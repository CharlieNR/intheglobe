import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js';
import {loadModernCountries} from './geography.js';

const MAX_FUTURE=250000000;
const PRESENT=2026;
let futureGroup=null;
let futureOcean=null;
let countryMeshes=[];
let initialised=false;
let countriesPromise=null;

function latLon(lat,lon){const a=lat*Math.PI/180,b=lon*Math.PI/180;return new THREE.Vector3(Math.cos(a)*Math.cos(b),Math.sin(a),Math.cos(a)*Math.sin(b)).normalize()}
function rotate(v,axis,angle){const q=new THREE.Quaternion().setFromAxisAngle(axis,angle);return v.clone().applyQuaternion(q).normalize()}
function flattenGeometry(g,out=[]){if(!g)return out;if(g.type==='FeatureCollection')g.features.forEach(f=>flattenGeometry(f.geometry,out));else if(g.type==='Feature')flattenGeometry(g.geometry,out);else out.push(g);return out}
function polygons(geometry){const out=[];for(const g of flattenGeometry(geometry)){if(g.type==='Polygon')out.push(g.coordinates);else if(g.type==='MultiPolygon')g.coordinates.forEach(p=>out.push(p))}return out}
function unwrapRing(ring){if(!ring?.length)return[];const out=[];let previous=Number(ring[0][0]);out.push([previous,Number(ring[0][1])]);for(let i=1;i<ring.length;i++){let lon=Number(ring[i][0]),lat=Number(ring[i][1]);while(lon-previous>180)lon-=360;while(lon-previous<-180)lon+=360;out.push([lon,lat]);previous=lon}return out}
function buildPolygonData(rings){const outer=unwrapRing(rings[0]);if(outer.length<3)return null;const anchor=outer[0][0];const holes=rings.slice(1).map(r=>{const u=unwrapRing(r);if(!u.length)return u;const shift=360*Math.round((anchor-u[0][0])/360);return u.map(([lon,lat])=>[lon+shift,lat])}).filter(r=>r.length>=3);const all=[outer,...holes];const contour=outer.map(([lon,lat])=>new THREE.Vector2(lon,lat));const holePoints=holes.map(r=>r.map(([lon,lat])=>new THREE.Vector2(lon,lat)));const triangles=THREE.ShapeUtils.triangulateShape(contour,holePoints);const base=[];for(const ring of all)for(const p of ring)base.push(p);const indices=[];for(const tri of triangles)indices.push(...tri);return{base,indices}}
function plateForPoint(lat,lon){if(lat<-55)return'antarctica';if(lon>110&&lat<-5)return'australia';if(lon>60&&lon<95&&lat>0&&lat<40)return'india';if(lon<-30&&lat>-10)return'americas';if(lon>=-30&&lon<60&&lat>-35&&lat<40)return'africa';return'eurasia'}
const axes={americas:latLon(20,-90),africa:latLon(-10,20),eurasia:latLon(45,85),india:latLon(5,75),australia:latLon(-25,135),antarctica:latLon(-80,0)};
const rates={americas:0.070,africa:-0.040,eurasia:0.025,india:0.060,australia:0.048,antarctica:0.012};
function targetVector(plate,v){
  const targets={americas:latLon(10,-5),africa:latLon(15,20),eurasia:latLon(25,35),india:latLon(15,35),australia:latLon(10,45),antarctica:latLon(-45,25)};
  const t=targets[plate];
  if(!t)return v;
  return v.lerp(t,0.16).normalize();
}
function makeMeshes(countries){
  const material=new THREE.MeshBasicMaterial({color:0x9fb98d,side:THREE.DoubleSide,transparent:false});
  for(const feature of countries.features||[]){
    const data=[];
    for(const rings of polygons(feature.geometry)){const built=buildPolygonData(rings);if(built)data.push(built)}
    if(!data.length)continue;
    const vertices=[];const groups=[];let offset=0;
    for(const item of data){const positions=new Float32Array(item.base.length*3);const plate=plateForPoint(item.base.reduce((s,p)=>s+p[1],0)/item.base.length,item.base.reduce((s,p)=>s+p[0],0)/item.base.length);groups.push({base:item.base,indices:item.indices,plate,positions,offset});offset+=item.base.length*3;vertices.push(positions)}
    const geo=new THREE.BufferGeometry();const combined=[];const idx=[];let vertexOffset=0;
    for(const group of groups){combined.push(...group.positions);for(const i of group.indices)idx.push(i+vertexOffset);vertexOffset+=group.base.length;}
    geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(combined),3));geo.setIndex(idx);geo.computeVertexNormals();
    const mesh=new THREE.Mesh(geo,material);mesh.renderOrder=5;futureGroup.add(mesh);countryMeshes.push({mesh,groups});
  }
}
function updateFuture(year){
  const future=year>PRESENT;
  if(!futureGroup)return;
  futureGroup.visible=future;
  if(futureOcean)futureOcean.visible=future;
  if(window.__intheglobeModernCountryOverlay)window.__intheglobeModernCountryOverlay.visible=!future && !!document.querySelector('#modernCountries')?.checked;
  if(!future)return;
  const myr=Math.max(0,Math.min(MAX_FUTURE,(year-PRESENT)/1000000));
  for(const entry of countryMeshes){
    const attr=entry.mesh.geometry.getAttribute('position');
    let cursor=0;
    for(const group of entry.groups){
      const angle=myr*rates[group.plate]*Math.PI/180;
      const axis=axes[group.plate]||axes.eurasia;
      for(const [lon,lat] of group.base){
        let v=latLon(lat,lon);
        v=rotate(v,axis,angle);
        const progress=Math.min(1,myr/250);
        if(progress>.35)v=v.lerp(targetVector(group.plate,v),((progress-.35)/.65)*.22).normalize();
        attr.array[cursor++]=v.x;attr.array[cursor++]=v.y;attr.array[cursor++]=v.z;
      }
    }
    attr.needsUpdate=true;
    entry.mesh.geometry.computeBoundingSphere();
  }
  futureGroup.rotation.y=(myr/250)*0.10;
}
async function init(earthGroup){
  if(initialised)return;initialised=true;
  futureGroup=new THREE.Group();futureGroup.name='FutureEarth';futureGroup.visible=false;futureGroup.renderOrder=4;earthGroup.add(futureGroup);
  futureOcean=new THREE.Mesh(new THREE.SphereGeometry(.998,96,72),new THREE.MeshBasicMaterial({color:0x176d9a}));futureOcean.visible=false;futureOcean.renderOrder=1;earthGroup.add(futureOcean);
  try{countriesPromise=countriesPromise||loadModernCountries();const countries=await countriesPromise;makeMeshes(countries)}catch(error){console.error('[InTheGlobe] Future Earth data error',error)}
  window.__intheglobeFutureEarth=futureGroup;
}
const originalSceneAdd=THREE.Scene.prototype.add;
if(!THREE.Scene.prototype.__intheglobeFutureHook){
  THREE.Scene.prototype.__intheglobeFutureHook=true;
  THREE.Scene.prototype.add=function(...objects){const result=originalSceneAdd.apply(this,objects);for(const object of objects){if(object?.isGroup&&!window.__intheglobeEarthGroup){window.__intheglobeEarthGroup=object;void init(object);break}}return result};
}
function tick(){
  const input=document.querySelector('#yearInput');const year=Number(input?.value||PRESENT);updateFuture(Number.isFinite(year)?year:PRESENT);requestAnimationFrame(tick)
}
requestAnimationFrame(tick);
