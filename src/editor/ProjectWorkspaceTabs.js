/** A bounded editor workspace. Inactive projects retain CPU snapshots/history;
 * only one document is attached to the renderer and simulated at any time. */
export default class ProjectWorkspaceTabs {
  constructor(editor, options = {}) {
    this.editor = editor; this.options = options; this.limit = Math.max(1, Math.min(4, options.limit || 4)); this.entries = new Map(); this.activeKey = null;
    this.switching = false; this.disposed = false; this.identity = this.userKey(); this.identityEpoch = 0; this.counter = 0;
    this.original = {apply: editor.applyServerProject.bind(editor), open: editor.openServerProject.bind(editor), save: editor.saveProject.bind(editor), status: editor.updateStatus.bind(editor)};
    editor.projectTabs = this;
    editor.applyServerProject = (project, settings) => this.apply(project, settings);
    editor.openServerProject = (project, roomId) => this.open(project, roomId);
    editor.saveProject = async (...args) => { const scope = this.scope(), saved = await this.original.save(...args); if (this.sameScope(scope)) this.saved(saved); return saved; };
    editor.updateStatus = (...args) => { const result = this.original.status(...args); if (!this.switching) this.refresh(); return result; };
    this.build(); this.refresh();
  }
  userKey() { const client = this.editor.ctx.studio && this.editor.ctx.studio.client; return client && client.user && client.user.id || null; }
  scope() { return {ownerId: this.identity, identityEpoch: this.identityEpoch}; }
  sameScope(scope) { return Boolean(!this.disposed && scope && scope.ownerId && scope.ownerId === this.identity && scope.ownerId === this.userKey() && scope.identityEpoch === this.identityEpoch); }
  assertScope(scope) { if (!this.sameScope(scope)) throw Object.assign(new Error('La cuenta cambió. Abre el proyecto desde la sesión actual.'), {code: 'session_changed'}); }
  key(project = this.editor.currentProject) { return project && project.id ? 'project:' + project.id : 'draft:' + this.identity; }
  editable(project = this.editor.currentProject) { const access = project && project.access; return !access || !['public', 'template', 'viewer'].includes(access.role) && access.canEdit !== false && access.write !== false; }
  roomIndex(roomId) { return Array.from(this.editor.document.rooms.keys()).indexOf(roomId); }
  build() {
    if (typeof document === 'undefined' || !this.editor.ui) return;
    const bar = document.createElement('nav'); bar.className = 'ed-project-tabs'; bar.setAttribute('aria-label', 'Proyectos abiertos'); this.bar = bar;
    const host = this.options.host || this.editor.ui; host.appendChild(bar);
  }
  syncIdentity() {
    const identity = this.userKey(); if (identity === this.identity) return false;
    this.entries.clear(); this.activeKey = null; this.identity = identity; this.identityEpoch++; this.switching = false;
    if (this.editor.clearObjectClipboard) this.editor.clearObjectClipboard();
    if (this.editor.studioTools && this.editor.studioTools.selection) this.editor.studioTools.selection.clear();
    this.render(); return true;
  }
  safe() {
    const editor = this.editor;
    if (!editor.active || editor.ctx.vrMode || editor.ctx.studio && editor.ctx.studio.room || this.switching || editor.busy || editor.loadingProject || editor.pendingEdits || editor.importingFiles || editor.pastingObject || editor.creatingScene || editor.creatingStudy || editor.creatingProject || editor.document.loading || editor.document.transaction || editor.transform && editor.transform.dragging) throw new Error('Termina la operación actual en el editor antes de cambiar de proyecto.');
    if (!this.userKey()) throw new Error('Inicia sesión para abrir proyectos de edición.');
  }
  refresh() {
    if (this.disposed) return; if (this.syncIdentity()) return;
    const editor = this.editor; if (!this.identity || !this.editable()) { this.render(); return; }
    const key = this.key(); let entry = this.entries.get(key);
    if (!entry) { entry = Object.assign(this.scope(), {key, project: editor.currentProject && Object.assign({}, editor.currentProject), name: editor.projectName, dirty: editor.dirty, touched: ++this.counter}); this.entries.set(key, entry); }
    entry.name = editor.projectName; entry.project = editor.currentProject && Object.assign({}, editor.currentProject); entry.dirty = editor.dirty; this.activeKey = key; this.render();
  }
  async stash() {
    const editor = this.editor, key = this.key(), generation = editor.projectGeneration, version = editor.changeVersion, scope = this.scope(); this.assertScope(scope);
    const snapshot = editor.document.capture(), undo = editor.document.undoStack.slice(), redo = editor.document.redoStack.slice();
    const serialized = await editor.document.serialize();
    this.assertScope(scope);
    if (generation !== editor.projectGeneration || version !== editor.changeVersion || this.userKey() !== this.identity) throw new Error('El proyecto o la cuenta cambió durante la preparación. Vuelve a cambiar de pestaña.');
    const entry = Object.assign(this.entries.get(key) || {}, scope, {key, snapshot, undo, redo, serialized, project: editor.currentProject && Object.assign({}, editor.currentProject), name: editor.projectName, dirty: editor.dirty,
      historicalRevision: editor.historicalRevision, changeVersion: editor.changeVersion, roomId: editor.roomId, clipboard: editor.objectClipboard, selected: editor.selected && editor.selected.userData.editorId,
      camera: editor.camera && {position: editor.camera.position.clone(), quaternion: editor.camera.quaternion.clone(), zoom: editor.camera.zoom, target: editor.orbit.target.clone()}, touched: ++this.counter});
    this.entries.set(key, entry); this.activeKey = key; return entry;
  }
  roomFor(key) {
    if (this.entries.has(key) || this.entries.size < this.limit) return;
    const removable = Array.from(this.entries.values()).filter(entry => entry.key !== this.activeKey && !entry.dirty).sort((a, b) => a.touched - b.touched)[0];
    if (removable) this.entries.delete(removable.key);
    else throw new Error('Hay ' + this.limit + ' proyectos abiertos con cambios. Guarda y cierra una pestaña antes de abrir otra.');
  }
  async apply(project, settings = {}) {
    const changedIdentity = this.syncIdentity();
    if (this.disposed || !this.identity || !this.editor.active || this.switching || !this.editable(project)) return this.original.apply(project, settings);
    const key = this.key(project), scope = this.scope(); this.roomFor(key); let previous;
    this.switching = true;
    try { previous = changedIdentity ? null : await this.stash(); this.assertScope(scope); const result = await this.original.apply(project, settings); this.assertScope(scope); this.activeKey = key; this.entries.delete(key); this.refreshAfterSwitch(); return result; }
    catch (error) { if (previous && this.sameScope(scope) && this.sameScope(previous)) await this.restore(previous); throw error; }
    finally { if (this.sameScope(scope)) { this.switching = false; this.refresh(); } }
  }
  refreshAfterSwitch() {
    const editor = this.editor, key = this.key(); this.activeKey = key;
    this.entries.set(key, Object.assign(this.scope(), {key, project: editor.currentProject && Object.assign({}, editor.currentProject), name: editor.projectName, dirty: editor.dirty, touched: ++this.counter}));
  }
  async restore(entry, roomId) {
    this.assertScope(entry);
    const editor = this.editor, target = roomId || entry.roomId;
    await this.original.apply({id: entry.project && entry.project.id, name: entry.name, revision: entry.project && entry.project.revision, historicalRevision: entry.historicalRevision, access: entry.project && entry.project.access, document: entry.serialized}, {roomId: target, workspaceSnapshot: entry.snapshot});
    this.assertScope(entry);
    editor.document.undoStack.splice(0, editor.document.undoStack.length, ...entry.undo); editor.document.redoStack.splice(0, editor.document.redoStack.length, ...entry.redo);
    editor.currentProject = entry.project && Object.assign({}, entry.project); editor.projectName = entry.name; editor.dirty = entry.dirty; editor.historicalRevision = entry.historicalRevision;
    editor.changeVersion = Math.max(editor.changeVersion, entry.changeVersion || 0); editor.objectClipboard = entry.clipboard || null;
    if (editor.document.hasPendingRoom(target)) { await editor.document.activateRoom(target); this.assertScope(entry); }
    if (target !== editor.roomId) { await editor.hooks.gotoRoom(this.roomIndex(target)); this.assertScope(entry); }
    editor.syncNative(); if (editor.entities) editor.entities.sync();
    if (entry.camera && target === entry.roomId) { editor.camera.position.copy(entry.camera.position); editor.camera.quaternion.copy(entry.camera.quaternion); editor.camera.zoom = entry.camera.zoom; editor.camera.updateProjectionMatrix(); editor.orbit.target.copy(entry.camera.target); editor.orbit.update(); }
    if (entry.selected) editor.select(editor.document.getObject(entry.selected));
    if (editor.performance) editor.performance.invalidate(); if (editor.collisionWorld) editor.collisionWorld.invalidate(); editor.renderAssets();
    if (editor.studioTools) editor.studioTools.refreshLabels(); this.activeKey = entry.key; entry.touched = ++this.counter;
    if (editor.rememberProject) editor.rememberProject(editor.currentProject);
  }
  async open(project, roomId) {
    const changedIdentity = this.syncIdentity(); this.safe(); const scope = this.scope(); if (!this.editable(project)) throw new Error('Este proyecto se puede visualizar. Crea una variante propia para editarlo.'); const key = this.key(project);
    if (key === this.activeKey && this.entries.has(key)) { if (roomId && roomId !== this.editor.roomId) { await this.editor.hooks.gotoRoom(this.roomIndex(roomId)); this.assertScope(scope); } return true; }
    this.roomFor(key); let previous; const cached = this.entries.get(key); this.switching = true;
    try {
      previous = changedIdentity ? null : await this.stash();
      this.assertScope(scope);
      if (cached && cached.snapshot) await this.restore(cached, roomId);
      else { await this.original.apply(project, {roomId: roomId || project.document && project.document.studio && project.document.studio.startRoomId || this.editor.roomId}); this.assertScope(scope); this.refreshAfterSwitch(); }
      return true;
    } catch (error) { if (previous && this.sameScope(scope) && this.sameScope(previous)) await this.restore(previous); throw error; }
    finally { if (this.sameScope(scope)) { this.switching = false; this.refresh(); } }
  }
  async activate(key) {
    this.syncIdentity(); this.safe(); const entry = this.entries.get(key); if (!entry || key === this.activeKey) return;
    this.assertScope(entry);
    const project = entry.project ? await this.editor.projectClient.getProject(entry.project.id) : {name: entry.name, document: entry.serialized};
    this.assertScope(entry);
    return this.open(project, entry.roomId);
  }
  saved(project) {
    if (!project || this.disposed) return; const current = this.activeKey, key = this.key(project);
    if (current !== key) this.entries.delete(current); this.activeKey = key; this.refresh();
  }
  async close(key) {
    this.safe(); const entry = this.entries.get(key); if (!entry) return; this.assertScope(entry);
    if (key === this.activeKey) { await this.stash(); this.assertScope(entry); if (this.editor.dirty) { const saved = await this.editor.saveProject(); this.assertScope(entry); if (!saved || this.editor.dirty) throw new Error('Guarda los cambios antes de cerrar la pestaña.'); key = this.key(); } }
    else if (entry.dirty) throw new Error('Abre «' + entry.name + '» y guarda sus cambios antes de cerrar la pestaña.');
    if (this.entries.size === 1) throw new Error('El proyecto actual permanece abierto. Abre otro proyecto antes de cerrar esta pestaña.');
    if (key === this.activeKey) { const next = Array.from(this.entries.keys()).find(value => value !== key); await this.activate(next); this.assertScope(entry); }
    this.entries.delete(key); this.render(); if (this.editor.performance) this.editor.performance.invalidate();
  }
  retainedSnapshots() { return Array.from(this.entries.values()).filter(entry => entry.key !== this.activeKey).flatMap(entry => [entry.snapshot].concat(entry.undo || [], entry.redo || []).filter(Boolean)); }
  retainedClipboards() { return Array.from(this.entries.values()).filter(entry => entry.key !== this.activeKey && entry.clipboard).map(entry => entry.clipboard); }
  hasUnsaved() { return this.editor.dirty || Array.from(this.entries.values()).some(entry => entry.key !== this.activeKey && entry.dirty); }
  render() {
    if (!this.bar) return; this.bar.hidden = !this.identity || !this.editor.active || !this.editable(); this.bar.textContent = '';
    if (this.editor.ui && this.editor.ui.classList) this.editor.ui.classList.toggle('ed-has-project-tabs', !this.bar.hidden);
    const caption = document.createElement('span'); caption.className = 'ed-project-tabs-caption'; caption.textContent = 'En edición'; this.bar.appendChild(caption);
    this.entries.forEach(entry => {
      const wrapper = document.createElement('span'); wrapper.className = 'ed-project-tab'; wrapper.classList.toggle('is-active', entry.key === this.activeKey);
      const tab = document.createElement('button'); tab.type = 'button'; tab.textContent = (entry.dirty ? '● ' : '') + entry.name; tab.title = entry.name; tab.setAttribute('aria-current', entry.key === this.activeKey ? 'page' : 'false'); tab.disabled = this.switching;
      tab.onclick = () => this.activate(entry.key).catch(error => this.editor.toast(error.message)); wrapper.appendChild(tab);
      const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.title = 'Cerrar «' + entry.name + '»'; close.setAttribute('aria-label', close.title); close.disabled = this.switching; close.onclick = () => this.close(entry.key).catch(error => this.editor.toast(error.message)); wrapper.appendChild(close); this.bar.appendChild(wrapper);
    });
    const open = document.createElement('button'); open.type = 'button'; open.className = 'ed-project-tabs-open'; open.textContent = '+ Abrir proyecto'; open.disabled = this.switching; open.onclick = () => this.editor.projectLibrary.open(); this.bar.appendChild(open);
  }
  dispose() { this.disposed = true; this.entries.clear(); if (this.bar) this.bar.remove(); }
}
