import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js';
import {OrbitControls} from 'https://cdn.jsdelivr.net/npm/three@0.161.0/examples/jsm/controls/OrbitControls.js';
import {TimeController} from './time_controller.js';
import {loadModernCountries,loadModernCountryBorders,loadPaleoCoastlines,loadPaleoLand,loadReconstructedCountry,makeCountryHighlight,disposeLineGroup,timelineBracket,timelineAges,prefetchPaleoFrames} from './geography.js?v=20260911-3';

const canvas=document.querySelector('#globe');
const loading=document.querySelector('#loading');
const status=document.querySelector('#status');
const debugLog=document.querySelector('#debugLog');
const followSelect=document.querySelector('#followCountry');
const countrySearch=document.querySelector('#countrySearch');
const bufferAmount=document.querySelector('#bufferAmount');
const bufferFill=document.querySelector('#bufferFill');
const bufferNote=document.querySelector('#bufferNote');
const countryToggle=document.querySelector('#borders');
const atmosphereToggle=document.querySelector('#atmosphere');
const STORAGE_KEY='intheglobe.preferences.v1';
const BUFFER_KEY='intheglobe.timeline.buffer.v3';
const PRESENT=2026;
const PLAY_THRESHOLD=.5;

let preferences={};
try{preferences=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}')||{}}catch{preferences={}};
function savePreferences(patch){preferences={...preferences,...patch};try{localStorage.setItem(STORAGE_KEY,JSON.stringify(preferences))}catch{}}
function debug(...args){const text=args.map(value=>{try{return typeof value==='string'?value:JSON.stringify(value)}catch{return String(value)}}).join(' ');console.log('[PastGlobe]',text);if(debugLog){const row=document.createElement('div');row.textContent=`[${new Date().toLocaleTimeString()}] ${text}`;debugLog.appendChild(row);debugLog.scrollTop=debugLog.scrollHeight}}
function readBuffer(total){try{const x=JSON.parse(localStorage.getItem(BUFFER_KEY)||'null');if(x&&x.total===total&&Number.isFinite(x.completed))return Math.max(0,Math.min(1,x.completed/total))}catch{}return 0}
function writeBuffer(completed,total){try{localStorage.setItem(BUFFER_KEY,JSON.stringify({version:3,total,completed,updatedAt:Date.now()}))}catch{}}
function showBuffer(value,done,total){bufferProgress=Math.max(bufferProgress,Math.max(0,Math.min(1,value)));if(bufferAmount)bufferAmount.textContent=`${Math.round(bufferProgress*100)}%`;if(bufferFill)bufferFill.style.width=`${bufferProgress*100}%`;if(bufferNote&&!prefetchDone)bufferNote.textContent=`Loading ${done}/${total} historical frames in the background…`;setPlayAvailability()}
function setOpacity(group,value){if(!group)return;const v=Math.max(0,Math.min(1,value));group.traverse(object=>{if(!object.material)return;const list=Array.isArray(object.material)?object.material:[object.material];for(const material of list){material.transparent=v<.999;material.opacity=v;material.depthWrite=v>.94}})}
function blend(a,b,t){if(!a)return;const x=Math.max(0,Math.min(1,t));const e=x*x*(3-2*x);setOpacity(a,1-e);if(b&&b!==a)setOpacity(b,e)}

