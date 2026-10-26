'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const authors = fs.readFileSync(path.join(__dirname, 'test-studio-authoring.js'), 'utf8');
const {harness} = new Function('require', '__dirname', authors.slice(0, authors.indexOf('\nasync function run()')) + '\nreturn {harness};')(require, __dirname);
const Tabs = new Function(fs.readFileSync(path.join(__dirname, '../src/editor/ProjectWorkspaceTabs.js'), 'utf8').replace('export default class ProjectWorkspaceTabs', 'return class ProjectWorkspaceTabs'))();
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; };
function privacyFixture() {
  const f = harness(), calls = []; Object.assign(f.editor, {projectGeneration: 1, changeVersion: 1, currentProject: {id: 'private-a', name: 'Private A'}, projectName: 'Private A', dirty: true,
    updateStatus() {}, clearObjectClipboard() { this.objectClipboard = null; }, async saveProject() {}, async openServerProject() {},
    async applyServerProject(project) { calls.push(project.id); }, projectClient: {}, syncNative() {}, rememberProject() {}});
  f.editor.ctx.studio = {client: {user: {id: 'owner-a'}}}; f.editor.orbit.update = () => {}; f.editor.objectClipboard = {privateOwner: 'owner-a'};
  const tabs = new Tabs(f.editor); return Object.assign(f, {tabs, calls});
}
function changeIdentity(f, next) {
  f.editor.ctx.studio.client.user = next ? {id: next} : null; f.tabs.syncIdentity();
  f.editor.currentProject = {id: next ? 'new-identity-project' : 'public-world'}; f.editor.projectName = 'New identity'; f.editor.objectClipboard = next ? {privateOwner: next} : null;
}
async function privacyRaces() {
  for (const operation of ['open', 'apply']) for (const next of [null, 'owner-b', 'owner-a']) {
    const f = privacyFixture(), started = deferred(), pending = deferred();
    f.tabs.original.apply = async project => { f.calls.push(project.id); started.resolve(); return pending.promise; };
    const opening = f.tabs[operation]({id: 'target-a', name: 'Target A', document: {}}); await started.promise;
    changeIdentity(f, null); if (next) changeIdentity(f, next);
    pending.reject(Object.assign(new Error('Session changed during apply'), {code: 'session_changed'}));
    await assert.rejects(opening, error => error.code === 'session_changed');
    assert.deepEqual(f.calls, ['target-a'], operation + ' must never roll back to private A after logout or another account.');
    assert.equal(f.tabs.entries.size, 0, 'An old finally cannot repopulate the next identity workspace.'); assert.equal(f.editor.currentProject.id, next ? 'new-identity-project' : 'public-world');
    assert.equal(f.editor.objectClipboard && f.editor.objectClipboard.privateOwner, next); assert.equal(f.tabs.switching, false); f.tabs.dispose();
  }
  const f = privacyFixture(), entry = await f.tabs.stash(); assert.equal(entry.ownerId, 'owner-a');
  const started = deferred(), pending = deferred(); f.tabs.original.apply = async project => { f.calls.push(project.id); started.resolve(); await pending.promise; };
  const restoring = f.tabs.restore(entry); await started.promise; changeIdentity(f, 'owner-b');
  const historyB = {owner: 'owner-b'}; f.document.undoStack.splice(0, f.document.undoStack.length, historyB); pending.resolve();
  await assert.rejects(restoring, error => error.code === 'session_changed'); assert.equal(f.editor.currentProject.id, 'new-identity-project'); assert.equal(f.editor.objectClipboard.privateOwner, 'owner-b'); assert.strictEqual(f.document.undoStack[0], historyB, 'A delayed restoration cannot overwrite the new account undo history.');
  const calls = f.calls.length; await assert.rejects(() => f.tabs.restore(entry), error => error.code === 'session_changed'); assert.equal(f.calls.length, calls, 'A cached entry from another account is rejected before apply starts.'); f.tabs.dispose();
  const save = privacyFixture(), pendingSave = deferred(); save.tabs.original.save = () => pendingSave.promise;
  const saving = save.editor.saveProject(); changeIdentity(save, 'owner-b'); pendingSave.resolve({id: 'private-a'}); await saving; assert.equal(save.tabs.entries.size, 0); save.tabs.dispose();
}
async function run() {
  const f = harness(), editor = f.editor, doc = f.document, server = new Map(); let applies = 0, snapshots = 0;
  Object.assign(editor, {ctx: Object.assign(editor.ctx, {studio: {client: {user: {id: 'owner-a'}}}}), projectGeneration: 1, changeVersion: 1, projectName: 'Proyecto A', currentProject: {id: 'a', name: 'Proyecto A', revision: 1, access: {canEdit: true}}, dirty: false,
    syncNative() {}, updateStatus() {}, clearObjectClipboard() { this.objectClipboard = null; }, projectLibrary: {open() {}}, rememberProject() {},
    projectClient: {async getProject(id) { return server.get(id); }},
    async applyServerProject(project, options = {}) { applies++; this.projectGeneration++; if (options.workspaceSnapshot) { snapshots++; doc._restore(options.workspaceSnapshot); } else await doc.load(project.document, {activeRoomId: options.roomId || 'hall'});
      this.currentProject = {id: project.id, name: project.name, revision: project.revision, access: project.access}; this.projectName = project.name; this.dirty = false; doc.undoStack.length = 0; doc.redoStack.length = 0; this.objectClipboard = null; this.selected = null;
    },
    async openServerProject(project) { return this.applyServerProject(project); }, async saveProject() { throw new Error('Quota rejected'); }
  });
  editor.orbit.update = () => {}; const objectA = doc.addPrimitive('hall', 'box', '#123456'); const originalPoseA = objectA.position.toArray(); doc.setProperty(objectA, 'name', 'Caja A'); doc.setTransform(objectA, {position: [3, 2, 1]});
  editor.selected = objectA; editor.dirty = true; editor.objectClipboard = {roomId: 'hall', label: 'A'}; editor.camera.position.set(7, 8, 9);
  const originalA = await doc.serialize(); server.set('a', {id: 'a', name: 'Proyecto A', revision: 1, access: {canEdit: true}, document: originalA});
  const other = harness(); other.document.addPrimitive('hall', 'sphere', '#abcdef'); const originalB = await other.document.serialize(); server.set('b', {id: 'b', name: 'Proyecto B', revision: 1, access: {canEdit: true}, document: originalB});
  const tabs = new Tabs(editor); const historyA = doc.undoStack.length;
  await tabs.open(server.get('b')); assert.equal(tabs.entries.size, 2); assert.equal(editor.currentProject.id, 'b'); assert.equal(objectA.parent, null); assert(tabs.retainedSnapshots().length >= historyA);
  const objectB = doc.getObjects('hall').find(object => !doc.isNative(object)); doc.setProperty(objectB, 'name', 'Cambio B sin guardar'); editor.dirty = true; editor.changeVersion++; editor.objectClipboard = {label: 'B'};
  await tabs.activate('project:a'); assert.equal(doc.getObject(objectA.userData.editorId), objectA, 'Restores original objects so undo snapshots reference the same document entries.'); assert.equal(objectA.parent, editor.root);
  assert.equal(doc.undoStack.length, historyA); assert(editor.dirty); assert.equal(editor.objectClipboard.label, 'A'); assert.deepEqual(editor.camera.position.toArray(), [7, 8, 9]);
  doc.undo(); assert.deepEqual(objectA.position.toArray(), originalPoseA); doc.redo(); assert.deepEqual(objectA.position.toArray(), [3, 2, 1]);
  await tabs.activate('project:b'); assert.equal(doc.getObject(objectB.userData.editorId).name, 'Cambio B sin guardar'); assert.equal(editor.objectClipboard.label, 'B');
  assert.equal(snapshots, 2, 'Switching cached tabs uses CPU snapshots, without constructing extra model scenes.');
  await assert.rejects(() => tabs.close('project:b'), /Quota rejected/); assert.equal(tabs.entries.size, 2); assert(editor.dirty); assert.equal(editor.currentProject.id, 'b');
  await assert.rejects(() => tabs.open({id: 'read-only', access: {canEdit: false}, document: originalA}), /visualizar/); assert.equal(editor.currentProject.id, 'b');
  for (const id of ['c', 'd']) { const project = {id, name: id, revision: 1, access: {canEdit: true}, document: originalB}; server.set(id, project); await tabs.open(project); editor.dirty = true; editor.changeVersion++; }
  await assert.rejects(() => tabs.open({id: 'e', name: 'e', document: originalA}), /4 proyectos abiertos/); assert.equal(editor.currentProject.id, 'd'); assert.equal(tabs.entries.size, 4);
  const count = applies; editor.importingFiles = true; await assert.rejects(() => tabs.activate('project:a'), /operación actual/); editor.importingFiles = false; assert.equal(applies, count);
  editor.ctx.studio.client.user = {id: 'owner-b'}; tabs.syncIdentity(); assert.equal(tabs.entries.size, 0); assert.equal(editor.objectClipboard, null); assert.equal(tabs.retainedSnapshots().length, 0);
  tabs.dispose(); await privacyRaces(); console.log('Project tabs: dirty state, original CPU objects, undo/redo, camera, isolated clipboards, quota failure, permissions, four-tab limit, account epochs and delayed apply/restore/save logout isolation passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
