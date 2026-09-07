import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js';
import {OrbitControls} from 'https://cdn.jsdelivr.net/npm/three@0.161.0/examples/jsm/controls/OrbitControls.js';
import {TimeController} from './time_controller.js';
import {fragmentShader,vertexShader,atmosphereFragment,atmosphereVertex} from './shaders.js';
import {loadModernCountries,loadModernCountryBorders,loadPaleoCoastlines,loadPaleoLand,prefetchPaleoFrames,loadReconstructedCountry,makeCountryHighlight,disposeLineGroup} from './geography.js';

const canvas=document.querySelector('#globe');
const loading=document.querySelector('#loading');
const status=document.querySelector('#status');
const debugPanel=document.querySelector('#debugPanel');
const debugLog=document.querySelector('#debugLog');
const followSelect=document.querySelector('#followCountry');
const countrySearch=document.querySelector('#countrySearch');
const bufferAmount=document.querySelector('#bufferAmount');
const bufferFill=document.querySelector('#bufferFill');
const bufferNote=document.querySelector('#bufferNote');
const debugEntries=[];
const startedAt=performance.now();
const bufferStartedAt=performance.now();
let loadingFinished=false;
let bufferProgress=0;
let bufferPromise=null;
let prefetchFinished=false;

function debug(message,type='info'){const text=`[+${((performance.now()-startedAt)/1000).toFixed(2)}s] ${message}`;debugEntries.push({text,type});if(debugEntries.length>300)debugEntries.shift();if(debugLog){const line=document.createElement('div');line.className=`debug-entry ${type}`;line.textContent=text;debugLog.appendChild(line);debugLog.scrollTop=debugLog.scrollHeight}}
function finishLoading(message='READY'){if(loadingFinished)return;loadingFinished=true;loading.classList.add('done');status.textContent=message;debug(`Loading screen dismissed: ${message}`,'ok')}
function setBufferProgress(value,done,total){bufferProgress=Math.max(bufferProgress,Math.min(1,value));if(bufferAmount)bufferAmount.textContent=`${Math.round(bufferProgress*100)}%`;if(bufferFill)bufferFill.style.width=`${bufferProgress*100}%`;if(bufferNote&&!prefetchFinished)bufferNote.textContent=`Loading ${done}/${total} timeline frames in the background…`;}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms))}

window.addEventListener('error',e=>{debug(`Window error: ${e.message} @ ${e.filename||'unknown'}:${e.lineno||'?'}`,'error');finishLoading('READY · DATA DEGRADED')});
window.addEventListener('unhandledrejection',e=>{debug(`Unhandled promise rejection: ${e.reason?.stack||e.reason}`,'error');finishLoading('READY · DATA DEGRADED')});
debug('Booting InTheGlobe');
debug(`Browser: ${navigator.userAgent}`);debug(`WebGL canvas: ${canvas?'found':'MISSING'}`);

