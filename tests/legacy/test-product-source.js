const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const behaviorSchema = require('../../modules/logistica-industrial/contracts/behaviors.js');
const automationSchema = require('../../modules/logistica-industrial/functions/flujo-materiales/schema/automation.js');
const ObjectPlacement = require('../support/load-object-placement')(THREE);
const {getGeometryTree} = require('../support/load-geometry-acceleration.js')(THREE);
const schema = behaviorSchema.productSources;
function source(file) { return fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-product-source.js"), '..', file)), 'utf8').replace(/^\uFEFF/, '').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''); }
const cargo = require('../support/load-product-prefabs.js')(THREE);
const prefabs = new Function('THREE', 'behaviorSchema', 'require', source("modules/logistica-industrial/functions/presentacion/runtime/IndustrialPrefabs.js") + '\nreturn {createIndustrialPrefab,createProductVisual,createSourceProductVisual};')(THREE, behaviorSchema, id => { assert.equal(path.resolve(path.dirname(__layout.source('editor/IndustrialPrefabs.js')), id), __layout.source('editor/ProductPrefabs.js')); return cargo; });
const SceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', source("packages/project-model/src/SceneDocument.js").replace('default class SceneDocument', 'return class SceneDocument'))(THREE, behaviorSchema, prefabs.createIndustrialPrefab);
const ProductFeedback = new Function('THREE', source("modules/logistica-industrial/functions/flujo-materiales/runtime/ProductFeedback.js").replace('default class ProductFeedback', 'return class ProductFeedback'))(THREE);
const PalletQueueRuntime = require('../support/load-pallet-queue-runtime.js')(THREE, behaviorSchema);
const ProcessorRuntime = require('../support/load-processor-runtime.js')(THREE, behaviorSchema);
const ProductSourceRuntime = new Function('THREE', 'behaviorSchema', 'createSourceProductVisual', source("modules/logistica-industrial/functions/flujo-materiales/runtime/ProductSourceRuntime.js").replace('default class ProductSourceRuntime', 'return class ProductSourceRuntime'))(THREE, behaviorSchema, prefabs.createSourceProductVisual);
const Runtime = new Function('THREE', 'behaviorSchema', 'automationSchema', 'createProductVisual', 'ProductFeedback', 'ObjectPlacement', 'ProductSourceRuntime', 'ProcessorRuntime', 'PalletQueueRuntime', source("modules/logistica-industrial/functions/flujo-materiales/runtime/SimulationRuntime.js").replace('default class SimulationRuntime', 'return class SimulationRuntime'))(THREE, behaviorSchema, automationSchema, prefabs.createProductVisual, ProductFeedback, ObjectPlacement, ProductSourceRuntime, ProcessorRuntime, PalletQueueRuntime);
const CollisionWorld = new Function('THREE', 'getGeometryTree', source("packages/render-three/src/CollisionWorld.js").replace('default class CollisionWorld', 'return class CollisionWorld'))(THREE, getGeometryTree);
function setup() {
  const scene = new THREE.Scene(), root = new THREE.Group(); scene.add(root);
  const floor = new THREE.Mesh(new THREE.BoxBufferGeometry(100, .05, 100), new THREE.MeshBasicMaterial()); floor.position.y = -.025; root.add(floor);
  const document = new SceneDocument({}); document.registerRoom('hall', root);
  const ctx = {scene, editor: {active: false}, raycontrol: {states: {}, addState(name, state) { this.states[name] = state; }, activateState() {}, deactivateState() {}}};
  ctx.collisionWorld = new CollisionWorld(ctx, document);
  const runtime = new Runtime(ctx, document);
  return {scene, root, document, ctx, runtime};
}
function sourceConfig(f, object) { return f.document.getBehaviors(object).find(value => value.type === 'source'); }
function addSource(f, values = {}, position = [0, 1.02, 0]) {
  const object = f.document.addPrefab('hall', 'source');
  f.document.setBehaviors(object, [Object.assign({}, sourceConfig(f, object), {autoGenerate: false}, values)]);
  f.document.setTransform(object, {position}); return object;
}
function addBelt(f, values = {}, position = [3.35, 1.02, 0]) {
  const object = f.document.addPrefab('hall', 'conveyor'), config = f.document.getBehaviors(object).find(value => value.type === 'conveyor');
  f.document.setBehaviors(object, [Object.assign({}, config, {length: 5, speed: .5, running: true, powered: true, autoSpawn: false, withSensors: false, withPanel: false, withPallet: false, role: 'middle'}, values)]);
  f.document.setTransform(object, {position}); return object;
}
function link(f, from, to) {
  const config = sourceConfig(f, from);
  f.document.setBehaviors(from, [Object.assign({}, config, {outputId: to.userData.editorId, delivery: 'automatic'})]);
}
function record(f, object) { return f.runtime.records.get(object.userData.editorId); }
function inventory(f, object) { return record(f, object).components.source; }
function vars(f, object) { return record(f, object).variables; }
function advance(f, seconds) {
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) { f.scene.updateMatrixWorld(true); f.ctx.collisionWorld.beginFrame(); f.runtime.execute(Math.min(1 / 60, seconds - t)); f.ctx.collisionWorld.endFrame(); }
}

