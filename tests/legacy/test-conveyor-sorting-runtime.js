const __layout = require("../../tooling/layout.cjs");
// Actual modular prefabs, path geometry, document bindings and collision sweeps.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const THREE = require('three');
const ObjectPlacement = require('../support/load-object-placement')(THREE);
const behaviorSchema = require('../../modules/logistica-industrial/contracts/behaviors.js');
const automationSchema = require('../../modules/logistica-industrial/functions/flujo-materiales/schema/automation.js');
const ProcessorRuntime = require('../support/load-processor-runtime.js')(THREE, behaviorSchema);
const ProductSourceRuntime = require('../support/load-product-source-runtime')(THREE, behaviorSchema);
const PalletQueueRuntime = require('../support/load-pallet-queue-runtime.js')(THREE, behaviorSchema);
const {ProjectStore} = require('../../apps/api/server/storage.js');
const {getGeometryTree} = require('../support/load-geometry-acceleration.js')(THREE);
const layout = behaviorSchema.conveyorLayout;
function source(file) { return fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-conveyor-sorting-runtime.js"), '..', file)), 'utf8').replace(/^\uFEFF/, '').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''); }
const prefabs = new Function('THREE', 'behaviorSchema', source("modules/logistica-industrial/functions/presentacion/runtime/IndustrialPrefabs.js") + '\nreturn {createIndustrialPrefab,createProductVisual};')(THREE, behaviorSchema);
const SceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', source("packages/project-model/src/SceneDocument.js").replace('default class SceneDocument', 'return class SceneDocument'))(THREE, behaviorSchema, prefabs.createIndustrialPrefab);
const ProductFeedback = new Function('THREE', source("modules/logistica-industrial/functions/flujo-materiales/runtime/ProductFeedback.js").replace('default class ProductFeedback', 'return class ProductFeedback'))(THREE);
const Runtime = new Function('THREE', 'behaviorSchema', 'automationSchema', 'createProductVisual', 'ProductFeedback', 'ObjectPlacement', 'ProductSourceRuntime', 'ProcessorRuntime', 'PalletQueueRuntime', source("modules/logistica-industrial/functions/flujo-materiales/runtime/SimulationRuntime.js").replace('default class SimulationRuntime', 'return class SimulationRuntime'))(THREE, behaviorSchema, automationSchema, prefabs.createProductVisual, ProductFeedback, ObjectPlacement, ProductSourceRuntime, ProcessorRuntime, PalletQueueRuntime);
const CollisionWorld = new Function('THREE', 'getGeometryTree', source("packages/render-three/src/CollisionWorld.js").replace('default class CollisionWorld', 'return class CollisionWorld'))(THREE, getGeometryTree);
function setup() {
  const scene = new THREE.Scene(), root = new THREE.Group(); scene.add(root);
  const floor = new THREE.Mesh(new THREE.BoxBufferGeometry(100, 0.05, 100), new THREE.MeshBasicMaterial()); floor.position.y = -0.025; root.add(floor);
  const document = new SceneDocument({}); document.registerRoom('hall', root);
  const notices = [], ctx = {scene, editor: {active: false}, raycontrol: {states: {}, addState(name, state) { this.states[name] = state; }, activateState() {}, deactivateState() {}}};
  ctx.collisionWorld = new CollisionWorld(ctx, document);
  const runtime = new Runtime(ctx, document, notice => notices.push(notice));
  return {scene, root, document, ctx, runtime, notices};
}
function config(f, object) { return f.document.getBehaviors(object).find(value => value.type === 'conveyor'); }
function update(f, object, values) { f.document.setBehaviors(object, [Object.assign({}, config(f, object), values)]); }
function add(f, values = {}, position = [0, 1.02, 0]) {
  const object = f.document.addPrefab('hall', 'conveyor');
  update(f, object, Object.assign({length: 2, speed: 2, running: true, powered: true, autoSpawn: false, role: 'middle', withPallet: false, withPanel: false, withSensors: false}, values));
  f.document.setTransform(object, {position}); return object;
}
function addPalletQueue(f, values = {}, position = [0, 1.02, 0]) {
  const object = f.document.addPrefab('hall', 'palletQueue'), config = f.document.getBehaviors(object).find(value => value.type === 'palletQueue');
  f.document.setBehaviors(object, [Object.assign({}, config, values)]); f.document.setTransform(object, {position}); return object;
}
function stock(f, object) { return f.runtime.records.get(object.userData.editorId).components.palletQueue; }
function connect(f, sourceObject, target, sourcePort = 'output', targetPort = 'input') {
  update(f, sourceObject, sourcePort === 'branch' ? {branchId: target.userData.editorId, branchPort: targetPort} : {outputId: target.userData.editorId, outputPort: targetPort});
  f.scene.updateMatrixWorld(true);
  const targetConfig = f.document.getBehaviors(target).find(value => value.type === 'conveyor' || value.type === 'palletQueue');
  const targetPorts = targetConfig.type === 'palletQueue' ? layout.palletQueueLayout(targetConfig) : layout.ports(targetConfig);
  const from = layout.ports(config(f, sourceObject))[sourcePort], to = targetPorts[targetPort];
  const parentInverse = new THREE.Matrix4().getInverse(target.parent.matrixWorld);
  const direction = new THREE.Vector3(from.tx, 0, from.tz).applyMatrix3(new THREE.Matrix3().setFromMatrix4(sourceObject.matrixWorld))
    .applyMatrix3(new THREE.Matrix3().setFromMatrix4(parentInverse)).normalize();
  const yaw = Math.atan2(-direction.z, direction.x) - Math.atan2(-to.tz * target.scale.z, to.tx * target.scale.x);
  const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw || 0);
  const position = new THREE.Vector3(from.x, 0, from.z).applyMatrix4(sourceObject.matrixWorld).applyMatrix4(parentInverse)
    .sub(new THREE.Vector3(to.x, 0, to.z).multiply(target.scale).applyQuaternion(quaternion));
  f.document.setTransform(target, {position: position.toArray(), quaternion: quaternion.toArray()});
}
function advance(f, seconds) {
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) {
    f.scene.updateMatrixWorld(true); f.ctx.collisionWorld.beginFrame(); f.runtime.execute(Math.min(1 / 60, seconds - t)); f.ctx.collisionWorld.endFrame();
  }
}
function vars(f, object) { return f.runtime.records.get(object.userData.editorId).variables; }
function belt(f, object) { return f.runtime.records.get(object.userData.editorId).components.conveyor; }
function retained(f) { return Array.from(f.runtime.products.keys()); }
function equivalent(actual, expected, location = 'document') {
  if (typeof expected === 'number') return assert(Math.abs(actual - expected) < 1e-12, 'Numeric persistence drift at ' + location);
  if (!expected || typeof expected !== 'object') return assert.equal(actual, expected, location);
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), 'Saved fields at ' + location);
  Object.keys(expected).forEach(key => equivalent(actual[key], expected[key], location + '.' + key));
}
function noOverlaps(f) {
  const boxes = [];
  f.runtime.records.forEach(record => {
    const b = record.components.conveyor, q = record.components.palletQueue;
    if (b) b.packages.forEach(item => boxes.push(item.box));
    if (q) q.items.forEach(item => boxes.push(item.box));
  });
  for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) assert(!boxes[a].clone().expandByScalar(-0.002).intersectsBox(boxes[b].clone().expandByScalar(-0.002)), 'Boxes on connected modules must not overlap.');
}

