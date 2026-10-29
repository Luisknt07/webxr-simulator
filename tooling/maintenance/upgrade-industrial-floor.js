const __layout = require("../layout.cjs");
'use strict';
// The real CPU SceneDocument/helper computes candidates. Merge only the one
// new floor actor, floor wear and explicitly reported generated legacy paint.
// --apply is the sole writer and commits all three revisions together.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const {DatabaseSync, backup} = require('node:sqlite');
const schema = require('../../modules/logistica-industrial/contracts/behaviors'), {validateDocument} = require('../../apps/api/server/validation');
const publication = require('./publish-study-projects'), presentation = require('./upgrade-industrial-presentation');
const ROOT = __layout.map(path.resolve(__layout.oldDir("scripts/upgrade-industrial-floor.js"), '..')), clone = value => JSON.parse(JSON.stringify(value)), hash = presentation.hash;
const TARGETS = presentation.TARGETS.map((target, index) => Object.assign({}, target, {baseRevision: [15, 2, 2][index], nextRevision: [16, 3, 3][index], baseHash: ['91bb9c7e1fe880ce738410c8800cb004d97a4d05457ec0d8296662e988ef2e59', 'fa91617e053f2a86389f9a470ec5b2065248014e22b1d78ab7b00d4db9b895ba', 'a03c21f6d53e2c36a9a04387e17a6b4481565cf92e99b08d6613e9b705c1e0b3'][index], candidateFile: 'floor-' + target.key + '-candidate.json'}));
const LEGACY_NAMES = /^(?:Ruta peatonal central|Límite peatonal|Cruce peatonal|Paso de peatones|Flecha de circulación|Delimitación ·|Demarcación longitudinal ·|Demarcación transversal ·|Ruta peatonal de recepción|Límite de ruta peatonal)/;
const LEGACY_COLORS = ['#f5ca36', '#d9b74c', '#385c60', '#555f65', '#edf1ef', '#d4effa', '#78cbf0', '#34545b'];
const GENERATED_WEAR = 'industrial-floor-v1-', MACHINE_TYPES = ['source', 'conveyor', 'processor', 'palletQueue'];
function readSource(file) { return fs.readFileSync(__layout.map(path.join(ROOT, 'src', file)), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''); }
function loadCPU() {
  const createIndustrialPrefab = new Function('THREE', 'behaviorSchema', readSource('editor/IndustrialPrefabs.js') + '\nreturn createIndustrialPrefab;')(THREE, schema);
  const BaseDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', readSource('editor/SceneDocument.js').replace('default class SceneDocument', 'return class SceneDocument'))(THREE, schema, createIndustrialPrefab);
  class FloorDocument extends BaseDocument { _newId() { if (!this.floorReservedIds) this.floorReservedIds = new Set(); let id; do { id = 'custom-floor-upgrade-' + this.nextId++; } while (this.objects.has(id) || this.floorReservedIds.has(id)); this.floorReservedIds.add(id); return id; } }
  const floor = new Function('THREE', 'schema', readSource('editor/IndustrialFloorPresentation.js') + '\nreturn {applyIndustrialFloorPresentation,deriveIndustrialFloorPresentation};')(THREE, schema);
  return Object.assign({SceneDocument: FloorDocument}, floor);
}
function nativeRoots(data) {
  const scene = new THREE.Scene(), roots = {}, mask = publication.nativeMask();
  schema.studio.ROOM_IDS.forEach(roomId => {
    const root = new THREE.Group(); root.name = 'CPU native root ' + roomId; if (roomId === 'photogrammetry') root.rotation.y = -Math.PI / 2; roots[roomId] = root; scene.add(root);
    const ensure = value => { let object = root; for (const token of value.split('.').slice(1)) { const index = Number(token); assert(Number.isInteger(index) && index >= 0 && index < 10000); while (object.children.length <= index) object.add(new THREE.Group()); object = object.children[index]; } };
    for (let index = 0; index < mask.counts[roomId]; index++) ensure('root.' + index);
    (data.rooms[roomId].overrides || []).forEach(record => { assert(record.id.startsWith('native:' + roomId + ':')); ensure(record.id.slice(('native:' + roomId + ':').length)); });
  }); return {scene, roots};
}
function dispose(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set(); root.traverse(object => { if (object.geometry) geometries.add(object.geometry); (Array.isArray(object.material) ? object.material : [object.material]).filter(Boolean).forEach(material => { materials.add(material); Object.keys(material).forEach(key => { if (material[key] && material[key].isTexture) textures.add(material[key]); }); }); }); textures.forEach(value => value.dispose()); materials.forEach(value => value.dispose()); geometries.forEach(value => value.dispose());
}
function knownLegacy(record) {
  return record && record.descriptor.type === 'plane' && LEGACY_NAMES.test(record.name) && !record.color && Math.abs(record.position[1]) < .05 && (record.behaviors || []).every(value => value.type === 'surfaceMaterial' && !value.texture && !(value.overrides || []).length && LEGACY_COLORS.includes(value.color));
}
function customLayers(record) { const behavior = (record.behaviors || []).find(value => value.type === 'surfaceWear'); return JSON.parse(behavior && behavior.layers || '[]').filter(layer => !String(layer.id).startsWith(GENERATED_WEAR) && layer.id !== 'cedi-floor-tire-wear'); }
function assertFloorChange(before, after) {
  assert(before && after); const strip = record => { const copy = clone(record); delete copy.behaviors; return copy; }; assert.equal(hash(strip(after)), hash(strip(before)), 'Floor transform, descriptor, nodes or material state outside behaviors changed.');
  const other = record => (record.behaviors || []).filter(value => value.type !== 'surfaceWear'); assert.equal(hash(other(after)), hash(other(before)), 'Existing floor materials, collisions and teleport settings must stay literal.');
  assert.equal(hash(customLayers(after)), hash(customLayers(before)), 'Custom floor wear was changed.');
  const oldWear = (before.behaviors || []).find(value => value.type === 'surfaceWear'), wear = (after.behaviors || []).find(value => value.type === 'surfaceWear'); assert(wear); assert.equal(after.behaviors.filter(value => value.type === 'surfaceWear').length, 1); assert.equal(wear.enabled, oldWear ? oldWear.enabled : true);
  const generated = JSON.parse(wear.layers).filter(layer => String(layer.id).startsWith(GENERATED_WEAR)); const allowed = ['motor-oil', 'station-scratches', 'wheel-traces', 'border-dirt'].map(value => GENERATED_WEAR + value); assert(generated.length > 0 && generated.length <= 4); assert(generated.every(layer => allowed.includes(layer.id)));
}
function assertActor(actor) {
  assert(actor && actor.descriptor.type === 'industrialFloor' && actor.descriptor.version === 1); schema.industrialFloor.normalize(actor.descriptor);
  assert.equal(actor.name, 'Presentación industrial del piso · v1'); assert.deepEqual(actor.interaction, {type: 'none'}); assert.equal(actor.visible, true); assert.equal(actor.color, null); assert(!actor.visual);
  assert.deepEqual(actor.position, [0, 0, 0]); assert.deepEqual(actor.quaternion, [0, 0, 0, 1]); assert.deepEqual(actor.scale, [1, 1, 1]); assert(!actor.nodes || Object.keys(actor.nodes).length === 0);
  assert((actor.behaviors || []).every(value => value.type === 'collision' && value.enabled === false), 'The floor actor cannot introduce simulation or collision behavior.');
}
function mergeRoom(original, loadedBefore, loadedAfter, result) {
  const floorId = result.floor && result.floor.userData.editorId || result.floorId, actorId = result.presentation && result.presentation.userData.editorId || result.presentationId;
  assert(floorId && actorId && floorId !== actorId); assert.deepEqual([...new Set(result.affectedObjectIds)].sort(), [actorId, floorId].sort()); assert.deepEqual(result.addedObjectIds, [actorId]);
  const old = new Map(loadedBefore.additions.map(row => [row.id, row])), next = new Map(loadedAfter.additions.map(row => [row.id, row])), removed = new Set(result.removedLegacyIds); assert.equal(removed.size, result.removedLegacyIds.length);
  removed.forEach(id => { assert(knownLegacy(old.get(id)), 'Refusing to remove a custom or non-paint actor: ' + id); assert(!next.has(id)); });
  assert(!old.has(actorId)); assertActor(next.get(actorId)); assertFloorChange(old.get(floorId), next.get(floorId)); assert.equal(hash(loadedBefore.overrides), hash(loadedAfter.overrides), 'Native overrides were changed by the floor helper.');
  loadedBefore.additions.forEach(row => { if (removed.has(row.id) || row.id === floorId) return; assert.equal(hash(next.get(row.id)), hash(row), 'The helper changed an existing non-floor actor: ' + row.id); });
  assert.equal(next.size, old.size - removed.size + 1, 'Unexpected added or removed objects.');
  const originalFloor = original.additions.find(row => row.id === floorId); assert(originalFloor); const floor = Object.assign({}, clone(originalFloor), {behaviors: clone(next.get(floorId).behaviors)}); assertFloorChange(originalFloor, floor);
  const additions = original.additions.filter(row => !removed.has(row.id)).map(row => row.id === floorId ? floor : clone(row)); additions.push(clone(next.get(actorId)));
  return {room: Object.assign({}, clone(original), {additions}), manifest: {floorId, presentationId: actorId, affectedObjectIds: [actorId, floorId], addedObjectIds: [actorId], removedLegacyIds: [...removed], removedLegacy: [...removed].map(id => ({id, name: old.get(id).name, hash: hash(original.additions.find(row => row.id === id))})), expectedActorHash: publication.hash(next.get(actorId)), expectedFloorBehaviorsHash: hash(floor.behaviors)}};
}
function planQA(derived) {
  const overlaps = (a, b, epsilon = 1e-5) => a[0] < b[2] - epsilon && a[2] > b[0] + epsilon && a[1] < b[3] - epsilon && a[3] > b[1] + epsilon;
  const plan = derived.plan; assert(plan && plan.walkways.length && plan.zones.length);
  plan.walkways.forEach(walkway => assert(!derived.obstacles.some(box => overlaps(walkway, box)), 'A pedestrian lane overlaps machine clearance.'));
  plan.bays.forEach((bay, index) => { assert(!derived.obstacles.some(box => overlaps(bay, box))); assert(!plan.walkways.some(walkway => overlaps(bay, walkway))); assert(!plan.bays.slice(0, index).some(other => overlaps(bay, other))); });
  return {machines: derived.machines.length, walkways: plan.walkways.length, zones: plan.zones.length, bays: plan.bays.length, crossings: plan.crossings.length, signs: plan.signs.length, labels: plan.labels.length, clearance: derived.clearance, routesAndBaysClear: true, floorBounds: plan.bounds};
}
function verifyCandidate(before, proposed, manifest, target) {
  assert.equal(manifest.length, target.rooms.length); assert.deepEqual(manifest.map(change => change.roomId).sort(), target.rooms.slice().sort()); const expected = clone(before);
  manifest.forEach(change => {
    assert(target.rooms.includes(change.roomId)); const previous = before.rooms[change.roomId], after = proposed.rooms[change.roomId], actor = after.additions.find(row => row.id === change.presentationId), floor = after.additions.find(row => row.id === change.floorId), oldFloor = previous.additions.find(row => row.id === change.floorId), removed = new Set(change.removedLegacyIds);
    assert.equal(change.addedObjectIds.length, 1); assert.deepEqual(change.addedObjectIds, [change.presentationId]); assert.deepEqual(change.affectedObjectIds.slice().sort(), [change.presentationId, change.floorId].sort()); assert.equal(removed.size, change.removedLegacyIds.length); assertActor(actor); assert.equal(publication.hash(actor), change.expectedActorHash); assertFloorChange(oldFloor, floor); assert.equal(hash(floor.behaviors), change.expectedFloorBehaviorsHash);
    removed.forEach(id => { const row = previous.additions.find(value => value.id === id); assert(knownLegacy(row)); const reviewed = change.removedLegacy.find(value => value.id === id); assert(reviewed && reviewed.hash === hash(row)); });
    expected.rooms[change.roomId].additions = previous.additions.filter(row => !removed.has(row.id)).map(row => row.id === change.floorId ? Object.assign({}, clone(row), {behaviors: clone(floor.behaviors)}) : clone(row)).concat(clone(actor));
  });
  assert.deepEqual(proposed, expected, 'Floor candidate changed equipment, nodes, transforms, Studio, imports or unapproved presentation.'); const document = validateDocument(proposed, value => value); assert.deepEqual(document, expected);
  const protectedRooms = Object.keys(before.rooms).filter(roomId => !target.rooms.includes(roomId)).map(roomId => ({roomId, hash: hash(before.rooms[roomId])})); protectedRooms.forEach(row => assert.equal(hash(document.rooms[row.roomId]), row.hash)); assert.equal(hash(document.studio), hash(before.studio)); assert.equal(hash(document.imports), hash(before.imports));
  return {document, payloadHash: hash(document), protectedRooms, changedPaths: presentation.expandedDifferences(before, document).map(change => change.path).sort()};
}
async function buildCandidate(data, target) {
  const cpu = loadCPU(), workspace = nativeRoots(data), document = new cpu.SceneDocument({scene: workspace.scene, editorRoots: workspace.roots}), candidate = clone(data), manifest = [];
  Object.entries(workspace.roots).forEach(([id, root]) => document.registerRoom(id, root));
  try {
    assert.equal(data.imports.length, 0, 'CPU migration refuses imported files.'); for (const room of Object.values(data.rooms)) room.additions.forEach(row => assert(!row.descriptor.nativeId && !row.descriptor.importId && !row.descriptor.path, 'Native/imported copies need a separate reviewed loader.'));
    await document.load(data); document.floorReservedIds = new Set(document.objects.keys()); document.undoStack.length = 0;
    for (const roomId of target.rooms) {
      console.log('Floor prepare:', target.key, roomId); const loadedBefore = await document.serialize(), root = document.getRoot(roomId), objects = document.getObjects(roomId), machines = objects.filter(object => document.getBehaviors(object).some(value => MACHINE_TYPES.includes(value.type)));
      const lines = (document.studio.groups || []).filter(group => group.roomId === roomId).map(group => ({id: group.id, title: group.name, objects: group.members.map(id => document.getObject(id)).filter(object => machines.includes(object))})).filter(line => line.objects.length);
      const derived = cpu.deriveIndustrialFloorPresentation(document, roomId, {machines, lines}), qa = planQA(derived); assert(derived.floor && document.additions.has(derived.floor.userData.editorId), 'An existing authored floor is required.');
      const result = cpu.applyIndustrialFloorPresentation(document, roomId, {floorObject: derived.floor, machines, lines, replaceLegacy: true, enabled: true}); assert(result.changed, 'The base version already has a floor presentation.'); const loadedAfter = await document.serialize(); assert.equal(hash(loadedAfter.studio), hash(loadedBefore.studio), 'The helper changed the Studio graph.'); assert.equal(hash(loadedAfter.imports), hash(loadedBefore.imports));
      const merged = mergeRoom(data.rooms[roomId], loadedBefore.rooms[roomId], loadedAfter.rooms[roomId], result); candidate.rooms[roomId] = merged.room;
      const actor = result.presentation, geometries = []; actor.traverse(object => { if (object.geometry) geometries.push(object.geometry); }); assert(geometries.length <= 8); assert(geometries.every(geometry => geometry.attributes.position && geometry.attributes.position.count > 0));
      const repeatBefore = await document.serialize(), repeated = cpu.applyIndustrialFloorPresentation(document, roomId, {floorObject: derived.floor, machines, lines, replaceLegacy: true, enabled: true}); assert(!repeated.changed && repeated.addedObjectIds.length === 0 && repeated.removedLegacyIds.length === 0); assert.equal(hash(await document.serialize()), hash(repeatBefore), 'Repeated application changed an existing floor presentation.');
      manifest.push(Object.assign({roomId, qa, meshes: geometries.length, wearLayers: result.wearLayers, stamps: result.report.stamps, idempotent: true, unchangedRecordsHash: hash(data.rooms[roomId].additions.filter(row => !merged.manifest.removedLegacyIds.includes(row.id) && row.id !== merged.manifest.floorId))}, merged.manifest)); document.undoStack.length = 0; document.redoStack.length = 0;
    }
    return Object.assign(verifyCandidate(data, candidate, manifest, target), {manifest});
  } finally { dispose(workspace.scene); }
}
function optionsFrom(argv) { const options = presentation.optionsFrom(argv); options.reportFile = __layout.map(path.join(options.outputDir, 'industrial-floor-upgrade.json')); return options; }
function writeJSON(file, value) { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); }
function readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
async function makeBackup(database, options, initial, label) { const file = __layout.map(path.join(options.dataDir, 'backups', 'before-industrial-floor-' + label + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.sqlite')); fs.mkdirSync(path.dirname(file), {recursive: true}); await backup(database, file); const copy = new DatabaseSync(file, {readOnly: true}); try { assert.equal(copy.prepare('PRAGMA quick_check').get().quick_check, 'ok'); assert.equal(publication.inventory(copy).fingerprint, initial.fingerprint); } finally { copy.close(); } return {file, sha256: publication.bytesHash(fs.readFileSync(file)), inventoryHash: initial.fingerprint}; }
function savedVersion(database, target) { const row = database.prepare('SELECT document FROM revisions WHERE project_id=? AND revision=?').get(target.id, target.nextRevision); assert(row); return JSON.parse(row.document); }
async function prepare(options) {
  const database = new DatabaseSync(options.databasePath, {readOnly: true});
  try { const initial = publication.inventory(database), projects = []; let original;
    for (const target of TARGETS) { const guarded = presentation.guardBase(database, target); original = guarded.original; const safe = await buildCandidate(guarded.before.document, target), candidateFile = __layout.map(path.join(options.outputDir, target.candidateFile)); writeJSON(candidateFile, safe.document); projects.push({key: target.key, id: target.id, name: guarded.before.name, baseRevision: target.baseRevision, nextRevision: target.nextRevision, baseHash: target.baseHash, payloadHash: safe.payloadHash, candidateFile, candidateFileHash: publication.bytesHash(fs.readFileSync(candidateFile)), manifest: safe.manifest, protectedRooms: safe.protectedRooms, changedPaths: safe.changedPaths, exportFile: __layout.map(path.join(options.exportsDir, target.exportFile))}); }
    const snapshot = await makeBackup(database, options, initial, 'prepared'); assert.equal(publication.inventory(database).fingerprint, initial.fingerprint); const report = {format: 'hello-webxr-industrial-floor-upgrade', version: 1, mode: 'dry-run', preparedAt: new Date().toISOString(), databasePath: options.databasePath, backup: snapshot, projects, original: {id: presentation.ORIGINAL, revision: 9, rawHash: original.rawHash}, otherProjects: presentation.otherProjectsState(initial), writes: [], exportWritten: false}; writeJSON(options.reportFile, report); return report;
  } finally { database.close(); }
}
async function apply(options) {
  const report = readJSON(options.reportFile); assert.equal(report.format, 'hello-webxr-industrial-floor-upgrade'); assert.equal(report.version, 1); assert.equal(__layout.map(path.resolve(report.databasePath)), __layout.map(path.resolve(options.databasePath))); assert.equal(report.projects.length, TARGETS.length); assert.equal(publication.bytesHash(fs.readFileSync(report.backup.file)), report.backup.sha256);
  const reader = new DatabaseSync(options.databasePath, {readOnly: true}); let plans, snapshot;
  try { const initial = publication.inventory(reader); assert.deepEqual(presentation.otherProjectsState(initial), report.otherProjects); plans = TARGETS.map(target => { const artifact = report.projects.find(project => project.key === target.key); assert(artifact && artifact.id === target.id && artifact.baseHash === target.baseHash && artifact.baseRevision === target.baseRevision && artifact.nextRevision === target.nextRevision); assert.equal(__layout.map(path.resolve(artifact.candidateFile)), __layout.map(path.join(options.outputDir, target.candidateFile))); assert.equal(publication.bytesHash(fs.readFileSync(artifact.candidateFile)), artifact.candidateFileHash); const {before} = presentation.guardBase(reader, target), safe = verifyCandidate(before.document, readJSON(artifact.candidateFile), artifact.manifest, target); assert.equal(safe.payloadHash, artifact.payloadHash); assert.deepEqual(safe.changedPaths, artifact.changedPaths); presentation.targetAction(reader, safe, target); return {target, artifact, safe}; }); snapshot = await makeBackup(reader, options, initial, 'apply'); } finally { reader.close(); }
  const database = new DatabaseSync(options.databasePath); let writes = [], projects;
  try { database.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE;');
    try { const initial = publication.inventory(database); assert.deepEqual(presentation.otherProjectsState(initial), report.otherProjects); projects = [];
      for (const {target, artifact, safe} of plans) { const {before} = presentation.guardBase(database, target), action = presentation.targetAction(database, safe, target); if (action.startsWith('create-')) { const timestamp = new Date().toISOString(), updated = database.prepare('UPDATE projects SET revision=?,updated_at=? WHERE id=? AND revision=?').run(target.nextRevision, timestamp, target.id, target.baseRevision); assert.equal(updated.changes, 1); database.prepare('INSERT INTO revisions(project_id,revision,name,document,created_at) VALUES(?,?,?,?,?)').run(target.id, target.nextRevision, before.current_name, JSON.stringify(safe.document), timestamp); writes.push({projectId: target.id, beforeRevision: target.baseRevision, revision: target.nextRevision}); } assert.equal(hash(savedVersion(database, target)), safe.payloadHash); projects.push({...artifact, action, revision: target.nextRevision}); }
      const after = publication.inventory(database); presentation.assertOtherProjectsUnchanged(initial, after); TARGETS.forEach(target => presentation.guardBase(database, target)); assert.equal(after.revisions.length - initial.revisions.length, writes.length); database.exec('COMMIT');
    } catch (error) { database.exec('ROLLBACK'); throw error; }
    TARGETS.forEach(target => writeJSON(__layout.map(path.join(options.exportsDir, target.exportFile)), savedVersion(database, target))); const result = {...report, mode: 'applied', appliedAt: new Date().toISOString(), projects, writes, applyBackup: snapshot, exportWritten: true, originalUnchanged: true, otherProjectsUnchanged: true}; writeJSON(options.reportFile, result); return result;
  } finally { database.close(); }
}
async function run(argv = process.argv.slice(2)) { const options = optionsFrom(argv), result = await (options.apply ? apply(options) : prepare(options)); console.log(JSON.stringify({mode: result.mode, writes: result.writes.length, reportFile: options.reportFile, exportWritten: result.exportWritten, projects: result.projects.map(project => ({id: project.id, name: project.name, revision: project.revision || project.baseRevision, nextRevision: project.nextRevision, payloadHash: project.payloadHash, rooms: project.manifest.length, removedLegacy: project.manifest.reduce((count, room) => count + room.removedLegacyIds.length, 0)}))}, null, 2)); return result; }
module.exports = {run, prepare, apply, optionsFrom, loadCPU, nativeRoots, buildCandidate, verifyCandidate, mergeRoom, assertFloorChange, assertActor, knownLegacy, planQA, TARGETS};
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
