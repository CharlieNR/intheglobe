import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js';
import {OrbitControls} from 'https://cdn.jsdelivr.net/npm/three@0.161.0/examples/jsm/controls/OrbitControls.js';
import {TimeController} from './time_controller.js';
import {loadModernCountries,loadModernCountryBorders,loadPaleoCoastlines,loadPaleoLand,prefetchPaleoFrames,prefetchReconstructedCountryFrames,loadReconstructedCountry,makeCountryHighlight,disposeLineGroup,timelineAges,timelineBracket,timelineCachedProgress} from './geography.js';

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
const heatToggle=document.querySelector('#heat');
const startedAt=performance.now();
const STORAGE_KEY='intheglobe.preferences.v1';
const PLAY_THRESHOLD=.5;

let loadingFinished=false;
let bufferProgress=0;
let prefetchFinished=false;
let savedPreferences={};
let modernCountries=null;
let countryBorders=null;
let paleoFrameA=null;
let paleoFrameB=null;
let paleoFrameKey='';
let paleoRequestedKey='';
let paleoRequestSerial=0;
let followFrameA=null;
let followFrameB=null;
let followFrameKey='';
let followRequestedKey='';
let followRequestSerial=0;
let time=null;
let pendingGeographyTimer=0;
let lastSavedYear=null;

function debug(message,type='info'){
  const text=`[+${((performance.now()-startedAt)/1000).toFixed(2)}s] ${message}`;
  if(debugLog){const line=document.createElement('div');line.className=`debug-entry ${type}`;line.textContent=text;debugLog.appendChild(line);debugLog.scrollTop=debugLog.scrollHeight;}
}
function finishLoading(message='READY'){
  if(loadingFinished)return;
  loadingFinished=true;
  loading?.classList.add('done');
  if(status)status.textContent=message;
}
function loadPreferences(){
  try{const raw=localStorage.getItem(STORAGE_KEY);savedPreferences=raw?JSON.parse(raw)||{}:{};}catch{savedPreferences={};}
}
function savePreferences(patch){
  try{savedPreferences={...savedPreferences,...patch};localStorage.setItem(STORAGE_KEY,JSON.stringify(savedPreferences));}catch{}
}
function saveYearThrottled(year){
  const rounded=Math.round(year);
  if(rounded===lastSavedYear)return;
  lastSavedYear=rounded;
  savePreferences({year:rounded});
}
function setPlayAvailability(){
  const button=time?.playButton;
  if(!button)return;
  const ready=bufferProgress>=PLAY_THRESHOLD;
  button.disabled=!ready;
  button.textContent=ready?(time.playing?'❚❚ Pause':'▶ Play'):'🚫 Play';
  button.title=ready?'Play the geological timeline':`Playback unlocks at ${Math.round(PLAY_THRESHOLD*100)}% buffered`;
}
function setBufferProgress(value,done,total){
  bufferProgress=Math.max(bufferProgress,Math.min(1,value));
  if(bufferAmount)bufferAmount.textContent=`${Math.round(bufferProgress*100)}%`;
  if(bufferFill)bufferFill.style.width=`${bufferProgress*100}%`;
  if(bufferNote&&!prefetchFinished)bufferNote.textContent=`Loading ${done}/${total} timeline keyframes in the background…`;
  setPlayAvailability();
}
function setGroupOpacity(group,opacity){
  if(!group)return;
  const value=Math.max(0,Math.min(1,opacity));
  group.traverse(object=>{
    if(!object.material)return;
    const materials=Array.isArray(object.material)?object.material:[object.material];
    for(const material of materials){material.transparent=value<.999;material.opacity=value;material.depthWrite=value>.94;}
  });
}
function applyFrameBlend(a,b,t){
  if(!a)return;
  const x=Math.max(0,Math.min(1,t));
  const blend=x*x*(3-2*x);
  setGroupOpacity(a,1-blend);
  if(b&&b!==a)setGroupOpacity(b,blend);
}
function countryFeatureByName(name){return modernCountries?.features.find(feature=>feature.properties?.name===name)||null;}

