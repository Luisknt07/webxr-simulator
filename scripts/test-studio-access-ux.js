'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const code = fs.readFileSync(path.join(__dirname, '../src/studio/StudioExperience.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class StudioExperience', 'return class StudioExperience');
class Element {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.listeners = {}; this.attributes = {}; this.classList = {add() {}}; this.isConnected = true; }
  set textContent(value) { this.text = value; this.children = []; } get textContent() { return (this.text || '') + this.children.map(value => value.textContent).join(' '); }
  appendChild(value) { this.children.push(value); value.parent = this; return value; } setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, callback) { this.listeners[type] = callback; } focus() {} remove() {} querySelectorAll() { return []; }
}
const document = {createElement: tag => new Element(tag), createTextNode: text => Object.assign(new Element('text'), {textContent: text})};
let navigated; const location = new URL('https://localhost:8080/'); location.assign = value => { navigated = new URL(value); };
class ImmersiveMenuMock { open(page) { this.page = page; } identityChanged() { this.identities = (this.identities || 0) + 1; } setVR(active) { this.active = active; } }
class AdministrationMock { close() { this.closed = true; } async openModal() { this.modalOpened = true; } }
const Experience = new Function('THREE', 'document', 'window', 'localStorage', 'avatarBadge', 'DEFAULT_AVATAR', 'AdminWorkspace', 'ImmersiveStudioMenu', code)(THREE, document, {location}, {getItem() { return null; }}, () => new Element('avatar'), {}, AdministrationMock, ImmersiveMenuMock);
const walk = root => [root].concat(root.children.flatMap(walk));
const labels = root => walk(root).filter(value => value.tag === 'button').map(value => value.textContent);
const account = {id: 'u1', displayName: 'Ana', avatar: {}, permissions: {editor: true, manageUsers: true}};
function fixture(user = null) {
  const experience = Object.create(Experience.prototype), content = new Element(), ctx = {room: 0};
  const editor = {ctx, document: {rooms: new Map([['hall', {root: {visible: true}}]]), studio: {}}, currentProject: {id: 'p1', revision: 1}, roomId: 'hall',
    hooks: {clearKeyboard() {}, unlock() {}, async gotoRoom() {}}, projectSync: {stop() { editor.stopped = true; }}, clearObjectClipboard() { editor.clipboardCleared = true; },
    projectTabs: {syncIdentity() { editor.tabsCleared = true; }}, leave() { this.active = false; }};
  Object.assign(experience, {editor, ctx, content, client: {user, configured: true}, accountButton: new Element('button'), avatars: new Map(),
    education: {accountChanged() {}, async restoreProgress() {}}, tools: {refreshLabels() {}}, message() {}, close() {}, open(page) { experience.lastPage = page; }, connection: {stop() {}},
    guard(action) { this.pending = Promise.resolve().then(action); return this.pending; }});
  experience.administration = new AdministrationMock(); experience.immersiveMenu = new ImmersiveMenuMock();
  return experience;
}
async function run() {
  const guest = fixture(); guest.personal(); const guestLabels = labels(guest.content);
  assert.equal(guestLabels.length, 4); for (const text of ['Escenarios', 'Ajustes', 'Controles y ayuda', 'Iniciar sesión']) assert(guestLabels.some(value => value.includes(text)));
  assert(!guestLabels.some(value => /avatar|multiusuario|editor|Nuevo escenario|Mis proyectos/.test(value)));
  const signed = fixture(account); signed.personal(); const signedLabels = labels(signed.content);
  assert(signedLabels.some(value => value.includes('Mis proyectos'))); assert(signedLabels.some(value => value.includes('Administración'))); assert(signedLabels.some(value => value.includes('Mis prácticas')));
  assert(!signedLabels.some(value => /Abrir editor|Nuevo escenario/.test(value))); assert.match(signed.content.textContent, /20 MiB/); assert.match(signed.content.textContent, /30 días/);
  signed.editor.currentProject = {id: 'public-lesson', access: {role: 'public', canEdit: false}}; signed.openEditor(); assert.equal(navigated.pathname, '/editor'); assert.equal(navigated.searchParams.get('project'), null); assert.equal(navigated.searchParams.get('room'), null);
  signed.editor.currentProject = {id: 'p1', access: {canEdit: true}}; signed.openEditor(); assert.equal(navigated.searchParams.get('project'), 'p1');
  let gallery = 0; guest.editor.accessView = {enabled: true, async gallery(host) { assert.strictEqual(host, guest.content); gallery++; }}; await guest.scenes(); assert.equal(gallery, 1);
  const fallback = fixture(); await fallback.scenes(); assert.match(fallback.content.textContent, /requiere el servidor/);
  const admin = fixture(account); await admin.users(); assert.equal(admin.administration.modalOpened, true, 'Administration opens the independent wide modal, not the visitor drawer.');
  admin.administration.modalOpened = false; await Experience.prototype.open.call(admin, 'users'); assert.equal(admin.administration.modalOpened, true);
  const immersive = fixture(); immersive.ctx.vrMode = true; Experience.prototype.open.call(immersive, 'account'); assert.equal(immersive.immersiveMenu.page, undefined, 'Closed VR menus wait for the controller shortcut.'); assert.equal(immersive.administration.closed, true);
  immersive.immersiveMenu.opened = true; Experience.prototype.open.call(immersive, 'account'); assert.equal(immersive.immersiveMenu.page, 'account');
  Experience.prototype.open.call(immersive, 'personal'); assert.equal(immersive.immersiveMenu.page, 'home', 'VR menu actions never open desktop DOM panels.');
  const classroom = fixture(account); classroom.client.classroom = async () => ({groups: [{name: 'Grupo A', description: 'Prácticas', assignments: [{title: 'Clasificación', instructions: 'Configura la línea', evaluation: {score: 91, feedback: 'Bien'}, templateId: 'lab-sorting'}]}]}); await classroom.classroom(); assert.match(classroom.content.textContent, /91 \/ 100/); assert.match(classroom.content.textContent, /Bien/);
  const stale = fixture(account); stale.client.classroom = async () => { stale.content = new Element(); return {groups: [{name: 'No mostrar', assignments: []}]}; }; const previous = stale.content; await stale.classroom(); assert.equal(previous.children.length, 0);
  const login = fixture(account); let ownLoaded = false, authOptions; login.editor.accessView = {enabled: true, user: null, async accountChanged(user, options) { assert.equal(this.user, null); this.user = user; ownLoaded = true; authOptions = options; }}; await login.authenticated({immersive: true}); assert(ownLoaded); assert.equal(login.editor.accessView.user.id, 'u1'); assert.equal(authOptions.preserveWorld, true); assert.equal(login.immersiveMenu.identities, 1);
  const logout = fixture(account); let finishLogout, publicReset = 0; logout.client.logout = () => new Promise(resolve => { finishLogout = resolve; }); logout.editor.accessView = {enabled: true, user: account, async accountChanged(user) { assert.equal(user, null); publicReset++; this.user = user; }};
  const pending = logout.logout(); assert.equal(logout.client.user, null); assert.equal(logout.editor.document.rooms.get('hall').root.visible, false); assert(logout.editor.stopped); assert(logout.editor.clipboardCleared); assert(logout.editor.tabsCleared); assert.equal(publicReset, 1); finishLogout(); await pending;
  const startup = fixture(account); startup.identity = () => {}; startup.applySpawn = () => {}; startup.editor.initialIdentity = {user: account, configured: true, capabilities: {privateProjects: true}}; startup.client.me = async () => { throw new Error('Duplicate identity request'); }; await startup.initialize(); assert.equal(startup.online, true);
  assert.match(code, /this\.controls\.hidden = true/, 'Controls stay inside the menu.');
  console.log('Studio access UX: guest menu, own project routes, public gallery/fallback, admin delegation, own assignments/grades, immediate logout privacy and initial identity reuse passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
