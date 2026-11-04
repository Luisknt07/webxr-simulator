import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),native=require('../support/load-practice-scenes.cjs')(),{diagnostics,boundedDriver,arrangement,prepare,cleanup,heldChecks}=require('../support/cedi-dock-operator.cjs')(native);

// This is the single full CEDI-05 native transport regression for the shared U facility.
test('CEDI-05 loads both original pallets deepest-first through the front dock and completes dispatch with real steering and hydraulics',{timeout:120000},()=>{
 const {f,built,workflow}=arrangement('CEDI-05');try{
  const originalIds=built.productIds.slice(),delivered=[];assert.deepEqual(workflow.snapshot().criticalReasons,[]);assert.throws(()=>workflow.command('material-close',{quantity:12}));prepare(workflow,built);const record=f.runtime.records.get(built.vehicleIds[0]),api=f.runtime.vehicleRuntime,driver=boundedDriver(f,record),vehicle=record.components.vehicle,forwardSide=vehicle.config.wheelbase/Math.tan(vehicle.config.steerLimit*.8)+vehicle.config.wheelbase/2;
  const targets=built.tasks.map(task=>f.runtime.records.get(task.destinationId).object.position);assert(targets[0].z>targets[1].z,'Load the far truck seat before the near seat so the first pallet cannot obstruct the next.');
  assert.equal(driver.yaw(),0);assert(Math.abs(record.object.position.y)<.001);api.command(record,'parkingBrake',false);
  for(let index=0;index<2;index++){
   const task=built.tasks[index],source=f.runtime.records.get(task.sourceId).object,approach=task.pickupRoute[0],target=targets[index];
   assert(approach.z<source.position.z,'A forward +Z approach starts before the staging pallet.');driver.dock('pickup',task.sourceId,{...approach,yaw:0});heldChecks(f,built,workflow,record,index);driver.lift(.3);
   const y=record.object.position.y;for(let n=0;n<60;n++)driver.tick({brake:1});assert(Math.abs(record.object.position.y-y)<.003);
   // Withdraw clear of staging, then steer the actual rear-steered chassis
   // through an S manoeuvre in the open dispatch aisle.
   driver.straight('z',12.2,true);driver.turn(-1);driver.straight('x',target.x+forwardSide,target.x+forwardSide>record.object.position.x);driver.turn(1);driver.straight('z',target.z-3.5);
   driver.dock('drop',task.destinationId,{x:target.x,z:target.z-3.5,yaw:0});assert.equal(Boolean(vehicle.entry),false);assert.equal(workflow.product(built.productIds[index]).sourceEntry.ownerId,task.destinationId);
   driver.straight('z',18,true);const product=workflow.product(built.productIds[index]);assert(f.runtime.records.get(task.destinationId).components.palletQueue.queue.includes(product.sourceEntry));delivered.push({productId:built.productIds[index],destinationId:task.destinationId,position:product.object.getWorldPosition(new native.THREE.Vector3()).toArray(),units:6});assert.equal(driver.stats().contacts,0);assert.equal(workflow.snapshot().receiverUnits,(index+1)*6);assert.equal(workflow.snapshot().totalUnits,12);assert(Math.abs(record.object.position.y)<.02);
   if(index===0){
    const next=built.tasks[1].pickupRoute[0];driver.lift(.3);driver.straight('z',11,true);driver.turn(1);driver.straight('x',22.5);driver.turn(-1,true);driver.straight('z',8.75,true);driver.turn(-1);driver.straight('x',next.x+forwardSide,true);driver.turn(1);driver.straight('z',next.z,next.z<record.object.position.z);
   }
  }
  workflow.command('material-inspect',{quantity:12,quality:'conforme'});workflow.command('material-close',{quantity:12});const result=workflow.snapshot();
  assert.deepEqual(result.criticalReasons,[]);assert.equal(result.sourceUnits,0);assert.equal(result.receiverUnits,12);assert.equal(result.destinationConfirmed,true);assert.equal(f.runtime.products.size,2);assert.equal(vehicle.training.completed.length,2);assert.deepEqual(result.materialBalance.actual,{box:12});assert.deepEqual([...f.runtime.products.values()].map(p=>p.record.id).sort(),originalIds.slice().sort());assert.deepEqual(result.stageEvidence.map(row=>row.guard),['identify','prepare','operate','inspect','deliver','close']);
  fs.mkdirSync(new URL('../../data/qa-studio/practice-facilities/',import.meta.url),{recursive:true});fs.writeFileSync(new URL('../../data/qa-studio/practice-facilities/dispatch-native.json',import.meta.url),JSON.stringify({passed:true,practiceId:'CEDI-05',layoutId:built.manifest.facility.layoutId,mode:'manual',simulationSeconds:f.runtime.time,driving:driver.stats(),delivered,snapshot:result},null,2));
 }catch(error){error.message+=' · '+diagnostics(f,f.runtime.records.get(built.vehicleIds[0]));throw error;}finally{cleanup(f,workflow);}
});
