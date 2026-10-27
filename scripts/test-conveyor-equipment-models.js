// Real procedural models, the existing SceneDocument and production feedback
// renderer. Only canvas/WebGL are adapted; no physical headset is asserted.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const schema = require('../shared/behaviors');
const equipment = require('../shared/conveyor-equipment');
const {validateDocument} = require('../server/validation');
const source = name => fs.readFileSync(path.join(__dirname, '../src/editor', name), 'utf8').replace(/^import .*;\r?\n/gm, '');
const createIndustrialPrefab = new Function('THREE', 'behaviorSchema', source('IndustrialPrefabs.js').replace(/^export const /gm, 'const ').replace(/^export function /gm, 'function ') + '\nreturn createIndustrialPrefab;')(THREE, schema);
const SceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', source('SceneDocument.js').replace('export default class SceneDocument', 'return class SceneDocument'))(THREE, schema, createIndustrialPrefab);
const IndustrialVisuals = new Function('THREE', source('IndustrialVisuals.js').replace('export default class IndustrialVisuals', 'return class IndustrialVisuals'))(THREE);
const near = (actual, expected, tolerance = 1e-5) => assert(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const persisted = value => JSON.parse(JSON.stringify(value, (key, field) => typeof field === 'number' ? Math.round(field * 1e12) / 1e12 : field));
function nodes(root, predicate) { const result = []; root.traverse(node => { if (predicate(node)) result.push(node); }); return result; }
function budget(root) {
  let meshes = 0, triangles = 0;
  root.traverse(node => { if (node.isMesh) { meshes++; triangles += (node.geometry.index ? node.geometry.index.count : node.geometry.attributes.position.count) / 3; } });
  return {meshes, triangles};
}
function dispose(root) {
  const resources = new Set();
  root.traverse(node => { if (node.geometry) resources.add(node.geometry); for (const material of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) { resources.add(material); Object.values(material).forEach(value => { if (value && value.isTexture) resources.add(value); }); } });
  resources.forEach(resource => resource.dispose());
}
function panelShape(panel) {
  const result = [];
  const visit = (node, index) => {
    result.push({index, name: node.name, position: node.position.toArray(), quaternion: node.quaternion.toArray(), scale: node.scale.toArray(),
      geometry: node.geometry && {type: node.geometry.type, parameters: node.geometry.parameters && JSON.parse(JSON.stringify(node.geometry.parameters, (key, value) => key === 'uuid' ? undefined : value))},
      material: node.material && {type: node.material.type, color: node.material.color.getHexString(), roughness: node.material.roughness, metalness: node.material.metalness},
      control: node.userData.editorDefaultBehaviors, action: node.userData.industrialAction});
    node.children.forEach((child, i) => visit(child, index + '.' + i));
  };
  // Panel root placement is an equipment anchor; its internal proportions,
  // colors, labels, nine command IDs and event configurations are immutable.
  panel.children.forEach((child, index) => visit(child, String(index)));
  return result;
}
function top(root, point, expected, tolerance = 0.001) {
  root.updateWorldMatrix(true, true);
  const hits = new THREE.Raycaster(new THREE.Vector3(point.x, expected + 0.4, point.z), new THREE.Vector3(0, -1, 0), 0, 0.5).intersectObject(root, true);
  assert(hits.length, 'The product path needs a real supporting surface.'); near(hits[0].point.y, expected, tolerance);
}
function fixture(variant) {
  const doc = new SceneDocument({}), scene = new THREE.Group(); doc.registerRoom('hall', scene);
  const object = doc.addPrefab('hall', 'conveyor', variant);
  doc.setTransform(object, {position: [0, 0, 0]});
  const config = doc.getBehaviors(object).find(config => config.type === 'conveyor');
  const variables = Object.assign({}, config, {powered: true, running: true, actualSpeed: 0.4, actuatorPosition: 0, actuatorAngle: 0, elevatorPosition: 0});
  const simulation = {running: true, records: new Map([[object.userData.editorId, {variables}]])};
  const visuals = new IndustrialVisuals({}, doc, simulation); scene.updateMatrixWorld(true); visuals.sync('hall', 0, false);
  return {doc, scene, object, content: object.children[0], config, variables, visuals};
}

async function run() {
  const original = createIndustrialPrefab('conveyor', 'roller-start'), originalPanel = panelShape(original.children[6]);
  const metrics = [];
  for (const definition of equipment.listEquipment({readyOnly: true})) {
    const root = createIndustrialPrefab('conveyor', definition.variant);
    const config = root.userData.editorDefaultBehaviors.find(config => config.type === 'conveyor');
    assert.equal(config.equipmentId, definition.id); assert.equal(config.equipmentVersion, definition.version);
    assert.equal(root.children.length, 11, 'Ten legacy slots remain stable; new equipment reserves its lateral sensor actor at slot 10.');
    assert.deepEqual(panelShape(root.children[6]), originalPanel, definition.variant + ': preserve the actual nine-command panel.');
    const measured = budget(root); metrics.push({id: definition.id, family: definition.family, variant: definition.variant, name: definition.name, ...measured});
    assert(measured.meshes < 150 && measured.triangles < 30000, definition.variant + ': bounded WebXR mesh/triangle cost.');
    root.updateMatrixWorld(true); near(new THREE.Box3().setFromObject(root).min.y, -1);
    if (config.drive === 'gravity' || config.drive === 'manual') {
      assert.equal(root.children[3].visible, false); assert.equal(root.children[6].visible, false);
      assert(!nodes(root, node => node.isMesh && /motor/i.test(node.material.name)).some(node => {
        for (let parent = node; parent; parent = parent.parent) if (!parent.visible) return false;
        return true;
      }), 'Unpowered equipment has no visible motor.');
    }
    assert(root.children[7].children.length === 0 && root.children[8].children.length === 0 && root.children[9].children.length === 0);
    assert.equal(root.children[10].userData.industrialBranchSensor, true);
    assert.equal(root.children[10].visible, config.layout === 'tee' && config.withSensors);
    assert(root.children[10].userData.editorDefaultBehaviors.some(behavior => behavior.type === 'sensor' && behavior.sourceId === '@root'));
    const length = schema.conveyorLayout.pathLength(config);
    if (['inclined', 'curved'].includes(definition.family)) {
      const count = Math.max(2, Math.ceil(length / config.rollerPitch));
      const distance = config.surface === 'rollers' ? 0.10 + (length - 0.20) * Math.floor(count / 2) / (count - 1) : length * 0.31;
      const p = schema.conveyorLayout.pathPoint(config, distance);
      top(root.children[2], p, p.y || 0, config.cleats ? 0.07 : 0.001);
      const entry = schema.conveyorLayout.pathPoint(config, Math.min(0.45, length * 0.2));
      near(root.children[4].position.y, entry.y + 0.18);
      near(root.children[6].position.y, 0.28);
    }
    if (config.surface === 'chains' && config.mechanism === 'transport') {
      const chains = nodes(root.children[2], node => node.name === 'Cadena portapallet');
      assert.equal(chains.length, 3, 'Pallet support comprises three actual chain tracks.');
      for (const lateral of [-0.34, 0, 0.34]) top(root.children[2], {x: 0, z: config.width * lateral}, 0);
    }
    if (config.mechanism === 'zones') {
      const count = Math.ceil(config.length / config.zoneLength);
      assert.equal(nodes(root, node => Number.isInteger(node.userData.industrialZoneLamp)).length, count);
      assert.equal(nodes(root, node => node.userData.industrialSignal && node.userData.industrialSignal.type === 'presence').length, count);
      const surfaces = nodes(root.children[2], node => node.userData.industrialBelt || node.userData.industrialRoller);
      assert.equal(new Set(surfaces.map(node => (node.userData.industrialBelt || node.userData.industrialRoller).zone)).size, count);
    }
    const savedRootActors = root.children.slice(3, 10), config2 = Object.assign({}, config, {width: config.width + 0.1, length: config.length + 0.2});
    createIndustrialPrefab.refresh(root, config2); assert.deepEqual(root.children.slice(3, 10), savedRootActors, 'Dimension changes preserve editable actors.');
    dispose(root);
  }
  dispose(original);
  for (const variant of ['popup-belt', 'popup-chain', 'roller-turntable', 'pallet-turntable', 'pusher', 'steer', 'box-elevator', 'pallet-elevator', 'cleated-incline']) {
    const f = fixture(variant), before = await f.doc.serialize();
    assert(f.visuals.mechanisms.size > 0, variant + ': real animated components exist.');
    f.variables.actuatorPosition = 1; f.variables.actuatorAngle = Math.PI / 2; f.variables.elevatorPosition = f.config.rise; f.variables.actuatorStroke = 1.75;
    f.visuals.sync('hall', 0.1, false);
    for (const entry of f.visuals.mechanisms.values()) {
      if (entry.motion.kind === 'lift') near(entry.object.position.y, 0.055);
      if (entry.motion.kind === 'turntable' || entry.motion.kind === 'steer') {
        const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(entry.object.quaternion); near(forward.x, 0); near(forward.z, -1);
      }
      if (entry.motion.kind === 'elevator') near(entry.object.position.y, f.config.rise);
      if (entry.motion.kind === 'pusher') near(Math.abs(entry.object.position.z - entry.rest.z), 1.75);
    }
    if (f.config.mechanism === 'turntable') top(f.content.children[2], {x: 0, z: -f.config.length / 2 + 0.1}, 0);
    if (f.config.mechanism === 'elevator') top(f.content.children[2], {x: -f.config.length / 2 + 0.1, z: 0}, f.config.rise);
    assert.deepEqual(await f.doc.serialize(), before, 'Live mechanism poses never overwrite authored transforms.');
    f.visuals.sync('hall', 0.1, true);
    for (const entry of f.visuals.mechanisms.values()) { assert(entry.object.position.equals(entry.rest)); assert(entry.object.quaternion.equals(entry.rotation)); }
    f.visuals.dispose(); dispose(f.scene);
  }
  for (const variant of ['roller-zones', 'belt-zones']) {
    const f = fixture(variant);
    f.variables.zone1Occupied = true; f.variables.zone1Speed = 0; f.variables.zone2Occupied = false; f.variables.zone2Speed = 0.4;
    f.visuals.sync('hall', 0, false);
    const surfaces = [...f.visuals.rollers.values(), ...f.visuals.belts.values()];
    const zone1 = surfaces.find(entry => entry.zone === 0), zone2 = surfaces.find(entry => entry.zone === 1);
    assert(zone1 && zone2); assert.notEqual(zone1.surfaces[0].texture, zone2.surfaces[0].texture, 'Zones own independent animation textures.');
    const first = zone1.surfaces[0].texture.offset.x, second = zone2.surfaces[0].texture.offset.x;
    f.visuals.sync('hall', 0.1, false); near(zone1.surfaces[0].texture.offset.x, first);
    assert.notEqual(zone2.surfaces[0].texture.offset.x, second, 'An available zone can move while another remains stopped.');
    const lamp1 = f.visuals.bindings.find(binding => binding.kind === 'zone' && binding.zone === 0);
    const lamp2 = f.visuals.bindings.find(binding => binding.kind === 'zone' && binding.zone === 1);
    assert.equal(lamp1.entry.privateMaterials[0].color.getHexString(), 'ffc356'); assert.equal(lamp2.entry.privateMaterials[0].color.getHexString(), '42e4a4');
    f.visuals.dispose(); dispose(f.scene);
  }
  const gravity = fixture('roller-gravity');
  gravity.variables.powered = false; gravity.variables.running = false; gravity.variables.actualSpeed = 0.3;
  const gravityRoller = Array.from(gravity.visuals.rollers.values())[0], gravityOffset = gravityRoller.surfaces[0].texture.offset.x;
  gravity.visuals.sync('hall', 0.1, false);
  assert.notEqual(gravityRoller.surfaces[0].texture.offset.x, gravityOffset, 'Gravity-driven contact rotates rollers without electric power or a hidden run command.');
  gravity.visuals.dispose(); dispose(gravity.scene);
  const zonePreset = Object.assign({type: 'conveyor'}, equipment.getDefinition('belt-zones').preset, {length: 6.4, zoneLength: 0.2});
  const maximumZones = schema.normalizeBehaviors([zonePreset])[0], maximumZoneModel = createIndustrialPrefab('conveyor', 'belt-zones', maximumZones);
  assert.equal(nodes(maximumZoneModel, node => Number.isInteger(node.userData.industrialZoneLamp)).length, 32);
  assert.equal(nodes(maximumZoneModel, node => node.userData.industrialBelt && Number.isInteger(node.userData.industrialBelt.zone)).length, 32);
  assert.throws(() => schema.normalizeBehaviors([Object.assign({}, zonePreset, {length: 6.5})]), /32 zonas/);
  assert.throws(() => schema.normalizeBehaviors([Object.assign({}, zonePreset, {length: 20})]), /32 zonas/);
  dispose(maximumZoneModel);
  for (const height of [0.5, 3, 5]) for (const variant of ['roller-motor', 'roller-turntable', 'box-elevator']) {
    const supportHeight = variant === 'roller-turntable' && height === 0.5 ? 0.6 : height;
    const tall = createIndustrialPrefab('conveyor', variant, {supportHeight}); tall.position.y = supportHeight; tall.updateMatrixWorld(true);
    near(new THREE.Box3().setFromObject(tall).min.y, 0);
    near(new THREE.Box3().setFromObject(tall.children[1]).min.y, 0);
    assert.deepEqual(panelShape(tall.children[6]), originalPanel, 'Tall supports do not alter the existing cabinet or nine control positions.');
    const buttons = tall.children[6].children.filter(node => node.userData.editorPrefabKey === 'control');
    buttons.forEach(button => {
      const y = button.getWorldPosition(new THREE.Vector3()).y;
      assert(y >= 1.15 - 1e-5 && y <= 1.50, 'Controls remain at standing height while the conveyor operates on a higher level.');
    });
    dispose(tall);
  }
  assert.throws(() => schema.normalizeBehaviors([Object.assign({type: 'conveyor'}, equipment.getDefinition('roller-turntable').preset, {supportHeight: 0.5})]), /Altura de transporte/);
  const migration = new SceneDocument({}); migration.registerRoom('hall', new THREE.Group());
  const legacy = migration.addPrefab('hall', 'conveyor'), legacyId = legacy.userData.editorId;
  const legacyRecord = persisted(await migration.serialize()), legacyActors = legacy.children[0].children.slice(3, 10);
  const adoptedConfig = Object.assign({}, migration.getBehaviors(legacy).find(behavior => behavior.type === 'conveyor'), equipment.getDefinition('merge-angle').preset);
  migration.setBehaviors(legacy, [adoptedConfig]);
  assert.equal(migration.getVisualDescriptor(legacy).variant, 'merge-angle');
  const addedSensor = migration.getObject(legacyId + '/10');
  assert(addedSensor && addedSensor.userData.industrialBranchSensor, 'Adopting equipment registers the real newly created sensor actor.');
  assert.equal(migration.getBehaviors(addedSensor).find(behavior => behavior.type === 'sensor').sourceId, legacyId);
  assert.deepEqual(legacy.children[0].children.slice(3, 10), legacyActors, 'Adoption preserves every existing motor, control and sensor actor.');
  const adoptedRecord = persisted(await migration.serialize());
  migration.undo(); assert.deepEqual(persisted(await migration.serialize()), legacyRecord);
  assert.equal(migration.getObject(legacyId + '/10'), null, 'Undoing adoption removes the new actor from the saved object registry.');
  assert.equal(addedSensor.visible, false);
  migration.redo(); assert.deepEqual(persisted(await migration.serialize()), adoptedRecord);
  assert.equal(migration.getObject(legacyId + '/10'), addedSensor, 'Redo restores the same sensor identity and factory recipe.');
  const oldFrame = legacy.children[0].children[0];
  migration.setBehaviors(legacy, [Object.assign({}, adoptedConfig, {mergeAngle: 60})]);
  assert.notEqual(legacy.children[0].children[0], oldFrame, 'A subsequent geometric parameter edit rebuilds the physical model.');
  assert.equal(migration.getObject(legacyId + '/10'), addedSensor);
  const priorSupports = legacy.children[0].children[1];
  migration.setBehaviors(legacy, [Object.assign({}, adoptedConfig, {mergeAngle: 60, supportHeight: 3})]);
  assert.notEqual(legacy.children[0].children[1], priorSupports);
  near(new THREE.Box3().setFromObject(legacy.children[0].children[1]).min.y - legacy.position.y, -3);
  const tallSaved = validateDocument(JSON.parse(JSON.stringify(await migration.serialize())), value => value);
  const tallRestored = new SceneDocument({}); tallRestored.registerRoom('hall', new THREE.Group()); await tallRestored.load(tallSaved);
  assert.deepEqual(persisted(await tallRestored.serialize()), persisted(tallSaved), 'High-level supports and their ergonomic panel anchor survive reopening.');
  dispose(tallRestored.getRoot('hall'));
  dispose(migration.getRoot('hall'));
  // Every new variant passes the actual design serializer and server schema.
  // A changed lateral sensor and its clone must survive re-opening with their
  // own bindings; the historical removed pallet at slot 10 is not restored.
  const project = new SceneDocument({}), authoredRoot = new THREE.Group(); project.registerRoom('hall', authoredRoot);
  for (const definition of equipment.listEquipment({readyOnly: true})) project.addPrefab('hall', 'conveyor', definition.variant);
  const junction = Array.from(project.additions.values()).find(entry => entry.descriptor.variant === 'merge-angle');
  const lateral = junction.nodes.get('10'); assert(lateral && lateral.userData.industrialBranchSensor);
  const pose = lateral.position.toArray().map((value, index) => value + (index === 1 ? 0.025 : 0));
  project.setTransform(lateral, {position: pose});
  const duplicate = await project.duplicate(junction.wrapper || junction.object || project.getObject(junction.id));
  const copiedEntry = project.additions.get(duplicate.userData.editorId), copiedSensor = copiedEntry.nodes.get('10');
  assert(copiedSensor); assert.deepEqual(copiedSensor.position.toArray(), pose);
  assert.equal(project.getBehaviors(copiedSensor).find(behavior => behavior.type === 'sensor').sourceId, duplicate.userData.editorId);
  const saved = validateDocument(JSON.parse(JSON.stringify(await project.serialize())), value => value);
  const restored = new SceneDocument({}); restored.registerRoom('hall', new THREE.Group()); await restored.load(saved);
  assert.deepEqual(persisted(await restored.serialize()), persisted(saved), 'All versioned equipment preserves configuration and actor references on reopening.');
  assert.deepEqual(restored.additions.get(duplicate.userData.editorId).nodes.get('10').position.toArray(), pose);
  dispose(authoredRoot); dispose(restored.getRoot('hall'));
  if (process.argv.includes('--write-metrics')) {
    const report = {format: 'hello-conveyor-model-metrics', version: 1, engine: 'Three.js ' + THREE.REVISION,
      method: 'Counts from the real createIndustrialPrefab factory with the default registry configuration, including hidden reserved hardware. Meshes are not measured GPU draw calls.',
      scope: 'Geometry and mesh budget only. No browser FPS, frame timing, GPU memory or physical headset result is asserted.',
      range: 'Default variants; extreme user dimensions can increase geometry and mesh counts. Versioned accumulators reject more than 32 zones.',
      regenerate: 'node scripts/test-conveyor-equipment-models.js --write-metrics',
      maximum: {meshes: Math.max(...metrics.map(value => value.meshes)), triangles: Math.max(...metrics.map(value => value.triangles))}, equipment: metrics};
    fs.writeFileSync(path.join(__dirname, '../docs/conveyor-model-metrics.json'), JSON.stringify(report, null, 2) + '\n');
  }
  console.log('Equipment models: ' + metrics.length + ' versioned real models; unchanged nine-command panel; bounded meshes/triangles; ramps, return paths, pallet tracks, pivots, guided platforms, per-zone motion and restoration passed.');
  console.log('Measured complete-model maximum: ' + Math.max(...metrics.map(value => value.meshes)) + ' meshes; ' + Math.max(...metrics.map(value => value.triangles)) + ' triangles (without a GPU or headset claim).');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
