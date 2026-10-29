const __layout = require("../../tooling/layout.cjs");
// Real Three geometry; no WebGL, DOM, network or user project mutation.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const THREE = require('three');
const behaviorSchema = require('../../modules/logistica-industrial/contracts/behaviors');
const layout = behaviorSchema.conveyorLayout;
const source = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-conveyor-geometry.js"), '../src/editor/IndustrialPrefabs.js')), 'utf8')
  .replace(/^import .*$/mg, '').replace(/export const /g, 'const ').replace(/export function /g, 'function ');
const {createIndustrialPrefab, conveyorPresets, industrialPrefabs} = new Function('THREE', 'behaviorSchema', source + '\nreturn {createIndustrialPrefab, conveyorPresets, industrialPrefabs};')(THREE, behaviorSchema);

function near(actual, expected, epsilon = 1e-6) {
  assert(Math.abs(actual - expected) <= epsilon, `${actual} must be within ${epsilon} of ${expected}`);
}
function count(root) {
  let meshes = 0, triangles = 0;
  root.traverse(node => { if (node.isMesh) { meshes++; triangles += (node.geometry.index ? node.geometry.index.count : node.geometry.attributes.position.count) / 3; } });
  return {meshes, triangles};
}
function configOf(root) { return root.userData.editorDefaultBehaviors.find(value => value.type === 'conveyor'); }
function assertTop(root, point, expected = 0) {
  root.updateWorldMatrix(true, true);
  const ray = new THREE.Raycaster(new THREE.Vector3(point.x, 0.5, point.z), new THREE.Vector3(0, -1, 0));
  const hits = ray.intersectObject(root.children[2], true);
  assert(hits.length, 'The shared transport path must lie on the actual 3D surface.');
  near(hits[0].point.y, expected, 0.00001);
}

assert.deepStrictEqual(conveyorPresets.map(item => item.id), layout.presetVariants);
assert.equal(industrialPrefabs.length, 10 + conveyorPresets.length + behaviorSchema.robots.VARIANTS.length + behaviorSchema.vehicles.VARIANTS.length + behaviorSchema.productEquipment.VARIANTS.length + behaviorSchema.warehouseRacks.SYSTEMS.length);
// These are the preserved legacy recipes. Versioned catalogue equipment has
// its own mechanism, admission and physical-model validation in the equipment
// catalogue tests, rather than inheriting the old start/middle power shortcut.
conveyorPresets.filter(preset => !preset.config.equipmentId).forEach(preset => {
  const root = createIndustrialPrefab('conveyor', preset.id);
  const config = configOf(root);
  assert.equal(root.userData.editorPrefabVariant, preset.id);
  Object.keys(preset.config).forEach(key => assert.deepStrictEqual(config[key], preset.config[key]));
  assert.equal(root.children[4].visible, config.withSensors);
  assert.equal(root.children[6].visible, config.withPanel);
  root.children.slice(7, 10).forEach(anchor => {
    assert.equal(anchor.visible, false, 'Every conveyor typology has an unobstructed inlet.');
    assert.equal(anchor.children.length, 0);
    assert.equal(anchor.userData.industrialRetiredSupply, true);
    assert(!anchor.userData.editorPrefabNode && !anchor.userData.editorPrefabKey);
  });
  assert.equal(config.withPallet, false);
  assert(!root.children.some(child => child.userData.industrialPallet || child.userData.industrialConveyorBranchPallet));
  assert.equal(config.powered, config.role !== 'start');
  const budget = count(root);
  assert(budget.meshes < 150 && budget.triangles < 30000, preset.id + ' must retain a small WebXR rendering budget.');
});
assert.throws(() => createIndustrialPrefab('conveyor', 'unknown'), /compatible/);

['curveLeft', 'curveRight'].forEach(shape => ['rollers', 'belt'].forEach(surface => ['x', 'z'].forEach(axis => {
  const config = Object.assign(behaviorSchema.defaultBehavior('conveyor'), {layout: shape, surface, axis, width: 1.4, radius: 2.1, curveAngle: 120});
  const root = createIndustrialPrefab('conveyor', undefined, config);
  const length = layout.pathLength(config);
  const rollers = root.children[2].children.filter(node => node.userData.industrialRoller);
  assert.equal(rollers.length, 1, 'Dynamic rollers are merged while preserving UV animation.');
  assert.equal(rollers[0].userData.industrialRoller.texture, true);
  const count = Math.max(2, Math.min(640, Math.ceil(length / 0.15)));
  [0, Math.floor(count / 2), count - 1].forEach(index => {
    const distance = surface === 'rollers' ? 0.1 + (length - 0.2) * index / (count - 1) : length * index / (count - 1);
    assertTop(root, layout.pathPoint(config, distance), surface === 'belt' ? 0 : 0);
  });
  const input = layout.pathPoint(config, 0), output = layout.pathPoint(config, length);
  assert.equal(root.children[9].children.length, 0, 'Curves also expose a free outlet without automatic pallets.');
  assert(Math.hypot(output.x - input.x, output.z - input.z) > 1, 'Curve endpoints must describe an actual turn.');
  if (surface === 'belt') {
    const belt = root.children[2].children.find(node => node.userData.industrialBelt);
    assert(belt && belt.material.map.wrapS === THREE.RepeatWrapping);
    assert.equal(belt.userData.industrialBelt.metersPerRepeat, 1);
    assert.equal(belt.userData.industrialBelt.scaleAxis, axis);
    const position = belt.geometry.attributes.position;
    near(position.getX(0), input.x + input.tz * config.width / 2);
    near(position.getZ(0), input.z - input.tx * config.width / 2);
    near(position.getY(0), 0);
    const uvs = belt.geometry.attributes.uv;
    near(Math.max(...uvs.array.filter((value, index) => index % 2 === 0)), length, 1e-5);
  }
})));

