// Real controller events and production picking/placement; physical XR hardware
// and GPU presentation remain outside this headless regression.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const text = fs.readFileSync(path.join(__dirname, 'test-industrial-xr.js'), 'utf8');
const start = text.indexOf('async function run()');
assert(start > 0);
const harness = new Function('require', '__dirname', text.slice(0, start) +
  '\nreturn {setup,advance,aim,away,button,select,press,vars,pickup,basis,unchangedBasis,connect,disconnect,wall,removeWall};')(require, __dirname);
const {setup, advance, aim, away, button, select, press, vars, pickup, basis, unchangedBasis, connect, disconnect, wall, removeWall} = harness;
function grip(f, object, hand) {
  const product = f.runtime.products.get(object);
  assert(product);
  const center = product.bounds.getCenter(new THREE.Vector3()).applyMatrix4(object.matrixWorld);
  aim(f, hand, center);
  select(f, hand, 'squeezestart');
  advance(f);
  assert.equal(product.heldBy, hand, 'The actual grip event picks the ray-selected product.');
  assert.equal(product.holdInput, 'squeeze');
  return product;
}
function carry(f, product, hand, matrix) {
  hand.rotation.set(0, 0, 0);
  hand.position.y = 3;
  advance(f, 0.15);
  const position = new THREE.Vector3().setFromMatrixPosition(matrix);
  hand.position.x = position.x; hand.position.z = position.z + product.holdDistance;
  advance(f, 0.15);
  hand.position.y = position.y + 0.025;
  advance(f, 0.15);
}

async function controlsAndLifecycle() {
  const f = setup(), authored = JSON.stringify(await f.document.serialize());
  const counts = hand => ['squeezestart', 'squeezeend'].map(type => (hand._listeners[type] || []).length);
  const initial = [counts(f.left), counts(f.right)];
  f.runtime.start('hall'); advance(f);
  assert.deepEqual(counts(f.left), initial[0].map(value => value + 1));
  assert.deepEqual(counts(f.right), initial[1].map(value => value + 1));
  const firstBasis = basis(f.cartons[0]), secondBasis = basis(f.cartons[1]);
  const first = grip(f, f.cartons[0], f.left), second = grip(f, f.cartons[1], f.right);
  f.left.rotation.set(0.6, 0.7, -0.5); f.right.rotation.set(-0.8, 0.4, 0.2); advance(f);
  unchangedBasis(f.cartons[0], firstBasis); unchangedBasis(f.cartons[1], secondBasis);
  select(f, f.left, 'squeezestart'); advance(f);
  assert.equal(first.heldBy, f.left, 'A duplicate grip-down cannot toggle an owned box off.');
  const before = Object.assign({}, f.native);
  away(f, f.left);
  select(f, f.left, 'selectstart'); select(f, f.left, 'selectend'); advance(f);
  assert.equal(first.heldBy, f.left, 'Trigger input cannot drop a load owned by the held grip.');
  assert.deepEqual(f.native, before, 'A grip-held trigger does not fire native background actions.');
  select(f, f.left, 'squeezeend'); advance(f);
  assert.equal(first.heldBy, null); assert.equal(second.heldBy, f.right);
  disconnect(f, f.right); advance(f);
  assert.equal(second.heldBy, null);
  assert.deepEqual(counts(f.right), initial[1]);
  connect(f, f.right); connect(f, f.right);
  assert.deepEqual(counts(f.right), initial[1].map(value => value + 1), 'Reconnects bind each grip handler exactly once.');
  const pause = button(f, 'pause'), normal = new THREE.Vector3(0, 0, 1).transformDirection(pause.object.matrixWorld);
  aim(f, f.right, pause.cap.getWorldPosition(new THREE.Vector3()), normal);
  const sequence = f.runtime.getControlFeedback(pause.id).sequence;
  select(f, f.right, 'squeezestart'); select(f, f.right, 'squeezeend'); advance(f);
  assert.equal(f.runtime.getControlFeedback(pause.id).sequence, sequence, 'Grip never operates physical panel buttons.');
  press(f, 'powerOn', f.right);
  const center = first.bounds.getCenter(new THREE.Vector3()).applyMatrix4(first.object.matrixWorld);
  aim(f, f.left, center);
  const obstacle = wall(f, center.clone().add(new THREE.Vector3(0, 0, 0.35))); advance(f);
  select(f, f.left, 'squeezestart'); select(f, f.left, 'squeezeend'); advance(f);
  assert.equal(first.heldBy, null, 'Grip cannot pick a box through a solid wall.'); removeWall(f, obstacle);
  pickup(f, first.object, f.left);
  select(f, f.left, 'squeezestart'); select(f, f.left, 'squeezeend'); advance(f);
  assert.equal(first.heldBy, f.left, 'Grip-up does not release a load picked with the trigger.');
  select(f, f.left, 'selectstart'); select(f, f.left, 'selectend'); advance(f);
  assert.equal(first.heldBy, null);
  grip(f, first.object, f.left);
  f.ctx.raycontrol.disable(); advance(f);
  assert.equal(first.heldBy, null, 'Disabling XR interaction cancels grip ownership.');
  f.ctx.raycontrol.enable();
  grip(f, first.object, f.left);
  f.runtime.onInputModeChange();
  assert.equal(first.heldBy, null);
  f.visuals.dispose(); f.runtime.stop();
  assert.deepEqual(counts(f.left), initial[0]); assert.deepEqual(counts(f.right), initial[1]);
  assert.equal(JSON.stringify(await f.document.serialize()), authored);
  assert.equal(f.runtime.productGripInputs.size, 0);
}

