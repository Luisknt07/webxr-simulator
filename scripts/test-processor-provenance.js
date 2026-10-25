'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const h = require('./test-processor-runtime');
const {validateDocument} = require('../server/validation');
const {THREE, behaviorSchema, setup, add, link, record, inventory, advance} = h;
const source = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const prefabs = new Function('THREE', 'behaviorSchema', source('src/editor/IndustrialPrefabs.js') + '\nreturn {createProductVisual,createSourceProductVisual};')(THREE, behaviorSchema);
const checkpoint = new Function('THREE', 'createProductVisual', 'createSourceProductVisual', source('src/studio/SimulationCheckpoint.js') + '\nreturn {captureSimulation,restoreSimulation};')(THREE, prefabs.createProductVisual, prefabs.createSourceProductVisual);
const id = object => object.userData.editorId;
function leaves(entry, seen = new Set()) {
  assert(!seen.has(entry), 'Provenance membership never cycles back to an enclosing load.');
  const branch = new Set(seen); branch.add(entry);
  return entry.members && entry.members.length ? entry.members.flatMap(member => leaves(member, branch)) : [entry];
}
function catalog(sku, color, quality) { return JSON.stringify([{id: sku, name: sku, type: 'box', width: .2, height: .15, depth: .22, mass: quality === 'good' ? 2 : 3, color, quality, defect: quality === 'good' ? 'none' : 'damaged', base: 'flat'}]); }
async function test(fractions) {
  const f = setup(), units = fractions ? 4 : 1;
  const feeds = [add(f, 'source', {initialCount: 1, generationMode: 'sequence', catalog: catalog('A', '#44aa77', 'good'), loadMode: fractions ? 'pallet' : 'individual', palletColumns: 1, palletRows: 1, palletLayers: units}, [-20, 1.02, 0]),
    add(f, 'source', {initialCount: 1, generationMode: 'sequence', catalog: catalog('B', '#bb6655', 'defective'), loadMode: fractions ? 'pallet' : 'individual', palletColumns: 1, palletRows: 1, palletLayers: units}, [-20, 1.02, 6])];
  f.document.setTransform(feeds[0], {scale: [1.1, .8, 1]}); f.document.setTransform(feeds[1], {scale: [.7, 1.2, .9]});
  const inspections = [add(f, 'processor', {}, [-10, 1.02, 0]), add(f, 'processor', {}, [-10, 1.02, 6])];
  const combine = add(f, 'processor', {mode: 'combiner', combineCount: 2, delivery: 'automatic', outputInterval: .1});
  const split = add(f, 'processor', {mode: 'separator', splitCount: fractions ? 3 : 2, delivery: 'automatic', outputInterval: .1});
  const processors = [combine, split]; link(f, combine, split);
  if (fractions) {
    const again = add(f, 'processor', {mode: 'combiner', combineCount: 3, delivery: 'automatic', outputInterval: .1});
    const singles = add(f, 'processor', {mode: 'separator', splitCount: 8, delivery: 'automatic', outputInterval: .1, outputCapacity: 12});
    link(f, split, again); link(f, again, singles); processors.push(again, singles);
  }
  const buffer = add(f, 'source', {capacity: 12}); link(f, processors.at(-1), buffer);
  const authored = validateDocument(await f.document.serialize(), value => value); f.runtime.start('hall');
  const originals = feeds.map(feed => {
    const entry = inventory(f, feed).queue[0]; const original = {id: entry.id, originId: id(feed), spec: Object.assign({}, entry.spec), scale: entry.scale.slice(), units: entry.units};
    assert(f.runtime.sourceRuntime.remove(record(f, feed), entry, 'manual'));
    assert(f.runtime.processorRuntime.receive(record(f, inspections[feeds.indexOf(feed)]), entry, true)); return original;
  });
  advance(f, .3);
  inspections.forEach(object => {
    const current = record(f, object), output = current.components.processor.output, entry = output.queue[0]; assert(entry);
    assert(f.runtime.sourceRuntime.remove(current, entry, 'manual', output));
    assert(f.runtime.processorRuntime.receive(record(f, combine), entry, true));
  });
  for (let t = 0; t < 8 && inventory(f, buffer).queue.length < units * 2; t += .1) advance(f, .1);
  const outputs = inventory(f, buffer).queue; assert.equal(outputs.length, units * 2);
  const verify = outputs => {
    assert.equal(new Set(outputs.map(entry => entry.id)).size, outputs.length, 'Each active split result owns a new unique load ID.');
    const tally = new Map();
    outputs.slice().sort((a, b) => b.spec.id.localeCompare(a.spec.id)).forEach(entry => {
      const original = originals.find(original => original.spec.id === entry.spec.id); assert(original);
      assert.equal(entry.originId, original.originId, 'A singleton from Source B must not inherit the aggregate first member Source A origin.');
      assert(!originals.some(original => original.id === entry.id), 'Splitting keeps the established new-output-ID semantics.');
      assert(entry.members && entry.members.length === 1, 'Even a singleton retains its source-unit provenance.');
      const provenance = leaves(entry); assert.equal(provenance.reduce((sum, leaf) => sum + leaf.units, 0), 1);
      provenance.forEach(leaf => { assert.equal(leaf.id, original.id); assert.equal(leaf.originId, original.originId); assert.deepEqual(leaf.spec, original.spec); tally.set(leaf.id, (tally.get(leaf.id) || 0) + leaf.units); });
      entry.scale.forEach((value, index) => assert(Math.abs(value - original.scale[index]) < 1e-7, 'Recovered single units keep their own source scale.'));
      processors.forEach(object => assert(entry.lineage.includes(id(object)), 'The complete actual processor route remains traceable.'));
      assert(entry.lineage.includes(id(inspections[originals.indexOf(original)])), 'The unit keeps its own exclusive upstream inspection.');
      assert(!entry.lineage.includes(id(inspections[1 - originals.indexOf(original)])), 'Shared-lot history cannot attribute another source branch inspection to this unit.');
      assert(entry.lineage.includes(original.originId)); assert(!entry.lineage.includes(originals.find(item => item !== original).originId), 'A B unit never acquires Source A in its route.');
    });
    originals.forEach(original => assert.equal(tally.get(original.id), original.units, 'Repeated splits/combines conserve every original leaf quantity.'));
  };
  verify(outputs);
  const saved = JSON.parse(JSON.stringify(checkpoint.captureSimulation(f.runtime)));
  assert(saved.graph.nodes.length < 60000); assert.equal(new Set(saved.descriptors.map(value => value.identity)).size, saved.descriptors.length);
  checkpoint.restoreSimulation(f.runtime, saved); verify(inventory(f, buffer).queue);
  const second = JSON.parse(JSON.stringify(checkpoint.captureSimulation(f.runtime))); checkpoint.restoreSimulation(f.runtime, second); verify(inventory(f, buffer).queue);
  f.runtime.stop(); assert.deepEqual(await f.document.serialize(), authored);
}
async function authoredRecovery() {
  const f = setup(), combine = add(f, 'processor', {mode: 'combiner', combineCount: 2, delivery: 'automatic', outputInterval: .1});
  const split = add(f, 'processor', {mode: 'separator', splitCount: 2, delivery: 'automatic', outputInterval: .1});
  const combineAgain = add(f, 'processor', {mode: 'combiner', combineCount: 2, delivery: 'automatic', outputInterval: .1});
  const splitAgain = add(f, 'processor', {mode: 'separator', splitCount: 2, delivery: 'manual', outputInterval: .1});
  link(f, combine, split); link(f, split, combineAgain); link(f, combineAgain, splitAgain);
  const actors = [f.document.addPrefab('hall', 'product'), f.document.addPrefab('hall', 'product')];
  actors.forEach((object, index) => f.document.setTransform(object, {position: [-8, 1, index * 4 + 4], scale: [1 + index * .1, .9, 1], rotation: [.1, index * .4, .05]}));
  const authored = JSON.stringify(await f.document.serialize()); f.runtime.start('hall');
  const bounds = actors.map(object => f.runtime.products.get(object).bounds.clone()), hand = new THREE.Group(); f.scene.add(hand);
  actors.forEach(object => {
    const product = f.runtime.products.get(object); assert(f.runtime.pickupProduct(product, hand));
    const machine = record(f, combine), component = machine.components.processor;
    f.runtime.setProductMatrix(product, f.runtime.sourceRuntime.frontMatrix(machine, product.bounds, product.scale, component.input.position));
    assert(f.runtime.releaseProduct(product), 'Both authored boxes enter the real combiner through the normal manual receiver.');
  });
  for (let t = 0; t < 6 && record(f, splitAgain).components.processor.output.queue.length < 2; t += .1) advance(f, .1);
  const outputs = record(f, splitAgain).components.processor.output.queue; assert.equal(outputs.length, 2);
  assert.equal(f.runtime.processorRuntime.archive.size, 0, 'Two complete combine/separate cycles leave no stale authored-product archive entries.');
  assert.equal(f.runtime.products.size, 2); assert(actors.every(object => outputs.some(entry => entry.product && entry.product.object === object)));
  const callbacks = () => {
    const states = Object.values(f.ctx.raycontrol.states).filter(state => actors.includes(state.colliderMesh));
    assert.equal(states.length, 2, 'Each original mesh retains exactly one live interaction callback after repeated recovery.');
    actors.forEach(object => assert(states.includes(f.runtime.products.get(object).stateEntry.state)));
  };
  callbacks();
  actors.forEach((object, index) => {
    const actual = f.runtime.products.get(object).bounds;
    assert(actual.min.distanceTo(bounds[index].min) < 1e-7 && actual.max.distanceTo(bounds[index].max) < 1e-7, 'Recovery keeps the original mesh bounds within transform precision.');
  });
  const saved = JSON.parse(JSON.stringify(checkpoint.captureSimulation(f.runtime)));
  assert.equal(saved.descriptors.length, 2); assert.equal(new Set(saved.descriptors.map(value => value.identity)).size, 2);
  checkpoint.restoreSimulation(f.runtime, saved); assert.equal(f.runtime.processorRuntime.archive.size, 0);
  assert(actors.every(object => f.runtime.products.has(object))); callbacks();
  f.runtime.stop(); assert.equal(JSON.stringify(await f.document.serialize()), authored); assert.equal(Object.keys(f.ctx.raycontrol.states).length, 0);
}
(async () => { await test(false); await test(true); await authoredRecovery(); console.log('Processor provenance: two Source origins/scales, singleton leaf IDs, repeated fractional quantities, unique output IDs, two-cycle authored mesh recovery and compatible checkpoint graphs passed.'); })().catch(error => { console.error(error); process.exitCode = 1; });
