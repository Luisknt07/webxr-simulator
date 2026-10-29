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
function source(file) { return fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-processor-runtime.js"), '..', file)), 'utf8').replace(/^\uFEFF/, '').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''); }
const prefabs = new Function('THREE', 'behaviorSchema', source("modules/logistica-industrial/functions/presentacion/runtime/IndustrialPrefabs.js") + '\nreturn {createIndustrialPrefab,createProductVisual,createSourceProductVisual};')(THREE, behaviorSchema);
const SceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', source("packages/project-model/src/SceneDocument.js").replace('default class SceneDocument', 'return class SceneDocument'))(THREE, behaviorSchema, prefabs.createIndustrialPrefab);
const ProductFeedback = new Function('THREE', source("modules/logistica-industrial/functions/flujo-materiales/runtime/ProductFeedback.js").replace('default class ProductFeedback', 'return class ProductFeedback'))(THREE);
const ProductSourceRuntime = require('../support/load-product-source-runtime')(THREE, behaviorSchema);
const PalletQueueRuntime = require('../support/load-pallet-queue-runtime.js')(THREE, behaviorSchema);
const ProcessorRuntime = require('../support/load-processor-runtime')(THREE, behaviorSchema);
const Runtime = new Function('THREE', 'behaviorSchema', 'automationSchema', 'createProductVisual', 'ProductFeedback', 'ObjectPlacement', 'ProductSourceRuntime', 'ProcessorRuntime', 'PalletQueueRuntime', source("modules/logistica-industrial/functions/flujo-materiales/runtime/SimulationRuntime.js").replace('default class SimulationRuntime', 'return class SimulationRuntime'))(THREE, behaviorSchema, automationSchema, prefabs.createProductVisual, ProductFeedback, ObjectPlacement, ProductSourceRuntime, ProcessorRuntime, PalletQueueRuntime);
const CollisionWorld = new Function('THREE', 'getGeometryTree', source("packages/render-three/src/CollisionWorld.js").replace('default class CollisionWorld', 'return class CollisionWorld'))(THREE, getGeometryTree);
function setup() {
  const scene = new THREE.Scene(), root = new THREE.Group(); scene.add(root);
  const floor = new THREE.Mesh(new THREE.BoxBufferGeometry(200, .05, 200), new THREE.MeshBasicMaterial()); floor.position.y = -.025; root.add(floor);
  const document = new SceneDocument({}); document.registerRoom('hall', root);
  const ctx = {scene, editor: {active: false}, raycontrol: {states: {}, addState(name, state) { this.states[name] = state; }, activateState() {}, deactivateState() {}}};
  ctx.collisionWorld = new CollisionWorld(ctx, document);
  const runtime = new Runtime(ctx, document); return {scene, root, document, ctx, runtime};
}
function config(f, object, type) { return f.document.getBehaviors(object).find(value => value.type === type); }
function add(f, kind, values = {}, position = [0, 1.02, 0]) {
  const object = f.document.addPrefab('hall', kind), type = kind === 'conveyor' ? 'conveyor' : kind;
  const initial = kind === 'source' ? {autoGenerate: false} : kind === 'processor' ? {powered: true, running: true, setupTime: 0, processTime: .2, delivery: 'manual'} :
    {powered: true, running: true, autoSpawn: false, length: 2, speed: 2, withPanel: false, withSensors: false, withPallet: false, role: 'middle'};
  f.document.setBehaviors(object, [Object.assign({}, config(f, object, type), initial, values)]); f.document.setTransform(object, {position}); return object;
}
function machineConfig(f, object) { return f.document.getBehaviors(object).find(value => ['source', 'processor', 'conveyor'].includes(value.type)); }
function ports(value) { return value.type === 'source' ? behaviorSchema.productSources.layout(value) : value.type === 'processor' ? behaviorSchema.conveyorLayout.processorLayout(value) : behaviorSchema.conveyorLayout.ports(value); }
function link(f, from, to, align = true) {
  const a = machineConfig(f, from), b = machineConfig(f, to);
  f.document.setBehaviors(from, [Object.assign({}, a, {outputId: to.userData.editorId, outputPort: 'input', delivery: a.type === 'conveyor' ? undefined : 'automatic'})]);
  if (!align) return;
  f.scene.updateMatrixWorld(true);
  const out = ports(a).outlet || ports(a).output, input = ports(b).input;
  const point = new THREE.Vector3(out.x, 0, out.z).applyMatrix4(from.matrixWorld), position = point.sub(new THREE.Vector3(input.x, 0, input.z));
  f.document.setTransform(to, {position: position.toArray()});
}
function record(f, object) { return f.runtime.records.get(object.userData.editorId); }
function processor(f, object) { return record(f, object).components.processor; }
function inventory(f, object) { return record(f, object).components.source; }
function vars(f, object) { return record(f, object).variables; }
function advance(f, seconds) {
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) { f.scene.updateMatrixWorld(true); f.ctx.collisionWorld.beginFrame(); f.runtime.execute(Math.min(1 / 60, seconds - t)); f.ctx.collisionWorld.endFrame(); }
}
function close(a, b, label) { assert(Math.abs(a - b) < 1e-7, label || a + ' != ' + b); }
function phases(f, object) {
  const p = processor(f, object), sum = ['setupSeconds', 'processSeconds', 'idleSeconds', 'blockedSeconds', 'operatorWaitSeconds', 'downSeconds'].reduce((value, key) => value + p[key], 0);
  close(sum, p.elapsed * p.config.parallelism, 'Every observed slot-second belongs to exactly one phase.');
}

