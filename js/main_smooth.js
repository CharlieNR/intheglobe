import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js';
import {OrbitControls} from 'https://cdn.jsdelivr.net/npm/three@0.161.0/examples/jsm/controls/OrbitControls.js';
import {TimeController} from './time_controller.js';
import {fragmentShader,vertexShader,atmosphereFragment,atmosphereVertex} from './shaders.js';
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
const debugEntries=[];
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

function debug(message,type='info'){
  const text=`[+${((performance.now()-startedAt)/1000).toFixed(2)}s] ${message}`;
  debugEntries.push({text,type});
  if(debugEntries.length>300)debugEntries.shift();
  if(debugLog){
    const line=document.createElement('div');
    line.className=`debug-entry ${type}`;
    line.textContent=text;
    debugLog.appendChild(line);
    debugLog.scrollTop=debugLog.scrollHeight;
  }
}

function finishLoading(message='READY'){
  if(loadingFinished)return;
  loadingFinished=true;
  loading?.classList.add('done');
  if(status)status.textContent=message;
  debug(`Loading screen dismissed: ${message}`,'ok');
}

function loadPreferences(){
  try{
    const raw=localStorage.getItem(STORAGE_KEY);
    savedPreferences=raw?JSON.parse(raw)||{}:{};
    debug('Loaded saved browser preferences','ok');
  }catch(e){
    savedPreferences={};
    debug(`Browser storage unavailable: ${e.message||e}`,'warn');
  }
}

function savePreferences(patch){
  try{
    savedPreferences={...savedPreferences,...patch};
    localStorage.setItem(STORAGE_KEY,JSON.stringify(savedPreferences));
  }catch(e){
    debug(`Could not save browser preferences: ${e.message||e}`,'warn');
  }
}

function setPlayAvailability(){
  const ready=bufferProgress>=PLAY_THRESHOLD;
  const button=time?.playButton;
  if(!button)return;
  button.disabled=!ready;
  button.textContent=ready?(time.playing?'❚❚ Pause':'▶ Play'):'🚫 Play';
  button.title=ready?'Play the geological timeline':`Playback unlocks at ${Math.round(PLAY_THRESHOLD*100)}% buffered`;
  button.setAttribute('aria-disabled',String(!ready));
}

function setBufferProgress(value,done,total){
  bufferProgress=Math.max(bufferProgress,Math.min(1,value));
  if(bufferAmount)bufferAmount.textContent=`${Math.round(bufferProgress*100)}%`;
  if(bufferFill)bufferFill.style.width=`${bufferProgress*100}%`;
  if(bufferNote&&!prefetchFinished)bufferNote.textContent=`Loading ${done}/${total} timeline keyframes in the background…`;
  setPlayAvailability();
}

function materialsFor(group){
  if(!group)return[];
  if(group.userData.__intheglobeMaterials)return group.userData.__intheglobeMaterials;
  const materials=[];
  const seen=new Set();
  group.traverse(object=>{
    if(!object.material)return;
    const list=Array.isArray(object.material)?object.material:[object.material];
    for(const material of list){
      if(seen.has(material))continue;
      seen.add(material);
      material.transparent=true;
      material.depthWrite=false;
      materials.push(material);
    }
  });
  group.userData.__intheglobeMaterials=materials;
  return materials;
}

function setGroupOpacity(group,opacity){
  if(!group)return;
  const value=Math.max(0,Math.min(1,opacity));
  for(const material of materialsFor(group))material.opacity=value;
}

function setGroupVisible(group,visible){
  if(group)group.visible=visible;
}

function applyFrameBlend(a,b,t){
  if(!a)return;
  const x=Math.max(0,Math.min(1,t));
  const blend=x*x*(3-2*x);
  setGroupOpacity(a,1-blend);
  if(b&&b!==a)setGroupOpacity(b,blend);
}

