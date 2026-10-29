const __layout = require("../../../tooling/layout.cjs");
'use strict';
// Real selected snapshot, production prefab geometry, collision queries and
// logistics runtime. There is no SceneEditor, backend or native room fixture.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const ROOT = __layout.map(path.resolve(__layout.oldDir("apps/public-viewer/tests/runtime.cjs"), '../../..')), THREE = require('three');
const schema = require(__layout.map(path.join(ROOT, "modules/logistica-industrial/contracts/behaviors.js")));
const fixtureSource = fs.readFileSync(__layout.map(path.join(ROOT, "tests/legacy/test-conveyor-mechanisms.js")), 'utf8');
const fixtures = new Function('require', '__dirname', fixtureSource.slice(0, fixtureSource.indexOf('async function run()')) + '\nreturn {Runtime, CollisionWorld, prefabs};')
  (require('node:module').createRequire(__layout.map(path.join(ROOT, "tests/legacy/test-conveyor-mechanisms.js"))), __layout.map(path.join(ROOT, 'scripts')));
const prefabLoader = require(path.join(ROOT, 'tests/support/load-robot-prefabs.js'))(THREE);
assert.equal(prefabLoader.resolve('../../robots/runtime/RobotPrefabs.js').createRobot, prefabLoader.createRobot);
assert.equal(prefabLoader.resolve('../../montacargas/runtime/VehiclePrefabs.js').createVehicle, prefabLoader.createVehicle);
assert.throws(() => prefabLoader.resolve('../../other/RobotPrefabs.js?code=arbitrary'), /no compatible/);
const adapterSource = fs.readFileSync(__layout.map(path.join(ROOT, 'apps/public-viewer/SelectedSceneDocument.js')), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class SelectedSceneDocument', 'return class SelectedSceneDocument');
const SelectedSceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', adapterSource)(THREE, schema, fixtures.prefabs.createIndustrialPrefab);
const sceneFile = ['projects/smarttwin/scenes/vr-robot-dispatch.json', "projects/smarttwin/scenes/vr-robot-dispatch.json"].map(value => __layout.map(path.join(ROOT, value))).find(value => fs.existsSync(value));
const snapshot = JSON.parse(fs.readFileSync(sceneFile, 'utf8')), saved = JSON.stringify(snapshot), scene = new THREE.Scene();
const document = new SelectedSceneDocument(snapshot, scene), ctx = {scene};
ctx.collisionWorld = new fixtures.CollisionWorld(ctx, document);
const simulation = new fixtures.Runtime(ctx, document);
const VehicleRuntime = require(__layout.map(path.join(ROOT, "tests/support/load-vehicle-runtime.js")))(THREE);
simulation.vehicleRuntime = new VehicleRuntime(simulation);
simulation.start('hall');
const robot = simulation.records.get('custom-public-4'), belt = simulation.records.get('custom-public-5'), vehicle = simulation.records.get('custom-public-7');
assert(robot && belt && vehicle); assert.equal(document.additions.size, 13);
assert.equal(document.getObject('custom-public-2').visible, false, 'The camera marker must not render in the lesson.');
for (const entry of document.additions.values()) for (const node of entry.nodes.values()) for (const behavior of document.getBehaviors(node)) assert.notEqual(behavior.targetId, '@root');
for (let frame = 0; frame < 60 * 60 && !belt.components.conveyor.packages.length; frame++) {scene.updateMatrixWorld(true); simulation.execute(1 / 60);}
assert.equal(robot.components.robot.fault, '', robot.components.robot.warning);
assert.equal(robot.components.robot.completed, 1, 'The actual source pallet must complete the robot cycle.');
for (let frame = 0; frame < 60 * 30 && belt.components.conveyor.actualSpeed; frame++) {scene.updateMatrixWorld(true); simulation.execute(1 / 60);}
const item = belt.components.conveyor.packages[0], product = item && item.product;
assert(product); assert.equal(belt.components.conveyor.actualSpeed, 0, 'The real belt must stop for manual fork collection.');
const metadata = simulation.productMetadata(product), entry = product.sourceEntry;
assert.equal(metadata.units, 4); assert.equal(metadata.mass, 33); assert.equal(metadata.loadMode, 'pallet');
assert(simulation.vehicleRuntime.productPockets(product));
const api = simulation.vehicleRuntime, v = vehicle.components.vehicle, direction = new THREE.Vector3(0, 0, 1).applyQuaternion(vehicle.object.quaternion), yaw = Math.atan2(direction.x, direction.z);
const dock = api.pickupDock(vehicle, {yaw, targetId: belt.id}, product); assert(dock);
assert(api.applyPose(vehicle, {...v.pose, lift: dock.toolY - v.originWorld.y - v.config.forkBaseHeight}, true));
api.command(vehicle, 'parkingBrake', false);
const tick = input => {api.setInput(vehicle, input); scene.updateMatrixWorld(true); simulation.execute(1 / 60);};
for (let frame = 0; dock.position.clone().sub(vehicle.object.position).dot(direction) > .015 && frame < 60 * 40; frame++) tick({throttle: .08});
for (let frame = 0; frame < 90; frame++) tick({brake: 1});
assert(api.getDockingState(vehicle).ready, v.warning); assert(api.pickup(vehicle, product), v.warning);
assert.equal(v.entry, entry); assert.equal(belt.components.conveyor.packages.length, 0); assert.equal(entry.product.object, product.object);
assert.equal(simulation.productMetadata(product).units, 4); assert.equal(JSON.stringify(snapshot), saved, 'Read-only loading and simulation must not mutate the snapshot.');
simulation.stop(); assert.equal(simulation.products.size, 0);
simulation.start('hall'); assert.equal(simulation.records.get(robot.id).components.robot.completed, 0, 'Restart restores the authored robot pose and counters.'); simulation.stop();
document.dispose(); assert.equal(document.objects.size, 0); assert.equal(document.root.parent, null);
assert.throws(() => new SelectedSceneDocument({project: {document: {format: 'other'}}}, scene), /compatible/);
console.log(JSON.stringify({app: 'public-viewer',objects: 13,robotCycle: true,beltStop: true,physicalForkPickup: true,sameEntry: true,units: 4,mass: 33,restart: true,dispose: true}));
