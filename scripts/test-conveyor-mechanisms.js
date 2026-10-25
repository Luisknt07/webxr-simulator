'use strict';
// Real scene document, catalogue prefabs, runtime and geometric collision world.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const behaviorSchema = require('../shared/behaviors');
const automationSchema = require('../shared/automation');
const layout = behaviorSchema.conveyorLayout;
const ObjectPlacement = require('./load-object-placement')(THREE);
const ProductSourceRuntime = require('./load-product-source-runtime')(THREE, behaviorSchema);
const ProcessorRuntime = require('./load-processor-runtime')(THREE, behaviorSchema);
const PalletQueueRuntime = require('./load-pallet-queue-runtime')(THREE, behaviorSchema);
const {getGeometryTree} = require('./load-geometry-acceleration.js')(THREE);
function code(file) { return fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/^\uFEFF/, '').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''); }
const prefabs = new Function('THREE', 'behaviorSchema', code('src/editor/IndustrialPrefabs.js') + '\nreturn {createIndustrialPrefab,createProductVisual,createSourceProductVisual};')(THREE, behaviorSchema);
const SceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', code('src/editor/SceneDocument.js').replace('default class SceneDocument', 'return class SceneDocument'))(THREE, behaviorSchema, prefabs.createIndustrialPrefab);
const ProductFeedback = new Function('THREE', code('src/editor/ProductFeedback.js').replace('default class ProductFeedback', 'return class ProductFeedback'))(THREE);
const Runtime = new Function('THREE', 'behaviorSchema', 'automationSchema', 'createProductVisual', 'ProductFeedback', 'ObjectPlacement', 'ProductSourceRuntime', 'ProcessorRuntime', 'PalletQueueRuntime', code('src/editor/SimulationRuntime.js').replace('default class SimulationRuntime', 'return class SimulationRuntime'))(THREE, behaviorSchema, automationSchema, prefabs.createProductVisual, ProductFeedback, ObjectPlacement, ProductSourceRuntime, ProcessorRuntime, PalletQueueRuntime);
const CollisionWorld = new Function('THREE', 'getGeometryTree', code('src/lib/CollisionWorld.js').replace('default class CollisionWorld', 'return class CollisionWorld'))(THREE, getGeometryTree);
const checkpoint = new Function('THREE', 'createProductVisual', 'createSourceProductVisual', code('src/studio/SimulationCheckpoint.js') + '\nreturn {captureSimulation,restoreSimulation};')(THREE, prefabs.createProductVisual, prefabs.createSourceProductVisual);
function setup() {
  const scene = new THREE.Scene(), root = new THREE.Group(); scene.add(root);
  const floor = new THREE.Mesh(new THREE.BoxBufferGeometry(100, .05, 100), new THREE.MeshBasicMaterial()); floor.position.y = -.025; root.add(floor);
  const document = new SceneDocument({}); document.registerRoom('hall', root);
  const notices = [], ctx = {scene, editor: {active: false}, raycontrol: {states: {}, addState(name, state) { this.states[name] = state; }, activateState() {}, deactivateState() {}}};
  ctx.collisionWorld = new CollisionWorld(ctx, document);
  return {scene, root, document, ctx, notices, runtime: new Runtime(ctx, document, message => notices.push(message))};
}
function configuration(f, object) { return f.document.getBehaviors(object).find(value => value.type === 'conveyor'); }
function update(f, object, values) { f.document.setBehaviors(object, [Object.assign({}, configuration(f, object), values)]); }
function add(f, variant, values = {}, position = [0, 1.02, 0]) {
  const object = f.document.addPrefab('hall', 'conveyor', variant);
  update(f, object, Object.assign({withPanel: false, withSensors: false, autoSpawn: false, running: true, powered: true}, values));
  f.document.setTransform(object, {position}); return object;
}
function belt(f, object) { return f.runtime.records.get(object.userData.editorId).components.conveyor; }
function advance(f, seconds) { for (let t = 0; t < seconds - 1e-9; t += 1 / 60) { f.scene.updateMatrixWorld(true); f.runtime.execute(Math.min(1 / 60, seconds - t)); } }
function link(f, from, to, port = 'output', input = 'input') {
  update(f, from, port === 'branch' ? {branchId: to.userData.editorId, branchPort: input} : {outputId: to.userData.editorId, outputPort: input});
  const a = layout.ports(configuration(f, from))[port], b = layout.ports(configuration(f, to))[input];
  f.scene.updateMatrixWorld(true);
  const direction = new THREE.Vector3(a.tx, a.ty || 0, a.tz).transformDirection(from.matrixWorld);
  const yaw = Math.atan2(-direction.z, direction.x) - Math.atan2(-b.tz, b.tx);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const position = new THREE.Vector3(a.x, a.y, a.z).applyMatrix4(from.matrixWorld).sub(new THREE.Vector3(b.x, b.y, b.z).applyQuaternion(q));
  f.document.setTransform(to, {position: position.toArray(), quaternion: q.toArray()});
}
function product(f, object, config = {}) {
  const item = f.document.addPrefab('hall', 'product'), initial = f.document.getBehaviors(item).find(value => value.type === 'product');
  f.document.setBehaviors(item, [Object.assign({}, initial, config)]);
  const point = layout.ports(configuration(f, object)).input;
  f.scene.updateMatrixWorld(true);
  const position = new THREE.Vector3(point.x, point.y + .13, point.z).applyMatrix4(object.matrixWorld);
  f.document.setTransform(item, {position: position.toArray()}); return item;
}
function noLoss(f, expected = 1) { assert.equal(f.runtime.products.size, expected); assert.equal(f.runtime.packageCount, expected); }
function canonical(f) {
  f.scene.updateMatrixWorld(true);
  return {time: f.runtime.time, variables: f.runtime.getSnapshot().objects.map(object => [object.id, object.variables]),
    products: Array.from(f.runtime.products.values(), product => ({matrix: product.object.matrixWorld.toArray(), stage: product.item && product.item.mechanismStage,
      offset: product.item && product.item.offset, elapsed: product.item && product.item.mechanismElapsed, gravityVelocity: product.item && product.item.gravityVelocity}))};
}
function validateAdmission() {
  const base = behaviorSchema.conveyorEquipment.getDefinition('roller-motor').preset;
  const carton = {productType: 'box', width: .25, depth: .25, height: .25, mass: 2, base: 'flat'};
  assert(layout.productCompatibility(base, carton).ok);
  for (const [changes, code] of [[{mass: 100}, 'mass'], [{height: 3}, 'clearance'], [{width: .1}, 'roller-support'], [{depth: 2}, 'width'], [{base: 'unstable'}, 'base'], [{loadMode: 'pallet'}, 'load-class']]) {
    assert(layout.productCompatibility(base, Object.assign({}, carton, changes)).reasons.some(reason => reason.code === code));
  }
  assert.throws(() => behaviorSchema.normalizeBehaviors([Object.assign({type: 'conveyor'}, base, {mechanism: 'elevator'})]), /variante/);
  assert.throws(() => behaviorSchema.normalizeBehaviors([Object.assign({type: 'conveyor'}, behaviorSchema.conveyorEquipment.getDefinition('roller-gravity').preset, {supportHeight: .5, rise: -.3})]), /extremo más bajo/);
  assert(behaviorSchema.normalizeBehaviors([Object.assign({type: 'conveyor'}, behaviorSchema.conveyorEquipment.getDefinition('roller-gravity').preset, {supportHeight: .5, rise: -.2})]));
}
function addPLC(f, rules, z = 12) {
  const plc = f.document.addPrimitive('hall', 'box');
  f.document.setTransform(plc, {position: [-12, 1, z]}); f.document.setBehaviors(plc, [{type: 'automation', rules: JSON.stringify(rules)}]); return plc;
}
function rule(source, variable, target, targetVariable = 'running', set = false) {
  return {sourceId: source.userData.editorId, variable, operator: 'eq', value: true, targetId: target.userData.editorId, targetVariable, set, edge: 'level'};
}
function validateSignals() {
  const f = setup(), zones = add(f, 'roller-zones', {speed: 1}), receiver = add(f, 'belt', {speed: 1});
  const occupiedRule = rule(zones, 'zone1Occupied', receiver);
  assert.equal(automationSchema.normalizeRules([occupiedRule])[0].variable, 'zone1Occupied');
  assert.throws(() => automationSchema.normalizeRules([Object.assign({}, occupiedRule, {value: 1})]), /tipo/);
  assert.throws(() => automationSchema.normalizeRules([Object.assign({}, occupiedRule, {variable: 'zone33Occupied'})]), /inválido/);
  assert.throws(() => automationSchema.normalizeRules([Object.assign({}, occupiedRule, {targetVariable: 'zone1Occupied'})]), /inválido/);
  assert.throws(() => automationSchema.normalizeRules([Object.assign({}, occupiedRule, {targetVariable: 'actuatorPosition', set: 1})]), /inválido/);
  addPLC(f, [occupiedRule]); f.runtime.start('hall'); f.runtime.insertProduct(zones.userData.editorId); advance(f, .05);
  assert.equal(f.runtime.records.get(zones.userData.editorId).variables.zone1Occupied, true);
  assert.equal(f.runtime.records.get(receiver.userData.editorId).variables.running, false, 'A real zone-presence signal drives the existing declarative PLC rules.');
  assert.throws(() => f.runtime.setVariable(zones.userData.editorId, 'zone1Occupied', false), /lectura/); f.runtime.stop();

  const c = setup(), source = add(c, 'roller-zones'), target = add(c, 'belt');
  addPLC(c, [rule(source, 'zone1Occupied', target, 'running', false)]);
  addPLC(c, [rule(source, 'zone1Occupied', target, 'running', true)], 14);
  c.runtime.start('hall'); c.runtime.insertProduct(source.userData.editorId); advance(c, .05);
  assert.equal(belt(c, target).running, true, 'Conflicting controllers preserve the previous command instead of traversal-order arbitration.');
  assert(c.notices.some(message => /contradictorias/.test(message))); c.runtime.stop();

  const m = setup(), elevator = add(m, 'box-elevator'), downstream = add(m, 'belt');
  addPLC(m, [rule(elevator, 'mechanismReady', downstream)]); m.runtime.start('hall'); advance(m, .02);
  const state = m.runtime.records.get(elevator.userData.editorId).variables;
  assert(state.mechanismReady && !state.mechanismBusy && state.atLowerLevel && !state.atUpperLevel && state.actuatorRetracted);
  assert.equal(belt(m, downstream).running, false, 'The mechanical ready flag is a typed read-only automation input.');
  assert.throws(() => m.runtime.setVariable(elevator.userData.editorId, 'atUpperLevel', true), /lectura/); m.runtime.stop();
}
async function run() {
  validateAdmission();
  validateSignals();
  const flat = setup(), gravity = add(flat, 'roller-gravity', {rise: 0}), carton = product(flat, gravity);
  flat.runtime.start('hall'); assert.equal(belt(flat, gravity).packages.length, 1); const initial = belt(flat, gravity).packages[0].offset;
  advance(flat, 2); assert.equal(belt(flat, gravity).packages[0].offset, initial, 'No hidden motor moves a flat unpushed gravity load.'); flat.runtime.stop();
  const downhill = setup(), slope = add(downhill, 'roller-gravity', {rise: -.2}), downhillCarton = product(downhill, slope);
  downhill.runtime.start('hall'); const down = belt(downhill, slope).packages[0], start = down.offset; advance(downhill, 1);
  assert(down.offset > start + .1, 'A descending unpowered surface accelerates under its declared gravity approximation.'); assert.equal(belt(downhill, slope).powered, false); downhill.runtime.stop();
  const impulse = setup(), unpowered = add(impulse, 'roller-gravity', {rise: 0}); product(impulse, unpowered, {initialVelocity: .5});
  impulse.runtime.start('hall'); const pushed = belt(impulse, unpowered).packages[0], began = pushed.offset; advance(impulse, 4);
  assert(pushed.offset > began + .5 && pushed.offset < began + .7); assert.equal(pushed.gravityVelocity, 0, 'Rolling resistance dissipates the declared impulse without a hidden drive.'); impulse.runtime.stop();
  const uphill = setup(), incline = add(uphill, 'belt-incline', {speed: 1}), upper = add(uphill, 'belt-incline', {speed: 1}); link(uphill, incline, upper);
  uphill.runtime.start('hall'); uphill.runtime.insertProduct(incline.userData.editorId); advance(uphill, 6);
  assert.equal(belt(uphill, upper).entryCount, 1, JSON.stringify({notices: uphill.notices, source: uphill.runtime.records.get(incline.userData.editorId).variables, packages: belt(uphill, incline).packages.map(item => ({offset:item.offset,blocked:item.blocked,box:item.box}))})); noLoss(uphill); uphill.runtime.stop();

  for (const variant of ['popup-belt', 'roller-turntable', 'pusher', 'steer', 'distributor']) {
    const f = setup(), machine = add(f, variant, {routing: 'branch', speed: 1, actuatorTime: .3, turnTime: .6}), receiver = add(f, 'belt', {speed: 1}); link(f, machine, receiver, 'branch');
    const saved = JSON.stringify(await f.document.serialize()); f.runtime.start('hall');
    f.runtime.command(receiver.userData.editorId, 'pause'); f.runtime.insertProduct(machine.userData.editorId); advance(f, 3);
    const source = belt(f, machine), item = source.packages[0]; assert(item); assert.equal(item.mechanismStage, 'receive'); assert.equal(source.mechanismPhase, 'waitingDestination', variant);
    const identity = item.mesh; f.runtime.command(receiver.userData.editorId, 'start'); advance(f, .15);
    assert.equal(item.mechanismStage, 'actuating');
    const checkpointed = JSON.parse(JSON.stringify(checkpoint.captureSimulation(f.runtime))), at = item.mechanismElapsed;
    advance(f, .2); const uninterrupted = canonical(f);
    checkpoint.restoreSimulation(f.runtime, checkpointed); assert.equal(belt(f, machine).packages[0].mechanismElapsed, at, 'Partial actuator timer resumes.');
    advance(f, .2); assert.deepEqual(canonical(f), uninterrupted, 'Actuator state, geometry and future simulation match uninterrupted execution.');
    const resumedIdentity = belt(f, machine).packages[0].mesh; advance(f, 5);
    assert.equal(belt(f, receiver).entryCount, 1, variant + ': ' + f.notices.join('\n'));
    assert(belt(f, receiver).packages.some(load => load.mesh === resumedIdentity)); noLoss(f);
    assert(f.runtime.events.some(event => event.type === 'mechanism-transfer'));
    f.runtime.stop(); assert.equal(JSON.stringify(await f.document.serialize()), saved);
  }
  for (const variant of ['pallet-chain', 'popup-chain', 'pallet-turntable', 'pallet-elevator']) {
    const f = setup(), machine = add(f, variant, {speed: 1, rise: variant === 'pallet-elevator' ? 1 : 0, turnTime: .5, actuatorTime: .3, verticalSpeed: .5}), receiver = add(f, 'pallet-chain', {speed: 1});
    link(f, machine, receiver, configuration(f, machine).layout === 'tee' ? 'branch' : 'output');
    const source = f.document.addPrefab('hall', 'source'), sourceConfig = f.document.getBehaviors(source).find(config => config.type === 'source');
    f.document.setBehaviors(source, [Object.assign({}, sourceConfig, {loadMode: 'pallet', mass: 12, initialCount: 1, autoGenerate: false})]); f.document.setTransform(source, {position: [-10, 1.02, 0]});
    f.runtime.start('hall'); const inventory = f.runtime.records.get(source.userData.editorId).components.source, load = inventory.queue[0].product;
    assert.equal(f.runtime.productMetadata(load).mass, 68, 'The pallet mass includes all four products and the declared 20 kg teaching pallet.');
    f.runtime.sourceRuntime.picked(load);
    assert(f.runtime.captureProduct(load, {record: f.runtime.records.get(machine.userData.editorId), belt: belt(f, machine), route: configuration(f, machine).layout === 'tee' ? 'branch' : 'main', offset: -layout.pathLength(configuration(f, machine)) / 2, lateral: 0}));
    const mesh = load.object; advance(f, 11);
    assert.equal(belt(f, receiver).entryCount, 1, variant + ': ' + f.notices.join('\n'));
    assert(belt(f, receiver).packages.some(item => item.mesh === mesh)); noLoss(f); f.runtime.stop();
  }
  // Two real incoming branches reserve the same Y merge one load at a time.
  const merge = setup(), merger = add(merge, 'merge-angle', {speed: 1, mergeAngle: 45, turnTime: .4}), main = add(merge, 'belt', {speed: 1}), lateral = add(merge, 'belt', {speed: 1}), merged = add(merge, 'belt', {speed: 1});
  link(merge, main, merger); link(merge, lateral, merger, 'output', 'branch');
  // The second alignment moves the merger; keep both source ports aligned.
  merge.scene.updateMatrixWorld(true);
  const inlets = layout.ports(configuration(merge, merger)), mainPosition = new THREE.Vector3(inlets.input.x - 2, inlets.input.y, inlets.input.z).applyMatrix4(merger.matrixWorld);
  merge.document.setTransform(main, {position: mainPosition.toArray(), quaternion: merger.quaternion.toArray()});
  link(merge, merger, merged); merge.runtime.start('hall'); merge.runtime.insertProduct(main.userData.editorId); merge.runtime.insertProduct(lateral.userData.editorId); advance(merge, 14);
  assert.equal(belt(merge, merger).entryCount, 2, merge.notices.join('\n')); assert.equal(belt(merge, merged).entryCount, 2); noLoss(merge, 2); merge.runtime.stop();
  const lift = setup(), elevator = add(lift, 'box-elevator', {length: 2.4, rise: 1.2, speed: 1, verticalSpeed: .5}), top = add(lift, 'belt', {speed: 1}); link(lift, elevator, top);
  lift.runtime.start('hall'); lift.runtime.insertProduct(elevator.userData.editorId); advance(lift, 2);
  assert(belt(lift, elevator).elevatorPosition > 0 && belt(lift, elevator).elevatorPosition < 1.2);
  const midway = JSON.parse(JSON.stringify(checkpoint.captureSimulation(lift.runtime))), elevation = belt(lift, elevator).elevatorPosition;
  advance(lift, .4); const elevatorUninterrupted = canonical(lift);
  checkpoint.restoreSimulation(lift.runtime, midway); assert.equal(belt(lift, elevator).elevatorPosition, elevation);
  advance(lift, .4); assert.deepEqual(canonical(lift), elevatorUninterrupted, 'Resuming mid-lift reproduces the same future platform and load.');
  advance(lift, 6); assert.equal(belt(lift, top).entryCount, 1, lift.notices.join('\n')); noLoss(lift);
  advance(lift, 3); assert.equal(belt(lift, elevator).elevatorPosition, 0); assert.equal(belt(lift, elevator).mechanismPhase, 'ready'); lift.runtime.stop();
  const zones = setup(), accumulator = add(zones, 'roller-zones', {speed: 1}), blocked = add(zones, 'belt', {speed: 1, running: false}); link(zones, accumulator, blocked);
  zones.runtime.start('hall'); for (let index = 0; index < 4; index++) { zones.runtime.insertProduct(accumulator.userData.editorId); advance(zones, 1.1); } advance(zones, 6);
  assert.equal(belt(zones, accumulator).packages.length, 4); assert.equal(belt(zones, accumulator).zonesOccupied, 4);
  const occupancy = belt(zones, accumulator).packages.map(item => Math.floor((item.offset + 2) / 1)); assert.equal(new Set(occupancy).size, 4);
  zones.runtime.command(blocked.userData.editorId, 'start'); advance(zones, 9); assert(belt(zones, blocked).entryCount > 0); noLoss(zones, 4); zones.runtime.stop();
  const manual = setup(), station = add(manual, 'manual-station', {speed: 1, operationTime: .5}), out = add(manual, 'belt', {speed: 1}); link(manual, station, out);
  manual.runtime.start('hall'); manual.runtime.insertProduct(station.userData.editorId); advance(manual, 2);
  assert.equal(belt(manual, station).mechanismPhase, 'waitingOperator'); manual.runtime.command(station.userData.editorId, 'operator'); advance(manual, .1);
  assert.equal(belt(manual, station).mechanismPhase, 'waitingManualAction'); manual.runtime.command(station.userData.editorId, 'dispatch'); advance(manual, 3);
  assert.equal(belt(manual, out).entryCount, 1); manual.runtime.stop();
  console.log('Transportadores: admisión física declarada, gravedad sin motor, desnivel 3D, secuencias interbloqueadas de transferencia y giro, empujador, zonas, elevador, estación con acción manual y reanudación parcial sin pérdida de cargas OK.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
