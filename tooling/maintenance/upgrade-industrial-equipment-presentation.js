const __layout = require("../layout.cjs");
'use strict';
// Read-only preparation computes real CPU prefabs and all three production
// helpers. Only --apply writes, and all three reviewed revisions commit once.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const {DatabaseSync, backup} = require('node:sqlite');
const schema = require('../../modules/logistica-industrial/contracts/behaviors'), materials = require('../../packages/render-three/schema/materials'), {validateDocument} = require('../../apps/api/server/validation');
const publication = require('./publish-study-projects'), presentation = require('./upgrade-industrial-presentation'), floorMigration = require('./upgrade-industrial-floor');
const ROOT = __layout.map(path.resolve(__layout.oldDir("scripts/upgrade-industrial-equipment-presentation.js"), '..')), clone = value => JSON.parse(JSON.stringify(value)), hash = presentation.hash;
const TARGETS = presentation.TARGETS.map((target, index) => Object.assign({}, target, {baseRevision: [16, 3, 3][index], nextRevision: [17, 4, 4][index], baseHash: ['124a4b3e0ab275fdb9144b76474c0e84dba5635b951a59f03a179c1c999c4060', 'f83c66aeece14c0b11397d75623bb93ef0902551567119646486e619cb734fe6', '316371e58946a39c6259b702cc32ab87c821a2dd66221600393283c2fc1f3983'][index], candidateFile: 'equipment-' + target.key + '-candidate.json'}));
const MACHINE_TYPES = ['source', 'conveyor', 'processor', 'palletQueue'], FINISH_TYPES = ['surfaceMaterial', 'surfaceWear'];
const INFO_FIELDS = ['presentation', 'revealDistance', 'fadeDistance', 'fadeTime', 'gazeAngle', 'width'];
const BOARD_NAMES = /^(?:(?:\d{2} · )?Rótulo ·|Guía ·|Guía de red ·|Etiqueta de destino ·|CEDI · guía del proceso)/;
const MONITOR_NAMES = /^(?:\d{2} · )?(?:Monitor 2D · |Monitor · |Supervisión CEDI · )/;
const LEGACY_NAMES = /^(?:\d{2} · )?(?:Soporte de monitor · .+|Base de monitor · .+|Pedestal del monitor(?: CEDI)?|Base del monitor CEDI)$/;
const sourceFiles = ["modules/logistica-industrial/functions/presentacion/runtime/IndustrialMessages.js", "modules/logistica-industrial/functions/presentacion/runtime/IndustrialAgingPresentation.js", "modules/logistica-industrial/functions/presentacion/runtime/IndustrialFinishes.js", "modules/logistica-industrial/functions/presentacion/runtime/IndustrialMonitorLayout.js", "modules/logistica-industrial/functions/presentacion/runtime/IndustrialFloorPresentation.js", "modules/logistica-industrial/functions/presentacion/runtime/IndustrialPrefabs.js", "packages/project-model/src/SceneDocument.js", "tests/support/load-industrial-aging.js", "tests/support/load-industrial-monitor-layout.js", "tests/support/load-industrial-floor.js", "tooling/maintenance/upgrade-industrial-equipment-presentation.js"].concat(fs.readdirSync(__layout.map(path.join(ROOT, 'shared'))).filter(file => file.endsWith('.js')).map(file => 'shared/' + file));
function sourceState() { const files = sourceFiles.map(file => ({file, hash: publication.bytesHash(fs.readFileSync(__layout.map(path.join(ROOT, file))))})); return {files, hash: publication.hash(files)}; }
function readSource(file) { return fs.readFileSync(__layout.map(path.join(ROOT, 'src/editor', file)), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''); }
function loadCPU() {
  const base = floorMigration.loadCPU(), aging = require('../../tests/support/load-industrial-aging')(THREE), monitor = require('../../tests/support/load-industrial-monitor-layout')(THREE, schema);
  const applyIndustrialMessages = new Function('schema', readSource('IndustrialMessages.js') + '\nreturn applyIndustrialMessages;')(schema);
  class EquipmentDocument extends base.SceneDocument {
    _newId() { if (!this.equipmentReservedIds) this.equipmentReservedIds = new Set(); let id; do { id = 'custom-equipment-upgrade-' + this.nextId++; } while (this.objects.has(id) || this.equipmentReservedIds.has(id)); this.equipmentReservedIds.add(id); return id; }
  }
  return Object.assign({SceneDocument: EquipmentDocument, applyIndustrialMessages, deriveIndustrialFloorPresentation: base.deriveIndustrialFloorPresentation}, aging, monitor);
}
function dispose(root) {
  const geometries = new Set(), surfaces = new Set(), textures = new Set(); root.traverse(object => { if (object.geometry) geometries.add(object.geometry); (Array.isArray(object.material) ? object.material : [object.material]).filter(Boolean).forEach(material => { surfaces.add(material); Object.values(material).forEach(value => { if (value && value.isTexture) textures.add(value); }); }); }); textures.forEach(value => value.dispose()); surfaces.forEach(value => value.dispose()); geometries.forEach(value => value.dispose());
}
function behavior(record, type) { return (record.behaviors || []).find(value => value.type === type); }
function patchBehaviors(original, updated, allowed) {
  const next = new Map((updated || []).filter(value => allowed.includes(value.type)).map(value => [value.type, clone(value)]));
  const result = (original || []).map(value => { if (!allowed.includes(value.type)) return clone(value); const replacement = next.get(value.type); assert(replacement, 'A presentation helper removed a behavior.'); next.delete(value.type); return replacement; });
  return result.concat([...next.values()]);
}
function except(record, keys, types = []) { const result = clone(record); keys.forEach(key => delete result[key]); if (types.length) result.behaviors = (result.behaviors || []).filter(value => !types.includes(value.type)); return result; }
function knownBoard(record) { return record && record.descriptor.type === 'box' && ['#172d42', '#182b38'].includes(record.descriptor.color) && !record.color && BOARD_NAMES.test(record.name) && behavior(record, 'info') && !(record.behaviors || []).some(value => schema.simulationTypes.includes(value.type) || ['lineMonitor', 'control', 'sensor', 'plc'].includes(value.type)); }
function assertMessage(before, after) {
  assert(knownBoard(before), 'Only known generated guide boards may become contextual.');
  assert.equal(hash(except(after, ['position', 'scale'], ['info'])), hash(except(before, ['position', 'scale'], ['info'])), 'A message changed its ID, content wrapper, rotation, nodes, custom material or other behaviors.');
  const oldInfo = behavior(before, 'info'), nextInfo = behavior(after, 'info'), preserved = value => { const result = clone(value); INFO_FIELDS.forEach(key => delete result[key]); return result; };
  assert.equal(hash(preserved(nextInfo)), hash(preserved(oldInfo)), 'Authored title, text, text color and enabled state stay literal.');
  assert.deepEqual(Object.fromEntries(INFO_FIELDS.map(key => [key, nextInfo[key]])), {presentation: 'contextual', revealDistance: 5, fadeDistance: .75, fadeTime: .22, gazeAngle: 110, width: 1});
  assert.deepEqual(after.position, [before.position[0], /^Etiqueta de destino ·/.test(before.name) && before.position[1] > 2.7 ? before.position[1] : 1.55, before.position[2]]); assert.deepEqual(after.scale, [1, .625, .025]);
}
function customWear(record) { const wear = behavior(record, 'surfaceWear'); return JSON.parse(wear && wear.layers || '[]').filter(layer => !layer.id.startsWith('industrial-aging-v1-')); }
function assertAging(before, after) {
  assert(MACHINE_TYPES.includes(before.descriptor.prefab)); assert(!before.color && !before.visual, 'Custom tinted/replaced equipment must remain literal.');
  assert.equal(hash(except(after, [], FINISH_TYPES)), hash(except(before, [], FINISH_TYPES)), 'Aging changed equipment recipes, nodes, graph references, control configuration or transforms.');
  const previous = behavior(before, 'surfaceMaterial'), next = behavior(after, 'surfaceMaterial'); assert(next && next.enabled);
  const assignments = value => value ? materials.assignments(value) : [], original = assignments(previous), updated = assignments(next);
  assert(original.every(row => /^Industrial · /.test(row.name)), 'Custom materials cannot be aged.'); assert(updated.every(row => /^Industrial · /.test(row.name)), 'Only generated industrial finishes are allowed.');
  if (previous) {
    assert.equal(updated.length, original.length + (updated.some(row => row.slot === 'part:Armario y pedestal Processor') && !original.some(row => row.slot === 'part:Armario y pedestal Processor') ? 1 : 0));
    original.forEach(row => { const fresh = updated.find(value => value.slot === row.slot); assert(fresh); const brushedWorktop = /^name:Mesa de (?:proceso inoxidable|próxima carga)/u.test(row.slot); const strip = value => { const result = clone(value); ['seed', 'wear', 'wearType'].concat(brushedWorktop ? ['repeatX', 'repeatY'] : []).forEach(key => delete result[key]); return result; }; assert.deepEqual(strip(fresh), strip(row), 'Generated PBR may only change deterministic wear and approved worktop-grain parameters.'); if (brushedWorktop) { assert.equal(fresh.repeatX, 3); assert.equal(fresh.repeatY, 8); } });
  }
  const wear = behavior(after, 'surfaceWear'), oldWear = behavior(before, 'surfaceWear'); assert(wear && wear.enabled && (!oldWear || oldWear.enabled)); assert.equal(hash(customWear(after)), hash(customWear(before)), 'Existing non-aging brush strokes stay literal.');
  const generated = JSON.parse(wear.layers).filter(layer => layer.id.startsWith('industrial-aging-v1-'));
  assert(generated.length <= 6); assert(generated.every(layer => ['edge-chips', 'lower-frame-dirt', 'panel-runoff', 'joint-oxidation', 'drive-grease', 'worktop-rubbing'].some(id => layer.id === 'industrial-aging-v1-' + id))); schema.normalizeBehaviors([next, wear]);
}
function knownLegacy(record, monitors) {
  if (!record || record.descriptor.type !== 'box' || !['#3d505b', '#405360'].includes(record.descriptor.color) || record.color || (record.behaviors || []).length || !LEGACY_NAMES.test(record.name)) return false;
  const near = (a, b) => Math.abs(a - b) < 1e-5, stand = [.12, 1.1, .12].every((value, index) => near(record.scale[index], value)) && near(record.position[1], .55), base = [.85, .07, .65].every((value, index) => near(record.scale[index], value)) && near(record.position[1], .035);
  return (stand || base) && monitors.some(row => Math.hypot(record.position[0] - row.position[0], record.position[2] - row.position[2]) < .05);
}
function assertMonitor(before, after, layout) {
  assert(MONITOR_NAMES.test(before.name) && behavior(before, 'lineMonitor')); assert.equal(hash(except(after, ['position', 'quaternion', 'scale'])), hash(except(before, ['position', 'quaternion', 'scale'])), 'A monitor may only move and resize; title/target/behaviors remain literal.');
  for (const key of ['position', 'quaternion', 'scale']) assert.deepEqual(after[key], key === 'quaternion' ? normalizedQuaternion(layout[key]) : layout[key]); assert.deepEqual(after.scale, [3, 1.6875, .09]); assert.equal(layout.supportIds.length, 3);
}
function normalizedQuaternion(value) { const length = Math.hypot(...value); return Math.abs(length - 1) > 16 * Number.EPSILON ? value.map(component => component / length) : value.slice(); }
function assertSupport(record, layout, index) {
  assert(record); assert.deepEqual(record.descriptor, {type: 'box', color: '#3a454a'}); assert.equal(record.name, 'Suspensión HMI v1 · ' + layout.monitorId + ' · ' + ['tirante izquierdo', 'tirante derecho', 'perfil de techo'][index]);
  assert.deepEqual(record.interaction, {type: 'none'}); assert.equal(record.visible, true); assert.equal(record.color, null); assert(!record.visual && (!record.nodes || !Object.keys(record.nodes).length)); assert.deepEqual(record.quaternion, normalizedQuaternion(layout.quaternion));
  const configs = record.behaviors || []; assert.equal(configs.length, 2); assert.equal(behavior(record, 'collision').enabled, false); const finish = behavior(record, 'surfaceMaterial'); assert(finish && finish.color === '#3a454a' && finish.preset === 'paintedMetal' && finish.roughness === .86 && finish.metalness === .18); assert(!finish.overrides.length && !finish.texture);
  const round = value => Math.round(value * 1000000) / 1000000, yaw = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().fromArray(normalizedQuaternion(layout.quaternion)), 'YXZ').y, top = layout.position[1] + 1.6875 / 2, length = layout.ceilingY - top, side = index ? 1 : -1;
  const position = index === 2 ? [layout.position[0], layout.ceilingY, layout.position[2]] : [layout.position[0] + side * 3 * .31 * Math.cos(yaw), top + length / 2, layout.position[2] - side * 3 * .31 * Math.sin(yaw)];
  assert.deepEqual(record.position, position.map(round)); assert.deepEqual(record.scale, (index === 2 ? [2.1, .04, .16] : [.035, length, .035]).map(round));
  const expected = [Object.assign(schema.defaultBehavior('collision'), {enabled: false}), Object.assign(schema.defaultBehavior('surfaceMaterial'), {preset: 'paintedMetal', color: '#3a454a', colorMapMode: 'none', roughness: .86, metalness: .18, clearcoat: 0})]; assert.deepEqual(configs, schema.normalizeBehaviors(expected));
}
function mergeRoom(original, before, after, results) {
  const {messages, monitors} = results, old = new Map(before.additions.map(row => [row.id, row])), next = new Map(after.additions.map(row => [row.id, row])), messageIds = new Set(messages.changedObjectIds), monitorIds = new Set(monitors.affectedObjectIds), removed = new Set(monitors.removedLegacyIds), added = new Set(monitors.addedObjectIds);
  assert.equal(hash(before.overrides), hash(after.overrides), 'Native overrides changed.'); assert.equal(removed.size, monitors.removedLegacyIds.length); assert.equal(added.size, monitors.addedObjectIds.length); assert.equal(added.size, monitorIds.size * 3);
  const monitorRows = [...monitorIds].map(id => old.get(id)); removed.forEach(id => { assert(knownLegacy(old.get(id), monitorRows), 'An unapproved pedestal would be removed: ' + id); assert(!next.has(id)); });
  const patches = [], agedIds = [], floorIds = [];
  const additions = original.additions.filter(row => !removed.has(row.id)).map(originalRow => {
    const initial = old.get(originalRow.id), updated = next.get(originalRow.id); assert(initial && updated); const record = clone(originalRow), types = [];
    if (messageIds.has(record.id)) { record.position = clone(updated.position); record.scale = clone(updated.scale); types.push('info'); }
    if (monitorIds.has(record.id)) { ['position', 'quaternion', 'scale'].forEach(key => { record[key] = clone(updated[key]); }); }
    if (MACHINE_TYPES.includes(record.descriptor.prefab) && hash((initial.behaviors || []).filter(row => FINISH_TYPES.includes(row.type))) !== hash((updated.behaviors || []).filter(row => FINISH_TYPES.includes(row.type)))) { types.push(...FINISH_TYPES); agedIds.push(record.id); }
    const floor = results.floorAging.find(row => row.id === record.id); if (floor) { record.behaviors = clone(floor.record.behaviors); floorIds.push(record.id); }
    if (types.length) record.behaviors = patchBehaviors(originalRow.behaviors, updated.behaviors, types);
    const expectedLoaded = clone(initial); if (messageIds.has(record.id)) { expectedLoaded.position = clone(updated.position); expectedLoaded.scale = clone(updated.scale); }
    if (monitorIds.has(record.id)) ['position', 'quaternion', 'scale'].forEach(key => { expectedLoaded[key] = clone(updated[key]); });
    if (types.length || floor) { const allowed = floor ? ['surfaceWear'] : types; assert.deepEqual((updated.behaviors || []).filter(value => !allowed.includes(value.type)), (initial.behaviors || []).filter(value => !allowed.includes(value.type)), 'A helper changed an unrelated behavior.'); expectedLoaded.behaviors = clone(updated.behaviors); }
    assert.equal(hash(updated), hash(expectedLoaded), 'The helper changed an unapproved actor field: ' + record.id);
    if (hash(originalRow) !== hash(record)) patches.push({id: record.id, message: messageIds.has(record.id), monitor: monitorIds.has(record.id), aging: agedIds.includes(record.id), floorAging: floorIds.includes(record.id), expectedHash: hash(record)});
    return record;
  });
  monitors.layouts.filter(layout => !layout.existing).forEach(layout => layout.supportIds.forEach((id, index) => { assert(added.has(id) && !old.has(id)); const support = next.get(id); assertSupport(support, layout, index); additions.push(clone(support)); }));
  assert.equal(next.size, old.size - removed.size + added.size); assert.equal(additions.length, original.additions.length - removed.size + added.size);
  return {room: Object.assign({}, clone(original), {additions}), manifest: {patches, messageIds: [...messageIds], agedIds, floorIds, monitorIds: [...monitorIds], addedObjectIds: [...added], removedLegacyIds: [...removed], affectedGroupIds: monitors.affectedGroupIds, layouts: monitors.layouts, warnings: monitors.warnings, removedLegacy: [...removed].map(id => ({id, name: old.get(id).name, expectedHash: hash(original.additions.find(row => row.id === id))})), added: [...added].map(id => ({id, expectedHash: publication.hash(next.get(id))})), helperReports: {messages: {boards: messages.boards}, aging: results.aging, floorAging: floorIds.length, monitors: monitors.report}}};
}
function updatedGroups(before, manifest) {
  const removed = new Set(manifest.flatMap(row => row.removedLegacyIds));
  return (before || []).map(group => { const layouts = manifest.flatMap(row => row.layouts.filter(layout => !layout.existing && group.members.includes(layout.monitorId))); const members = [...new Set(group.members.filter(id => !removed.has(id)).concat(...layouts.map(layout => layout.supportIds)))]; return Object.assign({}, clone(group), {members}); });
}
function verifyCandidate(before, proposed, manifest, target) {
  assert.equal(manifest.length, target.rooms.length); assert.deepEqual(manifest.map(row => row.roomId).sort(), target.rooms.slice().sort()); const expected = clone(before), allAffectedGroups = new Set();
  manifest.forEach(change => {
    const previous = before.rooms[change.roomId], after = proposed.rooms[change.roomId], rows = new Map(previous.additions.map(row => [row.id, row])), next = new Map(after.additions.map(row => [row.id, row])), removed = new Set(change.removedLegacyIds);
    assert.equal(change.sourceRoomHash, hash(previous)); assert.equal(change.floorplanHash, hash(previous.additions.filter(row => row.descriptor.type === 'industrialFloor').map(row => row.descriptor)));
    assert.equal(removed.size, change.removedLegacyIds.length); assert.equal(change.addedObjectIds.length, change.monitorIds.length * 3); assert.equal(change.layouts.filter(row => !row.existing).length, change.monitorIds.length); assert.equal(change.warnings.length, 0, 'All generated monitors need a clear final placement.');
    const patches = new Map(change.patches.map(row => [row.id, row])); assert.equal(patches.size, change.patches.length);
    for (const [key, flag] of [['messageIds', 'message'], ['agedIds', 'aging'], ['floorIds', 'floorAging'], ['monitorIds', 'monitor']]) assert.deepEqual(change[key].slice().sort(), change.patches.filter(row => row[flag]).map(row => row.id).sort(), 'A helper affected-ID list does not match its approved patches.');
    change.removedLegacyIds.forEach(id => { const record = rows.get(id); assert(knownLegacy(record, change.monitorIds.map(id => rows.get(id)))); assert.equal(change.removedLegacy.find(row => row.id === id).expectedHash, hash(record)); assert(!next.has(id)); });
    expected.rooms[change.roomId].additions = previous.additions.filter(row => !removed.has(row.id)).map(row => {
      const patch = patches.get(row.id); if (!patch) return clone(row); const updated = next.get(row.id); assert(updated && hash(updated) === patch.expectedHash);
      const copy = clone(row), allowed = [];
      if (patch.message) { assert(change.messageIds.includes(row.id)); assertMessage(row, updated); copy.position = clone(updated.position); copy.scale = clone(updated.scale); allowed.push('info'); }
      if (patch.monitor) { assert(change.monitorIds.includes(row.id)); const layout = change.layouts.find(value => value.monitorId === row.id); assertMonitor(row, updated, layout); ['position', 'quaternion', 'scale'].forEach(key => { copy[key] = clone(updated[key]); }); }
      if (patch.aging) { assert(change.agedIds.includes(row.id)); assertAging(row, updated); allowed.push(...FINISH_TYPES); }
      if (patch.floorAging) { assert(change.floorIds.includes(row.id) && row.id === change.floorObjectId && row.descriptor.type === 'box'); const aged = require('../../tests/support/load-industrial-aging')(THREE).ageIndustrialFloorRecord(row); assert.deepEqual(updated, aged.record, 'Only the four existing generated floor-wear profiles may intensify.'); allowed.push('surfaceWear'); }
      if (allowed.length) copy.behaviors = patchBehaviors(row.behaviors, updated.behaviors, allowed); assert.deepEqual(copy, updated, 'An approved actor contains unrelated edits.'); return copy;
    });
    change.layouts.filter(layout => !layout.existing).forEach(layout => layout.supportIds.forEach((id, index) => { assert(change.addedObjectIds.includes(id) && !rows.has(id)); const support = next.get(id); assertSupport(support, layout, index); assert.equal(change.added.find(value => value.id === id).expectedHash, publication.hash(support)); expected.rooms[change.roomId].additions.push(clone(support)); }));
    change.affectedGroupIds.forEach(id => allAffectedGroups.add(id)); assert.equal(hash(after.overrides), hash(previous.overrides));
  });
  const groups = updatedGroups(before.studio.groups, manifest); const changedGroups = groups.filter((row, index) => hash(row) !== hash(before.studio.groups[index])).map(row => row.id); assert.deepEqual([...allAffectedGroups].sort(), changedGroups.sort(), 'Only reported monitor-group memberships may change.'); expected.studio.groups = groups;
  assert.deepEqual(proposed, expected, 'Candidate changed simulation, controls/nodes, geometry, custom materials, floorplan, Studio metadata, imports or protected rooms.'); const document = validateDocument(proposed, value => value); assert.deepEqual(document, expected);
  const protectedRooms = Object.keys(before.rooms).filter(id => !target.rooms.includes(id)).map(roomId => ({roomId, hash: hash(before.rooms[roomId])})); protectedRooms.forEach(row => assert.equal(hash(document.rooms[row.roomId]), row.hash));
  return {document, payloadHash: hash(document), protectedRooms, changedPaths: presentation.expandedDifferences(before, document).map(change => change.path).sort()};
}
async function buildCandidate(data, target) {
  const cpu = loadCPU(), workspace = floorMigration.nativeRoots(data), document = new cpu.SceneDocument({scene: workspace.scene, editorRoots: workspace.roots}), candidate = clone(data), manifest = [];
  Object.entries(workspace.roots).forEach(([id, root]) => document.registerRoom(id, root));
  try {
    assert.equal(data.imports.length, 0, 'Imported copies require a separately reviewed loader.'); Object.values(data.rooms).forEach(room => room.additions.forEach(row => assert(!row.descriptor.nativeId && !row.descriptor.importId && !row.descriptor.path)));
    await document.load(data); document.equipmentReservedIds = new Set(document.objects.keys()); document.undoStack.length = 0;
    for (const roomId of target.rooms) {
      console.log('Equipment prepare:', target.key, roomId); const before = await document.serialize(), objects = document.getObjects(roomId), machines = objects.filter(object => MACHINE_TYPES.includes(object.userData.editorPrefabKey));
      const messages = cpu.applyIndustrialMessages(document, roomId), aging = cpu.applyIndustrialAging(document, roomId, machines), floorAging = [], derivedFloor = cpu.deriveIndustrialFloorPresentation(document, roomId).floor; assert(derivedFloor, 'An authored floor is required.'); const floorObjectId = derivedFloor.userData.editorId;
      data.rooms[roomId].additions.filter(row => row.id === floorObjectId && behavior(row, 'surfaceWear')).forEach(row => { const aged = cpu.ageIndustrialFloorRecord(row); if (hash(aged.record) === hash(row)) return; const object = document.getObject(row.id); assert(object); document.setBehaviors(object, aged.record.behaviors); floorAging.push({id: row.id, record: aged.record}); });
      const monitors = cpu.applyIndustrialMonitorLayout(document, roomId); assert.equal(monitors.warnings.length, 0, 'A monitor has no safe placement in ' + roomId); const after = await document.serialize();
      const merged = mergeRoom(data.rooms[roomId], before.rooms[roomId], after.rooms[roomId], {messages, aging, floorAging, monitors}); candidate.rooms[roomId] = merged.room;
      floorAging.forEach(value => assert.deepEqual(cpu.ageIndustrialFloorRecord(value.record).record, value.record, 'Generated floor-wear enhancement must also be idempotent.'));
      const repeatedBefore = await document.serialize(); const repeatedMessages = cpu.applyIndustrialMessages(document, roomId); cpu.applyIndustrialAging(document, roomId, machines); const repeatedMonitors = cpu.applyIndustrialMonitorLayout(document, roomId); assert(!repeatedMessages.changed && !repeatedMonitors.changed && !repeatedMonitors.addedObjectIds.length && !repeatedMonitors.removedLegacyIds.length); const repeatedAfter = await document.serialize(); assert.equal(hash(repeatedAfter), hash(repeatedBefore), 'A repeated presentation helper changed saved content: ' + JSON.stringify(presentation.expandedDifferences(repeatedBefore, repeatedAfter).slice(0, 8)));
      manifest.push(Object.assign({roomId, floorObjectId, idempotent: true, sourceRoomHash: hash(data.rooms[roomId]), floorplanHash: hash(data.rooms[roomId].additions.filter(row => row.descriptor.type === 'industrialFloor').map(row => row.descriptor))}, merged.manifest)); document.undoStack.length = document.redoStack.length = 0;
    }
    candidate.studio.groups = updatedGroups(data.studio.groups, manifest); const actual = await document.serialize(); assert.deepEqual(actual.studio.groups, candidate.studio.groups, 'A helper altered unreported group metadata.'); const exceptGroups = value => { const result = clone(value); delete result.groups; return result; }; assert.equal(hash(exceptGroups(actual.studio)), hash(exceptGroups(data.studio))); assert.equal(hash(actual.imports), hash(data.imports));
    return Object.assign(verifyCandidate(data, candidate, manifest, target), {manifest});
  } finally { dispose(workspace.scene); }
}
function optionsFrom(argv) { const options = presentation.optionsFrom(argv); options.reportFile = __layout.map(path.join(options.outputDir, 'industrial-equipment-upgrade.json')); return options; }
function writeJSON(file, value) { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); }
function readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
async function makeBackup(database, options, initial, label) { const file = __layout.map(path.join(options.dataDir, 'backups', 'before-industrial-equipment-' + label + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.sqlite')); fs.mkdirSync(path.dirname(file), {recursive: true}); await backup(database, file); const copy = new DatabaseSync(file, {readOnly: true}); try { assert.equal(copy.prepare('PRAGMA quick_check').get().quick_check, 'ok'); assert.equal(publication.inventory(copy).fingerprint, initial.fingerprint); } finally { copy.close(); } return {file, sha256: publication.bytesHash(fs.readFileSync(file)), inventoryHash: initial.fingerprint}; }
function savedVersion(database, target) { const row = database.prepare('SELECT document FROM revisions WHERE project_id=? AND revision=?').get(target.id, target.nextRevision); assert(row); return JSON.parse(row.document); }
async function prepare(options) {
  const database = new DatabaseSync(options.databasePath, {readOnly: true});
  try { const initial = publication.inventory(database), projects = [], sources = sourceState(); let original;
    for (const target of TARGETS) { const guarded = presentation.guardBase(database, target); original = guarded.original; const safe = await buildCandidate(guarded.before.document, target), candidateFile = __layout.map(path.join(options.outputDir, target.candidateFile)); writeJSON(candidateFile, safe.document); projects.push({key: target.key, id: target.id, name: guarded.before.name, baseRevision: target.baseRevision, nextRevision: target.nextRevision, baseHash: target.baseHash, payloadHash: safe.payloadHash, candidateFile, candidateFileHash: publication.bytesHash(fs.readFileSync(candidateFile)), manifest: safe.manifest, protectedRooms: safe.protectedRooms, changedPaths: safe.changedPaths, exportFile: __layout.map(path.join(options.exportsDir, target.exportFile))}); }
    assert.deepEqual(sourceState(), sources, 'Helper source changed during preparation; regenerate candidates.'); const snapshot = await makeBackup(database, options, initial, 'prepared'); assert.equal(publication.inventory(database).fingerprint, initial.fingerprint); const report = {format: 'hello-webxr-industrial-equipment-upgrade', version: 1, mode: 'dry-run', preparedAt: new Date().toISOString(), databasePath: options.databasePath, sources, backup: snapshot, projects, original: {id: presentation.ORIGINAL, revision: 9, rawHash: original.rawHash}, otherProjects: presentation.otherProjectsState(initial), writes: [], exportWritten: false}; writeJSON(options.reportFile, report); return report;
  } finally { database.close(); }
}
async function apply(options) {
  const report = readJSON(options.reportFile); assert.equal(report.format, 'hello-webxr-industrial-equipment-upgrade'); assert.equal(report.version, 1); assert.deepEqual(sourceState(), report.sources, 'Helper source differs from the reviewed candidates.'); assert.equal(__layout.map(path.resolve(report.databasePath)), __layout.map(path.resolve(options.databasePath))); assert.equal(report.projects.length, TARGETS.length); assert.equal(publication.bytesHash(fs.readFileSync(report.backup.file)), report.backup.sha256);
  const reader = new DatabaseSync(options.databasePath, {readOnly: true}); let plans = [], snapshot;
  try { const initial = publication.inventory(reader); assert.deepEqual(presentation.otherProjectsState(initial), report.otherProjects);
    for (const target of TARGETS) { const artifact = report.projects.find(project => project.key === target.key); assert(artifact && artifact.id === target.id && artifact.baseHash === target.baseHash && artifact.baseRevision === target.baseRevision && artifact.nextRevision === target.nextRevision); assert.equal(__layout.map(path.resolve(artifact.candidateFile)), __layout.map(path.join(options.outputDir, target.candidateFile))); assert.equal(publication.bytesHash(fs.readFileSync(artifact.candidateFile)), artifact.candidateFileHash); const {before} = presentation.guardBase(reader, target), safe = verifyCandidate(before.document, readJSON(artifact.candidateFile), artifact.manifest, target); assert.equal(safe.payloadHash, artifact.payloadHash); assert.deepEqual(safe.changedPaths, artifact.changedPaths); presentation.targetAction(reader, safe, target); const rebuilt = await buildCandidate(before.document, target); assert.deepEqual(rebuilt.document, safe.document, 'The reviewed candidate no longer matches the production helpers.'); plans.push({target, artifact, safe}); }
    snapshot = await makeBackup(reader, options, initial, 'apply');
  } finally { reader.close(); }
  const database = new DatabaseSync(options.databasePath); let writes = [], projects;
  try { database.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE;');
    try { assert.deepEqual(sourceState(), report.sources); const initial = publication.inventory(database); assert.deepEqual(presentation.otherProjectsState(initial), report.otherProjects); projects = [];
      for (const {target, artifact, safe} of plans) { const {before} = presentation.guardBase(database, target), action = presentation.targetAction(database, safe, target); if (action.startsWith('create-')) { const timestamp = new Date().toISOString(), updated = database.prepare('UPDATE projects SET revision=?,updated_at=? WHERE id=? AND revision=?').run(target.nextRevision, timestamp, target.id, target.baseRevision); assert.equal(updated.changes, 1); database.prepare('INSERT INTO revisions(project_id,revision,name,document,created_at) VALUES(?,?,?,?,?)').run(target.id, target.nextRevision, before.current_name, JSON.stringify(safe.document), timestamp); writes.push({projectId: target.id, beforeRevision: target.baseRevision, revision: target.nextRevision}); } assert.equal(hash(savedVersion(database, target)), safe.payloadHash); projects.push({...artifact, action, revision: target.nextRevision}); }
      const after = publication.inventory(database); presentation.assertOtherProjectsUnchanged(initial, after); TARGETS.forEach(target => presentation.guardBase(database, target)); assert.equal(after.revisions.length - initial.revisions.length, writes.length); database.exec('COMMIT');
    } catch (error) { database.exec('ROLLBACK'); throw error; }
    TARGETS.forEach(target => writeJSON(__layout.map(path.join(options.exportsDir, target.exportFile)), savedVersion(database, target))); const result = {...report, mode: 'applied', appliedAt: new Date().toISOString(), projects, writes, applyBackup: snapshot, exportWritten: true, originalUnchanged: true, otherProjectsUnchanged: true}; writeJSON(options.reportFile, result); return result;
  } finally { database.close(); }
}
async function run(argv = process.argv.slice(2)) { const options = optionsFrom(argv), result = await (options.apply ? apply(options) : prepare(options)); console.log(JSON.stringify({mode: result.mode, writes: result.writes.length, reportFile: options.reportFile, exportWritten: result.exportWritten, sourceHash: result.sources.hash, projects: result.projects.map(project => ({id: project.id, revision: project.revision || project.baseRevision, nextRevision: project.nextRevision, payloadHash: project.payloadHash, rooms: project.manifest.length, messages: project.manifest.reduce((sum, row) => sum + row.messageIds.length, 0), aged: project.manifest.reduce((sum, row) => sum + row.agedIds.length, 0), monitors: project.manifest.reduce((sum, row) => sum + row.monitorIds.length, 0)}))}, null, 2)); return result; }
module.exports = {run, prepare, apply, optionsFrom, loadCPU, nativeRoots: floorMigration.nativeRoots, buildCandidate, verifyCandidate, mergeRoom, assertAging, assertMessage, assertSupport, knownLegacy, updatedGroups, sourceState, TARGETS};
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
