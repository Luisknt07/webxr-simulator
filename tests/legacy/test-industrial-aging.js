const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const materialSchema = require('../../packages/render-three/schema/materials'), wearSchema = require('../../packages/render-three/schema/wear'), {validateDocument} = require('../../apps/api/server/validation');
const read = file => fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-industrial-aging.js"), '..', file)), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const applyIndustrialFinishes = new Function('THREE', 'materialSchema', 'wearSchema', read("modules/logistica-industrial/functions/presentacion/runtime/IndustrialFinishes.js") + '\nreturn applyIndustrialFinishes;')(THREE, materialSchema, wearSchema);
const aging = new Function('THREE', 'materialSchema', 'wearSchema', 'applyIndustrialFinishes', read("modules/logistica-industrial/functions/presentacion/runtime/IndustrialAgingPresentation.js") + '\nreturn {applyIndustrialAging,ageIndustrialRecord,ageIndustrialFloorRecord};')(THREE, materialSchema, wearSchema, applyIndustrialFinishes);
const fixture = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-industrial-aging.js"), 'test-industrial-finishes.js')), 'utf8'), h = new Function('require', '__dirname', fixture.slice(0, fixture.indexOf('\nasync function run()')) + '\nreturn {h,Surface,Wear};')(require, __dirname);
const mats = node => Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
const machine = (doc, object) => doc.getBehaviors(object).filter(value => !['surfaceMaterial', 'surfaceWear'].includes(value.type));
function geometry(root) { const result = new Set(); root.traverse(node => { if (node.geometry && !node.userData.editorRuntimeHelper) result.add(node.geometry); }); return result; }
async function run() {
  const f = h.h.setup(), owners = [f.head];
  for (const type of ['source', 'processor', 'palletQueue']) owners.push(f.document.addPrefab('hall', type));
  const custom = f.document.addPrefab('hall', 'processor'); f.document.setBehaviors(custom, f.document.getBehaviors(custom).concat(materialSchema.normalizeMaterial({name: 'My exact custom finish', preset: 'paintedMetal', color: '#924f37', wear: .17})));
  const beforeCustom = JSON.stringify(f.document.getBehaviors(custom)), recipes = new Map(owners.map(object => [object, JSON.stringify(machine(f.document, object))])), originalGeometry = geometry(f.root);
  const protectedMaterials = new Map(); f.root.traverse(node => { if (node.userData.industrialButton || node.userData.industrialDisplay || node.userData.industrialTower || node.userData.industrialSensorLamp) protectedMaterials.set(node, node.material); });
  const result = aging.applyIndustrialAging(f.document, 'hall', owners.concat(custom));
  assert.equal(result.objects, 4); assert.equal(result.skippedCustom, 1); assert(result.layers >= 12 && result.stamps <= 40);
  assert.equal(JSON.stringify(f.document.getBehaviors(custom)), beforeCustom);
  assert.deepEqual(geometry(f.root), originalGeometry, 'Aging changes only typed coatings, with no replacement or extra mechanical geometry.');
  owners.forEach(object => {
    assert.equal(JSON.stringify(machine(f.document, object)), recipes.get(object));
    const rows = materialSchema.assignments(f.document.getBehaviors(object).find(value => value.type === 'surfaceMaterial'));
    assert(rows.every(row => row.name.startsWith('Industrial · ')));
    const layers = JSON.parse(f.document.getBehaviors(object).find(value => value.type === 'surfaceWear').layers);
    assert(layers.length >= 3 && layers.length <= 6); assert(layers.some(layer => layer.pattern === 'chipped') && layers.some(layer => layer.pattern === 'grime'));
    assert(layers.every(layer => layer.width <= .8 && layer.height <= .6 && layer.depth <= .08), 'Visible local wear cannot become a full-machine projection blanket.');
  });
  const processor = owners[2], assignments = materialSchema.assignments(f.document.getBehaviors(processor).find(value => value.type === 'surfaceMaterial'));
  assert(assignments.some(row => row.slot === 'part:Armario y pedestal Processor'), 'A previously unfinished Processor cabinet receives an editable generated paint finish.');
  const saved = await f.document.serialize(); validateDocument(saved, value => value);
  aging.applyIndustrialAging(f.document, 'hall', owners.concat(custom)); assert.equal(JSON.stringify(await f.document.serialize()), JSON.stringify(saved), 'The same usage pass is idempotent.');
  const legacyProcessor = f.document.getBehaviors(processor), legacySurface = legacyProcessor.find(value => value.type === 'surfaceMaterial');
  f.document.setBehaviors(processor, legacyProcessor.map(value => value.type === 'surfaceMaterial' ? materialSchema.fromAssignments(materialSchema.assignments(legacySurface).filter(row => row.slot !== 'part:Armario y pedestal Processor')) : value));
  aging.applyIndustrialAging(f.document, 'hall', [processor]); const upgradedLegacy = JSON.stringify(f.document.getBehaviors(processor));
  aging.applyIndustrialAging(f.document, 'hall', [processor]); assert.equal(JSON.stringify(f.document.getBehaviors(processor)), upgradedLegacy, 'An older generated Processor missing its cabinet finish receives one stable, idempotent cabinet assignment.');
  const errors = [], surfaces = new h.Surface(f.ctx, f.document, {}, message => errors.push(message)), wear = new h.Wear(f.ctx, f.document, {}, message => errors.push(message));
  await surfaces.sync('hall'); wear.sync('hall');
  protectedMaterials.forEach((material, node) => assert.equal(node.material, material));
  const projected = Array.from(wear.engine.states.values());
  assert(projected.filter(state => state.mesh.geometry.attributes.position.count > 0).length >= result.layers * .75, 'Real selected triangles produce clipped wear on the actual machine surfaces.');
  assert(projected.every(state => state.mesh.geometry.attributes.position.count < 15000), 'All wear projections have bounded geometry.');
  const stable = Object.assign({}, wear.engine.stats); for (let index = 0; index < 8; index++) { await surfaces.sync('hall'); wear.sync('hall'); }
  ['behaviorReads', 'boundsBuilds', 'inputTriangles', 'projections', 'textureBuilds'].forEach(key => assert.equal(wear.engine.stats[key], stable[key], 'Idle frames reuse clipped geometry and textures rather than regenerating wear.'));
  assert.deepEqual(errors, []); wear.dispose(); surfaces.dispose();
  const row = saved.rooms.hall.additions.find(value => value.id === processor.userData.editorId), copy = processor.clone(true), patch = aging.ageIndustrialRecord(row, copy);
  assert.equal(JSON.stringify(patch.record.behaviors.filter(value => !['surfaceMaterial', 'surfaceWear'].includes(value.type))), JSON.stringify(row.behaviors.filter(value => !['surfaceMaterial', 'surfaceWear'].includes(value.type))));
  const userLayer = {id: 'user-brush', pattern: 'rust', matrix: new THREE.Matrix4().toArray(), stamps: []}, floor = {behaviors: [{type: 'surfaceWear', enabled: true, layers: JSON.stringify([userLayer, {id: 'industrial-floor-v1-motor-oil', pattern: 'grime', matrix: new THREE.Matrix4().toArray(), stamps: []}])}]};
  const floorPatch = aging.ageIndustrialFloorRecord(floor), floorLayers = JSON.parse(floorPatch.record.behaviors[0].layers); assert.deepEqual(floorLayers[0], userLayer); assert.equal(floorLayers[1].roughness, .36); assert.equal(floorLayers[1].opacity, .64);
  console.log('Industrial aging: real localized chips/dirt/grease/rubbing, Processor cabinet coverage, strict custom/recipe/geometry preservation, bounded reusable projections, idempotence, JSON validation and floor-only generated wear migration passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
