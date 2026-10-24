// Reuse the industrial XR harness: production WebXR controller events, native
// index.js input bridge, RayControl, collision world and real simulation logic.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const harnessText = fs.readFileSync(path.join(__dirname, 'test-industrial-xr.js'), 'utf8');
const testStart = harnessText.indexOf('async function run()');
assert(testStart > 0, 'The shared production XR harness must expose its setup before running assertions.');
const harness = new Function('require', '__dirname', harnessText.slice(0, testStart) + '\nreturn {setup,advance,aim,away,button,select,press,vars,pickup,close};')(require, __dirname);
const {advance, aim, away, button, select, press, vars, pickup, close} = harness;

function setup() {
  const f = harness.setup();
  [f.head, f.tail, f.unrelated].forEach(object => f.document.remove(object));
  f.head = f.document.addPrefab('hall', 'processor');
  f.unrelated = f.document.addPrefab('hall', 'processor', 'combiner');
  f.document.setTransform(f.head, {position: [0, 1, 0]});
  f.document.setTransform(f.unrelated, {position: [0, 1, 9]});
  f.document.setBehaviors(f.head, f.document.getBehaviors(f.head).map(config => config.type === 'processor' ? Object.assign({}, config,
    {processTime: 1.5, setupTime: 0.5, setupPolicy: 'startup', requiresOperator: true, operatorAvailable: false, delivery: 'manual'}) : config));
  f.cartons.forEach((object, index) => f.document.setTransform(object, {position: [-4 + index * 1.5, 1.3, 5], rotation: [0, 0, 0]}));
  f.scene.updateMatrixWorld(true); f.ctx.collisionWorld.invalidate();
  return f;
}
function processor(f) { return f.runtime.records.get(f.head.userData.editorId).components.processor; }
function inputCenter(f, product) {
  const record = f.runtime.records.get(f.head.userData.editorId), machine = processor(f);
  return product.bounds.clone().applyMatrix4(f.runtime.sourceRuntime.frontMatrix(record, product.bounds, product.scale, machine.input.position)).getCenter(new THREE.Vector3());
}
function tryPickup(f, object, hand) {
  const product = f.runtime.products.get(object), center = product.bounds.getCenter(new THREE.Vector3()).applyMatrix4(object.matrixWorld);
  aim(f, hand, center); select(f, hand, 'selectstart'); select(f, hand, 'selectend'); advance(f);
  return product;
}
function deposit(f, object, hand) {
  const product = pickup(f, object, hand), center = inputCenter(f, product);
  hand.rotation.set(0, 0, 0); hand.position.y = 2.5; advance(f, 0.15);
  hand.position.set(center.x, 2.5, center.z + product.holdDistance); advance(f, 0.15);
  // XR retains the authored box origin and basis. Its holding offset is 25 mm
  // below the tracked hand, so place that origin above the receiver's deck.
  hand.position.y = center.y + 0.025; advance(f, 0.15);
  assert(f.runtime.processorRuntime.findInput(product).accepted, 'Physical held-box placement must find a free, valid processor inlet.');
  select(f, hand, 'selectstart'); select(f, hand, 'selectend'); advance(f);
  return product;
}

