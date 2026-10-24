// No WebGL or user project access: real clipboard records and an isolated SQLite database.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const THREE = require('three');
const behaviorSchema = require('../shared/behaviors.js');
const automation = require('../shared/automation.js');
const {ProjectStore} = require('../server/storage.js');
const {validateDocument} = require('../server/validation.js');
const clone = value => JSON.parse(JSON.stringify(value));
function source(file) {
  return fs.readFileSync(path.join(__dirname, '../src/editor', file), 'utf8')
    .replace(/^\uFEFF/, '').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
}
const createIndustrialPrefab = new Function('THREE', 'behaviorSchema', source('IndustrialPrefabs.js') + '\nreturn createIndustrialPrefab;')(THREE, behaviorSchema);
const SceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', source('SceneDocument.js')
  .replace('default class SceneDocument', 'return class SceneDocument'))(THREE, behaviorSchema, createIndustrialPrefab);
const TelemetryRecorder = new Function(source('TelemetryRecorder.js').replace('default class TelemetryRecorder', 'class TelemetryRecorder') + '\nreturn TelemetryRecorder;')();
const normal = values => behaviorSchema.normalizeBehaviors([Object.assign({type: 'processor'}, values)])[0];
function makeDocument() { const document = new SceneDocument({}); document.registerRoom('hall', new THREE.Group()); return document; }
function config(document, object, type) { return document.getBehaviors(object).find(row => row.type === type); }
function rule(sourceId, variable, value, targetId, targetVariable, set) {
  return {sourceId, variable, operator: 'eq', value, targetId, targetVariable, set, edge: 'rising'};
}
async function run() {
  const defaults = normal({});
  assert.equal(defaults.mode, 'process'); assert.equal(defaults.length, 3); assert.equal(defaults.width, 1.6);
  assert.equal(defaults.powered, false); assert.equal(defaults.running, false); assert.equal(defaults.setupPolicy, 'productChange');
  assert.equal(defaults.requiresOperator, false); assert.equal(defaults.operatorAvailable, false);
  assert.equal(defaults.processTime, 5); assert.equal(defaults.setupTime, 2); assert.equal(defaults.delivery, 'automatic');
  for (const mode of ['process', 'combiner', 'separator']) for (const setupPolicy of ['startup', 'productChange', 'eachBatch']) {
    const value = {mode, setupPolicy, powered: true, running: true, requiresOperator: true, operatorAvailable: false,
      capacity: 16, parallelism: 8, outputCapacity: 16, combineCount: 16, splitCount: 16, processTime: 3600, setupTime: 0};
    const input = clone(value), result = normal(value);
    Object.keys(value).forEach(key => assert.equal(result[key], value[key])); assert.deepEqual(value, input);
  }
  const rejected = [{mode: 'javascript'}, {setupPolicy: 'eval'}, {delivery: 'script'}, {powered: 'true'}, {operatorAvailable: 1},
    {processTime: 0}, {processTime: 3600.1}, {setupTime: -0.1}, {setupTime: Infinity}, {capacity: 0}, {capacity: 65}, {capacity: 1.5},
    {parallelism: 0}, {parallelism: 9}, {parallelism: 1.5}, {outputCapacity: 0}, {outputCapacity: 65}, {outputCapacity: 1.5},
    {combineCount: 1}, {combineCount: 17}, {combineCount: 2.5}, {splitCount: 1}, {splitCount: 17}, {splitCount: 2.5},
    {mode: 'combiner', capacity: 2, combineCount: 3}, {mode: 'separator', outputCapacity: 2, splitCount: 3},
    {length: 1.49}, {length: 8.01}, {width: 0.59}, {width: 6.01}, {outputInterval: 0.09}, {outputInterval: 120.1},
    {outputId: '../outside'}, {outputId: 'x;DROP TABLE projects'}, {outputPort: 'output'}];
  rejected.forEach(value => assert.throws(() => normal(value), /inválid|inval|rango|opción|opcion|capacidad|entero|compatible/i));
  const declarative = normal({code: 'throw new Error()', function: 'process.exit()', sql: 'DROP TABLE projects'});
  assert.equal(declarative.code, undefined); assert.equal(declarative.function, undefined); assert.equal(declarative.sql, undefined);
  const operatorRule = rule('custom-processor', 'waitingOperator', true, 'custom-processor', 'operatorAvailable', true);
  const timingRule = rule('custom-processor', 'completed', 5, 'custom-processor', 'processTime', 0.1);
  const setupRule = rule('custom-processor', 'settingUp', false, 'custom-processor', 'setupTime', 0);
  const bottleneckRule = rule('custom-processor', 'outputQueued', 8, 'custom-belt', 'running', false);
  assert.deepEqual(automation.normalizeRules([operatorRule, timingRule, setupRule, bottleneckRule]), [operatorRule, timingRule, setupRule, bottleneckRule]);
  for (const bad of [Object.assign({}, operatorRule, {value: 1}), Object.assign({}, timingRule, {value: true}),
    Object.assign({}, timingRule, {set: 0}), Object.assign({}, timingRule, {set: 3601}), Object.assign({}, setupRule, {set: -1}),
    Object.assign({}, operatorRule, {set: 1}), Object.assign({}, operatorRule, {execute: 'script'})]) assert.throws(() => automation.normalizeRules([bad]), /tipo|rango|campos/);

  const document = makeDocument(), sourceObject = document.addPrefab('hall', 'source'), queue = document.addPrefab('hall', 'source', 'queue');
  const belt = document.addPrefab('hall', 'conveyor', 'belt-middle'), processor = document.addPrefab('hall', 'processor');
  const combiner = document.addPrefab('hall', 'processor', 'combiner'), separator = document.addPrefab('hall', 'processor', 'separator');
  const id = object => object.userData.editorId;
  document.setBehaviors(sourceObject, [Object.assign({}, config(document, sourceObject, 'source'), {outputId: id(processor), delivery: 'automatic'})]);
  const processorValue = Object.assign({}, defaults, {powered: true, running: true, requiresOperator: true, operatorAvailable: true,
    processTime: 8.5, setupTime: 3.25, setupPolicy: 'eachBatch', capacity: 6, parallelism: 3, outputCapacity: 4,
    length: 5.1, width: 2.4, outputId: id(combiner), outputInterval: 0.2});
  const localRules = [rule(id(processor), 'waitingOperator', true, id(processor), 'operatorAvailable', true),
    rule(id(processor), 'completedUnits', 100, id(belt), 'running', false)];
  document.setBehaviors(processor, [processorValue, behaviorSchema.defaultBehavior('analytics'), {type: 'automation', rules: JSON.stringify(localRules)}]);
  document.setBehaviors(combiner, [Object.assign({}, config(document, combiner, 'processor'), {capacity: 5, combineCount: 3, outputId: id(separator), setupPolicy: 'startup'})]);
  document.setBehaviors(separator, [Object.assign({}, config(document, separator, 'processor'), {outputCapacity: 8, splitCount: 4, outputId: id(queue)})]);
  document.setBehaviors(queue, [Object.assign({}, config(document, queue, 'source'), {outputId: id(belt), delivery: 'automatic'})]);
  assert.equal(config(document, combiner, 'processor').mode, 'combiner'); assert.equal(config(document, separator, 'processor').mode, 'separator');
  const processorEntry = document.additions.get(id(processor)), originals = Array.from(processorEntry.nodes.values()).filter(node => config(document, node, 'control'));
  assert.equal(originals.length, 9);
  assert(originals.some(node => config(document, node, 'control').command === 'operator'));
  originals.forEach(node => assert.equal(config(document, node, 'control').targetId, id(processor)));
  const operatorButton = originals.find(node => config(document, node, 'control').command === 'operator');
  document.setTransform(operatorButton, {position: [-0.32, -0.55, 0.17]});
  const copied = await document.pasteObject(document.captureObject(processor), 'hall', 1);
  const copyEntry = document.additions.get(id(copied)), copyControls = Array.from(copyEntry.nodes.values()).filter(node => config(document, node, 'control'));
  assert.equal(copyControls.length, 9); assert.notEqual(id(copied), id(processor));
  copyControls.forEach(node => {
    assert.equal(config(document, node, 'control').targetId, id(copied));
    assert(!originals.some(before => id(before) === id(node)), 'Every copied physical processor control needs a new identity.');
  });
  const copiedOperator = copyControls.find(node => config(document, node, 'control').command === 'operator');
  assert.deepEqual(copiedOperator.position.toArray(), operatorButton.position.toArray());
  assert.equal(config(document, copied, 'processor').outputId, id(combiner), 'External flow destinations remain external at document clipboard level.');
  assert.equal(config(document, copied, 'processor').processTime, 8.5); assert.equal(config(document, copied, 'processor').parallelism, 3);
  const copiedRules = JSON.parse(config(document, copied, 'automation').rules);
  assert.equal(copiedRules[0].sourceId, id(copied)); assert.equal(copiedRules[0].targetId, id(copied));
  assert.equal(copiedRules[1].sourceId, id(copied)); assert.equal(copiedRules[1].targetId, id(belt));
  originals.forEach(node => assert.equal(config(document, node, 'control').targetId, id(processor)));
  for (const machine of [combiner, separator]) {
    const duplicate = await document.duplicate(machine);
    assert.deepEqual(config(document, duplicate, 'processor'), config(document, machine, 'processor'));
    assert.deepEqual(document.getVisualDescriptor(duplicate), document.getVisualDescriptor(machine));
  }
  const saved = await document.serialize(); assert.deepEqual(validateDocument(saved, value => value), saved);
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hello-webxr-processor-storage-'));
  let store;
  try {
    store = new ProjectStore({dataDir: temporaryRoot});
    const project = store.saveProject(null, {name: 'Procesos / preparación / operario', document: saved});
    const processorIndex = saved.rooms.hall.additions.findIndex(row => row.id === id(processor));
    for (const mutate of [data => { data.rooms.hall.additions[processorIndex].behaviors[0].parallelism = 9; },
      data => { data.rooms.hall.additions[processorIndex].descriptor.variant = 'javascript'; },
      data => { data.rooms.hall.additions[processorIndex].behaviors[0].outputId = '../outside'; }]) {
      const invalid = clone(saved); mutate(invalid);
      assert.throws(() => store.saveProject(null, {name: 'Rechazar', document: invalid}), error => error.status === 400);
      assert.equal(store.listProjects().length, 1, 'Rejected processor records cannot partially create a project.');
    }
    const recorder = new TelemetryRecorder();
    const counters = {powered: true, running: true, operatorAvailable: false, waitingOperator: true, busy: false, settingUp: false,
      queued: 3, queuedUnits: 8, activeJobs: 0, progress: 0, completed: 0, completedUnits: 0, outputQueued: 0,
      utilization: 0, setupSeconds: 0, processSeconds: 0, idleSeconds: 0, blockedSeconds: 0, operatorWaitSeconds: 2, downSeconds: 0,
      nominalCapacity: 1270, processTime: 8.5, setupTime: 3.25};
    recorder.start({projectRevision: project.revision, roomId: 'hall'}, {time: 10,
      objects: [{id: id(processor), analyticsInterval: 0.1, variables: counters}]});
    const telemetry = recorder.stop({time: 11, objects: [{id: id(processor), analyticsInterval: 0.1, variables: Object.assign({}, counters,
      {operatorAvailable: true, waitingOperator: false, busy: true, activeJobs: 3, progress: 0.1, processSeconds: 1, utilization: 1})}],
      events: [{id: 1, time: 10.5, objectId: id(processor), type: 'processor.operator', message: 'Operario disponible'}]});
    assert.equal(telemetry.samples.length, 2);
    const execution = store.saveSimulationRun(project.id, telemetry);
    store.close(); store = new ProjectStore({dataDir: temporaryRoot});
    assert.deepEqual(store.getProject(project.id).document, saved);
    assert.deepEqual(store.getSimulationRun(project.id, execution.id), execution, 'Processor timing, operator and throughput telemetry survive closing SQLite.');
    const reopened = makeDocument(); await reopened.load(store.getProject(project.id).document);
    assert.deepEqual(await reopened.serialize(), saved, 'All processor variants and editable control paths survive SQLite and browser reopening.');
    assert.equal(config(reopened, reopened.getObject(id(processor)), 'processor').outputId, id(combiner));
    assert.equal(config(reopened, reopened.getObject(id(combiner)), 'processor').outputId, id(separator));
    assert.equal(config(reopened, reopened.getObject(id(separator)), 'processor').outputId, id(queue));
    assert.equal(config(reopened, reopened.getObject(id(queue)), 'source').outputId, id(belt));
  } finally {
    if (store) store.close();
    const resolved = path.resolve(temporaryRoot);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir())); assert(path.basename(resolved).startsWith('hello-webxr-processor-storage-'));
    fs.rmSync(resolved, {recursive: true, force: true});
  }
  console.log('Processor storage: strict processing/setup/operator/combiner/separator schema, typed PLC rules, independent clipboard controls, SQLite project and timing/throughput telemetry round trips passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
