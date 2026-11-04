import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);

test('CEDI-02 transfers its first original pallet through the real shared U aisles into its reserved rack cell without completing the other five',{timeout:180000},()=>{
 const native=require('../support/load-practice-scenes.cjs')(),f=native.fixture();let workflow;
 try{
  const built=native.buildConfigurablePracticeScene(f.document,'hall','CEDI-02',{scene:f.scene});f.runtime.start('hall');native.advance(f,.1);workflow=new native.ConfigurablePracticeRuntime({simulation:f.runtime,document:f.document},built.manifest);
  workflow.command('material-order',{orderId:built.materialRecipe.orderId,quantity:48});workflow.command('material-prepare',{method:'ruta-y-capacidad-verificadas'});
  for(const task of built.tasks.slice(0,6)){const rack=f.runtime.records.get(task.destinationId),cell=f.runtime.palletQueueRuntime.locations(rack).find(row=>row.index===task.destinationSlot);workflow.command('assign-stock-location',{palletId:task.productId,locationCode:cell.code});}
  const task=built.tasks[0],record=f.runtime.records.get(built.vehicleIds[0]),v=record.components.vehicle,api=f.runtime.vehicleRuntime,driver=require('../support/practice-manual-driver.cjs')(native,f,record),approach=task.pickupRoute[0],aisles=built.manifest.facility.sharedLayout.aisles.safePolyline,aisleX=aisles[1][0],crossZ=aisles[2][2];
  api.command(record,'parkingBrake',false);driver.dock('pickup',task.sourceId,approach);assert.equal(v.entry.product.record.id,task.productId);driver.lift(.32);
  driver.straight('z',Math.min(built.manifest.facility.bounds.maxZ-3,approach.z+3.35),true);
  // Measure the real rear-steered quarter-turn displacement. Rotationally
  // equivalent turns then align with the authored U aisle and native rack cell;
  // no carrier or pallet pose, queue, completion or custody field is assigned.
  const before=record.object.getWorldPosition(new native.THREE.Vector3());driver.turn(-1);const turn=record.object.getWorldPosition(new native.THREE.Vector3()).sub(before),sideShift=Math.abs(turn.z);
  driver.straight('x',aisleX-sideShift);driver.turn(1);driver.straight('z',crossZ);driver.turn(1);
  const destination=f.runtime.vehicleTraining.destination(record),target=new native.THREE.Vector3().setFromMatrixPosition(destination.matrix);driver.straight('x',target.x+sideShift);driver.turn(-1);const rackApproach=target.z+3.5;driver.straight('z',rackApproach,rackApproach>record.object.position.z);
  driver.dock('drop',task.destinationId,{x:target.x,z:rackApproach,yaw:Math.PI});workflow.update();const product=workflow.product(task.productId),rack=f.runtime.records.get(task.destinationId),world=workflow.snapshot();
  assert.equal(v.entry,null);assert.equal(product.sourceEntry.ownerId,rack.id);assert(rack.components.palletQueue.queue.includes(product.sourceEntry));assert.equal(f.runtime.palletQueueRuntime.locations(rack).find(row=>row.index===task.destinationSlot).palletId,task.productId);
  assert.equal(world.sourceUnits,40);assert.equal(world.processedUnits,8);assert.equal(world.totalUnits,48);assert.equal(world.finalizedUnits,0);assert.deepEqual(world.criticalReasons,[]);assert.deepEqual(world.materialBalance.actual,{box:48});assert.equal(f.runtime.products.size,6);assert.equal(driver.stats().contacts,0);assert.deepEqual(world.stageEvidence.map(row=>row.guard),['identify','prepare']);assert.throws(()=>workflow.command('material-close',{quantity:48}),/entrega|concili/i);
  const directory=new URL('../../data/qa-studio/practice-facilities/',import.meta.url);fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(new URL('cedi-02-unified-first-putaway-native.json',directory),JSON.stringify({passed:true,scope:'one of six putaway pallets; replenishment and full completion are not asserted',practiceId:'CEDI-02',physicalProductId:task.productId,destinationId:task.destinationId,position:product.object.getWorldPosition(new native.THREE.Vector3()).toArray(),world,driving:driver.stats()},null,2));
 }finally{if(workflow)workflow.dispose();if(f.runtime.active)f.runtime.stop();native.releaseGeometry(f);}
});