function makeFrameKey(year){
  const bracket=timelineBracket(year);
  return `${bracket.lower}:${bracket.upper}`;
}

function countryFeatureByName(name){
  return modernCountries?.features.find(feature=>feature.properties?.name===name)||null;
}

window.addEventListener('error',event=>{
  debug(`Window error: ${event.message} @ ${event.filename||'unknown'}:${event.lineno||'?'}`,'error');
  finishLoading('READY · DATA DEGRADED');
});
window.addEventListener('unhandledrejection',event=>{
  debug(`Unhandled promise rejection: ${event.reason?.stack||event.reason}`,'error');
  finishLoading('READY · DATA DEGRADED');
});

loadPreferences();
debug('Booting InTheGlobe');
debug(`Browser: ${navigator.userAgent}`);
debug(`WebGL canvas: ${canvas?'found':'MISSING'}`);

let renderer;
try{
  renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
  debug('Three.js WebGLRenderer created','ok');
}catch(error){
  debug(`WebGLRenderer failed: ${error.stack||error}`,'error');
  finishLoading('WEBGL INITIALISATION FAILED');
  throw error;
}
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.05;

const scene=new THREE.Scene();
scene.background=new THREE.Color(0x01050c);
scene.add(new THREE.AmbientLight(0x9fc5dd,1.25));
const sun=new THREE.DirectionalLight(0xffffff,2.2);
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
const fallbackDiffuse=new THREE.DataTexture(new Uint8Array([42,100,145,255]),1,1,THREE.RGBAFormat);
fallbackDiffuse.needsUpdate=true;
fallbackDiffuse.colorSpace=THREE.SRGBColorSpace;
const fallbackNormal=new THREE.DataTexture(new Uint8Array([128,128,255,255]),1,1,THREE.RGBAFormat);
fallbackNormal.needsUpdate=true;
const fallbackSpecular=new THREE.DataTexture(new Uint8Array([35,35,35,255]),1,1,THREE.RGBAFormat);
fallbackSpecular.needsUpdate=true;
const uniforms={
  uYear:{value:2026},
  uHeat:{value:1},
  uLight:{value:new THREE.Vector3(-.7,.35,.55).normalize()},
  uEarth:{value:fallbackDiffuse},
  uNormal:{value:fallbackNormal},
  uSpecular:{value:fallbackSpecular}
};

loader.load('https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg',texture=>{
  texture.colorSpace=THREE.SRGBColorSpace;
  uniforms.uEarth.value=texture;
  debug('Earth diffuse texture loaded','ok');
},undefined,error=>debug(`Earth diffuse texture failed: ${error?.message||error}`,'error'));
loader.load('https://threejs.org/examples/textures/planets/earth_normal_2048.jpg',texture=>{
  uniforms.uNormal.value=texture;
  debug('Earth normal map loaded','ok');
},undefined,error=>debug(`Earth normal map failed: ${error?.message||error}`,'warn'));
loader.load('https://threejs.org/examples/textures/planets/earth_specular_2048.jpg',texture=>{
  uniforms.uSpecular.value=texture;
  debug('Earth specular map loaded','ok');
},undefined,error=>debug(`Earth specular map failed: ${error?.message||error}`,'warn'));

const modernGlobe=new THREE.Mesh(
  new THREE.SphereGeometry(1,192,128),
  new THREE.ShaderMaterial({vertexShader,fragmentShader,uniforms})
);
earthGroup.add(modernGlobe);

const paleoOcean=new THREE.Mesh(
  new THREE.SphereGeometry(.999,128,96),
  new THREE.MeshStandardMaterial({color:0x0e5d86,roughness:.65,metalness:.02})
);
paleoOcean.visible=false;
earthGroup.add(paleoOcean);

const atmosphere=new THREE.Mesh(
  new THREE.SphereGeometry(1.045,128,80),
  new THREE.ShaderMaterial({vertexShader:atmosphereVertex,fragmentShader:atmosphereFragment,transparent:true,side:THREE.BackSide,depthWrite:false,blending:THREE.AdditiveBlending})
);
earthGroup.add(atmosphere);

