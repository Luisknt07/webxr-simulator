'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const schema = require('../shared/behaviors'), {validateDocument} = require('../server/validation');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/^import .*$/gm, '');
const authorSource = read('scripts/test-studio-authoring.js');
const {harness, Element} = new Function('require', '__dirname', authorSource.slice(0, authorSource.indexOf('\nasync function run()')) + '\nreturn {harness,Element};')(require, __dirname);
// Compile the UI modules as JavaScript too: these modules have no build-only syntax.
new Function('STUDY_SCENES', read('src/editor/SceneCreationDialog.js').replace('export default class SceneCreationDialog', 'return class SceneCreationDialog'))([]);
const probe = harness(), study = require('./load-study-scenes')(THREE, schema, probe.document.constructor);
const Tools = study.loadStudioTools({prompt: () => 'Unused'}, {createElement: () => new Element()});
function fixture() { const f = harness(); f.editor.projectGeneration = 1; f.editor.clearNavigation = () => {}; f.editor.home = () => {}; f.tools = new Tools(f.editor); return f; }
async function run() {
  const f = fixture(), before = await f.document.serialize(); const blank = await study.compileBlankProject({name: 'Proyecto vacío', nativeDocument: f.document});
  validateDocument(blank.document, value => value); assert.equal(blank.name, 'Proyecto vacío'); assert.equal(blank.document.studio.scenes.length, 1); assert.equal(blank.document.studio.startRoomId, 'hall');
  assert.equal(blank.document.studio.environments[0].sky, 'day'); assert.equal(blank.document.rooms.hall.additions.length, 3); assert.equal(blank.document.rooms.hall.overrides.length, 1);
  assert.deepEqual(await f.document.serialize(), before, 'Compiling a blank project never changes the current document.');
  f.editor.sceneCreationDialog = {async request() { return null; }}; await f.tools.newScene(); assert.deepEqual(await f.document.serialize(), before);
  f.editor.sceneCreationDialog.request = async () => ({kind: 'empty', name: 'Nivel vacío'}); await f.tools.newScene(); assert.equal(f.editor.roomId, 'sound'); assert.equal(f.document.studio.scenes.find(scene => scene.id === 'sound').name, 'Nivel vacío');
  const guided = fixture(); let guidedRoom; guided.editor.sceneCreationDialog = {async request() { return {kind: 'guided', name: 'Nivel guiado'}; }}; guided.editor.sceneGuide = {open() { guidedRoom = guided.editor.roomId; }}; await guided.tools.newScene(); assert.equal(guidedRoom, 'sound', 'Guided construction opens only after a blank destination exists.');
  const project = fixture(); let writes = 0, payload; project.editor.sceneCreationDialog = {async request() { return {kind: 'empty', name: 'Proyecto independiente'}; }}; project.editor.projectTabs = {};
  project.editor.projectClient = {async createProject(name, document) { writes++; payload = document; return {id: 'new', name, revision: 1, document}; }};
  project.editor.applyServerProject = async saved => project.document.load(saved.document, {activeRoomId: 'hall'});
  await project.tools.newProject(); assert.equal(writes, 1); assert.equal(payload.studio.scenes.length, 1); assert.equal(project.editor.creatingProject, false);
  const failed = fixture(), failedBefore = await failed.document.serialize(); failed.editor.projectTabs = {}; failed.editor.sceneCreationDialog = project.editor.sceneCreationDialog; failed.editor.projectClient = {async createProject() { throw new Error('Project quota reached'); }};
  await assert.rejects(() => failed.tools.newProject(), /quota/); assert.deepEqual(await failed.document.serialize(), failedBefore); assert.equal(failed.editor.creatingProject, false); assert.equal(failed.editor.creatingStudy, false);
  const concurrent = fixture(); let resolve; concurrent.editor.sceneCreationDialog = {request() { return new Promise(done => { resolve = done; }); }}; const pending = concurrent.tools.newProject(); await assert.rejects(() => concurrent.tools.newProject(), /actual/); resolve(null); await pending;
  console.log('Scene creation: UI syntax, empty level environment, cancel, guided destination, pure preparation, one project write, quota rollback and creation lock passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
