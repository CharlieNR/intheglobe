import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js';
import {feature} from 'https://cdn.jsdelivr.net/npm/topojson-client@3/+esm';
import {geoEquirectangular, geoPath} from 'https://cdn.jsdelivr.net/npm/d3-geo@3/+esm';

const GWS='https://gws.gplates.org/reconstruct/';
const MODERN_COUNTRIES='https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json';
const CACHE_DB='intheglobe-cache-v3';
const CACHE_STORE='json';
const CACHE_VERSION=3;
const TIMELINE_META='intheglobe.timeline.cache.v3';

function geoPoint(lon,lat,r=1){const a=THREE.MathUtils.degToRad(lat),b=THREE.MathUtils.degToRad(lon);return new THREE.Vector3(Math.cos(a)*Math.cos(b),Math.sin(a),-Math.cos(a)*Math.sin(b)).multiplyScalar(r)}
function geometries(g,out=[]){if(!g)return out;if(g.type==='FeatureCollection')g.features.forEach(f=>geometries(f.geometry,out));else if(g.type==='Feature')geometries(g.geometry,out);else out.push(g);return out}
function addGeometryLines(group,geometry,radius,material){const positions=[];for(const g of geometries(geometry)){const lines=g.type==='LineString'?[g.coordinates]:g.type==='MultiLineString'?g.coordinates:g.type==='Polygon'?g.coordinates:g.type==='MultiPolygon'?g.coordinates.flat(1):[];for(const ring of lines){if(!ring||ring.length<2)continue;for(let i=0;i<ring.length-1;i++){const a=geoPoint(ring[i][0],ring[i][1],radius),b=geoPoint(ring[i+1][0],ring[i+1][1],radius);positions.push(a.x,a.y,a.z,b.x,b.y,b.z)}}}if(!positions.length)return;const geometryBuffer=new THREE.BufferGeometry();geometryBuffer.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometryBuffer.computeBoundingSphere();const line=new THREE.LineSegments(geometryBuffer,material);line.renderOrder=20;group.add(line)}

// Geographic data is rasterised into an equirectangular texture before it reaches
// WebGL. This is deliberately used for modern and paleo geography: triangulating
// complex spherical polygons into enormous CPU/GPU meshes was the main source of
// malformed polygons and, after enough timeline frames, browser/WebGL memory loss.
function makeGeoTexture(data,{fill=null,stroke='rgba(70,183,255,0.90)',lineWidth=2,size=2048}={}){
  const canvas=document.createElement('canvas');canvas.width=size;canvas.height=Math.round(size/2);const ctx=canvas.getContext('2d');
  if(!ctx)throw new Error('Canvas 2D unavailable');
  const projection=geoEquirectangular().scale(size/(2*Math.PI)).translate([size/2,canvas.height/2]);
  const path=geoPath(projection,ctx);
  ctx.clearRect(0,0,canvas.width,canvas.height);
  if(fill){ctx.fillStyle=fill}
  if(stroke&&lineWidth>0){ctx.strokeStyle=stroke;ctx.lineWidth=lineWidth;ctx.lineJoin='round';ctx.lineCap='round'}
  if(data){ctx.beginPath();path(data);if(fill)ctx.fill();if(stroke&&lineWidth>0)ctx.stroke()}
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.needsUpdate=true;texture.minFilter=THREE.LinearFilter;texture.magFilter=THREE.LinearFilter;
  return texture;
}
function textureGlobe(data,radius,options={}){const group=new THREE.Group();const texture=makeGeoTexture(data,options);const material=new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,side:THREE.DoubleSide});const mesh=new THREE.Mesh(new THREE.SphereGeometry(radius,96,64),material);mesh.renderOrder=15;group.add(mesh);group.userData.__texture=texture;return group}

