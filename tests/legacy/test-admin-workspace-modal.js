const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
let document;
class Element {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; this.listeners = {}; this.dataset = {}; this.className = ''; this.value = ''; this.disabled = false; this.hidden = false; this.classList = {add: value => { this.className += ' ' + value; }, remove: value => { this.className = this.className.split(/\s+/).filter(item => item !== value).join(' '); }}; }
  get isConnected() { return this.rootBody || Boolean(this.parentNode && this.parentNode.isConnected); }
  set textContent(value) { this.text = String(value); this.children.forEach(child => { child.parentNode = null; }); this.children = []; } get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(''); }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, callback) { (this.listeners[type] || (this.listeners[type] = [])).push(callback); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
  focus() { document.activeElement = this; } select() { this.selected = true; }
  getClientRects() { return this.isConnected && !this.hidden ? [{}] : []; }
  querySelectorAll(selector) { const tags = selector.split(',').map(value => value.trim().split(/[\[.#]/)[0].toUpperCase()); return descendants(this).filter(node => node !== this && tags.includes(node.tagName)); }
  click() { if (this.disabled) return; const event = {target: this, preventDefault() {}, stopPropagation() {}}; if (this.onclick) this.onclick(event); (this.listeners.click || []).forEach(callback => callback(event)); }
}
const descendants = node => [node].concat(node.children.flatMap(descendants));
document = {createElement: tag => new Element(tag), body: new Element('body'), activeElement: null}; document.body.rootBody = true;
const source = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-admin-workspace-modal.js"), '../src/studio/AdminWorkspace.js')), 'utf8').replace('export default class AdminWorkspace', 'class AdminWorkspace');
const {AdminWorkspace, date} = new Function('document', 'navigator', source + '\nreturn {AdminWorkspace,date};')(document, {});
const css = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-admin-workspace-modal.js"), '../src/studio/admin-workspace.css')), 'utf8');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {resolve, promise}; };
const clone = value => JSON.parse(JSON.stringify(value));
const user = (index, name) => ({id: 'u-' + index, username: 'user' + String(index).padStart(3, '0'), displayName: name || 'Usuario ' + String(index).padStart(3, '0'), role: index % 3 ? 'creator' : 'viewer', superadmin: index === 0, permissions: {manageUsers: index === 0}, createdAt: 1792990800000,
  quota: {projects: index % 3, maxProjects: 2, storageBytes: 20971520, usedBytes: index * 1024, remainingBytes: 20971520 - index * 1024, documentBytes: index * 512, assetBytes: index * 512, lastSeenAt: new Date(1792990800000 + index * 1000).toISOString()}});
function fixture(count = 203) {
  const users = Array.from({length: count}, (_, index) => user(index, index === 1 ? 'Ána Muñoz' : undefined)), calls = [], messages = [], editor = {hooks: {unlock() {}, clearKeyboard() {}}};
  const studio = {ctx: {}, editor, message(value) { messages.push(value); }, close() { studio.drawerClosed = true; }, guard(operation) { studio.pending = Promise.resolve().then(operation); return studio.pending; }, client: {user: users[0], async request(method, route, data) {
    calls.push({method, route, data}); if (studio.override) { const result = studio.override(method, route, data); if (result !== undefined) return result; }
    if (route === '/admin/users' && method === 'GET') return {users: clone(users), policy: {invitationOnly: false}};
    if (route === '/admin/users' && method === 'POST') { const value = user(users.length, data.displayName); value.username = data.username; value.role = data.role; users.push(value); return {user: clone(value), accessCode: 'OneTime-Secret-12345'}; }
    if (/\/quota$/.test(route)) { const target = users.find(value => route.includes('/' + value.id + '/')); Object.assign(target.quota, data); return {user: clone(target), quota: clone(target.quota)}; }
    if (route.startsWith('/admin/reports')) { const selected = new URL(route, 'http://fixture').searchParams.get('userId'); return {report: {students: users.filter(value => !selected || value.id === selected).map(value => ({user: value, completed: 0, recordedMissions: 0, projects: [], progress: [], evaluations: [], checkpoints: {total: 0}}))}}; }
    if (route === '/admin/groups') return {groups: []}; if (route === '/admin/codes') return {codes: []}; throw new Error('Unexpected request ' + route);
  }, async setUserRole(id, role) { calls.push({method: 'PUT', route: '/users/' + id + '/role', data: {role}}); if (studio.roleError) throw new Error('Permiso rechazado'); const target = users.find(value => value.id === id); target.role = role; return clone(target); }} };
  return {studio, workspace: new AdminWorkspace(studio), users, calls, messages};
}
const byClass = (root, className) => descendants(root).find(value => value.className.split(/\s+/).includes(className));
const buttons = root => descendants(root).filter(value => value.tagName === 'BUTTON');
const submit = form => form.onsubmit({preventDefault() {}});
async function run() {
  const chromeReset = css.match(/\.studio-admin-modal-header,\.studio-admin-modal-footer\s*\{([^}]+)\}/); assert(chromeReset, 'Modal chrome overrides the original viewer header/footer selectors.'); for (const property of ['position:static', 'inset:auto', 'width:auto', 'margin:0', 'text-align:left', 'box-sizing:border-box']) assert(chromeReset[1].includes(property));
  const original = new Element('button'); document.body.appendChild(original); original.focus();
  const f = fixture(); await f.workspace.openModal(); const w = f.workspace;
  assert(f.studio.drawerClosed); assert(w.modal.isConnected); assert.equal(w.modal.children[0].attributes['aria-modal'], 'true'); assert.equal(document.activeElement, w.closeButton);
  assert.equal(w.userDirectory.rows.children.length, 25, 'Only one page is materialized, even with hundreds of users.'); assert.match(w.userDirectory.status.textContent, /203 de 203/);
  w.userDirectory.search.value = 'ana munoz'; w.userDirectory.search.oninput(); assert.equal(w.userDirectory.rows.children.length, 1); assert.match(w.userDirectory.detail.textContent, /Ána Muñoz/); assert.equal(w.selectedUserId, 'u-1');
  w.userDirectory.search.value = ''; w.userDirectory.search.oninput(); w.userDirectory.role.value = 'admin'; w.userDirectory.role.onchange(); assert.equal(w.userDirectory.rows.children.length, 1); assert.equal(w.selectedUserId, 'u-0');
  const adminForm = byClass(w.userDirectory.detail, 'studio-admin-user-quota'); assert(adminForm.querySelectorAll('select')[0].disabled);
  w.userDirectory.role.value = 'viewer'; w.userDirectory.role.onchange(); assert(w.filteredUsers().every(value => value.role === 'viewer' && !value.superadmin));
  w.userDirectory.role.value = 'all'; w.userDirectory.role.onchange(); w.userDirectory.size.value = '50'; w.userDirectory.size.onchange(); assert.equal(w.userDirectory.rows.children.length, 50); w.userDirectory.next.click(); assert.equal(w.userPage, 1); assert.equal(w.userDirectory.rows.children.length, 50);
  w.userDirectory.sort.value = 'storage'; w.userDirectory.sort.onchange(); assert.equal(w.userPage, 0); assert.equal(w.selectedUserId, 'u-202'); assert.match(w.userDirectory.detail.textContent, /Desglose del almacenamiento/); assert.match(w.userDirectory.detail.textContent, /Último acceso/);
  let form = byClass(w.userDirectory.detail, 'studio-admin-user-quota'), fields = form.querySelectorAll('input'); fields[0].value = '5'; fields[1].value = '40'; form.querySelectorAll('select')[0].value = 'viewer'; submit(form); await f.studio.pending;
  assert.equal(f.studio.client.user.id, 'u-0'); assert.equal(w.users.find(value => value.id === 'u-202').quota.maxProjects, 5); assert.equal(w.users.find(value => value.id === 'u-202').role, 'viewer'); assert.match(w.userDirectory.detail.textContent, /guardados/); assert.match(w.userDirectory.detail.textContent, /Explorador/);
  assert.equal(f.calls.filter(value => value.route.startsWith('/admin/reports')).length, 0, 'Progress is loaded on demand, not for every list row.');
  const consult = buttons(w.userDirectory.detail).find(value => value.textContent.includes('Consultar proyectos')); consult.click(); await f.studio.pending; assert.equal(f.calls.filter(value => value.route.startsWith('/admin/reports')).length, 1); assert.equal(f.calls.find(value => value.route.startsWith('/admin/reports')).route, '/admin/reports?userId=u-202'); assert.match(w.userDirectory.detail.textContent, /misiones registradas/);
  w.selectedUserId = 'u-201'; w.renderUserDetail(); form = byClass(w.userDirectory.detail, 'studio-admin-user-quota'); f.studio.roleError = true; form.querySelectorAll('select')[0].value = 'creator'; submit(form); await f.studio.pending;
  assert.match(form.textContent, /La cuota se guardó/); assert(!form.textContent.includes('Límites y permiso guardados.')); assert(f.messages.every(value => !value.includes('user201'))); f.studio.roleError = false;
  const create = byClass(w.body, 'studio-admin-create').querySelectorAll('form')[0]; create.querySelectorAll('input')[0].value = 'zz-new'; create.querySelectorAll('input')[1].value = 'ZZ Nuevo'; submit(create); await f.studio.pending;
  assert.equal(w.selectedUserId, 'u-203'); assert(w.userDirectory.rows.children.some(value => value.dataset.userId === 'u-203')); assert.match(w.userDirectory.detail.textContent, /Acceso de zz-new/); assert(w.userDirectory.detail.querySelectorAll('input').some(value => value.value === 'OneTime-Secret-12345'));
  let prevented = false; const modalDialog = w.modal.children[0], focusables = modalDialog.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]').filter(value => !value.disabled && !value.hidden); focusables[focusables.length - 1].focus();
  w.modal.listeners.keydown[0]({key: 'Tab', preventDefault() { prevented = true; }, stopPropagation() {}}); assert(prevented); assert.equal(document.activeElement, focusables[0]);
  const delayed = deferred(); f.studio.override = (_method, route) => route === '/admin/users' ? delayed.promise : undefined; const loading = w.open(w.modalContent, 'users'); w.close(); delayed.resolve({users: [user(9)], policy: {}}); await loading;
  assert.equal(w.modal, null); assert.equal(w.users.length, 0); assert.equal(document.activeElement, original); assert(!document.body.textContent.includes('OneTime-Secret'));
  f.studio.override = null; await w.openModal(); f.studio.client.user = user(1); await assert.rejects(() => w.openModal(), /superadministrador/); w.close();
  const vr = fixture(); vr.studio.ctx.vrMode = true; await assert.rejects(() => vr.workspace.openModal(), /fuera de la sesión VR/); assert.equal(vr.workspace.modal, undefined);
  const unavailable = fixture(); unavailable.studio.override = () => Promise.reject(new Error('Servidor temporalmente no disponible')); await assert.rejects(() => unavailable.workspace.openModal(), /temporalmente/); assert.match(unavailable.workspace.body.textContent, /Reintentar/); unavailable.workspace.close();
  const pending = fixture(), late = deferred(); pending.studio.override = (_method, route) => route === '/admin/users' ? late.promise : undefined; const open = pending.workspace.openModal(); pending.studio.client.user = user(1); late.resolve({users: [user(123)], policy: {}}); await open; assert.equal(pending.workspace.body.children.length, 1, 'An expired identity cannot render an authorized response.'); pending.workspace.close();
  const project = fixture(2), e = project.studio.editor; let opened = false; Object.assign(e, {editorEnabled: true, active: true, canEditDocument: () => true, projectClient: {async getProject() { return {id: 'project-selected'}; }}, async openServerProject(value) { assert.equal(project.workspace.modal, null, 'The modal closes before opening the selected project.'); assert.equal(value.id, 'project-selected'); opened = true; }, enter() { e.entered = true; }});
  project.studio.override = (_method, route) => route.startsWith('/admin/reports') ? {report: {students: [{user: user(1), completed: 0, recordedMissions: 0, progress: [], evaluations: [], checkpoints: {total: 0}, projects: [{id: 'project-selected', name: 'Proyecto del alumno', revision: 1}]}]}} : undefined;
  await project.workspace.openModal(); project.workspace.selectedUserId = 'u-1'; project.workspace.renderUserDetail(); buttons(project.workspace.userDirectory.detail).find(value => value.textContent.includes('Consultar proyectos')).click(); await project.studio.pending; buttons(project.workspace.userDirectory.detail).find(value => value.textContent === 'Abrir proyecto').click(); await project.studio.pending; assert(opened); assert(e.entered);
  assert.equal(date('2026-10-26T13:00:00Z'), new Intl.DateTimeFormat('es-EC', {dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Guayaquil'}).format(new Date('2026-10-26T13:00:00Z')));
  console.log('Admin modal: 203-user paginated list, search/filter/sort, selected detail, quota/role saves and partial failure, lazy progress, one-time creation code, focus/close, VR block and stale identity isolation passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
