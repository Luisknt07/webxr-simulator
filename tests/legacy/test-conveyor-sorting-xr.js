const __layout = require("../../tooling/layout.cjs");
// Bilateral production WebXR trigger rays with real physical placement. Only
// hardware/canvas boundaries are adapted by the shared industrial XR harness.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const text = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-conveyor-sorting-xr.js"), 'test-industrial-xr.js')), 'utf8'), start = text.indexOf('async function run()');
assert(start > 0);
const harness = new Function('require', '__dirname', text.slice(0, start) + '\nreturn {setup,advance,aim,away,select,press,vars,pickup};')(require, __dirname);
const {advance, aim, away, select, press, vars, pickup} = harness;

function setup() {
  const f = harness.setup();
  [f.head, f.tail, f.unrelated].forEach(object => f.document.remove(object));
  f.head = f.document.addPrefab('hall', 'conveyor', 'roller-tee-split');
  f.document.setTransform(f.head, {position: [0, 1.02, 0]});
  f.document.setBehaviors(f.head, f.document.getBehaviors(f.head).map(config => config.type === 'conveyor' ? Object.assign({}, config,
    {length: 3, width: .8, autoSpawn: false, powered: true, running: false, withSensors: true, withPanel: true, routing: 'rules',
      routingRules: JSON.stringify([{field: 'quality', operator: 'eq', value: 'defective', route: 'branch'},
        {field: 'color', operator: 'eq', value: '#ff0000', route: 'branch'}, {field: 'productType', operator: 'eq', value: 'crate', route: 'main'}])}) : config));
  f.cartons.forEach((object, index) => {
    f.document.setTransform(object, {position: [-4 + index * 1.5, 1.3, 5], rotation: [0, 0, 0]});
    f.document.setBehaviors(object, f.document.getBehaviors(object).map(config => config.type === 'product' ? Object.assign({}, config,
      {sku: index ? 'manual_blue' : 'manual_red', productType: index ? 'crate' : 'box', color: index ? '#0000ff' : '#ff0000',
        quality: index ? 'good' : 'defective', defect: index ? 'none' : 'surface'}) : config));
  });
  f.scene.updateMatrixWorld(true); f.ctx.collisionWorld.invalidate(); return f;
}
function belt(f) { return f.runtime.records.get(f.head.userData.editorId).components.conveyor; }
function carryTo(f, product, hand, center) {
  hand.rotation.set(0, 0, 0); hand.position.y = 2.5; advance(f, .15);
  hand.position.set(center.x, 2.5, center.z + product.holdDistance); advance(f, .15);
  const offset = product.bounds.getCenter(new THREE.Vector3()).applyMatrix3(new THREE.Matrix3().setFromMatrix4(product.holdMatrix));
  hand.position.y = center.y - offset.y + .025; advance(f, .15);
}
function deposit(f, product, hand, distance = .35, route = 'main') {
  const record = f.runtime.records.get(f.head.userData.editorId), b = belt(f), point = f.runtime.pathPoint(b.config, distance, route);
  const center = f.runtime.pathSurface(record, b, point).add(new THREE.Vector3(0, product.bounds.getSize(new THREE.Vector3()).multiply(product.scale).y / 2 + .012, 0));
  carryTo(f, product, hand, center);
  assert(f.runtime.findProductBelt(product), 'The tracked hand must physically reach the roller surface.');
  select(f, hand, 'selectstart'); select(f, hand, 'selectend'); advance(f);
  assert.equal(product.heldBy, null); assert.equal(product.item.beltId, f.head.userData.editorId);
}

async function run() {
  const f = setup(), authored = JSON.stringify(await f.document.serialize());
  const originalSelect = f.ctx.raycontrol.onSelectStart, nativeStart = f.nativeState.onSelectStart, nativeEnd = f.nativeState.onSelectEnd;
  const listeners = Object.fromEntries(Object.entries(f.ctx.raycontrol._listeners).map(([key, entries]) => [key, entries.length]));
  f.runtime.start('hall'); advance(f);
  assert.equal(f.ctx.raycontrol.controllers.length, 2);
  const red = pickup(f, f.cartons[0], f.left), originalMesh = red.object, classification = f.runtime.productMetadata(red);
  assert.equal(classification.sku, 'manual_red'); assert.equal(classification.quality, 'defective'); assert.equal(classification.defect, 'surface');
  assert.equal(classification.color, '#ff0000');
  deposit(f, red, f.left); assert.equal(red.item.route, 'branch'); assert.equal(belt(f).routedBranch, 1); assert.equal(belt(f).routedMain, 0);
  assert.equal(red.object, originalMesh); assert.equal(red.item.mesh, f.cartons[0]);
  // Take the same accepted load with the other hand. Its frozen admission
  // decision survives manual removal and redeposit on the shared inlet.
  pickup(f, originalMesh, f.right); deposit(f, red, f.right);
  assert.equal(red.item.route, 'branch'); assert.equal(belt(f).routedBranch, 1); assert.equal(belt(f).entryCount, 1);
  assert.deepEqual(f.runtime.productMetadata(red), classification);
  pickup(f, originalMesh, f.left); carryTo(f, red, f.left, new THREE.Vector3(-4, 1.5, 5));
  const blue = pickup(f, f.cartons[1], f.right); deposit(f, blue, f.right);
  assert.equal(blue.item.route, 'main'); assert.equal(belt(f).routedMain, 1); assert.equal(belt(f).routingUnmatched, 0);
  assert.equal(blue.item.mesh, f.cartons[1]); assert.equal(f.runtime.productMetadata(blue).productType, 'crate');
  assert.deepEqual(f.native, {starts: 0, ends: 0, backgroundStarts: 0, backgroundEnds: 0}, 'Sorter product trigger capture must not fire native portal/background input.');
  press(f, 'start', f.right); assert(vars(f).running); press(f, 'pause', f.right); assert(vars(f).paused);
  assert(f.pulses.some(value => value.handedness === 'left') && f.pulses.some(value => value.handedness === 'right'));
  away(f, f.right);
  f.visuals.dispose(); f.runtime.stop();
  assert.equal(f.ctx.raycontrol.onSelectStart, originalSelect); assert.equal(f.nativeState.onSelectStart, nativeStart); assert.equal(f.nativeState.onSelectEnd, nativeEnd);
  assert.equal(f.runtime.held.size, 0); assert(!Object.keys(f.ctx.raycontrol.states).some(name => name.startsWith(f.runtime.statePrefix)));
  Object.entries(f.ctx.raycontrol._listeners).forEach(([key, entries]) => assert.equal(entries.length, listeners[key] || 0));
  assert.equal(JSON.stringify(await f.document.serialize()), authored, 'Sorter XR restores authored poses, metadata and native input exactly.');
  console.log('Conveyor sorting WebXR: real bilateral trigger pickup/deposit, immutable color/quality/SKU attributes, fixed branch decisions on recapture, private controls, native input isolation and exact cleanup passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