['split', 'merge'].forEach(junctionMode => ['rollers', 'belt'].forEach(surface => {
  const config = Object.assign(behaviorSchema.defaultBehavior('conveyor'), {layout: 'tee', junctionMode, surface, role: 'end', length: 5, branchSide: 'right'});
  const root = createIndustrialPrefab('conveyor', undefined, config);
  const ports = layout.ports(config);
  const branchPallet = root.children.find(node => node.userData.industrialConveyorBranchPallet);
  assert.equal(branchPallet, undefined, 'No T topology may append an automatic side pallet.');
  const sample = junctionMode === 'split' ? layout.pathLength(config, 'branch') - 0.1 : 0.1;
  const point = layout.pathPoint(config, sample, 'branch');
  assertTop(root, point, 0); // The trimmed branch now meets the main deck at one level.
  assert.equal(root.children[7].visible, false);
  assert.equal(ports.branch.incoming, junctionMode === 'merge');
}));

const root = createIndustrialPrefab('conveyor');
const actors = root.children.slice(3, 10);
const config = Object.assign({}, configOf(root), {length: 7, width: 1.8, withSensors: false, withPanel: false, withPallet: false});
const originalEntry = root.children[4]; originalEntry.position.x = -0.9;
assert(createIndustrialPrefab.refresh(root, config));
assert.deepStrictEqual(root.children.slice(3, 10), actors, 'Changing dimensions must preserve every editable component identity.');
near(originalEntry.position.x, -0.9);
assert.equal(root.children[4].visible, false); assert.equal(root.children[5].visible, false); assert.equal(root.children[6].visible, false); assert.equal(root.children[9].visible, false);
near(root.children[4].scale.z, 1);
near(root.children[4].children.find(node => node.userData.industrialSensorVolume).geometry.parameters.depth, 1.88);
near(root.children[4].children[0].geometry.parameters.depth, 0.065);
assert.equal(createIndustrialPrefab.refresh(root, config), false, 'An unchanged configuration must not rebuild geometry.');
const widerBounds = new THREE.Box3().setFromObject(root.children[2]);
near(widerBounds.max.z - widerBounds.min.z, 1.84, 1e-5);
const next = Object.assign({}, config, {layout: 'curveLeft', radius: 3, withSensors: true, withPanel: true});
assert(createIndustrialPrefab.refresh(root, next));
near(originalEntry.position.x, -0.9);
assert.equal(root.children[4].visible, true); assert.equal(root.children[6].visible, true);
root.children[6].visible = false;
createIndustrialPrefab.refresh(root, Object.assign({}, next, {radius: 3.4}));
assert.equal(root.children[6].visible, false, 'User-hidden panels stay hidden while dimensions change.');
root.children[4].visible = true;
createIndustrialPrefab.enforceOptions(root, Object.assign({}, next, {withSensors: false}));
assert.equal(root.children[4].visible, false, 'Saved child visibility cannot enable hardware excluded by the module configuration.');
assert.equal(root.children[5].visible, false);
root.children[7].visible = true; root.children[8].visible = true; root.children[9].visible = true;
createIndustrialPrefab.enforceOptions(root, next);
root.children.slice(7, 10).forEach(anchor => { assert.equal(anchor.visible, false); assert.equal(anchor.children.length, 0); });

const split = createIndustrialPrefab('conveyor', undefined, Object.assign({}, behaviorSchema.defaultBehavior('conveyor'), {layout: 'tee', role: 'end', junctionMode: 'split'}));
const splitConfig = configOf(split), mainPallet = split.children[9];
assert.equal(mainPallet.visible, false);
assert(!split.children.find(node => node.userData.industrialConveyorBranchPallet));
const splitHardware = split.children[0];
createIndustrialPrefab.refresh(split, Object.assign({}, splitConfig, {outputId: 'custom-next'}));
assert.equal(mainPallet.visible, false);
assert.strictEqual(split.children[0], splitHardware, 'Linking ports must not rebuild mechanical geometry.');
createIndustrialPrefab.refresh(split, Object.assign({}, splitConfig, {outputId: 'custom-next', branchId: 'custom-other'}));
assert.equal(mainPallet.visible, false);
createIndustrialPrefab.refresh(split, splitConfig);
assert.equal(mainPallet.visible, false, 'Unlinking a terminal port must keep the outlet free.');
mainPallet.visible = true;
createIndustrialPrefab.enforceOptions(split, Object.assign({}, splitConfig, {outputId: 'custom-next', branchId: 'custom-other'}));
assert.equal(mainPallet.visible, false);
assert.equal(mainPallet.children.length, 0);

console.log('Conveyor geometry: catalog, real curves and T branches, rollers/belt UVs, dimensions, oriented ports, stable editable components, option visibility and rendering budgets passed.');
