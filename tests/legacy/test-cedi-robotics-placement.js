'use strict';
const assert = require('node:assert/strict'), THREE = require('three'), schema = require('../../modules/logistica-industrial/contracts/behaviors.js');
const {setup} = require('./test-vehicle-storage.js'), builders = require('../support/load-industrial-cedi.js')(THREE, schema);
function room(width) {
  const doc = setup();
  const part = (name, position, scale) => {const object = doc.addPrimitive('hall', 'box', '#777777'); doc.setProperty(object, 'name', name); doc.setTransform(object, {position, scale}); doc.setBehaviors(object, [schema.defaultBehavior('collision')]); return object;};
  const floor = part('CEDI · Piso de hormigón mate', [0, -.06, 0], [width, .12, width]);
  const walls = []; for (const side of [-1, 1]) {walls.push(part('Muro lateral', [side * width / 2, 2, 0], [.2, 4, width])); walls.push(part('Muro posterior', [0, 2, side * width / 2], [width, 4, .2]));}
  return {doc, floor, walls};
}
const open = room(20), result = builders.retrofitCediRobotics(open.doc, 'hall'); assert.equal(result.vehicles.length, 1); assert.equal(result.products.length, 0); assert(result.logistics);
for (const object of result.logistics.objects) {
  object.updateWorldMatrix(true, true); const box = new THREE.Box3().setFromObject(object); assert(box.min.x >= -9.8 && box.max.x <= 9.8 && box.min.z >= -9.8 && box.max.z <= 9.8, 'Existing-room retrofit stays inside its actual floor and walls');
  for (const wall of open.walls) {wall.updateWorldMatrix(true, true); assert(!box.intersectsBox(new THREE.Box3().setFromObject(wall)));}
}
const tight = room(4), before = tight.doc.getObjects('hall').length, skipped = builders.retrofitCediRobotics(tight.doc, 'hall');
assert.equal(skipped.vehicles.length, 0); assert.equal(skipped.products.length, 0); assert.equal(tight.doc.getObjects('hall').length, before); assert(skipped.warnings.some(message => /zona interior libre/.test(message)));
const unknown = setup(), unsupported = builders.retrofitCediRobotics(unknown, 'hall'); assert.equal(unsupported.vehicles.length, 0); assert(unsupported.warnings.length);
const rotated = room(20); rotated.walls.forEach(wall => rotated.doc.remove(wall)); rotated.doc.setTransform(rotated.floor, {rotation: [0, Math.PI / 4, 0]});
const angled = builders.retrofitCediRobotics(rotated.doc, 'hall'); assert.equal(angled.vehicles.length, 1);
rotated.floor.updateWorldMatrix(true, true);
for (const object of angled.logistics.objects) {object.updateWorldMatrix(true, true); const box = new THREE.Box3().setFromObject(object); for (const x of [box.min.x, box.max.x]) for (const z of [box.min.z, box.max.z]) {const point = rotated.floor.worldToLocal(new THREE.Vector3(x, 0, z)); assert(Math.abs(point.x) <= .5 && Math.abs(point.z) <= .5, 'Rotated-floor AABB cannot count as physical support outside the real slab.');}}
const source = open.doc.addPrefab('hall', 'source'), config = open.doc.getBehaviors(source).find(value => value.type === 'source');
open.doc.setBehaviors(source, [Object.assign({}, config, {loadMode: 'individual', generationMode: 'sequence', catalog: JSON.stringify(['pallet', 'cage'].map(type => ({id: type, name: type, type, width: 1.2, height: .15, depth: .8, color: '#889988'})))})]);
assert.doesNotThrow(() => builders.retrofitCediRobotics(open.doc, 'hall', {vehicles: false}));
assert.deepEqual(schema.productSources.normalizeCatalog(open.doc.getBehaviors(source).find(value => value.type === 'source').catalog).map(spec => spec.variant), ['pallet-euro', 'cage']);
// The previous release added a nozzle, a disconnected truck and two authored
// loads. Explicitly upgrading that saved layout must reuse them safely.
const old = room(30), add = (kind, name, variant, position, changes = {}) => {const o = old.doc.addPrefab('hall', kind, variant); old.doc.setProperty(o, 'name', name); old.doc.setTransform(o, {position}); old.doc.setBehaviors(o, old.doc.getBehaviors(o).map(c => c.type === kind ? {...c, withPanel: false, ...changes} : c)); return o;};
const inlet = add('source', 'Source original', undefined, [-4, 1, -4], {delivery: 'automatic', initialCount: 1}), belt = add('conveyor', 'Banda original', 'belt', [-1.95, 1, -4], {length: 2.4, autoSpawn: false}), stock = add('palletQueue', 'Almacén original', undefined, [.25, 1, -4], {palletCapacity: 1, capacity: 8});
old.doc.setBehaviors(inlet, old.doc.getBehaviors(inlet).map(c => c.type === 'source' ? {...c, outputId: belt.userData.editorId} : c)); old.doc.setBehaviors(belt, old.doc.getBehaviors(belt).map(c => c.type === 'conveyor' ? {...c, outputId: stock.userData.editorId} : c));
const nozzle = add('robot', 'Robótica CEDI · proceso sobre Banda original', 'articulated-process', [-1.95, 0, -2], {sourceId: belt.userData.editorId});
const truck = add('vehicle', 'Robótica CEDI · montacargas de expedición', 'forklift-electric-4w', [8, 0, -8], {frameColor: '#235a7c', speed: .7, wear: .6, sourceId: '', outputId: ''}); old.doc.setTransform(truck, {rotation: [0, .35, 0]});
const oldLoads = ['pallet-loaded', 'pallet-plastic'].map((variant, index) => add('product', 'Carga original ' + index, variant, [8 + index * 2, 0, -4]));
const pose = truck.matrix.toArray(), beforeConfig = old.doc.getBehaviors(truck).find(c => c.type === 'vehicle'), savedLoads = oldLoads.map(o => JSON.stringify(old.doc.captureObject(o))), robotId = nozzle.userData.editorId;
const upgraded = builders.retrofitCediRobotics(old.doc, 'hall'); assert(upgraded.logistics); assert.equal(upgraded.vehicles[0], truck, 'Reuse the already-authored truck instead of suppressing its production station.'); assert.deepEqual(truck.matrix.toArray(), pose);
const afterConfig = old.doc.getBehaviors(truck).find(c => c.type === 'vehicle'); for (const key of Object.keys(beforeConfig).filter(key => !['sourceId', 'outputId'].includes(key))) assert.deepEqual(afterConfig[key], beforeConfig[key], 'Preserve custom truck property ' + key);
assert.equal(afterConfig.sourceId, upgraded.logistics.pickup.userData.editorId); assert.equal(afterConfig.outputId, upgraded.logistics.destination.userData.editorId);
assert.equal(old.doc.getObject(robotId), nozzle); assert(old.doc.getBehaviors(nozzle).some(c => c.type === 'robot' && c.operation === 'pick-place' && c.tool === 'gripper'), 'The legacy nozzle ID becomes a real manipulation cell.');
oldLoads.forEach((o, index) => assert.equal(JSON.stringify(old.doc.captureObject(o)), savedLoads[index], 'Existing authored pallets are never consumed or replaced by the upgrade.'));
const upgradedCount = old.doc.getObjects('hall').length; assert.equal(builders.retrofitCediRobotics(old.doc, 'hall').changed, false); assert.equal(old.doc.getObjects('hall').length, upgradedCount);
// A room hidden only because another level is active remains fully authorable.
const hidden = setup(), hiddenRoot = hidden.getRoot('sound'); hiddenRoot.visible = false;
const hiddenBuilt = builders.buildIndustrialCediLevel(hidden, 'sound', {kind: 'sorting', robotized: true, continuous: false});
assert.deepEqual(hiddenBuilt.robotics.cells.map(cell => cell.role), ['loading', 'transfer', 'unloading']); assert.equal(hiddenBuilt.robotics.vehicles.length, 1); assert.equal(hiddenRoot.visible, false);
hiddenRoot.position.set(19, 0, -7); hiddenRoot.rotation.y = .63; hiddenRoot.scale.setScalar(1.35);
assert.equal(builders.retrofitCediRobotics(hidden, 'sound', {lines: hiddenBuilt.lines}).changed, false, 'Inactive translated/rotated rooms retain the same cell identities.');
for (const builder of [builders.buildIndustrialCediLevel, builders.buildIndustrialLab]) {
  const failed = setup(), root = failed.getRoot('sound'); root.visible = false; const add = failed.addPrefab;
  failed.addPrefab = () => {throw new Error('Intentional authoring failure');};
  assert.throws(() => builder(failed, 'sound', {robotized: true}), /Intentional authoring failure/); failed.addPrefab = add;
  assert.equal(root.visible, false, 'An authoring exception restores inactive-room visibility.');
}
console.log('CEDI retrofit placement: supported free indoor floor, real wall clearance, narrow/unknown room omission and pallet/cage catalogue preservation passed.');
