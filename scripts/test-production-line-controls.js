'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const h = require('./test-processor-runtime'), q = require('./test-pallet-queue-runtime');
const {THREE, behaviorSchema, setup, add, record, vars, advance} = h;
const source = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const prefabs = new Function('THREE', 'behaviorSchema', source('src/editor/IndustrialPrefabs.js') + '\nreturn {createProductVisual,createSourceProductVisual};')(THREE, behaviorSchema);
const checkpoint = new Function('THREE', 'createProductVisual', 'createSourceProductVisual', source('src/studio/SimulationCheckpoint.js') + '\nreturn {captureSimulation,restoreSimulation};')(THREE, prefabs.createProductVisual, prefabs.createSourceProductVisual);
const ConveyorAssembly = new Function('THREE', 'conveyorLayout', source('src/editor/ConveyorAssembly.js').replace('default class ConveyorAssembly', 'return class ConveyorAssembly'))(THREE, behaviorSchema.conveyorLayout);
const id = object => object.userData.editorId;

async function run() {
  const f = setup(), inlet = add(f, 'source', {withPanel: false, initialCount: 1, capacity: 8, delivery: 'automatic', outputInterval: .1});
  const fifo = add(f, 'source', {withPanel: false, initialCount: 0, delivery: 'automatic', outputInterval: .1});
  const gravity = f.document.addPrefab('hall', 'conveyor', 'roller-gravity');
  f.document.setBehaviors(gravity, f.document.getBehaviors(gravity).map(config => config.type === 'conveyor' ? Object.assign({}, config, {length: .8, rise: 0, rollingResistance: 0, withPanel: false}) : config));
  const motor = add(f, 'conveyor', {length: 1, speed: .6, withPanel: true});
  const machine = add(f, 'processor', {withPanel: false, setupTime: .4, processTime: .8, delivery: 'automatic', outputInterval: .1});
  const stock = q.addQueue(f, {withPanel: false, palletCapacity: 4, capacity: 4, columns: 1, rows: 1, layers: 1});
  const unrelated = add(f, 'source', {initialCount: 1, delivery: 'manual'}, [0, 1.02, 12]);
  const members = [inlet, fifo, motor, gravity, machine, stock], driven = members.filter(object => object !== gravity);
  const assembly = new ConveyorAssembly({document: f.document, roomId: 'hall', root: f.root, ctx: f.ctx, hooks: {renderScene: f.scene}, assemblyMessage() {}});
  for (let index = 0; index < members.length - 1; index++) {
    assert(assembly.align(members[index], 'output', members[index + 1], 'input'));
    assert(assembly.connect(assembly.pair(members[index + 1], 'input', members[index], 'output')));
  }
  assembly.clear(); f.scene.updateMatrixWorld(true);
  const authored = JSON.stringify(await f.document.serialize()); f.runtime.start('hall');
  const panel = () => f.runtime.getPanelSnapshot(id(motor), 'line');
  const component = object => f.runtime.machineComponent(record(f, object));
  const command = action => f.runtime.command(id(motor), action, undefined, 'line');
  const flags = () => members.map(object => { const state = component(object); return [state.enabled, state.powered, state.running, state.paused, state.emergency, state.speed]; });
  const progress = () => members.map(object => {
    const state = component(object);
    return [state.generated, state.delivered, state.received, state.entryCount, state.exitCount, state.completed,
      state.packages && state.packages.map(item => [item.offset, item.gravityVelocity]), state.jobs && state.jobs.map(job => [job.phase, job.elapsed]),
      state.queue && state.queue.map(entry => entry.id)];
  });
  const unchanged = (action, message) => { const before = flags(); assert.throws(action, message); assert.deepEqual(flags(), before, 'Rejected line command validates every member before changing any member.'); };
  const frozen = () => { const before = progress(); advance(f, .3); assert.deepEqual(progress(), before, 'Suspended line retains actual product poses, process progress and counters.'); };
  const unrelatedBefore = Object.assign({}, vars(f, unrelated));
  for (const anchor of members) assert.deepEqual(f.runtime.getPanelSnapshot(id(anchor), 'line').memberIds.slice().sort(), members.map(id).sort(), 'Any machine can anchor the same mixed production line.');
  assert.equal(panel().variables.moduleCount, 6); assert.equal(panel().variables.entryCount, 1); assert.equal(panel().variables.exitCount, 0);
  for (let i = 0; i < 60 && !component(gravity).packages.length; i++) advance(f, .05);
  assert.equal(component(gravity).packages.length, 1, 'The real Source/FIFO/motor flow hands the original source product onto free rollers.');
  assert(component(gravity).packages[0].gravityVelocity > 0, 'Free rollers inherit an actual upstream motor velocity.');

  command('pause'); assert(members.every(object => component(object).paused)); frozen();
  command('start'); assert(members.every(object => !component(object).paused));
  command('stop'); assert(driven.every(object => !component(object).running)); assert(component(gravity).paused); frozen();
  command('start'); assert(driven.every(object => component(object).running)); assert(!component(gravity).paused);
  command('powerOff'); assert(driven.every(object => !component(object).powered && !component(object).running)); assert(component(gravity).paused); frozen();
  unchanged(() => command('start'), /Enciende|alimentación/);
  command('powerOn'); assert(driven.every(object => component(object).powered && !component(object).running)); assert(component(gravity).paused, 'Power-on alone does not release gravity transport.');
  command('start');
  command('emergency'); assert(members.every(object => component(object).emergency)); frozen();
  assert.equal(command('pause'), false, 'Pause cannot release stopped machinery during an emergency.'); frozen();
  unchanged(() => f.runtime.setVariable(id(gravity), 'paused', false), /emergencia/);
  unchanged(() => command('start'), /emergencia/);
  const emergency = JSON.parse(JSON.stringify(checkpoint.captureSimulation(f.runtime)));
  command('resetEmergency'); assert(members.every(object => !component(object).emergency));
  assert(driven.every(object => !component(object).running), 'Reset does not restart a Source, FIFO, motor, processor or store.'); frozen();
  checkpoint.restoreSimulation(f.runtime, emergency);
  assert(members.every(object => component(object).emergency), 'Checkpoint restore keeps every emergency interlock.');
  command('resetEmergency'); command('start');

  command('stop'); f.runtime.command(id(machine), 'powerOff');
  unchanged(() => command('start'), /Enciende|alimentación/); assert(component(gravity).paused, 'A rejected start must not release free rollers.');
  command('powerOn'); command('start');
  const gravitySpeed = component(gravity).speed, processorTime = component(machine).processTime;
  command('speedUp'); assert.equal(component(motor).speed, .7); assert.equal(component(gravity).speed, gravitySpeed); assert.equal(component(machine).processTime, processorTime);
  unchanged(() => f.runtime.setScopedVariable(id(motor), 'speed', 30, 'line'), /inválido|velocidad/);
  for (let i = 0; i < 300 && vars(f, stock).received !== 1; i++) advance(f, .05);
  assert.equal(vars(f, stock).received, 1, 'Actual flow resumes after reset/rearm and reaches the pallet receiver.');
  assert.equal(vars(f, fifo).delivered, 1); assert.equal(vars(f, motor).exitCount, 1); assert.equal(vars(f, machine).completed, 1);
  assert.equal(panel().variables.entryCount, 1); assert.equal(panel().variables.exitCount, 1, 'Internal FIFO, belt and process transfers are not counted again as line outputs.');
  assert.equal(panel().variables.generatedUnits, 1); assert.equal(panel().variables.storedUnits, 1); assert.equal(panel().variables.palletCapacity, 4);
  assert.deepEqual(vars(f, unrelated), unrelatedBefore, 'Every line command leaves an unconnected machine independent.');

  command('powerOff'); const poweredOff = JSON.parse(JSON.stringify(checkpoint.captureSimulation(f.runtime)));
  command('powerOn'); command('start'); checkpoint.restoreSimulation(f.runtime, poweredOff);
  assert(driven.every(object => !component(object).powered && !component(object).running), 'Checkpoint restores source, FIFO, processor and storage power state too.');
  unchanged(() => command('start'), /Enciende|alimentación/);
  f.runtime.command(id(inlet), 'powerOn'); assert.equal(vars(f, inlet).powered, true); assert.equal(vars(f, inlet).running, false, 'Source power-on requires a separate Start.');
  const hand = q.addHand(f), unrelatedProduct = record(f, unrelated).components.source.queue[0].product;
  assert(f.runtime.pickupProduct(unrelatedProduct, hand));
  assert.equal(f.runtime.getPanelSnapshot(id(unrelated), 'line').variables.exitCount, 1, 'Picking one autonomous Source load reports exactly one delivered output.');
  f.runtime.stop(); assert.equal(JSON.stringify(await f.document.serialize()), authored);
  console.log('Production-line controls: real Source/FIFO/gravity/motor/process/pallet flow, isolated lines, unique terminal counts, pause/stop/power/emergency/rearm, atomic validation and checkpoint interlocks passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
