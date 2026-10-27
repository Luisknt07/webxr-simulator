'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./test-vehicle-runtime.js');
const schema = require('../shared/behaviors.js');
const {THREE} = h;
const code = file => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const products = new Function('THREE', 'behaviorSchema', code('editor/IndustrialPrefabs.js') + '\nreturn {createProductVisual,createSourceProductVisual};')(THREE, schema);
const checkpoint = new Function('THREE', 'createProductVisual', 'createSourceProductVisual', code('studio/SimulationCheckpoint.js') + '\nreturn {captureSimulation,restoreSimulation,productIdentity};')(THREE, products.createProductVisual, products.createSourceProductVisual);
const Presentation = new Function('THREE', 'productIdentity', code('studio/RemotePresentation.js').replace('default class RemotePresentation', 'return class RemotePresentation'))(THREE, checkpoint.productIdentity);
const clean = value => JSON.parse(JSON.stringify(value, (key, item) => typeof item === 'number' ? Math.round(item * 1e8) / 1e8 : item));
function refresh(f) { f.record = f.runtime.records.get(f.object.userData.editorId); f.v = f.record.components.vehicle; f.api = f.runtime.vehicleRuntime; }
function snapshot(f) { return JSON.parse(JSON.stringify(checkpoint.captureSimulation(f.runtime))); }
function canonical(f) {
  f.scene.updateMatrixWorld(true); const forks = f.api.rig(f.record).forks;
  return clean({time: f.runtime.time, root: f.object.matrixWorld.toArray(), pose: f.v.pose, forks: forks.matrixWorld.toArray(),
    distance: f.v.distance, battery: f.v.batteryPercent, received: f.v.received, delivered: f.v.delivered,
    load: f.v.entry && {id: f.v.entry.id, owner: f.v.entry.product.vehicleOwnerId, matrix: f.v.entry.product.object.matrixWorld.toArray(), loadMatrix: f.v.loadMatrix.toArray()},
    products: Array.from(f.runtime.products.values(), product => [checkpoint.productIdentity(product), product.object.matrixWorld.toArray(), product.vehicleOwnerId || ''])});
}
const carried = h.fixture();
assert.ok(carried.api.command(carried.record, 'pickup')); h.step(carried, .6, {lift: 1}); h.step(carried, .4, {throttle: -1});
assert.ok(carried.v.actualSpeed < 0); const hostSpeed = carried.v.actualSpeed, hostAcceleration = carried.v.longitudinalAcceleration, saved = snapshot(carried), expected = canonical(carried);
h.step(carried, .5, {reach: 1, lift: 1, throttle: -1});
checkpoint.restoreSimulation(carried.runtime, saved); refresh(carried);
assert.deepEqual(canonical(carried), expected, 'Restoring reapplies the real forks before the same load-relative matrix.');
assert.equal(carried.v.actualSpeed, 0, 'A resumed manual driver has no stale driving authority.');
assert.equal(carried.v.longitudinalAcceleration, 0, 'A manually resumed owner also clears pending acceleration torque.');
assert.equal(carried.v.inputAge, Infinity); assert.equal(carried.v.input.brake, 1); assert.equal(carried.v.input.throttle, 0);
assert.equal(carried.v.entry.product.object.parent, carried.api.rig(carried.record).forks);
assert.equal(carried.v.entry.product.object.industrialHeld, true); assert.equal(carried.v.entry.product.object.userData.vehicleOwnerId, carried.record.id);
const position = carried.object.position.clone(); h.step(carried, .4); assert.ok(carried.object.position.equals(position), 'No ghost throttle after a manual restore.');

// A participant consumes host speed telemetry and matrices, but cannot inherit
// the host's keyboard/stick state or interpolate a pallet away from its forks.
const observer = h.fixture(); observer.runtime.stop();
for (const key of ['object', 'pallet']) {
  observer[key].userData.editorId = carried[key].userData.editorId;
  observer[key].name = carried[key].name;
  observer[key].userData.editorDefaultBehaviors = JSON.parse(JSON.stringify(carried[key].userData.editorDefaultBehaviors));
}
observer.runtime.start('hall'); refresh(observer);
const presentation = new Presentation(); presentation.before(observer.runtime);
checkpoint.restoreSimulation(observer.runtime, saved, {reuse: true}); refresh(observer); presentation.after(observer.runtime); presentation.tick(observer.runtime);
assert.deepEqual(canonical(observer), expected); assert.equal(observer.v.actualSpeed, hostSpeed);
assert.equal(observer.v.longitudinalAcceleration, hostAcceleration, 'A participant preserves the host acceleration telemetry without driving authority.');
assert.equal(observer.v.inputAge, Infinity); assert.equal(observer.v.input.throttle, 0); assert.equal(observer.v.driving, false);
assert.equal(presentation.blends.size, 0); assert.equal(observer.v.entry.product.object.parent, observer.api.rig(observer.record).forks);
const sameLoad = observer.v.entry.product;
presentation.before(observer.runtime); checkpoint.restoreSimulation(observer.runtime, saved, {reuse: true}); refresh(observer); presentation.after(observer.runtime);
assert.equal(observer.v.entry.product, sameLoad, 'Repeated shared snapshots retain product and GPU identity.'); assert.equal(presentation.blends.size, 0); presentation.clear();
observer.runtime.stop(); carried.runtime.stop();