const starGeo=new THREE.BufferGeometry();
const stars=[];
for(let i=0;i<1800;i++){
  const radius=12+Math.random()*18;
  const azimuth=Math.random()*Math.PI*2;
  const polar=Math.acos(2*Math.random()-1);
  stars.push(radius*Math.sin(polar)*Math.cos(azimuth),radius*Math.cos(polar),radius*Math.sin(polar)*Math.sin(azimuth));
}
starGeo.setAttribute('position',new THREE.Float32BufferAttribute(stars,3));
scene.add(new THREE.Points(starGeo,new THREE.PointsMaterial({color:0xffffff,size:.035,sizeAttenuation:true,transparent:true,opacity:.55})));

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
  status.textContent=`LOADING · ${bracket.lower}${bracket.upper!==bracket.lower?`–${bracket.upper}`:''} Ma`;
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
      if(!frame)continue;
      earthGroup.remove(frame.lines,frame.land);
      disposeLineGroup(frame.lines);disposeLineGroup(frame.land);
    }
    paleoFrameA=low;
    paleoFrameB=high;
    paleoFrameKey=key;
    paleoRequestedKey=key;
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
    for(const group of [followFrameA,followFrameB]){
      if(group){earthGroup.remove(group);disposeLineGroup(group);}
    }
    followFrameA=followFrameB=null;
    followFrameKey='';
    followRequestedKey='';
    return;
  }
  const country=countryFeatureByName(selected);
  if(!country)return;
  if(year>2026){
    setGroupVisible(followFrameA,false);setGroupVisible(followFrameB,false);return;
  }
  if(year>=-10000){
    if(followFrameKey==='present'&&followFrameA){
      setGroupVisible(followFrameA,true);setGroupOpacity(followFrameA,1);return;
    }
    if(followRequestedKey==='present')return;
    followRequestedKey='present';
    const serial=++followRequestSerial;
    try{
      const group=makeCountryHighlight(country,1.012);
      if(serial!==followRequestSerial){disposeLineGroup(group);return;}
      for(const frame of [followFrameA,followFrameB]){
        if(frame){earthGroup.remove(frame);disposeLineGroup(frame);}
      }
      followFrameA=group;followFrameB=null;followFrameKey='present';
      earthGroup.add(group);group.visible=true;setGroupOpacity(group,1);
    }catch(error){debug(`Country tracking failed: ${error.stack||error}`,'error');}
    return;
  }

  const bracket=timelineBracket(year);
  const key=`${selected}:${bracket.lower}:${bracket.upper}`;
  if(key===followFrameKey&&followFrameA){
    setGroupVisible(followFrameA,true);setGroupVisible(followFrameB,true);
    applyFrameBlend(followFrameA,followFrameB,bracket.t);
    return;
  }
  if(key===followRequestedKey)return;
  followRequestedKey=key;
  const serial=++followRequestSerial;
  try{
    const [low,high]=await Promise.all([
      loadReconstructedCountry(country,bracket.lower,'CAO2024'),
      bracket.upper===bracket.lower?Promise.resolve(null):loadReconstructedCountry(country,bracket.upper,'CAO2024')
    ]);
    if(serial!==followRequestSerial){disposeLineGroup(low);if(high)disposeLineGroup(high);return;}
    for(const frame of [followFrameA,followFrameB]){
      if(frame){earthGroup.remove(frame);disposeLineGroup(frame);}
    }
    followFrameA=low;followFrameB=high;followFrameKey=key;
    earthGroup.add(low);if(high)earthGroup.add(high);
    low.visible=true;if(high)high.visible=true;
    applyFrameBlend(low,high,bracket.t);
  }catch(error){debug(`Country tracking failed: ${error.stack||error}`,'error');}
}

