'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const h = require('./test-processor-runtime');
const q = require('./test-pallet-queue-runtime');
const {THREE, setup, add, record, vars, advance} = h;
const source = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const prefabs = new Function('THREE', 'behaviorSchema', source('src/editor/IndustrialPrefabs.js') + '\nreturn {createProductVisual,createSourceProductVisual};')(THREE, h.behaviorSchema);
const checkpoint = new Function('THREE', 'createProductVisual', 'createSourceProductVisual', source('src/studio/SimulationCheckpoint.js') + '\nreturn {captureSimulation,restoreSimulation};')(THREE, prefabs.createProductVisual, prefabs.createSourceProductVisual);

function run() {
  const f = setup(), inlet = add(f, 'source', {initialCount: 17, capacity: 20, outputInterval: .1});
  const output = q.addQueue(f, {palletCapacity: 4, columns: 2, rows: 2, layers: 1, capacity: 16});
  q.connect(f, inlet, output); f.runtime.start('hall'); advance(f, 3);
  const store = q.queue(f, output);
  assert.equal(vars(f, output).queued, 16); assert.equal(vars(f, output).palletCount, 4); assert.equal(vars(f, output).completePallets, 4);
  assert.equal(vars(f, inlet).queued, 1, 'A fifth pallet of product cannot silently overflow the four physical bays.');
  assert.deepEqual(store.pallets.map(pallet => pallet.items.length), [4, 4, 4, 4]);
  assert.deepEqual(JSON.parse(vars(f, output).palletOccupancies).map(pallet => pallet.units), [4, 4, 4, 4]);
  assert.equal(new Set(store.items.map(item => item.palletIndex)).size, 4); q.noOverlaps(store.items);
  const ids = store.queue.map(entry => entry.id), positions = store.items.map(item => item.mesh.matrixWorld.toArray());
  const saved = JSON.parse(JSON.stringify(checkpoint.captureSimulation(f.runtime)));
  checkpoint.restoreSimulation(f.runtime, saved);
  const resumed = q.queue(f, output);
  assert.deepEqual(resumed.queue.map(entry => entry.id), ids); assert.deepEqual(resumed.items.map(item => item.mesh.matrixWorld.toArray()), positions);
  assert.deepEqual(resumed.pallets.map(pallet => pallet.items.length), [4, 4, 4, 4]);
  const product = resumed.pallets[2].items[0].product, hand = q.addHand(f); assert(f.runtime.pickupProduct(product, hand));
  assert.equal(vars(f, output).completePallets, 3); advance(f, .2);
  assert.equal(vars(f, output).received, 17); assert.equal(vars(f, output).completePallets, 4);
  assert.equal(product.item.palletOwnerId, null, 'Manual retrieval clears that bay ownership without touching other pallets.');
  f.runtime.stop();

  const full = setup(), pallets = add(full, 'source', {initialCount: 5, capacity: 8, outputInterval: .1, loadMode: 'pallet', palletColumns: 2, palletRows: 2, palletLayers: 1});
  const depot = q.addQueue(full, {palletCapacity: 4, acceptsPallets: true, width: 1.4, depth: 1.2, columns: 1, rows: 1, layers: 1, capacity: 4});
  q.connect(full, pallets, depot); full.runtime.start('hall'); advance(full, 1);
  assert.equal(vars(full, depot).queued, 4); assert.equal(vars(full, depot).queuedUnits, 16);
  assert.equal(vars(full, depot).completePallets, 4); assert.equal(vars(full, pallets).queued, 1);
  q.noOverlaps(q.queue(full, depot).items);
  assert(q.queue(full, depot).pallets.every(pallet => pallet.items.length === 1));
  const fullSaved = JSON.parse(JSON.stringify(checkpoint.captureSimulation(full.runtime))); checkpoint.restoreSimulation(full.runtime, fullSaved);
  assert.equal(vars(full, depot).queuedUnits, 16); assert(q.queue(full, depot).pallets.every(pallet => pallet.items.length === 1));
  full.runtime.stop();
  console.log('Four-pallet buffers: real separate bays, unit packing, complete-pallet reception, capacity/backpressure, collision-free storage, manual retrieval and checkpoint identity/pose conservation passed.');
}
run();