function machine(f, kind, values = {}, position = [0, 1.02, 0]) {
  const object = f.document.addPrefab('hall', kind), cfg = f.document.getBehaviors(object).find(value => value.type === kind);
  const defaults = kind === 'source' ? {autoGenerate: false, initialCount: 0, outputInterval: .1} :
    {running: true, powered: true, setupTime: 0, processTime: .1, delivery: 'manual'};
  f.document.setBehaviors(object, [Object.assign({}, cfg, defaults, values)]);
  f.document.setTransform(object, {position}); return object;
}
function sourceTo(f, from, to) {
  const cfg = f.document.getBehaviors(from).find(value => value.type === 'source');
  f.document.setBehaviors(from, [Object.assign({}, cfg, {outputId: to.userData.editorId, outputPort: 'input', delivery: 'automatic'})]);
  const outlet = behaviorSchema.productSources.layout(cfg).outlet, inlet = layout.ports(config(f, to)).input;
  f.scene.updateMatrixWorld(true);
  const destination = new THREE.Vector3(inlet.x, 0, inlet.z).applyMatrix4(to.matrixWorld).sub(new THREE.Vector3(outlet.x, 0, outlet.z));
  f.document.setTransform(from, {position: destination.toArray()});
}
function rec(f, object) { return f.runtime.records.get(object.userData.editorId); }
function src(f, object) { return rec(f, object).components.source; }
function productRow(id, color, type = 'box', quality = 'good', defect = 'none') {
  return {id, name: id, type, width: .2, height: .2, depth: .2, color, quality, defect};
}
function sorter(f, values = {}) {
  const tee = add(f, Object.assign({layout: 'tee', junctionMode: 'split', width: .8, length: 3}, values));
  const main = add(f), branch = add(f), mainStore = addPalletQueue(f), branchStore = addPalletQueue(f);
  connect(f, tee, main); connect(f, tee, branch, 'branch'); connect(f, main, mainStore); connect(f, branch, branchStore);
  return {tee, main, branch, mainStore, branchStore};
}

