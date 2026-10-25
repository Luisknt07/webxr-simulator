'use strict';
// Actual prefabs, timed jobs, loads, CollisionWorld and checkpoint codec. The
// pure recorder checks below cover only the bounded statistics algorithms.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const h = require('./test-processor-runtime'), q = require('./test-pallet-queue-runtime');
const {THREE, behaviorSchema, setup, add, record, vars, advance, close} = h;
const {Recorder, controlChart} = require('../shared/productionAnalytics');
const source = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const prefabs = new Function('THREE', 'behaviorSchema', source('src/editor/IndustrialPrefabs.js') + '\nreturn {createProductVisual,createSourceProductVisual};')(THREE, behaviorSchema);
const checkpoint = new Function('THREE', 'createProductVisual', 'createSourceProductVisual', source('src/studio/SimulationCheckpoint.js') + '\nreturn {captureSimulation,restoreSimulation};')(THREE, prefabs.createProductVisual, prefabs.createSourceProductVisual);
const id = object => object.userData.editorId;
const snapshot = (f, object, scope = 'module') => f.runtime.getAnalyticsSnapshot(id(object), scope);
const summary = (f, object, scope) => snapshot(f, object, scope).summary;
const metricSum = value => ['busySeconds', 'idleSeconds', 'setupSeconds', 'blockedSeconds', 'downSeconds', 'pausedSeconds'].reduce((sum, key) => sum + value[key], 0);
const equalTime = value => close(metricSum(value), value.observedSeconds, 'Every observed machine-second is assigned exactly once, including parallel idle capacity.');

function waitFor(f, predicate, seconds = 30) {
  for (let elapsed = 0; elapsed < seconds && !predicate(); elapsed += .05) advance(f, .05);
  assert(predicate(), 'The real simulated condition must be reached within its bounded physical cycle.');
}

async function idleAndQueries() {
  const f = setup(), belt = add(f, 'conveyor', {length: 2, running: true, autoSpawn: false}); f.runtime.start('hall');
  advance(f, 3.25); let state = snapshot(f, belt);
  close(state.summary.busySeconds, 0); close(state.summary.idleSeconds, 3.25); close(state.summary.utilization, 0);
  assert.equal(state.machines[0].state, 'idle', 'An empty running belt does not report 100% useful utilization.');
  assert.equal(state.summary.nominalCapacityPerMinute, null, 'A plain belt does not invent a rated machine capacity.'); equalTime(state.summary);
  assert.equal(state.history.length, 4); state.history.forEach((point, index) => close(point.time, index));
  const authored = JSON.stringify(await f.document.serialize()), before = JSON.stringify(f.runtime.productionAnalytics.exportState());
  const counters = JSON.stringify(f.runtime.getSnapshot()), time = f.runtime.time;
  for (let index = 0; index < 30; index++) JSON.stringify(snapshot(f, belt));
  assert.equal(f.runtime.time, time); assert.equal(JSON.stringify(f.runtime.productionAnalytics.exportState()), before);
  assert.equal(JSON.stringify(f.runtime.getSnapshot()), counters); assert.equal(JSON.stringify(await f.document.serialize()), authored,
    'Reading/exporting analytics does not advance time, add samples, change counters or edit the scene.');
  advance(f, 602); state = snapshot(f, belt);
  assert.equal(state.history.length, 600); close(state.history[state.history.length - 1].time, 605);
  for (let index = 1; index < state.history.length; index++) close(state.history[index].time - state.history[index - 1].time, 1);
  assert.equal(state.control.ready, true); equalTime(state.summary);
  const full = checkpoint.captureSimulation(f.runtime), partial = checkpoint.captureSimulation(f.runtime, {analyticsHistorySamples: 2});
  const analyticsState = value => { const ref = value.graph.nodes[value.graph.entry.r].v.productionAnalytics; return value.graph.nodes[ref.r]; };
  assert.equal(analyticsState(full).v.partial, false); assert.equal(analyticsState(partial).v.partial, true);
  assert(JSON.stringify(partial).length < JSON.stringify(full).length - 10000, 'An actual captured shared simulation omits the accumulated 600-point history.');
  const beforeTailExport = JSON.stringify(f.runtime.productionAnalytics.exportState());
  for (let index = 0; index < 5; index++) checkpoint.captureSimulation(f.runtime, {analyticsHistorySamples: 2});
  assert.equal(JSON.stringify(f.runtime.productionAnalytics.exportState()), beforeTailExport, 'Partial publication never truncates the host or the next manual checkpoint.');
  assert.throws(() => checkpoint.captureSimulation(f.runtime, {analyticsHistorySamples: 0}), /muestras/);
  f.runtime.stop();
}