function updateGeography(year){
  const historical=year<-10000;
  const future=year>2026;
  modernGlobe.visible=!historical;
  paleoOcean.visible=historical;
  atmosphere.visible=document.querySelector('#atmosphere')?.checked??true;
  if(countryBorders)countryBorders.visible=!!countryToggle?.checked&&!historical&&!future;

  if(future){
    status.textContent='SPECULATIVE FUTURE · PANGEA ULTIMA SCENARIO';
    for(const frame of [paleoFrameA,paleoFrameB]){
      if(frame){frame.lines.visible=false;frame.land.visible=false;}
    }
    setGroupVisible(followFrameA,false);setGroupVisible(followFrameB,false);
    return;
  }

  if(!historical){
    status.textContent=`MODERN EARTH · ${Math.round(year).toLocaleString()} CE`;
    for(const frame of [paleoFrameA,paleoFrameB]){
      if(frame){frame.lines.visible=false;frame.land.visible=false;}
    }
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

function filterCountries(){
  if(!modernCountries||!followSelect)return;
  const query=(countrySearch?.value||'').trim().toLocaleLowerCase();
  const current=followSelect.value||savedPreferences.country||'';
  followSelect.innerHTML='<option value="">None</option>';
  const sorted=modernCountries.features.filter(feature=>feature.properties?.name).sort((a,b)=>a.properties.name.localeCompare(b.properties.name,'en',{sensitivity:'base'}));
  for(const feature of sorted){
    const name=feature.properties.name;
    if(!query||name.toLocaleLowerCase().includes(query)){
      const option=document.createElement('option');
      option.value=name;
      option.textContent=name;
      followSelect.appendChild(option);
    }
  }
  if([...followSelect.options].some(option=>option.value===current))followSelect.value=current;
}

function applySavedLayers(){
  for(const [selector,key,defaultValue] of [['#terrain','terrain',true],['#atmosphere','atmosphere',true],['#heat','heat',true],['#borders','borders',true]]){
    const element=document.querySelector(selector);
    if(element)element.checked=savedPreferences[key]??defaultValue;
  }
}

time=new TimeController({
  slider:document.querySelector('#timeline'),
  yearInput:document.querySelector('#yearInput'),
  yearOutput:document.querySelector('#year'),
  epoch:document.querySelector('#epoch'),
  playButton:document.querySelector('#play'),
  onChange:year=>{
    uniforms.uYear.value=year;
    savePreferences({year:Math.round(year)});
    updateGeography(year);
  }
});

applySavedLayers();
if(Number.isFinite(savedPreferences.year))time.setYear(savedPreferences.year);
if(Number.isFinite(savedPreferences.speed))time.speed=savedPreferences.speed;
setPlayAvailability();
debug('Time controller initialised','ok');

const originalToggle=time.toggle.bind(time);
time.toggle=()=>{
  if(!time.playing&&bufferProgress<PLAY_THRESHOLD){setPlayAvailability();debug('Playback blocked until 50% of timeline keyframes is buffered','warn');return;}
  originalToggle();
  savePreferences({playing:time.playing,speed:time.speed});
  setPlayAvailability();
};

time.slider?.addEventListener('input',()=>savePreferences({playing:false}));

document.querySelectorAll('#speeds [data-speed]').forEach(button=>button.addEventListener('click',()=>savePreferences({speed:time.speed})));

document.querySelector('#heat')?.addEventListener('change',event=>{uniforms.uHeat.value=event.target.checked?1:0;savePreferences({heat:event.target.checked});});
document.querySelector('#atmosphere')?.addEventListener('change',event=>{atmosphere.visible=event.target.checked;savePreferences({atmosphere:event.target.checked});});
document.querySelector('#terrain')?.addEventListener('change',event=>savePreferences({terrain:event.target.checked}));
document.querySelector('#jumpPresent')?.addEventListener('click',()=>time.setYear(2026));
countryToggle?.addEventListener('change',()=>{if(countryBorders)countryBorders.visible=countryToggle.checked&&time.year>=-10000&&time.year<=2026;savePreferences({borders:countryToggle.checked});});
followSelect?.addEventListener('change',()=>{
  const selected=followSelect.value||'';
  savePreferences({country:selected});
  followRequestedKey='';
  followRequestSerial++;
  for(const frame of [followFrameA,followFrameB]){
    if(frame){earthGroup.remove(frame);disposeLineGroup(frame);}
  }
  followFrameA=followFrameB=null;followFrameKey='';
  ensureFollowCountry(time.year);
  if(selected){
    const country=countryFeatureByName(selected);
    if(country){
      prefetchReconstructedCountryFrames(country,timelineAges(),'CAO2024',12,()=>{}).catch(error=>debug(`Country reconstruction prefetch failed: ${error.stack||error}`,'warn'));
    }
  }
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
window.addEventListener('resize',()=>{renderer.setPixelRatio(Math.min(devicePixelRatio,2));resize();});

const backgroundAges=timelineAges();
const persistedTimelineProgress=timelineCachedProgress(backgroundAges.length);
if(persistedTimelineProgress>0){
  bufferProgress=persistedTimelineProgress;
  setPlayAvailability();
  if(bufferAmount)bufferAmount.textContent=`${Math.round(bufferProgress*100)}%`;
  if(bufferFill)bufferFill.style.width=`${bufferProgress*100}%`;
  if(bufferNote)bufferNote.textContent=bufferProgress>=1?'Timeline loaded from browser cache · playback ready':`Resuming timeline buffer · ${Math.round(bufferProgress*100)}% already stored`;
  debug(`Restored ${Math.round(bufferProgress*100)}% timeline readiness from browser storage`,'ok');
}

debug(`Preparing ${backgroundAges.length} geological keyframes for background buffering`);
Promise.resolve().then(async()=>{
  try{
    const complete=await prefetchPaleoFrames(backgroundAges,'CAO2024',20,(progress,done,total)=>setBufferProgress(progress,done,total));
    prefetchFinished=complete;
    if(complete){
      bufferProgress=1;
      setBufferProgress(1,backgroundAges.length,backgroundAges.length);
      if(bufferNote)bufferNote.textContent=`Timeline loaded · ${backgroundAges.length} keyframes stored for playback`;
      debug(`Background timeline prefetch completed · ${backgroundAges.length} keyframes`,'ok');
    }else{
      if(bufferNote)bufferNote.textContent=`Timeline buffer paused at ${Math.round(bufferProgress*100)}% · unavailable frames will retry`;
      debug(`Timeline prefetch incomplete · ${Math.round(bufferProgress*100)}% available`,'warn');
    }
  }catch(error){debug(`Background timeline prefetch failed: ${error.stack||error}`,'error');}
})();

loadModernCountries().then(countries=>{
  modernCountries=countries;
  filterCountries();
  if(savedPreferences.country&&countryFeatureByName(savedPreferences.country)){followSelect.value=savedPreferences.country;ensureFollowCountry(time.year);}
  debug(`Loaded ${countries.features.length} country geometries in alphabetical order`,'ok');
  return loadModernCountryBorders();
}).then(group=>{
  countryBorders=group;
  earthGroup.add(group);
  countryBorders.visible=!!countryToggle?.checked&&time.year>=-10000&&time.year<=2026;
  debug('Modern country boundaries loaded','ok');
}).catch(error=>debug(`Country boundary data unavailable: ${error.stack||error}`,'error'));

requestAnimationFrame(function frame(now){
  time.update(now);
  controls.update();
  renderer.render(scene,camera);
  requestAnimationFrame(frame);
});

updateGeography(time.year);
finishLoading(`MODERN EARTH · ${Math.round(time.year).toLocaleString()} CE`);
debug('Render loop started','ok');
