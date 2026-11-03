'use strict';
const assert=require('node:assert/strict');
module.exports=function packedPalletDriver(native,f,workflow,built){
 const record=workflow.alias('E07'),v=record.components.vehicle,api=f.runtime.vehicleRuntime,d=require('./practice-manual-driver.cjs')(native,f,record),THREE=native.THREE;
 api.command(record,'parkingBrake',false);const source=workflow.alias(built.manifest.practiceId==='CEDI-04'?'E04':'E03'),origin=source.object.position,aisle=Math.min(built.manifest.facility.bounds.maxZ-2.5,origin.z+4),delivered=[];
 function transfer({assembly,index}){
  const receiver=f.runtime.records.get(built.receiverIds[index]),target=receiver.object.position;assert(receiver);
  if(process.env.PRACTICE_DRIVER_DEBUG)console.log('packed-pickup',index,record.object.position.toArray(),assembly.object.getWorldPosition(new THREE.Vector3()).toArray());
  d.dock('pickup',source.id,{x:origin.x,z:origin.z+3.5});assert.equal(v.entry.product,assembly);
  const current=api.rig(record).forks.getWorldPosition(new THREE.Vector3()).y,max=v.config.forkBaseHeight+v.config.maxLift-.005;d.lift(Math.min(current+.035,max));d.straight('z',aisle,true);d.lift(Math.min(.3,max));
  const left=target.x<record.object.position.x,r=d.turn(left?-1:1,true);
  d.straight('x',target.x+(left?-1:1)*(r+v.config.wheelbase/2),true);d.turn(left?1:-1,false);
  const approach=target.z+3.5;d.straight('z',approach,approach>record.object.position.z);d.dock('drop',receiver.id,{x:target.x,z:approach});
  assert(!v.entry);assert.equal(assembly.sourceEntry.ownerId,receiver.id);assert(receiver.components.palletQueue.queue.includes(assembly.sourceEntry));
  d.straight('z',approach,true);delivered.push({palletId:assembly.sourceEntry.id,destinationId:receiver.id,units:assembly.sourceEntry.units,driving:d.stats()});
  if(index+1<built.receiverIds.length){
   d.straight('z',aisle,aisle>record.object.position.z);const returnLeft=origin.x<record.object.position.x,r2=d.turn(returnLeft?-1:1,true);d.straight('x',origin.x+(returnLeft?-1:1)*(r2+v.config.wheelbase/2),true);d.turn(returnLeft?1:-1,false);d.straight('z',origin.z+3.5,origin.z+3.5>record.object.position.z);
  }
 }
 return{transfer,record,stats:()=>({delivered,driving:d.stats()})};
};
