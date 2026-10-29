const __layout = require("../../tooling/layout.cjs");
// Real scene geometry and controller transforms. GPU and physical XR hardware
// remain outside this headless check; helpers never enter project documents.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const behaviorSchema = require('../../modules/logistica-industrial/contracts/behaviors.js');
const automationSchema = require('../../modules/logistica-industrial/functions/flujo-materiales/schema/automation.js');
const PalletQueueRuntime = require('../support/load-pallet-queue-runtime.js')(THREE, behaviorSchema);
const ProcessorRuntime = require('../support/load-processor-runtime.js')(THREE, behaviorSchema);
const ProductSourceRuntime = require('../support/load-product-source-runtime')(THREE, behaviorSchema);
const {getGeometryTree} = require('../support/load-geometry-acceleration.js')(THREE);
const ObjectPlacement = require('../support/load-object-placement.js')(THREE);
function source(file) { return fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-product-placement.js"), '..', file)), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''); }
const prefabs = new Function('THREE', 'behaviorSchema', source("modules/logistica-industrial/functions/presentacion/runtime/IndustrialPrefabs.js") + '\nreturn {createIndustrialPrefab,createProductVisual};')(THREE, behaviorSchema);
const SceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', source("packages/project-model/src/SceneDocument.js").replace('default class SceneDocument', 'return class SceneDocument'))(THREE, behaviorSchema, prefabs.createIndustrialPrefab);
const ProductFeedback = new Function('THREE', source("modules/logistica-industrial/functions/flujo-materiales/runtime/ProductFeedback.js").replace('default class ProductFeedback', 'return class ProductFeedback'))(THREE);
const Runtime = new Function('THREE', 'behaviorSchema', 'automationSchema', 'createProductVisual', 'ProductFeedback', 'ObjectPlacement', 'ProductSourceRuntime', 'ProcessorRuntime', 'PalletQueueRuntime', source("modules/logistica-industrial/functions/flujo-materiales/runtime/SimulationRuntime.js").replace('default class SimulationRuntime', 'return class SimulationRuntime'))(THREE, behaviorSchema, automationSchema, prefabs.createProductVisual, ProductFeedback, ObjectPlacement, ProductSourceRuntime, ProcessorRuntime, PalletQueueRuntime);
const CollisionWorld = new Function('THREE', 'getGeometryTree', source("packages/render-three/src/CollisionWorld.js").replace('default class CollisionWorld', 'return class CollisionWorld'))(THREE, getGeometryTree);
function near(a, b, message) { assert(Math.abs(a - b) < 0.00001, message || `${a} != ${b}`); }
function basis(matrix) { return [0, 1, 2, 4, 5, 6, 8, 9, 10].map(index => matrix.elements[index]); }
async function run() {
  const scene = new THREE.Scene(), root = new THREE.Group(); scene.add(root);
  const table = new THREE.Mesh(new THREE.BoxBufferGeometry(2, 0.1, 2), new THREE.MeshStandardMaterial()); table.position.y = 0.95; root.add(table);
  const floor = new THREE.Mesh(new THREE.BoxBufferGeometry(30, 0.05, 30), new THREE.MeshBasicMaterial()); floor.position.y = -0.025; root.add(floor);
  const document = new SceneDocument({}); document.registerRoom('hall', root);
  const box = document.addPrefab('hall', 'product'), second = document.addPrefab('hall', 'product');
  document.setTransform(box, {position: [0, 1.7, 0], rotation: [0, 0.3, 0]});
  document.setTransform(second, {position: [3, 1.4, 0]});
  const left = new THREE.Group(), right = new THREE.Group(); scene.add(left, right);
  const ctx = {scene, vrMode: true, editor: {active: false}};
  ctx.collisionWorld = new CollisionWorld(ctx, document);
  const runtime = new Runtime(ctx, document);
  scene.updateMatrixWorld(true);
  const authored = await document.serialize();
  runtime.start('hall');
  const product = runtime.products.get(box), other = runtime.products.get(second);
  assert(runtime.pickupProduct(product, left));
  const initialBasis = basis(box.matrixWorld);
  let candidate = runtime.updateProductPlacement(product, left);
  assert(candidate && candidate.target === table && !candidate.snapped, 'A nearby top surface offers a yellow destination before it enters magnetic reach.');
  let entry = runtime.productFeedback.bindings.get(box);
  assert(entry.destination.visible && entry.surface.visible);
  assert.equal(entry.destination.material.color.getHexString(), 'ffd34a');
  assert.equal(entry.surface.material.color.getHexString(), 'ffd34a');
  assert.equal(entry.destination.userData.editorNonCollidable, true);
  assert.equal(Object.keys(entry.destination.userData).length, 0, 'Placement outlines have no serializable authored metadata.');
  near(box.matrixWorld.elements[13], 1.7, 'Preview does not pull a held box away from its controller/reticle.');
  const destination = entry.destination, surface = entry.surface;
  runtime.setProductMatrix(product, box.matrixWorld.clone().setPosition(new THREE.Vector3(0, 1.31, 0)));
  candidate = runtime.updateProductPlacement(product, left);
  assert(candidate && candidate.snapped); assert.equal(entry.destination.material.color.getHexString(), '42e4a4');
  assert.strictEqual(entry.destination, destination); assert.strictEqual(entry.surface, surface, 'A moving preview reuses two bounded helpers.');
  assert(runtime.releaseProduct(product));
  near(product.bounds.clone().applyMatrix4(box.matrixWorld).min.y, 1.003, 'Release places the box on the table with a narrow collision clearance.');
  assert.deepEqual(basis(box.matrixWorld), initialBasis, 'Magnetic placement translates without changing the held world basis.');
  assert(!entry.destination.visible && !entry.surface.visible);
  assert.equal(ctx.collisionWorld.testBox(product.bounds.clone().applyMatrix4(box.matrixWorld), {ignore: [box]}), false);

  // A second box is a physical stacking support, rather than a fixed joint:
  // the top one can immediately be picked up and moved away again.
  runtime.setProductMatrix(other, second.matrixWorld.clone().setPosition(new THREE.Vector3(0, 1.6, 0)));
  assert(runtime.pickupProduct(other, right));
  candidate = runtime.updateProductPlacement(other, right);
  assert(candidate && candidate.snapped && candidate.target !== table);
  assert(runtime.releaseProduct(other));
  const lower = product.bounds.clone().applyMatrix4(box.matrixWorld), upper = other.bounds.clone().applyMatrix4(second.matrixWorld);
  assert(upper.min.y >= lower.max.y - 0.001 && upper.min.y <= lower.max.y + 0.006,
    'Stacking rests on the real box top, allowing the millimetric decorative tape above its broad support face.');
  assert(runtime.pickupProduct(other, right));
  runtime.setProductMatrix(other, second.matrixWorld.clone().setPosition(new THREE.Vector3(4, 4, 4)));
  assert.equal(runtime.updateProductPlacement(other, right), null);
  const otherEntry = runtime.productFeedback.bindings.get(second);
  assert(!otherEntry.destination.visible && !otherEntry.surface.visible, 'Moving away clears the proposed contact immediately.');

  // Both hands can hold products; the industrialHeld flag must not make one
  // hand's box disappear from the other hand's dynamic collision checks.
  assert(runtime.pickupProduct(product, left));
  runtime.setProductMatrix(product, box.matrixWorld.clone().setPosition(new THREE.Vector3(0, 1.31, 0)));
  runtime.setProductMatrix(other, second.matrixWorld.clone().setPosition(new THREE.Vector3(1.5, 1.31, 0)));
  left.position.set(0, 1.335, 0.35); right.position.copy(left.position);
  scene.updateMatrixWorld(true);
  runtime.updateHeldProducts();
  const heldLower = product.bounds.clone().applyMatrix4(box.matrixWorld), heldOther = other.bounds.clone().applyMatrix4(second.matrixWorld);
  assert(!heldLower.clone().expandByScalar(-0.003).intersectsBox(heldOther.clone().expandByScalar(-0.003)), 'A second held product cannot be dragged through the first hand\'s box.');
  const options = runtime.productCollisionOptions(product, left);
  assert(options.extraBoxes.some(bounds => bounds.equals(heldOther)), 'Other held boxes remain explicit dynamic collision bodies.');
  runtime.onInputModeChange();
  assert.equal(runtime.held.size, 0);
  runtime.productFeedback.bindings.forEach(value => { if (value.destination) assert(!value.destination.visible && !value.surface.visible); });
  runtime.stop();
  assert.equal(runtime.productFeedback.root.parent, null);
  assert.deepEqual(await document.serialize(), authored, 'Simulation previews, drops, stacks and input cleanup restore the saved document exactly.');
  console.log('Product placement: yellow/ready ghost supports, bounded helper reuse, table/box stacking, unmodified pickup basis, moving away, two-hand collisions, cleanup and exact document restoration passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
