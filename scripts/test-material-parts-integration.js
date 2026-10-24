// Independent integration: real machine geometry, physical WebXR controls,
// copied authoring records and an isolated SQLite database.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const THREE = require('three');
const materialSchema = require('../shared/materials.js');
const {ProjectStore} = require('../server/storage.js');
const harnessText = fs.readFileSync(path.join(__dirname, 'test-industrial-xr.js'), 'utf8');
const end = harnessText.indexOf('async function run()');
assert(end > 0);
const h = new Function('require', '__dirname', harnessText.slice(0, end) + '\nreturn {setup, advance, press, button, vars};')(require, __dirname);
const source = fs.readFileSync(path.join(__dirname, '../src/editor/SurfaceMaterialSystem.js'), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export default class SurfaceMaterialSystem', 'return class SurfaceMaterialSystem');
const Surface = new Function('THREE', 'materialSchema', source)(THREE, materialSchema);
const copy = value => JSON.parse(JSON.stringify(value));
const mats = mesh => Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
function under(object, name) { for (let node = object; node; node = node.parent) if (node.name === name) return true; return false; }
function meshes(root, part) { const result = []; root.traverse(node => { if (node.isMesh && under(node, part)) result.push(node); }); return result; }
function apply(document, object, values) {
  document.setBehaviors(object, document.getBehaviors(object).filter(value => value.type !== 'surfaceMaterial').concat([materialSchema.normalizeMaterial(values)]));
}

async function run() {
  const f = h.setup(), notices = [], surface = new Surface(f.ctx, f.document, {}, notice => notices.push(notice));
  const frame = meshes(f.head, 'Bastidor'), motor = meshes(f.head, 'Motor eléctrico');
  assert(frame.length && motor.length);
  const originalFrame = frame.map(mesh => mesh.material), originalMotor = motor.map(mesh => mesh.material);
  const roller = meshes(f.head, 'Rodillos').find(mesh => mats(mesh).some(material => material.map)); assert(roller);
  const rollerMaterial = roller.material, rollerMap = mats(roller)[0].map;
  const green = h.button(f, 'start'), otherGreen = h.button(f, 'start', f.unrelated);
  const originalCap = green.cap.material, otherCap = otherGreen.cap.material;
  const configuration = {preset: 'paintedMetal', slot: 'part:Bastidor', color: '#204c8d', colorMapMode: 'none',
    overrides: [{preset: 'aluminum', slot: 'part:Motor eléctrico', color: '#d6dce3', roughness: .24}]};
  apply(f.document, f.head, configuration);
  await surface.sync('hall');
  frame.forEach(mesh => mats(mesh).forEach(material => assert.equal(material.color.getHexString(), '204c8d')));
  motor.forEach(mesh => mats(mesh).forEach(material => { assert.equal(material.color.getHexString(), 'd6dce3'); assert.equal(material.roughness, .24); }));
  assert.equal(roller.material, rollerMaterial); assert.equal(mats(roller)[0].map, rollerMap, 'Frame and motor finishes cannot recolour or replace rolling surfaces.');
  assert.equal(green.cap.material, originalCap, 'Bulk machine finishes never change functional button caps.');

  const capSlot = surface.getSlots(green.object).find(slot => slot.value.startsWith('mesh:') && /Pulsador/i.test(slot.label));
  assert(capSlot, 'Selecting a control offers its cap as an explicit independent material target.');
  apply(f.document, green.object, {preset: 'plastic', slot: capSlot.value, color: '#b7549d', roughness: .45});
  surface.invalidate(); await surface.sync('hall');
  assert.equal(green.cap.material.color.getHexString(), 'b7549d'); assert.equal(otherGreen.cap.material, otherCap);
  const authored = copy(await f.document.serialize());
  f.runtime.start('hall');
  h.advance(f);
  h.press(f, 'powerOn', f.left); h.press(f, 'start', f.right);
  assert.equal(h.vars(f).running, true);
  assert.equal(green.cap.material.color.getHexString(), 'b7549d', 'A custom cap colour survives its live state, glow and press animation.');
  h.press(f, 'pause', f.left); assert.equal(h.vars(f).paused, true);
  assert(f.pulses.some(value => value.handedness === 'left') && f.pulses.some(value => value.handedness === 'right'));
  f.visuals.dispose(); f.runtime.stop(); surface.dispose();
  frame.forEach((mesh, index) => assert.equal(mesh.material, originalFrame[index]));
  motor.forEach((mesh, index) => assert.equal(mesh.material, originalMotor[index]));
  assert.equal(green.cap.material, originalCap); assert.deepEqual(await f.document.serialize(), authored);

  const duplicate = await f.document.duplicate(f.head);
  const original = f.document.getBehaviors(f.head).find(value => value.type === 'surfaceMaterial');
  assert.deepEqual(f.document.getBehaviors(duplicate).find(value => value.type === 'surfaceMaterial'), original);
  const edited = copy(original); edited.overrides[0].color = '#949ca5'; apply(f.document, duplicate, edited);
  assert.equal(f.document.getBehaviors(f.head).find(value => value.type === 'surfaceMaterial').overrides[0].color, '#d6dce3');
  const data = await f.document.serialize(), temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hello-webxr-material-parts-')); let store;
  try {
    store = new ProjectStore({dataDir: temporary}); const project = store.saveProject(null, {name: 'Acabados por piezas', document: data});
    store.close(); store = new ProjectStore({dataDir: temporary}); assert.deepEqual(store.getProject(project.id).document, data);
    const loaded = h.setup(); await loaded.document.load(store.getProject(project.id).document);
    assert.deepEqual(await loaded.document.serialize(), data, 'Independent part finishes and control-cap settings survive a complete SQLite reopen.');
  } finally {
    if (store) store.close(); const resolved = path.resolve(temporary);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir())); assert(path.basename(resolved).startsWith('hello-webxr-material-parts-'));
    fs.rmSync(resolved, {recursive: true, force: true});
  }
  assert.deepEqual(notices, []);
  console.log('Material parts integration: independent frame/motor finishes, original roller textures, explicit cap colours under bilateral WebXR presses, copied settings, SQLite reopen and exact resource restoration passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
