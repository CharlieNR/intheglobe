// Plate kinematics: present-day rigid-plate continuation plus historical keyframes.
// Rates are deliberately approximate engineering inputs. USGS notes that present plate
// velocities are measurable with GPS and vary by plate; this module keeps the values
// explicit so they can later be replaced by a published Euler-vector catalogue.

export const PLATES = [
  {name:'Pacific', seed:[-20,-150], pole:[-55,-105], speedCmYr:10.0},
  {name:'North America', seed:[45,-105], pole:[52,-95], speedCmYr:2.0},
  {name:'South America', seed:[-15,-55], pole:[-60,-95], speedCmYr:2.0},
  {name:'Eurasia', seed:[50,75], pole:[60,-100], speedCmYr:1.0},
  {name:'Africa', seed:[5,20], pole:[-50,25], speedCmYr:2.0},
  {name:'Indo-Australian', seed:[-15,115], pole:[-35,35], speedCmYr:6.0},
  {name:'Antarctic', seed:[-75,0], pole:[-65,-20], speedCmYr:1.5},
  {name:'Nazca', seed:[-15,-105], pole:[50,80], speedCmYr:7.0},
  {name:'Arabian', seed:[25,45], pole:[-5,60], speedCmYr:3.0},
  {name:'India', seed:[20,78], pole:[-20,120], speedCmYr:5.0},
  {name:'Philippine', seed:[15,125], pole:[50,-70], speedCmYr:7.0},
  {name:'Caribbean', seed:[15,-75], pole:[15,160], speedCmYr:2.0}
];

const R_EARTH_M = 6.371e6;
const DEG = Math.PI/180;
export function latLonToVec(lat,lon){
  const a=lat*DEG,b=lon*DEG,c=Math.cos(a);
  return {x:c*Math.cos(b),y:Math.sin(a),z:c*Math.sin(b)};
}
export function angularSpeed(speedCmYr){ return (speedCmYr/100)/R_EARTH_M; }
export function axisForPlate(p){ return latLonToVec(p.pole[0],p.pole[1]); }

export function quatFromAxisAngle(axis,angle){
  const h=angle*.5,s=Math.sin(h);
  return {x:axis.x*s,y:axis.y*s,z:axis.z*s,w:Math.cos(h)};
}
export function quatMul(a,b){
  return {x:a.w*b.x+a.x*b.w+a.y*b.z-a.z*b.y,
    y:a.w*b.y-a.x*b.z+a.y*b.w+a.z*b.x,
    z:a.w*b.z+a.x*b.y-a.y*b.x+a.z*b.w,
    w:a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z};
}
export function quatConj(q){return{x:-q.x,y:-q.y,z:-q.z,w:q.w}}

// Historical anchor rotations are a simplified reconstruction scaffold.
// They deliberately interpolate through Pannotia/Pangea/present rather than
// pretending that a few procedural points are equivalent to a published model.
const HISTORICAL = [-600e6,-335e6,-250e6,0];
const HIST_ANGLES = [
  [0.75,-0.55,0.45,-0.35,0.25,-0.30,0.20,0.60,-0.45,0.55,0.50,-0.30],
  [0.35,-0.20,0.15,-0.05,0.10,-0.05,0.08,0.25,-0.12,0.20,0.18,-0.10],
  [0.18,-0.08,0.05,0.00,0.04,-0.02,0.03,0.12,-0.05,0.10,0.08,-0.04],
  [0,0,0,0,0,0,0,0,0,0,0,0]
];

function smoothstep(t){return t*t*(3-2*t)}
function interpolateAngle(i,year){
  if(year<=HISTORICAL[0])return HIST_ANGLES[0][i];
  if(year>=0)return 0;
  let k=0;while(k<HISTORICAL.length-1&&year>HISTORICAL[k+1])k++;
  const t=smoothstep((year-HISTORICAL[k])/(HISTORICAL[k+1]-HISTORICAL[k]));
  return HIST_ANGLES[k][i]*(1-t)+HIST_ANGLES[k+1][i]*t;
}

export function plateQuaternions(year){
  return PLATES.map((p,i)=>{
    const axis=axisForPlate(p);
    // Before present: historical scaffold. After present: continue current
    // Euler motion at constant present-day angular velocity.
    const qHist=quatFromAxisAngle(axis,interpolateAngle(i,year));
    if(year<=0)return qHist;
    const qFuture=quatFromAxisAngle(axis,angularSpeed(p.speedCmYr)*year);
    return quatMul(qFuture,qHist);
  });
}
export function seeds(){
  return PLATES.map(p=>latLonToVec(p.seed[0],p.seed[1]));
}