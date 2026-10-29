const __layout = require("../../tooling/layout.cjs");
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// A small DOM fixture keeps these state/race checks independent from WebGL.
class Node {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this.tabIndex = ['BUTTON', 'INPUT', 'SELECT'].includes(this.tagName) ? 0 : -1;
  }
  get firstChild() { return this.children[0] || null; }
  get textContent() { return this._text || this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this._text = value; this.children = []; }
  get isConnected() { return !!this.parentNode || this === document.body; }
  appendChild(node) { this.children.push(node); node.parentNode = this; return node; }
  removeChild(node) { this.children.splice(this.children.indexOf(node), 1); node.parentNode = null; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(type, listener) { (this.listeners[type] || (this.listeners[type] = [])).push(listener); }
  dispatch(type, extra = {}) {
    const event = Object.assign({ target: this, preventDefault() {}, stopPropagation() {} }, extra);
    (this.listeners[type] || []).forEach(listener => listener(event));
    return event;
  }
  focus() { document.activeElement = this; }
  select() { this.selectedText = true; }
  closest(selector) {
    if (selector !== '[hidden]') throw new Error('Unsupported selector');
    for (let node = this; node; node = node.parentNode) if (node.hidden) return node;
    return null;
  }
  querySelectorAll(selector) {
    const tags = selector.split(',').map(part => part.trim().toUpperCase());
    const result = [];
    const walk = node => node.children.forEach(child => {
      if (tags.includes(child.tagName) || (tags.includes('[TABINDEX]') && child.tabIndex >= 0)) result.push(child);
      walk(child);
    });
    walk(this);
    return result;
  }
}
const document = { createElement: tag => new Node(tag), body: new Node('body'), activeElement: null };
const source = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-project-library.js"), '../src/editor/ProjectLibrary.js')), 'utf8')
  .replace('export default class ProjectLibrary', 'class ProjectLibrary');
const ProjectLibrary = new Function('document', source + '\nreturn ProjectLibrary;')(document);

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

