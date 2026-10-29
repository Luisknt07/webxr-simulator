const __layout = require("../../tooling/layout.cjs");
// Real room/prefab triangles, including a single hollow hall mesh. No browser,
// rendering context, server, SQLite database or user project is modified.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const schema = require('../../modules/logistica-industrial/contracts/behaviors');
const {getGeometryTree} = require('../support/load-geometry-acceleration')(THREE);
const read = file => fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-equipment-placement.js"), '../src/', file)), 'utf8').replace(/^import .*;\r?\n/gm, '');
const CollisionWorld = new Function('THREE', 'getGeometryTree', read('lib/CollisionWorld.js').replace('export default class CollisionWorld', 'return class CollisionWorld'))(THREE, getGeometryTree);
const EquipmentPlacement = new Function('THREE', read('editor/EquipmentPlacement.js').replace('export default class EquipmentPlacement', 'return class EquipmentPlacement'))(THREE);
const prefabSource = read('editor/IndustrialPrefabs.js').replace(/export const /g, 'const ').replace(/export function /g, 'function ');
const createIndustrialPrefab = new Function('THREE', 'behaviorSchema', prefabSource + '\nreturn createIndustrialPrefab;')(THREE, schema);
const v = (x, y, z) => new THREE.Vector3(x, y, z);
const near = (a, b, message) => assert(Math.abs(a - b) < 0.00001, (message || '') + `: ${a} != ${b}`);

function fixture() {
  const root = new THREE.Group(), document = {getRoot: () => root};
  const world = new CollisionWorld({}, document); world.setRoom('hall');
  const camera = new THREE.PerspectiveCamera(); camera.position.set(0, 4, 6);
  const editor = {root, document, collisionWorld: world, camera, orbit: {target: v(0, 1.2, 0)}};
  return {root, world, editor, placer: new EquipmentPlacement(editor)};
}
function floor(root, width = 30, depth = width, height = 0) {
  const mesh = new THREE.Mesh(new THREE.PlaneBufferGeometry(width, depth), new THREE.MeshBasicMaterial({side: THREE.DoubleSide}));
  mesh.rotation.x = -Math.PI / 2; mesh.position.y = height; mesh.name = 'Suelo'; root.add(mesh); return mesh;
}
function box(root, size, position, descriptor = true) {
  const object = new THREE.Group();
  if (descriptor) object.userData.editorDescriptor = {type: 'box'};
  const mesh = new THREE.Mesh(new THREE.BoxBufferGeometry(...size), new THREE.MeshBasicMaterial());
  object.add(mesh); object.position.fromArray(position); root.add(object); return object;
}
function prefab(root, kind = 'conveyor', variant) {
  const object = new THREE.Group(); object.userData.editorDescriptor = {prefab: kind};
  object.userData.editorPrefabKey = kind; object.add(createIndustrialPrefab(kind, variant));
  object.position.set(0, 1, -2); root.add(object); return object;
}
function visibleBox(root) {
  root.updateWorldMatrix(true, true); const result = new THREE.Box3();
  root.traverseVisible(mesh => {
    if (!mesh.isMesh || mesh.userData.industrialSensorVolume || mesh.userData.editorHelper || mesh.userData.editorRuntimeHelper) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const material = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (material.every(value => value.opacity <= 0.08 || value.visible === false)) return;
    result.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
  });
  return result;
}

