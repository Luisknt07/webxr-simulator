// Upgrade saved control poses without changing assets, machine bindings or
// deliberately authored transforms. Uses real prefab and document code.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const behaviorSchema = require('../shared/behaviors.js');
const wearSchema = require('../shared/wear.js');
const {validateDocument} = require('../server/validation.js');
const source = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
  .replace(/^\uFEFF/, '').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const factory = new Function('THREE', 'behaviorSchema', source('src/editor/IndustrialPrefabs.js') +
  '\nreturn createIndustrialPrefab;')(THREE, behaviorSchema);
let factoryCalls = 0;
function createIndustrialPrefab(...args) { factoryCalls++; return factory(...args); }
createIndustrialPrefab.refresh = factory.refresh;
createIndustrialPrefab.enforceOptions = factory.enforceOptions;
const SceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', source('src/editor/SceneDocument.js')
  .replace('default class SceneDocument', 'return class SceneDocument'))(THREE, behaviorSchema, createIndustrialPrefab);
const clone = value => JSON.parse(JSON.stringify(value));
const kinds = ['conveyor', 'plc', 'source', 'processor', 'palletQueue'];
function setup() {
  const document = new SceneDocument({});
  document.registerRoom('hall', new THREE.Group()); document.registerRoom('sound', new THREE.Group());
  return document;
}
function poses(prefab) {
  const prefix = prefab === 'conveyor' ? '6.' : prefab === 'plc' ? '' : prefab === 'palletQueue' ? '1.' : '2.';
  const rows = prefab === 'source' ? [
    [[-0.23, 0, 0.23], 0.06, 0.44], [[-0.23, 0, 0.23], -0.12, 0.27]
  ] : prefab === 'palletQueue' ? [
    [[-0.15, 0.15], 0.055, 0.33], [[-0.15, 0.15], -0.11, 0.16]
  ] : prefab === 'processor' ? [
    [[-0.29, 0, 0.29], -0.08, 0.44], [[-0.29, 0, 0.29], -0.30, 0.27], [[-0.29, 0, 0.29], -0.52, 0.10]
  ] : [
    [[-0.24, 0, 0.24], -0.17, 0.21], [[-0.30, 0, 0.30], -0.39, 0.04], [[0.30, -0.30, 0], -0.61, -0.13]
  ];
  const z = prefab === 'source' || prefab === 'palletQueue' ? 0.08 : prefab === 'processor' ? 0.15 : 0.17;
  let index = 2;
  return rows.reduce((list, [xs, oldY, newY]) => list.concat(xs.map(x => ({path: prefix + index++,
    before: [x, oldY, z], after: [prefab === 'conveyor' || prefab === 'plc' ? Math.sign(x) * 0.29 : x, newY, z]}))), []);
}
function additions(data) { return Object.values(data.rooms).flatMap(room => room.additions); }
function record(data, id) { return additions(data).find(row => row.id === id); }
function equivalent(actual, expected, label = 'document') {
  if (typeof expected === 'number') return assert(Math.abs(actual - expected) < 1e-12, label);
  if (!expected || typeof expected !== 'object') return assert.equal(actual, expected, label);
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), label);
  Object.keys(expected).forEach(key => equivalent(actual[key], expected[key], label + '.' + key));
}