async function run() {
  const f = setup(), sourceObject = addSource(f, {capacity: 3, interval: .1, autoGenerate: true, initialCount: 1});
  const before = JSON.stringify(await f.document.serialize()); f.runtime.start('hall'); advance(f, 1);
  const s = inventory(f, sourceObject);
  assert.equal(s.queue.length, 3); assert.equal(s.generated, 3); assert.equal(vars(f, sourceObject).queuedUnits, 3);
  assert.equal(f.runtime.products.size, 1, 'Waiting inventory is logical; one complete front load is physically materialized per source.');
  const first = s.queue[0], product = first.product;
  assert(product, 'The first generated load is visible and grabbable.');
  const hand = new THREE.Group(); f.scene.add(hand); hand.position.set(5, 2, 0);
  assert(f.runtime.pickupProduct(product, hand));
  assert.equal(s.delivered, 1); assert.equal(s.queue.length, 2); assert.equal(first.ownerId, '');
  assert(!f.runtime.pickupProduct(product, hand)); assert.equal(s.delivered, 1, 'Repeated pickup cannot count a manual output twice.');
  assert.equal(f.runtime.products.size, 1, 'The next front waits until the held box clears the source tray.');
  advance(f, .15); assert.equal(s.queue.length, 3, 'Generation resumes after a manual withdrawal frees capacity.');
  assert(s.queue[0].product); assert.equal(f.runtime.products.size, 2);
  f.runtime.command(sourceObject.userData.editorId, 'pause'); const generated = s.generated; advance(f, .5); assert.equal(s.generated, generated);
  f.runtime.command(sourceObject.userData.editorId, 'clearQueue'); assert.equal(s.queue.length, 0); assert(f.runtime.products.has(product.object), 'Clearing inventory preserves a load already taken by an operator.');
  f.runtime.stop(); assert.equal(f.runtime.products.size, 0); assert.equal(f.runtime.sourceRuntime.entries.size, 0);
  assert.equal(JSON.stringify(await f.document.serialize()), before, 'Run-time inventory and counters do not mutate the saved scene.');
  assert.equal(Object.keys(f.ctx.raycontrol.states).length, 0, 'Stopping removes source load and panel interaction states.');

  const fifo = setup(), rows = [
    {id: 'small', name: 'Caja pequeña', type: 'box', width: .2, height: .2, depth: .2, color: '#996633'},
    {id: 'blue', name: 'Bidón azul', type: 'drum', width: .3, height: .4, depth: .3, color: '#2255aa'}
  ];
  const generator = addSource(fifo, {generationMode: 'sequence', catalog: JSON.stringify(rows), initialCount: 4, capacity: 4, totalLimit: 4});
  fifo.runtime.start('hall');
  assert.deepEqual(inventory(fifo, generator).queue.map(entry => entry.spec.id), ['small', 'blue', 'small', 'blue']);
  assert.equal(fifo.runtime.command(generator.userData.editorId, 'generate'), false, 'Generation respects both capacity and finite total limits.');
  const queueIds = inventory(fifo, generator).queue.map(entry => entry.id); assert.equal(new Set(queueIds).size, 4);
  fifo.runtime.stop();
  const randomConfig = Object.assign({}, behaviorSchema.defaultBehavior('source'), {generationMode: 'random', catalog: JSON.stringify(rows), seed: 37});
  assert.deepEqual(Array.from({length: 20}, (_, index) => schema.specAt(randomConfig, index)), Array.from({length: 20}, (_, index) => schema.specAt(randomConfig, index)), 'Random SKU sequences are reproducible from seed.');

  const pipeline = setup(), gen = addSource(pipeline, {initialCount: 3, capacity: 3, outputInterval: .1}), buffer = addSource(pipeline, {capacity: 2, outputInterval: .1}, [1.7, 1.02, 0]);
  const belt = addBelt(pipeline, {}, [5.05, 1.02, 0]); link(pipeline, gen, buffer); link(pipeline, buffer, belt);
  pipeline.runtime.start('hall'); const original = inventory(pipeline, gen).queue[0], originalMesh = original.product.object;
  pipeline.runtime.setVariable(belt.userData.editorId, 'running', false); advance(pipeline, 1);
  assert.equal(vars(pipeline, buffer).queued, 2); assert.equal(vars(pipeline, gen).queued, 1); assert.equal(vars(pipeline, gen).delivered, 2);
  assert.equal(vars(pipeline, buffer).received, 2); assert.equal(vars(pipeline, buffer).delivered, 0); assert(vars(pipeline, gen).blocked);
  assert.equal(inventory(pipeline, buffer).queue[0].id, original.id, 'Flow transfers preserve FIFO load identity and SKU lineage.');
  assert.equal(inventory(pipeline, buffer).queue[0].product.object, originalMesh, 'A currently visible load moves to an empty receiver without cloning.');
  assert.equal(pipeline.runtime.products.size, 2, 'Two queued sources expose at most two physical front loads.');
  pipeline.runtime.command(belt.userData.editorId, 'start'); advance(pipeline, 3);
  const b = record(pipeline, belt).components.conveyor;
  assert.equal(vars(pipeline, gen).queued, 0); assert.equal(vars(pipeline, buffer).queued, 0);
  assert.equal(vars(pipeline, gen).delivered, 3); assert.equal(vars(pipeline, buffer).received, 3); assert.equal(vars(pipeline, buffer).delivered, 3);
  assert.equal(b.entryCount, 3); assert.equal(b.packages.length, 3); assert(b.packages.some(item => item.mesh === originalMesh));
  assert.equal(new Set(b.packages.map(item => item.product.sourceEntry.id)).size, 3, 'Backpressure retries never duplicate a logical load.');
  assert(b.packages.every(item => item.product.sourceId === ''), 'Generated lineage does not accidentally restrict products to a legacy preferred conveyor.');
  pipeline.runtime.stop();

  const reverse = setup(), upstream = addBelt(reverse, {speed: 2}, [0, 1.02, 0]), receiver = addSource(reverse, {capacity: 1}, [3.35, 1.02, 0]);
  const upstreamConfig = reverse.document.getBehaviors(upstream).find(value => value.type === 'conveyor');
  reverse.document.setBehaviors(upstream, [Object.assign({}, upstreamConfig, {outputId: receiver.userData.editorId})]);
  reverse.runtime.start('hall'); reverse.runtime.insertProduct(upstream.userData.editorId); advance(reverse, .02);
  const legacyCarton = record(reverse, upstream).components.conveyor.packages[0].mesh; advance(reverse, 3);
  assert.equal(vars(reverse, receiver).received, 1); assert.equal(vars(reverse, receiver).queued, 1);
  assert.equal(inventory(reverse, receiver).queue[0].product.object, legacyCarton, 'A legacy belt carton can enter a FIFO buffer without cloning its visible body.');
  assert.equal(record(reverse, upstream).components.conveyor.exitCount, 1); assert.equal(reverse.runtime.packageCount, 0);
  reverse.runtime.insertProduct(upstream.userData.editorId); advance(reverse, 3);
  assert.equal(vars(reverse, receiver).received, 1); assert.equal(record(reverse, upstream).components.conveyor.packages.length, 1, 'An occupied downstream queue applies backpressure to its conveyor input.');
  reverse.runtime.stop();

  const authored = setup(), authoredBelt = addBelt(authored, {speed: 2}, [0, 1.02, 0]), authoredQueue = addSource(authored, {capacity: 2, initialCount: 1}, [3.35, 1.02, 0]);
  const authoredBeltConfig = authored.document.getBehaviors(authoredBelt).find(value => value.type === 'conveyor');
  authored.document.setBehaviors(authoredBelt, [Object.assign({}, authoredBeltConfig, {outputId: authoredQueue.userData.editorId})]);
  const authoredBox = authored.document.addPrefab('hall', 'product'); authored.document.setTransform(authoredBox, {position: [-3, 2, 0]});
  const authoredBefore = JSON.stringify(await authored.document.serialize()); authored.runtime.start('hall');
  const authoredProduct = authored.runtime.products.get(authoredBox), authoredHand = new THREE.Group(); authored.scene.add(authoredHand);
  authored.ctx.vrMode = true; assert(authored.runtime.pickupProduct(authoredProduct, authoredHand));
  const authoredBeltRecord = record(authored, authoredBelt), authoredB = authoredBeltRecord.components.conveyor;
  authored.runtime.setProductMatrix(authoredProduct, authored.runtime.packageMatrix(authoredBeltRecord, authoredB, -2, {bounds: authoredProduct.bounds, scale: authoredProduct.scale, route: 'main'}));
  assert(authored.runtime.releaseProduct(authoredProduct)); advance(authored, 3);
  assert.equal(vars(authored, authoredQueue).received, 0, 'An authored object waits behind existing FIFO inventory instead of destroying its custom asset.');
  assert.equal(authoredB.packages.length, 1); authored.runtime.command(authoredQueue.userData.editorId, 'clearQueue'); advance(authored, .2);
  assert.equal(vars(authored, authoredQueue).received, 1); assert.equal(inventory(authored, authoredQueue).queue[0].product.object, authoredBox);
  authored.runtime.command(authoredQueue.userData.editorId, 'clearQueue');
  assert(authored.runtime.products.has(authoredBox)); assert(authoredBox.parent === authored.root, 'Clearing a buffered authored product releases its real asset without disposing it.');
  authored.runtime.stop(); assert.equal(JSON.stringify(await authored.document.serialize()), authoredBefore, 'An authored box returns to its exact saved parent and transform after passing through conveyor and buffer.');

  const xr = setup(), xrSource = addSource(xr, {initialCount: 1}), xrBelt = addBelt(xr);
  xr.runtime.start('hall'); xr.ctx.vrMode = true;
  const xrEntry = inventory(xr, xrSource).queue[0], xrProduct = xrEntry.product, xrHand = new THREE.Group(); xr.scene.add(xrHand);
  assert(xr.runtime.pickupProduct(xrProduct, xrHand)); assert.equal(vars(xr, xrSource).delivered, 1);
  const xrRecord = record(xr, xrBelt), xrConveyor = xrRecord.components.conveyor;
  xr.runtime.setProductMatrix(xrProduct, xr.runtime.packageMatrix(xrRecord, xrConveyor, -1, {bounds: xrProduct.bounds, scale: xrProduct.scale, route: 'main'}));
  assert(xr.runtime.releaseProduct(xrProduct)); assert.equal(xrConveyor.packages.length, 1);
  assert(xr.runtime.pickupProduct(xrProduct, xrHand)); assert.equal(vars(xr, xrSource).delivered, 1, 'Repeated XR pickup after a source load has entered another process never recounts its original source output.');
  xr.runtime.stop(); assert.equal(Object.keys(xr.ctx.raycontrol.states).length, 0);

  const separated = setup(), separatedSource = addSource(separated, {initialCount: 1}), separatedBelt = addBelt(separated, {}, [8, 1.02, 0]);
  link(separated, separatedSource, separatedBelt); separated.runtime.start('hall'); advance(separated, 1);
  assert.equal(vars(separated, separatedSource).delivered, 0); assert.equal(vars(separated, separatedSource).queued, 1); assert(vars(separated, separatedSource).blocked);
  separated.runtime.stop();

  const pallets = setup(), palletSource = addSource(pallets, {loadMode: 'pallet', palletColumns: 2, palletRows: 2, palletLayers: 2, initialCount: 2, capacity: 2});
  const narrow = addBelt(pallets, {width: .8}, [3.35, 1.02, 0]); link(pallets, palletSource, narrow);
  pallets.runtime.start('hall'); const ps = inventory(pallets, palletSource), load = ps.queue[0];
  assert.equal(load.units, 8); assert.equal(vars(pallets, palletSource).generatedUnits, 16); assert.equal(pallets.runtime.products.size, 1);
  assert.equal(load.product.object.userData.sourceProduct.units, 8, 'A complete pallet represents its contained units without independently registering duplicate products.');
  const palletHand = new THREE.Group(); pallets.scene.add(palletHand); palletHand.position.set(5, 3, 0);
  assert(pallets.runtime.pickupProduct(load.product, palletHand)); assert.equal(ps.delivered, 1); assert.equal(ps.deliveredUnits, 8);
  pallets.runtime.stop();

  const oversized = setup(), bigSource = addSource(oversized, {initialCount: 1, width: .9, depth: .9, loadMode: 'pallet', palletColumns: 3, palletRows: 3}), smallQueue = addSource(oversized);
  const bigLayout = schema.layout(sourceConfig(oversized, bigSource)), smallLayout = schema.layout(sourceConfig(oversized, smallQueue));
  oversized.document.setTransform(smallQueue, {position: [bigLayout.length / 2 + smallLayout.length / 2, 1.02, 0]}); link(oversized, bigSource, smallQueue);
  oversized.runtime.start('hall'); advance(oversized, 1);
  assert.equal(vars(oversized, bigSource).delivered, 0); assert.equal(vars(oversized, smallQueue).received, 0); assert(vars(oversized, bigSource).blocked, 'An oversized incoming pallet waits instead of overhanging a receiver designed for smaller products.'); oversized.runtime.stop();

  const bound = setup(), hugeQueue = addSource(bound, {initialCount: 64, capacity: 64, loadMode: 'pallet', palletColumns: 4, palletRows: 4, palletLayers: 4});
  bound.runtime.start('hall'); assert.equal(vars(bound, hugeQueue).queuedUnits, 4096); assert.equal(bound.runtime.products.size, 1, '64 pallets of 64 units still require only one complete load visual.'); bound.runtime.stop();

  const budget = setup(), generators = Array.from({length: 8}, (_, index) => addSource(budget, {initialCount: 64, capacity: 64}, [0, 1.02, index * 4]));
  const budgetBelt = addBelt(budget, {speed: 2}, [0, 1.02, 40]); budget.runtime.start('hall');
  const budgetRecord = record(budget, budgetBelt), budgetConveyor = budgetRecord.components.conveyor;
  assert.equal(budget.runtime.sourceRuntime.liveLoads(), 500); assert.equal(budget.runtime.products.size, 8);
  assert.equal(budget.runtime.spawn(budgetRecord, budgetConveyor), false, 'Legacy conveyor generation shares the global budget with logical source inventory.');
  assert.equal(budget.runtime.insertProduct(budgetBelt.userData.editorId), false, 'Manual conveyor requests cannot bypass a full logical load budget.');
  const lastSource = generators[7]; budget.runtime.command(lastSource.userData.editorId, 'clearQueue');
  for (let index = 0; index < 50; index++) assert(budget.runtime.command(lastSource.userData.editorId, 'generate'));
  assert.equal(budget.runtime.sourceRuntime.liveLoads(), 498);
  assert(budget.runtime.insertProduct(budgetBelt.userData.editorId)); assert(budget.runtime.insertProduct(budgetBelt.userData.editorId));
  assert.equal(budget.runtime.sourceRuntime.liveLoads(), 500); assert.equal(budget.runtime.sourceRuntime.liveLoads(false), 498);
  assert.equal(budget.runtime.command(lastSource.userData.editorId, 'generate'), false, 'A source cannot consume capacity already reserved by a pending conveyor insertion.');
  assert.equal(budget.runtime.insertProduct(budgetBelt.userData.editorId), false); assert.equal(budget.runtime.spawn(budgetRecord, budgetConveyor), false);
  advance(budget, .5);
  assert.equal(budgetConveyor.pendingInsert, 0); assert.equal(budgetConveyor.packages.length, 2);
  assert.equal(budget.runtime.sourceRuntime.liveLoads(), 500, 'Fulfilling each queued insertion consumes its existing reservation exactly once.');
  budget.runtime.stop();
  console.log('Product sources: bounded FIFO, manual/VR pickup, SKU mixing, pallet loads, physical flow/backpressure, identities and restoration passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
