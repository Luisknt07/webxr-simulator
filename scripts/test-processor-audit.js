// Independent edge-case audit reusing the real simulation fixture, without WebGL.
'use strict';
const assert = require('node:assert/strict');
const {THREE, setup, add, link, record, processor, inventory, vars, advance, close, phases} = require('./test-processor-runtime.js');
function monitoredAdvance(f, seconds, machines = []) {
  for (let time = 0; time < seconds - 1e-9; time += 1 / 60) {
    advance(f, Math.min(1 / 60, seconds - time));
    assert(f.runtime.sourceRuntime.liveLoads() <= 500, 'Physical loads, waiting inventory and reserved separator outputs share the global capacity.');
    machines.forEach(object => {
      phases(f, object);
      const values = vars(f, object);
      assert(values.utilization >= -1e-7 && values.utilization <= 100 + 1e-7, 'Parallel utilization must remain within 0-100%.');
      assert(values.progress >= 0 && values.progress <= 100 + 1e-7);
    });
  }
}
function leaves(entry, result = []) {
  if (entry.members && entry.members.length) entry.members.forEach(member => leaves(member, result));
  else result.push(entry);
  return result;
}
function unitMix(entries) {
  const result = {};
  entries.forEach(entry => leaves(entry).forEach(leaf => { result[leaf.spec.id] = (result[leaf.spec.id] || 0) + leaf.units; }));
  return result;
}
function placeByHand(f, machine, object, hand, lift = 0) {
  const product = f.runtime.products.get(object); assert(product);
  assert(f.runtime.pickupProduct(product, hand));
  const matrix = f.runtime.sourceRuntime.frontMatrix(record(f, machine), product.bounds, product.scale, processor(f, machine).input.position);
  if (lift) matrix.setPosition(new THREE.Vector3().setFromMatrixPosition(matrix).add(new THREE.Vector3(0, lift, 0)));
  f.runtime.setProductMatrix(product, matrix);
  assert(f.runtime.releaseProduct(product), 'An intake with FIFO capacity accepts a second manual load without being blocked by its own queued front.');
}
async function run() {
  {
    const f = setup(), catalog = [
      {id: 'carton', name: 'Caja de repuestos', type: 'box', width: 0.20, height: 0.22, depth: 0.18, color: '#ad7544'},
      {id: 'bottle', name: 'Botella azul', type: 'bottle', width: 0.12, height: 0.30, depth: 0.12, color: '#3478a4'}
    ];
    const source = add(f, 'source', {initialCount: 2, generationMode: 'sequence', catalog: JSON.stringify(catalog),
      loadMode: 'pallet', palletColumns: 2, palletRows: 1, palletLayers: 1, outputInterval: 0.1});
    const combine = add(f, 'processor', {mode: 'combiner', combineCount: 2, processTime: 0.1, outputInterval: 0.1});
    const separate = add(f, 'processor', {mode: 'separator', splitCount: 3, processTime: 0.1, outputInterval: 0.1});
    const queue = add(f, 'source', {capacity: 8});
    link(f, source, combine); link(f, combine, separate); link(f, separate, queue);
    f.runtime.start('hall');
    assert.deepEqual(unitMix(inventory(f, source).queue), {carton: 2, bottle: 2});
    monitoredAdvance(f, 2, [combine, separate]);
    const outputs = inventory(f, queue).queue;
    assert.equal(outputs.length, 3); assert.deepEqual(outputs.map(entry => entry.units), [2, 1, 1]);
    assert.deepEqual(unitMix(outputs), {carton: 2, bottle: 2}, 'Mixed pallet units retain their SKU composition across combining and non-even separation.');
    assert.equal(vars(f, combine).completedUnits, 4); assert.equal(vars(f, separate).completedUnits, 4);
    assert.equal(vars(f, queue).receivedUnits, 4); assert.equal(new Set(outputs.map(entry => entry.id)).size, 3);
    assert.equal(outputs[0].product.object.userData.sourceUnits, 2);
    f.runtime.stop(); assert.equal(f.runtime.sourceRuntime.entries.size, 0); assert.equal(f.runtime.processorRuntime.archive.size, 0);
  }
  {
    const f = setup(), combine = add(f, 'processor', {mode: 'combiner', combineCount: 2, processTime: 0.1, outputInterval: 0.1});
    const separate = add(f, 'processor', {mode: 'separator', splitCount: 2, processTime: 0.1}); link(f, combine, separate);
    const authored = [0, 1].map(index => {
      const object = f.document.addPrimitive('hall', 'box', index ? '#274e76' : '#b46942');
      f.document.setBehaviors(object, [{type: 'product'}]);
      f.document.setTransform(object, {position: [-6 - index, 2, 4], scale: index ? [0.28, 0.34, 0.22] : [0.42, 0.27, 0.31]});
      return object;
    });
    const original = authored.map(object => ({object, parent: object.parent, visible: object.visible, matrixAutoUpdate: object.matrixAutoUpdate,
      position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone(), matrix: object.matrix.clone()}));
    const resources = new Set(); authored.forEach(object => object.traverse(node => {
      if (node.geometry) resources.add(node.geometry);
      (Array.isArray(node.material) ? node.material : [node.material]).filter(Boolean).forEach(material => {
        resources.add(material); Object.values(material).forEach(value => { if (value && value.isTexture) resources.add(value); });
      });
    }));
    let authoredDisposals = 0; resources.forEach(resource => resource.addEventListener('dispose', () => authoredDisposals++));
    const saved = JSON.stringify(await f.document.serialize()); f.runtime.start('hall'); f.ctx.vrMode = true;
    const bounds = new Map(authored.map(object => [object, f.runtime.products.get(object).bounds.clone()]));
    const hand = new THREE.Group(); hand.position.set(-3, 3, 4); f.scene.add(hand);
    placeByHand(f, combine, authored[0], hand);
    assert.equal(vars(f, combine).queued, 1); assert.equal(vars(f, combine).completed, 0);
    placeByHand(f, combine, authored[1], hand, 0.35);
    monitoredAdvance(f, 1, [combine, separate]);
    const outputs = processor(f, separate).output.queue;
    assert.equal(outputs.length, 2); assert.equal(vars(f, separate).completedUnits, 2);
    assert.deepEqual(new Set(outputs.map(entry => entry.product && entry.product.object)), new Set(authored), 'Separate singleton outputs reactivate the exact authored meshes.');
    outputs.forEach(entry => {
      const product = entry.product, expected = bounds.get(product.object);
      assert(product.bounds.min.distanceTo(expected.min) < 1e-7 && product.bounds.max.distanceTo(expected.max) < 1e-7,
        'Reactivating a hidden authored model must preserve its actual bounds.');
      assert.strictEqual(product.item.product, product, 'Belt/queue movement must point to the reactivated product registration.');
      assert.strictEqual(product.item.sourceEntry, entry);
    });
    assert.equal(authoredDisposals, 0, 'Combining and separating document-owned meshes must never dispose their geometry, materials or textures.');
    f.runtime.stop(); assert.equal(authoredDisposals, 0);
    original.forEach(before => {
      assert.strictEqual(before.object.parent, before.parent); assert.equal(before.object.visible, before.visible);
      assert.equal(before.object.matrixAutoUpdate, before.matrixAutoUpdate); assert(before.object.matrix.equals(before.matrix));
      assert(before.object.position.equals(before.position)); assert(before.object.quaternion.equals(before.quaternion)); assert(before.object.scale.equals(before.scale));
    });
    assert.equal(JSON.stringify(await f.document.serialize()), saved); assert.equal(Object.keys(f.ctx.raycontrol.states).length, 0);
  }
  {
    const f = setup(), source = add(f, 'source', {initialCount: 1, loadMode: 'pallet', palletColumns: 4, palletRows: 4, palletLayers: 4,
      width: 0.05, height: 0.05, depth: 0.05, outputInterval: 0.1});
    const separate = add(f, 'processor', {mode: 'separator', splitCount: 16, outputCapacity: 16, processTime: 0.1}); link(f, source, separate);
    const fillers = Array.from({length: 8}, (_, index) => add(f, 'source', {initialCount: index < 7 ? 64 : 51, capacity: 64}, [20 + index * 5, 1.02, 20]));
    f.runtime.start('hall'); assert.equal(f.runtime.sourceRuntime.liveLoads(), 500);
    monitoredAdvance(f, 0.4, [separate]);
    assert.equal(vars(f, separate).queued, 1); assert.equal(vars(f, separate).completed, 0);
    assert.equal(processor(f, separate).jobs.length, 0, 'A separator waits for its additional result-load reservations before consuming an input.');
    assert.equal(f.runtime.sourceRuntime.liveLoads(), 500);
    f.runtime.command(fillers[0].userData.editorId, 'clearQueue');
    monitoredAdvance(f, 0.5, [separate]);
    assert.equal(vars(f, separate).completed, 1); assert.equal(vars(f, separate).outputQueued, 16);
    assert.equal(processor(f, separate).output.queue.reduce((sum, entry) => sum + entry.units, 0), 64);
    assert.equal(f.runtime.sourceRuntime.liveLoads(), 451);
    assert.equal(f.runtime.processorRuntime.reservedLoads(), 0, 'Completed output queues do not retain duplicate capacity reservations.');
    f.runtime.stop(); assert.equal(f.runtime.products.size, 0); assert.equal(f.runtime.sourceRuntime.entries.size, 0);
  }
  {
    const f = setup(), source = add(f, 'source', {initialCount: 6, capacity: 6, outputInterval: 0.1});
    const machine = add(f, 'processor', {parallelism: 3, requiresOperator: true, operatorAvailable: false,
      processTime: 0.4, setupTime: 0.2, setupPolicy: 'startup'}); link(f, source, machine);
    f.runtime.start('hall'); monitoredAdvance(f, 0.35, [machine]); assert(vars(f, machine).waitingOperator);
    f.runtime.command(machine.userData.editorId, 'operator'); monitoredAdvance(f, 0.1, [machine]);
    const setupBefore = vars(f, machine).setupSeconds, processBefore = vars(f, machine).processSeconds;
    f.runtime.command(machine.userData.editorId, 'pause'); monitoredAdvance(f, 0.5, [machine]);
    close(vars(f, machine).setupSeconds, setupBefore); close(vars(f, machine).processSeconds, processBefore);
    f.runtime.setVariable(machine.userData.editorId, 'operatorAvailable', false); f.runtime.command(machine.userData.editorId, 'pause');
    monitoredAdvance(f, 0.2, [machine]); close(vars(f, machine).setupSeconds, setupBefore);
    f.runtime.setVariable(machine.userData.editorId, 'operatorAvailable', true); monitoredAdvance(f, 2, [machine]);
    assert.equal(vars(f, machine).completed, 6); close(vars(f, machine).processSeconds, 2.4); close(vars(f, machine).setupSeconds, 0.6);
    f.runtime.command(machine.userData.editorId, 'powerOff'); const downBefore = vars(f, machine).downSeconds;
    monitoredAdvance(f, 0.3, [machine]); close(vars(f, machine).downSeconds - downBefore, 0.9);
    assert(vars(f, machine).operatorWaitSeconds > 0); assert(vars(f, machine).idleSeconds > 0); phases(f, machine);
    f.runtime.stop();
  }
  console.log('Processor independent audit: mixed-SKU pallets, uneven splitting, authored manual combining and exact asset restoration, 500-load reservations and parallel/operator/pause phase accounting passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
