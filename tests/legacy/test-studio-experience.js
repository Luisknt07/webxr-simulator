const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const code = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-studio-experience.js"), '../src/studio/StudioExperience.js')), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export default class StudioExperience', 'class StudioExperience');
const captures = [], restores = [], calls = [];
const location = new URL('https://localhost:8080/'); location.assign = url => calls.push(['navigate', url]);
const createAvatar = config => { const avatar = new THREE.Group(); avatar.userData.dispose = () => { avatar.userData.disposed = true; }; return avatar; };
class ImmersiveMenuMock { constructor(studio) { this.studio = studio; } open(page) { calls.push(['immersiveOpen', page]); } close() { calls.push(['immersiveClose']); } setVR(active) { calls.push(['immersiveVR', active]); } identityChanged() { calls.push(['immersiveIdentity']); } }
class AdministrationMock { close() { calls.push(['administrationClose']); } }
const Experience = new Function('THREE', 'StudioClient', 'StudioRoomConnection', 'StudioTools', 'EducationRuntime', 'SharedGrabs', 'RemotePresentation', 'createAvatar', 'avatarBadge', 'DEFAULT_AVATAR', 'captureSimulation', 'restoreSimulation', 'window', 'AdminWorkspace', 'ImmersiveStudioMenu', 'document',
  code + '\nreturn StudioExperience;')(THREE, class {}, class {}, class {}, class {}, class {}, class {}, createAvatar, () => ({}), {},
  (runtime, options) => { captures.push(options); if (runtime.held && !options.allowHeld) throw new Error('Suelta las cargas'); return {version: 1, time: runtime.time}; },
  (runtime, state, options) => { restores.push({runtime, state, options}); }, {location}, AdministrationMock, ImmersiveMenuMock, {querySelectorAll() { return []; }});

function setup() {
  const experience = Object.create(Experience.prototype), cameraRig = new THREE.Group(), camera = new THREE.PerspectiveCamera();
  cameraRig.add(camera);
  const ctx = {room: 0, cameraRig, camera};
  const editor = {ctx, active: false, dirty: false, currentProject: {id: 'p1', revision: 3, name: 'Línea'}, roomId: 'hall', root: new THREE.Group(),
    simulationPaused: false, simulation: {time: 3, command(id, action, value, scope) { calls.push(['command', id, action, value, scope]); if (action === 'invalid') throw new Error('Mando inválido'); return true; }, pickupProduct() { calls.push(['pickup']); return true; }},
    projectClient: {async getProject(id) { calls.push(['getProject', id]); return {id, revision: 3}; }},
    async applyServerProject(project) { calls.push(['applyProject', project.id]); },
    async keepCurrentProject() { calls.push(['keepProject']); }, leave() { this.active = false; calls.push(['leaveEditor']); },
    startRuntime() { calls.push(['restartRuntime']); },
    hooks: {async gotoRoom(index) { ctx.room = index; calls.push(['gotoRoom', index]); }}};
  Object.assign(experience, {editor, ctx, client: {configured: true, user: {id: 'u1', permissions: {editor: true}}},
    avatars: new Map(), appliedEvents: new Set(), roomRevision: 0, messages: [],
    message(message) { this.messages.push(message); }, open(page) { calls.push(['open', page]); }, close() {}, renderParticipants() {},
    connection: {async action(action) { calls.push(['roomAction', action]); return {accepted: true}; }, async save(state) { calls.push(['saveRoom', state]); return {revision: 1}; }} });
  experience.immersiveMenu = new ImmersiveMenuMock(experience); experience.administration = new AdministrationMock();
  return experience;
}

