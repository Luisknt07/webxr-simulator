// Real merged Three.js meshes: a centre-only branch test misses shaft overlap.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const THREE = require('three');
const schema = require('../shared/behaviors');
const layout = schema.conveyorLayout;
const factory = fs.readFileSync(path.join(__dirname, '../src/editor/IndustrialPrefabs.js'), 'utf8')
  .replace(/^import .*$/mg, '').replace(/export const /g, 'const ').replace(/export function /g, 'function ');
const {createIndustrialPrefab, refreshConveyorGeometry, refreshSourceGeometry, refreshProcessorGeometry, refreshPalletQueueGeometry} = new Function('THREE', 'behaviorSchema', factory + '\nreturn {createIndustrialPrefab, refreshConveyorGeometry, refreshSourceGeometry, refreshProcessorGeometry, refreshPalletQueueGeometry};')(THREE, schema);
const near = (a, b, epsilon = 1e-6) => assert(Math.abs(a - b) <= epsilon, `${a} differs from ${b}`);
const verticesPerRoller = new THREE.CylinderBufferGeometry(1, 1, 1, 20).toNonIndexed().attributes.position.count;
let shortenedShafts = 0;

function vertices(mesh) {
  const result = [], attribute = mesh.geometry.attributes.position;
  const indices = mesh.geometry.index;
  for (let i = 0; i < (indices ? indices.count : attribute.count); i++) result.push(new THREE.Vector3().fromBufferAttribute(attribute, indices ? indices.getX(i) : i).applyMatrix4(mesh.matrixWorld));
  return result;
}
function assertJunction(config) {
  const root = createIndustrialPrefab('conveyor', undefined, config); root.updateMatrixWorld(true);
  const main = layout.pathPoint(config, 0), normal = new THREE.Vector3(-main.tz, 0, main.tx);
  const branchPoint = layout.pathPoint(config, config.junctionMode === 'merge' ? 0 : layout.pathLength(config, 'branch'), 'branch');
  const branchAcross = new THREE.Vector3(-branchPoint.tz, 0, branchPoint.tx);
  let branchVertices = 0;
  root.children[2].traverse(mesh => {
    if (!mesh.isMesh) return;
    const roller = mesh.userData.industrialRoller, belt = mesh.userData.industrialBelt;
    if ((!roller || roller.route !== 'branch') && (!belt || belt.route !== 'branch')) return;
    const points = vertices(mesh); branchVertices += points.length;
    points.forEach(point => {
      const separation = Math.abs(point.dot(normal) - main.x * normal.x - main.z * normal.z);
      assert(separation >= config.width / 2 + (roller ? .02 : .001) - 1e-5,
        `A rendered ${roller ? 'shaft' : 'belt'} crosses the main bank: ${JSON.stringify(config)} / ${separation}`);
    });
    if (roller && config.mechanism === 'merge') {
      for (let start = 0; start < points.length; start += verticesPerRoller) {
        const projection = points.slice(start, start + verticesPerRoller).map(point => point.dot(branchAcross));
        const span = Math.max(...projection) - Math.min(...projection);
        if (span < config.width - .10) shortenedShafts++;
      }
    }
  });
  assert(branchVertices, 'A branch needs a physical receiving deck outside the main bank.');
  let meshes = 0, triangles = 0;
  root.traverse(mesh => { if (mesh.isMesh) { meshes++; triangles += (mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count) / 3; } });
  assert(meshes < 150 && triangles < 30000, 'Clipping and fittings must stay within the existing complete-model budget.');
}

for (const axis of ['x', 'z']) for (const branchSide of ['left', 'right']) {
  for (const mergeAngle of [30, 45, 60, 75]) assertJunction(Object.assign(schema.defaultBehavior('conveyor'), {
    equipmentId: 'merge-y', layout: 'tee', mechanism: 'merge', junctionMode: 'merge', surface: 'rollers', axis, branchSide, mergeAngle, rollerPitch: .10, length: 4, width: 1
  }));
  for (const junctionMode of ['merge', 'split']) for (const surface of ['rollers', 'belt']) assertJunction(Object.assign(schema.defaultBehavior('conveyor'), {
    layout: 'tee', junctionMode, surface, axis, branchSide, length: 4, width: 1
  }));
  assertJunction(Object.assign(schema.defaultBehavior('conveyor'), {equipmentId: 'merge-belt', mechanism: 'merge', layout: 'tee', junctionMode: 'merge', surface: 'belt', axis, branchSide, length: 4, width: 1}));
}
assert(shortenedShafts > 10, 'Diagonal junctions need shortened real shafts, not a missing bank or hidden full shafts.');

