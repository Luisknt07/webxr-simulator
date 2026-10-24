// Run with: node scripts/test-editor-document.js (no WebGL/browser required).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const THREE = require('three');
const source = fs.readFileSync(path.join(__dirname, '../src/editor/SceneDocument.js'), 'utf8')
  .replace("import * as THREE from 'three';", '')
  .replace("import behaviorSchema from '../../shared/behaviors.js';", '')
  .replace("import {createIndustrialPrefab} from './IndustrialPrefabs.js';", '')
  .replace('export default class SceneDocument', 'return class SceneDocument');
const prefabSource = fs.readFileSync(path.join(__dirname, '../src/editor/IndustrialPrefabs.js'), 'utf8')
  .replace("import * as THREE from 'three';", '')
  .replace("import behaviorSchema from '../../shared/behaviors.js';", '')
  .replace(/export const /g, 'const ')
  .replace(/export function /g, 'function ');
const createIndustrialPrefab = new Function('THREE', 'behaviorSchema', prefabSource + '\nreturn createIndustrialPrefab;')(THREE, require('../shared/behaviors'));
const SceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', source)(THREE, require('../shared/behaviors'), createIndustrialPrefab);

async function run() {
  const root = new THREE.Group();
  const shared = new THREE.MeshBasicMaterial({color: '#123456'});
  const door = new THREE.Mesh(new THREE.BoxBufferGeometry(), shared);
  const wall = new THREE.Mesh(new THREE.BoxBufferGeometry(), shared);
  door.name = 'doorA';
  wall.name = 'wall';
  door.userData.runtimeReference = root; // Runtime circular references must never enter JSON.
  const helper = new THREE.Group();
  helper.userData.editorHelper = true;
  root.add(door, wall, helper);
  const recordA = {id: 'batch-test-1', path: 'a.glb', dataUrl: 'data:model/gltf-binary;base64,QUFB'};
  const recordB = {id: 'batch-other-1', path: 'b.glb', dataUrl: 'data:model/gltf-binary;base64,QkJC'};
  const makeLibrary = records => ({
    imports: records.slice(),
    instantiate: async function(descriptor) {
      if (descriptor.path === 'broken.glb') throw new Error('fixture failed');
      if (descriptor.importId && !this.imports.some(record => record.id === descriptor.importId)) throw new Error('Missing imported binary');
      return new THREE.Mesh(new THREE.BoxBufferGeometry(), shared);
    },
    exportImports() { return this.imports.map(record => Object.assign({}, record)); },
    restoreImports(records) { this.imports = records.map(record => Object.assign({}, record)); }
  });
  const library = makeLibrary([recordA]);
  const document = new SceneDocument({}, {assetLibrary: library});
  document.registerRoom('hall', root);
  assert.deepStrictEqual(document.getObjects('hall'), [door, wall]);
  assert.strictEqual(door.userData.editorId, 'native:hall:root.0');
  assert.strictEqual(document.getRoomForObject(door), 'hall');
  assert.strictEqual(document.isNative(door), true);
  assert.throws(() => document.rename(door, 'broken'), /nativo/);

  document.setTransform(door, {position: [2, 0, 0], rotation: [0, Math.PI / 2, 0]});
  assert.strictEqual(door.position.x, 2);
  assert.strictEqual(document.canUndo, true);
  document.undo();
  assert.strictEqual(door.position.x, 0);
  document.redo();
  assert.strictEqual(door.position.x, 2);
  assert.throws(() => document.setTransform(door, {scale: [0, 1, 1]}), /inválido/);
  assert.throws(() => document.setTransform(door, {position: [NaN, 1, 1]}), /inválido/);

  const historyLength = document.undoStack.length;
  document.begin();
  door.position.x = 4;
  door.position.x = 5;
  document.commit();
  assert.strictEqual(document.undoStack.length, historyLength + 1);
  document.undo();
  assert.strictEqual(door.position.x, 2);
  document.begin();
  door.scale.x = -1;
  assert.throws(() => document.commit(), /inválido/);
  assert.strictEqual(door.scale.x, 1);
  assert.strictEqual(document.transaction, null);

  document.setProperty(door, 'color', '#abcdef');
  assert.notStrictEqual(door.material, shared);
  assert.strictEqual(wall.material, shared);
  assert.strictEqual(shared.color.getHexString(), '123456');
  document.undo();
  assert.strictEqual(door.material, shared);

  document.remove(door);
  assert.strictEqual(door.visible, false);
  assert.strictEqual(door.parent, root);
  assert.strictEqual(root.getObjectByName('doorA'), door);
  document.undo();
  assert.strictEqual(door.visible, true);

  const box = document.addPrimitive('hall', 'box');
  document.rename(box, 'Personalizado');
  document.setInteraction(box, {type: 'room', room: 2});
  document.setProperty(box, 'color', '#ff0000');
  const copy = await document.duplicate(box);
  assert.notStrictEqual(copy.children[0].material, box.children[0].material);
  assert.deepStrictEqual(copy.userData.editorInteraction, {type: 'room', room: 2});
  assert.strictEqual(copy.position.x, box.position.x + 0.5);
  const asset = await document.addAsset('hall', {path: 'model.glb'});
  const imported = await document.addAsset('hall', {importId: 'batch-test-1'});
  assert.strictEqual(imported.userData.editorDescriptor.importId, 'batch-test-1');
  assert.strictEqual(document.getEditableObject(asset.children[0]), asset);
  document.remove(asset);
  assert.strictEqual(asset.parent, null);
  document.undo();
  assert.strictEqual(asset.parent, root);
  assert.throws(() => document.setInteraction(box, {type: 'link', url: 'javascript:alert(1)'}), /compatible/);
  assert.throws(() => document.setInteraction(box, {type: 'message', text: 'a'.repeat(651)}), /650/);
  document.setInteraction(box, {type: 'message', text: 'Bienvenido'});
  assert.deepStrictEqual(box.userData.editorInteraction, {type: 'message', text: 'Bienvenido'});
  document.setInteraction(box, {type: 'teleport'});
  assert.deepStrictEqual(box.userData.editorInteraction, {type: 'teleport'});
  document.setInteraction(box, {type: 'room'});
  assert.deepStrictEqual(box.userData.editorInteraction, {type: 'room', room: 0});
  assert.throws(() => document.setInteraction(box, {type: 'room', room: 10}), /Sala/);
  await assert.rejects(document.addAsset('hall', {path: '../outside.glb'}), /inválida/);

  // JSON is an overlay, never a serialization of native runtime objects or materials.
  const saved = await document.serialize();
  const json = JSON.stringify(saved);
  assert(!json.includes('runtimeReference'));
  assert(!json.includes('Object3D'));
  assert.strictEqual(saved.rooms.hall.additions.length, 4);
  assert.strictEqual(saved.rooms.hall.overrides.length, 1);
  assert.strictEqual(saved.rooms.hall.overrides[0].position[0], 2);

  document.resetRoom('hall');
  assert.strictEqual(door.position.x, 0);
  assert.strictEqual(document.additions.size, 0);
  assert.strictEqual((await document.serialize()).rooms.hall.overrides.length, 0);
  await document.load(JSON.parse(json));
  assert.strictEqual(door.position.x, 2);
  assert.strictEqual(door.name, 'doorA');
  assert.strictEqual(document.additions.size, 4);
  const roundtrip = await document.serialize();
  assert.deepStrictEqual(roundtrip, saved);

  // All input/model loading must succeed before replacing the current scene.
  const invalid = JSON.parse(json);
  invalid.rooms.hall.additions[0].quaternion = [0, 0, 0, 0];
  await assert.rejects(document.load(invalid), /Rotación/);
  assert.deepStrictEqual(await document.serialize(), saved);
  const missing = JSON.parse(json);
  missing.rooms.hall.additions[0].descriptor = {path: 'broken.glb'};
  await assert.rejects(document.load(missing), /fixture failed/);
  assert.deepStrictEqual(await document.serialize(), saved);
  assert.strictEqual(root.getObjectByName('doorA'), door);
  document.undo();
  assert.strictEqual(document.additions.size, 0);
  document.redo();
  assert.strictEqual(document.additions.size, 4);

  // A load replaces binary resources as well as scene instances. History must
  // restore both, so exporting an undone project is independently reopenable.
  const other = JSON.parse(json);
  other.imports = [recordB];
  other.rooms.hall.additions.find(item => item.descriptor.importId).descriptor.importId = recordB.id;
  await document.load(other);
  assert.deepStrictEqual(library.exportImports(), [recordB]);
  document.undo();
  assert.deepStrictEqual(library.exportImports(), [recordA]);
  const undone = await document.serialize();
  assert.deepStrictEqual(undone, saved);
  const reopenedRoot = new THREE.Group();
  reopenedRoot.add(new THREE.Mesh(new THREE.BoxBufferGeometry(), shared), new THREE.Mesh(new THREE.BoxBufferGeometry(), shared));
  const reopened = new SceneDocument({}, {assetLibrary: makeLibrary([])});
  reopened.registerRoom('hall', reopenedRoot);
  await reopened.load(undone);
  assert.deepStrictEqual(await reopened.serialize(), saved);
  document.redo();
  assert.deepStrictEqual(await document.serialize(), other);
  assert.deepStrictEqual(library.exportImports(), [recordB]);

  const emptyImports = JSON.parse(JSON.stringify(other));
  emptyImports.imports = [];
  emptyImports.rooms.hall.additions = emptyImports.rooms.hall.additions.filter(item => !item.descriptor.importId);
  await document.load(emptyImports);
  assert.deepStrictEqual(library.exportImports(), []);
  document.undo();
  assert.deepStrictEqual(await document.serialize(), other);
  document.redo();
  assert.deepStrictEqual(await document.serialize(), emptyImports);
  const failedReplacement = JSON.parse(json);
  failedReplacement.rooms.hall.additions[0].descriptor = {path: 'broken.glb'};
  await assert.rejects(document.load(failedReplacement), /fixture failed/);
  assert.deepStrictEqual(library.exportImports(), []);
  assert.deepStrictEqual(await document.serialize(), emptyImports);

  // Binary payloads are immutable shared strings; snapshots own their metadata.
  library.restoreImports([recordA]);
  const captured = document.capture();
  library.imports[0].path = 'changed.glb';
  assert.strictEqual(captured.imports[0].path, 'a.glb');
  assert.strictEqual(captured.imports[0].dataUrl, recordA.dataUrl);
  await testBehaviorsAndAssets();
  await testObjectClipboard();
  await testPanoramaMaterialCopies();
  await testDecalAnchors();
  await testDeferredRoomResources();
  console.log('SceneDocument: native identity, clipboard, texture copies, replacement assets, atomic lazy room loading/cancellation, save-before-visit and undo/redo history passed.');
}

