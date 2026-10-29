const __layout = require("../../tooling/layout.cjs");
// Real Three.js transforms, prefab products, document restoration and collision
// geometry. The wheel EventTarget is the browser-input boundary adapted here.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const ObjectPlacement = require('../support/load-object-placement')(THREE);
const behaviorSchema = require('../../modules/logistica-industrial/contracts/behaviors.js');
const automationSchema = require('../../modules/logistica-industrial/functions/flujo-materiales/schema/automation.js');
const PalletQueueRuntime = require('../support/load-pallet-queue-runtime.js')(THREE, behaviorSchema);
const ProcessorRuntime = require('../support/load-processor-runtime.js')(THREE, behaviorSchema);
const ProductSourceRuntime = require('../support/load-product-source-runtime')(THREE, behaviorSchema);
const {getGeometryTree} = require('../support/load-geometry-acceleration.js')(THREE);
function source(file) { return fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-product-handling.js"), '..', file)), 'utf8').replace(/^\uFEFF/, '').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''); }
const prefabs = new Function('THREE', 'behaviorSchema', source("modules/logistica-industrial/functions/presentacion/runtime/IndustrialPrefabs.js") + '\nreturn {createIndustrialPrefab,createProductVisual};')(THREE, behaviorSchema);
const SceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', source("packages/project-model/src/SceneDocument.js").replace('default class SceneDocument', 'return class SceneDocument'))(THREE, behaviorSchema, prefabs.createIndustrialPrefab);
const ProductFeedback = new Function('THREE', source("modules/logistica-industrial/functions/flujo-materiales/runtime/ProductFeedback.js").replace('default class ProductFeedback', 'return class ProductFeedback'))(THREE);
const Runtime = new Function('THREE', 'behaviorSchema', 'automationSchema', 'createProductVisual', 'ProductFeedback', 'ObjectPlacement', 'ProductSourceRuntime', 'ProcessorRuntime', 'PalletQueueRuntime', source("modules/logistica-industrial/functions/flujo-materiales/runtime/SimulationRuntime.js").replace('default class SimulationRuntime', 'return class SimulationRuntime'))(THREE, behaviorSchema, automationSchema, prefabs.createProductVisual, ProductFeedback, ObjectPlacement, ProductSourceRuntime, ProcessorRuntime, PalletQueueRuntime);
const CollisionWorld = new Function('THREE', 'getGeometryTree', source("packages/render-three/src/CollisionWorld.js").replace('default class CollisionWorld', 'return class CollisionWorld'))(THREE, getGeometryTree);

function inputTarget() {
  const listeners = [];
  const capture = options => typeof options === 'boolean' ? options : !!(options && options.capture);
  return {clientHeight: 800, listeners,
    addEventListener(type, callback, options) {
      if (!listeners.some(entry => entry.type === type && entry.callback === callback && entry.capture === capture(options))) listeners.push({type, callback, capture: capture(options), options});
    },
    removeEventListener(type, callback, options) {
      const index = listeners.findIndex(entry => entry.type === type && entry.callback === callback && entry.capture === capture(options));
      if (index !== -1) listeners.splice(index, 1);
    },
    wheel(values = {}) {
      const event = Object.assign({type: 'wheel', deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, defaultPrevented: false, propagationStopped: false,
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; }}, values);
      listeners.slice().sort((a, b) => Number(b.capture) - Number(a.capture)).forEach(entry => { if (entry.type === 'wheel') entry.callback(event); });
      return event;
    }
  };
}
function setup() {
  const scene = new THREE.Scene(), root = new THREE.Group(); scene.add(root);
  root.position.set(1, 0, -1); root.rotation.y = 0.3; root.scale.set(1.1, 1, 0.9);
  const floor = new THREE.Mesh(new THREE.BoxBufferGeometry(60, 0.05, 60), new THREE.MeshBasicMaterial()); floor.position.y = -0.025; root.add(floor);
  const document = new SceneDocument({}); document.registerRoom('hall', root);
  const carton = document.addPrefab('hall', 'product');
  document.setTransform(carton, {position: [-4, 1.4, -5], rotation: [-0.15, 0.5, 0.25]});
  // Imported products commonly have their pivot away from the visible body.
  // Offset the complete visual, including its children, to exercise that case.
  carton.children[0].position.set(0.31, -0.09, 0.18);
  scene.updateMatrixWorld(true);
  const camera = new THREE.PerspectiveCamera(); camera.position.copy(carton.getWorldPosition(new THREE.Vector3())).add(new THREE.Vector3(0.3, 0.2, 0.8)); scene.add(camera);
  const desktop = new THREE.Group(); desktop.userData.isDesktop = true; desktop.position.set(0.2, -0.2, -0.45); camera.add(desktop);
  const xr = new THREE.Group(); scene.add(xr);
  const target = inputTarget(), nativeWheels = [];
  const nativeWheel = event => nativeWheels.push(event); target.addEventListener('wheel', nativeWheel, false);
  const nativeSelect = () => {}, raycontrol = {states: {}, onSelectStart: nativeSelect, addState(name, state) { this.states[name] = state; }, activateState() {}, deactivateState() {}};
  const ctx = {scene, camera, desktopController: desktop, controllers: [xr], renderer: {domElement: target}, raycontrol, vrMode: false, editor: {active: false}};
  ctx.collisionWorld = new CollisionWorld(ctx, document);
  const runtime = new Runtime(ctx, document);
  return {scene, root, carton, camera, desktop, xr, document, runtime, ctx, target, nativeWheels, nativeSelect, nativeWheel};
}
function advance(f, seconds = 1 / 60) {
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) {
    f.scene.updateMatrixWorld(true); f.ctx.collisionWorld.beginFrame(); f.runtime.execute(Math.min(1 / 60, seconds - t)); f.ctx.collisionWorld.endFrame();
  }
}
function reach(f) {
  f.scene.updateMatrixWorld(true);
  const local = productCenter(f).sub(f.camera.getWorldPosition(new THREE.Vector3()))
    .applyQuaternion(f.camera.getWorldQuaternion(new THREE.Quaternion()).inverse());
  // Keep wheel-distance assertions separate from the 45 cm desktop base reach.
  return -local.z - 0.45;
}
function productCenter(f) {
  const product = f.runtime.products.get(f.carton);
  return product.bounds.getCenter(new THREE.Vector3()).applyMatrix4(f.carton.matrixWorld);
}
function centered(f) {
  f.scene.updateMatrixWorld(true);
  const projected = productCenter(f).project(f.camera);
  close(projected.x, 0, 'The visible bounding-box center stays on the horizontal reticle axis.');
  close(projected.y, 0, 'The visible bounding-box center stays on the vertical reticle axis.');
  assert(projected.z > -1 && projected.z < 1, 'The held product remains in front of the camera inside its visible depth range.');
}
function orientation(f) { return f.carton.getWorldQuaternion(new THREE.Quaternion()).normalize(); }
function matrixBasis(f) {
  f.carton.updateWorldMatrix(true, false);
  const values = f.carton.matrixWorld.elements;
  return [0, 1, 2, 4, 5, 6, 8, 9, 10].map(index => values[index]);
}
function close(actual, expected, message) { assert(Math.abs(actual - expected) < 1e-7, message || actual + ' != ' + expected); }
function unchangedOrientation(f, expectedQuaternion, expectedBasis) {
  assert(orientation(f).angleTo(expectedQuaternion) < 1e-7, 'A held box keeps its pickup world orientation independently of camera or controller pitch, yaw and roll.');
  matrixBasis(f).forEach((value, index) => close(value, expectedBasis[index], 'Holding preserves the exact world basis, including the authored parent scale.'));
}
function wheel(f, values) {
  const event = f.target.wheel(values); advance(f);
  const product = f.runtime.products.get(f.carton);
  if (product && product.heldBy === f.desktop && !f.ctx.vrMode) centered(f);
  return event;
}