function parallelCapacity() {
  const f = setup(), inlet = add(f, 'source', {initialCount: 1, outputInterval: .1}), machine = add(f, 'processor', {
    parallelism: 2, setupPolicy: 'startup', setupTime: 4, processTime: 6, capacity: 4, outputCapacity: 4, delivery: 'manual'});
  q.connect(f, inlet, machine); f.runtime.start('hall');
  const jobs = () => record(f, machine).components.processor.jobs;
  waitFor(f, () => jobs().length === 1 && jobs()[0].phase === 'setup');
  let before = summary(f, machine); advance(f, 2); let after = summary(f, machine);
  close(after.setupSeconds - before.setupSeconds, 1); close(after.idleSeconds - before.idleSeconds, 1);
  close(after.observedSeconds - before.observedSeconds, 2); equalTime(after);
  waitFor(f, () => jobs().length === 1 && jobs()[0].phase === 'process');
  before = summary(f, machine); advance(f, 2); after = summary(f, machine);
  close(after.busySeconds - before.busySeconds, 1); close(after.idleSeconds - before.idleSeconds, 1); equalTime(after);
  const current = snapshot(f, machine), capacity = current.machines[0].capacity;
  assert.equal(capacity.configured, 10); assert.equal(capacity.occupied, 1); close(capacity.percent, 10);
  assert.equal(after.atCapacity, false, 'One active job occupies half of a two-slot processor, rather than all its capacity.');
  assert(after.utilization > 0 && after.utilization < 50);
  waitFor(f, () => vars(f, machine).completed === 1); close(summary(f, machine).nominalCapacityPerMinute, 20); h.phases(f, machine); f.runtime.stop();

  const full = setup(), sourceObject = add(full, 'source', {initialCount: 2, outputInterval: .1});
  const dual = add(full, 'processor', {parallelism: 2, processTime: 5, setupTime: 0, delivery: 'manual'});
  q.connect(full, sourceObject, dual); full.runtime.start('hall');
  waitFor(full, () => record(full, dual).components.processor.jobs.filter(job => job.phase === 'process').length === 2);
  before = summary(full, dual); advance(full, 1); after = summary(full, dual);
  close(after.busySeconds - before.busySeconds, 1); close(after.idleSeconds - before.idleSeconds, 0); assert.equal(after.atCapacity, true); equalTime(after); full.runtime.stop();
}

function completionAndBackpressure() {
  const f = setup(), inlet = add(f, 'source', {initialCount: 1, totalLimit: 1, autoGenerate: true, delivery: 'automatic', outputInterval: .1});
  const belt = add(f, 'conveyor', {length: 1, speed: .8}), store = q.addQueue(f, {columns: 1, rows: 1, layers: 1, capacity: 1});
  q.connect(f, inlet, belt); q.connect(f, belt, store); f.runtime.start('hall'); waitFor(f, () => vars(f, store).received === 1); advance(f, 4);
  const completed = summary(f, inlet), terminal = summary(f, store);
  assert.equal(vars(f, inlet).remaining, 0); assert.equal(completed.blocked, false); assert.equal(completed.jamSuspected, false);
  assert.equal(snapshot(f, inlet).machines[0].state, 'idle', 'A finished finite Source is completed/idle, rather than jammed.');
  assert.equal(terminal.atCapacity, true); assert.equal(terminal.blocked, false); assert.equal(terminal.jamSuspected, false);
  assert.equal(snapshot(f, store).machines[0].state, 'idle', 'A full final pallet is stored inventory, rather than an equipment fault.'); f.runtime.stop();

  const blocked = setup(), upstream = add(blocked, 'source', {initialCount: 2, outputInterval: .1}), transport = add(blocked, 'conveyor', {length: 1, speed: .8});
  const limited = q.addQueue(blocked, {columns: 1, rows: 1, layers: 1, capacity: 1});
  q.connect(blocked, upstream, transport); q.connect(blocked, transport, limited); blocked.runtime.start('hall');
  waitFor(blocked, () => vars(blocked, limited).received === 1 && vars(blocked, transport).transferBlocked); advance(blocked, 3.2);
  const pressure = summary(blocked, transport);
  assert.equal(pressure.congestion, true); assert.equal(pressure.jamSuspected, false); assert.match(pressure.blockReason, /Destino lleno/);
  assert.equal(summary(blocked, limited).jamSuspected, false, 'Known destination-full backpressure is not mislabelled a mechanical jam.'); blocked.runtime.stop();
}

