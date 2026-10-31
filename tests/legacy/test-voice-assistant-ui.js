'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/^import .*;\r?\n/gm, '');
const Panel = new Function('THREE', read('packages/voice-assistant/VoiceAssistantPanel.js').replace('export class VoiceAssistantPanel', 'class VoiceAssistantPanel').replace('export default VoiceAssistantPanel;', '') + '\nreturn VoiceAssistantPanel;')(THREE);
const Events = new Function(read('packages/render-three/src/EventDispatcher.js').replace('export default class EventDispatcher', 'return class EventDispatcher'))();
const RayControl = new Function('THREE', 'EventDispatcher', read('packages/render-three/src/RayControl.js').replace('export var rayMaterial;', 'var rayMaterial;').replace('export default class RayControl', 'class RayControl') + '\nreturn RayControl;')(THREE, Events);

class Surface {
  constructor(tag = '', ownerDocument) { this.tagName = tag.toUpperCase(); this.ownerDocument = ownerDocument; this.children = []; this.listeners = new Map(); this.attributes = {}; this.dataset = {}; this.style = {}; this.value = ''; this.textContent = ''; this.hidden = false; this.disabled = false; this.checked = false; }
  get firstChild() { return this.children[0] || null; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) { const index = this.children.indexOf(child); if (index >= 0) this.children.splice(index, 1); child.parentNode = null; return child; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key]; }
  addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(callback); }
  removeEventListener(type, callback) { if (this.listeners.has(type)) this.listeners.get(type).delete(callback); }
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  fire(type, values = {}) {
    const event = Object.assign({target: this, stopped: false, prevented: false, stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; }}, values);
    let current = this; while (current) { for (const callback of Array.from(current.listeners.get(type) || [])) callback(event); if (event.stopped) break; current = current.parentNode; } return event;
  }
  getContext() {
    if (!this.context) { this.draws = []; this.context = {measureText: value => ({width: String(value).length * 14})}; for (const method of ['fillText', 'fillRect']) this.context[method] = (...args) => { assert(args.every(value => typeof value !== 'number' || Number.isFinite(value))); this.draws.push([method, ...args]); }; } return this.context;
  }
}
function harness() {
  const document = new Surface('document'), canvases = [], obstacles = {};
  document.createElement = tag => { const node = new Surface(tag, document); if (tag === 'canvas') canvases.push(node); return node; };
  document.body = document.createElement('body'); document.body.parentNode = document;
  document.defaultView = new Surface('window'); Object.assign(document.defaultView, {innerWidth: 1440, innerHeight: 900});
  document.querySelector = selector => obstacles[selector] || null;
  const header = document.createElement('nav'); document.body.appendChild(header);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(65, 1, .05, 50); camera.position.set(0, 1.65, 1); scene.add(camera);
  const head = new THREE.Object3D(); head.position.set(.1, 1.75, .8); scene.add(head); scene.updateMatrixWorld(true);
  const model = new THREE.Group(), beam = new THREE.Mesh(new THREE.BoxBufferGeometry(.001, .001, 1), new THREE.MeshBasicMaterial()); beam.name = 'beam'; model.add(beam);
  const calls = [], xr = {isPresenting: false, getCamera: () => head, getSession: () => ({visibilityState: 'visible'})};
  const ctx = {scene, camera, cameraRig: scene, vrMode: false, document, renderer: {xr}, assets: {teleport_model: {scene: model}, beam_tex: new THREE.Texture()}, shaders: {basic_vert: '', beam_frag: ''}, handedness: 'right', desktopLook: {unlock() { calls.push(['unlock']); }, reset() { calls.push(['reset']); }, lock() { throw new Error('Closing voice controls cannot capture the mouse.'); }}};
  ctx.raycontrol = new RayControl(ctx, 'right');
  const controllers = ['left', 'right'].map(handedness => { const controller = new THREE.Group(); scene.add(controller); const data = ctx.raycontrol.addController(controller, {handedness}); return {controller, data}; });
  let state = {enabled: false, automatic: false, speaking: false, listening: false, voices: [{id: 'es-1', name: 'Voz española', lang: 'es-ES'}], voiceId: 'auto', volume: .8, rate: 1, status: 'Voz desactivada.', transcript: '', recognitionSupported: true, speechSupported: true, samples: Array.from({length: 6}, (_, i) => ({id: 'sample-' + i, label: 'Grabación ' + (i + 1), text: 'Prueba ' + i, src: 'local-' + i + '.wav'})), error: ''};
  const subscribers = new Set(), emit = changes => { state = Object.assign({}, state, changes); for (const subscriber of subscribers) subscriber(state); };
  const assistant = {state: () => state, subscribe(callback) { subscribers.add(callback); callback(state); return () => subscribers.delete(callback); }};
  for (const [method, field] of [['setEnabled', 'enabled'], ['setAutomatic', 'automatic'], ['setVoice', 'voiceId'], ['setVolume', 'volume'], ['setRate', 'rate']]) assistant[method] = value => { calls.push([method, value]); emit({[field]: value}); };
  assistant.ask = intent => { calls.push(['ask', intent]); emit({transcript: 'Ayuda: ' + intent}); };
  assistant.playSample = id => { calls.push(['playSample', id]); emit({speaking: true, transcript: 'Grabación ' + id, status: 'Reproduciendo grabación.'}); };
  assistant.repeat = () => calls.push(['repeat']); assistant.stop = () => { calls.push(['stop']); emit({listening: false, speaking: false, status: 'Detenido.'}); }; assistant.listen = () => { calls.push(['listen']); emit({listening: true, status: 'Escuchando.'}); };
  const panel = new Panel({assistant, context: ctx, document}); panel.mount(header);
  return {panel, assistant, emit, ctx, document, header, canvases, obstacles, calls, controllers, head, subscribers};
}
const count = (f, method) => f.calls.filter(call => call[0] === method).length;
function point(panel, key) { const region = panel.regions.find(value => value.key === key); assert(region, 'Missing XR control: ' + key); return {object: panel.xrPanel, distance: 1, uv: new THREE.Vector2((region.x + region.width / 2) / panel.xrCanvas.width, 1 - (region.y + region.height / 2) / panel.xrCanvas.height)}; }
function aim(f, controller, hit) {
  const mesh = hit.object, size = mesh.geometry.parameters; mesh.updateWorldMatrix(true, false);
  const target = mesh.localToWorld(new THREE.Vector3((hit.uv.x - .5) * size.width, (hit.uv.y - .5) * size.height, 0)), normal = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.getWorldQuaternion(new THREE.Quaternion()));
  controller.position.copy(target).addScaledVector(normal, .6); controller.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(controller.position, target, new THREE.Vector3(0, 1, 0))); f.ctx.scene.updateMatrixWorld(true);
}