async function sourceToQueue() {
  const f = setup();
  [f.head, f.tail, f.unrelated].forEach(object => f.document.remove(object));
  f.cartons.forEach(object => f.document.remove(object));
  f.head = f.document.addPrefab('hall', 'source');
  f.document.setTransform(f.head, {position: [0, 1, 0]});
  f.document.setBehaviors(f.head, f.document.getBehaviors(f.head).map(config => config.type === 'source' ?
    Object.assign({}, config, {initialCount: 1, autoGenerate: false, delivery: 'manual'}) : config));
  f.tail = f.document.addPrefab('hall', 'palletQueue');
  f.document.setTransform(f.tail, {position: [4, 1, 0]});
  f.document.setBehaviors(f.tail, f.document.getBehaviors(f.tail).map(config => config.type === 'palletQueue' ?
    Object.assign({}, config, {capacity: 2, columns: 1, rows: 1, layers: 2, delivery: 'manual'}) : config));
  f.scene.updateMatrixWorld(true); f.ctx.collisionWorld.invalidate();
  const authored = JSON.stringify(await f.document.serialize());
  f.runtime.start('hall'); advance(f);
  const source = f.runtime.records.get(f.head.userData.editorId).components.source;
  const product = grip(f, source.queue[0].product.object, f.left);
  assert.equal(vars(f).delivered, 1); assert.equal(vars(f).queued, 0);
  const record = f.runtime.records.get(f.tail.userData.editorId);
  const candidate = f.runtime.palletQueueRuntime.placement(record, product);
  assert(candidate);
  carry(f, product, f.left, candidate.matrix);
  assert(f.runtime.palletQueueRuntime.findPlacement(product).accepted);
  select(f, f.left, 'squeezeend'); advance(f);
  assert.equal(product.heldBy, null); assert.equal(product.item.palletOwnerId, record.id);
  assert.equal(vars(f, f.tail).received, 1);
  grip(f, product.object, f.right);
  assert.equal(vars(f, f.tail).delivered, 1);
  assert.equal(vars(f).delivered, 1, 'The second grip retains original source accounting and product identity.');
  away(f, f.right); select(f, f.right, 'squeezeend'); advance(f);
  assert.equal(product.heldBy, null);
  f.visuals.dispose(); f.runtime.stop();
  assert.equal(JSON.stringify(await f.document.serialize()), authored);
}

async function run() {
  await controlsAndLifecycle();
  await sourceToQueue();
  console.log('Product WebXR grip: real bilateral hold/release, fixed orientation, trigger isolation, obstruction, optional grip, source-to-pallet flow, disconnect/reconnect, mode cancellation and exact cleanup passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
