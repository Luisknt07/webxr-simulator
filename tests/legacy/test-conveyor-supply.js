'use strict';
const assert = require('node:assert/strict');
const h = require('./test-processor-runtime');
const {THREE, setup, add, link, record, inventory, vars, advance} = h;
function belt(f, object) { return record(f, object).components.conveyor; }
function config(f, object, type) { return f.document.getBehaviors(object).find(value => value.type === type); }
function change(f, object, type, values) { f.document.setBehaviors(object, [Object.assign({}, config(f, object, type), values)]); }
function addBelt(f, values = {}, position) { return add(f, 'conveyor', Object.assign({autoSpawn: true, spawnInterval: .1, maxPackages: 100}, values), position); }
function external(f, object) {
  const b = belt(f, object), id = object.userData.editorId;
  assert.equal(vars(f, object).externalSupply, true); assert.equal(vars(f, object).internalSupplyActive, false); assert.equal(vars(f, object).supplyMode, 'external');
  assert.equal(f.runtime.insertProduct(id), false); assert.equal(f.runtime.command(id, 'insertBox'), false); assert.equal(f.runtime.spawn(record(f, object), b), false);
  assert.equal(b.pendingInsert, 0, 'A source-connected machine cannot reserve extra fallback products.');
}

async function run() {
  const supplied = setup(), source = add(supplied, 'source', {initialCount: 2, capacity: 2, outputInterval: .1}), receiving = addBelt(supplied);
  link(supplied, source, receiving); const before = JSON.stringify(await supplied.document.serialize()); supplied.runtime.start('hall'); external(supplied, receiving);
  advance(supplied, 1); assert.equal(belt(supplied, receiving).entryCount, 2); assert.equal(vars(supplied, source).delivered, 2);
  advance(supplied, 1); assert.equal(belt(supplied, receiving).entryCount, 2, 'An empty source never triggers invisible replacement generation on its conveyor.');
  belt(supplied, receiving).pendingInsert = 1; advance(supplied, .2);
  assert.equal(belt(supplied, receiving).entryCount, 2); assert.equal(belt(supplied, receiving).pendingInsert, 1, 'An existing fallback request waits under external ownership instead of creating or silently discarding a product.');
  assert.equal(vars(supplied, receiving).autoSpawn, true, 'External supply overrides effective operation without changing the saved fallback option.');
  supplied.runtime.stop(); assert.equal(JSON.stringify(await supplied.document.serialize()), before);

  for (const values of [{running: false}, {paused: true}, {enabled: false}, {running: true, autoGenerate: false, initialCount: 0}]) {
    const f = setup(), upstream = add(f, 'source', Object.assign({initialCount: 0}, values)), downstream = addBelt(f);
    link(f, upstream, downstream); f.runtime.start('hall'); external(f, downstream); advance(f, .5);
    assert.equal(belt(f, downstream).entryCount, 0, 'Stopped, paused, disabled and empty configured sources retain ownership of their receiving conveyor.');
    f.runtime.stop();
  }

  const misaligned = setup(), farSource = add(misaligned, 'source', {initialCount: 1}), farBelt = addBelt(misaligned, {}, [10, 1.02, 0]);
  link(misaligned, farSource, farBelt, false); misaligned.runtime.start('hall'); external(misaligned, farBelt); advance(misaligned, .5);
  assert.equal(belt(misaligned, farBelt).entryCount, 0, 'A configured connection waits for alignment instead of silently generating substitute cartons.'); misaligned.runtime.stop();

  for (const kind of ['source', 'processor']) {
    const f = setup(), upstream = add(f, kind, kind === 'source' ? {autoGenerate: false, initialCount: 0} : {powered: false, running: false}), downstream = addBelt(f);
    link(f, upstream, downstream); f.runtime.start('hall'); external(f, downstream); advance(f, .5); assert.equal(belt(f, downstream).entryCount, 0);
    f.runtime.stop();
  }

  const chain = setup(), head = addBelt(chain, {withPanel: true}), middle = addBelt(chain), end = addBelt(chain, {withPanel: true});
  link(chain, head, middle); link(chain, middle, end); chain.runtime.start('hall'); external(chain, middle); external(chain, end);
  assert.equal(vars(chain, head).externalSupply, false); assert.equal(vars(chain, head).internalSupplyActive, true); assert.equal(vars(chain, head).supplyMode, 'internal');
  const scopedHead = chain.runtime.getPanelSnapshot(head.userData.editorId, 'line').variables;
  assert.equal(scopedHead.externalSupply, false); assert.equal(scopedHead.internalSupplyActive, true, 'A line-scoped panel reports the anchor generator rather than disabling it because downstream modules have an incoming conveyor.');
  assert.equal(chain.runtime.getPanelSnapshot(middle.userData.editorId, 'line').variables.externalSupply, true);
  assert(chain.runtime.insertProduct(head.userData.editorId)); advance(chain, .05); assert.equal(belt(chain, head).entryCount, 1);
  change(chain, head, 'conveyor', {autoSpawn: false}); // Document edits become effective on the next play, without losing the saved option.
  chain.runtime.stop(); chain.runtime.start('hall'); advance(chain, 1.8);
  assert.equal(belt(chain, head).entryCount, 0); assert.equal(belt(chain, middle).entryCount, 0); assert.equal(belt(chain, end).entryCount, 0);
  assert(chain.runtime.insertProduct(head.userData.editorId)); advance(chain, 3.5);
  assert.equal(belt(chain, head).entryCount, 1); assert.equal(belt(chain, middle).entryCount, 1); assert.equal(belt(chain, end).entryCount, 1, 'Connected intermediate conveyors transport only the load supplied upstream.');
  chain.runtime.stop();

  const standalone = setup(), independent = addBelt(standalone, {autoSpawn: false}); standalone.runtime.start('hall');
  assert.equal(vars(standalone, independent).supplyMode, 'manual'); assert(standalone.runtime.insertProduct(independent.userData.editorId)); advance(standalone, .05);
  assert.equal(belt(standalone, independent).entryCount, 1); standalone.runtime.setVariable(independent.userData.editorId, 'autoSpawn', true);
  assert.equal(vars(standalone, independent).supplyMode, 'internal'); advance(standalone, .5); assert(belt(standalone, independent).entryCount > 1); standalone.runtime.stop();

  const reload = setup(), reloadSource = add(reload, 'source', {autoGenerate: false}), reloadBelt = addBelt(reload);
  link(reload, reloadSource, reloadBelt); reload.runtime.start('hall'); external(reload, reloadBelt); reload.runtime.stop();
  change(reload, reloadSource, 'source', {outputId: ''}); reload.runtime.start('hall');
  assert.equal(vars(reload, reloadBelt).externalSupply, false); assert.equal(vars(reload, reloadBelt).internalSupplyActive, true); advance(reload, .2); assert(belt(reload, reloadBelt).entryCount > 0); reload.runtime.stop();

  const branch = setup(), tee = addBelt(branch, {layout: 'tee', junctionMode: 'split', autoSpawn: false}), branchBelt = addBelt(branch, {}, [20, 1.02, 0]);
  change(branch, tee, 'conveyor', {branchId: branchBelt.userData.editorId}); branch.runtime.start('hall'); external(branch, branchBelt); branch.runtime.stop();
  change(branch, tee, 'conveyor', {layout: 'straight'}); branch.runtime.start('hall'); assert.equal(vars(branch, branchBelt).externalSupply, false); branch.runtime.stop();

  const invalid = setup(), self = addBelt(invalid), danglingSource = add(invalid, 'source', {outputId: 'missing-equipment'});
  change(invalid, self, 'conveyor', {outputId: self.userData.editorId}); invalid.runtime.start('hall');
  assert.equal(vars(invalid, self).externalSupply, false, 'A self-link or unrelated dangling reference cannot disable the fallback generator.'); invalid.runtime.stop();

  const foreign = setup(), local = addBelt(foreign), otherRoot = new THREE.Group(); foreign.scene.add(otherRoot); foreign.document.registerRoom('other', otherRoot);
  const remote = foreign.document.addPrefab('other', 'source'), remoteConfig = config(foreign, remote, 'source');
  foreign.document.setBehaviors(remote, [Object.assign({}, remoteConfig, {outputId: local.userData.editorId})]); otherRoot.visible = false;
  foreign.runtime.start('hall'); assert.equal(vars(foreign, local).externalSupply, false, 'An inactive source from another room cannot claim supply ownership in this room.'); foreign.runtime.stop();

  console.log('Conveyor supply: external ownership, empty/stopped/disabled/misaligned sources, queues/processors/chains, scoped panels, fallback restoration and exact persistence passed.');
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = {external, addBelt, config, change};
