'use strict';
const assert = require('node:assert/strict');
const Overlay = require('../support/load-vehicle-mission-overlay')();
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.dataset = {}; this.hidden = false; this.textContent = ''; this.listeners = new Map(); }
  get firstChild() { return this.children[0] || null; }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener(key, listener) { if (!this.listeners.has(key)) this.listeners.set(key, new Set()); this.listeners.get(key).add(listener); }
  removeEventListener(key, listener) { this.listeners.get(key)?.delete(listener); }
}
const dom = () => ({body: new Element('body'), createElement: tag => new Element(tag), hidden: false});
const document = dom(); let now = 0, taskReads = 0, guidanceReads = 0;
const legacy = {id: 'legacy', components: {vehicle: {training: {phase: 'pickup'}}}}, scored = {id: 'manual', components: {vehicle: {training: {phase: 'pickup'}}}};
const tasks = [{id: 'first', name: 'Recepción a R1', scoring: true}, {id: 'second', name: 'Reposición', scoring: true}];
let lesson = {taskId: 'first', title: 'Recepción a R1', total: 2, completed: 0, phase: 'pickup', stage: 'approach', instruction: 'Sigue las flechas.', score: 0, scoreMax: 330};
const simulation = {running: true, roomId: 'hall', runSequence: 1, records: new Map(), vehicleTraining: {tasks(record) { taskReads++; return record === legacy ? [{id: 'old', name: 'Práctica anterior'}] : tasks; }, guidance() { guidanceReads++; return lesson; }}};
const editor = {active: false, simulation, simulationPaused: false}; const ctx = {editor, document, studio: {drawer: {hidden: true}}};
const overlay = new Overlay({document, now: () => now});
assert.equal(overlay.update(ctx), false); assert.equal(document.body.children.length, 0, 'Ordinary rooms do not mount a mission HUD.');
simulation.records.set(legacy.id, legacy); now = 200; assert.equal(overlay.update(ctx), false); assert.equal(guidanceReads, 0); assert.equal(document.body.children.length, 0, 'Legacy unscored tasks remain inactive.');
simulation.records.set(scored.id, scored); now = 400; assert.equal(overlay.update(ctx), true); assert.equal(document.body.children.length, 1); assert.equal(overlay.panel.element.dataset.mode, 'walking');
assert.equal(overlay.recordId, scored.id); assert.equal(overlay.panel.missionList.children[1].dataset.status, 'locked');
const initialReads = [taskReads, guidanceReads], element = overlay.panel.element;
now = 599; assert.equal(overlay.update(ctx), true); assert.deepEqual([taskReads, guidanceReads], initialReads, 'Runtime reads and panel rendering are bounded to five updates per second.');
now = 600; overlay.update(ctx); assert.equal(guidanceReads, initialReads[1] + 1);
for (const [target, key, value] of [[ctx,'drivingVehicle',scored.id],[ctx,'vrMode',true],[ctx,'studioMenuOpen',true],[ctx,'voicePanelOpen',true],[ctx,'publicDialogOpen',true],[ctx,'roomTransition',true],[ctx,'xrEntryPending',true],[ctx,'xrExitPending',true],[editor,'active',true],[editor,'simulationPaused',true],[editor,'loadingProject',true],[editor,'busy',true],[document,'hidden',true],[simulation,'paused',true],[ctx.studio.drawer,'hidden',false]]) {
  const previous = target[key], reads = guidanceReads; target[key] = value; assert.equal(overlay.update(ctx), false); assert.equal(element.hidden, true, key + ' hides immediately inside the throttle window'); assert.equal(guidanceReads, reads, 'Blocked UI does not read or advance training.'); target[key] = previous; assert.equal(overlay.update(ctx), true, key + ' can resume the same walking view');
}
ctx.vehicleDriving = {id: scored.id}; assert.equal(overlay.update(ctx), false); ctx.vehicleDriving.id = null; assert.equal(overlay.update(ctx), true); assert.equal(overlay.recordId, scored.id);
simulation.running = false; assert.equal(overlay.update(ctx), false); simulation.running = true; overlay.update(ctx);
lesson = {...lesson, taskId: 'second', title: 'Reposición', completed: 1, score: 145}; now += 200; overlay.update(ctx);
assert.equal(overlay.panel.title.textContent, 'Reposición'); assert.equal(overlay.panel.score.textContent, '145 / 330 pts'); assert.equal(overlay.panel.missionList.children[1].dataset.status, 'active');
simulation.runSequence++; simulation.records.clear(); assert.equal(overlay.update(ctx), false); assert.equal(element.hidden, true, 'A new run cannot display stale mission state.');
const publicDocument = dom(), publicCtx = {document: publicDocument, demo: {simulation: {...simulation, records: new Map([[scored.id, scored]])}, paused: false}};
const publicOverlay = new Overlay({document: publicDocument, now: () => now}); assert.equal(publicOverlay.update(publicCtx), true); publicCtx.demo.paused = true; assert.equal(publicOverlay.update(publicCtx), false);
publicOverlay.dispose(); assert.equal(publicDocument.body.children.length, 0); overlay.dispose(); assert.equal(document.body.children.length, 0); assert.equal(overlay.update(ctx), false); overlay.dispose();
assert.equal(scored.components.vehicle.training.phase, 'pickup'); assert.equal(simulation.events, undefined, 'The overlay never publishes rewards or commands.');
console.log('Walking mission overlay: scored-only lazy mount, five-Hz reads, immediate context gating, verified progression, public context and disposal passed.');
