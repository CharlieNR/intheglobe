export const MIN_YEAR=-600000000,MAX_YEAR=250000000,PRESENT=2026;
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function normalize(v){const l=Math.hypot(v.x,v.y,v.z)||1;return{x:v.x/l,y:v.y/l,z:v.z/l}}
export function latLon(lat,lon){const a=lat*Math.PI/180,b=lon*Math.PI/180;return{x:Math.cos(a)*Math.cos(b),y:Math.sin(a),z:Math.cos(a)*Math.sin(b)}}
export function eulerQuaternion(axis,angularVelocity,timeMyr){const a=normalize(axis),h=angularVelocity*timeMyr*Math.PI/180/2;return{w:Math.cos(h),x:a.x*Math.sin(h),y:a.y*Math.sin(h),z:a.z*Math.sin(h)}}
function cross(a,b){return{x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x}}
export function quatRotate(v,q){const t=cross({x:q.x,y:q.y,z:q.z},v),u={x:2*t.x,y:2*t.y,z:2*t.z},c=cross({x:q.x,y:q.y,z:q.z},u);return{x:v.x+q.w*u.x+c.x,y:v.y+q.w*u.y+c.y,z:v.z+q.w*u.z+c.z}}
export function catmullRom(a,b,c,d,t){const t2=t*t,t3=t2*t;return{x:.5*(2*b.x+(-a.x+c.x)*t+(2*a.x-5*b.x+4*c.x-d.x)*t2+(-a.x+3*b.x-3*c.x+d.x)*t3),y:.5*(2*b.y+(-a.y+c.y)*t+(2*a.y-5*b.y+4*c.y-d.y)*t2+(-a.y+3*b.y-3*c.y+d.y)*t3),z:.5*(2*b.z+(-a.z+c.z)*t+(2*a.z-5*b.z+4*c.z-d.z)*t2+(-a.z+3*b.z-3*c.z+d.z)*t3)}}
export function timeToSlider(year){const y=clamp(year,MIN_YEAR,MAX_YEAR);if(y>=-2000000)return 800+(y+2000000)/(MAX_YEAR+2000000)*200;return 800*Math.pow((y-MIN_YEAR)/(-2000000-MIN_YEAR),.55)}
export function sliderToTime(value){const v=clamp(Number(value),0,1000);if(v>=800)return -2000000+(v-800)/200*(MAX_YEAR+2000000);return MIN_YEAR+Math.pow(v/800,1/.55)*(-2000000-MIN_YEAR)}
export function formatYear(y){const n=Math.round(y);return n<0?`${Math.abs(n).toLocaleString()} BCE`:`${Math.max(1,n).toLocaleString()} CE`}
export function epochForYear(y){if(y>0)return'Holocene · present Earth';if(y>-11700)return'Late Pleistocene / Holocene';if(y>-2600000)return'Pleistocene';if(y>-66000000)return'Cenozoic';if(y>-145000000)return'Late Jurassic / Early Cretaceous';if(y>-252000000)return'Mesozoic';if(y>-335000000)return'Late Paleozoic';if(y>-541000000)return'Paleozoic';return'Neoproterozoic · Pannotia era'}
export const PLATES={Laurentia:{axis:latLon(55,-100),rate:.018},Gondwana:{axis:latLon(-25,20),rate:-.012},Eurasia:{axis:latLon(45,80),rate:.009},Siberia:{axis:latLon(65,110),rate:-.008},India:{axis:latLon(5,75),rate:.022},Australia:{axis:latLon(-25,135),rate:.014},Antarctica:{axis:latLon(-80,0),rate:.004},Pacific:{axis:latLon(0,-150),rate:-.016}};
export function plateTransform(point,plate,year){const p=PLATES[plate]||PLATES.Laurentia;return quatRotate(point,eulerQuaternion(p.axis,p.rate,(year-PRESENT)/1000000))}
