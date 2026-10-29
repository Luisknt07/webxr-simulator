const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const schema = require('../../modules/logistica-industrial/contracts/behaviors');
const {validateDocument} = require('../../apps/api/server/validation');
const code = file => fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-industrial-lab-lines.js"), '..', file)), 'utf8').replace(/^\uFEFF/, '').replace(/^import .*$/gm, '').replace(/export default /g, '').replace(/export /g, '');
const fixtureText = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-industrial-lab-lines.js"), 'test-conveyor-mechanisms.js')), 'utf8');
const boundary = fixtureText.indexOf('async function run()');
const harness = new Function('require', '__dirname', fixtureText.slice(0, boundary) + '\nreturn {setup,advance};')(require, __dirname);
const ConveyorAssembly = new Function('THREE', 'conveyorLayout', code("modules/logistica-industrial/functions/bandas/runtime/ConveyorAssembly.js") + '\nreturn ConveyorAssembly;')(THREE, schema.conveyorLayout);
const buildConveyorExample = new Function('THREE', 'ConveyorAssembly', code("modules/logistica-industrial/functions/bandas/runtime/ConveyorExamples.js") + '\nreturn buildConveyorExample;')(THREE, ConveyorAssembly);
const buildIndustrialLabLines = new Function('THREE', 'ConveyorAssembly', 'buildConveyorExample', require('../support/load-industrial-continuous')() + code("modules/logistica-industrial/scenarios/IndustrialLabLines.js") + '\nreturn buildIndustrialLabLines;')(THREE, ConveyorAssembly, buildConveyorExample);
function variables(f, object) { return f.runtime.records.get(object.userData.editorId).variables; }
function visible(object) { for (let node = object; node; node = node.parent) if (!node.visible) return false; return true; }
function fixture() { const f = harness.setup(); delete f.ctx.collisionWorld; return f; }
function releaseGeometry(f) {
  f.runtime.stop();
  const geometries = new Set(), materials = new Set(), textures = new Set();
  f.scene.traverse(object => { if (object.geometry) geometries.add(object.geometry); (Array.isArray(object.material) ? object.material : [object.material]).filter(Boolean).forEach(material => { materials.add(material); Object.values(material).forEach(value => { if (value && value.isTexture) textures.add(value); }); }); });
  textures.forEach(value => value.dispose()); materials.forEach(value => value.dispose()); geometries.forEach(value => value.dispose());
}
async function run() {
  const f = fixture(), graph = buildIndustrialLabLines(f.document, 'hall', {scene: f.scene});
  assert.equal(graph.cells.length, 9); assert.equal(new Set(graph.cells.map(cell => cell.id)).size, 9);
  assert.equal(graph.cells.filter(cell => cell.mode === 'automatic').length, 9);
  const assembly = new ConveyorAssembly({document: f.document, roomId: 'hall', root: f.root, ctx: f.ctx, hooks: {renderScene: f.scene}, assemblyMessage() {}});
  for (const cell of graph.cells) {
    assert(cell.bounds.width <= 28 && cell.bounds.depth <= 15);
    assert.equal(cell.objects.filter(object => f.document.getBehaviors(object).some(config => ['conveyor', 'source', 'processor', 'palletQueue'].includes(config.type) && config.withPanel)).length, 1, cell.id + ' has one shared line panel.');
    let panelControls = 0;
    cell.controller.traverse(node => f.document.getBehaviors(node).filter(config => config.type === 'control' && config.targetId === cell.controller.userData.editorId).forEach(config => { panelControls++; assert.equal(config.scope, 'line'); }));
    assert(panelControls >= 9, cell.id + ' exposes real controls for the entire connected line.');
    assert.equal(cell.receivers.reduce((sum, object) => sum + f.document.getBehaviors(object).find(config => config.type === 'palletQueue').palletCapacity, 0), 4, cell.id + ' has four physical pallet positions.');
    cell.objects.forEach(object => {
      const config = f.document.getBehaviors(object).find(value => value.type === 'conveyor');
      if (!config) return;
      const needed = ['loading', 'liftTransfer', 'turntable', 'pusher', 'steer', 'merge', 'distributor', 'elevator'].includes(config.mechanism);
      assert.equal(config.withSensors, needed, 'Lab detectors are opt-in at actual handling/decision points; ordinary transport does not duplicate them.');
      const sensors = [], zones = [];
      object.traverse(node => {
        if (!visible(node)) return;
        if (f.document.getBehaviors(node).some(value => value.type === 'sensor')) sensors.push(node);
        if (node.userData.industrialZoneLamp !== undefined) zones.push(node);
      });
      assert.equal(sensors.length > 0, needed, 'Only required entry/exit detector actors remain physically visible.');
      if (config.mechanism === 'zones') assert.equal(zones.length, Math.ceil(config.length / config.zoneLength), 'Every accumulation zone retains its own real occupancy detector and indicator.');
    });
    for (const link of cell.links) {
      const from = f.document.getObject(link.source), to = f.document.getObject(link.target);
      const a = assembly.worldPort(from, link.sourcePort), b = assembly.worldPort(to, link.targetPort);
      assert(a.position.distanceTo(b.position) < 1e-6, cell.id + ' physically joins every real port.');
      assert(a.tangent.dot(b.tangent) > .999999);
      assert.equal(assembly.assessConnection(from, link.sourcePort, to, link.targetPort).ready, true);
    }
  }
  const saved = validateDocument(await f.document.serialize(), value => value);
  const restored = fixture(); await restored.document.load(saved);
  const rounded = value => JSON.parse(JSON.stringify(value, (key, item) => typeof item === 'number' ? Number(item.toFixed(10)) : item));
  assert.deepEqual(rounded(await restored.document.serialize()), rounded(saved), 'The complete example configuration survives save/reopen.');
  assembly.clear(); releaseGeometry(f); releaseGeometry(restored);
  const transfer = graph.cells.find(cell => cell.id === 'transfer-l'), curve = graph.cells.find(cell => cell.id === 'manual-l');
  assert(transfer && curve && transfer.center[1] === 20 && curve.center[1] === -60);
  assert.equal(graph.cells[0].id, 'transfer-l', 'The first visible example is the rectangular L, not the curved conveyor.');
  const transferModules = transfer.objects.filter(object => f.document.getBehaviors(object).some(config => config.type === 'conveyor'));
  const transferConfigs = transferModules.map(object => f.document.getBehaviors(object).find(config => config.type === 'conveyor'));
  assert.deepEqual(transferConfigs.map(config => config.mechanism), ['transport', 'liftTransfer', 'transport']);
  assert(transferConfigs[0].length >= 4 && transferConfigs[2].length >= 4);
  assert.equal(transferConfigs[1].length, transferConfigs[2].width, 'The lift corner fits the perpendicular deck without an unused straight arm.');
  assert(transferConfigs.every(config => !['curveLeft', 'curveRight'].includes(config.layout)), 'The rectangular L is a true transfer between two perpendicular straight roller banks.');
  for (const id of graph.cells.map(cell => cell.id)) {
    const test = fixture(), line = buildIndustrialLabLines(test.document, 'hall', {scene: test.scene, cellIds: [id]}).cells[0];
    test.scene.updateMatrixWorld(true); test.runtime.start('hall');
    if (line.mode === 'automatic') {
      for (let elapsed = 0; elapsed < 260 && line.receivers.reduce((sum, object) => sum + variables(test, object).completePallets, 0) < 4; elapsed += 5) harness.advance(test, 5);
      const state = variables(test, line.receiver);
      const count = state.received || state.queued || state.inFlight;
      assert(count > 0, id + ' must deliver actual products: ' + JSON.stringify(state));
      if (id === 'sorting') {
        assert(line.receivers.every(receiver => variables(test, receiver).received > 0), 'The quality classifier must serve both A and B.');
      }
      if (id === 'assembly') {
        assert.equal(state.receivedUnits, 16, 'Combining and separating preserves all sixteen source units.');
      }
      assert.equal(line.receivers.reduce((sum, object) => sum + variables(test, object).completePallets, 0), 4, id + ' fills all four pallets with real products.');
    } else {
      harness.advance(test, 8);
      assert.equal(variables(test, line.source).queued, 4, 'A manual Source keeps its initial stock until the operator picks it up.');
      const output = variables(test, line.receiver);
      assert.equal(output.received || output.inFlight || 0, 0, 'Manual cells never silently auto-deliver products.');
      const source = test.runtime.records.get(line.source.userData.editorId).components.source;
      const product = source.queue[0].product, hand = new THREE.Group(); test.scene.add(hand);
      assert(test.runtime.pickupProduct(product, hand), 'Manual Source stock is an actual manipulable product.');
      const record = test.runtime.records.get(line.manualInlet.userData.editorId), belt = record.components.conveyor;
      const point = test.runtime.pathPoint(belt.config, .4), surface = test.runtime.pathSurface(record, belt, point);
      const pose = product.holdMatrix.clone(); pose.setPosition(surface.clone().add(new THREE.Vector3(0, -product.bounds.min.y * product.scale.y, 0)));
      test.runtime.setProductMatrix(product, pose);
      assert(test.runtime.releaseProduct(product, true)); assert.equal(product.item.mesh, product.object);
      assert.equal(variables(test, line.source).delivered, 1, 'Manual pickup removes exactly one original Source load.');
      if (id === 'manual-l') {
        harness.advance(test, 5); assert.equal(variables(test, line.receiver).received, 0, 'The manual workpoint waits for its operator and explicit dispatch.');
        const auxiliary = line.objects.filter(object => test.document.getBehaviors(object).some(config => config.type === 'control' && config.targetId === line.manualInlet.userData.editorId && ['operator', 'dispatch'].includes(config.command)));
        assert.equal(auxiliary.length, 2, 'Both manual operations have real labeled physical buttons.');
        test.runtime.command(record.id, 'operator'); test.runtime.command(record.id, 'dispatch');
        harness.advance(test, 35);
        assert.equal(variables(test, line.receiver).received, 1, 'The explicitly attended and dispatched load traverses the L and reaches the pallet stock.');
      } else {
        const start = product.item.offset; harness.advance(test, 2);
        assert(product.item.offset > start, 'The hand-deposited box moves under the configured gravity approximation.');
        assert.equal(belt.powered, false, 'The gravity station has no hidden motor.');
      }
    }
    console.log('Industrial lab cell passed:', id);
    releaseGeometry(test);
  }
  console.log('Industrial lab: nine automatic metric graphs, distinct curved/transfer L recipes, selective real presence detectors, one panel per line, four-pallet buffers, physical ports, unit conservation and saved configuration passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
