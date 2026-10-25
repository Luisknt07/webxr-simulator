'use strict';
// No browser or database: exercise the migration against real document/factory
// geometry and assembly ports, then prove its persisted-field whitelist.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const schema = require('../shared/behaviors'), {targets, payloadFor, fitInEditor} = require('./fit-l-transfer');
const text = fs.readFileSync(path.join(__dirname, 'test-industrial-lab-lines.js'), 'utf8');
const {harness, releaseGeometry} = new Function('require', '__dirname', text.slice(0, text.indexOf('\nasync function run()')) + '\nreturn {harness,releaseGeometry};')(require, __dirname);
const {ConveyorAssembly} = require('./load-industrial-cedi')(THREE, schema);
const clone = value => JSON.parse(JSON.stringify(value)), id = object => object.userData.editorId;
const close = (actual, expected, message) => actual.forEach((value, index) => assert(Math.abs(value - expected[index]) < 1e-8, message));

async function run() {
  const f = harness.setup(), editor = {active: true, document: f.document, transform: {dragging: false}, materials: {invalidate() {}}, industrialVisuals: {invalidate() {}}, lineMonitors: {invalidate() {}}, collisionWorld: {invalidate() {}}};
  const roots = {}, fixtures = [];
  for (const roomId of ['sound', 'vertigo']) {
    const root = roots[roomId] = new THREE.Group(); f.scene.add(root); f.document.registerRoom(roomId, root);
    editor.roomId = roomId; editor.root = root; editor.ctx = f.ctx; editor.hooks = {renderScene: f.scene};
    const assembly = editor.assembly = new ConveyorAssembly(editor);
    const add = (variant, name, values = {}) => {
      const object = f.document.addPrefab(roomId, 'conveyor', variant), config = f.document.getBehaviors(object).find(value => value.type === 'conveyor');
      f.document.setProperty(object, 'name', name);
      f.document.setBehaviors(object, [Object.assign(config, {withPanel: false, withSensors: true, autoSpawn: false}, values)]);
      f.document.setTransform(object, {position: [4, 1, 10]}); return object;
    };
    const before = add('roller-motor', 'Entrada fija', {length: 4, width: 1});
    const corner = add('popup-belt', roomId === 'sound' ? '01 · Transferencia a 90° · correas elevables entre rodillos' : 'L rectangular · transferencia por correas a 90°', {length: 2.4, width: 1, routing: 'branch', branchSide: 'left'});
    const split = add('distributor', 'Descendente con dos ramales', {length: 3, width: 1});
    const straight = add('roller-motor', 'Final recto', {length: 2, width: 1}), branch = add('roller-motor', 'Final lateral', {length: 2, width: 1});
    const link = (source, port, target) => {
      f.document.setBehaviors(source, f.document.getBehaviors(source).map(config => config.type === 'conveyor' ? Object.assign(config, port === 'branch' ? {branchId: id(target), branchPort: 'input'} : {outputId: id(target), outputPort: 'input'}) : config));
      assembly.align(source, port, target, 'input');
    };
    link(before, 'output', corner); link(corner, 'branch', split); link(split, 'output', straight); link(split, 'branch', branch);
    fixtures.push({roomId, corner, before, downstream: [split, straight, branch], assembly});
  }
  // A third, unrelated pallet transfer is intentionally excluded by targeting.
  const pallet = f.document.addPrefab('sound', 'conveyor', 'popup-chain'); f.document.setProperty(pallet, 'name', '05 · Transferencia de cadenas a 90°');
  f.document.setStudio({scenes: [{id: 'sound', name: 'Laboratorio protegido'}, {id: 'vertigo', name: 'Packing protegido'}]});
  const original = await f.document.serialize(), selected = targets(original); assert.equal(selected.length, 2);
  const plans = [], previousContext = global.context; global.context = {editor};
  try {
    fixtures.forEach(fixture => {
      editor.roomId = fixture.roomId; editor.root = roots[fixture.roomId]; editor.assembly = fixture.assembly;
      const fixed = fixture.before.position.toArray(), poses = fixture.downstream.map(object => object.position.toArray());
      const target = selected.find(value => value.roomId === fixture.roomId), result = fitInEditor(target); plans.push(result);
      close(result.delta, [-.7, 0, .7], 'The branch moves by the exact footprint reduction.');
      close(fixture.before.position.toArray(), fixed, 'The upstream entry remains literally fixed.');
      assert.equal(result.beforeProtrusion, .7); assert(Math.abs(result.afterProtrusion) < 1e-8);
      assert.equal(result.downstream.length, 3, 'Both downstream output branches move, not just the next belt.');
      fixture.downstream.forEach((object, index) => close(object.position.toArray(), poses[index].map((value, axis) => value + result.delta[axis])));
      assert(result.checks.every(check => check.gap < 1e-8 && check.heading > .999999));
      assert(result.actorMoves.length > 0, 'The real factory rebuilds the existing detector/PLC poses.');
    });
  } finally { global.context = previousContext; }
  const candidate = await f.document.serialize(), safe = payloadFor(original, candidate, plans);
  assert(safe.differences.length > 10); assert.equal(safe.roomHashes.filter(room => room.changed).length, 2);
  assert.equal(JSON.stringify(safe.document.rooms.hall), JSON.stringify(original.rooms.hall));
  assert.deepEqual(safe.document.rooms.sound.additions.find(row => row.id === id(pallet)), original.rooms.sound.additions.find(row => row.id === id(pallet)));
  const reject = (mutate, expected = /Unexpected fields changed/) => { const value = clone(candidate); mutate(value); assert.throws(() => payloadFor(original, value, plans), expected); };
  reject(value => { value.rooms.sound.additions[0].color = '#ff0000'; });
  reject(value => { value.rooms.sound.additions[0].behaviors[0].speed += .1; });
  reject(value => { value.rooms.hall.additions.push(clone(value.rooms.sound.additions[0])); });
  reject(value => { value.studio = {version: 1, scenes: []}; });
  reject(value => { value.rooms.sound.additions.reverse(); }, /IDs and insertion order/);
  const omitted = clone(plans); omitted[0].moves.pop(); assert.throws(() => payloadFor(original, candidate, omitted), /all its downstream/);
  const tilted = clone(candidate), targetRow = tilted.rooms.sound.additions.find(row => row.id === plans[0].id); targetRow.quaternion[1] = .001;
  assert.throws(() => payloadFor(original, tilted, plans), /Unexpected fields changed/);
  const rounded = clone(candidate); rounded.rooms.sound.additions[0].quaternion[1] += Number.EPSILON;
  const restored = payloadFor(original, rounded, plans); assert.deepEqual(restored.document.rooms.sound.additions[0].quaternion, original.rooms.sound.additions[0].quaternion, 'Tiny serialization roundoff is restored from the original, never persisted.');
  const wrongActor = clone(plans); wrongActor[0].actorMoves[0].path = '6.2'; assert.throws(() => payloadFor(original, candidate, wrongActor), /Only presence sensors/);
  releaseGeometry(f); fixtures.forEach(value => value.assembly.clear());
  console.log('L transfer fitting: exact 1×1 footprint, fixed inlet, all downstream branches, existing actor identities and literal unrelated data; every unapproved persisted change is rejected.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
