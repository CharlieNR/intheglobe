import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js';
import {feature} from 'https://cdn.jsdelivr.net/npm/topojson-client@3/+esm';
import {geoEquirectangular,geoPath} from 'https://cdn.jsdelivr.net/npm/d3-geo@3/+esm';

const GWS_SERVERS=[
  'https://gws.gplates.org/reconstruct/',
  'https://gws1.gplates.org/reconstruct/',
  'https://gws2.gplates.org/reconstruct/'
];
const MODERN_COUNTRIES='https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json';
const CACHE_DB='intheglobe-cache-v3';
const CACHE_STORE='json';
const MAX_LIVE_PALEO_DATA=6;
const PALEO_MODEL_MAX_AGE=600;

function geoPoint(lon,lat,r=1){
  const a=THREE.MathUtils.degToRad(lat),b=THREE.MathUtils.degToRad(lon);
  return new THREE.Vector3(Math.cos(a)*Math.cos(b),Math.sin(a),-Math.cos(a)*Math.sin(b)).multiplyScalar(r);
}
function geometries(g,out=[]){
  if(!g)return out;
  if(g.type==='FeatureCollection')g.features.forEach(f=>geometries(f.geometry,out));
  else if(g.type==='Feature')geometries(g.geometry,out);
  else if(g.type==='GeometryCollection')g.geometries?.forEach(x=>geometries(x,out));
  else out.push(g);
  return out;
}
function addGeometryLines(group,geometry,radius,material){
  const positions=[];
  for(const g of geometries(geometry)){
    const lines=g.type==='LineString'?[g.coordinates]:g.type==='MultiLineString'?g.coordinates:g.type==='Polygon'?g.coordinates:g.type==='MultiPolygon'?g.coordinates.flat(1):[];
    for(const ring of lines){
      if(!Array.isArray(ring)||ring.length<2)continue;
      for(let i=0;i<ring.length-1;i++){
        const p0=ring[i],p1=ring[i+1];
        if(!Array.isArray(p0)||!Array.isArray(p1)||p0.length<2||p1.length<2)continue;
        const a=geoPoint(Number(p0[0]),Number(p0[1]),radius),b=geoPoint(Number(p1[0]),Number(p1[1]),radius);
        positions.push(a.x,a.y,a.z,b.x,b.y,b.z);
      }
    }
  }
  if(!positions.length)return;
  const geometryBuffer=new THREE.BufferGeometry();
  geometryBuffer.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometryBuffer.computeBoundingSphere();
  const line=new THREE.LineSegments(geometryBuffer,material);
  line.renderOrder=20;
  group.add(line);
}
function makeGeoTexture(data,{fill=null,stroke='rgba(70,183,255,.90)',lineWidth=2,size=4096}={}){
  const canvas=document.createElement('canvas');
  canvas.width=size;canvas.height=size/2;
  const ctx=canvas.getContext('2d',{alpha:true});
  if(!ctx)throw new Error('Canvas 2D unavailable');
  const projection=geoEquirectangular().scale(size/(2*Math.PI)).translate([size/2,canvas.height/2]);
  const path=geoPath(projection,ctx);
  ctx.clearRect(0,0,canvas.width,canvas.height);
  if(fill)ctx.fillStyle=fill;
  if(stroke&&lineWidth>0){ctx.strokeStyle=stroke;ctx.lineWidth=lineWidth;ctx.lineJoin='round';ctx.lineCap='round';}
  if(data){ctx.beginPath();path(data);if(fill)ctx.fill('evenodd');if(stroke&&lineWidth>0)ctx.stroke();}
  const texture=new THREE.CanvasTexture(canvas);
  texture.colorSpace=THREE.SRGBColorSpace;texture.needsUpdate=true;
  texture.minFilter=THREE.LinearFilter;texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=false;
  return texture;
}
function textureGlobe(data,radius,options={}){
  const group=new THREE.Group();
  const texture=makeGeoTexture(data,options);
  const material=new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,side:THREE.DoubleSide});
  const mesh=new THREE.Mesh(new THREE.SphereGeometry(radius,160,112),material);
  mesh.renderOrder=15;group.add(mesh);group.userData.__texture=texture;return group;
}
function openPersistentDB(){
  if(typeof indexedDB==='undefined')return Promise.resolve(null);
  if(openPersistentDB.promise)return openPersistentDB.promise;
  openPersistentDB.promise=new Promise((resolve,reject)=>{
    const request=indexedDB.open(CACHE_DB,1);
    request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(CACHE_STORE))db.createObjectStore(CACHE_STORE)};
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error('IndexedDB unavailable'));
  });
  return openPersistentDB.promise;
}
async function persistentGet(key){
  try{const db=await openPersistentDB();if(!db)return null;return await new Promise((resolve,reject)=>{const tx=db.transaction(CACHE_STORE,'readonly'),req=tx.objectStore(CACHE_STORE).get(key);req.onsuccess=()=>resolve(req.result??null);req.onerror=()=>reject(req.error||new Error('IndexedDB read failed'));});}
  catch{return null}
}
async function persistentPut(key,value){
  try{const db=await openPersistentDB();if(!db)return;await new Promise((resolve,reject)=>{const tx=db.transaction(CACHE_STORE,'readwrite');tx.objectStore(CACHE_STORE).put(value,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('IndexedDB write failed'));});}
  catch{}
}
let modernCountriesPromise=null;
export async function loadModernCountries(){
  if(!modernCountriesPromise){modernCountriesPromise=fetch(MODERN_COUNTRIES,{cache:'force-cache'}).then(r=>{if(!r.ok)throw new Error(`Country data HTTP ${r.status}`);return r.json();}).then(t=>feature(t,t.objects.countries));}
  return modernCountriesPromise;
}
export async function loadModernCountryBorders(radius=1.006){return textureGlobe(await loadModernCountries(),radius,{fill:null,stroke:'rgba(70,183,255,.90)',lineWidth:2,size:2048});}
export async function loadModernCountryOverlay(radius=1.012){return textureGlobe(await loadModernCountries(),radius,{fill:'rgba(22,140,255,.24)',stroke:null,lineWidth:0,size:2048});}

