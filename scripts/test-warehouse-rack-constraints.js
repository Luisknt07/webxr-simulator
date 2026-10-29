'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture,offer,cell,THREE,h,schema}=require('./test-warehouse-rack-runtime');
const source=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8').replace(/^\uFEFF/,'').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const prefabs=new Function('THREE','behaviorSchema','require',source('src/editor/IndustrialPrefabs.js')+'\nreturn {createProductVisual,createSourceProductVisual};')(THREE,schema,require('./load-robot-prefabs')(THREE).resolve);
const {captureSimulation,restoreSimulation}=new Function('THREE','createProductVisual','createSourceProductVisual',source('src/studio/SimulationCheckpoint.js')+'\nreturn {captureSimulation,restoreSimulation};')(THREE,prefabs.createProductVisual,prefabs.createSourceProductVisual);
function state(f){
  f.scene.updateMatrixWorld(true);const c=f.runtime.records.get(f.rack.userData.editorId).components.palletQueue,r=c.rack;
  return {time:f.runtime.time,banks:r.banks.map(n=>n.position.toArray()),carriage:r.carriage&&r.carriage.position.toArray(),carts:r.carts.map(n=>n&&n.position.toArray()),
    queues:c.queue.map(e=>[e.id,e.units,e.ownerId,e.product.item.palletIndex]),products:c.items.map(i=>[i.product.sourceEntry.id,i.product.object.matrixWorld.toArray()]),
    jobs:r.jobs.map(j=>[j.item.product.sourceEntry.id,j.targetIndex,j.kind,j.path.map(m=>m.toArray())]),open:r.openAisle,presented:r.presentedSlot};
}
function roundtrip(f,seconds=.2){
  const saved=JSON.parse(JSON.stringify(captureSimulation(f.runtime))),before=state(f);h.advance(f,seconds);const uninterrupted=state(f);
  restoreSimulation(f.runtime,saved);f.rackRecord=f.runtime.records.get(f.rack.userData.editorId);f.stock=f.rackRecord.components.palletQueue;
  assert.deepEqual(state(f),before,'Checkpoint must restore nested rack mechanisms together with the actual stored loads.');
  h.advance(f,seconds);assert.deepEqual(state(f),uninterrupted,'Resumed mechanism movement must match uninterrupted execution.');
  return saved;
}
const cases={
  access(){
    const f=fixture('double-deep'),api=f.runtime.palletQueueRuntime,rear=offer(f),front=offer(f);assert(rear&&front);
    assert.equal(cell(f,rear.product).depthIndex,1);assert.equal(api.canPickup(rear.product),false);assert.equal(api.canPickup(front.product),true);
    const object=new THREE.Group();object.position.set(0,0,4);f.scene.add(object);const actor={object,components:{vehicle:{config:{forkLength:.8},pose:{reach:0}}}};
    api.picked(front.product);assert(api.canPickup(rear.product));assert.equal(api.rackAccess(f.rackRecord,rear.product,actor),false,'Normal forks cannot acquire the rear double-deep load.');
    actor.components.vehicle.pose.reach=2;assert(api.rackAccess(f.rackRecord,rear.product,actor));object.position.z=-4;assert.equal(api.rackAccess(f.rackRecord,rear.product,actor),false,'A front-only rack is not accessible through its rear.');
    f.runtime.stop();console.log('Rack constraints: blocked rear load, required reach and access face passed.');
  },
  staging(){
    const f=fixture('selective',{rackLevels:2}),api=f.runtime.palletQueueRuntime,entry=offer(f);assert(entry);const next=f.runtime.sourceRuntime.materialize(f.sourceRecord);
    assert(api.rackPlacement(f.rackRecord,next),'A physically served upper location remains available.');
    assert.equal(api.rackPlacement(f.rackRecord,next,[],undefined,undefined,true),null,'A connected conveyor cannot teleport an incoming pallet to the upper tier.');
    f.runtime.stop();console.log('Rack constraints: conveyor staging remains restricted to its real reachable support.');
  },
  mobile(){
    const f=fixture('mobile',{rackBanks:2}),api=f.runtime.palletQueueRuntime,entry=offer(f);assert(entry);
    const camera=new THREE.PerspectiveCamera();camera.position.set(0,1.65,-1);f.scene.add(camera);f.ctx.camera=camera;f.ctx.vrMode=true;f.scene.updateMatrixWorld(true);
    const before=f.stock.rack.banks.map(n=>n.position.toArray());assert(api.rackRequestAisle(f.rackRecord,1));h.advance(f,.1);
    assert.deepEqual(f.stock.rack.banks.map(n=>n.position.toArray()),before,'Occupancy locks the complete aisle before any bank begins moving.');assert(f.stock.emergency);
    camera.position.z=10;h.advance(f,.1);assert.deepEqual(f.stock.rack.banks.map(n=>n.position.toArray()),before,'Leaving the aisle alone does not reset the emergency.');
    f.runtime.command(f.rack.userData.editorId,'resetEmergency');f.runtime.command(f.rack.userData.editorId,'start');h.advance(f,.1);assert.notDeepEqual(f.stock.rack.banks.map(n=>n.position.toArray()),before);
    entry.product.robotReservedBy='constraint-reservation';const held=f.stock.rack.banks.map(n=>n.position.toArray());h.advance(f,.1);assert.deepEqual(f.stock.rack.banks.map(n=>n.position.toArray()),held,'A reserved rack load cannot move away from its handler.');delete entry.product.robotReservedBy;
    f.runtime.stop();console.log('Rack constraints: whole-aisle occupancy, deliberate rearm and reserved-load interlock passed.');
  },
  checkpoint_static(){const f=fixture('selective');assert(offer(f));roundtrip(f);f.runtime.stop();console.log('Rack constraints: static storage checkpoint preserves identity, inventory and position.');},
  checkpoint_mobile(){
    const f=fixture('mobile',{rackBanks:2}),api=f.runtime.palletQueueRuntime;assert(offer(f));const before=f.stock.rack.banks[0].position.z;assert(api.rackRequestAisle(f.rackRecord,1));h.advance(f,.3);assert(f.stock.rack.banks[0].position.z>before,'The checkpoint must be taken during actual motion.');roundtrip(f,.3);f.runtime.stop();console.log('Rack constraints: mid-motion mobile checkpoint restores bank and load together.');
  },
  checkpoint_lift(){
    const f=fixture('vertical-lift',{rackLevels:3}),entry=offer(f);assert(entry);h.advance(f,.2);assert(f.stock.rack.jobs.length,'Save during the actual internal route.');roundtrip(f,.2);f.runtime.stop();console.log('Rack constraints: mid-route vertical extractor checkpoint preserves carriage and cargo.');
  },
  gravity_identity(){
    const f=fixture('pallet-flow',{rackDepthSlots:3}),first=offer(f);assert(first);const firstMesh=first.product.object,units=first.units,mass=f.runtime.productMetadata(first.product).mass;
    h.advance(f,20);assert.equal(cell(f,first.product).depthIndex,0);const second=offer(f);assert(second);const secondMesh=second.product.object;h.advance(f,20);
    assert.equal(cell(f,second.product).depthIndex,1);assert.equal(f.stock.queue[0],first);assert.equal(f.stock.queue[1],second);assert.equal(first.product.object,firstMesh);assert.equal(second.product.object,secondMesh);
    assert.equal(first.units,units);assert.equal(f.runtime.productMetadata(first.product).mass,mass);assert(f.runtime.palletQueueRuntime.canPickup(first.product));assert(!f.runtime.palletQueueRuntime.canPickup(second.product));
    assert(!first.product.item.box.clone().expandByScalar(-.001).intersectsBox(second.product.item.box));f.runtime.stop();console.log('Rack constraints: gravity advances the same two pallets and enforces physical FIFO without duplication or overlap.');
  },
  pushback_identity(){
    const f=fixture('push-back',{rackDepthSlots:3}),api=f.runtime.palletQueueRuntime,first=offer(f);assert(first);const firstMesh=first.product.object;
    assert(api.rackPrepareInput(f.rackRecord));h.advance(f,20);assert.equal(cell(f,first.product).depthIndex,1);const second=offer(f);assert(second);const secondMesh=second.product.object;
    assert(api.rackPrepareInput(f.rackRecord));h.advance(f,20);assert.equal(cell(f,first.product).depthIndex,2);assert.equal(cell(f,second.product).depthIndex,1);const third=offer(f);assert(third);h.advance(f,.1);
    assert.equal(f.stock.queue[0],third);assert.equal(f.stock.queue[1],second);assert.equal(f.stock.queue[2],first);assert.equal(first.product.object,firstMesh);assert.equal(second.product.object,secondMesh);assert.equal(f.stock.receivedUnits,first.units+second.units+third.units);
    assert(api.canPickup(third.product));assert(!api.canPickup(second.product));assert(!api.canPickup(first.product));assert.equal(f.stock.items.length,3);f.runtime.stop();console.log('Rack constraints: push-back moves existing entries backwards and keeps physical LIFO/custody across three loads.');
  },
  miniload_window(){
    const f=fixture('miniload',{rackBays:2,rackLevels:2}),api=f.runtime.palletQueueRuntime,entries=[];
    for(let i=0;i<3;i++){const entry=offer(f);assert(entry);entries.push(entry);h.advance(f,20);assert(!f.stock.rack.jobs.length);}
    const selected=entries[2],selectedIndex=selected.product.item.palletIndex;assert(cell(f,selected.product).bay>0,'Exercise the miniload horizontal axis as well as its vertical extractor.');
    assert(!api.canPickup(selected.product));assert(api.rackRequestRetrieval(f.rackRecord,selectedIndex));h.advance(f,.2);assert(f.stock.rack.jobs.length);roundtrip(f,.2);h.advance(f,20);
    const restored=f.stock.queue.find(e=>e.id===selected.id);assert(restored);assert.equal(f.stock.rack.presentedSlot,selectedIndex);assert(api.canPickup(restored.product));
    const access=f.rackRecord.object.localToWorld(new THREE.Vector3().fromArray(f.stock.rack.layout.accessPosition)),box=restored.product.item.box,center=box.getCenter(new THREE.Vector3());assert(Math.abs(center.x-access.x)<1e-6);assert(Math.abs(center.z-access.z)<1e-6);assert(Math.abs(box.min.y-access.y-.005)<1e-6);
    assert.equal(f.stock.queue.length,3);assert.equal(f.stock.queue.reduce((sum,e)=>sum+e.units,0),entries.reduce((sum,e)=>sum+e.units,0));f.runtime.stop();console.log('Rack constraints: miniload selects another bay, resumes its extraction route and presents the same load at the real centered window.');
  }
};
async function run(){const selected=process.argv.slice(2);for(const name of selected.length?selected:Object.keys(cases)){assert(cases[name],'Unknown constraint case: '+name);await cases[name]();}}
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});module.exports={cases,state,roundtrip};
