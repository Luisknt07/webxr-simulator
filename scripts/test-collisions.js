const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const {getGeometryTree} = require('./load-geometry-acceleration.js')(THREE);
const source = fs.readFileSync(path.join(__dirname, '../src/lib/CollisionWorld.js'), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export default class CollisionWorld', 'class CollisionWorld');
const {CollisionWorld, treeFor, closedSurface} = new Function('THREE', 'getGeometryTree', source + '\nreturn {CollisionWorld, treeFor, closedSurface};')(THREE, getGeometryTree);
function fixture() {
  const root = new THREE.Group();
  const world = new CollisionWorld({}, {getRoot: () => root}); world.setRoom('hall');
  return {root, world};
}
function box(root, size, position, name = 'Solid') {
  const object = new THREE.Mesh(new THREE.BoxBufferGeometry(...size), new THREE.MeshBasicMaterial());
  object.position.fromArray(position); object.name = name; root.add(object); return object;
}
function floor(root) {
  const mesh = new THREE.Mesh(new THREE.PlaneBufferGeometry(30, 30), new THREE.MeshBasicMaterial({side: THREE.DoubleSide}));
  mesh.rotation.x = -Math.PI / 2; root.add(mesh); return mesh;
}
const v = (x, y, z) => new THREE.Vector3(x, y, z);

{
  const geometry = new THREE.BoxBufferGeometry(2, 2, 2);
  assert(closedSurface(treeFor(geometry)), 'Seam vertices are welded for exact closed-solid occupancy.');
  const x = geometry.attributes.position.getX(0);
  geometry.attributes.position.setX(0, x + 1e-6); geometry.attributes.position.needsUpdate = true;
  assert(closedSurface(treeFor(geometry)), 'Closure retains the existing 1e-5 vertex weld tolerance.');
  geometry.attributes.position.setX(0, x + 3e-5); geometry.attributes.position.needsUpdate = true;
  assert(!closedSurface(treeFor(geometry)), 'A genuine boundary beyond the weld tolerance remains open.');
  assert(!closedSurface(treeFor(new THREE.PlaneBufferGeometry(2, 2))));
  assert(closedSurface(treeFor(new THREE.SphereBufferGeometry(1, 64, 32))));
  assert(!closedSurface(treeFor(new THREE.SphereBufferGeometry(1, 64, 32, 0, Math.PI))));
  const doubled = new THREE.BufferGeometry();
  doubled.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  assert(closedSurface(treeFor(doubled)), 'Even edge multiplicities retain the previous closure parity semantics.');
}

{
  const {root, world} = fixture(); floor(root);
  const wall = box(root, [10, 4, 0.02], [0, 2, -2]);
  const stopped = world.moveSphere(v(0, 1, 0), v(0, 1, -20), 0.18);
  assert(stopped.z > -1.82 && stopped.z < -1.79, 'Continuous substeps stop a camera at a thin wall.');
  const slide = world.moveSphere(v(0, 1, 0), v(2, 1, -4), 0.18);
  assert(Math.abs(slide.x - 2) < 0.01 && slide.z > -1.82, 'Diagonal movement slides along a wall.');
  const ground = world.moveSphere(v(0, 1, 0), v(0, -3, 0), 0.18);
  assert(ground.y >= 0.18 && ground.y < 0.19, 'The editor camera cannot pass through the floor.');
  const actor = world.moveCapsule(v(0, 1.6, 0), v(0, 1.6, -7));
  assert(actor.z > -1.75 && actor.y >= 1.6, 'The visitor collides as a full height capsule.');
  assert(world.canOccupyCapsule(v(0, 1.6, 0)), 'A grounded visitor fits in open space.');
  assert(!world.canOccupyCapsule(v(0, 1.6, -2)), 'Teleporting into a wall is rejected.');
  wall.visible = false;
  assert(world.moveSphere(v(0, 1, 0), v(0, 1, -4)).z < -3.9, 'Hidden objects do not block movement.');
  wall.visible = true;
  Object.defineProperty(wall, 'industrialHeld', {value: true, configurable: true});
  assert(world.moveSphere(v(0, 1, 0), v(0, 1, -4)).z < -3.9, 'A carried product must not block its own visitor camera.');
  delete wall.industrialHeld;
  assert(world.moveSphere(v(0, 1, 0), v(0, 1, -4)).z > -1.82, 'A released product becomes solid again.');
  wall.visible = true; wall.userData.editorBehaviors = [{type: 'collision', enabled: true, mode: 'trigger'}];
  assert(world.moveSphere(v(0, 1, 0), v(0, 1, -4)).z < -3.9, 'Trigger volumes do not act as walls.');
  wall.userData.editorBehaviors = [{type: 'collision', enabled: false, mode: 'solid'}];
  assert(world.moveSphere(v(0, 1, 0), v(0, 1, -4)).z < -3.9);
  wall.userData.editorBehaviors = []; wall.scale.set(0, 0, 0);
  assert(world.moveSphere(v(0, 1, 0), v(0, 1, -4)).z < -3.9);
  wall.scale.set(1, 1, 1);
  assert(world.moveSphere(v(0, 1, 0), v(0, 1, -4)).z > -1.82, 'A previously degenerate animated mesh becomes solid again.');
}

{
  // Concave room geometry must not be replaced by its enclosing solid AABB.
  const {root, world} = fixture(), positions = [];
  for (const [size, position] of [[[0.1, 4, 6], [-3, 2, 0]], [[0.1, 4, 6], [3, 2, 0]], [[6, 0.1, 6], [0, -0.05, 0]]]) {
    const geometry = new THREE.BoxBufferGeometry(...size).toNonIndexed();
    geometry.translate(...position); positions.push(...geometry.attributes.position.array);
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  root.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
  const free = world.moveSphere(v(0, 1, 0), v(0, 1, 2));
  assert(free.distanceTo(v(0, 1, 2)) < 1e-8, 'The empty interior of a combined room mesh remains traversable.');
  assert(world.canOccupyCapsule(v(0, 1.6, 0)));
  assert(world.moveSphere(v(0, 1, 0), v(5, 1, 0)).x < 2.8);
  assert(!world.testBox(new THREE.Box3(v(-0.2, 0.01, -0.2), v(0.2, 0.4, 0.2))), 'A box resting on the floor remains free.');
}

{
  const {root, world} = fixture(); box(root, [4, 4, 4], [0, 0, 0]);
  assert(!world.canOccupyCapsule(v(0, 1.6, 0)), 'A capsule wholly inside a closed solid cannot be a teleport destination.');
  assert(world.testBox(new THREE.Box3(v(-0.1, -0.1, -0.1), v(0.1, 0.1, 0.1))), 'A package wholly inside a solid is blocked at spawn.');
  const recovered = world.moveCapsule(v(0, 1.6, 0), v(0, 1.6, 0));
  assert(world.canOccupyCapsule(recovered), 'A visitor starting inside an authored solid is moved to a free surface.');
}

{
  const {root, world} = fixture();
  const sensor = box(root, [2, 3, 0.1], [0, 1.5, -2]);
  sensor.userData.editorBehaviors = [{type: 'sensor', enabled: true}];
  assert(world.moveSphere(v(0, 1, 0), v(0, 1, -4)).z < -3.9, 'Sensor detection volumes default to triggers.');
  sensor.userData.editorBehaviors.push({type: 'collision', enabled: true, mode: 'solid'});
  assert(world.moveSphere(v(0, 1, 0), v(0, 1, -4)).z > -1.8, 'An explicit solid collider overrides sensor defaults.');
  sensor.visible = false;
  const helper = new THREE.Group(); helper.userData.editorRuntimeHelper = true; root.add(helper);
  const parcel = box(helper, [0.3, 0.3, 0.3], [0, 1, -2]); parcel.userData.editorRuntimeHelper = true;
  assert(world.moveSphere(v(0, 1, 0), v(0, 1, -4)).z < -3.9);
  parcel.userData.editorCollisionBody = true;
  assert(world.moveSphere(v(0, 1, 0), v(0, 1, -4)).z > -1.7, 'Physical runtime packages block the camera despite their helper parent.');
  parcel.visible = false;
  const sky = box(root, [1, 4, 0.02], [0, 1, -2], 'sky');
  assert(world.moveSphere(v(0, 1, 0), v(0, 1, -4)).z < -3.9, 'Decorative backgrounds are excluded.');
  sky.visible = false;
  const replaced = box(root, [1, 4, 0.1], [0, 1, -1]); replaced.userData.editorGeometryReplaced = true;
  const visual = box(root, [1, 4, 0.1], [0, 1, -3]); visual.userData.editorVisualOwnerId = 'logical-owner';
  const result = world.moveSphere(v(0, 1, 0), v(0, 1, -4));
  assert(result.z < -2.7 && result.z > -2.8, 'Only the active replacement geometry blocks movement.');
}

{
  const {root, world} = fixture();
  box(root, [6, 6, 0.01], [0, 0, -2]);
  const body = new THREE.Box3(v(-0.15, -0.15, -0.15), v(0.15, 0.15, 0.15));
  const sweep = world.sweepBox(body, v(0, 0, -30));
  assert(sweep.blocked && sweep.movement.z > -1.86, 'Continuous AABB/triangle sweep prevents fast packages tunneling.');
  const queue = world.sweepBox(body, v(0, 0, -4), {extraBoxes: [new THREE.Box3(v(-0.15, -0.15, -1.15), v(0.15, 0.15, -0.85))]});
  assert(queue.movement.z > -0.71 && queue.movement.z < -0.69, 'Packages stop before the next package.');
}

{
  const {root, world} = fixture();
  const parent = new THREE.Group(); parent.position.set(3, 0, 1); parent.rotation.y = Math.PI / 2; parent.scale.x = 2; root.add(parent);
  const actor = box(parent, [0.5, 0.5, 0.5], [0, 1, 0]);
  box(root, [4, 3, 0.05], [3, 1, -3]);
  const moved = world.moveObject(actor, v(4, 1, 0));
  assert(moved.blocked && moved.position.x > 1 && moved.position.x < 2, 'Object sweeps respect translated, rotated and scaled parents.');
  assert(actor.position.equals(v(0, 1, 0)), 'Queries return a resolved pose without mutating the actor.');
  actor.userData.editorBehaviors = [{type: 'collision', enabled: true, mode: 'trigger'}];
  assert(world.moveObject(actor, v(4, 1, 0)).position.equals(v(4, 1, 0)));
}

{
  const {root, world} = fixture();
  const wall = box(root, [6, 4, 0.02], [0, 1, -3]);
  const body = new THREE.Box3(v(-0.15, 0.8, -0.15), v(0.15, 1.1, 0.15));
  const before = world.stats.refreshes;
  world.beginFrame();
  for (let i = 0; i < 50; i++) assert(world.sweepBox(body, v(0, 0, -8)).blocked);
  assert.equal(world.stats.refreshes, before + 1, 'Fifty package queries share one scene traversal within a frame.');
  assert.equal(world.stats.matrixInversions, 1, 'A static mesh inverse is shared by collision substeps and queries.');
  wall.position.z = -5;
  world.invalidate(wall);
  assert(world.sweepBox(body, v(0, 0, -8)).movement.z < -4.7, 'Targeted invalidation updates a moving wall in the same frame.');
  assert.equal(world.stats.refreshes, before + 1, 'Moving one actor does not traverse the full room.');
  const parcel = box(root, [0.3, 0.3, 0.3], [0, 1, -1]);
  parcel.userData.editorCollisionBody = true;
  world.invalidate(parcel);
  assert(world.moveSphere(v(0, 1, 0), v(0, 1, -2)).z > -0.7, 'A package spawned in the same frame immediately blocks the camera.');
  root.remove(parcel); world.invalidate(parcel);
  assert(world.moveSphere(v(0, 1, 0), v(0, 1, -2)).z < -1.99, 'A removed package leaves no stale blocker in that frame.');
  wall.userData.editorBehaviors = [{type: 'collision', enabled: true, mode: 'trigger'}];
  world.invalidate(wall);
  assert(!world.sweepBox(body, v(0, 0, -8)).blocked, 'Targeted updates preserve trigger semantics.');
  world.endFrame();
  wall.userData.editorBehaviors = []; wall.position.z = -2;
  assert(world.sweepBox(body, v(0, 0, -8)).movement.z > -1.9, 'Queries outside a frame still detect arbitrary external edits without a hook.');
  world.beginFrame();
  assert(world.sweepBox(body, v(0, 0, -8)).blocked);
  wall.visible = false; world.invalidate();
  assert(!world.sweepBox(body, v(0, 0, -8)).blocked, 'Explicit whole-room invalidation handles bulk edits.');
  world.endFrame();
}

{
  const {root, world} = fixture();
  const sphere = new THREE.Mesh(new THREE.SphereBufferGeometry(1, 64, 32), new THREE.MeshBasicMaterial()); root.add(sphere);
  const pose = v(0.8, 0.8, 0), samples = world.insideEntry.bind(world), contacts = world.triangles.bind(world);
  let insideCalls = 0, contactCalls = 0;
  world.insideEntry = (...args) => { insideCalls++; return samples(...args); };
  world.triangles = (...args) => { contactCalls++; return contacts(...args); };
  assert(world.moveSphere(pose, pose, 0.05).equals(pose));
  assert.equal(insideCalls, 1, 'A stationary sphere tests one unique occupancy sample, rather than three identical samples.');
  const firstContacts = contactCalls;
  for (let i = 0; i < 20; i++) {
    const result = world.moveSphere(pose, pose, 0.05);
    assert(result.equals(pose)); result.x = 100;
  }
  assert.equal(insideCalls, 1, 'An unchanged camera and scene reuse the exact occupancy result across frames.');
  assert.equal(contactCalls, firstContacts, 'Stationary queries skip the unchanged triangle narrow phase.');
  assert.equal(world.stats.restingCacheHits, 20);
  assert(world.moveSphere(pose, pose, 0.2).distanceTo(pose) > 0.01, 'Changing the camera radius invalidates the cached result.');
  sphere.position.copy(pose);
  assert(world.moveSphere(pose, pose, 0.05).distanceTo(pose) > 0.5, 'A moving collider still pushes a stationary camera out of its interior.');
  sphere.visible = false;
  assert(world.moveSphere(pose, pose, 0.05).equals(pose), 'Hiding a collider invalidates an occupied result.');
  sphere.visible = true; sphere.material.visible = false;
  assert(world.moveSphere(pose, pose, 0.05).equals(pose));
  sphere.material.visible = true;
  assert(world.moveSphere(pose, pose, 0.05).distanceTo(pose) > 0.5, 'Material visibility changes cannot leave a stale free-space cache.');
}

{
  const {root, world} = fixture(), pose = v(0, 0, 0);
  assert(world.moveSphere(pose, pose).equals(pose));
  const solid = box(root, [2, 2, 2], [0, 0, 0]);
  const occupied = () => world.moveSphere(pose, pose).distanceTo(pose) > 0.5;
  assert(occupied(), 'A newly added collider invalidates a stationary free-space result.');
  solid.userData.editorBehaviors = [{type: 'collision', mode: 'trigger'}];
  assert(world.moveSphere(pose, pose).equals(pose), 'Changing solid to trigger invalidates the cache.');
  solid.userData.editorBehaviors = [{type: 'collision', mode: 'solid'}];
  assert(occupied());
  assert(world.moveSphere(pose, pose, 0.18, {ignore: [solid]}).equals(pose), 'Changing ignored objects changes the query result.');
  assert(occupied());
  solid.userData.editorCollisionBody = true;
  assert(world.moveSphere(pose, pose, 0.18, {extraBoxes: []}).equals(pose), 'Runtime-body filtering is part of the stationary query signature.');
  assert(occupied());
  solid.geometry.setDrawRange(0, 0);
  assert(world.moveSphere(pose, pose).equals(pose), 'Changing a geometry draw range invalidates both occupancy and the triangle tree.');
  solid.geometry.setDrawRange(0, Infinity);
  assert(occupied());
  const index = solid.geometry.index;
  solid.geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(), 1));
  assert(world.moveSphere(pose, pose).equals(pose), 'Replacing the index with a new attribute at version zero rebuilds its triangle tree.');
  solid.geometry.setIndex(index);
  assert(occupied());
  solid.geometry.translate(4, 0, 0);
  assert(world.moveSphere(pose, pose).equals(pose), 'Vertex edits refresh world bounds and cached occupancy.');
  solid.geometry.translate(-4, 0, 0);
  assert(occupied());
  root.remove(solid);
  assert(world.moveSphere(pose, pose).equals(pose), 'Removing a collider invalidates an occupied result.');
}

