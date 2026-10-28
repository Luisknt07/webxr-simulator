'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const behaviorSchema = require('../shared/behaviors.js');
const automationSchema = require('../shared/automation.js');
const robotSchema = require('../shared/robots.js');
const robotKinematics = require('../shared/robot-kinematics.js');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const prefabs = new Function('THREE', 'robotSchema', 'kinematics', read('src/editor/RobotPrefabs.js') + '\nreturn {createRobot,updateRobotPose};')(THREE, robotSchema, robotKinematics);
const RobotRuntime = new Function('THREE', 'robotSchema', 'robotKinematics', 'updateRobotPose', read('src/editor/RobotRuntime.js').replace('default class RobotRuntime', 'return class RobotRuntime'))(THREE, robotSchema, robotKinematics, prefabs.updateRobotPose);
function productVisual(spec, load) {
  const size = behaviorSchema.productSources.loadSize(spec, load), group = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxBufferGeometry(size.width, size.height, size.depth), new THREE.MeshStandardMaterial({color: spec.color}));
  mesh.position.y = size.height / 2; group.add(mesh); group.userData.sourceProduct = Object.assign({}, spec, {units: behaviorSchema.productSources.unitsFor(load, spec)}); return group;
}
const ProductSourceRuntime = new Function('THREE', 'behaviorSchema', 'createSourceProductVisual', read('src/editor/ProductSourceRuntime.js').replace('default class ProductSourceRuntime', 'return class ProductSourceRuntime'))(THREE, behaviorSchema, productVisual);
const ProcessorRuntime = require('./load-processor-runtime')(THREE, behaviorSchema);
const PalletQueueRuntime = require('./load-pallet-queue-runtime')(THREE, behaviorSchema);
const ProductFeedback = new Function('THREE', read('src/editor/ProductFeedback.js').replace('default class ProductFeedback', 'return class ProductFeedback'))(THREE);
const ObjectPlacement = require('./load-object-placement')(THREE);
const Runtime = new Function('THREE', 'behaviorSchema', 'automationSchema', 'createProductVisual', 'ProductFeedback', 'ObjectPlacement', 'ProductSourceRuntime', 'ProcessorRuntime', 'PalletQueueRuntime', 'RobotRuntime',
  read('src/editor/SimulationRuntime.js').replace('default class SimulationRuntime', 'return class SimulationRuntime'))(THREE, behaviorSchema, automationSchema, () => productVisual({width: .25, height: .25, depth: .25, color: '#ab7842'}, {}), ProductFeedback, ObjectPlacement, ProductSourceRuntime, ProcessorRuntime, PalletQueueRuntime, RobotRuntime);