{
  const {root, placer} = fixture(); floor(root);
  const first = prefab(root); const firstResult = placer.place(first, v(0, 1.2, 0));
  near(firstResult.floorY, 0); near(visibleBox(first).min.y, 0, 'Conveyor feet, pallet and cabinet rest on the floor');
  const second = prefab(root); const result = placer.place(second, v(0, 1.2, 0));
  assert(result.attempts > 1, 'An occupied view target must trigger a search for free space');
  assert(!visibleBox(first).intersectsBox(visibleBox(second)), 'New conveyors reserve the complete visible equipment footprint');
  near(visibleBox(second).min.y, 0);
  assert(result.attempts <= 129, 'Initial placement has a bounded candidate budget');
}
schema.conveyorLayout.presetVariants.forEach(variant => {
  const {root, placer} = fixture(); floor(root, 60);
  const machine = prefab(root, 'conveyor', variant);
  const result = placer.place(machine, v(0, 1.2, 0));
  near(result.floorY, 0); near(visibleBox(machine).min.y, 0, variant + ' uses actual visible feet rather than hidden modules');
});
{
  const {root, placer} = fixture(); floor(root, 30, 30, 2);
  const machine = prefab(root, 'plc'); const quaternion = machine.quaternion.clone();
  const result = placer.place(machine, v(1, 2.8, 1));
  near(result.floorY, 2); near(visibleBox(machine).min.y, 2, 'Separate control cabinets use their actual pedestal bottom');
  assert(machine.quaternion.equals(quaternion));
}
{
  const {root, placer} = fixture(); root.position.set(7, 1.7, -4); root.rotation.y = 0.7; root.scale.set(1.5, 1.1, 0.8);
  const base = floor(root); const machine = prefab(root, 'conveyor', 'belt-middle'); machine.rotation.y = 0.4; machine.scale.set(0.8, 1.2, 0.8);
  const quaternion = machine.quaternion.clone(), scale = machine.scale.clone();
  root.updateWorldMatrix(true, true); const target = root.localToWorld(v(0, 1.3, 0));
  const result = placer.place(machine, target);
  near(visibleBox(machine).min.y, base.getWorldPosition(v(0, 0, 0)).y, 'Parent transforms and non-uniform scale are respected');
  assert(machine.quaternion.equals(quaternion)); assert(machine.scale.equals(scale)); near(result.floorY, 1.7);
}
{
  const {root, placer} = fixture(); floor(root);
  // A hollow room is deliberately ONE mesh, whose AABB encloses every candidate.
  const positions = [];
  [[20, 0.1, 20, 0, -0.05, 0], [0.06, 5, 20, 0, 2.5, 0]].forEach(([x, y, z, px, py, pz]) => {
    const geometry = new THREE.BoxBufferGeometry(x, y, z).toNonIndexed(); geometry.translate(px, py, pz);
    positions.push(...geometry.attributes.position.array);
  });
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const hall = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()); hall.name = 'hall'; hall.userData.editorNative = true; root.add(hall);
  const machine = box(root, [1, 1, 1], [0, 1, 0]); const result = placer.place(machine, v(0, 1.2, 0));
  assert(result.attempts > 1, 'An actual wall forces relocation even inside a single large hall collider');
  assert(Math.abs(machine.position.x) > 0.65, 'The equipment clears the wall instead of being rejected by the hall AABB');
  near(visibleBox(machine).min.y, 0);
}
{
  const {root, placer} = fixture(); floor(root);
  const existing = prefab(root); placer.place(existing, v(0, 1.2, 0));
  const next = box(root, [0.5, 0.5, 0.5], [0, 1, 0]);
  const result = placer.place(next, v(0, 1.6, 0));
  near(result.floorY, 0, 'Conveyor decks, loading tables and pallet surfaces never become a new equipment floor');
  near(visibleBox(next).min.y, 0);
  assert(!visibleBox(existing).intersectsBox(visibleBox(next)));
}
{
  const {root, placer} = fixture(); floor(root, 0.4);
  const machine = prefab(root); const original = machine.position.clone();
  assert.throws(() => placer.place(machine, v(0, 1.2, 0)), /No hay espacio libre/);
  assert(machine.position.equals(original), 'A room without a sufficiently supported free footprint does not move the new object');
}
{
  const {root, placer} = fixture();
  // The corners have floor but the center is a hole: a center/feet-only ray
  // or a room-sized floor AABB must not incorrectly approve this footprint.
  [[10, 2, 0, -2], [10, 2, 0, 2], [2, 2, -2, 0], [2, 2, 2, 0]].forEach(([width, depth, x, z]) => {
    const mesh = floor(root, width, depth); mesh.position.set(x, 0, z);
  });
  const machine = box(root, [1, 1, 1], [0, 1, 0]);
  const result = placer.place(machine, v(0, 1.2, 0));
  assert(result.attempts > 1, 'The full floor support grid rejects a floor hole and finds a genuinely supported location');
  near(visibleBox(machine).min.y, 0);
}
{
  const {root, placer} = fixture();
  const machine = prefab(root, 'conveyor', 'roller-middle');
  const hidden = new THREE.Mesh(new THREE.BoxBufferGeometry(200, 200, 200), new THREE.MeshBasicMaterial()); hidden.visible = false; machine.add(hidden);
  const helper = new THREE.Mesh(new THREE.BoxBufferGeometry(500, 500, 500), new THREE.MeshBasicMaterial()); helper.userData.editorHelper = true; machine.add(helper);
  const result = placer.place(machine, v(0, 1.2, 0));
  near(result.floorY, 0, 'A truly empty scene has a predictable ground plane');
  near(visibleBox(machine).min.y, 0, 'Hidden attachments and editor helpers do not affect grounding');
}
{
  const {root, placer} = fixture();
  const obstacle = box(root, [2, 1, 2], [0, 0.5, 0]);
  const machine = prefab(root, 'plc'); const original = machine.position.clone();
  assert.throws(() => placer.place(machine, v(0, 1.2, 0)), /No hay espacio libre/);
  assert(machine.position.equals(original), 'Geometry without a floor cannot silently place equipment in mid-air');
  assert(obstacle.visible);
}
{
  const {root, placer} = fixture();
  const obstacle = box(root, [2, 1, 2], [0, 0.5, 0]);
  obstacle.userData.editorBehaviors = [{type: 'collision', enabled: false, mode: 'solid'}];
  const machine = prefab(root, 'plc');
  assert.throws(() => placer.place(machine, v(0, 1.2, 0)), /No hay espacio libre/, 'An existing model without collision does not turn a floor-less room into an empty scene');
}
{
  const {root, placer} = fixture(); floor(root);
  const object = box(root, [1, 1, 1], [0, 1, 0]); object.children[0].position.set(15, 2, -3);
  placer.place(object, v(0, 1.2, 0)); const boxBounds = visibleBox(object);
  near(boxBounds.getCenter(v(0, 0, 0)).x, 0, 'Imported assets with an offset origin appear at the view target');
  near(boxBounds.getCenter(v(0, 0, 0)).z, 0); near(boxBounds.min.y, 0);
}
{
  const {root, placer} = fixture(); floor(root);
  const paint = schema.industrialFloor.createVisual(THREE, {type:'industrialFloor',version:1,bounds:[-15,-15,15,15],floorY:0,
    walkways:[[-2,-12,2,12]],zones:[[-8,-8,8,8]],texts:['ENSAMBLE'],labels:[[0,0,0,3,.6,8]],signs:[[-10,0,0,1,8],[10,0,0,1,8]]});
  root.add(paint);
  const machine=box(root,[1,1,1],[0,1,0]), result=placer.place(machine,v(0,1.2,0));
  assert.equal(result.attempts,1,'A painted walkway, label and zone do not reserve the whole room between two distant signs.');
  near(machine.position.x,0);near(machine.position.z,0);near(result.floorY,0);
  const bySign=box(root,[.6,1,.6],[0,1,0]), displaced=placer.place(bySign,v(10,1.2,0));
  assert(displaced.attempts>1,'The footprint of the individual upright sign still reserves space.');
}
console.log('Equipment placement: painted zones/walkways stay buildable, individual signs reserve only their own footprint, floor support, free-space search, room walls, parent transforms and authored pose passed.');
