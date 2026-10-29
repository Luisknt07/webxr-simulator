const __layout = require("../../tooling/layout.cjs");
// Actual authored prefabs, PBR maps, projected wear, real control events and
// disposable derived GPU resources. No project database or headset required.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const {authoredHex} = require('../support/material-test-colors');
const materialSchema = require('../../packages/render-three/schema/materials');
const wearSchema = require('../../packages/render-three/schema/wear');
const {validateDocument} = require('../../apps/api/server/validation');
function source(file) { return fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-industrial-finishes.js"), '..', file)), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''); }
const applyIndustrialFinishes = new Function('THREE', 'materialSchema', 'wearSchema', source("modules/logistica-industrial/functions/presentacion/runtime/IndustrialFinishes.js") + '\nreturn applyIndustrialFinishes;')(THREE, materialSchema, wearSchema);
const Surface = new Function('THREE', 'materialSchema', source("packages/tools/editor/src/SurfaceMaterialSystem.js").replace('default class SurfaceMaterialSystem', 'return class SurfaceMaterialSystem'))(THREE, materialSchema);
const fixture = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-industrial-finishes.js"), 'test-industrial-xr.js')), 'utf8');
const h = new Function('require', '__dirname', fixture.slice(0, fixture.indexOf('async function run()')) + '\nreturn {setup,advance,press,vars};')(require, __dirname);
const decalFixture = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-industrial-finishes.js"), 'test-wear-decals.js')), 'utf8');
const {DecalSystem} = new Function('require', '__dirname', decalFixture.slice(0, decalFixture.indexOf('\nasync function run()')) + '\nreturn {DecalSystem};')(require, __dirname);
const Wear = new Function('THREE', 'DecalSystem', 'wearSchema', source("packages/tools/editor/src/WearPaintSystem.js").replace('default class WearPaintSystem', 'return class WearPaintSystem'))(THREE, DecalSystem, wearSchema);
const mats = mesh => Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
function meshNamed(root, materialName) { let result; root.traverse(node => { if (!result && mats(node).some(material => material.name.includes(materialName))) result = node; }); assert(result, materialName); return result; }
function triangles(root) { let count = 0; root.traverse(node => { if (node.geometry && !node.userData.editorHelper && !node.userData.editorRuntimeHelper) count += (node.geometry.index ? node.geometry.index.count : node.geometry.attributes.position.count) / 3; }); return count; }
function disposed(value) { let count = 0; value.addEventListener('dispose', () => count++); return () => count; }

async function run() {
  const f = h.setup(), owners = [f.head];
  ['source', 'processor', 'palletQueue'].forEach((kind, index) => {
    const object = f.document.addPrefab('hall', kind); f.document.setTransform(object, {position: [15 + index * 7, 1.02, 0]}); owners.push(object);
  });
  const before = await f.document.serialize(), depth = f.document.undoStack.length, topology = triangles(f.root);
  const roller = meshNamed(f.head, 'Acero de los rodillos'), rollerMap = roller.material.map;
  const cable = meshNamed(f.head, 'Cable de alimentación'), reducer = meshNamed(f.head, 'Reductor de tornillo sin fin');
  const sourceDeck = meshNamed(owners[1], 'Mesa de próxima carga');
  const protectedMeshes = new Map(), originals = new Map();
  f.root.traverse(node => {
    if (node.material) originals.set(node, node.material);
    if (node.userData.industrialButton || node.userData.industrialDisplay || node.userData.industrialSensorLamp || node.userData.industrialTower) protectedMeshes.set(node, node.material);
  });
  const result = applyIndustrialFinishes(f.document, 'hall', owners);
  assert.equal(result.objects.length, 4); assert.equal(result.wearLayers, 4); assert.equal(result.decals, 4);
  assert.equal(f.document.undoStack.length, depth + 1, 'The full finish pass is one reversible authoring action.');
  assert.equal(triangles(f.root), topology, 'Authoring finishes add no mechanical geometry.');
  owners.forEach(owner => {
    const config = f.document.getBehaviors(owner).find(value => value.type === 'surfaceMaterial'), rows = materialSchema.assignments(config);
    assert(rows.length <= 32 && rows.length > 1); assert(rows.every(value => value.slot !== 'all'), 'No finish blankets a machine with one material.');
    assert(f.document.getBehaviors(owner).some(value => value.type === 'surfaceWear'));
  });
  assert(!f.document.getBehaviors(f.tail).some(value => value.type === 'surfaceMaterial'), 'Only explicitly requested equipment receives finishes.');
  const authored = await f.document.serialize(), saved = validateDocument(authored, value => value);
  const unchanged = JSON.stringify(authored), again = applyIndustrialFinishes(f.document, 'hall', owners);
  assert.equal(again.objects.length, 0); assert.equal(again.skipped.length, 4);
  assert.equal(JSON.stringify(await f.document.serialize()), unchanged, 'Repeated application preserves existing custom materials and brush edits exactly.');

  const errors = [], surfaces = new Surface(f.ctx, f.document, {}, value => errors.push(value));
  const wear = new Wear(f.ctx, f.document, {}, value => errors.push(value));
  await surfaces.sync('hall'); wear.sync('hall');
  assert.equal(roller.material.metalness, .86); assert.equal(roller.material.roughness, .36);
  assert.strictEqual(roller.material.map.image, rollerMap.image, 'The real rolling colour texture remains available for animated rollers.');
  assert(roller.material.bumpMap.isDataTexture && roller.material.roughnessMap.isDataTexture);
  assert.equal(roller.material.bumpMap.encoding, THREE.LinearEncoding);
  assert.equal(roller.material.bumpMap.image.data.length, 128 * 128 * 4);
  assert.equal(cable.material.metalness, 0); assert(cable.material.roughness >= .9);
  assert.equal(authoredHex(reducer.material.color), '285991');
  assert(sourceDeck.material.roughness >= .7, 'The Source table remains matte.');
  protectedMeshes.forEach((material, mesh) => assert.strictEqual(mesh.material, material));
  const projected = Array.from(wear.engine.states.values());
  assert.equal(projected.length, 4);
  assert(projected.every(state => state.mesh.geometry.attributes.position.count > 0), 'Each editable scratch decal is clipped onto a real machine surface.');
  assert(projected.every(state => state.mesh.geometry.attributes.position.count < 300), 'Small default scratches keep a bounded geometry cost.');
  const maps = new Set(), derived = new Set();
  surfaces.states.forEach(state => state.groups.forEach(group => {
    group.textures.forEach(map => maps.add(map)); group.materials.forEach(material => derived.add(material));
  }));
  assert(maps.size < result.assignments * 2, 'Equal finish assignments share private procedural maps inside each equipment owner.');
  const releases = Array.from(maps, disposed), materialReleases = Array.from(derived, disposed);
  const wearResources = projected.flatMap(state => [state.mesh.geometry, state.material].concat(state.proceduralTextures));
  const wearReleases = wearResources.map(disposed);
  const stable = Object.assign({}, wear.engine.stats), stableSurface = Object.assign({}, surfaces.stats);
  for (let index = 0; index < 6; index++) { await surfaces.sync('hall'); wear.sync('hall'); }
  ['projections', 'textureBuilds', 'boundsBuilds', 'inputTriangles'].forEach(key => assert.equal(wear.engine.stats[key], stable[key]));
  assert.deepEqual(surfaces.stats, stableSurface, 'Idle frames reuse materials, textures and clipped wear.');
  f.runtime.start('hall'); h.advance(f); h.press(f, 'powerOn', f.left); h.press(f, 'start', f.right);
  assert(h.vars(f).running); h.press(f, 'pause', f.left); assert(h.vars(f).paused);
  f.visuals.dispose(); f.runtime.stop();
  wear.dispose(); surfaces.dispose();
  releases.concat(materialReleases, wearReleases).forEach(count => assert.equal(count(), 1, 'Every privately owned GPU resource is disposed exactly once.'));
  originals.forEach((material, mesh) => assert.strictEqual(mesh.material, material));
  assert.equal(errors.length, 0); assert.equal(triangles(f.root), topology);
  assert.equal(JSON.stringify(await f.document.serialize()), unchanged);
  // Discard the no-op retry action if the document implementation recorded it.
  while (f.document.undoStack.length > depth + 1) f.document.undo();
  f.document.undo(); assert.deepEqual(await f.document.serialize(), before);
  f.document.redo();
  const reopened = h.setup(); await reopened.document.load(saved);
  const restored = reopened.document.getObject(owners[0].userData.editorId);
  assert.deepEqual(reopened.document.getBehaviors(restored), f.document.getBehaviors(owners[0]), 'Typed part selections and brush layers survive a complete document reopen.');
  console.log('Industrial finishes: persisted steel/paint/rubber/wood/glass parts, original controls and roller pixels, matte Source, bounded reusable microdetail/decal resources, physical XR controls, exact GPU cleanup, undo and reopen passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
