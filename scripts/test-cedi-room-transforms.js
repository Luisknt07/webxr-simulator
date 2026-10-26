'use strict';
// A CEDI room may inherit a transform from the original environment asset.
// World-derived fixtures must still be authored in that room's local space.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const schema = require('../shared/behaviors');
const prefix = fs.readFileSync(path.join(__dirname, 'test-industrial-lab-lines.js'), 'utf8');
const {harness, releaseGeometry} = new Function('require', '__dirname', prefix.slice(0, prefix.indexOf('\nasync function run()')) + '\nreturn {harness,releaseGeometry};')(require, __dirname);
const build = require('./load-industrial-cedi')(THREE, schema).buildIndustrialCediLevel;
const id = object => object.userData.editorId;
const near = (a, b, label) => assert(a.distanceTo(b) < 1e-6, label + ': ' + a.toArray() + ' / ' + b.toArray());
const config = (f, object, type) => f.document.getBehaviors(object).find(value => value.type === type);
const json = value => JSON.parse(JSON.stringify(value));
const displayOf = controller => { let display; controller.traverse(node => { if (!display && node.userData.industrialDisplay) display = node; }); return display || controller; };
function nearMatrix(a, b, label) { a.elements.forEach((value, index) => assert(Math.abs(value - b.elements[index]) < 1e-6, label + ' matrix element ' + index + ': ' + value + ' / ' + b.elements[index])); }

// The explicit opt-out still exposes the old stand-mounted placement. Keep its
// numeric PLC offset regression instead of silently dropping that old contract.
function legacyMonitorOffsets(kind) {
  const f = harness.setup(), roomScale = 1.25; f.root.position.set(7, 1.25, -11); f.root.rotation.y = -Math.PI / 2; f.root.scale.setScalar(roomScale); f.scene.updateMatrixWorld(true);
  const result = build(f.document, 'hall', {kind, scene: f.scene, monitorLayout: false, industrialMessages: false, industrialAging: false, floorPresentation: false});
  assert.equal(result.monitorLayout, null);
  result.lines.forEach(value => {
    const anchor = displayOf(value.controller), expected = anchor.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(2.35, 0, .05).multiplyScalar(roomScale).applyQuaternion(anchor.getWorldQuaternion(new THREE.Quaternion())));
    expected.y = f.root.position.y + 2 * roomScale; near(value.monitor.getWorldPosition(new THREE.Vector3()), expected, 'Explicit legacy placement retains the original monitor-to-PLC offset');
    assert.deepEqual(value.monitor.scale.toArray(), [3.2, 1.8, .12]);
  });
  releaseGeometry(f);
}

