'use strict';
// Real monitor authoring and guide dialogs with a small keyboard/DOM adapter.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const guide = require('../shared/guided-scene-plan');
const original = fs.readFileSync(path.join(__dirname, 'test-guided-scene-builder.js'), 'utf8');
const {harness, monitor, buildGuidedScene, guidedPlanDiagram, release} = new Function('require', '__dirname', original.slice(0, original.indexOf('\nasync function run()')) + '\nreturn {harness,monitor,buildGuidedScene,guidedPlanDiagram,release};')(require, __dirname);
const code = fs.readFileSync(path.join(__dirname, '../src/editor/SceneGuideChat.js'), 'utf8').replace(/^import .*$/gm, '').replace('export default class SceneGuideChat', 'return class SceneGuideChat');
const SceneGuideChat = new Function('guidePlan', 'buildGuidedScene', 'guidedPlanDiagram', code)(guide, buildGuidedScene, guidedPlanDiagram);
function makeDom() {
  const dom = {activeElement: null};
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.parentNode = null; this.attributes = {}; this.hidden = false; this.disabled = false; this.value = ''; }
    set textContent(value) { this.text = String(value); this.children.forEach(child => { child.parentNode = null; }); this.children = []; }
    get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(''); }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    querySelectorAll(tags) { return this.children.flatMap(child => (tags.split(',').includes(child.tagName) ? [child] : []).concat(child.querySelectorAll(tags))); }
    focus() { dom.activeElement = this; }
  }
  dom.createElement = tag => new Element(tag); dom.body = new Element('body'); dom.activeElement = dom.body; return dom;
}
function fixture() {
  const f = harness.setup(), dom = makeDom(), messages = [];
  const editor = {active: true, roomId: 'hall', projectGeneration: 1, document: f.document, ctx: {document: dom, scene: f.scene}, hooks: {renderScene: f.scene}, orbit: {target: new THREE.Vector3()}, toast: message => messages.push(message), select(object) { this.selected = object; }, focus() {}, async perform(action) { try { return await action(); } catch (error) { messages.push(error.message); return undefined; } }};
  return Object.assign(f, {editor, dom, messages});
}
async function run() {
  {
    const f = fixture(), machine = f.document.addPrefab('hall', 'conveyor'); f.editor.selected = machine; const tools = new monitor.MonitorWidgetTools(f.editor), before = f.document.undoStack.length;
    const inserted = await tools.add(); assert(inserted); assert.equal(f.document.undoStack.length, before + 1, 'Inserting a configured monitor is one undo action.');
    assert.equal(f.document.getBehaviors(inserted)[0].targetId, machine.userData.editorId); assert(tools.dialog);
    const selects = tools.dialog.querySelectorAll('select'), inputs = tools.dialog.querySelectorAll('input'); selects[1].value = 'module'; inputs[0].value = 'Monitor de prueba'; tools.dialog.querySelectorAll('form')[0].onsubmit({preventDefault() {}});
    assert.equal(f.document.getBehaviors(inserted)[0].scope, 'module'); assert.equal(f.document.getBehaviors(inserted)[0].title, 'Monitor de prueba'); assert.equal(tools.dialog, null);
    tools.openBinding(inserted); f.editor.projectGeneration++; const saved = JSON.stringify(f.document.getBehaviors(inserted)); tools.dialog.querySelectorAll('form')[0].onsubmit({preventDefault() {}}); assert.equal(JSON.stringify(f.document.getBehaviors(inserted)), saved); assert(tools.dialog.textContent.includes('El nivel cambió'));
    tools.dispose(); assert.equal(f.dom.body.children.length, 0); release(f);
  }
  {
    const f = fixture(), ui = new SceneGuideChat(f.editor); ui.open(); assert(ui.layer); ui.prompt.value = 'Quiero tres transportadores de rodillos en L con 3 tipos de productos y monitor'; ui.interpret(); assert.equal(ui.plan.conveyorCount, 3); assert.equal(ui.plan.shape, 'l');
    ui.prompt.value = 'Una montaña nevada'; ui.interpret(); assert.equal(ui.build.disabled, true); ui.setMode('manual'); assert.equal(ui.chat.hidden, true); assert.equal(ui.build.disabled, false);
    ui.fields.environment.checked = false; const before = f.document.undoStack.length; await ui.construct(); assert.equal(ui.layer, null); assert.equal(f.document.undoStack.length, before + 1); assert(f.messages.some(value => value.includes('Línea creada'))); release(f);
  }
  {
    const f = fixture(), ui = new SceneGuideChat(f.editor); ui.open(); f.editor.projectGeneration++; const count = f.document.getObjects('hall').length; await ui.construct(); assert(ui.layer); assert(ui.error.textContent.includes('cambió')); assert.equal(f.document.getObjects('hall').length, count); ui.dispose(); release(f);
  }
  {
    const f = fixture(), ui = new SceneGuideChat(f.editor); ui.open(); f.editor.perform = async () => undefined; await ui.construct(); assert(ui.layer, 'A swallowed editor operation failure must not close the proposal or claim success.'); assert(ui.error.textContent.includes('No se pudo')); assert(!f.messages.some(value => value.includes('Línea creada'))); ui.dispose(); release(f);
  }
  console.log('Monitor widget and guide: selected/local binding, scope, one undo, stale-project guards, manual/assisted review and honest failure state passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
