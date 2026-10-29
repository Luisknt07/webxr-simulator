const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const behaviorSchema = require('../../modules/logistica-industrial/contracts/behaviors.js');
const processors = require('../../modules/logistica-industrial/functions/procesamiento/schema/processors.js');
function source(file) {
  return fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-processor-flow.js"), '../src/editor', file)), 'utf8')
    .replace(/^\uFEFF/, '').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
}
const createIndustrialPrefab = new Function('THREE', 'behaviorSchema', source('IndustrialPrefabs.js') + '\nreturn createIndustrialPrefab;')(THREE, behaviorSchema);
const SceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', source('SceneDocument.js')
  .replace('default class SceneDocument', 'return class SceneDocument'))(THREE, behaviorSchema, createIndustrialPrefab);
const ConveyorAssembly = new Function('THREE', 'conveyorLayout', source('ConveyorAssembly.js')
  .replace('default class ConveyorAssembly', 'return class ConveyorAssembly'))(THREE, behaviorSchema.conveyorLayout);
function fixture() {
  const scene = new THREE.Scene(), root = new THREE.Group(); scene.add(root);
  const document = new SceneDocument({}); document.registerRoom('hall', root);
  const editor = {document, roomId: 'hall', selected: null, hooks: {renderScene: scene}, assemblyMessage() {}};
  return {scene, root, document, editor, assembly: new ConveyorAssembly(editor)};
}
function add(f, type, position, values = {}, variant) {
  const object = f.document.addPrefab('hall', type, variant), original = f.document.getBehaviors(object);
  f.document.setBehaviors(object, original.map(config => config.type === type ? Object.assign({}, config, values) : config));
  f.document.setTransform(object, {position}); return object;
}
function offset(object, delta) {
  const point = object.getWorldPosition(new THREE.Vector3()).add(delta);
  object.position.copy(object.parent ? object.parent.worldToLocal(point) : point); object.updateWorldMatrix(true, true);
}
function nearby(f, fixed, fixedPort, moving, movingPort, distance = 0.1) {
  f.assembly.align(fixed, fixedPort, moving, movingPort); offset(moving, new THREE.Vector3(distance, 0, 0.01));
}
function drag(f, object, mutate = () => {}) {
  f.editor.selected = object; f.document.begin(); f.assembly.begin(object); mutate();
  f.assembly.update(object); f.assembly.end(); f.document.commit();
}
function joined(f, from, to, fromPort = 'output', toPort = 'input') {
  const a = f.assembly.worldPort(from, fromPort), b = f.assembly.worldPort(to, toPort);
  assert(a.position.distanceTo(b.position) < 1e-6); assert(a.tangent.dot(b.tangent) > 0.999999);
  const config = f.assembly.config(from), branch = fromPort === 'branch';
  assert.equal(config[branch ? 'branchId' : 'outputId'], to.userData.editorId);
  assert.equal(config[branch ? 'branchPort' : 'outputPort'], toPort);
}
async function run() {
  assert.strictEqual(behaviorSchema.conveyorLayout.processorLayout, processors.layout);
  assert.deepEqual(processors.modes, ['process', 'combiner', 'separator']);
  const defaults = processors.layout();
  assert.equal(defaults.length, 3); assert.equal(defaults.width, 1.6); assert.equal(defaults.floor, -1); assert.equal(defaults.deckHeight, 0);
  for (const length of [1.5, 3, 8]) for (const width of [0.6, 1.6, 6]) {
    const input = {mode: 'separator', length, width}, original = Object.assign({}, input), shape = processors.layout(input);
    assert.deepEqual(input, original, 'Computing flow ports must not mutate authored processor settings.');
    assert.deepEqual(shape.input, {x: -length / 2, y: 0, z: 0, tx: 1, tz: 0});
    assert.deepEqual(shape.output, {x: length / 2, y: 0, z: 0, tx: 1, tz: 0});
    assert.deepEqual(shape.inputPosition, [-length / 2 + 0.35, 0, 0]); assert.deepEqual(shape.outputPosition, [length / 2 - 0.35, 0, 0]);
    assert.equal(shape.width, width); assert.equal(shape.mode, 'separator');
    assert.notStrictEqual(shape.inputPosition, shape.queuePosition, 'Independent metadata consumers must not alias mutable position arrays.');
  }
  {
    const f = fixture(), processor = add(f, 'processor', [0, 1.02, 0]);
    const generator = add(f, 'source', [-20, 1.02, 0]), queue = add(f, 'source', [20, 1.02, 0], {}, 'queue');
    const next = add(f, 'processor', [40, 1.02, 0], {length: 5, width: 2.3}, 'separator');
    assert(f.assembly.supported(processor)); assert.equal(f.assembly.records().length, 4);
    nearby(f, next, 'input', queue, 'output'); drag(f, queue); joined(f, queue, next);
    nearby(f, processor, 'output', queue, 'input'); drag(f, queue); joined(f, processor, queue);
    // Moving a linked queue may separate its downstream edge, but must not rewrite another producer's connection.
    assert.equal(f.assembly.config(queue).outputId, '');
    nearby(f, processor, 'input', generator, 'output', 0.7);
    const before = await f.document.serialize();
    f.document.begin(); f.assembly.begin(generator); f.assembly.update(generator);
    assert(f.assembly.candidate); assert.equal(f.assembly.config(generator).outputId, '');
    const guides = []; f.scene.traverse(node => { if (node.material && node.material.color && node.material.color.getHex() === 0xffd54a) guides.push(node); });
    assert(guides.length, 'Source -> processor flow is previewed in yellow before snapping.');
    guides.forEach(node => { const hits = []; node.raycast(new THREE.Raycaster(), hits); assert.equal(hits.length, 0); });
    assert.deepEqual(await f.document.serialize(), before, 'Processor flow guides stay outside saved scene records.');
    f.assembly.end();
    const delta = f.assembly.worldPort(processor, 'input').position.sub(f.assembly.worldPort(generator, 'output').position).multiplyScalar(0.9);
    const depth = f.document.undoStack.length; drag(f, generator, () => offset(generator, delta));
    joined(f, generator, processor); joined(f, processor, queue);
    assert.equal(f.document.undoStack.length, depth + 1);
    f.document.undo(); assert.deepEqual(await f.document.serialize(), before); f.document.redo(); joined(f, generator, processor);
    const saved = await f.document.serialize(), restored = fixture(); await restored.document.load(saved);
    joined(restored, restored.document.getObject(generator.userData.editorId), restored.document.getObject(processor.userData.editorId));
    joined(restored, restored.document.getObject(processor.userData.editorId), restored.document.getObject(queue.userData.editorId));
    const connected = await f.document.serialize();
    drag(f, processor, () => offset(processor, new THREE.Vector3(0, 0, 4)));
    assert.equal(f.assembly.config(generator).outputId, ''); assert.equal(f.assembly.config(processor).outputId, '');
    f.document.undo(); assert.deepEqual(await f.document.serialize(), connected);
    f.document.begin(); assert(f.assembly.disconnect(processor)); f.document.commit(); drag(f, processor);
    assert.equal(f.assembly.config(generator).outputId, '', 'Explicit separation suppresses immediate reassembly at coincident processor ports.');
    f.assembly.clear(); restored.assembly.clear();
  }
  for (const [type, variant] of [['source', undefined], ['conveyor', 'belt-middle'], ['processor', 'combiner']]) {
    const f = fixture(), producer = add(f, type, [0, 1.02, 0], {}, variant);
    const destination = add(f, 'processor', [20, 1.02, 5], {length: 4.6, width: 2.4});
    f.root.position.set(4, 2, -7); f.root.rotation.y = 0.43; f.root.scale.setScalar(1.3);
    producer.rotation.y = -0.5; destination.rotation.y = 0.8; f.scene.updateMatrixWorld(true);
    nearby(f, producer, 'output', destination, 'input'); drag(f, destination); joined(f, producer, destination);
    const outsider = add(f, 'source', [-30, 1.02, 0]); nearby(f, destination, 'input', outsider, 'output');
    const pose = outsider.position.clone(); drag(f, outsider);
    assert.equal(f.assembly.config(outsider).outputId, ''); assert(outsider.position.equals(pose));
    assert.equal(f.assembly.config(producer).outputId, destination.userData.editorId, 'The single processor inlet is occupied across every producer type.');
    f.assembly.clear();
  }
  {
    const f = fixture(), processor = add(f, 'processor', [0, 1.02, 0], {length: 6}, 'separator');
    const merge = add(f, 'conveyor', [20, 1.02, 0], {axis: 'z'}, 'roller-tee-merge');
    nearby(f, merge, 'branch', processor, 'output'); drag(f, processor); joined(f, processor, merge, 'output', 'branch');
    const before = processor.position.clone();
    assert.throws(() => f.assembly.align(merge, 'input', processor, 'input'), /compatibles|puertos/); assert(processor.position.equals(before));
    f.document.begin();
    const config = f.assembly.config(processor); f.document.setBehaviors(processor, [Object.assign({}, config, {length: 3})]);
    assert(f.assembly.detachSeparated(processor)); f.document.commit();
    assert.equal(f.assembly.config(processor).outputId, '', 'Changing processor dimensions invalidates a physically separated flow link.');
    const resized = f.assembly.worldPort(processor, 'output');
    assert(resized.position.distanceTo(processor.localToWorld(new THREE.Vector3(1.5, 0, 0))) < 1e-6);
    f.assembly.clear();
  }
  console.log('Processor flow: shared metric ports, Source/Queue/belt/processor assembly, occupancy, magnetic preview, T merge, resize/detach, undo and persistence passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
