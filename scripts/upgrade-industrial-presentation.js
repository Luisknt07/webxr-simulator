'use strict';
// Passive appearance/audio only. Dry run writes reviewed candidates and a
// verified backup. --apply advances Lab 14→15 and both studies 1→2 atomically.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {DatabaseSync, backup} = require('node:sqlite');
const {validateDocument} = require('../server/validation');
const {inventory, bytesHash} = require('./publish-study-projects');
const ROOT = path.resolve(__dirname, '..'), PROJECT = '194c1284-1c6e-4f2a-b089-9c540ed6e32b', ORIGINAL = 'ce14b39b-5d77-45ea-a85e-1d7e0d76e872';
const BASE_REVISION = 14, NEXT_REVISION = 15, BASE_HASH = '20f3365f1ac42726368b8b52f91eea21b534f38719a5da26ca83d0b7cafd01bc', ORIGINAL_HASH = '9a990ce7925ca3ca84a98fa02d363c9cef4da0f2a8bba961491e23dab54b3cac';
const ROOMS = ['sound', 'photogrammetry', 'vertigo'];
const TARGETS = [
  {key: 'laboratory', id: PROJECT, baseRevision: 14, nextRevision: 15, baseHash: BASE_HASH, rooms: ROOMS, materials: true, candidateFile: 'presentation-candidate.json', exportFile: 'industrial-cedi-complete.json'},
  {key: 'fundamentals', id: 'a18776be-ac57-452b-809a-46e69c2953e7', baseRevision: 1, nextRevision: 2, baseHash: 'a18d481ae342ce4f8bbfee6a99a2863771585b8222537fcf63ca9e78df17728d', rooms: ['hall', 'sound', 'photogrammetry', 'vertigo', 'panoramastereo', 'panorama1', 'panorama2', 'panorama3', 'panorama4'], materials: false, candidateFile: 'presentation-fundamentals-candidate.json', exportFile: 'industrial-study-fundamentals.json'},
  {key: 'advanced', id: '05397448-a767-4f3b-8371-2aeb7ed18ae0', baseRevision: 1, nextRevision: 2, baseHash: 'c31341789957be15cc1fda522010480f014a305cfd673c553ea168b3e6d461c2', rooms: ['hall', 'sound', 'photogrammetry', 'vertigo'], materials: false, candidateFile: 'presentation-advanced-candidate.json', exportFile: 'industrial-study-advanced.json'}
];
const ENVIRONMENT = {renderQuality: 'high', shadows: true, exposure: .9, sunIntensity: .85, ambientIntensity: .15, machineSounds: true, machineVolume: .25, ambientPreset: 'warehouse', ambientVolume: .12};
const clone = value => JSON.parse(JSON.stringify(value)), hash = value => bytesHash(JSON.stringify(value));
function writeJSON(filename, value) { fs.mkdirSync(path.dirname(filename), {recursive: true}); fs.writeFileSync(filename, JSON.stringify(value, null, 2) + '\n'); }
function readJSON(filename) { return JSON.parse(fs.readFileSync(filename, 'utf8')); }
function optionsFrom(argv) {
  const result = {apply: false, dataDir: path.join(ROOT, 'data'), outputDir: path.join(ROOT, 'data/qa-studio'), exportsDir: path.join(ROOT, 'data/exports')};
  for (let index = 0; index < argv.length; index++) { const key = argv[index]; if (key === '--apply') { result.apply = true; continue; }
    const name = {'--data-dir': 'dataDir', '--output-dir': 'outputDir', '--exports-dir': 'exportsDir'}[key]; if (!name) throw new Error('Opción desconocida: ' + key); const value = argv[++index]; if (!value || value.startsWith('--')) throw new Error('Falta el valor de ' + key); result[name] = path.resolve(value);
  }
  result.databasePath = path.join(result.dataDir, 'projects.sqlite'); result.reportFile = path.join(result.outputDir, 'presentation-upgrade.json'); return result;
}
function differences(before, after, prefix = '', result = []) {
  if (before === after) return result;
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object' || Array.isArray(before) !== Array.isArray(after)) { result.push({path: prefix || '/', before, after}); return result; }
  for (const key of new Set(Object.keys(before).concat(Object.keys(after)))) differences(before[key], after[key], prefix + '/' + key, result); return result;
}
function expandedDifferences(before, after) {
  return differences(before, after).flatMap(change => change.path.endsWith('/layers') && typeof change.before === 'string' && typeof change.after === 'string' ? differences(JSON.parse(change.before), JSON.parse(change.after), change.path) : [change]);
}
function buildCandidate(before, target = TARGETS[0]) {
  const candidate = clone(before); assert(candidate.studio && Array.isArray(candidate.studio.environments));
  for (const roomId of target.rooms) {
    assert(candidate.rooms[roomId]); const environments = candidate.studio.environments.filter(item => item.roomId === roomId); assert.equal(environments.length, 1, 'Se requiere un entorno existente para ' + roomId); Object.assign(environments[0], ENVIRONMENT);
    if (!target.materials) continue;
    for (const record of candidate.rooms[roomId].additions.concat(candidate.rooms[roomId].overrides)) for (const behavior of record.behaviors || []) {
      if (behavior.type === 'surfaceMaterial') for (const material of [behavior].concat(behavior.overrides || [])) {
        if (typeof material.name === 'string' && material.name.startsWith('Industrial') && material.metalness > .15) material.wear = Math.max(Number.isFinite(material.wear) ? material.wear : 0, .24);
      }
      if (behavior.type === 'surfaceWear') {
        const layers = JSON.parse(behavior.layers); let changed = false;
        layers.forEach(layer => { if (layer.id !== 'industrial-light-scratches') return; for (const [key, floor] of [['opacity', .55], ['density', .60]]) { const value = Math.max(layer[key], floor); if (value !== layer[key]) { layer[key] = value; changed = true; } } });
        if (changed) behavior.layers = JSON.stringify(layers);
      }
    }
  }
  (candidate.studio.entities || []).forEach(entity => { if (target.rooms.includes(entity.roomId) && entity.type === 'pointLight') entity.intensity = .65; });
  return candidate;
}
function preservation(before, after, target = TARGETS[0]) {
  const protectedRooms = Object.keys(before.rooms).filter(roomId => !target.rooms.includes(roomId)).map(roomId => ({roomId, hash: hash(before.rooms[roomId])}));
  assert.equal(protectedRooms.length, 10 - target.rooms.length); protectedRooms.forEach(item => assert.equal(hash(after.rooms[item.roomId]), item.hash, 'Cambió una sala protegida: ' + item.roomId));
  for (const key of new Set(Object.keys(before).concat(Object.keys(after)))) if (!['rooms', 'studio'].includes(key)) assert.equal(hash(after[key]), hash(before[key]), 'Cambió un campo de proyecto ajeno: ' + key);
  for (const key of new Set(Object.keys(before.studio).concat(Object.keys(after.studio)))) if (!['environments', 'entities'].includes(key)) assert.equal(hash(after.studio[key]), hash(before.studio[key]), 'Cambió una propiedad Studio ajena: ' + key);
  for (const key of ['environments', 'entities']) { const outside = rows => (rows || []).filter(item => !target.rooms.includes(item.roomId)); assert.equal(hash(outside(after.studio[key])), hash(outside(before.studio[key]))); }
  return protectedRooms;
}
function verifyCandidate(before, proposed, target = TARGETS[0]) {
  const expected = buildCandidate(before, target);
  assert.deepEqual(proposed, expected, 'El candidato contiene cambios fuera de la presentación pasiva autorizada.');
  const document = validateDocument(proposed, value => value); assert.deepEqual(document, expected, 'La validación alteró el alcance del candidato.');
  const protectedRooms = preservation(before, document, target), changes = expandedDifferences(before, document), paths = changes.map(change => change.path);
  assert.equal(new Set(paths).size, paths.length);
  changes.forEach(change => {
    if (change.path.startsWith('/studio/environments/')) { assert(Object.keys(ENVIRONMENT).some(key => change.path.endsWith('/' + key))); return; }
    if (change.path.startsWith('/studio/entities/')) { const match = /^\/studio\/entities\/(\d+)\/intensity$/.exec(change.path); assert(match); const entity = before.studio.entities[Number(match[1])]; assert(entity.type === 'pointLight' && target.rooms.includes(entity.roomId)); return; }
    assert(target.materials && target.rooms.some(roomId => change.path.startsWith('/rooms/' + roomId + '/')));
    assert(/\/behaviors\/\d+\/(?:overrides\/\d+\/)?wear$/.test(change.path) || /\/behaviors\/\d+\/layers\/\d+\/(?:opacity|density)$/.test(change.path), 'Ruta no autorizada: ' + change.path);
  });
  return {document, protectedRooms, changes, changedPaths: paths.sort(), payloadHash: hash(document), counts: {paths: paths.length, materialWear: changes.filter(change => change.path.endsWith('/wear')).length, scratchOpacity: changes.filter(change => change.path.includes('/layers/') && change.path.endsWith('/opacity')).length, scratchDensity: changes.filter(change => change.path.includes('/layers/') && change.path.endsWith('/density')).length, pointLights: changes.filter(change => change.path.startsWith('/studio/entities/')).length}};
}
function projectVersion(database, id, revision) {
  const row = database.prepare('SELECT p.id,p.name AS current_name,p.revision AS current_revision,p.created_at,p.updated_at,r.revision,r.name,r.document,r.created_at AS revision_created_at FROM projects p JOIN revisions r ON p.id=r.project_id WHERE p.id=? AND r.revision=?').get(id, revision); assert(row, 'No existe la revisión esperada ' + id + '/' + revision); return {...row, rawDocument: row.document, rawHash: bytesHash(row.document), document: JSON.parse(row.document)};
}
function guardBase(database, target = TARGETS[0]) {
  const before = projectVersion(database, target.id, target.baseRevision), original = projectVersion(database, ORIGINAL, 9);
  assert.equal(before.rawHash, target.baseHash, 'La base no coincide con el hash exacto autorizado: ' + target.key); assert.equal(before.current_name, before.name, 'Cambió el nombre del proyecto.'); assert.equal(original.current_revision, 9); assert.equal(original.rawHash, ORIGINAL_HASH, 'El original cambió.');
  return {before, original};
}
function assertOtherProjectsUnchanged(before, after) {
  before.projects.filter(row => !TARGETS.some(target => target.id === row.id)).forEach(row => assert.deepEqual(after.projects.find(value => value.id === row.id), row, 'Se modificó otro proyecto.'));
  assert.equal(after.projects.length, before.projects.length, 'No se pueden crear ni eliminar proyectos.');
  before.revisions.forEach(row => assert.deepEqual(after.revisions.find(value => value.projectId === row.projectId && value.revision === row.revision), row, 'Cambió una revisión histórica.'));
}
function otherProjectsState(current) { return {projects: current.projects.filter(row => !TARGETS.some(target => target.id === row.id)), revisions: current.revisions.filter(row => !TARGETS.some(target => target.id === row.projectId))}; }
function targetAction(database, safe, target = TARGETS[0]) {
  const row = database.prepare('SELECT revision,name FROM projects WHERE id=?').get(target.id); assert(row);
  if (row.revision === target.baseRevision) { assert.equal(projectVersion(database, target.id, target.baseRevision).rawHash, target.baseHash); return 'create-revision-' + target.nextRevision; }
  assert.equal(row.revision, target.nextRevision, 'Sólo se admite la transición ' + target.baseRevision + ' → ' + target.nextRevision); assert.equal(projectVersion(database, target.id, target.nextRevision).rawHash, safe.payloadHash, 'La revisión final ya contiene otro contenido.'); return 'reuse-revision-' + target.nextRevision;
}
async function makeBackup(database, options, before, label) {
  const file = path.join(options.dataDir, 'backups', 'before-presentation-' + label + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.sqlite'); fs.mkdirSync(path.dirname(file), {recursive: true}); await backup(database, file);
  const copy = new DatabaseSync(file, {readOnly: true}); try { assert.equal(copy.prepare('PRAGMA quick_check').get().quick_check, 'ok'); assert.equal(inventory(copy).fingerprint, before.fingerprint); } finally { copy.close(); }
  return {file, sha256: bytesHash(fs.readFileSync(file)), inventoryHash: before.fingerprint, bytes: fs.statSync(file).size};
}
async function prepare(options) {
  assert(fs.existsSync(options.databasePath)); const database = new DatabaseSync(options.databasePath, {readOnly: true});
  try {
    const initial = inventory(database), projects = []; let original;
    for (const target of TARGETS) {
      const guarded = guardBase(database, target), before = guarded.before; original = guarded.original; const safe = verifyCandidate(before.document, buildCandidate(before.document, target), target), action = targetAction(database, safe, target), candidateFile = path.join(options.outputDir, target.candidateFile); writeJSON(candidateFile, safe.document);
      projects.push({key: target.key, id: target.id, name: before.name, baseRevision: target.baseRevision, nextRevision: target.nextRevision, baseHash: target.baseHash, payloadHash: safe.payloadHash, candidateFile, candidateFileHash: bytesHash(fs.readFileSync(candidateFile)), action, protectedRooms: safe.protectedRooms, counts: safe.counts, changes: safe.changes, changedPaths: safe.changedPaths, exportFile: path.join(options.exportsDir, target.exportFile)});
    }
    const snapshot = await makeBackup(database, options, initial, 'prepared'); assert.equal(inventory(database).fingerprint, initial.fingerprint);
    const report = {format: 'hello-webxr-passive-presentation', version: 2, mode: 'dry-run', preparedAt: new Date().toISOString(), databasePath: options.databasePath, backup: snapshot, projects,
      original: {id: ORIGINAL, revision: 9, rawHash: original.rawHash}, otherProjects: otherProjectsState(initial), environment: ENVIRONMENT, pointLightIntensity: .65, writes: [], exportWritten: false};
    writeJSON(options.reportFile, report); return report;
  } finally { database.close(); }
}
async function apply(options) {
  const report = readJSON(options.reportFile); assert.equal(report.format, 'hello-webxr-passive-presentation'); assert.equal(report.version, 2); assert.equal(path.resolve(report.databasePath), path.resolve(options.databasePath)); assert.equal(report.projects.length, TARGETS.length); assert.equal(bytesHash(fs.readFileSync(report.backup.file)), report.backup.sha256);
  const reader = new DatabaseSync(options.databasePath, {readOnly: true}); let plans, snapshot;
  try {
    const initial = inventory(reader); assert.deepEqual(otherProjectsState(initial), report.otherProjects, 'Otro proyecto cambió desde la preparación.');
    plans = TARGETS.map(target => {
      const artifact = report.projects.find(project => project.key === target.key); assert(artifact && artifact.id === target.id); assert.equal(artifact.baseRevision, target.baseRevision); assert.equal(artifact.nextRevision, target.nextRevision); assert.equal(artifact.baseHash, target.baseHash); assert.equal(path.resolve(artifact.candidateFile), path.join(options.outputDir, target.candidateFile)); assert.equal(bytesHash(fs.readFileSync(artifact.candidateFile)), artifact.candidateFileHash);
      const {before} = guardBase(reader, target), safe = verifyCandidate(before.document, readJSON(artifact.candidateFile), target); assert.equal(safe.payloadHash, artifact.payloadHash); assert.deepEqual(safe.changedPaths, artifact.changedPaths); targetAction(reader, safe, target); return {target, artifact, safe};
    }); snapshot = await makeBackup(reader, options, initial, 'apply');
  }
  finally { reader.close(); }
  const database = new DatabaseSync(options.databasePath); let writes = [], results;
  try {
    database.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE;');
    try {
      const initial = inventory(database); assert.deepEqual(otherProjectsState(initial), report.otherProjects); results = [];
      for (const plan of plans) {
        const {target, safe, artifact} = plan, {before} = guardBase(database, target), action = targetAction(database, safe, target);
        if (action.startsWith('create-')) {
          const timestamp = new Date().toISOString(), update = database.prepare('UPDATE projects SET revision=?,updated_at=? WHERE id=? AND revision=?').run(target.nextRevision, timestamp, target.id, target.baseRevision); assert.equal(update.changes, 1);
          database.prepare('INSERT INTO revisions(project_id,revision,name,document,created_at) VALUES(?,?,?,?,?)').run(target.id, target.nextRevision, before.current_name, JSON.stringify(safe.document), timestamp); writes.push({operation: 'UPDATE project revision + INSERT revision', projectId: target.id, beforeRevision: target.baseRevision, revision: target.nextRevision});
        }
        assert.equal(projectVersion(database, target.id, target.nextRevision).rawHash, safe.payloadHash); results.push({...artifact, action, revision: target.nextRevision});
      }
      const after = inventory(database); assertOtherProjectsUnchanged(initial, after); TARGETS.forEach(target => guardBase(database, target)); assert.equal(after.revisions.length - initial.revisions.length, writes.length); database.exec('COMMIT');
    } catch (error) { database.exec('ROLLBACK'); throw error; }
    const after = inventory(database); assert.deepEqual(otherProjectsState(after), report.otherProjects);
    TARGETS.forEach(target => { guardBase(database, target); writeJSON(path.join(options.exportsDir, target.exportFile), projectVersion(database, target.id, target.nextRevision).document); });
    const result = {...report, mode: 'applied', appliedAt: new Date().toISOString(), projects: results, applyBackup: snapshot, writes, exportWritten: true, afterInventoryHash: after.fingerprint, otherProjectsUnchanged: true, originalUnchanged: true}; writeJSON(options.reportFile, result); return result;
  } finally { database.close(); }
}
function summary(report, options) { return {mode: report.mode, writes: report.writes.length, projects: report.projects.map(project => ({id: project.id, name: project.name, revision: project.revision || project.baseRevision, action: project.action, payloadHash: project.payloadHash, counts: project.counts, protectedRooms: project.protectedRooms.length})), reportFile: options.reportFile, exportWritten: report.exportWritten, originalUnchanged: true}; }
async function run(argv = process.argv.slice(2)) { const options = optionsFrom(argv), report = await (options.apply ? apply(options) : prepare(options)); console.log(JSON.stringify(summary(report, options), null, 2)); return report; }
module.exports = {run, prepare, apply, optionsFrom, buildCandidate, verifyCandidate, preservation, expandedDifferences, guardBase, targetAction, assertOtherProjectsUnchanged, otherProjectsState, TARGETS, PROJECT, ORIGINAL, BASE_REVISION, NEXT_REVISION, BASE_HASH, ORIGINAL_HASH, ROOMS, ENVIRONMENT, hash};
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
