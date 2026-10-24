// The existing production interaction contract uses WebXR trigger/select.
// Reuse the actual controller bridge, RayControl, collisions and simulation;
// only hardware/canvas boundaries are adapted, without synthetic grab commands.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const text = fs.readFileSync(path.join(__dirname, 'test-industrial-xr.js'), 'utf8'), start = text.indexOf('async function run()');
assert(start > 0);
const harness = new Function('require', '__dirname', text.slice(0, start) + '\nreturn {setup,advance,aim,away,button,select,press,vars,pickup,close};')(require, __dirname);
const {advance, aim, away, button, select, press, vars, pickup, close} = harness;

function setup() {
  const f = harness.setup();
  [f.head, f.tail, f.unrelated].forEach(object => f.document.remove(object));
  f.head = f.document.addPrefab('hall', 'palletQueue'); f.document.setTransform(f.head, {position: [0, 1, 0]});
  f.document.setBehaviors(f.head, f.document.getBehaviors(f.head).map(config => config.type === 'palletQueue' ? Object.assign({}, config,
    {width: 0.6, depth: 0.6, columns: 1, rows: 1, layers: 2, capacity: 2, delivery: 'manual'}) : config));
  f.unrelated = f.document.addPrefab('hall', 'palletQueue'); f.document.setTransform(f.unrelated, {position: [0, 1, 9]});
  f.tail = f.document.addPrefab('hall', 'conveyor', 'roller-middle'); f.document.setTransform(f.tail, {position: [4, 1, 0]});
  f.document.setBehaviors(f.tail, f.document.getBehaviors(f.tail).map(config => config.type === 'conveyor' ? Object.assign({}, config,
    {length: 2.5, autoSpawn: false, powered: true, running: false, withSensors: false, withPanel: false}) : config));
  f.cartons.forEach((object, index) => f.document.setTransform(object, {position: [-4 + index * 1.5, 1.3, 5], rotation: [0, 0, 0]}));
  f.scene.updateMatrixWorld(true); f.ctx.collisionWorld.invalidate(); return f;
}
function queue(f) { return f.runtime.records.get(f.head.userData.editorId).components.palletQueue; }
function tryPickup(f, object, hand) {
  const product = f.runtime.products.get(object), center = product.bounds.getCenter(new THREE.Vector3()).applyMatrix4(object.matrixWorld);
  aim(f, hand, center); select(f, hand, 'selectstart'); select(f, hand, 'selectend'); advance(f); return product;
}
function carryTo(f, product, hand, center) {
  hand.rotation.set(0, 0, 0); hand.position.y = 2.5; advance(f, 0.15);
  hand.position.set(center.x, 2.5, center.z + product.holdDistance); advance(f, 0.15);
  const offset = product.bounds.getCenter(new THREE.Vector3()).applyMatrix3(new THREE.Matrix3().setFromMatrix4(product.holdMatrix));
  hand.position.y = center.y - offset.y + 0.025; advance(f, 0.15);
}
function depositOnQueue(f, object, hand) {
  const product = pickup(f, object, hand), record = f.runtime.records.get(f.head.userData.editorId);
  const candidate = f.runtime.palletQueueRuntime.placement(record, product);
  assert(candidate, 'The next physical stock position must be unoccupied and supported.');
  carryTo(f, product, hand, candidate.bounds.getCenter(new THREE.Vector3()));
  const placement = f.runtime.palletQueueRuntime.findPlacement(product);
  assert(placement && placement.accepted, 'Tracked-hand placement must reach the physical wooden pallet.');
  select(f, hand, 'selectstart'); select(f, hand, 'selectend'); advance(f);
  assert.equal(product.heldBy, null); assert.equal(product.item.palletOwnerId, f.head.userData.editorId);
  return product;
}