const paleoCache=new Map();const paleoPromiseCache=new Map();
function rememberPaleoData(key,value){paleoCache.delete(key);paleoCache.set(key,value);while(paleoCache.size>MAX_LIVE_PALEO_DATA)paleoCache.delete(paleoCache.keys().next().value);}
async function fetchPaleoFromGWS(age,model){
  const errors=[];
  for(const base of GWS_SERVERS){
    const url=`${base}coastlines/?time=${encodeURIComponent(age)}&model=${encodeURIComponent(model)}`;
    let lastError=null;
    for(let attempt=0;attempt<2;attempt++){
      try{
        const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),45000);
        let response;try{response=await fetch(url,{cache:'no-store',signal:controller.signal});}finally{clearTimeout(timeout)}
        if(!response.ok)throw new Error(`GPlates HTTP ${response.status}`);
        const data=await response.json();
        if(!data||typeof data!=='object'||data.type!=='FeatureCollection'||!Array.isArray(data.features))throw new Error('GPlates returned invalid GeoJSON');
        return data;
      }catch(error){lastError=error;await new Promise(resolve=>setTimeout(resolve,350*(attempt+1)));}
    }
    errors.push(`${new URL(base).hostname}: ${lastError?.message||lastError}`);
  }
  throw new Error(`Historical GPlates request failed · ${errors.join(' · ')}`);
}
async function getPaleoData(year,model='CAO2024'){
  const age=Math.max(0,Math.min(PALEO_MODEL_MAX_AGE,-year/1e6));
  const key=`paleo:${model}:${Math.round(age*10)/10}`;
  if(paleoCache.has(key)){const value=paleoCache.get(key);paleoCache.delete(key);paleoCache.set(key,value);return value;}
  if(paleoPromiseCache.has(key))return paleoPromiseCache.get(key);
  const promise=(async()=>{const persisted=await persistentGet(key);if(persisted){rememberPaleoData(key,persisted);return persisted;}const data=await fetchPaleoFromGWS(age,model);await persistentPut(key,data);rememberPaleoData(key,data);return data;})();
  paleoPromiseCache.set(key,promise);try{return await promise}finally{if(paleoPromiseCache.get(key)===promise)paleoPromiseCache.delete(key);}
}
export async function loadPaleoLand(year,model='CAO2024',radius=1.002){return textureGlobe(await getPaleoData(year,model),radius,{fill:'rgba(158,180,141,1)',stroke:null,lineWidth:0,size:4096});}
export async function loadPaleoCoastlines(year,model='CAO2024',radius=1.008){const group=new THREE.Group();addGeometryLines(group,await getPaleoData(year,model),radius,new THREE.LineBasicMaterial({color:0xe5f5ec,transparent:true,opacity:.95,depthWrite:false}));return group;}
export function timelineAges(){const ages=[];for(let a=0;a<=50;a++)ages.push(a);for(let a=52.5;a<=150;a+=2.5)ages.push(Number(a.toFixed(1)));for(let a=155;a<=600;a+=5)ages.push(a);return ages;}
export function timelineBracket(year){const age=Math.max(0,Math.min(PALEO_MODEL_MAX_AGE,-Number(year||0)/1e6));const ages=timelineAges();if(age<=ages[0])return{lower:ages[0],upper:ages[0],t:0};if(age>=ages.at(-1))return{lower:ages.at(-1),upper:ages.at(-1),t:0};for(let i=0;i<ages.length-1;i++){if(age>=ages[i]&&age<=ages[i+1])return{lower:ages[i],upper:ages[i+1],t:(age-ages[i])/(ages[i+1]-ages[i])};}return{lower:0,upper:0,t:0};}
export async function prefetchPaleoFrames(ages,model='CAO2024',concurrency=2,onProgress=()=>{}){
  const list=[...ages];if(!list.length)return true;let completed=0,next=0,failed=0;
  const worker=async()=>{while(true){const index=next++;if(index>=list.length)return;const age=list[index];try{await getPaleoData(-age*1e6,model)}catch(error){failed++;console.warn('[InTheGlobe] Background paleo frame failed',age,error);}completed++;onProgress((completed-failed)/list.length,completed-failed,list.length,age);await new Promise(resolve=>setTimeout(resolve,25));}};
  await Promise.all(Array.from({length:Math.min(Math.max(1,concurrency),list.length)},worker));return failed===0;
}

