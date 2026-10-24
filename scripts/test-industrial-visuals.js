// Real Three.js prefabs and document serialization; only the canvas/GPU boundary
// is adapted. This is not a browser performance or physical headset test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const behaviorSchema = require('../shared/behaviors.js');

const canvases = [];
const dom = {
  createElement(tag) {
    assert.equal(tag, 'canvas');
    const canvas = {width: 0, height: 0, text: [], paints: 0};
    const context = {
      fillRect(x, y, w, h) { if (x === 0 && y === 0 && w === canvas.width && h === canvas.height) { canvas.text = []; canvas.paints++; } },
      fillText(value) { canvas.text.push(String(value)); }, measureText(value) { return {width: String(value).length * 12}; }
    };
    canvas.getContext = () => context; canvases.push(canvas); return canvas;
  }
};
function source(file) { return fs.readFileSync(path.join(__dirname, '../src/editor', file), 'utf8').replace(/^import .*;\r?\n/gm, ''); }
const createIndustrialPrefab = new Function('THREE', 'behaviorSchema', 'document', source('IndustrialPrefabs.js')
  .replace(/^export const /gm, 'const ')
  .replace(/^export function /gm, 'function ') + '\nreturn createIndustrialPrefab;')(THREE, behaviorSchema, dom);
const SceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', source('SceneDocument.js').replace('export default class SceneDocument', 'return class SceneDocument'))(THREE, behaviorSchema, createIndustrialPrefab);
const IndustrialVisuals = new Function('THREE', source('IndustrialVisuals.js').replace('export default class IndustrialVisuals', 'return class IndustrialVisuals'))(THREE);

function setup() {
  const document = new SceneDocument({});
  const root = new THREE.Group(); document.registerRoom('hall', root); document.registerRoom('empty', new THREE.Group());
  const belt = document.addPrefab('hall', 'conveyor');
  const sensorRecords = document.getObjects('hall').filter(object => document.getBehaviors(object).some(config => config.type === 'sensor'));
  const beltVariables = {powered: true, paused: false, running: true, enabled: true, speed: 0.4, actualSpeed: 0.4, emergency: false, entryCount: 17, exitCount: 12, inFlight: 5, runSeconds: 60, autoSpawn: false, externalSupply: false, internalSupplyActive: false, supplyMode: 'manual', palletCount: 0, palletCapacity: 0, palletFull: false};
  const records = new Map([[belt.userData.editorId, {variables: beltVariables}]]);
  sensorRecords.forEach((object, index) => records.set(object.userData.editorId, {variables: {enabled: true, occupied: index === 0, active: false, count: index === 0 ? 17 : 12}}));
  let snapshotCalls = 0;
  const simulation = {running: true, records, getSnapshot() { snapshotCalls++; throw new Error('Hot frames must read existing records, not copy every event into snapshots.'); }};
  const ctx = {document: dom, renderer: {capabilities: {getMaxAnisotropy: () => 16}}};
  const visuals = new IndustrialVisuals(ctx, document, simulation);
  root.updateMatrixWorld(true);
  return {document, root, belt, sensorRecords, beltVariables, records, simulation, ctx, visuals, snapshotCalls: () => snapshotCalls};
}
function screen(visuals) { return Array.from(visuals.displays.values())[0]; }
function roller(visuals) { return Array.from(visuals.rollers.values())[0]; }
function text(visuals) { return screen(visuals).canvas.text.join('\n'); }
function close(a, b, message) { assert(Math.abs(a - b) < 0.000001, message || `${a} differs from ${b}`); }

