// Independent migration/graph audit; real Three graphs, no browser or user files.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {THREE, behaviorSchema, setup, add, link, record, vars, advance} = require('./test-processor-runtime.js');
const {external, addBelt, config, change} = require('./test-conveyor-supply.js');
const ConveyorAssembly = new Function('THREE', 'conveyorLayout', fs.readFileSync(path.join(__dirname, '../src/editor/ConveyorAssembly.js'), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export default class ConveyorAssembly', 'return class ConveyorAssembly'))(THREE, behaviorSchema.conveyorLayout);
const clone = value => JSON.parse(JSON.stringify(value));
function oldNode(name, behaviors, color) {
  return {name, position: [-2.55, -0.18, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1], visible: true, color: null,
    behaviors, visual: {type: 'box', color}, interaction: {type: 'message', text: 'Legacy'} };
}
function noBuiltInSupply(f, object) {
  const content = object.children[0];
  [7, 8].forEach(index => {
    const anchor = content.children[index]; assert(anchor && anchor.userData.industrialRetiredSupply);
    assert.equal(anchor.visible, false); assert.equal(anchor.children.length, 0);
    assert.equal(anchor.userData.editorPrefabNode, undefined); assert.equal(anchor.userData.editorPrefabKey, undefined);
    assert.equal(anchor.userData.editorDefaultBehaviors, undefined);
  });
  const nodes = f.document.additions.get(object.userData.editorId).nodes;
  assert(!Array.from(nodes.keys()).some(key => /^[78](?:\.|$)/.test(key)), 'Retired supply anchors must not regain editable actor identities.');
}
async function run() {
  {
    const f = setup(), original = add(f, 'conveyor', {autoSpawn: false}), target = addBelt(f, {}, [20, 1.02, 0]);
    const fresh = await f.document.serialize(), legacy = clone(fresh), entry = legacy.rooms.hall.additions.find(row => row.id === original.userData.editorId);
    const legacySource = Object.assign(behaviorSchema.defaultBehavior('source'), {outputId: target.userData.editorId, initialCount: 1, delivery: 'automatic'});
    entry.nodes['7'] = oldNode('Caja manual antigua', [{type: 'product'}, legacySource], '#a12b34');
    entry.nodes['7.0'] = oldNode('Modelo reemplazado de la caja', [{type: 'grab'}], '#b21a43');
    entry.nodes['8'] = oldNode('Mesa antigua', [], '#c31254');
    entry.nodes['8.0'] = oldNode('Modelo reemplazado de la mesa', [], '#d42365');
    const frozenInput = JSON.stringify(legacy), instantiate = f.document._instantiate.bind(f.document), requestedVisuals = [];
    f.document._instantiate = async descriptor => {
      if (descriptor.type === 'box' && ['#a12b34', '#b21a43', '#c31254', '#d42365'].includes(descriptor.color)) requestedVisuals.push(descriptor);
      return instantiate(descriptor);
    };
    await f.document.load(legacy);
    assert.equal(JSON.stringify(legacy), frozenInput, 'Migrating a legacy scene must not mutate the caller JSON.');
    assert.equal(requestedVisuals.length, 0, 'Retired replacement models are removed before visual preparation or loading.');
    const live = f.document.getObject(original.userData.editorId), receiving = f.document.getObject(target.userData.editorId);
    noBuiltInSupply(f, live); assert.deepEqual(await f.document.serialize(), fresh);
    const assembly = new ConveyorAssembly({document: f.document, roomId: 'hall', hooks: {renderScene: f.scene}});
    assert.equal(assembly.records().length, 2, 'A retired box carrying an old source component cannot become a phantom machine or connector.');
    assert(assembly.worldPort(live, 'input')); assert(assembly.worldPort(live, 'output')); assembly.clear();
    const clipboard = f.document.captureObject(live); clipboard.record.nodes = clone(entry.nodes);
    clipboard.sources.push(['7', live.userData.editorId + '/7']);
    const copy = await f.document.pasteObject(clipboard, 'hall', 5);
    noBuiltInSupply(f, copy); assert.equal(requestedVisuals.length, 0, 'Pasting a clipboard made by an older editor must not prepare retired models either.');
    const buttons = Array.from(f.document.additions.get(copy.userData.editorId).nodes.values())
      .map(node => config(f, node, 'control')).filter(Boolean);
    assert.equal(buttons.length, 9); buttons.forEach(button => assert.equal(button.targetId, copy.userData.editorId));
    f.runtime.start('hall');
    assert.equal(vars(f, receiving).externalSupply, false, 'A migrated legacy box cannot suppress a real conveyor generator with a stale source link.');
    assert.equal(vars(f, receiving).internalSupplyActive, true); assert.equal(f.runtime.products.size, 0);
    advance(f, 0.05); assert.equal(record(f, receiving).components.conveyor.entryCount, 1);
    f.runtime.stop(); noBuiltInSupply(f, live); noBuiltInSupply(f, copy);
    const beforeReject = await f.document.serialize(), excessive = clone(beforeReject);
    excessive.rooms.hall.additions[0].nodes = {};
    for (let index = 0; index <= 10000; index++) excessive.rooms.hall.additions[0].nodes['7.' + index] = {};
    await assert.rejects(f.document.load(excessive), /demasiados/i);
    assert.deepEqual(await f.document.serialize(), beforeReject, 'Retired-node migration still enforces the project object budget and leaves the live scene intact.');
  }
  {
    const f = setup(), a = addBelt(f), b = addBelt(f, {}, [20, 1.02, 0]);
    link(f, a, b, false); link(f, b, a, false);
    f.runtime.start('hall'); external(f, a); external(f, b); advance(f, 0.5);
    assert.equal(record(f, a).components.conveyor.entryCount, 0); assert.equal(record(f, b).components.conveyor.entryCount, 0);
    assert.equal(f.runtime.products.size, 0, 'A closed connected circulation loop never manufactures a fallback box to seed itself.');
    f.runtime.stop();
    change(f, a, 'conveyor', {enabled: false}); f.runtime.start('hall'); external(f, b); advance(f, 0.2);
    assert.equal(record(f, b).components.conveyor.entryCount, 0, 'Disabling an upstream conveyor does not silently turn its successor into a generator.');
    f.runtime.stop();
  }
  {
    const f = setup(), source = add(f, 'source', {initialCount: 1}), receiving = addBelt(f, {}, [15, 1.02, 0]);
    link(f, source, receiving, false); source.visible = false;
    f.runtime.start('hall'); external(f, receiving); advance(f, 0.3);
    assert.equal(f.runtime.products.size, 0); assert.equal(record(f, receiving).components.conveyor.entryCount, 0);
    f.runtime.stop();
  }
  {
    const f = setup(), tee = addBelt(f, {layout: 'tee', junctionMode: 'merge', autoSpawn: false}), receiving = addBelt(f, {}, [20, 1.02, 0]);
    change(f, tee, 'conveyor', {branchId: receiving.userData.editorId}); f.runtime.start('hall');
    assert.equal(vars(f, receiving).externalSupply, false, 'The incoming branch of a merge T is not an output supply edge.');
    assert.equal(vars(f, receiving).internalSupplyActive, true); f.runtime.stop();
    change(f, tee, 'conveyor', {junctionMode: 'split'}); f.runtime.start('hall'); external(f, receiving); advance(f, 0.2);
    assert.equal(record(f, receiving).components.conveyor.entryCount, 0); f.runtime.stop();
  }
  {
    const f = setup(), conveyor = add(f, 'conveyor'), source = add(f, 'source', {initialCount: 1}, [10, 1.02, 0]);
    const queue = f.document.addPrefab('hall', 'source', 'queue'); f.document.setTransform(queue, {position: [15, 1.02, 0]});
    f.document.setBehaviors(queue, [Object.assign({}, config(f, queue, 'source'), {initialCount: 1})]);
    const process = add(f, 'processor', {}, [20, 1.02, 0]); noBuiltInSupply(f, conveyor);
    [source, queue, process].forEach(object => {
      let meshes = 0; object.traverse(node => { if (node.isMesh) meshes++; });
      assert(meshes > 0, 'Removing conveyor startup supply must preserve independent Source, Queue and Processor models.');
    });
    f.runtime.start('hall'); assert.equal(f.runtime.products.size, 2, 'Independent sources and queues still expose their configured first loads.');
    assert.equal(record(f, conveyor).components.conveyor.entryCount, 0); f.runtime.stop();
  }
  console.log('Conveyor supply independent audit: old scene/clipboard visual stripping, no phantom sources, migration budgets, disabled/hidden/cyclic supply graphs, merge/split T direction and independent source equipment passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