{
  const {root, world} = fixture(), pose = v(0, 0, 0), a = new THREE.Group(), b = new THREE.Group(), owner = new THREE.Group();
  root.add(a, b); a.add(owner); box(owner, [2, 2, 2], [0, 0, 0]);
  assert(world.moveSphere(pose, pose, 0.18, {ignore: [a]}).equals(pose));
  b.add(owner);
  assert(world.moveSphere(pose, pose, 0.18, {ignore: [a]}).distanceTo(pose) > 0.5,
    'Reparenting an ancestor with an identical world transform still updates ignored-subtree semantics.');
  world.beginFrame();
  owner.position.x = 4; world.invalidate(owner);
  assert(world.moveSphere(pose, pose).equals(pose));
  assert(world.moveSphere(pose, pose).equals(pose));
  owner.position.x = 0; world.invalidate(owner);
  assert(world.moveSphere(pose, pose).distanceTo(pose) > 0.5, 'Targeted same-frame invalidation also clears the resting cache.');
  owner.position.x = 4; world.invalidate(owner);
  assert(world.moveSphere(pose, pose).equals(pose));
  world.endFrame();
  owner.position.x = 0;
  assert(world.moveSphere(pose, pose).distanceTo(pose) > 0.5,
    'Reverting to an older transform after a targeted frame update cannot reuse that update\'s free-space result.');
}

console.log('CollisionWorld: hollow geometry, camera/capsule sliding, floors, thin-wall sweeps, exact closed-solid occupancy, transforms, triggers, replacements, runtime packages, frame/subtree caching and stationary invalidation passed.');
