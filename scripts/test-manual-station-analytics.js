'use strict';
// Actual Source, loading-station prefab, pallet store and CollisionWorld. These
// observations must not confuse an operator wait with useful machine work.
const assert = require('node:assert/strict');
const h = require('./test-processor-runtime'), q = require('./test-pallet-queue-runtime');
const {setup, add, record, vars, advance, close} = h;
const id = object => object.userData.editorId;
const canonical = value => JSON.parse(JSON.stringify(value));
const timeFields = ['busySeconds', 'idleSeconds', 'setupSeconds', 'blockedSeconds', 'downSeconds', 'pausedSeconds'];

function station(f) {
  const object = f.document.addPrefab('hall', 'conveyor', 'manual-station');
  f.document.setBehaviors(object, f.document.getBehaviors(object).map(config => config.type !== 'conveyor' ? config : Object.assign({}, config, {
    length: 4, speed: .6, operationTime: 2, requiresOperator: true, operatorAvailable: false, loadingMode: 'manual',
    autoSpawn: false, withPanel: false, withSensors: false, powered: true, running: true
  })));
  return object;
}
function waitFor(f, predicate, label, seconds = 20) {
  for (let elapsed = 0; elapsed < seconds && !predicate(); elapsed += 1 / 60) advance(f, 1 / 60);
  assert(predicate(), 'The real physical state must be reached: ' + label);
}
function snapshot(f, object) { return f.runtime.getAnalyticsSnapshot(id(object), 'module'); }
function sample(f, object, seconds, state, metric) {
  const before = snapshot(f, object), beforeTime = f.runtime.time;
  advance(f, seconds);
  const after = snapshot(f, object);
  assert.equal(after.machines[0].state, state);
  close(after.observedSeconds - before.observedSeconds, seconds);
  close(f.runtime.time - beforeTime, seconds);
  for (const field of timeFields) close(after.summary[field] - before.summary[field], field === metric ? seconds : 0,
    state + ': only ' + metric + ' may accumulate during this physical interval.');
  close(timeFields.reduce((sum, field) => sum + after.summary[field], 0), after.summary.observedSeconds);
  return after;
}

