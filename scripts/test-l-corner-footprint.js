'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const schema = require('../shared/behaviors');
const {validateDocument} = require('../server/validation');
const fixture = fs.readFileSync(path.join(__dirname, 'test-industrial-lab-lines.js'), 'utf8');
const {harness, releaseGeometry} = new Function('require', '__dirname', fixture.slice(0, fixture.indexOf('\nasync function run()')) + '\nreturn {harness,releaseGeometry};')(require, __dirname);
const production = require('./load-industrial-cedi')(THREE, schema);
const buildLab = production.buildIndustrialLab, buildPacking = production.buildIndustrialCediLevel;
const config = (f, object) => f.document.getBehaviors(object).find(value => value.type === 'conveyor');
const close = (actual, expected, message) => assert(Math.abs(actual - expected) < 1e-6, message || actual + ' != ' + expected);

async function validation() {
  const base = Object.assign(schema.defaultBehavior('conveyor'), schema.conveyorEquipment.getDefinition('popup-belt').preset, {length: 1, width: 1});
  assert.equal(schema.normalizeBehaviors([base])[0].length, 1);
  assert.throws(() => schema.normalizeBehaviors([Object.assign({}, base, {length: .9})]), /transferencia elevable.*ancho/);
  const tee = Object.assign({}, base, schema.conveyorEquipment.getDefinition('distributor').preset, {length: 1, width: 1});
  assert.throws(() => schema.normalizeBehaviors([tee]), /dos veces/);
  assert.equal(schema.conveyorEquipment.getDefinition('popup-belt').preset.length, 2.4, 'The general three-port catalogue preset keeps its authored size.');
  const f = harness.setup(), corner = f.document.addPrefab('hall', 'conveyor', 'popup-belt'); f.document.setBehaviors(corner, [base]);
  const saved = await f.document.serialize(); assert(validateDocument(saved, value => value));
  for (const invalid of [Object.assign({}, base, {length: .9}), tee]) {
    const copy = JSON.parse(JSON.stringify(saved)); copy.rooms.hall.additions.find(value => value.id === corner.userData.editorId).behaviors = [invalid];
    assert.throws(() => validateDocument(copy, value => value), /transferencia elevable|dos veces/);
  }
  releaseGeometry(f);
}

async function check(kind) {
  const f = harness.setup(), graph = kind === 'lab' ? buildLab(f.document, 'hall', {scene: f.scene, cellIds: ['transfer-l']}) : buildPacking(f.document, 'hall', {scene: f.scene, kind: 'packing'});
  const line = graph.cells.find(cell => cell.objects.some(object => config(f, object)?.equipmentId === 'conveyor.popup-belt'));
  const corner = line.objects.find(object => config(f, object)?.equipmentId === 'conveyor.popup-belt');
  const settings = config(f, corner), outgoing = f.document.getObject(settings.branchId), outputSettings = config(f, outgoing);
  assert.equal(settings.mechanism, 'liftTransfer'); assert.equal(settings.routing, 'branch'); assert.equal(settings.branchSide, 'left');
  close(settings.length, outputSettings.width, 'The corner length matches the useful width of the perpendicular receiver.'); close(settings.width, 1);
  assert.equal(settings.outputId, '', 'The rectangular L has no straight-through output route to a blind branch.');
  const assembly = new production.ConveyorAssembly({document: f.document, roomId: 'hall', root: f.root, ctx: f.ctx, hooks: {renderScene: f.scene}, assemblyMessage() {}});
  const a = assembly.worldPort(corner, 'branch'), b = assembly.worldPort(outgoing, 'input'); close(a.position.distanceTo(b.position), 0); close(a.tangent.dot(b.tangent), 1);
  f.scene.updateMatrixWorld(true); const inverse = new THREE.Matrix4().getInverse(corner.matrixWorld), rollers = new THREE.Box3();
  corner.traverse(node => {
    if (!node.geometry || !node.userData.industrialRoller) return;
    if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
    rollers.union(node.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, node.matrixWorld)));
  });
  assert(!rollers.isEmpty()); assert(rollers.min.x >= -outputSettings.width / 2 - .001 && rollers.max.x <= outputSettings.width / 2 + .001,
    'The actual roller mesh bank stays within the receiver width; no unused roller arm extends beyond the L.');
  assembly.clear(); f.runtime.start('hall'); let raised = false, delivered = false;
  const total = () => line.receivers.reduce((sum, object) => sum + f.runtime.records.get(object.userData.editorId).variables.receivedUnits, 0);
  const expectedUnits = kind === 'lab' ? 16 : line.expectedUnits, cornerLoads = kind === 'lab' ? 16 : 12;
  for (let frame = 0; frame < 6000 && total() < expectedUnits; frame++) {
    f.ctx.collisionWorld.beginFrame(); try { f.scene.updateMatrixWorld(true); f.runtime.execute(.1); } finally { f.ctx.collisionWorld.endFrame(); }
    const belt = f.runtime.records.get(corner.userData.editorId).components.conveyor;
    raised = raised || belt.actuatorPosition > .1; delivered = delivered || belt.mechanismPhase === 'delivering';
  }
  const belt = f.runtime.records.get(corner.userData.editorId).components.conveyor;
  assert(raised && delivered, 'The compact corner still performs a real raise/transfer/return cycle.'); assert.equal(belt.entryCount, cornerLoads); assert.equal(belt.exitCount, cornerLoads); assert.equal(belt.routedBranch, cornerLoads);
  assert.equal(total(), expectedUnits);
  assert.equal(f.notices.length, 0); console.log('Compact L corner:', kind, '— 1x1 m roller bed, no blind arm,', cornerLoads, 'real loads and', expectedUnits, 'line units with the complete building/monitor collision world.'); releaseGeometry(f);
}
async function run() { await validation(); for (const kind of ['lab', 'packing']) await check(kind); }
run().catch(error => { console.error(error); process.exitCode = 1; });
