// Real glTF decoding, asset records, scene documents, materials, wear projection,
// industrial runtime and temporary SQLite. Image decoding/WebGL are adapted.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const THREE = require('three');
const ObjectPlacement = require('./load-object-placement')(THREE);
const behaviorSchema = require('../shared/behaviors.js');
const automationSchema = require('../shared/automation.js');
const PalletQueueRuntime = require('./load-pallet-queue-runtime.js')(THREE, behaviorSchema);
const ProcessorRuntime = require('./load-processor-runtime.js')(THREE, behaviorSchema);
const ProductSourceRuntime = require('./load-product-source-runtime')(THREE, behaviorSchema);
const assetLimits = require('../shared/asset-limits.js');
const materialSchema = require('../shared/materials.js');
const wearSchema = require('../shared/wear.js');
const {ProjectStore} = require('../server/storage.js');
const {validateDocument} = require('../server/validation.js');
const {getGeometryTree} = require('./load-geometry-acceleration.js')(THREE);
function source(file) { return fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/^\uFEFF/, '').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''); }
const clone = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const resources = [], fetched = [], imageResources = [];
const bytesByURL = new Map();
function dataBytes(url) {
  if (bytesByURL.has(url)) return bytesByURL.get(url);
  if (url.startsWith('data:')) return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  throw new Error('Unknown isolated test asset ' + url);
}
class FileLoader {
  constructor(manager) { this.manager = manager; this.path = ''; }
  setPath(value) { this.path = value || ''; return this; }
  setResponseType(value) { this.responseType = value; return this; }
  setWithCredentials() { return this; }
  load(url, done, progress, fail) {
    try {
      const resolved = this.manager.resolveURL(this.path + url), data = dataBytes(resolved); fetched.push(resolved);
      done(this.responseType === 'arraybuffer' ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data.toString());
    } catch (error) { if (fail) fail(error); else throw error; }
  }
}
class TextureLoader {
  constructor(manager) { this.manager = manager; this.path = ''; }
  setPath(value) { this.path = value || ''; return this; }
  setCrossOrigin() { return this; }
  load(url, done, progress, fail) {
    try {
      const resolved = this.manager ? this.manager.resolveURL(this.path + url) : this.path + url; dataBytes(resolved); fetched.push(resolved);
      const texture = new THREE.Texture({width: 16, height: 16}); texture.needsUpdate = true;
      const record = {texture, disposed: 0}; texture.addEventListener('dispose', () => record.disposed++); imageResources.push(record);
      done(texture); return texture;
    } catch (error) { if (fail) fail(error); else throw error; }
  }
}
const loaderSource = fs.readFileSync(path.join(__dirname, '../node_modules/three/examples/jsm/loaders/GLTFLoader.js'), 'utf8')
  .replace(/import \{([\s\S]*?)\} from "[^\"]+";/, (_, fields) => 'const {' + fields.replace('Math as _Math', 'Math: _Math') + '} = THREE;')
  .replace('export { GLTFLoader };', 'return GLTFLoader;');
const loaderTHREE = Object.assign({}, THREE, {FileLoader, TextureLoader});
const GLTFLoader = new Function('THREE', 'window', loaderSource)(loaderTHREE, {URL});
class DRACOLoader { setDecoderPath() { return this; } dispose() {} }
const AssetLibrary = new Function('THREE', 'assetDefinitions', 'assetLimits', 'GLTFLoader', 'DRACOLoader', 'optimizeModel', 'prepareModelAcceleration', source('src/editor/AssetLibrary.js').replace('default class AssetLibrary', 'return class AssetLibrary'))
  (loaderTHREE, {}, assetLimits, GLTFLoader, DRACOLoader, async () => {}, async () => {});
