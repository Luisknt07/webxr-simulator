const __layout = require("../../tooling/layout.cjs");
'use strict';
// Real catalogue factories, persisted graph and simulation; no server or user DB.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const schema = require('../../modules/logistica-industrial/contracts/behaviors'), guide = require('../../packages/project-model/shared/guided-scene-plan'), catalog = require('../../modules/logistica-industrial/contracts/resourceCatalog');
const {validateDocument} = require('../../apps/api/server/validation');
const code = file => fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-guided-scene-builder.js"), '../src/editor', file)), 'utf8').replace(/^\uFEFF/, '').replace(/^import .*$/gm, '').replace(/export default /g, '').replace(/export /g, '');
const mechanismSource = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-guided-scene-builder.js"), 'test-conveyor-mechanisms.js')), 'utf8');
const harness = new Function('require', '__dirname', mechanismSource.slice(0, mechanismSource.indexOf('async function run()')) + '\nreturn {setup,advance};')(require, __dirname);
const {ConveyorAssembly, buildCediEnvironment} = require('../support/load-industrial-cedi')(THREE, schema);
const {applyIndustrialFloorPresentation} = require('../support/load-industrial-floor')(THREE, schema);
const monitor = new Function('THREE', 'schema', code('MonitorWidgetTools.js') + '\nreturn {monitorTarget,createLineMonitor,MonitorWidgetTools};')(THREE, schema);
const {buildGuidedScene, guidedPlanDiagram} = new Function('THREE', 'schema', 'guidePlan', 'ConveyorAssembly', 'createLineMonitor', 'buildCediEnvironment', 'applyIndustrialFloorPresentation', code('GuidedSceneBuilder.js') + '\nreturn {buildGuidedScene,guidedPlanDiagram};')(THREE, schema, guide, ConveyorAssembly, monitor.createLineMonitor, buildCediEnvironment, applyIndustrialFloorPresentation);
const cfg = (document, object) => document.getBehaviors(object).find(value => ['source', 'conveyor', 'processor', 'palletQueue'].includes(value.type));
const round = value => JSON.parse(JSON.stringify(value, (key, item) => typeof item === 'number' ? Number(item.toFixed(8)) : item));
function release(f) {
  if (f.runtime) f.runtime.stop();
  const geometries = new Set(), materials = new Set(); f.scene.traverse(node => { if (node.geometry) geometries.add(node.geometry); (Array.isArray(node.material) ? node.material : [node.material]).filter(Boolean).forEach(value => materials.add(value)); });
  geometries.forEach(value => value.dispose()); materials.forEach(value => value.dispose());
}
function checkLinks(f, result) {
  const assembly = new ConveyorAssembly({document: f.document, roomId: 'hall', root: f.root, ctx: f.ctx, hooks: {renderScene: f.scene}, assemblyMessage() {}});
  result.links.forEach(link => { const from = f.document.getObject(link.source), to = f.document.getObject(link.target), a = assembly.worldPort(from, link.sourcePort), b = assembly.worldPort(to, link.targetPort); assert(a.position.distanceTo(b.position) < 1e-6, 'Real deck ports must meet.'); assert(a.tangent.dot(b.tangent) > .999999, 'Travel directions must agree.'); assert(assembly.assessConnection(from, link.sourcePort, to, link.targetPort).ready); const state = cfg(f.document, from); assert.equal(state[link.sourcePort === 'branch' ? 'branchId' : 'outputId'], link.target); }); assembly.clear();
}
async function run() {
  const requested = guide.planFromInstruction('Quiero un modelo con 3 transportadores de rodillos que hagan una L, ingresen 3 tipos de productos y un monitor de información.');
  assert.equal(requested.shape, 'l'); assert.equal(requested.turn, 'transfer'); assert.equal(requested.conveyorCount, 3); assert.equal(requested.productCount, 3); assert.equal(requested.monitor, true);
  assert.equal(guide.planFromInstruction('cuatro cintas en T, clasificar por defectos y generar siempre').routing, 'quality');
  assert.equal(guide.planFromInstruction('tres transportadores en L sin curvas, carga manual, sin monitor').automatic, false);
  assert.equal(guide.planFromInstruction('tres transportadores en L sin curvas, carga manual, sin monitor').monitor, false);
  assert.equal(guide.planFromInstruction('Necesito un castillo de hielo').understood, false);
  assert.equal(guide.normalizePlan({shape: 't', conveyorCount: 1}).conveyorCount, 4); assert(guide.normalizePlan({shape: 'l', conveyorCount: 300}).warnings.length);
  assert.equal(guide.planFromInstruction('3 bandas en recta, longitud 3,2 metros, velocidad de 0,8 m/s').length, 3.2);
  assert.equal(guide.planFromInstruction('3 bandas en recta, longitud 3,2 metros, velocidad de 0,8 m/s').speed, .8);
  assert(!guidedPlanDiagram(Object.assign({}, requested, {title: '<script>alert(1)</script>'})).includes('<script>'));
  const resource = catalog.RESOURCES.find(value => value.id === 'library:widget.lineMonitor'); assert(resource); assert.equal(resource.action.method, 'addLineMonitor'); assert(catalog.matches(resource, 'monitor widget'));
  for (const options of [{shape: 'straight', conveyorCount: 2}, {shape: 'l', conveyorCount: 3}, {shape: 'l', conveyorCount: 5, turn: 'curve'}, {shape: 't', conveyorCount: 6, routing: 'quality'}, {shape: 'y', conveyorCount: 5}, {shape: 'l', conveyorCount: 3, automatic: false}, {shape: 'straight', conveyorCount: 2, processor: 'process'}]) {
    const f = harness.setup(), depth = f.document.undoStack.length, before = await f.document.serialize(), plan = guide.normalizePlan(Object.assign({quantity: 12}, options));
    const result = buildGuidedScene(f.document, 'hall', plan, {scene: f.scene});
    assert.equal(result.conveyors.length, plan.conveyorCount); checkLinks(f, result);
    assert.equal(f.document.undoStack.length, depth + 1, 'A proposal is one undo transaction.');
    assert.equal(result.machines.filter(object => cfg(f.document, object).withPanel).length, 1, 'One line has one panel.');
    const monitorConfig = f.document.getBehaviors(result.monitor).find(value => value.type === 'lineMonitor'); assert.equal(monitorConfig.targetId, result.controller.userData.editorId); assert.equal(monitorConfig.scope, 'line');
    assert(result.conveyors.every(object => cfg(f.document, object).autoSpawn === false), 'Only explicit sources generate products.');
    const sourceState = cfg(f.document, result.sources[0]); assert.equal(JSON.parse(sourceState.catalog).length, 3);
    if (plan.shape === 'l' && plan.turn === 'transfer') assert.equal(cfg(f.document, result.conveyors[1]).length, plan.width, 'A rectangular L has no protruding arm.');
    const saved = validateDocument(await f.document.serialize(), value => value); f.document.undo(); assert.deepEqual(round(await f.document.serialize()), round(before)); f.document.redo(); checkLinks(f, result);
    const restored = harness.setup(); await restored.document.load(saved); assert.deepEqual(round(await restored.document.serialize()), round(saved), 'Properties, links and monitor survive reopen.'); release(restored);
    f.scene.updateMatrixWorld(true); f.runtime.start('hall');
    const states = () => result.receivers.map(object => f.runtime.records.get(object.userData.editorId).variables), units = () => states().reduce((sum, value) => sum + value.receivedUnits, 0);
    if (plan.automatic) {
      for (let elapsed = 0; elapsed < 240 && units() < 12; elapsed += 5) harness.advance(f, 5);
      const diagnostic = result.machines.map(object => [object.name, f.runtime.records.get(object.userData.editorId).variables]);
      assert.equal(units(), 12, plan.shape + ': all source products arrive, ' + JSON.stringify(diagnostic));
      if (plan.shape === 't') assert(states().every(value => value.receivedUnits > 0), 'Quality rules serve both branches.');
      assert(!f.runtime.events.some(value => value.type === 'configuration-warning'), 'Catalogue products and transport stay compatible.');
    } else { harness.advance(f, 8); assert.equal(units(), 0, 'Manual mode waits for a deliberate pickup.'); }
    release(f);
  }
  {
    const f = harness.setup(), result = buildGuidedScene(f.document, 'hall', guide.normalizePlan({shape: 'y', quantity: 1}), {scene: f.scene});
    assert.equal(cfg(f.document, result.sources[1]).autoGenerate, false, 'A zero-share source cannot accidentally become unlimited.'); assert.equal(cfg(f.document, result.sources[1]).initialCount, 0); release(f);
  }
  {
    const f = harness.setup(), result = buildGuidedScene(f.document, 'hall', requested, {scene: f.scene, environment: true}); assert(result.environment.floor); checkLinks(f, result); assert((f.document.studio.environments || []).length); validateDocument(await f.document.serialize(), value => value); release(f);
  }
  {
    const f = harness.setup(), before = await f.document.serialize(); assert.throws(() => buildGuidedScene(f.document, 'hall', requested, {scene: f.scene, position: [Infinity, 1, 0]})); assert.equal(f.document.transaction, null); assert.deepEqual(await f.document.serialize(), before, 'A failed build leaves no partial modules.'); release(f);
  }
  {
    const f = harness.setup(), line = buildGuidedScene(f.document, 'hall', requested, {scene: f.scene}), original = line.controller, root = new THREE.Group(); f.scene.add(root); f.document.registerRoom('sound', root);
    const internalRule = {sourceId: original.userData.editorId, variable: 'running', operator: 'eq', value: true, targetId: original.userData.editorId, targetVariable: 'paused', set: false, edge: 'rising'}, externalRule = Object.assign({}, internalRule, {sourceId: line.receivers[0].userData.editorId});
    f.document.setBehaviors(original, f.document.getBehaviors(original).concat(Object.assign(schema.defaultBehavior('automation'), {rules: JSON.stringify([internalRule, externalRule])})));
    f.document.setInteraction(original, {type: 'toggle', targetId: line.receivers[0].userData.editorId});
    const snapshot = f.document.captureObject(original), same = await f.document.pasteObject(snapshot, 'hall'), copied = await f.document.pasteObject(snapshot, 'sound');
    assert.equal(snapshot.roomId, 'hall', 'The immutable clipboard retains its source level.');
    assert.equal(cfg(f.document, same).outputId, cfg(f.document, original).outputId, 'Copying within a level keeps external bindings.');
    assert.equal(cfg(f.document, copied).outputId, '', 'Cross-level copy never controls or sends products to the original level.');
    assert.equal(cfg(f.document, copied).speed, cfg(f.document, original).speed); assert.equal(cfg(f.document, copied).length, cfg(f.document, original).length);
    const automation = f.document.getBehaviors(copied).find(value => value.type === 'automation'), rules = JSON.parse(automation.rules); assert.equal(rules.length, 1); assert.equal(rules[0].sourceId, copied.userData.editorId); assert.equal(rules[0].targetId, copied.userData.editorId); assert.equal(copied.userData.editorInteraction.type, 'none');
    let controls = 0; copied.traverse(node => f.document.getBehaviors(node).filter(value => value.type === 'control').forEach(value => { controls++; assert.equal(value.targetId, copied.userData.editorId, 'Internal panel references follow their own copied machine.'); })); assert(controls >= 9);
    const copiedMonitor = await f.document.pasteObject(f.document.captureObject(line.monitor), 'sound'); assert.equal(f.document.getBehaviors(copiedMonitor).find(value => value.type === 'lineMonitor').targetId, '', 'An independent monitor asks for a new local binding.');
    validateDocument(await f.document.serialize(), value => value); release(f);
  }
  console.log('Guided scene builder: Spanish proposals, catalogue monitor, measured L/T/Y ports, single undo, reopen and real product flow passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
