'use strict';
// Metres in the actual public cell. R1/R2/R3 are manual travel/approach
// corridors; the live fork guide still determines the final pallet alignment.
const HOME=Object.freeze({position:Object.freeze([12.4,0,2.4]),yaw:Math.PI});
const LANES=Object.freeze([[7.0,-1.65,14.1,1.65],[3.9,-4.6,14.1,-1.25],[10.75,-4.6,14.05,3.75],[7.1,.75,14.1,3.75]].map(Object.freeze));
const ROUTES=Object.freeze([
 {id:'R1',name:'Recogida',points:[[12.4,2.4],[12.4,0],[9.2,0],[8.4,0]]},
 {id:'R2',name:'Almacén A01',points:[[12.4,0],[12.4,-2.8],[8,-2.8]]},
 {id:'R3',name:'Despacho',points:[[8.4,0],[9.2,0],[12.4,0],[12.4,2],[9.4,2]]}
].map(route=>Object.freeze({...route,points:Object.freeze(route.points.map(Object.freeze))})));
function markings(){return{
 vehicleLanes:LANES.map(row=>row.slice()),
 vehicleArrows:[[10.4,-.8,Math.PI/2],[9,-.8,Math.PI/2],[9,.8,-Math.PI/2],[10.4,.8,-Math.PI/2],
  [10,-3.65,Math.PI/2],[6.8,-3.65,Math.PI/2],[6.8,-2.15,-Math.PI/2],[10,-2.15,-Math.PI/2],
  [13.1,-2.7,0],[11.8,-2.7,Math.PI],[13.1,2.5,0],[11.8,2.5,Math.PI],
  [9.3,1.45,Math.PI/2],[9.3,3,-Math.PI/2]],
 vehicleStops:[[8,-1.15,8.12,1.15],[5.2,-4.6,7.7,-4.48],[8.3,-4.6,10.8,-4.48],[7.8,3.45,10.7,3.57]]
};}
function waypoints(sourceId,outputId){
 const [hx,,hz]=HOME.position,yaw=HOME.yaw,local=([x,z],extra={})=>({x:Math.round(((x-hx)*Math.cos(yaw)-(z-hz)*Math.sin(yaw))*1e6)/1e6,z:Math.round(((x-hx)*Math.sin(yaw)+(z-hz)*Math.cos(yaw))*1e6)/1e6,...extra});
 const pickup=ROUTES.find(r=>r.id==='R1').points,drop=ROUTES.find(r=>r.id==='R3').points;
 return JSON.stringify(pickup.map((p,i)=>local(p,i===pickup.length-1?{action:'pickup',targetId:sourceId}:{action:'drive'})).concat(drop.slice(1).map((p,i)=>local(p,i===drop.length-2?{action:'drop',targetId:outputId}:{action:'drive',reverse:i<2}))));
}
module.exports={HOME,LANES,ROUTES,markings,waypoints};