async function testDeferredRoomResources() {
  const state = {position: [0, 1, -2], quaternion: [0, 0, 0, 1], scale: [1, 1, 1], visible: true, behaviors: []};
  const addition = (id, descriptor) => Object.assign({id, name: id, descriptor, interaction: {type: 'none'}}, state);
  const data = {format: 'hello-webxr-editor', version: 1, imports: [
    {id: 'large-model', path: 'large.glb', size: 51 * 1024 * 1024, url: '/api/assets/' + 'a'.repeat(64)}
  ], rooms: {
    hall: {overrides: [], additions: [addition('custom-active', {path: 'active.glb'})]},
    other: {
      overrides: [{id: 'native:other:root.0', position: [3, 0, 0], visual: {path: 'other-visual.glb'}}],
      additions: [addition('custom-inactive', {importId: 'large-model'})]
    }
  }};
  const setup = () => {
    const calls = [], events = [];
    const library = {
      imports: [], gate: null, fail: null,
      async instantiate(descriptor) {
        const key = descriptor.path || descriptor.importId;
        calls.push(key);
        if (this.gate) await this.gate.promise;
        if (this.fail === key) throw new Error('fixture model failure');
        return new THREE.Mesh(new THREE.BoxBufferGeometry(), new THREE.MeshBasicMaterial());
      },
      exportImports() { return this.imports.slice(); },
      restoreImports(records) { this.imports = records.slice(); }
    };
    const document = new SceneDocument({}, {assetLibrary: library, onChange: event => events.push(event.type)});
    ['hall', 'other'].forEach(roomId => {
      const root = new THREE.Group();
      root.add(new THREE.Mesh(new THREE.BoxBufferGeometry(), new THREE.MeshBasicMaterial()));
      document.registerRoom(roomId, root);
    });
    return {document, library, calls, events};
  };
  const eager = setup();
  await eager.document.load(data);
  assert.deepEqual(eager.calls, ['active.glb', 'large-model', 'other-visual.glb'], 'Legacy loading remains eager.');
  const canonical = await eager.document.serialize();
  const {document, library, calls, events} = setup();
  await document.load(canonical, {activeRoomId: 'hall'});
  assert.deepEqual(calls, ['active.glb'], 'An inactive 51 MiB import and native replacement must not be fetched or parsed.');
  assert.equal(document.getObject('custom-inactive'), null);
  const native = document.getObject('native:other:root.0');
  assert.equal(native.position.x, 3, 'Native transforms and functions apply without requiring the replacement model.');
  assert.equal(document.visuals.has(native.userData.editorId), false);
  assert.equal(document.getVisualDescriptor(native).path, 'other-visual.glb');
  assert.equal(document.captureObject(native).record.visual.path, 'other-visual.glb', 'Copy records retain pending replacements.');
  assert.deepEqual(await document.serialize(), canonical, 'Saving before visiting a room must retain every record and asset.');
  const fingerprint = document._fingerprint(document.capture());
  const history = document.undoStack.length, changes = events.length;
  library.gate = {};
  library.gate.promise = new Promise(resolve => { library.gate.resolve = resolve; });
  const activation = document.activateRoom('other');
  assert.strictEqual(document.activateRoom('other'), activation, 'Concurrent room requests share the same promise.');
  assert.equal(document.getObject('custom-inactive'), null, 'The live graph stays untouched until the whole room is ready.');
  assert.deepEqual(await document.serialize(), canonical);
  library.gate.resolve(); library.gate = null;
  assert.equal(await activation, true);
  assert.equal(document.hasPendingRoom('other'), false);
  assert(document.getObject('custom-inactive'));
  assert(document.visuals.has(native.userData.editorId));
  assert.equal(document._fingerprint(document.capture()), fingerprint, 'Activation must not create a dirty project.');
  assert.equal(document.undoStack.length, history);
  assert.equal(events.length, changes, 'Activation emits no authoring change event.');
  assert.deepEqual(await document.serialize(), canonical);
  assert.equal(await document.activateRoom('other'), false);
  document.resetRoom('other');
  assert.equal(document.getObject('custom-inactive'), null);
  document.undo();
  assert(document.getObject('custom-inactive'), 'Undoing a reset restores already hydrated objects synchronously.');
  assert.deepEqual(await document.serialize(), canonical);
  const copy = await document.duplicate(document.getObject('custom-inactive'));
  assert.equal(document.additions.get(copy.userData.editorId).descriptor.importId, 'large-model');
  document.undo();

  const historical = setup();
  await historical.document.load(canonical, {activeRoomId: 'hall'});
  historical.document.setTransform(historical.document.getObject('custom-active'), {position: [9, 1, -2]});
  await historical.document.activateRoom('other');
  historical.document.undo();
  assert(historical.document.getObject('custom-inactive'), 'Undo history from before activation must retain its hydrated room.');
  assert(historical.document.visuals.has('native:other:root.0'));
  assert.deepEqual(await historical.document.serialize(), canonical);
  historical.document.redo();
  assert.equal(historical.document.getObject('custom-active').position.x, 9);
  assert(historical.document.getObject('custom-inactive'));

  const failed = setup();
  await failed.document.load(canonical, {activeRoomId: 'hall'});
  failed.library.fail = 'other-visual.glb';
  await assert.rejects(failed.document.activateRoom('other'), /fixture model failure/);
  assert.equal(failed.document.getObject('custom-inactive'), null, 'A failed later asset cannot partially install its room.');
  assert(failed.document.getObject('custom-active'));
  assert(failed.document.hasPendingRoom('other'));
  assert.deepEqual(await failed.document.serialize(), canonical, 'Activation failure must not lose saved data.');
  failed.library.fail = null;
  assert.equal(await failed.document.activateRoom('other'), true, 'Failed room loads remain retryable.');

  const stale = setup();
  await stale.document.load(canonical, {activeRoomId: 'hall'});
  const gate = {};
  gate.promise = new Promise(resolve => { gate.resolve = resolve; });
  stale.library.gate = gate;
  const obsolete = stale.document.activateRoom('other');
  stale.document.resetRoom('other');
  gate.resolve(); stale.library.gate = null;
  assert.equal(await obsolete, false);
  assert.equal(stale.document.getObject('custom-inactive'), null, 'A reset invalidates pending attachment.');
  assert.equal((await stale.document.serialize()).rooms.other.additions.length, 0);
  stale.document.undo();
  assert(stale.document.hasPendingRoom('other'), 'Undo must retain the deferred records.');
  await stale.document.activateRoom('other');
  assert.deepEqual(await stale.document.serialize(), canonical);

  const replaced = setup();
  await replaced.document.load(canonical, {activeRoomId: 'hall'});
  const oldGate = {};
  oldGate.promise = new Promise(resolve => { oldGate.resolve = resolve; });
  replaced.library.gate = oldGate;
  const oldActivation = replaced.document.activateRoom('other');
  replaced.library.gate = null;
  const empty = {format: data.format, version: 1, imports: [], rooms: {
    hall: {overrides: [], additions: []}, other: {overrides: [], additions: []}
  }};
  await replaced.document.load(empty, {activeRoomId: 'hall'});
  oldGate.resolve();
  assert.equal(await oldActivation, false);
  assert.equal(replaced.document.getObject('custom-inactive'), null, 'Old load results cannot attach to another project.');
  assert.deepEqual(await replaced.document.serialize(), empty);
  assert.equal(replaced.calls.filter(key => key === 'other-visual.glb').length, 0, 'Obsolete activation stops preparing later models.');
}

