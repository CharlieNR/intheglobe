const API='https://gws.gplates.org';
export const MODEL='MULLER2022';
const cache=new Map();
async function get(path,params){const u=new URL(API+path);Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,String(v)));const key=u.href;if(cache.has(key))return cache.get(key);const p=fetch(key).then(async r=>{if(!r.ok)throw new Error(`GPlates HTTP ${r.status}`);return r.json()});cache.set(key,p);return p}
export const staticPolygons=t=>get('/reconstruct/static_polygons/',{time:t,model:MODEL});
export const coastlines=t=>get('/reconstruct/coastlines/',{time:t,model:MODEL,wrap:true});
export const assignPlateIds=(lats,lons)=>get('/reconstruct/assign_points_plate_ids',{lats:lats.join(','),lons:lons.join(','),model:MODEL});
export const reconstructPoints=(lats,lons,t)=>get('/reconstruct/reconstruct_points/',{lats:lats.join(','),lons:lons.join(','),time:t,model:MODEL,return_null_points:true,fc:true});
export async function currentEulerPerMa(pid){const d=await get('/rotation/get_euler_pole_and_angle',{times:1,pids:pid,model:MODEL});const a=Array.isArray(d)?d.flat(Infinity):[];for(let i=0;i<a.length-2;i++){if(typeof a[i]==='number'&&typeof a[i+1]==='number'&&typeof a[i+2]==='number')return{lon:a[i],lat:a[i+1],angleDegPerMa:a[i+2]};}throw new Error(`No Euler rotation for plate ${pid}`)}
export function featurePid(f){const p=f?.properties||{};return Number(p.plateId??p.PLATEID1??p.reconstructionPlateId??p.pid??p.PlateID??0)}
