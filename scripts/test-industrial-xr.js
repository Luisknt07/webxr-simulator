// Actual controller events, native input bridge, RayControl, industrial prefabs,
// collisions and simulation. Canvas/XR hardware are the adapted boundaries.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const ObjectPlacement = require('./load-object-placement')(THREE);
const behaviorSchema = require('../shared/behaviors.js');
const automationSchema = require('../shared/automation.js');
const PalletQueueRuntime = require('./load-pallet-queue-runtime.js')(THREE, behaviorSchema);
const ProcessorRuntime = require('./load-processor-runtime.js')(THREE, behaviorSchema);
const ProductSourceRuntime = require('./load-product-source-runtime')(THREE, behaviorSchema);
const {getGeometryTree} = require('./load-geometry-acceleration.js')(THREE);
const layout = behaviorSchema.conveyorLayout;
function source(file) { return fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/^\uFEFF/, '').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''); }
function block(text, marker) {
  const start = text.indexOf(marker); assert(start >= 0, 'Missing production input bridge ' + marker);
  const open = text.indexOf('{', start); let depth = 0, quote = '', line = false, comment = false;
  for (let index = open; index < text.length; index++) {
    const ch = text[index], next = text[index + 1];
    if (line) { if (ch === '\n') line = false; continue; }
    if (comment) { if (ch === '*' && next === '/') { comment = false; index++; } continue; }
    if (quote) { if (ch === '\\') index++; else if (ch === quote) quote = ''; continue; }
    if (ch === '/' && next === '/') { line = true; index++; continue; }
    if (ch === '/' && next === '*') { comment = true; index++; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}' && --depth === 0) return text.slice(start, index + 1);
  }
  throw new Error('Unbalanced production bridge ' + marker);
}
const dom = {createElement(tag) {
  assert.equal(tag, 'canvas'); const canvas = {width: 0, height: 0, text: []};
  const drawing = {fillRect(x, y, width, height) { if (x === 0 && y === 0 && width === canvas.width && height === canvas.height) canvas.text = []; },
    fillText(value) { canvas.text.push(String(value)); }, measureText(value) { return {width: String(value).length * 12}; }};
  canvas.getContext = () => drawing; return canvas;
}};
const cargo = require('./load-product-prefabs.js')(THREE);
const prefabs = new Function('THREE', 'behaviorSchema', 'document', 'require', source('src/editor/IndustrialPrefabs.js') + '\nreturn {createIndustrialPrefab,createProductVisual};')(THREE, behaviorSchema, dom, id => { assert.equal(id, './ProductPrefabs.js'); return cargo; });
const SceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', source('src/editor/SceneDocument.js').replace('default class SceneDocument', 'return class SceneDocument'))(THREE, behaviorSchema, prefabs.createIndustrialPrefab);
const EventDispatcher = new Function(source('src/lib/EventDispatcher.js').replace('default class EventDispatcher', 'return class EventDispatcher'))();
const RayControl = new Function('THREE', 'EventDispatcher', source('src/lib/RayControl.js').replace('default class RayControl', 'class RayControl') + '\nreturn RayControl;')(THREE, EventDispatcher);
const ProductFeedback = fs.existsSync(path.join(__dirname, '../src/editor/ProductFeedback.js')) ? new Function('THREE', source('src/editor/ProductFeedback.js').replace('default class ProductFeedback', 'return class ProductFeedback'))(THREE) : undefined;
const Runtime = new Function('THREE', 'behaviorSchema', 'automationSchema', 'createProductVisual', 'ProductFeedback', 'ObjectPlacement', 'ProductSourceRuntime', 'ProcessorRuntime', 'PalletQueueRuntime', source('src/editor/SimulationRuntime.js').replace('default class SimulationRuntime', 'return class SimulationRuntime'))(THREE, behaviorSchema, automationSchema, prefabs.createProductVisual, ProductFeedback, ObjectPlacement, ProductSourceRuntime, ProcessorRuntime, PalletQueueRuntime);
const CollisionWorld = new Function('THREE', 'getGeometryTree', source('src/lib/CollisionWorld.js').replace('default class CollisionWorld', 'return class CollisionWorld'))(THREE, getGeometryTree);
const IndustrialVisuals = new Function('THREE', 'RollerInstanceBatches', source('src/editor/IndustrialVisuals.js').replace('default class IndustrialVisuals', 'return class IndustrialVisuals'))(THREE, require('./load-roller-instance-batches')(THREE));