async function run() {
  const f = setup(), source = add(f, 'source', {withPanel: false, initialCount: 1, totalLimit: 1, autoGenerate: false, outputInterval: .1});
  const machine = station(f), stock = q.addQueue(f, {withPanel: false, columns: 1, rows: 1, layers: 1, palletCapacity: 1, capacity: 1, autoRelease: false});
  q.connect(f, source, machine); q.connect(f, machine, stock);
  f.document.setProperty(source, 'name', 'Manual test source'); f.document.setProperty(machine, 'name', 'Manual test station'); f.document.setProperty(stock, 'name', 'Manual test stock');
  const authored = canonical(await f.document.serialize());
  f.runtime.start('hall');
  const entry = record(f, source).components.source.queue[0], originalMesh = entry.product.object;
  const belt = () => record(f, machine).components.conveyor;

  waitFor(f, () => belt().mechanismPhase === 'receiving' && belt().actualSpeed > 0, 'loaded reception');
  const began = belt().packages[0].offset;
  sample(f, machine, .5, 'busy', 'busySeconds');
  assert(belt().packages[0].offset > began, 'Loaded reception is busy because the actual package moves.');
  waitFor(f, () => belt().mechanismPhase === 'waitingOperator', 'operator wait');
  assert.equal(belt().actualSpeed, 0); assert.equal(belt().packages.length, 1);
  sample(f, machine, 1, 'idle', 'idleSeconds');
  assert.equal(belt().mechanismPhase, 'waitingOperator');

  assert(f.runtime.command(id(machine), 'operator'));
  waitFor(f, () => belt().mechanismPhase === 'waitingManualAction', 'manual cycle request wait');
  assert.equal(belt().actualSpeed, 0);
  sample(f, machine, 1, 'idle', 'idleSeconds');
  assert.equal(belt().mechanismPhase, 'waitingManualAction');

  const heldPose = () => belt().packages[0].mesh.matrix.toArray();
  let pose = heldPose();
  assert(f.runtime.command(id(machine), 'pause')); sample(f, machine, .5, 'paused', 'pausedSeconds'); assert.deepEqual(heldPose(), pose);
  assert(f.runtime.command(id(machine), 'start'));
  assert(f.runtime.command(id(machine), 'powerOff')); sample(f, machine, .5, 'down', 'downSeconds'); assert.deepEqual(heldPose(), pose);
  assert.throws(() => f.runtime.command(id(machine), 'start'), /Enciende|alimentaci\u00f3n/);
  assert(f.runtime.command(id(machine), 'powerOn')); assert(f.runtime.command(id(machine), 'start'));
  assert(f.runtime.command(id(machine), 'emergency')); sample(f, machine, .5, 'down', 'downSeconds'); assert.deepEqual(heldPose(), pose);
  assert.throws(() => f.runtime.command(id(machine), 'start'), /emergencia/);
  assert(f.runtime.command(id(machine), 'resetEmergency'));
  assert.equal(belt().running, false, 'Emergency reset cannot restart a waiting station.');
  assert(f.runtime.command(id(machine), 'start'));
  sample(f, machine, .25, 'idle', 'idleSeconds');

  assert(f.runtime.command(id(machine), 'dispatch'));
  waitFor(f, () => belt().mechanismPhase === 'operating', 'operator-requested work');
  assert.equal(belt().actualSpeed, 0, 'The process remains useful while its stopped transport surface performs the requested operation.');
  const operationBegan = belt().packages[0].mechanismElapsed;
  sample(f, machine, .5, 'busy', 'busySeconds');
  assert(belt().packages[0].mechanismElapsed > operationBegan);
  waitFor(f, () => belt().mechanismPhase === 'delivering', 'real delivery');
  assert(f.runtime.command(id(stock), 'pause'));
  waitFor(f, () => belt().transferBlocked, 'stopped-destination backpressure');
  pose = heldPose(); sample(f, machine, .5, 'blocked', 'blockedSeconds'); assert.deepEqual(heldPose(), pose);
  assert.equal(snapshot(f, machine).summary.jamSuspected, false, 'Known stopped-destination backpressure does not become a mechanical jam.');
  assert(f.runtime.command(id(stock), 'start'));
  waitFor(f, () => vars(f, stock).receivedUnits === 1, 'one finished unit in stock');
  assert.equal(vars(f, source).generatedUnits, 1); assert.equal(vars(f, source).deliveredUnits, 1);
  assert.equal(vars(f, machine).entryCount, 1); assert.equal(vars(f, machine).exitCount, 1);
  assert.equal(vars(f, stock).queuedUnits, 1); assert.equal(vars(f, stock).deliveredUnits, 0);
  assert.equal(q.queue(f, stock).queue[0].id, entry.id); assert.equal(q.queue(f, stock).queue[0].product.object, originalMesh);
  sample(f, machine, 1, 'idle', 'idleSeconds');
  assert.equal(snapshot(f, source).machines[0].state, 'idle'); assert.equal(snapshot(f, stock).machines[0].state, 'idle');
  const observation = JSON.stringify(f.runtime.productionAnalytics.exportState()), counters = JSON.stringify(f.runtime.getSnapshot()), time = f.runtime.time;
  for (let index = 0; index < 10; index++) [source, machine, stock].forEach(object => snapshot(f, object));
  assert.equal(JSON.stringify(f.runtime.productionAnalytics.exportState()), observation); assert.equal(JSON.stringify(f.runtime.getSnapshot()), counters); assert.equal(f.runtime.time, time);
  assert.deepEqual(canonical(await f.document.serialize()), authored, 'Analytics and runtime-only controls never change authored properties, configurations or transforms.');
  assert(!f.runtime.events.some(event => event.type === 'configuration-warning'));
  f.runtime.stop();
  assert.deepEqual(canonical(await f.document.serialize()), authored, 'Stopping restores the exact Source, station, stock and authored scene.');
  assert.equal(f.runtime.products.size, 0); assert.equal(Object.keys(f.ctx.raycontrol.states).length, 0);
  console.log('Manual station analytics: moving reception and requested operation are busy; operator waits are idle; pause/power/emergency/backpressure and exact product/document restoration passed.');
}

module.exports = {run};
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