async function scenario(kind) {
  const plain = harness.setup(), transformed = harness.setup();
  const roomScale = 1.25;
  transformed.root.position.set(7, 1.25, -11); transformed.root.rotation.y = -Math.PI / 2; transformed.root.scale.setScalar(roomScale); transformed.scene.updateMatrixWorld(true);
  const a = build(plain.document, 'hall', {kind, scene: plain.scene}), b = build(transformed.document, 'hall', {kind, scene: transformed.scene});
  assert.equal(a.platforms.length, 1); assert.equal(b.platforms.length, 1);
  near(a.platforms[0].deck.position, b.platforms[0].deck.position, 'A room rotation does not double-transform the pallet platform');
  a.platforms[0].steps.forEach((step, index) => near(step.position, b.platforms[0].steps[index].position, 'Stairs stay beside their own local platform'));
  a.monitors.forEach((monitor, index) => {
    near(monitor.position, b.monitors[index].position, 'Supervisory monitors use room-local positions');
    assert(Math.abs(monitor.quaternion.dot(b.monitors[index].quaternion)) > .999999, 'Monitor orientation removes the parent world rotation exactly once.');
  });
  a.terminalSigns.forEach((label, index) => {
    near(label.position, b.terminalSigns[index].position, 'Destination labels stay beside the correct buffer');
    assert(Math.abs(label.quaternion.dot(b.terminalSigns[index].quaternion)) > .999999);
  });
  const line = b.lines.find(value => value.id === 'pallet-logistics'), receiver = line.receiver, deck = b.platforms[0].deck;
  const expectedFloor = receiver.localToWorld(new THREE.Vector3(0, -1, 0));
  assert(Math.abs(new THREE.Box3().setFromObject(deck).max.y - expectedFloor.y) < 1e-6, 'The world-space pallet floor rests on its physical platform.');
  assert.deepEqual(a.monitorLayout.warnings, []); assert.deepEqual(b.monitorLayout.warnings, []);
  assert.equal(a.monitorLayout.layouts.length, a.lines.length); assert.equal(b.monitorLayout.layouts.length, b.lines.length);
  const roomDelta = new THREE.Matrix4().multiplyMatrices(transformed.root.matrixWorld, new THREE.Matrix4().getInverse(plain.root.matrixWorld));
  b.lines.forEach(value => {
    const originalLine = a.lines.find(line => line.id === value.id), original = originalLine.monitor, monitor = value.monitor;
    const originalAnchor = displayOf(originalLine.controller), anchor = displayOf(value.controller), layout = b.monitorLayout.layouts.find(row => row.monitorId === id(monitor)), originalLayout = a.monitorLayout.layouts.find(row => row.monitorId === id(original));
    assert(layout && originalLayout && !layout.existing && !originalLayout.existing);
    assert.equal(layout.targetId, id(value.controller)); assert.equal(config(transformed, monitor, 'lineMonitor').targetId, id(value.controller)); assert.equal(config(transformed, monitor, 'lineMonitor').scope, 'line');
    assert.deepEqual(monitor.scale.toArray(), [3, 1.6875, .09]); assert.equal(monitor.position.y, b.floorPresentation.plan.floorY + 2.15, 'The default monitor is the compact suspended panel, not its retired stand.');
    // Compare the complete affine transform and the actual collision-safe PLC
    // offset selected in the plain room. The hanging layout deliberately has
    // no fixed 2.35m offset: nearby machinery and routes constrain placement.
    original.updateWorldMatrix(true, false); monitor.updateWorldMatrix(true, false);
    nearMatrix(monitor.matrixWorld, new THREE.Matrix4().multiplyMatrices(roomDelta, original.matrixWorld), 'Suspended monitor removes room rotation/scale exactly once');
    const localOffset = plain.root.worldToLocal(original.getWorldPosition(new THREE.Vector3())).sub(plain.root.worldToLocal(originalAnchor.getWorldPosition(new THREE.Vector3())));
    const worldOffset = localOffset.clone().applyMatrix4(transformed.root.matrixWorld).sub(transformed.root.getWorldPosition(new THREE.Vector3()));
    near(monitor.getWorldPosition(new THREE.Vector3()), anchor.getWorldPosition(new THREE.Vector3()).add(worldOffset), 'A transformed room retains its planned lateral monitor-to-PLC offset');
    const localAnchor = transformed.root.worldToLocal(anchor.getWorldPosition(new THREE.Vector3()));
    assert(Math.abs(Math.hypot(monitor.position.x - localAnchor.x, monitor.position.z - localAnchor.z) - layout.distanceFromPanel) < 1e-6, 'The placement report measures the actual local PLC clearance.');
    assert.equal(layout.supportIds.length, 3); assert.equal(originalLayout.supportIds.length, 3);
    layout.supportIds.forEach((supportId, index) => {
      const support = transformed.document.getObject(supportId), plainSupport = plain.document.getObject(originalLayout.supportIds[index]); assert(support && plainSupport); support.updateWorldMatrix(true, false); plainSupport.updateWorldMatrix(true, false);
      nearMatrix(support.matrixWorld, new THREE.Matrix4().multiplyMatrices(roomDelta, plainSupport.matrixWorld), 'Every ceiling support preserves its exact room-local mounting');
      if (index < 2) { assert(Math.abs(support.position.y - support.scale.y / 2 - (monitor.position.y + monitor.scale.y / 2)) < 1e-6); assert(Math.abs(support.position.y + support.scale.y / 2 - layout.ceilingY) < 1e-6, 'The hanging rod reaches its own roof plane.'); }
      else { assert.equal(support.position.y, layout.ceilingY); assert.deepEqual(support.scale.toArray(), [2.1, .04, .16]); }
      assert.equal(config(transformed, support, 'collision').enabled, false);
    });
  });
  assert(b.monitorLayout.removedLegacyIds.every(objectId => !transformed.document.getObject(objectId)), 'Retired monitor bases/pedestals are absent.');
  // Keep the full warehouse/platform collision geometry. Other independent
  // networks are hidden so this regression isolates the four complete pallets.
  b.lines.filter(value => value !== line).flatMap(value => value.objects).forEach(object => { object.visible = false; });
  const before = await transformed.document.serialize(); transformed.ctx.collisionWorld.setRoom('hall'); transformed.runtime.start('hall');
  const output = () => transformed.runtime.records.get(id(receiver)).variables;
  for (let frame = 0; frame < 2000 && output().receivedUnits < 32; frame++) {
    transformed.ctx.collisionWorld.beginFrame();
    try { transformed.scene.updateMatrixWorld(true); transformed.runtime.execute(.1); } finally { transformed.ctx.collisionWorld.endFrame(); }
  }
  assert.equal(output().receivedUnits, 32, 'The translated, rotated full CEDI delivers all four pallets instead of colliding with a misplaced platform.');
  assert.equal(output().received, 4); assert.equal(output().completePallets, 4);
  assert.equal(config(transformed, receiver, 'palletQueue').capacity, 4);
  assert(!transformed.runtime.events.some(event => event.type === 'configuration-warning'));
  transformed.runtime.stop(); assert.deepEqual(json(await transformed.document.serialize()), json(before), 'Running under a transformed room does not rewrite authored JSON local poses.');
  console.log('CEDI room transforms:', kind, '— yaw −90°, translated floor, uniform scale 1.25, local platforms/stairs/monitors/labels and 32 pallet units passed.');
  releaseGeometry(plain); releaseGeometry(transformed);
  legacyMonitorOffsets(kind);
}
(async () => { for (const kind of process.argv.slice(2).length ? process.argv.slice(2) : ['sorting', 'packing']) await scenario(kind); })().catch(error => { console.error(error); process.exitCode = 1; });