function openPersistentDB(){if(typeof indexedDB==='undefined')return Promise.resolve(null);if(openPersistentDB.promise)return openPersistentDB.promise;openPersistentDB.promise=new Promise((resolve,reject)=>{const request=indexedDB.open(CACHE_DB,1);request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(CACHE_STORE))db.createObjectStore(CACHE_STORE)};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error('IndexedDB unavailable'))});return openPersistentDB.promise}
async function persistentGet(key){try{const db=await openPersistentDB();if(!db)return null;return await new Promise((resolve,reject)=>{const tx=db.transaction(CACHE_STORE,'readonly');const req=tx.objectStore(CACHE_STORE).get(key);req.onsuccess=()=>resolve(req.result??null);req.onerror=()=>reject(req.error||new Error('IndexedDB read failed'))})}catch{return null}}
async function persistentPut(key,value){try{const db=await openPersistentDB();if(!db)return;await new Promise((resolve,reject)=>{const tx=db.transaction(CACHE_STORE,'readwrite');tx.objectStore(CACHE_STORE).put(value,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('IndexedDB write failed'))})}catch{}}
function timelineMetaSave(ready,total){try{localStorage.setItem(TIMELINE_META,JSON.stringify({version:CACHE_VERSION,ready,total,updatedAt:Date.now()}))}catch{}}
export function timelineCachedProgress(total){try{const raw=localStorage.getItem(TIMELINE_META);const meta=raw?JSON.parse(raw):null;if(meta?.version===CACHE_VERSION&&meta.total===total)return Math.max(0,Math.min(1,Number(meta.ready||0)/total))}catch{}return 0}

let modernCountriesPromise=null;
export async function loadModernCountries(){if(!modernCountriesPromise)modernCountriesPromise=fetch(MODERN_COUNTRIES,{cache:'force-cache'}).then(r=>{if(!r.ok)throw new Error(`Country data HTTP ${r.status}`);return r.json()}).then(topo=>feature(topo,topo.objects.countries));return modernCountriesPromise}
export async function loadModernCountryBorders(radius=1.006){const countries=await loadModernCountries();return textureGlobe(countries,radius,{fill:null,stroke:'rgba(70,183,255,0.90)',lineWidth:2,size:2048})}
export async function loadModernCountryOverlay(radius=1.012){const countries=await loadModernCountries();return textureGlobe(countries,radius,{fill:'rgba(22,140,255,0.24)',stroke:null,lineWidth:0,size:2048})}

// Only a handful of raw paleo frames are kept in JS memory. Prefetching writes the
// complete timeline to IndexedDB, but does not retain every GeoJSON object in RAM.
const paleoCache=new Map();
const MAX_LIVE_PALEO_DATA=3;
function rememberPaleoData(key,value){paleoCache.delete(key);paleoCache.set(key,value);while(paleoCache.size>MAX_LIVE_PALEO_DATA)paleoCache.delete(paleoCache.keys().next().value)}
async function getPaleoData(year,model='CAO2024'){
  const age=Math.max(0,Math.min(1800,-year/1e6));
  const key=`paleo:${model}:${Math.round(age*10)/10}`;
  if(paleoCache.has(key)){const value=paleoCache.get(key);paleoCache.delete(key);paleoCache.set(key,value);return value}
  const persisted=await persistentGet(key);if(persisted){rememberPaleoData(key,persisted);return persisted}
  const r=await fetch(`${GWS}coastlines/?time=${encodeURIComponent(age)}&model=${encodeURIComponent(model)}`,{cache:'no-store'});if(!r.ok)throw new Error(`GPlates HTTP ${r.status}`);
  const data=await r.json();await persistentPut(key,data);rememberPaleoData(key,data);return data;
}

// Rasterising the paleo land avoids ShapeUtils triangulating huge lon/lat polygons.
// d3-geo performs the spherical projection correctly, including difficult longitudes.
export async function loadPaleoLand(year,model='CAO2024',radius=1.002){const data=await getPaleoData(year,model);return textureGlobe(data,radius,{fill:'rgba(158,180,141,1)',stroke:null,lineWidth:0,size:2048})}
export async function loadPaleoCoastlines(year,model='CAO2024',radius=1.008){const data=await getPaleoData(year,model);return textureGlobe(data,radius,{fill:null,stroke:'rgba(217,243,230,0.90)',lineWidth:1.25,size:2048})}

