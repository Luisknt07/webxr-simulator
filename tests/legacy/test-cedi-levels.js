const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const schema = require('../../modules/logistica-industrial/contracts/behaviors'), {validateDocument} = require('../../apps/api/server/validation');
const authors = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-cedi-levels.js"), 'test-studio-authoring.js')), 'utf8');
const authoring = new Function('require', '__dirname', authors.slice(0, authors.indexOf('\nasync function run()')) + '\nreturn {harness,Element};')(require, __dirname);
const lines = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-cedi-levels.js"), 'test-industrial-lab-lines.js')), 'utf8');
const {harness, releaseGeometry} = new Function('require', '__dirname', lines.slice(0, lines.indexOf('\nasync function run()')) + '\nreturn {harness,releaseGeometry};')(require, __dirname);
const builders = require('../support/load-industrial-cedi')(THREE, schema);
const rounded = value => JSON.parse(JSON.stringify(value, (key, item) => typeof item === 'number' ? Number(item.toFixed(9)) : item));
const equal = (actual, expected, message) => assert.deepEqual(rounded(actual), rounded(expected), message);
const id = object => object.userData.editorId;
const scoped = (saved, roomId) => ({room: saved.rooms[roomId], studio: Object.fromEntries(['scenes', 'environments', 'entities', 'spawns', 'groups', 'widgets', 'missions'].map(key =>
  [key, (saved.studio && saved.studio[key] || []).filter(value => value.roomId === roomId || key === 'scenes' && value.id === roomId)]))});

function fixture() {
  const f = authoring.harness(), scene = new THREE.Scene(); f.document.rooms.forEach(room => scene.add(room.root));
  const Tools = builders.loadStudioTools({prompt: () => 'Unused'}, {createElement: () => new authoring.Element()}); f.tools = new Tools(f.editor);
  f.editor.hooks.renderScene = scene; f.scene = scene; f.runtime = {stop() {}};
  f.editor.hooks.gotoRoom = async index => { f.editor.ctx.room = index; f.document.rooms.forEach((room, roomId) => { room.root.visible = roomId === f.editor.roomId; }); };
  return f;
}

