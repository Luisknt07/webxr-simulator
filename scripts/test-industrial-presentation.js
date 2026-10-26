'use strict';
// Guard fixtures are independent of the user's database. If a reviewed dry-run
// snapshot exists, SQLite integration runs against temporary copies only.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {DatabaseSync} = require('node:sqlite');
const schema = require('../shared/behaviors'), wear = require('../shared/wear'), {validateDocument} = require('../server/validation');
const publish = require('./publish-study-projects'), upgrade = require('./upgrade-industrial-presentation');
const clone = value => JSON.parse(JSON.stringify(value));
const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const config = (document, roomId, type) => document.rooms[roomId].additions.find(row => row.behaviors.some(value => value.type === type));
function material(name, metalness, wearValue) { const value = Object.assign(schema.defaultBehavior('surfaceMaterial'), {name, metalness, wear: wearValue}); delete value.overrides; return value; }
async function fixtures() {
  const compiler = publish.productionCompiler(), built = await compiler.compileStudyProject(['lab-transfer-l', 'lab-sorting', 'lab-assembly', 'advanced-rework'], {nativeDocument: publish.nativeMask(), continuous: false});
  const before = built.document;
  upgrade.ROOMS.forEach(roomId => {
    const row = config(before, roomId, 'source');
    // Builders now install generated finishes/wear. Replace only those fixture
    // inputs so each deliberately tested behavior occurs exactly once.
    row.behaviors = row.behaviors.filter(value => !['surfaceMaterial', 'surfaceWear'].includes(value.type));
    row.behaviors.push(Object.assign(material('Industrial · fixture', .8, .1), {overrides: [material('Industrial · superior', .7, .6), material('Material del usuario', .8, .1), material('Industrial · caucho', 0, .1), material('Industrial · umbral', .15, .1)]}));
    row.behaviors.push({type: 'surfaceWear', enabled: true, layers: wear.normalizeLayerJSON([{id: 'industrial-light-scratches', pattern: 'scratches', opacity: .3, density: .4, matrix}, {id: 'user-layer', pattern: 'grime', opacity: .2, density: .3, matrix}])});
  });
  before.studio.entities.filter(entity => entity.type === 'pointLight').forEach(entity => { entity.intensity = 1.2; });
  const base = clone(validateDocument(before, value => value)), candidate = upgrade.buildCandidate(base), safe = upgrade.verifyCandidate(base, candidate);
  assert.equal(safe.protectedRooms.length, 7); assert(safe.counts.materialWear === 3 && safe.counts.scratchOpacity === 3 && safe.counts.scratchDensity === 3); assert(safe.counts.pointLights > 0);
  upgrade.ROOMS.forEach(roomId => { const row = config(safe.document, roomId, 'source'), finish = row.behaviors.find(value => value.type === 'surfaceMaterial'), layers = JSON.parse(row.behaviors.find(value => value.type === 'surfaceWear').layers); assert.equal(finish.wear, .24); assert.deepEqual(finish.overrides.map(value => value.wear), [.6, .1, .1, .1]); assert.equal(layers[0].opacity, .55); assert.equal(layers[0].density, .6); assert.equal(layers[1].opacity, .2); });
  assert.deepEqual(upgrade.buildCandidate(safe.document), safe.document, 'Repeated passive preparation is idempotent.');
  let rejected = 0; const mutate = action => { const changed = clone(candidate); action(changed); assert.throws(() => upgrade.verifyCandidate(base, changed), /presentación pasiva/); rejected++; };
  mutate(document => { config(document, 'sound', 'source').behaviors.find(value => value.type === 'source').interval += 1; });
  mutate(document => { config(document, 'vertigo', 'processor').behaviors.find(value => value.type === 'processor').processTime += 1; });
  mutate(document => { config(document, 'sound', 'conveyor').behaviors.find(value => value.type === 'conveyor').outputId = 'custom-wrong'; });
  mutate(document => { config(document, 'sound', 'source').position[0] += .1; });
  mutate(document => { config(document, 'sound', 'source').quaternion[1] += .01; });
  mutate(document => { config(document, 'sound', 'source').scale[0] += .1; });
  mutate(document => { config(document, 'sound', 'source').descriptor.variant = 'queue'; });
  mutate(document => { const row = config(document, 'sound', 'source'); Object.values(row.nodes)[0].position[0] += .1; });
  mutate(document => { const row = config(document, 'sound', 'source'), node = Object.values(row.nodes).find(value => value.behaviors.some(behavior => behavior.type === 'control')); node.behaviors.find(value => value.type === 'control').action = 'powerOff'; });
  mutate(document => { document.rooms.sound.overrides[0].visible = true; });
  mutate(document => { document.rooms.sound.additions.push({...clone(config(document, 'sound', 'source')), id: 'custom-unapproved-object'}); });
  mutate(document => { document.rooms.hall.additions[0].position[0] += .1; });
  mutate(document => { document.imports.push({id: 'new-import'}); });
  mutate(document => { document.studio.startRoomId = 'sound'; });
  mutate(document => { document.studio.groups[0].name += ' changed'; });
  mutate(document => { document.studio.entities.find(entity => entity.roomId === 'sound' && entity.type === 'pointLight').range += 1; });
  mutate(document => { document.studio.entities.find(entity => entity.type === 'camera').fov += 1; });
  mutate(document => { document.studio.entities.push(clone(document.studio.entities[0])); });
  mutate(document => { const value = config(document, 'sound', 'source').behaviors.find(behavior => behavior.type === 'surfaceMaterial'); value.overrides[1].wear = .24; });
  for (const change of [layer => { layer.pattern = 'rust'; }, layer => { layer.matrix[12] += .1; }, layer => { layer.opacity = .56; }]) mutate(document => { const value = config(document, 'sound', 'source').behaviors.find(behavior => behavior.type === 'surfaceWear'), layers = JSON.parse(value.layers); change(layers[0]); value.layers = JSON.stringify(layers); });
  mutate(document => { const value = config(document, 'sound', 'source').behaviors.find(behavior => behavior.type === 'surfaceWear'), layers = JSON.parse(value.layers); layers[1].opacity = .55; value.layers = JSON.stringify(layers); });
  const studyOnly = {...upgrade.TARGETS[0], materials: false}, studyCandidate = upgrade.buildCandidate(base, studyOnly); upgrade.verifyCandidate(base, studyCandidate, studyOnly);
  upgrade.ROOMS.forEach(roomId => assert.deepEqual(studyCandidate.rooms[roomId], base.rooms[roomId], 'Study project updates leave every object record unchanged.'));
  console.log('Passive fixtures: exact allowed wear/scratch/light changes, preserved high/custom values, idempotence and ' + rejected + ' rejected graph/source/control/node/transform/import/Studio/other-room mutations passed.');
}
async function sqliteCopies() {
  const filename = path.join(__dirname, '../data/qa-studio/presentation-upgrade.json'); if (!fs.existsSync(filename)) return;
  const report = JSON.parse(fs.readFileSync(filename, 'utf8')); if (report.version !== 2 || !fs.existsSync(report.backup.file)) return;
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hello-passive-presentation-')); assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
  try {
    const setup = async name => { const dataDir = path.join(temporary, name); fs.mkdirSync(dataDir); fs.copyFileSync(report.backup.file, path.join(dataDir, 'projects.sqlite')); const options = upgrade.optionsFrom(['--data-dir', dataDir, '--output-dir', path.join(dataDir, 'qa'), '--exports-dir', path.join(dataDir, 'exports')]); const beforeDb = new DatabaseSync(options.databasePath, {readOnly: true}), before = publish.inventory(beforeDb); beforeDb.close(); await upgrade.prepare(options); assert(!fs.existsSync(path.join(options.exportsDir, 'industrial-cedi-complete.json')), 'Dry-run never writes the final export.'); return {options, before}; };
    const good = await setup('success'), applied = await upgrade.apply(good.options); assert.equal(applied.writes.length, 3); assert.deepEqual(applied.projects.map(project => project.revision), [15, 2, 2]);
    const first = new DatabaseSync(good.options.databasePath, {readOnly: true}), after = publish.inventory(first); first.close(); upgrade.assertOtherProjectsUnchanged(good.before, after);
    const repeated = await upgrade.apply(good.options); assert.equal(repeated.writes.length, 0); const second = new DatabaseSync(good.options.databasePath, {readOnly: true}); assert.equal(publish.inventory(second).fingerprint, after.fingerprint); second.close();
    const failed = await setup('third-write-failure'), failureDb = new DatabaseSync(failed.options.databasePath); failureDb.exec("CREATE TRIGGER reject_third_presentation BEFORE INSERT ON revisions WHEN NEW.project_id='05397448-a767-4f3b-8371-2aeb7ed18ae0' AND NEW.revision=2 BEGIN SELECT RAISE(ABORT, 'Injected third revision failure'); END;"); failureDb.close();
    await assert.rejects(() => upgrade.apply(failed.options), /Injected third revision failure/); const final = new DatabaseSync(failed.options.databasePath, {readOnly: true}); assert.equal(publish.inventory(final).fingerprint, failed.before.fingerprint, 'Failure of the third project rolls back all three revisions.'); final.close();
    console.log('Temporary SQLite snapshots: atomic 14→15 / 1→2 / 1→2, no project/history changes outside scope, idempotent reuse, export-only-on-apply and third-project rollback passed.');
  } finally { assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir())); fs.rmSync(temporary, {recursive: true, force: true}); }
}
fixtures().then(sqliteCopies).catch(error => { console.error(error); process.exitCode = 1; });
