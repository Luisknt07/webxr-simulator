// Surface assembly uses the actual collision world and editable project graph.
// No browser, database, saved project or VR device is modified.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const behaviorSchema = require('../shared/behaviors.js');
const {getGeometryTree} = require('./load-geometry-acceleration')(THREE);
const read = file => fs.readFileSync(path.join(__dirname, '../src/', file), 'utf8').replace(/^import .*;\r?\n/gm, '');
const createIndustrialPrefab = new Function('THREE', 'behaviorSchema', read('editor/IndustrialPrefabs.js')
  .replace(/export const /g, 'const ').replace(/export function /g, 'function ') + '\nreturn createIndustrialPrefab;')(THREE, behaviorSchema);
const SceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', read('editor/SceneDocument.js')
  .replace('export default class SceneDocument', 'return class SceneDocument'))(THREE, behaviorSchema, createIndustrialPrefab);
const CollisionWorld = new Function('THREE', 'getGeometryTree', read('lib/CollisionWorld.js')
  .replace('export default class CollisionWorld', 'return class CollisionWorld'))(THREE, getGeometryTree);
const ObjectPlacement = new Function('THREE', read('lib/ObjectPlacement.js')
  .replace('export default class ObjectPlacement', 'return class ObjectPlacement'))(THREE);
const ObjectAssembly = new Function('THREE', 'ObjectPlacement', read('editor/ObjectAssembly.js')
  .replace('export default class ObjectAssembly', 'return class ObjectAssembly'))(THREE, ObjectPlacement);
const v = (x, y, z) => new THREE.Vector3(x, y, z);
const near = (a, b, label = '') => assert(Math.abs(a - b) < 0.004, `${label}: ${a} != ${b}`);

function fixture() {
  const scene = new THREE.Scene(), root = new THREE.Group(); scene.add(root);
  const floor = new THREE.Mesh(new THREE.BoxBufferGeometry(50, 0.1, 50), new THREE.MeshBasicMaterial());
  floor.name = 'Suelo'; floor.position.y = -0.05; root.add(floor);
  const document = new SceneDocument({}); document.registerRoom('hall', root);
  const collisionWorld = new CollisionWorld({}, document); collisionWorld.setRoom('hall');
  const messages = [], editor = {document, root, roomId: 'hall', collisionWorld, hooks: {renderScene: scene},
    assemblyMessage: value => messages.push(value)};
  return {scene, root, floor, document, collisionWorld, editor, messages, assembly: new ObjectAssembly(editor)};
}
function box(f, position, scale = [1, 1, 1]) {
  const object = f.document.addPrimitive('hall', 'box', '#888888');
  f.document.setTransform(object, {position, scale}); return object;
}
function bounds(object) { object.updateWorldMatrix(true, true); return new THREE.Box3().setFromObject(object); }
function rawPose(f, object, position) { f.document.setTransform(object, {position}); object.updateWorldMatrix(true, true); }