async function authoringTransactions() {
  const f = fixture(), custom = f.document.addPrefab('hall', 'conveyor', 'belt');
  f.document.setProperty(custom, 'name', 'Equipo original personalizado'); f.document.setTransform(custom, {position: [-4, 1, 2], rotation: [0, .3, 0]});
  f.document.setStudio({scenes: [{id: 'hall', name: 'Mi escenario'}, {id: 'sound', name: 'Laboratorio industrial existente'}], startRoomId: 'hall'});
  builders.buildIndustrialLab(f.document, 'sound', {scene: f.scene}); f.document.setStudio({startRoomId: 'hall'});
  const before = await f.document.serialize(), history = f.document.undoStack.length;
  const original = scoped(before, 'hall'), lab = scoped(before, 'sound');
  const result = await f.tools.createCediExamples();
  assert.equal(result.scenarios.length, 2); assert.deepEqual(result.scenarios.map(value => value.kind), ['sorting', 'packing']);
  assert.deepEqual(result.scenarios.map(value => value.expectedUnits), [0, 0]);
  assert(result.scenarios.every(value => value.continuous === true), 'New authored CEDI levels start in continuous mode; finite fixtures remain opt-in builder tests.');
  assert(result.scenarios.every(value => !['hall', 'sound'].includes(value.roomId) && value.sourceIds.length >= 5 && value.receiverIds.length >= 8 && value.controllerIds.length >= 4));
  assert.equal(new Set(result.scenarios.map(value => value.roomId)).size, 2);
  assert.equal(f.document.undoStack.length, history + 1, 'Creating both complete CEDI levels is one reversible operation.');
  const created = validateDocument(await f.document.serialize(), value => value);
  equal(scoped(created, 'hall'), original, 'Original Hall geometry, controls, metadata and per-part settings remain exact.');
  equal(scoped(created, 'sound'), lab, 'The complete existing Lab level, its nine networks and metadata remain exact.');
  assert.equal(created.studio.startRoomId, 'hall');
  result.scenarios.forEach(value => {
    const entities = created.studio.entities.filter(entity => entity.roomId === value.roomId);
    assert.equal(entities.filter(entity => entity.type === 'camera').length, 1); assert(entities.filter(entity => entity.type === 'pointLight').length <= 8);
    assert(created.studio.scenes.some(scene => scene.id === value.roomId && scene.name === value.title));
    assert(created.studio.environments.some(environment => environment.roomId === value.roomId && environment.sky === 'color'));
  });
  const repeatHistory = f.document.undoStack.length, repeated = await f.tools.createCediExamples();
  assert(repeated.scenarios.every(value => value.existing)); equal(await f.document.serialize(), created, 'Repeating the command reuses the named scenarios without duplicating rooms, lights, networks or groups.');
  assert.equal(f.document.undoStack.length, repeatHistory);
  f.document.undo(); equal(await f.document.serialize(), before); f.document.redo(); equal(await f.document.serialize(), created);
  const reopened = fixture(); await reopened.document.load(created); equal(await reopened.document.serialize(), created, 'Both generated levels survive complete server validation and reopen.');
  releaseGeometry(f); releaseGeometry(reopened);

  const failed = fixture(); failed.document.setStudio({scenes: [{id: 'hall', name: 'Original'}, {id: 'sound', name: 'Lab protegido'}]});
  const previous = await failed.document.serialize(), previousRoom = failed.editor.roomId, count = failed.document.undoStack.length;
  const populate = failed.tools.populateCediScenario.bind(failed.tools);
  failed.tools.populateCediScenario = (roomId, kind) => { if (kind === 'packing') throw new Error('Second network failed'); return populate(roomId, kind); };
  await assert.rejects(() => failed.tools.createCediExamples(), /Second network failed/);
  equal(await failed.document.serialize(), previous, 'Failure in the second network rolls back both new rooms, their architecture, wear and Studio metadata.');
  assert.equal(failed.document.undoStack.length, count); assert.equal(failed.editor.roomId, previousRoom); releaseGeometry(failed);

  const full = fixture(); full.document.setStudio({scenes: schema.studio.ROOM_IDS.map((roomId, index) => ({id: roomId, name: 'Occupied ' + index}))});
  const fullBefore = await full.document.serialize(), fullHistory = full.document.undoStack.length;
  await assert.rejects(() => full.tools.createCediExamples(), /niveles libres/); equal(await full.document.serialize(), fullBefore); assert.equal(full.document.undoStack.length, fullHistory); releaseGeometry(full);
  console.log('CEDI authoring: two independent new levels, preserved Hall/Lab records+Studio metadata, one undo, idempotence, server reopen, second-level rollback and capacity preflight passed.');
}

const editorCode = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-cedi-levels.js"), '../src/editor/SceneEditor.js')), 'utf8');
const home = editorCode.slice(editorCode.indexOf('  home() {'), editorCode.indexOf('  focus() {'));
const stopOrbit = editorCode.slice(editorCode.indexOf('  stopOrbitMotion() {'), editorCode.indexOf('  updateSmoothZoom('));
const constrain = editorCode.slice(editorCode.indexOf('  constrainEditorCamera('), editorCode.indexOf('  setTool('));
const CameraHome = new Function('THREE', 'visibleInTree', 'return class CameraHome {' + home + stopOrbit + constrain + '}')(THREE, object => { for (let node = object; node; node = node.parent) if (!node.visible) return false; return true; });