let renderer;
try{renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});debug('Three.js WebGLRenderer created','ok')}catch(e){debug(`WebGLRenderer failed: ${e.stack||e}`,'error');finishLoading('WEBGL INITIALISATION FAILED');throw e}
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
const scene=new THREE.Scene();scene.background=new THREE.Color(0x01050c);scene.add(new THREE.AmbientLight(0x9fc5dd,1.25));const sun=new THREE.DirectionalLight(0xffffff,2.2);sun.position.set(-3,2,4);scene.add(sun);
const camera=new THREE.PerspectiveCamera(35,innerWidth/innerHeight,.05,100);camera.position.set(0,0,3.05);const controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.dampingFactor=.045;controls.enablePan=false;controls.minDistance=1.65;controls.maxDistance=5;controls.rotateSpeed=.45;controls.zoomSpeed=.65;
const earthGroup=new THREE.Group();scene.add(earthGroup);const loader=new THREE.TextureLoader();
const fallbackDiffuse=new THREE.DataTexture(new Uint8Array([42,100,145,255]),1,1,THREE.RGBAFormat);fallbackDiffuse.needsUpdate=true;fallbackDiffuse.colorSpace=THREE.SRGBColorSpace;
const fallbackNormal=new THREE.DataTexture(new Uint8Array([128,128,255,255]),1,1,THREE.RGBAFormat);fallbackNormal.needsUpdate=true;
const fallbackSpecular=new THREE.DataTexture(new Uint8Array([35,35,35,255]),1,1,THREE.RGBAFormat);fallbackSpecular.needsUpdate=true;
const uniforms={uYear:{value:2026},uHeat:{value:1},uLight:{value:new THREE.Vector3(-.7,.35,.55).normalize()},uEarth:{value:fallbackDiffuse},uNormal:{value:fallbackNormal},uSpecular:{value:fallbackSpecular}};
const earth=loader.load('https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg',t=>{t.colorSpace=THREE.SRGBColorSpace;uniforms.uEarth.value=t;debug('Earth diffuse texture loaded','ok')},undefined,e=>debug(`Earth diffuse texture failed: ${e?.message||e}`,'error'));
loader.load('https://threejs.org/examples/textures/planets/earth_normal_2048.jpg',t=>{uniforms.uNormal.value=t;debug('Earth normal map loaded','ok')},undefined,e=>debug(`Earth normal map failed: ${e?.message||e}`,'warn'));
loader.load('https://threejs.org/examples/textures/planets/earth_specular_2048.jpg',t=>{uniforms.uSpecular.value=t;debug('Earth specular map loaded','ok')},undefined,e=>debug(`Earth specular map failed: ${e?.message||e}`,'warn'));
if(earth)earth.colorSpace=THREE.SRGBColorSpace;
const modernGlobe=new THREE.Mesh(new THREE.SphereGeometry(1,192,128),new THREE.ShaderMaterial({vertexShader,fragmentShader,uniforms}));earthGroup.add(modernGlobe);
const paleoOcean=new THREE.Mesh(new THREE.SphereGeometry(.999,128,96),new THREE.MeshStandardMaterial({color:0x0e5d86,roughness:.65,metalness:.02}));paleoOcean.visible=false;earthGroup.add(paleoOcean);
const atmosphere=new THREE.Mesh(new THREE.SphereGeometry(1.045,128,80),new THREE.ShaderMaterial({vertexShader:atmosphereVertex,fragmentShader:atmosphereFragment,transparent:true,side:THREE.BackSide,depthWrite:false,blending:THREE.AdditiveBlending}));earthGroup.add(atmosphere);
const starGeo=new THREE.BufferGeometry(),stars=[];for(let i=0;i<1800;i++){const r=12+Math.random()*18,a=Math.random()*Math.PI*2,b=Math.acos(2*Math.random()-1);stars.push(r*Math.sin(b)*Math.cos(a),r*Math.cos(b),r*Math.sin(b)*Math.sin(a))}starGeo.setAttribute('position',new THREE.Float32BufferAttribute(stars,3));scene.add(new THREE.Points(starGeo,new THREE.PointsMaterial({color:0xffffff,size:.035,sizeAttenuation:true,transparent:true,opacity:.55})));

let countryBorders=null,paleoLines=null,paleoLand=null,followGroup=null,lastPaleoSlice=null,lastFollowSlice=null,requestSerial=0,followSerial=0,time=null,modernCountries=null;
const countryToggle=document.querySelector('#borders');
function countryFeatureByName(name){return modernCountries?.features.find(f=>f.properties?.name===name)||null}
async function updateFollowCountry(year){const selected=followSelect?.value;if(!selected||!modernCountries){if(followGroup){earthGroup.remove(followGroup);disposeLineGroup(followGroup);followGroup=null}return}const historical=year<-10000;const future=year>2026;const country=countryFeatureByName(selected);if(!country)return;if(future){if(followGroup)followGroup.visible=false;return}const ageMa=historical?Math.round((-year/1e6)*2)/2:0;const slice=historical?ageMa:0;if(slice===lastFollowSlice&&followGroup){followGroup.visible=true;return}const serial=++followSerial;debug(`Following ${selected} at ${historical?ageMa+' Ma':'present'}`);try{const group=historical?await loadReconstructedCountry(country,ageMa,'CAO2024'):makeCountryHighlight(country,1.012);if(serial!==followSerial){disposeLineGroup(group);return}if(followGroup){earthGroup.remove(followGroup);disposeLineGroup(followGroup)}followGroup=group;earthGroup.add(followGroup);followGroup.visible=true;lastFollowSlice=slice;debug(`Country tracking updated: ${selected}`,'ok')}catch(e){debug(`Country tracking failed: ${e.stack||e}`,'error')}}

