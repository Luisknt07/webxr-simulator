const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const schema = require('../../modules/logistica-industrial/contracts/behaviors.js'), h = require('./test-robot-runtime.js');
const read = file => fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-robot-checkpoint.js"), '../src', file)), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const visuals = new Function('THREE', 'behaviorSchema', read('editor/IndustrialPrefabs.js') + '\nreturn {createProductVisual,createSourceProductVisual};')(THREE, schema);
const checkpoint = new Function('THREE', 'createProductVisual', 'createSourceProductVisual', read('studio/SimulationCheckpoint.js') + '\nreturn {captureSimulation,restoreSimulation,productIdentity};')(THREE, visuals.createProductVisual, visuals.createSourceProductVisual);
const Presentation = new Function('THREE', 'productIdentity', read('studio/RemotePresentation.js').replace('default class RemotePresentation', 'return class RemotePresentation'))(THREE, checkpoint.productIdentity);
const record = f => f.runtime.records.get(f.robot.userData.editorId);
const refresh = f => { f.r = record(f).components.robot; f.input = f.runtime.records.get(f.source.userData.editorId).components.source; f.result = f.runtime.records.get(f.output.userData.editorId).components.source; };
const clean = value => JSON.parse(JSON.stringify(value, (key, item) => typeof item === 'number' ? Math.round(item * 1e9) / 1e9 : item));
function canonical(f) {
  f.scene.updateMatrixWorld(true); f.runtime.refreshVariables();
  const tool = f.runtime.robotRuntime.tool(record(f)); tool.updateWorldMatrix(true, true);
  const rig = f.r.visualRoot.userData.robotRig;
  return clean({time: f.runtime.time, events: f.runtime.events, variables: Array.from(f.runtime.records.values(), value => [value.id, value.variables]),
    phase: f.r.phase, elapsed: f.r.phaseElapsed, pose: f.r.pose, gripSpan: f.r.pose.gripSpan, tool: tool.matrixWorld.toArray(), chassis: f.robot.matrixWorld.toArray(), routeIndex: f.r.routeIndex,
    renderedJoints: rig.joints.filter(Boolean).map(joint => joint.matrixWorld.toArray()), jaws: rig.fingers.map(finger => finger.position.toArray()),
    counts: [f.input.queue.length, f.result.queue.length, f.r.received, f.r.completed, f.r.receivedUnits, f.r.deliveredUnits],
    products: Array.from(f.runtime.products.values(), product => [product.sourceEntry.id, product.object.matrixWorld.toArray(), product.object.parent.name,
      product.robotOwnerId || '', product.robotReservedBy || '', product.robotProcessedBy ? Array.from(product.robotProcessedBy) : []]).sort()});
}
function roundtrip(f, seconds = .7) {
  const saved = JSON.parse(JSON.stringify(checkpoint.captureSimulation(f.runtime))), initial = canonical(f);
  h.advance(f, seconds); const expected = canonical(f);
  checkpoint.restoreSimulation(f.runtime, saved); refresh(f);
  assert.deepEqual(canonical(f), initial, 'A paused/moving rig and its tool-relative load restore at the exact authored execution pose.');
  const held = f.r.entry && f.r.entry.product;
  if (held) { assert.equal(held.object.industrialHeld, true); assert.equal(held.object.userData.robotOwnerId, f.robot.userData.editorId); assert.equal(held.object.parent, f.runtime.robotRuntime.tool(record(f))); }
  h.advance(f, seconds); assert.deepEqual(canonical(f), expected, 'Resumed robot execution must match an uninterrupted timeline.');
  return saved;
}
function checkTransport(f) { h.until(f, () => f.r.completed === 3, 60); assert.equal(h.sum(f), 3); assert.equal(f.r.receivedUnits, f.r.deliveredUnits); f.runtime.stop(); }

const moving = h.fixture(); h.until(moving, () => moving.r.phase === 'carry' && moving.r.phaseElapsed > .08); roundtrip(moving); checkTransport(moving);
const paused = h.fixture(); h.until(paused, () => paused.r.phase === 'carry' && paused.r.phaseElapsed > .08);
paused.runtime.command(paused.robot.userData.editorId, 'pause'); roundtrip(paused); assert(paused.r.paused); paused.runtime.command(paused.robot.userData.editorId, 'pause'); checkTransport(paused);
const setup = h.fixture('articulated', {setupTime: 2}); h.until(setup, () => setup.r.phase === 'setup' && setup.r.phaseElapsed > .2); roundtrip(setup, .3); checkTransport(setup);
const mobile = h.fixture('amr', {speed: 1, waypointsJson: '[{"x":0,"z":2},{"x":2,"z":2}]'});
h.until(mobile, () => mobile.r.phase === 'drive-output' && mobile.r.distance > .2, 30); roundtrip(mobile, .3); checkTransport(mobile);
const process = h.fixture('articulated', {tool: 'process', operation: 'process', processTime: 1.5});
h.until(process, () => process.r.phase === 'process-inplace' && process.r.phaseElapsed > .1); const owner = process.input.queue[0].ownerId;
roundtrip(process, .2); assert.equal(process.input.queue[0].ownerId, owner); assert.equal(process.r.entry, null);
h.until(process, () => process.r.completed === 1 && process.r.phase === 'idle'); assert.equal(process.input.queue.length, 3);
assert.equal(process.input.queue[0].processHistory.length, 1); process.runtime.stop();

const shared = h.fixture(); h.until(shared, () => shared.r.phase === 'carry' && shared.r.phaseElapsed > .08);
const presentation = new Presentation(), held = shared.r.entry.product;
presentation.before(shared.runtime); h.advance(shared, .04);
const authoritative = checkpoint.captureSimulation(shared.runtime), expected = canonical(shared);
const observer = h.fixture(); observer.runtime.stop();
[['source', shared.source], ['output', shared.output], ['robot', shared.robot]].forEach(([key, source]) => {
  const object = observer[key]; object.userData.editorId = source.userData.editorId; object.name = source.name;
  observer.configs.set(object, JSON.parse(JSON.stringify(shared.configs.get(source))));
});
observer.scene.updateMatrixWorld(true); observer.runtime.start('hall'); refresh(observer);
const remote = new Presentation(); remote.before(observer.runtime);
checkpoint.restoreSimulation(observer.runtime, JSON.parse(JSON.stringify(authoritative)), {reuse: true}); refresh(observer); remote.after(observer.runtime); remote.tick(observer.runtime);
assert.deepEqual(canonical(observer), expected, 'A separate observer sees the same joint meshes, jaws, robot tool, cargo, counters and host clock.');
remote.clear(); checkTransport(observer);
checkpoint.restoreSimulation(shared.runtime, JSON.parse(JSON.stringify(authoritative)), {reuse: true}); refresh(shared);
presentation.after(shared.runtime); presentation.tick(shared.runtime);
assert.equal(shared.r.entry.product, held, 'Shared checkpoint reuses the physical load identity.');
assert.equal(Array.from(presentation.blends.values()).some(blend => blend.product === held), false, 'A retained load is positioned by its robot, never independently interpolated away from the tool.');
assert.deepEqual(canonical(shared), expected); presentation.clear(); checkTransport(shared);
console.log('Robot checkpoint: moving/paused tool and grip, setup, mobile route, in-situ dwell, shared ownership and lossless continuation passed.');
