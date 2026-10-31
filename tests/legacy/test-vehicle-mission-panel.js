'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const MissionPanel = require('../../modules/logistica-industrial/functions/montacargas/runtime/VehicleMissionPanel.js').default;
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = new Map(); this.hidden = false; this.open = false; this.writes = 0; this._text = ''; }
  get textContent() { return this._text; }
  set textContent(value) { this._text = String(value); this.writes++; }
  get firstChild() { return this.children[0] || null; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(callback); }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
}
const nodes = element => [element, ...element.children.flatMap(nodes)];
const document = {createElement: tag => new Element(tag), body: new Element('body')};
const tasks = [{id: 'first', name: '1 · De recepción a R1'}, {id: 'second', name: '2 · Reposición del muelle'}, {id: 'third', name: '3 · Preparación de pedidos'}];
const stages = active => ['approach','pickup','transport','align','drop','withdraw'].map((id, index, ids) => ({id, title: id, status: index < ids.indexOf(active) ? 'completed' : id === active ? 'active' : 'locked'}));
let now = 0;
const panel = new MissionPanel(document, {now: () => now, feedbackDuration: 100}); panel.mount(document.body); panel.update(null);
assert.equal(panel.element.hidden, true);
const lesson = {taskId: 'first', title: tasks[0].name, total: 3, completed: 0, phase: 'pickup', stage: 'approach', stageTitle: 'Aproximación', instruction: 'Sigue las flechas hasta recepción.', stages: stages('approach'), score: 0, scoreMax: 495, badges: [], routeComplete: false};
panel.update(lesson, tasks);
assert.equal(panel.element.hidden, false); assert.equal(panel.kicker.textContent, 'Misión 1 de 3'); assert.equal(panel.title.textContent, 'De recepción a R1');
assert.equal(panel.score.textContent, '0 / 495 pts'); assert.equal(panel.missions.open, false); assert.equal(panel.help.open, false);
assert.equal(panel.missionList.children[0].dataset.status, 'active'); assert.equal(panel.missionList.children[1].dataset.status, 'locked');
assert.equal(panel.missionList.children[2].children[1].textContent, 'Bloqueada');
assert.match(panel.unlockNote.textContent, /depositar.*retirar ambas horquillas/);
assert.equal(panel.element.getAttribute('aria-live'), undefined, 'The full panel cannot announce every runtime update.');
assert.equal(panel.announcement.getAttribute('aria-live'), 'polite');
assert.deepEqual(nodes(panel.element).filter(node => node.tagName === 'button'), [panel.expandButton], 'The only button changes the presentation; there are no skip or award controls.');
assert.equal(panel.element.dataset.expanded, 'false'); panel.toggleDetails(); assert.equal(panel.element.dataset.expanded, 'true'); assert.equal(panel.expandButton.getAttribute('aria-expanded'), 'true'); panel.toggleDetails(); assert.equal(panel.element.dataset.expanded, 'false');
const firstRow = panel.missionList.children[0], firstStage = panel.stageList.children[0], firstAnnouncementWrites = panel.announcement.writes;
panel.missions.open = true; panel.update({...lesson, waypointIndex: 1, distanceM: 8.53}, tasks);
assert.equal(panel.missionList.children[0], firstRow); assert.equal(panel.stageList.children[0], firstStage); assert.equal(panel.missions.open, true);
assert.equal(panel.announcement.writes, firstAnnouncementWrites, 'Telemetry does not rebuild the list or repeat the live announcement.');

const mistake = {...lesson, feedback: {id: 'error-1', kind: 'error', message: 'El pallet debe quedar en la ubicación asignada.', points: -5, retry: 'Centra el pallet en R1 antes de depositar.'}, score: 15};
panel.update(mistake, tasks);
assert.equal(panel.feedback.hidden, false); assert.equal(panel.feedback.dataset.kind, 'error'); assert.equal(panel.feedbackPoints.textContent, '−5 pts');
assert.equal(panel.help.open, true); assert.equal(panel.helpSummary.textContent, 'Cómo corregirlo'); assert.match(panel.helpText.textContent, /Centra el pallet/);
assert.equal(panel.missionList.children[1].dataset.status, 'locked'); assert.equal(panel.progress.value, 0, 'An error cannot advance progress.');
const errorWrites = panel.announcement.writes; now = 101; panel.update(mistake, tasks);
assert.equal(panel.feedback.hidden, true); assert.equal(panel.announcement.writes, errorWrites, 'A persistent event is announced once and its toast expires.');
assert.equal(panel.help.open, true, 'The corrective advice remains available after the short toast.');