let renderer;
try{renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'})}catch(error){status.textContent='WEBGL INITIALISATION FAILED';loading?.classList.add('done');throw error}
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.NoToneMapping;
renderer.setSize(innerWidth,innerHeight,false);

const scene=new THREE.Scene();
scene.background=new THREE.Color(0x01050c);
const camera=new THREE.PerspectiveCamera(35,innerWidth/innerHeight,.05,100);
camera.position.set(0,0,3.05);
const controls=new OrbitControls(camera,canvas);
controls.enableDamping=true;controls.dampingFactor=.045;controls.enablePan=false;controls.minDistance=1.65;controls.maxDistance=5;controls.rotateSpeed=.45;controls.zoomSpeed=.65;

const earthGroup=new THREE.Group();
earthGroup.name='InTheGlobeEarthGroup';
scene.add(earthGroup);
window.__intheglobeEarthGroup=earthGroup;
const earthMaterial=new THREE.MeshBasicMaterial({color:0xffffff});
const earthSphere=new THREE.Mesh(new THREE.SphereGeometry(1,160,112),earthMaterial);
earthSphere.renderOrder=0;
earthGroup.add(earthSphere);
const paleoOcean=new THREE.Mesh(new THREE.SphereGeometry(.998,160,112),new THREE.MeshBasicMaterial({color:0x176d9a}));
paleoOcean.visible=false;paleoOcean.renderOrder=1;earthGroup.add(paleoOcean);
const atmosphere=new THREE.Mesh(new THREE.SphereGeometry(1.045,96,64),new THREE.MeshBasicMaterial({color:0x4fcfff,transparent:true,opacity:.14,side:THREE.BackSide,depthWrite:false}));
earthGroup.add(atmosphere);
new THREE.TextureLoader().load('https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg',texture=>{texture.colorSpace=THREE.SRGBColorSpace;earthMaterial.map=texture;earthMaterial.needsUpdate=true;debug('Modern Earth texture loaded')},undefined,error=>debug('Modern Earth texture unavailable',error?.message||error));

let modernCountries=null;
let countryBorders=null;
let paleoA=null;
let paleoB=null;
let paleoKey='';
let paleoRequestKey='';
let paleoRequestSerial=0;
let followA=null;
let followB=null;
let followKey='';
let followSerial=0;
let followBusy=false;
let followWantedKey='';
let followWantedYear=PRESENT;
let bufferProgress=0;
let prefetchDone=false;
let prefetchRunning=false;
let followTimer=0;

function countryByName(name){return modernCountries?.features.find(f=>f.properties?.name===name)||null}
function setPlayAvailability(){const button=time?.playButton;if(!button)return;const ready=bufferProgress>=PLAY_THRESHOLD;button.disabled=!ready;button.textContent=ready?(time.playing?'❚❚ Pause':'▶ Play'):'🚫 Play';button.title=ready?'Play the geological timeline':'Playback unlocks at 50% background buffer'}
function clearPaleoFrames(){for(const frame of[paleoA,paleoB])if(frame){earthGroup.remove(frame.land,frame.lines);disposeLineGroup(frame.land);disposeLineGroup(frame.lines)}paleoA=paleoB=null;paleoKey=''}
function clearFollowFrames(){for(const frame of[followA,followB])if(frame){earthGroup.remove(frame);disposeLineGroup(frame)}followA=followB=null;followKey=''}

async function loadPaleoFrame(age){
  const [lines,land]=await Promise.all([loadPaleoCoastlines(-age*1e6,'CAO2024'),loadPaleoLand(-age*1e6,'CAO2024')]);
  setOpacity(lines,1);setOpacity(land,1);return{age,lines,land}
}
async function showPaleo(year){
  const bracket=timelineBracket(year);
  const key=`${bracket.lower}:${bracket.upper}`;
  if(key===paleoKey&&paleoA)return;
  if(key===paleoRequestKey)return;
  paleoRequestKey=key;
  const serial=++paleoRequestSerial;
  status.textContent=`CAO2024 RECONSTRUCTION · ${Math.round(-year/1e6).toLocaleString()} Ma`;
  try{
    const [low,high]=await Promise.all([loadPaleoFrame(bracket.lower),bracket.upper===bracket.lower?Promise.resolve(null):loadPaleoFrame(bracket.upper)]);
    if(serial!==paleoRequestSerial){disposeLineGroup(low.lines);disposeLineGroup(low.land);if(high){disposeLineGroup(high.lines);disposeLineGroup(high.land)};return}
    clearPaleoFrames();paleoA=low;paleoB=high;paleoKey=key;earthGroup.add(low.land,low.lines);if(high)earthGroup.add(high.land,high.lines);low.land.visible=low.lines.visible=true;if(high)high.land.visible=high.lines.visible=true;blend(low.land,high?.land,bracket.t);blend(low.lines,high?.lines,bracket.t);debug('Paleo frame rendered',key)
  }catch(error){if(serial===paleoRequestSerial){status.textContent='CAO2024 DATA ERROR';debug('Paleo rendering failed',error?.stack||error)}}finally{if(paleoRequestKey===key)paleoRequestKey=''}
}
function scheduleFollow(year,immediate=false){followWantedYear=year;clearTimeout(followTimer);followTimer=setTimeout(()=>void updateFollow(year),immediate?0:100)}
async function updateFollow(year){
  const selected=followSelect?.value;
  const country=countryByName(selected);
  if(!selected||!country||year>PRESENT){clearFollowFrames();return}
  if(year>=-10000){
    const key='present';
    if(key===followKey&&followA){followA.visible=true;return}
    const serial=++followSerial;const group=makeCountryHighlight(country,1.012);if(serial!==followSerial){disposeLineGroup(group);return}
    clearFollowFrames();followA=group;followKey=key;earthGroup.add(group);group.visible=true;setOpacity(group,1);return
  }
  const bracket=timelineBracket(year);const key=`${selected}:${bracket.lower}:${bracket.upper}`;
  if(key===followKey&&followA){followA.visible=followB?true:true;if(followB)followB.visible=true;blend(followA,followB,bracket.t);return}
  if(followBusy)return;
  followBusy=true;const serial=++followSerial;
  try{
    const [low,high]=await Promise.all([loadReconstructedCountry(country,bracket.lower,'CAO2024'),bracket.upper===bracket.lower?Promise.resolve(null):loadReconstructedCountry(country,bracket.upper,'CAO2024')]);
    if(serial!==followSerial){disposeLineGroup(low);if(high)disposeLineGroup(high);return}
    clearFollowFrames();followA=low;followB=high;followKey=key;earthGroup.add(low);if(high)earthGroup.add(high);low.visible=true;if(high)high.visible=true;blend(low,high,bracket.t)
  }catch(error){debug('Country tracking failed',error?.message||error)}finally{followBusy=false}
}
function updateGeography(year){
  const historical=year<0;
  const future=year>PRESENT;
  earthSphere.visible=!historical&&!future;
  paleoOcean.visible=historical||future;
  atmosphere.visible=atmosphereToggle?.checked??true;
  if(countryBorders)countryBorders.visible=!!countryToggle?.checked&&!historical&&!future;
  if(future){status.textContent='SPECULATIVE FUTURE · PANGEA ULTIMA SCENARIO';for(const f of[paleoA,paleoB])if(f){f.land.visible=false;f.lines.visible=false}for(const f of[followA,followB])if(f)f.visible=false;return}
  for(const f of[paleoA,paleoB])if(f){f.land.visible=historical;f.lines.visible=historical}
  if(historical){showPaleo(year);if(followSelect?.value)scheduleFollow(year)}
  else{clearTimeout(followTimer);if(paleoA||paleoB){for(const f of[paleoA,paleoB])if(f){f.land.visible=false;f.lines.visible=false}}if(followSelect?.value)scheduleFollow(year);status.textContent=`MODERN EARTH · ${Math.round(year).toLocaleString()} CE`}
}

function filterCountries(){
  if(!modernCountries||!followSelect)return;
  const q=(countrySearch?.value||'').trim().toLowerCase();const current=followSelect.value||preferences.country||'';followSelect.innerHTML='<option value="">None</option>';
  const features=modernCountries.features.filter(f=>f.properties?.name).sort((a,b)=>a.properties.name.localeCompare(b.properties.name,'en',{sensitivity:'base'}));
  for(const feature of features){const name=feature.properties.name;if(!q||name.toLowerCase().includes(q)){const option=document.createElement('option');option.value=name;option.textContent=name;followSelect.appendChild(option)}}
  if([...followSelect.options].some(option=>option.value===current))followSelect.value=current;
}

let time=new TimeController({slider:document.querySelector('#timeline'),yearInput:document.querySelector('#yearInput'),yearOutput:document.querySelector('#year'),epoch:document.querySelector('#epoch'),playButton:document.querySelector('#play'),onChange:year=>{savePreferences({year:Math.round(year)});updateGeography(year)}});
const originalToggle=time.toggle.bind(time);time.toggle=()=>{if(!time.playing&&bufferProgress<PLAY_THRESHOLD){setPlayAvailability();return}originalToggle();savePreferences({playing:time.playing,speed:time.speed});setPlayAvailability()};
if(Number.isFinite(preferences.speed))time.speed=preferences.speed;
if(Number.isFinite(preferences.year))time.setYear(preferences.year);
setPlayAvailability();

time.slider?.addEventListener('input',()=>savePreferences({playing:false}));
followSelect?.addEventListener('change',()=>{savePreferences({country:followSelect.value||''});followSerial++;clearFollowFrames();scheduleFollow(time.year,true)});
countrySearch?.addEventListener('input',filterCountries);
atmosphereToggle?.addEventListener('change',event=>{atmosphere.visible=event.target.checked;savePreferences({atmosphere:event.target.checked})});
countryToggle?.addEventListener('change',()=>{if(countryBorders)countryBorders.visible=countryToggle.checked&&time.year>=0&&time.year<=PRESENT;savePreferences({borders:countryToggle.checked})});
document.querySelector('#jumpPresent')?.addEventListener('click',()=>time.setYear(PRESENT));
document.querySelectorAll('#speeds [data-speed]').forEach(button=>button.addEventListener('click',()=>savePreferences({speed:time.speed})));
const hud=document.querySelector('#hud');document.querySelector('#collapse')?.addEventListener('click',()=>hud?.classList.add('hidden'));document.querySelector('#dock')?.addEventListener('click',()=>hud?.classList.remove('hidden'));canvas.addEventListener('dblclick',()=>{controls.reset();camera.position.set(0,0,3.05)});
window.addEventListener('resize',()=>{renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix()});

const backgroundAges=timelineAges();
bufferProgress=readBuffer(backgroundAges.length);
showBuffer(bufferProgress,Math.round(bufferProgress*backgroundAges.length),backgroundAges.length);
if(bufferNote)bufferNote.textContent=bufferProgress>=1?'Historical frames ready from saved browser cache':`Resuming background buffer · ${Math.round(bufferProgress*100)}% already completed`;

async function startPrefetch(){
  if(prefetchRunning)return;prefetchRunning=true;
  try{
    const complete=await prefetchPaleoFrames(backgroundAges,'CAO2024',2,(progress,done,total)=>{writeBuffer(done,total);showBuffer(progress,done,total)});
    if(complete){prefetchDone=true;bufferProgress=1;writeBuffer(backgroundAges.length,backgroundAges.length);showBuffer(1,backgroundAges.length,backgroundAges.length);if(bufferNote)bufferNote.textContent=`Historical frames ready · ${backgroundAges.length} cached`;setPlayAvailability()}
    else if(bufferNote)bufferNote.textContent=`Historical buffer incomplete · ${Math.round(bufferProgress*100)}% cached; failed frames will retry`;
  }catch(error){debug('Background historical buffer failed',error?.message||error);}
}
void startPrefetch();

loadModernCountries().then(async countries=>{modernCountries=countries;filterCountries();if(preferences.country&&countryByName(preferences.country))followSelect.value=preferences.country;return loadModernCountryBorders()}).then(group=>{countryBorders=group;earthGroup.add(group);countryBorders.visible=!!countryToggle?.checked&&time.year>=0&&time.year<=PRESENT}).catch(error=>debug('Modern country data failed',error?.message||error));

requestAnimationFrame(function frame(now){time.update(now);controls.update();renderer.render(scene,camera);requestAnimationFrame(frame)});
updateGeography(time.year);
loading?.classList.add('done');
debug('Fixed application started',`year=${time.year}`);
