const __layout = require("../../tooling/layout.cjs");
// The full equipment catalogue shares the production WebXR input bridge,
// RayControl, collisions, prefabs, animated caps and simulation. This adapts
// controller poses and canvas drawing; it does not claim physical-headset QA.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const schema = require('../../modules/logistica-industrial/contracts/behaviors.js');
const fixture = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-equipment-catalog-xr.js"), 'test-industrial-xr.js')), 'utf8');
const boundary = fixture.indexOf('async function run()');
assert(boundary > 0);
const harness = new Function('require', '__dirname', fixture.slice(0, boundary) +
  '\nreturn {setup,advance,aim,away,button,select,press,vars,pickup,close};')(require, __dirname);
const {advance, aim, away, button, select, press, vars, close} = harness;
function pickup(f, object, hand) {
  const product = f.runtime.products.get(object);
  assert(product, 'The physical product must be registered.');
  const metadata = object.userData.sourceProduct;
  // The centre of a multi-column pallet can be empty air between its boxes.
  // Point at one real package surface; the whole pallet remains one load.
  const target = metadata && metadata.loadMode === 'pallet' ? new THREE.Vector3(
    -(metadata.palletColumns - 1) / 2 * (metadata.productWidth + 0.02),
    0.15 + metadata.productHeight / 2,
    (metadata.palletRows - 1) / 2 * (metadata.productDepth + 0.02)) : product.bounds.getCenter(new THREE.Vector3());
  const center = target.applyMatrix4(object.matrixWorld);
  aim(f, hand, center, new THREE.Vector3(0, 0, 1), metadata && metadata.loadMode === 'pallet' ? 0.35 : 0.7);
  select(f, hand, 'selectstart'); select(f, hand, 'selectend'); advance(f);
  // Avoid handing Node an entire circular Three scene for a failed diff.
  assert(product.heldBy === hand, 'The actual controller ray must acquire the physical product.');
  assert(f.runtime.held.get(hand) === product, 'The tracked hand must own the same product record.');
  return product;
}
function update(f, object, type, changes) {
  f.document.setBehaviors(object, f.document.getBehaviors(object).map(config => config.type === type ? Object.assign({}, config, changes) : config));
}
function controls(f, object) {
  return f.document.getObjects('hall').filter(node => f.document.getBehaviors(node).some(config =>
    config.type === 'control' && config.targetId === object.userData.editorId) && visible(node));
}
function visible(object) { for (let node = object; node; node = node.parent) if (!node.visible) return false; return true; }
function flags(f, object) {
  const state = vars(f, object);
  return Object.fromEntries(['powered', 'running', 'paused', 'emergency', 'speed', 'entryCount', 'exitCount', 'inFlight',
    'queued', 'generated', 'delivered', 'received', 'operatorAvailable', 'completed'].map(key => [key, state[key]]));
}
function release(f, hand) { select(f, hand, 'selectstart'); select(f, hand, 'selectend'); advance(f); }
function deposit(f, product, hand) {
  const record = f.runtime.records.get(f.head.userData.editorId), belt = record.components.conveyor;
  const point = f.runtime.pathPoint(belt.config, 0.35), surface = f.runtime.pathSurface(record, belt, point);
  const halfHeight = product.bounds.getSize(new THREE.Vector3()).multiply(product.scale).y / 2;
  const center = surface.clone().add(new THREE.Vector3(0, halfHeight + 0.012, 0));
  hand.rotation.set(0, 0, 0); hand.position.y = 3.5; advance(f, 0.15);
  hand.position.set(center.x, 3.5, center.z + product.holdDistance); advance(f, 0.15);
  hand.position.y = center.y + 0.025; advance(f, 0.15);
  assert(f.runtime.findProductBelt(product), 'The actual tracked pose reaches the physical transport deck.');
  release(f, hand); assert.equal(product.heldBy, null); assert.equal(product.item.beltId, f.head.userData.editorId);
  return product.item;
}
function cleanup(f, authored) {
  f.visuals.dispose(); f.runtime.stop();
  assert.equal(f.runtime.held.size, 0);
  assert(!Object.keys(f.ctx.raycontrol.states).some(key => key.startsWith(f.runtime.statePrefix)));
  assert.deepEqual(f.native, {starts: 0, ends: 0, backgroundStarts: 0, backgroundEnds: 0}, 'Equipment input must preserve native background interactions.');
  return f.document.serialize().then(value => assert.equal(JSON.stringify(value), authored, 'XR cannot change the saved equipment configuration.'));
}
function mechanisms(f, definition) {
  const kind = definition.preset.mechanism;
  const expected = {liftTransfer: 'lift', turntable: 'turntable', pusher: 'pusher', steer: 'steer', distributor: 'steer', elevator: 'elevator'}[kind];
  if (!expected) return;
  assert(Array.from(f.visuals.mechanisms.values()).some(entry => entry.conveyor.id === f.head.userData.editorId && entry.motion.kind === expected),
    definition.id + ' binds its actual visible mechanism to the same live simulation record used by XR controls.');
}
async function conveyor(definition) {
  const f = harness.setup();
  f.document.remove(f.head); f.document.remove(f.tail);
  f.head = f.document.addPrefab('hall', 'conveyor', definition.variant);
  f.document.setTransform(f.head, {position: [0, 1.02, 0]});
  if (!definition.preset.withPanel) f.cartons.forEach(object => f.document.setTransform(object, {rotation: [0, 0, 0]}));
  const authored = JSON.stringify(await f.document.serialize());
  f.scene.updateMatrixWorld(true); f.ctx.collisionWorld.invalidate(); f.runtime.start('hall'); advance(f);
  const initialOther = flags(f, f.unrelated);
  assert.deepEqual(controls(f, f.head).map(node => node.userData.industrialAction).sort(), definition.actions.map(action => action.id).sort(),
    definition.id + ' retains its documented physical panel.');
  mechanisms(f, definition);
  if (!definition.preset.withPanel) {
    const product = pickup(f, f.cartons[0], f.left);
    assert.equal(product.heldBy, f.left, definition.id + ' remains a physical, manipulable equipment workflow without a fictitious electrical panel.');
    const item = deposit(f, product, f.left), offset = item.offset;
    advance(f, 0.6);
    if (definition.preset.drive === 'gravity') assert(item.offset > offset + 0.01, 'A real XR deposit on the descending passive rollers moves by gravity.');
    else close(item.offset, offset, 0.001);
    const second = pickup(f, f.cartons[1], f.right); away(f, f.right); release(f, f.right); assert.equal(second.heldBy, null);
    let motor = false; f.head.traverse(node => { if (/Motorreductor/.test(node.name) && visible(node)) motor = true; });
    assert.equal(motor, false, definition.id + ' must not add a motor to a passive physical station.');
  } else {
    // Swap hands for the second pass: every physical cap is operated by both
    // actual rays, including its inward travel and release captured off-target.
    for (const [left, right] of [[f.left, f.right], [f.right, f.left]]) {
      press(f, 'powerOn', left); assert(vars(f).powered && !vars(f).running);
      press(f, 'start', right); assert(vars(f).running);
      if (definition.preset.requiresOperator) assert.equal(vars(f).operatorAvailable, false, 'XR start never invents an available operator.');
      press(f, 'pause', left); assert(vars(f).paused); close(vars(f).actualSpeed, 0);
      press(f, 'start', right); assert(!vars(f).paused);
      const speed = vars(f).speed;
      press(f, 'speedUp', left); close(vars(f).speed, speed + 0.1);
      press(f, 'speedDown', right); close(vars(f).speed, speed);
      const entries = vars(f).entryCount, pending = vars(f).pendingInsert;
      press(f, 'insertBox', left);
      if (definition.productProfiles.every(profile => profile.loadType === 'pallet')) {
        assert.equal(vars(f).entryCount, entries, 'The insertion helper cannot fabricate a pallet from a box.');
        assert(f.notices.some(message => /pallet/.test(message)));
      } else assert.equal(vars(f).entryCount + vars(f).pendingInsert, entries + pending + 1,
        definition.id + ' admits a compatible physical box or retains its request until the occupied inlet is free.');
      press(f, 'stop', right); assert(!vars(f).running); close(vars(f).actualSpeed, 0);
      press(f, 'start', left); assert(vars(f).running);
      press(f, 'emergency', right); assert(vars(f).emergency && !vars(f).running);
      press(f, 'start', left); assert(!vars(f).running, 'XR cannot bypass the emergency latch.');
      press(f, 'emergency', right); assert(!vars(f).emergency && !vars(f).running);
      press(f, 'start', left); assert(vars(f).running);
      press(f, 'powerOff', right); assert(!vars(f).powered && !vars(f).running);
      assert.deepEqual(flags(f, f.unrelated), initialOther, 'A different machine must never inherit the selected panel\'s command or counters.');
    }
    assert(f.pulses.some(pulse => pulse.handedness === 'left') && f.pulses.some(pulse => pulse.handedness === 'right'));
  }
  await cleanup(f, authored);
}
function replaceEquipment(kind, variant, changes = {}) {
  const f = harness.setup();
  [f.head, f.tail, f.unrelated].forEach(object => f.document.remove(object));
  f.head = f.document.addPrefab('hall', kind, variant);
  f.unrelated = f.document.addPrefab('hall', kind, variant);
  f.document.setTransform(f.head, {position: [0, 1.02, 0]});
  f.document.setTransform(f.unrelated, {position: [0, 1.02, 9]});
  update(f, f.head, kind, changes); update(f, f.unrelated, kind, changes);
  f.scene.updateMatrixWorld(true); f.ctx.collisionWorld.invalidate(); return f;
}
async function source(loadMode, variant) {
  const f = replaceEquipment('source', variant, {autoGenerate: false, initialCount: 0, capacity: 2, delivery: 'manual',
    loadMode, palletColumns: 2, palletRows: 2, palletLayers: 1});
  const authored = JSON.stringify(await f.document.serialize());
  f.runtime.start('hall'); advance(f); const initialOther = flags(f, f.unrelated);
  assert.deepEqual(controls(f, f.head).map(node => node.userData.industrialAction).sort(), ['start', 'stop', 'pause', 'generate', 'dispatch', 'clearQueue'].sort());
  for (const [left, right] of [[f.left, f.right], [f.right, f.left]]) {
    press(f, 'stop', left); assert(!vars(f).running);
    press(f, 'start', right); assert(vars(f).running);
    press(f, 'pause', left); assert(vars(f).paused);
    press(f, 'start', right); assert(!vars(f).paused);
    const generated = vars(f).generated;
    press(f, 'generate', left); press(f, 'generate', right);
    assert.equal(vars(f).generated, generated + 2); assert.equal(vars(f).queued, 2);
    press(f, 'generate', left); assert.equal(vars(f).generated, generated + 2, 'Both tracked controls respect the FIFO limit.');
    const entry = f.runtime.records.get(f.head.userData.editorId).components.source.queue[0];
    assert(entry.product, 'The real generated front load is physically exposed.');
    const product = pickup(f, entry.product.object, left);
    assert.equal(product.sourceEntry.id, entry.id); assert.equal(entry.ownerId, '');
    assert.equal(vars(f).queued, 1); assert.equal(vars(f).deliveredUnits, vars(f).delivered * (loadMode === 'pallet' ? 4 : 1));
    if (loadMode === 'pallet') assert.equal(product.object.userData.sourceProduct.units, 4, 'One tracked grip holds the complete pallet rather than duplicating its contained units.');
    // Clear the wide load above the Source deck before moving it past the
    // cabinet; a diagonal shortcut can correctly collide with the panel.
    left.rotation.set(0, 0, 0); left.position.y = 3.5; advance(f, 0.15);
    left.position.set(8, 3.5, 6 + product.holdDistance); advance(f, 0.15);
    release(f, left); assert.equal(product.heldBy, null);
    const delivered = vars(f).delivered;
    press(f, 'dispatch', right); assert.equal(vars(f).delivered, delivered, 'An unconnected outlet cannot silently delete a queued physical load.');
    press(f, 'clearQueue', left); assert.equal(vars(f).queued, 0);
    assert(f.runtime.products.has(product.object), 'Clearing FIFO cannot delete a load already taken by a tracked hand.');
    assert.deepEqual(flags(f, f.unrelated), initialOther);
  }
  await cleanup(f, authored);
}
async function sourceFlow(loadMode) {
  const f = replaceEquipment('source', undefined, {autoGenerate: false, initialCount: 0, capacity: 1, delivery: 'manual',
    loadMode, palletColumns: 2, palletRows: 2, palletLayers: 1});
  const queue = f.unrelated;
  const belt = f.document.addPrefab('hall', 'conveyor', loadMode === 'pallet' ? 'pallet-chain' : 'roller-motor');
  update(f, belt, 'conveyor', {autoSpawn: false, powered: true, running: false});
  const headConfig = f.document.getBehaviors(f.head).find(config => config.type === 'source');
  const queueConfig = f.document.getBehaviors(queue).find(config => config.type === 'source');
  const beltConfig = f.document.getBehaviors(belt).find(config => config.type === 'conveyor');
  const headPorts = schema.productSources.layout(headConfig), queuePorts = schema.productSources.layout(queueConfig);
  f.document.setTransform(queue, {position: [headPorts.output.x - queuePorts.input.x, 1.02, 0]});
  const beltPorts = schema.conveyorLayout.ports(beltConfig);
  f.document.setTransform(belt, {position: [queue.position.x + queuePorts.output.x - beltPorts.input.x, 1.02, 0]});
  update(f, f.head, 'source', {outputId: queue.userData.editorId});
  update(f, queue, 'source', {outputId: belt.userData.editorId});
  f.scene.updateMatrixWorld(true); f.ctx.collisionWorld.invalidate();
  const authored = JSON.stringify(await f.document.serialize());
  f.runtime.start('hall'); advance(f);
  press(f, 'generate', f.left); assert.equal(vars(f).queued, 1);
  const front = f.runtime.records.get(f.head.userData.editorId).components.source.queue[0], body = front.product.object;
  press(f, 'dispatch', f.right); assert.equal(vars(f).delivered, 1); assert.equal(vars(f, queue).received, 1);
  assert.equal(f.runtime.records.get(queue.userData.editorId).components.source.queue[0], front, 'XR dispatch preserves the FIFO identity.');
  press(f, 'generate', f.right); assert.equal(vars(f).queued, 1);
  press(f, 'dispatch', f.left); assert.equal(vars(f).queued, 1); assert.equal(vars(f).delivered, 1, 'A full connected FIFO applies real backpressure to the XR button.');
  press(f, 'dispatch', f.left, queue); assert.equal(vars(f, queue).delivered, 0, 'A stopped connected conveyor cannot receive a dispatched load.');
  press(f, 'start', f.right, belt);
  press(f, 'dispatch', f.right, queue); assert.equal(vars(f, queue).delivered, 1); assert.equal(vars(f, belt).entryCount, 1);
  const item = f.runtime.records.get(belt.userData.editorId).components.conveyor.packages[0];
  assert.equal(item.mesh, body, 'Source, FIFO and conveyor share the original generated physical load after tracked-control dispatch.');
  assert.equal(item.product.sourceEntry.id, front.id);
  assert.equal(vars(f, belt).inFlight, 1); assert.equal(f.runtime.packageCount, 1);
  assert.equal(vars(f, queue).deliveredUnits, loadMode === 'pallet' ? 4 : 1);
  press(f, 'stop', f.left, belt);
  pickup(f, body, f.right); assert.equal(item.product.heldBy, f.right);
  assert.equal(vars(f, queue).delivered, 1, 'Picking up a downstream product cannot recount the original FIFO dispatch.');
  away(f, f.right); release(f, f.right);
  await cleanup(f, authored);
}
async function processor(mode) {
  const f = replaceEquipment('processor', mode === 'process' ? undefined : mode, {requiresOperator: true, operatorAvailable: false, delivery: 'manual'});
  const authored = JSON.stringify(await f.document.serialize());
  f.runtime.start('hall'); advance(f); const initialOther = flags(f, f.unrelated);
  assert.deepEqual(controls(f, f.head).map(node => node.userData.industrialAction).sort(),
    ['start', 'stop', 'emergency', 'pause', 'powerOff', 'powerOn', 'operator', 'dispatch', 'resetEmergency'].sort());
  for (const [left, right] of [[f.left, f.right], [f.right, f.left]]) {
    press(f, 'powerOn', left); assert(vars(f).powered && !vars(f).running);
    press(f, 'start', right); assert(vars(f).running);
    press(f, 'pause', left); assert(vars(f).paused);
    press(f, 'start', right); assert(!vars(f).paused);
    press(f, 'operator', left); assert(vars(f).operatorAvailable);
    press(f, 'operator', right); assert(!vars(f).operatorAvailable);
    press(f, 'dispatch', left); assert.equal(vars(f).exitCount, 0);
    press(f, 'stop', right); assert(!vars(f).running);
    press(f, 'emergency', left); assert(vars(f).emergency);
    press(f, 'start', right); assert(!vars(f).running);
    press(f, 'resetEmergency', left); assert(!vars(f).emergency && !vars(f).running);
    press(f, 'powerOff', right); assert(!vars(f).powered && !vars(f).running);
    assert.deepEqual(flags(f, f.unrelated), initialOther);
  }
  assert.equal(f.runtime.records.get(f.head.userData.editorId).components.processor.config.mode, mode);
  await cleanup(f, authored);
}
async function run() {
  const definitions = schema.conveyorEquipment.listEquipment();
  assert.equal(definitions.length, 25); assert.equal(new Set(definitions.map(value => value.family)).size, 8);
  for (const definition of definitions) await conveyor(definition);
  await source('individual'); await source('pallet'); await source('individual', 'queue');
  await sourceFlow('individual'); await sourceFlow('pallet');
  for (const mode of ['process', 'combiner', 'separator']) await processor(mode);
  console.log('Equipment catalogue WebXR: all 25 conveyors / 8 families, Source individual and complete pallet, FIFO Queue and Processor/Combiner/Separator use real bilateral controller rays, animated physical caps, isolated machine state, compatible loads and exact play cleanup.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