const dom = {createElement(tag) {
  assert.equal(tag, 'canvas'); const canvas = {width: 0, height: 0, text: []};
  const context = {fillRect(x, y, width, height) { if (x === 0 && y === 0 && width === canvas.width && height === canvas.height) canvas.text = []; }, fillText(value) { canvas.text.push(String(value)); }, measureText(value) { return {width: String(value).length * 12}; }};
  canvas.getContext = () => context; return canvas;
}};
const prefabs = new Function('THREE', 'behaviorSchema', 'document', source('src/editor/IndustrialPrefabs.js') + '\nreturn {createIndustrialPrefab,createProductVisual};')(THREE, behaviorSchema, dom);
const SceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', source('src/editor/SceneDocument.js').replace('default class SceneDocument', 'return class SceneDocument'))(THREE, behaviorSchema, prefabs.createIndustrialPrefab);
const ProductFeedback = new Function('THREE', source('src/editor/ProductFeedback.js').replace('default class ProductFeedback', 'return class ProductFeedback'))(THREE);
const Runtime = new Function('THREE', 'behaviorSchema', 'automationSchema', 'createProductVisual', 'ProductFeedback', 'ObjectPlacement', 'ProductSourceRuntime', 'ProcessorRuntime', 'PalletQueueRuntime', source('src/editor/SimulationRuntime.js').replace('default class SimulationRuntime', 'return class SimulationRuntime'))(THREE, behaviorSchema, automationSchema, prefabs.createProductVisual, ProductFeedback, ObjectPlacement, ProductSourceRuntime, ProcessorRuntime, PalletQueueRuntime);
const IndustrialVisuals = new Function('THREE', source('src/editor/IndustrialVisuals.js').replace('default class IndustrialVisuals', 'return class IndustrialVisuals'))(THREE);
const CollisionWorld = new Function('THREE', 'getGeometryTree', source('src/lib/CollisionWorld.js').replace('default class CollisionWorld', 'return class CollisionWorld'))(THREE, getGeometryTree);
const SurfaceMaterialSystem = new Function('THREE', 'materialSchema', source('src/editor/SurfaceMaterialSystem.js').replace('default class SurfaceMaterialSystem', 'return class SurfaceMaterialSystem'))(THREE, materialSchema);
const decalGeometrySource = fs.readFileSync(path.join(__dirname, '../node_modules/three/examples/jsm/geometries/DecalGeometry.js'), 'utf8').replace(/import \{[\s\S]*?\} from "[^\"]+";/, '').replace('export { DecalGeometry, DecalVertex };', 'return DecalGeometry;');
const DecalGeometry = new Function('BufferGeometry', 'Float32BufferAttribute', 'Matrix4', 'Vector3', decalGeometrySource)(THREE.BufferGeometry, THREE.Float32BufferAttribute, THREE.Matrix4, THREE.Vector3);
const DecalSystem = new Function('THREE', 'DecalGeometry', 'getGeometryTree', 'wearSchema', source('src/editor/DecalSystem.js').replace('default class DecalSystem', 'return class DecalSystem'))(THREE, DecalGeometry, getGeometryTree, wearSchema);
const WearPaintSystem = new Function('THREE', 'DecalSystem', 'wearSchema', source('src/editor/WearPaintSystem.js').replace('default class WearPaintSystem', 'return class WearPaintSystem'))(THREE, DecalSystem, wearSchema);

