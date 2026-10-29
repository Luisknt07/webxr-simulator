const __layout = require("../../tooling/layout.cjs");
// Physical authoring of Source -> FIFO -> conveyor flow with real project records.
// Primitives stand in for the source visuals so transport contracts are tested
// independently from the generator's procedural geometry and runtime inventory.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const behaviorSchema = require('../../modules/logistica-industrial/contracts/behaviors.js');
function source(file) {
  return fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-production-flow.js"), '../src/editor', file)), 'utf8')
    .replace(/^\uFEFF/, '').replace(/^import .*;\r?\n/gm, '');
}
const createIndustrialPrefab = new Function('THREE', 'behaviorSchema', source('IndustrialPrefabs.js')
  .replace(/export const /g, 'const ').replace(/export function /g, 'function ') + '\nreturn createIndustrialPrefab;')(THREE, behaviorSchema);
const SceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', source('SceneDocument.js')
  .replace('export default class SceneDocument', 'return class SceneDocument'))(THREE, behaviorSchema, createIndustrialPrefab);
const ConveyorAssembly = new Function('THREE', 'conveyorLayout', source('ConveyorAssembly.js')
  .replace('export default class ConveyorAssembly', 'return class ConveyorAssembly'))(THREE, behaviorSchema.conveyorLayout);

function fixture() {
  const scene = new THREE.Scene(), root = new THREE.Group(); scene.add(root);
  const floor = new THREE.Mesh(new THREE.BoxBufferGeometry(100, 0.05, 100), new THREE.MeshBasicMaterial());
  floor.position.y = -0.025; root.add(floor); scene.updateMatrixWorld(true);
  const document = new SceneDocument({}); document.registerRoom('hall', root);
  const editor = {document, roomId: 'hall', selected: null, hooks: {renderScene: scene}, assemblyMessage() {}};
  return {scene, root, document, editor, assembly: new ConveyorAssembly(editor)};
}
function machine(f, type, position, patch = {}, variant = 'roller-middle') {
  const object = type === 'source' ? f.document.addPrimitive('hall', 'box') : f.document.addPrefab('hall', 'conveyor', variant);
  const authored = f.document.getBehaviors(object).find(config => config.type === type) || behaviorSchema.defaultBehavior(type);
  const config = Object.assign({}, authored, type === 'conveyor' ? {withPanel: false, withSensors: false, withPallet: false} : {}, patch);
  f.document.setBehaviors(object, [config]);
  f.document.setTransform(object, {position});
  return object;
}
function offset(object, delta) {
  const world = object.getWorldPosition(new THREE.Vector3()).add(delta);
  object.position.copy(object.parent ? object.parent.worldToLocal(world) : world); object.updateWorldMatrix(true, true);
}
function nearby(f, fixed, fixedPort, moving, movingPort, gap = 0.1) {
  f.assembly.align(fixed, fixedPort, moving, movingPort); offset(moving, new THREE.Vector3(gap, 0, 0.02));
}
function drag(f, object, mutate = () => {}) {
  f.editor.selected = object; f.document.begin(); f.assembly.begin(object);
  mutate(); f.assembly.update(object); f.assembly.end(); f.document.commit();
}
function joined(f, from, to, sourcePort = 'output', targetPort = 'input') {
  const a = f.assembly.worldPort(from, sourcePort), b = f.assembly.worldPort(to, targetPort);
  assert(a.position.distanceTo(b.position) < 1e-6, 'Connected deck openings must coincide.');
  assert(a.tangent.dot(b.tangent) > 0.999999, 'Flow must continue in the receiver direction.');
  const config = f.assembly.config(from), branch = sourcePort === 'branch';
  assert.equal(config[branch ? 'branchId' : 'outputId'], to.userData.editorId);
  assert.equal(config[branch ? 'branchPort' : 'outputPort'], targetPort);
}