async function run() {
  const project = { id: 'one', name: '<img src=x onerror=alert(1)>', createdAt: '2026-10-22T12:00:00Z', updatedAt: '2026-10-22T13:00:00Z' };
  const requests = [], opened = [], created = [], copied = [];
  let listError = null;
  let revisions = [{ revision: 2, createdAt: project.updatedAt }, { revision: 1, createdAt: project.createdAt }];
  let getPending = null;
  const client = {
    async listProjects() { if (listError) throw listError; return [project]; },
    async listRevisions(id) { requests.push(['revisions', id]); return revisions; },
    async getProject(id, revision) {
      requests.push(['get', id, revision]);
      if (getPending) return getPending.promise;
      return { id, revision, document: { rooms: [] } };
    }
  };
  const launcher = new Node('button'); document.body.appendChild(launcher); launcher.focus();
  const library = new ProjectLibrary(client, {
    onOpen: data => { opened.push(data); },
    onNew: name => { created.push(name); },
    onSaveAs: name => { copied.push(name); }
  });
  await library.open();
  assert.equal(library.overlay.hidden, false);
  assert.equal(document.activeElement, library.search);
  assert.equal(library.list.children.length, 1);
  assert(library.list.textContent.includes(project.name), 'Untrusted names are retained as text');
  assert(!library.list.querySelectorAll('img').length, 'Project names cannot create markup');
  library.search.value = 'missing'; library.search.dispatch('input');
  assert(library.list.textContent.includes('No hay proyectos'));
  library.search.value = ''; library.search.dispatch('input');
  await library.selectProject(project);
  assert.equal(library.revisionSelect.children.length, 3);
  assert.equal(library.versionButton.disabled, true, 'Latest is the default and has its own Open button');
  library.revisionSelect.value = '1'; library.revisionSelect.dispatch('change');
  assert.equal(library.versionButton.disabled, false);
  await library.openProject(project.id, 1);
  assert.deepEqual(requests[requests.length - 1], ['get', project.id, 1]);
  assert.equal(opened[0].revision, 1);
  assert.equal(library.overlay.hidden, true);
  assert.equal(document.activeElement, launcher, 'Close returns focus to its launcher');

  await library.open('saveAs');
  assert.equal(document.activeElement, library.copyName);
  assert(library.copyName.selectedText);
  library.copyName.value = '  Copia de sala  ';
  library.copyName.parentNode.parentNode.dispatch('submit');
  await settle();
  assert.deepEqual(copied, ['Copia de sala']);
  await library.open();
  library.createName.value = 'Nuevo proyecto';
  library.createName.parentNode.parentNode.dispatch('submit');
  await settle();
  assert.deepEqual(created, ['Nuevo proyecto']);

  listError = new Error('Servidor desconectado');
  await library.open();
  assert.equal(library.feedback.hidden, false);
  assert.equal(library.feedbackText.textContent, listError.message);
  assert.equal(library.retryButton.hidden, false);
  listError = null;
  library.retryButton.dispatch('click'); await settle();
  assert.equal(library.feedback.hidden, true, 'Retry clears connection errors');

  await library.selectProject(project);
  getPending = deferred();
  const operation = library.openProject(project.id);
  assert.equal(library.busy, true);
  assert(library.dialog.querySelectorAll('button, input, select').every(node => node.disabled));
  library.onKey({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
  assert.equal(library.overlay.hidden, false, 'Escape does not interrupt a save/open in progress');
  getPending.reject(new Error('No se pudo leer el proyecto'));
  await operation;
  assert.equal(library.busy, false);
  assert.equal(library.overlay.hidden, false);
  assert.equal(library.revisionSelect.disabled, false, 'History remains usable after an action failure');
  getPending = null;

  let stopped = false, prevented = false;
  const focusable = library.dialog.querySelectorAll('button, input, select, [tabindex]')
    .filter(node => !node.disabled && !node.hidden && !node.closest('[hidden]') && node.tabIndex >= 0);
  focusable[focusable.length - 1].focus();
  library.onKey({ key: 'Tab', shiftKey: false, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert(stopped && prevented);
  assert.equal(document.activeElement, focusable[0], 'Tab wraps inside the dialog');
  library.onKey({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
  assert(library.overlay.hidden);

  await library.open();
  const stale = deferred();
  revisions = stale.promise;
  const pendingSelection = library.selectProject(project);
  library.close();
  stale.resolve([{ revision: 99, createdAt: project.createdAt }]);
  await pendingSelection;
  assert.equal(library.revisionSelect.children.length, 1, 'Results arriving after close do not mutate the dialog');

  const original = {id: 'original', name: 'Mi escenario'}, lab = {id: 'lab', name: 'Laboratorio industrial'}, levelOpens = [];
  let protectDraft = false;
  const levels = new ProjectLibrary({
    async listProjects() { return [original, lab]; }, async listRevisions() { return []; },
    async getProject(id) { return {id, name: id === lab.id ? lab.name : original.name, document: {levels: [{id: 'hall', name: 'Sala principal'}, {id: 'sound', name: '<Laboratorio>', initial: true}]}}; }
  }, {getCurrentProject: () => original, listLevels: project => project.document.levels,
    onOpen: (project, roomId) => { if (protectDraft) throw new Error('El borrador sigue sin guardar'); levelOpens.push([project.id, roomId]); }});
  await levels.open('levels');
  assert.equal(levels.selected.id, original.id); assert(levels.list.textContent.includes('Proyecto abierto'));
  await levels.selectProject(lab);
  assert.equal(levels.levelList.children.length, 2); assert(levels.levelList.textContent.includes('<Laboratorio>'));
  assert.equal(levels.levelList.querySelectorAll('laboratorio').length, 0, 'Level names remain safe plain text.');
  protectDraft = true; await levels.openProject(lab.id, undefined, 'sound');
  assert.equal(levels.overlay.hidden, false); assert.equal(levelOpens.length, 0); assert(levels.feedbackText.textContent.includes('borrador'));
  protectDraft = false; await levels.openProject(lab.id, undefined, 'sound');
  assert.deepEqual(levelOpens, [[lab.id, 'sound']], 'Opening a named level explicitly selects its owning project and room.');
  assert.equal(levels.overlay.hidden, true);

  console.log('Project library: safe names, cross-project level discovery, explicit room opening/draft protection, versions, create/copy, retry, focus and stale results passed.');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
