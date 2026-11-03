'use strict';
// An operator drives the real SF-01 forklift and actuates its forks. This helper
// never writes actor transforms, joint poses, inventory membership or cargo IDs.
module.exports=function runRawReceiving(h,f,built,onProgress=()=>{}){
 const record=f.runtime.records.get(built.vehicleIds[0]),v=record.components.vehicle,api=f.runtime.vehicleRuntime,w=new h.ConfigurablePracticeRuntime({simulation:f.runtime,document:f.document},built.manifest),d=require('./practice-manual-driver.cjs')(h,f,record),shipments=[];
 const verify=()=>{w.update();const world=w.snapshot();if(world.criticalReasons.length)throw Error(world.criticalReasons.join(' '));if(world.totalUnits!==12)throw Error('The native multi-reference material total changed.');return world;};
 if(process.env.PRACTICE_DRIVER_DEBUG){
  const drive=api.drive.bind(api);api.drive=(r,delta,input)=>{const prior=r.components.vehicle.blocked;const result=drive(r,delta,input);if(r.components.vehicle.blocked&&!prior)console.log('NATIVE DRIVE BLOCKED',r.object.position.toArray(),input,r.components.vehicle.pose);return result;};
  const apply=api.applyPose.bind(api);api.applyPose=(r,pose,check)=>{const result=apply(r,pose,check);if(check&&!result)console.log('NATIVE POSE REFUSED',r.object.position.toArray(),pose);return result;};
 }
 w.command('material-order',{orderId:built.materialRecipe.orderId,quantity:12});
 w.command('material-prepare',{method:'ruta-y-capacidad-verificadas'});api.command(record,'parkingBrake',false);
 for(let i=0;i<2;i++){
  const task=built.tasks[i],approach=task.pickupRoute[0];
  if(i){
   // Withdraw from the actual rack face before turning. Use the clear central
   // corridor; a direct line through Z5 would cross the quarantine equipment.
   d.straight('z',.3,true);const radius=d.turn(1,false);
   d.straight('x',approach.x+radius-v.config.wheelbase/2,true);d.turn(1,true);
   d.straight('z',approach.z,approach.z>record.object.position.z);
  }
  onProgress({stage:'pickup-approach',pallet:i+1,position:record.object.position.toArray()});
  d.dock('pickup',task.sourceId,approach);verify();onProgress({stage:'picked-up',pallet:i+1,driving:d.stats()});
  d.lift(api.rig(record).forks.getWorldPosition(new h.THREE.Vector3()).y+.08);
  d.straight('z',approach.z,true);d.lift(.35);onProgress({stage:'withdrawn',pallet:i+1,driving:d.stats()});
  const radius=d.turn(1,true);d.straight('x',-7,true);d.turn(1,true);
  d.straight('z',2.5,true);d.turn(-1,true);
  const destination=f.runtime.vehicleTraining.destination(record),goal=api.dropDock(record,{position:new h.THREE.Vector3(),yaw:0},destination);
  d.straight('x',goal.position.x-radius+v.config.wheelbase/2,true);d.turn(1,true);
  // Finish transport at low height, stop in the clear aisle and raise to the
  // actual assigned level before entering an already occupied lower rack bay.
  d.lift(goal.toolY);
  d.straight('z',goal.position.z-.8,false);onProgress({stage:'rack-approach',pallet:i+1,driving:d.stats()});
  d.dock('drop',task.destinationId,{x:goal.position.x,z:goal.position.z-.8,yaw:0});
  const world=verify(),product=world.pallets.find(row=>row.id===task.productId);
  if(!product||!product.inReleased||product.held||product.ownerId!==task.destinationId)throw Error('The same multi-reference pallet did not reach its native rack.');
  if(world.receiverUnits!==(i+1)*6)throw Error('The raw-receiving counter differs from real custody.');
  shipments.push({palletId:task.productId,sourceId:task.sourceId,destinationId:task.destinationId,slot:task.destinationSlot,materials:product.materials,massKg:product.massKg,position:product.position,simulationSeconds:f.runtime.time,driving:d.stats()});
  onProgress({stage:'delivered',pallet:i+1,receiverUnits:world.receiverUnits,position:record.object.position.toArray(),driving:d.stats()});
 }
 w.command('material-inspect',{quantity:12,quality:'conforme'});
 w.command('register-material-lot',{orderId:built.materialRecipe.orderId,lotId:'LOT-SF-01-001'});
 w.command('material-close',{quantity:12});
 return{workflow:w,world:verify(),shipments,driving:d.stats()};
};