window.addEventListener('error',event=>{debug(`Window error: ${event.message||event.error||'unknown error'}`,'error');});
window.addEventListener('unhandledrejection',event=>{debug(`Unhandled promise rejection: ${event.reason?.stack||event.reason||'unknown rejection'}`,'error');});

loadPreferences();

let renderer;
try{
  renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
}catch(error){
  debug(`WebGL initialisation failed: ${error.stack||error}`,'error');
  finishLoading('WEBGL INITIALISATION FAILED');
  throw error;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.05;

const scene=new THREE.Scene();
scene.background=new THREE.Color(0x01050c);
scene.add(new THREE.AmbientLight(0xb8d8e8,1.5));
const sun=new THREE.DirectionalLight(0xffffff,2.4);
sun.position.set(-3,2,4);
scene.add(sun);

const camera=new THREE.PerspectiveCamera(35,innerWidth/innerHeight,.05,100);
camera.position.set(0,0,3.05);
const controls=new OrbitControls(camera,canvas);
controls.enableDamping=true;
controls.dampingFactor=.045;
controls.enablePan=false;
controls.minDistance=1.65;
controls.maxDistance=5;
controls.rotateSpeed=.45;
controls.zoomSpeed=.65;

const earthGroup=new THREE.Group();
scene.add(earthGroup);

const loader=new THREE.TextureLoader();
const earthMaterial=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.86,metalness:0});
const earthSphere=new THREE.Mesh(new THREE.SphereGeometry(1,128,96),earthMaterial);
earthGroup.add(earthSphere);

const fallbackOceanMaterial=new THREE.MeshStandardMaterial({color:0x176d9a,roughness:.64,metalness:.02});
const paleoOcean=new THREE.Mesh(new THREE.SphereGeometry(.999,96,72),fallbackOceanMaterial);
paleoOcean.visible=false;
earthGroup.add(paleoOcean);

const atmosphere=new THREE.Mesh(
  new THREE.SphereGeometry(1.045,96,64),
  new THREE.MeshBasicMaterial({color:0x4fcfff,transparent:true,opacity:.14,side:THREE.BackSide,depthWrite:false})
);
earthGroup.add(atmosphere);

const starGeo=new THREE.BufferGeometry();
const stars=[];
for(let i=0;i<1400;i++){
  const radius=12+Math.random()*18;
  const azimuth=Math.random()*Math.PI*2;
  const polar=Math.acos(2*Math.random()-1);
  stars.push(radius*Math.sin(polar)*Math.cos(azimuth),radius*Math.cos(polar),radius*Math.sin(polar)*Math.sin(azimuth));
}
starGeo.setAttribute('position',new THREE.Float32BufferAttribute(stars,3));
scene.add(new THREE.Points(starGeo,new THREE.PointsMaterial({color:0xffffff,size:.035,sizeAttenuation:true,transparent:true,opacity:.55})));

loader.load('https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg',texture=>{
  texture.colorSpace=THREE.SRGBColorSpace;
  earthMaterial.map=texture;
  earthMaterial.needsUpdate=true;
  debug('Earth texture loaded','ok');
},undefined,error=>debug(`Earth texture failed: ${error?.message||error}`,'warn'));

async function loadPaleoFrame(ageMa){
  const [lines,land]=await Promise.all([
    loadPaleoCoastlines(-ageMa*1e6,'CAO2024'),
    loadPaleoLand(-ageMa*1e6,'CAO2024')
  ]);
  setGroupOpacity(lines,1);
  setGroupOpacity(land,1);
  return {lines,land};
}

