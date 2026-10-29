// Independent multi-destination audit using real product flow and collision geometry.
'use strict';
const assert = require('node:assert/strict');
const {THREE, behaviorSchema, setup, add, config, inventory, vars, advance} = require('./test-processor-runtime.js');
const automation = require('../../modules/logistica-industrial/functions/flujo-materiales/schema/automation.js');
const layouts = behaviorSchema.conveyorLayout;
function machine(f, object) { return f.document.getBehaviors(object).find(value => ['source', 'conveyor'].includes(value.type)); }
function ports(value) { return value.type === 'source' ? behaviorSchema.productSources.layout(value) : layouts.ports(value); }
function connect(f, from, to, outlet = 'output') {
  const a = machine(f, from), b = machine(f, to), side = outlet === 'branch';
  f.document.setBehaviors(from, [Object.assign({}, a, side ? {branchId: to.userData.editorId, branchPort: 'input'} :
    {outputId: to.userData.editorId, outputPort: 'input'}, a.type === 'source' ? {delivery: 'automatic'} : {})]);
  f.scene.updateMatrixWorld(true);
  const aPorts = ports(a), output = aPorts[outlet] || aPorts.outlet, input = ports(b).input;
  const direction = new THREE.Vector3(output.tx, 0, output.tz).transformDirection(from.matrixWorld);
  const yaw = Math.atan2(-direction.z, direction.x) - Math.atan2(-input.tz, input.tx);
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const position = new THREE.Vector3(output.x, 0, output.z).applyMatrix4(from.matrixWorld)
    .sub(new THREE.Vector3(input.x, 0, input.z).applyQuaternion(rotation));
  f.document.setTransform(to, {position: position.toArray(), quaternion: rotation.toArray()});
}
function row(id, color, quality = 'good', defect = 'none') {
  return {id, name: id, type: 'box', width: .22, height: .22, depth: .22, color, quality, defect};
}
function outputIds(f, object) { return inventory(f, object).queue.map(entry => entry.spec.id).sort(); }

async function run() {
  const f = setup();
  const catalog = [row('red-good', '#ff0000'), row('red-bad', '#ff0000', 'defective', 'damaged'),
    row('blue-good', '#0000ff'), row('blue-bad', '#0000ff', 'defective', 'surface'), row('green-good', '#00ff00'), row('blue-next', '#0000ff')];
  const source = add(f, 'source', {generationMode: 'sequence', catalog: JSON.stringify(catalog), initialCount: 6, outputInterval: .15});
  const tee = values => add(f, 'conveyor', Object.assign({layout: 'tee', junctionMode: 'split', length: 4, width: 1.2, speed: 3, routing: 'rules'}, values));
  const qualityGate = tee({routingRules: JSON.stringify([{field: 'quality', operator: 'eq', value: 'defective', route: 'branch'}]), routingDefault: 'main'});
  const colourGate = tee({routingRules: JSON.stringify([{field: 'color', operator: 'eq', value: '#ff0000', route: 'branch'}]), routingDefault: 'main'});
  const rejects = add(f, 'source', {capacity: 8}), reds = add(f, 'source', {capacity: 8}), others = add(f, 'source', {capacity: 8});
  f.document.setTransform(source, {position: [-8, 1.02, 0]});
  connect(f, source, qualityGate); connect(f, qualityGate, colourGate); connect(f, qualityGate, rejects, 'branch');
  connect(f, colourGate, reds, 'branch'); connect(f, colourGate, others);
  const before = JSON.stringify(await f.document.serialize()); f.runtime.start('hall'); advance(f, 12);
  assert.deepEqual(outputIds(f, rejects), ['blue-bad', 'red-bad'], 'Quality has priority before a downstream colour gate.');
  assert.deepEqual(outputIds(f, reds), ['red-good']); assert.deepEqual(outputIds(f, others), ['blue-good', 'blue-next', 'green-good']);
  assert.equal(vars(f, qualityGate).routedMain, 4); assert.equal(vars(f, qualityGate).routedBranch, 2);
  assert.equal(vars(f, colourGate).routedMain, 3); assert.equal(vars(f, colourGate).routedBranch, 1);
  assert.equal(vars(f, qualityGate).routingUnmatched, 4); assert.equal(vars(f, colourGate).routingUnmatched, 3);
  assert.equal(vars(f, qualityGate).exitCount, 6); assert.equal(vars(f, colourGate).exitCount, 4);
  assert.equal(f.runtime.sourceRuntime.liveLoads(), 6, 'Classification cannot duplicate or delete a product.');
  const entries = [rejects, reds, others].flatMap(object => inventory(f, object).queue);
  assert.equal(new Set(entries.map(entry => entry.id)).size, 6);
  entries.forEach(entry => { const original = catalog.find(row => row.id === entry.spec.id); assert.equal(entry.spec.color, original.color); assert.equal(entry.spec.quality, original.quality); assert.equal(entry.spec.defect, original.defect); });
  assert.throws(() => f.runtime.setVariable(qualityGate.userData.editorId, 'routedBranch', 7), /lectura/);
  for (const variable of ['routedMain', 'routedBranch', 'routingUnmatched']) {
    const rule = {sourceId: qualityGate.userData.editorId, variable, operator: 'gte', value: 2,
      targetId: qualityGate.userData.editorId, targetVariable: 'running', set: false, edge: 'rising'};
    assert.deepEqual(automation.normalizeRules([rule])[0], rule);
  }
  f.runtime.stop(); assert.equal(JSON.stringify(await f.document.serialize()), before, 'Routing metadata and generated objects never leak into authored documents.');
  console.log('Sorting independent audit: chained T quality/colour destinations, independent committed decisions, retained identity/attributes, readonly PLC counters and exact cleanup passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