async function testDecalAnchors() {
  const root = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.BoxBufferGeometry(), new THREE.MeshBasicMaterial());
  root.add(wall);
  const document = new SceneDocument({});
  document.registerRoom('hall', root);
  const config = {asset: 'paintings/sign.png', targetId: wall.userData.editorId,
    width: 2.5, height: 0.75, depth: 0.08, opacity: 0.6, color: '#ABCDEF'};
  const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2).toArray();
  const decal = document.addDecal('hall', config, {position: [1, 2, 3], quaternion, scale: [2, 1, 1]});
  const decalId = decal.userData.editorId;
  assert.equal(document.undoStack.length, 1, 'Placing a decal is one complete history action.');
  assert.deepEqual(decal.userData.editorDescriptor, {type: 'decal'});
  assert.deepEqual(decal.position.toArray(), [1, 2, 3]);
  assert.deepEqual(decal.quaternion.toArray(), quaternion);
  assert.deepEqual(decal.scale.toArray(), [2, 1, 1]);
  assert.equal(decal.children[0].isGroup, true, 'The persisted projector has no visible or collidable base plane.');
  assert.equal(decal.children[0].children.length, 0);
  config.width = 99;
  assert.equal(document.getBehaviors(decal)[0].width, 2.5, 'Configuration inputs are copied.');
  document.undo(); assert.equal(document.getObject(decalId), null);
  document.redo(); assert.equal(document.getObject(decalId), decal);

  const generated = new THREE.Mesh(new THREE.PlaneBufferGeometry(), new THREE.MeshBasicMaterial());
  generated.userData.editorRuntimeHelper = true;
  generated.userData.editorVisualOwnerId = decalId;
  decal.add(generated);
  assert.equal(document.getEditableObject(generated), decal);
  const snapshot = document.captureObject(generated);
  const duplicate = await document.pasteObject(snapshot);
  assert.deepEqual(document.getBehaviors(duplicate), document.getBehaviors(decal));
  assert.equal(duplicate.position.x, 1.5);
  assert.equal(duplicate.children.length, 1, 'Copying retains configuration, not transient projected triangles.');
  document.setBehaviors(duplicate, [Object.assign({}, document.getBehaviors(duplicate)[0], {asset: 'batch-image-1', opacity: 0.2})]);
  assert.equal(document.getBehaviors(decal)[0].asset, 'paintings/sign.png');
  assert.equal(document.getBehaviors(decal)[0].opacity, 0.6);
  assert.equal(document.getBehaviors(duplicate)[0].targetId, wall.userData.editorId, 'Copies retain external surface references.');
  const saved = await document.serialize();
  assert(!JSON.stringify(saved).includes('editorRuntimeHelper'));
  const reopened = new SceneDocument({});
  reopened.registerRoom('hall', new THREE.Group());
  await reopened.load(saved);
  assert.deepEqual(await reopened.serialize(), saved, 'Decals reopen without loading generated meshes as assets.');
  assert.deepEqual(reopened.getBehaviors(reopened.getObject(duplicate.userData.editorId)), document.getBehaviors(duplicate));
  const historyLength = document.undoStack.length;
  const count = document.additions.size;
  for (const invalid of [{width: 0}, {height: Infinity}, {depth: -1}, {opacity: 2}, {color: '#bad'},
    {asset: 'https://foreign.test/decal.png'}, {asset: '../secret.png'}, {targetId: '../object'}]) {
    assert.throws(() => document.addDecal('hall', invalid));
  }
  assert.throws(() => document.addDecal('hall', {}, {quaternion: [0, 0, 0, 0]}), /Rotación/);
  assert.equal(document.additions.size, count);
  assert.equal(document.undoStack.length, historyLength, 'Invalid projection parameters do not create partial history.');
  const blank = document.addDecal('hall');
  assert.deepEqual(document.getBehaviors(blank), [require('../shared/behaviors').defaultBehavior('decal')]);
}

