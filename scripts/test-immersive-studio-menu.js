'use strict';
// Native Three.js meshes and RayControl; only the headset/Canvas/network are
// adapted boundaries. No real account, project database or password is used.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export var rayMaterial;', 'var rayMaterial;');
const Events = new Function(read('src/lib/EventDispatcher.js').replace('export default class EventDispatcher', 'return class EventDispatcher'))();
const RayControl = new Function('THREE', 'EventDispatcher', read('src/lib/RayControl.js').replace('export default class RayControl', 'class RayControl') + '\nreturn RayControl;')(THREE, Events);
const Menu = new Function('THREE', read('src/studio/ImmersiveStudioMenu.js').replace('export default class ImmersiveStudioMenu', 'class ImmersiveStudioMenu') + '\nreturn ImmersiveStudioMenu;')(THREE);
const user = id => ({id, username: id, displayName: 'Usuario ' + id, permissions: {editor: true, manageUsers: id === 'admin'}, preferences: {handedness: 'right', locomotion: 'smooth'}});
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function harness() {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(65, 1, .05, 50); camera.position.set(0, 1.65, 1); scene.add(camera);
  const canvases = [], document = {createElement(tag) { assert.equal(tag, 'canvas', 'XR menu creates canvases, never desktop forms or overlays.');
    const canvas = {width: 0, height: 0, text: []}, drawing = {fillRect(x, y, width, height) { if (!x && !y && width === canvas.width && height === canvas.height) canvas.text = []; }, fillText(value) { canvas.text.push(String(value)); }, strokeRect() {}};
    canvas.getContext = () => drawing; canvases.push(canvas); return canvas;
  }};
  const model = new THREE.Group(), beam = new THREE.Mesh(new THREE.BoxBufferGeometry(.001, .001, 1), new THREE.MeshBasicMaterial()); beam.name = 'beam'; model.add(beam);
  const session = {visibilityState: 'visible'}, calls = [], writes = [], applications = [], xr = {isPresenting: false, getSession: () => session};
  const ctx = {scene, camera, cameraRig: scene, vrMode: true, document, renderer: {xr}, assets: {teleport_model: {scene: model}, beam_tex: new THREE.Texture()}, shaders: {basic_vert: '', beam_frag: ''}, handedness: 'right'};
  ctx.raycontrol = new RayControl(ctx, 'right');
  const controls = ['left', 'right'].map(handedness => {
    const controller = new THREE.Group(); scene.add(controller); const source = {handedness, gamepad: {mapping: 'xr-standard', buttons: Array.from({length: 6}, () => ({pressed: false, value: 0})), hapticActuators: [{pulse() { calls.push('pulse:' + handedness); return Promise.resolve(true); }}]}};
    const data = ctx.raycontrol.addController(controller, source); return {controller, source, data};
  });
  const publicScenes = [{id: 'public-a', name: 'L rectangular', roomId: 'hall'}, {id: 'public-b', name: 'Clasificación', roomId: 'sound'}];
  const project = {id: 'project-a', name: 'Proyecto de prueba', revision: 1, access: {canEdit: true}, document: {studio: {scenes: [{id: 'hall', name: 'Nivel A'}, {id: 'sound', name: 'Nivel B'}]}}};
  const editor = {ctx, dirty: false, hooks: {clearKeyboard() { calls.push('clearKeyboard'); }}, industrialAudio: {volume: .7, muted: false, setMuted(value) { this.muted = value; }, setVolume(value) { this.volume = value; }, activate: async () => true},
    async applyServerProject(value, settings) { applications.push({project: value, settings}); },
    projectClient: {async request(method, route) { calls.push(route); if (route === '/public/scenes') return {scenes: publicScenes}; if (route === '/library/scenes') return {scenes: Array.from({length: 12}, (_, i) => ({id: 'library-' + i, name: 'Ejemplo ' + i, collection: 'Catálogo', roomId: 'hall'}))}; if (route.startsWith('/public/scenes/') || route.startsWith('/library/scenes/')) return {project: {id: 'view-' + route, document: {}, access: {canEdit: false}}}; throw new Error('Unexpected route ' + route); }, async listProjects() { return [project]; }, async getProject() { return project; }}
  };
  const client = {user: null, async login(username, password) { writes.push({kind: 'login', username, password}); this.user = user(username); }, async register(username, password, displayName, code) { writes.push({kind: 'register', username, password, displayName, code}); this.user = user(username); }, async me() { return {user: this.user}; }, async updateProfile(value) { writes.push(value); }, async classroom() { return {groups: [{name: 'Grupo A', assignments: [{id: 'assignment-a', title: 'Práctica A', evaluation: {score: 90}}]}]}; }, async request() { return {users: [{id: 'a', displayName: 'Nombre', username: 'nombre', role: 'creator', quota: {projects: 1, usedBytes: 1024}}]}; }};
  const studio = {ctx, editor, client, education: {missions: () => [], getProgress: () => ({status: 'active'})}, beforeImmersiveMenuOpen() { calls.push('releaseHeld'); }, async authenticated(options) { calls.push({authenticated: options}); menu.identityChanged(); }, async logout() { client.user = null; menu.identityChanged(); }, applyPreferences(preferences) { Object.assign(ctx, {handedness: preferences.handedness, studioLocomotion: preferences.locomotion}); }};
  const menu = new Menu(studio); scene.updateMatrixWorld(true);
  return {ctx, scene, camera, controls, menu, client, studio, editor, calls, canvases, writes, applications, session, project};
}
function hit(menu, region, object = menu.panel) { return {object, distance: 1, uv: new THREE.Vector2((region.x + region.width / 2) / 1024, 1 - (region.y + region.height / 2) / 960)}; }
function press(f, key, index = 1) {
  f.menu.tick(.016); const region = f.menu.regions.find(value => value.key === key); assert(region, 'Missing interactive region ' + key); f.menu.press(hit(f.menu, region), f.controls[index].controller); f.menu.release(f.controls[index].controller); f.menu.tick(.016); return region;
}
function aim(f, controller, mesh, u = .5, v = .5) {
  mesh.updateWorldMatrix(true, false); const size = mesh.geometry.parameters, point = mesh.localToWorld(new THREE.Vector3((u - .5) * size.width, (v - .5) * size.height, 0));
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.getWorldQuaternion(new THREE.Quaternion())); controller.position.copy(point).addScaledVector(normal, .6);
  controller.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(controller.position, point, new THREE.Vector3(0, 1, 0))); f.scene.updateMatrixWorld(true);
}
function toggleMenu(f, index = 1) {
  const pad = f.controls[index].data.inputSource.gamepad;
  pad.mapping = 'xr-standard';
  pad.buttons[4] = {pressed: false, value: 0}; f.menu.tick(.016);
  pad.buttons[4] = {pressed: true, value: 1}; f.menu.tick(.016);
  pad.buttons[4] = {pressed: false, value: 0}; f.menu.tick(.016);
}
async function run() {
  const f = harness(), {menu, controls, ctx} = f;
  assert.equal(f.canvases.length, 0); menu.setVR(true); menu.tick(.016);
  assert.equal(menu.opened, false); assert.equal(Boolean(ctx.studioMenuOpen), false); assert.equal(menu.group, undefined); assert.equal(f.canvases.length, 0, 'Entering VR creates no floating label, panel or GPU canvas.');
  f.camera.position.x += .2; menu.tick(.016); assert.equal(f.canvases.length, 0, 'Head movement does not create any menu UI.');
  toggleMenu(f, 0);
  assert.equal(menu.opened, true); assert.equal(ctx.studioMenuOpen, true); assert.equal(f.canvases.length, 1); assert.equal(menu.canvas.width, 1024); assert.equal(menu.canvas.height, 960);
  assert.equal(menu.group.children.length, 1, 'The panel is the only menu object; no launcher exists.');
  assert(menu.state.consumeSelect && menu.state.captureSelect && menu.state.xrMenu && menu.state.vrOnly); assert.equal(menu.state.controller, 'both');
  assert.equal(menu.panel.parent, menu.group); assert(menu.group.parent === f.scene); assert.equal(menu.panel.userData.editorId, undefined); assert.equal(menu.texture.generateMipmaps, false); assert.equal(menu.panel.material.depthTest, false);
  assert(Math.abs(menu.panel.position.y - (f.camera.position.y - .08)) < 1e-8);
  const stationary = menu.panel.position.clone(); f.camera.position.x += .2; menu.tick(.016); assert(menu.panel.position.equals(stationary), 'Open panel stays fixed in world space, without chasing the user\'s head.');
  press(f, 'account', 0); press(f, 'field:username', 1); press(f, 'key:1:0', 0); assert.equal(menu.fields.username, 'q');
  press(f, 'field:password', 0); press(f, 'key:1:0', 1); assert.equal(menu.fields.password, 'q'); assert(menu.canvas.text.includes('•'), 'The password field draws a mask; individual characters also occur on the keyboard.');
  press(f, 'key:shift'); press(f, 'key:1:1'); assert.equal(menu.fields.password, 'qW'); press(f, 'key:symbols'); press(f, 'key:0:0'); assert.equal(menu.fields.password, 'qW!');
  press(f, 'key:delete'); assert.equal(menu.fields.password, 'qW'); press(f, 'key:clear'); assert.equal(menu.fields.password, '');
  menu.fields.username = 'demo'; menu.fields.password = 'fixture-secret-123'; menu.dirty = true; menu.tick(.016);
  assert(!menu.canvas.text.some(value => value.includes('fixture-secret-123')));
  await menu.authenticate(); assert.equal(f.writes[0].username, 'demo'); assert.equal(f.writes[0].password, 'fixture-secret-123'); assert.equal(menu.fields.password, ''); assert.equal(menu.fields.code, ''); assert.equal(menu.page, 'home'); assert(f.calls.some(value => value && value.authenticated && value.authenticated.immersive));
  menu.tick(.016); assert(menu.regions.some(region => region.key === 'progress'), 'Authenticated users can open their progress from the VR home page.');
  menu.navigate('scenes'); await flush(); menu.tick(.016); assert.equal(menu.items.length, 14); assert.equal(menu.regions.filter(value => value.key.startsWith('item:')).length, 6); press(f, 'next'); assert.equal(menu.listPage, 1);
  menu.navigate('projects'); await flush(); menu.tick(.016); await menu.chooseItem(menu.items[0]); assert.equal(menu.page, 'projectScenes'); assert.equal(menu.items.length, 2); assert.equal(menu.privateProject.id, f.project.id);
  await menu.chooseItem(menu.items[1]); assert.equal(f.applications[0].settings.roomId, 'sound'); assert.equal(menu.opened, false); assert.equal(menu.privateProject, null);
  menu.open('settings'); menu.tick(.016); press(f, 'volume-down'); assert(Math.abs(f.editor.industrialAudio.volume - .6) < 1e-8); await menu.setPreferences({locomotion: 'teleport'}); assert.equal(ctx.studioLocomotion, 'teleport');
  let clarity='sharp';ctx.graphics={getXRClarity:()=>clarity,setXRClarity:value=>{clarity=value;}};const profileWrites=f.writes.length;menu.dirty=true;menu.tick(.016);press(f,'xr-clarity');assert.equal(clarity,'balanced');menu.tick(.016);press(f,'xr-clarity');assert.equal(clarity,'sharp');assert.equal(f.writes.length,profileWrites,'The in-headset clarity control stays a local device preference.');
  menu.open('account'); menu.fields.password = 'discard-me'; menu.close(); assert.equal(menu.fields.password, ''); assert(!menu.canvas.text.some(value => value.includes('discard-me')));
  menu.tick(.016); assert.equal(menu.group.visible, false); assert.equal(menu.panel.visible, false); assert(!ctx.raycontrol.currentStates.includes(menu.state), 'A closed menu has no active ray target.');
  toggleMenu(f, 1); assert(menu.opened, 'The right A button can reopen the menu without any floating launcher.');
  // Both controllers operate actual panel UVs through RayControl. An unrelated
  // machine closer to the controller is excluded by the modal owner gate.
  const blocker = new THREE.Mesh(new THREE.PlaneBufferGeometry(4, 4), new THREE.MeshBasicMaterial({side: THREE.DoubleSide})); f.scene.add(blocker); blocker.position.copy(menu.panel.position).add(new THREE.Vector3(0, 0, .25)); blocker.quaternion.copy(menu.panel.quaternion);
  let machinePresses = 0, nativePresses = 0; ctx.raycontrol.addState('test-machine', {controller: 'both', colliderMesh: blocker, onSelectStart: () => machinePresses++}, true);
  ctx.raycontrol.addState('test-native', {controller: 'both', raycaster: false, onSelectStart: () => nativePresses++}, true);
  for (const [i, target] of controls.entries()) {
    menu.navigate('controls'); menu.tick(.016); const region = menu.regions.find(value => value.key === 'recenter');
    aim(f, target.controller, menu.panel, (region.x + region.width / 2) / 1024, 1 - (region.y + region.height / 2) / 960); ctx.raycontrol.execute(ctx, .016, 2 + i);
    assert(target.data.currentIntersection && target.data.currentIntersection.state === menu.state, 'Real menu hit for ' + target.source.handedness);
    ctx.raycontrol.onSelectStart({target: target.controller}); ctx.raycontrol.onSelectEnd({target: target.controller});
  }
  assert.equal(machinePresses, 0); assert.equal(nativePresses, 0);
  // A held face button when connecting is seeded, never treated as a new tap.
  menu.close(); const replacement = {handedness: 'left', gamepad: {mapping: 'xr-standard', buttons: Array.from({length: 6}, (_, i) => ({pressed: i === 4, value: i === 4 ? 1 : 0}))}};
  controls[0].data.inputSource = replacement; menu.tick(.016); assert(!menu.opened); replacement.gamepad.buttons[4] = {pressed: false, value: 0}; menu.tick(.016); replacement.gamepad.buttons[4] = {pressed: true, value: 1}; menu.tick(.016); assert(menu.opened); menu.tick(.016); assert(menu.opened, 'Holding X does not repeat-toggle.');
  replacement.gamepad.buttons[4] = {pressed: false, value: 0}; menu.tick(.016); replacement.gamepad.buttons[4] = {pressed: true, value: 1}; menu.tick(.016); assert(!menu.opened);
  // Reserved menu buttons and arbitrary unmapped button arrays are not bound.
  controls[1].source.gamepad.buttons[5] = {pressed: true, value: 1}; menu.tick(.016); assert(!menu.opened);
  controls[1].source.gamepad.mapping = ''; controls[1].source.gamepad.buttons[4] = {pressed: true, value: 1}; menu.tick(.016); assert(!menu.opened);
  menu.open(); menu.fields.password = 'hidden-secret'; f.session.visibilityState = 'visible-blurred'; menu.tick(.016); assert(!menu.opened); assert.equal(menu.fields.password, ''); assert.equal(menu.group.visible, false); f.session.visibilityState = 'visible'; menu.tick(.016); assert(!menu.opened, 'Returning from a system overlay does not reopen the menu.');
  menu.open(); menu.fields.password = 'lost-controller'; ctx.raycontrol.dispatchEvent('controllerDisconnected', controls[0].data); assert.equal(menu.fields.password, '');
  // Stale catalogue responses cannot leak another account's projects.
  menu.open('home'); const pending = deferred(); f.editor.projectClient.listProjects = () => pending.promise; menu.navigate('projects'); f.client.user = user('other'); menu.identityChanged(); pending.resolve([{id: 'old-user-project', name: 'Old private data'}]); await flush(); assert.equal(menu.items.length, 0);
  let geometries = 0, materials = 0, textures = 0; [menu.surface].forEach(value => { value.mesh.geometry.addEventListener('dispose', () => geometries++); value.mesh.material.addEventListener('dispose', () => materials++); value.texture.addEventListener('dispose', () => textures++); });
  const stateName = menu.stateName; menu.setVR(false); assert.equal(ctx.raycontrol.states[stateName], undefined); assert.equal(ctx.studioMenuOpen, false); assert.equal(menu.group, null); assert.equal(geometries, 1); assert.equal(materials, 1); assert.equal(textures, 1); assert.equal(f.canvases[0].width, 1);
  menu.setVR(true); menu.tick(.016); assert(!menu.opened); assert.equal(f.canvases.length, 1); toggleMenu(f); assert(menu.opened); assert.equal(f.canvases.length, 2); menu.dispose(); assert.equal(menu.disposed, true); assert.equal(menu.group, null); assert(!ctx.raycontrol.hasEventListener('controllerDisconnected', menu.controllerDisconnected));
  const head = harness(); head.ctx.renderer.xr.isPresenting = true; const arrayCamera = new THREE.ArrayCamera(); arrayCamera.matrixWorld.makeTranslation(5, 2, -4); head.ctx.renderer.xr.getCamera = () => arrayCamera;
  head.menu.setVR(true); head.menu.tick(.016); toggleMenu(head); assert(Math.abs(head.menu.panel.position.x - 5) < 1e-8); assert(Math.abs(head.menu.panel.position.y - 1.92) < 1e-8, 'Reads r112 XR matrixWorld without recomposing its stale local pose.'); head.menu.dispose();
  const registration = harness(); registration.menu.setVR(true); registration.menu.tick(.016); registration.menu.open('register'); registration.menu.tick(.016);
  assert(registration.menu.regions.some(region => region.key === 'field:code'));
  Object.assign(registration.menu.fields, {username: 'nuevo', password: 'registration-fixture-123', code: 'INVITE-FIXTURE'});
  await registration.menu.authenticate(true); assert.equal(registration.writes[0].kind, 'register'); assert.equal(registration.writes[0].code, 'INVITE-FIXTURE'); assert.equal(registration.menu.fields.password, ''); assert.equal(registration.menu.fields.code, ''); registration.menu.dispose();
  const rejected = harness(); rejected.menu.setVR(true); rejected.menu.tick(.016); rejected.menu.open('account'); rejected.client.login = async () => { throw new Error('Usuario o contraseña incorrectos.'); };
  Object.assign(rejected.menu.fields, {username: 'incorrecto', password: 'rejected-fixture-secret'}); await rejected.menu.authenticate(); rejected.menu.tick(.016);
  assert.equal(rejected.menu.busy, false); assert(rejected.menu.error.includes('incorrectos')); assert.equal(rejected.menu.fields.password, ''); assert(!rejected.menu.canvas.text.some(text => text.includes('rejected-fixture-secret'))); rejected.menu.dispose();
  const occupiedHand = harness(); occupiedHand.menu.setVR(true); occupiedHand.menu.tick(.016); occupiedHand.menu.close(); occupiedHand.menu.tick(.016);
  occupiedHand.controls[0].data.enabled = false;
  occupiedHand.studio.beforeImmersiveMenuOpen = () => { occupiedHand.calls.push('releaseOccupiedHand'); occupiedHand.controls[0].data.enabled = true; };
  occupiedHand.controls[0].source.gamepad.buttons[4] = {pressed: true, value: 1}; occupiedHand.menu.tick(.016);
  assert(occupiedHand.menu.opened, 'A physical X/A press opens the menu even when a held native stick suspended its target ray.');
  assert.equal(occupiedHand.controls[0].data.enabled, true, 'The opening hook releases the held item and restores the hand ray.'); assert(occupiedHand.calls.includes('releaseOccupiedHand')); occupiedHand.menu.dispose();
  const shortcut = harness(); shortcut.menu.setVR(true); toggleMenu(shortcut); press(shortcut, 'account');
  assert.equal(shortcut.menu.keyboardField, 'username', 'Opening sign-in immediately exposes the VR keyboard.');
  shortcut.menu.fields.username = 'demo'; press(shortcut, 'key:done'); assert.equal(shortcut.menu.keyboardField, 'password');
  shortcut.menu.fields.password = 'shortcut-fixture'; press(shortcut, 'key:done'); await flush();
  assert.equal(shortcut.writes.length, 1); assert.equal(shortcut.client.user.id, 'demo'); assert.equal(shortcut.menu.fields.password, ''); shortcut.menu.dispose();
  const retry = harness(); retry.editor.staticPublic = true; retry.menu.setVR(true); toggleMenu(retry); press(retry, 'account');
  assert(!retry.menu.regions.some(region => region.key.startsWith('field:')));
  retry.studio.reconnectAccountService = async () => { retry.editor.staticPublic = false; };
  press(retry, 'reconnect-account'); await flush(); retry.menu.tick(.016);
  assert.equal(retry.menu.page, 'account'); assert.equal(retry.menu.keyboardField, 'username'); assert(retry.menu.regions.some(region => region.key === 'field:password')); assert.equal(retry.writes.length, 0); retry.menu.dispose();
  const late = harness(); late.editor.staticPublic = true; late.menu.setVR(true); toggleMenu(late); press(late, 'account');
  const probe = deferred(); late.studio.reconnectAccountService = () => probe.promise;
  press(late, 'reconnect-account'); late.menu.close(); probe.resolve(); await flush(); late.menu.tick(.016);
  assert.equal(late.menu.opened, false, 'A delayed server probe cannot reopen the menu after closing.'); assert.equal(late.menu.keyboardField, ''); late.menu.dispose();
  const delayedLogout = harness(); delayedLogout.client.user = user('demo'); delayedLogout.menu.setVR(true); toggleMenu(delayedLogout);
  const logoutReply = deferred(); delayedLogout.studio.logout = async () => { await logoutReply.promise; delayedLogout.client.user = null; delayedLogout.menu.identityChanged(); };
  press(delayedLogout, 'logout'); delayedLogout.menu.close(); logoutReply.resolve(); await flush(); delayedLogout.menu.tick(.016);
  assert.equal(delayedLogout.menu.opened, false, 'Finishing logout never reopens a menu the user closed.'); assert.equal(delayedLogout.menu.group.visible, false); delayedLogout.menu.dispose();
  console.log('Immersive Studio menu: native bounded canvases, both real controller rays/UVs, modal machine isolation, masked XR keyboard, login, authorized paginated scenes/projects, face-button edges, r112 head pose, identity/visibility/disconnect cleanup and resource disposal passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
