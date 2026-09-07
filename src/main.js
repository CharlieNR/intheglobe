import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {TimeController,sliderToYear,yearToSlider,formatYear,MIN_YEAR,MAX_YEAR} from './time_controller.js';
import {staticPolygons,coastlines,assignPlateIds,reconstructPoints,currentEulerPerMa,featurePid,MODEL} from './gplates_client.js';
import {COUNTRIES} from './country_tracker.js';

const canvas=document.querySelector('#globe');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;
const scene=new THREE.Scene();scene.background=new THREE.Color(0x04070b);
const camera=new THREE.PerspectiveCamera(38,innerWidth/innerHeight,.01,20);camera.position.set(0,0,3.15);
const controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.minDistance=1.3;controls.maxDistance=8;
scene.add(new THREE.AmbientLight(0xffffff,.65));const sun=new THREE.DirectionalLight(0xffffff,2.0);sun.position.set(4,2,5);scene.add(sun);

const ocean=new THREE.Mesh(new THREE.SphereGeometry(1,128,64),new THREE.MeshPhongMaterial({color:0x123a52,shininess:12}));scene.add(ocean);
const overlays=new THREE.Group();scene.add(overlays);
const trackerGroup=new THREE.Group();scene.add(trackerGroup);
const trackerMarker=new THREE.Mesh(new THREE.SphereGeometry(.025,16,8),new THREE.MeshBasicMaterial({color:0xffd34d}));trackerGroup.add(trackerMarker);
const trackerRing=new THREE.Mesh(new THREE.RingGeometry(.035,.045,24),new THREE.MeshBasicMaterial({color:0xffd34d,side:THREE.DoubleSide}));trackerGroup.add(trackerRing);

const timeline=document.querySelector('#timeline'),yearInput=document.querySelector('#yearInput'),era=document.querySelector('#era'),play=document.querySelector('#play'),status=document.querySelector('#status');
const countrySelect=document.querySelector('#country');COUNTRIES.forEach((c,i)=>{const o=document.createElement('option');o.value=i;o.textContent=c.name;countrySelect.appendChild(o)});countrySelect.value='0';
let followedCountry=null;let countryPid=null;let countryEuler=null;let currentGeoYear=null;let requestSerial=0;let pendingRender=null;let plateEulerCache=new Map();

const R=1.012;function llv(lon,lat,r=R){const a=lat*Math.PI/180,b=lon*Math.PI/180,c=Math.cos(a);return new THREE.Vector3(r*c*Math.cos(b),r*Math.sin(a),r*c*Math.sin(b));}
function rotVec(v,euler,ma){const axis=llv(euler.lon,euler.lat,1).normalize();const q=new THREE.Quaternion().setFromAxisAngle(axis,THREE.MathUtils.degToRad(-euler.angleDegPerMa*ma));return v.clone().applyQuaternion(q);}
function clearGroup(g){while(g.children.length){const c=g.children.pop();c.geometry?.dispose?.();c.material?.dispose?.();}}
function polygonGroup(coords,color,opacity=.56){
 const g=new THREE.Group();if(!coords?.length)return g;
 for(const ring of coords){if(!ring||ring.length<2)continue;const pts=ring.map(([lon,lat])=>llv(lon,lat));const geo=new THREE.BufferGeometry().setFromPoints(pts);g.add(new THREE.LineLoop(geo,new THREE.LineBasicMaterial({color,transparent:true,opacity:.95})));}
 return g;
}
function featureToGroup(feature,color=0x7fc98b){const g=new THREE.Group(),geom=feature.geometry;if(!geom)return g;const polys=geom.type==='Polygon'?[geom.coordinates]:geom.type==='MultiPolygon'?geom.coordinates:[];for(const poly of polys){const r=polygonGroup(poly,color);g.add(r)}return g}
function colorForPid(pid){let h=(Math.abs(pid)*0.61803398875)%1;const c=new THREE.Color();c.setHSL(h,.62,.52);return c;}
function transformFeatureFuture(feature,eulerByPid,years){const pid=featurePid(feature),e=eulerByPid.get(pid);if(!e)return feature;const clone={...feature,geometry:{...feature.geometry,coordinates:structuredClone(feature.geometry.coordinates)}};const t=x=>{if(Array.isArray(x)&&typeof x[0]==='number')return [THREE.MathUtils.radToDeg(Math.atan2(rotVec(llv(x[0],x[1],1),e,years).z,rotVec(llv(x[0],x[1],1),e,years).x)),THREE.MathUtils.radToDeg(Math.asin(rotVec(llv(x[0],x[1],1),e,years).y))];return x.map(t)};clone.geometry.coordinates=t(clone.geometry.coordinates);return clone;}

async function buildHistorical(timeMa){
 const serial=++requestSerial;status.textContent=`Loading ${MODEL} reconstruction at ${timeMa.toFixed(2)} Ma…`;
 try{const [plates,coast]=await Promise.all([staticPolygons(timeMa),coastlines(timeMa)]);if(serial!==requestSerial)return;clearGroup(overlays);const pg=new THREE.Group();for(const f of plates.features||[]){const pid=featurePid(f);pg.add(featureToGroup(f,colorForPid(pid)));}overlays.add(pg);const cg=new THREE.Group();for(const f of coast.features||[]){cg.add(featureToGroup(f,0xe7e2ba));}for(const c of cg.children)c.scale.setScalar(1.004);overlays.add(cg);currentGeoYear=timeMa;status.textContent=`${MODEL} · published GPlates reconstruction`;updateTracker(timeMa);}
 catch(e){console.error(e);status.textContent='GPlates data request failed; check network access.'}}

