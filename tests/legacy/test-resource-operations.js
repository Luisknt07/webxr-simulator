const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const behaviorSchema = require('../../modules/logistica-industrial/contracts/behaviors');
const catalog = require('../../modules/logistica-industrial/contracts/resourceCatalog');
const source = file => fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-resource-operations.js"), '..', file)), 'utf8');
const prefabs = source("modules/logistica-industrial/functions/presentacion/runtime/IndustrialPrefabs.js").replace(/^import .*$/gm, '').replace(/export (const|function) /g, '$1 ');
const createIndustrialPrefab = new Function('THREE', 'behaviorSchema', prefabs + '\nreturn createIndustrialPrefab;')(THREE, behaviorSchema);
const documentSource = source("packages/project-model/src/SceneDocument.js").replace(/^import .*$/gm, '').replace('export default class SceneDocument', 'return class SceneDocument');
const SceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', documentSource)(THREE, behaviorSchema, createIndustrialPrefab);
const operationsSource = source("apps/workspace/studio/ResourceOperations.js").replace(/export async function /g, 'async function ');
const {usage, remove} = new Function(operationsSource + '\nreturn {usage,remove};')();
const copy = value => JSON.parse(JSON.stringify(value));
const files = [
  {id: 'model-one', importId: 'model-one', batchId: 'group-one', path: 'model.glb', name: 'model.glb', extension: 'glb', kind: 'model', size: 1, dataUrl: 'data:model/gltf-binary;base64,AA=='},
  {id: 'texture-one', importId: 'texture-one', batchId: 'group-two', path: 'texture.png', name: 'texture.png', extension: 'png', kind: 'image', size: 1, dataUrl: 'data:image/png;base64,AA=='},
  {id: 'unused-one', importId: 'unused-one', batchId: 'group-three', path: 'unused.png', name: 'unused.png', extension: 'png', kind: 'image', size: 1, dataUrl: 'data:image/png;base64,AA=='}
];
function createEditor() {
  const library = {
    imports: copy(files), exportImports() { return copy(this.imports); }, restoreImports(value) { this.imports = copy(value); },
    instantiate() { return Promise.resolve(new THREE.Mesh(new THREE.BoxBufferGeometry(), new THREE.MeshStandardMaterial())); },
    getCatalog() { return Promise.resolve(this.imports); }
  };
  const document = new SceneDocument({}, {assetLibrary: library});
  document.registerRoom('hall', new THREE.Group()); document.registerRoom('sound', new THREE.Group());
  return {document, library, projectGeneration: 1, currentProject: {id: 'project-one'}, renderAssets() {}, toast() {}};
}
async function run() {
  const editor = createEditor();
  const resource = id => catalog.assetResource(editor.library.imports.find(entry => entry.id === id));
  const mesh = await editor.document.addAsset('hall', {importId: 'model-one'});
  assert((await usage(editor, resource('model-one'))).some(use => use.id.includes(mesh.userData.editorId)));
  const floor = editor.document.addPrimitive('sound', 'plane');
  editor.document.setBehaviors(floor, [{type: 'surfaceMaterial', texture: 'texture-one'}]);
  assert((await usage(editor, resource('texture-one'))).some(use => use.label.startsWith('sound')));
  const saved = await editor.document.serialize();
  await editor.document.load(saved, {activeRoomId: 'hall'});
  assert.equal(editor.document.pendingRooms.has('sound'), true);
  assert((await usage(editor, resource('texture-one'))).some(use => use.label.startsWith('sound')), 'Inactive rooms preserve resource usages without loading their meshes.');
  const pendingBeforeScope = editor.document.pendingRooms.get('sound');
  const liveScope = catalog.sceneResources.index(editor.document, 'hall', editor.library.imports);
  assert(catalog.sceneResources.includes(liveScope, resource('model-one')));
  assert(!catalog.sceneResources.includes(liveScope, resource('texture-one')), 'A texture belonging to another level is excluded from live scene files.');
  const inactiveScope = catalog.sceneResources.index(editor.document, 'sound', editor.library.imports);
  assert(catalog.sceneResources.includes(inactiveScope, resource('texture-one')), 'Pending authoring records expose scene membership without loading a mesh.');
  assert.equal(editor.document.pendingRooms.get('sound'), pendingBeforeScope, 'Checking scene resources does not activate or replace pending level records.');
  assert(!editor.document.transaction, 'Listing scene files does not open or commit a document transaction.');
  await assert.rejects(remove(editor, resource('model-one')), /en uso/);
  const environmentEditor = createEditor();
  environmentEditor.library.imports.push({id: 'ambient-one', importId: 'ambient-one', path: 'warehouse.wav', name: 'warehouse.wav', kind: 'audio', extension: 'wav', size: 1, dataUrl: 'data:audio/wav;base64,AA=='});
  environmentEditor.document.setStudio({environments: [Object.assign(behaviorSchema.studio.defaultEnvironment('sound'), {ambientSound: 'ambient-one'})]});
  const ambientResource = catalog.assetResource(environmentEditor.library.imports.at(-1));
  assert((await usage(environmentEditor, ambientResource)).some(value => value.id === 'environment:sound'), 'An ambient clip stays referenced even in another inactive room.');
  await assert.rejects(remove(environmentEditor, ambientResource), /en uso/);
  const unused = resource('unused-one');
  editor.document.setStudio({organization: {folders: [], resources: [{id: unused.id, name: 'Textura', folderId: 'images'}], favorites: [unused.id]}});
  const historyBefore = editor.document.undoStack.length;
  assert.equal((await usage(editor, unused)).length, 0);
  assert.equal(await remove(editor, unused), true); assert(!editor.library.imports.some(entry => entry.id === 'unused-one')); assert(!editor.document.studio.organization.favorites.length);
  assert.equal(editor.document.undoStack.length, historyBefore + 1, 'Removing import plus its metadata is one undoable action.');
  editor.document.undo(); assert(editor.library.imports.some(entry => entry.id === 'unused-one')); assert.deepEqual(editor.document.studio.organization.favorites, [unused.id]);
  editor.document.redo(); assert(!editor.library.imports.some(entry => entry.id === 'unused-one'));

  const dependencyEditor = createEditor();
  dependencyEditor.library.imports[0].extension = 'gltf'; dependencyEditor.library.imports[0].path = 'model.gltf'; dependencyEditor.library.imports[1].batchId = 'group-one';
  const dependent = catalog.assetResource(dependencyEditor.library.imports[1]);
  const dependencies = await usage(dependencyEditor, dependent); assert.match(dependencies[0].label, /Posible dependencia/); await assert.rejects(remove(dependencyEditor, dependent), /en uso/);
  dependencyEditor.objectClipboard = {record: {descriptor: {importId: 'texture-one'}}}; assert((await usage(dependencyEditor, dependent)).some(use => use.id === 'clipboard:object'));
  dependencyEditor.objectClipboard = null;
  dependencyEditor.behaviorClipboard = [{type: 'surfaceWear', layers: JSON.stringify([{asset: 'texture-one'}])}]; assert((await usage(dependencyEditor, dependent)).some(use => use.id === 'clipboard:behaviors'), 'Embedded JSON material/paint fields are checked.');

  const templateEditor = createEditor();
  const box = templateEditor.document.addPrimitive('hall', 'box');
  const template = {id: 'template-one', name: 'Caja de ejemplo', version: 1, objects: [templateEditor.document.captureObject(box)]};
  templateEditor.document.setStudio({templates: [template]});
  const templateResource = catalog.projectResources([template])[0]; assert.equal((await usage(templateEditor, templateResource)).length, 0);
  await remove(templateEditor, templateResource); assert.equal(templateEditor.document.studio.templates.length, 0); assert(templateEditor.document.getObject(box.userData.editorId), 'Removing a template leaves its independent scene instances intact.');
  templateEditor.document.undo(); assert.equal(templateEditor.document.studio.templates.length, 1);

  const racingEditor = createEditor(), serialize = racingEditor.document.serialize.bind(racingEditor.document);
  racingEditor.document.serialize = async () => { const data = await serialize(); racingEditor.projectGeneration++; return data; };
  await assert.rejects(remove(racingEditor, catalog.assetResource(racingEditor.library.imports[2])), /proyecto cambió/); assert.equal(racingEditor.library.imports.length, 3);
  editor.document.begin(); await assert.rejects(usage(editor, resource('model-one')), /operación actual/); editor.document.cancel();
  console.log('Resource operations: all-room references, nested material JSON, import dependencies, templates, undo/redo and stale-project deletion guards passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
