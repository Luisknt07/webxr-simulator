'use strict';
// Exercise manufactured geometry and real contact envelopes, not screenshots
// or assertions about source-code strings. All metrics include instanced parts.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const schema = require('../shared/behaviors.js'), robots = require('../shared/robots.js'), kinematics = require('../shared/robot-kinematics.js');
const products = require('./load-product-prefabs.js')(THREE), productSchema = require('../shared/product-equipment.js');
const read = name => fs.readFileSync(path.join(__dirname, '../src/editor/', name), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const robotFactory = new Function('THREE', 'robotSchema', 'kinematics', read('RobotPrefabs.js') + '\nreturn {createRobot,updateRobotPose,refreshRobotGeometry};')(THREE, robots, kinematics);
const dom = {createElement() { return {width: 0, height: 0, getContext() { return {fillRect() {}, fillText() {}}; }}; }};
const prefab = new Function('THREE', 'behaviorSchema', 'document', 'require', read('IndustrialPrefabs.js') + '\nreturn {createIndustrialPrefab,conveyorPresets,fabricatedBox,compactFabricated,builder,junctionBearingSupport};')(THREE, schema, dom, name => name.includes('RobotPrefabs') ? robotFactory : products);
const near = (a, b) => assert(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const bounds = mesh => { mesh.updateMatrixWorld(true); return new THREE.Box3().setFromObject(mesh); };
function stats(object) {
  let triangles = 0, meshes = 0; object.traverse(node => { if (node.isMesh) { meshes++; triangles += (node.geometry.index ? node.geometry.index.count : node.geometry.attributes.position.count) / 3 * (node.isInstancedMesh ? node.count : 1); } }); return {triangles, meshes};
}
function anchors(object, label) {
  let count = 0;
  object.traverse(host => (host.userData.industrialStickerAnchors || []).forEach(anchor => {
    count++; assert(anchor.id && anchor.position.length === 3 && anchor.normal.length === 3 && anchor.size.length === 2, label);
    assert([...anchor.position, ...anchor.normal, ...anchor.size].every(Number.isFinite), label + ': finite metric frame');
    near(new THREE.Vector3().fromArray(anchor.normal).length(), 1); assert(anchor.size.every(value => value > 0), label);
    assert(!host.userData.industrialDisplay && !host.userData.industrialAction, 'Stickers cannot cover interactive controls.');
  })); assert(count > 0 && count <= 6, `${label}: ${count} anchors`);
  assert.doesNotThrow(() => JSON.stringify(object.toJSON()), label + ': plain metadata, without runtime parent cycles');
}

for (const dimensions of [[2, .1, .08], [.08, 2, .1], [.08, .1, 2]]) {
  const geometry = prefab.fabricatedBox(...dimensions, true), mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({side: THREE.DoubleSide})), box = bounds(mesh), size = box.getSize(new THREE.Vector3());
  dimensions.forEach((value, axis) => near(size.getComponent(axis), value));
  const axis = dimensions.indexOf(2), direction = new THREE.Vector3().setComponent(axis, -1), origin = new THREE.Vector3().setComponent(axis, 3);
  assert.equal(new THREE.Raycaster(origin, direction).intersectObject(mesh).length, 0, 'Open tube center remains a real opening along its whole length.');
  origin.setComponent((axis + 1) % 3, dimensions[(axis + 1) % 3] / 2 - .001);
  assert(new THREE.Raycaster(origin, direction).intersectObject(mesh).length, 'The surrounding annular wall has a real end face.');
}
const sheet = prefab.fabricatedBox(.7, .9, .14), n = sheet.attributes.normal;
assert(Array.from({length: n.count}, (_, i) => [n.getX(i), n.getY(i), n.getZ(i)].filter(value => Math.abs(value) > .1).length).some(count => count >= 2), 'Folded covers include actual chamfer normals.');
function expanded(geometry, name) {
  const attribute = geometry.attributes[name], values = [];
  for (let vertex = 0; vertex < (geometry.index ? geometry.index.count : attribute.count); vertex++) {
    const index = geometry.index ? geometry.index.getX(vertex) : vertex;
    for (let component = 0; component < attribute.itemSize; component++) values.push(attribute.array[index * attribute.itemSize + component]);
  } return values;
}
for (const source of [new THREE.CylinderBufferGeometry(.1, .08, .3, 16), sheet.clone().toNonIndexed()]) {
  const before = Object.fromEntries(['position', 'normal', 'uv'].map(name => [name, expanded(source, name)])), compact = prefab.compactFabricated(source.clone());
  for (const name of Object.keys(before)) assert.deepEqual(expanded(compact, name), before[name], 'Tuple compaction preserves every expanded ' + name + ' exactly.');
  assert(compact.attributes.position.count < (compact.index ? compact.index.count : compact.attributes.position.count));
}

// Arbitrary clipped bearings on an oblique junction have a connected vertical
// hanger and a crossmember that reaches both rail webs below the shafts.
const fixture = new THREE.Group(), bearing = new THREE.Object3D(); bearing.position.set(.31, -.065, .21);
prefab.junctionBearingSupport(prefab.builder(), fixture, bearing, [{x: -2, z: -1}, {x: 2, z: 1}], 1);
const plate = bounds(fixture.children[0]), hanger = bounds(fixture.children[1]), beam = bounds(fixture.children[2]);
assert(plate.intersectsBox(hanger)); assert(hanger.intersectsBox(beam)); assert(beam.max.y < -.15, 'Crossmembers remain below the full roller sweep.');
assert(beam.getSize(new THREE.Vector3()).length() > 1.2, 'The support bridges across both rail webs.');

let conveyorTriangles = 0;
for (const variant of prefab.conveyorPresets) {
  const object = prefab.createIndustrialPrefab('conveyor', variant.id), metric = stats(object); conveyorTriangles = Math.max(conveyorTriangles, metric.triangles);
  assert(metric.meshes < 250 && metric.triangles < 60000, variant.id + ': bounded complete mechanism'); anchors(object, variant.id);
  assert.equal(object.children[0].name, 'Bastidor'); assert.equal(object.children[2].name, 'Rodillos');
}
const processor = prefab.createIndustrialPrefab('processor'), legs = processor.children[1], frame = processor.children[0], head = processor.children[3];
const support = legs.children.find(mesh => /Pata de máquina/.test(mesh.material.name)), cabinet = frame.children.find(mesh => /Bancada/.test(mesh.material.name));
assert(bounds(support).intersectsBox(bounds(cabinet)), 'Processor legs contact the chassis instead of ending 10 mm short.');
const sleeve = frame.children.find(mesh => /Camisa fija/.test(mesh.material.name)), rods = head.children.find(mesh => /Vástago del actuador/.test(mesh.material.name));
for (const y of [.60, .545, .49]) {
  head.position.y = y; processor.updateMatrixWorld(true);
  assert(bounds(sleeve).intersectsBox(bounds(rods)), 'Actuator rods stay engaged in fixed guide sleeves through the entire cosmetic stroke.');
}
for (const kind of ['source', 'processor', 'palletQueue', 'plc']) anchors(prefab.createIndustrialPrefab(kind), kind);
let robotTriangles = 0;
for (const definition of robots.VARIANTS) {
  const object = robotFactory.createRobot(Object.assign({}, definition.preset, {detail: 'high'})); robotTriangles = Math.max(robotTriangles, stats(object).triangles); anchors(object, definition.id);
}
const vacuum = robotFactory.createRobot(Object.assign({}, robots.defaults('articulated-general'), {tool: 'vacuum'})), rig = vacuum.userData.robotRig;
for (const cup of rig.toolAssembly.children.filter(node => node.name === 'Fuelle de ventosa')) {
  cup.updateMatrix(); cup.geometry.computeBoundingBox(); const envelope = cup.geometry.boundingBox.clone().applyMatrix4(cup.matrix);
  near(envelope.max.x, 0); assert(envelope.min.x <= -.0399, 'Real bellows lip meets its stem and the mathematical TCP.');
}
const delta = robotFactory.createRobot(robots.defaults('delta')), deltaRig = delta.userData.robotRig, column = deltaRig.visual.children.find(node => /Columna estructural/.test(node.name));
const beamTop = deltaRig.visual.children.find(node => /Viga superior/.test(node.name)); assert(bounds(column).intersectsBox(bounds(beamTop)), 'Delta roof beams are attached to their posts.');
const plateDelta = deltaRig.visual.children.find(node => /Placa superior de mecanismo/.test(node.name)), bridgeDelta = deltaRig.visual.children.find(node => /Puente estructural.*X/.test(node.name));
assert(bounds(plateDelta).intersectsBox(bounds(bridgeDelta)), 'Parallel robot mechanism plate is supported by its frame.');
let productTriangles = 0;
for (const definition of productSchema.VARIANTS) {
  const id = definition.id || definition, object = products.createProduct(id); productTriangles = Math.max(productTriangles, stats(object).triangles); anchors(object, id); assert(stats(object).meshes <= 8);
}
// Replacing one actor must not dispose a store-owned photographic texture.
const sharedMap = new THREE.Texture(); sharedMap.userData = {sharedIndustrialTexture: true}; let disposed = false; sharedMap.addEventListener('dispose', () => { disposed = true; });
let oneMesh; vacuum.traverse(node => { if (!oneMesh && node.isMesh) oneMesh = node; }); oneMesh.material.map = sharedMap;
robotFactory.refreshRobotGeometry(vacuum, robots.defaults('articulated-general')); assert.equal(disposed, false);
console.log(`Industrial fabrication: hollow profiles, chamfered covers, connected junctions/actuators/Delta, ${prefab.conveyorPresets.length} conveyors, ${robots.VARIANTS.length} robots, ${productSchema.VARIANTS.length} products, serializable sticker frames. Maximum triangles conveyor=${conveyorTriangles}, robot=${robotTriangles}, product=${productTriangles}.`);