async function ensureFutureEulers(features){const pids=[...new Set((features.features||[]).map(featurePid).filter(Boolean))];for(const pid of pids){if(!plateEulerCache.has(pid)){try{plateEulerCache.set(pid,await currentEulerPerMa(pid))}catch{}}}return plateEulerCache;}
async function buildFuture(yearMa){const serial=++requestSerial;const base=await staticPolygons(0);if(serial!==requestSerial)return;const eulers=await ensureFutureEulers(base);clearGroup(overlays);for(const f of base.features||[]){const tf=transformFeatureFuture(f,eulers,yearMa);overlays.add(featureToGroup(tf,colorForPid(featurePid(f))))}currentGeoYear=0;status.textContent='Future: present-day Euler motion extrapolated at constant rate';updateTracker(yearMa)}

function updateTracker(timeMa){if(!followedCountry){trackerMarker.visible=false;trackerRing.visible=false;return}trackerMarker.visible=true;trackerRing.visible=true;let v=llv(followedCountry.lon,followedCountry.lat,1.025);if(timeMa<0){reconstructPoints([followedCountry.lat],[followedCountry.lon],Math.abs(timeMa)).then(d=>{const coords=d?.features?.[0]?.geometry?.coordinates;if(coords){v=llv(coords[0],coords[1],1.025);trackerMarker.position.copy(v);trackerRing.position.copy(v);}}).catch(()=>{});}else if(countryEuler&&countryPid){v=rotVec(v,countryEuler,timeMa);trackerMarker.position.copy(v);trackerRing.position.copy(v)}else{trackerMarker.position.copy(v);trackerRing.position.copy(v)}trackerRing.lookAt(v.clone().multiplyScalar(2));}

async function selectCountry(){const c=COUNTRIES[Number(countrySelect.value)];followedCountry=c.name==='None'?null:c;if(!followedCountry){countryPid=null;countryEuler=null;updateTracker(tc.year/1e6);return}try{const ids=await assignPlateIds([c.lat],[c.lon]);countryPid=Array.isArray(ids)?Number(ids[0]):Number(ids?.plate_ids?.[0]??ids?.[0]);if(countryPid)countryEuler=await currentEulerPerMa(countryPid);}catch{countryPid=null;countryEuler=null}updateTracker(tc.year/1e6);}

const tc=new TimeController({onChange:geologicalYear=>{yearInput.value=Math.round(geologicalYear);era.textContent=geologicalYear<0?formatYear(geologicalYear):geologicalYear===0?'Present':formatYear(geologicalYear);timeline.value=yearToSlider(geologicalYear/1e6)*1e6;const ma=geologicalYear/1e6;if(tc.playing){scheduleRender(Math.round(ma));}else scheduleRender(Math.round(ma));}});
function scheduleRender(ma){if(pendingRender===ma)return;pendingRender=ma;if(ma>0)buildFuture(ma);else buildHistorical(Math.max(0,Math.min(600,-ma)));}

timeline.addEventListener('input',()=>{});timeline.addEventListener('change',()=>tc.setYear(sliderToYear(Number(timeline.value)/1e6)*1e6));
document.querySelector('#go').onclick=()=>tc.setYear(Number(yearInput.value)||0);yearInput.addEventListener('keydown',e=>{if(e.key==='Enter')tc.setYear(Number(yearInput.value)||0)});
play.onclick=()=>{const playing=tc.toggle();if(playing){play.textContent='❚❚ Pause';play.classList.add('active')}else{play.textContent='▶ Play';play.classList.remove('active')}};
document.querySelector('#stepBack').onclick=()=>tc.setYear(tc.year-1e6);document.querySelector('#stepForward').onclick=()=>tc.setYear(tc.year+1e6);
document.querySelectorAll('[data-speed]').forEach(b=>b.onclick=()=>{tc.setSpeed(Number(b.dataset.speed));document.querySelectorAll('[data-speed]').forEach(x=>x.classList.remove('active'));b.classList.add('active')});document.querySelector('[data-speed="1"]').classList.add('active');
document.querySelector('#heatmap').onchange=()=>{};countrySelect.onchange=selectCountry;
const panelToggle=document.querySelector('#panelToggle');panelToggle.onclick=()=>{const hud=document.querySelector('#hud');hud.classList.toggle('minimised');const open=!hud.classList.contains('minimised');panelToggle.setAttribute('aria-expanded',String(open));panelToggle.textContent=open?'⌄':'⌃'};
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
function render(){controls.update();if(followedCountry&&tc.playing){const c=countryWorldPosition(followedCountry,tc.year);const desired=c.clone().normalize().multiplyScalar(2.4);camera.position.lerp(desired,.06);controls.target.lerp(c.clone().multiplyScalar(.92),.06)}renderer.render(scene,camera);requestAnimationFrame(render)}
function countryWorldPosition(c,year){let v=llv(c.lon,c.lat,1);if(year>0&&countryEuler)v=rotVec(v,countryEuler,year);return v;}

timeline.value=yearToSlider(0)*1e6;scheduleRender(0);tc.start();requestAnimationFrame(render);
