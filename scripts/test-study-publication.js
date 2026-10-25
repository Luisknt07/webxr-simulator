'use strict';
// Exercises publication only against fresh temporary SQLite databases.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {DatabaseSync, backup} = require('node:sqlite');
const {ProjectStore} = require('../server/storage'), schema = require('../shared/studio-document');
const publish = require('./publish-study-projects');
const writeJSON = (filename, value) => { fs.mkdirSync(path.dirname(filename), {recursive: true}); fs.writeFileSync(filename, JSON.stringify(value)); };
async function run() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hello-study-publication-'));
  assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
  try {
    const compiler = publish.productionCompiler(), mask = publish.nativeMask(), candidates = [];
    for (const target of publish.TARGETS) {
      const built = await compiler.compileStudyProject(target.ids, {name: target.name, nativeDocument: mask, continuous: false});
      publish.validateCandidate(built.document, target, built.reports);
      const repeated = await compiler.compileStudyProject(target.ids, {name: target.name, nativeDocument: mask, continuous: false});
      assert.equal(publish.hash(repeated.document), publish.hash(built.document), 'Repeated compiler preparation has a stable content hash.');
      candidates.push({...target, document: built.document, reports: built.reports, presetIds: target.ids, contentHash: publish.hash(built.document)});
    }
    const setup = async label => {
      const dataDir = path.join(temporary, label), outputDir = path.join(dataDir, 'qa'), exportsDir = path.join(dataDir, 'exports');
      const options = publish.optionsFrom(['--data-dir', dataDir, '--output-dir', outputDir, '--exports-dir', exportsDir]);
      const store = new ProjectStore({dataDir}); store.close(); const database = new DatabaseSync(options.databasePath);
      const document = {format: 'hello-webxr-editor', version: 1, rooms: Object.fromEntries(schema.ROOM_IDS.map(id => [id, {overrides: [], additions: []}])), imports: []};
      for (const target of publish.PROTECTED) {
        database.prepare('INSERT INTO projects(id,name,revision,created_at,updated_at) VALUES(?,?,?,?,?)').run(target.id, 'Protected ' + target.id, target.revision, '2026-01-01', '2026-01-01');
        for (let revision = 1; revision <= target.revision; revision++) database.prepare('INSERT INTO revisions(project_id,revision,name,document,created_at) VALUES(?,?,?,?,?)').run(target.id, revision, 'Protected ' + target.id, JSON.stringify(document), '2026-01-01');
      }
      const before = publish.inventory(database), protectedProjects = publish.protectedState(database), backupFile = path.join(dataDir, 'prepared-backup.sqlite'); await backup(database, backupFile); database.close();
      const projects = candidates.map(candidate => { const file = path.join(exportsDir, candidate.file); writeJSON(file, candidate.document); const {document: omitted, ...metadata} = candidate; return {...metadata, file, fileHash: publish.bytesHash(fs.readFileSync(file))}; });
      writeJSON(options.reportFile, {format: 'hello-webxr-study-publication', version: 1, databasePath: options.databasePath, protectedProjects, qa: {passed: true}, backup: {file: backupFile, sha256: publish.bytesHash(fs.readFileSync(backupFile))}, projects});
      return {options, before};
    };
    const successful = await setup('success'), result = await publish.apply(successful.options); assert.equal(result.writes.length, 2); assert.equal(result.projects.length, 2); assert(result.projects.every(project => project.revision === 1 && project.urls.editor.includes(project.id)));
    const successfulDb = new DatabaseSync(successful.options.databasePath, {readOnly: true}), afterFirst = publish.inventory(successfulDb); successfulDb.close(); publish.assertExistingUnchanged(successful.before, afterFirst);
    const repeated = await publish.apply(successful.options); assert.equal(repeated.writes.length, 0); assert(repeated.projects.every(project => project.action === 'reused'));
    const repeatedDb = new DatabaseSync(successful.options.databasePath, {readOnly: true}); assert.equal(publish.inventory(repeatedDb).fingerprint, afterFirst.fingerprint); repeatedDb.close();
    const conflict = await setup('conflict'), conflictDb = new DatabaseSync(conflict.options.databasePath);
    const wrong = {format: 'hello-webxr-editor', version: 1, rooms: {hall: {overrides: [], additions: []}}, imports: []};
    conflictDb.prepare('INSERT INTO projects(id,name,revision,created_at,updated_at) VALUES(?,?,1,?,?)').run('existing-unrelated', publish.TARGETS[0].name, '2026-01-01', '2026-01-01');
    conflictDb.prepare('INSERT INTO revisions(project_id,revision,name,document,created_at) VALUES(?,1,?,?,?)').run('existing-unrelated', publish.TARGETS[0].name, JSON.stringify(wrong), '2026-01-01');
    const conflictBefore = publish.inventory(conflictDb); conflictDb.close(); await assert.rejects(() => publish.apply(conflict.options), /no se sobrescribirá/);
    const conflictAfter = new DatabaseSync(conflict.options.databasePath, {readOnly: true}); assert.equal(publish.inventory(conflictAfter).fingerprint, conflictBefore.fingerprint); conflictAfter.close();
    const failed = await setup('atomic-failure'), failedDb = new DatabaseSync(failed.options.databasePath);
    failedDb.exec("CREATE TRIGGER reject_second_study BEFORE INSERT ON projects WHEN NEW.name = 'Automatización industrial · Casos avanzados' BEGIN SELECT RAISE(ABORT, 'Injected second insert failure'); END;"); failedDb.close();
    await assert.rejects(() => publish.apply(failed.options), /Injected second insert failure/);
    const failedAfter = new DatabaseSync(failed.options.databasePath, {readOnly: true}); assert.equal(publish.inventory(failedAfter).fingerprint, failed.before.fingerprint, 'The second-project failure rolls back the first project and its revision.'); failedAfter.close();
    assert.throws(() => publish.optionsFrom(['--unsafe-option']), /desconocida/);
    console.log('Study publication: stable compiler hashes, isolated SQLite pair insert, original/revision preservation, idempotent reuse, name conflict refusal, verified backups, URLs and atomic second-project rollback passed.');
  } finally { assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir())); fs.rmSync(temporary, {recursive: true, force: true}); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