const f = harness(), {panel, ctx, document} = f;
assert.equal(panel.opened, false); assert.equal(panel.element.hidden, true); assert.equal(f.header.children[0], panel.launcher); assert.equal(f.canvases.length, 0, 'Mounting desktop controls allocates no XR surface.'); assert.equal(f.calls.length, 0, 'Mounting the panel cannot enable audio or ask for a microphone.');
const closedKey = document.fire('keydown', {key: 'w'}); assert.equal(closedKey.stopped, false, 'Closed voice controls do not intercept walking.');
panel.launcher.fire('pointerdown'); assert.equal(panel.opened, false); panel.launcher.fire('click');
assert.equal(panel.opened, true); assert.equal(ctx.voicePanelOpen, true); assert.equal(panel.element.hidden, false); assert.equal(count(f, 'unlock'), 1); assert.equal(count(f, 'reset'), 1);
assert.equal(document.activeElement, panel.closeButton); assert.equal(panel.element.fire('keydown', {key: 'w'}).stopped, true, 'Typing and native controls cannot leak into locomotion.');
panel.controls.enabled.fire('click'); assert.equal(panel.controls.enabled.getAttribute('aria-pressed'), 'true');
panel.controls.automatic.checked = true; panel.controls.automatic.fire('change'); assert.equal(f.assistant.state().automatic, true);
panel.controls.voice.value = 'es-1'; panel.controls.voice.fire('change'); assert.equal(f.assistant.state().voiceId, 'es-1');
panel.controls.volume.value = '.35'; panel.controls.volume.fire('input'); panel.controls.rate.value = '1.25'; panel.controls.rate.fire('input'); assert.equal(f.assistant.state().volume, .35); assert.equal(f.assistant.state().rate, 1.25);
const firstVoice = panel.controls.voice.firstChild, firstSample = panel.controls.sample.firstChild;
f.emit({status: 'Listo para consultar.'}); assert.equal(panel.controls.voice.firstChild, firstVoice); assert.equal(panel.controls.sample.firstChild, firstSample, 'Status updates preserve native select options and focus.');
f.emit({voiceId:'missing-saved-voice',voices:[]});assert.equal(panel.controls.voice.value,'auto','A missing saved voice must display the effective automatic fallback.');assert.equal(f.assistant.state().voiceId,'missing-saved-voice','A temporarily absent system voice does not erase the saved preference.');
f.emit({voiceId:'es-1',voices:[{id:'es-1',name:'Voz española',lang:'es-ES'}]});
for (const intent of ['next', 'objective', 'controls', 'content']) panel.controls[intent].fire('click'); assert.deepEqual(f.calls.filter(call => call[0] === 'ask').map(call => call[1]), ['next', 'objective', 'controls', 'content']);
assert.equal(panel.caption.textContent, 'Ayuda: content'); panel.controls.repeat.fire('click'); assert.equal(count(f, 'repeat'), 1);
panel.controls.sample.value = 'sample-5'; panel.controls.sample.fire('change'); panel.controls.samplePlay.fire('click'); assert.deepEqual(f.calls[f.calls.length - 1], ['playSample', 'sample-5']);
panel.controls.stop.fire('click'); assert.equal(panel.controls.stop.disabled, true); assert.equal(panel.status.textContent, 'Detenido.');
panel.controls.mic.fire('click'); assert.equal(panel.controls.mic.getAttribute('aria-pressed'), 'true'); panel.controls.mic.fire('click'); assert.equal(f.assistant.state().listening, false);
f.emit({speechSupported: false, recognitionSupported: false, error: '', speaking: false, listening: false, status: 'Solo subtítulos disponibles.', transcript: 'Avanza cuando el pasillo esté libre.'});
assert.equal(panel.controls.voice.disabled, true); assert.equal(panel.controls.mic.disabled, true); assert.match(panel.hint.textContent, /subtítulos/); assert.equal(panel.status.textContent, 'Solo subtítulos disponibles.'); assert.equal(panel.caption.textContent, 'Avanza cuando el pasillo esté libre.'); assert.equal(panel.controls.samplePlay.disabled, false);
f.emit({samples: []}); assert.equal(panel.controls.sample.disabled, true); assert.equal(panel.controls.samplePlay.disabled, true);
f.obstacles['.vehicle-docking-monitor'] = {hidden: false, getBoundingClientRect: () => ({left: 750, right: 1428, top: 76, bottom: 410, width: 678, height: 334})};
f.obstacles['.vehicle-guidance-panel'] = {hidden: false, getBoundingClientRect: () => ({left: 12, right: 372, top: 76, bottom: 180, width: 360, height: 104})};
panel.placeDesktop(); assert.equal(panel.element.style.right, '702px', 'Desktop panel fits between the guidance and camera without moving either.');
document.defaultView.innerWidth = 390; document.defaultView.innerHeight = 844; f.obstacles['.vehicle-docking-monitor'].getBoundingClientRect = () => ({left: 8, right: 382, top: 116, bottom: 380, width: 374, height: 264}); f.obstacles['.vehicle-guidance-panel'].getBoundingClientRect = () => ({left: 8, right: 382, top: 66, bottom: 110, width: 374, height: 44});
document.defaultView.fire('resize'); assert.equal(panel.element.style.top, '392px'); assert.equal(panel.element.style.maxHeight, '440px');
panel.element.fire('keydown', {key: 'Escape'}); assert.equal(ctx.voicePanelOpen, false); assert.equal(document.activeElement, panel.launcher); assert.equal(panel.element.hidden, true);

