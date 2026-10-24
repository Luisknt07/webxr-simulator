// Real Three scene graphs and real document serialization; no GPU/VR adapter.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const behaviorSchema = require('../shared/behaviors');
function source(file) { return fs.readFileSync(path.join(__dirname, '../src/editor', file), 'utf8').replace(/^import .*;\r?\n/gm, ''); }
const ProductFeedback = new Function('THREE', source('ProductFeedback.js').replace('export default class ProductFeedback', 'return class ProductFeedback'))(THREE);
const SceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', source('SceneDocument.js').replace('export default class SceneDocument', 'return class SceneDocument'))(THREE, behaviorSchema, () => { throw new Error('This test does not instantiate industrial prefabs.'); });
function near(a, b, epsilon = 0.000001) { assert(Math.abs(a - b) < epsilon, `${a} differs from ${b}`); }
function authored(object) {
  const rows = [];
  object.traverse(node => rows.push({node, parent: node.parent, position: node.position.toArray(), quaternion: node.quaternion.toArray(), scale: node.scale.toArray(), material: node.material, userData: JSON.stringify(node.userData)}));
  return rows;
}
function assertAuthored(rows) {
  rows.forEach(row => {
    assert.strictEqual(row.node.parent, row.parent); assert.deepEqual(row.node.position.toArray(), row.position);
    assert.deepEqual(row.node.quaternion.toArray(), row.quaternion); assert.deepEqual(row.node.scale.toArray(), row.scale);
    assert.strictEqual(row.node.material, row.material); assert.equal(JSON.stringify(row.node.userData), row.userData);
  });
}
async function run() {
  const scene = new THREE.Scene(), room = new THREE.Group(); scene.add(room);
  const document = new SceneDocument({}); document.registerRoom('hall', room);
  const object = document.addPrimitive('hall', 'box');
  const ctx = {scene, editor: {active: false, simulation: {running: true}}};
  const feedback = new ProductFeedback(ctx);
  const before = await document.serialize(), state = authored(object);
  const originalCount = document.getObjects('hall').length;
  assert(feedback.hold(object));
  const entry = feedback.bindings.get(object);
  assert(entry && entry.held && entry.helper.visible);
  assert.equal(entry.helper.material.color.getHexString(), '50d9ff');
  assert.equal(entry.helper.material.depthTest, true);
  assert(feedback.root.parent === scene && entry.helper.parent === feedback.root);
  ['editorHelper', 'editorRuntimeHelper', 'editorNonCollidable'].forEach(key => {
    assert.equal(entry.helper.userData[key], true); assert.equal(feedback.root.userData[key], true);
    assert.equal(Object.getOwnPropertyDescriptor(entry.helper.userData, key).enumerable, false);
  });
  const material = object.children[0].material, geometry = object.children[0].geometry;
  const hadBounds = geometry.boundingBox;
  feedback.update(0.016);
  assert.strictEqual(geometry.boundingBox, hadBounds, 'Measuring an outline must not add/change authored geometry caches.');
  assert.strictEqual(object.children[0].material, material);
  assertAuthored(state);
  assert.equal(document.getObjects('hall').length, originalCount);
  assert.deepEqual(await document.serialize(), before, 'Temporary feedback must never leak into project saves.');
  assert(feedback.hold(object)); assert.equal(feedback.bindings.size, 1, 'Repeated hold calls reuse a binding and its GPU resources.');
  assert.strictEqual(feedback.bindings.get(object).helper, entry.helper);
  const helperHits = [];
  entry.helper.raycast(new THREE.Raycaster(), helperHits);
  assert.equal(helperHits.length, 0, 'An outline must not intercept native interaction rays.');

  object.position.set(3, 2, -4); object.rotation.y = 0.6; object.scale.set(0.4, 0.6, 0.8);
  feedback.update(0.016);
  const bounds = new THREE.Box3().setFromObject(object);
  near(entry.bounds.min.x, bounds.min.x - 0.006); near(entry.bounds.max.z, bounds.max.z + 0.006);
  const helperCenter = entry.helper.getWorldPosition(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
  near(helperCenter.x, center.x); near(helperCenter.y, center.y); near(helperCenter.z, center.z);
  scene.position.set(2, 1, -3); scene.rotation.y = 0.45; scene.scale.set(1.2, 0.8, 1.3);
  feedback.update(0.016);
  const transformedCenter = new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3());
  const transformedHelper = entry.helper.getWorldPosition(new THREE.Vector3());
  near(transformedCenter.x, transformedHelper.x); near(transformedCenter.y, transformedHelper.y); near(transformedCenter.z, transformedHelper.z);
  object.visible = false; feedback.update(0.016); assert.equal(entry.helper.visible, false);
  object.visible = true; ctx.editor.active = true; feedback.update(0.016); assert.equal(feedback.root.visible, false);
  ctx.editor.active = false; ctx.editor.simulation.running = false; feedback.update(0.016); assert.equal(feedback.root.visible, false);
  ctx.editor.simulation.running = true; feedback.update(0.016); assert.equal(entry.helper.visible, true);

  let geometryDisposed = 0, materialDisposed = 0;
  entry.helper.geometry.addEventListener('dispose', () => geometryDisposed++);
  entry.helper.material.addEventListener('dispose', () => materialDisposed++);
  assert(feedback.release(object)); assert.equal(entry.helper.material.color.getHexString(), '42e4a4');
  assert.equal(feedback.release(object), false, 'Repeated release events cannot extend a flash forever.');
  feedback.update(0.09); near(entry.helper.material.opacity, 0.475);
  feedback.hold(object); feedback.update(0.2); assert.equal(feedback.bindings.size, 1, 'Picking up again cancels the release timeout.');
  feedback.release(object); feedback.update(0.18);
  assert.equal(feedback.bindings.size, 0); assert.equal(geometryDisposed, 1); assert.equal(materialDisposed, 1);
  assert.equal(entry.helper.parent, null);
  assert.equal(feedback.remove(object), false);

  const loose = new THREE.Mesh(new THREE.BoxBufferGeometry(0.25, 0.25, 0.25), new THREE.MeshStandardMaterial()); scene.add(loose);
  assert.equal(loose.geometry.boundingBox, null); feedback.hold(loose); feedback.update(0.016); assert.equal(loose.geometry.boundingBox, null);
  scene.remove(loose); feedback.update(0.016); assert.equal(feedback.bindings.size, 0, 'Removing a product removes its outline immediately.');
  const generated = new THREE.Mesh(loose.geometry, loose.material);
  generated.userData.editorRuntimeHelper = true; generated.userData.editorCollisionBody = true;
  const privateChild = new THREE.Mesh(new THREE.BoxBufferGeometry(10, 10, 10), loose.material);
  privateChild.userData.editorRuntimeHelper = true; generated.add(privateChild); scene.add(generated);
  assert(feedback.hold(generated)); feedback.update(0.016);
  const generatedEntry = feedback.bindings.get(generated);
  assert(generatedEntry.helper.visible, 'A runtime-generated physical product gets the same held outline as an authored box.');
  const generatedBodyBounds = new THREE.Box3().setFromBufferAttribute(generated.geometry.attributes.position).applyMatrix4(generated.matrixWorld);
  near(generatedEntry.bounds.min.x, generatedBodyBounds.min.x - 0.006);
  near(generatedEntry.bounds.max.z, generatedBodyBounds.max.z + 0.006);
  assert(feedback.release(generated)); feedback.update(0.18); assert(!feedback.bindings.has(generated));
  privateChild.geometry.dispose(); scene.remove(generated);
  const facade = new THREE.Mesh(new THREE.BoxBufferGeometry(4, 4, 4), loose.material);
  facade.userData.editorGeometryReplaced = true;
  const replacement = new THREE.Mesh(new THREE.BoxBufferGeometry(0.2, 0.3, 0.4), loose.material); facade.add(replacement); scene.add(facade);
  feedback.hold(facade); feedback.update(0.016);
  const replacementBounds = new THREE.Box3().setFromObject(replacement), facadeEntry = feedback.bindings.get(facade);
  near(facadeEntry.bounds.max.x, replacementBounds.max.x + 0.006);
  assert(facadeEntry.helper.visible, 'An overridden product uses its visible replacement, even if the actor mesh itself is marked replaced.');
  feedback.remove(facade);
  const objects = [];
  for (let index = 0; index < 17; index++) { const item = new THREE.Mesh(loose.geometry, loose.material); scene.add(item); objects.push(item); }
  for (let index = 0; index < 16; index++) assert(feedback.hold(objects[index]));
  assert.equal(feedback.hold(objects[16]), false, 'Held bindings have a fixed resource ceiling.');
  feedback.release(objects[0]); assert(feedback.hold(objects[16])); assert.equal(feedback.bindings.size, 16);
  assert(!feedback.bindings.has(objects[0]), 'New holds can evict an old short flash, without evicting a held outline.');
  feedback.update(NaN); feedback.update(-10);
  const helpers = Array.from(feedback.bindings.values()).map(value => value.helper);
  feedback.dispose(); feedback.dispose();
  assert.equal(feedback.bindings.size, 0); assert.equal(feedback.root.parent, null);
  helpers.forEach(helper => assert.equal(helper.parent, null));
  assert.equal(feedback.hold(object), false);
  assert.equal(new ProductFeedback({}).hold(object), false);
  console.log('Product feedback: held/release outlines, moving bounds, transformed scenes, hidden/editor/runtime guards, ray pass-through, bounded allocations, cleanup and unchanged document serialization passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