async function run() {
  const fixture = setup();
  const {document, root, belt, sensorRecords, beltVariables, records, visuals} = fixture;
  const before = await document.serialize();
  const originalMaterials = new Map(); const originalQuaternions = new Map();
  root.traverse(object => { if (object.material) originalMaterials.set(object, object.material); originalQuaternions.set(object, object.quaternion.toArray()); });
  let scans = 0; const originalTraverse = root.traverse;
  root.traverse = function(callback) { scans++; return originalTraverse.call(this, callback); };
  visuals.sync('hall', 0, false);
  assert.equal(visuals.displays.size, 1, 'The physical PLC screen receives a live dashboard.');
  assert.equal(visuals.rollers.size, 26);
  assert.match(text(visuals), /EN MARCHA/);
  assert.match(text(visuals), /0\.40/);
  assert.match(text(visuals), /24\.0 m\/min/);
  assert.match(text(visuals), /17/);
  assert.match(text(visuals), /12/);
  assert.match(text(visuals), /00:01:00/);
  assert.match(text(visuals), /12\.0 uds\/min/);
  assert.match(text(visuals), /ALIMENTACIÓN/);
  assert.match(text(visuals), /MANUAL/);
  assert(!text(visuals).includes('3/48'), 'Conveyor dashboards no longer advertise an attached receiving pallet.');
  assert(screen(visuals).canvas.text.some(value => value.includes(visuals.byId.get(belt.userData.editorId).shortId)), 'The screen identifies its actual machine.');
  assert.match(text(visuals), /ENTRADA: DETECTANDO/);
  assert.match(text(visuals), /SALIDA: LIBRE/);
  assert.equal(screen(visuals).texture.anisotropy, 4);
  const displayOriginal = originalMaterials.get(screen(visuals).object);
  if (Array.isArray(screen(visuals).object.material)) {
    assert.equal(screen(visuals).object.material[4], screen(visuals).material);
    assert.equal(screen(visuals).object.material[0], displayOriginal, 'The screen map must only cover the front face of a box.');
  }
  assert.deepEqual(await document.serialize(), before, 'Dashboard and feedback must not become authored changes.');
  const inputLamp = visuals.bindings.find(binding => binding.kind === 'sensor' && binding.sensor.object === sensorRecords[0]);
  const outputLamp = visuals.bindings.find(binding => binding.kind === 'sensor' && binding.sensor.object === sensorRecords[1]);
  assert.equal(inputLamp.entry.privateMaterials[0].color.getHexString(), '42e4a4');
  assert.equal(outputLamp.entry.privateMaterials[0].color.getHexString(), 'ff6575', 'An NC active bit must not turn an unoccupied sensor green.');
  const startButton = visuals.bindings.find(binding => binding.kind === 'button' && binding.action === 'start');
  assert(startButton.entry.privateMaterials[0].emissiveIntensity > 0.5, 'Running state must light the physical Start button.');
  const tower = visuals.bindings.find(binding => binding.kind === 'tower' && binding.tower === 'running');
  if (tower) assert(tower.entry.privateMaterials[0].emissiveIntensity > 0.5);
  records.get(sensorRecords[0].userData.editorId).variables.occupied = false;
  records.get(sensorRecords[0].userData.editorId).variables.active = true;
  visuals.sync('hall', 1 / 60, false);
  assert.equal(inputLamp.entry.privateMaterials[0].color.getHexString(), 'ff6575');
  const r = roller(visuals); const initialOffset = r.surfaces[0].texture.offset.x;
  visuals.sync('hall', 0.1, false);
  assert(r.surfaces[0].texture.offset.x > initialOffset, 'Forward conveyor motion must move the visible cylinder surface toward +X.');
  const traveled = r.surfaces[0].texture.offset.x - initialOffset;
  close(traveled, 0.4 * 0.1 / (0.065 * Math.PI * 2));
  originalQuaternions.forEach((quaternion, object) => assert.deepEqual(object.quaternion.toArray(), quaternion, 'Roller motion must leave collision transforms completely static.'));
  assert.equal(r.surfaces[0].texture, Array.from(visuals.rollers.values())[1].surfaces[0].texture, 'A belt shares a single moving surface texture.');
  assert.notEqual(r.surfaces[0].texture, r.original.map, 'The moving surface must not change the source texture.');
  visuals.sync('hall', 0.2, false);
  const hmi = screen(visuals); const paints = hmi.canvas.paints; const textureVersion = hmi.texture.version; const scanCount = scans;
  for (let i = 0; i < 120; i++) visuals.sync('hall', 1 / 60, false);
  assert.equal(hmi.canvas.paints, paints, 'Stable values must not repaint/reupload the HMI texture.');
  assert.equal(hmi.texture.version, textureVersion);
  assert.equal(scans, scanCount, 'Stable frames must not traverse imported scene graphs.');
  assert.equal(fixture.snapshotCalls(), 0);
  beltVariables.paused = true; beltVariables.actualSpeed = 0;
  const pausedOffset = r.surfaces[0].texture.offset.x;
  visuals.sync('hall', 0.25, false);
  close(r.surfaces[0].texture.offset.x, pausedOffset);
  assert.match(text(visuals), /EN PAUSA/);
  assert(startButton.entry.privateMaterials[0].emissiveIntensity < 0.5);
  beltVariables.paused = false; beltVariables.emergency = true; beltVariables.running = false;
  visuals.sync('hall', 0.25, false);
  close(r.surfaces[0].texture.offset.x, pausedOffset);
  assert.match(text(visuals), /EMERGENCIA/);
  const emergencyTower = visuals.bindings.find(binding => binding.kind === 'tower' && binding.tower === 'fault');
  if (emergencyTower) assert(emergencyTower.entry.privateMaterials[0].emissiveIntensity > 0.5);
  beltVariables.powered = false;
  visuals.sync('hall', 0.25, false);
  assert.match(text(visuals), /APAGADA/);
  assert.equal(inputLamp.entry.privateMaterials[0].emissiveIntensity, 0);
  beltVariables.powered = true; beltVariables.emergency = false; beltVariables.running = true; beltVariables.actualSpeed = -0.4;
  visuals.sync('hall', 0.1, false);
  assert(r.surfaces[0].texture.offset.x < pausedOffset, 'Reverse movement must reverse the roller surface.');
  beltVariables.entryCount = 18;
  const previousPaints = hmi.canvas.paints;
  visuals.sync('hall', 0.01, false);
  assert.equal(hmi.canvas.paints, previousPaints, 'A value change must respect the HMI upload interval.');
  visuals.sync('hall', 0.2, false);
  assert.match(text(visuals), /18/);
  assert.equal(hmi.canvas.paints, previousPaints + 1);
  // Uniform scaling must preserve the surface speed in world metres.
  belt.scale.setScalar(2); root.updateMatrixWorld(true);
  const scaledOffset = r.surfaces[0].texture.offset.x;
  visuals.sync('hall', 0.1, false);
  close(scaledOffset - r.surfaces[0].texture.offset.x, 0.4 * 0.1 / (0.13 * Math.PI * 2));
  belt.scale.setScalar(1); root.updateMatrixWorld(true);
  visuals.invalidate(); visuals.sync('hall', 0, true);
  assert.match(text(visuals), /VISTA PREVIA/);
  assert.match(text(visuals), /APAGADA/);
  assert(!screen(visuals).canvas.text.includes('18'), 'Preview must not invent runtime production counts.');
  assert.match(text(visuals), /Tiempo activo 00:00:00/);
  const previewOffset = r.surfaces[0].texture.offset.x;
  visuals.sync('hall', 0.1, true);
  close(r.surfaces[0].texture.offset.x, previewOffset);
  assert.deepEqual(await document.serialize(), before);
  // The same resource is released once, and original materials/maps remain live.
  let materialDisposals = 0, textureDisposals = 0, originalDisposals = 0;
  hmi.material.addEventListener('dispose', () => materialDisposals++);
  hmi.texture.addEventListener('dispose', () => textureDisposals++);
  materialsOfOriginals(originalMaterials).forEach(material => material.addEventListener('dispose', () => originalDisposals++));
  visuals.dispose(); visuals.dispose();
  assert.equal(materialDisposals, 1); assert.equal(textureDisposals, 1); assert.equal(originalDisposals, 0);
  originalMaterials.forEach((material, object) => assert.equal(object.material, material));
  assert.deepEqual(await document.serialize(), before);
  visuals.sync('hall', 0, true);
  assert.equal(visuals.displays.size, 1, 'Dispose is reusable across preview/runtime transitions.');
  visuals.sync('empty', 0.2, false);
  assert.equal(visuals.displays.size, 0);
  originalMaterials.forEach((material, object) => assert.equal(object.material, material, 'Inactive room visuals must release private resources.'));
  visuals.dispose();

  // Recoloring operates on authored materials after the visual boundary has
  // been restored; reentering preview must retain that choice and history.
  document.setProperty(belt, 'color', '#b3c5d7');
  const recolored = await document.serialize();
  visuals.sync('hall', 0, true); visuals.dispose();
  assert.deepEqual(await document.serialize(), recolored);

  // Separate copies retain references to their own sensors and machine state.
  const independent = setup();
  const copy = await independent.document.duplicate(independent.belt);
  independent.root.updateMatrixWorld(true);
  independent.records.set(copy.userData.editorId, {variables: Object.assign({}, independent.beltVariables, {actualSpeed: -0.8, speed: -0.8, entryCount: 42})});
  independent.visuals.sync('hall', 0.1, false);
  const screens = Array.from(independent.visuals.displays.values());
  assert.equal(screens.length, 2);
  assert.equal(screens[0].conveyor.id, independent.belt.userData.editorId);
  assert.equal(screens[1].conveyor.id, copy.userData.editorId);
  assert.notEqual(screens[0].texture, screens[1].texture);
  assert.notEqual(screens[0].conveyor.shortId, screens[1].conveyor.shortId, 'Each machine has a distinct visible identity, including duplicates.');
  assert(screens[0].canvas.text.some(value => value.includes(screens[0].conveyor.shortId)));
  assert(screens[1].canvas.text.some(value => value.includes(screens[1].conveyor.shortId)));
  assert.match(screens[1].canvas.text.join('\n'), /42/);
  const sourceRoller = Array.from(independent.visuals.rollers.values()).find(entry => entry.conveyor.id === independent.belt.userData.editorId);
  const copyRoller = Array.from(independent.visuals.rollers.values()).find(entry => entry.conveyor.id === copy.userData.editorId);
  assert.notEqual(sourceRoller.surfaces[0].texture, copyRoller.surfaces[0].texture);
  assert(sourceRoller.surfaces[0].texture.offset.x > 0); assert(copyRoller.surfaces[0].texture.offset.x < 0);
  let inView = false;
  independent.ctx.performanceVisibility = {isVisible: () => inView};
  const untouchedVersion = screens[0].texture.version;
  independent.beltVariables.entryCount++;
  independent.visuals.sync('hall', 0.25, false);
  assert.equal(screens[0].texture.version, untouchedVersion, 'An offscreen HMI must not upload changed values until visible.');
  inView = true;
  independent.visuals.sync('hall', 0.25, false);
  assert(screens[0].texture.version > untouchedVersion);
  independent.visuals.dispose();

  await testExplicitMachineBindings();
  await testPushbuttonMotion();
  testPanelScopes();
  testBeltSurfaceMotion();
  testModularBeltPrefabs();

  // A headless environment keeps simulation usable when no 2D canvas exists.
  const headless = setup(); delete headless.ctx.document;
  assert.doesNotThrow(() => headless.visuals.sync('hall', 0.1, false));
  assert.equal(headless.visuals.displays.size, 0);
  headless.visuals.dispose();
  console.log('Industrial visuals: physical HMI, independent scoped telemetry, sensor occupancy, roller/belt surfaces, held/pulsed pushbuttons with hover and spring return, authoring poses and resource restoration passed.');
}

