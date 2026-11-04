import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),native=require('../support/load-practice-scenes.cjs')(),{diagnostics,boundedDriver,arrangement,prepare,cleanup,heldChecks}=require('../support/cedi-dock-operator.cjs')(native);

test('CEDI-01 really picks the first pallet through the front receiving dock without lifting the truck or drifting its fork support',{timeout:60000},()=>{
 const {f,built,workflow}=arrangement('CEDI-01');try{
  prepare(workflow,built);const record=f.runtime.records.get(built.vehicleIds[0]),vehicle=record.components.vehicle,api=f.runtime.vehicleRuntime,driver=boundedDriver(f,record),originalIds=[...f.runtime.products.values()].map(row=>row.record.id);
  assert(Math.abs(record.object.position.x+22)<.01);assert.equal(driver.yaw(),0);assert(Math.abs(record.object.position.y)<.001);
  const truck=workflow.alias('E01');assert(Math.abs(truck.object.position.y+1.147)<.001);assert.equal(built.tasks[0].pickupRoute[0].z,19);
  api.command(record,'parkingBrake',false);driver.dock('pickup',built.tasks[0].sourceId,{x:-22,z:19,yaw:0});heldChecks(f,built,workflow,record);
  driver.lift(.3);const floorY=record.object.position.y,forkY=api.rig(record).forks.getWorldPosition(new native.THREE.Vector3()).y;
  for(let n=0;n<60;n++)driver.tick({brake:1});assert(Math.abs(record.object.position.y-floorY)<.003);assert(Math.abs(api.rig(record).forks.getWorldPosition(new native.THREE.Vector3()).y-forkY)<.003);
  driver.straight('z',18,true);assert(Math.abs(record.object.position.y)<.02);assert.equal(driver.stats().contacts,0);assert.deepEqual([...f.runtime.products.values()].map(row=>row.record.id),originalIds);assert.equal(workflow.snapshot().sourceUnits,40);
 }catch(error){error.message+=' · '+diagnostics(f,f.runtime.records.get(built.vehicleIds[0]));throw error;}finally{cleanup(f,workflow);}
});