async function run() {
  const f = setup(), authored = JSON.stringify(await f.document.serialize());
  const originalSelect = f.ctx.raycontrol.onSelectStart, nativeStart = f.nativeState.onSelectStart, nativeEnd = f.nativeState.onSelectEnd;
  const listeners = Object.fromEntries(Object.entries(f.ctx.raycontrol._listeners).map(([key, entries]) => [key, entries.length]));
  f.runtime.start('hall'); advance(f);
  assert.equal(f.ctx.raycontrol.controllers.length, 2);
  assert(f.left.getObjectByName('raycasterContext') && f.right.getObjectByName('raycasterContext'));
  press(f, 'stop', f.left); assert.equal(vars(f).running, false); assert.equal(vars(f, f.unrelated).running, true);
  press(f, 'start', f.right); assert.equal(vars(f).running, true);
  press(f, 'pause', f.left); assert.equal(vars(f).paused, true); assert.equal(vars(f, f.unrelated).paused, false);
  press(f, 'start', f.right); assert.equal(vars(f).paused, false);
  press(f, 'dispatch', f.left); assert.equal(vars(f).delivered, 0, 'The dedicated dispatch control cannot fabricate an empty stock load.');
  assert.deepEqual(f.native, {starts: 0, ends: 0, backgroundStarts: 0, backgroundEnds: 0});
  assert(f.pulses.some(value => value.handedness === 'left') && f.pulses.some(value => value.handedness === 'right'));

  const pause = button(f, 'pause'), normal = new THREE.Vector3(0, 0, 1).transformDirection(pause.object.matrixWorld);
  aim(f, f.left, pause.cap.getWorldPosition(new THREE.Vector3()), normal); aim(f, f.right, pause.cap.getWorldPosition(new THREE.Vector3()), normal);
  const sequence = f.runtime.getControlFeedback(pause.id).sequence;
  select(f, f.left, 'selectstart'); select(f, f.right, 'selectstart'); advance(f, 0.08);
  assert.equal(vars(f).paused, true); assert.equal(f.runtime.getControlFeedback(pause.id).sequence, sequence + 1, 'Two hands on one cap cause one action.');
  select(f, f.left, 'selectend'); advance(f, 0.08); assert(f.runtime.getControlFeedback(pause.id).pressed);
  select(f, f.right, 'selectend'); advance(f, 0.3); assert(!f.runtime.getControlFeedback(pause.id).pressed); close(pause.cap.position.z, 0.025, 0.0001);
  // Grip/squeeze currently has no production adapter. It must not duplicate
  // trigger actions or accidentally invoke controls through this test harness.
  const beforeSqueeze = f.runtime.getControlFeedback(pause.id).sequence;
  [f.left, f.right].forEach(hand => { select(f, hand, 'squeezestart'); select(f, hand, 'squeezeend'); }); advance(f);
  assert.equal(f.runtime.getControlFeedback(pause.id).sequence, beforeSqueeze); assert.equal(vars(f).paused, true);
  press(f, 'start', f.right);

  const bottom = depositOnQueue(f, f.cartons[0], f.left), top = depositOnQueue(f, f.cartons[1], f.right);
  assert.equal(vars(f).queued, 2); assert.equal(vars(f).received, 2); assert.equal(vars(f).receivedUnits, 2); assert.equal(vars(f).full, true);
  assert.equal(queue(f).items.length, 2); assert.equal(bottom.item.palletSlot, 0); assert.equal(top.item.palletSlot, 1);
  assert(top.item.box.min.y >= bottom.item.box.max.y - 0.001, 'The upper stock load physically rests above the existing lower load.');
  tryPickup(f, bottom.object, f.right); tryPickup(f, bottom.object, f.left);
  assert.equal(bottom.heldBy, null, 'Neither tracked hand can remove a box underneath another box.');
  assert.equal(vars(f).delivered, 0); assert.equal(queue(f).items.length, 2);
  const heldTop = pickup(f, top.object, f.left), entry = heldTop.sourceEntry;
  assert.equal(heldTop, top); assert.equal(vars(f).queued, 1); assert.equal(vars(f).delivered, 1); assert.equal(vars(f).deliveredUnits, 1);
  assert.equal(entry.ownerId, ''); assert.equal(heldTop.item.palletOwnerId, null);
  tryPickup(f, heldTop.object, f.right); assert.equal(heldTop.heldBy, f.left); assert.equal(vars(f).delivered, 1);
  const beltRecord = f.runtime.records.get(f.tail.userData.editorId), belt = beltRecord.components.conveyor;
  const point = f.runtime.pathPoint(belt.config, 0.35), surface = f.runtime.pathSurface(beltRecord, belt, point);
  const halfHeight = heldTop.bounds.getSize(new THREE.Vector3()).multiply(heldTop.scale).y / 2;
  const center = surface.clone().add(new THREE.Vector3(0, halfHeight + 0.012, 0));
  carryTo(f, heldTop, f.left, center);
  assert(f.runtime.findProductBelt(heldTop), 'The tracked hand reaches a free transport surface.');
  select(f, f.left, 'selectstart'); select(f, f.left, 'selectend'); advance(f);
  assert.equal(heldTop.heldBy, null); assert.equal(heldTop.item.beltId, f.tail.userData.editorId);
  assert.equal(heldTop.item.mesh, f.cartons[1], 'Manual stock-to-conveyor transfer preserves the authored product identity.');
  assert.equal(vars(f, f.tail).entryCount, 1); assert.equal(vars(f).delivered, 1); assert.equal(vars(f).received, 2);
  assert.equal(queue(f).items.length, 1); assert.equal(queue(f).queue[0].product, bottom);

  pickup(f, bottom.object, f.right); assert.equal(vars(f).queued, 0); assert.equal(vars(f).delivered, 2); assert.equal(vars(f).empty, true);
  assert.equal(queue(f).items.length, 0, 'Removing the upper box makes the newly exposed lower box available.');
  const active = button(f, 'pause'); aim(f, f.left, active.cap.getWorldPosition(new THREE.Vector3()), normal);
  select(f, f.left, 'selectstart'); advance(f, 0.08); assert(f.runtime.getControlFeedback(active.id).pressed);
  f.visuals.dispose(); f.runtime.stop(); f.ctx.editor.active = true;
  assert.equal(f.runtime.held.size, 0); assert.equal(f.ctx.raycontrol.onSelectStart, originalSelect);
  assert.equal(f.nativeState.onSelectStart, nativeStart); assert.equal(f.nativeState.onSelectEnd, nativeEnd);
  assert.equal(f.ctx.raycontrol.states['native-portal'], f.nativeState); assert.equal(f.ctx.raycontrol.states['native-background'], f.nativeBackground);
  assert(!Object.keys(f.ctx.raycontrol.states).some(name => name.startsWith(f.runtime.statePrefix)));
  Object.entries(f.ctx.raycontrol._listeners).forEach(([key, entries]) => assert.equal(entries.length, listeners[key] || 0));
  assert.equal((f.ctx.renderer.domElement._listeners.wheel || []).length, 0); assert.equal(f.runtime.productFeedback.bindings.size, 0);
  assert.equal(f.runtime.productFeedback.root.parent, null); assert(!f.head.children.some(object => object.name === 'Cargas de la estiba'));
  assert.equal(JSON.stringify(await f.document.serialize()), authored, 'Exiting XR restores authored boxes, controls, stock equipment and native input exactly.');
  console.log('Pallet Queue WebXR: production bilateral trigger rays, dedicated physical controls, top-only picking, tracked pallet deposits, manual conveyor transfer and exact play cleanup passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
