'use strict';
// Default prepares exports, runs real flow QA and makes a consistent backup.
// Only --apply opens the source database for writing. Its transaction inserts
// missing target projects; it never updates or deletes an existing record.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {createHash, randomUUID} = require('node:crypto'), {DatabaseSync, backup} = require('node:sqlite');
const {spawnSync} = require('node:child_process'), THREE = require('three');
const schema = require('../shared/behaviors'), {validateDocument} = require('../server/validation');
const ROOT = path.resolve(__dirname, '..');
const PROTECTED = [{id: 'ce14b39b-5d77-45ea-a85e-1d7e0d76e872', revision: 9}, {id: '194c1284-1c6e-4f2a-b089-9c540ed6e32b', revision: 14}];
const TARGETS = [
  {key: 'fundamentals', name: 'Prácticas industriales · Fundamentos', file: 'industrial-study-fundamentals.json', ids: ['lab-transfer-l', 'lab-sorting', 'lab-merge', 'lab-elevator', 'lab-pallets', 'lab-assembly', 'lab-rectangle', 'lab-gravity', 'lab-manual-l']},
  {key: 'advanced', name: 'Automatización industrial · Casos avanzados', file: 'industrial-study-advanced.json', ids: ['advanced-rework', 'advanced-packing', 'advanced-pallets', 'manual-station']}
];
const clone = value => JSON.parse(JSON.stringify(value));
function ordered(value) { if (Array.isArray(value)) return value.map(ordered); if (!value || typeof value !== 'object') return value; return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])); }
const bytesHash = value => createHash('sha256').update(value).digest('hex');
const hash = value => bytesHash(JSON.stringify(ordered(value)));
function writeJSON(filename, value) { fs.mkdirSync(path.dirname(filename), {recursive: true}); fs.writeFileSync(filename, JSON.stringify(value, null, 2) + '\n'); }
function readJSON(filename) { return JSON.parse(fs.readFileSync(filename, 'utf8')); }
function optionsFrom(argv) {
  const allowed = new Set(['--apply', '--data-dir', '--output-dir', '--exports-dir', '--base-url']);
  const options = {apply: false, dataDir: path.join(ROOT, 'data'), outputDir: path.join(ROOT, 'data/qa-studio'), exportsDir: path.join(ROOT, 'data/exports'), baseURL: 'https://localhost:8080'};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]; if (!allowed.has(key)) throw new Error('Opción desconocida: ' + key);
    if (key === '--apply') { options.apply = true; continue; }
    const value = argv[++i]; if (!value || value.startsWith('--')) throw new Error('Falta el valor de ' + key);
    options[{'--data-dir': 'dataDir', '--output-dir': 'outputDir', '--exports-dir': 'exportsDir', '--base-url': 'baseURL'}[key]] = value;
  }
  ['dataDir', 'outputDir', 'exportsDir'].forEach(key => { options[key] = path.resolve(options[key]); });
  const base = new URL(options.baseURL); assert(['http:', 'https:'].includes(base.protocol)); options.baseURL = base.origin;
  options.databasePath = path.join(options.dataDir, 'projects.sqlite'); options.reportFile = path.join(options.outputDir, 'study-publication.json'); return options;
}
function sourceModule(file) { return fs.readFileSync(path.join(ROOT, 'src', file), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''); }
function productionCompiler() {
  const createIndustrialPrefab = new Function('THREE', 'behaviorSchema', sourceModule('editor/IndustrialPrefabs.js') + '\nreturn createIndustrialPrefab;')(THREE, schema);
  const SceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', sourceModule('editor/SceneDocument.js').replace('default class SceneDocument', 'return class SceneDocument'))(THREE, schema, createIndustrialPrefab);
  // Stable IDs make a fresh compile byte-equivalent to the reviewed export.
  // All graph/material/camera/environment logic stays in StudySceneProject.
  class PublicationDocument extends SceneDocument { _newId() { let id; do { id = 'custom-study-' + this.nextId++; } while (this.objects.has(id)); return id; } }
  return require('./load-study-scenes')(THREE, schema, PublicationDocument);
}
function glbRootCount(filename) {
  const bytes = fs.readFileSync(path.join(ROOT, 'assets', filename)); assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  const length = bytes.readUInt32LE(12); assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
  const json = JSON.parse(bytes.subarray(20, 20 + length).toString('utf8').trim()); return json.scenes[json.scene || 0].nodes.length;
}
function nativeMask() {
  // Container roots are explicit in src/rooms/{Hall,Sound,PanoramaStereo,
  // Panorama}. Model-root child counts come directly from the actual GLBs.
  const counts = {hall: 1, sound: 2, photogrammetry: glbRootCount('angel.min.glb'), vertigo: glbRootCount('vertigo.glb'), panoramastereo: 2, panorama1: 1, panorama2: 1, panorama3: 1, panorama4: 1, panorama5: 1};
  const roots = {}, native = new Map();
  Object.entries(counts).forEach(([roomId, count]) => { const root = new THREE.Group(); roots[roomId] = root; for (let index = 0; index < count; index++) { const object = new THREE.Group(); root.add(object); native.set('native:' + roomId + ':root.' + index, {roomId, object}); } });
  return {native, getRoot: id => roots[id], counts};
}
function inventory(database) {
  const projects = database.prepare('SELECT id,name,revision,created_at,updated_at FROM projects ORDER BY id').all().map(row => ({...row}));
  const revisions = database.prepare('SELECT project_id,revision,name,document,created_at FROM revisions ORDER BY project_id,revision').all().map(row => ({projectId: row.project_id, revision: row.revision, name: row.name, createdAt: row.created_at, bytesHash: bytesHash(row.document), contentHash: hash(JSON.parse(row.document))}));
  return {projects, revisions, fingerprint: hash({projects, revisions})};
}
function currentProject(database, id) {
  const row = database.prepare('SELECT p.*,r.document FROM projects p JOIN revisions r ON r.project_id=p.id AND r.revision=p.revision WHERE p.id=?').get(id);
  assert(row, 'Falta el proyecto protegido: ' + id); return {...row, document: JSON.parse(row.document), rawDocumentHash: bytesHash(row.document)};
}
function protectedState(database, expected) {
  return PROTECTED.map(target => { const current = currentProject(database, target.id); assert.equal(current.revision, target.revision, 'Cambió la revisión del proyecto protegido ' + target.id);
    const state = {id: current.id, name: current.name, revision: current.revision, createdAt: current.created_at, updatedAt: current.updated_at, rawDocumentHash: current.rawDocumentHash, contentHash: hash(current.document)};
    if (expected) assert.deepEqual(state, expected.find(item => item.id === target.id), 'El proyecto protegido cambió desde la preparación.'); return state;
  });
}
function assertExistingUnchanged(before, after) {
  before.projects.forEach(row => assert.deepEqual(after.projects.find(current => current.id === row.id), row, 'Se modificó un proyecto existente: ' + row.id));
  before.revisions.forEach(row => assert.deepEqual(after.revisions.find(current => current.projectId === row.projectId && current.revision === row.revision), row, 'Se modificó una revisión existente: ' + row.projectId + '/' + row.revision));
}
function validateCandidate(document, target, reports) {
  assert.equal(document.imports.length, 0, 'Los ejemplos no necesitan importar ni copiar archivos.');
  const canonical = validateDocument(document, () => { throw new Error('Importación inesperada.'); });
  assert.equal(hash(canonical), hash(document), 'La validación modificó el documento preparado.');
  assert.equal(document.studio.scenes.length, target.ids.length); assert.equal(reports.length, target.ids.length); assert.equal(document.studio.startRoomId, 'hall');
  reports.forEach((report, index) => {
    assert.equal(report.presetId, target.ids[index]); assert.equal(report.roomId, schema.studio.ROOM_IDS[index]); assert(report.sourceIds.length && report.receiverIds.length);
    const room = document.rooms[report.roomId], rows = new Map(room.additions.map(row => [row.id, row])); assert(room.overrides.length);
    assert(room.overrides.every(row => row.visible === false && /^native:[^:]+:root\.\d+$/.test(row.id)));
    Object.entries(productionDefaults()).forEach(([key, value]) => assert.equal(document.studio.environments.find(environment => environment.roomId === report.roomId)[key], value));
    document.studio.entities.filter(entity => entity.roomId === report.roomId && entity.type === 'pointLight').forEach(entity => assert.equal(entity.intensity, .65));
    report.lines.forEach(line => { const monitor = rows.get(line.monitorId), cfg = monitor && monitor.behaviors.find(value => value.type === 'lineMonitor'); assert(cfg && cfg.scope === 'line' && cfg.targetId === line.controllerId); assert(line.machineIds.includes(line.controllerId));
      line.links.forEach(link => { assert(rows.has(link.source) && rows.has(link.target)); });
    });
  });
  return canonical;
}
function productionDefaults() { return {renderQuality: 'high', shadows: true, exposure: .9, sunIntensity: .85, ambientIntensity: .15, machineSounds: true, machineVolume: .25, ambientPreset: 'warehouse', ambientSound: '', ambientVolume: .12}; }
function targetsPlan(database, candidates) {
  return candidates.map(candidate => { const matches = database.prepare('SELECT id FROM projects WHERE name=? ORDER BY id').all(candidate.name);
    assert(matches.length <= 1, 'Hay varios proyectos con el nombre de publicación: ' + candidate.name);
    if (!matches.length) return {...candidate, existing: false};
    const current = currentProject(database, matches[0].id); assert.equal(hash(current.document), candidate.contentHash, 'El nombre ya pertenece a otro contenido; no se sobrescribirá: ' + candidate.name);
    assert(!PROTECTED.some(project => project.id === current.id)); return {...candidate, existing: true, id: current.id, revision: current.revision};
  });
}
async function verifiedBackup(database, options, before, label) {
  const directory = path.join(options.dataDir, 'backups'); fs.mkdirSync(directory, {recursive: true});
  const filename = path.join(directory, 'before-study-publication-' + label + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.sqlite');
  await backup(database, filename); const copy = new DatabaseSync(filename, {readOnly: true});
  try { assert.equal(copy.prepare('PRAGMA quick_check').get().quick_check, 'ok'); assert.equal(inventory(copy).fingerprint, before.fingerprint); }
  finally { copy.close(); }
  return {file: filename, bytes: fs.statSync(filename).size, sha256: bytesHash(fs.readFileSync(filename)), inventoryHash: before.fingerprint};
}
function flowQA() {
  const run = spawnSync(process.execPath, [path.join(__dirname, 'test-study-scenes.js')], {cwd: ROOT, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 180000});
  if (run.error) throw run.error; assert.equal(run.status, 0, 'Falló QA de puertos, unidades, modos manuales y transacciones:\n' + run.stdout + run.stderr);
  return {passed: true, command: 'node scripts/test-study-scenes.js', output: run.stdout.trim(), assertions: ['real physical ports', 'rework 8/8 units', 'packing 18/6 units', 'four pallets / 16 units', 'manual idle', 'server validation', 'environment defaults', 'single undo/redo', 'rollback', 'ten-room separate project']};
}
function projectURLs(baseURL, project, reports) { return {editor: baseURL + '/editor?project=' + project.id + '&room=hall', explore: baseURL + '/?project=' + project.id + '&room=hall', levels: reports.map(report => ({roomId: report.roomId, title: report.title, presetId: report.presetId, editor: baseURL + '/editor?project=' + project.id + '&room=' + report.roomId, explore: baseURL + '/?project=' + project.id + '&room=' + report.roomId}))}; }

async function prepare(options) {
  assert(fs.existsSync(options.databasePath), 'No existe la base actual; la preparación no la creará.');
  const database = new DatabaseSync(options.databasePath, {readOnly: true});
  try {
    const protectedProjects = protectedState(database), before = inventory(database), study = productionCompiler(), mask = nativeMask(), candidates = [];
    for (const target of TARGETS) {
      const built = await study.compileStudyProject(target.ids, {name: target.name, nativeDocument: mask, continuous: false});
      const document = validateCandidate(built.document, target, built.reports), file = path.join(options.exportsDir, target.file); writeJSON(file, document);
      candidates.push({key: target.key, name: target.name, presetIds: target.ids, file, fileHash: bytesHash(fs.readFileSync(file)), contentHash: hash(document), document, reports: built.reports});
    }
    const plan = targetsPlan(database, candidates), qa = flowQA(), snapshot = await verifiedBackup(database, options, before, 'prepared');
    assert.equal(inventory(database).fingerprint, before.fingerprint, 'La base cambió durante la preparación; vuelve a preparar.'); protectedState(database, protectedProjects);
    const report = {format: 'hello-webxr-study-publication', version: 1, mode: 'dry-run', preparedAt: new Date().toISOString(), databasePath: options.databasePath, baseURL: options.baseURL, sourceInventoryHash: before.fingerprint, protectedProjects, backup: snapshot, nativeTopLevelCounts: mask.counts, qa,
      projects: plan.map(({document, ...candidate}) => ({...candidate, action: candidate.existing ? 'reuse' : 'create', sceneCount: candidate.reports.length})), writes: [], applyCommand: 'node scripts/publish-study-projects.js --apply'};
    writeJSON(options.reportFile, report); return report;
  } finally { database.close(); }
}

async function apply(options) {
  const reviewed = readJSON(options.reportFile); assert.equal(reviewed.format, 'hello-webxr-study-publication'); assert.equal(reviewed.version, 1); assert(reviewed.qa.passed); assert.equal(path.resolve(reviewed.databasePath), options.databasePath);
  assert(fs.existsSync(reviewed.backup.file)); assert.equal(bytesHash(fs.readFileSync(reviewed.backup.file)), reviewed.backup.sha256);
  const candidates = TARGETS.map(target => { const artifact = reviewed.projects.find(candidate => candidate.key === target.key); assert(artifact && artifact.name === target.name); assert.deepEqual(artifact.presetIds, target.ids);
    const file = path.resolve(artifact.file); assert.equal(file, path.join(options.exportsDir, target.file)); assert.equal(bytesHash(fs.readFileSync(file)), artifact.fileHash); const document = readJSON(file); validateCandidate(document, target, artifact.reports); assert.equal(hash(document), artifact.contentHash); return {...artifact, document};
  });
  // Read-only preflight and WAL-safe backup finish before a writable connection.
  const reader = new DatabaseSync(options.databasePath, {readOnly: true}); let snapshot;
  try { protectedState(reader, reviewed.protectedProjects); targetsPlan(reader, candidates); snapshot = await verifiedBackup(reader, options, inventory(reader), 'apply'); }
  finally { reader.close(); }
  const database = new DatabaseSync(options.databasePath); let results, writes = [], before;
  try {
    database.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE;');
    try {
      before = inventory(database); protectedState(database, reviewed.protectedProjects); const plan = targetsPlan(database, candidates), timestamp = new Date().toISOString();
      const insertProject = database.prepare('INSERT INTO projects(id,name,revision,created_at,updated_at) VALUES(?,?,1,?,?)'), insertRevision = database.prepare('INSERT INTO revisions(project_id,revision,name,document,created_at) VALUES(?,1,?,?,?)');
      results = plan.map(candidate => {
        if (candidate.existing) return {...candidate, action: 'reused'};
        const id = randomUUID(); assert(!PROTECTED.some(project => project.id === id));
        insertProject.run(id, candidate.name, timestamp, timestamp); insertRevision.run(id, candidate.name, JSON.stringify(candidate.document), timestamp);
        writes.push({operation: 'INSERT new project + revision 1', projectId: id, name: candidate.name}); return {...candidate, id, revision: 1, action: 'created'};
      });
      const after = inventory(database); assertExistingUnchanged(before, after); protectedState(database, reviewed.protectedProjects);
      assert.equal(after.projects.length - before.projects.length, writes.length); assert.equal(after.revisions.length - before.revisions.length, writes.length);
      assert.equal(new Set(results.map(project => project.id)).size, 2); results.forEach(candidate => assert.equal(hash(currentProject(database, candidate.id).document), candidate.contentHash));
      database.exec('COMMIT');
    } catch (error) { database.exec('ROLLBACK'); throw error; }
    const after = inventory(database); assertExistingUnchanged(before, after); const protectedProjects = protectedState(database, reviewed.protectedProjects);
    const report = {...reviewed, mode: 'applied', appliedAt: new Date().toISOString(), applyBackup: snapshot, protectedProjects, afterInventoryHash: after.fingerprint, writes,
      projects: results.map(({document, ...candidate}) => ({...candidate, sceneCount: candidate.reports.length, urls: projectURLs(options.baseURL, candidate, candidate.reports)})), existingProjectsUnchanged: true};
    writeJSON(options.reportFile, report); return report;
  } finally { database.close(); }
}
function summary(report, options) { return {mode: report.mode, reportFile: options.reportFile, writes: report.writes.length, protectedProjects: report.protectedProjects.map(project => ({id: project.id, revision: project.revision, rawDocumentHash: project.rawDocumentHash})), projects: report.projects.map(project => ({name: project.name, id: project.id || null, revision: project.revision || null, sceneCount: project.sceneCount, contentHash: project.contentHash, action: project.action, urls: project.urls || null}))}; }
async function run(argv = process.argv.slice(2)) { const options = optionsFrom(argv), report = await (options.apply ? apply(options) : prepare(options)); console.log(JSON.stringify(summary(report, options), null, 2)); return report; }
module.exports = {run, prepare, apply, optionsFrom, productionCompiler, nativeMask, inventory, protectedState, validateCandidate, targetsPlan, assertExistingUnchanged, hash, bytesHash, TARGETS, PROTECTED};
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
