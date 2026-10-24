// Actual procedural geometry and persisted component identities; no WebGL or user data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const behaviorSchema = require('../shared/behaviors');
const materialSchema = require('../shared/materials');
const layout = behaviorSchema.conveyorLayout;
const read = file => fs.readFileSync(path.join(__dirname, '../src/editor/', file), 'utf8').replace(/^import .*;\r?\n/gm, '');
const prefabSource = read('IndustrialPrefabs.js').replace(/^export const /gm, 'const ').replace(/^export function /gm, 'function ');
const createIndustrialPrefab = new Function('THREE', 'behaviorSchema', prefabSource + '\nreturn createIndustrialPrefab;')(THREE, behaviorSchema);
const documentSource = read('SceneDocument.js').replace('export default class SceneDocument', 'return class SceneDocument');
const SceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', documentSource)(THREE, behaviorSchema, createIndustrialPrefab);
const materialSource = read('SurfaceMaterialSystem.js').replace('export default class SurfaceMaterialSystem', 'return class SurfaceMaterialSystem');
const SurfaceMaterialSystem = new Function('THREE', 'materialSchema', materialSource)(THREE, materialSchema);

function near(actual, expected, epsilon = 1e-5, message = '') {
  assert(Math.abs(actual - expected) <= epsilon, `${message}: ${actual} != ${expected}`);
}
function meshes(root) { const result = []; root.traverse(node => { if (node.isMesh) result.push(node); }); return result; }
function vertices(root) {
  root.updateWorldMatrix(true, true);
  const result = [], point = new THREE.Vector3();
  for (const mesh of meshes(root)) {
    const positions = mesh.geometry.attributes.position;
    for (let index = 0; index < positions.count; index++) {
      point.fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld);
      result.push(point.clone());
    }
  }
  return result;
}
function terminal(config) {
  const distance = config.surface === 'belt' ? 0 : 0.1;
  return layout.pathPoint(config, distance);
}
function sideOf(config) {
  return config.layout === 'curveRight' || config.layout === 'tee' && config.branchSide === 'right' ? -1 : 1;
}
function projections(root, config) {
  const p = terminal(config), side = sideOf(config);
  return vertices(root).map(vertex => ({
    along: (vertex.x - p.x) * p.tx + (vertex.z - p.z) * p.tz,
    outward: side * (-(vertex.x - p.x) * p.tz + (vertex.z - p.z) * p.tx), y: vertex.y
  }));
}
function extent(rows, field) { const values = rows.map(row => row[field]); return [Math.min(...values), Math.max(...values)]; }
// Applying a saved quaternion may normalize its last floating-point bit and
// JSON turns -0 into 0; those changes must not count as lost authored state.
function persisted(value) { return JSON.parse(JSON.stringify(value, (key, field) => typeof field === 'number' ? Math.round(field * 1e12) / 1e12 : field)); }
function dispose(root) {
  const resources = new Set();
  root.traverse(node => {
    if (node.geometry) resources.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) {
      resources.add(material);
      Object.values(material).forEach(value => { if (value && value.isTexture) resources.add(value); });
    }
  });
  resources.forEach(resource => resource.dispose());
}