async function testPanoramaMaterialCopies() {
  const shaders = new Function(fs.readFileSync(path.join(__dirname, '../src/lib/shaders.js'), 'utf8')
    .replace('export var shaders', 'var shaders') + '\nreturn shaders;')();
  const makeTexture = () => {
    const texture = new THREE.CompressedTexture([{data: new Uint8Array(8).fill(127), width: 4, height: 4}],
      4, 4, THREE.RGB_S3TC_DXT1_Format);
    texture.encoding = THREE.sRGBEncoding;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2, 3); texture.offset.set(0.1, 0.2);
    texture.needsUpdate = true;
    return texture;
  };
  const makeDocument = () => {
    const tex = makeTexture(), fx = makeTexture();
    const material = new THREE.ShaderMaterial({
      uniforms: {time: {value: 1.2}, selected: {value: 0}, tex: {value: tex}, texfx: {value: fx}},
      vertexShader: shaders.panoball_vert, fragmentShader: shaders.panoball_frag, side: THREE.BackSide
    });
    const sphere = new THREE.Mesh(new THREE.SphereBufferGeometry(0.15, 30, 20), material);
    sphere.name = 'Portal panorámico';
    sphere.userData.editorDefaultBehaviors = [require('../shared/behaviors').defaultBehavior('portal')];
    sphere.userData.editorNativeBehaviorTypes = ['portal'];
    const root = new THREE.Group(); root.add(sphere);
    const document = new SceneDocument({}); document.registerRoom('hall', root);
    return {document, sphere, material, tex, fx};
  };
  const {document, sphere, material, tex, fx} = makeDocument();
  // This is the Three r112 failure mode: cloned samplers keep their bytes but
  // WebGLTextures will not upload a new texture until its version is positive.
  assert.equal(material.clone().uniforms.tex.value.version, 0);
  const checkMaterial = object => {
    const copied = object.children[0].material;
    assert.notStrictEqual(copied, material);
    assert.equal(copied.vertexShader, material.vertexShader);
    assert.equal(copied.fragmentShader, material.fragmentShader);
    assert.equal(copied.side, material.side);
    for (const key of ['tex', 'texfx']) {
      const source = material.uniforms[key].value, texture = copied.uniforms[key].value;
      assert.notStrictEqual(texture, source);
      assert(texture.version > 0, 'A copied panorama sampler must be scheduled for GPU upload.');
      assert.equal(texture.isCompressedTexture, true);
      assert.deepEqual(texture.image, source.image);
      assert.deepEqual(texture.mipmaps, source.mipmaps);
      for (const property of ['format', 'type', 'encoding', 'flipY', 'wrapS', 'wrapT', 'minFilter', 'magFilter']) {
        assert.equal(texture[property], source[property], 'Preserved texture property: ' + property);
      }
      assert(texture.repeat.equals(source.repeat)); assert(texture.offset.equals(source.offset));
    }
    return copied;
  };
  const clipboard = document.captureObject(sphere);
  const copy = await document.pasteObject(clipboard, 'hall');
  const firstMaterial = checkMaterial(copy);
  const duplicate = await document.duplicate(copy);
  const secondMaterial = checkMaterial(duplicate);
  assert.notStrictEqual(firstMaterial.uniforms.tex.value, secondMaterial.uniforms.tex.value);
  firstMaterial.uniforms.tex.value.offset.x = 0.8;
  assert.equal(secondMaterial.uniforms.tex.value.offset.x, 0.1);
  assert.equal(tex.offset.x, 0.1);
  assert.equal(tex.version, 1); assert.equal(fx.version, 1, 'Source textures remain unchanged.');
  document.setProperty(duplicate, 'color', '#ffffff'); checkMaterial(duplicate);
  document.undo(); checkMaterial(duplicate);
  const copyId = copy.userData.editorId;
  const saved = await document.serialize();
  assert(!JSON.stringify(saved).includes('mipmaps'), 'GPU data is reconstructed from the native asset reference.');
  const restored = makeDocument(); await restored.document.load(saved);
  const restoredCopy = restored.document.getObject(copyId);
  const restoredMaterial = restoredCopy.children[0].material;
  assert(restoredMaterial.uniforms.tex.value.version > 0);
  assert(restoredMaterial.uniforms.texfx.value.version > 0, 'Previously saved copies recover upload-ready effect textures.');
  assert.deepEqual(restoredMaterial.uniforms.tex.value.mipmaps, tex.mipmaps);
}

