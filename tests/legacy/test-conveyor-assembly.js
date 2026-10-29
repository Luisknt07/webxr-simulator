const __layout = require("../../tooling/layout.cjs");
// Magnetic authoring with real Three.js graphs and reversible project records.
// This never opens WebGL, touches a user project, or invokes a native VR device.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const behaviorSchema = require('../../modules/logistica-industrial/contracts/behaviors.js');
const paths = behaviorSchema.conveyorLayout;
function source(file) {
  return fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-conveyor-assembly.js"), '../src/editor', file)), 'utf8')
    .replace(/^\uFEFF/, '').replace(/^import .*;\r?\n/gm, '');
}
const createIndustrialPrefab = new Function('THREE', 'behaviorSchema', source('IndustrialPrefabs.js')
  .replace(/export const /g, 'const ').replace(/export function /g, 'function ') + '\nreturn createIndustrialPrefab;')(THREE, behaviorSchema);
const SceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', source('SceneDocument.js')
  .replace('export default class SceneDocument', 'return class SceneDocument'))(THREE, behaviorSchema, createIndustrialPrefab);
const ConveyorAssembly = new Function('THREE', 'conveyorLayout', source('ConveyorAssembly.js')
  .replace('export default class ConveyorAssembly', 'return class ConveyorAssembly'))(THREE, paths);

function setup() {
  const scene = new THREE.Scene(), root = new THREE.Group(); scene.add(root);
  const floor = new THREE.Mesh(new THREE.BoxBufferGeometry(100, 0.05, 100), new THREE.MeshBasicMaterial());
  floor.name = 'Native floor'; floor.position.y = -0.025; root.add(floor);
  const portal = new THREE.Mesh(new THREE.SphereBufferGeometry(0.2, 8, 6), new THREE.MeshBasicMaterial());
  portal.name = 'Native panorama'; portal.position.set(12, 2, 0); portal.userData.editorInteraction = {type: 'room', room: 1}; root.add(portal);
  scene.updateMatrixWorld(true);
  const document = new SceneDocument({}); document.registerRoom('hall', root);
  const notices = [];
  const editor = {document, root, roomId: 'hall', selected: null, active: true, toolMode: 'translate',
    hooks: {renderScene: scene}, ctx: {scene}, assemblyMessage: value => notices.push(value)};
  editor.conveyorConfig = object => document.getBehaviors(object).find(config => config.type === 'conveyor');
  editor.updateConveyor = (object, patch) => document.setBehaviors(object, document.getBehaviors(object)
    .map(config => config.type === 'conveyor' ? Object.assign({}, config, patch) : config));
  const assembly = new ConveyorAssembly(editor);
  return {scene, root, portal, document, editor, assembly, notices};
}
function config(f, object) { return f.editor.conveyorConfig(object); }
function add(f, variant = 'roller-middle', position = [0, 1.02, 0], patch = {}) {
  const object = f.document.addPrefab('hall', 'conveyor', variant);
  f.editor.updateConveyor(object, Object.assign({withSensors: false, withPanel: false, withPallet: false}, patch));
  f.document.setTransform(object, {position}); return object;
}
function port(f, object, key) {
  object.updateWorldMatrix(true, true);
  const local = paths.ports(config(f, object))[key]; assert(local, 'The requested port must exist.');
  return {position: object.localToWorld(new THREE.Vector3(local.x, object.userData.editorConveyorTop || 0, local.z)),
    direction: new THREE.Vector3(local.tx, 0, local.tz).transformDirection(object.matrixWorld)};
}
function joined(f, source, destination, output = 'output', input = 'input') {
  const from = port(f, source, output), to = port(f, destination, input);
  assert(from.position.distanceTo(to.position) < 1e-6, 'Joined transport surfaces must meet at their actual world-space ports.');
  assert(from.direction.dot(to.direction) > 0.999999, 'Joined transport directions must agree.');
  const c = config(f, source);
  assert.equal(c[output === 'branch' ? 'branchId' : 'outputId'], destination.userData.editorId);
  assert.equal(c[output === 'branch' ? 'branchPort' : 'outputPort'], input);
}
function offsetWorld(object, offset) {
  const position = object.getWorldPosition(new THREE.Vector3()).add(offset);
  object.position.copy(object.parent ? object.parent.worldToLocal(position) : position);
  object.updateWorldMatrix(true, true);
}
function nearConnection(f, fixed, fixedPort, moving, movingPort, gap = 0.1) {
  // Use the documented explicit alignment only to seed a near-port drag pose.
  // The subsequent snap must independently re-align and write the correct link.
  f.document.begin(); f.assembly.align(fixed, fixedPort, moving, movingPort);
  offsetWorld(moving, new THREE.Vector3(gap, 0, 0.025)); f.document.commit();
}
function drag(f, moving, mutate, finish = true) {
  f.editor.selected = moving; f.document.begin(); f.assembly.begin(moving);
  mutate(); f.assembly.update(moving);
  if (finish) { f.assembly.end(); f.document.commit(); }
}
function outgoing(f, object, output = 'output') { return config(f, object)[output === 'branch' ? 'branchId' : 'outputId']; }