let sequence = 0;
function fixture(family = 'articulated', options = {}) {
  const scene = new THREE.Scene(), objects = [], configs = new Map();
  const document = {getObjects: () => objects, getRoot: () => scene, getBehaviors: object => configs.get(object), getRoomId: () => 'hall'};
  const add = (type, values, position) => {
    const config = Object.assign(behaviorSchema.defaultBehavior(type), values), object = new THREE.Group();
    if (type === 'robot') object.add(prefabs.createRobot(config));
    if (type === 'conveyor') { const surface = new THREE.Group(); surface.userData.editorConveyorTop = 0; object.add(surface); }
    object.userData.editorId = 'robot-fixture-' + (++sequence); object.userData.editorPrefabKey = type;
    object.position.fromArray(position || [0, 0, 0]); object.name = type + ' ' + object.userData.editorId; scene.add(object); objects.push(object); configs.set(object, [config]); return object;
  };
  const source = add('source', {initialCount: 3, autoGenerate: false, delivery: 'manual', running: true, width: .25}, [.85, .65, .3]);
  const output = add('source', {initialCount: 0, autoGenerate: false, delivery: 'manual', running: true, capacity: 20, width: .25}, [.85, .65, -.5]);
  const config = Object.assign(robotSchema.defaults(family), {running: true, cycleTime: .3, speed: 3, sourceId: source.userData.editorId, outputId: output.userData.editorId, withPanel: false}, options);
  const robot = add('robot', config);
  const authoredRig = robot.children[0].userData.robotRig;
  const authoredJawMatrices = [...authoredRig.fingers, ...(authoredRig.gripperRail ? [authoredRig.gripperRail] : [])].map(node => { node.updateMatrix(); return node.matrix.toArray(); });
  configs.get(source)[0].outputId = robot.userData.editorId;
  const ctx = {scene, editor: {active: false}, raycontrol: {states: {}, addState(name, state) { this.states[name] = state; }, activateState() {}, deactivateState() {}}};
  const runtime = new Runtime(ctx, document); scene.updateMatrixWorld(true); runtime.start('hall');
  return {scene, runtime, document, source, output, robot, add, configs, ctx, authoredJawMatrices, r: runtime.records.get(robot.userData.editorId).components.robot,
    input: runtime.records.get(source.userData.editorId).components.source, result: runtime.records.get(output.userData.editorId).components.source};
}
function advance(f, seconds) { for (let t = 0; t < seconds - 1e-9; t += 1 / 60) { f.scene.updateMatrixWorld(true); f.runtime.execute(Math.min(1 / 60, seconds - t)); } }
function sum(f) { return f.input.queue.length + f.result.queue.length + (f.r.entry ? 1 : 0); }
function until(f, condition, seconds = 30) { for (let t = 0; t < seconds; t += 1 / 60) { if (condition()) return; advance(f, 1 / 60); } throw new Error('Timeout: ' + JSON.stringify(f.runtime.records.get(f.robot.userData.editorId).variables)); }

