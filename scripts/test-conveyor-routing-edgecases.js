/* Independent admission/retry and mixed classification audit. */
'use strict';
const assert = require('node:assert/strict');
const {THREE, behaviorSchema, setup, add, config, record, inventory, vars, advance} = require('./test-processor-runtime.js');
const layout = behaviorSchema.conveyorLayout;
function connect(f, from, to, branch = false) {
  const get = object => f.document.getBehaviors(object).find(value => ['conveyor', 'source'].includes(value.type));
  const a = get(from), b = get(to), ports = value => value.type === 'source' ? behaviorSchema.productSources.layout(value) : layout.ports(value);
  f.document.setBehaviors(from, [Object.assign({}, a, a.type === 'source' ? {delivery: 'automatic'} : {},
    branch ? {branchId: to.userData.editorId, branchPort: 'input'} : {outputId: to.userData.editorId, outputPort: 'input'})]);
  f.scene.updateMatrixWorld(true);
  const fromPorts = ports(a), output = branch ? fromPorts.branch : fromPorts.output || fromPorts.outlet, input = ports(b).input;
  const direction = new THREE.Vector3(output.tx, 0, output.tz).transformDirection(from.matrixWorld);
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-direction.z, direction.x) - Math.atan2(-input.tz, input.tx));
  const position = new THREE.Vector3(output.x, 0, output.z).applyMatrix4(from.matrixWorld).sub(new THREE.Vector3(input.x, 0, input.z).applyQuaternion(rotation));
  f.document.setTransform(to, {position: position.toArray(), quaternion: rotation.toArray()});
}
async function run() {
  const f = setup(), source = add(f, 'source', {initialCount: 8, capacity: 8, outputInterval: .1});
  const tee = add(f, 'conveyor', {layout: 'tee', width: 1.2, length: 4, speed: 3, maxPackages: 2, routing: 'percentage', branchPercentage: 37.5});
  const main = add(f, 'source', {capacity: 12, running: false}), branch = add(f, 'source', {capacity: 12, running: false});
  f.document.setTransform(source, {position: [-8, 1.02, 0]});
  connect(f, source, tee); connect(f, tee, main); connect(f, tee, branch, true);
  const before = JSON.stringify(await f.document.serialize()); f.runtime.start('hall');
  const original = inventory(f, source).queue.slice(); advance(f, 4);
  const belt = record(f, tee).components.conveyor, committed = belt.routeSequence;
  assert(committed > 0 && committed < 8, 'A stopped receiver applies realistic backpressure to the feeder.');
  const decisions = belt.packages.map(item => [item.product.sourceEntry.id, item.route]);
  const counters = [belt.routedMain, belt.routedBranch, belt.routeSequence];
  for (let attempt = 0; attempt < 120; attempt++) f.runtime.sourceRuntime.dispatch(record(f, source));
  advance(f, 2);
  assert.deepEqual([belt.routedMain, belt.routedBranch, belt.routeSequence], counters, 'Failed admission retries do not advance percentage allocation or counters.');
  assert.deepEqual(belt.packages.map(item => [item.product.sourceEntry.id, item.route]), decisions, 'An already admitted product retains its percentage route while blocked.');
  f.runtime.command(main.userData.editorId, 'start'); f.runtime.command(branch.userData.editorId, 'start'); advance(f, 12);
  assert.equal(belt.routeSequence, 8); assert.equal(belt.routedBranch, 3); assert.equal(belt.routedMain, 5);
  assert.equal(vars(f, main).queued, 5); assert.equal(vars(f, branch).queued, 3);
  const received = inventory(f, main).queue.concat(inventory(f, branch).queue);
  assert.equal(received.length, 8); assert.equal(new Set(received.map(entry => entry.id)).size, 8);
  original.forEach(entry => assert(received.includes(entry), 'Percentage dispatch retains original inventory identities.'));
  f.runtime.stop(); assert.equal(JSON.stringify(await f.document.serialize()), before);

  const mixed = setup(), runtime = mixed.runtime;
  const compound = {units: 2, members: [{units: 1, spec: {id: 'red', type: 'box', color: '#ff0000', quality: 'good', defect: 'none'}},
    {units: 1, spec: {id: 'blue', type: 'drum', color: '#0000ff', quality: 'defective', defect: 'dimension'}}]};
  const pseudo = {sourceEntry: compound, classification: {}, bounds: new THREE.Box3(new THREE.Vector3(-.5, 0, -.3), new THREE.Vector3(.5, .4, .3)), scale: new THREE.Vector3(1, 1, 1)};
  const summary = runtime.productMetadata(pseudo);
  assert.equal(summary.sku, undefined); assert.equal(summary.color, 'mixed'); assert.equal(summary.productType, 'mixed');
  assert.equal(summary.quality, 'defective'); assert.equal(summary.defect, 'dimension'); assert.equal(summary.units, 2);
  for (const [field, value] of [['sku', 'red'], ['color', '#ff0000'], ['productType', 'box']]) {
    assert(!behaviorSchema.conveyorRouting.matches({field, operator: 'neq', value, route: 'branch'}, summary), 'A mixed attribute cannot count as an explicit negative match.');
  }
  assert(behaviorSchema.conveyorRouting.matches({field: 'quality', operator: 'eq', value: 'defective', route: 'branch'}, summary), 'A batch containing a faulty member is rejected as defective.');
  const missing = runtime.productMetadata(Object.assign({}, pseudo, {sourceEntry: {units: 1, spec: {}}}));
  assert(!behaviorSchema.conveyorRouting.matches({field: 'quality', operator: 'neq', value: 'good', route: 'branch'}, missing), 'Unknown quality is not automatically a rejected quality classification.');
  console.log('Routing edge cases: actual backpressure percentage retries, committed routes, conserved identities, mixed negative rules and unknown inspection metadata passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