function assertMotor(config, description) {
  const root = createIndustrialPrefab('conveyor', undefined, config), motor = root.children[3];
  assert.equal(motor.name, 'Motorreductor', description + ': persisted mechanical path 3');
  const body = motor.getObjectByName('Motor eléctrico'), reducer = motor.getObjectByName('Reductor angular');
  assert(body && reducer, description + ': electric motor and angular gearbox remain identifiable parts');
  const p = terminal(config), side = sideOf(config), origin = motor.getWorldPosition(new THREE.Vector3());
  near((origin.x - p.x) * p.tx + (origin.z - p.z) * p.tz, 0, 1e-6, description + ': drive on the terminal roller');
  near(side * (-(origin.x - p.x) * p.tz + (origin.z - p.z) * p.tx), config.width / 2 + 0.055, 1e-6, description + ': external drive side');
  near(origin.y, -0.065, 1e-6, description + ': output shaft at the roller center height');

  const rows = projections(motor, config), outward = extent(rows, 'outward'), height = extent(rows, 'y');
  assert(outward[0] >= config.width / 2 - 0.08, description + ': shaft and mount cannot cross the useful transport width');
  assert(outward[1] <= config.width / 2 + 0.43, description + ': compact lateral footprint');
  assert(height[1] < 0.05, description + ': only the external coupling flange may extend slightly above the deck');
  rows.filter(row => row.y > 0).forEach(row => assert(row.outward > config.width / 2 + 0.08, description + ': raised flange remains outside the useful transport width'));
  const bodyRows = projections(body, config), along = extent(bodyRows, 'along'), normal = extent(bodyRows, 'outward');
  assert(along[0] > 0.08, description + ': electric motor extends downstream inside this module');
  assert(along[1] - along[0] > (normal[1] - normal[0]) * 1.35, description + ': motor axis follows travel instead of projecting across the aisle');

  // Cast through the actual output shaft at the roller's height, independently
  // of decorative casing bounds, so a disconnected or vertically shifted shaft fails.
  motor.updateWorldMatrix(true, true);
  const rayOrigin = motor.localToWorld(new THREE.Vector3(-0.15, 0, -0.03));
  const direction = new THREE.Vector3(1, 0, 0).transformDirection(motor.matrixWorld);
  const hits = new THREE.Raycaster(rayOrigin, direction, 0, 0.3).intersectObject(motor, true);
  assert(hits.length, description + ': physical shaft reaches the terminal roller coupling');
  const hit = motor.worldToLocal(hits[0].point.clone());
  assert(Math.abs(hit.x) < 0.065 && Math.abs(hit.y) < 0.01, description + ': shaft is coaxial with the terminal roller');

  // Sample both ports and a package-width corridor through each actual branch.
  // An assembly intruding above the deck would obstruct package entry/transfer.
  for (const route of layout.pathBranches(config)) for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
    const point = layout.pathPoint(config, layout.pathLength(config, route) * fraction, route);
    for (const lateral of [-0.4, 0, 0.4]) {
      const origin = new THREE.Vector3(point.x - point.tz * config.width * lateral, 0.3, point.z + point.tx * config.width * lateral);
      const blocking = new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0), 0, 0.30).intersectObject(motor, true);
      assert.equal(blocking.length, 0, description + ': open product corridor and modular ports');
    }
  }
  dispose(root);
}

