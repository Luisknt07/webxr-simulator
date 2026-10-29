const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const schema = require('../../modules/logistica-industrial/contracts/behaviors');
const {validateDocument} = require('../../apps/api/server/validation');
const prefix = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-industrial-cedi-scenarios.js"), 'test-industrial-lab-lines.js')), 'utf8');
const helpers = new Function('require', '__dirname', prefix.slice(0, prefix.indexOf('\nasync function run()')) + '\nreturn {harness,ConveyorAssembly,releaseGeometry};')(require, __dirname);
const source = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-industrial-cedi-scenarios.js"), '../src/editor/IndustrialCediScenarios.js')), 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, '');
const buildIndustrialCediScenario = new Function('THREE', 'ConveyorAssembly', require('../support/load-industrial-continuous')() + source + '\nreturn buildIndustrialCediScenario;')(THREE, helpers.ConveyorAssembly);
const id = object => object.userData.editorId;
function visible(object) { for (let node = object; node; node = node.parent) if (!node.visible) return false; return true; }
const rounded = value => JSON.parse(JSON.stringify(value, (key, item) => typeof item === 'number' ? Number(item.toFixed(9)) : item));

async function scenario(kind) {
  const f = helpers.harness.setup(), depth = f.document.undoStack.length;
  const graph = buildIndustrialCediScenario(f.document, 'hall', {kind, scene: f.scene}), expected = 96;
  assert(graph.objects.length >= 35 && graph.objects.length <= 60); assert.equal(graph.expectedUnits, expected); assert.equal(graph.expectedLoads, 68);
  assert.equal(graph.controllers.length, graph.lines.length); assert.equal(graph.lines.filter(line => line.mode === 'manual').length, 2);
  assert.equal(graph.lines.filter(line => line.mode === 'automatic').length, kind === 'sorting' ? 2 : 3);
  assert.equal(graph.receivers.length, graph.expectedReceiverUnits.length);
  assert(graph.bounds.width < 100 && graph.bounds.depth < 140 && graph.bounds.min[1] >= -.00001, 'The separate networks fit the warehouse and their conveyor supports reach the floor.');
  graph.lines.forEach(line => {
    assert.equal(line.expectedUnits, line.sourceExpectations.reduce((sum, value) => sum + value.units, 0));
    if (line.mode === 'manual') line.sources.forEach(object => { const cfg = f.document.getBehaviors(object).find(value => value.type === 'source'); assert.equal(cfg.autoGenerate, false); assert.equal(cfg.initialCount, 0); });
  });
  assert.equal(f.document.undoStack.length, depth + 1);
  const assembly = new helpers.ConveyorAssembly({document: f.document, roomId: 'hall', root: f.root, ctx: f.ctx, hooks: {renderScene: f.scene}, assemblyMessage() {}});
  graph.links.forEach(link => {
    const from = f.document.getObject(link.source), to = f.document.getObject(link.target), a = assembly.worldPort(from, link.sourcePort), b = assembly.worldPort(to, link.targetPort);
    assert(a.position.distanceTo(b.position) < 1e-6); assert(a.tangent.dot(b.tangent) > .999999);
    assert(assembly.assessConnection(from, link.sourcePort, to, link.targetPort).ready, 'Every CEDI path is a persisted metric connection through compatible real ports.');
  }); assembly.clear();
  const displays = [];
  graph.objects.forEach(object => object.traverse(node => { if (node.userData.industrialDisplay && visible(node)) displays.push(node); }));
  assert.equal(displays.length, graph.lines.length, 'Each independent network has one visible PLC rather than a cabinet on every short segment.');
  if (kind === 'packing') {
    const corner = graph.objects.find(object => f.document.getBehaviors(object).some(value => value.equipmentId === 'conveyor.popup-belt'));
    const config = f.document.getBehaviors(corner).find(value => value.type === 'conveyor');
    const receiver = f.document.getObject(config.branchId), target = f.document.getBehaviors(receiver).find(value => value.type === 'conveyor');
    assert.equal(config.length, target.width, 'The packing L has a square lift bed flush with its perpendicular receiver.');
  }
  graph.controllers.forEach(controller => controller.traverse(node => f.document.getBehaviors(node).filter(value => value.type === 'control').forEach(control => { assert.equal(control.targetId, id(controller)); assert.equal(control.scope, 'line'); })));
  const before = validateDocument(await f.document.serialize(), value => value), reopened = helpers.harness.setup(); await reopened.document.load(before);
  assert.deepEqual(rounded(await reopened.document.serialize()), rounded(before), 'All independently configurable equipment, recipes, controls and links survive validation and reopening.'); helpers.releaseGeometry(reopened);
  const generated = new Map(), sourceIds = new Set(graph.sources.map(id)), rememberUnits = () => f.runtime.sourceRuntime.entries.forEach(entry => {
    if (sourceIds.has(entry.originId) && Array.from(sourceIds).some(sourceId => entry.id.startsWith(sourceId + ':')) && !entry.members) generated.set(entry.id, entry);
  });
  f.ctx.collisionWorld.setRoom('hall'); f.runtime.start('hall'); rememberUnits();
  const outputs = () => graph.receivers.map(object => f.runtime.records.get(id(object)).variables);
  for (let frame = 0; frame < 6000 && outputs().reduce((sum, value) => sum + value.receivedUnits, 0) < expected; frame++) {
    f.ctx.collisionWorld.beginFrame();
    try { f.scene.updateMatrixWorld(true); f.runtime.execute(.1); rememberUnits(); } finally { f.ctx.collisionWorld.endFrame(); }
  }
  const final = outputs(), diagnostics = () => Array.from(f.runtime.records.values()).filter(record => f.runtime.machineComponent(record)).map(record => [record.object.name, Object.fromEntries(['generated','delivered','received','receivedUnits','inFlight','entryCount','exitCount','blocked','mechanismPhase'].map(key => [key,record.variables[key]]))]);
  assert.equal(final.reduce((sum, state) => sum + state.receivedUnits, 0), expected, kind + ' routes every finite Source unit under real CollisionWorld checks: ' + JSON.stringify(diagnostics()));
  assert.deepEqual(final.map(state => state.receivedUnits), graph.expectedReceiverUnits); assert.deepEqual(final.map(state => state.received), graph.expectedReceiverLoads);
  graph.receivers.forEach((object, index) => { const cfg = f.document.getBehaviors(object).find(value => value.type === 'palletQueue'), perPallet = cfg.acceptsPallets ? 1 : cfg.columns * cfg.rows * cfg.layers; assert.equal(final[index].completePallets, Math.floor(graph.expectedReceiverLoads[index] / perPallet)); });
  assert.equal(generated.size, graph.lines.flatMap(line => line.sourceExpectations).reduce((sum, value) => sum + value.loads, 0));
  const entries = graph.receivers.flatMap(object => f.runtime.records.get(id(object)).components.palletQueue.queue);
  assert.equal(new Set(entries.map(entry => entry.id)).size, graph.expectedLoads);
  const multiset = values => {
    const counts = new Map();
    values.forEach(entry => {
      const spec = entry.spec, fingerprint = JSON.stringify([entry.originId, spec.id, spec.type, spec.width, spec.height, spec.depth, spec.color, spec.quality, spec.defect, spec.mass, spec.base]);
      counts.set(fingerprint, (counts.get(fingerprint) || 0) + entry.units);
    }); return Array.from(counts).sort((a, b) => a[0].localeCompare(b[0]));
  };
  assert.deepEqual(multiset(entries), multiset(Array.from(generated.values())), 'Every original Source/SKU/color/quality/dimension/mass/base unit is conserved exactly once across the complete network.');
  entries.forEach(entry => {
    assert(sourceIds.has(entry.originId) && entry.lineage.includes(entry.originId) && graph.receivers.some(object => entry.lineage.includes(id(object))), 'Every final load retains its source and complete ownership provenance.');
    if (kind === 'sorting') assert.strictEqual(entry, generated.get(entry.id), 'Ordinary inspections and transport preserve the original entry identity.');
  });
  if (kind === 'packing') {
    const processors = graph.objects.filter(object => f.document.getBehaviors(object).some(config => config.type === 'processor' && ['combiner', 'separator'].includes(config.mode)));
    entries.filter(entry => entry.originId === id(graph.lines[0].sources[0])).forEach(entry => processors.forEach(object => assert(entry.lineage.includes(id(object)), 'New separated load IDs retain both combination and separation provenance.')));
    const single = f.runtime.records.get(id(graph.lines[0].receivers[0])).components.palletQueue.queue;
    assert(single.every(entry => entry.units === 1 && entry.spec.id === 'packing-single'), 'The quantity rule sends individual Source loads down the other physical path.');
  } else {
    const expectedSkus = [['surface-case'], ['damaged-case'], ['priority-sku'], ['blue-case'], ['crate-case'], ['wide-case', 'tall-case', 'long-case']];
    expectedSkus.forEach((skus, index) => {
      const inventory = f.runtime.records.get(id(graph.lines[0].receivers[index])).components.palletQueue.queue;
      assert.deepEqual(Array.from(new Set(inventory.map(entry => entry.spec.id))).sort(), skus.slice().sort(), 'Each declared inspection rule is exercised by its intended product profile.');
      skus.forEach(sku => assert.equal(inventory.filter(entry => entry.spec.id === sku).length, 8, 'Eight reproducible units exercise ' + sku));
    });
  }
  const items = entries.map(entry => entry.product.item);
  for (let a = 0; a < items.length; a++) for (let b = a + 1; b < items.length; b++) assert(!items[a].box.clone().expandByScalar(-.001).intersectsBox(items[b].box.clone().expandByScalar(-.001)), 'Final stored boxes never overlap.');
  assert(!f.runtime.events.some(event => event.type === 'configuration-warning'), 'The complete network has no incompatible load or invalid equipment warning.');
  graph.lines.forEach(line => assert.equal(f.runtime.getPanelSnapshot(id(line.controller), 'line').memberIds.length, line.memberIds.length));
  const elapsed = f.runtime.time;
  const advance = seconds => { for (let tick = 0; tick < seconds * 10; tick++) { f.ctx.collisionWorld.beginFrame(); try { f.scene.updateMatrixWorld(true); f.runtime.execute(.1); } finally { f.ctx.collisionWorld.endFrame(); } } };
  const manualTable = graph.lines.find(line => line.id === 'manual-loading-table'), manualStation = graph.lines.find(line => line.id === 'manual-manual-station');
  assert(f.runtime.command(id(manualTable.source), 'generate')); advance(3);
  const table = manualTable.objects.find(object => f.runtime.records.get(id(object))?.components.conveyor), tableBelt = f.runtime.records.get(id(table)).components.conveyor;
  assert.equal(tableBelt.config.drive, 'manual'); assert.equal(tableBelt.entryCount, 0, 'The free loading table cannot acquire a hidden automatic motor.');
  assert.equal(f.runtime.records.get(id(manualTable.source)).components.source.queue.length, 1, 'Manual generation exposes a real load ready for grip placement.');
  assert(f.runtime.command(id(manualStation.source), 'generate')); advance(5);
  const station = manualStation.objects.find(object => f.runtime.records.get(id(object))?.components.conveyor), stationBelt = f.runtime.records.get(id(station)).components.conveyor;
  assert.equal(stationBelt.mechanismPhase, 'waitingOperator'); assert.equal(f.runtime.records.get(id(manualStation.receiver)).variables.received, 0);
  f.runtime.setVariable(id(station), 'operatorAvailable', true); advance(1); assert.equal(stationBelt.mechanismPhase, 'waitingManualAction');
  assert(f.runtime.command(id(station), 'dispatch')); advance(8);
  assert.equal(f.runtime.records.get(id(manualStation.receiver)).variables.received, 1, 'The real operator action completes one manual station cycle.');
  f.runtime.stop(); assert.deepEqual(rounded(await f.document.serialize()), rounded(before), 'Stopping restores every authored machine pose and recipe.');
  console.log('CEDI scenario:', kind, '—', graph.objects.length, 'machines,', graph.lines.length, 'independent networks,', expected, 'traceable units in', elapsed.toFixed(1), 's, real collisions and persisted controls.'); helpers.releaseGeometry(f);
  return graph.coverage;
}

