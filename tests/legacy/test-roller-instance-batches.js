const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const Batches = require('../support/load-roller-instance-batches')(THREE);
// Actual prefabs/document/industrial animation, adapting only the canvas/GPU
// boundary. Browser VBO lifecycle is exercised separately by the renderer test.
const fixtureSource = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-roller-instance-batches.js"), 'test-industrial-visuals.js')), 'utf8');
const setup = new Function('require', '__dirname', fixtureSource.slice(0, fixtureSource.indexOf('\nasync function run()')) + '\nreturn setup;')(require, __dirname);
const shown = object => {for (let node = object; node; node = node.parent) if (!node.visible) return false; return true;};
function draws(root) { let count = 0; root.traverse(object => {if ((object.isMesh || object.isInstancedMesh) && shown(object) && object.layers.mask & 1) count += Array.isArray(object.material) ? object.geometry.groups.filter(group => object.material[group.materialIndex] && object.material[group.materialIndex].visible).length : 1;}); return count; }
function near(a, b) {assert(a.length === b.length && a.every((value, index) => Math.abs(value - b[index]) < 1e-5));}
async function run() {
  assert(!Batches.supported({capabilities: {isWebGL2: false}}));
  assert(Batches.supported({capabilities: {}, extensions: {get: name => name === 'ANGLE_instanced_arrays' ? {} : null}}));
  const f = setup(); f.ctx.renderer.capabilities.isWebGL2 = true;
  // Capability is detected once when the actual renderer is supplied.
  f.visuals.rollerInstancing = false;
  const before = await f.document.serialize(), originals = [];
  f.root.traverse(mesh => {if (mesh.userData.industrialRoller) originals.push({mesh, geometry: mesh.geometry, material: mesh.material, quaternion: mesh.quaternion.clone(), mask: mesh.layers.mask});});
  assert.equal(originals.length, 26); f.visuals.sync('hall', 0, false); const initial = draws(f.root); f.visuals.rollerInstancing = Batches.supported(f.ctx.renderer);
  f.root.updateMatrixWorld(true); const point = originals[0].mesh.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 2, 0));
  const ray = new THREE.Raycaster(point, new THREE.Vector3(0, -1, 0));
  const rayHits = () => ray.intersectObject(f.root, true).filter(hit => originals.some(value => value.mesh === hit.object));
  const hitsBefore = rayHits().map(hit => [hit.object, hit.distance]); assert(hitsBefore.length);
  f.visuals.sync('hall', 0, false); const stats = f.visuals.getStats();
  assert.equal(stats.rollerInstanceSources, 26); assert.equal(stats.rollerInstanceBatches, 1); assert.equal(stats.rollerDrawCallsAvoided, 25); assert.equal(stats.rollerInstanceBytes, 26 * 64);
  assert.equal(initial - draws(f.root), 25); assert.equal(stats.rollerMatrixUploads, 1);
  const bank = f.visuals.rollerBatches.batches[0], shared = originals[0].geometry;
  assert(bank.frustumCulled && bank.userData.editorRuntimeHelper); assert.equal(bank.parent, originals[0].mesh.parent);
  assert.equal(bank.geometry.attributes.position, shared.attributes.position); assert.equal(bank.geometry.index, shared.index);
  assert.equal(bank.material, originals[0].mesh.material, 'The exact same rolling texture/material drives every instance.');
  originals.forEach(value => {assert.equal(value.mesh.layers.mask, 0); assert(value.mesh.visible); assert.equal(value.mesh.geometry, value.geometry); assert(value.mesh.quaternion.equals(value.quaternion));});
  const hitsAfter = rayHits(); assert.equal(hitsAfter.length, hitsBefore.length); hitsAfter.forEach((hit, index) => {assert.equal(hit.object, hitsBefore[index][0]); assert.equal(hit.distance, hitsBefore[index][1]);});
  assert.deepEqual(await f.document.serialize(), before, 'Generated draw objects and temporary masks never enter saved scene data.');
  const roller = f.visuals.rollers.values().next().value, texture = roller.surfaces[0].texture, offset = texture.offset.x;
  f.visuals.sync('hall', .1, false); assert.notEqual(texture.offset.x, offset, 'Real roller animation advances the exact shared texture.');
  for (let i = 0; i < 20; i++) f.visuals.sync('hall', 1 / 60, false);
  assert.equal(f.visuals.getStats().rollerBatchRebuilds, stats.rollerBatchRebuilds); assert.equal(f.visuals.getStats().rollerMatrixUploads, stats.rollerMatrixUploads, 'UV animation and normal frames never reupload static matrices.');
  // Mechanism-parent motion is applied exactly once by the ordinary graph.
  bank.parent.position.y += .16; bank.parent.rotation.z = .12; f.root.updateMatrixWorld(true);
  const matrix = new THREE.Matrix4(); bank.getMatrixAt(0, matrix);
  near(new THREE.Matrix4().multiplyMatrices(bank.matrixWorld, matrix).elements, originals[0].mesh.matrixWorld.elements);
  f.visuals.sync('hall', .02, false); assert.equal(f.visuals.getStats().rollerMatrixUploads, stats.rollerMatrixUploads);
  originals[0].mesh.position.y += .02; f.visuals.sync('hall', .02, false); bank.getMatrixAt(0, matrix); near(matrix.elements, originals[0].mesh.matrix.elements); assert.equal(f.visuals.getStats().rollerMatrixUploads, stats.rollerMatrixUploads + 1);
  const view = bank.geometry; let viewDisposed = 0, sourceDisposed = 0, materialDisposed = 0;
  view.addEventListener('dispose', () => {viewDisposed++; assert.equal(Object.keys(view.attributes).length, 0); assert.equal(view.index, null);}); shared.addEventListener('dispose', () => sourceDisposed++); bank.material.addEventListener('dispose', () => materialDisposed++);
  f.visuals.sync('hall', 0, true); assert.equal(viewDisposed, 1); assert.equal(sourceDisposed, 0); assert.equal(materialDisposed, 0); originals.forEach(value => assert.equal(value.mesh.layers.mask, value.mask));
  f.visuals.sync('hall', .02, false); assert.equal(f.visuals.getStats().rollerInstanceSources, 26);
  f.visuals.sync('empty', 0, false); assert.equal(f.visuals.getStats().rollerInstanceSources, 0); originals.forEach(value => assert.equal(value.mesh.layers.mask, value.mask));
  f.visuals.dispose(); assert.equal(sourceDisposed, 0);

  // Arrays preserve cap groups and exact material ordering. An unsafe material,
  // mirrored instance or mutable steer buffer retains its ordinary draw path.
  const root = new THREE.Group(), parent = new THREE.Group(); root.add(parent);
  const geometry = new THREE.CylinderBufferGeometry(.1, .1, 1, 12), material = new THREE.MeshStandardMaterial({color: '#8899aa'}), cap = material.clone();
  const map = new Map(), meshes = [];
  for (let index = 0; index < 4; index++) {const mesh = new THREE.Mesh(geometry, [material, cap, cap]); mesh.position.x = index * .3; parent.add(mesh); map.set(mesh, {}); meshes.push(mesh);}
  const manager = new Batches(), raw = draws(root); manager.sync(root, map, {supported: true}); assert.equal(manager.batches.length, 1); assert.deepEqual(manager.batches[0].geometry.groups, geometry.groups); assert.equal(raw - draws(root), 9); assert.equal(manager.getStats().rollerDrawCallsAvoided, 9);
  const batches = manager.batches.slice(); meshes[0].material = [cap, material, cap]; manager.sync(root, map, {supported: true}); assert.equal(meshes[0].layers.mask, 1); assert(!manager.batches.includes(batches[0]));
  material.onBeforeCompile = () => {}; manager.sync(root, map, {supported: true}); assert.equal(manager.sources.length, 0); meshes.forEach(mesh => assert.equal(mesh.layers.mask, 1));
  material.staticInstanceBatchShader = material.onBeforeCompile; manager.invalidate(); manager.sync(root, map, {supported: true}); assert(manager.sources.length >= 2);
  manager.clear(); meshes[1].scale.x = -1; meshes[2].onBeforeRender = () => {}; manager.invalidate(); manager.sync(root, map, {supported: true}); assert.equal(manager.sources.length, 0); assert.equal(meshes[1].layers.mask, 1); assert.equal(meshes[2].layers.mask, 1);
  geometry.userData.industrialSteerRest = {}; manager.invalidate(); manager.sync(root, map, {supported: true}); assert.equal(manager.sources.length, 0);
  delete geometry.userData.industrialSteerRest; meshes[1].scale.x = 1; meshes[2].onBeforeRender = THREE.Object3D.prototype.onBeforeRender; manager.invalidate(); manager.sync(root, map, {supported: true}); assert(manager.sources.length > 0);
  manager.sync(root, map, {supported: false}); meshes.forEach(mesh => assert.equal(mesh.layers.mask, 1)); manager.dispose();
  const bulk = setup();
  for (let index = 1; index < 20; index++) {const actor = bulk.document.addPrefab('hall', 'conveyor'); actor.position.set((index % 4) * 5, 0, Math.floor(index / 4) * 3); bulk.records.set(actor.userData.editorId, {variables: Object.assign({}, bulk.beltVariables)});}
  bulk.root.updateMatrixWorld(true); const authoredDraws = draws(bulk.root); bulk.visuals.sync('hall', 0, false); const fullDraws = draws(bulk.root); bulk.visuals.rollerInstancing = true; bulk.visuals.sync('hall', .1, false);
  const measured = bulk.visuals.getStats(); assert.equal(measured.rollerInstanceSources, 520); assert.equal(measured.rollerInstanceBatches, 20); assert.equal(measured.rollerDrawCallsAvoided, 500); assert.equal(fullDraws - draws(bulk.root), 500); assert.equal(measured.rollerInstanceBytes, 33280);
  bulk.visuals.dispose(); assert.equal(draws(bulk.root), authoredDraws, 'Disposing live HMI wrappers and batches restores every ordinary authored mesh.');
  console.log('Roller instances: actual legacy prefab 26→1; twenty real conveyor prefabs 520→20 roller submissions (500 avoided, 33,280 instance bytes). Exact texture animation/local mechanism matrices, source raycasts/serialization/UVs, array groups, unsafe/mutable guards and reversible editing/room/disposal passed.');
}
run().catch(error => {console.error(error); process.exitCode = 1;});
