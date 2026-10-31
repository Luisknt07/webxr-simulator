'use strict';
const assert = require('node:assert/strict');
const {fixture, THREE} = require('./test-vehicle-runtime.js');
const {Training} = require('./test-warehouse-training-score.js');
const schema = require('../../modules/logistica-industrial/functions/montacargas/schema/vehicle-training.js');
const clone = value => JSON.parse(JSON.stringify(value));

function practice() {
  const f = fixture(), product = f.runtime.products.get(f.pallet);
  const tasks = [{id: 'advisory-pickup', name: 'Recogida por otra aproximación', productId: f.runtime.palletQueueRuntime.palletIdentity(product), sourceId: 'warehouse-origin', destinationId: 'warehouse-destination', destinationSlot: 0, scoring: true,
    pickupRoute: [{x: 7, z: 7}, {x: 7, z: 0}], route: [{x: 0, z: -3}]}];
  f.v.config.trainingTasksJson = JSON.stringify(tasks);
  const entry = f.runtime.sourceRuntime.entryForProduct(f.record, product); entry.ownerId = tasks[0].sourceId; product.item.palletOwnerId = tasks[0].sourceId;
  f.v.training = {index: 0, completed: [], scoring: schema.score.create(schema.parse(JSON.stringify(tasks)))};
  f.training = f.runtime.vehicleTraining = new Training(f.runtime); f.training.beginRoute(f.record, 'pickup');
  return {...f, product, tasks};
}
function tick(f, input = {brake: 1}) {
  f.api.setInput(f.record, input); f.scene.updateMatrixWorld(true); f.ctx.collisionWorld.beginFrame();
  try {f.runtime.time += 1 / 60; f.api.step(1 / 60); f.training.step(1 / 60);} finally {f.ctx.collisionWorld.endFrame();}
}
function run() {
  const docked = practice(), before = clone(docked.v.training), plan = docked.api.pickupPlan.bind(docked.api); let probes = 0;
  docked.api.pickupPlan = (...args) => {probes++; return plan(...args);};
  for (let index = 0; index < 100; index++) docked.training.variables(docked.record);
  assert.equal(probes, 0, 'Per-frame variable reads do not probe pickup geometry.');
  assert.equal(docked.training.guidance(docked.record).stage, 'pickup', 'Physically ready tines unlock pickup instruction even if advisory arrows were missed.');
  assert.equal(probes, 1);
  for (let index = 0; index < 100; index++) {docked.training.guidance(docked.record); docked.training.variables(docked.record);}
  assert.equal(probes, 1, 'The physical pickup readiness hint is cached for 200 ms.');
  docked.runtime.time += .21; docked.training.guidance(docked.record); assert.equal(probes, 2);
  assert.deepEqual(docked.v.training, before, 'Ready guidance never credits missed arrows, awards points or changes mission state.');
  assert.equal(docked.training.guidance(docked.record).pickupRouteAdvisory, true);
  assert.equal(docked.api.command(docked.record, 'pickup'), true, docked.v.warning);
  assert.equal(docked.v.entry.product, docked.product); assert.equal(docked.v.training.phase, 'drop');
  assert.equal(docked.v.training.scoring.score, 20, 'Only the actual pickup earns its reward.');
  assert.equal(docked.v.training.waypointIndex, 0, 'The delivery route starts normally; pickup arrows are not transferred to it.');
  assert(docked.training.validateDrop(docked.record, {kind: 'stock', targetId: docked.tasks[0].destinationId, placement: {palletIndex: 0}}), 'Delivery route remains mandatory.');
  const saved = clone(docked.v.training); docked.v.training = clone(saved); assert(docked.training.validateState(docked.record));
  docked.training.onPickup(docked.record); assert.deepEqual(docked.v.training, saved, 'Restored custody cannot replay pickup points or reset delivery progress.');
  docked.runtime.stop();

  const alternate = practice();
  for (let index = 0; index < 95; index++) tick(alternate, {throttle: -.18});
  for (let index = 0; index < 40; index++) tick(alternate);
  assert(alternate.object.position.z < -.1, 'The learner actually backed away from the pallet.');
  let ticks = 0;
  while (alternate.object.position.z < -.045 && ticks++ < 1000) tick(alternate, {throttle: .12});
  for (let index = 0; index < 35; index++) tick(alternate);
  assert(ticks < 1000 && alternate.v.distance > .2, JSON.stringify({ticks, distance: alternate.v.distance, position: alternate.object.position.toArray(), blocked: alternate.v.blocked, speed: alternate.v.actualSpeed, warning: alternate.v.warning})); assert(!alternate.v.blocked);
  assert.equal(alternate.training.routeComplete(alternate.record), false, 'This driven approach never visits either remote advisory point.');
  assert.equal(alternate.v.training.scoring.score, 0);
  assert(alternate.api.command(alternate.record, 'pickup'), alternate.v.warning);
  assert.equal(alternate.v.entry.product, alternate.product); assert.equal(alternate.v.training.phase, 'drop');
  assert.equal(alternate.v.training.scoring.score, 20); assert(alternate.training.validateState(alternate.record)); alternate.runtime.stop();

  const unsafe = practice(); unsafe.pallet.position.x = .4; unsafe.scene.updateMatrixWorld(true);
  assert.equal(unsafe.api.pickupPlan(unsafe.record).ready, false, 'Advisory routing never permits tines outside the real pockets.');
  assert.equal(unsafe.training.guidance(unsafe.record).stage, 'approach'); assert(!unsafe.api.command(unsafe.record, 'pickup')); assert.equal(unsafe.v.entry, null); unsafe.runtime.stop();

  for (const forgedDistance of [false, true]) {
    const moved = practice(), state = clone(moved.v.training);
    moved.object.position.x += 2; moved.pallet.position.x += 2; moved.scene.updateMatrixWorld(true); if (forgedDistance) moved.v.distance += 2;
    const rejected = moved.api.pickupPlan(moved.record);
    assert(rejected.candidate, 'The moved truck and pallet still have genuinely aligned fork geometry.');
    assert.equal(rejected.ready, false); assert.match(rejected.reason, /sin conducción/);
    assert.deepEqual(moved.v.training, state, 'Fresh teleport rejection does not mutate state from a read-only planner.');
    tick(moved); assert(moved.v.training.routeFault); assert(moved.training.validatePickup(moved.record, moved.product)); moved.runtime.stop();
  }
  console.log('Pickup approach: advisory arrows, real alternate driven docking, read-only 5 Hz readiness, no approach/route credit, retained pocket and teleport guards, exact custody and replay-safe checkpoint passed.');
}
module.exports = {run}; if (require.main === module) run();
