// Metric layout checks; no browser, WebGL or headset is required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const behaviorSchema = require('../shared/behaviors.js');

const source = fs.readFileSync(path.join(__dirname, '../src/editor/IndustrialPrefabs.js'), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/^export const /gm, 'const ').replace(/^export function /gm, 'function ');
const {createIndustrialPrefab, conveyorPresets} = new Function('THREE', 'behaviorSchema', source + '\nreturn {createIndustrialPrefab, conveyorPresets};')(THREE, behaviorSchema);
const close = (actual, expected, message) => assert(Math.abs(actual - expected) < 0.00001, message || `${actual} != ${expected}`);
function bounds(object) { object.updateWorldMatrix(true, true); return new THREE.Box3().setFromObject(object); }
function worldPosition(object) { return object.getWorldPosition(new THREE.Vector3()); }
function panelBounds(object, inverse) {
  const result = new THREE.Box3();
  object.traverse(node => {
    if (!node.geometry) return;
    if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
    result.union(node.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, node.matrixWorld)));
  });
  return result;
}
function inspect(kind, variant) {
  const object = createIndustrialPrefab(kind, variant);
  object.position.y = kind === 'plc' ? 1.28 : 1;
  object.updateMatrixWorld(true);
  const panel = kind === 'plc' ? object : object.children[kind === 'conveyor' ? 6 : kind === 'palletQueue' ? 1 : 2];
  const controls = panel.children.filter(node => node.userData.editorPrefabKey === 'control');
  const expectedActions = kind === 'source' ? ['start', 'stop', 'pause', 'generate', 'dispatch', 'clearQueue'] :
    kind === 'palletQueue' ? ['start', 'stop', 'pause', 'dispatch'] : kind === 'processor' ?
      ['start', 'stop', 'emergency', 'pause', 'powerOff', 'powerOn', 'operator', 'dispatch', 'resetEmergency'] :
      ['start', 'stop', 'emergency', 'pause', 'powerOff', 'powerOn', 'speedUp', 'speedDown', 'insertBox'];
  assert.deepEqual(controls.map(control => control.userData.industrialAction), expectedActions,
    `${kind} retains every command and its persisted child path.`);
  const cabinet = kind === 'processor' ? panel.children[0].children.find(mesh => mesh.material.color.getHexString() === '9cabb6') : panel.children[0];
  const cabinetBounds = bounds(cabinet), inverse = new THREE.Matrix4().getInverse(panel.matrixWorld);
  const cabinetLocal = panelBounds(cabinet, inverse);
  const screen = panel.children.find(child => child.userData.industrialDisplay), screenBounds = bounds(screen);
  assert(screenBounds.min.y >= 1.45 && screenBounds.max.y <= 1.91, 'The HMI stays above the controls at readable standing height.');
  close(bounds(panel).min.y, 0, `${kind} pedestal must remain on the floor after lifting the controls.`);
  const eye = panel.localToWorld(new THREE.Vector3(0, 0, controls[0].position.z + 0.9)); eye.y = 1.60;
  controls.forEach(control => {
    const point = worldPosition(control), cap = control.children.find(node => node.userData.industrialButton);
    assert(point.y >= 1.15 - 0.00001 && point.y <= 1.50, 'The lowest command no longer requires looking toward the knees.');
    assert(Math.atan2(Math.abs(eye.y - point.y), Math.hypot(point.x - eye.x, point.z - eye.z)) < Math.PI / 6,
      'A standing viewer can see every command within 30 degrees vertically.');
    const capBounds = bounds(cap);
    assert(capBounds.max.y < screenBounds.min.y - 0.015, 'Controls must not overlap the HMI.');
    const caption = control.children.find(child => child.name === 'Rótulo del control'), local = panelBounds(caption, inverse);
    assert(local.min.x >= cabinetLocal.min.x + 0.02 - 0.00001 && local.max.x <= cabinetLocal.max.x - 0.02 + 0.00001 &&
      local.min.y >= cabinetLocal.min.y + 0.02 - 0.00001 && local.max.y <= cabinetLocal.max.y - 0.02 + 0.00001,
    'All command captions retain at least a 20 mm border inside the cabinet face.');
    assert(local.max.z < panelBounds(cap, inverse).max.z, 'Captions stay on the panel face behind the movable button caps.');
    assert(cap.userData.industrialButton && control.children[0].name === 'Aro cromado' && control.children[1] === cap,
      'Existing press animation meshes and ray interaction paths remain stable.');
  });
  controls.forEach((control, index) => controls.slice(index + 1).forEach(other => {
    const distance = worldPosition(control).distanceTo(worldPosition(other));
    assert(distance >= 0.15 - 0.00001, 'Commands remain at least 150 mm apart to avoid accidental adjacent presses.');
  }));
  panel.children.filter(child => child.name.startsWith('Identificación')).forEach(header => {
    const local = panelBounds(header, inverse);
    assert(local.min.y >= cabinetLocal.min.y + 0.02 - 0.00001 && local.max.y <= cabinetLocal.max.y - 0.02 + 0.00001,
      'The panel title also stays inside its cabinet.');
  });
  if (kind !== 'plc') close(bounds(object).min.y, kind === 'conveyor' ? -0.0125 : 0,
    'Machine feet and pallets keep their authored floor height.');
}

inspect('plc'); inspect('conveyor');
conveyorPresets.forEach(preset => inspect('conveyor', preset.id));
inspect('source'); inspect('source', 'queue'); inspect('palletQueue');
['processor', 'combiner', 'separator'].forEach(mode => inspect('processor', mode === 'processor' ? undefined : mode));
console.log('Panel ergonomics: standing command heights, HMI readability, cabinet margins, floor anchoring and stable controls passed.');
