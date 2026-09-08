import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js';
import {OrbitControls} from 'https://cdn.jsdelivr.net/npm/three@0.161.0/examples/jsm/controls/OrbitControls.js';
import {TimeController} from './time_controller.js';
import {loadModernCountries,loadModernCountryBorders,loadPaleoCoastlines,loadPaleoLand,prefetchPaleoFrames,loadReconstructedCountry,makeCountryHighlight,disposeLineGroup,timelineAges,timelineBracket,timelineCachedProgress} from './geography.js';

const canvas=document.querySelector('#globe');
const loading=document.querySelector('#loading');
const status=document.querySelector('#status');
const followSelect=document.querySelector('#followCountry');
const countrySearch=document.querySelector('#countrySearch');
const bufferAmount=document.querySelector('#bufferAmount');
const bufferFill=document.querySelector('#bufferFill');
const bufferNote=document.querySelector('#bufferNote');
const countryToggle=document.querySelector('#borders');
const atmosphereToggle=document.querySelector('#atmosphere');
const STORAGE_KEY='intheglobe.preferences.v1';
const PLAY_THRESHOLD=.5;
const savedPreferences=readPreferences();
let bufferProgress=timelineCachedProgress(timelineAges().length);
let prefetchFinished=false;
let modernCountries=null;
let countryBorders=null;
let paleoFrameA=null;
let paleoFrameB=null;
let paleoFrameKey='';
let paleoRequestKey='';
let paleoRequestSerial=0;
let followFrameA=null;
let followFrameB=null;
let followFrameKey='';
let followRequestKey='';
let followRequestSerial=0;

function readPreferences(){try{const raw=localStorage.getItem(STORAGE_KEY);return raw?JSON.parse(raw)||{}:{}}catch{return {}}}
function savePreferences(patch){try{Object.assign(savedPreferences,patch);localStorage.setItem(STORAGE_KEY,JSON.stringify(savedPreferences))}catch{}}
function logError(message){if(status)status.textContent='READY · DATA DEGRADED';console.error('[InTheGlobe]',message)}
function setBufferProgress(value,done,total){bufferProgress=Math.max(bufferProgress,Math.min(1,value));if(bufferAmount)bufferAmount.textContent=`${Math.round(bufferProgress*100)}%`;if(bufferFill)bufferFill.style.width=`${bufferProgress*100}%`;if(bufferNote&&!prefetchFinished)bufferNote.textContent=`Loading ${done}/${total} timeline keyframes in the background…`;setPlayAvailability()}
function setPlayAvailability(){const ready=bufferProgress>=PLAY_THRESHOLD;const button=time?.playButton;if(!button)return;button.disabled=!ready;button.textContent=ready?(time.playing?'❚❚ Pause':'▶ Play'):'🚫 Play';button.title=ready?'Play the geological timeline':`Playback unlocks at ${Math.round(PLAY_THRESHOLD*100)}% buffered`}
function setOpacity(group,opacity){if(!group)return;const value=Math.max(0,Math.min(1,opacity));group.traverse(o=>{if(!o.material)return;const ms=Array.isArray(o.material)?o.material:[o.material];for(const m of ms){m.transparent=value<.999;m.opacity=value;m.depthWrite=value>.94}})}
function blend(a,b,t){if(!a)return;const x=Math.max(0,Math.min(1,t));const eased=x*x*(3-2*x);setOpacity(a,1-eased);if(b&&b!==a)setOpacity(b,eased)}
function countryByName(name){return modernCountries?.features.find(f=>f.properties?.name===name)||null}

window.addEventListener('error',e=>{console.error(e.error||e.message);logError(e.message||'Unknown window error')});
window.addEventListener('unhandledrejection',e=>{console.error(e.reason);logError(e.reason?.message||e.reason||'Unknown promise rejection')});

let renderer;
try{renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05}catch(error){logError(error);throw error}

const scene=new THREE.Scene();
scene.background=new THREE.Color(0x01050c);
scene.add(new THREE.AmbientLight(0xb8d8e8,1.35));
const sun=new THREE.DirectionalLight(0xffffff,2.2);sun.position.set(-3,2,4);scene.add(sun);
const camera=new THREE.PerspectiveCamera(35,innerWidth/innerHeight,.05,100);camera.position.set(0,0,3.05);
const controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.dampingFactor=.045;controls.enablePan=false;controls.minDistance=1.65;controls.maxDistance=5;controls.rotateSpeed=.45;controls.zoomSpeed=.65;
const earthGroup=new THREE.Group();scene.add(earthGroup);

const earthMaterial=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.88,metalness:0});
const earthSphere=new THREE.Mesh(new THREE.SphereGeometry(1,128,96),earthMaterial);earthGroup.add(earthSphere);
const paleoOcean=new THREE.Mesh(new THREE.SphereGeometry(.998,96,72),new THREE.MeshStandardMaterial({color:0x176d9a,roughness:.65,metalness:.02}));paleoOcean.visible=false;earthGroup.add(paleoOcean);
const atmosphere=new THREE.Mesh(new THREE.SphereGeometry(1.045,96,64),new THREE.MeshBasicMaterial({color:0x4fcfff,transparent:true,opacity:.14,side:THREE.BackSide,depthWrite:false}));earthGroup.add(atmosphere);