for (const variant of ['reach-truck', 'vna-turret', 'telehandler', 'order-picker']) {
  const f = h.fixture(variant, false, false); h.step(f, .5, {lift: 1, reach: 1, sideShift: 1, turret: 1, tilt: 1});
  const state = snapshot(f), before = canonical(f); h.step(f, .4, {lift: -1, reach: -1});
  checkpoint.restoreSimulation(f.runtime, state); refresh(f); assert.deepEqual(canonical(f), before, variant + ' mechanisms survive restore'); f.runtime.stop();
}

const automatic = h.fixture('forklift-electric-4w', false, false); automatic.runtime.stop();
Object.assign(automatic.object.userData.editorDefaultBehaviors[0], {mode: 'automatic', waypointsJson: '[{"x":0,"z":5}]'});
automatic.runtime.start('hall'); refresh(automatic); h.step(automatic, .5);
const autoState = snapshot(automatic), savedAcceleration = automatic.v.longitudinalAcceleration; h.step(automatic, .6); const uninterrupted = canonical(automatic);
checkpoint.restoreSimulation(automatic.runtime, autoState); refresh(automatic); assert.equal(automatic.v.longitudinalAcceleration, savedAcceleration); h.step(automatic, .6);
assert.deepEqual(canonical(automatic), uninterrupted, 'An automatic route resumes its velocity, counters and physical pose without stale manual input.'); automatic.runtime.stop();
const malformed = JSON.parse(JSON.stringify(saved)), invalidVehicle = malformed.graph.nodes.find(node => node.t === 'object' && node.v.ownerId === carried.record.id && Object.prototype.hasOwnProperty.call(node.v, 'actualSpeed'));
assert(invalidVehicle); invalidVehicle.v.longitudinalAcceleration = 'corrupt';
assert.throws(() => checkpoint.restoreSimulation(carried.runtime, malformed), /movimiento|aceleración/); carried.runtime.stop();
const legacy = JSON.parse(JSON.stringify(saved)), legacyVehicle = legacy.graph.nodes.find(node => node.t === 'object' && node.v.ownerId === carried.record.id && Object.prototype.hasOwnProperty.call(node.v, 'actualSpeed'));
delete legacyVehicle.v.longitudinalAcceleration; checkpoint.restoreSimulation(carried.runtime, legacy); refresh(carried);
assert.equal(carried.v.longitudinalAcceleration, 0, 'Snapshots made before jerk-limited handling initialize the missing state to a finite zero.');
const legacyPosition = carried.object.position.clone(); h.step(carried, .2); assert(carried.object.position.equals(legacyPosition)); carried.runtime.stop();
const reserved=h.fixture('forklift-electric-4w',false,true),candidate=reserved.runtime.products.get(reserved.pallet);
reserved.v.missionCandidate=candidate;reserved.v.missionStage='height';candidate.vehicleReservedBy=reserved.record.id;
const reservationState=snapshot(reserved);delete candidate.vehicleReservedBy;reserved.v.missionCandidate=null;
checkpoint.restoreSimulation(reserved.runtime,reservationState,{reuse:true});refresh(reserved);
assert.equal(reserved.v.missionCandidate,candidate);assert.equal(candidate.vehicleReservedBy,reserved.record.id,'A shared pickup reservation keeps the same physical load.');
const corrupt=JSON.parse(JSON.stringify(reservationState)),component=corrupt.graph.nodes.find(node=>node.t==='object'&&node.v.missionCandidate&&node.v.ownerId===reserved.record.id);component.v.missionCandidate=null;
assert.throws(()=>checkpoint.restoreSimulation(reserved.runtime,corrupt),/reserva de vehículo/);assert.equal(reserved.runtime.running,false);
console.log('Vehicle checkpoint: loaded forks, mast/reach/turret/boom, owner identity, manual authority reset, participant telemetry/mesh reuse, attached-load presentation and automatic continuation passed.');