async function run() {
  const f = helpers.harness.setup(), before = await f.document.serialize();
  assert.throws(() => buildIndustrialCediScenario(f.document, 'hall', {kind: 'unknown'}), /clasificación|empaque/);
  let count = 0; const add = f.document.addPrefab.bind(f.document); f.document.addPrefab = (...args) => { if (++count === 4) throw new Error('Insertion failed'); return add(...args); };
  assert.throws(() => buildIndustrialCediScenario(f.document, 'hall', {kind: 'sorting', scene: f.scene}), /Insertion failed/);
  assert.deepEqual(await f.document.serialize(), before, 'A partially constructed CEDI is rolled back as one authoring action.'); helpers.releaseGeometry(f);
  const kinds = process.argv.slice(2).length ? process.argv.slice(2) : ['sorting', 'packing'], coverage = [];
  for (const kind of kinds) coverage.push(await scenario(kind));
  if (kinds.includes('sorting') && kinds.includes('packing')) {
    assert.deepEqual(Array.from(new Set(coverage.flatMap(value => value.variants))).sort(), schema.conveyorEquipment.listEquipment({readyOnly: true}).map(value => value.id).sort(), 'The two complete levels exercise all 25 real catalogue variants.');
    assert.deepEqual(Array.from(new Set(coverage.flatMap(value => value.fields))).sort(), schema.conveyorRouting.fields.map(value => value.value).sort(), 'Every supported classification attribute has a physical example.');
    assert.deepEqual(Array.from(new Set(coverage.flatMap(value => value.modes))).sort(), ['alternate', 'percentage', 'rules']);
    assert.deepEqual(Array.from(new Set(coverage.flatMap(value => value.productTypes))).sort(), ['bottle', 'box', 'crate', 'drum']);
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
