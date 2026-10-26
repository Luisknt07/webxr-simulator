'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const schema = require('../shared/behaviors'), read = file => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const Lod = new Function('THREE', read('editor/CosmeticVisualLod.js').replace('default class CosmeticVisualLod', 'return class CosmeticVisualLod'))(THREE);
const {getGeometryTree} = require('./load-geometry-acceleration')(THREE), CollisionWorld = new Function('THREE', 'getGeometryTree', read('lib/CollisionWorld.js').replace('default class CollisionWorld', 'return class CollisionWorld'))(THREE, getGeometryTree);
const cpu = require('./upgrade-industrial-floor').loadCPU();
function setup() {
  const scene = new THREE.Scene(), root = new THREE.Group(), document = new cpu.SceneDocument({scene}); scene.add(root); document.registerRoom('hall', root);
  const camera = new THREE.PerspectiveCamera(55, 1.5, .1, 500); camera.position.set(0, 1.5, 0); scene.add(camera); const lod = new Lod(); return {scene, root, document, camera, lod};
}
const economy = {tier: 'economy', visualDistanceScale: .65};
async function run() {
  const f = setup(), machine = f.document.addPrefab('hall', 'conveyor', 'roller-motor'); f.document.setTransform(machine, {position: [0, 1, -40]}); f.scene.updateMatrixWorld(true);
  const before = await f.document.serialize(), poses = new Map(), resources = new Map(); machine.traverse(node => { poses.set(node, [node.position.toArray(), node.quaternion.toArray(), node.scale.toArray(), node.visible]); if (node.geometry) resources.set(node, {geometry: node.geometry, material: node.material, index: node.geometry.index && node.geometry.index.array.slice()}); });
  f.lod.reconcile(f.root); assert(f.lod.getStats().cosmeticLodCandidates >= 4, 'Real factory hardware batches are eligible without changing their topology or part paths.');
  f.lod.update([f.camera], .2, economy); assert(f.lod.getStats().cosmeticLodHidden >= 4); assert(f.lod.getStats().cosmeticLodDrawCallsAvoidedEstimated >= 4);
  const hidden = []; machine.traverse(node => { if (node.layers.mask === 0) hidden.push(node); }); assert(hidden.length); hidden.forEach(node => assert.equal(node.userData.industrialCosmeticDetail, true));
  const renderable = () => { let count = 0; machine.traverse(node => { if (node.isMesh && f.camera.layers.test(node.layers)) count++; }); return count; }; const reduced = renderable();
  assert.deepEqual(await f.document.serialize(), before, 'Authored visibility, poses, behaviors, nodes and model records stay literal.');
  machine.traverse(node => { assert.deepEqual([node.position.toArray(), node.quaternion.toArray(), node.scale.toArray(), node.visible], poses.get(node)); const original = resources.get(node); if (original) { assert.equal(node.geometry, original.geometry); assert.equal(node.material, original.material); if (original.index) assert.deepEqual(node.geometry.index.array, original.index); } });
  f.lod.update([f.camera], 0, {tier: 'high', visualDistanceScale: 1.35}); assert.equal(f.lod.getStats().cosmeticLodHidden, 0); assert(renderable() > reduced, 'High quality immediately restores actual renderer-visible draw submissions.');
  f.lod.update([f.camera], .2, economy); f.camera.position.z = -38; f.camera.updateMatrixWorld(true); f.lod.update([f.camera], .2, economy); assert.equal(f.lod.getStats().cosmeticLodHidden, 0, 'Approaching machinery restores its fittings.');
  const left = f.camera.clone(), right = f.camera.clone(); left.position.z = 30; right.position.z = -38; left.updateMatrixWorld(true); right.updateMatrixWorld(true); f.lod.update([left, right], .2, economy); assert.equal(f.lod.getStats().cosmeticLodHidden, 0, 'A near XR eye preserves detail for both eyes.');
  const trackedEye = f.camera.clone(); trackedEye.position.set(80, 20, 80); trackedEye.matrixWorld.makeTranslation(0, 1.5, -38);
  const trackedWorld = trackedEye.matrixWorld.elements.slice(), trackedLocal = trackedEye.position.toArray();
  f.lod.update([trackedEye], .2, economy);
  assert.equal(f.lod.getStats().cosmeticLodHidden, 0, 'LOD uses the actual tracked eye and camera-rig world offset, not the stale local XR eye pose.');
  assert.deepEqual(trackedEye.matrixWorld.elements, trackedWorld, 'Reading XR detail distance must never recompute a tracked eye matrix.'); assert.deepEqual(trackedEye.position.toArray(), trackedLocal);
  f.camera.position.z = 0; f.camera.updateMatrixWorld(true); f.lod.update([f.camera], .2, economy); f.lod.clear(); hidden.forEach(mesh => assert.equal(mesh.layers.mask, 1));

  // Layer filtering is deliberately independent of the exact collision triangles.
  const owner = new THREE.Group(); owner.userData.editorPrefabKey = 'conveyor'; const bolt = new THREE.Mesh(new THREE.BoxBufferGeometry(1, 1, 1), new THREE.MeshBasicMaterial()); bolt.userData.industrialCosmeticDetail = true; bolt.position.set(0, 1, -30); owner.add(bolt); f.root.add(owner); f.scene.updateMatrixWorld(true);
  const world = new CollisionWorld({}, f.document); world.setRoom('hall'); const start = new THREE.Vector3(-2, 1, -30), end = new THREE.Vector3(2, 1, -30), blocked = world.rayBlocked(start, end), moved = world.moveCapsule(start, end, {radius: .2, height: .4, eyeHeight: .2}); const entryCount = world.entries.length; assert(blocked);
  f.lod.reconcile(f.root); f.lod.update([f.camera], .2, economy); assert.equal(bolt.layers.mask, 0); world.invalidate(); world.refresh(); assert.equal(world.entries.length, entryCount); assert.equal(world.rayBlocked(start, end), blocked); assert.deepEqual(world.moveCapsule(start, end, {radius: .2, height: .4, eyeHeight: .2}).toArray(), moved.toArray(), 'Collision and movement use exactly the same original geometry when cosmetic draws are omitted.');
  f.lod.dispose(); assert.equal(bolt.layers.mask, 1);

  const Memory = new Function('THREE', read('editor/RuntimeResourceMemory.js').replace('default class RuntimeResourceMemory', 'return class RuntimeResourceMemory'))(THREE);
  const Performance = new Function('THREE', 'RuntimeResourceMemory', 'CosmeticVisualLod', read('editor/ScenePerformance.js').replace('default class ScenePerformance', 'return class ScenePerformance'))(THREE, Memory, Lod);
  let limits = economy; const manager = new Performance({scene: f.scene, graphics: {getLimits: () => limits}, renderer: {domElement: {height: 720}, info: {render: {}, memory: {}}}}, f.document); manager.setRoom('hall'); manager.update(f.camera, .2); assert(manager.getStats().cosmeticLodHidden > 0, 'The existing ScenePerformance lifecycle applies the effective graphics policy.'); limits = {tier: 'ultra', visualDistanceScale: 1.8}; manager.update(f.camera, 0); assert.equal(manager.getStats().cosmeticLodHidden, 0); manager.dispose(); assert.equal(bolt.layers.mask, 1);

  const protectedFixture = setup(), container = new THREE.Group(); container.userData.editorPrefabKey = 'conveyor'; protectedFixture.root.add(container);
  const add = data => { const group = new THREE.Group(); Object.assign(group.userData, data); const mesh = new THREE.Mesh(new THREE.BoxBufferGeometry(.02, .02, .02), new THREE.MeshBasicMaterial()); mesh.userData.industrialCosmeticDetail = true; group.add(mesh); container.add(group); return mesh; };
  const protectedMeshes = [{editorPrefabKey: 'control'}, {editorPrefabKey: 'sensor'}, {editorPrefabKey: 'product'}, {editorPrefabKey: 'plc'}, {editorPrefabKey: 'conveyor', editorNative: true}, {industrialDynamicGeometry: true}, {industrialProcessorHead: true}, {industrialSteerBank: true}, {industrialDisplay: true}, {industrialButton: true}, {industrialSensorVolume: true}, {editorBehaviors: [{type: 'lineMonitor'}]}, {editorVisualOwnerId: 'replacement'}].map(add);
  protectedFixture.lod.reconcile(protectedFixture.root); protectedFixture.lod.update([protectedFixture.camera], .2, economy); assert.equal(protectedFixture.lod.getStats().cosmeticLodCandidates, 0); protectedMeshes.forEach(mesh => assert.equal(mesh.layers.mask, 1));
  const sharedGeometry = new THREE.BoxBufferGeometry(.02, .02, .02), material = new THREE.MeshBasicMaterial(); for (let index = 0; index < 2300; index++) { const mesh = new THREE.Mesh(sharedGeometry, material); mesh.userData.industrialCosmeticDetail = true; mesh.position.z = -40; container.add(mesh); }
  protectedFixture.scene.updateMatrixWorld(true); protectedFixture.lod.reconcile(protectedFixture.root); assert.equal(protectedFixture.lod.getStats().cosmeticLodCandidates, 2048); protectedFixture.lod.update([protectedFixture.camera], .2, economy); assert.equal(protectedFixture.lod.getStats().cosmeticLodMaxDecisionsPerFrame, 64); assert.equal(protectedFixture.lod.getStats().cosmeticLodHidden, 64); protectedFixture.lod.dispose(); container.traverse(mesh => assert.equal(mesh.layers.mask, 1));
  console.log('Cosmetic visual LOD: real factory draw reduction, exact document/geometry/material/pose and collision preservation, near/high/XR restoration, protected HMI/sensors/products/dynamic ancestors, bounded registry/decisions and cleanup passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