async function run() {
  const f = setup(), before = JSON.stringify(await f.document.serialize());
  f.runtime.start('hall');
  assert.equal(f.target.listeners.filter(entry => entry.type === 'wheel').length, 2, 'Runtime adds one product listener beside the preexisting camera/page listener.');
  const productListener = f.target.listeners.find(entry => entry.callback !== f.nativeWheel);
  assert.equal(productListener.options.passive, false, 'The held-box listener must be able to consume the browser wheel event.');
  let event = wheel(f, {deltaY: 100});
  assert.equal(event.defaultPrevented, false); assert.equal(event.propagationStopped, false);
  assert.equal(f.nativeWheels.at(-1), event, 'Without a held product the native camera/page wheel path remains available.');
  const product = f.runtime.products.get(f.carton), originalOrientation = orientation(f), originalBasis = matrixBasis(f);
  assert(f.runtime.pickupProduct(product, f.desktop)); advance(f);
  assert(product.bounds.getCenter(new THREE.Vector3()).length() > 0.2, 'The regression uses a genuinely off-center visual pivot.');
  unchangedOrientation(f, originalOrientation, originalBasis); close(reach(f), 0.35); centered(f);
  close(productCenter(f).distanceTo(f.camera.getWorldPosition(new THREE.Vector3())), 0.8, 'Default reach is measured along the camera ray rather than from the offset virtual hand.');
  const firstPosition = f.carton.getWorldPosition(new THREE.Vector3());
  f.camera.position.add(new THREE.Vector3(0.5, 0.4, -0.2)); f.camera.rotation.set(0.65, 0.9, -0.35); advance(f);
  assert(f.carton.getWorldPosition(new THREE.Vector3()).distanceTo(firstPosition) > 0.2, 'The box follows the hand position while retaining its orientation.');
  unchangedOrientation(f, originalOrientation, originalBasis);
  centered(f);
  event = wheel(f, {deltaY: -100}); close(reach(f), 0.23);
  assert(event.defaultPrevented && event.propagationStopped, 'A wheel event moving a held desktop box is consumed.');
  wheel(f, {deltaY: 100}); close(reach(f), 0.35); unchangedOrientation(f, originalOrientation, originalBasis);
  // Leave vertical clearance for the maximum reach while looking down.
  f.camera.position.y += 2; advance(f); centered(f);
  for (let index = 0; index < 30; index++) f.target.wheel({deltaY: 1e9}); advance(f);
  close(reach(f), 3, 'Far-wheel distance clamps to 3 m plus the desktop base, i.e. 3.45 m from the camera.'); centered(f);
  for (let index = 0; index < 30; index++) f.target.wheel({deltaY: -1e9}); advance(f);
  close(reach(f), 0.2, 'Near-wheel distance clamps to 20 cm plus the desktop base, i.e. 65 cm from the camera.'); centered(f);
  for (const values of [{deltaY: 0}, {deltaY: NaN}, {deltaY: Infinity}, {deltaY: 100, ctrlKey: true}, {deltaY: 100, metaKey: true}]) {
    event = wheel(f, values); assert.equal(event.defaultPrevented, false); close(reach(f), 0.2);
  }
  f.ctx.editor.active = true; event = wheel(f, {deltaY: 100}); assert.equal(event.defaultPrevented, false); close(reach(f), 0.2); f.ctx.editor.active = false;
  f.ctx.vrMode = true; event = wheel(f, {deltaY: 100}); assert.equal(event.defaultPrevented, false); close(reach(f), 0.2); f.ctx.vrMode = false;
  wheel(f, {deltaY: 3, deltaMode: 1}); close(reach(f), 0.2 + 3 * 16 * 0.0012);
  wheel(f, {deltaY: 1, deltaMode: 2}); close(reach(f), 0.2 + 3 * 16 * 0.0012 + 400 * 0.0012, 'Page-mode deltas are normalized and capped per event.');

  // Far-wheel requests must stop before a real wall, and near-wheel requests
  // must let the operator pull the same box back away from that obstruction.
  for (let index = 0; index < 30; index++) f.target.wheel({deltaY: -1e9});
  f.camera.rotation.set(0, 0, 0); f.camera.position.set(-4, 1.8, -3); advance(f);
  const cameraPosition = f.camera.getWorldPosition(new THREE.Vector3());
  const wall = new THREE.Mesh(new THREE.BoxBufferGeometry(3, 3, 0.05), new THREE.MeshBasicMaterial());
  f.root.add(wall); wall.matrixAutoUpdate = false;
  const desiredWall = new THREE.Matrix4().makeTranslation(cameraPosition.x, cameraPosition.y, cameraPosition.z - 1.3);
  wall.matrix.copy(new THREE.Matrix4().getInverse(f.root.matrixWorld)).multiply(desiredWall); wall.updateMatrixWorld(true); f.ctx.collisionWorld.invalidate(wall);
  for (let index = 0; index < 30; index++) f.target.wheel({deltaY: 10000}); advance(f, 0.1);
  const boxBounds = product.bounds.clone().applyMatrix4(f.carton.matrixWorld), wallBounds = new THREE.Box3().setFromObject(wall);
  assert(boxBounds.min.z >= wallBounds.max.z - 0.003, 'A far-wheel move cannot push a held product through a physical wall.');
  assert(reach(f) < 1 && reach(f) > 0.2);
  assert.equal(f.ctx.collisionWorld.testBox(boxBounds, {ignore: [f.carton, f.desktop]}), false);
  unchangedOrientation(f, originalOrientation, originalBasis);
  centered(f);
  for (let index = 0; index < 30; index++) f.target.wheel({deltaY: -10000}); advance(f);
  close(reach(f), 0.2, 'The operator can pull the box away from contact.');
  wall.visible = false; f.ctx.collisionWorld.invalidate(wall);
  assert(f.runtime.releaseProduct(product));
  event = wheel(f, {deltaY: 100}); assert.equal(event.defaultPrevented, false);

  // XR uses the same fixed pickup basis, but a mouse wheel never controls its
  // reach, even if a stale XR-held product exists during a desktop transition.
  const xrOrientation = orientation(f), xrBasis = matrixBasis(f);
  f.xr.position.copy(f.carton.getWorldPosition(new THREE.Vector3())).add(new THREE.Vector3(0, 1, 0.35)); f.xr.rotation.set(0.1, 0.3, -0.2);
  assert(f.runtime.pickupProduct(product, f.xr)); f.ctx.vrMode = true; advance(f);
  f.xr.position.add(new THREE.Vector3(0.3, 0.3, -0.1)); f.xr.rotation.set(1.1, 0.7, -0.5); advance(f);
  unchangedOrientation(f, xrOrientation, xrBasis);
  const expectedGrip = new THREE.Vector3(0, -0.025, -0.35).applyMatrix4(f.xr.matrixWorld);
  assert(f.carton.getWorldPosition(new THREE.Vector3()).distanceTo(expectedGrip) < 1e-7, 'XR keeps its actual controller grip instead of snapping the product onto the desktop camera ray.');
  const xrProjection = productCenter(f).project(f.camera);
  assert(Math.hypot(xrProjection.x, xrProjection.y) > 0.1, 'The XR fixture is distinct from desktop reticle centering.');
  let xrPosition = f.carton.getWorldPosition(new THREE.Vector3());
  event = wheel(f, {deltaY: 10000}); assert.equal(event.defaultPrevented, false); assert(f.carton.getWorldPosition(new THREE.Vector3()).distanceTo(xrPosition) < 1e-7);
  f.ctx.vrMode = false; xrPosition = f.carton.getWorldPosition(new THREE.Vector3());
  event = wheel(f, {deltaY: -10000}); assert.equal(event.defaultPrevented, false); assert(f.carton.getWorldPosition(new THREE.Vector3()).distanceTo(xrPosition) < 1e-7);
  f.runtime.stop();
  assert.equal(f.ctx.raycontrol.onSelectStart, f.nativeSelect);
  assert.equal(f.target.listeners.filter(entry => entry.type === 'wheel').length, 1, 'Stopping removes only the runtime listener with its matching capture flag.');
  event = f.target.wheel({deltaY: 100}); assert.equal(event.defaultPrevented, false); assert.equal(f.nativeWheels.at(-1), event);
  assert.equal(JSON.stringify(await f.document.serialize()), before, 'Holding, zooming and XR motion must not persist authored poses or input metadata.');
  f.runtime.start('hall'); assert.equal(f.target.listeners.filter(entry => entry.type === 'wheel').length, 2);
  f.runtime.stop(); assert.equal(f.target.listeners.filter(entry => entry.type === 'wheel').length, 1, 'Repeated play cycles never accumulate wheel handlers.');
  console.log('Product handling: off-pivot products centered on the desktop reticle under camera movement/wheel input, exact world basis, bounded reach, physical walls, XR controller grip, wheel exclusions, input lifecycle and authored restoration passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
