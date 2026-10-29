const __layout = require("../../tooling/layout.cjs");
// Connected equipment resizing uses real document transactions, factory ports
// and Three.js parent matrices. No browser or user project is involved.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const schema = require('../../modules/logistica-industrial/contracts/behaviors');
const read = file => fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-conveyor-reflow.js"), '../src/editor', file)), 'utf8').replace(/^import .*;\r?\n/gm, '');
const createIndustrialPrefab = new Function('THREE', 'behaviorSchema', read('IndustrialPrefabs.js')
  .replace(/export const /g, 'const ').replace(/export function /g, 'function ') + '\nreturn createIndustrialPrefab;')(THREE, schema);
const SceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', read('SceneDocument.js')
  .replace('export default class SceneDocument', 'return class SceneDocument'))(THREE, schema, createIndustrialPrefab);
const ConveyorAssembly = new Function('THREE', 'conveyorLayout', read('ConveyorAssembly.js')
  .replace('export default class ConveyorAssembly', 'return class ConveyorAssembly'))(THREE, schema.conveyorLayout);
const clone = value => JSON.parse(JSON.stringify(value));
const near = (a, b, label, epsilon = 1e-6) => assert(Math.abs(a - b) <= epsilon, label + ': ' + a + ' / ' + b);

function setup() {
  const root = new THREE.Group(), document = new SceneDocument({});
  document.registerRoom('hall', root);
  const editor = {root, document, roomId: 'hall'}, assembly = new ConveyorAssembly(editor);
  const config = object => assembly.config(object);
  const add = (kind = 'conveyor', variant = 'roller-motor', patch = {}) => {
    const object = document.addPrefab('hall', kind, kind === 'conveyor' ? variant : undefined);
    document.setBehaviors(object, document.getBehaviors(object).map(value => value.type === kind ? Object.assign({}, value,
      {withPanel: false, withSensors: false, autoSpawn: false}, patch) : value));
    document.setTransform(object, {position: [0, 1, 0]});
    return object;
  };
  const patch = (object, values) => {
    const previous = config(object), next = assembly.adaptReflowConfig(previous, Object.assign({}, previous, values));
    document.setBehaviors(object, document.getBehaviors(object).map(value => value.type === previous.type ? next : value));
  };
  const connect = (source, target, sourcePort = 'output', targetPort = 'input') => {
    document.begin();
    assembly.align(source, sourcePort, target, targetPort);
    const pair = assembly.pair(target, targetPort, source, sourcePort);
    assert(pair && assembly.connect(pair), 'Fixture connects actual compatible physical interfaces.');
    document.commit();
  };
  const assertJoined = () => assembly.edges().forEach(edge => {
    const out = assembly.worldPort(edge.source, edge.sourcePort), input = assembly.worldPort(edge.target, edge.targetPort);
    assert(out && input && !out.incoming && input.incoming);
    assert(out.position.distanceTo(input.position) < .0001, 'Connected surface endpoints coincide: ' + edge.source.name + ' -> ' + edge.target.name);
    assert(out.tangent.dot(input.tangent) > .9999, 'Flow tangents agree.');
  });
  const plan = (snapshot, mode = 'geometry') => assembly.planReflow(snapshot, {mode, normalizeBehaviors: schema.normalizeBehaviors});
  return {root, document, assembly, config, add, patch, connect, assertJoined, plan};
}

async function perform(f, object, mutate, mode = 'geometry') {
  const snapshot = f.assembly.captureReflow(object), depth = f.document.undoStack.length;
  f.document.begin(); mutate();
  const beforePlan = f.document._fingerprint(f.document.capture());
  const plan = f.plan(snapshot, mode);
  assert.equal(f.document._fingerprint(f.document.capture()), beforePlan, 'Planning never mutates config or poses.');
  assert(plan.ok, plan.message);
  f.assembly.applyReflow(plan); f.document.commit(); f.assertJoined();
  assert.equal(f.document.undoStack.length, depth + 1, 'The edit, width changes and all poses share one undo entry.');
  return plan;
}

