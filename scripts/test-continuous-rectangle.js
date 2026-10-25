'use strict';
// Full production lab factory, real warehouse colliders and animated machinery;
// select only this cell so recirculation can be audited without unrelated load.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const schema = require('../shared/behaviors');
const fixture = fs.readFileSync(path.join(__dirname, 'test-industrial-lab-lines.js'), 'utf8');
const {harness, buildIndustrialLabLines, releaseGeometry} = new Function('require', '__dirname', fixture.slice(0, fixture.indexOf('\nasync function run()')) + '\nreturn {harness,buildIndustrialLabLines,releaseGeometry};')(require, __dirname);
const buildIndustrialLab = require('./load-industrial-lab')(THREE, schema, buildIndustrialLabLines);
const Visuals = new Function('THREE', fs.readFileSync(path.join(__dirname, '../src/editor/IndustrialVisuals.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class IndustrialVisuals', 'return class IndustrialVisuals'))(THREE);
const clone = value => JSON.parse(JSON.stringify(value));
const id = object => object.userData.editorId;

async function run() {
  const f = harness.setup(), built = buildIndustrialLab(f.document, 'hall', {scene: f.scene, continuous: true, cellIds: ['rectangle']});
  assert.equal(built.cells.length, 1); const cell = built.cells[0], runtime = f.runtime, world = f.ctx.collisionWorld;
  const machineConfig = object => f.document.getBehaviors(object).find(value => ['source', 'conveyor', 'palletQueue'].includes(value.type));
  const exit = cell.objects.find(object => machineConfig(object)?.mechanism === 'distributor');
  assert.equal(machineConfig(exit).routing, 'percentage', 'The live circuit must exercise recirculation as well as its physical stock exit.');
  assert.equal(machineConfig(exit).branchPercentage, 90);
  assert.equal(machineConfig(cell.source).outputInterval, 6, 'The dispatch window lets returning loads enter the Y.');
  assert.equal(machineConfig(cell.source).totalLimit, 0);
  const generated = new Map(), retired = new Map(), warnings = [], waves = [];
  const remember = entry => {
    if (!entry || entry.originId !== id(cell.source)) return;
    if (!generated.has(entry.id)) generated.set(entry.id, {spec: clone(entry.spec), units: entry.units});
  };
  const generate = runtime.sourceRuntime.generate, release = runtime.palletQueueRuntime.releasePallet, event = runtime.event;
  runtime.sourceRuntime.generate = function (...args) { const result = generate.apply(this, args); if (result) remember(args[0].components.source.queue.at(-1)); return result; };
  runtime.palletQueueRuntime.releasePallet = function (record, index) {
    const entries = record.components.palletQueue.queue.filter(entry => entry.product?.item.palletIndex === index).map(entry => ({id: entry.id, spec: clone(entry.spec), units: entry.units}));
    const result = release.call(this, record, index);
    if (result) entries.forEach(entry => { assert(!retired.has(entry.id), 'A circulating product is retired exactly once.'); retired.set(entry.id, entry); });
    return result;
  };
  runtime.event = function (objectId, type, message) { if (type === 'configuration-warning') warnings.push({objectId, message}); return event.call(this, objectId, type, message); };
  const authored = clone(await f.document.serialize()), visuals = new Visuals(f.ctx, f.document, runtime);
  f.root.updateWorldMatrix(true, true); world.setRoom('hall'); runtime.start('hall'); runtime.sourceRuntime.entries.forEach(remember);
  for (let frame = 0; frame < 6000; frame++) {
    world.beginFrame();
    try { f.root.updateWorldMatrix(true, true); runtime.execute(.1); visuals.sync('hall', .1, false); f.root.updateWorldMatrix(true, true); } finally { world.endFrame(); }
    assert(runtime.sourceRuntime.liveLoads() <= 500);
    if ((frame + 1) % 2000 === 0) {
      const source = runtime.records.get(id(cell.source)).variables, stock = runtime.records.get(id(cell.receiver)).variables;
      waves.push({time: (frame + 1) / 10, generated: source.generatedUnits, received: stock.receivedUnits, retired: stock.dispatchedPallets});
      assert.equal(stock.receivedUnits, stock.queuedUnits + stock.deliveredUnits);
      console.log('Continuous rectangle:', JSON.stringify(waves.at(-1)));
    }
  }
  if (waves[2].generated === waves[1].generated || !waves[2].retired) console.log('Rectangle diagnostic:', JSON.stringify(cell.objects.filter(object => machineConfig(object)).map(object => {
    const r = runtime.records.get(id(object)), b = r.components.conveyor, v = r.variables;
    return {name: object.name, config: machineConfig(object).equipmentId || machineConfig(object).type,
      generated: v.generated, queued: v.queued, received: v.received, delivered: v.delivered, entry: v.entryCount, exit: v.exitCount,
      phase: v.mechanismPhase, transferBlocked: v.transferBlocked, blocked: v.blocked,
      loads: b && b.packages.map(item => ({offset: item.offset, route: item.route, stage: item.mechanismStage, blocked: item.blocked}))};
  })));
  assert(waves[1].generated > waves[0].generated && waves[2].generated > waves[1].generated, 'The Source keeps feeding after recirculating products return to its Y merge.');
  assert(waves[2].retired > 0, 'Complete pallet dispatch frees terminal capacity during live recirculation.');
  const conveyors = cell.objects.filter(object => machineConfig(object)?.type === 'conveyor');
  conveyors.forEach(object => {
    const values = runtime.records.get(id(object)).variables;
    assert(values.entryCount > 0 && values.exitCount > 0, 'Every real rectangular path, including the last three return modules, carries products: ' + object.name);
  });
  const active = Array.from(runtime.sourceRuntime.entries);
  assert.equal(active.length + retired.size, generated.size);
  const seen = new Set(); active.concat(Array.from(retired.values())).forEach(entry => {
    assert(!seen.has(entry.id)); seen.add(entry.id);
    assert.deepEqual({spec: clone(entry.spec), units: entry.units}, generated.get(entry.id), 'Circulation and dispatch retain the exact generated SKU, dimensions, quality and mass.');
  });
  assert.deepEqual(warnings, []); assert.equal(runtime.processorRuntime.archive.size, 0);
  const counters = conveyors.map(object => ({name: object.name, entry: runtime.records.get(id(object)).variables.entryCount, exit: runtime.records.get(id(object)).variables.exitCount}));
  visuals.dispose(); runtime.stop();
  assert.deepEqual(clone(await f.document.serialize()), authored); releaseGeometry(f);
  console.log('Continuous rectangle physical return, bounded inventory and exact conservation passed:', JSON.stringify(counters));
}

module.exports = {run};
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