async function run() {
  const f = setup(), sourceObject = add(f, 'source', {initialCount: 2, outputInterval: .1}), machine = add(f, 'processor', {processTime: .3, setupTime: .2, setupPolicy: 'startup', requiresOperator: true});
  link(f, sourceObject, machine); const before = JSON.stringify(await f.document.serialize()); f.runtime.start('hall');
  const entry = inventory(f, sourceObject).queue[0], originalMesh = entry.product.object;
  advance(f, .3); assert(vars(f, machine).waitingOperator); assert.equal(vars(f, machine).completed, 0); phases(f, machine);
  f.runtime.command(machine.userData.editorId, 'operator'); advance(f, .1); assert(vars(f, machine).settingUp); close(vars(f, machine).setupProgress, 50);
  assert(!f.runtime.pickupProduct(f.runtime.products.get(originalMesh), new THREE.Group()), 'A processing input cannot be stolen by mouse or XR grab.');
  f.runtime.command(machine.userData.editorId, 'pause'); const setupElapsed = processor(f, machine).setupSeconds; advance(f, .2); close(processor(f, machine).setupSeconds, setupElapsed);
  f.runtime.command(machine.userData.editorId, 'pause'); advance(f, .4);
  assert.equal(vars(f, machine).completed, 1); assert.equal(vars(f, machine).outputQueued, 1); assert.equal(processor(f, machine).output.queue[0].id, entry.id);
  assert.equal(processor(f, machine).output.queue[0].product.object, originalMesh, 'Processing retains the existing visible load instead of cloning it.');
  advance(f, .3); assert.equal(vars(f, machine).completed, 2); close(vars(f, machine).setupSeconds, .2, 'Startup setup is paid once per station.'); phases(f, machine);
  const hand = new THREE.Group(); f.scene.add(hand); hand.position.set(0, 3, 4); f.ctx.vrMode = true;
  assert(f.runtime.pickupProduct(processor(f, machine).output.queue[0].product, hand)); assert.equal(vars(f, machine).exitCount, 1);
  assert.equal(vars(f, machine).deliveredUnits, 1); f.runtime.stop(); assert.equal(JSON.stringify(await f.document.serialize()), before);
  assert.equal(Object.keys(f.ctx.raycontrol.states).length, 0);

  const interlock = setup(), stopped = add(interlock, 'processor', {powered: false, running: false}); interlock.runtime.start('hall');
  assert.throws(() => interlock.runtime.command(stopped.userData.editorId, 'start'), /alimentación/);
  interlock.runtime.command(stopped.userData.editorId, 'powerOn'); interlock.runtime.command(stopped.userData.editorId, 'start');
  interlock.runtime.command(stopped.userData.editorId, 'emergency'); assert(!vars(interlock, stopped).running); assert.throws(() => interlock.runtime.command(stopped.userData.editorId, 'start'), /emergencia/);
  interlock.runtime.command(stopped.userData.editorId, 'resetEmergency'); assert(!vars(interlock, stopped).running, 'Resetting an emergency never restarts machinery.'); interlock.runtime.stop();

  const parallel = setup(), many = add(parallel, 'source', {initialCount: 4, outputInterval: .1}), two = add(parallel, 'processor', {parallelism: 2, processTime: .4, setupTime: .1, setupPolicy: 'startup'});
  link(parallel, many, two); parallel.runtime.start('hall'); advance(parallel, 1.3); assert.equal(vars(parallel, two).completed, 4); close(vars(parallel, two).processSeconds, 1.6); close(vars(parallel, two).setupSeconds, .2); phases(parallel, two);
  close(vars(parallel, two).utilization, 1.6 / (1.3 * 2) * 100); parallel.runtime.stop();

  const changes = setup(), sequence = add(changes, 'source', {initialCount: 2, outputInterval: .1}), changeMachine = add(changes, 'processor', {processTime: .3, setupTime: .1, setupPolicy: 'eachBatch'});
  link(changes, sequence, changeMachine); changes.runtime.start('hall'); advance(changes, .15);
  changes.runtime.setVariable(changeMachine.userData.editorId, 'processTime', 1); changes.runtime.setVariable(changeMachine.userData.editorId, 'setupTime', .2);
  advance(changes, .3); assert.equal(vars(changes, changeMachine).completed, 1, 'Changing durations leaves the already allocated cycle unchanged.');
  advance(changes, 1.2); assert.equal(vars(changes, changeMachine).completed, 2); close(vars(changes, changeMachine).processSeconds, 1.3); close(vars(changes, changeMachine).setupSeconds, .3); phases(changes, changeMachine); changes.runtime.stop();

  const line = setup(), gen = add(line, 'source', {initialCount: 4, outputInterval: .1}), combine = add(line, 'processor', {mode: 'combiner', combineCount: 2, delivery: 'automatic', outputInterval: .1}), split = add(line, 'processor', {mode: 'separator', splitCount: 2, delivery: 'automatic', outputInterval: .1}), buffer = add(line, 'source', {capacity: 4});
  link(line, gen, combine); link(line, combine, split); link(line, split, buffer);
  line.runtime.start('hall'); advance(line, 3);
  assert.equal(vars(line, combine).completed, 2); assert.equal(vars(line, combine).completedUnits, 4);
  assert.equal(vars(line, split).completed, 2); assert.equal(vars(line, split).completedUnits, 4);
  assert.equal(vars(line, buffer).queued, 4); assert.equal(vars(line, buffer).queuedUnits, 4);
  assert.equal(vars(line, gen).deliveredUnits, vars(line, buffer).receivedUnits, 'Combiner/Separator preserve all product units through communicating equipment.');
  assert.equal(new Set(inventory(line, buffer).queue.map(value => value.id)).size, 4); phases(line, combine); phases(line, split); line.runtime.stop();

  const full = setup(), feed = add(full, 'source', {initialCount: 5, outputInterval: .1}), limited = add(full, 'processor', {capacity: 2, outputCapacity: 1, processTime: .1});
  link(full, feed, limited); full.runtime.start('hall'); advance(full, 2);
  assert.equal(vars(full, limited).outputQueued, 1); assert(vars(full, limited).blocked); assert(vars(full, feed).queued > 0);
  const firstOutput = processor(full, limited).output.queue[0].product, outputHand = new THREE.Group(); outputHand.position.set(0, 3, 8); full.scene.add(outputHand);
  assert(full.runtime.pickupProduct(firstOutput, outputHand)); advance(full, .2); assert.equal(vars(full, limited).outputQueued, 1); phases(full, limited); full.runtime.stop();

  const manual = setup(), manualMachine = add(manual, 'processor', {processTime: .1}), authored = manual.document.addPrefab('hall', 'product');
  manual.document.setTransform(authored, {position: [0, 2, 4]}); const manualBefore = JSON.stringify(await manual.document.serialize()); manual.runtime.start('hall');
  const manualProduct = manual.runtime.products.get(authored), manualHand = new THREE.Group(); manual.scene.add(manualHand); manual.ctx.vrMode = true;
  assert(manual.runtime.pickupProduct(manualProduct, manualHand));
  manual.runtime.setProductMatrix(manualProduct, manual.runtime.sourceRuntime.frontMatrix(record(manual, manualMachine), manualProduct.bounds, manualProduct.scale, processor(manual, manualMachine).input.position));
  assert(manual.runtime.releaseProduct(manualProduct)); advance(manual, .2);
  assert.equal(vars(manual, manualMachine).entryCount, 1); assert.equal(vars(manual, manualMachine).outputQueued, 1); assert.equal(processor(manual, manualMachine).output.queue[0].product.object, authored);
  assert(manual.runtime.pickupProduct(manualProduct, manualHand)); assert.equal(vars(manual, manualMachine).exitCount, 1);
  manual.runtime.stop(); assert.equal(JSON.stringify(await manual.document.serialize()), manualBefore); assert(authored.visible);
  console.log('Processors: timed setup/process, interlocks, operators, parallel slot accounting, bounded flow, combiner/separator conservation, VR input/output and restoration passed.');
}
module.exports = {THREE, behaviorSchema, setup, add, link, ports, config, record, processor, inventory, vars, advance, close, phases};
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