async function run() {
  const document = setup(), created = [];
  ['hall', 'sound'].forEach((roomId, roomIndex) => kinds.forEach((kind, index) => {
    const object = document.addPrefab(roomId, kind);
    document.setTransform(object, {position: [index * 8, 1, roomIndex * 15], rotation: [0.13, 0.21, -0.07], scale: [1.03, 1.1, 0.97]});
    created.push(object);
  }));
  const belt = created[0], entry = document.additions.get(belt.userData.editorId), panel = entry.nodes.get('6'), sensor = entry.nodes.get('4');
  document.setTransform(panel, {position: [0.76, 0.49, 1.4], rotation: [0, 0.17, 0], scale: [0.9, 1.05, 1.1]});
  document.setTransform(sensor, {position: [-1.62, 0.1, 0.04], rotation: [0.08, 0.1, 0.03]});
  const material = Object.assign(behaviorSchema.defaultBehavior('surfaceMaterial'), {name: 'Panel pintado propio', color: '#946032', wear: 0.7});
  const layers = wearSchema.normalizeLayerJSON([{id: 'panel-rust', pattern: 'rust', width: 0.4, height: 0.3, depth: 0.1,
    stamps: [{position: [0.1, 0.1, 0.03], quaternion: [0, 0, 0, 1], scale: [1, 1, 1]}]}]);
  const firstButton = entry.nodes.get('6.2');
  document.setBehaviors(firstButton, document.getBehaviors(firstButton).concat([material, {type: 'surfaceWear', layers}]));
  await document.replaceAsset(firstButton, {type: 'cylinder', color: '#ab32de'});
  const expected = await document.serialize(), legacy = clone(expected);
  additions(legacy).forEach(row => poses(row.descriptor.prefab).forEach(pose => { row.nodes[pose.path].position = pose.before.slice(); }));
  const originalLegacy = clone(legacy);
  const targetSource = record(legacy, created[2].userData.editorId), expectedSource = record(expected, created[2].userData.editorId);
  // Keep three independent customizations even when their former default
  // position still identifies other untouched buttons on the same panel.
  targetSource.nodes['2.2'].position = [-0.11, 0.13, 0.09];
  targetSource.nodes['2.3'].quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.2, 0)).toArray();
  targetSource.nodes['2.4'].scale = [0.91, 0.82, 0.82];
  ['2.2', '2.3', '2.4'].forEach(key => { expectedSource.nodes[key] = clone(targetSource.nodes[key]); });
  const before = clone(legacy), noGeometry = setup(), count = factoryCalls;
  const validated = noGeometry._validate(legacy);
  assert.equal(factoryCalls, count, 'Migrating inactive-room records must not allocate prefab models, textures or geometry.');
  assert.deepEqual(legacy, before, 'Loading or copying never mutates the incoming project/clipboard object.');
  equivalent(validated.rooms, expected.rooms);

  const loaded = setup(); await loaded.load(legacy, {activeRoomId: 'hall'});
  assert(loaded.hasPendingRoom('sound'));
  equivalent(await loaded.serialize(), expected, 'lazy serialized document');
  const restoredPanel = loaded.getObject(panel.userData.editorId), restoredSensor = loaded.getObject(sensor.userData.editorId);
  equivalent(restoredPanel.position.toArray(), panel.position.toArray());
  equivalent(restoredPanel.quaternion.toArray(), panel.quaternion.toArray());
  equivalent(restoredSensor.position.toArray(), sensor.position.toArray());
  equivalent(restoredSensor.quaternion.toArray(), sensor.quaternion.toArray());
  const restoredButton = loaded.getObject(firstButton.userData.editorId);
  assert.equal(loaded.getBehaviors(restoredButton).find(item => item.type === 'control').targetId, belt.userData.editorId);
  assert.deepEqual(loaded.getVisualDescriptor(restoredButton), {type: 'cylinder', color: '#ab32de'});
  assert.equal(loaded.getBehaviors(restoredButton).find(item => item.type === 'surfaceWear').layers, layers);
  await loaded.activateRoom('sound');
  equivalent(await loaded.serialize(), expected, 'hydrated document');
  const saved = await loaded.serialize(); validateDocument(saved, value => value);
  const reopened = setup(); await reopened.load(saved);
  equivalent(await reopened.serialize(), saved, 'idempotent reopen');

  const clipboard = document.captureObject(belt);
  clipboard.record = clone(record(originalLegacy, belt.userData.editorId));
  const copy = await loaded.pasteObject(clipboard, 'hall', 4);
  const copyEntry = loaded.additions.get(copy.userData.editorId);
  poses('conveyor').forEach(pose => assert.deepEqual(copyEntry.nodes.get(pose.path).position.toArray(), pose.after));
  const copiedButton = copyEntry.nodes.get('6.2');
  assert.equal(loaded.getBehaviors(copiedButton).find(item => item.type === 'control').targetId, copy.userData.editorId);
  assert.equal(loaded.getBehaviors(copiedButton).find(item => item.type === 'surfaceWear').layers, layers);
  assert.deepEqual(loaded.getVisualDescriptor(copiedButton), {type: 'cylinder', color: '#ab32de'});
  const afterPaste = await loaded.serialize(); assert(loaded.undo()); assert(!loaded.getObject(copy.userData.editorId));
  assert(loaded.redo()); equivalent(await loaded.serialize(), afterPaste, 'copy undo/redo');

  // A new project with one deliberately relocated button is not a legacy
  // layout. Duplicating it must preserve the user's local placement.
  const current = clone(saved), currentBelt = record(current, belt.userData.editorId);
  currentBelt.nodes['6.2'].position = poses('conveyor')[0].before.slice();
  const single = setup(); await single.load(current);
  assert.deepEqual(single.getObject(belt.userData.editorId + '/6.2').position.toArray(), poses('conveyor')[0].before);
  equivalent(await single.serialize(), current);
  const overBudget = clone(saved), large = record(overBudget, belt.userData.editorId), oldState = clone(large.nodes['6.2']);
  large.nodes = {};
  for (let index = 0; index < 10001; index++) large.nodes['9.' + index] = oldState;
  assert.throws(() => setup()._validate(overBudget), /demasiados objetos/, 'Retired or migrated paths still count against the total document budget.');
  console.log('Panel migration: legacy controls raised, custom transforms/assets/materials retained, independent clipboard bindings, lazy rooms, idempotent load and undo/redo passed.');
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = {poses};