async function run() {
  {
    const f = setup(), source = f.add('source'), first = f.add(), machine = f.add('processor'), next = f.add(), stock = f.add('palletQueue');
    f.connect(source, first); f.connect(first, machine); f.connect(machine, next); f.connect(next, stock);
    const outsider = f.add(), product = f.document.addPrimitive('hall', 'box');
    f.document.setTransform(outsider, {position: [40, 1, 20]});
    const untouched = clone([f.config(source), f.config(machine), f.config(stock)]), productScale = product.scale.clone(), unrelated = outsider.position.clone();
    const sourcePose = source.position.clone(), inlet = f.assembly.worldPort(first, 'input').position.clone();
    const before = await f.document.serialize();
    f.assembly.align = () => { throw new Error('The solver must not call generic magnetic alignment.'); };
    const plan = await perform(f, first, () => f.patch(first, {length: 6}));
    assert.equal(plan.anchorId, source.userData.editorId);
    assert(source.position.equals(sourcePose), 'The predecessor stays fixed.');
    assert(f.assembly.worldPort(first, 'input').position.distanceTo(inlet) < 1e-6, 'The edited inlet remains on its predecessor.');
    assert.deepEqual([f.config(source), f.config(machine), f.config(stock)], untouched, 'Source product catalog, processor settings and storage capacities stay intact.');
    assert(product.scale.equals(productScale)); assert(outsider.position.equals(unrelated));
    const after = await f.document.serialize();
    f.document.undo(); assert.deepEqual(await f.document.serialize(), before, 'Undo restores complete geometry, graph and poses.');
    f.document.redo(); assert.deepEqual(await f.document.serialize(), after, 'Redo restores the reflow exactly.'); f.assertJoined();
  }
  {
    const f = setup(), first = f.add(), next = f.add(), stock = f.add('palletQueue');
    f.connect(first, next); f.connect(next, stock);
    const inlet = f.assembly.worldPort(first, 'input');
    await perform(f, first, () => f.patch(first, {length: 7}));
    assert(f.assembly.worldPort(first, 'input').position.distanceTo(inlet.position) < 1e-6, 'Without a predecessor, preserve the old input rather than the object centre.');
    const pose = first.position.clone().add(new THREE.Vector3(4, 0, -3));
    await perform(f, first, () => f.document.setTransform(first, {position: pose.toArray(), rotation: [0, .63, 0]}), 'transform');
    assert(first.position.equals(pose), 'An explicit transform keeps the user-edited anchor pose.');
    near(first.rotation.y, .63, 'Explicit anchor yaw');
  }
  for (const axis of ['x', 'z']) for (const side of ['left', 'right']) {
    const f = setup(), source = f.add('source'), first = f.add('conveyor', 'roller-motor', {axis}),
      corner = f.add('conveyor', 'popup-belt', {axis, length: 1, width: 1, branchSide: side, routing: 'branch'}),
      exit = f.add(), stock = f.add('palletQueue');
    f.connect(source, first); f.connect(first, corner); f.connect(corner, exit, 'branch'); f.connect(exit, stock);
    const catalog = clone(f.config(source)), stockSettings = clone(f.config(stock));
    const plan = await perform(f, first, () => f.patch(first, {width: 1.4}));
    assert(plan.behaviorChanges.length >= 2);
    for (const object of [first, corner, exit]) near(f.config(object).width, 1.4, 'Connected conveyor width');
    near(f.config(corner).length, 1.4, 'A compact transfer remains square');
    assert.deepEqual(f.config(source), catalog); assert.deepEqual(f.config(stock), stockSettings);
  }
  {
    const f = setup(), source = f.add('source'), first = f.add(), corner = f.add('conveyor', 'popup-belt', {length: 1, width: 1, routing: 'branch'}),
      exit = f.add(), stock = f.add('palletQueue');
    f.connect(source, first); f.connect(first, corner); f.connect(corner, exit, 'branch'); f.connect(exit, stock);
    const snapshot = f.assembly.captureReflow(corner), sourceConfig = clone(f.config(source)), queueConfig = clone(f.config(stock));
    const baseline = snapshot.entries.map(entry => ({object: entry.object, position: entry.pose.position.clone(), quaternion: entry.pose.quaternion.clone()}));
    f.document.begin();
    for (const stretch of [2, 1.5, 1, 1.8, 1]) {
      // TransformControls reuses pointer-down dimensions, while previous preview
      // poses/configurations are still live on the neighbors.
      f.document.setTransform(corner, {scale: [stretch, 1, 1]});
      const beforePlan = f.document._fingerprint(f.document.capture()), plan = f.plan(snapshot);
      assert(plan.ok, plan.message);
      assert.equal(f.document._fingerprint(f.document.capture()), beforePlan);
      f.assembly.applyReflow(plan); f.assertJoined();
      near(f.config(first).width, 1, 'Longitudinal corner scale never widens the incoming leg');
      near(f.config(exit).width, stretch, 'Only the corner lateral interface widens its outgoing leg');
      near(f.config(corner).width, 1, 'Explicit scale is not converted into arbitrary local width changes');
      near(f.assembly.worldPort(corner, 'branch').width, f.assembly.worldPort(exit, 'input').width, 'Actual branch widths agree');
      assert.deepEqual(f.config(source), sourceConfig); assert.deepEqual(f.config(stock), queueConfig);
    }
    baseline.forEach(entry => {
      assert(entry.object.position.distanceTo(entry.position) < 1e-6, 'Returning a preview to baseline restores every neighbor position.');
      assert(1 - Math.abs(entry.object.quaternion.dot(entry.quaternion)) < 1e-7, 'Preview yaw never accumulates.');
    });
    f.document.commit();
    const widthSnapshot = f.assembly.captureReflow(first);
    f.document.begin();
    for (const width of [1.6, 1.2, 1]) {
      f.patch(first, {width}); const plan = f.plan(widthSnapshot); assert(plan.ok, plan.message);
      f.assembly.applyReflow(plan); f.assertJoined();
      for (const object of [first, corner, exit]) near(f.config(object).width, width, 'Repeated width preview restores neighbor settings from the original capture');
      near(f.config(corner).length, width, 'Repeated width preview preserves the square corner');
    }
    f.document.commit();
  }
  {
    const f = setup(), source = f.add('source'), tee = f.add('conveyor', 'distributor', {length: 2.4}), main = f.add(), branch = f.add(),
      stockA = f.add('palletQueue'), stockB = f.add('palletQueue');
    f.connect(source, tee); f.connect(tee, main); f.connect(tee, branch, 'branch'); f.connect(main, stockA); f.connect(branch, stockB);
    await perform(f, main, () => f.patch(main, {width: 1.5}));
    near(f.config(tee).length, 3, 'Wider T preserves its physical minimum');
    near(f.config(tee).width, 1.5, 'Wider T interface');
    near(f.assembly.worldPort(main, 'input').width, f.assembly.worldPort(tee, 'output').width, 'Main effective width');
    near(f.assembly.worldPort(branch, 'input').width, f.assembly.worldPort(tee, 'branch').width, 'Branch effective width');
  }
  {
    const f = setup(), sourceA = f.add('source'), feedA = f.add(), sourceB = f.add('source'), feedB = f.add(),
      merge = f.add('conveyor', 'merge-angle'), machine = f.add('processor'), stock = f.add('palletQueue');
    f.connect(sourceA, feedA); f.connect(feedA, merge); f.connect(merge, feedB, 'branch', 'output');
    // A merge's branch is incoming, so write its supplier link in the actual direction.
    assert.equal(f.config(feedB).outputId, merge.userData.editorId);
    f.connect(feedB, sourceB, 'input', 'output'); f.connect(merge, machine); f.connect(machine, stock);
    const anchor = feedA.position.clone(), sourceBPosition = sourceB.position.clone(), sourceBConfig = clone(f.config(sourceB));
    await perform(f, merge, () => f.patch(merge, {mergeAngle: 70, length: 4}));
    assert(feedA.position.equals(anchor), 'The main predecessor anchors a multi-input junction.');
    assert(!sourceB.position.equals(sourceBPosition), 'The entire secondary supply branch is realigned.');
    assert.deepEqual(f.config(sourceB), sourceBConfig);
  }
  {
    const f = setup(), source = f.add('source'), curve = f.add('conveyor', 'roller-curve', {radius: .7}), exit = f.add(), stock = f.add('palletQueue');
    f.connect(source, curve); f.connect(curve, exit); f.connect(exit, stock);
    f.root.position.set(5, 2, -4); f.root.rotation.y = .47; f.root.scale.setScalar(1.25); f.root.updateMatrixWorld(true);
    const scales = [source, curve, exit, stock].map(object => object.scale.toArray());
    await perform(f, curve, () => f.patch(curve, {width: 1.5}));
    near(f.config(curve).radius, .85, 'Curve radius grows only to its physical width clearance');
    assert.deepEqual([source, curve, exit, stock].map(object => object.scale.toArray()), scales, 'Parent transforms never cause arbitrary local scaling.');
    await perform(f, exit, () => f.document.setTransform(exit, {scale: [1.6, 1, 1]}), 'transform');
    assert.deepEqual(exit.scale.toArray(), [1.6, 1, 1], 'Only the expressly edited machine retains the requested scale.');
    assert.deepEqual([source, curve, stock].map(object => object.scale.toArray()), [scales[0], scales[1], scales[3]]);
  }
  {
    const f = setup(), ring = Array.from({length: 4}, () => f.add('conveyor', 'roller-curve', {radius: 1.5}));
    for (let index = 1; index < ring.length; index++) f.connect(ring[index - 1], ring[index]);
    f.document.begin(); assert(f.assembly.connect(f.assembly.pair(ring[0], 'input', ring[3], 'output'))); f.document.commit(); f.assertJoined();
    const before = await f.document.serialize(), snapshot = f.assembly.captureReflow(ring[1]);
    f.document.begin(); f.patch(ring[1], {radius: 2});
    const beforePlan = f.document._fingerprint(f.document.capture()), conflict = f.plan(snapshot);
    assert.equal(conflict.ok, false); assert.equal(conflict.conflicts[0].code, 'cycle');
    assert.equal(f.document._fingerprint(f.document.capture()), beforePlan, 'A failed closure changes no planned neighbor.');
    f.document.cancel(); assert.deepEqual(await f.document.serialize(), before, 'A closed-loop conflict rolls back the original edit as well.');
    const pose = ring[0].position.clone().add(new THREE.Vector3(4, 0, 5));
    await perform(f, ring[0], () => f.document.setTransform(ring[0], {position: pose.toArray(), rotation: [0, .27, 0]}), 'transform');
    assert(ring[0].position.equals(pose), 'A consistent closed circuit may move rigidly as one connected graph.');
  }
  {
    const f = setup(), first = f.add(), narrow = f.add('conveyor', 'roller-motor', {width: 2});
    f.document.setTransform(narrow, {scale: [1, 1, .5]}); f.connect(first, narrow);
    const before = await f.document.serialize(), snapshot = f.assembly.captureReflow(first);
    f.document.begin(); f.patch(first, {width: 2});
    const conflict = f.plan(snapshot); assert.equal(conflict.ok, false); assert.equal(conflict.conflicts[0].code, 'width');
    f.document.cancel(); assert.deepEqual(await f.document.serialize(), before, 'An impossible neighbor width never changes products or silently clamps dimensions.');
  }
  {
    const f = setup(), source = f.add('source'), first = f.add(), next = f.add(); f.connect(source, first); f.connect(first, next);
    const before = await f.document.serialize(), snapshot = f.assembly.captureReflow(first);
    f.document.begin(); f.patch(first, {supportHeight: 1.3});
    const rejected = f.plan(snapshot); assert.equal(rejected.ok, false); assert.equal(rejected.conflicts[0].code, 'support-height');
    f.document.cancel(); assert.deepEqual(await f.document.serialize(), before, 'Changing supports never silently puts feet below the floor.');
    const standalone = f.add();
    await perform(f, standalone, () => { f.patch(standalone, {supportHeight: 1.3}); f.document.setTransform(standalone, {position: [0, 1.3, 0]}); }, 'transform');
    near(standalone.position.y - f.config(standalone).supportHeight, 0, 'A coherent explicit support/height edit may keep its known floor contact.');
  }
  {
    const f = setup(), ring = Array.from({length: 4}, () => f.add('conveyor', 'popup-belt', {length: 1, width: 1, routing: 'branch'}));
    for (let index = 1; index < ring.length; index++) f.connect(ring[index - 1], ring[index], 'branch');
    f.document.begin(); assert(f.assembly.connect(f.assembly.pair(ring[0], 'input', ring[3], 'branch'))); f.document.commit(); f.assertJoined();
    const before = await f.document.serialize(), snapshot = f.assembly.captureReflow(ring[0]);
    f.document.begin(); f.document.setTransform(ring[0], {scale: [2, 1, 1]});
    const rejected = f.plan(snapshot, 'transform'); assert.equal(rejected.ok, false); assert.equal(rejected.conflicts[0].code, 'width-cycle');
    f.document.cancel(); assert.deepEqual(await f.document.serialize(), before, 'A loop cannot demand two distinct effective widths on one homogeneous belt.');
  }
  {
    const f = setup(), first = f.add(), next = f.add(); f.connect(first, next);
    f.root.scale.set(2, 1, 1); f.root.updateMatrixWorld(true);
    const before = await f.document.serialize(), snapshot = f.assembly.captureReflow(first);
    f.document.begin(); f.document.setTransform(first, {rotation: [0, .4, 0]});
    const rejected = f.plan(snapshot, 'transform'); assert.equal(rejected.ok, false); assert.equal(rejected.conflicts[0].code, 'pose');
    f.document.cancel(); assert.deepEqual(await f.document.serialize(), before, 'Unrepresentable shear never deforms a neighbor to force alignment.');
  }
  {
    const f = setup(), first = f.add(), next = f.add(); f.connect(first, next);
    const before = await f.document.serialize(), snapshot = f.assembly.captureReflow(first);
    f.document.begin(); f.patch(first, {length: 5}); const plan = f.plan(snapshot); assert(plan.ok);
    f.document.setTransform(next, {position: next.position.clone().add(new THREE.Vector3(0, 0, 1)).toArray()});
    const fingerprint = f.document._fingerprint(f.document.capture());
    assert.throws(() => f.assembly.applyReflow(plan), /cambi/);
    assert.equal(f.document._fingerprint(f.document.capture()), fingerprint, 'A stale plan is rejected before the first write.');
    f.document.cancel(); assert.deepEqual(await f.document.serialize(), before);
    assert.throws(() => f.assembly.applyReflow(plan), /transacci/);
  }
  {
    const f = setup(), first = f.add(), next = f.add(); f.connect(first, next);
    const before = await f.document.serialize(), snapshot = f.assembly.captureReflow(first);
    f.document.begin(); f.patch(first, {outputId: ''});
    const plan = f.plan(snapshot); assert.equal(plan.ok, false); assert.equal(plan.conflicts[0].code, 'topology');
    f.document.cancel(); assert.deepEqual(await f.document.serialize(), before, 'Explicit connect/detach is never treated as a dimensional edit.');
  }
  {
    const f = setup(), source = f.add('source'), first = f.add(), corner = f.add('conveyor', 'popup-belt', {length: 1, width: 1, routing: 'branch'}),
      exit = f.add(), stock = f.add('palletQueue');
    f.connect(source, first); f.connect(first, corner); f.connect(corner, exit, 'branch'); f.connect(exit, stock);
    // Emulate a previously saved document edited before connected resizing:
    // anchor already wide, corner/narrow outlet unchanged, and physical gaps.
    f.patch(first, {width: 1.4});
    f.document.setTransform(corner, {position: corner.position.clone().add(new THREE.Vector3(.35, 0, .2)).toArray()});
    const before = await f.document.serialize(), depth = f.document.undoStack.length, snapshot = f.assembly.captureReflow(first);
    const ids = f.document.getObjects('hall').map(object => object.userData.editorId);
    const controls = f.document.getObjects('hall').map(object => [object.userData.editorId,
      f.document.getBehaviors(object).filter(value => value.type === 'control')]).filter(([, values]) => values.length);
    const links = f.assembly.edges().map(edge => [edge.source.userData.editorId, edge.sourcePort, edge.targetId, edge.targetPort]);
    assert(controls.length, 'Exercise the existing physical PLC command bindings.');
    f.document.begin();
    const automatic = f.plan(snapshot);
    assert.equal(automatic.ok, false, 'A no-change snapshot does not silently trigger width repair.');
    const repair = f.assembly.planReflow(snapshot, {mode: 'geometry', forceWidthFit: true, normalizeBehaviors: schema.normalizeBehaviors});
    assert(repair.ok, repair.message); assert(repair.behaviorChanges.length >= 2);
    f.assembly.applyReflow(repair); f.document.commit(); f.assertJoined();
    assert.equal(f.document.undoStack.length, depth + 1, 'Explicit repair is one reversible edit.');
    near(f.config(first).width, 1.4, 'Repair preserves the existing anchor width');
    near(f.config(corner).width, 1.4, 'Repair fits a previously mismatched corner');
    near(f.config(corner).length, 1.4, 'Repair keeps the existing corner compact');
    near(f.config(exit).width, 1.4, 'Repair fits the downstream outlet');
    assert.deepEqual(f.document.getObjects('hall').map(object => object.userData.editorId), ids, 'Repair preserves every logical identity.');
    assert.deepEqual(f.document.getObjects('hall').map(object => [object.userData.editorId,
      f.document.getBehaviors(object).filter(value => value.type === 'control')]).filter(([, values]) => values.length), controls,
      'Repair preserves PLC actions, target IDs and control scope.');
    assert.deepEqual(f.assembly.edges().map(edge => [edge.source.userData.editorId, edge.sourcePort, edge.targetId, edge.targetPort]), links,
      'Repair never creates, removes or rewrites connections.');
    f.document.undo(); assert.deepEqual(await f.document.serialize(), before, 'Undo restores even the original legacy misalignment exactly.');
  }
  console.log('Connected reflow: pure plans, anchored resizing, heterogeneous flow graphs, effective widths, square L/T/curve limits, merges, scaled parents, closed-loop rejection/rigid motion, stale guards and atomic undo/redo passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
