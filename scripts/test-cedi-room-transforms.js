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
  b.lines.forEach(value => {
    const monitor = value.monitor; let display; value.controller.traverse(node => { if (!display && node.userData.industrialDisplay) display = node; });
    const anchor = display || value.controller, expected = anchor.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(2.35, 0, .05).multiplyScalar(roomScale).applyQuaternion(anchor.getWorldQuaternion(new THREE.Quaternion())));
    expected.y = transformed.root.position.y + 2 * roomScale; near(monitor.getWorldPosition(new THREE.Vector3()), expected, 'A transformed room retains the monitor-to-PLC offset');
  });
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
}
(async () => { for (const kind of process.argv.slice(2).length ? process.argv.slice(2) : ['sorting', 'packing']) await scenario(kind); })().catch(error => { console.error(error); process.exitCode = 1; });