async function testObjectClipboard() {
  const schema = require('../shared/behaviors');
  const imports = [{id: 'clipboard-model', path: 'model.glb', dataUrl: 'data:model/gltf-binary;base64,QUFB'}];
  const library = {
    imports,
    async instantiate(descriptor) {
      if (descriptor.path === 'broken.glb') throw new Error('clipboard fixture failed');
      if (descriptor.importId && !this.imports.some(item => item.id === descriptor.importId)) throw new Error('Missing imported binary');
      return new THREE.Mesh(new THREE.BoxBufferGeometry(), new THREE.MeshStandardMaterial({color: '#ffffff'}));
    },
    exportImports() { return this.imports.map(item => Object.assign({}, item)); },
    restoreImports(records) { this.imports = records.map(item => Object.assign({}, item)); }
  };
  const makeDocument = () => {
    const document = new SceneDocument({}, {assetLibrary: library});
    const hall = new THREE.Group(), other = new THREE.Group();
    const native = new THREE.Group(), nativeChild = new THREE.Mesh(new THREE.BoxBufferGeometry(), new THREE.MeshStandardMaterial({color: '#ffffff'}));
    native.name = 'Native instrument'; nativeChild.name = 'Editable note';
    native.userData.runtimeReference = nativeChild;
    nativeChild.userData.editorDefaultBehaviors = [schema.defaultBehavior('note')];
    native.add(nativeChild); hall.add(native);
    document.registerRoom('hall', hall); document.registerRoom('other', other);
    return {document, native, nativeChild};
  };
  const {document, native, nativeChild} = makeDocument();
  const source = await document.addAsset('hall', {importId: 'clipboard-model'});
  document.rename(source, 'Motor configurado');
  document.setTransform(source, {position: [5, 2, -3], scale: [2, 3, 4], rotation: [0, 0.4, 0]});
  document.setProperty(source, 'color', '#12ab34');
  document.setProperty(source, 'visible', false);
  document.setBehaviors(source, [Object.assign(schema.defaultBehavior('float'), {amplitude: 0.35})]);
  document.setInteraction(source, {type: 'toggle', targetId: source.userData.editorId});
  await document.replaceAsset(source, {type: 'sphere', color: '#778899'});
  const sourceState = document._additionRecord(document.additions.get(source.userData.editorId));
  const historyLength = document.undoStack.length, nextId = document.nextId;
  const clipboard = document.captureObject(source);
  const clipboardJSON = JSON.stringify(clipboard);
  assert.equal(document.undoStack.length, historyLength, 'Copying must not create an edit or history entry.');
  assert.equal(document.nextId, nextId, 'Copying must not allocate scene identities.');
  assert(!clipboardJSON.includes('Object3D') && !clipboardJSON.includes('runtimeReference'));
  document.rename(source, 'Changed after copy');
  document.setTransform(source, {position: [50, 2, -3]});
  document.setBehaviors(source, []);
  await document.replaceAsset(source, {type: 'box', color: '#ff0000'});
  document.remove(source);
  const copy = await document.pasteObject(clipboard, 'other');
  assert.equal(copy.parent, document.getRoot('other'));
  assert.equal(copy.name, 'Motor configurado copia');
  assert.deepEqual(copy.position.toArray(), [5.5, 2, -3]);
  assert.deepEqual(copy.quaternion.toArray(), sourceState.quaternion);
  assert.deepEqual(copy.scale.toArray(), [2, 3, 4]);
  assert.equal(copy.visible, false);
  assert.equal(copy.userData.editorColor, '#12ab34');
  assert.deepEqual(document.getBehaviors(copy), sourceState.behaviors);
  assert.deepEqual(document.getVisualDescriptor(copy), sourceState.visual);
  assert.equal(copy.userData.editorDescriptor.importId, 'clipboard-model');
  assert.equal(copy.userData.editorInteraction.targetId, copy.userData.editorId);
  assert.deepEqual(library.exportImports(), imports, 'Pasting reuses the asset file without duplicating its binary import.');
  document.undo(); assert.equal(document.getObject(copy.userData.editorId), null);
  document.redo(); assert.equal(document.getObject(copy.userData.editorId), copy);
  const repeated = await document.pasteObject(clipboard, 'other', 1);
  assert.notEqual(repeated.userData.editorId, copy.userData.editorId);
  assert.deepEqual(repeated.position.toArray(), [6, 2, -3]);
  assert.notEqual(repeated.children[0].material, copy.children[0].material);
  document.setBehaviors(copy, []);
  assert.deepEqual(document.getBehaviors(repeated), sourceState.behaviors, 'Pasted component data must remain independent.');
  assert.equal(JSON.stringify(clipboard), clipboardJSON, 'Editing, deleting and pasting must not mutate the captured clipboard.');

  // Capture current native child tints/parameters, rather than reading the live
  // original again when reconstructing the baseline native asset during paste.
  document.setTransform(native, {position: [-3, 1, 2]});
  document.setProperty(nativeChild, 'color', '#aabbcc');
  document.setBehaviors(nativeChild, [Object.assign(schema.defaultBehavior('note'), {volume: 0.27})]);
  const nativeClipboard = document.captureObject(native);
  document.setProperty(nativeChild, 'color', '#ff0000');
  document.setBehaviors(nativeChild, []);
  document.remove(native);
  const nativeCopy = await document.pasteObject(nativeClipboard);
  const nativeCopyChild = document.additions.get(nativeCopy.userData.editorId).nodes.get('0');
  assert.equal(nativeCopyChild.userData.editorColor, '#aabbcc');
  assert.equal(nativeCopyChild.material.color.getHexString(), 'aabbcc');
  assert.equal(document.getBehaviors(nativeCopyChild)[0].volume, 0.27);
  assert.equal(nativeCopy.visible, true, 'A later hide of the original must not hide the captured copy.');
  assert.equal(nativeCopy.children[0].userData.runtimeReference, undefined);

  const belt = document.addPrefab('hall', 'conveyor');
  const entry = document.additions.get(belt.userData.editorId);
  const sensorEntry = Array.from(entry.nodes).find(([, node]) => document.getBehaviors(node).some(item => item.type === 'sensor'));
  const plcEntry = Array.from(entry.nodes).find(([, node]) => document.getBehaviors(node).some(item => item.type === 'automation'));
  const [sensorPath, sensor] = sensorEntry, [plcPath, plc] = plcEntry;
  const external = document.addPrimitive('hall', 'box');
  document.setBehaviors(plc, [Object.assign(schema.defaultBehavior('automation'), {rules: JSON.stringify([
    {sourceId: sensor.userData.editorId, variable: 'active', operator: 'eq', value: true, targetId: belt.userData.editorId, targetVariable: 'running', set: false, edge: 'rising'},
    {sourceId: sensor.userData.editorId, variable: 'active', operator: 'eq', value: false, targetId: external.userData.editorId, targetVariable: 'running', set: true, edge: 'falling'}
  ])})]);
  document.setInteraction(sensor, {type: 'toggle', targetId: belt.userData.editorId});
  document.undo(); assert.equal(sensor.userData.editorInteraction, undefined, 'Undo must restore an absent legacy child action.');
  document.redo(); assert.equal(sensor.userData.editorInteraction.targetId, belt.userData.editorId);
  document.setTransform(sensor, {position: [-1.2, 0.35, 0]});
  document.rename(sensor, 'Sensor personalizado');
  await document.replaceAsset(sensor, {type: 'sphere', color: '#112233'});
  const beltClipboard = document.captureObject(belt);
  document.setInteraction(sensor, {type: 'message', text: 'Changed after copy'});
  document.setTransform(sensor, {position: [20, 0, 0]});
  document.remove(belt);
  const pastedBelt = await document.pasteObject(beltClipboard, 'other');
  const pastedEntry = document.additions.get(pastedBelt.userData.editorId);
  const pastedSensor = pastedEntry.nodes.get(sensorPath), pastedPLC = pastedEntry.nodes.get(plcPath);
  assert.equal(pastedSensor.name, 'Sensor personalizado');
  assert.equal(pastedSensor.position.x, -1.2);
  assert.equal(pastedSensor.userData.editorInteraction.targetId, pastedBelt.userData.editorId);
  assert.equal(document.getBehaviors(pastedSensor).find(item => item.type === 'sensor').sourceId, pastedBelt.userData.editorId);
  assert.deepEqual(document.getVisualDescriptor(pastedSensor), {type: 'sphere', color: '#112233'});
  const pastedRules = JSON.parse(document.getBehaviors(pastedPLC).find(item => item.type === 'automation').rules);
  assert.equal(pastedRules[0].sourceId, pastedSensor.userData.editorId);
  assert.equal(pastedRules[0].targetId, pastedBelt.userData.editorId);
  assert.equal(pastedRules[1].targetId, external.userData.editorId, 'External references must remain linked to their original targets.');
  pastedEntry.nodes.forEach(node => {
    const control = document.getBehaviors(node).find(item => item.type === 'control');
    if (control) assert.equal(control.targetId, pastedBelt.userData.editorId);
  });
  // Copying an editable subcomponent alone must also preserve its descendants.
  const plcClipboard = document.captureObject(pastedPLC);
  document.remove(pastedBelt);
  const pastedPLCAlone = await document.pasteObject(plcClipboard, 'hall');
  assert.equal(document.additions.get(pastedPLCAlone.userData.editorId).nodes.size, 9, 'Copying the panel preserves all nine independently editable controls.');
  const persistedBelt = await document.pasteObject(beltClipboard, 'other', 1);
  const saved = await document.serialize();
  const reopened = makeDocument().document;
  await reopened.load(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(await reopened.serialize(), saved, 'Copied child interactions and replacement assets must roundtrip with the scene.');
  assert.equal(reopened.additions.get(persistedBelt.userData.editorId).nodes.get(sensorPath).userData.editorInteraction.targetId, persistedBelt.userData.editorId);
  const invalid = JSON.parse(JSON.stringify(saved));
  const withNodes = invalid.rooms.other.additions.find(item => item.nodes);
  withNodes.nodes[Object.keys(withNodes.nodes)[0]].interaction = {type: 'message', text: 'x'.repeat(651)};
  await assert.rejects(reopened.load(invalid), /650/);
  assert.deepEqual(await reopened.serialize(), saved);
  const brokenClipboard = JSON.parse(clipboardJSON);
  brokenClipboard.record.visual = {path: 'broken.glb'};
  const beforeFailure = await document.serialize();
  await assert.rejects(document.pasteObject(brokenClipboard), /clipboard fixture failed/);
  assert.deepEqual(await document.serialize(), beforeFailure, 'Failed resource loads must leave scene and history intact.');
  await assert.rejects(document.pasteObject(clipboard, 'missing'), /Sala/);
  await assert.rejects(document.pasteObject(clipboard, 'hall', NaN), /inv\u00e1lido/);
  await assert.rejects(document.pasteObject(null), /compatible/);
}

async function testBehaviorsAndAssets() {
  const {defaultBehavior} = require('../shared/behaviors');
  function scene() {
    const root = new THREE.Group(), instrument = new THREE.Group();
    instrument.name = 'xylophone'; instrument.position.set(3, 2, -1);
    instrument.userData.circular = root;
    const note = new THREE.Mesh(new THREE.BoxBufferGeometry(1, 0.2, 0.4), new THREE.MeshStandardMaterial({color: '#abcdef'}));
    note.name = 'xnote000'; note.position.set(1, 0, 0);
    note.userData.editorDefaultBehaviors = [defaultBehavior('note')];
    note.userData.editorNativeBehaviorTypes = ['note'];
    const functionalText = new THREE.Mesh(new THREE.PlaneBufferGeometry(), new THREE.MeshBasicMaterial());
    functionalText.name = 'textMesh';
    note.add(functionalText);
    const helper = new THREE.Mesh(new THREE.PlaneBufferGeometry(), new THREE.MeshBasicMaterial());
    helper.userData.editorRuntimeHelper = true;
    note.add(helper);
    instrument.add(note); root.add(instrument);
    return {root, instrument, note};
  }
  const first = scene();
  const library = {instantiate: async descriptor => {
    if (descriptor.path === 'broken.glb') throw new Error('fixture failed');
    return new THREE.Mesh(new THREE.SphereBufferGeometry(2), new THREE.MeshStandardMaterial({color: '#ffffff'}));
  }, exportImports: () => [], restoreImports() {}};
  const document = new SceneDocument({}, {assetLibrary: library});
  document.registerRoom('hall', first.root);
  assert.equal(document.getBehaviors(first.note)[0].asset, 'ogg/xylophone1.ogg');
  document.setBehaviors(first.note, [Object.assign(defaultBehavior('note'), {volume: 0.3})]);
  assert.equal(document.getBehaviors(first.note)[0].volume, 0.3);
  assert.equal((await document.serialize()).rooms.hall.overrides[0].behaviors[0].volume, 0.3);
  const clipboard = document.copyBehaviors(first.note);
  clipboard[0].volume = 0.6;
  assert.equal(document.getBehaviors(first.note)[0].volume, 0.3, 'Clipboard data must not share mutable component state.');
  document.undo(); assert.equal(document.getBehaviors(first.note)[0].volume, 1);
  document.redo(); assert.equal(document.getBehaviors(first.note)[0].volume, 0.3);
  const duplicate = await document.duplicate(first.instrument);
  const duplicateEntry = document.additions.get(duplicate.userData.editorId);
  const duplicateNote = duplicateEntry.nodes.get('0');
  assert(duplicateNote && duplicateNote.userData.editorId.endsWith('/0'));
  assert.equal(document.getBehaviors(duplicateNote)[0].volume, 0.3);
  assert(!duplicateNote.userData.editorNativeBehaviorTypes);
  assert.equal(duplicateNote.children.length, 0, 'Clones must regenerate text and runtime helpers from their components.');
  assert.notEqual(duplicateNote.material, first.note.material);
  assert.deepEqual(duplicate.position.toArray(), [3.5, 2, -1]);
  document.setBehaviors(duplicateNote, [Object.assign(defaultBehavior('note'), {volume: 0.9})]);
  assert.equal(document.getBehaviors(first.note)[0].volume, 0.3);
  document.setTransform(duplicateNote, {position: [2, 0, 0]});

  const originalIdentity = first.note;
  const originalMaterial = first.note.material;
  await document.replaceAsset(first.note, {path: 'replacement.glb'});
  assert.equal(first.instrument.getObjectByName('xnote000'), originalIdentity);
  assert.equal(first.note.userData.editorGeometryReplaced, true);
  assert.equal(first.note.material.visible, false);
  assert.equal(first.note.getObjectByName('textMesh').material.visible, true, 'Native functional text must remain visible after changing the background asset.');
  const replacement = document.visuals.get(first.note.userData.editorId).content;
  assert.equal(document.getEditableObject(replacement.children[0]), first.note);
  assert.equal(document.getBehaviors(first.note)[0].volume, 0.3);
  document.undo(); assert.equal(first.note.material, originalMaterial);
  assert.equal(first.note.userData.editorGeometryReplaced, undefined);
  document.redo(); assert.equal(document.getVisualDescriptor(first.note).path, 'replacement.glb');
  document.setProperty(first.note, 'color', '#112233');
  assert.equal(first.note.material.visible, false, 'Tinting a replacement cannot reveal its original mesh.');
  document.resetAsset(first.note); assert.equal(first.note.material.visible, true);
  document.undo(); assert.equal(first.note.material.visible, false);
  await document.replaceAsset(first.instrument, {type: 'box', color: '#ffffff'});
  document.resetAsset(first.instrument);
  assert.equal(first.note.material.visible, false, 'Resetting a parent replacement must preserve a child replacement.');
  document.undo();
  document.resetAsset(first.note);
  assert.equal(first.note.material.visible, false, 'Resetting a child replacement must preserve the parent mask.');
  document.resetAsset(first.instrument);
  assert.equal(first.note.material.visible, true);
  await document.replaceAsset(first.note, {path: 'replacement.glb'});
  await document.replaceAsset(duplicateNote, {path: 'replacement.glb'});
  const before = await document.serialize();
  assert.equal(before.rooms.hall.additions[0].descriptor.nativeId, first.instrument.userData.editorId);
  assert.equal(before.rooms.hall.additions[0].nodes['0'].behaviors[0].volume, 0.9);
  assert(!JSON.stringify(before).includes('circular'));
  const second = scene(), reopened = new SceneDocument({}, {assetLibrary: library});
  reopened.registerRoom('hall', second.root);
  await reopened.load(before);
  assert.deepEqual(await reopened.serialize(), before);
  const restored = reopened.additions.values().next().value;
  assert.equal(reopened.getBehaviors(restored.nodes.get('0'))[0].volume, 0.9);
  assert.equal(restored.nodes.get('0').position.x, 2);
  assert.equal(reopened.visuals.get(restored.nodes.get('0').userData.editorId).descriptor.path, 'replacement.glb');
  const broken = JSON.parse(JSON.stringify(before));
  broken.rooms.hall.additions[0].nodes['0'].visual = {path: 'broken.glb'};
  await assert.rejects(reopened.load(broken), /fixture failed/);
  assert.deepEqual(await reopened.serialize(), before);
  const badNode = JSON.parse(JSON.stringify(before));
  badNode.rooms.hall.additions[0].nodes['99'] = badNode.rooms.hall.additions[0].nodes['0'];
  await assert.rejects(reopened.load(badNode), /descendiente/);
  assert.deepEqual(await reopened.serialize(), before);
  const custom = document.addPrimitive('hall', 'box');
  document.setInteraction(custom, {type: 'toggle', targetId: custom.userData.editorId});
  const copiedCustom = await document.duplicate(custom);
  assert.equal(copiedCustom.userData.editorInteraction.targetId, copiedCustom.userData.editorId);
  document.pasteBehaviors(custom, clipboard);
  const customBefore = document.getBehaviors(custom);
  await document.replaceAsset(custom, {type: 'sphere', color: '#ffffff'});
  assert.deepEqual(document.getBehaviors(custom), customBefore);
  assert.equal(custom.children[0].material.visible, false, 'A replaced custom primitive must hide its original content.');
  const model = await document.addAsset('hall', {path: 'original.glb'});
  await document.replaceAsset(model, {path: 'replacement.glb'});
  assert.equal(model.children[0].material.visible, false, 'A replaced imported asset must hide its original content.');
  await document.replaceAsset(duplicate, {path: 'replacement.glb'});
  assert.equal(duplicateNote.material.visible, false, 'Replacing a native clone must hide its original logical descendants.');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
