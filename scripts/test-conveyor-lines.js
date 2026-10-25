// Actual modular prefabs, path geometry, document bindings and collision sweeps.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const THREE = require('three');
const ObjectPlacement = require('./load-object-placement')(THREE);
const behaviorSchema = require('../shared/behaviors.js');
const automationSchema = require('../shared/automation.js');
const ProcessorRuntime = require('./load-processor-runtime.js')(THREE, behaviorSchema);
const ProductSourceRuntime = require('./load-product-source-runtime')(THREE, behaviorSchema);
const PalletQueueRuntime = require('./load-pallet-queue-runtime.js')(THREE, behaviorSchema);
const {ProjectStore} = require('../server/storage.js');
const {getGeometryTree} = require('./load-geometry-acceleration.js')(THREE);
const layout = behaviorSchema.conveyorLayout;
function source(file) { return fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/^\uFEFF/, '').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''); }
const prefabs = new Function('THREE', 'behaviorSchema', source('src/editor/IndustrialPrefabs.js') + '\nreturn {createIndustrialPrefab,createProductVisual};')(THREE, behaviorSchema);
const SceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', source('src/editor/SceneDocument.js').replace('default class SceneDocument', 'return class SceneDocument'))(THREE, behaviorSchema, prefabs.createIndustrialPrefab);
const ProductFeedback = new Function('THREE', source('src/editor/ProductFeedback.js').replace('default class ProductFeedback', 'return class ProductFeedback'))(THREE);
const Runtime = new Function('THREE', 'behaviorSchema', 'automationSchema', 'createProductVisual', 'ProductFeedback', 'ObjectPlacement', 'ProductSourceRuntime', 'ProcessorRuntime', 'PalletQueueRuntime', source('src/editor/SimulationRuntime.js').replace('default class SimulationRuntime', 'return class SimulationRuntime'))(THREE, behaviorSchema, automationSchema, prefabs.createProductVisual, ProductFeedback, ObjectPlacement, ProductSourceRuntime, ProcessorRuntime, PalletQueueRuntime);
const CollisionWorld = new Function('THREE', 'getGeometryTree', source('src/lib/CollisionWorld.js').replace('default class CollisionWorld', 'return class CollisionWorld'))(THREE, getGeometryTree);
function setup() {
  const scene = new THREE.Scene(), root = new THREE.Group(); scene.add(root);
  const floor = new THREE.Mesh(new THREE.BoxBufferGeometry(100, 0.05, 100), new THREE.MeshBasicMaterial()); floor.position.y = -0.025; root.add(floor);
  const document = new SceneDocument({}); document.registerRoom('hall', root);
  const notices = [], ctx = {scene, editor: {active: false}, raycontrol: {states: {}, addState(name, state) { this.states[name] = state; }, activateState() {}, deactivateState() {}}};
  ctx.collisionWorld = new CollisionWorld(ctx, document);
  const runtime = new Runtime(ctx, document, notice => notices.push(notice));
  return {scene, root, document, ctx, runtime, notices};
}
function config(f, object) { return f.document.getBehaviors(object).find(value => value.type === 'conveyor'); }
function update(f, object, values) { f.document.setBehaviors(object, [Object.assign({}, config(f, object), values)]); }
function add(f, values = {}, position = [0, 1.02, 0]) {
  const object = f.document.addPrefab('hall', 'conveyor');
  update(f, object, Object.assign({length: 2, speed: 2, running: true, powered: true, autoSpawn: false, role: 'middle', withPallet: false, withPanel: false, withSensors: false}, values));
  f.document.setTransform(object, {position}); return object;
}
function addPalletQueue(f, values = {}, position = [0, 1.02, 0]) {
  const object = f.document.addPrefab('hall', 'palletQueue'), config = f.document.getBehaviors(object).find(value => value.type === 'palletQueue');
  f.document.setBehaviors(object, [Object.assign({}, config, values)]); f.document.setTransform(object, {position}); return object;
}
function stock(f, object) { return f.runtime.records.get(object.userData.editorId).components.palletQueue; }
function connect(f, sourceObject, target, sourcePort = 'output', targetPort = 'input') {
  update(f, sourceObject, sourcePort === 'branch' ? {branchId: target.userData.editorId, branchPort: targetPort} : {outputId: target.userData.editorId, outputPort: targetPort});
  f.scene.updateMatrixWorld(true);
  const targetConfig = f.document.getBehaviors(target).find(value => value.type === 'conveyor' || value.type === 'palletQueue');
  const targetPorts = targetConfig.type === 'palletQueue' ? layout.palletQueueLayout(targetConfig) : layout.ports(targetConfig);
  const from = layout.ports(config(f, sourceObject))[sourcePort], to = targetPorts[targetPort];
  const parentInverse = new THREE.Matrix4().getInverse(target.parent.matrixWorld);
  const direction = new THREE.Vector3(from.tx, 0, from.tz).applyMatrix3(new THREE.Matrix3().setFromMatrix4(sourceObject.matrixWorld))
    .applyMatrix3(new THREE.Matrix3().setFromMatrix4(parentInverse)).normalize();
  const yaw = Math.atan2(-direction.z, direction.x) - Math.atan2(-to.tz * target.scale.z, to.tx * target.scale.x);
  const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw || 0);
  const position = new THREE.Vector3(from.x, 0, from.z).applyMatrix4(sourceObject.matrixWorld).applyMatrix4(parentInverse)
    .sub(new THREE.Vector3(to.x, 0, to.z).multiply(target.scale).applyQuaternion(quaternion));
  f.document.setTransform(target, {position: position.toArray(), quaternion: quaternion.toArray()});
}
function advance(f, seconds) {
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) {
    f.scene.updateMatrixWorld(true); f.ctx.collisionWorld.beginFrame(); f.runtime.execute(Math.min(1 / 60, seconds - t)); f.ctx.collisionWorld.endFrame();
  }
}
function vars(f, object) { return f.runtime.records.get(object.userData.editorId).variables; }
function belt(f, object) { return f.runtime.records.get(object.userData.editorId).components.conveyor; }
function retained(f) { return Array.from(f.runtime.products.keys()); }
function equivalent(actual, expected, location = 'document') {
  if (typeof expected === 'number') return assert(Math.abs(actual - expected) < 1e-12, 'Numeric persistence drift at ' + location);
  if (!expected || typeof expected !== 'object') return assert.equal(actual, expected, location);
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), 'Saved fields at ' + location);
  Object.keys(expected).forEach(key => equivalent(actual[key], expected[key], location + '.' + key));
}
function noOverlaps(f) {
  const boxes = [];
  f.runtime.records.forEach(record => {
    const b = record.components.conveyor, q = record.components.palletQueue;
    if (b) b.packages.forEach(item => boxes.push(item.box));
    if (q) q.items.forEach(item => boxes.push(item.box));
  });
  for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) assert(!boxes[a].clone().expandByScalar(-0.002).intersectsBox(boxes[b].clone().expandByScalar(-0.002)), 'Boxes on connected modules must not overlap.');
}