async function testPushbuttonMotion() {
  const {document, root, belt, simulation, ctx, visuals} = setup();
  const feedbacks = new Map();
  const idle = {pressed: false, sequence: 0, hovered: false};
  simulation.getControlFeedback = id => feedbacks.get(id) || idle;
  visuals.sync('hall', 0, false);
  const button = action => visuals.bindings.find(binding => binding.kind === 'button' && binding.action === action);
  const start = button('start'), emergency = button('emergency'), stop = button('stop');
  const cap = start.entry.object, emergencyCap = emergency.entry.object;
  const rest = cap.position.clone(), emergencyRest = emergencyCap.position.clone(), otherRest = stop.entry.object.position.clone();
  const groupPosition = start.owner.object.position.clone(), capQuaternion = cap.quaternion.clone(), positions = cap.geometry.attributes.position.array;
  const authored = await document.serialize();
  const startFeedback = {pressed: false, sequence: 0, hovered: true};
  feedbacks.set(start.owner.id, startFeedback);
  const color = start.entry.privateMaterials[0].color.getHex();
  const normalLight = start.entry.privateMaterials[0].emissiveIntensity;
  visuals.sync('hall', 1 / 60, false);
  assert(cap.position.equals(rest), 'Hover must not physically press the cap.');
  assert(start.entry.privateMaterials[0].emissiveIntensity > normalLight, 'Hover supplies a small targeting cue.');
  assert.equal(start.entry.privateMaterials[0].color.getHex(), color, 'Hover must preserve the functional button color.');
  startFeedback.pressed = true; startFeedback.sequence++;
  visuals.sync('hall', 1 / 60, false);
  assert(cap.position.z < rest.z && cap.position.z > rest.z - 0.012, 'A held trigger begins a smooth 12 mm inward stroke.');
  assert.equal(cap.position.x, rest.x); assert.equal(cap.position.y, rest.y);
  for (let i = 0; i < 20; i++) visuals.sync('hall', 1 / 60, false);
  close(cap.position.z, rest.z - 0.012);
  assert(stop.entry.object.position.equals(otherRest), 'Pressing Start must not animate another control.');
  assert(start.owner.object.position.equals(groupPosition), 'Only the cap moves; the control root and ray target stay in place.');
  assert(cap.quaternion.equals(capQuaternion)); assert.equal(cap.geometry.attributes.position.array, positions, 'Press feedback never deforms collision geometry.');
  assert.deepEqual(await document.serialize(), authored, 'A held physical button must not enter the authored document/history.');
  feedbacks.set(emergency.owner.id, {pressed: true, sequence: 1, hovered: false});
  for (let i = 0; i < 20; i++) visuals.sync('hall', 1 / 60, false);
  close(emergencyCap.position.z, emergencyRest.z - 0.012, 'Mushroom buttons use the same safe stroke without passing through the door.');
  startFeedback.pressed = false; startFeedback.hovered = false;
  const held = cap.position.z;
  visuals.sync('hall', 1 / 60, false);
  assert(cap.position.z > held && cap.position.z < rest.z, 'Releasing a trigger starts a spring return rather than snapping.');
  for (let i = 0; i < 30; i++) visuals.sync('hall', 1 / 60, false);
  assert(cap.position.equals(rest), 'The spring eventually returns to the exact authored resting pose.');
  close(start.entry.privateMaterials[0].emissiveIntensity, normalLight);
  // A click whose down/up events occur between render frames still has a
  // sequence change even when the currently held bit is already false.
  startFeedback.sequence++;
  visuals.sync('hall', 1 / 60, false);
  assert(cap.position.z < rest.z, 'A quick click must remain visible even when no rendered frame sees the trigger held.');
  for (let i = 0; i < 40; i++) visuals.sync('hall', 1 / 60, false);
  assert(cap.position.equals(rest));
  // Camera culling cannot strand a cap in its pressed pose.
  ctx.performanceVisibility = {isVisible: () => false};
  startFeedback.pressed = true; startFeedback.sequence++;
  visuals.sync('hall', 0.1, false);
  assert(cap.position.z < rest.z);
  startFeedback.pressed = false;
  for (let i = 0; i < 30; i++) visuals.sync('hall', 1 / 60, false);
  assert(cap.position.equals(rest), 'Offscreen buttons continue their release animation.');
  startFeedback.pressed = true;
  visuals.sync('hall', 0.1, false);
  visuals.sync('hall', 0, true);
  assert(cap.position.equals(rest) && emergencyCap.position.equals(emergencyRest), 'Editor preview instantly restores every authored cap pose.');
  visuals.sync('hall', 0.1, false);
  assert(cap.position.z < rest.z);
  visuals.dispose(); visuals.dispose();
  assert(cap.position.equals(rest) && emergencyCap.position.equals(emergencyRest), 'Leaving a room/stopping runtime restores exact poses, including held emergency controls.');
  assert.equal(visuals.buttons.size, 0);
  assert.deepEqual(await document.serialize(), authored);
  startFeedback.pressed = false; feedbacks.get(emergency.owner.id).pressed = false;
  visuals.sync('hall', 0.1, false);
  assert(cap.position.equals(rest), 'Recreating a visual must not replay an old completed sequence.');
  visuals.dispose();

  const copy = await document.duplicate(belt);
  root.updateMatrixWorld(true); visuals.sync('hall', 0, false);
  const copied = visuals.bindings.find(binding => binding.kind === 'button' && binding.action === 'start' && binding.conveyor && binding.conveyor.id === copy.userData.editorId);
  const copiedRest = copied.entry.object.position.clone();
  feedbacks.set(copied.owner.id, {pressed: true, sequence: 1, hovered: false});
  visuals.sync('hall', 0.1, false);
  assert(copied.entry.object.position.z < copiedRest.z);
  assert(cap.position.equals(rest), 'Duplicated controls use their own feedback identity and spring pose.');
  visuals.dispose();
  assert(copied.entry.object.position.equals(copiedRest));
}

function testModularBeltPrefabs() {
  const {document, root, records, beltVariables, visuals} = setup();
  const modules = ['belt-start', 'belt-middle', 'belt-curve-left', 'belt-tee-split'].map(variant => {
    const object = document.addPrefab('hall', 'conveyor', variant);
    records.set(object.userData.editorId, {variables: Object.assign({}, beltVariables)});
    return object;
  });
  root.updateMatrixWorld(true); visuals.sync('hall', 0.1, false);
  modules.forEach(object => {
    const surfaces = Array.from(visuals.belts.values()).filter(entry => entry.conveyor.id === object.userData.editorId);
    assert(surfaces.length > 0, 'Every rubber-belt preset exposes an animated longitudinal surface.');
    surfaces.forEach(entry => close(entry.surfaces[0].texture.offset.x, entry.surfaces[0].offsets.x - 0.04));
  });
  assert.equal(visuals.displays.size, 2, 'Hidden optional PLCs in middle/curve/T modules must not allocate dashboard textures.');
  const tee = Array.from(visuals.belts.values()).filter(entry => entry.conveyor.id === modules[3].userData.editorId);
  assert(tee.length > 1, 'The T conveyor animates the primary and branch surfaces.');
  assert.equal(tee[0].surfaces[0].texture, tee[1].surfaces[0].texture, 'A T uses one shared surface pattern without advancing it once per branch.');
  const curve = Array.from(visuals.belts.values()).find(entry => entry.conveyor.id === modules[2].userData.editorId);
  assert.notEqual(curve.surfaces[0].texture, tee[0].surfaces[0].texture, 'Separate curved and T modules keep independent motion phases.');
  visuals.dispose();
}

function testPanelScopes() {
  const {document, root, belt, beltVariables, records, simulation, visuals} = setup();
  const middle = document.addPrefab('hall', 'conveyor'), nextPanel = document.addPrefab('hall', 'conveyor'), end = document.addPrefab('hall', 'conveyor');
  const unrelated = document.addPrefab('hall', 'conveyor');
  const conveyor = (object, fields) => document.setBehaviors(object, document.getBehaviors(object).map(config => config.type === 'conveyor' ? Object.assign({}, config, fields) : config));
  conveyor(belt, {outputId: middle.userData.editorId, withPanel: true});
  conveyor(middle, {outputId: nextPanel.userData.editorId, withPanel: false});
  conveyor(nextPanel, {outputId: end.userData.editorId, withPanel: true});
  conveyor(end, {withPanel: false});
  records.set(middle.userData.editorId, {variables: Object.assign({}, beltVariables, {entryCount: 12, exitCount: 10})});
  records.set(nextPanel.userData.editorId, {variables: Object.assign({}, beltVariables, {entryCount: 10, exitCount: 8})});
  records.set(end.userData.editorId, {variables: Object.assign({}, beltVariables, {entryCount: 8, exitCount: 5})});
  records.set(unrelated.userData.editorId, {variables: Object.assign({}, beltVariables, {entryCount: 999})});
  const panel = belt.getObjectByName('PLC simulado / panel de mando');
  const buttons = document.getObjects('hall').filter(object => {
    if (!document.getBehaviors(object).some(config => config.type === 'control')) return false;
    for (let node = object.parent; node; node = node.parent) if (node === panel) return true;
    return false;
  });
  const scope = value => {
    visuals.dispose();
    buttons.forEach((button, index) => document.setBehaviors(button, document.getBehaviors(button).map(config => config.type === 'control' ?
      Object.assign({}, config, {scope: typeof value === 'function' ? value(index) : value}) : config)));
    root.updateMatrixWorld(true);
  };
  const hmi = () => Array.from(visuals.displays.values()).find(entry => {
    for (let node = entry.object; node; node = node.parent) if (node === panel) return true;
    return false;
  });
  scope('segment'); visuals.sync('hall', 0, false);
  assert.equal(hmi().scope, 'segment');
  assert.match(hmi().canvas.text.join('\n'), /TRAMO SIN DATOS/);
  assert(!hmi().canvas.text.includes('17'), 'Missing scoped telemetry must never fall back to anchor-only counters.');
  visuals.dispose(); visuals.sync('hall', 0, true);
  assert.match(hmi().canvas.text.join('\n'), /TRAMO · 2 MÓDULOS/);
  assert(!hmi().canvas.text.includes('17'), 'Preview shows graph scope without inventing production.');
  assert.deepEqual(visuals.previewMembers(visuals.byId.get(belt.userData.editorId), 'segment'), [belt.userData.editorId, middle.userData.editorId], 'A controlled segment stops before the next module with a panel.');
  let calls = 0;
  const segment = {variables: Object.assign({}, beltVariables, {entryCount: 9, exitCount: 5, moduleCount: 2}), memberIds: [belt.userData.editorId, middle.userData.editorId], anchorId: belt.userData.editorId, scope: 'segment'};
  const line = {variables: Object.assign({}, beltVariables, {entryCount: 3, exitCount: 2, moduleCount: 4}), memberIds: [belt, middle, nextPanel, end].map(object => object.userData.editorId), anchorId: belt.userData.editorId, scope: 'line'};
  simulation.getPanelSnapshot = (id, selectedScope) => {
    assert.equal(id, belt.userData.editorId); calls++;
    const snapshot = selectedScope === 'line' ? line : segment;
    return Object.assign({}, snapshot, {variables: Object.assign({}, snapshot.variables)});
  };
  visuals.dispose(); visuals.sync('hall', 0, false);
  assert.equal(calls, 1, 'The screen and all segment buttons share a single scoped read per update interval.');
  assert(hmi().canvas.text.includes('9') && hmi().canvas.text.includes('5'), 'The HMI consumes runtime boundary counts directly.');
  assert(!hmi().canvas.text.includes('17') && !hmi().canvas.text.includes('29'), 'The HMI must not sum per-module entry hops.');
  const version = hmi().texture.version;
  segment.variables.entryCount = 10;
  visuals.sync('hall', 0.05, false);
  assert.equal(calls, 1); assert.equal(hmi().texture.version, version);
  visuals.sync('hall', 0.2, false);
  assert.equal(calls, 2); assert(hmi().canvas.text.includes('10'));
  scope('line'); visuals.sync('hall', 0, true);
  assert.match(hmi().canvas.text.join('\n'), /LÍNEA · 4 MÓDULOS/);
  assert(!visuals.previewMembers(visuals.byId.get(belt.userData.editorId), 'line').includes(unrelated.userData.editorId), 'Line preview only follows explicit graph links.');
  visuals.dispose(); visuals.sync('hall', 0, false);
  assert.match(hmi().canvas.text.join('\n'), /LÍNEA · 4 MÓDULOS/);
  assert(hmi().canvas.text.includes('3') && hmi().canvas.text.includes('2'));
  assert(!hmi().canvas.text.includes('999'), 'Unrelated machinery must never enter a scoped dashboard.');
  scope(index => index === 0 ? 'module' : 'line'); visuals.sync('hall', 0, false);
  assert.equal(hmi().conveyor, null, 'Controls with one anchor but different scopes must not silently mix telemetry or actions.');
  assert.match(hmi().canvas.text.join('\n'), /VÍNCULOS DISTINTOS/);
  visuals.dispose();
}

function testBeltSurfaceMotion() {
  const {document, root, belt, beltVariables, visuals} = setup();
  const map = new THREE.DataTexture(new Uint8Array(16 * 4 * 4).fill(192), 16, 4, THREE.RGBAFormat);
  map.wrapS = THREE.RepeatWrapping; map.offset.set(0.2, 0.3); map.needsUpdate = true;
  const material = new THREE.MeshStandardMaterial({map});
  const makeSurface = () => {
    const mesh = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 1), material);
    mesh.name = 'Superficie continua'; mesh.rotation.x = -Math.PI / 2;
    mesh.userData.industrialBelt = {textureAxis: 'x', metersPerRepeat: 1, direction: -1, scaleAxis: 'x'};
    belt.add(mesh); return mesh;
  };
  const first = makeSurface(), second = makeSurface();
  const quaternion = first.quaternion.clone(); const position = first.position.clone();
  root.updateMatrixWorld(true); visuals.sync('hall', 0.1, false);
  assert.equal(visuals.belts.size, 2);
  const surface = visuals.belts.get(first).surfaces[0];
  assert.notEqual(surface.texture, map, 'Scrolling a rubber belt must not modify its authored texture.');
  assert.equal(surface.texture, visuals.belts.get(second).surfaces[0].texture, 'Separate visible parts of one belt share one moving texture.');
  assert.equal(first.material, second.material, 'Shared belt materials remain batched after the animation boundary.');
  close(surface.texture.offset.x, 0.2 - 0.4 * 0.1);
  close(surface.texture.offset.y, 0.3);
  close(map.offset.x, 0.2);
  assert(first.quaternion.equals(quaternion) && first.position.equals(position), 'Belt surface motion must not change collision poses.');
  const paused = surface.texture.offset.x; beltVariables.paused = true;
  visuals.sync('hall', 0.1, false); close(surface.texture.offset.x, paused);
  beltVariables.paused = false; beltVariables.actualSpeed = -0.4;
  visuals.sync('hall', 0.1, false); close(surface.texture.offset.x, paused + 0.04);
  beltVariables.actualSpeed = 0.4; belt.scale.setScalar(2); root.updateMatrixWorld(true);
  const scaled = surface.texture.offset.x;
  visuals.sync('hall', 0.1, false); close(surface.texture.offset.x, scaled - 0.02);
  const preview = surface.texture.offset.x; visuals.sync('hall', 0.1, true); close(surface.texture.offset.x, preview);
  let releases = 0; surface.texture.addEventListener('dispose', () => releases++);
  visuals.dispose(); visuals.dispose();
  assert.equal(first.material, material); assert.equal(second.material, material);
  assert.equal(releases, 1, 'A shared private belt texture is released exactly once.');
  close(map.offset.x, 0.2);
  assert(document.getObject(belt.userData.editorId), 'Visual cleanup preserves the editable module.');
}

async function testExplicitMachineBindings() {
  const {document, root, belt, records, beltVariables, visuals} = setup();
  const detached = document.addPrefab('hall', 'plc');
  const controls = panel => document.getObjects('hall').filter(object => {
    if (!document.getBehaviors(object).some(config => config.type === 'control')) return false;
    for (let node = object.parent; node; node = node.parent) if (node === panel) return true;
    return false;
  });
  const link = (panel, target, options = {}) => {
    visuals.dispose();
    controls(panel).forEach((control, index) => document.setBehaviors(control, document.getBehaviors(control).map(config =>
      config.type === 'control' ? Object.assign({}, config, {targetId: typeof target === 'function' ? target(control, index) : target}, options) : config)));
    root.updateMatrixWorld(true); visuals.sync('hall', 0, false);
  };
  const displayFor = panel => Array.from(visuals.displays.values()).find(entry => {
    for (let node = entry.object; node; node = node.parent) if (node === panel) return true;
    return false;
  });
  const contents = panel => displayFor(panel).canvas.text.join('\n');
  root.updateMatrixWorld(true); visuals.sync('hall', 0, false);
  assert.equal(displayFor(detached).conveyor, null, 'An isolated PLC targeting itself must not adopt the only conveyor in the room.');
  assert.match(contents(detached), /SIN VINCULAR/);
  assert.match(contents(detached), /PANEL SIN MÁQUINA/);
  assert(!displayFor(detached).canvas.text.includes('17'), 'An unlinked panel must not display another machine\'s production.');
  assert(!contents(detached).includes('0.40'), 'An unlinked panel must not display another machine\'s speed.');
  const detachedButtons = visuals.bindings.filter(binding => binding.kind === 'button' && controls(detached).some(object => object === binding.owner.object));
  assert(detachedButtons.length > 0);
  detachedButtons.forEach(binding => assert.equal(binding.entry.privateMaterials[0].emissiveIntensity, 0, 'Unlinked buttons must not imply another machine is powered.'));
  link(detached, belt.userData.editorId);
  assert.equal(displayFor(detached).conveyor.id, belt.userData.editorId, 'A consistent explicit target connects a standalone panel.');
  assert(contents(detached).includes(displayFor(detached).conveyor.shortId));
  assert.match(contents(detached), /17/);

  visuals.dispose();
  const second = document.addPrefab('hall', 'conveyor');
  document.rename(belt, 'Línea A'); document.rename(second, 'Línea B');
  records.set(second.userData.editorId, {variables: Object.assign({}, beltVariables, {speed: 1.25, actualSpeed: 1.25, entryCount: 82, exitCount: 31, inFlight: 51})});
  link(detached, second.userData.editorId);
  assert.equal(displayFor(detached).conveyor.id, second.userData.editorId);
  assert.match(contents(detached), /Línea B/);
  assert.match(contents(detached), /1\.25/);
  assert.match(contents(detached), /82/);
  assert.equal(displayFor(belt).conveyor.id, belt.userData.editorId);
  assert.match(contents(belt), /Línea A/);
  assert.match(contents(belt), /0\.40/);
  beltVariables.entryCount = 99; visuals.sync('hall', 0.25, false);
  assert(displayFor(belt).canvas.text.includes('99'));
  assert(!displayFor(detached).canvas.text.includes('99'), 'Changing the first machine must not change the explicitly linked second HMI.');
  assert(displayFor(detached).canvas.text.includes('82'));

  link(detached, (control, index) => index === 0 ? belt.userData.editorId : second.userData.editorId);
  assert.equal(displayFor(detached).conveyor, null, 'Conflicting targets must not select whichever control is traversed first.');
  assert.match(contents(detached), /VÍNCULOS DISTINTOS/);
  assert(!displayFor(detached).canvas.text.includes('99') && !displayFor(detached).canvas.text.includes('82'));
  link(detached, (control, index) => index === 0 ? detached.userData.editorId : second.userData.editorId);
  assert.equal(displayFor(detached).conveyor, null, 'A mixture of valid and unbound controls must not silently bind the whole panel.');
  assert.match(contents(detached), /VÍNCULOS DISTINTOS/);

  const embedded = belt.getObjectByName('PLC simulado / panel de mando');
  link(embedded, second.userData.editorId);
  assert.equal(displayFor(embedded).conveyor.id, second.userData.editorId, 'An explicit panel target overrides its geometric parent.');
  assert.match(contents(embedded), /Línea B/);
  link(embedded, embedded.userData.editorId);
  assert.equal(displayFor(embedded).conveyor, null, 'Disconnecting an embedded PLC must not fall back to the parent conveyor.');
  assert.match(contents(embedded), /SIN VINCULAR/);
  link(embedded, second.userData.editorId, {enabled: false});
  assert.equal(displayFor(embedded).conveyor, null, 'A PLC with all controls disabled must not infer telemetry from its parent.');
  assert.match(contents(embedded), /SIN VINCULAR/);
  visuals.dispose();
  document.setBehaviors(embedded, []);
  visuals.sync('hall', 0, false);
  assert.equal(displayFor(embedded).conveyor, null, 'A panel without PLC logic remains an ownership boundary when its buttons are disabled.');
  assert.match(contents(embedded), /SIN VINCULAR/);
  link(embedded, second.userData.editorId, {enabled: true});

  const secondVariables = records.get(second.userData.editorId).variables;
  secondVariables.transferBlocked = true; secondVariables.actualSpeed = 0;
  visuals.sync('hall', 0.25, false);
  assert.match(contents(detached), /VÍNCULOS DISTINTOS/, 'A blocked output must not repair unrelated conflicting bindings.');
  assert.match(contents(embedded), /ESPERANDO SALIDA/);
  assert.match(contents(embedded), /siguiente tramo/);
  assert(!contents(embedded).includes('PALLET'), 'A conveyor never presents an attached pallet dashboard.');
  assert(!contents(second).includes('0.40'), 'The second machine keeps its own speed setpoint while its receiver blocks transport.');
  secondVariables.transferBlocked = false; secondVariables.actualSpeed = 1.25;
  visuals.sync('hall', 0.25, false);
  assert.match(contents(embedded), /EN MARCHA/);
  assert(!contents(embedded).includes('ESPERANDO SALIDA'));
  visuals.dispose();
}
function materialsOfOriginals(originals) { return new Set(Array.from(originals.values()).flatMap(material => Array.isArray(material) ? material : [material])); }
run().catch(error => { console.error(error); process.exitCode = 1; });
