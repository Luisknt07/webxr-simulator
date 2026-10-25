'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), {createRequire} = require('node:module');
const schema = require('../shared/behaviors'), {validateDocument} = require('../server/validation');
const file = path.join(__dirname, 'test-editor-runtime.js'), source = fs.readFileSync(file, 'utf8');
const {harness, storage, remote, THREE} = new Function('require', '__dirname', source.slice(0, source.indexOf('async function run()')) + '\nreturn {harness,storage,remote,THREE};')(createRequire(file), __dirname);
const api = require('./load-industrial-monitor-layout')(THREE, schema), floorAPI = require('./load-industrial-floor')(THREE, schema);
function close(a, b) { assert.equal(a.length, b.length); a.forEach((value, index) => assert(Math.abs(value - b[index]) < 1e-5, value + '/' + b[index])); }
async function run() {
  storage.clear(); remote.projects.clear(); const f = harness(), e = f.editor; await e.ready;
  const document = e.document, roomId = e.roomId, root = document.getRoot(roomId);
  const primitive = (name, position, scale, color) => { const object = document.addPrimitive(roomId, 'box', color); document.setProperty(object, 'name', name); document.setTransform(object, {position, scale}); return object; };
  primitive('Piso industrial · hormigón mate', [0, -.06, 0], [32, .12, 28], '#777c76'); primitive('CEDI · Cubierta interior cerrada', [0, 8, 0], [32, .16, 28], '#656c65');
  const machines = ['source', 'conveyor', 'processor'].map((type, index) => { const object = document.addPrefab(roomId, type, type === 'conveyor' ? 'roller-motor' : undefined); document.setTransform(object, {position: [-6 + index * 6, 1, -4]}); return object; });
  for (let index = 0; index < 2; index++) document.setBehaviors(machines[index], document.getBehaviors(machines[index]).map(value => ['source', 'conveyor'].includes(value.type) ? Object.assign({}, value, {outputId: machines[index + 1].userData.editorId}) : value));
  const monitor = primitive('Monitor · Fixture', [-7, 2, 5], [3.2, 1.8, .12], '#202f39'); document.setBehaviors(monitor, [Object.assign(schema.defaultBehavior('lineMonitor'), {targetId: machines[1].userData.editorId, scope: 'line', title: 'Fixture protegida'})]);
  const stand = primitive('Pedestal del monitor', [-7, .55, 5], [.12, 1.1, .12], '#405360'), custom = primitive('Mi pedestal personalizado', [-7, .55, 7], [.12, 1.1, .12], '#405360');
  const line = {objects: machines.concat(monitor, stand)}, group = {id: 'fixture-monitor-group', name: 'Grupo protegido', roomId, members: line.objects.map(object => object.userData.editorId)}; document.setStudio({groups: [group]});
  floorAPI.applyIndustrialFloorPresentation(document, roomId);
  const before = await document.serialize(), depth = document.undoStack.length, plan = api.deriveIndustrialMonitorLayout(document, roomId); assert.equal(plan.layouts.length, 1); assert.deepEqual(plan.warnings, []); assert(plan.removedLegacyIds.includes(stand.userData.editorId));
  root.position.set(12, -2, 7); root.rotation.set(.21, .8, -.13); root.scale.set(1.2, .85, 1.1); root.updateWorldMatrix(true, true);
  const rotated = api.deriveIndustrialMonitorLayout(document, roomId); close(rotated.layouts[0].position, plan.layouts[0].position); close(rotated.layouts[0].quaternion, plan.layouts[0].quaternion); close(rotated.layouts[0].scale, plan.layouts[0].scale);
  root.position.set(0, 0, 0); root.quaternion.set(0, 0, 0, 1); root.scale.set(1, 1, 1); root.updateWorldMatrix(true, true);
  const result = api.applyIndustrialMonitorLayout(document, roomId, {lines: [line]}); assert(result.changed); assert.deepEqual(result.warnings, []); assert.deepEqual(result.affectedObjectIds, [monitor.userData.editorId]); assert.equal(result.addedObjectIds.length, 3); assert.deepEqual(result.removedLegacyIds, [stand.userData.editorId]); assert.deepEqual(result.affectedGroupIds, [group.id]); assert(document.getObject(custom.userData.editorId));
  assert.equal(monitor.position.y, 2.15); assert.deepEqual(monitor.scale.toArray(), [3, 1.6875, .09]); assert.equal(document.undoStack.length, depth + 1);
  const after = await document.serialize(), allowed = new Set(result.affectedObjectIds.concat(result.removedLegacyIds));
  before.rooms[roomId].additions.filter(row => !allowed.has(row.id)).forEach(row => assert.deepEqual(after.rooms[roomId].additions.find(value => value.id === row.id), row, 'Machine recipes, links, controls, floor paint/wear and unrelated props remain literal.'));
  assert.deepEqual(document.getBehaviors(monitor), before.rooms[roomId].additions.find(row => row.id === monitor.userData.editorId).behaviors, 'Placement never rewrites monitor content or targets.');
  assert(line.objects.every(object => document.getObject(object.userData.editorId) === object)); assert(result.addedObjectIds.every(id => document.studio.groups[0].members.includes(id)));
  result.supports.forEach(part => { const config = document.getBehaviors(part); assert(config.some(value => value.type === 'collision' && value.enabled === false)); assert(config.some(value => value.type === 'surfaceMaterial' && value.roughness >= .8)); assert(part.position.y > 3); assert(part.scale.toArray().every(Number.isFinite)); });
  const rods = result.supports.filter(part => part.name.includes('tirante')); assert.equal(rods.length, 2); rods.forEach(rod => { assert(Math.abs(rod.position.y - rod.scale.y / 2 - (monitor.position.y + monitor.scale.y / 2)) < 1e-5); assert(Math.abs(rod.position.y + rod.scale.y / 2 - plan.layouts[0].ceilingY) < 1e-5); });
  const repeat = api.applyIndustrialMonitorLayout(document, roomId); assert.equal(repeat.changed, false); assert.deepEqual(await document.serialize(), after, 'Version1 layout is idempotent.');
  document.undo(); assert.deepEqual(await document.serialize(), before); document.redo(); assert.deepEqual(await document.serialize(), after); const saved = validateDocument(after, value => value);
  const reopened = harness(); await reopened.editor.ready; await reopened.editor.document.load(saved, {activeRoomId: roomId}); assert.equal(reopened.editor.document.getObjects(roomId).filter(object => object.name.startsWith('Suspensión HMI v1 · ')).length, 3);
  assert.deepEqual(reopened.editor.document.getBehaviors(reopened.editor.document.getObject(monitor.userData.editorId)), document.getBehaviors(monitor));
  e.projectSync.stop(); reopened.editor.projectSync.stop(); e.clearAssembly(true); reopened.editor.clearAssembly(true);
  console.log('Monitor layout: lateral safe placement, protected floor routes/equipment, exact rotated/scaled room coordinates, three thin ceiling supports, strict pedestal removal, limited group edits, unchanged flow/controls, one undo, idempotence and reopen passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
