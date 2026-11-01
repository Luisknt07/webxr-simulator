'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const {Document} = require('./test-vehicle-storage.js'), robots = require('../../modules/logistica-industrial/functions/robots/schema/robots.js'), kinematics = require('../../modules/logistica-industrial/functions/robots/schema/robot-kinematics.js'), tasks = robots.taskProgram, products = require('../../modules/logistica-industrial/functions/flujo-materiales/schema/productSources.js');
class Element {
  constructor(tag) {this.tagName = tag.toUpperCase(); this.children = []; this.listeners = new Map(); this.attributes = {}; this.style = {}; this.value = ''; this.checked = false; if (tag === 'select') this.type = 'select-one';}
  set textContent(text) {this._text = text; this.children = [];} get textContent() {return this._text || '';}
  appendChild(child) {child.parentNode = this; this.children.push(child); return child;}
  setAttribute(k, v) {this.attributes[k] = String(v);} getAttribute(k) {return this.attributes[k];}
  addEventListener(k, fn) {if (!this.listeners.has(k)) this.listeners.set(k, []); this.listeners.get(k).push(fn);}
  async fire(k) {for (const fn of this.listeners.get(k) || []) await fn({preventDefault() {}});}
  remove() {if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this); this.parentNode = null;}
  getContext() {return {clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}};}
}
const document = {createElement: tag => new Element(tag)}, all = n => [n, ...n.children.flatMap(all)];
const source = fs.readFileSync(path.join(__dirname, '../../modules/logistica-industrial/functions/presentacion/runtime/RobotTaskPanel.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export const ROBOT_TASK_STYLE', 'const ROBOT_TASK_STYLE').replace('export default class RobotTaskPanel', 'class RobotTaskPanel');
const Panel = new Function('THREE', 'robots', 'kinematics', 'tasks', 'products', source + '\nreturn RobotTaskPanel;')(THREE, robots, kinematics, tasks, products);
async function fixture() {
  const model = new Document({}), root = new THREE.Group(); model.registerRoom('hall', root);
  const robot = model.addPrefab('hall', 'robot', 'articulated-general'), input = model.addPrefab('hall', 'source'), output = model.addPrefab('hall', 'source');
  model.setTransform(robot, {position: [0, 0, 0]}); model.setTransform(input, {position: [.8, .65, .3]}); model.setTransform(output, {position: [.8, .65, -.4]});
  model.setBehaviors(robot, model.getBehaviors(robot).map(c => c.type === 'robot' ? {...c, visualModel: 'legacy', sourceId: input.userData.editorId, outputId: output.userData.editorId} : c));
  root.updateMatrixWorld(true); let allowed = true, closed = false, deferred = null, delayed = false; const messages = [], previews = [];
  const editor = {document: model, roomId: 'hall', projectGeneration: 1, canEditDocument: () => allowed, setEquipmentBehaviors: (o, next) => model.setBehaviors(o, next), async perform(fn) {if (delayed) deferred = fn; else fn();}};
  const scope = {object: robot, id: robot.userData.editorId, description: {config: model.getBehaviors(robot).find(c => c.type === 'robot')}};
  const viewer = {document, documentModel: model, editor, scope, simulation: {records: new Map()}, current: () => !closed && editor.projectGeneration === 1, editable: () => allowed && !closed,
    previewTaskPose: p => previews.push(p), clearTaskPreview() {}, close() {closed = true;}, notify: text => messages.push(text)};
  const panel = new Panel(viewer).mount(new Element('section')); const before = await model.serialize();
  return {model, robot, input, output, panel, viewer, editor, before, messages, previews, allow(value) {allowed = value;}, delay() {delayed = true;}, pending() {return deferred;}};
}
async function run() {
  const f = await fixture(), p = f.panel; assert(p.coordinates.textContent.includes('X ')); assert.equal(p.applyButton.disabled, true);
  assert(p.validate(), p.status.textContent); assert(!p.applyButton.disabled); assert(p.preview.frames.length > 0); assert.equal(f.previews.length, 1); assert.deepEqual(await f.model.serialize(), f.before);
  await p.playButton.fire('click'); for (let i = 0; i < 5; i++) p.update(.05); assert(f.previews.length > 1); const time = p.time; await p.pauseButton.fire('click'); p.update(.1); assert.equal(p.time, time);
  const phase = p.frame.phase; await p.stepButton.fire('click'); assert.notEqual(p.frame.phase, phase); assert.deepEqual(await f.model.serialize(), f.before, 'Shadow playback never edits source, custody or persisted scene.');
  p.code.value = 'alert(document.cookie)'; const load = all(p.host).find(n => n.textContent === 'Cargar JSON en los parámetros'); await load.fire('click'); assert(p.status.textContent.includes('JSON')); assert.deepEqual(await f.model.serialize(), f.before);
  p.code.value = JSON.stringify({...p.read(), via: [{x: .75, y: 1.05, z: 0}]}); await load.fire('click'); assert.equal(p.pointRows.length, 1); assert(p.validate(), p.status.textContent);
  f.allow(false); await p.applyButton.fire('click'); assert.deepEqual(await f.model.serialize(), f.before, 'Late permission revocation prevents apply.'); f.allow(true); p.enabled.checked = true; assert(p.validate()); await p.applyButton.fire('click');
  const saved = f.model.getBehaviors(f.robot).find(c => c.type === 'robot'); assert(saved.taskEnabled); assert.equal(saved.mode, 'manual'); assert.equal(saved.running, false); assert.equal(tasks.normalize(saved.taskProgramJson).via.length, 1); f.model.undo(); assert.deepEqual(await f.model.serialize(), f.before, 'The complete recipe and links undo in one authored action.');
  p.dispose(); assert(!p.playing && !p.preview);

  const stale = await fixture(); assert(stale.panel.validate()); stale.delay(); await stale.panel.apply(); assert(stale.pending()); stale.editor.projectGeneration++; assert.throws(() => stale.pending()(), /proyecto|permisos/i); assert.deepEqual(await stale.model.serialize(), stale.before);
  const publicView = await fixture(); publicView.viewer.editor = null; publicView.allow(false); publicView.viewer.editable = () => false; publicView.panel.dispose(); const readonly = new Panel(publicView.viewer).mount(new Element('section')); assert(readonly.code.readOnly); assert(readonly.validate()); assert(readonly.applyButton.disabled); await readonly.apply(); assert.deepEqual(await publicView.model.serialize(), publicView.before); readonly.dispose();
  console.log('Robot task panel: native coordinates, isolated play/pause/step, code import, validation, explicit activation, one-step undo, readonly and deferred permission/project guards passed.');
}
run().catch(error => {console.error(error); process.exitCode = 1;});