function inputTarget() {
  const target = new THREE.EventDispatcher(); target.clientHeight = 800;
  return target;
}
function setup(variant = 'roller-start') {
  const scene = new THREE.Scene(), root = new THREE.Group(); scene.add(root);
  const floor = new THREE.Mesh(new THREE.BoxBufferGeometry(50, 0.05, 50), new THREE.MeshBasicMaterial()); floor.position.y = -0.025; root.add(floor);
  const portal = new THREE.Mesh(new THREE.PlaneBufferGeometry(1, 1), new THREE.MeshBasicMaterial()); portal.position.set(0, 1.6, -10); root.add(portal);
  const document = new SceneDocument({}); document.registerRoom('hall', root);
  const head = document.addPrefab('hall', 'conveyor', variant); document.setTransform(head, {position: [0, 1.02, 0]});
  const tail = document.addPrefab('hall', 'conveyor', 'belt-end');
  const unrelated = document.addPrefab('hall', 'conveyor'); document.setTransform(unrelated, {position: [0, 1.02, 9]});
  const change = (object, values) => document.setBehaviors(object, document.getBehaviors(object).map(value => value.type === 'conveyor' ? Object.assign({}, value, values) : value));
  change(head, {length: 2.5, outputId: tail.userData.editorId, autoSpawn: false});
  change(tail, {length: 2.5, powered: false, running: false, autoSpawn: false});
  scene.updateMatrixWorld(true);
  const from = layout.ports(document.getBehaviors(head).find(value => value.type === 'conveyor')).output;
  const to = layout.ports(document.getBehaviors(tail).find(value => value.type === 'conveyor')).input;
  document.setTransform(tail, {position: [from.x - to.x, 1.02, from.z - to.z]});
  const cartons = [document.addPrefab('hall', 'product'), document.addPrefab('hall', 'product')];
  cartons.forEach((object, index) => document.setTransform(object, {position: [-4 + index * 1.5, 1.3, 5], rotation: [0.15, 0.45 + index * 0.2, -0.1]}));
  const camera = new THREE.PerspectiveCamera(); camera.position.set(0, 1.6, 2); scene.add(camera);
  const desktop = new THREE.Group(); desktop.userData.isDesktop = true; desktop.position.set(0.2, -0.2, -0.45); camera.add(desktop);
  const left = new THREE.Group(), right = new THREE.Group(); scene.add(left, right);
  const beamModel = new THREE.Group(), beam = new THREE.Mesh(new THREE.BoxBufferGeometry(0.002, 0.002, 1), new THREE.MeshBasicMaterial()); beam.name = 'beam'; beamModel.add(beam);
  const controllerModel = new THREE.Group(); controllerModel.name = 'Modelo de mando';
  ['body', 'trigger'].forEach(name => { const object = new THREE.Mesh(new THREE.BoxBufferGeometry(0.015, 0.015, 0.025), new THREE.MeshBasicMaterial()); object.name = name; controllerModel.add(object); });
  const assets = {teleport_model: {scene: beamModel}, beam_tex: new THREE.Texture(), generic_controller_model: {scene: controllerModel}, controller_tex: new THREE.Texture()};
  const xr = new THREE.EventDispatcher(), renderer = {xr, domElement: inputTarget(), capabilities: {getMaxAnisotropy: () => 8}};
  const ctx = {scene, camera, cameraRig: scene, desktopController: desktop, controllers: [left, right], assets, shaders: {basic_vert: '', beam_frag: ''}, document: dom,
    renderer, vrMode: true, editor: {active: false, document}};
  ctx.raycontrol = new RayControl(ctx, 'right');
  const indexSource = source('src/index.js');
  const bridge = new Function('THREE', 'assets', 'controllers', 'raycontrol', 'context', 'renderer', 'OculusBrowser', 'selectStartSkip', 'selectEndSkip', 'updateXRGrip',
    [block(indexSource, 'function setupControllers()'), block(indexSource, 'function syncXRControllers(frame)'), block(indexSource, 'function onSelectStart('), block(indexSource, 'function onSelectEnd(')].join('\n') + '\nreturn {setupControllers,syncXRControllers,onSelectStart,onSelectEnd};')
    (THREE, assets, ctx.controllers, ctx.raycontrol, ctx, renderer, false, {}, {}, require('./load-xr-grip.js')(THREE).updateXRGrip);
  bridge.setupControllers();
  ctx.controllers.forEach(controller => {
    controller.addEventListener('selectstart', bridge.onSelectStart); controller.addEventListener('selectend', bridge.onSelectEnd);
  });
  const pulses = [];
  const inputSource = handedness => ({handedness, targetRayMode: 'tracked-pointer', gamepad: {hapticActuators: [{pulse(strength, duration) {
    pulses.push({handedness, strength, duration}); return Promise.resolve(true);
  }}]}});
  const sources = new Map([[left, inputSource('left')], [right, inputSource('right')]]);
  sources.forEach((data, controller) => controller.dispatchEvent({type: 'connected', data}));
  const notices = [], runtime = new Runtime(ctx, document, value => notices.push(value));
  const visuals = new IndustrialVisuals(ctx, document, runtime); ctx.collisionWorld = new CollisionWorld(ctx, document);
  const native = {starts: 0, ends: 0, backgroundStarts: 0, backgroundEnds: 0};
  const nativeState = ctx.raycontrol.addState('native-portal', {colliderMesh: portal, controller: 'primary', onSelectStart() { native.starts++; }, onSelectEnd() { native.ends++; }}, true);
  const nativeBackground = ctx.raycontrol.addState('native-background', {raycaster: false, controller: 'primary', vrOnly: true,
    onSelectStart() { native.backgroundStarts++; }, onSelectEnd() { native.backgroundEnds++; }}, true);
  scene.updateMatrixWorld(true);
  return {scene, root, document, head, tail, unrelated, cartons, camera, desktop, left, right, sources, pulses, ctx, runtime, visuals, notices, bridge, native, nativeState, nativeBackground, portal};
}
function advance(f, seconds = 1 / 60) {
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) {
    const delta = Math.min(1 / 60, seconds - t); f.scene.updateMatrixWorld(true); f.ctx.collisionWorld.beginFrame();
    f.ctx.raycontrol.execute(f.ctx, delta, f.runtime.time + delta); f.runtime.execute(delta); f.visuals.sync('hall', delta, f.ctx.editor.active);
    f.ctx.collisionWorld.endFrame();
  }
}
function aim(f, controller, point, normal = new THREE.Vector3(0, 0, 1), distance = 0.7) {
  const position = point.clone().addScaledVector(normal, distance); controller.position.copy(position);
  controller.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(position, point, new THREE.Vector3(0, 1, 0)));
  f.scene.updateMatrixWorld(true); advance(f);
}
function away(f, controller) { aim(f, controller, new THREE.Vector3(20, 4, 19)); }
function button(f, action, machine = f.head) {
  const object = f.document.getObjects('hall').find(node => node.userData.industrialAction === action &&
    f.document.getBehaviors(node).some(config => config.type === 'control' && config.targetId === machine.userData.editorId));
  assert(object, 'Missing bound physical button ' + action);
  let cap; object.traverse(node => { if (node.userData.industrialButton) cap = node; }); assert(cap);
  return {object, cap, id: object.userData.editorId};
}
function select(f, controller, type) { controller.dispatchEvent({type}); }
function press(f, action, controller = f.right, machine = f.head) {
  const current = button(f, action, machine), normal = new THREE.Vector3(0, 0, 1).transformDirection(current.object.matrixWorld), rest = current.cap.position.z;
  aim(f, controller, current.cap.getWorldPosition(new THREE.Vector3()), normal);
  const controllerData = f.ctx.raycontrol.controllers.find(data => data.controller === controller);
  assert(controllerData && f.ctx.raycontrol.selectionEntries(controllerData).some(entry => entry.state.colliderMesh === current.object),
    'A real ray from the ' + f.sources.get(controller).handedness + ' hand must hit the logical ' + action + ' button.');
  const before = f.runtime.getControlFeedback(current.id).sequence;
  select(f, controller, 'selectstart');
  assert.equal(f.runtime.getControlFeedback(current.id).pressed, true, 'Physical feedback follows trigger-down.');
  assert.equal(f.runtime.getControlFeedback(current.id).sequence, before + 1);
  advance(f, 0.08); assert(current.cap.position.z < rest - 0.005, 'The actual 3D cap moves into its housing while pressed.');
  away(f, controller);
  assert.equal(f.runtime.getControlFeedback(current.id).pressed, true, 'Aiming away does not release the original captured button early.');
  select(f, controller, 'selectend'); advance(f, 0.3);
  assert.equal(f.runtime.getControlFeedback(current.id).pressed, false, 'Release ends the original physical button, even after aiming away.');
  close(current.cap.position.z, rest, 0.0001);
  return current;
}
function vars(f, object = f.head) { return f.runtime.records.get(object.userData.editorId).variables; }
function close(actual, expected, epsilon = 1e-7) { assert(Math.abs(actual - expected) <= epsilon, actual + ' != ' + expected); }
function basis(object) { object.updateWorldMatrix(true, false); return [0, 1, 2, 4, 5, 6, 8, 9, 10].map(index => object.matrixWorld.elements[index]); }
function unchangedBasis(object, expected) { basis(object).forEach((value, index) => close(value, expected[index])); }
function pickup(f, object, controller) {
  const product = f.runtime.products.get(object); assert(product);
  const center = product.bounds.getCenter(new THREE.Vector3()).applyMatrix4(object.matrixWorld);
  aim(f, controller, center); select(f, controller, 'selectstart'); select(f, controller, 'selectend'); advance(f);
  assert.equal(product.heldBy, controller, 'An actual controller ray/trigger picks up the authored box.');
  assert.equal(f.runtime.held.get(controller), product);
  return product;
}
function editorVRChange(f, inVR) {
  const method = block(source('src/editor/SceneEditor.js'), 'onVRChange(inVR)');
  const invoke = new Function('inVR', method.slice(method.indexOf('{') + 1, -1));
  invoke.call({ctx: f.ctx, simulation: f.runtime, active: false, editorEnabled: true, canEditDocument() { return true; }, clearNavigation() {}, projectLibrary: {close() {}},
    launcher: {}, returnButton: {}, resize() {}, simulationPanel: {modeChanged() {}}}, inVR);
}
function connect(f, controller) { controller.dispatchEvent({type: 'connected', data: f.sources.get(controller)}); }
function disconnect(f, controller) { controller.dispatchEvent({type: 'disconnected', data: f.sources.get(controller)}); }
function wall(f, center, width = 0.7, height = 0.7) {
  const object = new THREE.Mesh(new THREE.BoxBufferGeometry(width, height, 0.04), new THREE.MeshBasicMaterial());
  object.position.copy(center); f.root.add(object); f.scene.updateMatrixWorld(true); f.ctx.collisionWorld.invalidate(object);
  return object;
}
function removeWall(f, object) { object.parent.remove(object); f.ctx.collisionWorld.invalidate(object); object.geometry.dispose(); object.material.dispose(); }

