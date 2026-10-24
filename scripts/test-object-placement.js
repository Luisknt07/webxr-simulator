// Actual Three meshes and accelerated CollisionWorld, without DOM/WebGL or user data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const {getGeometryTree} = require('./load-geometry-acceleration.js')(THREE);
function load(file, name, values = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class ' + name, 'class ' + name);
  return new Function('THREE', ...Object.keys(values), source + '\nreturn ' + name + ';')(THREE, ...Object.values(values));
}
const CollisionWorld = load('src/lib/CollisionWorld.js', 'CollisionWorld', {getGeometryTree});
const ObjectPlacement = load('src/lib/ObjectPlacement.js', 'ObjectPlacement');
const vector = (x, y, z) => new THREE.Vector3(x, y, z);
function near(actual, expected, epsilon = 1e-5) { assert(Math.abs(actual - expected) <= epsilon, `${actual} ~= ${expected}`); }
function fixture() {
  const root = new THREE.Group(), world = new CollisionWorld({}, {getRoot: () => root}); world.setRoom('hall');
  return {root, world, placement: new ObjectPlacement(world)};
}
function box(root, size, position, descriptor) {
  const mesh = new THREE.Mesh(new THREE.BoxBufferGeometry(...size), new THREE.MeshBasicMaterial());
  mesh.position.fromArray(position); if (descriptor) mesh.userData.editorDescriptor = descriptor;
  root.add(mesh); return mesh;
}
function floor(root) {
  const mesh = new THREE.Mesh(new THREE.PlaneBufferGeometry(20, 20), new THREE.MeshBasicMaterial({side: THREE.DoubleSide}));
  mesh.rotation.x = -Math.PI / 2; root.add(mesh); return mesh;
}

{
  const {root, placement} = fixture(), ground = floor(root), actor = box(root, [.4, .4, .4], [0, .36, 0]);
  const original = actor.position.clone(), candidate = placement.find(actor);
  assert(candidate && candidate.snapped && candidate.kind === 'top'); assert.equal(candidate.target, ground);
  near(candidate.bounds.min.y, .003); near(candidate.distance, .157);
  assert(actor.position.equals(original), 'Queries never mutate the object.');
  actor.position.y = .8;
  const preview = placement.find(actor); assert(preview && !preview.snapped, 'Distant supports preview before they snap.');
  actor.position.y = 2; assert.equal(placement.find(actor), null, 'Objects beyond the preview radius do not teleport.');
}

{
  const {root, placement} = fixture(); floor(root);
  const target = box(root, [1, 1, 1], [0, .5, 0], {type: 'box'}), actor = box(root, [.4, .4, .4], [.83, .2, 0]);
  const side = placement.find(actor);
  assert(side && side.kind === 'side' && side.snapped, 'A nearby box side wins over an already touching floor.');
  assert.equal(side.target, target); near(side.bounds.min.x, .503); near(side.bounds.min.y, 0);
  actor.position.x = 1.1;
  const preview = placement.find(actor); assert.equal(preview.kind, 'side'); assert(!preview.snapped, 'Side preview remains visible while resting on the floor.');
  const restricted = placement.find(actor, {targets: [target], sideDistance: .5});
  assert(restricted && restricted.kind === 'side', 'Restricting the destination still permits the physical floor to support the box.');
  actor.position.y = 2; assert.equal(placement.find(actor, {targets: [target]}), null, 'Side magnets cannot suspend an object in midair.');
}

{
  const {root, placement, world} = fixture(); floor(root);
  const table = box(root, [1.2, .12, 1.2], [0, 1, 0]), actor = box(root, [.4, .4, .4], [0, 1.43, 0]);
  let candidate = placement.find(actor, {allowSides: false}); assert(candidate && candidate.target === table); near(candidate.bounds.min.y, 1.063);
  box(root, [.35, .45, .35], [0, 1.285, 0]);
  assert.equal(placement.find(actor, {allowSides: false}), null, 'An occupied table surface cannot receive another box.');
  actor.position.set(.7, 1.43, 0);
  assert.equal(placement.find(actor, {allowSides: false}), null, 'A mostly unsupported table edge is not a valid assembly.');
  actor.position.set(0, 1.43, 0); world.entries = []; world.dirty = true;
}

{
  const {root, placement} = fixture(), ground = floor(root);
  box(root, [1, .025, 1], [0, .4, 0]);
  const actor = box(root, [.3, .3, .3], [0, .78, 0]);
  assert.equal(placement.find(actor, {targets: [ground]}), null, 'A preview cannot snap through a thin shelf into free space below it.');
}

{
  const {root, placement} = fixture(); floor(root);
  const support = box(root, [1, .2, 1], [0, .5, 0]), actor = box(root, [.3, .3, .3], [0, .73, 0]);
  const candidate = placement.find(actor, {targets: [support]});
  assert(candidate && candidate.snapped, 'A slightly intersecting authored box may escape upward onto the support.');
  near(candidate.bounds.min.y, .603);
  support.scale.x = -1;
  const mirrored = placement.find(actor, {targets: [support]});
  assert(mirrored && mirrored.snapped, 'Mirrored equipment keeps its physical top-face direction.'); near(mirrored.bounds.min.y, .603);
}