function gltfFixture() {
  const positions = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);
  const binary = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(normals.buffer), Buffer.from(uv.buffer)]);
  return Buffer.from(JSON.stringify({asset: {version: '2.0'}, scene: 0, scenes: [{nodes: [0]}], nodes: [{name: 'Imported machinery', mesh: 0}],
    meshes: [{primitives: [0, 1].map(material => ({attributes: {POSITION: 0, NORMAL: 1, TEXCOORD_0: 2}, material}))}],
    buffers: [{byteLength: binary.length, uri: 'data:application/octet-stream;base64,' + binary.toString('base64')}],
    bufferViews: [{buffer: 0, byteOffset: 0, byteLength: positions.byteLength}, {buffer: 0, byteOffset: positions.byteLength, byteLength: normals.byteLength}, {buffer: 0, byteOffset: positions.byteLength + normals.byteLength, byteLength: uv.byteLength}],
    accessors: [{bufferView: 0, componentType: 5126, count: 6, type: 'VEC3', min: [-0.5, -0.5, 0], max: [0.5, 0.5, 0]}, {bufferView: 1, componentType: 5126, count: 6, type: 'VEC3'}, {bufferView: 2, componentType: 5126, count: 6, type: 'VEC2'}],
    materials: [{name: 'Factory steel', pbrMetallicRoughness: {baseColorTexture: {index: 0}, metallicFactor: 0.85, roughnessFactor: 0.25}}, {name: 'Factory paint', pbrMetallicRoughness: {baseColorTexture: {index: 0}, baseColorFactor: [0.1, 0.3, 0.6, 1], metallicFactor: 0.4, roughnessFactor: 0.5}}],
    textures: [{source: 0}], images: [{uri: 'color.png'}]}));
}
function imports() {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
  return [['workflow-model', 'model.gltf', 'model/gltf+json', gltfFixture()], ['workflow-color', 'color.png', 'image/png', png], ['workflow-normal', 'normal.png', 'image/png', png], ['workflow-roughness', 'roughness.png', 'image/png', png], ['workflow-metalness', 'metalness.png', 'image/png', png]].map(([id, assetPath, mime, bytes]) => ({
    id, importId: id, batchId: 'workflow', path: assetPath, dataUrl: 'data:' + mime + ';base64,' + bytes.toString('base64')
  }));
}
function setup(records = imports()) {
  const scene = new THREE.Scene(), root = new THREE.Group(); scene.add(root);
  const floor = new THREE.Mesh(new THREE.BoxBufferGeometry(30, 0.05, 30), new THREE.MeshStandardMaterial()); floor.position.y = -0.025; root.add(floor);
  const renderer = {capabilities: {getMaxAnisotropy: () => 8}};
  const ctx = {scene, camera: new THREE.PerspectiveCamera(), renderer, document: dom, editor: {active: true}, raycontrol: {states: {}, addState(name, state) { this.states[name] = state; }, activateState() {}, deactivateState() {}}};
  scene.add(ctx.camera); const library = new AssetLibrary(ctx); library.catalog = []; library.restoreImports(records);
  const document = new SceneDocument({}, {assetLibrary: library}); document.registerRoom('hall', root); ctx.editor.document = document;
  const notices = [], surface = new SurfaceMaterialSystem(ctx, document, library, value => notices.push(value));
  const paint = new WearPaintSystem(ctx, document, library, value => notices.push(value));
  const runtime = new Runtime(ctx, document, value => notices.push(value)), visuals = new IndustrialVisuals(ctx, document, runtime); ctx.editor.simulation = runtime;
  ctx.collisionWorld = new CollisionWorld(ctx, document);
  // This is the editor's document-change boundary, not an engine replacement.
  document.onChange = () => { surface.invalidate(); paint.invalidate(); visuals.invalidate(); };
  const value = {scene, root, ctx, library, document, notices, surface, paint, runtime, visuals}; resources.push(value); return value;
}
function physicalMeshes(actor) { const result = []; actor.traverse(node => { if (node.isMesh && !node.userData.editorRuntimeHelper && !node.userData.editorHelper && !node.userData.editorGeometryReplaced) result.push(node); }); return result; }
function materialOf(mesh) { return Array.isArray(mesh.material) ? mesh.material[0] : mesh.material; }
function materialConfig(values = {}) { return Object.assign(behaviorSchema.defaultBehavior('surfaceMaterial'), materialSchema.getPreset(values.preset || 'custom'), values); }
function setMaterial(f, actor, values) { f.document.setBehaviors(actor, f.document.getBehaviors(actor).filter(value => value.type !== 'surfaceMaterial').concat([materialConfig(values)])); }
async function settle(f) { f.scene.updateMatrixWorld(true); await f.surface.sync('hall'); f.paint.sync('hall'); await tick(); await f.surface.sync('hall'); f.paint.sync('hall'); }
function close(actual, expected, epsilon = 1e-10) { assert(Math.abs(actual - expected) <= epsilon, actual + ' != ' + expected); }
function equivalent(actual, expected, location = 'document') {
  if (typeof expected === 'number') return close(actual, expected);
  if (!expected || typeof expected !== 'object') return assert.equal(actual, expected, location);
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), location);
  Object.keys(expected).forEach(key => equivalent(actual[key], expected[key], location + '.' + key));
}
function stop(f) { f.visuals.dispose(); f.runtime.stop(); f.paint.dispose(); f.surface.dispose(); }
function layer(values = {}) { return wearSchema.normalizeLayers([Object.assign({id: 'sample-rust', pattern: 'rust', width: 0.7, height: 0.5, depth: 0.1, opacity: 0.74, density: 0.8, seed: 137,
  matrix: new THREE.Matrix4().makeTranslation(0, 0, 0.02).toArray(), stamps: [{position: [-0.12, 0.02, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1]}, {position: [0.13, 0.09, 0], quaternion: [0, 0, 0, 1], scale: [0.75, 0.75, 1]}]}, values)])[0]; }