async function run() {
  {
    const f = fixture(), target = box(f, [0, 0.5, 0]), moving = box(f, [0, 1.65, 0]);
    const material = target.children[0].material, quaternion = moving.quaternion.clone(), scale = moving.scale.clone();
    const original = await f.document.serialize(), depth = f.document.undoStack.length;
    f.editor.selected = moving; f.document.begin(); f.assembly.begin(moving);
    assert(f.assembly.candidate, 'Selection previews a nearby support face.');
    const yellow = [];
    f.scene.traverse(node => {
      if (node.material && node.material.color && node.material.color.getHex() === 0xffd54a) yellow.push(node);
    });
    assert(yellow.length >= 2, 'The compatible face and ghost bounds are yellow.');
    yellow.forEach(node => {
      assert(node.userData.editorHelper && node.userData.editorRuntimeHelper);
      const hits = []; node.raycast(new THREE.Raycaster(), hits); assert.equal(hits.length, 0);
    });
    assert.strictEqual(target.children[0].material, material, 'Preview never changes an authored material.');
    assert(f.assembly.update(moving), 'A box near another box snaps onto its top.');
    near(bounds(moving).min.y, bounds(target).max.y, 'Supported contact');
    assert(moving.quaternion.equals(quaternion)); assert(moving.scale.equals(scale));
    f.assembly.end(); f.document.commit();
    assert.equal(f.document.undoStack.length, depth + 1, 'One drag remains one undo action.');
    const saved = await f.document.serialize();
    assert(!JSON.stringify(saved).includes('Ensamble de objetos'), 'Transient helpers never enter project JSON.');
    f.document.undo(); assert.deepEqual(await f.document.serialize(), original, 'Undo restores the complete unsnapped pose.');
    f.document.redo(); near(bounds(moving).min.y, bounds(target).max.y);
    let disposals = 0;
    f.assembly.helperGroup.traverse(node => {
      if (node.geometry) node.geometry.addEventListener('dispose', () => disposals++);
      if (node.material) node.material.addEventListener('dispose', () => disposals++);
    });
    f.assembly.clear(); assert(disposals >= 6); assert.equal(f.assembly.helperGroup, null);
  }
  {
    const f = fixture(), target = box(f, [0, 0.5, 0]), moving = box(f, [1.13, 0.5, 0]);
    f.document.begin(); f.assembly.begin(moving); f.assembly.update(moving);
    assert(f.assembly.drag.latch && f.assembly.drag.latch.kind === 'side', 'A floor contact does not hide a nearby box side.');
    near(bounds(moving).min.x, bounds(target).max.x, 'Adjacent boxes meet');
    rawPose(f, moving, [1.3, 0.5, 0]); f.assembly.update(moving);
    near(bounds(moving).min.x, bounds(target).max.x, 'Magnetic contact has a wider release threshold.');
    rawPose(f, moving, [1.65, 0.5, 0]); f.assembly.update(moving);
    assert(!f.assembly.drag.latch || f.assembly.drag.latch.kind !== 'side', 'Pulling away detaches the side contact.');
    near(moving.position.x, 1.65, 'The detached box follows its raw drag');
    f.assembly.end(); f.document.commit();
  }
  {
    const f = fixture(), target = box(f, [0, 0.5, 0], [3, 1, 3]), moving = box(f, [0, 1.58, 0]);
    f.document.begin(); f.assembly.begin(moving); f.assembly.update(moving);
    rawPose(f, moving, [0.5, 1.75, 0.2]); f.assembly.update(moving);
    near(moving.position.x, 0.5); near(moving.position.z, 0.2);
    near(bounds(moving).min.y, bounds(target).max.y, 'Sliding along a table retains support without locking X/Z.');
    rawPose(f, moving, [0.5, 2.1, 0.2]); f.assembly.update(moving);
    near(moving.position.y, 2.1, 'A deliberate upward pull separates the box.');
    f.assembly.end(); f.document.cancel();
  }
  {
    const f = fixture(), object = box(f, [4, 0.6, 0]);
    f.assembly.enabled = false; const pose = object.position.clone(); f.assembly.begin(object); f.assembly.update(object);
    assert(object.position.equals(pose)); assert.equal(f.assembly.helperGroup, null);
    f.assembly.enabled = true;
    const native = f.floor; assert(!f.assembly.supported(native));
    const portal = box(f, [4, 2, 0]); f.document.setBehaviors(portal, [{type: 'portal'}]); assert(!f.assembly.supported(portal));
    const floating = box(f, [4, 2, 0]); f.document.setBehaviors(floating, [{type: 'float'}]); assert(!f.assembly.supported(floating));
    const trigger = box(f, [4, 2, 0]); f.document.setBehaviors(trigger, [{type: 'collision', mode: 'trigger'}]); assert(!f.assembly.supported(trigger));
    const conveyor = f.document.addPrefab('hall', 'conveyor'); assert(!f.assembly.supported(conveyor));
    const manual = f.document.addPrefab('hall', 'product'); conveyor.add(manual);
    assert(manual && f.assembly.supported(manual), 'Manual boxes remain eligible beneath a conveyor actor.');
  }
  {
    const f = fixture(), table = box(f, [4, 0.4, 0], [3, 0.8, 3]);
    const conveyor = f.document.addPrefab('hall', 'conveyor');
    f.document.setTransform(conveyor, {position: [10, 1.02, 0], rotation: [0, 0.6, 0], scale: [1.2, 1.1, 0.8]});
    const manual = f.document.addPrefab('hall', 'product'); conveyor.add(manual);
    manual.updateWorldMatrix(true, true);
    const current = bounds(manual), center = current.getCenter(new THREE.Vector3());
    const delta = v(4 - center.x, 0.9 - current.min.y, -center.z);
    const worldPosition = manual.getWorldPosition(new THREE.Vector3()).add(delta);
    f.document.setTransform(manual, {position: manual.parent.worldToLocal(worldPosition).toArray()});
    const quaternion = manual.quaternion.clone(), scale = manual.scale.clone(), parent = manual.parent;
    f.document.begin(); f.assembly.begin(manual); f.assembly.update(manual); f.assembly.end(); f.document.commit();
    near(bounds(manual).min.y, bounds(table).max.y, 'A prefab child aligns in world space beneath a scaled, rotated machine.');
    assert(manual.quaternion.equals(quaternion)); assert(manual.scale.equals(scale)); assert.strictEqual(manual.parent, parent);
  }
  {
    const f = fixture(), obstacle = box(f, [0, 0.5, 0]), moving = box(f, [-3, 0.503, 0]);
    const original = await f.document.serialize(), quaternion = moving.quaternion.clone();
    f.document.begin(); f.assembly.begin(moving);
    rawPose(f, moving, [3, 0.503, 0]); f.assembly.update(moving);
    assert(bounds(moving).max.x <= bounds(obstacle).min.x + 0.001, 'A fast drag cannot tunnel through another box.');
    assert(!f.collisionWorld.testBox(bounds(moving), {ignore: [moving]}));
    assert(moving.quaternion.equals(quaternion));
    f.assembly.clear(); f.document.cancel();
    assert.deepEqual(await f.document.serialize(), original, 'Cancelling a constrained drag restores its initial project state.');
  }
  {
    const f = fixture(), wall = box(f, [0, 2, 0], [0.08, 4, 6]), moving = box(f, [-3, 0.503, 0]);
    f.document.begin(); f.assembly.begin(moving);
    rawPose(f, moving, [3, 0.503, 1]); f.assembly.update(moving);
    assert(bounds(moving).max.x <= bounds(wall).min.x + 0.001, 'A thin wall stops a fast diagonal drag.');
    near(moving.position.z, 1, 'The constrained object can slide along the wall.');
    f.assembly.end(); f.document.commit();
    f.document.undo(); near(moving.position.x, -3); near(moving.position.z, 0);
  }
  {
    const f = fixture(), moving = box(f, [3, 2, 0]);
    f.document.begin(); f.assembly.begin(moving);
    rawPose(f, moving, [3, -4, 0]); f.assembly.update(moving);
    assert(bounds(moving).min.y >= -0.001, 'A downward drag cannot pass through the floor.');
    f.assembly.end(); f.document.commit();
    f.document.undo(); near(moving.position.y, 2);
  }
  {
    const f = fixture(), target = box(f, [0, 0.5, 0]), moving = box(f, [0, 0.5, 0]);
    f.document.begin(); f.assembly.begin(moving);
    assert(!f.assembly.drag.safeMatrix, 'An existing authored overlap does not become a trapped safe pose.');
    rawPose(f, moving, [3, 0.503, 0]); f.assembly.update(moving);
    assert(f.assembly.drag.safeMatrix, 'The object can escape and establish an unobstructed pose.');
    rawPose(f, moving, [-3, 0.503, 0]); f.assembly.update(moving);
    assert(bounds(moving).min.x >= bounds(target).max.x - 0.001, 'Subsequent dragging respects collisions after escaping.');
    f.assembly.end(); f.document.commit();
  }
  {
    const f = fixture(), moving = box(f, [0, 1, 0]);
    f.editor.collisionWorld = {}; const assembly = new ObjectAssembly(f.editor);
    assert.doesNotThrow(() => { assembly.begin(moving); rawPose(f, moving, [1, 1, 0]); assembly.update(moving); assembly.end(); assembly.clear(); },
      'An editor adapter without collision query APIs remains usable.');
  }
  console.log('Object surface assembly: previews, top/side contacts, hysteresis, undo and native isolation OK.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
