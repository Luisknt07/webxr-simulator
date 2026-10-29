const __layout = require("../../tooling/layout.cjs");
/* Production sorting, RayControl and WebXR event bridge. Only canvas drawing,
 * account persistence and tracked hardware are adapted. No user data is opened.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const studio = require('../../packages/project-model/shared/studio-document');
const source = file => fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-education-runtime.js"), file)), 'utf8');
function harness(file, names) {
  const text = source(file), start = text.indexOf('async function run()'); assert(start > 0);
  return new Function('require', '__dirname', text.slice(0, start) + '\nreturn {' + names + '};')(require, __dirname);
}
const sorting = harness('test-conveyor-sorting-runtime.js', 'setup,sorter,machine,sourceTo,advance,vars,belt,rec,productRow,update');
const xr = harness('test-industrial-xr.js', 'setup,advance,aim,away,select,vars,wall,removeWall');
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.events = {}; this.draws = []; this.text = []; this.hidden = false; }
  set textContent(value) { this.content = String(value); this.children = []; }
  get textContent() { return (this.content || '') + this.children.map(child => child.textContent).join(''); }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  setAttribute() {}
  addEventListener(name, action) { (this.events[name] || (this.events[name] = [])).push(action); }
  dispatch(name) { (this.events[name] || []).forEach(action => action({})); }
  getContext() { return {fillRect: (...args) => this.draws.push(args), fillText: text => this.text.push(String(text))}; }
}
const document = {body: new Element('body'), createElement: tag => new Element(tag)};
let now = 1000, timerId = 0;
const timers = new Map();
const educationSource = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-education-runtime.js"), '../src/studio/EducationRuntime.js')), 'utf8').replace(/^import .*$/gm, '').replace('export default class EducationRuntime', 'class EducationRuntime').replace(/export function /g, 'function ');
const {EducationRuntime, advanceMission, signature} = new Function('THREE', 'document', 'performance', 'setTimeout', 'clearTimeout', educationSource + '\nreturn {EducationRuntime,advanceMission,signature};')(
  THREE, document, {now: () => now}, callback => { const id = ++timerId; timers.set(id, callback); return id; }, id => timers.delete(id)
);
function createEducation(fixture, missions = [], widgets = []) {
  const saved = [], messages = [];
  const client = {user: {id: 'user-one'}, getProgress: async () => saved.map(row => Object.assign({}, row)), saveProgress: async (projectId, missionId, missionVersion, value) => saved.push({projectId, missionId, missionVersion, value: JSON.parse(JSON.stringify(value))})};
  fixture.document.setStudio({missions, widgets});
  const editor = {simulation: fixture.runtime, document: fixture.document, roomId: 'hall', currentProject: {id: 'project-one'}, active: false, ctx: fixture.ctx, root: fixture.root, toast: text => messages.push(text)};
  fixture.ctx.editor = editor;
  const education = new EducationRuntime(editor, client); education.accountChanged();
  return {education, editor, client, saved, messages};
}
function mission(id, objectId, target = 2) { return {id, name: 'Clasificar correctamente', roomId: 'hall', description: 'Confirmar la salida real', help: '', start: 'automatic', steps: [{name: 'Salidas confirmadas', event: 'classification-confirmed', objectId, target, failEvent: ''}]}; }
function tick(education) { now += 120; education.tick(); }

async function run() {
  const config = mission('mission-unit', 'sorter');
  assert.equal(advanceMission(config, undefined, {type: 'package-entry', objectId: 'sorter'}).count, 0);
  assert.equal(advanceMission(config, undefined, {type: 'classification-confirmed', objectId: 'other'}).count, 0);
  let progress = advanceMission(config, undefined, {type: 'classification-confirmed', objectId: 'sorter'}); assert.equal(progress.count, 1);
  progress = advanceMission(config, progress, {type: 'classification-confirmed', objectId: 'sorter'}); assert.equal(progress.status, 'completed'); assert.equal(progress.step, 1);
  const manual = Object.assign({}, config, {start: 'manual'}); assert.equal(advanceMission(manual, undefined, {type: 'classification-confirmed', objectId: 'sorter'}).status, 'ready');
  const failing = Object.assign({}, config, {steps: [Object.assign({}, config.steps[0], {failEvent: 'reject-confirmed'})]}); assert.equal(advanceMission(failing, undefined, {type: 'reject-confirmed', objectId: 'sorter'}).status, 'failed');
  assert.throws(() => studio.normalize({version: 1, missions: [Object.assign({}, config, {steps: [Object.assign({}, config.steps[0], {target: 0})]})]}), /rango|límites/);

  const f = sorting.setup(), line = sorting.sorter(f, {routing: 'rules', routingRules: JSON.stringify([{field: 'sku', operator: 'eq', value: 'reject', route: 'branch'}])});
  sorting.update(f, line.branch, {powered: false, running: false});
  const input = sorting.machine(f, 'source', {generationMode: 'sequence', catalog: JSON.stringify([sorting.productRow('reject', '#ff0000')]), initialCount: 1}); sorting.sourceTo(f, input, line.tee);
  const realMission = mission('mission-sort', line.tee.userData.editorId), e = createEducation(f, [realMission]);
  f.runtime.start('hall'); sorting.advance(f, 7);
  assert.equal(sorting.vars(f, line.tee).routedBranch, 1, 'Admission has committed one route.');
  assert.equal(e.education.getProgress(realMission).count, 0, 'Admission must never pass a classification objective.');
  const waiting = sorting.belt(f, line.tee).packages[0]; assert(waiting);
  for (let index = 0; index < 60; index++) f.runtime.transferDetails(sorting.rec(f, line.tee), sorting.belt(f, line.tee), waiting);
  sorting.advance(f, 2); assert.equal(e.education.getProgress(realMission).count, 0, 'Blocked retries do not count as a classified exit.');
  f.runtime.setVariable(line.branch.userData.editorId, 'powered', true); f.runtime.command(line.branch.userData.editorId, 'start'); sorting.advance(f, 7);
  assert.equal(e.education.getProgress(realMission).count, 1); assert.equal(sorting.vars(f, line.branchStore).queued, 1);
  const confirmed = f.runtime.events.find(event => event.type === 'classification-confirmed'); assert(confirmed);
  for (let index = 0; index < 20; index++) e.education.event(confirmed);
  assert.equal(e.education.getProgress(realMission).count, 1, 'Repeated delivery of the same event ID is idempotent.');
  assert(f.runtime.sourceRuntime.generate(sorting.rec(f, input))); sorting.advance(f, 10);
  assert.equal(e.education.getProgress(realMission).status, 'completed'); assert.equal(sorting.vars(f, line.branchStore).queued, 2); assert(e.messages.some(text => text.includes('Objetivo completado')));
  await e.education.saveProgress(); assert.equal(e.saved.length, 1); assert.equal(e.saved[0].missionVersion, signature(realMission)); assert.equal(e.saved[0].value.status, 'completed'); assert.match(e.education.progressStatus, /guardado/);
  e.education.progress.clear(); await e.education.restoreProgress(); assert.equal(e.education.getProgress(realMission).status, 'completed');
  e.education.progress.clear(); const savedVersion = e.saved[0].missionVersion; e.saved[0].missionVersion++;
  await e.education.restoreProgress(); assert.equal(e.education.getProgress(realMission).status, 'active', 'A changed mission definition cannot reuse an incompatible completion.');
  assert(e.education.incompatible.has(realMission.id), 'The UI can offer explicit reset for a changed mission.');
  await e.education.resetMissionVersion(realMission); assert(!e.education.incompatible.has(realMission.id)); assert.equal(e.saved[e.saved.length - 1].value.status, 'active');
  e.education.pending.add('deleted-mission'); await e.education.saveProgress(); assert(!e.education.pending.has('deleted-mission'), 'Deleted missions cannot block switching projects forever.'); e.saved[0].missionVersion = savedVersion;
  e.education.progress.clear(); e.saved[0].value = {step: -1, count: -3, status: 'unknown'}; await e.education.restoreProgress(); assert.equal(e.education.getProgress(realMission).step, 0, 'Malformed stored progress must be ignored.');
  e.client.user = {id: 'user-two'}; e.education.accountChanged(); assert.equal(e.education.getProgress(realMission).status, 'active', 'Progress does not leak between accounts.');
  e.editor.active = true; e.education.event({id: 'edit-event', type: 'classification-confirmed', objectId: line.tee.userData.editorId}); assert.equal(e.education.getProgress(realMission).count, 0, 'Authoring and preview edits do not evaluate a running mission.'); e.editor.active = false;
  f.runtime.stop();

  const unmatched = sorting.setup(), ordinaryLine = sorting.sorter(unmatched, {routing: 'rules', routingRules: JSON.stringify([{field: 'sku', operator: 'eq', value: 'reject', route: 'branch'}])});
  const ordinaryInput = sorting.machine(unmatched, 'source', {initialCount: 1}); sorting.sourceTo(unmatched, ordinaryInput, ordinaryLine.tee);
  const ordinaryMission = mission('mission-unmatched', ordinaryLine.tee.userData.editorId), ordinaryEducation = createEducation(unmatched, [ordinaryMission]); unmatched.runtime.start('hall'); sorting.advance(unmatched, 12);
  assert.equal(sorting.vars(unmatched, ordinaryLine.mainStore).queued, 1); assert.equal(ordinaryEducation.education.getProgress(ordinaryMission).count, 0, 'Fallback outputs without a matching classification rule do not count as correctly classified.'); unmatched.runtime.stop();

  const x = xr.setup(), id = x.head.userData.editorId;
  const widgetConfig = {id: 'widget-power', name: 'Encender', roomId: 'hall', kind: 'button', text: 'Encender', objectId: id, variable: 'powered', action: 'powerOn', presentation: 'both', visible: true, color: '#51ebd2', position: [0, 2, 4], maximum: 100};
  const world = createEducation(x, [], [widgetConfig]); x.runtime.start('hall'); xr.advance(x); tick(world.education);
  let item = world.education.widgets[0]; assert(item.mesh.isMesh && item.texture.isCanvasTexture); assert.equal(item.state.controller, 'both'); assert.equal(item.state.consumeSelect, true); assert.equal(world.education.desktop.hidden, true, 'HTML remains hidden inside immersive VR.');
  const commands = [], actualCommand = x.runtime.command.bind(x.runtime); x.runtime.command = (...args) => { commands.push(args); return actualCommand(...args); };
  for (const controller of [x.left, x.right]) {
    xr.aim(x, controller, item.mesh.getWorldPosition(new THREE.Vector3()));
    const controllerData = x.ctx.raycontrol.controllers.find(data => data.controller === controller);
    assert(x.ctx.raycontrol.selectionEntries(controllerData).some(entry => entry.state === item.state), 'An actual tracked ray must select the world widget.');
    xr.select(x, controller, 'selectstart'); assert.equal(item.mesh.scale.x, 0.97); xr.away(x, controller); xr.select(x, controller, 'selectend'); assert.equal(item.mesh.scale.x, 1, 'Captured trigger release restores feedback after aiming away.');
  }
  assert.equal(commands.length, 2); assert(xr.vars(x).powered); assert.deepEqual(x.native, {starts: 0, ends: 0, backgroundStarts: 0, backgroundEnds: 0}, 'Widget selections consume native portal/background actions.');
  const point = item.mesh.getWorldPosition(new THREE.Vector3()); xr.aim(x, x.right, point, new THREE.Vector3(0, 0, 1), 6.5); xr.select(x, x.right, 'selectstart'); xr.select(x, x.right, 'selectend'); assert.equal(commands.length, 2, 'World widgets respect the interaction distance.');
  xr.aim(x, x.right, point); const obstacle = xr.wall(x, point.clone().add(new THREE.Vector3(0, 0, 0.35))); xr.advance(x); xr.select(x, x.right, 'selectstart'); xr.select(x, x.right, 'selectend'); assert.equal(commands.length, 2, 'A solid obstacle blocks the widget ray.'); xr.removeWall(x, obstacle);
  x.ctx.vrMode = false; tick(world.education); assert.equal(world.education.desktop.hidden, false); item.html.dispatch('click'); assert.equal(commands.length, 3, 'The desktop button invokes the same machine command.');
  world.editor.active = true; item.html.dispatch('click'); assert.equal(commands.length, 3, 'Editing does not execute a widget command.'); world.editor.active = false;
  const previous = item, disposals = [];
  previous.mesh.geometry.addEventListener('dispose', () => disposals.push('geometry')); previous.mesh.material.addEventListener('dispose', () => disposals.push('material')); previous.texture.addEventListener('dispose', () => disposals.push('texture'));
  x.document.setStudio({widgets: ['text', 'counter', 'indicator', 'progress'].map((kind, index) => Object.assign({}, widgetConfig, {id: 'widget-' + kind, name: kind, kind, position: [index, 2, 4], variable: 'speed'}))}); tick(world.education);
  assert.deepEqual(disposals.sort(), ['geometry', 'material', 'texture']); assert(!x.ctx.raycontrol.states[previous.stateName]);
  assert.equal(world.education.widgets.length, 4); assert(world.education.widgets.every(widget => widget.canvas.text.length && widget.html.textContent));
  const bar = world.education.widgets.find(widget => widget.config.kind === 'progress'); assert(bar.canvas.draws.some(draw => draw[1] === 220 && draw[3] === 30), 'Progress widgets draw a data-driven bar.');
  world.education.disposeWidgets(); assert.equal(world.education.widgets.length, 0); x.visuals.dispose(); x.runtime.stop();
  timers.clear();
  console.log('Education runtime: actual confirmed sorter exits, blocked retry/admission exclusion, event idempotency, versioned/account progress, five world widgets and bilateral production XR/desktop controls passed.');
}
run().catch(error => { timers.clear(); console.error(error); process.exitCode = 1; });
