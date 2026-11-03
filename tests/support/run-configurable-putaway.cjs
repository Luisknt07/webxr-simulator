'use strict';
module.exports=function runPutaway(h,f,built,onProgress=()=>{}){
 const record=f.runtime.records.get(built.vehicleIds[0]),v=record.components.vehicle,api=f.runtime.vehicleRuntime,w=new h.ConfigurablePracticeRuntime({simulation:f.runtime,document:f.document},built.manifest),d=require('./practice-manual-driver.cjs')(h,f,record),shipments=[];
 const verify=()=>{w.update();const world=w.snapshot();if(world.criticalReasons.length)throw Error(world.criticalReasons.join(' '));return world;};
 w.command('material-order',{orderId:built.materialRecipe.orderId,quantity:48});w.command('material-prepare',{method:'ruta-y-capacidad-verificadas'});
 for(const task of built.tasks.slice(0,6)){const rack=f.runtime.records.get(task.destinationId),cell=f.runtime.palletQueueRuntime.locations(rack).find(row=>row.index===task.destinationSlot);w.command('assign-stock-location',{palletId:task.productId,locationCode:cell.code});}
 api.command(record,'parkingBrake',false);
 const returnToInput=approach=>{const radius=d.turn(1,true);d.straight('x',approach.x+radius-v.config.wheelbase/2,true);d.turn(1,true);d.straight('z',approach.z,false);};
 const travelToRack=target=>{const radius=d.turn(1,true);d.straight('x',target.x-radius+v.config.wheelbase/2,true);d.turn(1,true);d.straight('z',target.z-3.5,false);};
 for(let i=0;i<6;i++){
  const task=built.tasks[i],approach=task.pickupRoute[0];
  if(i)returnToInput(approach);
  onProgress({stage:'pickup',index:i,position:record.object.position.toArray()});d.dock('pickup',task.sourceId,approach);verify();
  d.lift(api.rig(record).forks.getWorldPosition(new h.THREE.Vector3()).y+.1);d.straight('z',approach.z,true);d.lift(.35);
  const destination=f.runtime.vehicleTraining.destination(record),target=new h.THREE.Vector3().setFromMatrixPosition(destination.matrix);travelToRack(target);
  onProgress({stage:'drop-approach',index:i,position:record.object.position.toArray(),yaw:d.yaw(),target:target.toArray()});
  d.dock('drop',task.destinationId,{x:target.x,z:target.z-3.5,yaw:0});d.straight('z',target.z-3.5,true);verify();
  shipments.push({productId:task.productId,destinationId:task.destinationId,world:verify()});onProgress({stage:'delivered',index:i,driving:d.stats()});
 }
 w.command('material-inspect',{quantity:48,quality:'conforme'});
 const refill=built.tasks[6],first=built.tasks[0],source=f.runtime.records.get(refill.sourceId),product=w.product(refill.productId),rackTarget=product.object.getWorldPosition(new h.THREE.Vector3());returnToInput(first.pickupRoute[0]);travelToRack(rackTarget);
 d.dock('pickup',source.id,{x:rackTarget.x,z:rackTarget.z-3.5,yaw:0});d.lift(api.rig(record).forks.getWorldPosition(new h.THREE.Vector3()).y+.1);d.straight('z',-2,true);d.lift(.35);
 const destination=f.runtime.vehicleTraining.destination(record),target=new h.THREE.Vector3().setFromMatrixPosition(destination.matrix),radius=d.turn(1,false);d.straight('x',target.x-radius-v.config.wheelbase/2,false);d.turn(-1,false);d.straight('z',target.z-3.5,target.z-3.5<record.object.position.z);
 d.dock('drop',refill.destinationId,{x:target.x,z:target.z-3.5,yaw:0});d.straight('z',target.z-3.5,true);verify();w.command('material-close',{quantity:48});
 return{w,shipments,world:verify(),driving:d.stats()};
};