async function physical(kind) {
  const f = harness.setup(); f.document.getObjects('hall').filter(object => f.document.isNative(object)).forEach(object => f.document.setProperty(object, 'visible', false));
  const spawn = f.document.addPrimitive('hall', 'cylinder'), camera = f.document.addPrimitive('hall', 'box');
  f.document.setTransform(spawn, {scale: [.45, .03, .45]}); f.document.setTransform(camera, {scale: [.2, .14, .28]});
  for (const object of [spawn, camera]) f.document.setBehaviors(object, [Object.assign(schema.defaultBehavior('collision'), {enabled: false})]);
  f.document.setStudio({spawns: [{roomId: 'hall', objectId: id(spawn)}], entities: [{id: 'authored-camera', roomId: 'hall', objectId: id(camera), type: 'camera', fov: 55}]});
  const level = builders.buildIndustrialCediLevel(f.document, 'hall', {kind, scene: f.scene});
  assert.equal(level.environment.bounds.height, 8); assert.equal(level.environment.roof.position.y, 8); assert(level.environment.lights.length >= 4 && level.environment.lights.length <= 8);
  assert(level.finishes.wearLayers > 0 && level.finishes.assignments > 0); assert.equal(level.monitors.length, level.lines.length);
  assert.equal(level.platforms.length, 1); const platform = level.platforms[0];
  assert(platform.steps.length >= 6 && platform.feet.length === 4, 'The upper pallet stock has a real deck, supports and a stair to the floor.');
  const deckTop = new THREE.Box3().setFromObject(platform.deck).max.y;
  assert(Math.abs(deckTop - platform.floorY) < 1e-6);
  assert(platform.steps.every(step => f.document.getBehaviors(step).some(value => value.type === 'collision' && value.enabled)), 'Every stair is physically collidable.');
  assert.equal(level.processSigns.length, level.lines.length, 'Each automatic or manual network has its own explanatory sign.');
  assert(level.objects.some(object => f.document.getBehaviors(object).some(config => config.type === 'surfaceWear')));
  f.scene.updateMatrixWorld(true); f.ctx.collisionWorld.setRoom('hall');
  assert(f.ctx.collisionWorld.canOccupyCapsule(spawn.position.clone().add(new THREE.Vector3(0, 1.6, 0))), 'The persisted entrance is physically accessible inside the warehouse.');
  assert(camera.position.y > 1.6 && camera.position.y < 7, 'The authored inspection view starts safely below the roof.');
  const view = Object.assign(new CameraHome(), {document: f.document, roomId: 'hall', camera: new THREE.PerspectiveCamera(), collisionWorld: f.ctx.collisionWorld,
    orbit: {target: new THREE.Vector3(), update() {}}, safeCameraPosition: new THREE.Vector3(80, 15, 80), safeOrbitTarget: new THREE.Vector3(80, 0, 80)});
  view.home(); assert(view.camera.position.distanceTo(camera.position) < 1e-5, 'Home selects the authored interior camera directly rather than sweeping from the old level through the roof or wall.');
  const before = await f.document.serialize(); f.runtime.start('hall');
  const outputs = () => level.receivers.map(object => f.runtime.records.get(id(object)).variables);
  for (let index = 0; index < 6000 && outputs().reduce((sum, state) => sum + state.receivedUnits, 0) < level.expectedUnits; index++) {
    f.ctx.collisionWorld.beginFrame(); try { f.scene.updateMatrixWorld(true); f.runtime.execute(.1); } finally { f.ctx.collisionWorld.endFrame(); }
  }
  assert.equal(outputs().reduce((sum, state) => sum + state.receivedUnits, 0), level.expectedUnits,
    'Actual walls, roof, warehouse columns, finishing geometry and supervisory monitor must leave every production corridor open.');
  assert.deepEqual(outputs().map(state => state.receivedUnits), level.expectedReceiverUnits); assert.equal(f.notices.length, 0);
  const elapsed = f.runtime.time; f.runtime.stop(); equal(await f.document.serialize(), before);
  console.log('Full CEDI level:', kind, '— real closed warehouse, authored camera/spawn, wear/monitor and all', level.expectedUnits, 'units delivered in', elapsed.toFixed(1), 's.'); releaseGeometry(f);
}

async function run() { await authoringTransactions(); for (const kind of process.argv.slice(2).length ? process.argv.slice(2) : ['sorting', 'packing']) await physical(kind); }
run().catch(error => { console.error(error); process.exitCode = 1; });