async function ensurePaleoFrame(year){
  const bracket=timelineBracket(year);
  const key=`${bracket.lower}:${bracket.upper}`;
  if(key===paleoFrameKey&&paleoFrameA)return;
  if(key===paleoRequestedKey)return;
  paleoRequestedKey=key;
  const serial=++paleoRequestSerial;
  try{
    const [low,high]=await Promise.all([
      loadPaleoFrame(bracket.lower),
      bracket.upper===bracket.lower?Promise.resolve(null):loadPaleoFrame(bracket.upper)
    ]);
    if(serial!==paleoRequestSerial){
      disposeLineGroup(low.lines);disposeLineGroup(low.land);
      if(high){disposeLineGroup(high.lines);disposeLineGroup(high.land);}
      return;
    }
    for(const frame of [paleoFrameA,paleoFrameB]){
      if(frame){earthGroup.remove(frame.lines,frame.land);disposeLineGroup(frame.lines);disposeLineGroup(frame.land);}
    }
    paleoFrameA=low;
    paleoFrameB=high;
    paleoFrameKey=key;
    earthGroup.add(low.land,low.lines);
    if(high)earthGroup.add(high.land,high.lines);
    low.lines.visible=low.land.visible=true;
    if(high)high.lines.visible=high.land.visible=true;
    applyFrameBlend(low.lines,high?.lines,bracket.t);
    applyFrameBlend(low.land,high?.land,bracket.t);
    debug(`Keyframes ready: ${bracket.lower} Ma → ${bracket.upper} Ma`,'ok');
  }catch(error){
    if(serial===paleoRequestSerial)debug(`Paleogeography unavailable: ${error.stack||error}`,'error');
  }
}

async function ensureFollowCountry(year){
  const selected=followSelect?.value;
  if(!selected||!modernCountries){
    for(const group of [followFrameA,followFrameB])if(group){earthGroup.remove(group);disposeLineGroup(group);}
    followFrameA=followFrameB=null;followFrameKey='';followRequestedKey='';return;
  }
  const country=countryFeatureByName(selected);
  if(!country)return;
  if(year>2026){if(followFrameA)followFrameA.visible=false;if(followFrameB)followFrameB.visible=false;return;}
  if(year>=-10000){
    if(followFrameKey==='present'&&followFrameA){followFrameA.visible=true;setGroupOpacity(followFrameA,1);return;}
    if(followRequestedKey==='present')return;
    followRequestedKey='present';
    const serial=++followRequestSerial;
    try{
      const group=makeCountryHighlight(country,1.012);
      if(serial!==followRequestSerial){disposeLineGroup(group);return;}
      for(const frame of [followFrameA,followFrameB])if(frame){earthGroup.remove(frame);disposeLineGroup(frame);}
      followFrameA=group;followFrameB=null;followFrameKey='present';
      earthGroup.add(group);group.visible=true;setGroupOpacity(group,1);
    }catch(error){debug(`Country tracking failed: ${error.stack||error}`,'error');}
    return;
  }
  const bracket=timelineBracket(year);
  const key=`${selected}:${bracket.lower}:${bracket.upper}`;
  if(key===followFrameKey&&followFrameA){followFrameA.visible=true;if(followFrameB)followFrameB.visible=true;applyFrameBlend(followFrameA,followFrameB,bracket.t);return;}
  if(key===followRequestedKey)return;
  followRequestedKey=key;
  const serial=++followRequestSerial;
  try{
    const [low,high]=await Promise.all([
      loadReconstructedCountry(country,bracket.lower,'CAO2024'),
      bracket.upper===bracket.lower?Promise.resolve(null):loadReconstructedCountry(country,bracket.upper,'CAO2024')
    ]);
    if(serial!==followRequestSerial){disposeLineGroup(low);if(high)disposeLineGroup(high);return;}
    for(const frame of [followFrameA,followFrameB])if(frame){earthGroup.remove(frame);disposeLineGroup(frame);}
    followFrameA=low;followFrameB=high;followFrameKey=key;
    earthGroup.add(low);if(high)earthGroup.add(high);
    low.visible=true;if(high)high.visible=true;
    applyFrameBlend(low,high,bracket.t);
  }catch(error){debug(`Country tracking failed: ${error.stack||error}`,'error');}
}

