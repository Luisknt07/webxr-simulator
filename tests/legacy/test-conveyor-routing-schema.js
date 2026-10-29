/* Typed classification and reproducible simulated inspection, without runtime. */
'use strict';
const assert = require('node:assert/strict');
const schema = require('../../modules/logistica-industrial/contracts/behaviors.js');
const routing = schema.conveyorRouting, sources = schema.productSources;
const normal = (type, values = {}) => schema.normalizeBehaviors([Object.assign({type}, values)])[0];
const rule = (field, operator, value, route = 'branch') => ({field, operator, value, route});
const config = rules => normal('conveyor', {layout: 'tee', routing: 'rules', routingRules: JSON.stringify(rules)});

function run() {
  const legacy = normal('conveyor');
  assert.equal(legacy.routing, 'primary'); assert.equal(legacy.routingRules, '[]');
  assert.equal(legacy.routingDefault, 'main'); assert.equal(legacy.branchPercentage, 50);
  const metadata = {sku: 'RED-01', color: '#FF0000', productType: 'box', quality: 'defective', defect: 'surface', width: .25, height: .3, depth: .4, units: 12};
  for (const [field, value] of [['sku', 'RED-01'], ['color', '#ff0000'], ['productType', 'box'], ['quality', 'defective'], ['defect', 'surface'], ['width', .25], ['height', .3], ['depth', .4], ['units', 12]]) {
    assert.equal(routing.selectRoute(config([rule(field, 'eq', value)]), metadata), 'branch', field);
    assert.equal(routing.selectRoute(config([rule(field, 'neq', value)]), metadata), 'main', field);
  }
  for (const [operator, value, expected] of [['lt', .3, true], ['lte', .25, true], ['gt', .2, true], ['gte', .25, true], ['lt', .25, false], ['gt', .25, false]]) {
    assert.equal(routing.selectRoute(config([rule('width', operator, value)]), metadata), expected ? 'branch' : 'main');
  }
  const firstMatch = config([rule('quality', 'eq', 'defective'), rule('color', 'eq', '#ff0000', 'main')]);
  assert.deepEqual(routing.decideRoute(firstMatch, metadata), {route: 'branch', reason: 'rule', ruleIndex: 0});
  assert.equal(routing.selectRoute(config([rule('color', 'eq', '#00ff00')]), metadata), 'main');
  assert.deepEqual(routing.decideRoute(Object.assign({}, firstMatch, {routingDefault: 'branch'}), {}), {route: 'branch', reason: 'default', ruleIndex: -1});
  for (const unavailable of [{}, {color: 'mixed', sku: undefined, productType: 'mixed'}, {sku: undefined, units: NaN}, {units: '12'}, Object.create({sku: 'OTHER'})]) {
    assert.equal(routing.selectRoute(config([rule('sku', 'neq', 'RED-01'), rule('color', 'neq', '#ff0000'), rule('units', 'gt', 1)]), unavailable), 'main', 'Unavailable or mixed metadata must not satisfy a negative rule.');
  }
  assert(routing.matches(rule('sku', 'eq', 'mixed'), {sku: 'mixed'}), 'The literal mixed is a valid authored SKU.');
  assert(routing.matches(rule('sku', 'neq', 'OTHER'), {sku: 'mixed'}));
  assert(!routing.matches(rule('sku', 'neq', 'OTHER'), {sku: undefined}), 'A heterogeneous batch has no single SKU.');
  assert.deepEqual(Array.from({length: 6}, (_, index) => routing.selectRoute({routing: 'alternate'}, {}, index)), ['main', 'branch', 'main', 'branch', 'main', 'branch']);
  assert.equal(routing.selectRoute({routing: 'branch'}, metadata), 'branch');
  assert.equal(routing.selectRoute({routing: 'primary'}, metadata), 'main');
  for (const percentage of [0, .1, 1, 25, 33.3, 50, 67.5, 99.9, 100]) {
    let branches = 0;
    for (let index = 0; index < 1000; index++) {
      const selected = routing.percentageRoute(index, percentage);
      assert.equal(selected, routing.percentageRoute(index, percentage), 'Retries keep the same admission ordinal and route.');
      if (selected === 'branch') branches++;
      assert.equal(branches, Math.floor((index + 1) * percentage / 100 + 1e-10), 'Every prefix follows the configured deterministic proportion.');
    }
    assert.equal(branches, Math.round(percentage * 10));
  }
  const invalid = [null, {}, '{', 'null', Array(17).fill(rule('units', 'gt', 1)), [rule('script', 'eq', 'x')],
    [rule('color', 'gt', '#ff0000')], [rule('sku', 'eq', '')], [rule('sku', 'eq', '../escape')], [rule('color', 'eq', 'red')],
    [rule('quality', 'eq', 'unknown')], [rule('defect', 'eq', 'mixed')], [rule('productType', 'eq', 'vehicle')],
    [rule('units', 'eq', 1.5)], [rule('height', 'eq', Infinity)], [rule('units', 'lt', -1)], [rule('width', 'eq', '0.2')],
    [rule('sku', 'eq', {sql: 'DROP TABLE projects'})], [rule('sku', 'eval', 'x')], [rule('sku', 'eq', 'x', 'script')],
    [Object.assign(rule('units', 'gt', 1), {script: 'process.exit()'})], ' '.repeat(routing.MAX_RULES_JSON + 1)];
  invalid.forEach(value => assert.throws(() => routing.normalizeRules(value)));
  assert.equal(routing.normalizeRulesJSON([rule('color', 'eq', '#FFAA00')]), JSON.stringify([rule('color', 'eq', '#ffaa00')]));
  assert.equal(routing.normalizeRules(Array(16).fill(rule('units', 'gt', 0))).length, 16);
  for (const values of [{routing: 'eval'}, {routingDefault: 'random'}, {branchPercentage: -1}, {branchPercentage: 101}, {routingRules: '[{}]'}, {branchPercentage: NaN}]) {
    assert.throws(() => normal('conveyor', values));
  }

  const product = normal('product');
  assert.equal(product.sku, 'product'); assert.equal(product.productType, 'box'); assert.equal(product.quality, 'good'); assert.equal(product.defect, 'none');
  assert.equal(normal('product', {quality: 'defective'}).defect, 'damaged');
  assert.equal(normal('product', {color: '#AABBCC'}).color, '#aabbcc');
  for (const values of [{quality: 'bad'}, {defect: 'script'}, {quality: 'good', defect: 'damaged'}, {sku: 'a b'}, {productType: 'script'}]) assert.throws(() => normal('product', values));
  const row = {id: 'A', name: 'Caja A', type: 'box', width: .2, height: .3, depth: .4, color: '#FF0000'};
  const oldRows = sources.normalizeCatalog([row]); assert.equal(oldRows[0].quality, 'good'); assert.equal(oldRows[0].defect, 'none');
  assert.equal(sources.normalizeCatalog([Object.assign({}, row, {quality: 'defective'})])[0].defect, 'damaged');
  for (const values of [{quality: 'good', defect: 'surface'}, {quality: 'script'}, {defect: 'mixed'}, {script: 'eval'}]) assert.throws(() => sources.normalizeCatalog([Object.assign({}, row, values)]));
  const source = normal('source', {generationMode: 'sequence', catalog: JSON.stringify([row, Object.assign({}, row, {id: 'B', quality: 'defective', defect: 'dimension'})]), defectRate: 35.5, defect: 'surface', seed: 37});
  const before = JSON.stringify(source), generated = Array.from({length: 2000}, (_, index) => sources.specAt(source, index));
  assert.equal(JSON.stringify(source), before, 'Inspection never mutates the source or persisted catalogue.');
  assert.deepEqual(generated, Array.from({length: 2000}, (_, index) => sources.specAt(source, index)), 'The same seed and generation ordinals reproduce quality.');
  assert.notDeepEqual(generated, Array.from({length: 2000}, (_, index) => sources.specAt(Object.assign({}, source, {seed: 38}), index)), 'A different seed changes simulated defects.');
  const goodSkuDefects = generated.filter(spec => spec.id === 'A' && spec.quality === 'defective');
  assert(goodSkuDefects.length > 300 && goodSkuDefects.length < 420, 'Random quality approximately follows the selected defect rate.');
  assert(goodSkuDefects.every(spec => spec.defect === 'surface'));
  assert(generated.filter(spec => spec.id === 'B').every(spec => spec.quality === 'defective' && spec.defect === 'dimension'), 'Fixed catalogue defects survive global quality injection.');
  assert.equal(sources.specAt(normal('source', {defectRate: 100}), 0).defect, 'damaged');
  assert.equal(sources.specAt(normal('source', {quality: 'good', defect: 'surface', defectRate: 0}), 0).defect, 'none');
  assert.equal(sources.specAt(normal('source', {quality: 'defective', defectRate: 0}), 0).quality, 'defective');
  for (const values of [{defectRate: -1}, {defectRate: 101}, {defectRate: '1'}, {quality: 'script'}, {defect: 'mixed'}, {seed: 1.5}]) assert.throws(() => normal('source', values));
  console.log('Conveyor routing schema: typed ordered rules, safe fallback, exact deterministic percentages, authored product metadata and seeded source quality passed.');
}
run();