function run() {
  const f = fixture(); const ids = f.input.queue.map(entry => entry.id), original = f.input.queue[0].product.object;
  until(f, () => f.r.completed === 3); assert.equal(f.result.queue.length, 3); assert.deepEqual(f.result.queue.map(entry => entry.id), ids); assert.equal(f.result.queue[0].product.object, original);
  assert.equal(f.r.receivedUnits, f.r.deliveredUnits); assert.equal(sum(f), 3); assert.equal(new Set(f.result.queue).size, 3);
  assert(f.runtime.getPanelSnapshot(f.robot.userData.editorId, 'line').memberIds.includes(f.source.userData.editorId));
  const analytics = f.runtime.getAnalyticsSnapshot(f.robot.userData.editorId); assert(analytics); assert(f.r.busySeconds > 0);
  const r = f.r; const accounted = r.busySeconds + r.idleSeconds + r.setupSeconds + r.blockedSeconds + r.downSeconds;
  assert(Math.abs(accounted - r.elapsed) < 1e-7, 'Each robot-second belongs to exactly one phase.');
  f.runtime.stop(); assert.equal(Object.keys(f.ctx.raycontrol.states).length, 0);

  const blocked = fixture(); blocked.result.config.capacity = 1; until(blocked, () => blocked.r.completed === 1 && blocked.r.entry);
  advance(blocked, 8); assert.equal(blocked.r.completed, 1); assert.equal(sum(blocked), 3); assert(blocked.r.blocked);
  assert(!blocked.runtime.pickupProduct(blocked.r.entry.product, new THREE.Group()), 'A held robot load cannot be stolen by mouse or XR.');
  const heldId = blocked.r.entry.id; blocked.result.config.capacity = 20; until(blocked, () => blocked.r.completed === 3);
  assert(blocked.result.queue.some(entry => entry.id === heldId)); assert.equal(sum(blocked), 3); blocked.runtime.stop();

  const paused = fixture(); until(paused, () => !!paused.r.entry);
  const load = paused.r.entry; paused.runtime.command(paused.robot.userData.editorId, 'pause'); const elapsed = paused.r.phaseElapsed;
  advance(paused, .5); assert.equal(paused.r.phaseElapsed, elapsed); assert.equal(paused.r.entry, load);
  paused.runtime.command(paused.robot.userData.editorId, 'emergency'); assert(!paused.r.running);
  assert.throws(() => paused.runtime.command(paused.robot.userData.editorId, 'start'), /emergencia/);
  paused.runtime.command(paused.robot.userData.editorId, 'resetEmergency'); assert(!paused.r.running);
  paused.runtime.command(paused.robot.userData.editorId, 'start'); until(paused, () => paused.r.completed === 3); assert.equal(sum(paused), 3); paused.runtime.stop();

  const heavy = fixture('articulated', {payloadKg: .1}); advance(heavy, .2); assert(heavy.r.fault.includes('kg')); assert.equal(heavy.input.queue.length, 3); assert.equal(heavy.r.received, 0); heavy.runtime.stop();
  const far = fixture('articulated', {reach: .3}); advance(far, .2); assert(far.r.fault.includes('alcance')); assert.equal(far.input.queue.length, 3); far.runtime.stop();
  const manual = fixture('articulated', {mode: 'manual'}); advance(manual, .2); assert.equal(manual.r.phase, 'idle'); manual.runtime.command(manual.robot.userData.editorId, 'dispatch'); until(manual, () => manual.r.completed === 1 && manual.r.phase === 'idle'); advance(manual, .3); assert.equal(manual.r.completed, 1); manual.runtime.stop();

  const process = fixture('articulated', {operation: 'process', tool: 'process', processTime: .3, setupTime: .2});
  const processed = process.input.queue[0], matrix = processed.product.object.matrixWorld.clone(), sourceRecord = process.runtime.records.get(process.source.userData.editorId);
  until(process, () => process.r.completed === 1 && process.r.phase === 'idle'); advance(process, .5);
  assert.equal(process.r.completed, 1, 'A nozzle cannot repeatedly process the same stationary carton.');
  assert.equal(process.input.queue.length, 3); assert.equal(process.result.queue.length, 0); assert.equal(processed.ownerId, sourceRecord.id);
  assert(processed.product.object.matrixWorld.equals(matrix), 'A process nozzle never picks up, carries or teleports a load.');
  assert.equal(processed.processHistory[0].inSitu, true); assert.equal(process.r.entry, null);
  assert.equal(process.runtime.getPanelSnapshot(process.robot.userData.editorId, 'line').variables.exitCount, 0, 'A nozzle operation is not a physical line shipment.');
  assert(Math.abs(process.r.setupSeconds - .2) < .02); assert(Math.abs(process.r.processSeconds - .3) < .02); process.runtime.stop();

  const gated = fixture('articulated', {operation: 'process', tool: 'process', processTime: .2, outputId: ''}); gated.runtime.stop();
  gated.configs.get(gated.source)[0].delivery = 'automatic'; gated.configs.get(gated.source)[0].outputInterval = .1;
  gated.configs.get(gated.source)[0].outputId = gated.output.userData.editorId;
  gated.output.position.copy(gated.source.position).add(new THREE.Vector3(1.7, 0, 0));
  gated.scene.updateMatrixWorld(true); gated.runtime.start('hall'); gated.r = gated.runtime.records.get(gated.robot.userData.editorId).components.robot;
  gated.result = gated.runtime.records.get(gated.output.userData.editorId).components.source;
  until(gated, () => gated.result.queue.length === 3);
  assert.equal(gated.r.completed, 3); assert(gated.result.queue.every(entry => entry.processHistory[0].inSitu));
  assert.equal(gated.runtime.getPanelSnapshot(gated.robot.userData.editorId, 'line').variables.exitCount, 0, 'A final FIFO has no physical shipment until it dispatches.'); gated.runtime.stop();

  const beltProcess = fixture('articulated', {operation: 'process', tool: 'process', processTime: .2, outputId: ''}); beltProcess.runtime.stop();
  beltProcess.configs.get(beltProcess.source)[0].initialCount = 0;
  const beltObject = beltProcess.add('conveyor', {powered: true, running: true, autoSpawn: false, speed: 1, length: 1, width: .6,
    withPanel: false, withSensors: false, withPallet: false, outputId: beltProcess.output.userData.editorId}, [.8, .65, .3]);
  beltProcess.configs.get(beltProcess.robot)[0].sourceId = beltObject.userData.editorId;
  beltProcess.output.position.set(2.15, .65, .3); beltProcess.scene.updateMatrixWorld(true); beltProcess.runtime.start('hall');
  beltProcess.r = beltProcess.runtime.records.get(beltProcess.robot.userData.editorId).components.robot;
  beltProcess.result = beltProcess.runtime.records.get(beltProcess.output.userData.editorId).components.source;
  const moving = beltProcess.runtime.records.get(beltObject.userData.editorId); assert(beltProcess.runtime.spawn(moving, moving.components.conveyor));
  until(beltProcess, () => beltProcess.result.queue.length === 1); assert.equal(beltProcess.r.completed, 1);
  assert.equal(beltProcess.result.queue[0].processHistory[0].inSitu, true); beltProcess.runtime.stop();

  const pickBelt = fixture(); pickBelt.runtime.stop(); pickBelt.configs.get(pickBelt.source)[0].initialCount = 0;
  const pickupConveyor = pickBelt.add('conveyor', {powered: true, running: true, autoSpawn: false, speed: 1, length: 1, width: .6,
    withPanel: false, withSensors: false, withPallet: false, outputId: pickBelt.robot.userData.editorId}, [.8, .65, .3]);
  pickBelt.configs.get(pickBelt.robot)[0].sourceId = pickupConveyor.userData.editorId;
  pickBelt.scene.updateMatrixWorld(true); pickBelt.runtime.start('hall'); pickBelt.r = pickBelt.runtime.records.get(pickBelt.robot.userData.editorId).components.robot;
  pickBelt.result = pickBelt.runtime.records.get(pickBelt.output.userData.editorId).components.source;
  const pickup = pickBelt.runtime.records.get(pickupConveyor.userData.editorId); assert(pickBelt.runtime.spawn(pickup, pickup.components.conveyor));
  const pickedMesh = pickup.components.conveyor.packages[0].mesh;
  until(pickBelt, () => pickBelt.result.queue.length === 1); assert.equal(pickBelt.result.queue[0].product.object, pickedMesh);
  assert.equal(pickup.components.conveyor.exitCount, 1); assert.equal(pickBelt.runtime.packageCount, 0); pickBelt.runtime.stop();

  const pulled = fixture(); pulled.runtime.stop(); pulled.configs.get(pulled.source)[0].outputId = ''; pulled.scene.updateMatrixWorld(true); pulled.runtime.start('hall');
  pulled.r = pulled.runtime.records.get(pulled.robot.userData.editorId).components.robot; pulled.result = pulled.runtime.records.get(pulled.output.userData.editorId).components.source;
  const scope = pulled.runtime.getPanelSnapshot(pulled.robot.userData.editorId, 'line'); assert(scope.memberIds.includes(pulled.source.userData.editorId));
  const bounds = pulled.runtime.analyticsBoundaries(scope.memberIds, 'line'); assert.deepEqual(bounds.inputIds, [pulled.source.userData.editorId]);
  assert.deepEqual(bounds.outputIds, [pulled.output.userData.editorId]); until(pulled, () => pulled.r.completed === 3); pulled.runtime.stop();

  const mobile = fixture('amr', {speed: 3, waypointsJson: '[{"x":0,"y":0,"z":1}]'}); until(mobile, () => mobile.r.completed === 3, 50);
  assert(mobile.r.distance > 0); assert(mobile.r.batteryPercent < 100); assert.equal(sum(mobile), 3);
  const object = mobile.result.queue[0].product.object; assert(object.position.y > -.01); mobile.runtime.stop();
  const slow = fixture('amr', {speed: 3, waypointsJson: '[{"x":0,"y":0,"z":1,"speed":0.2}]'});
  advance(slow, .5); assert(slow.r.distance > .05 && slow.r.distance <= .101, 'A waypoint applies its explicit local speed limit.');
  const travelled = slow.r.distance; slow.runtime.setVariable(slow.robot.userData.editorId, 'speed', .1); advance(slow, .5);
  assert(slow.r.distance - travelled <= .0501, 'The lower current global speed overrides a faster waypoint limit.'); slow.runtime.stop();

  for (const family of ['scara', 'delta', 'cartesian', 'palletizer', 'shuttle']) {
    const cell = fixture(family), config = cell.r.config, joints = robotKinematics.homePose(config).joints;
    const a = robotKinematics.forward(config, joints).toolPosition;
    const next = joints.slice(); next[0] += family === 'cartesian' || family === 'shuttle' ? .35 : .12;
    const b = robotKinematics.forward(config, next).toolPosition;
    const supported = ['fork', 'platform'].includes(config.tool), height = supported ? .005 : .255;
    cell.source.position.fromArray(a); cell.source.position.y -= height;
    cell.output.position.fromArray(b); cell.output.position.y -= height;
    cell.scene.updateMatrixWorld(true); cell.runtime.sourceRuntime.materialize(cell.runtime.records.get(cell.source.userData.editorId));
    until(cell, () => cell.r.completed === 3); assert.equal(sum(cell), 3, family + ': conserve three products');
    assert.equal(cell.result.queue[0].product.object.parent, cell.result.helper); cell.runtime.stop();
  }

  for (const kind of ['conveyor', 'processor', 'palletQueue']) {
    // This receiver-API regression deliberately spans the former medium-cell
    // envelope (including distant pallet bays), not the new compact catalogue.
    const cell = fixture('articulated', {reach: 2.2, baseHeight: .65}); cell.runtime.stop();
    const values = kind === 'conveyor' ? {powered: true, running: true, autoSpawn: false, length: 1, speed: 0, withPallet: false, withPanel: false, withSensors: false} :
      kind === 'processor' ? {powered: true, running: true, setupTime: 0, processTime: .1, delivery: 'manual'} :
        {running: true, palletCount: 1, columns: 2, rows: 2, layers: 2, capacity: 8, width: 1.2, depth: .8, delivery: 'manual'};
    const target = cell.add(kind, values, [.9, .65, -.6]); cell.configs.get(cell.robot)[0].outputId = target.userData.editorId;
    cell.scene.updateMatrixWorld(true); cell.runtime.start('hall'); cell.r = cell.runtime.records.get(cell.robot.userData.editorId).components.robot;
    cell.input = cell.runtime.records.get(cell.source.userData.editorId).components.source;
    const targetRecord = cell.runtime.records.get(target.userData.editorId);
    until(cell, () => cell.r.completed === 3);
    advance(cell, .2);
    const count = kind === 'conveyor' ? targetRecord.components.conveyor.packages.length : kind === 'processor' ? targetRecord.components.processor.output.queue.length : targetRecord.components.palletQueue.queue.length;
    assert.equal(count, 3, kind + ': robot delivers existing loads through actual receiver API');
    assert.equal(cell.r.deliveredUnits, 3); cell.runtime.stop();
  }

  const obstruction = fixture('agv', {speed: 2}); until(obstruction, () => !!obstruction.r.entry);
  obstruction.ctx.collisionWorld = {testBox: () => true}; const frozen = obstruction.robot.position.clone(); advance(obstruction, .5);
  assert(obstruction.r.blocked); assert(obstruction.robot.position.equals(frozen)); assert.equal(sum(obstruction), 3);
  obstruction.ctx.collisionWorld = null; until(obstruction, () => obstruction.r.completed === 3); obstruction.runtime.stop();

  for (const width of [.12, .8, 1.1]) {
    const jaws = fixture('articulated', {maxProductWidth: 1.5, maxProductDepth: 1.5}); jaws.runtime.stop();
    Object.assign(jaws.configs.get(jaws.source)[0], {width, depth: width}); jaws.scene.updateMatrixWorld(true); jaws.runtime.start('hall');
    jaws.r = jaws.runtime.records.get(jaws.robot.userData.editorId).components.robot;
    assert.notEqual(jaws.r.initialPose, jaws.r.pose, 'Authored home pose cannot alias a mutable runtime pose.');
    until(jaws, () => !!jaws.r.entry); advance(jaws, .05);
    assert(Math.abs(jaws.r.pose.gripSpan - width) < 1e-5, 'The actual jaw gap adapts to the current load before Stop.');
    jaws.runtime.stop(); const rig = jaws.robot.children[0].userData.robotRig;
    const restored = [...rig.fingers, ...(rig.gripperRail ? [rig.gripperRail] : [])].map(node => { node.updateMatrix(); return node.matrix.toArray(); });
    assert.deepEqual(restored, jaws.authoredJawMatrices, 'Stop restores exact authored finger and jaw-rail local matrices for load width ' + width);
  }

  // Actual triangle collision tree: a tall, wide carton strikes a small side
  // obstruction which is entirely clear of the AMR's own chassis footprint.
  const overhang = fixture('amr', {speed: 3, maxProductWidth: 1.6}); overhang.runtime.stop();
  Object.assign(overhang.configs.get(overhang.source)[0], {width: 1.4});
  overhang.scene.updateMatrixWorld(true); overhang.runtime.start('hall');
  overhang.r = overhang.runtime.records.get(overhang.robot.userData.editorId).components.robot;
  overhang.result = overhang.runtime.records.get(overhang.output.userData.editorId).components.source;
  until(overhang, () => !!overhang.r.entry); advance(overhang, 1 / 60);
  const product = overhang.r.entry.product, originalEntry = overhang.r.entry;
  const {getGeometryTree} = require('./load-geometry-acceleration.js')(THREE);
  const CollisionWorld = new Function('THREE', 'getGeometryTree', read('src/lib/CollisionWorld.js').replace('default class CollisionWorld', 'return class CollisionWorld'))(THREE, getGeometryTree);
  const obstacle = new THREE.Mesh(new THREE.BoxBufferGeometry(.02, .10, .14), new THREE.MeshBasicMaterial());
  obstacle.position.set(product.item.box.min.x - .025, .53, product.item.box.getCenter(new THREE.Vector3()).z); overhang.scene.add(obstacle);
  overhang.scene.updateMatrixWorld(true); const world = overhang.ctx.collisionWorld = new CollisionWorld(overhang.ctx, overhang.document); world.setRoom('hall');
  const record = overhang.runtime.records.get(overhang.robot.userData.editorId), segment = overhang.r.route[overhang.r.routeIndex];
  const current = record.object.getWorldPosition(new THREE.Vector3()), direction = segment.position.clone().sub(current).setY(0).normalize();
  const movement = direction.clone().multiplyScalar(overhang.r.speed / 60), next = current.clone().add(movement);
  const yaw = Math.atan2(direction.x, direction.z), rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), config = overhang.r.config;
  const body = new THREE.Box3(new THREE.Vector3(-config.length / 2, config.baseHeight, -config.width / 2),
    new THREE.Vector3(config.length / 2, config.baseHeight + config.height, config.width / 2)).applyMatrix4(new THREE.Matrix4().compose(next, rotation, new THREE.Vector3(1, 1, 1)));
  const options = {ignore: [record.object, product.object], extraBoxes: []};
  assert(!world.testBox(body, options), 'The proposed bare chassis motion really clears the obstacle.');
  assert(world.sweepBox(product.item.box, movement, options).blocked, 'The actual payload overhang really strikes obstacle triangles.');
  const position = record.object.position.clone(), quaternion = record.object.quaternion.clone(), matrixBefore = product.object.matrixWorld.clone();
  const distance = overhang.r.distance, battery = overhang.r.batteryPercent; advance(overhang, 1 / 60);
  assert(overhang.r.blocked); assert(record.object.position.equals(position)); assert(record.object.quaternion.equals(quaternion));
  assert(product.object.matrixWorld.equals(matrixBefore), 'Blocked payload movement rolls the complete mobile assembly back.');
  assert.equal(overhang.r.distance, distance); assert.equal(overhang.r.batteryPercent, battery); assert.equal(overhang.r.entry, originalEntry);
  overhang.scene.remove(obstacle); world.invalidate(obstacle); until(overhang, () => overhang.r.completed === 1);
  assert(overhang.result.queue.some(entry => entry.id === originalEntry.id)); overhang.runtime.stop(); obstacle.geometry.dispose(); obstacle.material.dispose();
  console.log('Robots: real kinematic geometry, custody conservation, interlocks, backpressure, manual cycles, process/setup, analytics and mobile missions passed.');
}
module.exports = {THREE, behaviorSchema, robotSchema, robotKinematics, prefabs, RobotRuntime, Runtime, fixture, advance, until, sum};
if (require.main === module) run();