const textureLoader=new THREE.TextureLoader();
textureLoader.load('https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg',texture=>{texture.colorSpace=THREE.SRGBColorSpace;earthMaterial.map=texture;earthMaterial.needsUpdate=true},undefined,error=>console.warn('[InTheGlobe] Earth texture unavailable',error));

function resize(){renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix()}
resize();window.addEventListener('resize',resize);

async function loadPaleoFrame(ageMa){const [lines,land]=await Promise.all([loadPaleoCoastlines(-ageMa*1e6,'CAO2024'),loadPaleoLand(-ageMa*1e6,'CAO2024')]);setOpacity(lines,1);setOpacity(land,1);return{lines,land}}
async function ensurePaleoFrame(year){const bracket=timelineBracket(year);const key=`${bracket.lower}:${bracket.upper}`;if(key===paleoFrameKey&&paleoFrameA)return;if(key===paleoRequestKey)return;paleoRequestKey=key;const serial=++paleoRequestSerial;try{const [low,high]=await Promise.all([loadPaleoFrame(bracket.lower),bracket.upper===bracket.lower?Promise.resolve(null):loadPaleoFrame(bracket.upper)]);if(serial!==paleoRequestSerial){disposeLineGroup(low.lines);disposeLineGroup(low.land);if(high){disposeLineGroup(high.lines);disposeLineGroup(high.land)}return}for(const frame of [paleoFrameA,paleoFrameB])if(frame){earthGroup.remove(frame.lines,frame.land);disposeLineGroup(frame.lines);disposeLineGroup(frame.land)}paleoFrameA=low;paleoFrameB=high;paleoFrameKey=key;earthGroup.add(low.land,low.lines);if(high)earthGroup.add(high.land,high.lines);low.lines.visible=low.land.visible=true;if(high)high.lines.visible=high.land.visible=true;blend(low.lines,high?.lines,bracket.t);blend(low.land,high?.land,bracket.t)}catch(error){console.error('[InTheGlobe] Paleo frame error',error)}}

async function updateFollowCountry(year){const selected=followSelect?.value;if(!selected||!modernCountries){for(const g of [followFrameA,followFrameB])if(g){earthGroup.remove(g);disposeLineGroup(g)}followFrameA=followFrameB=null;followFrameKey='';followRequestKey='';return}const country=countryByName(selected);if(!country)return;if(year>2026||year>=-10000){if(year>2026){if(followFrameA)followFrameA.visible=false;if(followFrameB)followFrameB.visible=false;return}if(followFrameKey==='present'&&followFrameA){followFrameA.visible=true;setOpacity(followFrameA,1);return}const serial=++followRequestSerial;followRequestKey='present';try{const group=makeCountryHighlight(country,1.012);if(serial!==followRequestSerial){disposeLineGroup(group);return}for(const g of [followFrameA,followFrameB])if(g){earthGroup.remove(g);disposeLineGroup(g)}followFrameA=group;followFrameB=null;followFrameKey='present';earthGroup.add(group);group.visible=true;setOpacity(group,1)}catch(error){console.error('[InTheGlobe] Country highlight error',error)}return}const bracket=timelineBracket(year);const key=`${selected}:${bracket.lower}:${bracket.upper}`;if(key===followFrameKey&&followFrameA){followFrameA.visible=true;if(followFrameB)followFrameB.visible=true;blend(followFrameA,followFrameB,bracket.t);return}if(key===followRequestKey)return;followRequestKey=key;const serial=++followRequestSerial;try{const [low,high]=await Promise.all([loadReconstructedCountry(country,bracket.lower,'CAO2024'),bracket.upper===bracket.lower?Promise.resolve(null):loadReconstructedCountry(country,bracket.upper,'CAO2024')]);if(serial!==followRequestSerial){disposeLineGroup(low);if(high)disposeLineGroup(high);return}for(const g of [followFrameA,followFrameB])if(g){earthGroup.remove(g);disposeLineGroup(g)}followFrameA=low;followFrameB=high;followFrameKey=key;earthGroup.add(low);if(high)earthGroup.add(high);low.visible=true;if(high)high.visible=true;blend(low,high,bracket.t)}catch(error){console.error('[InTheGlobe] Country reconstruction error',error)}}

