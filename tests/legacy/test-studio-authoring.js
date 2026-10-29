const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const behaviorSchema = require('../../modules/logistica-industrial/contracts/behaviors');
const studioSchema = require('../../packages/project-model/shared/studio-document');
const {validateDocument} = require('../../apps/api/server/validation');
function source(file) { return fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-studio-authoring.js"), '..', file)), 'utf8').replace(/^import .*$/gm, ''); }
const prefabDependencies = require('../support/load-robot-prefabs')(THREE);
const createIndustrialPrefab = new Function('THREE', 'behaviorSchema', 'require', source("modules/logistica-industrial/functions/presentacion/runtime/IndustrialPrefabs.js").replace(/export (const|function) /g, '$1 ') + '\nreturn createIndustrialPrefab;')(THREE, behaviorSchema, prefabDependencies.resolve);
const SceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', source("packages/project-model/src/SceneDocument.js").replace('export default class SceneDocument', 'return class SceneDocument'))(THREE, behaviorSchema, createIndustrialPrefab);
class Element {
  constructor() { this.children = []; this.listeners = {}; this.value = ''; }
  appendChild(child) { this.children.push(child); return child; }
  addEventListener(type, callback) { (this.listeners[type] || (this.listeners[type] = [])).push(callback); }
  dispatchEvent(event) { (this.listeners[event.type] || []).forEach(callback => callback(event)); }
  getBoundingClientRect() { return {left: 0, top: 0, width: 800, height: 600}; }
}
let nextPrompt = 'Línea de prueba';
const StudioTools = new Function('THREE', 'schema', 'window', 'document', source("modules/logistica-industrial/integrations/StudioTools.js").replace('export default class StudioTools', 'return class StudioTools'))(THREE, behaviorSchema, {prompt: () => nextPrompt}, {createElement: () => new Element()});

function harness() {
  const roots = {}, library = {exportImports: () => [], restoreImports() {}}, document = new SceneDocument({}, {assetLibrary: library});
  studioSchema.ROOM_IDS.forEach(id => { const root = new THREE.Group(); const native = new THREE.Mesh(new THREE.BoxBufferGeometry(1, 1, 1), new THREE.MeshBasicMaterial()); native.name = 'Original ' + id; root.add(native); roots[id] = root; document.registerRoom(id, root); });
  const editor = {
    ctx: {room: 0, renderer: {domElement: new Element()}}, document, active: true,
    transform: Object.assign(new THREE.EventDispatcher(), {dragging: false}), camera: new THREE.PerspectiveCamera(), orbit: {target: new THREE.Vector3(10, 0, 0)},
    select(object) { this.selected = object; }, toast() {}, renderAssets() {}, home() {},
    perform: async action => action(), roomSelect: {options: []},
    shell: {refresh() {}, openWorkspace() {}},
    hooks: {gotoRoom: async index => { editor.ctx.room = index; }},
    createPlacedObject(action) { const object = action(); editor.select(object); return object; }
  };
  Object.defineProperties(editor, {roomId: {get() { return studioSchema.ROOM_IDS[this.ctx.room]; }}, root: {get() { return roots[this.roomId]; }}});
  const tools = new StudioTools(editor);
  return {editor, tools, document};
}

async function run() {
  const {editor, tools, document} = harness();
  const legacy = await document.serialize(); assert(!Object.hasOwn(legacy, 'studio'));
  assert.equal(studioSchema.sceneEntries(document).length, 10, 'The level inventory does not depend on optional Studio labels.');
  assert.equal(studioSchema.sceneEntries(document)[1].name, 'Sala de sonido');
  assert.deepEqual(await document.serialize(), legacy, 'Reading level names does not mutate a legacy project.');
  assert(!Object.hasOwn(validateDocument(legacy, value => value), 'studio'), 'Legacy version 1 remains readable without Studio metadata.');
  document.setStudio({scenes: [{id: 'hall', name: 'Planta de pruebas'}], startRoomId: 'hall'});
  const snapshot = await document.serialize(); assert.equal(snapshot.version, 1); assert.equal(snapshot.studio.version, 1);
  const validated = validateDocument(snapshot, value => value); assert.deepEqual(validated.studio, snapshot.studio);
  document.undo(); assert.equal(document.studio, null); document.redo(); assert.deepEqual(document.studio, snapshot.studio);
  const beforeInvalid = JSON.stringify(document.studio), history = document.undoStack.length;
  assert.throws(() => document.setStudio({version: 90}), /incompatible/); assert.equal(JSON.stringify(document.studio), beforeInvalid); assert.equal(document.undoStack.length, history);
  assert.throws(() => studioSchema.normalize({version: 1, organization: {folders: [{id: 'a', name: 'A', parentId: 'b'}, {id: 'b', name: 'B', parentId: 'a'}]}}), /contenerse/);
  assert.throws(() => studioSchema.normalize({version: 1, widgets: [{id: 'bad', name: 'Bad', roomId: 'hall', kind: 'counter', maximum: -1}]}), /límites/);
  assert.throws(() => studioSchema.normalize({version: 1, scenes: [{id: 'hall', name: 'A'}, {id: 'hall', name: 'B'}]}), /repetidos/);
  const widget = {id: 'widget-one', name: 'W', roomId: 'hall', kind: 'counter'};
  assert.throws(() => studioSchema.normalize({version: 1, widgets: [widget, widget]}), /repetidos/);
  assert.throws(() => studioSchema.normalize({version: 1, organization: {folders: [{id: 'a', name: 'A', parentId: 'missing'}]}}), /no existe/);
  assert.throws(() => studioSchema.normalize({version: 1, organization: {resources: [{id: 'asset:a', name: 'A', folderId: 'missing'}]}}), /no existe/);
  assert.deepEqual(studioSchema.normalize({version: 1, organization: {resources: [{id: 'asset:a', name: 'A', folderId: 'models'}], favorites: ['asset:a', 'asset:a']}}).organization.favorites, ['asset:a']);

  const a = document.addPrefab('hall', 'conveyor', 'roller-middle'), b = document.addPrefab('hall', 'conveyor', 'roller-middle');
  document.setTransform(a, {position: [0, 0, 0]}); document.setTransform(b, {position: [4, 0, 0]});
  document.setBehaviors(a, document.getBehaviors(a).map(config => config.type === 'conveyor' ? Object.assign({}, config, {outputId: b.userData.editorId, outputPort: 'input'}) : config));
  editor.select(a); tools.selectObject(b, {shiftKey: true}); assert.equal(tools.objects().length, 2);
  tools.groupSelection(); assert.equal(document.studio.groups.length, 1); assert.equal(a.parent, editor.root); assert.equal(b.parent, editor.root);
  editor.selected = a; editor.transform.dragging = true; editor.transform.dispatchEvent({type: 'dragging-changed', value: true});
  a.position.x += 2; a.updateMatrixWorld(true); editor.transform.dispatchEvent({type: 'objectChange'});
  assert.equal(b.position.x, 6, 'Logical groups transform members without reparenting native simulation pivots.');
  editor.transform.dragging = false; editor.transform.dispatchEvent({type: 'dragging-changed', value: false});
  document.setStudio({widgets: [{id: 'bound-counter', name: 'Entradas', roomId: 'hall', kind: 'counter', objectId: a.userData.editorId, position: [2, 1.5, 2]}],
    missions: [{id: 'bound-mission', name: 'Clasificar', roomId: 'hall', steps: [{name: 'Clasificar correctamente', event: 'classification-confirmed', objectId: a.userData.editorId, target: 20}]}]});
  const template = await tools.saveTemplate(); assert.equal(template.objects.length, 2); assert.equal(document.studio.templates.length, 1);
  const size = document.additions.size, undoCount = document.undoStack.length;
  const copies = await tools.placeTemplate(template); assert.equal(copies.length, 2); assert.equal(document.additions.size, size + 2);
  assert.notEqual(copies[0].userData.editorId, a.userData.editorId);
  assert.equal(document.getBehaviors(copies[0]).find(config => config.type === 'conveyor').outputId, copies[1].userData.editorId, 'Inter-equipment references point to copied members.');
  assert.equal(copies[1].position.x - copies[0].position.x, b.position.x - a.position.x);
  const copiedWidget = document.studio.widgets.find(widget => widget.id !== 'bound-counter');
  assert.equal(copiedWidget.objectId, copies[0].userData.editorId); assert.deepEqual(copiedWidget.position, [10, 1.5, 2]);
  assert.equal(document.studio.missions.find(mission => mission.id !== 'bound-mission').steps[0].objectId, copies[0].userData.editorId);
  assert(document.studio.groups.some(group => group.members.includes(copies[0].userData.editorId) && group.members.includes(copies[1].userData.editorId)));
  assert.equal(document.undoStack.length, undoCount + 1); document.undo(); assert.equal(document.additions.size, size); document.redo(); assert.equal(document.additions.size, size + 2);
  const countBeforeFailure = document.additions.size, historyBeforeFailure = document.undoStack.length;
  const originalPerform = editor.perform;
  editor.perform = async action => { try { return await action(); } catch (_) { /* Production editor reports errors through toast. */ } };
  await assert.rejects(() => tools.placeTemplate({objects: [template.objects[0], {format: 'invalid'}]}), /compatible/);
  assert.equal(document.additions.size, countBeforeFailure, 'An invalid second template member rolls back the first copy.');
  assert.equal(document.undoStack.length, historyBeforeFailure); assert.equal(editor.pastingObject, false);
  editor.perform = originalPerform;
  const reopened = harness(); await reopened.document.load(await document.serialize(), {activeRoomId: 'hall'});
  assert.deepEqual(reopened.document.studio, document.studio); assert.equal(reopened.document.additions.size, document.additions.size);

  nextPrompt = 'Nueva sala'; await tools.newScene(); assert.equal(editor.roomId, 'sound'); assert(document.studio.scenes.some(scene => scene.id === 'hall'));
  const newEnvironment = document.studio.environments.find(item => item.roomId === 'sound');
  assert.equal(newEnvironment.sky, 'day', 'A new level persists its own daylight sky and illumination.');
  const floor = document.getObjects('sound').find(object => object.name === 'Suelo del nivel');
  assert(floor && floor.visible); assert.deepEqual(floor.scale.toArray(), [30, 30, 1]);
  assert.deepEqual(document.getBehaviors(floor).map(item => item.type).sort(), ['collision', 'teleport']);
  const newCamera = document.studio.entities.find(item => item.roomId === 'sound' && item.type === 'camera');
  assert(newCamera && document.getObject(newCamera.objectId).name === 'Cámara principal');
  const newSpawn = document.studio.spawns.find(item => item.roomId === 'sound');
  assert(newSpawn && document.getObject(newSpawn.objectId).name === 'Inicio del nivel');
  assert.deepEqual(validateDocument(await document.serialize(), value => value).studio.environments, document.studio.environments, 'Server validation preserves all per-level environment settings.');
  document.undo(); assert(!document.studio.environments || !document.studio.environments.some(item => item.roomId === 'sound'));
  document.redo(); assert.equal(document.studio.environments.find(item => item.roomId === 'sound').sky, 'day', 'Undo and redo restore the complete starting level atomically.');
  await tools.newScene(); assert.equal(editor.roomId, 'photogrammetry'); assert(document.studio.scenes.some(scene => scene.id === 'sound'));
  const currentId = editor.roomId, currentObjects = document.getObjects(currentId).length;
  nextPrompt = null; await tools.duplicateScene(); assert.equal(editor.roomId, currentId); assert.equal(document.getObjects(currentId).length, currentObjects, 'Cancelling a scene name must not create any copies.');
  const untouched = harness(); nextPrompt = 'Primera sala nueva'; await untouched.tools.newScene();
  assert(untouched.document.studio.scenes.some(scene => scene.id === 'hall'), 'The first creation must retain the previous scene in metadata.');
  await untouched.tools.newScene(); assert.equal(untouched.editor.roomId, 'photogrammetry', 'New scenes must not overwrite a previous authored scene.');
  const originalEnvironmentRoom = untouched.editor.roomId;
  untouched.document.setStudio({environments: untouched.document.studio.environments.map(item => item.roomId === originalEnvironmentRoom ? Object.assign({}, item, {skyColor: '#226688', sunIntensity: 0.7}) : item)});
  const historyBeforeScene = untouched.document.undoStack.length;
  const sourceCount = untouched.document.getObjects(untouched.editor.roomId).filter(object => object.parent === untouched.editor.root && object.visible).length;
  const sourcePositions = untouched.document.getObjects(untouched.editor.roomId).filter(object => object.parent === untouched.editor.root && object.visible).map(object => object.position.toArray());
  await untouched.tools.duplicateScene();
  assert.equal(untouched.document.getObjects(untouched.editor.roomId).filter(object => object.parent === untouched.editor.root && object.visible).length, sourceCount, 'Duplicating a scene does not add a second overlapping floor.');
  assert.equal(untouched.document.undoStack.length, historyBeforeScene + 1, 'Duplicate scene is one undo step.');
  assert.deepEqual(untouched.document.getObjects(untouched.editor.roomId).filter(object => object.parent === untouched.editor.root && object.visible).map(object => object.position.toArray()), sourcePositions, 'Scene duplicates preserve authored poses.');
  const duplicateEnvironment = untouched.document.studio.environments.find(item => item.roomId === untouched.editor.roomId);
  assert.equal(duplicateEnvironment.skyColor, '#226688'); assert.equal(duplicateEnvironment.sunIntensity, 0.7, 'Duplicated levels retain their source environment.');
  untouched.document.setStudio({environments: untouched.document.studio.environments.map(item => item.roomId === untouched.editor.roomId ? Object.assign({}, item, {skyColor: '#112233'}) : item)});
  assert.equal(untouched.document.studio.environments.find(item => item.roomId === originalEnvironmentRoom).skyColor, '#226688', 'Changing a duplicate does not change another level.');
  const spawn = await untouched.tools.addSpawn(); assert(untouched.document.studio.spawns.some(row => row.objectId === spawn.userData.editorId));
  assert.deepEqual(validateDocument(await untouched.document.serialize(), value => value).studio.spawns, untouched.document.studio.spawns);
  ['text', 'counter', 'indicator', 'progress', 'button'].forEach(kind => { untouched.tools.addWidget(kind); assert.equal(untouched.document.studio.widgets.at(-1).kind, kind); });
  const lightMarker = await untouched.tools.addLight(), cameraMarker = await untouched.tools.addCamera();
  assert(untouched.document.studio.entities.some(row => row.objectId === lightMarker.userData.editorId && row.type === 'pointLight'));
  assert(untouched.document.studio.entities.some(row => row.objectId === cameraMarker.userData.editorId && row.type === 'camera'));
  assert.deepEqual(validateDocument(await untouched.document.serialize(), value => value).studio.entities, untouched.document.studio.entities);
  const lightSnapshot = untouched.document.captureObject(lightMarker); assert.equal(lightSnapshot.studioEntity.type, 'pointLight');
  const lightsBeforeCopy = untouched.document.studio.entities.length;
  const copiedLight = await untouched.document.duplicate(lightMarker);
  const copiedEntity = untouched.document.studio.entities.find(entity => entity.objectId === copiedLight.userData.editorId);
  assert(copiedEntity && copiedEntity.type === 'pointLight'); assert.notEqual(copiedEntity.id, lightSnapshot.studioEntity.id);
  untouched.document.undo(); assert.equal(untouched.document.studio.entities.length, lightsBeforeCopy); untouched.document.redo();
  const currentRoom = untouched.editor.roomId;
  const visibleBeforeDuplicate = untouched.document.getObjects(currentRoom).filter(object => object.parent === untouched.editor.root && object.visible).length;
  const entityTypes = untouched.document.studio.entities.filter(entity => entity.roomId === currentRoom).map(entity => entity.type).sort();
  const widgetCount = untouched.document.studio.widgets.filter(widget => widget.roomId === currentRoom).length;
  await untouched.tools.duplicateScene();
  assert.equal(untouched.document.getObjects(untouched.editor.roomId).filter(object => object.parent === untouched.editor.root && object.visible).length, visibleBeforeDuplicate);
  assert.deepEqual(untouched.document.studio.entities.filter(entity => entity.roomId === untouched.editor.roomId).map(entity => entity.type).sort(), entityTypes);
  assert.equal(untouched.document.studio.widgets.filter(widget => widget.roomId === untouched.editor.roomId).length, widgetCount);
  assert(untouched.document.studio.spawns.some(spawn => spawn.roomId === untouched.editor.roomId && untouched.document.getObject(spawn.objectId)));
  const removeLight = untouched.document.studio.entities.find(entity => entity.roomId === untouched.editor.roomId && entity.type === 'pointLight');
  untouched.document.remove(untouched.document.getObject(removeLight.objectId)); assert(!untouched.document.studio.entities.some(entity => entity.id === removeLight.id));
  untouched.document.undo(); assert(untouched.document.studio.entities.some(entity => entity.id === removeLight.id));
  const legacyAuthored = harness(); legacyAuthored.document.addPrimitive('sound', 'box');
  await legacyAuthored.tools.newScene(); assert.equal(legacyAuthored.editor.roomId, 'photogrammetry', 'Existing legacy rooms remain occupied without Studio names.');
  const guarded = harness(), original = await guarded.document.serialize(); let finishName;
  guarded.editor.shell.requestSceneName = () => new Promise(resolve => { finishName = resolve; });
  const naming = guarded.tools.newScene();
  await assert.rejects(() => guarded.tools.newScene(), /Termina de crear/);
  assert.equal(guarded.editor.creatingScene, true);
  finishName(null); await naming;
  assert.equal(guarded.editor.creatingScene, false); assert.equal(guarded.editor.roomId, 'hall');
  assert.deepEqual(await guarded.document.serialize(), original, 'Cancelling the form leaves every existing level intact.');
  const staleName = guarded.tools.newScene(); guarded.editor.projectGeneration = 1; finishName('No debe crearse');
  await assert.rejects(() => staleName, /proyecto o el nivel cambió/);
  assert.deepEqual(await guarded.document.serialize(), original); assert.equal(guarded.editor.creatingScene, false);
  guarded.editor.busy = true; await assert.rejects(() => guarded.tools.newScene(), /operación actual/); guarded.editor.busy = false;
  guarded.editor.shell.requestSceneName = async () => 'No se activó'; guarded.editor.hooks.gotoRoom = async () => false;
  await assert.rejects(() => guarded.tools.newScene(), /No se pudo activar/);
  assert.deepEqual(await guarded.document.serialize(), original, 'A failed room transition cannot erase or replace an authored level.');
  const deferred = harness(); deferred.document.pendingRooms.set('sound', {additions: [{id: 'custom-deferred'}], nativeVisuals: []});
  assert(studioSchema.hasSceneContent(deferred.document, 'sound'), 'Unloaded authored levels remain reserved.');
  console.log('Studio authoring: legacy and server compatibility, metadata undo/redo, validated forms, logical groups, template reference remapping, atomic undo, persistence and independent scenes passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
