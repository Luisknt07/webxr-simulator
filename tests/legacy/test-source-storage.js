const __layout = require("../../tooling/layout.cjs");
// Source schema, real editor clipboard records and SQLite round trips.
// All files belong to a new OS temporary directory; real projects are untouched.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const THREE = require('three');
const behaviorSchema = require('../../modules/logistica-industrial/contracts/behaviors.js');
const automation = require('../../modules/logistica-industrial/functions/flujo-materiales/schema/automation.js');
const {ProjectStore} = require('../../apps/api/server/storage.js');
const {validateDocument} = require('../../apps/api/server/validation.js');
const productSources = behaviorSchema.productSources;
const clone = value => JSON.parse(JSON.stringify(value));
function source(file) {
  return fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-source-storage.js"), '../src/editor', file)), 'utf8')
    .replace(/^\uFEFF/, '').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
}
const createIndustrialPrefab = new Function('THREE', 'behaviorSchema', source('IndustrialPrefabs.js') + '\nreturn createIndustrialPrefab;')(THREE, behaviorSchema);
const SceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', source('SceneDocument.js')
  .replace('default class SceneDocument', 'return class SceneDocument'))(THREE, behaviorSchema, createIndustrialPrefab);
const TelemetryRecorder = new Function(source('TelemetryRecorder.js')
  .replace('default class TelemetryRecorder', 'class TelemetryRecorder') + '\nreturn TelemetryRecorder;')();
const ProductSourceRuntime = require('../support/load-product-source-runtime.js')(THREE, behaviorSchema);
function makeDocument() {
  const document = new SceneDocument({}); document.registerRoom('hall', new THREE.Group()); return document;
}
function config(document, object, type) { return document.getBehaviors(object).find(row => row.type === type); }
function normal(value) { return behaviorSchema.normalizeBehaviors([Object.assign({type: 'source'}, value)])[0]; }
function sku(index = 0) {
  return {id: 'sku_' + index, name: 'Producto ' + index, type: ['box', 'crate', 'drum', 'bottle'][index % 4],
    width: 0.20 + index * 0.02, height: 0.25 + index * 0.01, depth: 0.22 + index * 0.01, color: '#A17033'};
}
function rule(sourceId, variable, value, targetId, targetVariable = 'running', set = false) {
  return {sourceId, variable, operator: 'eq', value, targetId, targetVariable, set, edge: 'rising'};
}