async function run() {
  {
    const f = fixture(), generator = machine(f, 'source', [-20, 1.02, 0], {delivery: 'automatic'});
    const queue = machine(f, 'source', [0, 1.02, 0], {autoGenerate: false, delivery: 'automatic'});
    const belt = machine(f, 'conveyor', [20, 1.02, 0]);
    assert(f.assembly.supported(generator)); assert(f.assembly.supported(queue));
    assert.equal(f.assembly.records().length, 3, 'The machine graph includes generators, queues and conveyors.');
    nearby(f, queue, 'output', belt, 'input'); drag(f, belt); joined(f, queue, belt);
    nearby(f, queue, 'input', generator, 'output', 0.7);
    const original = await f.document.serialize();
    f.document.begin(); f.assembly.begin(generator); f.assembly.update(generator);
    assert(f.assembly.candidate, 'A source must show a compatible nearby FIFO inlet.');
    assert.equal(f.assembly.config(generator).outputId, '', 'Yellow preview alone never writes a flow connection.');
    const yellow = [];
    f.scene.traverse(node => { if (node.material && node.material.color && node.material.color.getHex() === 0xffd54a) yellow.push(node); });
    assert(yellow.length, 'Compatible source/queue ports need visible yellow guides.');
    yellow.forEach(node => {
      const hits = []; node.raycast(new THREE.Raycaster(), hits); assert.equal(hits.length, 0);
      assert(node.userData.editorHelper && node.userData.editorRuntimeHelper, 'Flow previews stay outside user assets.');
    });
    assert.deepEqual(await f.document.serialize(), original, 'Preview meshes and candidate state must not enter saved projects.');
    f.assembly.end();
    const displacement = f.assembly.worldPort(queue, 'input').position.sub(f.assembly.worldPort(generator, 'output').position).multiplyScalar(0.9);
    const depth = f.document.undoStack.length;
    drag(f, generator, () => offset(generator, displacement));
    joined(f, generator, queue); joined(f, queue, belt);
    assert.equal(f.document.undoStack.length, depth + 1, 'Source alignment and its flow link form one undo transaction.');
    f.document.undo(); assert.deepEqual(await f.document.serialize(), original);
    f.document.redo(); joined(f, generator, queue); joined(f, queue, belt);
    const saved = await f.document.serialize(), loaded = fixture(); await loaded.document.load(saved);
    const copySource = loaded.document.getObject(generator.userData.editorId), copyQueue = loaded.document.getObject(queue.userData.editorId);
    joined(loaded, copySource, copyQueue); joined(loaded, copyQueue, loaded.document.getObject(belt.userData.editorId));
    assert.equal(loaded.assembly.records().length, 3);
    const beforeDetach = await f.document.serialize();
    drag(f, queue, () => offset(queue, new THREE.Vector3(0, 0, 4)));
    assert.equal(f.assembly.config(generator).outputId, ''); assert.equal(f.assembly.config(queue).outputId, '');
    f.document.undo(); assert.deepEqual(await f.document.serialize(), beforeDetach, 'Moving a FIFO away detaches both incident flows reversibly.');
    f.document.begin(); assert(f.assembly.disconnect(queue)); f.document.commit();
    drag(f, queue); assert.equal(f.assembly.config(generator).outputId, '', 'Explicitly separated queues stay separated until moved out of the release radius.');
    f.assembly.clear(); loaded.assembly.clear();
  }
  {
    const f = fixture(), belt = machine(f, 'conveyor', [0, 1.02, 0]);
    const queue = machine(f, 'source', [30, 1.02, 0], {autoGenerate: false});
    nearby(f, belt, 'output', queue, 'input'); drag(f, queue); joined(f, belt, queue);
    const generator = machine(f, 'source', [-30, 1.02, 0]);
    nearby(f, queue, 'input', generator, 'output');
    const before = generator.position.clone(); drag(f, generator);
    assert.equal(f.assembly.config(belt).outputId, queue.userData.editorId);
    assert.equal(f.assembly.config(generator).outputId, '', 'A conveyor occupies a queue inlet just like another source.');
    assert(generator.position.equals(before), 'An occupied FIFO inlet must not attract another producer.');
    f.assembly.clear();
  }
  {
    const f = fixture(), merge = machine(f, 'conveyor', [0, 1.02, 0], {axis: 'z'}, 'belt-tee-merge');
    const generator = machine(f, 'source', [20, 1.02, 5], {delivery: 'automatic'});
    f.root.position.set(4, 2, -7); f.root.rotation.y = 0.71; f.root.scale.setScalar(1.3);
    merge.rotation.y = -0.3; generator.rotation.y = 0.8; f.scene.updateMatrixWorld(true);
    nearby(f, merge, 'branch', generator, 'output'); drag(f, generator); joined(f, generator, merge, 'output', 'branch');
    f.assembly.clear();
  }
  {
    const f = fixture(), generator = machine(f, 'source', [0, 1.02, 0], {
      productType: 'crate', width: 2, depth: 1.6, loadMode: 'pallet', palletColumns: 2, palletRows: 2, palletLayers: 1
    });
    const expected = behaviorSchema.productSources.layout(f.assembly.config(generator));
    const a = f.assembly.worldPort(generator, 'input'), b = f.assembly.worldPort(generator, 'output');
    assert(Math.abs(a.position.x + expected.length / 2) < 1e-9);
    assert(Math.abs(b.position.x - expected.length / 2) < 1e-9);
    assert.equal(b.width, expected.width, 'Source port placement uses real load-dependent dimensions, including pallet loads.');
    const belt = machine(f, 'conveyor', [30, 1.02, 0], {width: 1});
    assert(f.assembly.pair(generator, 'output', belt, 'input'), 'Deck width can differ between a source staging table and a belt; runtime validates each load.');
    assert.equal(f.assembly.pair(generator, 'output', belt, 'output'), null);
    const pose = belt.position.clone(); belt.rotation.x = 0.35; belt.updateWorldMatrix(true, true);
    assert.equal(f.assembly.pair(generator, 'output', belt, 'input'), null, 'A source never snaps a tilted machine.');
    assert(belt.position.equals(pose));
    f.assembly.clear();
  }
  console.log('Production flow: source/FIFO/conveyor magnetic connections, dynamic pallet ports, reverse dragging, occupancy, T inlets, undo, persistence and helper lifecycle passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
