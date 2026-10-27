'use strict';
const assert = require('node:assert/strict'), THREE = require('three'), schema = require('../shared/behaviors.js');
const {setup} = require('./test-vehicle-storage.js'), builders = require('./load-industrial-cedi.js')(THREE, schema);
function room(width) {
  const doc = setup();
  const part = (name, position, scale) => {const object = doc.addPrimitive('hall', 'box', '#777777'); doc.setProperty(object, 'name', name); doc.setTransform(object, {position, scale}); doc.setBehaviors(object, [schema.defaultBehavior('collision')]); return object;};
  const floor = part('CEDI · Piso de hormigón mate', [0, -.06, 0], [width, .12, width]);
  const walls = []; for (const side of [-1, 1]) {walls.push(part('Muro lateral', [side * width / 2, 2, 0], [.2, 4, width])); walls.push(part('Muro posterior', [0, 2, side * width / 2], [width, 4, .2]));}
  return {doc, floor, walls};
}
const open = room(20), result = builders.retrofitCediRobotics(open.doc, 'hall'); assert.equal(result.vehicles.length, 1); assert.equal(result.products.length, 2);
for (const object of result.vehicles.concat(result.products)) {
  object.updateWorldMatrix(true, true); const box = new THREE.Box3().setFromObject(object); assert(box.min.x >= -9.8 && box.max.x <= 9.8 && box.min.z >= -9.8 && box.max.z <= 9.8, 'Existing-room retrofit stays inside its actual floor and walls');
  for (const wall of open.walls) {wall.updateWorldMatrix(true, true); assert(!box.intersectsBox(new THREE.Box3().setFromObject(wall)));}
}
const tight = room(4), before = tight.doc.getObjects('hall').length, skipped = builders.retrofitCediRobotics(tight.doc, 'hall');
assert.equal(skipped.vehicles.length, 0); assert.equal(skipped.products.length, 0); assert.equal(tight.doc.getObjects('hall').length, before); assert(skipped.warnings.some(message => /zona interior libre/.test(message)));
const unknown = setup(), unsupported = builders.retrofitCediRobotics(unknown, 'hall'); assert.equal(unsupported.vehicles.length, 0); assert(unsupported.warnings.length);
const rotated = room(20); rotated.walls.forEach(wall => rotated.doc.remove(wall)); rotated.doc.setTransform(rotated.floor, {rotation: [0, Math.PI / 4, 0]});
const angled = builders.retrofitCediRobotics(rotated.doc, 'hall'); assert.equal(angled.vehicles.length, 1);
rotated.floor.updateWorldMatrix(true, true);
for (const object of angled.vehicles.concat(angled.products)) {object.updateWorldMatrix(true, true); const box = new THREE.Box3().setFromObject(object); for (const x of [box.min.x, box.max.x]) for (const z of [box.min.z, box.max.z]) {const point = rotated.floor.worldToLocal(new THREE.Vector3(x, 0, z)); assert(Math.abs(point.x) <= .5 && Math.abs(point.z) <= .5, 'Rotated-floor AABB cannot count as physical support outside the real slab.');}}
const source = open.doc.addPrefab('hall', 'source'), config = open.doc.getBehaviors(source).find(value => value.type === 'source');
open.doc.setBehaviors(source, [Object.assign({}, config, {loadMode: 'individual', generationMode: 'sequence', catalog: JSON.stringify(['pallet', 'cage'].map(type => ({id: type, name: type, type, width: 1.2, height: .15, depth: .8, color: '#889988'})))})]);
assert.doesNotThrow(() => builders.retrofitCediRobotics(open.doc, 'hall', {vehicles: false}));
assert.deepEqual(schema.productSources.normalizeCatalog(open.doc.getBehaviors(source).find(value => value.type === 'source').catalog).map(spec => spec.variant), ['pallet-euro', 'cage']);
console.log('CEDI retrofit placement: supported free indoor floor, real wall clearance, narrow/unknown room omission and pallet/cage catalogue preservation passed.');