function realObstruction() {
  const f = setup(), inlet = add(f, 'source', {initialCount: 1, outputInterval: .1}), belt = add(f, 'conveyor', {length: 3, speed: .8});
  const store = q.addQueue(f, {columns: 1, rows: 1, layers: 1, capacity: 1}); q.connect(f, inlet, belt); q.connect(f, belt, store);
  const wall = f.document.addPrimitive('hall', 'box', '#913c35');
  f.document.setTransform(wall, {position: belt.position.clone().add(new THREE.Vector3(.2, .2, 0)).toArray(), scale: [.08, .7, 1.3]});
  f.document.setBehaviors(wall, [{type: 'collision', mode: 'solid'}]); f.runtime.start('hall');
  waitFor(f, () => record(f, belt).components.conveyor.packages.some(item => item.blocked));
  advance(f, 2.5); assert.equal(summary(f, belt).jamSuspected, false, 'A possible obstruction requires three persistent seconds, not one delayed frame.');
  advance(f, .7); const jam = summary(f, belt); assert.equal(jam.jamSuspected, true); assert.equal(jam.congestion, true);
  assert.match(jam.blockReason, /obstáculo|recorrido/); assert.equal(vars(f, store).queued, 0); equalTime(jam);
  wall.parent.remove(wall); f.ctx.collisionWorld.invalidate(); advance(f, .3);
  assert.equal(summary(f, belt).jamSuspected, false, 'Clearing the actual obstruction resets the persistence streak.'); f.runtime.stop();
}

function palletUnitsAndCheckpoint() {
  const f = setup(), inlet = add(f, 'source', {initialCount: 2, outputInterval: .1, loadMode: 'pallet', palletColumns: 2, palletRows: 2, palletLayers: 1});
  const first = add(f, 'conveyor', {length: 1.6, speed: .8, width: 1.5}), second = add(f, 'conveyor', {length: 1.6, speed: .8, width: 1.5});
  const store = q.addQueue(f, {acceptsPallets: true, palletCapacity: 2, columns: 1, rows: 1, layers: 1, width: 1.4, depth: 1.2, capacity: 2});
  q.connect(f, inlet, first); q.connect(f, first, second); q.connect(f, second, store); f.runtime.start('hall');
  advance(f, 1.3); const saved = JSON.parse(JSON.stringify(checkpoint.captureSimulation(f.runtime))), time = f.runtime.time;
  const historical = JSON.stringify(f.runtime.productionAnalytics.exportState()); advance(f, 1.1);
  const uninterrupted = JSON.stringify(f.runtime.productionAnalytics.exportState());
  checkpoint.restoreSimulation(f.runtime, saved); close(f.runtime.time, time); assert.equal(JSON.stringify(f.runtime.productionAnalytics.exportState()), historical);
  advance(f, 1.1); assert.equal(JSON.stringify(f.runtime.productionAnalytics.exportState()), uninterrupted, 'Resumed production statistics match uninterrupted physics and timing.');
  waitFor(f, () => vars(f, store).received === 2); advance(f, 1);
  const line = snapshot(f, first, 'line'); assert.equal(line.summary.entryCount, 2); assert.equal(line.summary.exitCount, 2);
  assert.equal(line.summary.entryUnits, 8); assert.equal(line.summary.exitUnits, 8);
  for (const belt of [first, second]) { const state = summary(f, belt); assert.equal(state.entryCount, 2); assert.equal(state.exitCount, 2); assert.equal(state.entryUnits, 8); assert.equal(state.exitUnits, 8); }
  assert.equal(line.history[line.history.length - 1].exitCount, 2); assert.equal(line.history[line.history.length - 1].exitUnits, 8,
    'Line history counts terminal pallet receipts once and retains the contained carton units.');
  const legacy = JSON.parse(JSON.stringify(checkpoint.captureSimulation(f.runtime)));
  delete legacy.graph.nodes[legacy.graph.entry.r].v.productionAnalytics;
  checkpoint.restoreSimulation(f.runtime, legacy); assert.equal(vars(f, store).receivedUnits, 8);
  advance(f, .2); assert(snapshot(f, first, 'line').summary.observedSeconds > 0, 'A pre-analytics checkpoint remains valid and starts a fresh bounded observation history.'); f.runtime.stop();

  const batches = setup(), units = add(batches, 'source', {initialCount: 4, outputInterval: .1});
  const combine = add(batches, 'processor', {mode: 'combiner', combineCount: 2, processTime: .2, delivery: 'automatic', outputInterval: .1});
  const carrier = add(batches, 'conveyor', {length: 1.6, speed: .8, width: 1.5});
  const batchStore = q.addQueue(batches, {columns: 1, rows: 1, layers: 2, capacity: 2});
  q.connect(batches, units, combine); q.connect(batches, combine, carrier); q.connect(batches, carrier, batchStore); batches.runtime.start('hall');
  waitFor(batches, () => vars(batches, batchStore).received === 2); advance(batches, 1);
  const combined = summary(batches, carrier, 'line'), transported = summary(batches, carrier);
  assert.equal(combined.entryCount, 4); assert.equal(combined.exitCount, 2); assert.equal(combined.entryUnits, 4); assert.equal(combined.exitUnits, 4);
  assert.equal(transported.entryCount, 2); assert.equal(transported.exitCount, 2); assert.equal(transported.entryUnits, 4); assert.equal(transported.exitUnits, 4,
    'Combining individual cartons changes load counts while every transport boundary conserves their exact contained units.'); batches.runtime.stop();
}

