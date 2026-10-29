const __layout = require("../../tooling/layout.cjs");
// Independent runtime audit: ownership, LIFO access, real assets and backpressure.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {THREE, behaviorSchema, setup, add, config, record, processor, inventory, vars, advance} = require('./test-processor-runtime.js');
const ConveyorAssembly = new Function('THREE', 'conveyorLayout', fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-pallet-queue-audit.js"), '../src/editor/ConveyorAssembly.js')), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export default class ConveyorAssembly', 'return class ConveyorAssembly'))(THREE, behaviorSchema.conveyorLayout);
function queue(f, object) { return record(f, object).components.palletQueue; }
function connect(f, from, to, automatic = true) {
  const assembly = new ConveyorAssembly({document: f.document, roomId: 'hall'}), value = assembly.config(from);
  f.document.setBehaviors(from, [Object.assign({}, value, {outputId: to.userData.editorId}, value.type === 'conveyor' ? {} : {delivery: automatic ? 'automatic' : 'manual'})]);
  assembly.align(from, 'output', to, 'input');
}
function noOverlaps(f) {
  const boxes = [];
  f.runtime.products.forEach(product => { product.object.updateWorldMatrix(true, true); boxes.push(product.bounds.clone().applyMatrix4(product.object.matrixWorld)); });
  for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
    assert(!boxes[a].clone().expandByScalar(-0.002).intersectsBox(boxes[b].clone().expandByScalar(-0.002)), 'Stock and transported loads must not overlap.');
  }
}
async function run() {
  {
    const f = setup(), conveyor = add(f, 'conveyor', {layout: 'tee', routing: 'alternate', length: 3, role: 'end', withPallet: true, withPanel: true, withSensors: true});
    const entry = f.document.additions.get(conveyor.userData.editorId), sensor = entry.nodes.get('4'), plc = entry.nodes.get('6');
    f.document.setTransform(sensor, {position: [-1.18, 0.22, 0.03]});
    const rules = [{sourceId: sensor.userData.editorId, variable: 'active', operator: 'eq', value: true,
      targetId: conveyor.userData.editorId, targetVariable: 'running', set: false, edge: 'rising'}];
    f.document.setBehaviors(plc, [{type: 'automation', rules: JSON.stringify(rules)}]);
    const canonical = await f.document.serialize(), legacy = JSON.parse(JSON.stringify(canonical));
    const oldRecord = legacy.rooms.hall.additions[0];
    const oldPallet = {name: 'Pallet retirado', position: [2.85, -1, 0], quaternion: [0, 0, 0, 1], scale: [0, 0, 0], visible: true,
      behaviors: [{type: 'collision', enabled: false, mode: 'obsolete-mode'}], visual: {importId: 'missing-retired-pallet-model'}};
    ['9', '9.0', '10', '10.0'].forEach(key => { oldRecord.nodes[key] = JSON.parse(JSON.stringify(oldPallet)); });
    const instantiate = f.document._instantiate.bind(f.document); let retiredRequests = 0;
    f.document._instantiate = async descriptor => {
      if (descriptor.importId === 'missing-retired-pallet-model') { retiredRequests++; throw new Error('Retired models must never be requested.'); }
      return instantiate(descriptor);
    };
    await f.document.load(legacy);
    assert.equal(retiredRequests, 0, 'Retired stock records are removed before validating their stale collisions/transforms or loading missing models.');
    assert.deepEqual(await f.document.serialize(), canonical);
    const loaded = f.document.getObject(conveyor.userData.editorId), content = loaded.children[0], loadedEntry = f.document.additions.get(loaded.userData.editorId);
    assert.equal(content.children.length, 10); assert(content.children[9].userData.industrialRetiredSupply);
    assert.equal(content.children[9].visible, false); assert.equal(content.children[9].children.length, 0);
    assert(!Array.from(loadedEntry.nodes.keys()).some(key => /^(?:9|10)(?:\.|$)/.test(key)));
    assert.deepEqual(loadedEntry.nodes.get('4').position.toArray(), [-1.18, 0.22, 0.03]);
    assert.deepEqual(JSON.parse(config(f, loadedEntry.nodes.get('6'), 'automation').rules), rules);
    const clipboard = f.document.captureObject(loaded); clipboard.record.nodes['9'] = oldPallet; clipboard.record.nodes['10.0'] = oldPallet;
    clipboard.sources.push(['9', loaded.userData.editorId + '/9']);
    const copy = await f.document.pasteObject(clipboard, 'hall', 8), copiedNodes = f.document.additions.get(copy.userData.editorId).nodes;
    assert.equal(retiredRequests, 0);
    const copiedRules = JSON.parse(config(f, copiedNodes.get('6'), 'automation').rules);
    assert.equal(copiedRules[0].sourceId, copiedNodes.get('4').userData.editorId); assert.equal(copiedRules[0].targetId, copy.userData.editorId);
    copiedNodes.forEach(node => { const control = config(f, node, 'control'); if (control) assert.equal(control.targetId, copy.userData.editorId); });
    f.runtime.start('hall'); assert.equal(f.runtime.products.size, 0);
    [loaded, copy].forEach(object => {
      const belt = record(f, object).components.conveyor; assert.equal(belt.pallets.size, 0); assert.equal(belt.palletCount, 0); assert.equal(belt.palletCapacity, 0);
    });
    f.runtime.stop();
  }
  {
    const f = setup(), source = add(f, 'source', {initialCount: 3, outputInterval: 0.1});
    const a = add(f, 'palletQueue', {columns: 1, rows: 1, layers: 3, capacity: 3});
    const b = add(f, 'palletQueue', {columns: 1, rows: 1, layers: 3, capacity: 3}); const belt = add(f, 'conveyor');
    connect(f, source, a); connect(f, a, b, false); connect(f, b, belt, false);
    f.runtime.start('hall'); advance(f, 0.6);
    assert.equal(vars(f, a).queued, 3); assert.equal(vars(f, b).queued, 0);
    const originalMeshes = new Set(queue(f, a).queue.map(entry => entry.product.object));
    for (let index = 0; index < 3; index++) {
      assert(f.runtime.command(a.userData.editorId, 'dispatch'));
      assert.equal(vars(f, b).queued, index + 1);
      queue(f, b).queue.forEach(entry => {
        assert.equal(entry.product.item.palletOwnerId, b.userData.editorId, 'Removing an outgoing queue item must not erase ownership assigned by the receiving queue.');
        assert(Number.isInteger(entry.product.item.palletSlot)); assert(originalMeshes.has(entry.product.object));
      });
    }
    assert.equal(vars(f, a).delivered, 3); assert.equal(vars(f, b).received, 3);
    assert.equal(new Set(queue(f, b).items.map(item => item.palletSlot)).size, 3);
    const bottom = queue(f, b).items.find(item => item.palletSlot === 0).product;
    const top = queue(f, b).items.find(item => item.palletSlot === 2).product;
    const hand = new THREE.Group(); hand.position.set(10, 3, 10); f.scene.add(hand); f.ctx.vrMode = true;
    assert(!f.runtime.pickupProduct(bottom, hand), 'The oldest cell layer cannot be extracted through two loads placed above it.');
    assert(f.runtime.pickupProduct(top, hand)); assert.equal(vars(f, b).queued, 2); assert.equal(vars(f, b).delivered, 1);
    assert(!f.runtime.palletQueueRuntime.canPickup(bottom), 'Removing the upper layer still leaves the middle layer protecting the bottom.');
    assert(f.runtime.command(b.userData.editorId, 'dispatch'));
    const delivered = record(f, belt).components.conveyor.packages[0];
    assert(delivered && originalMeshes.has(delivered.mesh)); assert.equal(delivered.beltId, belt.userData.editorId);
    assert.equal(delivered.palletOwnerId, null); assert.equal(vars(f, b).queued, 1); assert.equal(vars(f, b).delivered, 2);
    assert(f.runtime.palletQueueRuntime.canPickup(bottom));
    advance(f, 0.1); noOverlaps(f); assert.equal(f.runtime.sourceRuntime.liveLoads(), 3);
    f.runtime.stop(); assert.equal(f.runtime.products.size, 0); assert.equal(f.runtime.sourceRuntime.entries.size, 0);
  }
  for (const targetType of ['source', 'processor', 'conveyor']) {
    const f = setup(), stock = add(f, 'palletQueue', {columns: 1, rows: 1, layers: 1, capacity: 1});
    const target = add(f, targetType, targetType === 'processor' ? {processTime: 0.1} : {}); connect(f, stock, target, false);
    const original = f.document.addPrimitive('hall', 'box', '#527c93');
    f.document.setBehaviors(original, [{type: 'product'}]); f.document.setTransform(original, {position: [-5, 2, 4], scale: [0.3, 0.24, 0.27]});
    const saved = JSON.stringify(await f.document.serialize()), parent = original.parent, matrix = original.matrix.clone(), visible = original.visible;
    let disposed = 0; const resources = new Set();
    original.traverse(node => {
      if (node.geometry) resources.add(node.geometry);
      (Array.isArray(node.material) ? node.material : [node.material]).filter(Boolean).forEach(material => {
        resources.add(material); Object.values(material).forEach(value => { if (value && value.isTexture) resources.add(value); });
      });
    });
    resources.forEach(resource => resource.addEventListener('dispose', () => disposed++));
    f.runtime.start('hall'); const product = f.runtime.products.get(original), expectedBounds = product.bounds.clone();
    const hand = new THREE.Group(); hand.position.set(-5, 3, 4); f.scene.add(hand); f.ctx.vrMode = true;
    assert(f.runtime.pickupProduct(product, hand));
    const placement = f.runtime.palletQueueRuntime.placement(record(f, stock), product); assert(placement);
    f.runtime.setProductMatrix(product, placement.matrix); assert(f.runtime.releaseProduct(product)); assert.equal(vars(f, stock).queued, 1);
    assert(f.runtime.command(stock.userData.editorId, 'dispatch'));
    assert.equal(vars(f, stock).queued, 0); assert.equal(vars(f, stock).delivered, 1);
    if (targetType === 'source') { assert.equal(vars(f, target).received, 1); assert.equal(inventory(f, target).queue[0].product.object, original); }
    if (targetType === 'processor') { advance(f, 0.3); assert.equal(processor(f, target).output.queue[0].product.object, original); }
    if (targetType === 'conveyor') { assert.equal(record(f, target).components.conveyor.packages[0].mesh, original); }
    assert(product.bounds.min.distanceTo(expectedBounds.min) < 1e-7 && product.bounds.max.distanceTo(expectedBounds.max) < 1e-7);
    assert.equal(disposed, 0, 'Storing and dispatching a document-owned object must not dispose its resources.');
    f.runtime.stop(); assert.equal(disposed, 0); assert.strictEqual(original.parent, parent); assert(original.matrix.equals(matrix));
    assert.equal(original.visible, visible); assert.equal(JSON.stringify(await f.document.serialize()), saved);
    assert.equal(Object.keys(f.ctx.raycontrol.states).length, 0);
  }
  {
    const f = setup(), belt = add(f, 'conveyor'), stock = add(f, 'palletQueue', {columns: 1, rows: 1, layers: 1, capacity: 1}); connect(f, belt, stock);
    f.runtime.start('hall'); assert(f.runtime.insertProduct(belt.userData.editorId)); assert(f.runtime.insertProduct(belt.userData.editorId)); advance(f, 3);
    assert.equal(vars(f, stock).queued, 1); assert.equal(record(f, belt).components.conveyor.packages.length, 1);
    assert.equal(vars(f, belt).transferBlocked, true); assert.equal(vars(f, belt).exitCount, 1);
    const held = queue(f, stock).queue[0].product, hand = new THREE.Group(); hand.position.set(10, 3, 10); f.scene.add(hand);
    assert(f.runtime.pickupProduct(held, hand)); advance(f, 1);
    assert.equal(vars(f, stock).received, 2); assert.equal(vars(f, stock).delivered, 1); assert.equal(vars(f, stock).queued, 1);
    assert.equal(vars(f, belt).exitCount, 2); assert.equal(record(f, belt).components.conveyor.packages.length, 0); noOverlaps(f);
    f.runtime.stop();
    f.document.setBehaviors(belt, [Object.assign({}, config(f, belt, 'conveyor'), {outputId: ''})]);
    f.runtime.start('hall'); assert(f.runtime.insertProduct(belt.userData.editorId)); advance(f, 3);
    assert.equal(vars(f, stock).received, 0); assert.equal(vars(f, belt).exitCount, 0); assert.equal(vars(f, belt).inFlight, 1);
    assert.equal(record(f, belt).components.conveyor.pallets.size, 0, 'Disconnecting the independent stock leaves the product waiting on the conveyor.');
    f.runtime.stop();
  }
  console.log('Pallet queue independent audit: legacy stock migration, preserved sensor/PLC copy links, cross-stock owner/slot preservation, LIFO access, same-mesh dispatch, authored resource restoration, full-stock backpressure and disconnect retention passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