const reconstructedCountryCache=new Map();
function countryParts(countryFeature){const g=countryFeature?.geometry;if(!g)return[];if(g.type==='MultiPolygon')return g.coordinates.map((coordinates,index)=>({type:'Feature',properties:{...(countryFeature.properties||{}),__countryPart:index+1},geometry:{type:'Polygon',coordinates}}));return[{...countryFeature,properties:{...(countryFeature.properties||{})}}];}
function hashText(text){let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(16);}
async function reconstructFeatureCollection(fc,timeMa,model='CAO2024'){
  const key=`country:${model}:${Math.round(timeMa*2)/2}:${hashText(JSON.stringify(fc.features.map(f=>f.geometry)))}`;
  if(reconstructedCountryCache.has(key))return reconstructedCountryCache.get(key);
  const persisted=await persistentGet(key);if(persisted){reconstructedCountryCache.set(key,Promise.resolve(persisted));return persisted;}
  const promise=(async()=>{
    const errors=[];
    for(const base of GWS_SERVERS){
      try{
        const response=await fetch(`${base}reconstruct_feature_collection`,{method:'POST',body:new URLSearchParams({feature_collection:JSON.stringify(fc),time:String(timeMa),model}),cache:'no-store'});
        if(!response.ok)throw new Error(`GPlates reconstruction HTTP ${response.status}`);
        const data=await response.json();
        if(!data||typeof data!=='object')throw new Error('GPlates reconstruction returned invalid JSON');
        void persistentPut(key,data);
        return data;
      }catch(error){errors.push(error?.message||String(error));}
    }
    throw new Error(`Country reconstruction failed · ${errors.join(' · ')}`);
  })();
  reconstructedCountryCache.set(key,promise);return promise;
}
export async function loadReconstructedCountry(countryFeature,timeMa,model='CAO2024',radius=1.016){const parts=countryParts(countryFeature);if(!parts.length)throw new Error('Country has no reconstructable geometry');const reconstructed=await Promise.all(parts.map(part=>reconstructFeatureCollection({type:'FeatureCollection',features:[part]},timeMa,model)));return makeCountryHighlight({type:'FeatureCollection',features:reconstructed.flatMap(fc=>fc.features||[])},radius);}
export async function loadReconstructedCountryBorders(countryCollection,timeMa,model='CAO2024',radius=1.012){
  if(!countryCollection?.features?.length)throw new Error('No modern country geometry available');
  const key=`country-borders:${model}:${Math.round(timeMa*2)/2}:${hashText(JSON.stringify(countryCollection.features.map(f=>f.geometry)))}`;
  if(reconstructedCountryCache.has(key))return reconstructedCountryCache.get(key);
  const persisted=await persistentGet(key);
  if(persisted){
    const group=new THREE.Group();
    addGeometryLines(group,persisted,radius,new THREE.LineBasicMaterial({color:0xb7d8e8,transparent:true,opacity:.82,depthWrite:false}));
    reconstructedCountryCache.set(key,Promise.resolve(persisted));
    return group;
  }
  const promise=(async()=>{
    let data=null;const errors=[];
    const payload=JSON.stringify({type:'FeatureCollection',features:countryCollection.features});
    for(const base of GWS_SERVERS){
      try{
        const response=await fetch(`${base}reconstruct_feature_collection`,{method:'POST',body:new URLSearchParams({feature_collection:payload,time:String(timeMa),model}),cache:'no-store'});
        if(!response.ok)throw new Error(`GPlates reconstruction HTTP ${response.status}`);
        data=await response.json();
        if(!data||data.type!=='FeatureCollection'||!Array.isArray(data.features))throw new Error('GPlates returned invalid reconstructed country GeoJSON');
        break;
      }catch(error){errors.push(`${new URL(base).hostname}: ${error?.message||error}`);}
    }
    if(!data)throw new Error(`Historical country borders failed · ${errors.join(' · ')}`);
    await persistentPut(key,data);
    return data;
  })();
  reconstructedCountryCache.set(key,promise);
  const data=await promise;
  const group=new THREE.Group();
  addGeometryLines(group,data,radius,new THREE.LineBasicMaterial({color:0xb7d8e8,transparent:true,opacity:.82,depthWrite:false}));
  return group;
}
export function prefetchReconstructedCountryFrames(countryFeature,agesMa,model='CAO2024',concurrency=12,onProgress){return Promise.resolve(true);}
export function makeCountryHighlight(data,radius=1.012){return textureGlobe(data,radius,{fill:'rgba(255,20,147,.42)',stroke:'rgba(255,20,147,1)',lineWidth:2,size:4096});}
export function disposeLineGroup(group){if(!group)return;group.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material.dispose();}if(o.userData?.__texture)o.userData.__texture.dispose();});}
export function timelineCachedProgress(){return 0;}
export function paleogeographyAge(year){return Math.max(0,-year/1e6);}