function boundedRecorderAndCharts() {
  const recorder = new Recorder(); recorder.reset(1000); assert.equal(recorder.capacity, 60);
  const row = {state: 'idle', isRunning: true, capacity: 1, occupied: 0, entryCount: 0, exitCount: 0, entryUnits: 0, exitUnits: 0};
  for (let index = 0; index < 1000; index++) recorder.observe('machine-' + index, Object.assign({}, row), 0);
  for (let time = 0; time < 70; time++) recorder.sample(time);
  assert.equal(Array.from(recorder.entries.values()).reduce((sum, entry) => sum + entry.history.length, 0), 60000);
  const exported = recorder.exportState(); assert(exported.entries.every(entry => !entry.history && entry.columns.every(column => column.length === 60)), 'Checkpoint histories use bounded compact column arrays.');
  const known = [10, 14, 11, 15], short = controlChart(known.map((outputRate, time) => ({time, outputRate})));
  assert.equal(short.ready, false); close(short.center, 12.5); close(short.mrCenter, 11 / 3);
  close(short.ucl, 12.5 + 11 / 1.128); close(short.lcl, 12.5 - 11 / 1.128); close(short.mrUcl, 3.267 * 11 / 3);
  const warm = controlChart(Array.from({length: 20}, (_, time) => ({time, outputRate: known[time % 4]})));
  assert.equal(warm.ready, true); close(warm.center, 12.5); close(warm.mrCenter, 75 / 19);
  close(warm.ucl, 12.5 + 3 * 75 / 19 / 1.128); close(warm.lcl, 12.5 - 3 * 75 / 19 / 1.128);
  close(warm.mrUcl, 3.267 * 75 / 19); assert.equal(warm.method, 'I-MR');
}