async function updateGeography(year){const serial=++requestSerial;const historical=year<-10000;const future=year>2026;debug(`Geography update requested for ${year}`);modernGlobe.visible=!historical;paleoOcean.visible=historical;atmosphere.visible=document.querySelector('#atmosphere').checked;if(countryBorders)countryBorders.visible=!!countryToggle.checked&&!historical&&!future;if(future){status.textContent='SPECULATIVE FUTURE · PANGEA ULTIMA SCENARIO';if(paleoLines)paleoLines.visible=false;if(paleoLand)paleoLand.visible=false;if(followGroup)followGroup.visible=false;return}if(!historical){if(paleoLines)paleoLines.visible=false;if(paleoLand)paleoLand.visible=false;status.textContent=`MODERN EARTH · ${Math.round(year).toLocaleString()} CE`;updateFollowCountry(year);return}const ageRaw=-year/1e6;const ageMa=Math.round(ageRaw*2)/2;const sliceYear=-ageMa*1e6;if(sliceYear===lastPaleoSlice){if(paleoLines)paleoLines.visible=true;if(paleoLand)paleoLand.visible=true;status.textContent=`CAO2024 RECONSTRUCTION · ${ageMa.toLocaleString()} Ma`;updateFollowCountry(year);return}status.textContent=`RECONSTRUCTING · ${ageMa.toLocaleString()} Ma`;debug(`Loading CAO2024 paleogeography for ${ageMa} Ma`);try{const [lines,land]=await Promise.all([loadPaleoCoastlines(sliceYear,'CAO2024'),loadPaleoLand(sliceYear,'CAO2024')]);if(serial!==requestSerial){debug('Discarding stale paleogeography response','warn');disposeLineGroup(lines);disposeLineGroup(land);return}if(paleoLines){earthGroup.remove(paleoLines);disposeLineGroup(paleoLines)}if(paleoLand){earthGroup.remove(paleoLand);disposeLineGroup(paleoLand)}paleoLines=lines;paleoLand=land;earthGroup.add(paleoLand,paleoLines);lastPaleoSlice=sliceYear;paleoLines.visible=true;paleoLand.visible=true;status.textContent=`CAO2024 RECONSTRUCTION · ${ageMa.toLocaleString()} Ma`;debug(`CAO2024 reconstruction loaded for ${ageMa} Ma`,'ok');updateFollowCountry(year)}catch(e){debug(`Paleogeography unavailable: ${e.stack||e}`,'error');status.textContent='PALEOGEOGRAPHY DATA UNAVAILABLE';paleoOcean.visible=true;}}

function filterCountries(){if(!modernCountries||!followSelect)return;const query=(countrySearch?.value||'').trim().toLocaleLowerCase();const current=followSelect.value;followSelect.innerHTML='<option value="">None</option>';const sorted=modernCountries.features.filter(f=>f.properties?.name).sort((a,b)=>a.properties.name.localeCompare(b.properties.name,'en',{sensitivity:'base'}));for(const f of sorted){const name=f.properties.name;if(!query||name.toLocaleLowerCase().includes(query)){const option=document.createElement('option');option.value=name;option.textContent=name;followSelect.appendChild(option)}}if([...followSelect.options].some(o=>o.value===current))followSelect.value=current}

