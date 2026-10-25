'use strict';
// A finished, already-materialized processor load must wait for physical
// clearance, even when the following catalog entry has a different footprint.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {THREE, setup, add, link, record, processor, inventory, vars, phases} = require('./test-processor-runtime');
const visible = object => { for (let node = object; node; node = node.parent) if (!node.visible) return false; return true; };
function noOverlap(f) {
  const loads = [...f.runtime.products.values()].filter(product => visible(product.object)).map(product => {
    product.object.updateWorldMatrix(true, true);
    return {product, box: product.bounds.clone().applyMatrix4(product.object.matrixWorld)};
  });
  for (let a = 0; a < loads.length; a++) for (let b = a + 1; b < loads.length; b++) {
    const overlap = loads[a].box.clone().intersect(loads[b].box).getSize(new THREE.Vector3());
    assert(!(overlap.x > 1e-5 && overlap.y > 1e-5 && overlap.z > 1e-5),
      'Visible inventory intersects a live departing load: ' + JSON.stringify({time:f.runtime.time,
        a:loads[a].product.sourceEntry && loads[a].product.sourceEntry.spec.id,
        b:loads[b].product.sourceEntry && loads[b].product.sourceEntry.spec.id, overlap:overlap.toArray()}));
  }
}
function advance(f, seconds, inspect) {
  for (let time = 0; time < seconds - 1e-9; time += 1/60) {
    f.scene.updateMatrixWorld(true); f.ctx.collisionWorld.beginFrame(); f.runtime.execute(Math.min(1/60, seconds-time)); f.ctx.collisionWorld.endFrame();
    noOverlap(f); if (inspect) inspect();
  }
}
const catalog = [
  {id:'wide-case',name:'Wide box',type:'box',width:.5,height:.25,depth:.3,color:'#af8250'},
  {id:'tall-case',name:'Tall box',type:'box',width:.28,height:.5,depth:.3,color:'#7c936c'}
];
const checkpointFixture = fs.readFileSync(path.join(__dirname,'test-simulation-checkpoint.js'),'utf8');
const checkpoint = new Function('require','__dirname',checkpointFixture.slice(0,checkpointFixture.indexOf('function setup()')) + '\nreturn {captureSimulation,restoreSimulation};')(require,__dirname);
async function run() {
  for (const receiverKind of ['conveyor','processor','source']) {
    const f = setup(), source = add(f,'source',{initialCount:6,capacity:8,generationMode:'sequence',catalog:JSON.stringify(catalog),outputInterval:.1});
    const machine = add(f,'processor',{length:2.4,width:1.6,outputCapacity:1,processTime:.1,setupTime:0,outputInterval:.1});
    const receiver = add(f,receiverKind,receiverKind === 'conveyor' ? {length:2,speed:.6} : receiverKind === 'processor' ?
      {length:2.4,width:1.6,outputCapacity:1,capacity:8,processTime:.1,outputInterval:.1} : {capacity:8});
    const sink = receiverKind === 'source' ? receiver : add(f,'source',{capacity:8});
    link(f,source,machine); link(f,machine,receiver); if (sink !== receiver) link(f,receiver,sink);
    const before = JSON.stringify(await f.document.serialize()); f.runtime.start('hall');
    const entryIds = inventory(f,source).queue.map(entry => entry.id); let first = inventory(f,source).queue[0].product;
    let paused = false, stalledPose, waiting;
    if (receiverKind === 'conveyor') {
      advance(f,1,() => {
        const belt = record(f,receiver).components.conveyor;
        if (!paused && belt.packages.length) {
          assert.equal(belt.packages[0].mesh,first.object); f.runtime.command(receiver.userData.editorId,'pause');
          stalledPose = first.object.matrixWorld.clone(); paused = true;
        }
      });
      assert(paused); assert.equal(processor(f,machine).output.queue.length,1);
      waiting = processor(f,machine).output.queue[0]; assert.equal(waiting.spec.id,'tall-case');
      assert(waiting.product,'Retain the actual finished mesh and its inventory identity while waiting.');
      assert.equal(waiting.product.object.visible,false,'Do not expose the next tall box inside the wide departing box.');
      assert(processor(f,machine).output.blocked && vars(f,machine).blocked,'Physical tray clearance produces buffer backpressure.');
      assert(first.object.matrixWorld.equals(stalledPose),'The delivered wide box is not moved to make room for the next load.');
      assert.equal(waiting.ownerId,machine.userData.editorId);
      assert(processor(f,machine).input.queue.length>0,'Output capacity1 applies real upstream backpressure.');
      const checkpointed = JSON.parse(JSON.stringify(checkpoint.captureSimulation(f.runtime)));
      checkpoint.restoreSimulation(f.runtime,checkpointed); noOverlap(f);
      waiting = processor(f,machine).output.queue[0]; first = record(f,receiver).components.conveyor.packages[0].product;
      assert(waiting.product && !waiting.product.object.visible && waiting.ownerId===machine.userData.editorId,
        'Checkpoint restores hidden waiting inventory without exposing it inside a stalled load.');
      f.runtime.command(receiver.userData.editorId,'pause');
    }
    advance(f,35);
    assert.equal(vars(f,sink).receivedUnits,6,receiverKind+' receiver eventually accepts the complete mixed-size FIFO.');
    assert.deepEqual(inventory(f,sink).queue.map(entry=>entry.id),entryIds,'No regeneration, reordering or unit loss across waiting.');
    assert.equal(inventory(f,sink).queue[0].product.object,first.object,'The first physical identity survives processing and delivery.');
    if(waiting) assert.equal(waiting.ownerId,sink.userData.editorId);
    phases(f,machine); if(receiverKind==='processor') phases(f,receiver);
    // A stale front-entry reference must never steal/hide an actively held load.
    const held = inventory(f,sink).queue[0].product, hand = new THREE.Group(); hand.position.set(0,3,8); f.scene.add(hand); f.ctx.vrMode=true;
    assert(f.runtime.pickupProduct(held,hand)); held.object.updateWorldMatrix(true,true);
    const heldMatrix = held.object.matrixWorld.clone(), entry=held.sourceEntry;
    assert.equal(f.runtime.sourceRuntime.present(record(f,sink),inventory(f,sink),entry),null);
    assert(held.object.visible && held.object.matrixWorld.equals(heldMatrix),'Presentation never hides or repositions a tracked grab.');
    f.runtime.stop(); assert.equal(JSON.stringify(await f.document.serialize()),before,'Stop restores the exact authored scene.');
    assert.equal(f.runtime.sourceRuntime.entries.size,0); assert.equal(f.runtime.processorRuntime.archive.size,0);
  }
  {
    const f=setup(), machine=add(f,'processor',{length:2.4,width:1.6,outputCapacity:1,processTime:.1,outputInterval:.1}),
      conveyor=add(f,'conveyor',{speed:.6,length:2}), sink=add(f,'processor',{length:2.4,width:1.6,capacity:8,outputCapacity:2,processTime:.1});
    link(f,machine,conveyor); link(f,conveyor,sink);
    const authored=catalog.map((spec,index)=>{
      const object=f.document.addPrimitive('hall','box'); f.document.setBehaviors(object,[{type:'product'}]);
      f.document.setTransform(object,{position:[-4-index,2,4],scale:[spec.width,spec.height,spec.depth]}); return object;
    });
    let disposals=0; authored.forEach(object=>object.traverse(node=>{if(node.geometry)node.geometry.addEventListener('dispose',()=>disposals++);}));
    const before=JSON.stringify(await f.document.serialize()); f.runtime.start('hall'); f.ctx.vrMode=true;
    const hand=new THREE.Group(); hand.position.set(0,3,8); f.scene.add(hand);
    authored.forEach((object,index)=>{
      const product=f.runtime.products.get(object); assert(f.runtime.pickupProduct(product,hand));
      const matrix=f.runtime.sourceRuntime.frontMatrix(record(f,machine),product.bounds,product.scale,processor(f,machine).input.position);
      if(index)matrix.setPosition(new THREE.Vector3().setFromMatrixPosition(matrix).add(new THREE.Vector3(0,.35,0)));
      f.runtime.setProductMatrix(product,matrix); assert(f.runtime.releaseProduct(product),'A normal tracked manual drop still accepts internal FIFO capacity.');
    });
    let paused=false;
    advance(f,1,()=>{if(!paused&&record(f,conveyor).components.conveyor.packages.length){f.runtime.command(conveyor.userData.editorId,'pause');paused=true;}});
    const waiting=processor(f,machine).output.queue[0]; assert(waiting && waiting.product.object===authored[1] && !waiting.product.object.visible);
    assert.equal(disposals,0,'Physical backpressure never disposes an authored waiting body.');
    f.runtime.command(conveyor.userData.editorId,'pause'); advance(f,20);
    assert.equal(vars(f,sink).completedUnits,2); assert.deepEqual(processor(f,sink).output.queue.map(entry=>entry.product.object),authored,
      'Both exact authored meshes escape and reach the next process in FIFO order.');
    f.runtime.stop(); assert.equal(disposals,0); assert.equal(JSON.stringify(await f.document.serialize()),before);
    assert(authored.every(object=>object.visible),'Stop restores original authored visibility even for an internally hidden waiting load.');
  }
  console.log('Buffer presentation: real mixed-size AABBs, stalled downstream/backpressure, delayed visibility without delays, Source/processor/belt handoffs, FIFO identity, held-load safety and exact restoration passed.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
