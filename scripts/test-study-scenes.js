'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const schema = require('../shared/behaviors'), {validateDocument} = require('../server/validation');
const source = fs.readFileSync(path.join(__dirname, 'test-industrial-lab-lines.js'), 'utf8');
const {fixture, harness, releaseGeometry} = new Function('require', '__dirname', source.slice(0, source.indexOf('\nasync function run()')) + '\nreturn {fixture,harness,releaseGeometry};')(require, __dirname);
const probe = fixture(), study = require('./load-study-scenes')(THREE, schema, probe.document.constructor); releaseGeometry(probe);
const variables = (f, object) => f.runtime.records.get(object.userData.editorId).variables;
function assertStudyEnvironment(environment) {
  assert(environment); Object.entries(study.STUDY_ENVIRONMENT_DEFAULTS).forEach(([key, value]) => assert.equal(environment[key], value, 'Study environment preserves ' + key));
}

async function environmentAuthoring(authoring, setup) {
  const f = setup(), roomId = f.editor.roomId;
  f.document.setStudio({environments: [Object.assign(schema.studio.defaultEnvironment(roomId), study.STUDY_ENVIRONMENT_DEFAULTS)]});
  const before = await f.document.serialize(), history = f.document.undoStack.length, container = new authoring.Element(); f.tools.openWorkspace('environment', container);
  const all = object => [object].concat(object.children.flatMap(all));
  const fields = all(container), named = name => fields.find(field => field.name === name);
  assert(named('renderQuality') && named('shadows') && named('machineSounds') && named('ambientPreset'));
  assert.equal(Number(named('exposure').min), .4); assert.equal(Number(named('exposure').max), 2);
  assert.equal(Number(named('machineVolume').max), 1); assert.equal(Number(named('ambientVolume').min), 0);
  named('renderQuality').value = 'performance'; named('shadows').checked = false; named('exposure').value = '0.8'; named('machineSounds').checked = false;
  named('machineVolume').value = '0.4'; named('ambientPreset').value = 'ventilation'; named('ambientSound').value = '  assets/sounds/warehouse.ogg  '; named('ambientVolume').value = '0.2';
  const apply = fields.find(field => field.textContent === 'Aplicar entorno'); assert(apply); await apply.listeners.click[0]();
  const updated = f.document.studio.environments.find(value => value.roomId === roomId);
  assert.equal(updated.renderQuality, 'performance'); assert.equal(updated.shadows, false); assert.equal(updated.exposure, .8); assert.equal(updated.machineSounds, false);
  assert.equal(updated.machineVolume, .4); assert.equal(updated.ambientPreset, 'ventilation'); assert.equal(updated.ambientSound, 'assets/sounds/warehouse.ogg'); assert.equal(updated.ambientVolume, .2);
  assert.equal(f.document.undoStack.length, history + 1); validateDocument(await f.document.serialize(), value => value);
  f.document.undo(); assert.deepEqual(await f.document.serialize(), before, 'One undo restores render and sound settings together.');
  f.document.redo(); assert.equal(f.document.studio.environments[0].ambientPreset, 'ventilation');
  for (const patch of [{renderQuality: 'ultra'}, {shadows: 'false'}, {exposure: .3}, {exposure: 2.1}, {machineSounds: 'yes'}, {machineVolume: 1.01}, {machineVolume: -.01}, {ambientPreset: 'ocean'}, {ambientVolume: 1.1}, {ambientSound: 12}]) assert.throws(() => schema.studio.normalize({version: 1, environments: [Object.assign({}, updated, patch)]}));
}