const timeControllerOptions={slider:document.querySelector('#timeline'),yearInput:document.querySelector('#yearInput'),yearOutput:document.querySelector('#year'),epoch:document.querySelector('#epoch'),playButton:document.querySelector('#play'),onChange:y=>{uniforms.uYear.value=y;clearTimeout(pendingTimer);pendingTimer=setTimeout(()=>updateGeography(y),90)}};
let pendingTimer=0;
time=new TimeController(timeControllerOptions);debug('Time controller initialised','ok');

const originalToggle=time.toggle.bind(time);time.toggle=async function(){if(this.playing)return originalToggle();this.playButton.textContent='⌛ Buffering…';status.textContent='BUFFERING TIMELINE';debug('Playback requested; waiting for timeline buffer');const minimumReadyAt=bufferStartedAt+60000;while(bufferProgress<.5||performance.now()<minimumReadyAt){const pct=Math.round(bufferProgress*100);const seconds=Math.max(0,Math.ceil((minimumReadyAt-performance.now())/1000));if(bufferNote)bufferNote.textContent=`Preparing playback · ${pct}% buffered · ${seconds}s minimum wait`;await sleep(500)}if(bufferNote)bufferNote.textContent=prefetchFinished?'Playback ready · timeline remains cached':'Playback ready · loading remaining frames in background…';debug('Playback buffer threshold reached','ok');originalToggle()};

Promise.resolve().then(async()=>{bufferPromise=prefetchPaleoFrames(Array.from({length:121},(_,i)=>i*5),'CAO2024',4,(p,d,t)=>setBufferProgress(p,d,t));await bufferPromise;prefetchFinished=true;bufferProgress=1;setBufferProgress(1,121,121);if(bufferNote)bufferNote.textContent='Timeline buffer loaded · playback ready';debug('Background timeline prefetch completed','ok')}).catch(e=>{prefetchFinished=true;debug(`Background timeline prefetch failed: ${e.stack||e}`,'error')});

loadModernCountries().then(countries=>{modernCountries=countries;filterCountries();debug(`Loaded ${countries.features.length} country geometries in alphabetical order`,'ok');return loadModernCountryBorders()}).then(g=>{countryBorders=g;earthGroup.add(g);countryBorders.visible=countryToggle.checked&&time.year>=-10000&&time.year<=2026;debug('Modern country boundaries loaded','ok')}).catch(e=>debug(`Country boundary data unavailable: ${e.stack||e}`,'error'));

followSelect?.addEventListener('change',()=>{lastFollowSlice=null;followSerial++;updateFollowCountry(time.year)});countrySearch?.addEventListener('input',filterCountries);
document.querySelector('#heat').addEventListener('change',e=>uniforms.uHeat.value=e.target.checked?1:0);document.querySelector('#terrain').addEventListener('change',()=>{});document.querySelector('#atmosphere').addEventListener('change',e=>atmosphere.visible=e.target.checked);document.querySelector('#jumpPresent').addEventListener('click',()=>time.setYear(2026));countryToggle.addEventListener('change',()=>{if(countryBorders)countryBorders.visible=countryToggle.checked&&time.year>=-10000&&time.year<=2026});const hud=document.querySelector('#hud');document.querySelector('#collapse').addEventListener('click',()=>hud.classList.add('hidden'));document.querySelector('#dock').addEventListener('click',()=>hud.classList.remove('hidden'));canvas.addEventListener('dblclick',()=>{controls.reset();camera.position.set(0,0,3.05)});
function resize(){renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix()}resize();window.addEventListener('resize',()=>{renderer.setPixelRatio(Math.min(devicePixelRatio,2));resize()});
requestAnimationFrame(function frame(now){time.update(now);controls.update();renderer.render(scene,camera);requestAnimationFrame(frame)});
updateGeography(2026).finally(()=>finishLoading('MODERN EARTH · 2,026 CE'));setTimeout(()=>{if(!loadingFinished){debug('4-second startup safety timeout reached','warn');finishLoading('MODERN EARTH · 2,026 CE')}},4000);
debug('Render loop started','ok');
