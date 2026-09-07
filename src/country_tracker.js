import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';
import {PLATES,latLonToVec,plateQuaternions} from './plate_model.js';

export const COUNTRIES=[
 {name:'None',lat:0,lon:0,plate:-1},
 {name:'United Kingdom',lat:54.0,lon:-2.5,plate:3},
 {name:'Ireland',lat:53.3,lon:-8.0,plate:3},
 {name:'France',lat:46.2,lon:2.2,plate:3},
 {name:'Germany',lat:51.2,lon:10.4,plate:3},
 {name:'Italy',lat:42.8,lon:12.5,plate:3},
 {name:'Spain',lat:40.2,lon:-3.7,plate:3},
 {name:'United States',lat:39.8,lon:-98.6,plate:1},
 {name:'Canada',lat:56.1,lon:-106.3,plate:1},
 {name:'Mexico',lat:23.6,lon:-102.6,plate:1},
 {name:'Brazil',lat:-10.8,lon:-52.9,plate:2},
 {name:'Argentina',lat:-38.4,lon:-63.6,plate:2},
 {name:'South Africa',lat:-30.6,lon:22.9,plate:4},
 {name:'Egypt',lat:26.8,lon:30.8,plate:4},
 {name:'India',lat:22.9,lon:79.0,plate:9},
 {name:'Australia',lat:-25.3,lon:133.8,plate:5},
 {name:'New Zealand',lat:-41.0,lon:174.0,plate:5},
 {name:'Japan',lat:36.2,lon:138.3,plate:10},
 {name:'Indonesia',lat:-2.5,lon:118.0,plate:5},
 {name:'China',lat:35.9,lon:104.2,plate:3}
];

function qrot(v,q){const x=new THREE.Vector3(q.x,q.y,q.z),w=q.w;return v.clone().add(x.clone().cross(x.clone().cross(v).add(v.clone().multiplyScalar(w))).multiplyScalar(2));}
export function countryWorldVector(country,year){
 const p=latLonToVec(country.lat,country.lon);
 if(country.plate<0)return new THREE.Vector3(p.x,p.y,p.z);
 const q=plateQuaternions(year)[country.plate];
 return qrot(new THREE.Vector3(p.x,p.y,p.z),q).normalize();
}
export function countryWorldPosition(country,year,radius=1.08){return countryWorldVector(country,year).multiplyScalar(radius)}
