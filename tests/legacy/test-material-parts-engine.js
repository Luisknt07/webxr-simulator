const __layout = require("../../tooling/layout.cjs");
// Real Three.js ownership, independent per-part PBR finishes, and SQLite validation.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const THREE = require('three');
const {authoredHex} = require('../support/material-test-colors');
const schema = require('../../packages/render-three/schema/materials.js');
const behaviorSchema = require('../../modules/logistica-industrial/contracts/behaviors.js');
const {ProjectStore} = require('../../apps/api/server/storage.js');
const code = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-material-parts-engine.js"), '../src/editor/SurfaceMaterialSystem.js')), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export default class SurfaceMaterialSystem', 'return class SurfaceMaterialSystem');
const System = new Function('THREE', 'materialSchema', code)(THREE, schema);
const clone = value => JSON.parse(JSON.stringify(value));
const setConfig = (object, value) => { object.userData.editorBehaviors = value ? [schema.normalizeMaterial(value)] : []; };
const config = value => schema.assignments(schema.normalizeMaterial(value))[0];
const next = () => new Promise(resolve => setImmediate(resolve));
const countDispose = resource => { const state = {count: 0}; resource.addEventListener('dispose', () => state.count++); return state; };
function texture() { const result = new THREE.DataTexture(new Uint8Array([230, 230, 230, 255]), 1, 1); result.needsUpdate = true; return result; }
function mesh(name, material) { const result = new THREE.Mesh(new THREE.BoxBufferGeometry(), material); result.name = name; return result; }
function fixture(library = {}) {
  const root = new THREE.Group(), owner = new THREE.Group(), paint = new THREE.Group(); root.add(owner); owner.add(paint);
  paint.name = 'Carcasa';
  const map = texture(), normalMap = texture(), roughnessMap = texture(), metalnessMap = texture(), aoMap = texture();
  const original = new THREE.MeshStandardMaterial({color: '#778899', map, normalMap, roughnessMap, metalnessMap, aoMap, roughness: 0.63, metalness: 0.87}); original.name = 'Acero original';
  const a = mesh('Pieza repetida', original), b = mesh('Pieza repetida', original); paint.add(a, b);
  const untouched = mesh('Tornillo', original); owner.add(untouched);
  const control = new THREE.Group(); control.userData.editorPrefabKey = 'control'; owner.add(control);
  const bezel = mesh('Aro', original), cap = mesh('Botón', original); cap.userData.industrialButton = {command: 'start'}; control.add(bezel, cap);
  const protectedMeshes = ['industrialDisplay', 'industrialSensorLamp', 'industrialTower'].map(key => {
    const result = mesh(key, original); result.userData[key] = true; owner.add(result); return result;
  });
  const child = new THREE.Group(); owner.add(child);
  const multiOriginal = [original, new THREE.MeshStandardMaterial({color: '#113355'})];
  const multi = mesh('Pieza multimat', multiOriginal); child.add(multi);
  const objects = [owner, child, control], document = {getRoot: () => root, getObjects: () => objects};
  const system = new System({}, document, library), originals = new Map(); root.traverse(node => { if (node.material) originals.set(node, node.material); });
  return {root, owner, paint, a, b, untouched, child, multi, multiOriginal, control, bezel, cap, protectedMeshes, original, map, normalMap, roughnessMap, metalnessMap, aoMap, objects, document, system, originals};
}
function imageResource() {
  const map = texture(), material = new THREE.MeshBasicMaterial({map}), object = new THREE.Mesh(new THREE.PlaneBufferGeometry(), material);
  return {object, map, disposal: [countDispose(object.geometry), countDispose(material), countDispose(map)]};
}
async function engine() {
  assert.equal(schema.MAX_ASSIGNMENTS, 32);
  assert.equal(schema.normalizeMaterial({}).colorMapMode, 'preserve');
  assert.deepEqual(schema.normalizeMaterial({}).overrides, []);
  const values = [config({slot: 'mesh:0.0:0', color: '#aabbcc'}), config({slot: 'mesh:0.1:0', color: '#123456'})];
  assert.deepEqual(schema.assignments(schema.fromAssignments(values)), values);
  assert.equal(schema.fromAssignments(values.slice(1)).slot, 'mesh:0.1:0', 'Removing the first assignment promotes the next without creating an all-surface assignment.');
  assert.equal(schema.fromAssignments(values, false).enabled, false);
  assert.equal(schema.assignments(schema.fromAssignments(Array.from({length: 32}, (_, index) => config({slot: 'index:' + index})))).length, 32);
  for (const value of [{overrides: '[]'}, {overrides: Array.from({length: 32}, () => ({}))}, {overrides: [{overrides: []}]},
    {overrides: [{unexpected: 'ignored?'}]}, {overrides: [null]}, {overrides: [{texture: '../outside.png'}]},
    {overrides: [{normalMap: 'https://external.invalid/a.png'}]}, {colorMapMode: 'execute'},
    {slot: 'mesh:00:0'}, {slot: 'mesh:-1:0'}, {slot: 'mesh:0..1:0'}, {slot: 'mesh:root:256'}, {slot: 'mesh:0:01'}]) {
    assert.throws(() => schema.normalizeMaterial(value));
  }
  assert.equal(schema.normalizeMaterial({legacyUnknown: true}).legacyUnknown, undefined);
  const f = fixture(), sourceDisposed = countDispose(f.original), sourceMapDisposed = countDispose(f.map);
  const geometry = f.a.geometry;
  const slots = f.system.getSlots(f.owner);
  assert(slots.some(row => row.value === 'mesh:0.0:0') && slots.some(row => row.value === 'mesh:0.1:0'));
  assert(!slots.some(row => row.value === 'index:0'), 'The UI advertises individual surfaces rather than the ambiguous slot zero across the whole equipment.');
  assert(!slots.some(row => row.value === 'mesh:2.1:0'), 'Equipment-wide selection never advertises a functional cap.');
  assert(f.system.getSlots(f.control).some(row => row.value === 'mesh:1:0' && row.label.startsWith('Pulsador:')));
  const defaults = f.system.getSlotDefaults(f.owner, 'mesh:0.0:0');
  assert.equal(defaults.color, '#778899'); assert.equal(defaults.roughness, 0.63); assert.equal(defaults.metalness, 0.87);
  assert.equal(defaults.overrides, undefined, 'Slot defaults can be inserted directly into fromAssignments.');
  setConfig(f.owner, schema.fromAssignments([config({slot: 'part:Carcasa', color: '#cc2200', colorMapMode: 'none', preset: 'paintedMetal'}),
    config({slot: 'mesh:0.1:0', color: '#0022cc', colorMapMode: 'none', preset: 'rubber'})]));
  await f.system.sync('hall');
  assert.equal(authoredHex(f.a.material.color), 'cc2200'); assert.equal(authoredHex(f.b.material.color), '0022cc');
  assert.notStrictEqual(f.a.material, f.b.material, 'Two parts that share a factory material still receive separate finishes.');
  assert.strictEqual(f.a.geometry, geometry, 'Material editing does not duplicate or simplify geometry.');
  assert.strictEqual(f.untouched.material, f.original); assert.strictEqual(f.cap.material, f.original);
  f.protectedMeshes.forEach(node => assert.strictEqual(node.material, f.original));
  assert.equal(f.a.material.map, null); assert.equal(f.b.material.map, null);
  assert.notStrictEqual(f.a.material.normalMap, f.normalMap); assert.strictEqual(f.a.material.normalMap.image, f.normalMap.image);
  assert.strictEqual(f.a.material.roughnessMap.image, f.roughnessMap.image); assert.strictEqual(f.a.material.metalnessMap.image, f.metalnessMap.image);
  assert.strictEqual(f.a.material.aoMap, f.aoMap); assert.equal(f.original.color.getHexString(), '778899');
  assert.equal(f.system.getSlotDefaults(f.owner, 'mesh:0.0:0').color, '#778899', 'New edits seed from the factory finish rather than a previous derived tint.');
  const aFinish = f.a.material, aDisposed = countDispose(aFinish), bFinish = f.b.material, bDisposed = countDispose(bFinish);
  const before = Object.assign({}, f.system.stats); for (let tick = 0; tick < 30; tick++) await f.system.sync('hall');
  assert.deepEqual(f.system.stats, before); assert.strictEqual(f.a.material, aFinish);
  setConfig(f.owner, schema.fromAssignments([config({slot: 'mesh:0.1:0', color: '#0022cc', colorMapMode: 'none', preset: 'rubber'})]));
  f.system.invalidate(); await f.system.sync('hall'); assert.strictEqual(f.a.material, f.original); assert.equal(authoredHex(f.b.material.color), '0022cc');
  assert.equal(aDisposed.count, 1); assert.equal(bDisposed.count, 1);
  // One multi-material mesh can inherit two different owners without losing
  // parent fallback, authored array identity, or independent disposal.
  setConfig(f.owner, {color: '#aa2200', slot: 'all', colorMapMode: 'none'});
  setConfig(f.child, {color: '#00aaff', slot: 'mesh:0:1', colorMapMode: 'none'});
  setConfig(f.control, {color: '#ff00cc', slot: 'mesh:1:0', colorMapMode: 'none'});
  f.system.invalidate(); await f.system.sync('hall');
  assert.equal(authoredHex(f.multi.material[0].color), 'aa2200'); assert.equal(authoredHex(f.multi.material[1].color), '00aaff');
  assert.equal(authoredHex(f.cap.material.color), 'ff00cc'); assert.equal(authoredHex(f.bezel.material.color), 'aa2200');
  setConfig(f.child, {slot: 'mesh:9:0', color: '#00aaff'}); f.system.invalidate(); await f.system.sync('hall');
  assert.equal(authoredHex(f.multi.material[1].color), 'aa2200', 'A nonmatching child assignment falls through to the nearest matching parent.');
  const duplicate = f.owner.clone(true); duplicate.userData = clone(f.owner.userData); f.root.add(duplicate); f.objects.push(duplicate);
  duplicate.traverse(node => { if (node !== duplicate) node.userData = Object.assign({}, node.userData, {editorBehaviors: []}); });
  // A document copy is authored from source surfaces, never derived resources.
  const copyA = duplicate.children[0].children[0]; copyA.material = f.original;
  duplicate.traverse(node => { if (node.material && !node.userData.industrialButton) node.material = Array.isArray(node.material) ? node.material.map(() => f.original) : f.original; });
  f.system.invalidate(); await f.system.sync('hall');
  assert.notStrictEqual(copyA.material, f.a.material); assert.equal(authoredHex(copyA.material.color), 'aa2200');
  setConfig(duplicate, {slot: 'all', color: '#112233', colorMapMode: 'none'}); f.system.invalidate(); await f.system.sync('hall');
  assert.equal(authoredHex(copyA.material.color), '112233'); assert.equal(authoredHex(f.a.material.color), 'aa2200');
  f.system.dispose(); f.originals.forEach((material, node) => assert.strictEqual(node.material, material));
  assert.equal(sourceDisposed.count, 0); assert.equal(sourceMapDisposed.count, 0);
  // Solid colour suppresses albedo while steel's physical property maps keep
  // their authored UV scale and supply Three's native wear coordinates.
  const plain = mesh('Metal sin mapas', new THREE.MeshStandardMaterial()); f.owner.add(plain);
  setConfig(f.owner, {slot: 'part:Metal sin mapas', preset: 'steel', colorMapMode: 'none', wear: 0.8, repeatX: 2, repeatY: 3});
  setConfig(f.child, null); setConfig(f.control, null); setConfig(duplicate, null); f.system.invalidate(); await f.system.sync('hall');
  assert.equal(plain.material.map, null);
  const shader = {uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader};
  plain.material.onBeforeCompile(shader, {});
  assert(plain.material.roughnessMap.isDataTexture && plain.material.bumpMap.isDataTexture);
  assert.deepEqual(plain.material.roughnessMap.repeat.toArray(), [2, 3]);
  assert(shader.fragmentShader.includes('texture2D(surfaceWearMap, vUv * surfaceWearScale)'));
  assert.equal(shader.uniforms.surfaceWearStrength.value, 0.8);
  // A custom colour with no physical maps needs independent wear UVs. Repeat
  // values remain per-material uniforms, allowing the GPU to reuse one shader
  // program for differently scaled surfaces without borrowing another's scale.
  const compileUnmapped = async (repeatX, repeatY) => {
    setConfig(f.owner, {slot: 'part:Metal sin mapas', preset: 'custom', colorMapMode: 'none', wear: .8, repeatX, repeatY});
    f.system.invalidate(); await f.system.sync('hall');
    assert.equal(plain.material.map, null); assert.equal(plain.material.roughnessMap, null); assert.equal(plain.material.bumpMap, null);
    const result = {uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader};
    plain.material.onBeforeCompile(result, {}); return result;
  };
  const unmapped = await compileUnmapped(2, 3), differentlyScaled = await compileUnmapped(7, 11);
  assert(unmapped.vertexShader.includes('varying vec2 surfaceWearUv;') && unmapped.fragmentShader.includes('varying vec2 surfaceWearUv;'));
  assert(unmapped.fragmentShader.includes('texture2D(surfaceWearMap, surfaceWearUv * surfaceWearScale)'));
  assert.deepEqual(unmapped.uniforms.surfaceWearRepeat.value.toArray(), [2, 3]);
  assert.deepEqual(differentlyScaled.uniforms.surfaceWearRepeat.value.toArray(), [7, 11]);
  assert.equal(differentlyScaled.vertexShader, unmapped.vertexShader); assert.equal(differentlyScaled.fragmentShader, unmapped.fragmentShader);
  f.system.dispose();
}
async function asyncAssignments() {
  const pending = [], notices = [], library = {getEntry: asset => ({id: asset, kind: 'image'}), instantiate: descriptor => new Promise((resolve, reject) => pending.push({descriptor, resolve, reject}))};
  const f = fixture(library); f.system.notify = message => notices.push(message);
  const assignment = (slot, repeatX, textureName = 'shared-color') => config({slot, repeatX, texture: textureName, colorMapMode: 'preserve'});
  setConfig(f.owner, schema.fromAssignments([assignment('mesh:0.0:0', 2), assignment('mesh:0.1:0', 5)]));
  const loading = f.system.sync('hall'); await next(); assert.equal(pending.length, 1, 'One image is decoded once per equipment, even across different surface UV scales.');
  const resource = imageResource(); pending.shift().resolve(resource.object); await loading;
  assert.notStrictEqual(f.a.material.map, f.b.material.map); assert.equal(f.a.material.map.repeat.x, 2); assert.equal(f.b.material.map.repeat.x, 5);
  assert.strictEqual(f.a.material.map.image, resource.map.image); assert.strictEqual(f.b.material.map.image, resource.map.image);
  setConfig(f.owner, schema.fromAssignments([assignment('mesh:0.0:0', 2, 'old-color'), assignment('mesh:0.1:0', 5, 'other-old-color')]));
  f.system.invalidate(); const stale = f.system.sync('hall'); await next(); const old = pending.splice(0);
  setConfig(f.owner, schema.fromAssignments([config({slot: 'mesh:0.0:0', color: '#112233', colorMapMode: 'none', texture: 'ignored-color'}),
    config({slot: 'mesh:0.1:0', color: '#abcdef', colorMapMode: 'none'})]));
  f.system.invalidate(); await f.system.sync('hall'); assert.equal(pending.length, 0, 'Solid color mode never decodes a suppressed color image.');
  const cancelled = old.map(() => imageResource()); old.forEach((request, index) => request.resolve(cancelled[index].object)); await stale;
  cancelled.forEach(record => record.disposal.forEach(state => assert.equal(state.count, 1)));
  assert.equal(authoredHex(f.a.material.color), '112233'); assert.equal(authoredHex(f.b.material.color), 'abcdef');
  assert.equal(f.a.material.map, null); assert.equal(f.b.material.map, null); resource.disposal.forEach(state => assert.equal(state.count, 1));
  f.system.dispose(); assert.equal(notices.length, 0);
}
async function storage() {
  const {setup, add} = require('./test-processor-runtime.js'), f = setup(), object = add(f, 'conveyor');
  const material = schema.fromAssignments([config({slot: 'name:Bastidor / Larguero de acero', color: '#163b7a', preset: 'paintedMetal', colorMapMode: 'none'}),
    config({slot: 'mesh:0.2.0:0', color: '#c8c8ca', preset: 'steel', wear: 0.2}), config({slot: 'part:Motor eléctrico', color: '#006599', preset: 'paintedMetal'})]);
  const current = f.document.getBehaviors(object); f.document.setBehaviors(object, current.concat([material]));
  const copy = await f.document.pasteObject(f.document.captureObject(object), 'hall', 3);
  assert.deepEqual(f.document.getBehaviors(copy).find(row => row.type === 'surfaceMaterial'), material);
  const saved = await f.document.serialize(), directory = fs.mkdtempSync(__layout.map(path.join(os.tmpdir(), 'hello-webxr-material-parts-'))); let store;
  try {
    store = new ProjectStore({dataDir: directory}); const project = store.saveProject(null, {name: 'Materiales por partes', document: saved});
    for (const bad of [{overrides: [{texture: '../escape.png'}]}, {overrides: [{overrides: []}]}, {overrides: [{script: 'execute'}]}, {overrides: Array.from({length: 32}, () => ({}))}]) {
      const invalid = clone(saved), record = invalid.rooms.hall.additions.find(row => row.id === object.userData.editorId);
      Object.assign(record.behaviors.find(row => row.type === 'surfaceMaterial'), bad);
      assert.throws(() => store.saveProject(null, {name: 'Inválido', document: invalid}), error => error.status === 400);
    }
    assert.equal(store.listProjects().length, 1); store.close(); store = new ProjectStore({dataDir: directory});
    const reopened = store.getProject(project.id); assert.deepEqual(reopened.document, saved);
    const loaded = setup(); await loaded.document.load(reopened.document); assert.deepEqual(await loaded.document.serialize(), saved);
    assert.deepEqual(loaded.document.getBehaviors(loaded.document.getObject(object.userData.editorId)).find(row => row.type === 'surfaceMaterial'), material);
    assert.deepEqual(behaviorSchema.normalizeBehaviors([material]), [material]);
  } finally {
    if (store) store.close(); const absolute = __layout.map(path.resolve(directory)); assert.equal(path.dirname(absolute), __layout.map(path.resolve(os.tmpdir())));
    assert(path.basename(absolute).startsWith('hello-webxr-material-parts-')); fs.rmSync(absolute, {recursive: true, force: true});
  }
}
async function run() { await engine(); await asyncAssignments(); await storage(); console.log('Material parts: strict bounded assignments, precise repeated-mesh slots, independent PBR/UV maps, solid colors with wear, protected indicators and explicit button caps, ancestor fallback, cancellation and private cleanup, clipboard and SQLite close/reopen passed.'); }
run().catch(error => { console.error(error); process.exitCode = 1; });
