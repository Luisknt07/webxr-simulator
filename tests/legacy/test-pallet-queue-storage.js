const __layout = require("../../tooling/layout.cjs");
// Strict configuration, real clipboard/component references, and temporary SQLite.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {THREE, behaviorSchema, setup, add, config} = require('./test-processor-runtime.js');
const automation = require('../../modules/logistica-industrial/functions/flujo-materiales/schema/automation.js');
const {ProjectStore} = require('../../apps/api/server/storage.js');
const {validateDocument} = require('../../apps/api/server/validation.js');
const clone = value => JSON.parse(JSON.stringify(value));
const normal = values => behaviorSchema.normalizeBehaviors([Object.assign({type: 'palletQueue'}, values)])[0];
const recorderSource = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-pallet-queue-storage.js"), '../src/editor/TelemetryRecorder.js')), 'utf8')
  .replace('export default class TelemetryRecorder', 'class TelemetryRecorder').replace(/^export /gm, '');
const TelemetryRecorder = new Function(recorderSource + '\nreturn TelemetryRecorder;')();
function rule(sourceId, variable, value, targetId, targetVariable, set) {
  return {sourceId, variable, operator: 'eq', value, targetId, targetVariable, set, edge: 'rising'};
}
async function run() {
  const defaults = normal({});
  assert.equal(defaults.width, 1.2); assert.equal(defaults.depth, 1.05); assert.equal(defaults.columns, 4); assert.equal(defaults.rows, 3);
  assert.equal(defaults.layers, 4); assert.equal(defaults.capacity, 48); assert.equal(defaults.running, true); assert.equal(defaults.paused, false);
  assert.equal(defaults.delivery, 'manual'); assert.equal(defaults.outputInterval, 1);
  const maximum = normal({width: 4, depth: 4, columns: 8, rows: 8, layers: 8, capacity: 128}); assert.equal(maximum.capacity, 128);
  assert.equal(normal({columns: 1, rows: 1, layers: 1, capacity: 1}).capacity, 1);
  const fitted = normal({layoutMode: 'fit', palletType: 'euro-1200x800', palletMaterial: 'plastic', capacity: 500, layers: 5,
    palletCapacity: 4, autoRelease: true, autoReleasePressure: true, releasePolicy: 'stockFull', releaseInterval: 2, maxStackHeight: 1.8});
  assert.equal(fitted.width, 1.2); assert.equal(fitted.depth, .8); assert.equal(fitted.capacity, 500);
  for (const invalid of [{layoutMode: 'fit', layers: 6}, {layoutMode: 'fit', capacity: 501}, {palletType: 'unknown'},
    {palletMaterial: 'steel'}, {releasePolicy: 'all'}, {autoRelease: 1}, {releaseInterval: 0}, {maxStackHeight: -1}]) assert.throws(() => normal(invalid));
  for (const invalid of [{width: 0.39}, {width: 4.01}, {depth: 0.39}, {depth: Infinity}, {columns: 0}, {columns: 9},
    {columns: 1.5}, {rows: 0}, {rows: 1.5}, {layers: 9}, {layers: 1.5}, {capacity: 0}, {capacity: 129}, {capacity: 1.5},
    {columns: 1, rows: 1, layers: 2, capacity: 3}, {running: 1}, {paused: 'false'}, {delivery: 'script'},
    {outputInterval: 0.09}, {outputInterval: 120.01}, {outputId: '../outside'}, {outputPort: 'output'}]) {
    assert.throws(() => normal(invalid), /rango|inválid|inval|entero|capacidad|opción|opcion/i);
  }
  const ignored = normal({script: 'process.exit()', sql: 'DROP TABLE projects'});
  assert.equal(ignored.script, undefined); assert.equal(ignored.sql, undefined);
  const occupancyRule = rule('custom-stock', 'occupancy', 75, 'custom-stock', 'paused', true);
  const fullRule = rule('custom-stock', 'full', true, 'custom-source', 'autoGenerate', false);
  const intervalRule = rule('custom-stock', 'receivedUnits', 16, 'custom-stock', 'outputInterval', 0.5);
  assert.deepEqual(automation.normalizeRules([occupancyRule, fullRule, intervalRule]), [occupancyRule, fullRule, intervalRule]);
  assert.throws(() => automation.normalizeRules([Object.assign({}, occupancyRule, {value: true})]), /tipo|rango/);
  assert.throws(() => automation.normalizeRules([Object.assign({}, fullRule, {value: 1})]), /tipo|rango/);
  assert.throws(() => automation.normalizeRules([Object.assign({}, intervalRule, {set: 0})]), /tipo|rango/);
  const f = setup(), stock = add(f, 'palletQueue', {width: 2.4, depth: 1.8, columns: 3, rows: 2, layers: 4, capacity: 24,
    delivery: 'automatic', outputInterval: 0.25});
  const source = add(f, 'source', {}, [-20, 1.02, 0]), belt = add(f, 'conveyor', {}, [20, 1.02, 0]);
  const id = object => object.userData.editorId;
  f.document.setBehaviors(source, [Object.assign({}, config(f, source, 'source'), {outputId: id(stock), delivery: 'automatic'})]);
  const localRules = [rule(id(stock), 'occupancy', 75, id(stock), 'paused', true), rule(id(stock), 'full', true, id(source), 'autoGenerate', false)];
  f.document.setBehaviors(stock, [Object.assign({}, config(f, stock, 'palletQueue'), {outputId: id(belt)}),
    behaviorSchema.defaultBehavior('analytics'), {type: 'automation', rules: JSON.stringify(localRules)}]);
  const controls = Array.from(f.document.additions.get(id(stock)).nodes.values()).filter(node => config(f, node, 'control'));
  assert.equal(controls.length, 4); controls.forEach(node => assert.equal(config(f, node, 'control').targetId, id(stock)));
  const dispatch = controls.find(node => config(f, node, 'control').command === 'dispatch');
  f.document.setTransform(dispatch, {position: [0.19, -0.13, 0.09]});
  const copy = await f.document.pasteObject(f.document.captureObject(stock), 'hall', 3);
  assert.deepEqual(config(f, copy, 'palletQueue'), config(f, stock, 'palletQueue'));
  const copyControls = Array.from(f.document.additions.get(id(copy)).nodes.values()).filter(node => config(f, node, 'control'));
  assert.equal(copyControls.length, 4); copyControls.forEach(node => {
    assert.equal(config(f, node, 'control').targetId, id(copy)); assert(!controls.some(original => id(original) === id(node)));
  });
  const copiedDispatch = copyControls.find(node => config(f, node, 'control').command === 'dispatch');
  assert.deepEqual(copiedDispatch.position.toArray(), dispatch.position.toArray());
  const copyRules = JSON.parse(config(f, copy, 'automation').rules);
  assert.equal(copyRules[0].sourceId, id(copy)); assert.equal(copyRules[0].targetId, id(copy)); assert.equal(copyRules[1].targetId, id(source));
  assert.equal(config(f, source, 'source').outputId, id(stock), 'Copying a store leaves external producers bound to the original equipment.');
  assert.equal(config(f, copy, 'palletQueue').outputId, id(belt), 'Document-level copies preserve explicitly external output references.');
  const fitStock = add(f, 'palletQueue', fitted, [35, 1.02, 0]);
  const fitCopy = await f.document.pasteObject(f.document.captureObject(fitStock), 'hall', 8);
  assert.deepEqual(config(f, fitCopy, 'palletQueue'), fitted, 'Pallet formats, packing and explicit continuous sink policy survive copying.');
  const saved = await f.document.serialize(); assert.deepEqual(validateDocument(saved, value => value), saved);
  const temporaryRoot = fs.mkdtempSync(__layout.map(path.join(os.tmpdir(), 'hello-webxr-pallet-queue-storage-'))); let store;
  try {
    store = new ProjectStore({dataDir: temporaryRoot});
    const project = store.saveProject(null, {name: 'Almacenes independientes', document: saved});
    const invalid = clone(saved), stockRecord = invalid.rooms.hall.additions.find(row => row.id === id(stock));
    stockRecord.behaviors.find(row => row.type === 'palletQueue').capacity = 128;
    assert.throws(() => store.saveProject(null, {name: 'Rechazar', document: invalid}), error => error.status === 400);
    assert.equal(store.listProjects().length, 1);
    const recorder = new TelemetryRecorder(), variables = {queued: 18, queuedUnits: 54, capacity: 24, occupancy: 75,
      received: 20, receivedUnits: 60, delivered: 2, deliveredUnits: 6, full: false, empty: false, blocked: false, running: true, paused: false};
    recorder.start({projectRevision: project.revision, roomId: 'hall'}, {time: 10, objects: [{id: id(stock), analyticsInterval: 0.1, variables}]});
    const telemetry = recorder.stop({time: 11, objects: [{id: id(stock), analyticsInterval: 0.1,
      variables: Object.assign({}, variables, {queued: 17, queuedUnits: 51, occupancy: 17 / 24 * 100, delivered: 3, deliveredUnits: 9})}],
      events: [{id: 1, time: 10.5, objectId: id(stock), type: 'palletQueue.dispatch', message: 'Salida de una carga'}]});
    const execution = store.saveSimulationRun(project.id, telemetry);
    store.close(); store = new ProjectStore({dataDir: temporaryRoot});
    assert.deepEqual(store.getProject(project.id).document, saved); assert.deepEqual(store.getSimulationRun(project.id, execution.id), execution);
    const loaded = setup(); await loaded.document.load(store.getProject(project.id).document);
    assert.deepEqual(await loaded.document.serialize(), saved);
    const restored = loaded.document.getObject(id(stock)); assert.deepEqual(config(loaded, restored, 'palletQueue'), config(f, stock, 'palletQueue'));
    assert.equal(restored.children[0].userData.industrialPalletQueue.capacity, 24);
    assert.equal(config(loaded, loaded.document.getObject(id(source)), 'source').outputId, id(stock));
    assert.equal(config(loaded, restored, 'palletQueue').outputId, id(belt));
    assert.deepEqual(config(loaded, loaded.document.getObject(id(fitStock)), 'palletQueue'), fitted);
  } finally {
    if (store) store.close(); const resolved = __layout.map(path.resolve(temporaryRoot));
    assert.equal(path.dirname(resolved), __layout.map(path.resolve(os.tmpdir()))); assert(path.basename(resolved).startsWith('hello-webxr-pallet-queue-storage-'));
    fs.rmSync(resolved, {recursive: true, force: true});
  }
  console.log('Pallet queue storage: strict grid/capacity schema, typed PLC occupancy rules, independent copied controls/references, SQLite project and stock telemetry round trips passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
