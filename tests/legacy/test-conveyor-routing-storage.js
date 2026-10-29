const __layout = require("../../tooling/layout.cjs");
/* New sorting configuration persists in a temporary SQLite database only. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const schema = require('../../modules/logistica-industrial/contracts/behaviors.js');
const {ProjectStore} = require('../../apps/api/server/storage.js');
const {validateDocument} = require('../../apps/api/server/validation.js');
const clone = value => JSON.parse(JSON.stringify(value));
const normal = (type, values = {}) => schema.normalizeBehaviors([Object.assign({type}, values)])[0];
const rules = [{field: 'quality', operator: 'eq', value: 'defective', route: 'branch'}, {field: 'color', operator: 'eq', value: '#ff0000', route: 'branch'}, {field: 'units', operator: 'gte', value: 8, route: 'main'}];
function record(id, prefab, behavior, position = [0, 1, 0]) {
  return {id, name: id, descriptor: {prefab}, position, quaternion: [0, 0, 0, 1], scale: [1, 1, 1], visible: true, interaction: {type: 'none'}, behaviors: [behavior]};
}
function run() {
  const classifier = record('custom-classifier', 'conveyor', normal('conveyor', {layout: 'tee', routing: 'rules', routingRules: JSON.stringify(rules), routingDefault: 'main', branchPercentage: 35, outputId: 'custom-main', branchId: 'custom-reject'}));
  const duplicate = clone(classifier); duplicate.id = 'custom-copy'; duplicate.name = 'Clasificador independiente'; duplicate.position[2] = 8;
  duplicate.behaviors[0].routingDefault = 'branch';
  const catalog = [{id: 'red', name: 'Caja roja', type: 'box', width: .2, height: .3, depth: .4, color: '#ff0000', quality: 'defective', defect: 'surface'},
    {id: 'blue', name: 'Bidón azul', type: 'drum', width: .3, height: .4, depth: .3, color: '#0000ff'}];
  const source = record('custom-source', 'source', normal('source', {generationMode: 'sequence', catalog: JSON.stringify(catalog), defectRate: 10, defect: 'dimension', seed: 49, outputId: 'custom-classifier', delivery: 'automatic'}), [-3, 1, 0]);
  const manual = record('custom-carton', 'product', normal('product', {sku: 'MANUAL-01', color: '#00ff00', productType: 'crate', quality: 'defective', defect: 'incomplete'}));
  const document = {format: 'hello-webxr-editor', version: 1, imports: [], rooms: {hall: {overrides: [], additions: [source, classifier, duplicate,
    record('custom-main', 'conveyor', normal('conveyor', {routing: 'primary'})), record('custom-reject', 'conveyor', normal('conveyor', {routing: 'percentage', branchPercentage: 20})), manual]}}};
  assert.deepEqual(validateDocument(document, value => value), document);
  const temporaryRoot = fs.mkdtempSync(__layout.map(path.join(os.tmpdir(), 'hello-webxr-routing-storage-'))); let store;
  try {
    store = new ProjectStore({dataDir: temporaryRoot});
    const project = store.saveProject(null, {name: 'Clasificación de productos', document});
    const changed = clone(document); changed.rooms.hall.additions[1].behaviors[0].routingRules = JSON.stringify([{field: 'sku', operator: 'eq', value: 'MANUAL-01', route: 'branch'}]);
    store.saveProject(project.id, {name: 'Clasificación de productos', document: changed, expectedRevision: project.revision});
    const invalidRules = [JSON.stringify([{field: 'color', operator: 'eval', value: 'process.exit()', route: 'branch'}]),
      JSON.stringify([{field: 'units', operator: 'gte', value: '8', route: 'branch'}]), JSON.stringify([{field: 'quality', operator: 'eq', value: 'defective', route: 'branch', script: 'DROP TABLE projects'}])];
    invalidRules.forEach(value => {
      const invalid = clone(changed); invalid.rooms.hall.additions[1].behaviors[0].routingRules = value;
      assert.throws(() => store.saveProject(null, {name: 'Inválido', document: invalid}), error => error.status === 400);
    });
    assert.equal(store.listProjects().length, 1, 'Invalid classification cannot create extra projects.');
    store.close(); store = new ProjectStore({dataDir: temporaryRoot});
    const restored = store.getProject(project.id);
    assert.equal(restored.revision, 2); assert.deepEqual(restored.document, changed);
    assert.equal(restored.document.rooms.hall.additions[2].behaviors[0].routingRules, classifier.behaviors[0].routingRules, 'Editing a classifier does not alter the copied configuration.');
    assert.equal(restored.document.rooms.hall.additions[0].behaviors[0].catalog, source.behaviors[0].catalog);
    assert.deepEqual(restored.document.rooms.hall.additions[5].behaviors[0], manual.behaviors[0]);
    const sourceRestored = restored.document.rooms.hall.additions[0].behaviors[0];
    assert.deepEqual(Array.from({length: 100}, (_, index) => schema.productSources.specAt(sourceRestored, index)), Array.from({length: 100}, (_, index) => schema.productSources.specAt(source.behaviors[0], index)), 'Saved source quality and catalogue settings reproduce the same classification inputs.');
  } finally {
    if (store) store.close();
    const resolved = __layout.map(path.resolve(temporaryRoot)); assert.equal(path.dirname(resolved), __layout.map(path.resolve(os.tmpdir())));
    assert(path.basename(resolved).startsWith('hello-webxr-routing-storage-')); fs.rmSync(resolved, {recursive: true, force: true});
  }
  console.log('Conveyor routing storage: SQLite rule/percentage/source quality/product metadata round trips, independent copies and rejected unsafe configurations passed.');
}
run();