async function run() {
  const catalog = Array.from({length: 8}, (_, index) => sku(index));
  const input = clone(catalog), normalized = productSources.normalizeCatalog(catalog);
  assert.equal(normalized.length, 8); assert.equal(normalized[0].color, '#a17033'); assert.deepEqual(catalog, input);
  assert.deepEqual(productSources.normalizeCatalog(JSON.stringify(catalog)), normalized);
  assert.equal(productSources.normalizeCatalogJSON(catalog), JSON.stringify(normalized));
  assert.throws(() => productSources.normalizeCatalog(catalog.concat(sku(8))), /8/);
  assert.throws(() => productSources.normalizeCatalog([sku(), sku()]), /único|unico/i);
  assert.throws(() => productSources.normalizeCatalog('[broken'), /válida|valida/i);
  assert.throws(() => productSources.normalizeCatalog(' '.repeat(productSources.MAX_CATALOG_JSON + 1)), /grande/);
  for (const field of ['width', 'height', 'depth']) {
    for (const value of [0, -1, 2.01, Infinity, NaN, '0.2', null]) {
      assert.throws(() => productSources.normalizeCatalog([Object.assign(sku(), {[field]: value})]), /dimensiones/i);
    }
  }
  for (const changed of [{id: '../escape'}, {id: ''}, {name: ''}, {name: 'bad\u0000name'}, {name: 'x'.repeat(161)},
    {type: 'script'}, {color: 'red'}, {code: 'process.exit()'}, {asset: 'https://example.invalid/model.glb'}, {sql: 'DROP TABLE projects'}]) {
    assert.throws(() => productSources.normalizeCatalog([Object.assign(sku(), changed)]), /producto|compatible|color|nombre|código|codigo/i);
  }
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const poisoned = JSON.parse(JSON.stringify(sku()).replace(/}$/, ',"' + key + '":{"polluted":true}}'));
    assert.throws(() => productSources.normalizeCatalog([poisoned]), /campos/i);
    assert.equal({}.polluted, undefined);
  }
  assert.throws(() => productSources.normalizeCatalog([Object.assign(Object.create({run() {}}), sku())]), /campos/);
  assert.equal(productSources.unitsFor(normal({loadMode: 'pallet', palletColumns: 4, palletRows: 4, palletLayers: 4})), 64);
  const fitted = normal({loadMode: 'pallet', palletType: 'industrial-1200x1000', palletMaterial: 'plastic', palletPacking: 'fit', palletLayers: 5, width: .5, height: .23, depth: .3});
  assert.equal(productSources.unitsFor(fitted), 30);
  assert.throws(() => normal({loadMode: 'pallet', palletPacking: 'fit', palletType: 'half-800x600', width: 1, depth: 1}));
  assert.throws(() => normal({loadMode: 'pallet', palletType: 'euro-1200x800', generationMode: 'sequence',
    catalog: JSON.stringify([{id: 'big', name: 'Big', type: 'box', width: 1, height: .5, depth: 1, color: '#aa8855'}])}), /pallet/);
  for (const changed of [{loadMode: 'pallet', palletColumns: 8, palletRows: 8, palletLayers: 2}, {capacity: 0},
    {capacity: 1.5}, {initialCount: 1.5}, {capacity: 2, initialCount: 3}, {initialCount: 3, totalLimit: 2},
    {totalLimit: 2.5}, {seed: 1.5}, {palletColumns: 1.5}, {width: 2.1}, {height: 0}, {depth: Infinity},
    {interval: 0.09}, {outputInterval: 121}, {outputId: '../escape'}, {outputId: 'x;DROP TABLE projects'}]) {
    assert.throws(() => normal(changed), /entero|capacidad|límite|limite|64|rango|inválida|invalida/i);
  }
  const random = normal({generationMode: 'random', catalog: JSON.stringify(catalog), seed: 91});
  const order = Array.from({length: 64}, (_, index) => productSources.specAt(random, index).id);
  assert.deepEqual(order, Array.from({length: 64}, (_, index) => productSources.specAt(clone(random), index).id));
  assert.notDeepEqual(order, Array.from({length: 64}, (_, index) => productSources.specAt(Object.assign({}, random, {seed: 92}), index).id));
  const sequence = Object.assign({}, random, {generationMode: 'sequence'});
  assert.deepEqual(Array.from({length: 10}, (_, index) => productSources.specAt(sequence, index).id), catalog.concat(catalog.slice(0, 2)).map(row => row.id));
  const ignored = normal({script: 'process.exit()', sql: 'DROP TABLE projects'});
  assert.equal(ignored.script, undefined); assert.equal(ignored.sql, undefined, 'Source behavior accepts declarative fields only.');
  const rules = [rule('custom-source', 'queued', 2, 'custom-belt'), rule('custom-source', 'full', true, 'custom-belt'),
    rule('custom-source', 'empty', true, 'custom-source', 'autoGenerate', true),
    rule('custom-source', 'generatedUnits', 16, 'custom-source', 'interval', 0.5)];
  assert.deepEqual(automation.normalizeRules(rules), rules);
  assert.throws(() => automation.normalizeRules([rule('custom-source', 'full', 1, 'custom-belt')]), /tipo|rango/);
  assert.throws(() => automation.normalizeRules([rule('custom-source', 'queued', true, 'custom-belt')]), /tipo|rango/);
  assert.throws(() => automation.normalizeRules([rule('custom-source', 'queued', 2, 'custom-source', 'interval', 0)]), /tipo|rango/);
  assert.throws(() => automation.normalizeRules([Object.assign({}, rules[0], {execute: 'code'})]), /campos/);

  const document = makeDocument(), generator = document.addPrefab('hall', 'source'), queue = document.addPrefab('hall', 'source', 'queue');
  const belt = document.addPrefab('hall', 'conveyor', 'roller-middle'), plc = document.addPrefab('hall', 'plc');
  const generatorId = generator.userData.editorId, queueId = queue.userData.editorId, beltId = belt.userData.editorId;
  const storedCatalog = normalized.slice(0, 4);
  storedCatalog[0].name = "Caja '); DROP TABLE projects; --";
  const generation = Object.assign({}, config(document, generator, 'source'), {generationMode: 'sequence', catalog: JSON.stringify(storedCatalog),
    loadMode: 'pallet', palletColumns: 2, palletRows: 2, palletLayers: 2, capacity: 4, initialCount: 2, totalLimit: 20,
    interval: 0.5, outputInterval: 0.25, delivery: 'automatic', outputId: queueId, seed: 123});
  const generatorRules = [rule(generatorId, 'full', true, beltId), rule(generatorId, 'queued', 4, generatorId, 'autoGenerate', false)];
  document.setBehaviors(generator, [generation, behaviorSchema.defaultBehavior('analytics'), {type: 'automation', rules: JSON.stringify(generatorRules)}]);
  document.setBehaviors(queue, [Object.assign({}, config(document, queue, 'source'), {capacity: 3, delivery: 'automatic', outputId: beltId}), behaviorSchema.defaultBehavior('analytics')]);
  document.setBehaviors(plc, [{type: 'automation', rules: JSON.stringify([rule(generatorId, 'full', true, beltId), rule(queueId, 'queued', 0, beltId)])}]);
  const controls = Array.from(document.additions.get(generatorId).nodes.values()).filter(node => config(document, node, 'control'));
  assert.equal(controls.length, 6); controls.forEach(node => assert.equal(config(document, node, 'control').targetId, generatorId));
  const originalControls = controls.map(node => [node.userData.editorId, node.name, config(document, node, 'control').command]);
  const clipboard = document.captureObject(generator), copy = await document.pasteObject(clipboard, 'hall', 1.5);
  const copiedControls = Array.from(document.additions.get(copy.userData.editorId).nodes.values()).filter(node => config(document, node, 'control'));
  assert.equal(copiedControls.length, 6);
  copiedControls.forEach(node => {
    assert.equal(config(document, node, 'control').targetId, copy.userData.editorId);
    assert(!originalControls.some(([original]) => original === node.userData.editorId), 'Each pasted physical button gets its own identity.');
  });
  assert.equal(config(document, copy, 'source').outputId, queueId, 'Document-level copying preserves external connections; editor placement may explicitly detach them.');
  assert.equal(config(document, copy, 'source').catalog, JSON.stringify(storedCatalog));
  assert.equal(config(document, copy, 'source').capacity, 4);
  const copyRules = JSON.parse(config(document, copy, 'automation').rules);
  assert.equal(copyRules[0].sourceId, copy.userData.editorId); assert.equal(copyRules[0].targetId, beltId);
  assert.equal(copyRules[1].sourceId, copy.userData.editorId); assert.equal(copyRules[1].targetId, copy.userData.editorId);
  assert.deepEqual(controls.map(node => [node.userData.editorId, node.name, config(document, node, 'control').command]), originalControls);
  const queueCopy = await document.duplicate(queue);
  assert.equal(config(document, queueCopy, 'source').autoGenerate, false);
  assert.equal(config(document, queueCopy, 'source').outputId, beltId);
  assert.deepEqual(document.getVisualDescriptor(queueCopy), {prefab: 'source', variant: 'queue'});
  const saved = await document.serialize();
  assert.deepEqual(validateDocument(saved, value => value), saved, 'Browser and HTTP validation preserve the same source catalog, flow and PLC rules.');

  const temporaryRoot = fs.mkdtempSync(__layout.map(path.join(os.tmpdir(), 'hello-webxr-source-storage-')));
  let store;
  try {
    store = new ProjectStore({dataDir: temporaryRoot});
    const project = store.saveProject(null, {name: 'Producción Source / FIFO', document: saved});
    assert.deepEqual(project.document, saved); assert.equal(store.listProjects().length, 1);
    const rows = store.db.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?').all('table', 'projects');
    assert.equal(rows.length, 1, 'Product names containing SQL syntax remain inert parameterized JSON text.');
    for (const mutate of [data => { data.rooms.hall.additions[0].behaviors[0].catalog = JSON.stringify([Object.assign(sku(), {code: 'code'})]); },
      data => { data.rooms.hall.additions[0].behaviors[0].capacity = 0; },
      data => { data.rooms.hall.additions[0].behaviors[0].outputId = '../escape'; }]) {
      const invalid = clone(saved); mutate(invalid);
      assert.throws(() => store.saveProject(null, {name: 'Rechazar', document: invalid}), error => error.status === 400);
      assert.equal(store.listProjects().length, 1, 'Invalid source records cannot partially save a project.');
    }
    const adapter = new ProductSourceRuntime({}), component = {config: Object.assign({}, generation, {capacity: 2, totalLimit: 10})};
    const record = {id: generatorId, object: new THREE.Group(), components: {source: component}, writable: []}; adapter.attach(record, component);
    component.queue = [{spec: storedCatalog[0], units: 8}, {spec: storedCatalog[1], units: 8}];
    Object.assign(component, {generated: 3, generatedUnits: 24, delivered: 1, deliveredUnits: 8, blocked: true});
    const recorder = new TelemetryRecorder();
    recorder.start({projectRevision: project.revision, roomId: 'hall'}, {time: 10,
      objects: [{id: generatorId, analyticsInterval: 0.1, variables: adapter.variables(record)}]});
    component.queue.shift(); Object.assign(component, {delivered: 2, deliveredUnits: 16, blocked: false});
    const telemetry = recorder.stop({time: 11, objects: [{id: generatorId, analyticsInterval: 0.1, variables: adapter.variables(record)}],
      events: [{id: 1, time: 10.5, objectId: generatorId, type: 'source.dispatch', message: 'Carga despachada'}]});
    assert.equal(telemetry.samples.length, 2);
    assert.equal(telemetry.samples[0].variables.queued, 2); assert.equal(telemetry.samples[0].variables.queuedUnits, 16);
    assert.equal(telemetry.samples[0].variables.full, true); assert.equal(telemetry.samples[0].variables.blocked, true);
    assert.equal(telemetry.samples[1].variables.queued, 1); assert.equal(telemetry.samples[1].variables.deliveredUnits, 16);
    assert.equal(telemetry.samples[1].variables.full, false); assert.equal(telemetry.samples[1].variables.blocked, false);
    assert.equal(telemetry.samples[0].variables.delivery, undefined); assert.equal(telemetry.samples[0].variables.nextProduct, undefined,
      'Telemetry persists machine counters and booleans without treating SKU labels as numeric variables.');
    const execution = store.saveSimulationRun(project.id, telemetry);
    store.close(); store = new ProjectStore({dataDir: temporaryRoot});
    const restored = store.getProject(project.id);
    assert.deepEqual(restored.document, saved, 'Source and FIFO configuration survives closing and reopening SQLite.');
    assert.deepEqual(store.getSimulationRun(project.id, execution.id), execution, 'Source counters and flow events survive a database restart.');
    const reopened = makeDocument(); await reopened.load(restored.document);
    assert.deepEqual(await reopened.serialize(), saved, 'Reopening generated source prefabs retains their editable controls and declarative functions.');
    assert.equal(config(reopened, reopened.getObject(generatorId), 'source').outputId, queueId);
    assert.equal(config(reopened, reopened.getObject(queueId), 'source').outputId, beltId);
    assert.equal(JSON.parse(config(reopened, reopened.getObject(plc.userData.editorId), 'automation').rules)[0].variable, 'full');
    assert.equal(JSON.parse(config(reopened, reopened.getObject(generatorId), 'source').catalog)[0].name, storedCatalog[0].name);
    assert.equal(store.listSimulationRuns(project.id).length, 1);
  } finally {
    if (store) store.close();
    const resolved = __layout.map(path.resolve(temporaryRoot)), parent = __layout.map(path.resolve(os.tmpdir()));
    assert.equal(path.dirname(resolved), parent); assert(path.basename(resolved).startsWith('hello-webxr-source-storage-'));
    fs.rmSync(resolved, {recursive: true, force: true});
  }
  console.log('Source storage: strict catalogs and limits, reproducible SKU mixing, real clipboard/control remapping, declarative PLC rules, validated project SQLite and counter/event telemetry round trips passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
