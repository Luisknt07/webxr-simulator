'use strict';
// Native public cell, real warehouse stock and collision authority. Pose
// assignments below are declared test fixtures; route inspection is read-only.
const assert=require('node:assert/strict');
const {guidanceRoute,guidanceAdvisoryRoute,buildGuidanceTargets}=require('../../modules/logistica-industrial/functions/montacargas/runtime/VehicleGuidancePlanner.js');
const {authorPublicAdvisoryRoute}=require('../../tooling/assets/generate-public-scenes.js');
const traffic=require('../../projects/smarttwin/PublicDemoTraffic.cjs');
async function run(){
 const f=require('../support/public-demo-fixture.cjs')({manual:true}),{THREE:T,runtime:s,scene,ctx,document}=f,r=[...s.records.values()].find(r=>r.components.vehicle),v=r.components.vehicle,api=s.vehicleRuntime,driving={ctx,simulation:s};
 try{
  const authored=await document.serialize(),row=authored.rooms.hall.additions.find(row=>row.id===r.id),canonical=authorPublicAdvisoryRoute(authored,'hall');
  assert.equal(v.config.waypointsJson,canonical.waypointsJson);
  const snapshot=()=>JSON.stringify({matrix:r.object.matrixWorld.toArray(),distance:v.distance,received:v.received,delivered:v.delivered,routeIndex:v.routeIndex,entry:v.entry?.id,products:[...s.products.values()].map(p=>[p.object.uuid,p.vehicleOwnerId,p.sourceEntry?.ownerId]),time:s.time});
  const target={kind:'pickup',targetId:v.config.sourceId,allowed:true},before=snapshot(),pickup=guidanceRoute(driving,r,null,target);
  assert(pickup?.clear&&pickup.advisory,JSON.stringify(pickup));assert(pickup.points.length>=4);assert.equal(snapshot(),before);
  assert.equal(guidanceAdvisoryRoute(driving,r,{...target,targetId:'unrelated'}),null);
  const stock=[...s.products.values()].find(p=>s.productMetadata(p).sku==='DEMO-STOCK-01');assert(stock);assert.equal(s.productMetadata(stock).mass,33);
  const rackTarget=buildGuidanceTargets(driving,r).find(t=>t.product===stock);assert(rackTarget?.allowed&&rackTarget.dock);
  const rackRoute=guidanceRoute(driving,r,null,rackTarget);assert(rackRoute?.clear,JSON.stringify(rackRoute));
  const dock=api.pickupDock(r,{yaw:Math.PI},stock);assert(dock);r.object.position.copy(dock.position);r.object.quaternion.setFromAxisAngle(new T.Vector3(0,1,0),dock.yaw);scene.updateMatrixWorld(true);api.applyPose(r,{...v.pose,lift:Math.max(0,dock.toolY-v.originWorld.y-v.config.forkBaseHeight)},false);scene.updateMatrixWorld(true);assert(api.pickup(r,stock),v.warning);
  // Place the actually supported 33 kg pallet in the R1 withdrawal apron.
  r.object.position.set(8.6,0,0);r.object.quaternion.setFromAxisAngle(new T.Vector3(0,1,0),-Math.PI/2);scene.updateMatrixWorld(true);api.applyPose(r,{...v.pose,lift:.25},false);api.carry(r,false);scene.updateMatrixWorld(true);ctx.collisionWorld.invalidate(stock.object);
  const destination=buildGuidanceTargets(driving,r).find(t=>t.targetId===v.config.outputId);assert(destination?.allowed,destination?.reason);const held=snapshot(),drop=guidanceRoute(driving,r,null,destination);assert(drop?.clear&&drop.advisory,JSON.stringify(drop));assert(drop.points.length>=4);for(let i=0;i<3;i++)guidanceRoute(driving,r,null,destination);assert.equal(snapshot(),held,'Planning must preserve real cargo, pose, indices and custody.');
  const obstruction=new T.Mesh(new T.BoxBufferGeometry(.12,2.5,2.5),new T.MeshBasicMaterial());obstruction.position.set(10.6,1.25,0);document.getRoot(s.roomId).add(obstruction);ctx.collisionWorld.invalidate(obstruction);const blocked=guidanceRoute(driving,r,null,destination);assert(blocked?.blocked&&!blocked.clear);obstruction.parent.remove(obstruction);ctx.collisionWorld.invalidate(obstruction);obstruction.geometry.dispose();obstruction.material.dispose();
  const world=ctx.collisionWorld;ctx.collisionWorld=null;assert(!guidanceRoute(driving,r,null,destination).clear);ctx.collisionWorld=world;
  console.log(JSON.stringify({passed:true,pickup:pickup.points.map(p=>[p.x,p.z]),rack:rackRoute.points.map(p=>[p.x,p.z]),loaded:drop.points.map(p=>[p.x,p.z]),loadKg:s.productMetadata(stock).mass}));
 }finally{f.close();}
}
module.exports={run};if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