async function run() {
  const base = behaviorSchema.defaultBehavior('conveyor');
  let cases = 0;
  for (const axis of ['x', 'z']) for (const surface of ['rollers', 'belt']) for (const width of [0.4, 1, 2.4]) {
    for (const shape of ['straight', 'curveLeft', 'curveRight', 'tee']) {
      const branchSides = shape === 'tee' ? ['left', 'right'] : ['left'];
      for (const branchSide of branchSides) {
        const config = Object.assign({}, base, {axis, surface, width, layout: shape, branchSide, length: 4, radius: 0.4, curveAngle: 120});
        assertMotor(config, `${shape}/${axis}/${surface}/${width}/${branchSide}`); cases++;
      }
    }
  }

  // Two aligned modules share a transport port, while their external drive
  // envelopes remain separate even on a short practical one-meter segment.
  for (const axis of ['x', 'z']) {
    const config = Object.assign({}, base, {axis, length: 1, withPanel: false, withSensors: false, withPallet: false});
    const first = createIndustrialPrefab('conveyor', undefined, config), second = createIndustrialPrefab('conveyor', undefined, config);
    const ports = layout.ports(config);
    second.position.set(ports.output.x - ports.input.x, 0, ports.output.z - ports.input.z);
    first.updateWorldMatrix(true, true); second.updateWorldMatrix(true, true);
    const a = new THREE.Box3().setFromObject(first.children[3]), b = new THREE.Box3().setFromObject(second.children[3]);
    assert.equal(a.intersectsBox(b), false, axis + ': neighboring drive assemblies must not collide across a connected port');
    dispose(first); dispose(second);
  }

  const scene = new THREE.Group(), document = new SceneDocument({}); document.registerRoom('hall', scene);
  const owner = document.addPrefab('hall', 'conveyor'), id = owner.userData.editorId;
  const entry = document.additions.get(id), content = owner.children[0], motor = content.children[3];
  const ids = Array.from(entry.nodes, ([key, object]) => [key, object, object.userData.editorId]);
  const sensor = entry.nodes.get('4'), sensorPose = [-1.2, 0.34, 0.08];
  document.setTransform(sensor, {position: sensorPose});
  const control = entry.nodes.get('6.2');
  const controlConfig = document.getBehaviors(control).map(value => value.type === 'control' ? Object.assign({}, value, {variable: 'speed', value: 0.8}) : value);
  document.setBehaviors(control, controlConfig);
  const config = Object.assign({}, document.getBehaviors(owner).find(value => value.type === 'conveyor'), {axis: 'z', layout: 'curveRight', radius: 2.2, width: 1.6});
  document.setBehaviors(owner, [config]);
  assert.strictEqual(content.children[3], motor, 'Refresh preserves the original motor component at child 3');
  ids.forEach(([key, object, childId]) => { assert.strictEqual(entry.nodes.get(key), object); assert.equal(object.userData.editorId, childId); });
  assert.deepEqual(sensor.position.toArray(), sensorPose, 'Refresh keeps independently edited sensor poses');
  assert.equal(document.getBehaviors(control).find(value => value.type === 'control').value, 0.8);
  const saved = await document.serialize(), reopened = new SceneDocument({}); reopened.registerRoom('hall', new THREE.Group());
  await reopened.load(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(persisted(await reopened.serialize()), persisted(saved), 'Motor redesign does not change the project format or saved actor properties');

  const materials = new SurfaceMaterialSystem({}, document, {});
  assert(materials.getSlots(owner).some(slot => slot.value === 'part:Motorreductor'), 'Motor remains selectable as an independent material part');
  assert(materials.getSlots(owner).some(slot => slot.value === 'part:Herrajes / Motorreductor'), 'Previously saved motor material slots remain available');
  meshes(motor).forEach(mesh => assert.equal(mesh.name, 'Herrajes / Motorreductor', 'Old material part selectors still cover every merged motor surface'));
  const allMeshes = meshes(owner), before = new Map(allMeshes.map(mesh => [mesh, mesh.material]));
  document.setBehaviors(owner, [config, materialSchema.normalizeMaterial({preset: 'paintedMetal', slot: 'part:Motorreductor', color: '#354f72'})]);
  await materials.sync('hall');
  meshes(motor).forEach(mesh => assert(materials.isOwnedMaterial(mesh.material), 'Part customization includes all motor subgroup surfaces'));
  allMeshes.filter(mesh => !meshes(motor).includes(mesh)).forEach(mesh => assert.strictEqual(mesh.material, before.get(mesh), 'Changing the motor material cannot change sensors, controls or frame'));
  materials.dispose();
  allMeshes.forEach(mesh => assert.strictEqual(mesh.material, before.get(mesh), 'Material ownership restores every authored surface'));
  document.setBehaviors(owner, [config, materialSchema.normalizeMaterial({preset: 'steel', slot: 'part:Herrajes / Motorreductor'})]);
  await materials.sync('hall');
  meshes(motor).forEach(mesh => assert(materials.isOwnedMaterial(mesh.material), 'A previously saved material selector still customizes all motor subgroups'));
  materials.dispose();
  dispose(scene); dispose(reopened.getRoot('hall'));
  console.log(`Conveyor motor: ${cases} compact external drives, terminal shaft alignment, axis/curve/T orientation, modular port clearance, stable actors and material part customization passed.`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