async function run() {
  const f = setup(); const authored = JSON.stringify(await f.document.serialize());
  const nativeStarts = f.nativeState.onSelectStart, nativeEnds = f.nativeState.onSelectEnd;
  const originalSelect = f.ctx.raycontrol.onSelectStart;
  const listenerCounts = Object.fromEntries(Object.entries(f.ctx.raycontrol._listeners).map(([key, entries]) => [key, entries.length]));
  f.runtime.start('hall'); advance(f);
  assert.equal(f.ctx.raycontrol.controllers.length, 2);
  assert(f.left.getObjectByName('raycasterContext') && f.right.getObjectByName('raycasterContext'), 'Both tracked hands own usable ray origins.');
  assert.deepEqual(f.runtime.getPanelSnapshot(f.head.userData.editorId, 'segment').memberIds.sort(), [f.head, f.tail].map(object => object.userData.editorId).sort());
  press(f, 'powerOn', f.left); assert(vars(f).powered && vars(f, f.tail).powered); assert.equal(vars(f, f.unrelated).powered, false);
  press(f, 'start', f.right); assert(vars(f).running && vars(f, f.tail).running);
  press(f, 'pause', f.left); assert(vars(f).paused && vars(f, f.tail).paused);
  press(f, 'start', f.right); assert(!vars(f).paused && !vars(f, f.tail).paused, 'The green physical start resumes every module in the selected segment.');
  const initialSpeed = vars(f).speed;
  press(f, 'speedUp', f.left); close(vars(f).speed, initialSpeed + 0.1); close(vars(f, f.tail).speed, initialSpeed + 0.1);
  press(f, 'speedDown', f.right); close(vars(f).speed, initialSpeed); close(vars(f, f.tail).speed, initialSpeed);
  press(f, 'insertBox', f.left); assert.equal(vars(f).entryCount, 1); assert.equal(vars(f).inFlight, 1); assert.equal(vars(f, f.unrelated).entryCount, 0);
  press(f, 'stop', f.right); assert(!vars(f).running && !vars(f, f.tail).running);
  press(f, 'start', f.left); assert(vars(f).running && vars(f, f.tail).running);
  press(f, 'emergency', f.right); assert(vars(f).emergency && vars(f, f.tail).emergency); assert(!vars(f).running && !vars(f, f.tail).running);
  press(f, 'start', f.left); assert(!vars(f).running && !vars(f, f.tail).running, 'An interlocked line cannot be restarted from either hand.'); assert(f.notices.some(value => /emergencia/.test(value)));
  press(f, 'emergency', f.right); assert(!vars(f).emergency && !vars(f, f.tail).emergency);
  press(f, 'start', f.left); assert(vars(f).running && vars(f, f.tail).running);
  press(f, 'powerOff', f.right); assert(!vars(f).powered && !vars(f, f.tail).powered);
  assert.deepEqual(f.native, {starts: 0, ends: 0, backgroundStarts: 0, backgroundEnds: 0}, 'Industrial triggers never start native background actions.');
  assert(f.pulses.some(value => value.handedness === 'left') && f.pulses.some(value => value.handedness === 'right'), 'Optional haptics acknowledge successful operations on either tracked hand.');
  const displayText = Array.from(f.visuals.displays.values()).map(value => value.canvas.text.join('\n')).join('\n');
  assert.match(displayText, /TRAMO/); assert.match(displayText, /2 M/); assert.match(displayText, /APAGADA/);

  const guarded = button(f, 'powerOn'), front = new THREE.Vector3(0, 0, 1).transformDirection(guarded.object.matrixWorld);
  const guardSequence = f.runtime.getControlFeedback(guarded.id).sequence;
  for (const [normal, distance, reason] of [[front.clone().negate(), 0.7, 'rear of cabinet'], [front, 6.5, 'beyond six metres']]) {
    aim(f, f.right, guarded.cap.getWorldPosition(new THREE.Vector3()), normal, distance);
    select(f, f.right, 'selectstart'); select(f, f.right, 'selectend'); advance(f, 0.2);
    assert.equal(vars(f).powered, false, 'A panel cannot be operated from the ' + reason + '.');
    assert.equal(f.runtime.getControlFeedback(guarded.id).sequence, guardSequence);
  }
  aim(f, f.right, guarded.cap.getWorldPosition(new THREE.Vector3()), front);
  const obstacle = wall(f, guarded.cap.getWorldPosition(new THREE.Vector3()).addScaledVector(front, 0.35)); advance(f);
  select(f, f.right, 'selectstart'); select(f, f.right, 'selectend'); advance(f, 0.2);
  assert.equal(vars(f).powered, false, 'A solid wall between the ray origin and physical button blocks its command.');
  assert.equal(f.runtime.getControlFeedback(guarded.id).sequence, guardSequence); removeWall(f, obstacle);

  // A cap has one mechanical action even if two tracked hands touch it; its
  // feedback remains down until the final owner releases the trigger.
  press(f, 'powerOn', f.right); press(f, 'start', f.right);
  const pause = button(f, 'pause'); const pausePoint = pause.cap.getWorldPosition(new THREE.Vector3());
  aim(f, f.left, pausePoint, front); aim(f, f.right, pausePoint, front);
  const previousPause = vars(f).paused, previousSequence = f.runtime.getControlFeedback(pause.id).sequence;
  select(f, f.left, 'selectstart'); select(f, f.right, 'selectstart'); advance(f, 0.2);
  assert.equal(vars(f).paused, !previousPause); assert.equal(f.runtime.getControlFeedback(pause.id).sequence, previousSequence + 1);
  select(f, f.left, 'selectend'); advance(f, 0.2); assert.equal(f.runtime.getControlFeedback(pause.id).pressed, true);
  select(f, f.right, 'selectend'); advance(f, 0.3); assert.equal(f.runtime.getControlFeedback(pause.id).pressed, false);

  // Changing handedness must retain one ray origin per controller and preserve
  // primary-only native interactions while industrial controls remain bilateral.
  f.ctx.raycontrol.changeHandedness('left'); press(f, 'powerOn', f.right); press(f, 'powerOff', f.left);
  const beforeNative = Object.assign({}, f.native);
  aim(f, f.left, f.portal.getWorldPosition(new THREE.Vector3())); select(f, f.left, 'selectstart'); select(f, f.left, 'selectend');
  Object.keys(f.native).forEach(key => assert.equal(f.native[key], beforeNative[key] + 1));
  away(f, f.left); f.ctx.raycontrol.changeHandedness('right');
  // A tracked pointer without the app's optional animated trigger model still
  // reaches the production input bridge and releases its captured selection.
  const trigger = f.right.getObjectByName('trigger'); trigger.parent.remove(trigger); press(f, 'powerOn', f.right); press(f, 'powerOff', f.right);

  const obscuredProduct = f.runtime.products.get(f.cartons[0]), obscuredCenter = obscuredProduct.bounds.getCenter(new THREE.Vector3()).applyMatrix4(f.cartons[0].matrixWorld);
  aim(f, f.left, obscuredCenter); const productWall = wall(f, obscuredCenter.clone().add(new THREE.Vector3(0, 0, 0.35))); advance(f);
  select(f, f.left, 'selectstart'); select(f, f.left, 'selectend'); advance(f);
  assert.equal(obscuredProduct.heldBy, null, 'A real ray cannot pick up a product through a solid wall.'); removeWall(f, productWall);
  const firstBasis = basis(f.cartons[0]), secondBasis = basis(f.cartons[1]);
  const first = pickup(f, f.cartons[0], f.left), second = pickup(f, f.cartons[1], f.right);
  assert.equal(f.runtime.held.size, 2, 'Two hands can independently hold two different boxes.');
  assert.equal(f.runtime.productFeedback.disposed, false); assert.equal(f.runtime.productFeedback.root.parent, f.scene);
  assert.equal(f.runtime.productFeedback.bindings.size, 2, 'The live product-feedback instance tracks both held boxes after start.');
  assert(f.runtime.productFeedback.bindings.get(first.object).held && f.runtime.productFeedback.bindings.get(second.object).held);
  f.left.position.add(new THREE.Vector3(0.4, 0.2, 0)); f.left.rotation.set(0.8, -0.4, 0.3);
  f.right.position.add(new THREE.Vector3(-0.2, 0.35, 0.1)); f.right.rotation.set(-0.7, 0.6, -0.45); advance(f, 0.1);
  unchangedBasis(f.cartons[0], firstBasis); unchangedBasis(f.cartons[1], secondBasis);
  // Move a hand rapidly through a thin wall. The box must remain on its
  // original side even though the tracked controller itself has no constraint.
  const previousBox = first.bounds.clone().applyMatrix4(first.object.matrixWorld), previousCenter = previousBox.getCenter(new THREE.Vector3());
  const barrier = wall(f, previousCenter.clone().add(new THREE.Vector3(0, 0, -0.65)), 2.5, 3);
  f.left.position.z -= 1.8; advance(f, 0.1);
  const stoppedBox = first.bounds.clone().applyMatrix4(first.object.matrixWorld), wallBox = new THREE.Box3().setFromObject(barrier);
  assert(stoppedBox.min.z >= wallBox.max.z - 0.005, 'A held XR box cannot cross a solid wall when its tracked hand crosses it.');
  unchangedBasis(f.cartons[0], firstBasis); removeWall(f, barrier);
  // The next own trigger releases the held product through the actual adapter
  // even when the controller is now aiming into empty space.
  away(f, f.left); const beforeDropNative = Object.assign({}, f.native);
  select(f, f.left, 'selectstart'); select(f, f.left, 'selectstart'); select(f, f.left, 'selectend'); advance(f);
  assert.equal(first.heldBy, null); assert.equal(second.heldBy, f.right);
  assert.deepEqual(f.native, beforeDropNative, 'A duplicate trigger-down/drop cycle cannot regrab a box or leak a native background release.');
  const releasedFeedback = f.runtime.productFeedback.bindings.get(first.object);
  assert(releasedFeedback && !releasedFeedback.held && releasedFeedback.remaining > 0, 'Releasing through the actual trigger produces the short green release feedback.');
  // A second hand cannot release or steal a box owned by the other controller.
  aim(f, f.left, second.bounds.getCenter(new THREE.Vector3()).applyMatrix4(second.object.matrixWorld));
  select(f, f.left, 'selectstart'); select(f, f.left, 'selectend'); advance(f);
  assert.equal(second.heldBy, f.right); assert.equal(f.runtime.held.get(f.right), second);
  disconnect(f, f.right); advance(f);
  assert.equal(second.heldBy, null); assert.equal(f.cartons[1].industrialHeld, undefined); assert.equal(f.runtime.held.size, 0);
  assert.equal(f.ctx.raycontrol.controllers.filter(data => data.controller === f.right).length, 0, 'The actual WebXR disconnected event unregisters its controller.');
  connect(f, f.right); connect(f, f.right);
  assert.equal(f.ctx.raycontrol.controllers.filter(data => data.controller === f.right).length, 1, 'Repeated connection notifications never duplicate action dispatch.');
  assert.equal(f.right.children.filter(node => node.name === 'raycasterContext').length, 1);

  // Captured physical buttons cannot remain pushed after controller loss.
  const paused = button(f, 'pause'); aim(f, f.left, paused.cap.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(0, 0, 1).transformDirection(paused.object.matrixWorld));
  select(f, f.left, 'selectstart'); advance(f, 0.08); assert(f.runtime.getControlFeedback(paused.id).pressed);
  disconnect(f, f.left); advance(f, 0.3); assert(!f.runtime.getControlFeedback(paused.id).pressed); close(paused.cap.position.z, 0.025, 0.0001); connect(f, f.left);

  // Deposit an authored box with a tracked hand. Lift across the frame, lower
  // onto the physical rollers, then release through the same trigger bridge.
  const deposited = pickup(f, f.cartons[0], f.left), conveyor = f.runtime.records.get(f.head.userData.editorId).components.conveyor;
  f.left.rotation.set(0, 0, 0); f.left.position.y = 2.5; advance(f, 0.15);
  f.left.position.set(-0.9, 2.5, 0.35); advance(f, 0.15);
  const depositY = f.head.getWorldPosition(new THREE.Vector3()).y + conveyor.top + deposited.bounds.getSize(new THREE.Vector3()).y * deposited.scale.y / 2 + 0.025;
  f.left.position.y = depositY + 0.025; advance(f, 0.15);
  const entries = vars(f).entryCount;
  select(f, f.left, 'selectstart'); select(f, f.left, 'selectend'); advance(f);
  assert.equal(deposited.heldBy, null); assert.equal(deposited.item.beltId, f.head.userData.editorId);
  assert.equal(deposited.item.mesh, f.cartons[0], 'Manual XR insertion retains the authored product identity.');
  assert.equal(vars(f).entryCount, entries + 1, 'A manual tracked-hand deposit emits one entry event.');
  const sameBox = pickup(f, f.cartons[0], f.left); select(f, f.left, 'selectstart'); select(f, f.left, 'selectend'); advance(f);
  assert.equal(sameBox.item.mesh, f.cartons[0]); assert.equal(vars(f).entryCount, entries + 1, 'Repositioning the same tracked product never duplicates its entry count.');

  // Both directions of input-mode change must clear old hands before the next
  // desktop/immersive frame. The production SceneEditor hook calls that API.
  pickup(f, f.cartons[0], f.left); pickup(f, f.cartons[1], f.right);
  f.ctx.vrMode = false; editorVRChange(f, false); advance(f);
  assert.equal(f.runtime.held.size, 0); assert.equal(first.heldBy, null); assert.equal(second.heldBy, null);
  assert(!f.cartons.some(object => object.industrialHeld));
  f.ctx.vrMode = true; editorVRChange(f, true);
  pickup(f, f.cartons[0], f.left); f.ctx.raycontrol.disable(); advance(f);
  assert.equal(f.runtime.held.size, 0, 'Disabling interaction for an editor/session transition releases held objects.');
  f.ctx.raycontrol.enable(); pickup(f, f.cartons[1], f.right);
  f.visuals.dispose(); f.runtime.stop(); f.ctx.editor.active = true;
  assert.equal(f.runtime.held.size, 0); assert.equal(f.ctx.raycontrol.onSelectStart, originalSelect);
  assert.equal(f.ctx.raycontrol.states['native-portal'], f.nativeState); assert.equal(f.ctx.raycontrol.states['native-background'], f.nativeBackground);
  assert.equal(f.nativeState.onSelectStart, nativeStarts); assert.equal(f.nativeState.onSelectEnd, nativeEnds);
  assert(f.ctx.raycontrol.currentStates.includes(f.nativeState)); assert(f.ctx.raycontrol.currentStates.includes(f.nativeBackground));
  assert(!Object.keys(f.ctx.raycontrol.states).some(name => name.startsWith(f.runtime.statePrefix)), 'Stopping removes every owned industrial input state.');
  Object.entries(f.ctx.raycontrol._listeners).forEach(([key, entries]) => assert.equal(entries.length, listenerCounts[key] || 0, 'No runtime controller listener leaks after stop: ' + key));
  assert.equal((f.ctx.renderer.domElement._listeners.wheel || []).length, 0, 'The canvas wheel adapter is removed on editor return.');
  assert.equal(f.runtime.productFeedback.bindings.size, 0, 'Private held/released outlines are removed with the play session.');
  assert.equal(JSON.stringify(await f.document.serialize()), authored, 'XR actions restore all authored transforms, control properties and references exactly on leaving play.');
  for (let index = 0; index < 3; index++) {
    f.ctx.editor.active = false; f.runtime.start('hall'); advance(f); pickup(f, f.cartons[index % 2], index % 2 ? f.right : f.left);
    assert.equal(f.runtime.productFeedback.root.parent, f.scene); assert.equal(f.runtime.productFeedback.bindings.size, 1);
    f.visuals.dispose(); f.runtime.stop();
    assert.equal(f.runtime.productFeedback.root.parent, null); assert.equal(f.runtime.productFeedback.bindings.size, 0);
    assert(!f.scene.children.some(object => object.name === 'Feedback de productos'), 'Repeated play sessions cannot leak private product-feedback roots.');
    assert.equal(JSON.stringify(await f.document.serialize()), authored);
  }
  // Spawned packages have an intentionally private simulation-helper root.
  // That root is still a physical manipulable product, so the feedback system
  // must outline its own real geometry rather than excluding the entire box.
  const spawned = setup(); spawned.runtime.start('hall'); advance(spawned);
  press(spawned, 'powerOn', spawned.left); press(spawned, 'start', spawned.right);
  press(spawned, 'insertBox', spawned.left); press(spawned, 'stop', spawned.right);
  const generated = Array.from(spawned.runtime.products.values()).find(product => !product.record && product.item && product.item.beltId === spawned.head.userData.editorId);
  assert(generated, 'The actual panel creates a new runtime package.');
  assert.equal(generated.object.userData.editorRuntimeHelper, true); assert.equal(generated.object.userData.editorCollisionBody, true);
  pickup(spawned, generated.object, spawned.left);
  const generatedOutline = spawned.runtime.productFeedback.bindings.get(generated.object);
  assert(generatedOutline && generatedOutline.held && generatedOutline.helper.visible, 'A spawned package picked up through the actual XR ray shows its cyan held outline.');
  assert(!generatedOutline.bounds.isEmpty(), 'Runtime-helper metadata cannot hide the generated product body from feedback measurement.');
  select(spawned, spawned.left, 'selectstart'); select(spawned, spawned.left, 'selectend'); advance(spawned);
  assert(!generatedOutline.held && generatedOutline.helper.visible, 'The generated package also shows its short release outline.');
  spawned.visuals.dispose(); spawned.runtime.stop();
  assert.equal(spawned.runtime.productFeedback.bindings.size, 0);
  // Every new mechanism reuses the original nine real controls, on both rays.
  // No extra UI command substitutes for the authored physical control events.
  for (const variant of ['roller-motor', 'belt-incline', 'popup-belt', 'roller-turntable', 'pusher', 'roller-zones', 'box-elevator', 'manual-station', 'pallet-chain']) {
    const mechanism = setup(variant), before = JSON.stringify(await mechanism.document.serialize());
    mechanism.runtime.start('hall'); advance(mechanism);
    const actions = mechanism.document.getObjects('hall').filter(object => mechanism.document.getBehaviors(object).some(config => config.type === 'control' && config.targetId === mechanism.head.userData.editorId)).map(object => object.userData.industrialAction).sort();
    assert.deepEqual(actions, ['start', 'stop', 'emergency', 'pause', 'powerOff', 'powerOn', 'speedDown', 'insertBox', 'speedUp'].sort(), variant + ' preserves the exact panel contract.');
    press(mechanism, 'powerOn', mechanism.left); press(mechanism, 'start', mechanism.right); assert(vars(mechanism).running);
    press(mechanism, 'pause', mechanism.left); assert(vars(mechanism).paused);
    press(mechanism, 'start', mechanism.right); assert(!vars(mechanism).paused);
    const speed = vars(mechanism).speed;
    press(mechanism, 'speedUp', mechanism.left); close(vars(mechanism).speed, speed + .1);
    press(mechanism, 'speedDown', mechanism.right); close(vars(mechanism).speed, speed);
    press(mechanism, 'insertBox', mechanism.left);
    assert.equal(vars(mechanism).entryCount, variant === 'pallet-chain' ? 0 : 1, 'The existing insertion helper creates only a compatible unit, never a fictitious pallet.');
    if (variant === 'pallet-chain') { assert.equal(vars(mechanism).pendingInsert, 0); assert(mechanism.notices.some(message => /pallet/.test(message))); }
    press(mechanism, 'stop', mechanism.right); assert(!vars(mechanism).running);
    press(mechanism, 'start', mechanism.left); assert(vars(mechanism).running);
    press(mechanism, 'emergency', mechanism.right); assert(vars(mechanism).emergency && !vars(mechanism).running);
    press(mechanism, 'start', mechanism.left); assert(!vars(mechanism).running);
    press(mechanism, 'emergency', mechanism.right); assert(!vars(mechanism).emergency && !vars(mechanism).running, 'Releasing emergency cannot restart a mechanism.');
    press(mechanism, 'start', mechanism.left); assert(vars(mechanism).running);
    press(mechanism, 'powerOff', mechanism.right); assert(!vars(mechanism).powered && !vars(mechanism).running);
    press(mechanism, 'powerOn', mechanism.left); assert(vars(mechanism).powered && !vars(mechanism).running, 'Restoring power never starts movement.');
    mechanism.visuals.dispose(); mechanism.runtime.stop(); assert.equal(JSON.stringify(await mechanism.document.serialize()), before);
  }
  // Reproduce the source-index reassignment in the shipped Three r112 manager:
  // removing the first hand remaps the surviving source to Group zero and only
  // emits disconnected for the removed source. The app reconciles both Groups
  // before the next ray pass, so the surviving physical hand remains usable.
  const hotplug = setup(), originalRight = hotplug.sources.get(hotplug.right);
  let activeSources = [hotplug.sources.get(hotplug.left), originalRight];
  hotplug.ctx.renderer.xr.getSession = () => ({inputSources: activeSources});
  hotplug.runtime.start('hall'); advance(hotplug);
  activeSources = [originalRight]; disconnect(hotplug, hotplug.left); hotplug.bridge.syncXRControllers();
  const survivor = hotplug.ctx.raycontrol.controllers.find(data => data.controller === hotplug.left);
  assert(survivor && survivor.inputSource === originalRight, 'The surviving physical right source is rebound to the Group used by Three r112');
  assert(!hotplug.ctx.raycontrol.controllers.some(data => data.controller === hotplug.right), 'Its old indexed Group cannot retain stale rays or held captures');
  hotplug.sources.set(hotplug.left, originalRight);
  press(hotplug, 'powerOn', hotplug.left); press(hotplug, 'start', hotplug.left); assert(vars(hotplug).running);
  const survivorData = hotplug.ctx.raycontrol.controllers[0]; hotplug.bridge.syncXRControllers();
  assert.equal(hotplug.ctx.raycontrol.controllers[0], survivorData, 'Stable source snapshots never reconnect or duplicate the same hand');
  activeSources = []; hotplug.bridge.syncXRControllers(); assert.equal(hotplug.ctx.raycontrol.controllers.length, 0);
  activeSources = [originalRight]; hotplug.bridge.syncXRControllers(); press(hotplug, 'powerOff', hotplug.left); assert(!vars(hotplug).powered);
  hotplug.visuals.dispose(); hotplug.runtime.stop();
  console.log('Industrial WebXR: production controller bridge, real bilateral rays/buttons, scoped commands, tactile feedback, native input preservation, two-hand boxes, r112 first-hand hotplug remapping, disconnect/session/editor cleanup and exact document restoration passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
