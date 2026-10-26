'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const load = (file, name) => new Function(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class ' + name, 'return class ' + name))();
const GraphicsSettings = load('editor/GraphicsSettings.js', 'GraphicsSettings'), MobileNavigation = load('lib/MobileNavigation.js', 'MobileNavigation');
let writes = 0;
class Events {
  constructor() { this.events = new Map(); }
  addEventListener(type, fn) { if (!this.events.has(type)) this.events.set(type, new Set()); this.events.get(type).add(fn); }
  removeEventListener(type, fn) { if (this.events.has(type)) this.events.get(type).delete(fn); }
  fire(type, event = {}) { event.preventDefault = event.preventDefault || (() => {}); event.stopPropagation = event.stopPropagation || (() => {}); this.events.get(type)?.forEach(fn => fn(event)); }
  count() { return [...this.events.values()].reduce((sum, handlers) => sum + handlers.size, 0); }
}
class Element extends Events {
  constructor(tag) { super(); this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null; this.hidden = false; this.disabled = false; this.attributes = {}; this.style = {}; this.captures = new Set(); const classes = new Set(); this.classList = {toggle: (name, active) => active ? classes.add(name) : classes.delete(name), remove: name => classes.delete(name), contains: name => classes.has(name)}; }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; }
  set textContent(value) { writes++; this.text = String(value); this.children = []; }
  get textContent() { return this.text || ''; }
  setAttribute(key, value) { writes++; this.attributes[key] = String(value); }
  getBoundingClientRect() { return {left: 0, top: 0, width: 106, height: 106}; }
  setPointerCapture(id) { this.captures.add(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
}
function environment(coarse = true) {
  const document = new Events(), window = new Events(), media = new Events(); document.body = new Element('body'); document.createElement = tag => new Element(tag); document.defaultView = window; document.hidden = false; media.matches = coarse; window.matchMedia = query => { assert.equal(query, '(pointer: coarse)'); return media; };
  return {document, window, media};
}
function graphics() {
  const env = environment(), listeners = new Set(), state = {mode: 'auto', effectiveProfile: 'balanced', targetFPS: 60, renderScale: .8, fps: 58.8, frameMs: 17, estimatedMemoryMB: null, status: 'steady'}, calls = [];
  const controller = {getMode: () => state.mode, getState: () => state, setMode: mode => { calls.push(mode); state.mode = mode; listeners.forEach(fn => fn(state)); }, subscribe: fn => { listeners.add(fn); fn(state); return () => listeners.delete(fn); }};
  const ctx = {renderer: {domElement: {width: 800, height: 600}}, editor: {performance: {getStats: () => ({gpuResourceBytesEstimated: 64 * 1024 * 1024})}}};
  const panel = new GraphicsSettings(controller, {document: env.document, ctx}).mount(env.document.body);
  assert.equal(panel.select.value, 'auto'); assert(panel.effective.textContent.includes('Equilibrado')); assert(panel.values.resolution.textContent.includes('800 × 600')); assert(panel.values.memory.textContent.includes('64 MB (estimación)'));
  panel.select.value = 'ultra'; panel.select.fire('change'); assert.deepEqual(calls, ['ultra']); assert(panel.effective.textContent.includes('Equilibrado'), 'Requested cinematic mode does not misrepresent the effective hardware-limited profile.');
  state.effectiveProfile = 'economy'; listeners.forEach(fn => fn(state)); assert(panel.effective.textContent.includes('Ahorro'));
  state.xr = true; panel.update(); assert(panel.values.resolution.textContent.includes('visor XR') && !panel.values.resolution.textContent.includes('800'), 'XR never labels the remembered desktop buffer as headset resolution.'); state.xr = false;
  panel.root.hidden = true; const previous = panel.effective.textContent; state.effectiveProfile = 'high'; listeners.forEach(fn => fn(state)); assert.equal(panel.effective.textContent, previous, 'A hidden panel does not redraw live telemetry.'); panel.root.hidden = false; panel.update(); assert(panel.effective.textContent.includes('Alta'));
  assert.equal(listeners.size, 1); panel.dispose(); assert.equal(listeners.size, 0); assert.equal(panel.select.count(), 0); assert.equal(env.document.body.children.length, 0);
  const server = new GraphicsSettings(null); assert.equal(server.root, undefined); server.dispose();
}
function mobile() {
  const env = environment(), controller = {userData: {}}, lookQueue = {pending: 0, reset() { this.pending = 0; }}, ctx = {editor: {active: false, simulation: {held: new Map()}}, renderer: {xr: {isPresenting: false}}, studio: {drawer: {hidden: true}}, desktopController: controller, desktopLook: lookQueue}, calls = [];
  const nav = new MobileNavigation(ctx, {document: env.document, window: env.window, onInteractStart: event => calls.push(['start', event.pointerId]), onInteractEnd: event => calls.push(['end', event.button]), onInteractCancel: () => calls.push(['cancel']), onGrabToggle: () => calls.push(['grab']), onRelease: () => calls.push(['drop']), onDistance: value => calls.push(['distance', value]), onFlightToggle: () => { ctx.desktopFlight = !ctx.desktopFlight; }});
  const event = (id, x = 53, y = 53) => ({pointerId: id, pointerType: 'touch', button: 0, clientX: x, clientY: y});
  assert(nav.active && !nav.root.hidden); assert(nav.nearButton.disabled && nav.dropButton.disabled);
  nav.moveElement.fire('pointerdown', event(1)); nav.moveElement.fire('pointermove', event(1, 100, 0)); nav.lookElement.fire('pointerdown', event(2)); nav.lookElement.fire('pointermove', event(2, 73, 43));
  const first = nav.consume(); assert(first.forward > 0 && first.right > 0 && Math.hypot(first.forward, first.right) <= 1.000001); assert.equal(first.lookX, 20); assert.equal(first.lookY, -10); assert.equal(nav.consume().lookX, 0, 'Look deltas are consumed exactly once while movement remains held.');
  nav.lookElement.fire('pointermove', event(2, 83, 43)); nav.lookElement.fire('pointerup', event(2, 83, 43)); assert.equal(nav.consume().lookX, 10, 'A quick released swipe keeps its last camera delta.');
  lookQueue.pending = 30; env.document.hidden = true; env.document.fire('visibilitychange'); assert.equal(lookQueue.pending, 0, 'Hiding the document clears already queued camera smoothing, not only the pad delta.'); env.document.hidden = false; nav.sync(); nav.moveElement.fire('pointerdown', event(1));
  nav.interactButton.fire('pointerdown', event(3)); assert.equal(nav.pointers.size, 2); env.window.fire('blur'); assert.deepEqual(calls, [['start', 3], ['cancel']]); assert.equal(nav.pointers.size, 0); assert.equal(nav.consume().forward, 0);
  nav.interactButton.fire('pointerdown', event(4)); nav.interactButton.fire('pointerup', event(4)); assert.deepEqual(calls.slice(-2), [['start', 4], ['end', 0]], 'Normal touch release preserves the button field used by the actual desktop input bridge.');
  nav.interactButton.fire('pointerdown', event(5)); ctx.studio.drawer.hidden = false; nav.interactButton.fire('pointerup', event(5)); assert.deepEqual(calls.at(-1), ['cancel'], 'Opening a menu cancels a capture before the next render frame.'); assert.equal(nav.consume().forward, 0); assert(nav.root.hidden); ctx.studio.drawer.hidden = true; nav.sync();
  nav.flightButton.fire('pointerdown', event(6)); assert(ctx.desktopFlight && !nav.upButton.hidden); nav.upButton.fire('pointerdown', event(7)); assert.equal(nav.consume().vertical, 1); nav.downButton.fire('pointerdown', event(8)); assert.equal(nav.consume().vertical, 0); nav.upButton.fire('pointercancel', event(7)); assert.equal(nav.consume().vertical, -1); nav.downButton.fire('pointerup', event(8)); assert.equal(nav.consume().vertical, 0);
  nav.upButton.fire('keydown', {key: ' ', repeat: false}); assert.equal(nav.consume().vertical, 1); nav.upButton.fire('keyup', {key: ' '}); assert.equal(nav.consume().vertical, 0, 'Keyboard activation has the same held/released lifetime as touch.');
  nav.upButton.fire('pointerdown', event(15)); ctx.desktopFlight = false; nav.consume(); assert.equal(nav.pointers.size, 0); ctx.desktopFlight = true; assert.equal(nav.consume().vertical, 0, 'Re-entering drone mode cannot revive a finger captured by its hidden vertical buttons.');
  ctx.editor.simulation.held.set(controller, {}); nav.sync(); assert(!nav.nearButton.disabled && !nav.dropButton.disabled); nav.nearButton.fire('pointerdown', event(9)); nav.farButton.fire('pointerdown', event(10)); nav.dropButton.fire('pointerdown', event(11)); assert.deepEqual(calls.slice(-3), [['distance', -120], ['distance', 120], ['drop']]);
  nav.moveElement.fire('pointerdown', event(12, 53, 0)); ctx.vrMode = true; assert.equal(nav.consume().forward, 0); assert(nav.root.hidden); ctx.vrMode = false; ctx.editor.active = true; nav.consume(); assert(nav.root.hidden); ctx.editor.active = false; env.document.hidden = true; nav.consume(); assert(nav.root.hidden); env.document.hidden = false; nav.sync();
  const beforeWrites = writes; for (let index = 0; index < 100; index++) nav.consume(); assert.equal(writes, beforeWrites, 'Idle frames do not repeatedly rewrite mobile DOM or schedule work.');
  env.media.matches = false; env.media.fire('change'); assert(nav.root.hidden); nav.grabButton.fire('pointerdown', event(13)); assert(!calls.some(row => row[0] === 'grab'), 'Hidden controls cannot act in a fine-pointer session.');
  nav.dispose(); assert.equal(env.document.count(), 0); assert.equal(env.window.count(), 0); assert.equal(env.media.count(), 0); assert.equal(env.document.body.children.length, 0); assert.deepEqual(nav.consume(), {forward: 0, right: 0, vertical: 0, lookX: 0, lookY: 0});
  const server = new MobileNavigation({}); assert.equal(server.root, undefined); assert.equal(server.active, false); server.dispose();
}
async function productBridge() {
  const THREE = require('three'), file = path.join(__dirname, 'test-industrial-xr.js'), source = fs.readFileSync(file, 'utf8');
  const h = new Function('require', '__dirname', source.slice(0, source.indexOf('async function run()')) + '\nreturn {setup,advance,wall,removeWall,button,vars};')(require, __dirname), f = h.setup(); f.ctx.vrMode = false; f.ctx.editor.simulation = f.runtime;
  const origin = new THREE.Group(); origin.name = 'raycasterContext'; origin.position.copy(f.desktop.position).negate(); f.desktop.add(origin); const data = f.ctx.raycontrol.addController(f.desktop, {handedness: 'right'}, origin);
  const inlet = f.document.addPrefab('hall', 'source'); f.document.setTransform(inlet, {position: [-8, 1.02, -4]}); f.document.setBehaviors(inlet, f.document.getBehaviors(inlet).map(value => value.type === 'source' ? Object.assign({}, value, {autoGenerate: false, initialCount: 1, outputId: '', delivery: 'manual'}) : value));
  const before = JSON.stringify(await f.document.serialize()); f.runtime.start('hall'); h.advance(f); const product = [...f.runtime.products.values()].find(value => value.sourceEntry); assert(product, 'The integration uses a real finite Source load.');
  const index = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8'), extract = name => { const match = index.match(new RegExp('function ' + name + '\\([^]*?\\n\\}')); assert(match); return match[0]; };
  class Boundary { constructor(ctx, callbacks) { this.callbacks = callbacks; } }
  new Function('MobileNavigation', 'context', 'desktopController', 'desktopControllerData', 'raycontrol', ['setupMobileNavigation', 'onDesktopSelectStart', 'onDesktopSelectEnd'].map(extract).join('\n') + '\nsetupMobileNavigation();')(Boundary, f.ctx, f.desktop, data, f.ctx.raycontrol);
  const actions = f.ctx.mobileNavigation.callbacks;
  const aim = (point, offsets = [[0, .6, 1.4], [0, .6, -1.4], [1.4, .6, 0], [-1.4, .6, 0], [0, 1.5, .2]], ignore = [product.object]) => {
    const offset = offsets.find(values => !f.ctx.collisionWorld.rayBlocked(point.clone().add(new THREE.Vector3().fromArray(values)), point, {ignore})); assert(offset, 'The chosen load has a physically unoccluded approach.');
    f.camera.position.copy(point).add(new THREE.Vector3().fromArray(offset)); f.camera.lookAt(point); h.advance(f, .08);
  };
  product.object.updateWorldMatrix(true, true); const center = product.bounds.getCenter(new THREE.Vector3()).applyMatrix4(product.object.matrixWorld); aim(center);
  assert(f.ctx.raycontrol.selectionEntries(data).some(entry => entry.state === product.stateEntry.state), 'The native RayControl resolves the actual product state.'); actions.onGrabToggle(); h.advance(f); assert.equal(product.heldBy, f.desktop, 'Coger goes through the real industrial trigger bridge.');
  const distance = product.holdDistance; actions.onDistance(-120); assert(product.holdDistance < distance); actions.onRelease(); h.advance(f); assert.equal(f.runtime.held.size, 0);
  let native = 0; f.desktop.addEventListener('griptoggle', () => native++); f.runtime.command(f.head.userData.editorId, 'powerOn', undefined, 'segment'); f.runtime.command(f.head.userData.editorId, 'stop', undefined, 'segment'); const start = h.button(f, 'start'), point = start.cap.getWorldPosition(new THREE.Vector3()); aim(point, [[0, 0, .7]], [start.object]);
  assert(f.ctx.raycontrol.selectionEntries(data).some(entry => entry.state.colliderMesh === start.object), 'A real physical PLC button is under the ray.'); actions.onGrabToggle(); assert.equal(native, 1); assert.equal(h.vars(f).running, false, 'Coger preserves native grip fallback and cannot actuate an HMI button.');
  actions.onInteractStart(); actions.onInteractEnd(); h.advance(f); assert.equal(h.vars(f).running, true, 'Accionar still actuates the real physical PLC.');
  data.enabled = false; actions.onGrabToggle(); assert.equal(native, 1); data.enabled = true; f.ctx.raycontrol.disable(); actions.onGrabToggle(); assert.equal(native, 1); f.ctx.raycontrol.enable();
  f.runtime.stop(); f.visuals.dispose(); assert.equal(JSON.stringify(await f.document.serialize()), before, 'All mobile action paths preserve authored equipment and Source content.');
}
graphics(); mobile(); productBridge().then(() => console.log('Device controls: local graphics/effective caps/estimated memory, SSR, multitouch walk/look, actual RayControl/Source grip-distance-drop versus PLC actions, native grip fallback, keyboard/menu/XR/blur cancellation, idle stability and disposal passed.')).catch(error => { console.error(error); process.exitCode = 1; });
