'use strict';
// Real procedural cargo, inventory and processors: no replacement box fixtures.
const assert = require('node:assert/strict'), THREE = require('three');
const storage = require('./test-vehicle-storage.js'), schema = require('../shared/behaviors.js');
const recipes = require('../shared/product-equipment.js'), {Runtime} = require('./test-robot-runtime.js');
const SourceRuntime = require('./load-product-source-runtime.js')(THREE, schema), VehicleRuntime = require('./load-vehicle-runtime.js')(THREE);
const close = (actual, expected, label) => assert(Math.abs(actual - expected) < 1e-5, label + ': ' + actual + ' != ' + expected);
function fixture() {
  const document = storage.setup(), root = document.getRoot('hall'), scene = new THREE.Scene(); scene.add(root);
  const floor = new THREE.Mesh(new THREE.BoxBufferGeometry(200, .05, 200), new THREE.MeshBasicMaterial()); floor.position.y = -.025; root.add(floor);
  const ctx = {scene, editor: {active: false}, raycontrol: {states: {}, addState(name, state) {this.states[name] = state;}, activateState() {}, deactivateState() {}}};
  const runtime = new Runtime(ctx, document); runtime.sourceRuntime = new SourceRuntime(runtime); runtime.vehicleRuntime = new VehicleRuntime(runtime);
  const add = (kind, values = {}, position = [0, 1, 0], variant) => {
    const object = document.addPrefab('hall', kind, variant), prior = document.getBehaviors(object).find(config => config.type === kind);
    const defaults = kind === 'source' ? {autoGenerate: false, initialCount: 0, delivery: 'manual', capacity: 20} : kind === 'processor' ? {setupTime: 0, processTime: .1, delivery: 'manual', powered: true, running: true, outputCapacity: 64, capacity: 64} : {};
    document.setBehaviors(object, [Object.assign({}, prior, defaults, values)]); document.setTransform(object, {position}); return object;
  };
  const record = object => runtime.records.get(object.userData.editorId);
  const start = () => {scene.updateMatrixWorld(true); runtime.start('hall');};
  const advance = seconds => {for (let t = 0; t < seconds - 1e-9; t += 1 / 60) {scene.updateMatrixWorld(true); runtime.execute(1 / 60);}};
  return {document, root, scene, ctx, runtime, add, record, start, advance};
}
function metadata(f, entry) {assert(entry.product, 'The actual accessible cargo must be materialized.'); return f.runtime.productMetadata(entry.product);}
function leaves(entry) {return entry.members && entry.members.length ? entry.members.flatMap(leaves) : [entry];}
function drain(f, record, inventory) {
  const result = [];
  while (inventory.queue.length) {
    const entry = inventory.queue[0]; f.runtime.sourceRuntime.materialize(record, inventory);
    result.push({entry, metadata: metadata(f, entry)}); assert(f.runtime.sourceRuntime.remove(record, entry, 'audit', inventory));
    if (entry.product) {entry.product.object.visible = false; f.runtime.sourceRuntime.dematerialize(entry);}
  }
  return result;
}
async function run() {
  const f = fixture(), bundle = f.add('product', {}, [-12, 0, 4], 'carton-bundle'), pallet = f.add('product', {}, [-12, 0, 8], 'pallet-loaded');
  const sourceBundle = f.add('source', {initialCount: 1, productType: 'box', productVariant: 'carton-bundle', width: .55, height: .48, depth: .7, mass: 3, units: 6}, [-10, 1, 0]);
  const sourcePallet = f.add('source', {initialCount: 1, productType: 'box', width: .25, height: .2, depth: .25, mass: 2, units: 6, loadMode: 'pallet', palletType: 'euro-1200x800', palletColumns: 2, palletRows: 2, palletLayers: 2}, [-10, 1, -5]);
  const queuedBundles = f.add('source', {initialCount: 2, productType: 'box', productVariant: 'carton-bundle', width: .55, height: .48, depth: .7, mass: 3, units: 6}, [-10, 1, -10]);
  const passthrough = f.add('processor', {}, [0, 1, 0]), combine = f.add('processor', {mode: 'combiner', combineCount: 2}, [5, 1, 0]), separator = f.add('processor', {mode: 'separator', splitCount: 12}, [10, 1, 0]);
  const stock = f.add('source', {}, [15, 1, 0]), splitThree = f.add('processor', {mode: 'separator', splitCount: 3}, [20, 1, 0]), recombine = f.add('processor', {mode: 'combiner', combineCount: 3}, [25, 1, 0]), splitTwo = f.add('processor', {mode: 'separator', splitCount: 2}, [30, 1, 0]);
  const authored = await f.document.serialize(); f.start();
  const direct = f.runtime.products.get(bundle), fullPallet = f.runtime.products.get(pallet);
  f.runtime.productionContents(f.record(queuedBundles)).forEach(row => {close(row.mass, 18, 'Dashboard queued cargo total mass'); assert.equal(row.units, 6);});
  close(f.runtime.productMetadata(direct).mass, 18, 'Direct bundle total mass'); assert.equal(f.runtime.productMetadata(direct).units, 6);
  close(f.runtime.productMetadata(fullPallet).mass, 145, 'Direct pallet total mass'); assert.equal(f.runtime.productMetadata(fullPallet).units, 24);
  const packEntry = f.record(sourceBundle).components.source.queue[0], palletEntry = f.record(sourcePallet).components.source.queue[0];
  close(metadata(f, packEntry).mass, 18, 'Source bundle per-unit mass'); assert.equal(packEntry.units, 6);
  close(metadata(f, palletEntry).mass, 121, 'Source pallet8 packages ×6units ×2kg +25kg tare'); assert.equal(palletEntry.units, 48);
  const before = metadata(f, palletEntry), mesh = palletEntry.product.object;
  assert(f.runtime.sourceRuntime.remove(f.record(sourcePallet), palletEntry, 'audit')); assert(f.runtime.processorRuntime.receive(f.record(passthrough), palletEntry, true)); f.advance(.2);
  const processed = f.record(passthrough).components.processor.output.queue[0]; assert.equal(processed, palletEntry); assert.equal(processed.product.object, mesh);
  const after = metadata(f, processed); ['width', 'height', 'depth', 'mass', 'units'].forEach(key => close(after[key], before[key], 'Pass-through pallet ' + key));
  const directEntry = f.runtime.sourceRuntime.entryForProduct(f.record(combine), direct); close(metadata(f, directEntry).mass, 18, 'Direct bundle inventory mass');
  assert(f.runtime.sourceRuntime.remove(f.record(sourceBundle), packEntry, 'audit')); assert(f.runtime.processorRuntime.receive(f.record(combine), directEntry, true)); assert(f.runtime.processorRuntime.receive(f.record(combine), packEntry, true)); f.advance(.2);
  const lot = f.record(combine).components.processor.output.queue[0]; assert.equal(lot.units, 12); close(metadata(f, lot).mass, 36, 'Mixed direct/source combined mass');
  assert(f.runtime.sourceRuntime.remove(f.record(combine), lot, 'audit', f.record(combine).components.processor.output)); assert(f.runtime.processorRuntime.receive(f.record(separator), lot, true)); f.advance(.3);
  const pieces = drain(f, f.record(separator), f.record(separator).components.processor.output);
  assert.equal(pieces.length, 12); assert.equal(pieces.reduce((sum, row) => sum + row.metadata.units, 0), 12); close(pieces.reduce((sum, row) => sum + row.metadata.mass, 0), 36, 'Split leaf quantities cannot reset to spec.units');
  pieces.forEach(({entry, metadata: info}) => {assert.equal(info.units, 1); close(info.mass, 3, 'Single contained unit mass'); const leaf = leaves(entry)[0]; close(leaf.spec.width, .55, 'Source package dimensional provenance'); close(leaf.spec.depth, .7, 'Source package depth provenance');});
  // An unchanged full pallet can cross a stock boundary without another tare.
  assert(f.runtime.sourceRuntime.remove(f.record(passthrough), processed, 'audit', f.record(passthrough).components.processor.output)); assert(f.runtime.sourceRuntime.receive(f.record(stock), processed));
  close(metadata(f, processed).mass, 121, 'Stock preserves one pallet tare'); assert.equal(metadata(f, processed).units, 48);
  const directPalletEntry = f.runtime.sourceRuntime.entryForProduct(f.record(combine), fullPallet);
  assert(f.runtime.sourceRuntime.remove(f.record(stock), processed, 'audit')); assert(f.runtime.processorRuntime.receive(f.record(combine), processed, true)); assert(f.runtime.processorRuntime.receive(f.record(combine), directPalletEntry, true)); f.advance(.3);
  const palletLot = f.record(combine).components.processor.output.queue[0]; assert.equal(palletLot.units, 72); close(metadata(f, palletLot).mass, 266, 'Combining complete pallets must account for both25kg physical bases');
  assert(f.runtime.sourceRuntime.remove(f.record(combine), palletLot, 'audit', f.record(combine).components.processor.output)); assert(f.runtime.processorRuntime.receive(f.record(splitThree), palletLot, true)); f.advance(.3);
  const thirds = drain(f, f.record(splitThree), f.record(splitThree).components.processor.output); assert.equal(thirds.length, 3);
  close(thirds.reduce((sum, row) => sum + row.metadata.mass, 0), 266, 'Three partitions preserve prorated packaging mass'); assert.equal(thirds.reduce((sum, row) => sum + row.metadata.units, 0), 72);
  thirds.forEach(({entry}) => assert(f.runtime.processorRuntime.receive(f.record(recombine), entry, true))); f.advance(.3);
  const rebuilt = f.record(recombine).components.processor.output.queue[0]; close(metadata(f, rebuilt).mass, 266, 'Recombine must not duplicate allocated pallet tare');
  assert(f.runtime.sourceRuntime.remove(f.record(recombine), rebuilt, 'audit', f.record(recombine).components.processor.output)); assert(f.runtime.processorRuntime.receive(f.record(splitTwo), rebuilt, true)); f.advance(.3);
  const halves = drain(f, f.record(splitTwo), f.record(splitTwo).components.processor.output); close(halves.reduce((sum, row) => sum + row.metadata.mass, 0), 266, 'Repeated fractional groups conserve all cargo and packaging'); assert.equal(halves.reduce((sum, row) => sum + row.metadata.units, 0), 72);
  f.runtime.stop(); assert.deepEqual(await f.document.serialize(), authored);
  const copied = await f.document.pasteObject(f.document.captureObject(pallet), 'sound', 1);
  assert.notEqual(copied.userData.editorId, pallet.userData.editorId); assert.deepEqual(f.document.getBehaviors(copied), f.document.getBehaviors(pallet));
  const resources = object => {const result = new Set(); object.traverse(mesh => {if (mesh.geometry) result.add(mesh.geometry); if (mesh.material) {result.add(mesh.material); if (mesh.material.map) result.add(mesh.material.map);}}); return result;};
  const originalResources = resources(pallet); resources(copied).forEach(value => assert(!originalResources.has(value), 'Copied cargo owns independent geometry/material/texture resources.'));
  const snapshot = await f.document.serialize(), reopened = storage.setup(); await reopened.load(snapshot); assert.deepEqual(await reopened.serialize(), snapshot);
  assert.equal(reopened.getBehaviors(reopened.getObject(copied.userData.editorId)).find(config => config.type === 'product').units, 24);
  console.log('Cargo conservation: real direct/Source bundles,48-unit pallet, processor/stock transfer,12 separated leaves,72-unit mixed pallets with repeated prorated tare, exact mass/dimensions and authored restoration passed.');
}
module.exports = {fixture, metadata, drain, leaves, run};
if (require.main === module) run().catch(error => {console.error(error); process.exitCode = 1;});