async function run() {
  const f = setup(), line = sorter(f, {routing: 'rules', routingRules: JSON.stringify([
    {field: 'quality', operator: 'eq', value: 'defective', route: 'branch'},
    {field: 'color', operator: 'eq', value: '#ff0000', route: 'branch'},
    {field: 'productType', operator: 'eq', value: 'bottle', route: 'main'}
  ])});
  const rows = [productRow('red', '#ff0000'), productRow('reject', '#00ff00', 'box', 'defective', 'surface'),
    productRow('bottle', '#00ffff', 'bottle'), productRow('regular', '#0000ff')];
  const sourceObject = machine(f, 'source', {generationMode: 'sequence', catalog: JSON.stringify(rows), initialCount: 4});
  sourceTo(f, sourceObject, line.tee);
  const before = JSON.stringify(await f.document.serialize()); f.runtime.start('hall');
  const entries = src(f, sourceObject).queue.slice();
  advance(f, 12);
  assert.equal(vars(f, line.tee).routedBranch, 2); assert.equal(vars(f, line.tee).routedMain, 2);
  assert.equal(vars(f, line.tee).routingUnmatched, 1);
  assert.equal(vars(f, line.tee).entryCount, 4); assert.equal(vars(f, line.mainStore).queued, 2); assert.equal(vars(f, line.branchStore).queued, 2);
  assert.deepEqual(stock(f, line.branchStore).queue.map(entry => entry.spec.id).sort(), ['red', 'reject']);
  assert.deepEqual(stock(f, line.mainStore).queue.map(entry => entry.spec.id).sort(), ['bottle', 'regular']);
  entries.forEach(entry => assert(stock(f, line.mainStore).queue.includes(entry) || stock(f, line.branchStore).queue.includes(entry), 'The same inventory entry reaches its chosen destination.'));
  assert.equal(stock(f, line.branchStore).queue.find(entry => entry.spec.id === 'reject').spec.defect, 'surface');
  noOverlaps(f); f.runtime.stop(); equivalent(JSON.parse(JSON.stringify(await f.document.serialize())), JSON.parse(before));

  const blocked = setup(), blockedLine = sorter(blocked, {routing: 'rules', routingRules: JSON.stringify([{field: 'sku', operator: 'eq', value: 'reject', route: 'branch'}])});
  update(blocked, blockedLine.branch, {powered: false, running: false});
  const rejection = machine(blocked, 'source', {generationMode: 'sequence', catalog: JSON.stringify([rows[1]]), initialCount: 1}); sourceTo(blocked, rejection, blockedLine.tee);
  blocked.runtime.start('hall'); advance(blocked, 7);
  assert.equal(vars(blocked, blockedLine.tee).routedBranch, 1); assert.equal(vars(blocked, blockedLine.tee).routedMain, 0);
  const waiting = belt(blocked, blockedLine.tee).packages[0]; assert(waiting); assert.equal(waiting.route, 'branch');
  for (let index = 0; index < 40; index++) blocked.runtime.transferDetails(rec(blocked, blockedLine.tee), belt(blocked, blockedLine.tee), waiting);
  advance(blocked, 3); assert.equal(vars(blocked, blockedLine.tee).routedBranch, 1); assert.equal(vars(blocked, blockedLine.mainStore).queued, 0);
  blocked.runtime.setVariable(blockedLine.branch.userData.editorId, 'powered', true); blocked.runtime.command(blockedLine.branch.userData.editorId, 'start');
  advance(blocked, 7); assert.equal(vars(blocked, blockedLine.branchStore).queued, 1); assert.equal(vars(blocked, blockedLine.tee).routedBranch, 1); blocked.runtime.stop();

  const percentages = setup(), split = sorter(percentages, {routing: 'percentage', branchPercentage: 30});
  const input = machine(percentages, 'source', {initialCount: 20, capacity: 24}); sourceTo(percentages, input, split.tee);
  percentages.runtime.start('hall'); advance(percentages, 28);
  assert.equal(vars(percentages, split.tee).entryCount, 20); assert.equal(vars(percentages, split.tee).routedBranch, 6); assert.equal(vars(percentages, split.tee).routedMain, 14);
  assert.equal(vars(percentages, split.branchStore).queued, 6); assert.equal(vars(percentages, split.mainStore).queued, 14); noOverlaps(percentages); percentages.runtime.stop();

  const manual = setup(), manualTee = add(manual, {layout: 'tee', junctionMode: 'split', width: .8, length: 3, routing: 'rules',
    routingRules: JSON.stringify([{field: 'sku', operator: 'eq', value: 'manual_red', route: 'branch'}])});
  const box = manual.document.addPrimitive('hall', 'box');
  manual.document.setBehaviors(box, [{type: 'product', sku: 'manual_red', productType: 'box', color: '#ff0000', quality: 'defective', defect: 'damaged'}]);
  manual.document.setTransform(box, {position: [8, .5, 0], scale: [.2, .2, .2]});
  const original = JSON.stringify(await manual.document.serialize()); manual.runtime.start('hall');
  const product = manual.runtime.products.get(box), r = rec(manual, manualTee), b = belt(manual, manualTee);
  assert.equal(manual.runtime.productMetadata(product).sku, 'manual_red');
  assert(manual.runtime.captureProduct(product, {record: r, belt: b, offset: -manual.runtime.pathLength(b.config) / 2, lateral: 0, route: 'main'}));
  assert.equal(product.item.route, 'branch'); assert.equal(b.routedBranch, 1);
  const hand = new THREE.Group(); manual.scene.add(hand); hand.position.set(8, 3, 0);
  assert(manual.runtime.pickupProduct(product, hand));
  product.heldBy = null; manual.runtime.held.clear();
  assert(manual.runtime.captureProduct(product, {record: r, belt: b, offset: -manual.runtime.pathLength(b.config) / 2, lateral: 0, route: 'main'}));
  assert.equal(b.routedBranch, 1); assert.equal(b.routeSequence, 1); assert.equal(product.item.route, 'branch');
  // A load placed by hand beyond the fork follows its physical leg. The
  // classifier must not drag it sideways back through the diverter.
  const sideMesh = prefabs.createProductVisual(.2); sideMesh.position.set(8, 2, 0); manual.root.add(sideMesh); manual.scene.updateMatrixWorld(true);
  const sideProduct = manual.runtime.registerProduct(sideMesh);
  const sideDistance = manual.runtime.pathLength(b.config, 'branch') - .4;
  assert(manual.runtime.captureProduct(sideProduct, {record: r, belt: b, offset: sideDistance - manual.runtime.pathLength(b.config, 'branch') / 2, lateral: 0, route: 'branch'}));
  assert.equal(sideProduct.item.route, 'branch'); assert.equal(sideProduct.routingDecisions.get(r.id).reason, 'manual');
  manual.runtime.disposePackage(sideProduct.item);
  manual.runtime.stop(); equivalent(JSON.parse(JSON.stringify(await manual.document.serialize())), JSON.parse(original));

  const namedMixed = setup(), literalTee = add(namedMixed, {layout: 'tee', junctionMode: 'split', length: 3, width: .8, running: false, routing: 'rules',
    routingRules: JSON.stringify([{field: 'sku', operator: 'eq', value: 'mixed', route: 'branch'}])});
  const literalBox = namedMixed.document.addPrefab('hall', 'product');
  namedMixed.document.setTransform(literalBox, {position: [8, 1, 0]});
  namedMixed.document.setBehaviors(literalBox, namedMixed.document.getBehaviors(literalBox).map(value => value.type === 'product' ? Object.assign({}, value, {sku: 'mixed'}) : value));
  namedMixed.runtime.start('hall');
  const literalProduct = namedMixed.runtime.products.get(literalBox), literalBelt = belt(namedMixed, literalTee);
  assert(namedMixed.runtime.captureProduct(literalProduct, {record: rec(namedMixed, literalTee), belt: literalBelt, offset: -1.5, lateral: 0, route: 'main'}));
  assert.equal(literalProduct.item.route, 'branch'); assert.equal(literalBelt.routedBranch, 1); namedMixed.runtime.stop();

  const quality = setup(), generated = machine(quality, 'source', {initialCount: 10, capacity: 10, defectRate: 40, seed: 167});
  quality.runtime.start('hall'); const firstRun = src(quality, generated).queue.map(entry => [entry.spec.quality, entry.spec.defect]);
  assert(firstRun.some(row => row[0] === 'defective') && firstRun.some(row => row[0] === 'good'));
  for (let attempt = 0; attempt < 20; attempt++) assert(!quality.runtime.sourceRuntime.generate(rec(quality, generated)));
  assert.deepEqual(src(quality, generated).queue.map(entry => [entry.spec.quality, entry.spec.defect]), firstRun);
  quality.runtime.stop(); quality.runtime.start('hall'); assert.deepEqual(src(quality, generated).queue.map(entry => [entry.spec.quality, entry.spec.defect]), firstRun); quality.runtime.stop();

  const composition = setup(), process = machine(composition, 'processor', {mode: 'combiner', combineCount: 2}), sourceA = machine(composition, 'source', {initialCount: 1, color: '#ff0000'}),
    sourceB = machine(composition, 'source', {initialCount: 1, color: '#00ff00', quality: 'defective', defect: 'dimension'}, [0, 1.02, 8]);
  composition.runtime.start('hall');
  const inputA = src(composition, sourceA).queue[0], inputB = src(composition, sourceB).queue[0], runtime = composition.runtime;
  inputA.spec.id = 'mixed'; inputB.spec.id = 'other';
  const combined = runtime.processorRuntime.combine(rec(composition, process), [inputA, inputB])[0];
  const pseudo = {sourceEntry: combined, classification: {}, bounds: runtime.sourceRuntime.loadBounds(combined), scale: new THREE.Vector3(1, 1, 1)};
  const summary = runtime.productMetadata(pseudo); assert.equal(summary.color, 'mixed'); assert.equal(summary.quality, 'defective'); assert.equal(summary.defect, 'dimension'); assert.equal(summary.units, 2);
  assert.equal(summary.sku, undefined); assert(!behaviorSchema.conveyorRouting.matches({field: 'sku', operator: 'neq', value: 'mixed'}, summary), 'A heterogenous SKU composition is unavailable, not the valid literal SKU mixed.');
  assert(!behaviorSchema.conveyorRouting.matches({field: 'color', operator: 'neq', value: '#ff0000'}, summary), 'Mixed lots cannot satisfy a negative color condition.');
  const separated = runtime.processorRuntime.split(rec(composition, process), combined, 2);
  assert.deepEqual(separated.map(entry => entry.spec.color).sort(), ['#00ff00', '#ff0000']);
  assert.deepEqual(separated.map(entry => entry.spec.quality).sort(), ['defective', 'good']);
  runtime.stop();
  console.log('Conveyor sorting runtime: color, SKU, quality, type, default rules, actual branch transfers, balanced percentages, fixed backpressure choices, manual recapture, seeded quality, composition and exact cleanup passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });

