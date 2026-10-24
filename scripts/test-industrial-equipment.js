// Real authored prefab, Three.js geometry, collision tree, runtime, HMI, document
// copies and SQLite. Canvas drawing is the only rendering boundary adapted here.
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
const {ProjectStore} = require('../server/storage.js');
const {validateDocument} = require('../server/validation.js');
const {getGeometryTree} = require('./load-geometry-acceleration.js')(THREE);

const canvases = [];
const dom = {createElement(tag) {
  assert.equal(tag, 'canvas');
  const canvas = {width: 0, height: 0, text: []};
  const context = {fillRect(x, y, width, height) {
    if (x === 0 && y === 0 && width === canvas.width && height === canvas.height) canvas.text = [];
  }, fillText(value) { canvas.text.push(String(value)); }, measureText(value) { return {width: String(value).length * 12}; }};
  canvas.getContext = () => context; canvases.push(canvas); return canvas;
}};
const source = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')
  .replace(/^\uFEFF/, '').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const {createIndustrialPrefab, createProductVisual} = new Function('THREE', 'behaviorSchema', 'document', source('src/editor/IndustrialPrefabs.js') +
  '\nreturn {createIndustrialPrefab, createProductVisual};')(THREE, behaviorSchema, dom);
const SceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', source('src/editor/SceneDocument.js')
  .replace('default class SceneDocument', 'return class SceneDocument'))(THREE, behaviorSchema, createIndustrialPrefab);
const CollisionWorld = new Function('THREE', 'getGeometryTree', source('src/lib/CollisionWorld.js')
  .replace('default class CollisionWorld', 'return class CollisionWorld'))(THREE, getGeometryTree);
const ProductFeedback = new Function('THREE', source('src/editor/ProductFeedback.js').replace('default class ProductFeedback', 'return class ProductFeedback'))(THREE);
const SimulationRuntime = new Function('THREE', 'behaviorSchema', 'automationSchema', 'createProductVisual', 'ProductFeedback', 'ObjectPlacement', 'ProductSourceRuntime', 'ProcessorRuntime', 'PalletQueueRuntime', source('src/editor/SimulationRuntime.js')
  .replace('default class SimulationRuntime', 'return class SimulationRuntime'))(THREE, behaviorSchema, automationSchema, createProductVisual, ProductFeedback, ObjectPlacement, ProductSourceRuntime, ProcessorRuntime, PalletQueueRuntime);
const IndustrialVisuals = new Function('THREE', source('src/editor/IndustrialVisuals.js')
  .replace('default class IndustrialVisuals', 'return class IndustrialVisuals'))(THREE);

function setup(withStorage = true) {
  const scene = new THREE.Scene(), root = new THREE.Group(); scene.add(root);
  const floor = new THREE.Mesh(new THREE.BoxBufferGeometry(22, 0.05, 22), new THREE.MeshBasicMaterial());
  floor.position.y = -0.025; floor.name = 'Suelo físico'; root.add(floor);
  const document = new SceneDocument({}); document.registerRoom('hall', root);
  const belt = document.addPrefab('hall', 'conveyor'); document.setTransform(belt, {position: [0, 1.02, 0]});
  // Handling products are authored explicitly; conveyors have a clear inlet.
  const manualProduct = document.addPrefab('hall', 'product');
  document.setTransform(manualProduct, {position: [-2.55, 0.84, 0]});
  document.setBehaviors(manualProduct, [{type: 'product', sourceId: belt.userData.editorId}]);
  const workbench = document.addPrimitive('hall', 'box');
  document.setTransform(workbench, {position: [-2.55, 0.695, 0], scale: [0.62, 0.035, 0.67]});
  const storage = withStorage ? document.addPrefab('hall', 'palletQueue') : null;
  if (storage) {
    document.setTransform(storage, {position: [2.9, 1.02, 0]});
    document.setBehaviors(belt, document.getBehaviors(belt).map(config => config.type === 'conveyor' ? Object.assign({}, config, {outputId: storage.userData.editorId}) : config));
  }
  const camera = new THREE.PerspectiveCamera(); camera.position.set(-1.75, 1.6, -2.1); camera.rotation.y = Math.PI; scene.add(camera);
  const desktop = new THREE.Group(); desktop.userData.isDesktop = true; desktop.position.set(0.2, -0.2, -0.45); camera.add(desktop);
  const xr = new THREE.Group(); xr.name = 'Controlador XR de prueba'; scene.add(xr);
  const notices = [], native = {};
  const raycontrol = {states: {native}, selected: null,
    addState(name, state) { this.states[name] = state; }, activateState() {}, deactivateState() {},
    onSelectStart(event) { if (this.selected) this.selected.onSelectStart({distance: 1}, event.target); },
    onSelectEnd(event) { if (this.selected && this.selected.onSelectEnd) this.selected.onSelectEnd({distance: 1}, event.target); }
  };
  const ctx = {scene, camera, cameraRig: scene, desktopController: desktop, controllers: [xr], raycontrol, document: dom,
    editor: {active: false}, renderer: {capabilities: {getMaxAnisotropy: () => 8}}};
  ctx.collisionWorld = new CollisionWorld(ctx, document);
  const runtime = new SimulationRuntime(ctx, document, message => notices.push(message));
  const visuals = new IndustrialVisuals(ctx, document, runtime);
  const objects = document.getObjects('hall');
  const controls = new Map(objects.filter(object => document.getBehaviors(object).some(config => config.type === 'control' && config.targetId === belt.userData.editorId))
    .map(object => [object.userData.industrialAction, object]));
  const sensors = objects.filter(object => document.getBehaviors(object).some(config => config.type === 'sensor'));
  const carton = objects.find(object => document.getBehaviors(object).some(config => config.type === 'product'));
  root.updateMatrixWorld(true); scene.updateMatrixWorld(true);
  return {scene, root, camera, document, belt, storage, id: belt.userData.editorId, ctx, runtime, visuals, controls, sensors, carton, desktop, xr, notices, native};
}
function variables(fixture, id = fixture.id) { return fixture.runtime.records.get(id).variables; }
function stock(fixture, storage = fixture.storage) { return fixture.runtime.records.get(storage.userData.editorId).components.palletQueue; }
function stockVariables(fixture, storage = fixture.storage) { return variables(fixture, storage.userData.editorId); }
function advance(fixture, seconds) {
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += 1 / 60) {
    fixture.scene.updateMatrixWorld(true);
    fixture.ctx.collisionWorld.beginFrame();
    fixture.runtime.execute(Math.min(1 / 60, seconds - elapsed));
    fixture.visuals.sync('hall', 1 / 60, false);
    fixture.ctx.collisionWorld.endFrame();
  }
}
function press(fixture, action, controller = fixture.desktop) {
  const object = fixture.controls.get(action); assert(object, 'Missing physical action ' + action);
  const entry = fixture.runtime.states.find(value => value.state.colliderMesh === object);
  assert(entry, 'Missing active control state ' + action);
  clickControl(fixture, entry.state, controller);
}
function pressMachine(fixture, id, action, controller = fixture.desktop) {
  const object = fixture.document.getObjects('hall').find(node => node.userData.industrialAction === action &&
    fixture.document.getBehaviors(node).some(config => config.type === 'control' && config.targetId === id));
  assert(object, 'No bound control ' + id + ' / ' + action);
  const state = fixture.runtime.states.find(entry => entry.state.colliderMesh === object).state;
  clickControl(fixture, state, controller);
}
function clickControl(fixture, state, controller) {
  withButtonOrigin(state, controller, () => {
    fixture.ctx.raycontrol.selected = state;
    try { fixture.ctx.raycontrol.onSelectStart({target: controller}); }
    finally { fixture.ctx.raycontrol.onSelectEnd({target: controller}); }
  });
}
function withButtonOrigin(state, controller, action) {
  // The full ray/capture path has its own XR integration test. This adapter
  // clicks from the front of the physical cap and balances trigger-down/up.
  const position = controller.position.clone(), quaternion = controller.quaternion.clone();
  state.colliderMesh.updateWorldMatrix(true, true);
  const front = new THREE.Vector3(0, 0, 1).transformDirection(state.colliderMesh.matrixWorld);
  const origin = state.colliderMesh.getWorldPosition(new THREE.Vector3()).addScaledVector(front, 0.7);
  if (controller.parent) controller.parent.worldToLocal(origin);
  controller.position.copy(origin); controller.updateWorldMatrix(true, true);
  try { action(); }
  finally {
    controller.position.copy(position); controller.quaternion.copy(quaternion); controller.updateWorldMatrix(true, true);
  }
}
function hmi(fixture) { return Array.from(fixture.visuals.displays.values())[0].canvas.text.join('\n'); }
function close(actual, expected) { assert(Math.abs(actual - expected) < 1e-6, actual + ' != ' + expected); }

async function run() {
  const f = setup(), before = await f.document.serialize();
  const originalParent = f.carton.parent, originalIndex = originalParent.children.indexOf(f.carton);
  const originalPosition = f.carton.position.clone(), originalQuaternion = f.carton.quaternion.clone();
  const originalSelect = f.ctx.raycontrol.onSelectStart;
  f.runtime.start('hall'); f.visuals.sync('hall', 0.25, false);
  assert.match(hmi(f), /APAGADA/);
  assert.equal(variables(f).powered, false); assert.equal(variables(f).autoSpawn, false);
  // A captured press cancelled by an input/session transition must release its
  // physical cap through the original production onSelectCancel callback.
  const cancelledControl = f.controls.get('powerOff');
  const cancelledState = f.runtime.states.find(entry => entry.state.colliderMesh === cancelledControl).state;
  const cancelledCap = cancelledControl.children.find(object => object.userData.industrialButton);
  const cancelledRest = cancelledCap.position.clone();
  withButtonOrigin(cancelledState, f.desktop, () => {
    cancelledState.onSelectStart({distance: 1}, f.desktop);
    advance(f, 0.08);
    assert(f.runtime.getControlFeedback(cancelledControl.userData.editorId).pressed);
    assert(cancelledCap.position.z < cancelledRest.z - 0.005);
    cancelledState.onSelectCancel({distance: 1}, f.desktop);
    assert.equal(f.runtime.getControlFeedback(cancelledControl.userData.editorId).pressed, false, 'Cancellation clears both the held trigger and the minimum press pulse.');
    advance(f, 0.4);
    assert(cancelledCap.position.equals(cancelledRest), 'A cancelled cap springs back to its exact authored pose.');
  });
  assert.deepEqual(await f.document.serialize(), before, 'Cancellation cannot persist a pressed cap in the editor document.');
  press(f, 'start'); assert.equal(variables(f).running, false, 'A physical start cannot bypass electrical power.');
  assert(f.notices.pop().includes('alimentación'));
  press(f, 'powerOn'); assert.equal(variables(f).powered, true); assert.equal(variables(f).running, false);
  press(f, 'start'); assert.equal(variables(f).actualSpeed, 0.4);
  advance(f, 0.3); assert.match(hmi(f), /EN MARCHA/);
  assert.equal(variables(f).entryCount, 0, 'The new machine waits for manual cartons.');
  const roller = Array.from(f.visuals.rollers.values())[0];
  const movingOffset = roller.surfaces[0].texture.offset.x;
  press(f, 'insertBox'); advance(f, 0.2);
  assert.equal(variables(f).entryCount, 1); assert.equal(variables(f).inFlight, 1);
  const belt = f.runtime.records.get(f.id).components.conveyor;
  assert(belt.packages[0].offset > -2, 'New frame, optical sensors and panel must not obstruct the conveyor lane.');
  press(f, 'pause'); const offset = belt.packages[0].offset; advance(f, 0.3);
  close(belt.packages[0].offset, offset); assert.match(hmi(f), /EN PAUSA/);
  const pausedRoller = roller.surfaces[0].texture.offset.x; advance(f, 0.2); close(roller.surfaces[0].texture.offset.x, pausedRoller);
  press(f, 'pause'); press(f, 'speedUp'); close(variables(f).speed, 0.5);
  press(f, 'speedDown'); close(variables(f).speed, 0.4);
  advance(f, 1);
  const inputSensor = f.sensors.find(object => object.name.includes('entrada'));
  const inputVariables = variables(f, inputSensor.userData.editorId);
  assert.equal(inputVariables.count, 1, 'The real optical entry sensor counts the moving carton.');
  assert.equal(inputVariables.occupied, true);
  const lamp = f.visuals.bindings.find(binding => binding.kind === 'sensor' && binding.sensor.object === inputSensor);
  assert.equal(lamp.entry.privateMaterials[0].color.getHexString(), '42e4a4');
  advance(f, 10);
  assert.equal(variables(f).exitCount, 1); assert.equal(variables(f).inFlight, 0);
  assert.equal(stockVariables(f).queued, 1); assert.equal(stockVariables(f).capacity, 48);
  const firstPallet = stock(f);
  assert.equal(firstPallet.items.length, 1); assert(firstPallet.items[0].mesh.parent, 'An exiting generated carton remains visible and manipulable on its own pallet.');
  assert(f.sensors.every(object => variables(f, object.userData.editorId).count === 1), 'Both real detection beams must see the full traversal.');
  assert(f.sensors.every(object => !variables(f, object.userData.editorId).occupied));
  assert.equal(lamp.entry.privateMaterials[0].color.getHexString(), 'ff6575');
  assert.notEqual(roller.surfaces[0].texture.offset.x, movingOffset);
  press(f, 'emergency'); assert.equal(variables(f).emergency, true); assert.equal(variables(f).actualSpeed, 0);
  press(f, 'start'); assert.equal(variables(f).running, false);
  assert(f.notices.pop().includes('emergencia'));
  press(f, 'emergency'); assert.equal(variables(f).emergency, false); assert.equal(variables(f).running, false);
  press(f, 'start'); press(f, 'stop'); assert.equal(variables(f).running, false);
  press(f, 'powerOff'); advance(f, 0.25); assert.match(hmi(f), /APAGADA/);

  // Pick up the actual staged authored box, move it over the entry with the
  // same desktop virtual hand used by the application, then click to release.
  const product = f.runtime.products.get(f.carton);
  const cartonState = f.runtime.states.find(entry => entry.state.colliderMesh === f.carton).state;
  f.ctx.raycontrol.selected = cartonState; f.ctx.raycontrol.onSelectStart({target: f.desktop});
  assert.equal(product.heldBy, f.desktop);
  advance(f, 0.15);
  assert.equal(f.carton.industrialHeld, true);
  const desired = new THREE.Vector3(-1.72, 1.17, 0);
  // Lift over the frame, then lower onto the entry. Sweeps retain real physical
  // clearance throughout each hand motion rather than teleporting the carton.
  f.camera.position.set(-1.72, 2.0, -0.8); advance(f, 0.2);
  f.camera.position.set(-1.72, 1.17, -0.8); advance(f, 0.2);
  const handCenter = f.carton.getWorldPosition(new THREE.Vector3());
  assert(handCenter.distanceTo(desired) < 0.16, 'Desktop hand can reach the actual roller lane without passing the frame.');
  f.ctx.raycontrol.selected = f.runtime.states.find(entry => entry.state.colliderMesh === f.controls.get('powerOff')).state;
  f.ctx.raycontrol.onSelectStart({target: f.desktop});
  assert.equal(product.heldBy, null); assert.equal(variables(f).inFlight, 1);
  assert.equal(variables(f).entryCount, 2);
  assert.equal(variables(f, f.carton.userData.editorId).onConveyor, true);
  assert.equal(variables(f).powered, false, 'Dropping a box consumes input before another panel action.');
  assert.equal(belt.packages[0].mesh, f.carton);

  // Trigger handling also works with an independent XR hand, and a reposition
  // of the same carton never adds a second logical product or entry event.
  f.xr.position.copy(f.carton.getWorldPosition(new THREE.Vector3())).add(new THREE.Vector3(0, 0.025, 0.35));
  f.ctx.raycontrol.selected = cartonState; f.ctx.raycontrol.onSelectStart({target: f.xr}); advance(f, 0.05);
  assert.equal(product.heldBy, f.xr);
  f.ctx.raycontrol.onSelectStart({target: f.xr});
  assert.equal(product.heldBy, null); assert.equal(variables(f).entryCount, 2);
  press(f, 'powerOn', f.xr); press(f, 'start', f.xr); advance(f, 10.6);
  assert.equal(variables(f).exitCount, 2);
  assert.equal(variables(f, f.carton.userData.editorId).onConveyor, false);
  assert.equal(variables(f, f.carton.userData.editorId).onPallet, true);
  assert.equal(stockVariables(f).queued, 2);
  assert(firstPallet.items.some(item => item.mesh === f.carton), 'An authored carton keeps its exact object when stacked.');

  // Stop restores every authored transform, child index and native input hook.
  f.runtime.stop(); f.visuals.dispose();
  assert.equal(f.carton.parent, originalParent); assert.equal(originalParent.children.indexOf(f.carton), originalIndex);
  assert(f.carton.position.equals(originalPosition)); assert(f.carton.quaternion.equals(originalQuaternion));
  assert.equal(f.carton.industrialHeld, undefined); assert.equal(f.ctx.raycontrol.onSelectStart, originalSelect);
  assert.deepEqual(Object.keys(f.ctx.raycontrol.states), ['native']); assert.equal(f.ctx.raycontrol.states.native, f.native);
  assert.deepEqual(await f.document.serialize(), before, 'Operating equipment must not alter the saved authoring document.');
  const copy = await f.document.duplicate(f.belt);
  assert.notEqual(copy.userData.editorId, f.id);
  const copiedObjects = f.document.getObjects('hall').filter(object => {
    for (let node = object; node; node = node.parent) if (node === copy) return true;
    return false;
  });
  const copiedProduct = copiedObjects.find(object => f.document.getBehaviors(object).some(config => config.type === 'product'));
  assert.equal(copiedProduct, undefined, 'Copying a conveyor must not introduce a built-in loading box.');
  assert.equal(f.document.getObject(f.carton.userData.editorId), f.carton, 'The separately authored handling product remains independent.');
  copiedObjects.forEach(object => f.document.getBehaviors(object).forEach(config => {
    if (config.type === 'control') assert.equal(config.targetId, copy.userData.editorId);
    if (config.type === 'sensor') assert.equal(config.sourceId, copy.userData.editorId);
  }));
  const serialized = await f.document.serialize(); assert.deepEqual(validateDocument(serialized, record => record), serialized);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'webxr-equipment-test-'));
  let store;
  try {
    store = new ProjectStore({dataDir: directory});
    const saved = store.saveProject(null, {name: 'Equipo industrial de prueba', document: serialized});
    assert.deepEqual(store.getProject(saved.id).document, serialized, 'SQLite preserves new commands, sensors, product and power settings.');
    const loaded = setup(); await loaded.document.load(saved.document);
    assert.equal(loaded.document.getObjects('hall').filter(object => loaded.document.getBehaviors(object).some(config => config.type === 'conveyor')).length, 2);
  } finally {
    if (store) store.close();
    fs.rmSync(directory, {recursive: true, force: true});
  }

  // A copied conveyor owns its controls, simulation data and receiving pallet.
  // Filling one pallet stops only that machine, without losing queued cartons.
  const g = setup();
  const sourceBehavior = g.document.getBehaviors(g.belt).find(config => config.type === 'conveyor');
  g.document.setBehaviors(g.belt, [Object.assign({}, sourceBehavior, {speed: 4, spawnInterval: 0.1}), behaviorSchema.defaultBehavior('analytics')]);
  const other = await g.document.duplicate(g.belt), otherId = other.userData.editorId;
  g.document.setTransform(other, {position: [0, 1.02, 5]});
  const otherStorage = await g.document.duplicate(g.storage);
  g.document.setTransform(otherStorage, {position: [2.9, 1.02, 5]});
  g.document.setBehaviors(other, g.document.getBehaviors(other).map(config => config.type === 'conveyor' ? Object.assign({}, config, {outputId: otherStorage.userData.editorId}) : config));
  const beforePair = await g.document.serialize();
  g.runtime.start('hall'); g.visuals.sync('hall', 0.25, false);
  assert.notEqual(g.runtime.records.get(g.id).components.conveyor, g.runtime.records.get(otherId).components.conveyor);
  assert.notEqual(stock(g).items, stock(g, otherStorage).items);
  pressMachine(g, g.id, 'powerOn'); pressMachine(g, g.id, 'start');
  assert.equal(variables(g, otherId).powered, false); assert.equal(variables(g, otherId).running, false);
  g.runtime.setVariable(g.id, 'autoSpawn', true); advance(g, 8);
  const sourceMachine = g.runtime.records.get(g.id).components.conveyor;
  assert.equal(stockVariables(g).queued, 48); assert.equal(stockVariables(g).full, true);
  assert.equal(variables(g).actualSpeed, 0); assert.equal(variables(g).exitCount, 48);
  assert.equal(variables(g).entryCount, variables(g).exitCount + variables(g).inFlight, 'A full pallet retains every produced box in its stack or upstream queue.');
  assert.equal(variables(g, otherId).entryCount, 0); assert.equal(stockVariables(g, otherStorage).queued, 0);
  assert.equal(variables(g, otherId).powered, false, 'Production and full-pallet state cannot leak to a copied conveyor.');
  const stacks = stock(g);
  assert.equal(stacks.items.length, 48);
  for (let i = 0; i < stacks.items.length; i++) for (let j = i + 1; j < stacks.items.length; j++) {
    assert(!stacks.items[i].box.clone().expandByScalar(-0.001).intersectsBox(stacks.items[j].box.clone().expandByScalar(-0.001)), 'Ordered pallet cartons must not overlap.');
  }
  const lower = stacks.items.find(item => item.palletSlot === 0);
  assert.equal(g.runtime.pickupProduct(lower.product, g.xr), false, 'Removing a supporting box must not leave floating cartons above it.');
  assert(g.notices.pop().includes('superiores'));
  const upper = stacks.items.find(item => item.palletSlot === 36);
  g.xr.position.copy(upper.mesh.getWorldPosition(new THREE.Vector3())).add(new THREE.Vector3(0, 0.5, 0.35));
  assert(g.runtime.pickupProduct(upper.product, g.xr));
  assert.equal(stockVariables(g).queued, 47); assert.equal(stockVariables(g).full, false);
  advance(g, 0.3);
  assert.equal(stockVariables(g).queued, 48); assert.equal(variables(g).exitCount, 49, 'Removing a top carton releases one new stacking slot and resumes the queue.');
  assert.equal(upper.product.heldBy, g.xr);
  pressMachine(g, otherId, 'powerOn'); pressMachine(g, otherId, 'start'); pressMachine(g, otherId, 'insertBox'); advance(g, 1.5);
  assert.equal(variables(g, otherId).entryCount, 1); assert.equal(stockVariables(g, otherStorage).queued, 1);
  assert.equal(stockVariables(g).queued, 48, 'Operating a copied panel changes only its connected receiving store.');
  g.runtime.stop(); g.visuals.dispose();
  assert.deepEqual(await g.document.serialize(), beforePair, 'Stopping restores both machines and their authored products without persisting runtime stacks.');

  // Reversing an unconnected conveyor must retain its load without creating
  // an implicit receiving pallet at the opposite end.
  const reverse = setup(false);
  const reverseConfig = reverse.document.getBehaviors(reverse.belt).find(config => config.type === 'conveyor');
  reverse.document.setBehaviors(reverse.belt, [Object.assign({}, reverseConfig, {speed: -4})]);
  const reverseBefore = await reverse.document.serialize(); reverse.runtime.start('hall');
  press(reverse, 'powerOn'); press(reverse, 'start'); press(reverse, 'insertBox'); advance(reverse, 1.3);
  assert.equal(variables(reverse).palletCount, 0); assert.equal(variables(reverse).exitCount, 0); assert.equal(variables(reverse).inFlight, 1);
  const reversedMachine = reverse.runtime.records.get(reverse.id).components.conveyor;
  assert.equal(reversedMachine.pallets.size, 0);
  assert.equal(reverse.ctx.collisionWorld.isSolid(reversedMachine.packages[0].mesh), true);
  reverse.runtime.stop(); reverse.visuals.dispose();
  assert.deepEqual(await reverse.document.serialize(), reverseBefore);

  const blocked = setup();
  const obstruction = new THREE.Mesh(new THREE.BoxBufferGeometry(1.16, 2, 1.1), new THREE.MeshBasicMaterial());
  obstruction.name = 'Obstáculo sobre el palet'; obstruction.position.set(2.87, 1.2, 0); blocked.root.add(obstruction);
  const blockedConfig = blocked.document.getBehaviors(blocked.belt).find(config => config.type === 'conveyor');
  blocked.document.setBehaviors(blocked.belt, [Object.assign({}, blockedConfig, {speed: 4})]);
  blocked.runtime.start('hall'); press(blocked, 'powerOn'); press(blocked, 'start'); press(blocked, 'insertBox'); advance(blocked, 1.5);
  assert.equal(stockVariables(blocked).queued, 0); assert.equal(stockVariables(blocked).blocked, true); assert.equal(variables(blocked).actualSpeed, 0);
  assert.equal(variables(blocked).inFlight, 1, 'A blocked pallet retains its waiting product.');
  obstruction.visible = false; blocked.ctx.collisionWorld.invalidate(obstruction); advance(blocked, 0.4);
  assert.equal(stockVariables(blocked).queued, 1); assert.equal(stockVariables(blocked).blocked, false);
  assert.equal(variables(blocked).actualSpeed, 4, 'A cleared obstruction resumes stacking without a new start command.');
  blocked.runtime.stop(); blocked.visuals.dispose();
  console.log('Real industrial equipment: physical controls, power/start/pause/stop/emergency, detailed carton traversal, optical sensor colors/counters, live HMI, visible rollers, desktop/XR product handling, exact authoring cleanup, copied bindings and SQLite reload passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
