import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),native=require('../support/load-practice-scenes.cjs')(),manualDriver=require('../support/practice-manual-driver.cjs');
test('CEDI-05 physically loads both original six-box pallets on the parked truck before dispatch closure',()=>{
 const f=native.fixture();let workflow;
 try{
  const built=native.buildConfigurablePracticeScene(f.document,'hall','CEDI-05',{mode:'manual',scene:f.scene});f.runtime.start('hall');native.advance(f,.1);workflow=new native.ConfigurablePracticeRuntime({simulation:f.runtime,document:f.document},built.manifest);
  const originalIds=built.productIds.slice();assert.deepEqual(workflow.snapshot().criticalReasons,[]);assert.throws(()=>workflow.command('material-close',{quantity:12}));
  workflow.command('material-order',{orderId:built.manifest.materialRecipe.orderId,quantity:12});workflow.command('material-prepare',{method:'ruta-y-capacidad-verificadas'});workflow.command('secure-material-dock',{secured:'calzos-borde-y-acceso-verificados'});
  const vehicle=f.runtime.records.get(built.vehicleIds[0]),driver=manualDriver(native,f,vehicle),api=f.runtime.vehicleRuntime,v=vehicle.components.vehicle,c=v.config,arcRadius=c.wheelbase/Math.tan(c.steerLimit*.8),reverseSide=arcRadius-c.wheelbase/2+.012;
  api.command(vehicle,'parkingBrake',false);const delivered=[];
  for(let index=0;index<2;index++){
   const task=built.tasks[index],target=f.runtime.records.get(task.destinationId).object.position;
   driver.dock('pickup',task.sourceId,task.pickupRoute[0]);assert.equal(v.entry.product.record.id,originalIds[index]);driver.lift(.25);
   // Withdraw before turning clear of the neighbouring pallet, reverse along
   // the north aisle, then turn in the central open bay. The east crossing is
   // beside the physical dock and truck mirrors, never over the raised deck.
   driver.straight('z',9.2,true);driver.turn(1);driver.straight('x',4,true);driver.turn(-1);driver.straight('z',1.4);driver.turn(-1,true);
   driver.straight('x',target.x+reverseSide);driver.lift(1.3);driver.turn(1,true);driver.straight('z',target.z+3.5);
   driver.dock('drop',task.destinationId,{x:target.x,z:target.z+3.5});assert.equal(v.entry,null);
   const product=workflow.product(originalIds[index]);assert.equal(product.sourceEntry.ownerId,task.destinationId);assert(f.runtime.records.get(task.destinationId).components.palletQueue.queue.includes(product.sourceEntry));
   driver.straight('z',5.1723,true);driver.lift(.3);delivered.push({productId:originalIds[index],destinationId:task.destinationId,position:product.object.getWorldPosition(new native.THREE.Vector3()).toArray(),units:6});
   assert.deepEqual(workflow.snapshot().criticalReasons,[]);
   if(index===0){
    // Empty forks return through the same aperture. Quarter turns use the
    // actual rear-steered chassis; no actor or load transform is assigned.
    driver.turn(1);driver.straight('x',1.3);driver.turn(1,true);driver.straight('z',6.4649);driver.turn(-1);driver.straight('x',-7.3+arcRadius+c.wheelbase/2);driver.turn(-1);
   }
  }
  workflow.command('material-inspect',{quantity:12,quality:'conforme'});workflow.command('material-close',{quantity:12});const result=workflow.snapshot();
  assert.deepEqual(result.criticalReasons,[]);assert.equal(result.sourceUnits,0);assert.equal(result.receiverUnits,12);assert.equal(result.totalUnits,12);assert.equal(result.destinationConfirmed,true);assert.deepEqual(result.stageEvidence.map(row=>row.guard),['identify','prepare','operate','inspect','deliver','close']);assert.deepEqual(result.materialBalance.actual,{box:12});assert.equal(v.training.completed.length,2);assert.equal(driver.stats().contacts,0);assert.equal(f.runtime.products.size,2);assert.deepEqual([...f.runtime.products.values()].map(p=>p.record.id).sort(),originalIds.sort());
  fs.mkdirSync(new URL('../../data/qa-studio/practice-facilities/',import.meta.url),{recursive:true});fs.writeFileSync(new URL('../../data/qa-studio/practice-facilities/dispatch-native.json',import.meta.url),JSON.stringify({passed:true,practiceId:'CEDI-05',mode:'manual',simulationSeconds:f.runtime.time,driving:driver.stats(),delivered,snapshot:result},null,2));
 }finally{if(workflow)workflow.dispose();if(f.runtime.active)f.runtime.stop();native.releaseGeometry(f);}
});
