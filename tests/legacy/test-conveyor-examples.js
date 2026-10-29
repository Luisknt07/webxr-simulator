const __layout = require("../../tooling/layout.cjs");
/* Real procedural models, document records and authoring ports. No WebGL,
 * user's project database, filesystem recovery or mock graph is involved. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const behaviorSchema = require('../../modules/logistica-industrial/contracts/behaviors');
const {validateDocument} = require('../../apps/api/server/validation');
function source(file) {
  return fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-conveyor-examples.js"), '../src/editor', file)), 'utf8')
    .replace(/^\uFEFF/, '').replace(/^import .*;\r?\n/gm, '');
}
const createIndustrialPrefab = new Function('THREE', 'behaviorSchema', source('IndustrialPrefabs.js')
  .replace(/export const /g, 'const ').replace(/export function /g, 'function ') + '\nreturn createIndustrialPrefab;')(THREE, behaviorSchema);
const SceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', source('SceneDocument.js')
  .replace('export default class SceneDocument', 'return class SceneDocument'))(THREE, behaviorSchema, createIndustrialPrefab);
const ConveyorAssembly = new Function('THREE', 'conveyorLayout', source('ConveyorAssembly.js')
  .replace('export default class ConveyorAssembly', 'return class ConveyorAssembly'))(THREE, behaviorSchema.conveyorLayout);
const examples = new Function('THREE', 'ConveyorAssembly', source('ConveyorExamples.js')
  .replace(/export const /g, 'const ').replace(/export function /g, 'function ') + '\nreturn {conveyorExamples, buildConveyorExample};')(THREE, ConveyorAssembly);
function fixture() {
  const scene = new THREE.Scene(), root = new THREE.Group(); scene.add(root);
  const floor = new THREE.Mesh(new THREE.BoxBufferGeometry(60, .05, 60), new THREE.MeshBasicMaterial({color: '#b8c7ca'}));
  floor.name = 'Suelo original'; floor.position.y = -.025; root.add(floor);
  const panorama = new THREE.Object3D(); panorama.name = 'Panorama original'; panorama.position.set(22, 2, 0); root.add(panorama);
  scene.updateMatrixWorld(true);
  const document = new SceneDocument({}); document.registerRoom('hall', root);
  const editor = {document, roomId: 'hall', root, ctx: {scene}, hooks: {renderScene: scene}, assemblyMessage() {}};
  return {scene, root, document, floor, panorama, assembly: new ConveyorAssembly(editor)};
}
function config(f, object) { return f.document.getBehaviors(object).find(component => component.type === 'conveyor'); }
function checkLinks(f, result) {
  const ids = new Set(result.objects.map(object => object.userData.editorId));
  assert.equal(ids.size, result.objects.length, 'Every example module has an independent identity.');
  result.links.forEach(link => {
    const from = f.document.getObject(link.source), to = f.document.getObject(link.target);
    assert(from && to && ids.has(link.source) && ids.has(link.target));
    const outgoing = f.assembly.worldPort(from, link.sourcePort), incoming = f.assembly.worldPort(to, link.targetPort);
    assert(outgoing.position.distanceTo(incoming.position) < 1e-6, result.id + ': surfaces must meet at their real ports.');
    assert(outgoing.tangent.dot(incoming.tangent) > .999999, result.id + ': travel directions must match.');
    assert.equal(f.assembly.assessConnection(from, link.sourcePort, to, link.targetPort).ready, true);
    const branch = link.sourcePort === 'branch', value = config(f, from);
    assert.equal(value[branch ? 'branchId' : 'outputId'], link.target, 'A geometric alignment also needs an explicit persisted functional link.');
    assert.equal(value[branch ? 'branchPort' : 'outputPort'], link.targetPort);
  });
  assert.equal(f.assembly.edges().length, result.links.length);
}
const round = value => JSON.parse(JSON.stringify(value, (key, item) => typeof item === 'number' ? Number(item.toFixed(10)) : item));
async function run() {
  for (const example of examples.conveyorExamples.filter(item => item.id !== 'single')) {
    const f = fixture(), nativePose = f.panorama.position.clone(), nativeMaterial = f.floor.material;
    const beforeDepth = f.document.undoStack.length;
    const result = examples.buildConveyorExample(f.document, 'hall', example.id, {scene: f.scene, position: [5, 1.02, -3]});
    checkLinks(f, result);
    assert.equal(f.document.undoStack.length, beforeDepth + 1, 'A complete graph is a single reversible editor action.');
    result.objects.forEach(object => {
      const value = config(f, object);
      assert(behaviorSchema.conveyorEquipment.getDefinition(value.equipmentId));
      assert.equal(value.equipmentVersion, 1);
      assert.equal(value.autoSpawn, false, 'Examples never seed hidden duplicate generators.');
    });
    if (example.id === 'line-l') {
      assert.equal(config(f, result.objects[1]).layout, 'curveLeft');
      assert(Math.abs(f.assembly.worldPort(result.first, 'input').tangent.dot(f.assembly.worldPort(result.last, 'output').tangent)) < 1e-6, 'An L uses a real arc with a perpendicular final direction.');
    }
    if (example.id === 'line-l-transfer') {
      assert.equal(config(f, result.objects[1]).mechanism, 'liftTransfer');
      assert.equal(config(f, result.objects[1]).routing, 'branch');
      assert.equal(config(f, result.objects[1]).length, config(f, result.last).width, 'The rectangular L example has no unused straight roller arm.');
      assert.equal(config(f, result.first).withSensors, false); assert.equal(config(f, result.last).withSensors, false);
      assert(Math.abs(f.assembly.worldPort(result.first, 'input').tangent.dot(f.assembly.worldPort(result.last, 'output').tangent)) < 1e-6, 'A lift transfer connects perpendicular straight paths without crossed roller banks.');
    }
    if (example.id === 'line-t') assert.equal(config(f, result.objects[1]).mechanism, 'pusher');
    if (example.id === 'line-y') {
      const merge = result.objects[1];
      assert.equal(config(f, merge).mergeAngle, 45);
      const branch = f.assembly.worldPort(merge, 'branch'), main = f.assembly.worldPort(merge, 'input');
      assert(Math.abs(branch.tangent.dot(main.tangent) - Math.SQRT1_2) < 1e-6, 'The Y branch uses an actual 45° incoming path.');
      const lateral = merge.children[0].children[10], sensor = f.document.getBehaviors(lateral).find(value => value.type === 'sensor');
      assert(sensor && sensor.sourceId === merge.userData.editorId);
      f.document.setBehaviors(lateral, f.document.getBehaviors(lateral).map(value => value.type === 'sensor' ? Object.assign({}, value, {normallyClosed: true}) : value));
    }
    if (example.id === 'transfer') {
      assert.equal(config(f, result.objects[1]).mechanism, 'liftTransfer');
      assert.equal(config(f, result.objects[1]).routing, 'branch');
    }
    if (example.id === 'sorting') {
      const value = config(f, result.objects[1]);
      assert.equal(value.routing, 'rules');
      assert.equal(behaviorSchema.conveyorRouting.decideRoute(value, {quality: 'defective'}, 0).route, 'branch');
      assert.equal(behaviorSchema.conveyorRouting.decideRoute(value, {quality: 'good'}, 0).route, 'main');
    }
    if (example.id === 'accumulation') {
      assert.equal(config(f, result.objects[1]).mechanism, 'zones');
      assert.equal(config(f, result.last).withPanel, true, 'The blocked receiver has independent controls, outside the first panel segment.');
      assert.equal(config(f, result.last).running, false);
    }
    if (example.id === 'level') {
      assert.equal(config(f, result.objects[1]).mechanism, 'elevator');
      assert(Math.abs(f.assembly.worldPort(result.last, 'input').position.y - f.assembly.worldPort(result.first, 'output').position.y - 2) < 1e-6, 'The exit receiver is placed at the actual upper level.');
      assert.equal(config(f, result.last).supportHeight, 3);
      const receiverBounds = new THREE.Box3().setFromObject(result.last);
      assert(Math.abs(receiverBounds.min.y - 0.02) < 0.00001, 'The elevated receiver has real tall supports reaching the same floor as the inlet.');
    }
    if (example.id === 'rectangle') {
      assert.equal(result.objects.length, 8); assert.equal(result.links.length, 8);
      assert.equal(config(f, result.last).outputId, result.first.userData.editorId, 'The rectangular circuit closes functionally and geometrically.');
    }
    assert(f.panorama.position.equals(nativePose)); assert.equal(f.floor.material, nativeMaterial);
    const data = await f.document.serialize();
    const validated = validateDocument(JSON.parse(JSON.stringify(data)), value => value);
    const reopened = fixture(); await reopened.document.load(validated);
    checkLinks(reopened, Object.assign({}, result, {objects: result.objects.map(object => reopened.document.getObject(object.userData.editorId))}));
    assert.deepEqual(round(await reopened.document.serialize()), round(data), 'All model variants, configuration and links survive API validation and a fresh scene document.');
  }
  const f = fixture(), initial = await f.document.serialize();
  assert.throws(() => examples.buildConveyorExample(f.document, 'hall', 'missing'), /Selecciona/);
  let calls = 0; const add = f.document.addPrefab.bind(f.document);
  f.document.addPrefab = (...args) => { if (++calls === 3) throw new Error('Fallo de inserción de prueba'); return add(...args); };
  assert.throws(() => examples.buildConveyorExample(f.document, 'hall', 'line-l'), /Fallo de inserción/);
  assert.deepEqual(await f.document.serialize(), initial, 'A partially built example rolls back atomically.');
  assert.equal(f.document.transaction, null);
  console.log("Conveyor examples:", examples.conveyorExamples.length - 1, 'real graphs, curved and transfer L/T/Y/rectangle and upper-level ports, persisted links, classification, independent blocking, API round trips and atomic rollback passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
