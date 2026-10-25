'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const h = require('./test-processor-runtime'), {THREE, behaviorSchema, setup, add, record, vars, advance} = h;
const source = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const factory = new Function('THREE', 'behaviorSchema', source('src/editor/IndustrialPrefabs.js') + '\nreturn {createSourceProductVisual,createIndustrialPrefab};')(THREE, behaviorSchema);
const ConveyorAssembly = new Function('THREE', 'conveyorLayout', source('src/editor/ConveyorAssembly.js').replace('default class ConveyorAssembly', 'return class ConveyorAssembly'))(THREE, behaviorSchema.conveyorLayout);
const fixture = fs.readFileSync(path.join(__dirname, 'test-simulation-checkpoint.js'), 'utf8');
const checkpoint = new Function('require', '__dirname', fixture.slice(0, fixture.indexOf('function setup()')) + '\nreturn {captureSimulation,restoreSimulation};')(require, __dirname);
const pallets = behaviorSchema.productSources.pallets;
function queue(f, values = {}) { return add(f, 'palletQueue', Object.assign({withPanel: false, layoutMode: 'fit', palletType: 'euro-1200x800', layers: 5, capacity: 128, palletCapacity: 4}, values)); }
function connect(f, from, to) {
  const assembly = new ConveyorAssembly({document: f.document, roomId: 'hall'}), config = assembly.config(from);
  f.document.setBehaviors(from, [Object.assign({}, config, {delivery: 'automatic', outputId: to.userData.editorId})]); assembly.align(from, 'output', to, 'input');
}
function noOverlaps(component) {
  component.pallets.forEach(pallet => {
    for (const item of pallet.items) {
      const place = item.fitPlacement; assert(place.layer <= 5);
      assert(place.x >= -1e-7 && place.z >= -1e-7 && place.x + place.width <= component.config.width + 1e-7 && place.z + place.depth <= component.config.depth + 1e-7);
      for (const other of pallet.items) if (other !== item) assert(!pallets.overlaps(place, other.fitPlacement), 'Actual packed envelopes never overlap.');
    }
  });
}
function balance(f) {
  let generated = 0, retired = 0, active = 0;
  f.runtime.records.forEach(rec => { if (rec.components.source) generated += rec.components.source.generatedUnits; if (rec.components.palletQueue) retired += rec.components.palletQueue.inventory.deliveredUnits; });
  f.runtime.sourceRuntime.entries.forEach(entry => { if (entry.ownerId || entry.product) active += entry.units; });
  assert.equal(generated, active + retired, 'Generation equals exact live inventories plus counted terminal outputs.');
}
async function run() {
  for (const type of pallets.types.filter(value => value.id !== 'custom')) for (const material of ['wood', 'plastic']) {
    const config = {loadMode: 'pallet', palletType: type.id, palletMaterial: material, palletPacking: 'fit', palletLayers: 5};
    const spec = {id: 'carton', name: 'Carton', type: 'box', width: .5, height: .23, depth: .3, mass: 2};
    const plan = behaviorSchema.productSources.palletPlan(spec, config), object = factory.createSourceProductVisual(spec, config);
    const bounds = new THREE.Box3().setFromObject(object), size = bounds.getSize(new THREE.Vector3());
    h.close(size.x, type.width); h.close(size.z, type.depth); h.close(size.y, plan.height);
    assert.equal(object.userData.sourceProduct.units, plan.units); assert.equal(object.userData.sourceProduct.palletMaterial, material);
    plan.placements.forEach((item, i) => plan.placements.slice(i + 1).forEach(other => assert(!pallets.overlaps(item, other))));
    if (type.id === 'euro-1200x800') assert.equal(plan.units, 20);
    if (type.id === 'industrial-1200x1000') assert.equal(plan.units, 30);
    let meshes = 0; object.traverse(value => { if (value.isMesh) meshes++; }); assert(meshes < 20, 'A complete pallet is batched by material, not one draw per contained carton.');
  }
  {
    const f = setup(), src = add(f, 'source', {autoGenerate: true, interval: .2, outputInterval: .1, capacity: 2, totalLimit: 12,
      loadMode: 'pallet', palletPacking: 'fit', palletType: 'industrial-1200x1000', palletMaterial: 'plastic', palletLayers: 5, width: .5, height: .23, depth: .3, mass: 2});
    const belt = add(f, 'conveyor', {equipmentType: 'chain', surface: 'chains', width: 1.4, maxLoad: 500, clearance: 1.8, speed: 4});
    const sink = queue(f, {palletType: 'industrial-1200x1000', acceptsPallets: true, capacity: 4, autoRelease: true, releaseInterval: .1});
    connect(f, src, belt); connect(f, belt, sink); f.runtime.start('hall');
    advance(f, 14); assert.equal(vars(f, src).generatedUnits, 360); assert.equal(vars(f, sink).receivedUnits, 360);
    assert(vars(f, sink).dispatchedPallets >= 9); assert.equal(vars(f, sink).deliveredUnits % 30, 0); balance(f);
    record(f, sink).components.palletQueue.queue.forEach(entry => { assert.equal(entry.units, 30); assert.equal(f.runtime.productMetadata(entry.product).base, 'runners'); h.close(f.runtime.productMetadata(entry.product).mass, 72); });
    f.runtime.stop();
  }
  {
    const f = setup(), src = add(f, 'source', {autoGenerate: true, interval: .1, outputInterval: .1, capacity: 2, width: .5, height: .23, depth: .3, totalLimit: 190}), sink = queue(f, {autoRelease: true, releaseInterval: .1});
    connect(f, src, sink); const saved = JSON.stringify(await f.document.serialize()); f.runtime.start('hall');
    let allFull = false;
    for (let time = 0; time < 24; time += .05) {
      advance(f, .05); const component = record(f, sink).components.palletQueue; noOverlaps(component); balance(f);
      if (vars(f, sink).completePallets >= 3) allFull = true;
      assert(f.runtime.sourceRuntime.liveLoads() <= 500);
    }
    assert(allFull, 'Four storage bays visibly fill before the stock-full release.');
    assert(vars(f, sink).dispatchedPallets >= 5, 'Several full bay waves retire and incoming generation continues.');
    assert.equal(vars(f, sink).deliveredUnits % 20, 0); assert.equal(vars(f, src).generatedUnits, 190);
    assert(f.runtime.events.some(value => value.type === 'pallet-dispatched'));
    const snapshot = JSON.parse(JSON.stringify(checkpoint.captureSimulation(f.runtime))), old = Object.assign({}, vars(f, sink));
    checkpoint.restoreSimulation(f.runtime, snapshot); noOverlaps(record(f, sink).components.palletQueue); balance(f);
    assert.equal(vars(f, sink).dispatchedPallets, old.dispatchedPallets); assert.equal(vars(f, sink).deliveredUnits, old.deliveredUnits);
    f.runtime.stop(); assert.equal(JSON.stringify(await f.document.serialize()), saved);
  }
  {
    const f = setup(), catalog = JSON.stringify([
      {id: 'large', name: 'Large', type: 'box', width: .55, height: .23, depth: .35, color: '#aa8855'},
      {id: 'small', name: 'Small', type: 'crate', width: .25, height: .3, depth: .25, color: '#4488aa'},
      {id: 'tall', name: 'Tall', type: 'box', width: .4, height: .6, depth: .35, color: '#77aa44'}
    ]), src = add(f, 'source', {autoGenerate: true, interval: .1, outputInterval: .1, capacity: 2, totalLimit: 100, generationMode: 'sequence', catalog}), sink = queue(f, {autoRelease: true, releaseInterval: .1, maxStackHeight: 1.8});
    connect(f, src, sink); f.runtime.start('hall');
    for (let time = 0; time < 18; time += .1) {
      advance(f, .1); const component = record(f, sink).components.palletQueue; noOverlaps(component); balance(f);
      component.items.forEach(item => assert(item.fitPlacement.y + item.fitPlacement.height <= 1.8 + 1e-7));
    }
    assert.equal(vars(f, src).generated, 100); assert(vars(f, sink).dispatchedPallets > 0, 'Mixed measured sizes can complete physical bays below the nominal quota.'); f.runtime.stop();
  }
  {
    const f = setup(), src = add(f, 'source', {initialCount: 2, outputInterval: .1}), sink = queue(f, {capacity: 8, autoRelease: true, autoReleasePressure: true, releaseInterval: .1}); connect(f, src, sink);
    for (let i = 0; i < 7; i++) add(f, 'source', {initialCount: 61, capacity: 64}, [-60 + i * 10, 1.02, 50]);
    f.runtime.start('hall'); advance(f, .8);
    assert.equal(vars(f, sink).dispatchedPallets, 1); assert.equal(vars(f, sink).deliveredUnits, 2); assert.equal(vars(f, sink).queued, 0, 'Pressure release retires only the one completed bay.'); balance(f); f.runtime.stop();
  }
  {
    const f = setup(), sink = queue(f, {capacity: 4, releasePolicy: 'palletFull', autoRelease: false}), authored = f.document.addPrefab('hall', 'product');
    f.document.setTransform(authored, {position: [0, 2, 5]}); const saved = JSON.stringify(await f.document.serialize()); f.runtime.start('hall');
    const body = f.runtime.products.get(authored), entry = f.runtime.sourceRuntime.entryForProduct(record(f, sink), body);
    assert(f.runtime.palletQueueRuntime.receive(record(f, sink), entry, true)); assert(f.runtime.command(sink.userData.editorId, 'dispatchPallet'));
    assert.equal(vars(f, sink).deliveredUnits, 1); assert(!authored.visible); assert(!f.runtime.products.has(authored));
    const snapshot = JSON.parse(JSON.stringify(checkpoint.captureSimulation(f.runtime))); checkpoint.restoreSimulation(f.runtime, snapshot);
    assert.equal(vars(f, sink).dispatchedPallets, 1); f.runtime.stop(); assert(authored.visible); assert.equal(JSON.stringify(await f.document.serialize()), saved, 'Retired authored loads retain exact persistent pose/visibility and checkpoint identity.');
  }
  console.log('Metric wood/plastic pallet templates, real mixed-size supported packing, five-layer/height limits, complete-bay continuous release, global-pressure relief, exact unit conservation and checkpoint/authored restoration passed.');
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = {run};
