'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const schema = require('../shared/behaviors'), materials = require('../shared/materials');
const read = file => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const Batches = new Function('THREE', read('editor/StaticArchitectureBatches.js').replace('default class StaticArchitectureBatches', 'return class StaticArchitectureBatches'))(THREE);
const build = new Function('THREE', 'schema', read('editor/IndustrialCediEnvironment.js') + '\nreturn buildCediEnvironment;')(THREE, schema);
const SurfaceMaterials = new Function('THREE', 'materialSchema', read('editor/SurfaceMaterialSystem.js').replace('default class SurfaceMaterialSystem', 'return class SurfaceMaterialSystem'))(THREE, materials);
const fixtureText = fs.readFileSync(path.join(__dirname, 'test-industrial-lab-lines.js'), 'utf8');
const {harness, releaseGeometry} = new Function('require', '__dirname', fixtureText.slice(0, fixtureText.indexOf('\nasync function run()')) + '\nreturn {harness,releaseGeometry};')(require, __dirname);
const {getGeometryTree} = require('./load-geometry-acceleration')(THREE);
const CollisionWorld = new Function('THREE', 'getGeometryTree', read('lib/CollisionWorld.js').replace('default class CollisionWorld', 'return class CollisionWorld'))(THREE, getGeometryTree);
const visible = object => {for (let node = object; node; node = node.parent) if (!node.visible) return false; return true;};
const drawCount = root => {let draws = 0; root.traverse(mesh => {if (mesh.isMesh && visible(mesh) && mesh.layers.mask & 1) draws++;}); return draws;};
const meshOf = owner => owner.children.find(mesh => mesh.isMesh);
const nearArray = (a, b, tolerance = 1e-5) => assert(a.length === b.length && a.every((value, i) => Math.abs(value - b[i]) < tolerance));
async function run() {
  const f = harness.setup(), building = build(f.document, 'hall', {width: 72, depth: 120, centerZ: -15});
  f.root.rotation.y = .18; f.root.scale.set(1.1, .95, 1.05); f.root.position.set(2, 0, -1); f.scene.updateMatrixWorld(true);
  const manager = new Batches(f.document), before = await f.document.serialize(), originals = new Map();
  building.objects.forEach(owner => owner.traverse(mesh => {if (mesh.isMesh) originals.set(mesh, {geometry: mesh.geometry, material: mesh.material, mask: mesh.layers.mask, visible: mesh.visible, positions: mesh.geometry.attributes.position.array.slice(), uv: mesh.geometry.attributes.uv.array.slice()});}));
  const world = new CollisionWorld(f.ctx, f.document); world.setRoom('hall');
  const start = f.root.localToWorld(new THREE.Vector3(33, 1.6, -15)), end = f.root.localToWorld(new THREE.Vector3(39, 1.6, -15));
  const physicalCount = world.entries.length, blocked = world.rayBlocked(start, end), movement = world.moveSphere(start, end, .2).toArray(); assert(blocked);
  const ray = new THREE.Raycaster(start, end.clone().sub(start).normalize(), 0, start.distanceTo(end));
  const hits = () => ray.intersectObject(f.root, true).filter(hit => !hit.object.userData.editorRuntimeHelper);
  const rayBefore = hits().map(hit => [hit.object, hit.distance]); assert(rayBefore.length);
  const baseline = drawCount(f.root); manager.sync('hall'); const reduced = drawCount(f.root), stats = manager.getStats();
  assert(stats.architectureSources > 30 && stats.architectureDrawCallsAvoided > 20, JSON.stringify(stats)); assert(reduced < baseline - 20);
  assert.equal(baseline - reduced, stats.architectureDrawCallsAvoided); assert.equal(stats.architectureInstanceBytes, stats.architectureSources * 64);
  assert.equal(stats.architectureChunkSize, 32); assert(manager.batches.every(batch => batch.frustumCulled && batch.userData.editorRuntimeHelper));
  for (const batch of manager.batches) {
    assert(!Object.values(batch.geometry.attributes).includes(batch.instanceMatrix), 'Instance matrices are owned and released by the central renderer lifecycle.');
    assert([...originals.values()].some(value => value.geometry.attributes.position === batch.geometry.attributes.position), 'Instance geometry borrows original vertex backing stores.');
    assert(batch.count >= 2); const matrix = new THREE.Matrix4();
    for (let index = 0; index < batch.count; index++) {
      batch.getMatrixAt(index, matrix); const local = batch.geometry.boundingBox.clone();
      const worldMatrix = new THREE.Matrix4().multiplyMatrices(f.root.matrixWorld, matrix);
      assert(manager.sources.some(source => worldMatrix.elements.every((value, at) => Math.abs(value - source.mesh.matrixWorld.elements[at]) < 1e-5)), 'Every displayed instance retains one actual architectural world transform.');
      const box = new THREE.Box3(new THREE.Vector3(-.5, -.5, -.5), new THREE.Vector3(.5, .5, .5)).applyMatrix4(matrix);
      assert(local.clone().expandByScalar(.0001).containsBox(box), 'Real instance bounds are covered by the batch culling volume.');
      const point = new THREE.Vector3(.5, .5, .5).applyMatrix4(matrix).applyMatrix4(f.root.matrixWorld);
      assert(point.toArray().every(Number.isFinite));
    }
  }
  // Masks change renderer submissions, never the actual physical/picking mesh.
  world.invalidate(); world.refresh(); assert.equal(world.entries.length, physicalCount); assert.equal(world.rayBlocked(start, end), blocked);
  nearArray(world.moveSphere(start, end, .2).toArray(), movement);
  const afterHits = hits(); assert.equal(afterHits.length, rayBefore.length); afterHits.forEach((hit, i) => {assert(hit.object === rayBefore[i][0]); assert(Math.abs(hit.distance - rayBefore[i][1]) < 1e-7);});
  assert.deepEqual(await f.document.serialize(), before, 'Batching is absent from saved authoring and history.');
  originals.forEach((saved, mesh) => {assert(mesh.geometry === saved.geometry && mesh.material === saved.material); assert.equal(mesh.visible, saved.visible); assert.deepEqual(mesh.geometry.attributes.position.array, saved.positions); assert.deepEqual(mesh.geometry.attributes.uv.array, saved.uv);});
  const rebuilds = manager.getStats().architectureRebuilds; for (let i = 0; i < 30; i++) manager.sync('hall');
  assert.equal(manager.getStats().architectureRebuilds, rebuilds, 'Steady frames reuse their derived instances.');
  const source = manager.sources[0], owner = source.owner; owner.position.x += .3; manager.sync('hall'); assert.equal(manager.getStats().architectureRebuilds, rebuilds + 1);
  owner.position.x -= .3; manager.sync('hall');
  const sourceMaterial = manager.sources[0].mesh.material; sourceMaterial.color.r *= .9; manager.sync('hall'); assert(manager.getStats().architectureRebuilds > rebuilds + 1, 'An independent current material edit invalidates equivalence.');
  const privateGeometries = manager.batches.map(batch => batch.geometry); let disposed = 0;
  privateGeometries.forEach(geometry => geometry.addEventListener('dispose', () => {disposed++; assert.deepEqual(Object.keys(geometry.attributes), []); assert.equal(geometry.index, null);}));
  manager.sync('hall', {editing: true}); assert.equal(disposed, privateGeometries.length); assert.equal(manager.sources.length, 0); originals.forEach((saved, mesh) => assert.equal(mesh.layers.mask, saved.mask));
  assert.equal(drawCount(f.root), baseline, 'Entering the editor restores every original primitive, including shadows and picking.');
  manager.dispose(); releaseGeometry(f);

  // Real final surface materials either carry an explicit safe shader token or
  // remain independent. Plain callbacks alone never authorize custom closures.
  const real = harness.setup(), shell = build(real.document, 'hall', {width: 72, depth: 120}), surface = new SurfaceMaterials(real.ctx, real.document, {});
  await surface.sync('hall'); const live = new Batches(real.document); live.sync('hall');
  assert(live.getStats().architectureDrawCallsAvoided >= 4, JSON.stringify(live.getStats()));
  const protectedOwners = shell.objects.filter(owner => real.document.getBehaviors(owner).some(value => ['surfaceWear', 'teleport'].includes(value.type)));
  protectedOwners.forEach(owner => assert.equal(meshOf(owner).layers.mask, 1, 'Projected weathering and floor teleportation retain their original render object.'));
  const glass = shell.walls.filter(owner => /Ventana/.test(owner.name)); glass.forEach(owner => assert.equal(meshOf(owner).layers.mask, 1));
  const pair = [];
  for (let i = 0; i < 2; i++) {const owner = real.document.addPrimitive('hall', 'box', '#456789'); real.document.setProperty(owner, 'name', 'CEDI · prueba protegida'); real.document.setTransform(owner, {position: [i * 2, 1, 0]}); const mesh = meshOf(owner); mesh.material.onBeforeCompile = () => {}; pair.push(owner);}
  live.invalidate(); live.sync('hall'); pair.forEach(owner => assert.equal(meshOf(owner).layers.mask, 1, 'Unproven custom shaders are not batched.'));
  pair[0].scale.x = -1; meshOf(pair[0]).material.onBeforeCompile = THREE.Material.prototype.onBeforeCompile;
  live.invalidate(); live.sync('hall'); assert.equal(meshOf(pair[0]).layers.mask, 1, 'Mirrored instanced winding stays on the exact original renderer path.');
  pair[0].scale.x = 1;
  const whole = await real.document.serialize(); live.sync('sound'); assert.equal(live.sources.length, 0); assert.deepEqual(await real.document.serialize(), whole);
  live.dispose(); surface.dispose(); releaseGeometry(real);
  console.log('Static architecture batches: ' + baseline + '→' + reduced + ' actual submissions, shared attribute backing stores, bounded spatial instances, exact original physics/raycast/UV/TRS/material edits, safe shader/transparent guards and owned GPU disposal passed.');
}
run().catch(error => {console.error(error); process.exitCode = 1;});