function updateGeography(year){
  const historical=year<-10000;
  const future=year>2026;
  earthSphere.visible=!historical;
  paleoOcean.visible=historical;
  atmosphere.visible=atmosphereToggle?.checked??true;
  if(countryBorders)countryBorders.visible=!!countryToggle?.checked&&!historical&&!future;
  if(future){
    status.textContent='SPECULATIVE FUTURE · PANGEA ULTIMA SCENARIO';
    for(const frame of [paleoFrameA,paleoFrameB])if(frame){frame.lines.visible=false;frame.land.visible=false;}
    if(followFrameA)followFrameA.visible=false;if(followFrameB)followFrameB.visible=false;
    return;
  }
  if(!historical){
    status.textContent=`MODERN EARTH · ${Math.round(year).toLocaleString()} CE`;
    for(const frame of [paleoFrameA,paleoFrameB])if(frame){frame.lines.visible=false;frame.land.visible=false;}
    ensureFollowCountry(year);
    return;
  }
  const bracket=timelineBracket(year);
  status.textContent=`CAO2024 RECONSTRUCTION · ${Math.round(-year/1e6).toLocaleString()} Ma`;
  if(paleoFrameA&&paleoFrameKey===`${bracket.lower}:${bracket.upper}`){
    paleoFrameA.lines.visible=paleoFrameA.land.visible=true;
    if(paleoFrameB)paleoFrameB.lines.visible=paleoFrameB.land.visible=true;
    applyFrameBlend(paleoFrameA.lines,paleoFrameB?.lines,bracket.t);
    applyFrameBlend(paleoFrameA.land,paleoFrameB?.land,bracket.t);
  }else{
    ensurePaleoFrame(year);
  }
  ensureFollowCountry(year);
}

function scheduleGeography(year){
  clearTimeout(pendingGeographyTimer);
  pendingGeographyTimer=setTimeout(()=>updateGeography(year),80);
}
function filterCountries(){
  if(!modernCountries||!followSelect)return;
  const query=(countrySearch?.value||'').trim().toLocaleLowerCase();
  const current=followSelect.value||savedPreferences.country||'';
  followSelect.innerHTML='<option value="">None</option>';
  const sorted=modernCountries.features.filter(feature=>feature.properties?.name).sort((a,b)=>a.properties.name.localeCompare(b.properties.name,'en',{sensitivity:'base'}));
  for(const feature of sorted){
    const name=feature.properties.name;
    if(!query||name.toLocaleLowerCase().includes(query)){
      const option=document.createElement('option');option.value=name;option.textContent=name;followSelect.appendChild(option);
    }
  }
  if([...followSelect.options].some(option=>option.value===current))followSelect.value=current;
}
function applySavedLayers(){
  for(const [element,key,defaultValue] of [[document.querySelector('#terrain'),'terrain',true],[atmosphereToggle,'atmosphere',true],[heatToggle,'heat',true],[countryToggle,'borders',true]])if(element)element.checked=savedPreferences[key]??defaultValue;
}

time=new TimeController({
  slider:document.querySelector('#timeline'),
  yearInput:document.querySelector('#yearInput'),
  yearOutput:document.querySelector('#year'),
  epoch:document.querySelector('#epoch'),
  playButton:document.querySelector('#play'),
  onChange:year=>{
    saveYearThrottled(year);
    scheduleGeography(year);
  }
});

applySavedLayers();
const resetStartYear=window.__intheglobeResetVideoStartYear;
if(Number.isFinite(resetStartYear)){
  time.setYear(resetStartYear);
  delete window.__intheglobeResetVideoStartYear;
}else if(Number.isFinite(savedPreferences.year)){
  time.setYear(savedPreferences.year);
}
if(Number.isFinite(savedPreferences.speed))time.speed=savedPreferences.speed;
setPlayAvailability();

const originalToggle=time.toggle.bind(time);
time.toggle=()=>{
  if(!time.playing&&bufferProgress<PLAY_THRESHOLD){setPlayAvailability();return;}
  originalToggle();
  savePreferences({playing:time.playing,speed:time.speed});
  setPlayAvailability();
};