async function run() {
  {
    const f = setup(), first = add(f), next = add(f, 'belt-middle', [9, 1.02, 0]);
    const nativePose = f.portal.matrix.clone(), nativeMaterial = f.portal.material;
    nearConnection(f, first, 'output', next, 'input', 0.65);
    const original = await f.document.serialize(), depth = f.document.undoStack.length;
    drag(f, next, () => {}, false);
    assert(f.assembly.candidate, 'Nearby compatible ports must produce a preview before automatic assembly.');
    const yellow = [];
    f.scene.traverse(node => {
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      if (materials.some(material => material && material.color && material.color.getHex() === 0xffd54a)) yellow.push(node);
    });
    assert(yellow.length, 'Compatible connection locations must be visibly highlighted in yellow.');
    yellow.forEach(node => {
      assert(node.userData.editorHelper || node.userData.editorRuntimeHelper, 'Connection previews must be classified as transient helpers.');
      const hits = []; node.raycast(new THREE.Raycaster(), hits); assert.equal(hits.length, 0, 'Previews must never intercept picking or native rays.');
    });
    assert.equal(outgoing(f, first), '', 'A preview must not create a logical link before reaching the magnet distance.');
    assert.deepEqual(await f.document.serialize(), original, 'Transient previews are absent from project JSON.');
    // serialize() closes transactions, so open a new one before continuing.
    f.document.begin();
    const distance = port(f, next, 'input').position.clone().sub(port(f, first, 'output').position);
    offsetWorld(next, distance.multiplyScalar(-0.9)); f.assembly.update(next); f.assembly.end(); f.document.commit();
    joined(f, first, next);
    assert.equal(f.document.undoStack.length, depth + 1, 'A complete drag and its link must produce one undo entry.');
    assert(!f.assembly.drag, 'Mouse release must end the magnetic drag.');
    assert.strictEqual(f.portal.material, nativeMaterial); assert(f.portal.matrix.equals(nativePose));
    f.document.undo(); assert.deepEqual(await f.document.serialize(), original, 'Undo restores pose and connection together.');
    f.document.redo(); joined(f, first, next);
    const saved = await f.document.serialize(), reloaded = setup(); await reloaded.document.load(saved);
    const loadedFirst = reloaded.document.getObject(first.userData.editorId), loadedNext = reloaded.document.getObject(next.userData.editorId);
    joined(reloaded, loadedFirst, loadedNext);
    assert.equal(reloaded.document.additions.size, 2, 'Helpers must not become persisted scene objects.');
    const helpers = []; f.scene.traverse(node => { if (node.userData.editorHelper && node.material) helpers.push(node); });
    let disposals = 0; helpers.forEach(node => {
      if (node.geometry) node.geometry.addEventListener('dispose', () => disposals++);
      (Array.isArray(node.material) ? node.material : [node.material]).forEach(material => material.addEventListener('dispose', () => disposals++));
    });
    f.assembly.clear(); assert(!f.assembly.helperGroup || !f.assembly.helperGroup.parent);
    if (helpers.length) assert(disposals > 0, 'Clearing the preview must dispose its owned render resources.');
  }
  // Actual endpoints of both curve directions, axis conventions and split/merge T
  // routes must participate, including dragging the source toward a fixed inlet.
  for (const [fixedVariant, fixedPort, movingVariant, movingPort, axis] of [
    ['roller-curve-left', 'output', 'belt-middle', 'input', 'x'],
    ['belt-curve-right', 'output', 'roller-middle', 'input', 'z'],
    ['roller-tee-split', 'branch', 'belt-middle', 'input', 'x'],
    ['belt-tee-merge', 'branch', 'roller-middle', 'output', 'z']
  ]) {
    const f = setup(), fixed = add(f, fixedVariant, [0, 1.02, 0], {axis}), moving = add(f, movingVariant, [20, 1.02, 5]);
    fixed.rotation.y = 0.63; fixed.updateWorldMatrix(true, true);
    nearConnection(f, fixed, fixedPort, moving, movingPort);
    drag(f, moving, () => {});
    if (paths.ports(config(f, fixed))[fixedPort].incoming) joined(f, moving, fixed, movingPort, fixedPort);
    else joined(f, fixed, moving, fixedPort, movingPort);
    assert.equal(f.assembly.hasConnections(moving), true);
    f.assembly.clear();
  }
  {
    const f = setup(), previous = add(f), middle = add(f, 'belt-middle', [10, 1.02, 0]), last = add(f, 'roller-end', [20, 1.02, 0]);
    nearConnection(f, previous, 'output', middle, 'input'); drag(f, middle, () => {});
    nearConnection(f, middle, 'output', last, 'input'); drag(f, last, () => {});
    const before = await f.document.serialize(), depth = f.document.undoStack.length;
    drag(f, middle, () => offsetWorld(middle, new THREE.Vector3(0, 0, 6)));
    assert.equal(outgoing(f, previous), ''); assert.equal(outgoing(f, middle), '');
    assert.equal(f.assembly.hasConnections(middle), false, 'Pulling a module away must detach its incident connections.');
    assert.equal(f.document.undoStack.length, depth + 1);
    f.document.undo(); assert.deepEqual(await f.document.serialize(), before, 'Detachment is fully reversible.');
    f.document.begin(); assert(f.assembly.disconnect(middle)); f.document.commit();
    assert.equal(outgoing(f, previous), ''); assert.equal(outgoing(f, middle), '');
    assert.equal(f.assembly.disconnect(middle), false, 'Explicit detach is safe to repeat.');
  }
  {
    const f = setup(), first = add(f), moving = add(f, 'belt-middle', [10, 1.02, 0]);
    first.rotation.y = 0.48; moving.rotation.y = -0.94;
    const desired = port(f, first, 'output').position.add(new THREE.Vector3(0.08, 0, 0.025));
    offsetWorld(moving, desired.sub(port(f, moving, 'input').position));
    drag(f, moving, () => {}); joined(f, first, moving);
    // An opening that becomes incompatible must release its logical link too.
    drag(f, moving, () => { moving.rotation.x = 0.4; offsetWorld(moving, new THREE.Vector3(0, 0, 5)); });
    assert.equal(outgoing(f, first), '', 'Tilting a joined module and pulling it away must not retain a phantom connection.');
  }
  {
    const f = setup(), first = add(f), moving = add(f, 'belt-middle', [10, 1.02, 0]);
    moving.rotation.y = Math.PI / 2;
    const desired = port(f, first, 'output').position.add(new THREE.Vector3(0.07, 0, 0.02));
    offsetWorld(moving, desired.sub(port(f, moving, 'input').position));
    const pointerDownPosition = moving.position.clone();
    f.document.begin(); f.assembly.begin(moving); f.assembly.update(moving); joined(f, first, moving);
    // Three r112 TransformControls retains its pointer-down position internally
    // after magnetic yaw. Its next frame writes raw translation from that pose.
    moving.position.copy(pointerDownPosition).add(new THREE.Vector3(0.025, 0, 0));
    f.assembly.update(moving); joined(f, first, moving);
    f.assembly.end(); f.document.commit();
    f.document.begin(); assert(f.assembly.disconnect(moving)); f.document.commit();
    drag(f, moving, () => {});
    assert.equal(outgoing(f, first), '', 'An explicit detach must remain detached while its ports still coincide.');
    drag(f, moving, () => offsetWorld(moving, new THREE.Vector3(0, 0, 1)));
    const near = port(f, first, 'output').position.add(new THREE.Vector3(0.08, 0, 0.02));
    drag(f, moving, () => offsetWorld(moving, near.sub(port(f, moving, 'input').position)));
    joined(f, first, moving);
  }
  {
    const f = setup(), first = add(f), moving = add(f, 'belt-middle', [10, 1.02, 0]);
    nearConnection(f, first, 'output', moving, 'input'); drag(f, moving, () => {});
    const original = await f.document.serialize();
    f.document.begin(); moving.rotation.y += 0.3; assert(f.assembly.detachSeparated(moving)); f.document.commit();
    assert.equal(outgoing(f, first), '', 'Rotating a module away must detach its separated ports without applying magnetic yaw again.');
    f.document.undo(); assert.deepEqual(await f.document.serialize(), original);
    f.document.begin(); moving.scale.x = 1.3; assert(f.assembly.detachSeparated(moving)); f.document.commit();
    assert.equal(outgoing(f, first), '', 'Scaling a joined module must release connections whose endpoints no longer meet.');
  }
  {
    const f = setup(), source = add(f), target = add(f, 'roller-middle', [8, 1.02, 0]), outsider = add(f, 'roller-middle', [30, 1.02, 0]);
    nearConnection(f, source, 'output', target, 'input'); drag(f, target, () => {});
    nearConnection(f, target, 'input', outsider, 'output');
    const pose = outsider.position.clone(); drag(f, outsider, () => {});
    assert.equal(outgoing(f, source), target.userData.editorId, 'An occupied inlet must retain its existing source.');
    assert.equal(outgoing(f, outsider), ''); assert(outsider.position.equals(pose), 'An incompatible occupied inlet must not move the dragged module.');
    const wide = add(f, 'roller-middle', [60, 1.02, 0]);
    nearConnection(f, wide, 'output', outsider, 'input'); f.editor.updateConveyor(wide, {width: 2.4}); drag(f, outsider, () => {});
    assert.equal(outgoing(f, wide), '', 'Incompatible transport widths must not silently connect.');
    f.assembly.enabled = false;
    nearConnection(f, target, 'output', outsider, 'input'); const disabledPose = outsider.position.clone();
    drag(f, outsider, () => {}); assert(outsider.position.equals(disabledPose)); assert.equal(outgoing(f, target), '');
  }
  {
    const f = setup(), first = add(f), moving = add(f, 'roller-curve-right', [10, 1.02, 0], {axis: 'z'});
    f.root.position.set(4, 2, -7); f.root.rotation.y = 0.71; f.root.scale.set(1.3, 1.3, 1.3);
    first.rotation.y = -0.3; f.scene.updateMatrixWorld(true);
    nearConnection(f, first, 'output', moving, 'input'); drag(f, moving, () => {}); joined(f, first, moving);
    const before = moving.position.clone();
    assert.throws(() => f.assembly.align(first, 'input', moving, 'input'), /entrada|salida|compatible|puerto/i);
    assert(moving.position.equals(before), 'Rejected alignment must leave the original pose intact.');
  }
  {
    const f = setup(), first = add(f), moving = add(f, 'roller-middle', [10, 1.02, 0]);
    const parent = new THREE.Group(); parent.scale.set(2, 1, 1); parent.rotation.y = Math.PI / 4; f.root.add(parent); parent.add(moving);
    f.scene.updateMatrixWorld(true);
    const before = {position: moving.position.clone(), quaternion: moving.quaternion.clone(), scale: moving.scale.clone()};
    assert.throws(() => f.assembly.align(first, 'output', moving, 'input'), /escala|deform|grupo|coincidir/i,
      'An unrepresentable rotation beneath an anisotropic parent must be rejected.');
    assert(moving.position.equals(before.position)); assert(moving.quaternion.equals(before.quaternion)); assert(moving.scale.equals(before.scale));
  }
  console.log('Conveyor assembly: magnetic preview/snap, occupancy, curves/T, detach/undo, serialization, parent transforms and helper lifecycle passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
