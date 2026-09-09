import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js';
import {loadModernCountryOverlay} from './geography.js';

const STORAGE_KEY='intheglobe.preferences.v1';
const OVERLAY_ID='modernCountries';
let overlay=null;
let ready=false;
let wanted=false;
let initialised=false;

function readPreferences(){try{const raw=localStorage.getItem(STORAGE_KEY);return raw?JSON.parse(raw)||{}:{}}catch{return {}}}
function savePreference(value){try{const prefs=readPreferences();prefs.modernCountries=!!value;localStorage.setItem(STORAGE_KEY,JSON.stringify(prefs))}catch{}}
function apply(){wanted=!!document.querySelector(`#${OVERLAY_ID}`)?.checked;if(overlay)overlay.visible=wanted}
function addToggle(){
  if(document.getElementById(OVERLAY_ID))return;
  const section=[...document.querySelectorAll('.section-title')].find(x=>x.textContent.trim()==='Layers');
  const terrain=document.querySelector('#terrain')?.closest('.switch-row');
  if(!section||!terrain)return;
  const row=document.createElement('label');
  row.className='switch-row';
  row.innerHTML='<span><span class="dot" style="background:#168cff"></span>Modern-day countries</span><input id="modernCountries" type="checkbox"><span class="switch"></span>';
  terrain.parentNode.insertBefore(row,terrain);
  row.querySelector('input').checked=!!readPreferences().modernCountries;
  row.querySelector('input').addEventListener('change',e=>{savePreference(e.target.checked);apply()});
  apply();
}
async function initForEarthGroup(earthGroup){
  if(initialised)return;
  initialised=true;
  addToggle();
  try{
    overlay=await loadModernCountryOverlay(1.012);
    overlay.name='ModernDayCountriesOverlay';
    overlay.visible=wanted;
    earthGroup.add(overlay);
    window.__intheglobeModernCountryOverlay=overlay;
    ready=true;
  }catch(error){
    console.error('[InTheGlobe] Modern-day country overlay error',error);
  }
}

const originalSceneAdd=THREE.Scene.prototype.add;
if(!THREE.Scene.prototype.__intheglobeOverlayHook){
  THREE.Scene.prototype.__intheglobeOverlayHook=true;
  THREE.Scene.prototype.add=function(...objects){
    const result=originalSceneAdd.apply(this,objects);
    for(const object of objects){
      if(object?.isGroup&&!window.__intheglobeEarthGroup){
        window.__intheglobeEarthGroup=object;
        void initForEarthGroup(object);
        break;
      }
    }
    return result;
  };
}

addToggle();
void ready;
