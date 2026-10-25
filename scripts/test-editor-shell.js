'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null; this.events = {}; this.attributes = {}; this.dataset = {};
    this.hidden = false; this.style = {setProperty: (key, value) => { this.style[key] = value; }};
    const classes = new Set();
    this.classList = {add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value), toggle(value, yes) {
      const include = yes === undefined ? !classes.has(value) : yes; if (include) classes.add(value); else classes.delete(value); return include;
    }};
  }
  appendChild(child) { if (child.parentNode) child.parentNode.removeChild(child); this.children.push(child); child.parentNode = this; return child; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; }
  set textContent(value) { this.text = String(value); this.children.forEach(child => { child.parentNode = null; }); this.children = []; }
  get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(''); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key]; }
  addEventListener(type, listener) { (this.events[type] || (this.events[type] = [])).push(listener); }
  fire(type, event = {}) {
    Object.assign(event, {target: event.target || this, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }});
    (this.events[type] || []).forEach(listener => listener(event)); return event;
  }
  dispatchEvent(event) { (this.events[event.type] || []).forEach(listener => listener(event)); }
  click() { this.fire('click'); }
  focus() { dom.activeElement = this; }
}
const dom = new Element('document'); dom.createElement = tag => new Element(tag); dom.body = new Element('body');
const storage = new Map();
const localStorage = {getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value)};
const browserWindow = {innerWidth: 1440, innerHeight: 900};
const source = fs.readFileSync(path.join(__dirname, '../src/editor/EditorShell.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class EditorShell', 'return class EditorShell');
const EditorShell = new Function('document', 'window', 'localStorage', source)(dom, browserWindow, localStorage);
function element(tag = 'div') { return new Element(tag); }
function find(root, text) { return root.children.flatMap(child => [child, ...all(child)]).find(child => child.tagName === 'BUTTON' && child.textContent === text); }
function all(root) { return root.children.flatMap(child => [child, ...all(child)]); }
function harness() {
  const called = []; let resizes = 0;
  const editor = {
    ui: element(), toolbar: element(), brand: element(), hierarchy: element(), tree: element(), treeHeader: element(), treeSearch: element('input'),
    viewport: element(), viewportHelp: element(), inspector: element(), assets: element(), roomSelect: element('select'), roomLabel: element(),
    ctx: {editorRoots: {hall: {}}, studio: {open: id => called.push(['account', id])}}, active: true, editorEnabled: true,
    toolButtons: {translate: element('button'), rotate: element('button'), scale: element('button')},
    saveButton: element('button'), undoButton: element('button'), redoButton: element('button'), snapButton: element('button'), playButton: element('button'),
    document: {studio: {scenes: [{id: 'hall', name: 'Planta'}], startRoomId: 'hall'}, canUndo: false, canRedo: true},
    simulationPanel: {panel: element(), toggle(yes = !this.opened) { this.opened = yes; this.panel.hidden = !yes; }, render() {}},
    roomId: 'hall', clearNavigation() { called.push(['clearNavigation']); }, resize() { resizes++; },
    toast(text) { called.push(['toast', text]); }, setTool(mode) { called.push(['tool', mode]); },
    appendAudioControls(parent) { const group = element(); group.appendChild(Object.assign(element('button'), {textContent: 'Activar sonido'})); parent.appendChild(group); called.push(['audioControls', parent]); return group; },
    perform(action) { return action(); }, projectLibrary: {open(mode) { called.push(['projects', mode]); }},
    assembly: {enabled: true}, assetInput: element('input'), projectInput: element('input'), assemblyButton: element('button'),
    enter() { this.active = true; }, leave() { this.active = false; },
    studioTools: {newScene() { called.push(['newScene']); }, openWorkspace(id, host) { host.appendChild(Object.assign(element('p'), {textContent: id})); called.push(['workspace', id]); }}
  };
  [editor.treeHeader, editor.treeSearch, element(), editor.tree].forEach(child => editor.hierarchy.appendChild(child));
  [editor.brand, editor.saveButton, editor.undoButton, editor.redoButton, editor.snapButton, editor.playButton].forEach(child => editor.toolbar.appendChild(child));
  [editor.toolbar, editor.hierarchy, editor.viewport, editor.inspector, editor.assets].forEach(child => editor.ui.appendChild(child));
  editor.roomSelect.appendChild(element('option'));
  editor.shell = new EditorShell(editor);
  return {editor, shell: editor.shell, called, getResizes: () => resizes};
}

const {editor, shell, called} = harness();
assert.equal(shell.menus.length, 7);
assert.deepEqual(shell.menus.map(menu => menu.trigger.textContent), ['Archivo', 'Editar', 'Añadir', 'Escenario', 'Simulación', 'Ventana', 'Ayuda']);
assert(editor.toolbar.children.includes(editor.saveButton)); assert(editor.toolbar.children.includes(editor.playButton));
assert(editor.toolbar.children.includes(shell.audioControls)); assert(find(editor.toolbar, 'Activar sonido')); assert(!all(shell.actionBank).includes(shell.audioControls), 'Audio activation remains in the visible shell toolbar.');
assert(!all(editor.toolbar).some(child => child.textContent === 'Entrar en VR'));
shell.newButton.click(); assert(called.some(call => call[0] === 'newScene'));
shell.selectButton.click(); assert(called.some(call => call[0] === 'tool' && call[1] === 'select'));
shell.accountButton.click(); assert(called.some(call => call[0] === 'account'));

// Menus are real commands, retain disabled state and keyboard focus order.
const edit = shell.menus[1]; edit.trigger.fire('keydown', {code: 'ArrowDown'});
assert.equal(edit.trigger.getAttribute('aria-expanded'), 'true');
assert.equal(edit.items[0].node.disabled, true); assert.equal(dom.activeElement, edit.items[1].node);
edit.popup.fire('keydown', {code: 'End'}); assert.equal(dom.activeElement, edit.items[edit.items.length - 1].node.disabled ? edit.items[edit.items.length - 2].node : edit.items[edit.items.length - 1].node);
edit.popup.fire('keydown', {code: 'Escape'}); assert.equal(shell.menuIndex, -1); assert.equal(dom.activeElement, edit.trigger);
shell.openMenu(0); find(shell.menus[0].popup, 'Guardar como…').click(); assert(called.some(call => call[0] === 'projects' && call[1] === 'saveAs')); assert.equal(shell.menuIndex, -1);

// Separators persist bounded dimensions and expose keyboard operations.
const left = shell.splitters.left;
left.fire('pointerdown', {button: 0, clientX: 238, clientY: 100}); left.fire('pointermove', {clientX: 310, clientY: 100}); left.fire('pointerup');
assert.equal(shell.layout.left, 310); assert.equal(editor.ui.style['--ed-left'], '310px');
const key = left.fire('keydown', {code: 'ArrowRight'}); assert(key.prevented && key.stopped); assert.equal(shell.layout.left, 334);
shell.setPanel('hierarchy', false); assert.equal(editor.hierarchy.hidden, true); assert.equal(editor.ui.style['--ed-left'], '0px');
shell.reopen.children[0].click(); assert.equal(editor.hierarchy.hidden, false);
shell.layout.right = 90000; shell.applyLayout(); assert.equal(shell.layout.right, 489.6);
const restored = harness(); assert.equal(restored.shell.layout.left, 334); assert.equal(restored.shell.layout.right, 489.6);
shell.restoreLayout(); assert.equal(shell.layout.left, 238); assert.equal(shell.layout.right, 304);

// Workspaces appear on demand, dispatch preview cleanup, and return to 3D.
assert.equal(shell.workarea.hidden, true); assert(shell.workspaceTabs.get('logic').hidden);
shell.openWorkspace('logic'); assert.equal(shell.workspace, 'logic'); assert(called.some(call => call[0] === 'workspace' && call[1] === 'logic'));
let cancelled = 0; shell.workcontent.addEventListener('studio-workspace-close', () => cancelled++);
shell.openWorkspace('interface'); assert.equal(cancelled, 1);
shell.openWorkspace('results'); assert.equal(editor.simulationPanel.opened, true); assert.equal(editor.simulationPanel.panel.parentNode, shell.workcontent);
shell.closeWorkspace(); assert.equal(shell.workarea.hidden, true); assert.equal(editor.simulationPanel.opened, false); assert.equal(editor.simulationPanel.panel.parentNode, dom.body);

editor.active = false; shell.modeChanged(); assert.equal(shell.previewControls.hidden, false);
shell.previewPause.click(); assert.equal(editor.simulationPaused, true); assert.equal(shell.previewPause.textContent, '▶ Continuar');
shell.previewPause.click(); assert.equal(editor.simulationPaused, false);
editor.ctx.vrMode = true; shell.modeChanged(); assert.equal(shell.previewControls.hidden, true);
shell.refresh(); assert.equal(editor.roomLabel.textContent, 'Planta'); assert.equal(editor.roomSelect.children[0].textContent, 'Planta · inicial');
// Numeric navigation indices are independent of root insertion order and of
// optional Studio names. Changing projects restores the original labels.
const picker = harness();
const roomIds = ['hall', 'sound', 'photogrammetry', 'vertigo', 'panoramastereo', 'panorama1', 'panorama2', 'panorama3', 'panorama4', 'panorama5'];
const defaults = ['Sala principal', 'Sala de sonido', 'Fotogrametría', 'Vértigo', 'Panorama estéreo', 'Panorama 1', 'Panorama 2', 'Panorama 3', 'Panorama 4', 'Panorama 5'];
picker.editor.ctx.editorRoots = Object.fromEntries(roomIds.slice().reverse().map(id => [id, {}]));
picker.editor.roomSelect.textContent = '';
roomIds.forEach((id, index) => { const option = element('option'); option.value = String(index); option.textContent = defaults[index]; option.dataset.defaultLabel = defaults[index]; picker.editor.roomSelect.appendChild(option); });
picker.editor.getSceneEntries = () => roomIds.map((id, index) => ({id, index, name: (picker.editor.document.studio.scenes || []).find(scene => scene.id === id)?.name || defaults[index]}));
picker.editor.document.studio = {scenes: [{id: 'sound', name: 'Nivel de prueba'}], startRoomId: 'sound'}; picker.editor.roomId = 'sound';
picker.shell.refresh();
assert.equal(picker.editor.roomSelect.children.length, 10, 'Partial metadata must retain all available levels.');
assert.equal(picker.editor.roomSelect.children[1].textContent, 'Nivel de prueba · inicial');
assert.equal(picker.editor.roomSelect.children[0].textContent, 'Sala principal');
assert.equal(picker.editor.roomLabel.textContent, 'Nivel de prueba');
picker.shell.refresh(); assert.equal(picker.editor.roomSelect.children[1].textContent, 'Nivel de prueba · inicial', 'Refresh must not accumulate initial-level markers.');
picker.editor.document.studio = {}; picker.shell.refresh();
assert.equal(picker.editor.roomSelect.children[1].textContent, 'Sala de sonido', 'A legacy project must not retain names from the previous project.');
assert.equal(picker.editor.roomLabel.textContent, 'Sala de sonido');
let scenesOpened = 0; picker.editor.resourceBrowser = {setActive() {}, render() {}, showScenes() { scenesOpened++; }};
find(picker.shell.menus[3].popup, 'Ver niveles del proyecto').click();
assert.equal(scenesOpened, 1, 'The scenario menu opens the levels list directly.');
async function checkSceneNameDialog() {
  const previous = element('button'); previous.focus();
  const pending = picker.shell.requestSceneName({title: 'Nuevo nivel', value: 'Nueva planta'});
  assert.equal(picker.shell.requestSceneName(), pending, 'Repeated clicks keep one visible name form.');
  const dialog = picker.editor.ui.children.find(child => child.tagName === 'DIALOG');
  assert(dialog && dialog.getAttribute('aria-modal') === 'true');
  const input = all(dialog).find(child => child.tagName === 'INPUT'), form = all(dialog).find(child => child.tagName === 'FORM');
  const cancel = find(dialog, 'Cancelar'), submit = find(dialog, 'Crear');
  assert.equal(dom.activeElement, input); assert.equal(input.value, 'Nueva planta');
  input.value = '   '; form.fire('submit');
  assert.equal(dialog.parentNode, picker.editor.ui, 'An empty name keeps the form open without creating a level.');
  assert(dialog.textContent.includes('160')); assert.equal(dom.activeElement, input);
  input.value = 'x'.repeat(161); form.fire('submit'); assert.equal(dialog.parentNode, picker.editor.ui);
  submit.focus(); const tab = dialog.fire('keydown', {code: 'Tab'});
  assert(tab.prevented); assert.equal(dom.activeElement, input);
  const backwards = dialog.fire('keydown', {code: 'Tab', shiftKey: true});
  assert(backwards.prevented); assert.equal(dom.activeElement, submit);
  input.value = '  Planta nueva  '; form.fire('submit');
  assert.equal(await pending, 'Planta nueva'); assert.equal(dialog.parentNode, null); assert.equal(dom.activeElement, previous);
  const cancelled = picker.shell.requestSceneName();
  find(picker.editor.ui.children.find(child => child.tagName === 'DIALOG'), 'Cancelar').click();
  assert.equal(await cancelled, null);
  const escaped = picker.shell.requestSceneName();
  picker.editor.ui.children.find(child => child.tagName === 'DIALOG').fire('keydown', {code: 'Escape'});
  assert.equal(await escaped, null); assert.equal(picker.shell.sceneNameRequest, null);
  const createElement = dom.createElement;
  let opened = 0, closed = 0;
  dom.createElement = tag => { const result = createElement(tag); if (tag === 'dialog') { result.showModal = () => { opened++; result.open = true; }; result.close = () => { closed++; result.open = false; }; } return result; };
  const native = picker.shell.requestSceneName(); assert.equal(opened, 1);
  picker.editor.ui.children.find(child => child.tagName === 'DIALOG').fire('cancel');
  assert.equal(await native, null); assert.equal(closed, 1);
  dom.createElement = createElement;
}
checkSceneNameDialog().then(() => console.log('Editor shell: commands, keyboard focus, layout, workspaces, level listing, names and accessible creation dialog passed.')).catch(error => { console.error(error); process.exitCode = 1; });
