const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {THREE, behaviorSchema, setup, add} = require('./test-processor-runtime.js');
const palletQueues = require('../../modules/logistica-industrial/functions/almacenamiento/schema/palletQueues.js');
const ConveyorAssembly = new Function('THREE', 'conveyorLayout', fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-pallet-queue-flow.js"), '../src/editor/ConveyorAssembly.js')), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export default class ConveyorAssembly', 'return class ConveyorAssembly'))(THREE, behaviorSchema.conveyorLayout);
function fixture() {
  const f = setup(), editor = {document: f.document, roomId: 'hall', hooks: {renderScene: f.scene}, assemblyMessage() {}};
  f.assembly = new ConveyorAssembly(editor); return f;
}
function offset(object, delta) {
  const point = object.getWorldPosition(new THREE.Vector3()).add(delta);
  object.position.copy(object.parent ? object.parent.worldToLocal(point) : point); object.updateWorldMatrix(true, true);
}
function nearby(f, fixed, fixedPort, moving, movingPort, distance = 0.1) {
  f.assembly.align(fixed, fixedPort, moving, movingPort); offset(moving, new THREE.Vector3(distance, 0, 0.01));
}
function drag(f, object, mutate = () => {}) {
  f.document.begin(); f.assembly.begin(object); mutate(); f.assembly.update(object); f.assembly.end(); f.document.commit();
}
function joined(f, source, target, from = 'output', to = 'input') {
  const a = f.assembly.worldPort(source, from), b = f.assembly.worldPort(target, to);
  assert(a.position.distanceTo(b.position) < 1e-6); assert(a.tangent.dot(b.tangent) > 0.999999);
  const config = f.assembly.config(source), branch = from === 'branch';
  assert.equal(config[branch ? 'branchId' : 'outputId'], target.userData.editorId);
  assert.equal(config[branch ? 'branchPort' : 'outputPort'], to);
}
async function run() {
  assert.strictEqual(behaviorSchema.conveyorLayout.palletQueueLayout, palletQueues.layout);
  const standard = palletQueues.layout();
  assert.equal(standard.length, 1.8); assert(Math.abs(standard.width - 1.45) < 1e-12);
  assert.equal(standard.floor, -1); assert.equal(standard.palletTop, -0.85); assert.deepEqual(standard.palletPosition, [0, -1, 0]);
  assert.equal(standard.slots.length, 48); assert.equal(standard.slots[0].layer, 0); assert.equal(standard.slots[12].layer, 1);
  for (const size of [0.4, 1.2, 4]) {
    const config = {width: size, depth: size, columns: 2, rows: 2, layers: 2, capacity: 8}, before = Object.assign({}, config);
    const shape = palletQueues.layout(config); assert.deepEqual(config, before);
    assert.equal(shape.length, Math.max(1.8, size + 0.4)); assert.equal(shape.width, Math.max(1.45, size + 0.4));
    assert.deepEqual(shape.input, {x: -shape.length / 2, y: 0, z: 0, tx: 1, tz: 0});
    assert.deepEqual(shape.output, {x: shape.length / 2, y: 0, z: 0, tx: 1, tz: 0});
    assert.equal(shape.cellWidth, size / 2); assert.equal(shape.cellDepth, size / 2);
    shape.slots.forEach(slot => { assert(Math.abs(slot.x) < size / 2); assert(Math.abs(slot.z) < size / 2); });
  }
  {
    const f = fixture(), source = add(f, 'source', {}, [-20, 1.02, 0]), queue = add(f, 'palletQueue');
    const belt = add(f, 'conveyor', {}, [20, 1.02, 0]);
    nearby(f, queue, 'output', belt, 'input'); drag(f, belt); joined(f, queue, belt);
    nearby(f, queue, 'input', source, 'output', 0.7); const before = await f.document.serialize();
    f.document.begin(); f.assembly.begin(source); f.assembly.update(source);
    assert(f.assembly.candidate); assert.equal(f.assembly.config(source).outputId, '');
    let yellow = 0; f.scene.traverse(node => {
      if (!node.material || !node.material.color || node.material.color.getHex() !== 0xffd54a) return;
      yellow++; const hits = []; node.raycast(new THREE.Raycaster(), hits); assert.equal(hits.length, 0);
      assert(node.userData.editorHelper && node.userData.editorRuntimeHelper);
    });
    assert(yellow > 0); assert.deepEqual(await f.document.serialize(), before); f.assembly.end();
    const delta = f.assembly.worldPort(queue, 'input').position.sub(f.assembly.worldPort(source, 'output').position).multiplyScalar(0.9);
    const depth = f.document.undoStack.length; drag(f, source, () => offset(source, delta));
    joined(f, source, queue); joined(f, queue, belt); assert.equal(f.document.undoStack.length, depth + 1);
    f.document.undo(); assert.deepEqual(await f.document.serialize(), before); f.document.redo(); joined(f, source, queue);
    const saved = await f.document.serialize(), loaded = fixture(); await loaded.document.load(saved);
    joined(loaded, loaded.document.getObject(source.userData.editorId), loaded.document.getObject(queue.userData.editorId));
    joined(loaded, loaded.document.getObject(queue.userData.editorId), loaded.document.getObject(belt.userData.editorId));
    assert.equal(loaded.assembly.records().length, 3);
    const joinedState = await f.document.serialize(); drag(f, queue, () => offset(queue, new THREE.Vector3(0, 0, 4)));
    assert.equal(f.assembly.config(source).outputId, ''); assert.equal(f.assembly.config(queue).outputId, '');
    f.document.undo(); assert.deepEqual(await f.document.serialize(), joinedState);
    f.document.begin(); assert(f.assembly.disconnect(queue)); f.document.commit(); drag(f, queue);
    assert.equal(f.assembly.config(source).outputId, '', 'Explicit pallet separation suppresses immediate magnetic reconnection.');
    f.assembly.clear(); loaded.assembly.clear();
  }
  for (const type of ['source', 'processor', 'conveyor', 'palletQueue']) {
    const f = fixture(), producer = add(f, type), queue = add(f, 'palletQueue', {width: 2, depth: 1.8}, [20, 1.02, 5]);
    f.root.position.set(4, 2, -7); f.root.rotation.y = 0.43; f.root.scale.setScalar(1.3);
    producer.rotation.y = -0.5; queue.rotation.y = 0.8; f.scene.updateMatrixWorld(true);
    nearby(f, producer, 'output', queue, 'input'); drag(f, queue); joined(f, producer, queue);
    const outsider = add(f, 'source', {}, [-30, 1.02, 0]); nearby(f, queue, 'input', outsider, 'output');
    const pose = outsider.position.clone(); drag(f, outsider); assert(outsider.position.equals(pose));
    assert.equal(f.assembly.config(outsider).outputId, '');
    assert.equal(f.assembly.config(producer).outputId, queue.userData.editorId, 'An occupied pallet inlet cannot be claimed by a second producer.');
    f.assembly.clear();
  }
  {
    const f = fixture(), queue = add(f, 'palletQueue'), merge = add(f, 'conveyor', {layout: 'tee', length: 3, junctionMode: 'merge', axis: 'z'}, [20, 1.02, 0]);
    nearby(f, merge, 'branch', queue, 'output'); drag(f, queue); joined(f, queue, merge, 'output', 'branch');
    f.document.begin();
    const config = f.assembly.config(queue); f.document.setBehaviors(queue, [Object.assign({}, config, {width: 3})]);
    assert(f.assembly.detachSeparated(queue)); f.document.commit();
    assert.equal(f.assembly.config(queue).outputId, '', 'Changing pallet footprint invalidates an endpoint that physically moved away.');
    f.assembly.clear();
  }
  console.log('Pallet queue flow: metric wood/grid metadata, Source/Processor/conveyor/pallet magnetic assembly, T merge, occupancy, resize, detach/undo and persistence passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