function setWear(f, actor, layers) { f.document.setBehaviors(actor, f.document.getBehaviors(actor).filter(value => value.type !== 'surfaceWear').concat([{type: 'surfaceWear', enabled: true, layers: wearSchema.normalizeLayerJSON(layers)}])); }
function paintEntry(f, actor, id = 'sample-rust') { const entry = f.paint.entries.get(actor.userData.editorId + '/wear/' + id); assert(entry, 'Missing persisted wear layer'); return {entry, state: f.paint.engine.states.get(entry.object)}; }
function vertices(mesh) { mesh.updateWorldMatrix(true, false); return Array.from({length: mesh.geometry.attributes.position.count}, (_, index) => new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, index).applyMatrix4(mesh.matrixWorld)); }
function advance(f, seconds) {
  for (let time = 0; time < seconds - 1e-9; time += 1 / 60) {
    const delta = Math.min(1 / 60, seconds - time); f.scene.updateMatrixWorld(true); f.ctx.collisionWorld.beginFrame(); f.surface.sync('hall');
    f.runtime.execute(delta); f.paint.sync('hall'); f.visuals.sync('hall', delta, false); f.ctx.collisionWorld.endFrame();
  }
}

async function run() {
  const f = setup(), model = await f.document.addAsset('hall', {importId: 'workflow-model'});
  const modelMeshes = physicalMeshes(model); assert.equal(modelMeshes.length, 2, 'The real glTF parser restores both source material primitives.');
  const original = modelMeshes.map(mesh => ({mesh, geometry: mesh.geometry, position: Array.from(mesh.geometry.attributes.position.array), material: mesh.material, map: materialOf(mesh).map}));
  assert(original.every(entry => entry.map && entry.map.flipY === false), 'The integration model includes its original glTF texture orientation.');
  setMaterial(f, model, {preset: 'custom', name: 'Independent machine finish', color: '#c7d4df', metalness: 0.78, roughness: 0.31, clearcoat: 0.45, clearcoatRoughness: 0.15, repeatX: 2, repeatY: 3, wear: 0.4, wearType: 'scratches', wearScale: 1.6, seed: 418});
  await settle(f);
  assert(modelMeshes.every(mesh => materialOf(mesh) !== original.find(entry => entry.mesh === mesh).material));
  original.forEach(entry => {
    assert.equal(entry.mesh.geometry, entry.geometry); assert.deepEqual(Array.from(entry.geometry.attributes.position.array), entry.position, 'Surface editing never simplifies or replaces source geometry.');
    assert.equal(entry.material.map, entry.map); assert.equal(entry.map.flipY, false, 'The source glTF map remains unchanged.');
  });
  assert(f.surface.getSlots(model).some(slot => slot.value === 'all'));
  const privateMaterials = modelMeshes.map(materialOf), applications = f.surface.stats.applications;
  for (let frame = 0; frame < 10; frame++) f.surface.sync('hall');
  assert.equal(f.surface.stats.applications, applications, 'Unchanged frames reuse their configured material bindings.');
  modelMeshes.forEach((mesh, index) => assert.equal(materialOf(mesh), privateMaterials[index]));
  const copied = await f.document.duplicate(model); await settle(f);
  const copiedMesh = physicalMeshes(copied)[0]; assert.notEqual(copiedMesh.material, modelMeshes[0].material);
  assert.deepEqual(f.document.getBehaviors(copied), f.document.getBehaviors(model));

  const maps = {texture: 'workflow-color', normalMap: 'workflow-normal', roughnessMap: 'workflow-roughness', metalnessMap: 'workflow-metalness'};
  setMaterial(f, model, Object.assign({name: 'Mapped imported finish', clearcoat: 0.6, repeatX: 4, repeatY: 2}, maps)); await settle(f);
  const mapped = materialOf(modelMeshes[0]);
  for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) {
    assert(mapped[key] && mapped[key].isTexture, 'Imported PBR image resolves into ' + key);
    assert.equal(mapped[key].encoding, key === 'map' ? THREE.sRGBEncoding : THREE.LinearEncoding);
    close(mapped[key].repeat.x, 4); close(mapped[key].repeat.y, 2);
  }
  assert.notEqual(mapped.map, mapped.normalMap); assert.notEqual(mapped.normalMap, materialOf(copiedMesh).map);
  close(mapped.clearcoat, 0.6); assert(fetched.some(url => url.startsWith('data:image/png;')));
  setMaterial(f, model, {slot: 'name:Factory paint', preset: 'rubber', roughness: 0.94}); await settle(f);
  assert.equal(modelMeshes[0].material, original[0].material, 'A named material slot leaves the other glTF primitive at its exact source material.');
  close(materialOf(modelMeshes[1]).roughness, 0.94);
  setMaterial(f, model, Object.assign({preset: 'paintedMetal', name: 'Saved imported PBR finish', repeatX: 2, repeatY: 3, wear: 0.37, wearType: 'rust', seed: 91}, maps)); await settle(f);

  setWear(f, model, [layer()]); await settle(f);
  let brush = paintEntry(f, model); assert(brush.state && brush.state.mesh.geometry.attributes.position.count > 0, 'Persisted actor-local stamps clip against the real decoded glTF triangles.');
  assert.equal(f.paint.entries.size, 1); assert.equal(f.paint.engine.states.size, 1, 'Two brush stamps share one layer mesh/material instead of one draw per mark.');
  assert.equal(brush.state.material.map.encoding, THREE.sRGBEncoding); assert.equal(brush.state.material.roughnessMap.encoding, THREE.LinearEncoding);
  const brushGeometry = brush.state.mesh.geometry, beforeVertices = vertices(brush.state.mesh), oldMatrix = model.matrixWorld.clone(), projectionCount = f.paint.engine.stats.projections;
  f.document.setTransform(model, {position: [2, 1.1, -2], rotation: [0, 0.4, 0]}); await settle(f); brush = paintEntry(f, model);
  assert.equal(brush.state.mesh.geometry, brushGeometry, 'Rigidly moving an actor reuses its local brush geometry.');
  assert.equal(f.paint.engine.stats.projections, projectionCount, 'Actor movement does not repeatedly reproject unchanged local marks.');
  const expectedTransform = model.matrixWorld.clone().multiply(new THREE.Matrix4().getInverse(oldMatrix)), movedVertices = vertices(brush.state.mesh);
  beforeVertices.forEach((point, index) => assert(movedVertices[index].distanceTo(point.clone().applyMatrix4(expectedTransform)) < 1e-5, 'Brush marks remain attached to their moving actor.'));
  const paintedCopy = await f.document.duplicate(model); await settle(f);
  assert.deepEqual(f.document.getBehaviors(paintedCopy), f.document.getBehaviors(model));
  const copiedBrush = paintEntry(f, paintedCopy); assert.notEqual(copiedBrush.state.mesh, brush.state.mesh); assert.notEqual(copiedBrush.state.material.map, brush.state.material.map);
  assert.equal(copiedBrush.entry.object.parent, paintedCopy); assert.equal(brush.entry.object.parent, model);
  const copiedMark = vertices(copiedBrush.state.mesh)[0], originalMark = vertices(brush.state.mesh)[0]; close(copiedMark.x - originalMark.x, 0.5, 1e-5);

  const beforePreview = JSON.stringify(await f.document.serialize()); f.paint.setPreview(model, layer({id: 'preview', pattern: 'scratches'})); await settle(f);
  assert(f.paint.entries.has('__wear-preview')); assert.equal(JSON.stringify(await f.document.serialize()), beforePreview, 'Brush preview never enters saved authoring data.');
  f.paint.clearPreview(); await settle(f); assert(!f.paint.entries.has('__wear-preview'));
  setWear(f, model, [layer({density: 0})]); await settle(f); brush = paintEntry(f, model);
  assert(brush.state.material.map.image.data.every((value, index) => index % 4 !== 3 || value === 0), 'A zero-density persisted brush layer has no visible alpha.');
  const emptyWearMap = brush.state.material.map; setWear(f, model, [layer({density: 0.8})]); await settle(f); brush = paintEntry(f, model);
  assert.notEqual(brush.state.material.map, emptyWearMap, 'Changing persisted density regenerates its procedural texture.');
  assert(brush.state.material.map.image.data.some((value, index) => index % 4 === 3 && value > 0));

  const machine = f.document.addPrefab('hall', 'conveyor'); f.document.setTransform(machine, {position: [-3, 1.02, -2]});
  const panel = machine.children[0].children[6], cabinet = panel.children[0], screen = panel.children[1], cap = panel.children[2].children[1];
  const originalCap = cap.material, originalScreen = screen.material;
  const beforeControl = f.document.getBehaviors(panel.children[2]);
  setMaterial(f, machine, {preset: 'paintedMetal', color: '#2d718c', roughness: 0.42, wear: 0.16, wearType: 'chips'});
  setMaterial(f, panel, {preset: 'steel', color: '#a8b6c5', roughness: 0.2, metalness: 0.91}); await settle(f);
  close(materialOf(cabinet).roughness, 0.2); close(materialOf(cabinet).metalness, 0.91);
  assert.equal(cap.material, originalCap, 'Surface customization preserves the functional button cap material.');
  assert.equal(screen.material, originalScreen, 'Surface customization preserves the native dashboard surface.');
  assert.deepEqual(f.document.getBehaviors(panel.children[2]), beforeControl, 'Applying a descendant material never replaces its control behavior.');
  const configuredCabinet = cabinet.material, configuredRollers = new Map();
  machine.traverse(mesh => { if (mesh.userData.industrialRoller && mesh.material) configuredRollers.set(mesh, mesh.material); }); assert(configuredRollers.size > 0);
  const beforePlay = JSON.stringify(await f.document.serialize()); f.ctx.editor.active = false; f.runtime.start('hall'); f.surface.sync('hall'); f.visuals.sync('hall', 0.2, false);
  f.runtime.command(machine.userData.editorId, 'powerOn'); f.runtime.command(machine.userData.editorId, 'start');
  const roller = Array.from(f.visuals.rollers.values()).find(entry => configuredRollers.has(entry.object)); assert(roller);
  const uvOffset = roller.surfaces[0].texture.offset.x, appCount = f.surface.stats.applications;
  advance(f, 0.3); assert.notEqual(roller.surfaces[0].texture.offset.x, uvOffset, 'Material customization keeps the actual roller UV animation working.');
  assert.equal(f.surface.stats.applications, appCount, 'Industrial private wrappers do not cause a surface material rebuild each frame.');
  assert.equal(cabinet.material, configuredCabinet);
  setMaterial(f, machine, {preset: 'aluminum', color: '#d8e1eb', roughness: 0.23, wear: 0.2, wearType: 'scratches'}); await settle(f);
  f.visuals.sync('hall', 0.2, false); advance(f, 0.2);
  const editedRoller = Array.from(f.visuals.rollers.values()).find(entry => configuredRollers.has(entry.object)); assert(editedRoller);
  const editedOriginal = editedRoller.original; assert(f.surface.isOwnedMaterial(Array.isArray(editedOriginal) ? editedOriginal[0] : editedOriginal));
  const changedOffset = editedRoller.surfaces[0].texture.offset.x; advance(f, 0.1); assert.notEqual(editedRoller.surfaces[0].texture.offset.x, changedOffset);
  f.visuals.dispose(); assert.equal(editedRoller.object.material, editedOriginal, 'Stopping industrial cosmetics restores the currently configured finish.');
  assert.equal(cabinet.material, configuredCabinet); f.runtime.stop(); f.ctx.editor.active = true;
  const afterPlay = JSON.stringify(await f.document.serialize()); assert.notEqual(afterPlay, beforePlay, 'Only the intentional authoring material edit remains after play.');
  const savedMachineConfig = f.document.getBehaviors(machine).find(value => value.type === 'surfaceMaterial'); assert.equal(savedMachineConfig.preset, 'aluminum');
  const oldRollerMeshes = Array.from(configuredRollers.keys());
  const conveyorConfig = f.document.getBehaviors(machine).find(value => value.type === 'conveyor');
  f.document.setBehaviors(machine, f.document.getBehaviors(machine).map(value => value.type === 'conveyor' ? Object.assign({}, conveyorConfig, {length: 5.2}) : value)); await settle(f);
  const rebuiltRollers = []; machine.traverse(mesh => { if (mesh.userData.industrialRoller && mesh.material) rebuiltRollers.push(mesh); });
  assert(rebuiltRollers.some(mesh => !oldRollerMeshes.includes(mesh)), 'The regression actually rebuilds the procedural mechanical geometry.');
  assert(rebuiltRollers.every(mesh => f.surface.isOwnedMaterial(materialOf(mesh))), 'Rebuilt conveyor geometry receives the persisted root finish.');
  close(materialOf(cabinet).metalness, 0.91); assert.deepEqual(f.document.getBehaviors(panel.children[2]), beforeControl);
  const machineCopy = await f.document.duplicate(machine); f.document.setTransform(machineCopy, {position: [-3, 1.02, 6]}); await settle(f);
  const copiedPanel = machineCopy.children[0].children[6];
  assert.deepEqual(f.document.getBehaviors(copiedPanel).find(value => value.type === 'surfaceMaterial'), f.document.getBehaviors(panel).find(value => value.type === 'surfaceMaterial'));
  const copiedStart = f.document.getBehaviors(copiedPanel.children[2]).find(value => value.type === 'control');
  assert.equal(copiedStart.targetId, machineCopy.userData.editorId, 'Duplicated equipment retains independent functional controls alongside its material overrides.');
  assert.notEqual(copiedPanel.children[0].material, cabinet.material);
  const beforeUndo = clone(f.document.getBehaviors(model).find(value => value.type === 'surfaceMaterial'));
  setMaterial(f, model, {preset: 'ceramic', color: '#ebe6db'}); await settle(f); assert(f.document.undo()); await settle(f);
  assert.deepEqual(f.document.getBehaviors(model).find(value => value.type === 'surfaceMaterial'), beforeUndo);
  assert(f.document.redo()); await settle(f); assert.equal(f.document.getBehaviors(model).find(value => value.type === 'surfaceMaterial').preset, 'ceramic');
  assert(f.document.undo()); await settle(f);

  const serialized = await f.document.serialize(); equivalent(validateDocument(serialized, record => record), serialized);
  for (const badPath of ['../escape.png', 'https://external.invalid/texture.png', '/api/assets/' + 'a'.repeat(64)]) {
    const bad = clone(serialized), target = bad.rooms.hall.additions.find(value => value.id === model.userData.editorId);
    target.behaviors.find(value => value.type === 'surfaceMaterial').texture = badPath;
    assert.throws(() => validateDocument(bad, record => record), /textura|ruta/i, 'SQLite validation rejects nonportable material asset paths.');
  }
  const badWear = clone(serialized), badActor = badWear.rooms.hall.additions.find(value => value.id === model.userData.editorId);
  const invalidLayer = layer(); invalidLayer.matrix[15] = 0;
  badActor.behaviors.find(value => value.type === 'surfaceWear').layers = JSON.stringify([invalidLayer]);
  assert.throws(() => validateDocument(badWear, record => record), /matriz|af.n/i);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'webxr-material-workflow-')); let store;
  try {
    store = new ProjectStore({dataDir: directory});
    const saved = store.saveProject(null, {name: 'Materials and local brush regression', document: serialized});
    assert(saved.document.imports.every(record => !record.dataUrl && record.url === '/api/assets/' + record.sha256));
    for (const record of saved.document.imports) bytesByURL.set(record.url, fs.readFileSync(path.join(directory, 'uploads', record.sha256 + '.blob')));
    store.close(); store = new ProjectStore({dataDir: directory}); const reopened = store.getProject(saved.id);
    equivalent(reopened.document, saved.document);
    const loaded = setup(reopened.document.imports); await loaded.document.load(reopened.document); await settle(loaded);
    const loadedModel = loaded.document.getObject(model.userData.editorId), loadedPaintCopy = loaded.document.getObject(paintedCopy.userData.editorId);
    assert(loadedModel && loadedPaintCopy); assert(fetched.some(url => url.startsWith('/api/assets/')), 'Reopening actually reloads imported model/maps from SQLite content-addressed asset URLs.');
    assert.deepEqual(loaded.document.getBehaviors(loadedModel), f.document.getBehaviors(model));
    assert.deepEqual(loaded.document.getBehaviors(loadedPaintCopy), f.document.getBehaviors(paintedCopy));
    const restoredMap = materialOf(physicalMeshes(loadedModel)[0]);
    assert(restoredMap.map && restoredMap.normalMap && restoredMap.roughnessMap && restoredMap.metalnessMap);
    close(restoredMap.map.repeat.x, 2); close(restoredMap.map.repeat.y, 3); assert.equal(restoredMap.map.flipY, false);
    assert.equal(restoredMap.normalMap.encoding, THREE.LinearEncoding);
    const loadedMark = paintEntry(loaded, loadedModel), loadedCopiedMark = paintEntry(loaded, loadedPaintCopy);
    assert(loadedMark.state.mesh.geometry.attributes.position.count > 0); assert.notEqual(loadedMark.state.material.map, loadedCopiedMark.state.material.map);
    const loadedMachine = loaded.document.getObject(machine.userData.editorId), loadedMachineCopy = loaded.document.getObject(machineCopy.userData.editorId);
    assert.equal(loaded.document.getBehaviors(loadedMachine).find(value => value.type === 'conveyor').length, 5.2);
    const loadedPanel = loadedMachine.children[0].children[6], loadedCopiedPanel = loadedMachineCopy.children[0].children[6];
    close(materialOf(loadedPanel.children[0]).metalness, 0.91);
    assert.equal(loaded.document.getBehaviors(loadedCopiedPanel.children[2]).find(value => value.type === 'control').targetId, loadedMachineCopy.userData.editorId);
    equivalent(await loaded.document.serialize(), reopened.document);
    const loadedAuthored = JSON.stringify(await loaded.document.serialize());
    for (let cycle = 0; cycle < 3; cycle++) {
      await settle(loaded); loaded.ctx.editor.active = false; loaded.runtime.start('hall'); loaded.visuals.sync('hall', 0.2, false);
      loaded.runtime.command(loadedMachine.userData.editorId, 'powerOn'); loaded.runtime.command(loadedMachine.userData.editorId, 'start'); advance(loaded, 0.1);
      const actualRoller = Array.from(loaded.visuals.rollers.values()).find(entry => {
        for (let node = entry.object; node; node = node.parent) if (node === loadedMachine) return true; return false;
      }); assert(actualRoller && actualRoller.surfaces.length);
      assert(loaded.runtime.records.get(loadedMachine.userData.editorId).variables.actualSpeed > 0);
      const owned = new Map();
      loaded.surface.states.forEach(state => new Set([...state.materials, ...state.textures]).forEach(resource => {
        owned.set(resource, 0); resource.addEventListener('dispose', () => owned.set(resource, owned.get(resource) + 1));
      }));
      loaded.visuals.dispose(); loaded.runtime.stop(); loaded.paint.dispose(); loaded.surface.dispose(); loaded.ctx.editor.active = true;
      owned.forEach(count => assert.equal(count, 1, 'Each customized private material/texture is disposed exactly once at teardown.'));
      assert.equal(loaded.surface.states.size, 0); assert.equal(loaded.paint.entries.size, 0); assert.equal(loaded.paint.engine.states.size, 0);
      assert.equal(JSON.stringify(await loaded.document.serialize()), loadedAuthored, 'Playing with loaded materials/brush layers does not alter the saved scene.');
      assert(physicalMeshes(loadedModel).every(mesh => !loaded.surface.isOwnedMaterial(materialOf(mesh))), 'The authored source material is restored before the next play session.');
    }
    assert.equal(loaded.notices.length, 0);
  } finally {
    if (store) store.close();
    const resolved = path.resolve(directory), temporaryRoot = path.resolve(os.tmpdir()) + path.sep;
    assert(resolved.startsWith(temporaryRoot), 'Only the isolated temporary test database may be deleted.'); fs.rmSync(resolved, {recursive: true, force: true});
  }
  stop(f);
  original.forEach(entry => {
    assert.equal(entry.mesh.material, entry.material); assert.equal(entry.material.map, entry.map);
    const image = imageResources.find(record => record.texture === entry.map); assert(image && image.disposed === 0, 'Surface teardown never disposes an original imported model texture.');
    assert.deepEqual(Array.from(entry.geometry.attributes.position.array), entry.position);
  });
  assert.equal(f.notices.length, 0);
  console.log('Material workflow: real glTF/assets, private PBR maps, source quality, slots/descendant overrides, brush batching/follow/copies, industrial controls/roller animation, undo/redo, SQLite close/reopen and exact reusable lifecycle cleanup passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { resources.forEach(stop); });
