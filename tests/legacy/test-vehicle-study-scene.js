const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const schema = require('../../modules/logistica-industrial/contracts/behaviors.js'), vehicles = require('../../modules/logistica-industrial/functions/montacargas/schema/vehicles.js');
const {Document} = require('./test-vehicle-storage.js'), {Runtime} = require('./test-robot-runtime.js');
const VehicleRuntime = require('../support/load-vehicle-runtime.js')(THREE), study = require('../support/load-study-scenes.js')(THREE, schema, Document);
const {getGeometryTree} = require('../support/load-geometry-acceleration.js')(THREE);
const collisionCode = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-vehicle-study-scene.js"), '../src/lib/CollisionWorld.js')), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class CollisionWorld', 'return class CollisionWorld');
const CollisionWorld = new Function('THREE', 'getGeometryTree', collisionCode)(THREE, getGeometryTree);
const near = (actual, expected, message) => assert(Math.abs(actual - expected) < 1e-5, message || actual + ' != ' + expected);
async function run() {
  const scene = new THREE.Scene(), root = new THREE.Group(); scene.add(root); const document = new Document({scene}); document.registerRoom('hall', root);
  study.studySceneBase(document, 'hall');
  const built = study.buildStudyScene(document, 'hall', 'forklift-training', {scene});
  const expected = vehicles.VARIANTS.filter(definition => vehicles.supports(definition.preset).forks).map(definition => definition.id);
  assert.deepEqual(built.stations.map(station => station.variant), expected); assert.equal(built.vehicles.length, 11); assert.equal(built.products.length, 22);
  assert.equal(built.conveyors.length, 22); assert.equal(built.receivers.length, 14); assert(built.environment && built.floorPresentation && built.aging);
  assert.equal(built.lines.length, 11); assert.equal(study.studySceneReport(document, built, 'hall').lines.length, 11);
  assert(!document.getObjects('hall').some(object => document.getBehaviors(object).some(value => value.type === 'source')), 'No replenishing generator disguises missing training loads.');
  assert.equal(document.studio.missions.length, 11); assert(document.studio.missions.every(mission => mission.steps[0].event === 'vehicle-delivered'));
  const authored = JSON.parse(JSON.stringify(await document.serialize())); require('../../apps/api/server/validation.js').validateDocument(authored, value => value);
  const plan = built.floorPresentation.plan, overlap = (a, b) => a[0] < b[2] - 1e-5 && a[2] > b[0] + 1e-5 && a[1] < b[3] - 1e-5 && a[3] > b[1] + 1e-5;
  assert.equal(plan.zones.length, 11); plan.zones.forEach(zone => plan.walkways.forEach(lane => assert(!overlap(zone, lane), 'Main circulation must not overlap a work-cell marking.')));
  built.stations.forEach((station, index) => {
    station.vehicle.updateWorldMatrix(true, true); const box = new THREE.Box3().setFromObject(station.vehicle);
    for (const other of [station.loaded, station.empty, station.stock, station.roller, station.chains]) {other.updateWorldMatrix(true, true); assert(!box.intersectsBox(new THREE.Box3().setFromObject(other)), station.variant + ' starts separately from its loads and receiving equipment.');}
    for (const next of built.stations.slice(index + 1)) assert(station.vehicle.position.distanceTo(next.vehicle.position) >= 19.9, 'Vehicles do not start stacked or in a shared driving bay.');
    for (const belt of [station.roller, station.chains]) {const config = document.getBehaviors(belt).find(value => value.type === 'conveyor'); near(belt.position.y - config.supportHeight, 0, 'Conveyor supports terminate at the actual floor.'); assert.equal(config.running, false); assert.equal(config.autoSpawn, false); assert(config.maxLoad >= 73);}
    if (station.rack) {const slab = station.rack.supports[0]; near(slab.position.y + slab.scale.y / 2, station.rack.height); station.rack.supports.slice(1, 5).forEach(post => near(post.position.y - post.scale.y / 2, 0));}
  });
  const ctx = {scene, editor: {active: false}, raycontrol: {states: {}, addState(name, state) {this.states[name] = state;}, activateState() {}, deactivateState() {}}};
  const runtime = new Runtime(ctx, document); runtime.vehicleRuntime = new VehicleRuntime(runtime); scene.updateMatrixWorld(true); runtime.start('hall');
  const world = ctx.collisionWorld = new CollisionWorld(ctx, document); world.setRoom('hall'); const api = runtime.vehicleRuntime;
  const controlStation = built.stations[0], rollerRecord = runtime.records.get(controlStation.roller.userData.editorId);
  runtime.command(controlStation.chains.userData.editorId, 'start'); runtime.execute(1 / 30); runtime.execute(1 / 30);
  assert(rollerRecord.components.conveyor.running, 'The one physical station panel enables both stopped transfer beds.');
  runtime.command(controlStation.chains.userData.editorId, 'stop'); runtime.execute(1 / 30); runtime.execute(1 / 30);
  assert.equal(rollerRecord.components.conveyor.running, false, 'Panel Stop also interlocks the roller bed before fork entry.');
  const step = (record, seconds, input) => {for (let frame = 0; frame < seconds * 30; frame++) {api.setInput(record, input); world.beginFrame(); try {scene.updateMatrixWorld(true); runtime.time += 1 / 30; api.step(1 / 30);} finally {world.endFrame();}}};
  function align(record, product) {
    const v = record.components.vehicle, first = api.pickupDock(record, {yaw: 0, targetId: product.record.id}, product); assert(first, v.config.variant + ': finite docking pose exists.');
    const lift = first.toolY - v.originWorld.y - v.config.forkBaseHeight, pose = Object.assign({}, v.pose);
    if (v.config.family === 'telehandler') pose.boomAngle = Math.asin(lift / (v.config.boomLength + pose.reach)); else pose.lift = lift;
    api.applyPose(record, pose, false);
    const dock = api.pickupDock(record, {yaw: 0, targetId: product.record.id}, product); record.object.position.copy(dock.position); record.object.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), dock.yaw); record.object.updateMatrix(); scene.updateMatrixWorld(true); world.invalidate(record.object);
    return Object.assign({}, v.pose);
  }
  function depositOn(record, receiver, entry) {
    const v = record.components.vehicle, product = entry.product, target = runtime.records.get(receiver.userData.editorId), point = {targetId: target.id};
    let destination = api.missionDestination(record, point); assert(destination, v.config.variant + ': receiving bay has actual free capacity.');
    let dock = api.dropDock(record, point, destination), pose = Object.assign({}, v.pose);
    const change = dock.toolY - api.rig(record).forks.getWorldPosition(new THREE.Vector3()).y;
    if (v.config.family === 'telehandler') pose.boomAngle = Math.asin(Math.sin(pose.boomAngle) + change / (v.config.boomLength + pose.reach)); else pose.lift += change;
    assert(api.applyPose(record, pose, true), v.config.variant + ': payload and hydraulic mechanism can reach the actual support height.');
    destination = api.missionDestination(record, point); assert(destination); dock = api.dropDock(record, point, destination);
    record.object.position.copy(dock.position); record.object.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), dock.yaw); record.object.updateMatrix(); scene.updateMatrixWorld(true); world.invalidate(record.object);
    assert(api.carry(record, true), v.config.variant + ': a clear lateral approach reaches the receiving bay without crossing equipment.');
    const preview = api.releasePlan(record, destination); assert(preview.ready, v.config.variant + ': ' + preview.reason);
    assert(api.release(record, destination), v.config.variant + ': ' + v.warning); assert.equal(v.entry, null);
    assert(target.components.palletQueue.queue.includes(entry)); assert.equal(entry.product, product); assert.equal(entry.ownerId, target.id); assert.equal(entry.units, 12);
  }
  for (const station of built.stations) {
    const record = runtime.records.get(station.vehicle.userData.editorId), v = record.components.vehicle, product = runtime.products.get(station.loaded), empty = runtime.products.get(station.empty);
    assert(product && empty); assert(api.productPockets(product) && api.productPockets(empty)); assert(v.powered && v.running && v.parkingBrake);
    assert.equal(api.getDockingState(record).ready, false, 'The truck begins outside real insertion range.');
    const metadata = runtime.productMetadata(product), count = runtime.products.size; assert.equal(metadata.units, 12); near(metadata.mass, station.variant.includes('rough') || station.variant === 'telehandler' ? 68 : ['order-picker', 'vna-turret'].includes(station.variant) ? 60 : 73);
    align(record, product); const ready = api.getDockingState(record); assert(ready.ready, station.variant + ': ' + ready.reason);
    assert(api.pickup(record), station.variant + ': ' + v.warning); const entry = v.entry; assert.equal(entry.product, product); assert.equal(product.vehicleOwnerId, record.id); assert.equal(runtime.products.size, count);
    const pickupPose = Object.assign({}, v.pose);
    step(record, .5, {lift: 1}); assert(product.item.box.min.y > .01, station.variant + ': actual fork elevation raises the same pallet.');
    api.command(record, 'parkingBrake', false); const before = record.object.position.clone(); step(record, 1, {throttle: -1}); step(record, 1, {brake: 1}); assert(record.object.position.distanceTo(before) > .03, station.variant + ': real manual reverse input moves the truck and cargo.');
    assert.equal(v.entry, entry); assert.equal(product.vehicleOwnerId, record.id); assert(api.applyPose(record, pickupPose, true), station.variant + ': hydraulic descent remains unobstructed.');
    const support = api.getDockingState(record); assert(support.ready, station.variant + ': ' + support.reason); assert(api.release(record), station.variant + ': ' + v.warning);
    assert.equal(v.entry, null); assert.equal(product.sourceEntry, entry); near(runtime.productMetadata(product).mass, metadata.mass); assert.equal(runtime.productMetadata(product).units, 12); assert.equal(runtime.products.size, count);
    assert(api.pickup(record, product), station.variant + ': the same supported floor pallet can be collected again.');
    depositOn(record, station.stock, entry);
    if (station.rack) {
      align(record, product); assert(api.pickup(record, product), station.variant + ': stock custody permits retrieving the same full pallet.');
      depositOn(record, station.rack.receiver, entry);
      near(product.item.box.min.y, station.rack.height + .005, station.variant + ': elevated pallet rests over the load-bearing shelf.');
    }
    api.command(record, 'parkingBrake', true);
    console.log(station.variant + ': real two-pocket pickup, lift, reverse/brake, floor/stock' + (station.rack ? '/raised-rack' : '') + ' deposits preserve 12 units and tare.');
  }
  runtime.stop(); assert.equal(runtime.products.size, 0); assert.deepEqual(JSON.parse(JSON.stringify(await document.serialize())), authored, 'Leaving playback restores all parked trucks, pallets, stations and lesson data.');
  console.log('Forklift training: eleven separated manual families, 22 real pallets, 22 supported conveyors, three load-bearing racks, six clear aisles and lossless save/stop passed.');
}
run().catch(error => {console.error(error); process.exitCode = 1;});