f.emit({speechSupported: true, recognitionSupported: true, samples: Array.from({length: 6}, (_, i) => ({id: 'clip-' + i, label: 'Clip ' + i})), transcript: 'Conduce con cuidado.'});
ctx.vrMode = true; ctx.renderer.xr.isPresenting = true; panel.step(.016); assert.equal(panel.launcher.hidden, true); assert.equal(panel.opened, false); assert.equal(f.canvases.length, 1, 'XR allocates only the tiny launcher, with no expanded panel.');
assert.equal(ctx.voicePanelOpen, false); assert.equal(panel.xrCanvas.width, 512); assert.equal(panel.xrCanvas.height, 160); assert.equal(panel.xrPanel.visible, true);
assert(Math.abs(panel.xrPanel.geometry.parameters.width * panel.xrPanel.scale.x - .25) < 1e-10); assert(Math.abs(panel.xrPanel.geometry.parameters.height * panel.xrPanel.scale.y - .078125) < 1e-10);
assert.equal(panel.regions.length, 1); assert.equal(panel.regions[0].key, 'launcher'); assert.equal(panel.xrState.voiceAssistantPanel, true); assert.equal(panel.xrState.xrMenu, true);
assert(Math.abs(panel.xrPanel.position.x - (f.head.position.x - .65)) < 1e-8); assert(Math.abs(panel.xrPanel.position.y - (f.head.position.y + .25)) < 1e-8);
const launcherResource = {mesh: panel.xrPanel, canvas: panel.xrCanvas, texture: panel.xrTexture, material: panel.xrPanel.material};
const cameraPosition = ctx.camera.position.clone(), cameraQuaternion = ctx.camera.quaternion.clone(), headPosition = f.head.position.clone(), headQuaternion = f.head.quaternion.clone();
let launcherHit = point(panel, 'launcher'); aim(f, f.controllers[0].controller, launcherHit); ctx.raycontrol.execute(ctx, .016, 1); assert.equal(f.controllers[0].data.currentIntersection.state, panel.xrState); ctx.raycontrol.onSelectStart({target: f.controllers[0].controller}); ctx.raycontrol.onSelectEnd({target: f.controllers[0].controller});
assert.equal(panel.opened, true); assert.equal(ctx.voicePanelOpen, true); assert.equal(panel.element.hidden, true); assert.equal(f.canvases.length, 1); assert.equal(panel.xrCanvas.width, 896); assert.equal(panel.xrCanvas.height, 1024); assert.equal(panel.xrTexture.generateMipmaps, false);
assert.equal(panel.xrPanel, launcherResource.mesh); assert.equal(panel.xrCanvas, launcherResource.canvas); assert.equal(panel.xrTexture, launcherResource.texture); assert.equal(panel.xrPanel.material, launcherResource.material, 'Opening the XR launcher reuses all GPU surfaces.');
assert.equal(panel.xrPanel.parent, ctx.scene); assert.equal(panel.xrPanel.geometry.parameters.width, .98); assert.equal(panel.xrPanel.geometry.parameters.height, 1.12); assert.equal(panel.xrPanel.material.depthTest, false); assert.equal(panel.xrState.controller, 'both');
assert(ctx.camera.position.equals(cameraPosition) && ctx.camera.quaternion.equals(cameraQuaternion)); assert(f.head.position.equals(headPosition) && f.head.quaternion.equals(headQuaternion), 'Opening XR voice controls never changes headset or camera pose.');
assert(Math.abs(panel.xrPanel.position.y - (f.head.position.y - .08)) < 1e-8, 'Panel is placed from the current XR head pose.');
const stationary = panel.xrPanel.position.clone(); f.head.position.x += .2; f.head.updateMatrixWorld(true); panel.step(.016); assert(panel.xrPanel.position.equals(stationary), 'The opened panel remains fixed in world space.');
assert.equal(panel.validXR({...point(panel, 'next'), object: new THREE.Group()}, f.controllers[0].controller), false); assert.equal(panel.validXR({...point(panel, 'next'), distance: 8}, f.controllers[0].controller), false);
const beforeQueries = count(f, 'ask');
for (const {controller} of f.controllers) { const hit = point(panel, 'next'); aim(f, controller, hit); ctx.raycontrol.execute(ctx, .016, 1); assert.equal(f.controllers.find(value => value.controller === controller).data.currentIntersection.state, panel.xrState); ctx.raycontrol.onSelectStart({target: controller}); ctx.raycontrol.onSelectEnd({target: controller}); }
assert.equal(count(f, 'ask'), beforeQueries + 2, 'Both controller rays select the real canvas regions.');
let hit = point(panel, 'sampleNext'); panel.pressXR(hit, f.controllers[0].controller); panel.releaseXR(f.controllers[0].controller); panel.step(.016); assert.equal(panel.sampleId, 'clip-1');
hit = point(panel, 'samplePlay'); panel.pressXR(hit, f.controllers[1].controller); panel.releaseXR(f.controllers[1].controller); assert.deepEqual(f.calls[f.calls.length - 1], ['playSample', 'clip-1']);
panel.close(); assert.equal(panel.xrPanel.visible, true); assert(ctx.raycontrol.currentStates.includes(panel.xrState)); assert.equal(panel.regions.length, 1); assert.equal(panel.regions[0].key, 'launcher'); assert.equal(ctx.voicePanelOpen, false); assert.equal(panel.xrCanvas.width, 512); assert.equal(panel.xrPanel, launcherResource.mesh);
const launcherFollow = panel.xrPanel.position.clone(); f.head.position.x += .1; f.head.updateMatrixWorld(true); panel.step(.016); assert.notEqual(panel.xrPanel.position.x, launcherFollow.x, 'The small launcher stays accessible beside the head while closed.');
const samplesBeforeLauncher = count(f, 'playSample'), queriesBeforeLauncher = count(f, 'ask'); launcherHit = point(panel, 'launcher'); panel.pressXR(launcherHit, f.controllers[1].controller); panel.releaseXR(f.controllers[1].controller); assert.equal(panel.opened, true); assert.equal(count(f, 'playSample'), samplesBeforeLauncher); assert.equal(count(f, 'ask'), queriesBeforeLauncher, 'Opening the launcher cannot trigger audio or a query.'); panel.close();
panel.open(); const resource = {mesh: panel.xrPanel, texture: panel.xrTexture, canvas: panel.xrCanvas}, disposed = [];
resource.mesh.geometry.addEventListener('dispose', () => disposed.push('geometry')); resource.mesh.material.addEventListener('dispose', () => disposed.push('material')); resource.texture.addEventListener('dispose', () => disposed.push('texture'));
ctx.vrMode = false; ctx.renderer.xr.isPresenting = false; panel.step(.016); assert.equal(panel.opened, false); assert.equal(panel.xrPanel, null); assert.equal(resource.mesh.parent, null); assert.deepEqual(disposed.sort(), ['geometry', 'material', 'texture']); assert.equal(resource.canvas.width, 1); assert.equal(ctx.raycontrol.states[panel.stateName], undefined);
for (let cycle = 0; cycle < 3; cycle++) { ctx.vrMode = true; ctx.renderer.xr.isPresenting = true; panel.step(.016); const mesh = panel.xrPanel; assert(mesh && mesh.parent === ctx.scene); assert.equal(panel.opened, false); assert.equal(ctx.voicePanelOpen, false); ctx.vrMode = false; ctx.renderer.xr.isPresenting = false; panel.step(.016); assert.equal(mesh.parent, null); assert.equal(panel.xrPanel, null); assert.equal(ctx.raycontrol.states[panel.stateName], undefined); }
const element = panel.element, launcher = panel.launcher; panel.dispose(); panel.dispose();
assert.equal(f.subscribers.size, 0); assert.equal(element.parentNode, null); assert.equal(launcher.parentNode, null); assert.equal(ctx.voicePanelOpen, false);
for (const node of [element, launcher, document, document.defaultView, ...Object.values(panel.controls)]) for (const listeners of node.listeners.values()) assert.equal(listeners.size, 0, 'Dispose removes every owned event listener.');
console.log('Voice assistant UI: native controls, subtitles/fallbacks, six sample choices, pointer release, responsive camera clearance, real dual XR rays, stable headset pose and complete resource cleanup passed.');