async function authoringTransactions() {
  const authors = fs.readFileSync(path.join(__dirname, 'test-studio-authoring.js'), 'utf8');
  const authoring = new Function('require', '__dirname', authors.slice(0, authors.indexOf('\nasync function run()')) + '\nreturn {harness,Element};')(require, __dirname);
  const setup = () => {
    const f = authoring.harness(), scene = new THREE.Scene(); f.document.rooms.forEach(room => scene.add(room.root)); f.editor.hooks.renderScene = scene;
    f.editor.hooks.gotoRoom = async index => { f.editor.ctx.room = index; };
    const Tools = study.loadStudioTools({prompt: () => 'Unused'}, {createElement: () => new authoring.Element()}); f.tools = new Tools(f.editor); return f;
  };
  await environmentAuthoring(authoring, setup);
  const f = setup(); f.document.setStudio({scenes: [{id: 'hall', name: 'Original protegido'}], startRoomId: 'hall'});
  f.document.addPrefab('hall', 'source'); const before = await f.document.serialize(), history = f.document.undoStack.length;
  const result = await f.tools.createStudyVariant('advanced-rework'); assert.equal(result.destination, 'scene'); assert.equal(result.roomId, 'sound');
  assert.equal(f.document.undoStack.length, history + 1); assert.equal(result.reports[0].lines[0].expectedReceiverUnits.join('/'), '8/8');
  const created = validateDocument(await f.document.serialize(), value => value); assert.deepEqual(created.rooms.hall, before.rooms.hall); assert.equal(created.studio.startRoomId, 'hall');
  f.document.undo(); assert.deepEqual(await f.document.serialize(), before, 'One undo removes the entire new lesson.'); f.document.redo(); assert.deepEqual(await f.document.serialize(), created);
  const failed = setup(), failureBefore = await failed.document.serialize(), failureHistory = failed.document.undoStack.length;
  failed.tools.populateStudyScene = () => { failed.document.addPrimitive(failed.editor.roomId, 'box'); throw new Error('Injected builder failure'); };
  await assert.rejects(() => failed.tools.createStudyVariant('advanced-rework'), /Injected builder failure/);
  assert.deepEqual(await failed.document.serialize(), failureBefore); assert.equal(failed.document.undoStack.length, failureHistory); assert.equal(failed.editor.roomId, 'hall');
  const full = setup(); full.document.setStudio({scenes: schema.studio.ROOM_IDS.map(id => ({id, name: 'Ocupada ' + id}))});
  const fullBefore = await full.document.serialize(); let writeCount = 0, savedSource;
  full.editor.keepCurrentProject = async () => { savedSource = await full.document.serialize(); };
  full.editor.projectClient = {async createProject(name, document) { writeCount++; validateDocument(document, value => value); return {id: 'new-separate-project', revision: 1, name, document}; }};
  full.editor.applyServerProject = async saved => { await full.document.load(saved.document); full.editor.ctx.room = 0; };
  const separate = await full.tools.createStudyVariant('advanced-pallets'); assert.equal(separate.destination, 'project'); assert.equal(writeCount, 1); assert.deepEqual(savedSource, fullBefore, 'A full project is preserved before writing one complete separate project.');
  const invalid = setup(); let invalidWrites = 0; invalid.editor.projectClient = {createProject() { invalidWrites++; }};
  await assert.rejects(() => invalid.tools.createStudyProject(['unknown-preset']), /no existe/); assert.equal(invalidWrites, 0);
  console.log('Study authoring: preserved source, single undo/redo, whole-operation rollback, ten-room fallback and preparation-before-write passed.');
}

