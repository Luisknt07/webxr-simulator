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
const vehicle = [...simulation.records.values()].find(record => record.components.vehicle), robot = [...simulation.records.values()].find(record => record.components.robot), belt = simulation.records.get(vehicle.components.vehicle.config.sourceId);
assert(robot && belt && vehicle); assert.equal(document.additions.size, 22);
assert.equal([...simulation.records.values()].filter(record=>record.components.conveyor).length,2,'The public URL now uses the existing two-conveyor transfer recipe.');
const transferSnapshot=JSON.parse(fs.readFileSync(path.join(ROOT,'projects/smarttwin/scenes/vr-robot-transfer.json'),'utf8'));
for(const row of transferSnapshot.project.document.rooms.hall.additions)for(const behavior of row.behaviors||[])if(behavior.type==='vehicle'&&behavior.forkColor==='#677682')behavior.forkColor=schema.vehicles.DEFAULTS.forkColor;
assert.deepEqual(snapshot.project.document,transferSnapshot.project.document,'The demonstration uses the same complete scene document as the maintained transfer lesson.');
const architecture = [...document.additions.values()].map(entry => entry.object), walls = architecture.filter(object => /CEDI.*RV pared/.test(object.name)), roof = architecture.filter(object => /CEDI.*RV cubierta industrial cerrada/.test(object.name));
assert.equal(walls.length, 4, 'The selected public cell must have four distinct industrial walls.');
assert.equal(roof.length, 1, 'The selected public cell must have one enclosed industrial roof.');
assert.equal(architecture.filter(object => /RV luminaria LED de techo/.test(object.name)).length, 4);
scene.updateMatrixWorld(true);
for (let i=0;i<walls.length;i++) for (let j=i+1;j<walls.length;j++) {
  const a=new THREE.Box3().setFromObject(walls[i]), b=new THREE.Box3().setFromObject(walls[j]);
  const overlap=Math.max(0,Math.min(a.max.x,b.max.x)-Math.max(a.min.x,b.min.x))*Math.max(0,Math.min(a.max.y,b.max.y)-Math.max(a.min.y,b.min.y))*Math.max(0,Math.min(a.max.z,b.max.z)-Math.max(a.min.z,b.min.z));
  assert(overlap<1e-8,'Wall boxes must meet without overlapping volume.');
}
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
console.log(JSON.stringify({app: 'public-viewer',objects: 22,conveyors:2,maintainedTransferRecipe:true,walls:4,roof:1,robotCycle: true,beltStop: true,physicalForkPickup: true,sameEntry: true,units: 4,mass: 33,restart: true,dispose: true}));