function updateGeography(year){const historical=year<-10000,future=year>2026;earthSphere.visible=!historical;paleoOcean.visible=historical;atmosphere.visible=atmosphereToggle?.checked??true;if(countryBorders)countryBorders.visible=!!countryToggle?.checked&&!historical&&!future;if(future){status.textContent='SPECULATIVE FUTURE · PANGEA ULTIMA SCENARIO';for(const f of [paleoFrameA,paleoFrameB])if(f){f.lines.visible=false;f.land.visible=false}for(const g of [followFrameA,followFrameB])if(g)g.visible=false;return}if(!historical){status.textContent=`MODERN EARTH · ${Math.round(year).toLocaleString()} CE`;for(const f of [paleoFrameA,paleoFrameB])if(f){f.lines.visible=false;f.land.visible=false}void updateFollowCountry(year);return}status.textContent=`CAO2024 RECONSTRUCTION · ${Math.round(-year/1e6).toLocaleString()} Ma`;void ensurePaleoFrame(year);void updateFollowCountry(year)}

function filterCountries(){if(!modernCountries||!followSelect)return;const query=(countrySearch?.value||'').trim().toLowerCase();const current=followSelect.value||savedPreferences.country||'';followSelect.innerHTML='<option value="">None</option>';const sorted=modernCountries.features.filter(f=>f.properties?.name).sort((a,b)=>a.properties.name.localeCompare(b.properties.name,'en',{sensitivity:'base'}));for(const f of sorted){const name=f.properties.name;if(!query||name.toLowerCase().includes(query)){const option=document.createElement('option');option.value=name;option.textContent=name;followSelect.appendChild(option)}}if([...followSelect.options].some(o=>o.value===current))followSelect.value=current}

let time=new TimeController({slider:document.querySelector('#timeline'),yearInput:document.querySelector('#yearInput'),yearOutput:document.querySelector('#year'),epoch:document.querySelector('#epoch'),playButton:document.querySelector('#play'),onChange:year=>{savePreferences({year:Math.round(year)});updateGeography(year)}});
const resetStartYear=window.__intheglobeResetVideoStartYear;if(Number.isFinite(resetStartYear)){time.setYear(resetStartYear);delete window.__intheglobeResetVideoStartYear}else if(Number.isFinite(savedPreferences.year))time.setYear(savedPreferences.year);
if(Number.isFinite(savedPreferences.speed))time.speed=savedPreferences.speed;
setPlayAvailability();
const originalToggle=time.toggle.bind(time);time.toggle=()=>{if(!time.playing&&bufferProgress<PLAY_THRESHOLD){setPlayAvailability();return}originalToggle();savePreferences({playing:time.playing,speed:time.speed});setPlayAvailability()};
document.querySelectorAll('#speeds [data-speed]').forEach(button=>button.addEventListener('click',()=>{savePreferences({speed:time.speed});}));
document.querySelector('#jumpPresent')?.addEventListener('click',()=>time.setYear(2026));
document.querySelector('#heat')?.addEventListener('change',e=>savePreferences({heat:e.target.checked}));atmosphereToggle?.addEventListener('change',e=>{atmosphere.visible=e.target.checked;savePreferences({atmosphere:e.target.checked})});document.querySelector('#terrain')?.addEventListener('change',e=>savePreferences({terrain:e.target.checked}));countryToggle?.addEventListener('change',()=>savePreferences({borders:countryToggle.checked}));followSelect?.addEventListener('change',()=>{savePreferences({country:followSelect.value||''});followRequestSerial++;followRequestKey='';for(const g of [followFrameA,followFrameB])if(g){earthGroup.remove(g);disposeLineGroup(g)}followFrameA=followFrameB=null;followFrameKey='';void updateFollowCountry(time.year)});countrySearch?.addEventListener('input',filterCountries);
const hud=document.querySelector('#hud');document.querySelector('#collapse')?.addEventListener('click',()=>hud?.classList.add('hidden'));document.querySelector('#dock')?.addEventListener('click',()=>hud?.classList.remove('hidden'));canvas.addEventListener('dblclick',()=>{controls.reset();camera.position.set(0,0,3.05)});

function warmTimeline(){const ages=timelineAges();return prefetchPaleoFrames(ages,'CAO2024',12,(progress,done,total)=>setBufferProgress(progress,done,total)).then(complete=>{prefetchFinished=complete;bufferProgress=complete?1:bufferProgress;setPlayAvailability();if(bufferNote)bufferNote.textContent=complete?`Timeline loaded · ${ages.length} keyframes stored for playback`:`Timeline buffer paused at ${Math.round(bufferProgress*100)}%`;}).catch(error=>console.error('[InTheGlobe] Timeline prefetch error',error))}
if(bufferProgress>0){setBufferProgress(bufferProgress,Math.round(bufferProgress*timelineAges().length),timelineAges().length)}
void warmTimeline();
loadModernCountries().then(countries=>{modernCountries=countries;filterCountries();return loadModernCountryBorders()}).then(group=>{countryBorders=group;earthGroup.add(group);countryBorders.visible=!!countryToggle?.checked&&time.year>=-10000&&time.year<=2026}).catch(error=>console.error('[InTheGlobe] Country border error',error));

function frame(now){time.update(now);controls.update();renderer.render(scene,camera);requestAnimationFrame(frame)}
requestAnimationFrame(frame);
updateGeography(time.year);
if(loading){loading.classList.add('done')}