function incrementalRecorder() {
  const make = () => {
    const value = new Recorder(), row = {state: 'idle', isRunning: true, capacity: 1, occupied: 0, entryCount: 0, exitCount: 0, entryUnits: 0, exitUnits: 0};
    value.observe('machine', row, 0); value.sample(0, true); return {value, row};
  };
  const host = make(), follower = make(); let earlier;
  for (let time = 1; time <= 610; time++) {
    host.row.entryCount = host.row.exitCount = host.row.entryUnits = host.row.exitUnits = time;
    host.value.observe('machine', host.row, 1); host.value.sample(time);
    const delta = host.value.exportState({historySamples: 2});
    assert.equal(delta.partial, true); assert(delta.entries.every(entry => entry.columns.every(column => column.length <= 2)));
    if (time === 100) earlier = JSON.parse(JSON.stringify(delta));
    follower.value.importState(delta); follower.value.importState(delta);
  }
  assert.equal(follower.value.entries.get('machine').history.length, 600);
  assert.deepEqual(follower.value.exportState(), host.value.exportState(), 'Repeated tails merge by exact sample time without duplicates or loss of full-window samples.');
  const newest = host.value.exportState({historySamples: 2}), joined = make(); joined.value.importState(newest);
  assert.deepEqual(joined.value.entries.get('machine').history.map(point => point.time), [609, 610], 'A late joiner receives two genuine samples, without an invented history or the local startup seed.');
  const earlyTail = JSON.parse(JSON.stringify(newest)); earlyTail.entries[0].columns = earlyTail.entries[0].columns.map(column => column.slice(0, 1));
  joined.value.importState(earlyTail);
  assert.deepEqual(joined.value.entries.get('machine').history.map(point => point.time), [609, 610], 'A partial update preserves newer retained points that are absent from its tail.');
  follower.value.importState(earlier);
  assert.deepEqual(follower.value.entries.get('machine').history.map(point => point.time), [99, 100], 'Rewinding the same execution replaces its future history rather than mixing timelines.');
  assert.deepEqual(follower.value.entries.get('machine').metrics, earlier.entries[0].metrics);
  const restarted = make(); follower.value.importState(restarted.value.exportState({historySamples: 2}));
  assert.deepEqual(follower.value.entries.get('machine').history.map(point => point.time), [0], 'A new execution stream discards the previous run even if its configured machine IDs match.');
  const oldFull = host.value.exportState(); delete oldFull.partial; delete oldFull.streamId; delete oldFull.time;
  follower.value.importState(oldFull); assert.equal(follower.value.entries.get('machine').history.length, 600, 'Full analytics checkpoints produced before streaming metadata remain valid.');

  const pristine = JSON.stringify(joined.value.exportState()), valid = host.value.exportState({historySamples: 2});
  const invalid = [state => { state.capacity = 601; }, state => { state.nextSample = -1; }, state => { state.nextSample = 1.5; },
    state => { state.time = -1; }, state => { state.streamId = ''; }, state => { delete state.streamId; }, state => { delete state.time; },
    state => { state.partial = 'true'; }, state => { state.entries.push(state.entries[0]); }, state => { state.entries = []; },
    state => { state.entries[0].id = 'unknown'; }, state => { state.entries[0].metrics.busySeconds = -1; },
    state => { state.entries[0].columns[1] = []; }, state => { state.entries[0].columns[0][0] = state.time + 1; },
    state => { state.entries[0].columns[1][0] = -1; }, state => { state.entries[0].columns[1][0] = Infinity; },
    state => { state.entries[0].columns = state.entries[0].columns.map(column => Array(601).fill(column[0])); }];
  invalid.forEach(mutate => {
    const payload = JSON.parse(JSON.stringify(valid)); mutate(payload); assert.throws(() => joined.value.importState(payload), /Histórico|histórico|producción|Muestras/);
    assert.equal(JSON.stringify(joined.value.exportState()), pristine, 'Invalid partial updates are rejected before any stream, metric, timestamp or history changes.');
  });
  const global = new Recorder(); global.reset(1000);
  for (let index = 0; index < 1000; index++) global.observe(String(index), {state: 'idle'}, 0);
  const inflated = global.exportState({historySamples: 2}); inflated.capacity = 600;
  assert.throws(() => global.importState(inflated), /Histórico/, 'An advertised capacity cannot exceed the shared 60,000-point budget.');
}

async function streamedCheckpoint() {
  const host = setup(), belt = add(host, 'conveyor', {length: 1, autoSpawn: false}); host.runtime.start('hall'); advance(host, 25.2);
  const follower = setup(); await follower.document.load(await host.document.serialize());
  const apply = () => checkpoint.restoreSimulation(follower.runtime, checkpoint.captureSimulation(host.runtime, {analyticsHistorySamples: 2}), {reuse: true});
  apply(); let received = snapshot(follower, follower.document.getObject(id(belt)));
  assert.equal(received.history.length, 2); assert.equal(received.control.ready, false, 'Late joins warm up the control chart from actual arriving observations.');
  const timestamps = received.history.map(point => point.time);
  advance(host, .1); apply(); received = snapshot(follower, follower.document.getObject(id(belt)));
  assert.deepEqual(received.history.map(point => point.time), timestamps, 'A publish between sample ticks changes metrics without inventing a point.');
  for (let index = 0; index < 20; index++) { advance(host, 1); apply(); }
  received = snapshot(follower, follower.document.getObject(id(belt)));
  assert.equal(received.history.length, 22); assert.equal(received.control.ready, true);
  close(received.summary.observedSeconds, summary(host, belt).observedSeconds); close(received.summary.idleSeconds, summary(host, belt).idleSeconds);
  const manual = checkpoint.captureSimulation(host.runtime); checkpoint.restoreSimulation(follower.runtime, manual, {reuse: true});
  assert.deepEqual(snapshot(follower, follower.document.getObject(id(belt))).history, snapshot(host, belt).history, 'A manual full checkpoint replaces the partial history with every genuine retained host sample.');
  host.runtime.stop(); follower.runtime.stop();
}

async function run() {
  await idleAndQueries(); parallelCapacity(); completionAndBackpressure(); realObstruction(); palletUnitsAndCheckpoint(); boundedRecorderAndCharts(); incrementalRecorder(); await streamedCheckpoint();
  console.log('Production analytics: real utilization/parallel occupancy, exclusive time accounting, completion versus jam/backpressure, physical obstruction persistence, pallet/unit boundary counts, 1 Hz/600/60k histories, I-MR warm-up/limits, read-only queries and compatible checkpoint continuation passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
