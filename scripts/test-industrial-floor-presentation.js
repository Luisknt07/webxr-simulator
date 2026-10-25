'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), {createRequire} = require('node:module');
const schema = require('../shared/behaviors'), {validateDocument} = require('../server/validation');
const file = path.join(__dirname, 'test-editor-runtime.js'), source = fs.readFileSync(file, 'utf8');
const {harness, storage, remote, THREE} = new Function('require', '__dirname', source.slice(0, source.indexOf('async function run()')) + '\nreturn {harness,storage,remote,THREE};')(createRequire(file), __dirname);
const floorAPI = require('./load-industrial-floor')(THREE, schema), clone = value => JSON.parse(JSON.stringify(value));
const overlap = (a, b) => a[0] < b[2] - 1e-6 && a[2] > b[0] + 1e-6 && a[1] < b[3] - 1e-6 && a[3] > b[1] + 1e-6;
function sameNumeric(a, b, message) {
  if (typeof a === 'number' && typeof b === 'number') { assert(Math.abs(a - b) < 1e-6, message + ': ' + a + '/' + b); return; }
  if (a && b && typeof a === 'object' && typeof b === 'object') { assert.deepEqual(Object.keys(a), Object.keys(b), message); Object.keys(a).forEach(key => sameNumeric(a[key], b[key], message + '/' + key)); return; }
  assert.deepEqual(a, b, message);
}
async function run() {
  storage.clear(); remote.projects.clear(); const f = harness(), e = f.editor; await e.ready;
  const document = e.document, roomId = e.roomId, root = document.getRoot(roomId);
  const floor = document.addPrimitive(roomId, 'box', '#777c76'); document.setProperty(floor, 'name', 'Piso industrial · hormigón mate'); document.setTransform(floor, {position: [0, -.06, 0], scale: [32, .12, 28]});
  const customFloor = Object.assign(schema.defaultBehavior('surfaceMaterial'), {preset: 'concrete', color: '#72796f', roughness: .94}); document.setBehaviors(floor, [schema.defaultBehavior('collision'), customFloor]);
  const add = (type, x, z) => { const object = document.addPrefab(roomId, type, type === 'conveyor' ? 'roller-motor' : undefined); document.setTransform(object, {position: [x, 1, z]}); return object; };
  const inlet = add('source', -8, -1), conveyor = add('conveyor', -3, -1), processor = add('processor', 3, -1), stock = add('palletQueue', 8, -1);
  document.setBehaviors(conveyor, document.getBehaviors(conveyor).concat([Object.assign(schema.defaultBehavior('surfaceMaterial'), {preset: 'paintedMetal', color: '#9d3c2a', slot: 'part:Bastidor'})]));
  const machines = [inlet, conveyor, processor, stock], ids = new Set(machines.map(object => object.userData.editorId)), before = await document.serialize(), machineRows = clone(before.rooms[roomId].additions.filter(row => ids.has(row.id))), depth = document.undoStack.length;
  const derived = floorAPI.deriveIndustrialFloorPresentation(document, roomId, {floorObject: floor, machines});
  assert(derived.plan.walkways.length >= 2); assert(derived.plan.zones.length); assert(derived.plan.bays.length); assert(derived.plan.labels.some(row => row[5] === 4));
  derived.plan.walkways.forEach(walkway => derived.obstacles.forEach(obstacle => assert(!overlap(walkway, obstacle), 'Pedestrian paint stays clear of all real machine footprints and .6m clearance.')));
  derived.plan.labels.filter(label => label[5] === 4).forEach(label => {
    const lane = derived.plan.walkways.find(box => label[0] >= box[0] && label[0] <= box[2] && label[1] >= box[1] && label[1] <= box[3]);
    assert(lane); assert.equal(label[2], lane[3] - lane[1] > lane[2] - lane[0] ? -1.570796 : 0, 'Pedestrian text follows the route rather than extending across its edges.');
  });
  const applied = floorAPI.applyIndustrialFloorPresentation(document, roomId, {floorObject: floor, machines}); assert(applied.changed); assert.equal(applied.affectedObjectIds.length, 2); assert.equal(document.undoStack.length, depth + 1);
  assert.equal(applied.presentation.userData.editorDescriptor.type, 'industrialFloor'); assert(applied.report.meshes <= 8); assert(applied.report.stamps <= 100); assert(applied.wearLayers <= 4);
  assert.deepEqual(applied.presentation.position.toArray(), [0, 0, 0]); assert.deepEqual(applied.presentation.quaternion.toArray(), [0, 0, 0, 1]); assert.deepEqual(applied.presentation.scale.toArray(), [1, 1, 1], 'The actor pivot is identity because its plan is already in room-local coordinates.');
  const floorConfig = document.getBehaviors(floor); assert.deepEqual(floorConfig.find(value => value.type === 'surfaceMaterial'), customFloor, 'A custom floor finish stays literal.');
  assert.deepEqual((await document.serialize()).rooms[roomId].additions.filter(row => ids.has(row.id)), machineRows, 'Equipment recipes, materials, poses, IDs and flow references stay literal.');
  const wear = JSON.parse(floorConfig.find(value => value.type === 'surfaceWear').layers);
  assert(wear.some(layer => layer.id.endsWith('motor-oil'))); assert(wear.some(layer => layer.id.endsWith('station-scratches'))); assert(wear.some(layer => layer.id.endsWith('border-dirt')));
  wear.forEach(layer => { assert(layer.depth <= .04); assert(layer.id.endsWith('motor-oil') ? layer.roughness >= .2 && layer.roughness <= .6 : layer.roughness >= .8); assert.equal(layer.metalness, 0); assert(layer.stamps.length <= 24); });
  applied.presentation.traverse(mesh => {
    if (!mesh.geometry) return; assert(mesh.geometry.index); assert(Array.from(mesh.geometry.attributes.position.array).every(Number.isFinite)); assert(Number.isFinite(mesh.geometry.boundingSphere.radius));
    const normal = mesh.geometry.attributes.normal;
    if (/Juntas|Ruta peatonal|Pintura de seguridad|Cebras/.test(mesh.name)) { for (let index = 0; index < normal.count; index++) if (mesh.geometry.attributes.position.getY(index) < applied.plan.floorY + .03) assert(Math.abs(normal.getY(index) - 1) < 1e-6, 'All floor paint faces upward.'); }
    assert(mesh.material.polygonOffset, 'Paint and labels have an explicit depth bias, including across long view distances.');
    assert(mesh.material.isMeshBasicMaterial || mesh.material.roughness >= .8); assert.equal(mesh.material.userData.studioColorSpace, 'linear');
  });
  const after = await document.serialize(), second = floorAPI.applyIndustrialFloorPresentation(document, roomId, {floorObject: floor, machines}); assert.equal(second.changed, false); assert.deepEqual(await document.serialize(), after, 'Applying the same version twice is a data no-op.');
  document.undo(); assert.deepEqual(await document.serialize(), before, 'A single undo removes the complete presentation and restores the previous floor behaviors.'); document.redo(); assert.deepEqual(await document.serialize(), after);
  validateDocument(after, value => value); const loaded = harness(); await loaded.editor.ready; await loaded.editor.document.load(after, {activeRoomId: roomId});
  sameNumeric(await loaded.editor.document.serialize(), after, 'Save/reopen');
  const reopened = loaded.editor.document.getObject(applied.presentation.userData.editorId); assert(reopened); assert.equal(reopened.children[0].children.length, applied.report.meshes);
  const originalPlan = floorAPI.deriveIndustrialFloorPresentation(document, roomId, {floorObject: floor, machines}).plan;
  root.position.set(12, -2, 7); root.rotation.set(.2, .8, -.13); root.scale.set(1.2, .85, 1.1); root.updateWorldMatrix(true, true);
  const rotated = floorAPI.deriveIndustrialFloorPresentation(document, roomId, {floorObject: floor, machines}).plan; sameNumeric(rotated, originalPlan, 'Room-root isometry');
  const rotatedFloor = document.addPrimitive('sound', 'box', '#777c76'); document.setProperty(rotatedFloor, 'name', 'Piso industrial · hormigón mate'); document.setTransform(rotatedFloor, {position: [0, -.06, 0], scale: [24, .12, 24]});
  const rotatedRoot = document.getRoot('sound'); rotatedRoot.position.set(6, 3, -7); rotatedRoot.rotation.set(.14, -1.1, .09); rotatedRoot.scale.set(1.2, .85, 1.1);
  const unit = document.addPrefab('sound', 'conveyor', 'roller-motor'); document.setTransform(unit, {position: [0, 1, 0]});
  const transformed = floorAPI.applyIndustrialFloorPresentation(document, 'sound', {floorObject: rotatedFloor, machines: [unit]});
  const matrix = JSON.parse(document.getBehaviors(rotatedFloor).find(value => value.type === 'surfaceWear').layers)[0].matrix;
  const actualMatrix = rotatedFloor.matrixWorld.clone().multiply(new THREE.Matrix4().fromArray(matrix)), expectedMatrix = rotatedRoot.matrixWorld.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(0, transformed.plan.floorY + .004, 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2), new THREE.Vector3(1, 1, 1)));
  sameNumeric(actualMatrix.toArray(), expectedMatrix.toArray(), 'Wear exact local matrix under rotated/scaled root');
  const labels = [], visual = schema.industrialFloor.createVisual(THREE, derived.plan, () => ({getContext: () => ({clearRect() {}, fillText: text => labels.push(text)})}));
  assert.equal(labels.length, schema.industrialFloor.LABELS.length); const textures = new Set(); visual.traverse(mesh => { if (mesh.material && mesh.material.map) textures.add(mesh.material.map); }); assert.equal(textures.size, 1); assert.equal([...textures][0].image.width, 1024); assert.equal([...textures][0].image.height, 256);
  for (const bad of [{version: 2}, {bounds: [0, 0, -1, 1]}, {floorY: NaN}, {arrows: Array(97).fill([0, 0, 0])}, {labels: [[0, 0, 0, 2, .4, 99]]}]) assert.throws(() => schema.industrialFloor.normalize(Object.assign({}, derived.plan, bad)));
  const legacyFloor = document.addPrimitive('photogrammetry', 'box', '#777c76'); document.setProperty(legacyFloor, 'name', 'Piso industrial · hormigón mate'); document.setTransform(legacyFloor, {position: [0, -.06, 0], scale: [24, .12, 24]});
  document.addPrefab('photogrammetry', 'conveyor', 'roller-motor');
  const legacy = (name, color, custom = false) => { const object = document.addPrimitive('photogrammetry', 'plane', color); document.setProperty(object, 'name', name); document.setTransform(object, {position: [0, .012, 5], rotation: [-Math.PI / 2, 0, 0]}); document.setBehaviors(object, [Object.assign(schema.defaultBehavior('surfaceMaterial'), {color, roughness: 1, metalness: 0})]); if (custom) document.setProperty(object, 'color', '#9d47b2'); return object; };
  const old = legacy('Ruta peatonal central', '#385c60'), customized = legacy('Ruta peatonal central · mía', '#385c60', true), unknown = legacy('Delimitación · color personalizado', '#aa37bb');
  const stand = document.addPrimitive('photogrammetry', 'box', '#394844'); document.setProperty(stand, 'name', 'Pedestal del monitor'); document.setTransform(stand, {position: [0, .65, 8], scale: [.6, 1.3, .6]});
  const board = document.addPrimitive('photogrammetry', 'box', '#182b38'); document.setProperty(board, 'name', 'Guía suspendida a altura humana'); document.setTransform(board, {position: [0, 2, 8], scale: [3.2, 1.8, .12]}); document.setBehaviors(board, [schema.defaultBehavior('info')]);
  const legacyDerived = floorAPI.deriveIndustrialFloorPresentation(document, 'photogrammetry', {floorObject: legacyFloor}); assert(legacyDerived.report.groundFixtures >= 2); legacyDerived.plan.walkways.forEach(path => legacyDerived.obstacles.forEach(obstacle => assert(!overlap(path, obstacle), 'Pedestrian paint avoids monitor pedestals and suspended panels at head height.')));
  const replacement = floorAPI.applyIndustrialFloorPresentation(document, 'photogrammetry', {floorObject: legacyFloor, replaceLegacy: true}); assert(replacement.removedLegacyIds.includes(old.userData.editorId)); assert(!document.getObject(old.userData.editorId)); assert(document.getObject(customized.userData.editorId)); assert(document.getObject(unknown.userData.editorId), 'Only known generated legacy names AND palette with no custom tint are removed.');
  e.projectSync.stop(); loaded.editor.projectSync.stop(); e.clearAssembly(true); loaded.editor.clearAssembly(true);
  console.log('Industrial floor: indexed matte batches/one atlas, protected walkways, bounded localized wear, preserved equipment/custom finishes, strict descriptor, one undo, reopen, idempotence and exact root-local isometry passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