async function run() {
  const f = setup();
  const head = add(f, {role: 'start', withPanel: true, withSensors: true, length: 2.5});
  const middle = add(f, {length: 3.2, surface: 'belt'});
  const end = add(f, {role: 'end', withPanel: true}), receivingStock = addPalletQueue(f);
  const unrelated = add(f, {powered: false, running: false}, [0, 1.02, 12]);
  connect(f, head, middle); connect(f, middle, end); connect(f, end, receivingStock);
  const physicalStart = f.document.getObjects('hall').find(object => object.userData.industrialAction === 'start' &&
    f.document.getBehaviors(object).some(value => value.type === 'control' && value.targetId === head.userData.editorId));
  const physicalStartConfig = f.document.getBehaviors(physicalStart).find(value => value.type === 'control');
  f.document.setBehaviors(physicalStart, [Object.assign({}, physicalStartConfig, {scope: 'segment'})]);
  const authored = JSON.stringify(await f.document.serialize()); f.runtime.start('hall');
  assert.deepEqual(f.runtime.getPanelSnapshot(head.userData.editorId, 'segment').memberIds.sort(), [head, middle].map(value => value.userData.editorId).sort());
  assert.equal(f.runtime.getPanelSnapshot(head.userData.editorId, 'line').memberIds.length, 4, 'The shared line includes its connected pallet store.');
  f.runtime.command(head.userData.editorId, 'pause', undefined, 'segment');
  assert(vars(f, head).paused && vars(f, middle).paused && !vars(f, end).paused);
  f.runtime.states.find(entry => entry.state.colliderMesh === physicalStart).state.onSelectStart();
  assert(!vars(f, head).paused && !vars(f, middle).paused, 'The physical green Start set-control resumes every paused module in its configured segment.');
  f.runtime.command(head.userData.editorId, 'start', undefined, 'line');
  assert(!vars(f, head).paused && !vars(f, middle).paused && !vars(f, end).paused);
  assert.equal(vars(f, unrelated).powered, false);
  f.runtime.insertProduct(head.userData.editorId); advance(f, 1 / 60);
  const originalBox = belt(f, head).packages[0].mesh; advance(f, 5);
  assert.equal(vars(f, head).exitCount, 1); assert.equal(vars(f, middle).entryCount, 1); assert.equal(vars(f, middle).exitCount, 1);
  assert.equal(vars(f, receivingStock).queued, 1); assert(retained(f).includes(originalBox));
  assert(stock(f, receivingStock).queue.some(entry => entry.product.object === originalBox), 'Transfers into the independently placed pallet retain the same mesh identity.');
  const line = f.runtime.getPanelSnapshot(head.userData.editorId, 'line').variables;
  assert.equal(line.entryCount, 1); assert.equal(line.exitCount, 1); assert.equal(line.inFlight, 0); assert.equal(line.palletCount, 1);
  assert.equal(f.runtime.getPanelSnapshot(head.userData.editorId, 'segment').variables.exitCount, 1);
  f.runtime.command(head.userData.editorId, 'stop', undefined, 'line'); f.runtime.setVariable(end.userData.editorId, 'emergency', true);
  assert.throws(() => f.runtime.command(head.userData.editorId, 'start', undefined, 'line'), /emergencia/);
  assert(!vars(f, head).running && !vars(f, middle).running, 'Line start validates all interlocks before changing any module.');
  f.runtime.command(head.userData.editorId, 'resetEmergency', undefined, 'line'); f.runtime.command(head.userData.editorId, 'start', undefined, 'line');
  f.runtime.setVariable(end.userData.editorId, 'paused', true); f.runtime.insertProduct(head.userData.editorId); advance(f, 4);
  assert.equal(vars(f, middle).transferBlocked, true); assert.equal(vars(f, end).entryCount, 1);
  noOverlaps(f);
  f.runtime.command(end.userData.editorId, 'start'); advance(f, 3);
  assert.equal(vars(f, receivingStock).queued, 2); assert.equal(f.runtime.getPanelSnapshot(head.userData.editorId, 'line').variables.exitCount, 2);
  f.runtime.stop(); assert.equal(JSON.stringify(await f.document.serialize()), authored);

  for (const curve of ['curveLeft', 'curveRight']) {
    const c = setup(), start = add(c, {role: 'start', length: 2}), curved = add(c, {layout: curve, surface: 'belt', radius: 1.5}), finish = add(c, {role: 'end'}), receiving = addPalletQueue(c);
    connect(c, start, curved); connect(c, curved, finish); connect(c, finish, receiving);
    c.runtime.start('hall'); c.runtime.insertProduct(start.userData.editorId); advance(c, 0.02);
    const box = belt(c, start).packages[0].mesh; advance(c, 5);
    assert.equal(vars(c, curved).entryCount, 1); assert.equal(vars(c, receiving).queued, 1, curve + ' follows its real collision geometry to the independently connected pallet.');
    assert(stock(c, receiving).queue.some(entry => entry.product.object === box)); noOverlaps(c); c.runtime.stop();
  }

  const scaled = setup(); scaled.root.position.set(1, 0, -2); scaled.root.rotation.y = 0.3; scaled.root.scale.set(1.3, 1, 0.85);
  const scaledHead = add(scaled, {role: 'start'}), scaledCurve = add(scaled, {layout: 'curveLeft', radius: 1.6}), scaledEnd = add(scaled, {role: 'end'}), scaledStock = addPalletQueue(scaled);
  scaled.document.setTransform(scaledHead, {scale: [1.6, 1, 1.1], rotation: [0, 0.45, 0]});
  scaled.document.setTransform(scaledCurve, {scale: [0.85, 1, 1.3]});
  scaled.document.setTransform(scaledEnd, {scale: [1.15, 1, 0.9]});
  connect(scaled, scaledHead, scaledCurve); connect(scaled, scaledCurve, scaledEnd); connect(scaled, scaledEnd, scaledStock);
  const scaledBefore = JSON.stringify(await scaled.document.serialize()); scaled.runtime.start('hall');
  scaled.runtime.insertProduct(scaledHead.userData.editorId); advance(scaled, 0.02);
  const scaledPackage = belt(scaled, scaledHead).packages[0];
  const entrance = layout.ports(config(scaled, scaledHead)).input;
  const entryWorld = new THREE.Vector3(entrance.x, 0, entrance.z).applyMatrix4(scaledHead.matrixWorld);
  const forwardWorld = new THREE.Vector3(entrance.tx, 0, entrance.tz).transformDirection(scaledHead.matrixWorld);
  const traveledWorld = scaledPackage.mesh.getWorldPosition(new THREE.Vector3()).sub(entryWorld).dot(forwardWorld);
  assert(Math.abs(traveledWorld - 2 * 0.02) < 0.00001, 'Scaling a prefab or its room must preserve velocity measured in world metres per second.');
  advance(scaled, 10);
  assert.equal(vars(scaled, scaledStock).queued, 1, 'Scaled, rotated modules and a nonuniformly transformed room retain aligned physical handoffs.');
  assert(!scaled.notices.some(message => message.includes('Alinea'))); noOverlaps(scaled);
  scaled.runtime.stop(); assert.equal(JSON.stringify(await scaled.document.serialize()), scaledBefore);

  // At 20 m/s a fixed-step chord cuts deeply across a 20 cm-radius bend.
  // The collision must follow the arc through intermediate orientations.
  const tight = setup(), tightCurve = add(tight, {layout: 'curveLeft', radius: 0.2, curveAngle: 180, width: 0.1, speed: 20});
  const tinyCarton = tight.document.addPrefab('hall', 'product');
  const tightConfig = config(tight, tightCurve), begin = layout.pathPoint(tightConfig, 0), obstaclePoint = layout.pathPoint(tightConfig, 0.2 * Math.PI / 4);
  tight.document.setTransform(tinyCarton, {position: [begin.x, 1.045, begin.z], scale: [0.16, 0.16, 0.16]});
  const thinObstacle = new THREE.Mesh(new THREE.BoxBufferGeometry(0.015, 0.1, 0.015), new THREE.MeshBasicMaterial());
  thinObstacle.position.set(obstaclePoint.x, 1.05, obstaclePoint.z); tight.root.add(thinObstacle);
  tight.runtime.start('hall'); const smallPackage = belt(tight, tightCurve).packages[0]; assert(smallPackage);
  advance(tight, 1 / 60);
  assert.equal(smallPackage.blocked, true, 'A thin obstacle on the arc cannot be skipped by the render-step chord.');
  assert(smallPackage.offset < -0.16, 'The carton stops before the obstacle rather than emerging on its far side.');
  const stoppedOffset = smallPackage.offset; thinObstacle.visible = false; tight.ctx.collisionWorld.invalidate(thinObstacle); advance(tight, 0.02);
  assert(smallPackage.offset > stoppedOffset, 'Clearing an arc obstacle resumes movement without accumulated displacement.'); tight.runtime.stop();

  const split = setup(), tee = add(split, {layout: 'tee', length: 3, routing: 'alternate', withPanel: true}), straightEnd = add(split, {role: 'end'}), branchEnd = add(split, {role: 'end'});
  const straightStock = addPalletQueue(split), branchStock = addPalletQueue(split);
  connect(split, tee, straightEnd); connect(split, tee, branchEnd, 'branch'); connect(split, straightEnd, straightStock); connect(split, branchEnd, branchStock);
  split.runtime.start('hall'); split.runtime.insertProduct(tee.userData.editorId); split.runtime.insertProduct(tee.userData.editorId); advance(split, 5);
  assert.equal(vars(split, tee).entryCount, 2); assert.equal(vars(split, straightStock).queued, 1); assert.equal(vars(split, branchStock).queued, 1);
  assert.equal(split.runtime.getPanelSnapshot(tee.userData.editorId, 'line').variables.entryCount, 2); assert.equal(split.runtime.getPanelSnapshot(tee.userData.editorId, 'line').variables.exitCount, 2);
  noOverlaps(split); split.runtime.stop();

  const terminalT = setup(), twoPallets = add(terminalT, {layout: 'tee', role: 'end', withPallet: true, routing: 'alternate', length: 3});
  const mainStock = addPalletQueue(terminalT), lateralStock = addPalletQueue(terminalT);
  connect(terminalT, twoPallets, mainStock); connect(terminalT, twoPallets, lateralStock, 'branch');
  terminalT.runtime.start('hall');
  assert.equal(vars(terminalT, twoPallets).palletCapacity, 0, 'The legacy pallet toggle cannot create a hidden stock inside a conveyor.');
  assert.equal(vars(terminalT, mainStock).capacity + vars(terminalT, lateralStock).capacity, 96, 'A terminal split can explicitly connect two independently configured receiving pallets.');
  terminalT.runtime.insertProduct(twoPallets.userData.editorId); terminalT.runtime.insertProduct(twoPallets.userData.editorId); advance(terminalT, 4);
  assert.equal(vars(terminalT, mainStock).queued + vars(terminalT, lateralStock).queued, 2);
  assert.deepEqual([stock(terminalT, mainStock).queue.length, stock(terminalT, lateralStock).queue.length], [1, 1], 'Each branch-ending product stacks on its own independent route pallet.');
  noOverlaps(terminalT); terminalT.runtime.stop();

  const merge = setup(), merger = add(merge, {layout: 'tee', junctionMode: 'merge', length: 3, role: 'end'}), mergedStock = addPalletQueue(merge);
  const leftInput = add(merge, {role: 'start'}), sideInput = add(merge, {role: 'start'});
  connect(merge, leftInput, merger);
  // Keep the merger fixed and align its second upstream module to the branch.
  update(merge, sideInput, {outputId: merger.userData.editorId, outputPort: 'branch'});
  const inlet = layout.ports(config(merge, merger)).branch, yaw = Math.atan2(-inlet.tz, inlet.tx);
  merge.document.setTransform(sideInput, {position: [inlet.x - Math.cos(yaw), 1.02, inlet.z + Math.sin(yaw)], quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw).toArray()});
  // The first alignment translated the merger; include that world translation.
  const localPosition = sideInput.position.clone().add(merger.position); localPosition.y = 1.02;
  merge.document.setTransform(sideInput, {position: localPosition.toArray()});
  connect(merge, merger, mergedStock);
  merge.runtime.start('hall'); merge.runtime.insertProduct(leftInput.userData.editorId); merge.runtime.insertProduct(sideInput.userData.editorId); advance(merge, 5);
  assert.equal(vars(merge, mergedStock).queued, 2, 'Main and branch inputs merge into independent stock without losing or duplicating boxes.');
  assert.equal(merge.runtime.getPanelSnapshot(merger.userData.editorId, 'line').variables.entryCount, 2); noOverlaps(merge); merge.runtime.stop();

  const disconnected = setup(), lone = add(disconnected, {role: 'middle', withPallet: false});
  disconnected.runtime.start('hall'); disconnected.runtime.insertProduct(lone.userData.editorId); advance(disconnected, 3);
  assert.equal(vars(disconnected, lone).inFlight, 1); assert.equal(vars(disconnected, lone).transferBlocked, true); assert.equal(vars(disconnected, lone).exitCount, 0);
  disconnected.runtime.stop();
  const unconnectedEnd = setup(), obsoleteEnd = add(unconnectedEnd, {role: 'end', withPallet: true});
  unconnectedEnd.runtime.start('hall'); unconnectedEnd.runtime.insertProduct(obsoleteEnd.userData.editorId); advance(unconnectedEnd, 3);
  assert.equal(vars(unconnectedEnd, obsoleteEnd).inFlight, 1); assert.equal(vars(unconnectedEnd, obsoleteEnd).exitCount, 0);
  assert.equal(belt(unconnectedEnd, obsoleteEnd).pallets.size, 0, 'A terminal conveyor without an explicit receiver retains its product instead of creating stock or disposing it.');
  unconnectedEnd.runtime.stop();
  const gap = setup(), from = add(gap), far = add(gap, {role: 'end', withPallet: true}, [15, 1.02, 0]);
  update(gap, from, {outputId: far.userData.editorId}); gap.runtime.start('hall'); gap.runtime.insertProduct(from.userData.editorId); advance(gap, 3);
  assert.equal(vars(gap, from).transferBlocked, true); assert.equal(vars(gap, far).entryCount, 0);
  assert(gap.notices.some(message => message.includes('Alinea')), 'A reference alone cannot teleport a product between distant modules.'); gap.runtime.stop();

  // Modular descriptors and their explicit graph survive real SQLite close /
  // reopen and a fresh document hydration, including optional hidden hardware.
  const persistence = setup(), variants = ['belt-start', 'roller-curve-right', 'belt-tee-merge', 'belt-middle', 'roller-end', 'roller-tee-split'];
  const modules = variants.map(variant => persistence.document.addPrefab('hall', 'conveyor', variant));
  const [persistHead, persistCurve, persistMerge, persistBranchInput, persistEnd, persistSplit] = modules;
  const persistStock = addPalletQueue(persistence, {width: 1.4, depth: 1.2, columns: 4, rows: 3, layers: 2, capacity: 24});
  update(persistence, persistHead, {length: 6.25, width: 1.4, withSensors: false, withPallet: false, outputId: persistCurve.userData.editorId});
  update(persistence, persistCurve, {radius: 2.2, curveAngle: 45, withPanel: false, withSensors: true, outputId: persistMerge.userData.editorId, outputPort: 'branch'});
  update(persistence, persistMerge, {length: 3.75, junctionMode: 'merge', branchSide: 'right', withPanel: false, withPallet: false, outputId: persistEnd.userData.editorId});
  update(persistence, persistBranchInput, {outputId: persistMerge.userData.editorId, outputPort: 'input'});
  update(persistence, persistSplit, {routing: 'alternate', outputId: persistHead.userData.editorId, branchId: persistBranchInput.userData.editorId, branchPort: 'input'});
  update(persistence, persistEnd, {outputId: persistStock.userData.editorId});
  const scopedButton = persistence.document.getObjects('hall').find(object => persistence.document.getBehaviors(object).some(value => value.type === 'control' && value.targetId === persistHead.userData.editorId));
  const buttonConfig = persistence.document.getBehaviors(scopedButton).find(value => value.type === 'control');
  persistence.document.setBehaviors(scopedButton, [Object.assign({}, buttonConfig, {scope: 'line'})]);
  const savedDocument = await persistence.document.serialize();
  modules.forEach((object, index) => assert.equal(savedDocument.rooms.hall.additions.find(record => record.id === object.userData.editorId).descriptor.variant, variants[index]));
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'webxr-modular-lines-'));
  let store;
  try {
    store = new ProjectStore({dataDir: temporaryDirectory});
    const project = store.saveProject(null, {name: 'Línea modular persistida', document: savedDocument});
    store.close(); store = new ProjectStore({dataDir: temporaryDirectory});
    const reopened = store.getProject(project.id);
    equivalent(reopened.document, savedDocument);
    const loaded = setup(); await loaded.document.load(reopened.document);
    equivalent(await loaded.document.serialize(), savedDocument);
    modules.forEach((object, index) => {
      const restored = loaded.document.objects.get(object.userData.editorId); assert(restored);
      assert.equal(restored.userData.editorPrefabVariant, variants[index]);
      assert.deepEqual(config(loaded, restored), config(persistence, object), 'Module layout, dimensions, checkboxes and output links retain their exact normalized values.');
    });
    const restoredHead = loaded.document.objects.get(persistHead.userData.editorId), headContent = restoredHead.children[0];
    assert.equal(headContent.children[4].visible, false); assert.equal(headContent.children[5].visible, false); assert.equal(headContent.children[9].visible, false);
    const restoredCurve = loaded.document.objects.get(persistCurve.userData.editorId);
    assert.equal(restoredCurve.children[0].children[6].visible, false, 'Loading withPanel=false keeps the whole physical panel hidden.');
    const restoredButton = loaded.document.objects.get(scopedButton.userData.editorId);
    const restoredControl = loaded.document.getBehaviors(restoredButton).find(value => value.type === 'control');
    assert.equal(restoredControl.scope, 'line'); assert.equal(restoredControl.targetId, persistHead.userData.editorId);
    const duplicate = await loaded.document.duplicate(restoredHead);
    const copiedControl = loaded.document.getObjects('hall').find(object => loaded.document.getBehaviors(object).some(value => value.type === 'control' && value.targetId === duplicate.userData.editorId));
    assert(copiedControl && copiedControl !== restoredButton);
    assert.equal(loaded.document.getBehaviors(copiedControl).find(value => value.type === 'control').scope, 'line');
    assert.equal(config(loaded, duplicate).outputId, persistCurve.userData.editorId, 'Copying one module retains an intentionally external downstream binding.');
    const restoredStock = loaded.document.getObject(persistStock.userData.editorId);
    assert.deepEqual(loaded.document.getBehaviors(restoredStock), persistence.document.getBehaviors(persistStock));
    assert.equal(config(loaded, loaded.document.getObject(persistEnd.userData.editorId)).outputId, persistStock.userData.editorId);
  } finally {
    if (store) store.close();
    fs.rmSync(temporaryDirectory, {recursive: true, force: true});
  }
  console.log('Modular conveyors: real straight/belt/curved/T split/merge paths, same-object handoffs to independent pallet queues, atomic segment/line controls, boundary counters, backpressure recovery, unconnected-end retention and exact play cleanup passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