{
  const {root, placement} = fixture(); floor(root);
  const target = box(root, [1, .3, 1], [0, .15, 0]), actor = box(root, [.4, .4, .4], [0, .63, 0]);
  const extra = new THREE.Box3(vector(-.2, .301, -.2), vector(.2, .701, .2));
  assert.equal(placement.find(actor, {targets: [target], extraBoxes: [extra]}), null, 'Other hand-held boxes remain collision obstacles.');
  target.visible = false; assert.equal(placement.find(actor, {targets: [target]}), null, 'Hidden surfaces never attract a product.');
}

{
  const {root, placement} = fixture(); floor(root);
  const generated = box(root, [.4, .4, .4], [0, .2, 0]);
  generated.userData.editorRuntimeHelper = true; generated.userData.editorCollisionBody = true;
  const carried = box(root, [.3, .3, .3], [0, .7, 0]);
  carried.userData.editorRuntimeHelper = true; carried.userData.editorCollisionBody = true; carried.industrialHeld = true;
  const outline = box(generated, [.7, .7, .7], [0, .8, 0]); outline.userData.editorRuntimeHelper = true;
  const candidate = placement.find(carried, {targets: [generated]});
  assert(candidate && candidate.target === generated, 'Physical generated packages remain valid supports, while helper outlines are excluded.');
  near(candidate.bounds.min.y, .403);
}

{
  const {root, placement} = fixture(); floor(root);
  // A single native mesh contains disconnected walls and the floor. Its large
  // bounding box encloses the actor but must not invent a side face in the room.
  const positions = [];
  [[[.1, 3, 6], [-3, 1.5, 0]], [[.1, 3, 6], [3, 1.5, 0]], [[6, .1, 6], [0, -.05, 0]]].forEach(([size, position]) => {
    const geometry = new THREE.BoxBufferGeometry(...size).toNonIndexed(); geometry.translate(...position); positions.push(...geometry.attributes.position.array);
  });
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const hall = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()); root.add(hall);
  const actor = box(root, [.4, .4, .4], [2.65, .3, 0]), candidate = placement.find(actor);
  assert(candidate && candidate.kind === 'top'); near(candidate.bounds.min.y, .003);
  assert.equal(placement.find(actor, {targets: [hall], allowSides: true}).kind, 'top', 'A combined room only offers its real floor surface.');
}

{
  const {root, placement} = fixture(); floor(root);
  const parent = new THREE.Group(); parent.position.set(1, 0, -2); parent.rotation.y = .61; parent.scale.set(1.3, .8, .7); root.add(parent);
  const actor = box(parent, [.4, .4, .4], [0, .5, 0]); actor.rotation.y = -.31;
  root.updateWorldMatrix(true, true);
  const matrix = actor.matrixWorld.clone(); matrix.elements[4] += .07; // Frozen hand pose can contain shear.
  const bounds = new THREE.Box3(vector(-.2, -.2, -.2), vector(.2, .2, .2));
  const candidate = placement.find(actor, {bounds, matrix, surfaceDistance: .5}); assert(candidate);
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 15].forEach(index => assert.equal(candidate.matrix.elements[index], matrix.elements[index], 'Full linear pose survives snapping exactly.'));
  near(candidate.bounds.min.y, .003); assert.equal(candidate.matrix.elements[12], matrix.elements[12]); assert.equal(candidate.matrix.elements[14], matrix.elements[14]);
}

{
  const {root, placement} = fixture(); floor(root);
  const owner = new THREE.Group(); owner.position.y = 1; root.add(owner);
  // Pallet slats have physical gaps; supporting rays may bridge at most 26 mm.
  [-.3, -.15, 0, .15, .3].forEach(x => box(owner, [.12, .1, .8], [x, 0, 0]));
  const actor = box(root, [.4, .4, .4], [0, 1.4, 0]);
  const candidate = placement.find(actor, {targets: [owner]}); assert(candidate && candidate.snapped); near(candidate.bounds.min.y, 1.053);
  owner.position.y = 1.8;
  assert.equal(placement.find(actor, {targets: [owner]}), null, 'A box underneath a pallet cannot snap through it.');
}

{
  const schema = require('../shared/behaviors');
  const source = fs.readFileSync(path.join(__dirname, '../src/editor/IndustrialPrefabs.js'), 'utf8').replace(/^import .*$/mg, '').replace(/export const /g, 'const ').replace(/export function /g, 'function ');
  const prefab = new Function('THREE', 'behaviorSchema', source + '\nreturn createIndustrialPrefab;')(THREE, schema);
  for (const surface of ['rollers', 'belt']) {
    const {root, placement} = fixture(); floor(root);
    const conveyor = prefab('conveyor', undefined, Object.assign(schema.defaultBehavior('conveyor'), {surface, withPanel: false, withSensors: false, withPallet: false}));
    conveyor.position.y = 1.02; root.add(conveyor);
    const actor = box(root, [.38, .38, .38], [0, 1.39, 0]);
    const candidate = placement.find(actor, {targets: [conveyor.children[2]], allowSides: false});
    assert(candidate && candidate.snapped, surface + ' exposes the real transport surface.'); near(candidate.bounds.min.y, 1.023, .004);
  }
}

assert.equal(new ObjectPlacement(null).find(new THREE.Group()), null);
assert.equal(new ObjectPlacement({entries: []}).find(new THREE.Group()), null, 'Partial/mocked worlds fail safely.');
console.log('Object placement: floor, boxes, sides, independent supports, obstacles, gaps, room geometry, transform preservation and conveyor surfaces passed.');
