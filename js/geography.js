import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js';
import {feature} from 'https://cdn.jsdelivr.net/npm/topojson-client@3/+esm';

const GWS='https://gws.gplates.org/reconstruct/coastlines/';
const MODERN_COUNTRIES='https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

function geoPoint(lon,lat,r=1){const a=THREE.MathUtils.degToRad(lat),b=THREE.MathUtils.degToRad(lon);return new THREE.Vector3(Math.cos(a)*Math.cos(b),Math.sin(a),Math.cos(a)*Math.sin(b)).multiplyScalar(r)}
function addGeometryLines(group,geometry,radius,material){
  const rings=[];
  const collect=g=>{if(!g)return;if(g.type==='Polygon')g.coordinates.forEach(r=>rings.push(r));else if(g.type==='MultiPolygon')g.coordinates.forEach(p=>p.forEach(r=>rings.push(r)));else if(g.type==='LineString')rings.push(g.coordinates);else if(g.type==='MultiLineString')g.coordinates.forEach(r=>rings.push(r));};
  if(geometry.type==='FeatureCollection')geometry.features.forEach(f=>collect(f.geometry));else if(geometry.type==='Feature')collect(geometry.geometry);else collect(geometry);
  for(const ring of rings){if(ring.length<2)continue;const pts=ring.map(([lon,lat])=>geoPoint(lon,lat,radius));const g=new THREE.BufferGeometry().setFromPoints(pts);group.add(new THREE.Line(g,material));}
}

export async function loadModernCountryBorders(radius=1.006){
  const topo=await fetch(MODERN_COUNTRIES,{cache:'force-cache'}).then(r=>{if(!r.ok)throw new Error(`Country data HTTP ${r.status}`);return r.json()});
  const countries=feature(topo,topo.objects.countries);
  const group=new THREE.Group();
  const material=new THREE.LineBasicMaterial({color:0xb7d8e8,transparent:true,opacity:.48,depthWrite:false,blending:THREE.AdditiveBlending});
  addGeometryLines(group,countries,radius,material);
  return group;
}

const cache=new Map();
export async function loadPaleoCoastlines(year,model='CAO2024',radius=1.008){
  const age=Math.max(0,Math.min(1800,-year/1e6));
  const key=`${model}:${Math.round(age*10)/10}`;
  if(cache.has(key))return cache.get(key).clone();
  const url=`${GWS}?time=${encodeURIComponent(age)}&model=${encodeURIComponent(model)}`;
  const data=await fetch(url,{cache:'force-cache'}).then(r=>{if(!r.ok)throw new Error(`GPlates HTTP ${r.status}`);return r.json()});
  const group=new THREE.Group();
  const material=new THREE.LineBasicMaterial({color:0xd9f3e6,transparent:true,opacity:.78,depthWrite:false});
  addGeometryLines(group,data,radius,material);
  cache.set(key,group);
  return group.clone();
}

export function disposeLineGroup(group){if(!group)return;group.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material.dispose()}})}

export function paleogeographyAge(year){return Math.max(0,-year/1e6)}