async function run() {
  assert.equal(study.STUDY_SCENES.length, 19); assert.equal(new Set(study.STUDY_SCENES.map(scene => scene.id)).size, 19);
  for (const definition of study.STUDY_SCENES.filter(scene => scene.advanced)) {
    const f = fixture(), built = study.buildStudyScene(f.document, 'hall', definition.id, {scene: f.scene}), line = built.lines[0];
    const saved = validateDocument(await f.document.serialize(), value => value); assert(saved.studio.missions.length === 1);
    assert.equal(saved.rooms.hall.additions.filter(row => row.descriptor.type === 'industrialFloor').length, 1, 'Every complete study includes exactly one persisted floor presentation.');
    assert(built.floorPresentation && built.floorPresentation.plan.walkways.length, 'The advanced study has usable pedestrian routes.');
    assert(built.monitorLayout && built.monitorLayout.changed); assert.deepEqual(built.monitorLayout.warnings, []); assert.equal(built.monitorLayout.supports.length, built.monitorLayout.affectedObjectIds.length * 3);
    assertStudyEnvironment(saved.studio.environments.find(value => value.roomId === 'hall'));
    assert(line.monitor && f.document.getBehaviors(line.monitor).some(value => value.type === 'lineMonitor' && value.targetId === line.controller.userData.editorId));
    const assembly = new study.ConveyorAssembly({document: f.document, roomId: 'hall', root: f.root, ctx: f.ctx, hooks: {renderScene: f.scene}, assemblyMessage() {}});
    for (const link of line.links) { const from = f.document.getObject(link.source), to = f.document.getObject(link.target); assert(assembly.worldPort(from, link.sourcePort).position.distanceTo(assembly.worldPort(to, link.targetPort).position) < 1e-6); assert(assembly.assessConnection(from, link.sourcePort, to, link.targetPort).ready); }
    assembly.clear(); f.runtime.start('hall');
    if (definition.mode === 'manual') {
      harness.advance(f, 12); assert.equal(line.receivers.reduce((sum, receiver) => sum + (variables(f, receiver).receivedUnits || 0), 0), 0, 'Manual practice stays empty until an explicit operator action.');
    } else {
      for (let elapsed = 0; elapsed < 360 && line.receivers.reduce((sum, receiver) => sum + (variables(f, receiver).receivedUnits || 0), 0) < definition.expectedUnits; elapsed += 5) harness.advance(f, 5);
      const actual = line.receivers.map(receiver => variables(f, receiver).receivedUnits || 0);
      if (actual.reduce((sum, count) => sum + count, 0) !== definition.expectedUnits) console.log(line.objects.filter(object => f.document.getBehaviors(object).some(value => ['source', 'conveyor', 'processor', 'palletQueue'].includes(value.type))).map(object => ({name: object.name, values: variables(f, object)})));
      assert.deepEqual(actual, line.expectedReceiverUnits, definition.id + ' delivers deterministic units to the intended physical destinations.');
      if (definition.advanced === 'pallets') assert.equal(variables(f, line.receivers[0]).received, 4);
      console.log(definition.id + ': real port connections and received units ' + actual.join('/'));
    }
    releaseGeometry(f);
  }
  const f = fixture(), original = await f.document.serialize();
  const prepared = await study.compileStudyProject(['lab-transfer-l', 'advanced-rework', 'advanced-packing', 'advanced-pallets', 'manual-station'], {name: 'Prepared study project', nativeDocument: f.document});
  assert.deepEqual(await f.document.serialize(), original, 'Detached preparation preserves the entire active document.');
  const valid = validateDocument(prepared.document, value => value); assert.equal(valid.studio.scenes.length, 5); assert.equal(prepared.reports.length, 5);
  valid.studio.environments.forEach(assertStudyEnvironment);
  valid.studio.entities.filter(entity => entity.type === 'pointLight').forEach(entity => assert.equal(entity.intensity, .65));
  assert(valid.rooms.hall.overrides.some(item => item.visible === false), 'New study rooms hide native geometry without editing its source.');
  for (const report of prepared.reports) { assert(report.sourceIds.length); assert(report.receiverIds.length); assert(report.lines.every(line => line.monitorId && line.machineIds.length)); }
  await assert.rejects(() => study.compileStudyProject(Array(11).fill('lab-transfer-l')), /uno y diez/);
  const preview = study.studyPreviewObject('lab-sorting'); assert(preview.children.length > 2); assert(!preview.children.some(object => object.name.includes('Muro')));
  const fundamentals = await study.compileStudyProject(study.STUDY_SCENES.filter(definition => definition.cellId).map(definition => definition.id), {nativeDocument: f.document});
  assert.equal(fundamentals.document.studio.environments.length, 9); validateDocument(fundamentals.document, value => value).studio.environments.forEach(assertStudyEnvironment);
  fundamentals.document.studio.scenes.forEach(scene => assert.equal(fundamentals.document.rooms[scene.id].additions.filter(row => row.descriptor.type === 'industrialFloor').length, 1, 'Every fundamental lesson has persisted markings.'));
  const cedi = await study.compileStudyProject(['cedi-sorting', 'cedi-packing'], {nativeDocument: f.document});
  assert.equal(cedi.document.studio.environments.length, 2); validateDocument(cedi.document, value => value).studio.environments.forEach(assertStudyEnvironment);
  cedi.document.studio.scenes.forEach(scene => assert.equal(cedi.document.rooms[scene.id].additions.filter(row => row.descriptor.type === 'industrialFloor').length, 1, 'Each CEDI level has a single floor presentation.'));
  releaseGeometry(f); await authoringTransactions(); console.log('Study catalog: 19 presets, deterministic advanced flow, manual idle, server validation, detached preparation and actual-geometry preview passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
