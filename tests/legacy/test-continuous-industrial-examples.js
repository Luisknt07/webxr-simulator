const __layout = require("../../tooling/layout.cjs");
'use strict';
// Long-running production recipes use the real prefabs, machinery animation,
// warehouse colliders and measured pallet packing. No browser or database write.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const schema = require('../../modules/logistica-industrial/contracts/behaviors'), {histogram} = require('../../tooling/maintenance/continuous-inventory-qa');
const fixture = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-continuous-industrial-examples.js"), 'test-industrial-lab-lines.js')), 'utf8');
const {harness, releaseGeometry} = new Function('require', '__dirname', fixture.slice(0, fixture.indexOf('\nasync function run()')) + '\nreturn {harness,releaseGeometry};')(require, __dirname);
const builders = require('../support/load-industrial-cedi')(THREE, schema);
const Visuals = new Function('THREE', 'RollerInstanceBatches', fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-continuous-industrial-examples.js"), '../src/editor/IndustrialVisuals.js')), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class IndustrialVisuals', 'return class IndustrialVisuals'))(THREE, require('../support/load-roller-instance-batches')(THREE));
const id = object => object.userData.editorId, clone = value => JSON.parse(JSON.stringify(value));
const config = (f, object) => f.document.getBehaviors(object).find(value => ['source', 'processor', 'conveyor', 'palletQueue'].includes(value.type));
function leaves(entry) {
  const rows = [], visit = value => { if (value.members && value.members.length) value.members.forEach(visit); else rows.push({id: value.id, originId: value.originId, units: value.units, spec: clone(value.spec)}); };
  visit(entry); return rows;
}
function capture(entry, runtime) {
  return {id: entry.id, originId: entry.originId, ownerId: entry.ownerId, units: entry.units, spec: clone(entry.spec), load: clone(entry.load || {}), lineage: (entry.lineage || []).slice(), leaves: leaves(entry), metadata: entry.product && runtime.productMetadata(entry.product)};
}

async function scenario(kind) {
  const f = harness.setup(), built = kind === 'lab' ? builders.buildIndustrialLab(f.document, 'hall', {scene: f.scene, continuous: true}) : builders.buildIndustrialCediLevel(f.document, 'hall', {kind, scene: f.scene, continuous: true});
  const lines = built.lines || built.cells, automatic = lines.filter(line => line.mode !== 'manual'), feeds = new Set(lines.flatMap(line => line.sourceIds));
  const generated = new Map(), dispatched = [], waves = [], palletUnits = new Set(), variants = new Set(), fields = new Set(), modes = new Set();
  const runtime = f.runtime, world = f.ctx.collisionWorld, visuals = new Visuals(f.ctx, f.document, runtime), authored = clone(await f.document.serialize());
  const rememberEntry = entry => {
    if (!entry) return;
    if (!feeds.has(entry.originId) || !entry.id.startsWith(entry.originId + ':') || entry.members && entry.members.length) return;
    const previous = generated.get(entry.id); if (!previous) generated.set(entry.id, capture(entry, runtime));
    else if (!previous.metadata && entry.product) previous.metadata = runtime.productMetadata(entry.product);
  };
  const remember = () => runtime.sourceRuntime.entries.forEach(rememberEntry);
  const originalGenerate = runtime.sourceRuntime.generate, originalMaterialize = runtime.sourceRuntime.materialize, originalRelease = runtime.palletQueueRuntime.releasePallet;
  runtime.sourceRuntime.generate = function (...args) { const result = originalGenerate.apply(this, args); if (result) rememberEntry(args[0].components.source.queue.at(-1)); return result; };
  runtime.sourceRuntime.materialize = function (...args) { const result = originalMaterialize.apply(this, args), inventory = args[1] || args[0].components.source; rememberEntry(result && result.sourceEntry || inventory && inventory.queue[0]); return result; };
  runtime.palletQueueRuntime.releasePallet = function (record, index) {
    const entries = record.components.palletQueue.queue.filter(entry => entry.product && entry.product.item.palletIndex === index).map(entry => ({receiverId: record.id, ...capture(entry, runtime)}));
    const result = originalRelease.call(this, record, index); if (result) dispatched.push(...entries); return result;
  };
  lines.forEach(line => {
    const members = line.memberIds.map(value => f.document.getObject(value));
    assert.equal(members.filter(object => config(f, object).withPanel).length, 1, 'Each network retains its single independent PLC.');
    line.sources.forEach(object => {
      const cfg = config(f, object);
      if (line.mode === 'manual') { assert.equal(cfg.autoGenerate, false); assert.equal(cfg.initialCount, 0); }
      else {
        assert.equal(cfg.autoGenerate, true); assert.equal(cfg.totalLimit, 0, 'Automatic supply cannot stop at a former finite demonstration limit.');
        if (cfg.loadMode === 'pallet') {
          const spec = schema.productSources.specAt(cfg, 0), plan = schema.productSources.palletPlan(spec, cfg); palletUnits.add(plan.units);
          assert([20, 30].includes(plan.units)); assert.equal(cfg.palletLayers, 5); assert.equal(cfg.palletPacking, 'fit');
          members.map(object => config(f, object)).filter(value => value.type === 'conveyor').forEach(value => assert(schema.conveyorLayout.productCompatibility(value, {width: plan.width, depth: plan.depth, height: plan.height, loadMode: 'pallet', base: 'runners', mass: plan.units * spec.mass + plan.tare}).ok, 'All pallet modules admit the real five-layer load envelope.'));
        }
      }
    });
    if (line.mode !== 'manual') line.receivers.forEach(object => {
      const cfg = config(f, object); assert.equal(cfg.palletCapacity, 4); assert.equal(cfg.layoutMode, 'fit'); assert.equal(cfg.layers, 5); assert.equal(cfg.maxStackHeight, 1.8); assert.equal(cfg.autoRelease, true);
    });
    members.forEach(object => { const cfg = config(f, object); if (cfg.type === 'conveyor') { variants.add(cfg.equipmentId); if (cfg.layout === 'tee' && cfg.junctionMode !== 'merge') { modes.add(cfg.routing); JSON.parse(cfg.routingRules || '[]').forEach(rule => fields.add(rule.field)); } } });
  });
  world.setRoom('hall'); f.scene.updateMatrixWorld(true); runtime.start('hall'); remember(); let peakLoads = runtime.sourceRuntime.liveLoads();
  const summary = () => lines.map(line => ({id: line.id, mode: line.mode, generatedUnits: line.sourceIds.reduce((sum, value) => sum + runtime.records.get(value).variables.generatedUnits, 0),
    receivedUnits: line.bufferIds.reduce((sum, value) => sum + runtime.records.get(value).variables.receivedUnits, 0), retiredPallets: line.bufferIds.reduce((sum, value) => sum + runtime.records.get(value).variables.dispatchedPallets, 0)}));
  for (let frame = 0; frame < 12000; frame++) {
    world.beginFrame();
    try { f.scene.updateMatrixWorld(true); runtime.execute(.1); visuals.sync('hall', .1, false); f.scene.updateMatrixWorld(true); peakLoads = Math.max(peakLoads, runtime.sourceRuntime.liveLoads()); }
    finally { world.endFrame(); }
    assert(peakLoads <= 500, 'Logical product pressure remains within the enforced global bound.');
    if ((frame + 1) % 1000 === 0) {
      const warnings = runtime.events.filter(event => event.type === 'configuration-warning'); assert.equal(warnings.length, 0, JSON.stringify(warnings));
      console.log('Continuous progress:', kind, (frame + 1) / 10, 's, generated', generated.size, 'active', runtime.sourceRuntime.liveLoads(), 'retired', dispatched.length);
    }
    if ((frame + 1) % 4000 === 0) {
      const state = summary(); waves.push(state); console.log('Continuous wave:', kind, (frame + 1) / 10, 's, live', runtime.sourceRuntime.liveLoads(), state.map(line => line.id + ':' + line.receivedUnits + 'u/' + line.retiredPallets + 'E').join(' · '));
      assert(runtime.sourceRuntime.entries.size <= 500 && runtime.products.size <= 500, 'Product records and materialized meshes remain bounded across dispatch waves.');
      assert.equal(runtime.processorRuntime.archive.size, 0, 'Retired generated products leave no authored-product archive behind.');
      lines.flatMap(line => line.receivers).forEach(object => {
        const record = runtime.records.get(id(object)), component = record.components.palletQueue, vars = record.variables;
        assert.equal(vars.receivedUnits, vars.queuedUnits + vars.deliveredUnits, 'Terminal received units equal real current inventory plus counted dispatches.');
        component.pallets.forEach(pallet => {
          for (const item of pallet.items) if (item.fitPlacement) {
            assert(item.fitPlacement.layer <= 5 && item.fitPlacement.y + item.fitPlacement.height <= 1.8 + 1e-6);
            for (const other of pallet.items) if (other !== item && other.fitPlacement) assert(!schema.productSources.pallets.overlaps(item.fitPlacement, other.fitPlacement), 'Actual mixed-size boxes have supported, non-overlapping footprints.');
          }
        });
      });
    }
  }
  remember();
  feeds.forEach(value => {
    const record = runtime.records.get(value), entries = Array.from(generated.values()).filter(entry => entry.originId === value);
    assert.equal(entries.length, record.variables.generated, 'Each Source generation count matches its observed load identities.');
    assert.equal(entries.reduce((sum, entry) => sum + entry.units, 0), record.variables.generatedUnits, 'Each Source unit counter matches its generated provenance.');
    entries.forEach((entry, index) => assert.deepEqual(entry.spec, schema.productSources.specAt(record.components.source.config, index), 'Source catalogues retain their real dimensions, product types, colors, defects and sequence.'));
  });
  const active = Array.from(runtime.sourceRuntime.entries).filter(entry => leaves(entry).some(leaf => feeds.has(leaf.originId))).map(entry => capture(entry, runtime));
  assert.deepEqual(histogram(Array.from(generated.values()).flatMap(value => value.leaves)), histogram(active.concat(dispatched).flatMap(value => value.leaves)), 'Every generated source unit, mass, dimension, SKU and origin remains active or was dispatched exactly once.');
  const ids = active.concat(dispatched).map(value => value.id); assert.equal(new Set(ids).size, ids.length);
  lines.forEach(line => {
    const rows = waves.map(wave => wave.find(value => value.id === line.id));
    if (line.mode === 'manual') { assert(rows.every(value => value.generatedUnits === 0 && value.receivedUnits === 0)); return; }
    assert(rows[1].generatedUnits > rows[0].generatedUnits && rows[2].generatedUnits > rows[1].generatedUnits, 'Automatic source production increases over three separate waves: ' + line.id);
    assert(rows[2].retiredPallets > 0, 'Every automatic network frees capacity by dispatching complete pallets: ' + line.id);
    line.memberIds.forEach(value => {
      const record = runtime.records.get(value), vars = record.variables, cfg = config(f, record.object);
      if (cfg.type === 'palletQueue' && /reserva|sin coincidencia/i.test(record.object.name)) return;
      const delivered = cfg.type === 'conveyor' || cfg.type === 'processor' ? vars.exitCount : cfg.type === 'source' ? vars.delivered : vars.received;
      assert(delivered > 0, 'Every automatic machine processes a real load: ' + record.object.name);
    });
    const analytics = runtime.getAnalyticsSnapshot(id(line.controller), 'line'); assert(analytics.history.length >= 20 && analytics.history.length <= 600 && analytics.control.ready);
    const time = ['busySeconds', 'idleSeconds', 'setupSeconds', 'blockedSeconds', 'downSeconds', 'pausedSeconds'].reduce((sum, field) => sum + analytics.summary[field], 0); assert(Math.abs(time - analytics.observedSeconds) < 1e-5);
  });
  dispatched.filter(entry => entry.load.loadMode === 'pallet').forEach(entry => {
    const source = generated.get(entry.id); assert(source && source.metadata && entry.metadata);
    ['width', 'height', 'depth'].forEach(key => assert(Math.abs(source.metadata[key] - entry.metadata[key]) < .005));
    ['units', 'mass', 'base', 'loadMode', 'productType'].forEach(key => assert.equal(entry.metadata[key], source.metadata[key]));
  });
  assert(!runtime.events.some(event => event.type === 'configuration-warning'), 'Continuous machinery never admits incompatible loads or broken physical links.');
  visuals.dispose(); runtime.stop(); assert.deepEqual(clone(await f.document.serialize()), authored, 'Continuous simulation restores the complete authored equipment and building.'); releaseGeometry(f);
  console.log("Continuous examples:", kind, automatic.length, 'automatic networks,', generated.size, 'generated loads,', dispatched.length, 'dispatched loads; exact lineage and bounded inventory passed.');
  return {variants, fields, palletUnits};
}

(async () => {
  const kinds = process.argv.slice(2).length ? process.argv.slice(2) : ['lab', 'sorting', 'packing'], results = [];
  for (const kind of kinds) results.push(await scenario(kind));
  if (kinds.includes('sorting') && kinds.includes('packing')) {
    assert.deepEqual(Array.from(new Set(results.flatMap(value => Array.from(value.variants)))).sort(), schema.conveyorEquipment.listEquipment({readyOnly: true}).map(value => value.id).sort());
    assert.deepEqual(Array.from(new Set(results.flatMap(value => Array.from(value.fields)))).sort(), schema.conveyorRouting.fields.map(value => value.value).sort());
    assert.deepEqual(Array.from(new Set(results.flatMap(value => Array.from(value.palletUnits)))).sort((a, b) => a - b), [20, 30]);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
