const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const behaviorSchema = require('../../modules/logistica-industrial/contracts/behaviors');
const automationSchema = require('../../modules/logistica-industrial/functions/flujo-materiales/schema/automation');
const ObjectPlacement = require('../support/load-object-placement')(THREE);
function source(file) { return fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-simulation-checkpoint.js"), '..', file)), 'utf8').replace(/^\uFEFF/, '').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''); }
const prefabs = new Function('THREE', 'behaviorSchema', source("modules/logistica-industrial/functions/presentacion/runtime/IndustrialPrefabs.js") + '\nreturn {createIndustrialPrefab,createProductVisual,createSourceProductVisual};')(THREE, behaviorSchema);
const SceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', source("packages/project-model/src/SceneDocument.js").replace('default class SceneDocument', 'return class SceneDocument'))(THREE, behaviorSchema, prefabs.createIndustrialPrefab);
const ProductFeedback = new Function('THREE', source("modules/logistica-industrial/functions/flujo-materiales/runtime/ProductFeedback.js").replace('default class ProductFeedback', 'return class ProductFeedback'))(THREE);
const ProductSourceRuntime = require('../support/load-product-source-runtime')(THREE, behaviorSchema);
const PalletQueueRuntime = require('../support/load-pallet-queue-runtime')(THREE, behaviorSchema);
const ProcessorRuntime = require('../support/load-processor-runtime')(THREE, behaviorSchema);
const Runtime = new Function('THREE', 'behaviorSchema', 'automationSchema', 'createProductVisual', 'ProductFeedback', 'ObjectPlacement', 'ProductSourceRuntime', 'ProcessorRuntime', 'PalletQueueRuntime', source("modules/logistica-industrial/functions/flujo-materiales/runtime/SimulationRuntime.js").replace('default class SimulationRuntime', 'return class SimulationRuntime'))(THREE, behaviorSchema, automationSchema, prefabs.createProductVisual, ProductFeedback, ObjectPlacement, ProductSourceRuntime, ProcessorRuntime, PalletQueueRuntime);
const {captureSimulation, restoreSimulation} = new Function('THREE', 'createProductVisual', 'createSourceProductVisual', source("modules/logistica-industrial/runtime/SimulationCheckpoint.js") + '\nreturn {captureSimulation,restoreSimulation};')(THREE, prefabs.createProductVisual, prefabs.createSourceProductVisual);
function setup() {
  const scene = new THREE.Scene(), root = new THREE.Group(); scene.add(root);
  const document = new SceneDocument({}); document.registerRoom('hall', root);
  const ctx = {scene, editor: {active: false}, raycontrol: {states: {}, addState(name, state) { this.states[name] = state; }, activateState() {}, deactivateState() {}}};
  return {scene, root, document, ctx, runtime: new Runtime(ctx, document)};
}
function config(f, object) { return f.document.getBehaviors(object).find(value => ['source', 'processor', 'conveyor', 'palletQueue'].includes(value.type)); }
function add(f, kind, values = {}, position = [0, 1.02, 0]) {
  const object = f.document.addPrefab('hall', kind);
  const initial = kind === 'source' ? {autoGenerate: false} : kind === 'processor' ? {powered: true, running: true, setupTime: 0, processTime: .3, delivery: 'manual'} : kind === 'palletQueue' ? {} :
    {powered: true, running: true, autoSpawn: false, length: 2, speed: .4, withPanel: false, withSensors: false, withPallet: false, role: 'middle'};
  f.document.setBehaviors(object, [Object.assign({}, config(f, object), initial, values)]); f.document.setTransform(object, {position}); return object;
}
function ports(value) { return value.type === 'source' ? behaviorSchema.productSources.layout(value) : value.type === 'processor' ? behaviorSchema.conveyorLayout.processorLayout(value) : behaviorSchema.conveyorLayout.ports(value); }
function link(f, from, to) {
  const a = config(f, from), b = config(f, to);
  f.document.setBehaviors(from, [Object.assign({}, a, {outputId: to.userData.editorId, outputPort: 'input', delivery: a.type === 'conveyor' ? undefined : 'automatic'})]);
  f.scene.updateMatrixWorld(true);
  const out = ports(a).outlet || ports(a).output, input = ports(b).input;
  const point = new THREE.Vector3(out.x, 0, out.z).applyMatrix4(from.matrixWorld), position = point.sub(new THREE.Vector3(input.x, 0, input.z));
  f.document.setTransform(to, {position: position.toArray()});
}
function advance(f, seconds) { for (let t = 0; t < seconds - 1e-9; t += 1 / 60) { f.scene.updateMatrixWorld(true); f.runtime.execute(Math.min(1 / 60, seconds - t)); } }
function rec(f, object) { return f.runtime.records.get(object.userData.editorId); }
function canonical(runtime) {
  runtime.ctx.scene.updateMatrixWorld(true);
  return {time: runtime.time, variables: runtime.getSnapshot().objects.map(value => [value.id, value.variables]),
    transforms: Array.from(runtime.records, ([id, record]) => [id, record.object.matrixWorld.toArray(), record.object.matrixAutoUpdate]),
    sourceIds: Array.from(runtime.sourceRuntime.entries, value => [value.id, value.units, value.ownerId]).sort(),
    products: Array.from(runtime.products.values(), value => [value.sourceEntry && value.sourceEntry.id || value.record && value.record.id || 'box', value.object.matrixWorld.toArray()]).sort()};
}
function roundtrip(f, delta = 1) {
  f.runtime.refreshVariables();
  const saved = JSON.parse(JSON.stringify(captureSimulation(f.runtime)));
  const initial = canonical(f.runtime);
  advance(f, delta); const expected = canonical(f.runtime);
  restoreSimulation(f.runtime, saved);
  assert.deepEqual(canonical(f.runtime), initial, 'checkpoint restores exact counters, identities and transforms');
  advance(f, delta);
  assert.deepEqual(canonical(f.runtime), expected, 'resumed execution matches uninterrupted simulation');
  return saved;
}

async function run() {
  const f = setup(), src = add(f, 'source', {initialCount: 4, outputInterval: .1}), processor = add(f, 'processor', {setupTime: .4, setupPolicy: 'eachBatch', processTime: .6, parallelism: 2});
  link(f, src, processor); const before = JSON.stringify(await f.document.serialize());
  f.runtime.start('hall'); advance(f, .35);
  assert(rec(f, processor).components.processor.jobs.length > 0);
  const saved = roundtrip(f, 1.1);
  assert.equal(saved.graph.nodes.length < 60000, true);
  assert.ok(JSON.stringify(saved).length < 4 * 1024 * 1024, 'checkpoint omits geometry/textures');
  const product = Array.from(f.runtime.products.values())[0];
  assert(product.stateEntry && f.ctx.raycontrol.states[product.stateEntry.name], 'real XR interaction handlers are re-registered');
  const sameProducts = Array.from(f.runtime.products.values()), sameMeshes = sameProducts.map(value => value.object), sameMaterials = sameMeshes.map(value => { let material; value.traverse(node => { if (!material && node.material) material = node.material; }); return material; });
  const inPlace = JSON.parse(JSON.stringify(captureSimulation(f.runtime)));
  restoreSimulation(f.runtime, inPlace, {reuse: true});
  assert.deepEqual(Array.from(f.runtime.products.values()), sameProducts, 'shared update reuses live product identities and interaction closures');
  sameMeshes.forEach((mesh, index) => { assert.equal(Array.from(f.runtime.products.keys())[index], mesh); let material; mesh.traverse(node => { if (!material && node.material) material = node.material; }); assert.equal(material, sameMaterials[index], 'shared update preserves GPU material'); });
  f.runtime.stop();
  assert.equal(JSON.stringify(await f.document.serialize()), before, 'stop after resume restores original editor document');

  const line = setup(), gen = add(line, 'source', {initialCount: 4, outputInterval: .1}), combine = add(line, 'processor', {mode: 'combiner', combineCount: 2, delivery: 'automatic', outputInterval: .1}), split = add(line, 'processor', {mode: 'separator', splitCount: 2, delivery: 'automatic', outputInterval: .1}), buffer = add(line, 'source', {capacity: 4});
  link(line, gen, combine); link(line, combine, split); link(line, split, buffer);
  line.runtime.start('hall'); advance(line, .65); roundtrip(line, 2);
  assert.equal(rec(line, buffer).variables.queuedUnits, 4, 'combiner/separator conservation survives resume');
  line.runtime.stop();

  const conveyor = setup(), belt = add(conveyor, 'conveyor', {autoSpawn: true, spawnInterval: .5});
  conveyor.runtime.start('hall'); advance(conveyor, .8); roundtrip(conveyor, .5);
  assert(rec(conveyor, belt).components.conveyor.packages.length > 0);
  conveyor.runtime.running = false;
  const paused = captureSimulation(conveyor.runtime); restoreSimulation(conveyor.runtime, JSON.parse(JSON.stringify(paused)));
  assert.equal(conveyor.runtime.running, false, 'paused execution remains paused');
  conveyor.runtime.stop();

  const originals = setup(), assembler = add(originals, 'processor', {mode: 'combiner', combineCount: 2, processTime: .2});
  const originalA = originals.document.addPrefab('hall', 'product'), originalB = originals.document.addPrefab('hall', 'product');
  originals.document.setTransform(originalA, {position: [0, 2, 5]}); originals.document.setTransform(originalB, {position: [1, 2, 5]});
  const originalsBefore = JSON.stringify(await originals.document.serialize());
  originals.runtime.start('hall'); const assemblerRecord = rec(originals, assembler);
  [originalA, originalB].forEach(object => { const product = originals.runtime.products.get(object), entry = originals.runtime.sourceRuntime.entryForProduct(assemblerRecord, product); assert(originals.runtime.processorRuntime.receive(assemblerRecord, entry, true)); });
  advance(originals, .3);
  assert.equal(originals.runtime.processorRuntime.archive.size, 2);
  roundtrip(originals, .2);
  assert.equal(originals.runtime.processorRuntime.archive.size, 2, 'consumed original models remain privately archived for separation');
  originals.runtime.stop();
  assert.equal(JSON.stringify(await originals.document.serialize()), originalsBefore);

  const moving = setup(), animated = moving.document.addPrimitive('hall', 'box');
  moving.document.setBehaviors(animated, [Object.assign({}, behaviorSchema.defaultBehavior('motion'), {mode: 'rotation', speed: .6})]);
  moving.runtime.start('hall'); advance(moving, .3); roundtrip(moving, .5);
  assert.equal(animated.matrixAutoUpdate, true, 'motion and control animation transforms remain automatic after resume');
  moving.runtime.stop();

  const pallet = setup(), sourceObject = add(pallet, 'source', {initialCount: 3}), queue = add(pallet, 'palletQueue', {capacity: 8, delivery: 'manual'}, [8, 0, 0]);
  pallet.runtime.start('hall');
  const sourceRecord = rec(pallet, sourceObject), queueRecord = rec(pallet, queue);
  for (let index = 0; index < 3; index++) {
    const entry = sourceRecord.components.source.queue[0];
    pallet.runtime.sourceRuntime.remove(sourceRecord, entry, 'manual');
    assert(pallet.runtime.palletQueueRuntime.receive(queueRecord, entry, true));
    pallet.runtime.sourceRuntime.materialize(sourceRecord);
  }
  roundtrip(pallet, .3);
  assert.equal(rec(pallet, queue).variables.queued, 3);
  const hand = new THREE.Group(); pallet.scene.add(hand);
  const pickable = rec(pallet, queue).components.palletQueue.queue.find(entry => pallet.runtime.palletQueueRuntime.canPickup(entry.product));
  assert(pallet.runtime.pickupProduct(pickable.product, hand));
  assert.throws(() => captureSimulation(pallet.runtime), /Suelta las cargas/);
  const sharedHeld = JSON.parse(JSON.stringify(captureSimulation(pallet.runtime, {allowHeld: true})));
  restoreSimulation(pallet.runtime, sharedHeld);
  assert.equal(pallet.runtime.held.size, 0, 'shared snapshot shows a held host load as read-only current pose without stale controller ownership');
  pallet.runtime.stop();
  assert.throws(() => restoreSimulation(pallet.runtime, {version: 999}), /formato o la versión/);
  console.log('Sesiones reanudables: colas, setup/proceso parcial, combiner/separator, rodillos, estibas, pausa e interacción XR OK.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