function coneFromMesh(points) {
  // Each closed cylinder's two cap centres repeat once per cap triangle.
  // Recover the actual rendered shaft and taper after batching/rotation.
  const frequencies = new Map();
  points.forEach(point => {
    const key = point.toArray().map(n => n.toFixed(6)).join(':');
    const previous = frequencies.get(key); frequencies.set(key, {point, count: previous ? previous.count + 1 : 1});
  });
  const centres = Array.from(frequencies.values()).sort((a, b) => b.count - a.count).slice(0, 2);
  assert(centres.every(item => item.count >= 19), 'Recover two physical cap centres from the merged model.');
  const a = centres[0].point, b = centres[1].point, length = a.distanceTo(b), axis = b.clone().sub(a).normalize();
  const radius = end => Math.max(...points.filter(p => Math.abs(p.clone().sub(end).dot(axis)) < 1e-5).map(p => p.distanceTo(end)));
  return {a, b, axis, length, ra: radius(a), rb: radius(b)};
}
function insideCone(point, cone) {
  const relative = point.clone().sub(cone.a), axial = relative.dot(cone.axis);
  if (axial < .0001 || axial > cone.length - .0001) return false;
  const radial = relative.addScaledVector(cone.axis, -axial).length();
  return radial < cone.ra + (cone.rb - cone.ra) * axial / cone.length - .001;
}
function intersectsCones(a, b) {
  const across = new THREE.Vector3(0, 1, 0).cross(a.axis).normalize(), up = a.axis.clone().cross(across).normalize();
  for (const fraction of [.001, .1, .5, .9, .999]) for (let step = 0; step < 24; step++) {
    const angle = step * Math.PI * 2 / 24, radius = a.ra + (a.rb - a.ra) * fraction;
    const p = a.a.clone().addScaledVector(a.axis, fraction * a.length)
      .addScaledVector(across, radius * Math.cos(angle)).addScaledVector(up, radius * Math.sin(angle));
    if (insideCone(p, b)) return true;
  }
  return false;
}
for (const advanced of [false, true]) for (const shape of ['curveLeft', 'curveRight']) for (const axis of ['x', 'z']) {
  const config = Object.assign(schema.defaultBehavior('conveyor'), {layout: shape, axis, width: 1.4, radius: 1.2, curveAngle: 120, rollerPitch: advanced ? .09 : .15}, advanced ? {equipmentId: 'conveyor.curve-test'} : {});
  const root = createIndustrialPrefab('conveyor', undefined, config); root.updateMatrixWorld(true);
  let cones = [];
  root.children[2].traverse(mesh => {
    if (!mesh.userData.industrialRoller) return;
    const points = vertices(mesh);
    for (let start = 0; start < points.length; start += verticesPerRoller) cones.push(coneFromMesh(points.slice(start, start + verticesPerRoller)));
  });
  assert(cones.length > 10);
  for (let i = 1; i < cones.length; i++) {
    assert(Math.abs(cones[i].ra - cones[i].rb) > .01, 'Curves use genuine tapered rollers.');
    assert(!intersectsCones(cones[i - 1], cones[i]) && !intersectsCones(cones[i], cones[i - 1]), 'Adjacent rendered radial rollers must remain separate at their inner and outer ends.');
  }
}

// Smooth grades meet flat machines with genuine horizontal port tangents.
for (const axis of ['x', 'z']) for (const rise of [-.35, .35]) for (const surface of ['rollers', 'belt']) {
  const config = Object.assign(schema.defaultBehavior('conveyor'), {axis, rise, surface, length: 4, gradeProfile: 'smooth', rollerPitch: .10});
  const ports = layout.ports(config); near(ports.input.ty, 0); near(ports.output.ty, 0); near(ports.output.y, rise);
  near(layout.pathPoint(config, 1).y, rise * .15625); near(layout.pathPoint(config, 2).ty, rise / 4 * 1.5);
  const root = createIndustrialPrefab('conveyor', undefined, config); root.updateMatrixWorld(true);
  const count = Math.ceil(config.length / config.rollerPitch);
  for (const index of [0, 7, 20, count - 1]) {
    const p = layout.pathPoint(config, .10 + (config.length - .20) * index / (count - 1));
    const ray = new THREE.Raycaster(new THREE.Vector3(p.x, 2, p.z), new THREE.Vector3(0, -1, 0));
    const hits = ray.intersectObject(root.children[2], true); assert(hits.length, 'Grade path must have a physical deck.'); near(hits[0].point.y, p.y, .0015);
  }
  const actor = root.children[6]; refreshConveyorGeometry(root, Object.assign({}, config, {gradeProfile: 'linear'}));
  assert.strictEqual(root.children[6], actor, 'Changing the grade preserves the editable panel actor.');
  near(layout.pathPoint(Object.assign({}, config, {gradeProfile: 'linear'}), 1).y, rise / 4);
}

// Hiding the local cabinet must not destroy its command actors or state.
for (const [kind, slot, refresh] of [['source', 2, refreshSourceGeometry], ['processor', 2, refreshProcessorGeometry], ['palletQueue', 1, refreshPalletQueueGeometry]]) {
  const root = createIndustrialPrefab(kind, undefined, {withPanel: false}), panel = root.children[slot]; assert.equal(panel.visible, false);
  refresh(root, {withPanel: true}); assert.strictEqual(root.children[slot], panel); assert.equal(panel.visible, true);
}
const queueConfig = {palletCapacity: 4, capacity: 128, withPanel: false}, queue = createIndustrialPrefab('palletQueue', undefined, queueConfig);
const bays = layout.palletQueueLayout(queueConfig).pallets, wood = queue.children[0].children.filter(child => child.userData.industrialPalletWoodSize);
assert.equal(wood.length, 4); wood.forEach((object, index) => { near(object.position.x, bays[index].position[0]); near(object.position.z, bays[index].position[2]); });
refreshPalletQueueGeometry(queue, Object.assign({}, queueConfig, {acceptsPallets: true}));
assert(!queue.children[0].children.some(child => child.userData.industrialPalletWoodSize && child.visible), 'Whole pallets need empty bays, not a second pallet underneath.');
assert.equal(queue.children[0].children.filter(child => /Bahía/.test(child.name)).length, 4);
console.log('Junction geometry: actual clipped Y/T shafts and belts, non-intersecting radial cones, smooth grades, stable optional cabinets and four independent pallet bays passed.');