time.slider?.addEventListener('input',()=>savePreferences({playing:false}));
document.querySelectorAll('#speeds [data-speed]').forEach(button=>button.addEventListener('click',()=>savePreferences({speed:time.speed})));
heatToggle?.addEventListener('change',event=>savePreferences({heat:event.target.checked}));
atmosphereToggle?.addEventListener('change',event=>{atmosphere.visible=event.target.checked;savePreferences({atmosphere:event.target.checked});});
document.querySelector('#terrain')?.addEventListener('change',event=>savePreferences({terrain:event.target.checked}));
document.querySelector('#jumpPresent')?.addEventListener('click',()=>time.setYear(2026));
countryToggle?.addEventListener('change',()=>{if(countryBorders)countryBorders.visible=countryToggle.checked&&time.year>=-10000&&time.year<=2026;savePreferences({borders:countryToggle.checked});});
followSelect?.addEventListener('change',()=>{
  const selected=followSelect.value||'';
  savePreferences({country:selected});
  followRequestedKey='';followRequestSerial++;
  for(const frame of [followFrameA,followFrameB])if(frame){earthGroup.remove(frame);disposeLineGroup(frame);}
  followFrameA=followFrameB=null;followFrameKey='';
  ensureFollowCountry(time.year);
  if(selected){const country=countryFeatureByName(selected);if(country)prefetchReconstructedCountryFrames(country,timelineAges(),'CAO2024',12,()=>{}).catch(()=>{});}
});
countrySearch?.addEventListener('input',filterCountries);

const hud=document.querySelector('#hud');
document.querySelector('#collapse')?.addEventListener('click',()=>hud?.classList.add('hidden'));
document.querySelector('#dock')?.addEventListener('click',()=>hud?.classList.remove('hidden'));
canvas.addEventListener('dblclick',()=>{controls.reset();camera.position.set(0,0,3.05);});

function resize(){
  renderer.setSize(innerWidth,innerHeight,false);
  camera.aspect=innerWidth/innerHeight;
  camera.updateProjectionMatrix();
}
resize();
window.addEventListener('resize',()=>{renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));resize();});

const backgroundAges=timelineAges();
const persistedTimelineProgress=timelineCachedProgress(backgroundAges.length);
if(persistedTimelineProgress>0){
  bufferProgress=persistedTimelineProgress;
  if(bufferAmount)bufferAmount.textContent=`${Math.round(bufferProgress*100)}%`;
  if(bufferFill)bufferFill.style.width=`${bufferProgress*100}%`;
  if(bufferNote)bufferNote.textContent=bufferProgress>=1?'Timeline loaded from browser cache · playback ready':`Resuming timeline buffer · ${Math.round(bufferProgress*100)}% already stored`;
  setPlayAvailability();
}
Promise.resolve().then(async()=>{
  try{
    const complete=await prefetchPaleoFrames(backgroundAges,'CAO2024',20,(progress,done,total)=>setBufferProgress(progress,done,total));
    prefetchFinished=complete;
    if(complete){bufferProgress=1;setBufferProgress(1,backgroundAges.length,backgroundAges.length);if(bufferNote)bufferNote.textContent=`Timeline loaded · ${backgroundAges.length} keyframes stored for playback`;}
  }catch(error){debug(`Timeline prefetch failed: ${error.stack||error}`,'warn');}
})();

loadModernCountries().then(countries=>{
  modernCountries=countries;
  filterCountries();
  if(savedPreferences.country&&countryFeatureByName(savedPreferences.country)){followSelect.value=savedPreferences.country;ensureFollowCountry(time.year);}
  return loadModernCountryBorders();
}).then(group=>{
  countryBorders=group;
  earthGroup.add(group);
  countryBorders.visible=!!countryToggle?.checked&&time.year>=-10000&&time.year<=2026;
}).catch(error=>debug(`Country boundary data unavailable: ${error.stack||error}`,'warn'));

requestAnimationFrame(function frame(now){
  time.update(now);
  controls.update();
  renderer.render(scene,camera);
  requestAnimationFrame(frame);
});

updateGeography(time.year);
finishLoading(time.year<-10000?`CAO2024 RECONSTRUCTION · ${Math.round(-time.year/1e6).toLocaleString()} Ma`:time.year>2026?'SPECULATIVE FUTURE · PANGEA ULTIMA SCENARIO':`MODERN EARTH · ${Math.round(time.year).toLocaleString()} CE`);