const carrying = {...lesson, phase: 'drop', stage: 'transport', stageTitle: 'Transporte', instruction: 'Sigue la ruta al destino.', stages: stages('transport'), score: 35, feedback: {id: 'reward-2', kind: 'reward', message: 'Has recogido la carga asignada.', points: 20}};
panel.update(carrying, tasks);
assert.equal(panel.feedbackPoints.textContent, '+20 pts'); assert.equal(panel.feedback.dataset.kind, 'reward'); assert.equal(panel.help.open, false);
assert.equal(panel.stageList.children[2].getAttribute('aria-current'), 'step'); assert.equal(panel.missionList.children[1].dataset.status, 'locked');
assert.equal(panel.score.textContent, '35 / 495 pts', 'The displayed total comes directly from the engine rather than accumulating local rewards.');
assert.equal(panel.progress.value, 11);
const withdrawing = {...carrying, phase: 'withdraw', stage: 'withdraw', stageTitle: 'Retirada', stages: stages('withdraw'), feedback: null};
panel.update(withdrawing, tasks);
assert.equal(panel.element.dataset.complete, 'false'); assert.equal(panel.kicker.textContent, 'Misión 1 de 3'); assert.equal(panel.missionList.children[1].dataset.status, 'locked', 'A successful deposit alone cannot unlock the next mission.');

const next = {...lesson, taskId: 'second', title: tasks[1].name, completed: 1, score: 160, badges: [{id: 'clean:first', title: 'Misión sin errores'}], feedback: {id: 'reward-3', kind: 'reward', message: 'Depósito y retirada verificados.', points: 100}};
panel.update(next, tasks);
assert.equal(panel.missionList.children[0].dataset.status, 'completed'); assert.equal(panel.missionList.children[1].dataset.status, 'active'); assert.equal(panel.missionList.children[2].dataset.status, 'locked');
assert.equal(panel.badges.hidden, false); assert.equal(panel.badges.children[0].dataset.badgeId, 'clean:first'); assert.match(panel.kicker.textContent, /2 de 3/);
assert.equal(panel.missions.open, true, 'A learner keeps their open mission list as the verified task changes.');

panel.update({...next, routeFault: true, status: 'Vuelve al último punto válido.'}, tasks);
assert.equal(panel.recovery.hidden, false); assert.match(panel.recovery.textContent, /último punto válido/);
panel.update({...next, phase: 'complete', completed: 3, taskId: '', title: 'Práctica completada', stage: 'complete', stages: stages('withdraw').map(item => ({...item, status: 'completed'})), score: 490, feedback: null}, tasks);
assert.equal(panel.element.dataset.complete, 'true'); assert.equal(panel.progress.value, 100); assert.equal(panel.stageList.hidden, true); assert.match(panel.title.textContent, /Práctica completada/);
assert(panel.missionList.children.every(item => item.dataset.status === 'completed'));
panel.update({...lesson, score: 0, scoreMax: 0}, tasks); assert.equal(panel.score.hidden, true, 'Legacy lessons without scoring do not invent points.');
panel.setVisible(false); assert.equal(panel.element.hidden, true); panel.setVisible(true); assert.equal(panel.element.hidden, false);
const root = panel.element; panel.unmount(); assert.equal(document.body.children.length, 0); assert.equal(nodes(root).find(node => node === root).listeners.get('keydown').size, 0);
for (const file of ['packages/tools/editor/src/editor.css', 'apps/public-viewer/viewer.css']) {
  const css = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8'); assert.match(css, /\.vehicle-mission-panel\[data-mode="walking"\]/); assert.match(css, /prefers-reduced-motion:reduce/); assert.match(css, /data-training="active"/);
}
console.log('Mission panel: authoritative locks, verified score and badges, correction advice, bounded event feedback, stable DOM and accessible updates passed.');