async function run() {
  const f = setup(), authored = JSON.stringify(await f.document.serialize());
  const originalSelect = f.ctx.raycontrol.onSelectStart, nativeStart = f.nativeState.onSelectStart, nativeEnd = f.nativeState.onSelectEnd;
  const listeners = Object.fromEntries(Object.entries(f.ctx.raycontrol._listeners).map(([key, entries]) => [key, entries.length]));
  f.runtime.start('hall'); advance(f);
  assert.equal(f.ctx.raycontrol.controllers.length, 2);
  assert(f.left.getObjectByName('raycasterContext') && f.right.getObjectByName('raycasterContext'));
  assert.equal(vars(f).state, 'OFF');
  press(f, 'powerOn', f.left); assert(vars(f).powered); assert.equal(vars(f).running, false, 'Power-on alone never starts the process.');
  press(f, 'start', f.right); assert(vars(f).running);
  press(f, 'pause', f.left); assert(vars(f).paused);
  press(f, 'start', f.right); assert(!vars(f).paused && vars(f).running);
  press(f, 'stop', f.left); assert.equal(vars(f).running, false);
  press(f, 'powerOff', f.right); assert(!vars(f).powered && !vars(f).running);
  press(f, 'start', f.left); assert(!vars(f).running, 'The actual XR panel respects the power interlock.');
  press(f, 'powerOn', f.right); press(f, 'start', f.left);
  press(f, 'emergency', f.right); assert(vars(f).emergency && !vars(f).running);
  press(f, 'start', f.left); assert(!vars(f).running, 'Neither tracked hand can start an emergency-latched machine.');
  press(f, 'resetEmergency', f.right); assert(!vars(f).emergency && !vars(f).running, 'Rearming never starts motion automatically.');
  press(f, 'operator', f.left); assert(vars(f).operatorAvailable);
  press(f, 'operator', f.right); assert(!vars(f).operatorAvailable);
  press(f, 'dispatch', f.left); assert.equal(vars(f).exitCount, 0, 'Dispatching an empty processor cannot fabricate output.');
  assert.equal(vars(f, f.unrelated).powered, false); assert.equal(vars(f, f.unrelated).operatorAvailable, false);
  assert.deepEqual(f.native, {starts: 0, ends: 0, backgroundStarts: 0, backgroundEnds: 0}, 'Captured processor panel actions never leak into native background input.');
  assert(f.pulses.some(pulse => pulse.handedness === 'left') && f.pulses.some(pulse => pulse.handedness === 'right'));

  // Two hands pressing the same mechanical operator cap produce one toggle.
  const operator = button(f, 'operator'), normal = new THREE.Vector3(0, 0, 1).transformDirection(operator.object.matrixWorld);
  aim(f, f.left, operator.cap.getWorldPosition(new THREE.Vector3()), normal); aim(f, f.right, operator.cap.getWorldPosition(new THREE.Vector3()), normal);
  const sequence = f.runtime.getControlFeedback(operator.id).sequence;
  select(f, f.left, 'selectstart'); select(f, f.right, 'selectstart'); advance(f, 0.08);
  assert.equal(vars(f).operatorAvailable, true); assert.equal(f.runtime.getControlFeedback(operator.id).sequence, sequence + 1);
  select(f, f.left, 'selectend'); advance(f, 0.08); assert(f.runtime.getControlFeedback(operator.id).pressed);
  select(f, f.right, 'selectend'); advance(f, 0.3); assert(!f.runtime.getControlFeedback(operator.id).pressed); close(operator.cap.position.z, 0.025, 0.0001);
  press(f, 'operator', f.right); assert.equal(vars(f).operatorAvailable, false);
  press(f, 'powerOff', f.left);

  // Deposit one authored product with actual tracked-hand motion and trigger
  // events. The processor then owns exactly one immutable handling identity.
  const deposited = deposit(f, f.cartons[0], f.left), entry = deposited.sourceEntry;
  assert.equal(deposited.heldBy, null); assert.equal(f.runtime.held.size, 0);
  assert.equal(vars(f).entryCount, 1); assert.equal(vars(f).queued, 1);
  assert.equal(processor(f).input.queue[0], entry); assert.equal(entry.ownerId, f.head.userData.editorId);
  assert.equal(deposited.processorLocked, true);
  tryPickup(f, deposited.object, f.right); tryPickup(f, deposited.object, f.left);
  assert.equal(deposited.heldBy, null, 'Neither tracked hand can steal an accepted input before processing.');
  assert.equal(processor(f).input.queue.length, 1); assert.equal(vars(f).entryCount, 1);
  press(f, 'powerOn', f.left); press(f, 'start', f.right);
  assert.equal(vars(f).state, 'WAITING_OPERATOR'); assert.equal(vars(f).completed, 0);
  press(f, 'operator', f.left); assert(vars(f).settingUp); assert.equal(deposited.processorLocked, true);
  advance(f, 0.2); assert.equal(vars(f).state, 'PROCESSING');
  assert.equal(deposited.object.visible, false, 'A processing load is hidden inside the machine and remains unavailable to tracked rays.');
  assert.equal(processor(f).jobs[0].inputs[0], entry); assert.equal(entry.ownerId, f.head.userData.editorId);
  assert(!processor(f).input.queue.includes(entry) && !processor(f).output.queue.includes(entry), 'A load cannot be owned by input, work and output simultaneously.');
  advance(f, 1.6);
  assert.equal(vars(f).completed, 1); assert.equal(vars(f).outputQueued, 1);
  assert.equal(processor(f).output.queue[0], entry); assert.equal(entry.product.object, f.cartons[0]);
  assert.equal(entry.product.processorLocked, false); assert.equal(entry.product.object.visible, true);
  const output = pickup(f, f.cartons[0], f.right);
  assert.equal(output, deposited); assert.equal(vars(f).exitCount, 1); assert.equal(vars(f).deliveredUnits, 1);
  assert.equal(vars(f).outputQueued, 0); assert.equal(entry.ownerId, '');
  tryPickup(f, output.object, f.left);
  assert.equal(output.heldBy, f.right); assert.equal(f.runtime.held.get(f.right), output); assert.equal(vars(f).exitCount, 1);
  f.right.rotation.set(0, 0, 0); f.right.position.y = 2.5; advance(f, 0.15);
  f.right.position.set(4, 2.5, 5); advance(f, 0.15);
  select(f, f.right, 'selectstart'); select(f, f.right, 'selectend'); advance(f);
  assert.equal(output.heldBy, null); assert.equal(vars(f).entryCount, 1, 'A release away from the inlet cannot duplicate its receipt.');

  // Leave immersive play with a box held and a physical button still down.
  pickup(f, f.cartons[1], f.left);
  const activeButton = button(f, 'operator'); aim(f, f.right, activeButton.cap.getWorldPosition(new THREE.Vector3()), normal);
  select(f, f.right, 'selectstart'); advance(f, 0.08); assert(f.runtime.getControlFeedback(activeButton.id).pressed);
  f.visuals.dispose(); f.runtime.stop(); f.ctx.editor.active = true;
  assert.equal(f.runtime.held.size, 0); assert.equal(f.ctx.raycontrol.onSelectStart, originalSelect);
  assert.equal(f.nativeState.onSelectStart, nativeStart); assert.equal(f.nativeState.onSelectEnd, nativeEnd);
  assert.equal(f.ctx.raycontrol.states['native-portal'], f.nativeState); assert.equal(f.ctx.raycontrol.states['native-background'], f.nativeBackground);
  assert(!Object.keys(f.ctx.raycontrol.states).some(name => name.startsWith(f.runtime.statePrefix)));
  Object.entries(f.ctx.raycontrol._listeners).forEach(([key, entries]) => assert.equal(entries.length, listeners[key] || 0));
  assert.equal((f.ctx.renderer.domElement._listeners.wheel || []).length, 0);
  assert.equal(f.runtime.productFeedback.bindings.size, 0); assert.equal(f.runtime.productFeedback.root.parent, null);
  assert(!f.scene.children.some(object => object.name === 'Feedback de productos'));
  assert.equal(JSON.stringify(await f.document.serialize()), authored, 'All authored poses, IDs, visibility, machine properties and control links restore exactly.');
  console.log('Processor WebXR: real bilateral controller rays and nine physical controls, interlocks, single-owner buttons, manual inlet deposit, locked process identity, output pickup and exact play cleanup passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
