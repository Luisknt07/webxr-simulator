'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {DatabaseSync} = require('node:sqlite'), schema = require('../shared/behaviors'), {validateDocument} = require('../server/validation');
const migration = require('./upgrade-industrial-equipment-presentation'), floorMigration = require('./upgrade-industrial-floor'), publication = require('./publish-study-projects'), presentation = require('./upgrade-industrial-presentation');
const clone = value => JSON.parse(JSON.stringify(value)), hash = presentation.hash, identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
async function fixtureGuards() {
  const cpu = migration.loadCPU(), empty = {rooms: Object.fromEntries(schema.studio.ROOM_IDS.map(id => [id, {overrides: [], additions: []}]))}, workspace = migration.nativeRoots(empty), document = new cpu.SceneDocument({scene: workspace.scene}); Object.entries(workspace.roots).forEach(([id, root]) => document.registerRoom(id, root));
  const roomId = 'sound', add = (name, color, position, scale) => { const object = document.addPrimitive(roomId, 'box', color); document.setProperty(object, 'name', name); document.setTransform(object, {position, scale}); return object; };
  const floor = add('Piso industrial · hormigón mate', '#777c76', [0, -.06, 0], [40, .12, 32]); const customFloor = Object.assign(schema.defaultBehavior('surfaceMaterial'), {name: 'Mi acabado de piso exacto', color: '#6a756b', roughness: .93}); document.setBehaviors(floor, [schema.defaultBehavior('collision'), schema.defaultBehavior('teleport'), customFloor]);
  const machines = [['source', -10], ['conveyor', -4], ['processor', 3], ['palletQueue', 9]].map(([type, x]) => { const object = document.addPrefab(roomId, type, type === 'conveyor' ? 'roller-motor' : undefined); document.setTransform(object, {position: [x, 1, -4]}); return object; });
  for (let index = 0; index < 3; index++) document.setBehaviors(machines[index], document.getBehaviors(machines[index]).map(value => ['source', 'conveyor', 'processor'].includes(value.type) ? Object.assign({}, value, {outputId: machines[index + 1].userData.editorId}) : value));
  require('./load-industrial-cedi')(require('three'), schema).applyIndustrialFinishes(document, roomId, machines, {decals: false});
  const customMachine = document.addPrefab(roomId, 'processor'); document.setTransform(customMachine, {position: [10, 1, 7]}); document.setBehaviors(customMachine, document.getBehaviors(customMachine).concat(Object.assign(schema.defaultBehavior('surfaceMaterial'), {name: 'Mi pintura exacta', color: '#945a42', wear: .13})));
  const guide = add('Guía · práctica reversible', '#182b38', [2, 2.4, 8], [4, 2, .12]); document.setBehaviors(guide, [Object.assign(schema.defaultBehavior('info'), {title: 'Contenido exacto', text: 'Objetivo y pasos que no deben cambiar.', color: '#bbddcc'}), schema.defaultBehavior('billboard')]);
  const customGuide = add('Guía personal', '#182b38', [-4, 1.8, 7], [2, 1, .1]); document.setBehaviors(customGuide, [schema.defaultBehavior('info')]);
  const monitor = add('Monitor · práctica', '#202f39', [-11, 2, 5], [3.2, 1.8, .12]); document.setBehaviors(monitor, [Object.assign(schema.defaultBehavior('lineMonitor'), {targetId: machines[0].userData.editorId, scope: 'line', title: 'Mi red exacta'})]);
  const stand = add('Pedestal del monitor', '#405360', [-11, .55, 5], [.12, 1.1, .12]), customStand = add('Mi soporte propio', '#405360', [-8, .55, 8], [.12, 1.1, .12]);
  document.setStudio({scenes: [{id: roomId, name: 'Fixture protegida'}], startRoomId: roomId, groups: [{id: 'fixture-line', name: 'Red intacta', roomId, members: machines.concat(monitor, stand).map(object => object.userData.editorId)}], environments: [schema.studio.defaultEnvironment(roomId)]});
  const floorAPI = floorMigration.loadCPU(); floorAPI.applyIndustrialFloorPresentation(document, roomId, {floorObject: floor});
  const wear = document.getBehaviors(floor).find(value => value.type === 'surfaceWear'); const layers = JSON.parse(wear.layers).concat([{id: 'my-brush-exact', pattern: 'grime', matrix: identity, opacity: .12}]); document.setBehaviors(floor, document.getBehaviors(floor).map(value => value.type === 'surfaceWear' ? Object.assign({}, value, {layers: JSON.stringify(layers)}) : value));
  const protectedObject = document.addPrimitive('hall', 'box', '#425566'), before = clone(validateDocument(await document.serialize(), value => value)), target = {key: 'fixture', rooms: [roomId]}, built = await migration.buildCandidate(before, target), after = built.document, manifest = built.manifest[0], row = (data, id) => data.rooms.sound.additions.find(value => value.id === id);
  assert.equal(manifest.monitorIds.length, 1); assert.equal(manifest.addedObjectIds.length, 3); assert.deepEqual(manifest.removedLegacyIds, [stand.userData.editorId]); assert.equal(manifest.messageIds.length, 1); assert.equal(manifest.agedIds.length, 4); assert.equal(manifest.floorIds.length, 1); assert(manifest.idempotent);
  for (const object of [customMachine, customGuide, customStand]) assert.deepEqual(row(after, object.userData.editorId), row(before, object.userData.editorId));
  assert.deepEqual(row(after, floor.userData.editorId).behaviors.find(value => value.type === 'surfaceMaterial'), customFloor); assert.deepEqual(JSON.parse(row(after, floor.userData.editorId).behaviors.find(value => value.type === 'surfaceWear').layers).find(layer => layer.id === 'my-brush-exact'), JSON.parse(row(before, floor.userData.editorId).behaviors.find(value => value.type === 'surfaceWear').layers).find(layer => layer.id === 'my-brush-exact'));
  let rejected = 0; const reject = action => { const candidate = clone(after), reviewed = clone(built.manifest); action(candidate, reviewed); assert.throws(() => migration.verifyCandidate(before, candidate, reviewed, target)); rejected++; };
  const rehash = (reviewed, data, id) => { reviewed[0].patches.find(value => value.id === id).expectedHash = hash(row(data, id)); };
  reject(data => { row(data, machines[0].userData.editorId).behaviors.find(value => value.type === 'source').interval += .1; });
  reject((data, reviewed) => { const id = machines[0].userData.editorId; row(data, id).behaviors.find(value => value.type === 'source').outputId = ''; rehash(reviewed, data, id); });
  reject((data, reviewed) => { const id = machines[1].userData.editorId; row(data, id).position[0] += .1; rehash(reviewed, data, id); });
  reject((data, reviewed) => { const id = machines[2].userData.editorId; Object.values(row(data, id).nodes)[0].position[1] += .1; rehash(reviewed, data, id); });
  reject((data, reviewed) => { const id = machines[0].userData.editorId; row(data, id).behaviors.find(value => value.type === 'surfaceMaterial').color = '#112233'; rehash(reviewed, data, id); });
  reject(data => { row(data, customMachine.userData.editorId).behaviors.find(value => value.type === 'surfaceMaterial').wear = .4; });
  reject((data, reviewed) => { const id = guide.userData.editorId; row(data, id).behaviors.find(value => value.type === 'info').text = 'Cambió el contenido'; rehash(reviewed, data, id); });
  reject((data, reviewed) => { const id = guide.userData.editorId; row(data, id).position[0] += .1; rehash(reviewed, data, id); });
  reject((data, reviewed) => { const id = monitor.userData.editorId; row(data, id).behaviors.find(value => value.type === 'lineMonitor').targetId = machines[3].userData.editorId; rehash(reviewed, data, id); });
  reject((data, reviewed) => { const id = floor.userData.editorId; row(data, id).behaviors.find(value => value.type === 'surfaceMaterial').color = '#112233'; rehash(reviewed, data, id); });
  reject((data, reviewed) => { const id = floor.userData.editorId, config = row(data, id).behaviors.find(value => value.type === 'surfaceWear'), custom = JSON.parse(config.layers); custom.find(value => value.id === 'my-brush-exact').opacity = .9; config.layers = JSON.stringify(custom); rehash(reviewed, data, id); });
  reject(data => { data.rooms.sound.additions.find(value => value.descriptor.type === 'industrialFloor').descriptor.walkways[0][0] += .1; });
  reject(data => { data.studio.groups[0].name = 'Cambio no autorizado'; }); reject(data => { data.studio.groups[0].members.shift(); }); reject(data => { data.studio.environments[0].exposure = .6; });
  reject(data => { data.rooms.hall.additions.find(value => value.id === protectedObject.userData.editorId).position[1] += 1; }); reject(data => { data.imports.push({id: 'unknown'}); });
  reject((data, reviewed) => { const id = manifest.addedObjectIds[0], support = row(data, id); support.behaviors.push(schema.defaultBehavior('source')); reviewed[0].added.find(value => value.id === id).expectedHash = publication.hash(support); });
  reject((data, reviewed) => { const id = manifest.addedObjectIds[0], support = row(data, id); support.position[1] += 1; reviewed[0].added.find(value => value.id === id).expectedHash = publication.hash(support); });
  reject((data, reviewed) => { reviewed[0].removedLegacyIds.push(customStand.userData.editorId); reviewed[0].removedLegacy.push({id: customStand.userData.editorId, expectedHash: hash(row(before, customStand.userData.editorId))}); data.rooms.sound.additions = data.rooms.sound.additions.filter(value => value.id !== customStand.userData.editorId); });
  reject((data, reviewed) => { reviewed[0].agedIds.push(customMachine.userData.editorId); }); reject((data, reviewed) => { reviewed[0].roomId = 'hall'; });
  console.log('Equipment migration fixture: literal recipes/control nodes/custom coatings/content/targets/floorplan/Studio, bounded generated support removal, deterministic aging, helper repeat and ' + rejected + ' rejected mutations passed.');
}
async function sqliteCopies() {
  // Test the guarded transition against its immutable pre-upgrade snapshot.
  // The user's current database can already be migrated, or absent on a new PC.
  const filename = path.join(__dirname, '../data/qa-studio/industrial-equipment-upgrade.json');
  const report = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : null;
  const archived = report && report.backup && report.backup.file;
  if (!archived || !fs.existsSync(archived)) {
    console.log('Temporary SQLite equipment transition: archived pre-upgrade snapshot unavailable; portable fixture guards passed above.');
    return;
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hello-equipment-upgrade-')); assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
  try {
    const setup = async name => { const dataDir = path.join(temporary, name); fs.mkdirSync(dataDir); fs.copyFileSync(archived, path.join(dataDir, 'projects.sqlite')); const options = migration.optionsFrom(['--data-dir', dataDir, '--output-dir', path.join(dataDir, 'qa'), '--exports-dir', path.join(dataDir, 'exports')]), db = new DatabaseSync(options.databasePath, {readOnly: true}), before = publication.inventory(db); db.close(); await migration.prepare(options); assert(!fs.existsSync(options.exportsDir)); return {options, before}; };
    const good = await setup('success'), saved = await migration.apply(good.options); assert.equal(saved.writes.length, 3); assert.deepEqual(saved.projects.map(project => project.revision), [17, 4, 4]); const db = new DatabaseSync(good.options.databasePath, {readOnly: true}), after = publication.inventory(db); presentation.assertOtherProjectsUnchanged(good.before, after); db.close();
    const repeated = await migration.apply(good.options); assert.equal(repeated.writes.length, 0); const repeatDb = new DatabaseSync(good.options.databasePath, {readOnly: true}); assert.equal(publication.inventory(repeatDb).fingerprint, after.fingerprint); repeatDb.close();
    const failed = await setup('third-write-failure'), failDb = new DatabaseSync(failed.options.databasePath); failDb.exec("CREATE TRIGGER reject_third_equipment BEFORE INSERT ON revisions WHEN NEW.project_id='05397448-a767-4f3b-8371-2aeb7ed18ae0' AND NEW.revision=4 BEGIN SELECT RAISE(ABORT, 'Injected third equipment failure'); END;"); failDb.close(); await assert.rejects(() => migration.apply(failed.options), /Injected third equipment failure/); const final = new DatabaseSync(failed.options.databasePath, {readOnly: true}); assert.equal(publication.inventory(final).fingerprint, failed.before.fingerprint, 'The third revision failure rolls back all three project changes.'); final.close();
    console.log('Temporary SQLite: atomic Lab16→17/studies3→4, preserved original and complete history, no-write repeat, exports only on apply and third-project rollback passed.');
  } finally { assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir())); fs.rmSync(temporary, {recursive: true, force: true}); }
}
fixtureGuards().then(() => process.argv.includes('--fixtures-only') ? undefined : sqliteCopies()).catch(error => { console.error(error); process.exitCode = 1; });
