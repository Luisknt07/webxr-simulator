const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {DatabaseSync} = require('node:sqlite'), schema = require('../../modules/logistica-industrial/contracts/behaviors'), wear = require('../../packages/render-three/schema/wear'), {validateDocument} = require('../../apps/api/server/validation');
const migration = require('../../tooling/maintenance/upgrade-industrial-floor'), publication = require('../../tooling/maintenance/publish-study-projects'), presentation = require('../../tooling/maintenance/upgrade-industrial-presentation');
const clone = value => JSON.parse(JSON.stringify(value)), hash = presentation.hash, matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
async function fixtureGuards() {
  const cpu = migration.loadCPU(), empty = {rooms: Object.fromEntries(schema.studio.ROOM_IDS.map(id => [id, {overrides: [], additions: []}]))}, workspace = migration.nativeRoots(empty), document = new cpu.SceneDocument({scene: workspace.scene}); Object.entries(workspace.roots).forEach(([id, root]) => document.registerRoom(id, root));
  const roomId = 'sound', floor = document.addPrimitive(roomId, 'box', '#777c76'); document.setProperty(floor, 'name', 'Piso industrial · hormigón mate'); document.setTransform(floor, {position: [0, -.06, 0], scale: [32, .12, 28]});
  const customMaterial = Object.assign(schema.defaultBehavior('surfaceMaterial'), {name: 'Mi hormigón personalizado', color: '#747b6b', roughness: .94}); document.setBehaviors(floor, [schema.defaultBehavior('collision'), schema.defaultBehavior('teleport'), customMaterial, {type: 'surfaceWear', enabled: false, layers: wear.normalizeLayerJSON([{id: 'user-brush', pattern: 'grime', opacity: .2, matrix}, {id: 'cedi-floor-tire-wear', pattern: 'grime', opacity: .19, matrix}])}]);
  const machines = [['source', -8], ['conveyor', -2], ['processor', 4], ['palletQueue', 9]].map(([type, x]) => { const object = document.addPrefab(roomId, type, type === 'conveyor' ? 'roller-motor' : undefined); document.setTransform(object, {position: [x, 1, -1]}); return object; });
  for (let index = 0; index < machines.length - 1; index++) document.setBehaviors(machines[index], document.getBehaviors(machines[index]).map(value => ['source', 'conveyor', 'processor'].includes(value.type) ? Object.assign({}, value, {outputId: machines[index + 1].userData.editorId}) : value));
  const paint = (name, custom) => { const object = document.addPrimitive(roomId, 'plane', '#385c60'); document.setProperty(object, 'name', name); document.setTransform(object, {position: [0, .004, 3], rotation: [-Math.PI / 2, 0, 0], scale: [1, 4, 1]}); document.setBehaviors(object, [Object.assign(schema.defaultBehavior('surfaceMaterial'), {color: '#385c60', roughness: 1, metalness: 0, colorMapMode: 'none'})]); if (custom) document.setProperty(object, 'color', '#ff00ff'); return object; };
  const legacy = paint('Ruta peatonal central', false), customPaint = paint('Límite peatonal', true), protectedObject = document.addPrimitive('hall', 'box', '#485566');
  const monitor = document.addPrimitive(roomId, 'box', '#203344'); document.setTransform(monitor, {position: [-11, 1.8, 5], scale: [3.2, 1.8, .12]}); document.setBehaviors(monitor, [Object.assign(schema.defaultBehavior('lineMonitor'), {targetId: machines[0].userData.editorId, title: 'Mi red', scope: 'line'})]);
  document.setStudio({scenes: [{id: roomId, name: 'Fixture de piso'}], startRoomId: roomId, groups: [{id: 'fixture-line', name: 'Red protegida', roomId, members: machines.map(object => object.userData.editorId).concat(monitor.userData.editorId)}], environments: [schema.studio.defaultEnvironment(roomId)]});
  const before = clone(validateDocument(await document.serialize(), value => value)), target = {key: 'fixture', rooms: [roomId]}, built = await migration.buildCandidate(before, target), manifest = built.manifest[0], after = built.document;
  assert.deepEqual(manifest.removedLegacyIds, [legacy.userData.editorId]); assert(after.rooms.sound.additions.some(row => row.id === customPaint.userData.editorId)); assert.equal(manifest.meshes <= 8, true); assert(manifest.qa.routesAndBaysClear && manifest.idempotent); assert.equal(manifest.addedObjectIds.length, 1);
  const floorAfter = after.rooms.sound.additions.find(row => row.id === floor.userData.editorId); assert.deepEqual(floorAfter.behaviors.find(value => value.type === 'surfaceMaterial'), customMaterial); assert.equal(floorAfter.behaviors.find(value => value.type === 'surfaceWear').enabled, false);
  machines.forEach(object => assert.equal(hash(after.rooms.sound.additions.find(row => row.id === object.userData.editorId)), hash(before.rooms.sound.additions.find(row => row.id === object.userData.editorId)))); assert.equal(hash(after.studio), hash(before.studio)); assert.equal(hash(after.rooms.hall), hash(before.rooms.hall));
  let rejected = 0; const reject = action => { const candidate = clone(after), reviewed = clone(built.manifest); action(candidate, reviewed); assert.throws(() => migration.verifyCandidate(before, candidate, reviewed, target)); rejected++; };
  const row = (data, id) => data.rooms.sound.additions.find(value => value.id === id), actor = data => row(data, manifest.presentationId), floorRow = data => row(data, manifest.floorId);
  reject(data => { row(data, machines[0].userData.editorId).behaviors.find(value => value.type === 'source').interval += 1; });
  reject(data => { row(data, machines[1].userData.editorId).behaviors.find(value => value.type === 'conveyor').outputId = ''; });
  reject(data => { row(data, machines[2].userData.editorId).position[0] += .1; });
  reject(data => { const node = Object.values(row(data, machines[0].userData.editorId).nodes)[0]; node.position[1] += .1; });
  reject(data => { row(data, monitor.userData.editorId).behaviors[0].targetId = machines[3].userData.editorId; });
  reject(data => { floorRow(data).position[1] += .01; });
  reject((data, reviewed) => { floorRow(data).behaviors.find(value => value.type === 'surfaceMaterial').color = '#777777'; reviewed[0].expectedFloorBehaviorsHash = hash(floorRow(data).behaviors); });
  reject((data, reviewed) => { const behavior = floorRow(data).behaviors.find(value => value.type === 'surfaceWear'), layers = JSON.parse(behavior.layers); layers.find(value => value.id === 'user-brush').opacity = .8; behavior.layers = JSON.stringify(layers); reviewed[0].expectedFloorBehaviorsHash = hash(floorRow(data).behaviors); });
  reject(data => { actor(data).position[1] = 1; });
  reject((data, reviewed) => { actor(data).interaction = {type: 'room', room: 1}; reviewed[0].expectedActorHash = hash(actor(data)); });
  reject((data, reviewed) => { actor(data).behaviors = [schema.defaultBehavior('source')]; reviewed[0].expectedActorHash = hash(actor(data)); });
  reject(data => { actor(data).descriptor.walkways[0][0] += .1; });
  reject(data => { data.rooms.hall.additions.find(value => value.id === protectedObject.userData.editorId).scale[0] += .1; });
  reject(data => { data.studio.groups[0].members.pop(); });
  reject(data => { data.studio.environments[0].sunIntensity = .5; });
  reject(data => { data.imports.push({id: 'unapproved'}); });
  reject(data => { data.rooms.sound.additions.pop(); });
  reject((data, reviewed) => { reviewed[0].removedLegacyIds.push(customPaint.userData.editorId); reviewed[0].removedLegacy.push({id: customPaint.userData.editorId, hash: hash(before.rooms.sound.additions.find(value => value.id === customPaint.userData.editorId))}); data.rooms.sound.additions = data.rooms.sound.additions.filter(value => value.id !== customPaint.userData.editorId); });
  reject((data, reviewed) => { reviewed[0].affectedObjectIds.push(machines[0].userData.editorId); });
  reject((data, reviewed) => { reviewed[0].roomId = 'hall'; });
  console.log('Floor upgrade fixtures: literal machines/control nodes/monitors/custom floor material+wear/Studio/imports, approved generated-paint removal, identity presentation pivot, clear routes, idempotence and ' + rejected + ' rejected out-of-scope mutations passed.');
}
async function sqliteCopies() {
  const filename = __layout.map(path.join(__layout.oldDir("scripts/test-industrial-floor-upgrade.js"), '../data/qa-studio/industrial-floor-upgrade.json')); if (!fs.existsSync(filename)) return; const report = JSON.parse(fs.readFileSync(filename, 'utf8')); if (!fs.existsSync(report.backup.file)) return;
  const temporary = fs.mkdtempSync(__layout.map(path.join(os.tmpdir(), 'hello-floor-upgrade-'))); assert.equal(path.dirname(__layout.map(path.resolve(temporary))), __layout.map(path.resolve(os.tmpdir())));
  try {
    const setup = async name => { const dataDir = __layout.map(path.join(temporary, name)); fs.mkdirSync(dataDir); fs.copyFileSync(report.backup.file, __layout.map(path.join(dataDir, 'projects.sqlite'))); const options = migration.optionsFrom(['--data-dir', dataDir, '--output-dir', __layout.map(path.join(dataDir, 'qa')), '--exports-dir', __layout.map(path.join(dataDir, 'exports'))]), database = new DatabaseSync(options.databasePath, {readOnly: true}), before = publication.inventory(database); database.close(); await migration.prepare(options); assert(!fs.existsSync(options.exportsDir), 'Dry-run does not update final exports.'); return {options, before}; };
    const good = await setup('success'), saved = await migration.apply(good.options); assert.equal(saved.writes.length, 3); assert.deepEqual(saved.projects.map(project => project.revision), [16, 3, 3]); const first = new DatabaseSync(good.options.databasePath, {readOnly: true}), after = publication.inventory(first); presentation.assertOtherProjectsUnchanged(good.before, after); first.close();
    const repeated = await migration.apply(good.options); assert.equal(repeated.writes.length, 0); const second = new DatabaseSync(good.options.databasePath, {readOnly: true}); assert.equal(publication.inventory(second).fingerprint, after.fingerprint); second.close();
    const failed = await setup('third-write-failure'), failureDb = new DatabaseSync(failed.options.databasePath); failureDb.exec("CREATE TRIGGER reject_third_floor BEFORE INSERT ON revisions WHEN NEW.project_id='05397448-a767-4f3b-8371-2aeb7ed18ae0' AND NEW.revision=3 BEGIN SELECT RAISE(ABORT, 'Injected third floor failure'); END;"); failureDb.close(); await assert.rejects(() => migration.apply(failed.options), /Injected third floor failure/);
    const final = new DatabaseSync(failed.options.databasePath, {readOnly: true}); assert.equal(publication.inventory(final).fingerprint, failed.before.fingerprint, 'The third-project failure rolls back the entire floor batch.'); final.close();
    console.log('Temporary SQLite snapshots: atomic Lab15→16 and studies2→3, literal prior history+original, no-op repeat, export-only-on-apply and third-project rollback passed.');
  } finally { assert.equal(path.dirname(__layout.map(path.resolve(temporary))), __layout.map(path.resolve(os.tmpdir()))); fs.rmSync(temporary, {recursive: true, force: true}); }
}
fixtureGuards().then(sqliteCopies).catch(error => { console.error(error); process.exitCode = 1; });