async function run() {
  const home = setup(); location.href = 'https://localhost:8080/editor?libraryScene=vr-robot-turn'; home.editor.dirty = true;
  home.editor.importingFiles = true; home.editor.projectTabs = {hasUnsaved: () => true};
  home.goHome(); const homeNavigation = calls.pop(); assert.deepEqual(homeNavigation, ['navigate', 'https://localhost:8080/']);
  assert(home.editor.dirty && home.editor.importingFiles && home.editor.projectTabs.hasUnsaved(), 'Returning home must preserve every existing beforeunload condition instead of discarding or silently saving edits.');
  const editorSource = fs.readFileSync(path.join(__dirname, '../../packages/tools/editor/src/SceneEditor.js'), 'utf8');
  const unloadBody = editorSource.split("window.addEventListener('beforeunload', event => {")[1].split('    });')[0];
  const beforeUnload = new Function('event', unloadBody);
  for (const state of [{dirty:true}, {importingFiles:true}, {projectTabs:{hasUnsaved:()=>true}}]) {
    let blocked = false; const event = {preventDefault() { blocked = true; }}; beforeUnload.call(state, event);
    assert(blocked && event.returnValue === '', 'The existing native confirmation must still protect edits, pending imports and other tabs when navigating home.');
  }
  let cleanBlocked = false; beforeUnload.call({dirty:false, importingFiles:false, projectTabs:{hasUnsaved:()=>false}}, {preventDefault() { cleanBlocked = true; }}); assert.equal(cleanBlocked, false);
  const flight = setup(); let cleared = 0, resetLook = 0; const attributes = {};
  flight.editor.hooks.clearKeyboard = () => cleared++; flight.ctx.desktopLook = {reset() { resetLook++; }};
  flight.flightButton = {setAttribute(key, value) { attributes[key] = value; }}; flight.ctx.studioLocomotion = 'teleport';
  const flightPosition = flight.ctx.camera.position.clone(); flight.setDesktopFlight(true);
  assert.equal(flight.ctx.desktopFlight, true); assert.equal(flight.ctx.studioLocomotion, 'teleport'); assert.equal(attributes['aria-pressed'], 'true'); assert.equal(cleared, 1); assert.equal(resetLook, 1);
  flight.setDesktopFlight(false); assert.equal(flight.ctx.desktopFlight, false); assert(flight.ctx.camera.position.equals(flightPosition), 'Switching drone mode never teleports the visitor.');
  flight.ctx.vrMode = true; flight.setDesktopFlight(true); assert.equal(flight.ctx.desktopFlight, false, 'Desktop mode controls do not change XR locomotion.');
  // Studio is already attached when the project library opens another level.
  // Its progress/ownership wrapper must forward explicit destination options.
  const forwarded = [], sequence = [];
  const boundEditor = {currentProject: {id: 'original'}, async applyServerProject(...args) { sequence.push('apply'); forwarded.push(args); return 'opened'; }};
  const boundExperience = {education: {pending: new Map(), async saveProgress() { sequence.push('saveProgress'); }, async restoreProgress() { sequence.push('restoreProgress'); }},
    client: {user: null}, tools: {refreshLabels() { sequence.push('refreshLabels'); }}};
  const wrapperStart = code.indexOf('    const applyProject = editor.applyServerProject.bind(editor);');
  const wrapperEnd = code.indexOf('    this.ready = this.initialize();', wrapperStart);
  new Function('editor', code.slice(wrapperStart, wrapperEnd)).call(boundExperience, boundEditor);
  const target = {id: 'lab'}, options = {roomId: 'sound'};
  assert.equal(await boundEditor.applyServerProject(target, options), 'opened');
  assert.strictEqual(forwarded[0][0], target); assert.strictEqual(forwarded[0][1], options);
  assert.deepEqual(sequence, ['saveProgress', 'apply', 'refreshLabels', 'restoreProgress']);
  boundExperience.client.user = {id: 'user'}; boundExperience.education.pending.set('unsaved', {});
  await assert.rejects(() => boundEditor.applyServerProject({id: 'another'}, {roomId: 'hall'}), /progreso/);
  assert.equal(forwarded.length, 1, 'Pending owned progress still blocks changing projects.');
  for (const [query, initialIndex, expectedTarget, expectedInvitation] of [['room=hall', 0, null, null], ['room=sound', 1, null, null], ['', 0, 1, null], ['room=ABC123', 0, 1, 'ABC123']]) {
    const startup = setup(), transitions = [], invitations = [];
    startup.ctx.room = initialIndex; startup.editor.editorEnabled = false;
    startup.editor.document = {studio: {startRoomId: 'sound'}};
    startup.editor.hooks.gotoRoom = async index => { transitions.push(index); startup.ctx.room = index; };
    startup.client.me = async () => {}; startup.identity = () => {}; startup.applySpawn = () => {};
    startup.tools = {refreshLabels() {}}; startup.education = {async restoreProgress() {}};
    startup.joinRoom = async code => invitations.push(code);
    location.href = 'https://localhost:8080/?project=lab' + (query ? '&' + query : '');
    await startup.initialize();
    assert.deepEqual(transitions, expectedTarget === null ? [] : [expectedTarget], 'Explicit native level links take precedence over the project default.');
    assert.deepEqual(invitations, expectedInvitation ? [expectedInvitation] : [], 'Authenticated native-level navigation must never join a multiplayer room with that level ID.');
  }
  const visitorEditor = setup(); visitorEditor.editor.editorEnabled = false; visitorEditor.editor.roomId = 'sound';
  visitorEditor.openEditor();
  const editorLink = new URL(calls.pop()[1]); assert.equal(editorLink.pathname, '/editor');
  assert.equal(editorLink.searchParams.get('project'), 'p1'); assert.equal(editorLink.searchParams.get('room'), 'sound');
  location.href = 'https://localhost:8080/';
  const spawnCase = setup(), marker = new THREE.Group(); marker.position.set(0, .02, 34);
  marker.rotation.y = .4; spawnCase.ctx.camera.rotation.y = Math.PI;
  spawnCase.editor.document = {studio: {spawns: [{roomId: 'hall', objectId: 'entry'}]}, getObject: () => marker};
  spawnCase.applySpawn();
  assert.deepEqual(spawnCase.ctx.camera.quaternion.toArray(), [0, 0, 0, 1], 'A new level starts facing its spawn direction instead of inheriting a previous portal yaw.');
  assert.deepEqual(spawnCase.ctx.camera.position.toArray(), [0, 1.6, 0]);
  assert(Math.abs(spawnCase.ctx.cameraRig.quaternion.dot(marker.quaternion)) > .999999);
  spawnCase.ctx.vrMode = true; spawnCase.ctx.camera.rotation.set(.1, .2, .3);
  const trackedHead = spawnCase.ctx.camera.quaternion.clone(); spawnCase.applySpawn(true);
  assert.deepEqual(spawnCase.ctx.camera.quaternion.toArray(), trackedHead.toArray(), 'VR spawn never overwrites the tracked headset orientation.');
  const f = setup();
  f.bindSimulation();
  assert.equal(f.editor.simulation.command('belt', 'start', .4, 'line'), true);
  assert.deepEqual(calls.pop(), ['command', 'belt', 'start', .4, 'line']);
  f.room = {id: 'r1', role: 'observer'};
  assert.equal(f.editor.simulation.command('belt', 'start'), false);
  f.room.role = 'participant';
  assert.equal(f.editor.simulation.command('belt', 'start', .2, 'segment'), true);
  assert.deepEqual(calls.pop(), ['roomAction', {type: 'control', objectId: 'belt', action: 'start', value: .2, scope: 'segment'}]);
  f.room.role = 'host';
  await f.applyEvents([{sequence: 1, type: 'action', payload: {type: 'control', objectId: 'belt', action: 'invalid'}},
    {sequence: 2, type: 'action', payload: {type: 'control', objectId: 'belt', action: 'start', value: .4, scope: 'line'}}]);
  assert.equal(f.applyingNetwork, false);
  assert(f.appliedEvents.has(1), 'rejected command is consumed and cannot block the shared action cursor');
  assert.deepEqual(calls.pop(), ['command', 'belt', 'start', .4, 'line']);
  assert.match(f.messages[f.messages.length - 1], /rechazada/);
  const count = calls.length;
  await f.applyEvents([{sequence: 2, type: 'action', payload: {type: 'control', objectId: 'belt', action: 'start'}}]);
  assert.equal(calls.length, count, 'duplicate poll does not execute accepted command twice');
  await f.applyEvents([{sequence: 3, type: 'action', payload: {type: 'simulation', action: 'pause'}}]);
  assert.equal(f.editor.simulationPaused, true);
  await f.applyEvents([{sequence: 4, type: 'action', payload: {type: 'simulation', action: 'reset'}}]);
  assert.equal(f.editor.simulationPaused, false);
  assert.deepEqual(calls.pop(), ['restartRuntime']);

  const g = setup();
  g.editor.simulation.held = true;
  assert.throws(() => g.captureExecution(), /Suelta las cargas/);
  g.room = {id: 'r1', role: 'host'};
  await g.publishRoom();
  assert.equal(captures[captures.length - 1].allowHeld, true, 'shared publication preserves current host-held load pose without blocking');
  assert.equal(captures[captures.length - 1].analyticsHistorySamples, 2, 'Frequent shared publications send only the two newest real analytic points.');
  assert.equal(g.publishing, false);
  g.editor.simulation.held = false; g.captureExecution();
  assert.equal(captures[captures.length - 1].analyticsHistorySamples, undefined, 'Manual sessions and initial room creation keep the complete analytics window.');
  g.editor.active = true;
  assert.throws(() => g.captureExecution(), /Probar/);
  g.editor.active = false; g.editor.dirty = true;
  assert.throws(() => g.captureExecution(), /Guarda primero/);

  const h = setup(); h.room = {id: 'r2', role: 'participant'}; h.roomRevision = 2;
  const update = {id: 'r2', role: 'participant', revision: 3, state: {simulation: {time: 8}}, participants: [
    {id: 'u1', online: true, avatar: {}, pose: {position: [0, 0, 0], quaternion: [0, 0, 0, 1]}},
    {id: 'u2', displayName: 'Invitada', online: true, avatar: {bodyColor: '#335577'}, pose: {position: [1, 2, 3], quaternion: [0, 0, 0, 1]}}]};
  await h.receiveRoom(update);
  assert.deepEqual(restores[restores.length - 1].options, {reuse: true});
  assert.equal(h.editor.simulationPaused, true, 'participant physics clock cannot compete with host authority');
  assert.equal(h.avatars.size, 1);
  assert.deepEqual(h.avatars.get('u2').position.toArray(), [1, 2, 3]);
  const restoreCount = restores.length;
  await h.receiveRoom(update);
  assert.equal(restores.length, restoreCount, 'same snapshot revision does not restore repeatedly');
  update.participants[1].online = false; await h.receiveRoom(update); assert.equal(h.avatars.size, 0);

  const saved = {format: 'hello-studio-execution', version: 1, simulation: {time: 5}, paused: true,
    camera: {position: [3, 1, 2], quaternion: [0, Math.SQRT1_2, 0, Math.SQRT1_2]}};
  const load = setup(); load.editor.dirty = true; load.editor.active = true;
  await load.loadExecution('p1', 3, 'sound', saved);
  assert.deepEqual(load.ctx.cameraRig.position.toArray(), [3, 1, 2]);
  assert.ok(Math.abs(load.ctx.cameraRig.quaternion.y - Math.SQRT1_2) < 1e-12);
  assert.equal(load.ctx.room, 1);
  assert.equal(load.editor.simulationPaused, true);
  assert(calls.some(value => value[0] === 'keepProject'), 'dirty project is preserved before replacing execution context');
  await assert.rejects(load.loadExecution('p1', 2, 'hall', saved), /cambió/);
  load.room = {id: 'shared'};
  await assert.rejects(load.loadExecution('p1', 3, 'hall', saved), /Sal de la sala/);
  const permission = setup(); permission.client.user.permissions.editor = false;
  permission.openEditor(); assert.match(permission.messages[0], /permiso de edición/);
  permission.client.user = null; permission.openEditor(); assert.deepEqual(calls.pop(), ['open', 'account']);
  const immersive = setup(); immersive.ctx.vrMode = true; immersive.editor.projectLibrary = {close() { calls.push(['libraryClose']); }};
  immersive.editor.sceneGuide = {close() { calls.push(['guideClose']); }}; immersive.editor.monitorWidgets = {close() { calls.push(['monitorBindingClose']); }};
  immersive.editor.sceneCreationDialog = {dispose() { calls.push(['creationClose']); }}; immersive.editor.sharePanel = {hidden: false}; immersive.editor.conveyorViewer = {close() { calls.push(['equipmentViewerClose']); }}; immersive.editor.simulationPanel = {toggle(value) { calls.push(['simulationPanel', value]); }};
  const vrStart = calls.length; immersive.onVRChange(true); const vrCalls = calls.slice(vrStart);
  for (const name of ['administrationClose', 'libraryClose', 'guideClose', 'monitorBindingClose', 'creationClose', 'equipmentViewerClose']) assert(vrCalls.some(value => value[0] === name)); assert(immersive.editor.sharePanel.hidden); assert.deepEqual(vrCalls[vrCalls.length - 1], ['immersiveVR', true]);
  immersive.onVRChange(false); assert.deepEqual(calls.pop(), ['immersiveVR', false]);
  const closedMenuStart = calls.length;
  Experience.prototype.open.call(immersive, 'account');
  assert(!calls.slice(closedMenuStart).some(value => value[0] === 'immersiveOpen'), 'Account/network events cannot open a closed VR menu.');
  immersive.immersiveMenu.opened = true; Experience.prototype.open.call(immersive, 'account');
  assert.deepEqual(calls.pop(), ['immersiveOpen', 'account'], 'An already open VR menu may show its login form.');
  immersive.ctx.goto = 8; immersive.ctx.teleport = {active: true, onHoverLeave() { calls.push(['teleportLeave']); }}; immersive.ctx.editorXylophone = {releaseHeld() { calls.push(['releaseStick']); }}; immersive.editor.simulation.onInputModeChange = () => calls.push(['inputModeChanged']);
  immersive.beforeImmersiveMenuOpen(); assert.equal(immersive.ctx.goto, null); assert.equal(immersive.ctx.teleport.active, false); assert(calls.some(value => value[0] === 'inputModeChanged')); assert(calls.some(value => value[0] === 'releaseStick'));
  assert.match(code, /password\.minLength = 12/, 'registration form matches actual password requirements');
  console.log('Studio experiencia: permisos, mandos con ámbito, autoridad, rechazo de acciones, snapshots sin recarga GPU y reanudación contextual OK.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
