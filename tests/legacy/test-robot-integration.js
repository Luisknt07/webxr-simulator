const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const THREE = require('three');
const behaviors = require('../../modules/logistica-industrial/contracts/behaviors.js');
const materialSchema = require('../../packages/render-three/schema/materials.js');
const robots = require('../../modules/logistica-industrial/functions/robots/schema/robots.js');
const {validateDocument} = require('../../apps/api/server/validation.js');
const {ProjectStore} = require('../../apps/api/server/storage.js');
const {authoredHex} = require('../support/material-test-colors.js');
const RobotPrefabs = require('../support/load-robot-prefabs.js')(THREE);
const source = relative => fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-robot-integration.js"), '..', relative)), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const {createIndustrialPrefab} = new Function('THREE', 'behaviorSchema', 'require', source("modules/logistica-industrial/functions/presentacion/runtime/IndustrialPrefabs.js") + '\nreturn {createIndustrialPrefab};')
  (THREE, behaviors, RobotPrefabs.resolve);
const SceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', source("packages/project-model/src/SceneDocument.js").replace('default class SceneDocument', 'return class SceneDocument'))(THREE, behaviors, createIndustrialPrefab);
const SurfaceMaterials = new Function('THREE', 'materialSchema', source("packages/tools/editor/src/SurfaceMaterialSystem.js").replace('default class SurfaceMaterialSystem', 'return class SurfaceMaterialSystem'))(THREE, materialSchema);
function document() {
  const result = new SceneDocument({}); result.registerRoom('hall', new THREE.Group()); result.registerRoom('sound', new THREE.Group()); return result;
}
const robotConfig = (doc, actor) => doc.getBehaviors(actor).find(config => config.type === 'robot');
function hardware(doc, actor) {
  return Array.from(doc.additions.get(actor.userData.editorId).nodes.values()).filter(node => doc.getBehaviors(node).some(config => config.type === 'control'));
}
function mesh(root, role) { let found; root.traverse(node => { if (!found && node.isMesh && node.userData.industrialMaterialRole === role) found = node; }); return found; }
function resources(root) {
  const geometries = new Set(), materials = new Set(); root.traverse(node => { if (node.geometry) geometries.add(node.geometry); if (node.material) materials.add(node.material); }); return {geometries, materials};
}
async function run() {
  const doc = document(), actors = [];
  for (const definition of robots.VARIANTS) {
    const actor = doc.addPrefab('hall', 'robot', definition.id), visual = actor.children[0], config = robotConfig(doc, actor);
    actors.push(actor); assert.equal(config.family, definition.family); assert.equal(config.variant, definition.id);
    assert.equal(visual.userData.robotRig.config.family, definition.family); assert.equal(visual.children[0].userData.robotVisual, true);
    assert.equal(visual.children[1].children[1].userData.industrialRobotDisplay, true);
    const controls = hardware(doc, actor); assert.ok(controls.length >= 8);
    for (const control of controls) assert.equal(doc.getBehaviors(control).find(config => config.type === 'control').targetId, actor.userData.editorId, 'All physical desktop/XR controls target their own robot actor');
    assert.ok(controls.some(control => doc.getBehaviors(control).some(config => config.command === 'dispatch')));
    assert.ok(!controls.some(control => doc.getBehaviors(control).some(config => config.command === 'insertBox')), 'Robot cycles must not create conveyor cartons');
  }
  const actor = actors[0], visual = actor.children[0], firstPanel = visual.children[1], firstControls = hardware(doc, actor);
  const independent = actors[1], independentResources = resources(independent);
  const originalConfig = robotConfig(doc, actor), revised = Object.assign({}, originalConfig, {reach: originalConfig.reach + .55, wear: .6, frameColor: '#8a382b', withPanel: false});
  doc.setBehaviors(actor, [revised, behaviors.defaultBehavior('analytics')]);
  assert.equal(visual.children[1], firstPanel); assert.equal(firstPanel.visible, false); assert.equal(visual.userData.robotRig.config.reach, revised.reach);
  assert.deepEqual(hardware(doc, actor), firstControls, 'Rebuilding parametric parts preserves control node paths, IDs and authored references');
  assert.equal(mesh(visual.children[0], 'frame').material.userData.studioColorSpace, 'linear');
  assert.equal(authoredHex(mesh(visual.children[0], 'frame').material.color), '8a382b');
  const changedResources = resources(actor); for (const key of Object.keys(changedResources)) for (const resource of changedResources[key]) assert.equal(independentResources[key].has(resource), false);

  const snapshot = doc.captureObject(actor), copy = await doc.pasteObject(snapshot, 'sound', 2);
  assert.notEqual(copy.userData.editorId, actor.userData.editorId); assert.deepEqual(robotConfig(doc, copy), revised);
  for (const control of hardware(doc, copy)) assert.equal(doc.getBehaviors(control).find(config => config.type === 'control').targetId, copy.userData.editorId);
  const copyResources = resources(copy); for (const key of Object.keys(changedResources)) for (const resource of changedResources[key]) assert.equal(copyResources[key].has(resource), false);

  // A family/model edit must update the persisted factory recipe as well as
  // the current render rig, so reopening never recreates the previous model.
  const scara = robots.normalize(Object.assign({}, robots.defaults('scara'), {type: 'robot', reach: 1.35, wear: .4, withPanel: true}));
  doc.setBehaviors(copy, [scara]);
  assert.equal(copy.children[0].userData.robotRig.config.family, 'scara');
  assert.equal(doc.additions.get(copy.userData.editorId).descriptor.variant, 'scara');
  assert.equal(copy.userData.editorDescriptor.variant, 'scara');

  const system = new SurfaceMaterials({}, doc, {}), frame = mesh(actor.children[0].children[0], 'frame'), accent = mesh(actor.children[0].children[0], 'accent');
  const accentMaterial = accent.material, geometry = frame.geometry, robotBeforeMaterials = robotConfig(doc, actor);
  const partSlot = system.getSlots(actor).find(row => row.value === 'name:' + frame.material.name); assert.ok(partSlot);
  const finish = materialSchema.normalizeMaterial({type: 'surfaceMaterial', slot: partSlot.value, name: 'Pintura personalizada del bastidor', color: '#185b89', colorMapMode: 'none', preset: 'paintedMetal', wear: .7});
  doc.setBehaviors(actor, [robotBeforeMaterials, finish]); await system.sync('hall');
  assert.equal(frame.geometry, geometry, 'Appearance edits do not add CAD tessellation or rebuild mechanics');
  assert.equal(authoredHex(frame.material.color), '185b89'); assert.equal(accent.material, accentMaterial, 'Per-part paint preserves joint/rubber finishes');
  assert.deepEqual(robotConfig(doc, actor), robotBeforeMaterials); assert.equal(hardware(doc, actor)[0], firstControls[0]);
  assert.ok(!Object.keys(actor.children[0].userData).includes('robotRig'), 'Runtime object references are not document fields');

  const saved = await doc.serialize(); assert.doesNotThrow(() => validateDocument(saved, value => value));
  const reopened = document(); await reopened.load(saved); assert.deepEqual(await reopened.serialize(), saved);
  const restored = reopened.getObjects('sound').find(node => node.userData.editorId === copy.userData.editorId);
  assert.equal(robotConfig(reopened, restored).family, 'scara'); assert.equal(restored.children[0].userData.robotRig.joints.length, 4);
  for (const control of hardware(reopened, restored)) assert.equal(reopened.getBehaviors(control).find(config => config.type === 'control').targetId, restored.userData.editorId);
  const dir = fs.mkdtempSync(__layout.map(path.join(os.tmpdir(), 'robot-integration-')));
  let store;
  try {
    store = new ProjectStore({dataDir: dir});
    const project = store.saveProject(null, {name: 'Robots integrados', document: saved});
    const loaded = store.getProject(project.id); assert.deepEqual(loaded.document, saved);
  } finally {
    if (store) store.close();
    assert.equal(path.dirname(__layout.map(path.resolve(dir))), __layout.map(path.resolve(os.tmpdir())));
    fs.rmSync(dir, {recursive: true, force: true});
  }
  system.dispose();
  console.log('Robot integration: ' + robots.VARIANTS.length + ' real catalogue rigs, panel bindings, dimensional/model refresh, isolated per-part PBR wear, cross-room copy, server validation and SQLite roundtrip passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
