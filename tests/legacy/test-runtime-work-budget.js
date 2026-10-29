const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const schema = require('../../modules/logistica-industrial/contracts/behaviors'), {Document} = require('./test-vehicle-storage'), {Runtime} = require('./test-robot-runtime');
const VehicleRuntime = require('../support/load-vehicle-runtime')(THREE), study = require('../support/load-study-scenes')(THREE, schema, Document);

// Real scene, runtime and meshes. The reference uses the previous full actor
// tree propagation; both runs keep every fixed logic step and every actor.
const scene = new THREE.Scene(), root = new THREE.Group(); scene.add(root);
const document = new Document({scene}); document.registerRoom('hall', root); study.studySceneBase(document, 'hall');
study.buildStudyScene(document, 'hall', 'forklift-training', {scene});
const context = {scene, editor: {active: false}, raycontrol: {states: {}, addState(name, state) {this.states[name] = state;}, activateState() {}, deactivateState() {}}};
const runtime = new Runtime(context, document); runtime.vehicleRuntime = new VehicleRuntime(runtime); scene.updateMatrixWorld(true);
const selective = runtime.syncActorMatrices;
function run(reference) {
  runtime.start('hall');
  if (reference) runtime.syncActorMatrices = function () {
    const actors = new Set(Array.from(this.records.values(), record => record.object));
    actors.forEach(object => {for (let parent = object.parent; parent; parent = parent.parent) if (actors.has(parent)) return; object.updateWorldMatrix(true, true);});
  }; else runtime.syncActorMatrices = selective;
  for (let index = 0; index < 3; index++) runtime.execute(1 / 60);
  let calls = 0; const original = THREE.Object3D.prototype.updateWorldMatrix;
  THREE.Object3D.prototype.updateWorldMatrix = function (...args) {calls++; return original.apply(this, args);};
  const started = performance.now();
  try {for (let frame = 0; frame < 60; frame++) runtime.execute(1 / 60);} finally {THREE.Object3D.prototype.updateWorldMatrix = original;}
  const result = {calls, ms: performance.now() - started, objects: runtime.getSnapshot().objects, time: runtime.time,
    products: [...runtime.products.values()].map(product => runtime.productMetadata(product)).map(meta => ({units: meta.units, mass: meta.mass, loadMode: meta.loadMode}))};
  runtime.stop(); return result;
}
const before = run(true), after = run(false);
assert.equal(after.time, before.time); assert.deepEqual(after.objects, before.objects); assert.deepEqual(after.products, before.products);
assert(after.calls < before.calls * .65, 'Idle/parked actors must avoid traversing their entire detailed mesh trees at every fixed step.');

// Nested motion/sensor actors and non-actor ancestors retain exact world
// transforms. Read matrices directly: getWorldPosition would hide a stale tree.
const scene2 = new THREE.Scene(), ancestor = new THREE.Group(), actor = new THREE.Group(), sensor = new THREE.Group(), volume = new THREE.Mesh(new THREE.BoxBufferGeometry(.2, .2, .2));
scene2.add(ancestor); ancestor.add(actor); actor.add(sensor); sensor.add(volume); actor.userData.editorId = 'moving-parent'; sensor.userData.editorId = 'nested-sensor'; volume.position.set(.2, .3, .4);
const doc = {getRoot: () => scene2, getObjects: () => [actor, sensor], getBehaviors: object => [Object.assign(schema.defaultBehavior(object === actor ? 'motion' : 'sensor'), object === actor ? {speed: 0} : {})]};
const nested = new Runtime({scene: scene2, editor: {active: false}}, doc); scene2.updateMatrixWorld(true); nested.start('hall'); nested.syncActorMatrices();
const verify = () => {const point = volume.position.clone().applyMatrix4(sensor.matrixWorld), actual = new THREE.Vector3().setFromMatrixPosition(volume.matrixWorld); assert(actual.distanceTo(point) < 1e-9);};
sensor.position.x = 1.2; nested.syncActorMatrices(); verify();
ancestor.position.set(4, 1, -2); ancestor.rotation.y = .7; ancestor.scale.set(1.2, .9, 1.1); nested.syncActorMatrices(); verify();
const parent = new THREE.Group(); parent.position.set(-2, .5, 4); ancestor.add(parent); parent.add(sensor); nested.syncActorMatrices(); verify();
sensor.matrixAutoUpdate = false; sensor.matrix.makeTranslation(3, 2, 1); nested.syncActorMatrices(); verify();
const added = new THREE.Group(); added.position.set(.9, .8, .7); sensor.add(added); nested.syncActorMatrices(); assert(new THREE.Vector3().setFromMatrixPosition(added.matrixWorld).distanceTo(added.position.clone().applyMatrix4(sensor.matrixWorld)) < 1e-9);
nested.stop();

// A closed panel must not allocate a complete machine/event snapshot. The
// public tick(snapshot) path and recording completion behavior stay supported.
const panelSource = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-runtime-work-budget.js"), '../src/editor/SimulationPanel.js')), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class SimulationPanel', 'return class SimulationPanel');
const Panel = new Function(panelSource)(); let snapshots = 0, paints = 0, captures = 0, notices = 0;
const panel = {opened: false, lastPaint: -Infinity, recorder: {active: false, capture() {captures++;}}, editor: {simulation: {time: 0, getSnapshot() {snapshots++; return {time: this.time};}}, toast() {notices++;}}, render(force, snapshot) {paints++; this.lastPaint = snapshot.time;}};
for (let frame = 0; frame < 180; frame++) {panel.editor.simulation.time = frame / 90; Panel.prototype.tick.call(panel);}
assert.equal(snapshots, 0); assert.equal(paints, 0); panel.opened = true;
for (let frame = 0; frame < 180; frame++) {panel.editor.simulation.time = 2 + frame / 90; Panel.prototype.tick.call(panel);}
assert(snapshots >= 7 && snapshots <= 9); assert.equal(paints, snapshots);
panel.opened = false; panel.recorder.active = true; const initial = snapshots;
for (let frame = 0; frame < 90; frame++) {panel.editor.simulation.time += 1 / 90; Panel.prototype.tick.call(panel);}
assert.equal(captures, 90); assert.equal(snapshots - initial, 90);
panel.recorder.capture = function () {this.active = false; this.payload = {complete: true};}; Panel.prototype.tick.call(panel); assert(panel.payload.complete); assert.equal(notices, 1); assert.equal(panel.saved, false);
const count = snapshots; Panel.prototype.tick.call(panel, {time: 12}); assert.equal(snapshots, count);
console.log('Runtime work budget: exact eleven-vehicle state/units, nested actor/ancestor/manual-matrix/reparent updates, closed/open/recorded panel behavior passed.');
console.log(JSON.stringify({reference: {matrixCalls: before.calls, ms: before.ms}, optimized: {matrixCalls: after.calls, ms: after.ms}, matrixReduction: 1 - after.calls / before.calls, snapshotRequestsWhenClosed: 0}));
