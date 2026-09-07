const API='https://gws.gplates.org';
export const MODEL='MULLER2022';
const cache=new Map();
async function get(path,params){const u=new URL(API+path);for(const[k,v]of Object.entries(params))u.searchParams.set(k,String(v));const key=u.toString();if(cache.has(key))return cache.get(key);const p=fetch(key).then(async r=>{if(!r.ok)throw new Error(`GPlates HTTP ${r.status}`);return r.json()});cache.set(key,p);return p}
export async function staticPolygons(timeMa){return get('/reconstruct/static_polygons/',{time:timeMa,model:MODEL})}
export async function coastlines(timeMa){return get('/reconstruct/coastlines/',{time:timeMa,model:MODEL,wrap:true})}
export async function assignPlateIds(lats,lons){return get('/reconstruct/assign_points_plate_ids',{lats:lats.join(','),lons:lons.join(','),model:MODEL})}
export async function reconstructPoints(lats,lons,timeMa){return get('/reconstruct/reconstruct_points/',{lats:lats.join(','),lons:lons.join(','),time:timeMa,model:MODEL,return_null_points:true,fc:true})}
export async function eulerPoleAt(timeMa,pids){return get('/rotation/get_euler_pole_and_angle',{times:timeMa,pids:pids.join(','),model:MODEL})}
export async function currentEulerPerMa(pids){
  const result={};
  for(const pid of pids){
    const a=await eulerPoleAt(1,[pid]);
    let triplet=null;
    const walk=x=>{if(triplet||x==null)return;if(Array.isArray(x)){if(x.length>=3&&x.every(n=>typeof n==='number'))triplet=x;else x.forEach(walk)}else if(typeof x==='object')Object.values(x).forEach(walk)};
    walk(a);
    if(triplet)result[pid]={lon:triplet[0],lat:triplet[1],angleDegPerMa:triplet[2]};
  }
  return result;
}
export function featurePid(feature){const p=feature?.properties||{};return Number(p.plateId??p.PLATEID1??p.reconstructionPlateId??p.reconstruction_plate_id??p.pid??p.PlateID??0)}
