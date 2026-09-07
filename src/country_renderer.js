import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';

// Natural Earth is vector boundary data, not raster map tiles. It is public-domain
// cartographic data and is used here only for modern political boundaries.
const COUNTRIES_URL='https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson';
const cache=new Map();

export async function loadCountries(){
  if(cache.has('countries'))return cache.get('countries');
  const p=fetch(COUNTRIES_URL).then(async r=>{if(!r.ok)throw new Error(`Country data HTTP ${r.status}`);return r.json()});
  cache.set('countries',p);return p;
}

export function countryName(feature){
  const p=feature?.properties||{};
  return p.ADMIN||p.NAME_LONG||p.NAME||p.SOVEREIGNT||'Unknown';
}

export function countryIso(feature){
  const p=feature?.properties||{};
  return p.ISO_A3||p.ADM0_A3||p.SU_A3||'';
}

function spherePoint(lon,lat,r=1.006){
  const a=THREE.MathUtils.degToRad(lat),b=THREE.MathUtils.degToRad(lon),c=Math.cos(a);
  return new THREE.Vector3(r*c*Math.cos(b),r*Math.sin(a),r*c*Math.sin(b));
}

function normalizeRing(ring){
  if(!ring?.length)return [];
  const first=ring[0]?.[0]??0;
  let previous=first;
  return ring.map(([lon,lat])=>{
    let x=lon;
    while(x-previous>180)x-=360;
    while(x-previous<-180)x+=360;
    previous=x;
    return [x,lat];
  });
}

function centroidOfFeature(feature){
  const geom=feature?.geometry;
  if(!geom)return [0,0];
  let sx=0,sy=0,n=0;
  const consume=(coords)=>{
    if(!Array.isArray(coords))return;
    if(typeof coords[0]==='number'){sx+=coords[0];sy+=coords[1];n++;return;}
    coords.forEach(consume);
  };
  consume(geom.coordinates);
  return n?[sx/n,sy/n]:[0,0];
}

function colorFromIndex(i){
  const golden=.618033988749895;
  const h=(i*golden)%1;
  return new THREE.Color().setHSL(h,.42,.62);
}

function makeCountryMesh(feature,color){
  const geom=feature.geometry;
  if(!geom)return null;
  const polygons=geom.type==='Polygon'?[geom.coordinates]:geom.type==='MultiPolygon'?geom.coordinates:[];
  const positions=[];
  const indices=[];
  let vertexOffset=0;
  const center=centroidOfFeature(feature);

  for(const polygon of polygons){
    const ring=normalizeRing(polygon?.[0]);
    if(ring.length<4)continue;
    const pts=ring.map(([lon,lat])=>new THREE.Vector2((lon-center[0])*Math.cos(THREE.MathUtils.degToRad(center[1])),lat-center[1]));
    const tris=THREE.ShapeUtils.triangulateShape(pts,[]);
    for(const [lon,lat] of ring)positions.push(...spherePoint(lon,lat).toArray());
    for(const tri of tris)indices.push(vertexOffset+tri[0],vertexOffset+tri[1],vertexOffset+tri[2]);
    vertexOffset+=ring.length;
  }
  if(!positions.length||!indices.length)return null;
  const buffer=new THREE.BufferGeometry();
  buffer.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  buffer.setIndex(indices);buffer.computeVertexNormals();
  const material=new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide,transparent:true,opacity:.88,depthWrite:false});
  const mesh=new THREE.Mesh(buffer,material);mesh.renderOrder=4;return mesh;
}

function makeBorderLines(feature,color,width=1){
  const geom=feature.geometry;if(!geom)return null;
  const polys=geom.type==='Polygon'?[geom.coordinates]:geom.type==='MultiPolygon'?geom.coordinates:[];
  const g=new THREE.Group();
  for(const polygon of polys){
    for(const rawRing of polygon){
      const ring=normalizeRing(rawRing);if(ring.length<2)continue;
      const pts=ring.map(([lon,lat])=>spherePoint(lon,lat,1.009));
      const line=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color,transparent:true,opacity:.9}));
      line.renderOrder=5;g.add(line);
    }
  }
  return g;
}

export function buildCountryLayer(fc,{selectedIso=null}={}){
  const group=new THREE.Group();
  const borders=new THREE.Group();
  const features=fc?.features||[];
  features.forEach((feature,i)=>{
    const iso=countryIso(feature);
    const selected=selectedIso&&iso===selectedIso;
    const color=selected?new THREE.Color(0xf2c94c):colorFromIndex(i+1);
    const mesh=makeCountryMesh(feature,color);
    if(mesh)group.add(mesh);
    const border=makeBorderLines(feature,selected?0xffffff:0x26333c);
    if(border)borders.add(border);
  });
  group.add(borders);
  return group;
}

export function findCountry(fc,name){
  return (fc?.features||[]).find(f=>countryName(f).toLowerCase()===name.toLowerCase())||null;
}

export function availableCountryNames(fc){
  return (fc?.features||[]).map(countryName).filter(Boolean).sort((a,b)=>a.localeCompare(b));
}
