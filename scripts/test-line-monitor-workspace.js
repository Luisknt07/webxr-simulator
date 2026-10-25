'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const original = fs.readFileSync(path.join(__dirname, 'test-line-monitor.js'), 'utf8');
const {h, Monitor, drawing, step, click} = new Function('require', '__dirname', original.slice(0, original.indexOf('\nasync function run()')) + '\nreturn {h,Monitor,drawing,step,click};')(require, __dirname);
const id = object => object.userData.editorId;
const THREE = require('three'), schema = require('../shared/behaviors');
const Assembly = new Function('THREE', 'conveyorLayout', fs.readFileSync(path.join(__dirname, '../src/editor/ConveyorAssembly.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class ConveyorAssembly', 'return class ConveyorAssembly'))(THREE, schema.conveyorLayout);
const previewHelpers = new Function('THREE', 'behaviorSchema', fs.readFileSync(path.join(__dirname, '../src/editor/LineMonitorSystem.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class LineMonitorSystem', 'class LineMonitorSystem') + '\nreturn {previewMeshes,previewModel};')(THREE, schema);

function cataloguePreviewQuality() {
  const f = h.setup();
  for (const definition of schema.conveyorEquipment.listEquipment({readyOnly: true})) {
    const object = f.document.addPrefab('hall', 'conveyor', definition.variant), preview = previewHelpers.previewModel(previewHelpers.previewMeshes(object), []);
    assert(preview.triangleCount <= 10000 && preview.triangleCount > preview.sourceTriangles * .45,
      'The actual catalogue preview retains complete front-facing surfaces instead of deleting alternating triangles: ' + definition.variant);
  }
  f.visuals.dispose();
}

async function inventoryRetirement() {
  const f = h.setup(); [f.head, f.tail, f.unrelated, ...f.cartons].forEach(object => f.document.remove(object));
  const source = f.document.addPrefab('hall', 'source'), stock = f.document.addPrefab('hall', 'palletQueue');
  f.document.setBehaviors(source, f.document.getBehaviors(source).map(value => value.type === 'source' ? Object.assign({}, value, {withPanel: false, autoGenerate: false, initialCount: 1, outputId: id(stock), delivery: 'automatic', outputInterval: .1}) : value));
  f.document.setBehaviors(stock, f.document.getBehaviors(stock).map(value => value.type === 'palletQueue' ? Object.assign({}, value, {withPanel: false, palletCapacity: 1, columns: 1, rows: 1, layers: 1, capacity: 1, autoRelease: false}) : value));
  f.document.setTransform(source, {position: [-4, 1.02, -4]}); const assembly = new Assembly({document: f.document, root: f.root, roomId: 'hall'}); assembly.align(source, 'output', stock, 'input');
  f.board = f.document.addPrimitive('hall', 'box'); f.document.setTransform(f.board, {position: [0, 2.2, 4], scale: [3.6, 2.025, .12]});
  f.document.setBehaviors(f.board, [{type: 'lineMonitor', targetId: id(source), scope: 'line'}]); f.ctx.document = {createElement: drawing};
  const authored = JSON.stringify(await f.document.serialize()); f.monitor = new Monitor(f.ctx, f.document, f.runtime); f.runtime.start('hall'); step(f, 1); f.entry = f.monitor.entries.get(f.board);
  const vars = () => f.runtime.records.get(id(stock)).variables;
  assert.equal(vars().queuedUnits, 1); assert.equal(vars().completePallets, 1); assert.equal(f.entry.model.analytics.summary.exitUnits, 1);
  click(f, 'control'); click(f, 'machine-next'); assert.equal(f.entry.selectedId, id(stock));
  assert(f.entry.regions.some(region => region.key === 'equipment-action-dispatchPallet' && region.targetId === id(stock)));
  click(f, 'equipment-action-dispatchPallet', f.left);
  assert.equal(vars().queuedUnits, 0); assert.equal(vars().receivedUnits, 1); assert.equal(vars().deliveredUnits, 1); assert.equal(vars().dispatchedPallets, 1);
  assert(!f.entry.regions.some(region => region.key === 'equipment-action-dispatchPallet'), 'A retired bay cannot offer another complete-pallet withdrawal.');
  click(f, 'diagram'); assert.equal(f.entry.model.analytics.summary.exitUnits, 1, 'Removing a pallet never resets cumulative boundary production to an empty-inventory zero.');
  assert(f.entry.canvas.text.some(text => text.includes('Stock actual 0 u') && text.includes('retiradas 1')));
  click(f, 'equipment'); click(f, 'equipment-1');
  assert(f.entry.canvas.text.includes('Inventario actual') && f.entry.canvas.text.includes('Retiradas de stock'));
  assert(f.entry.canvas.text.some(text => text.includes('1 u · 1 estibas completas')) && f.entry.canvas.text.some(text => text.includes('0 unidades en 0 cargas')),
    'Equipment contents distinguishes genuinely empty current inventory from completed dispatch history.');
  f.visuals.dispose(); f.runtime.stop(); f.monitor.dispose(); assembly.clear(); assert.equal(JSON.stringify(await f.document.serialize()), authored);
}

async function run() {
  const f = h.setup('roller-curve'), source = f.document.addPrefab('hall', 'source'), processor = f.document.addPrefab('hall', 'processor'), stock = f.document.addPrefab('hall', 'palletQueue');
  const machines = [f.head, f.tail, source, processor, stock];
  machines.forEach((object, index) => {
    const type = ['source', 'processor', 'palletQueue'].find(type => f.document.getBehaviors(object).some(value => value.type === type)) || 'conveyor';
    f.document.setBehaviors(object, f.document.getBehaviors(object).map(value => value.type === type ? Object.assign({}, value, {outputId: machines[index + 1] ? id(machines[index + 1]) : ''}, type === 'source' ? {autoGenerate: false, initialCount: 0} : {}) : value));
  });
  f.board = f.document.addPrimitive('hall', 'box'); f.document.setTransform(f.board, {position: [0, 2.2, 4], scale: [3.6, 2.025, .12]});
  f.document.setBehaviors(f.board, [{type: 'lineMonitor', targetId: id(f.head), scope: 'line', title: 'Monitor compuesto', refreshHz: 4}]);
  f.ctx.document = {createElement: drawing};
  let rendererCalls = 0; f.ctx.renderer = {xr: {enabled: true}, render() { rendererCalls++; throw new Error('A canvas preview must not render another GPU scene.'); }};
  const authored = JSON.stringify(await f.document.serialize());
  f.monitor = new Monitor(f.ctx, f.document, f.runtime); f.runtime.start('hall'); step(f); f.entry = f.monitor.entries.get(f.board);
  assert.equal(f.entry.page, 'diagram'); assert(f.entry.model.paths.length > 0 && f.entry.model.analytics);
  assert(f.entry.canvas.text.includes('Flujo (unidades / min)') && f.entry.canvas.text.includes('TRABAJO ÚTIL') && f.entry.canvas.text.includes('SALIDAS (ACUM.)'), 'The default screen shows the live physical plan, KPIs and a real trend together.');
  assert(!f.entry.regions.some(region => region.action), 'The overview has no operation row occupying its diagram/chart space.');
  assert.equal(f.monitor.stats.previewBuilds, 0, 'Equipment previews do no work while their page is hidden.');
  const stats = JSON.stringify(f.runtime.getAnalyticsSnapshot(id(f.head), 'line')); f.monitor.invalidate(); f.monitor.sync('hall', 0);
  assert.equal(JSON.stringify(f.runtime.getAnalyticsSnapshot(id(f.head), 'line')), stats, 'A combined diagram/chart draw cannot advance or rewrite analytics.');

  click(f, 'control');
  const operations = f.entry.regions.filter(region => region.action);
  assert(operations.some(region => region.key === 'emergency') && operations.some(region => region.key === 'resetEmergency'));
  assert(operations.every(region => region.height >= 46 && region.width >= 200), 'Dedicated operation buttons have generous, separate VR ray targets.');
  click(f, 'equipment');
  assert(!f.entry.regions.some(region => region.action));
  assert(f.entry.preview && f.entry.preview.meshCount > 0 && f.entry.preview.triangleCount > 100 && f.entry.preview.triangleCount <= 10000,
    'The equipment view projects real mesh triangles within the explicit CPU budget.');
  assert(f.entry.previewLabels.length > 0 && f.entry.previewLabels.every(label => label.height >= 36));
  assert(f.entry.preview.parts.some(part => /bastidor|superficie|rodillos/i.test(part.name)), 'Part annotations come from the selected physical model.');
  const initial = f.entry.preview, firstCache = Array.from(f.monitor.previewCache.values())[0], builds = f.monitor.stats.previewBuilds;
  f.monitor.invalidate(); f.monitor.sync('hall', 0);
  assert.equal(f.monitor.stats.previewBuilds, builds, 'An unchanged mesh reuses its projected canvas rather than rebuilding it every telemetry draw.');
  const label = f.entry.regions.find(region => region.part !== undefined); click(f, label.key);
  assert.equal(f.entry.previewPart, label.part); assert.equal(f.monitor.stats.previewBuilds, builds, 'Part emphasis reuses the same geometry cache.');
  click(f, 'preview-turn'); assert.equal(f.entry.previewTurn, 1);
  assert.notDeepEqual(f.entry.preview.faces[0].points, initial.faces[0].points, 'Rotating the preview reveals another side without rotating the real equipment.');
  assert.equal(f.head.rotation.y, 0);

  const types = new Set(['conveyor']);
  for (let index = 0; index < machines.length - 1; index++) {
    click(f, 'machine-next');
    const record = f.entry.model.records.find(record => record.id === f.entry.selectedId); types.add(record.config.type);
    assert(f.entry.preview.meshCount > 0 && f.entry.preview.sourceTriangles >= f.entry.preview.triangleCount);
  }
  assert.deepEqual(Array.from(types).sort(), ['conveyor', 'palletQueue', 'processor', 'source']);
  assert(f.monitor.previewCache.size <= 4); assert.equal(firstCache.canvas.width, 0, 'Evicting an old preview releases its backing canvas.');
  assert(f.entry.regions.filter(region => region.page || region.equipment !== undefined || region.part !== undefined).every(region => region.height >= 36));
  assert(f.entry.regions.every(region => region.x >= 0 && region.y >= 0 && region.x + region.width <= 1024 && region.y + region.height <= 576));
  const hiddenBuilds = f.monitor.stats.previewBuilds; f.board.visible = false; f.monitor.invalidate(); f.monitor.sync('hall', 1);
  assert.equal(f.monitor.stats.previewBuilds, hiddenBuilds); f.board.visible = true; f.monitor.sync('hall', 0);
  click(f, 'diagram'); step(f, .5); assert.equal(f.monitor.stats.previewBuilds, hiddenBuilds, 'Returning to the overview stops all preview work.');
  assert.equal(rendererCalls, 0); assert.equal(f.ctx.renderer.xr.enabled, true);
  const canvases = Array.from(f.monitor.previewCache.values()).map(value => value.canvas);
  f.visuals.dispose(); f.runtime.stop(); f.monitor.dispose();
  assert.equal(f.monitor.previewCache.size, 0); assert(canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
  assert.equal(JSON.stringify(await f.document.serialize()), authored, 'All dashboard pages and previews leave the authored model and controls intact.');
  await inventoryRetirement();
  cataloguePreviewQuality();
  console.log('Line monitor workspace: combined plan/KPIs/trend, dedicated accessible controls, actual annotated mesh previews, four-entry cache, hidden-page inactivity, XR state and exact cleanup passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