export function timelineAges(){const ages=[];for(let a=0;a<=50;a+=1)ages.push(a);for(let a=52.5;a<=150;a+=2.5)ages.push(Number(a.toFixed(1)));for(let a=155;a<=600;a+=5)ages.push(a);return ages}
export function timelineBracket(year){const age=Math.max(0,Math.min(600,-Number(year||0)/1e6));const ages=timelineAges();if(age<=ages[0])return{lower:ages[0],upper:ages[0],t:0};if(age>=ages[ages.length-1])return{lower:ages[ages.length-1],upper:ages[ages.length-1],t:0};for(let i=0;i<ages.length-1;i++){const lower=ages[i],upper=ages[i+1];if(age>=lower&&age<=upper)return{lower,upper,t:(age-lower)/(upper-lower)}}return{lower:0,upper:0,t:0}}
export async function prefetchPaleoFrames(agesMa,model='CAO2024',concurrency=1,onProgress){const ages=[...new Set(agesMa.map(Number).filter(Number.isFinite).map(a=>Math.max(0,Math.min(600,a))))].sort((a,b)=>a-b);let completed=0,cursor=0;const worker=async()=>{while(true){const i=cursor++;if(i>=ages.length)return;const age=ages[i];const key=`paleo:${model}:${Math.round(age*10)/10}`;try{await getPaleoData(-age*1e6,model);completed++}catch{}finally{paleoCache.delete(key);timelineMetaSave(completed,ages.length);onProgress?.(completed/ages.length,completed,ages.length)}}};await Promise.all(Array.from({length:Math.min(concurrency,ages.length)},worker));return completed===ages.length}

const reconstructedCountryCache=new Map();
function countryParts(countryFeature){const geometry=countryFeature?.geometry;if(!geometry)return[];if(geometry.type==='MultiPolygon')return geometry.coordinates.map((coordinates,index)=>({type:'Feature',properties:{...(countryFeature.properties||{}),__countryPart:index+1},geometry:{type:'Polygon',coordinates}}));return[{...countryFeature,properties:{...(countryFeature.properties||{})}}]}
function hashText(text){let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)}return(h>>>0).toString(16)}
async function reconstructFeatureCollection(fc,timeMa,model='CAO2024'){const key=`country:${model}:${Math.round(timeMa*2)/2}:${hashText(JSON.stringify(fc.features.map(f=>f.geometry)))}`;if(reconstructedCountryCache.has(key))return reconstructedCountryCache.get(key);const persisted=await persistentGet(key);if(persisted){reconstructedCountryCache.set(key,Promise.resolve(persisted));return persisted}const body=new URLSearchParams();body.set('feature_collection',JSON.stringify(fc));body.set('time',String(timeMa));body.set('model',model);const promise=fetch(`${GWS}reconstruct_feature_collection`,{method:'POST',body}).then(async r=>{if(!r.ok)throw new Error(`GPlates reconstruction HTTP ${r.status}`);const data=await r.json();persistentPut(key,data);return data});reconstructedCountryCache.set(key,promise);return promise}
export async function loadReconstructedCountry(countryFeature,timeMa,model='CAO2024',radius=1.016){const parts=countryParts(countryFeature);if(!parts.length)throw new Error('Country has no reconstructable geometry');const reconstructed=await Promise.all(parts.map(part=>reconstructFeatureCollection({type:'FeatureCollection',features:[part]},timeMa,model)));return makeCountryHighlight({type:'FeatureCollection',features:reconstructed.flatMap(fc=>fc.features||[])},radius)}
export async function prefetchReconstructedCountryFrames(countryFeature,agesMa,model='CAO2024',concurrency=4,onProgress){const ages=[...new Set(agesMa.map(Number).filter(Number.isFinite).map(a=>Math.max(0,Math.min(600,a))))].sort((a,b)=>a-b);const parts=countryParts(countryFeature);let done=0,cursor=0;const worker=async()=>{while(true){const i=cursor++;if(i>=ages.length)return;try{await Promise.all(parts.map(part=>reconstructFeatureCollection({type:'FeatureCollection',features:[part]},ages[i],model)));done++}catch{}finally{onProgress?.(done/ages.length,done,ages.length)}}};await Promise.all(Array.from({length:Math.min(concurrency,ages.length)},worker));return done===ages.length}
export function makeCountryHighlight(data,radius=1.012){return textureGlobe(data,radius,{fill:'rgba(255,20,147,0.42)',stroke:'rgba(255,20,147,1)',lineWidth:2,size:2048})}
export function disposeLineGroup(group){if(!group)return;group.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material.dispose()}if(o.userData?.__texture)o.userData.__texture.dispose()})}
export function paleogeographyAge(year){return Math.max(0,-year/1e6)}
