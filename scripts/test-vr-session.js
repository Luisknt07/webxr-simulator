'use strict';
// Session requests, floor negotiation and the actual entry guards run without
// a physical headset. The browser XR and DOM boundaries are controlled adapters.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const studioSchema = require('../shared/studio-document.js');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
function session(options = {}) {
  const target = new THREE.EventDispatcher(); target.requests = []; target.ended = 0;
  target.requestReferenceSpace = async type => {
    target.requests.push(type);
    if (options.floor === false && type === 'local-floor') throw new Error('No floor support');
    return {type};
  };
  target.end = async () => {
    target.ended++;
    if (options.endFailure) throw new Error('Device refused end');
    target.dispatchEvent({type: 'end'});
  };
  return target;
}
async function setup(options = {}) {
  const elements = [], events = [], assigned = [], requests = [];
  const document = {location: {href: 'https://localhost/'}, createElement(tag) {
    const element = {tagName: tag.toUpperCase(), style: {}, attrs: {}, disabled: false,
      setAttribute(key, value) { this.attrs[key] = value; }, removeAttribute(key) { delete this.attrs[key]; }};
    elements.push(element); return element;
  }};
  const navigator = options.noXR ? {} : {xr: {
    isSessionSupported: async () => { if (options.supportFailure) throw new Error('XR policy'); return options.supported !== false; },
    requestSession(type, init) { requests.push({type, init}); return options.request ? options.request() : Promise.resolve(session(options)); }
  }};
  const renderer = {xr: {setReferenceSpaceType(type) { renderer.space = type; }, setSession(value) {
    assigned.push(value); if (options.assignFailure) throw new Error('WebGL unavailable');
  }}};
  const text = fs.readFileSync(path.join(__dirname, '../src/lib/VRButton.js'), 'utf8').replace('export { VRButton };', 'return VRButton;');
  const button = new Function('navigator', 'document', 'window', text)(navigator, document, {isSecureContext: options.insecure !== true})
    .createButton(renderer, (type, info) => events.push({type, info}), options.canStart);
  await tick();
  return {button, events, renderer, assigned, requests};
}
function productionHelpers(context) {
  const text = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');
  const names = ['keepRoomOnVREntry', 'canStartVR', 'setVRFloorOffset'];
  const declarations = names.map(name => {
    const found = text.match(new RegExp('function ' + name + '\\([^]*?\\n\\}'));
    assert(found, 'Missing production XR helper ' + name); return found[0];
  });
  return new Function('context', 'studioSchema', declarations.join('\n') + '\nreturn {' + names.join(',') + '};')(context, studioSchema);
}
async function run() {
  const pending = deferred(), f = await setup({request: () => pending.promise});
  const first = f.button.onclick(); assert.equal(f.requests.length, 1, 'requestSession runs inside the original user action');
  assert.equal(f.button.disabled, true); assert.equal(f.button.attrs['aria-busy'], 'true');
  await f.button.onclick(); assert.equal(f.requests.length, 1, 'Rapid clicks cannot open two immersive sessions');
  const live = session(); pending.resolve(live); await first;
  assert.deepEqual(f.events, [{type: 'sessionStarted', info: {referenceSpaceType: 'local-floor'}}]);
  assert.equal(f.renderer.space, 'local-floor'); assert.equal(f.assigned[0], live);
  assert.equal(f.button.disabled, false); assert.equal(f.button.textContent, 'Salir de VR');
  await f.button.onclick(); assert.equal(live.ended, 1); assert.equal(f.events.at(-1).type, 'sessionEnded');
  assert.equal(f.button.textContent, 'Entrar en VR'); assert.equal(f.button.disabled, false);
  live.dispatchEvent({type: 'end'}); assert.equal(f.events.length, 2, 'Repeated session-end events cannot repeat desktop restoration');

  const fallback = await setup({floor: false}); await fallback.button.onclick();
  assert.deepEqual(fallback.assigned[0].requests, ['local-floor', 'local']);
  assert.equal(fallback.renderer.space, 'local'); assert.equal(fallback.events[0].info.referenceSpaceType, 'local');
  fallback.assigned[0].dispatchEvent({type: 'end'}); assert.equal(fallback.events.at(-1).type, 'sessionEnded', 'Headset-driven exit restores desktop controls');

  const denied = await setup({request: () => Promise.reject(new Error('Permission denied'))});
  await denied.button.onclick(); assert.equal(denied.button.disabled, false); assert.equal(denied.button.textContent, 'Reintentar VR'); assert.deepEqual(denied.events, []);
  const syncDenied = await setup({request: () => { throw new Error('Synchronous request failure'); }});
  await syncDenied.button.onclick(); assert.equal(syncDenied.button.disabled, false); assert.deepEqual(syncDenied.events, []);
  const broken = await setup({assignFailure: true}); await broken.button.onclick();
  assert.equal(broken.assigned[0].ended, 1, 'An unrenderable session is closed instead of stranding the headset');
  assert.deepEqual(broken.events, []); assert.equal(broken.button.disabled, false);
  const failedEnd = await setup({endFailure: true}); await failedEnd.button.onclick(); await failedEnd.button.onclick();
  assert.equal(failedEnd.button.disabled, false); assert.equal(failedEnd.events.length, 1); assert.match(failedEnd.button.title, /salir de VR/);
  const gated = await setup({canStart: () => 'Termina de cargar el nivel.'}); await gated.button.onclick();
  assert.equal(gated.requests.length, 0); assert.equal(gated.button.title, 'Termina de cargar el nivel.');
  for (const options of [{supported: false}, {supportFailure: true}]) {
    const unavailable = await setup(options); assert.equal(unavailable.button.attrs['aria-disabled'], 'true'); assert.equal(unavailable.button.onclick, null);
  }
  const insecure = await setup({noXR: true, insecure: true}); assert.equal(insecure.button.href, 'https://localhost/');
  assert.equal(insecure.button.textContent, 'VR requiere HTTPS');
  const noXR = await setup({noXR: true}); assert.equal(noXR.button.attrs['aria-disabled'], 'true');

  const context = {cameraRig: new THREE.Group(), editor: {document: {}, toast() {}}};
  const helpers = productionHelpers(context);
  assert.equal(helpers.keepRoomOnVREntry(null, 'sound'), false);
  assert.equal(helpers.keepRoomOnVREntry(context.editor, 'sound'), false, 'Untouched native rooms retain the original hall entry');
  assert.equal(helpers.keepRoomOnVREntry({currentProject: {id: 'saved'}}, 'sound'), true);
  assert.equal(helpers.keepRoomOnVREntry({document: {studio: {scenes: [{id: 'sound', name: 'Nivel nuevo'}]}}}, 'sound'), true,
    'A new unsaved level remains selected when starting VR');
  assert.equal(helpers.keepRoomOnVREntry({document: {additions: new Map([['machine', {roomId: 'sound'}]])}}, 'sound'), true,
    'Unsaved equipment in a native room also remains selected');
  assert.equal(helpers.canStartVR(), true);
  for (const key of ['loadingProject', 'busy', 'importingFiles', 'pastingObject', 'creatingScene', 'pendingEdits']) {
    context.editor[key] = true; assert.equal(typeof helpers.canStartVR(), 'string', key + ' must finish before immersive entry'); delete context.editor[key];
  }
  context.editor.document.loading = true; assert.equal(typeof helpers.canStartVR(), 'string'); delete context.editor.document.loading;
  context.editor.document.transaction = {}; assert.equal(typeof helpers.canStartVR(), 'string'); delete context.editor.document.transaction;
  context.editor.transform = {dragging: true}; assert.equal(typeof helpers.canStartVR(), 'string'); delete context.editor.transform;
  context.roomTransition = true; assert.equal(typeof helpers.canStartVR(), 'string'); context.roomTransition = false;
  context.cameraRig.position.y = 2;
  helpers.setVRFloorOffset(true, 'local'); assert.equal(context.cameraRig.position.y, 3.6);
  helpers.setVRFloorOffset(true, 'local'); assert.equal(context.cameraRig.position.y, 3.6, 'A repeated mode update cannot accumulate head height');
  helpers.setVRFloorOffset(false); assert.equal(context.cameraRig.position.y, 2, 'Returning to desktop removes the simulated floor height');
  helpers.setVRFloorOffset(true, 'local-floor'); assert.equal(context.cameraRig.position.y, 2, 'Tracked floor height requires no offset');
  helpers.setVRFloorOffset(true, 'local'); context.cameraRig.position.y = 0;
  helpers.setVRFloorOffset(true, 'local', true); assert.equal(context.cameraRig.position.y, 1.6, 'An original room-entry rig reset restores local-reference eye height');
  helpers.setVRFloorOffset(false); assert.equal(context.cameraRig.position.y, 0);
  console.log('WebXR sessions: exclusive user-action requests, enter/exit/retry/denial, renderer cleanup, local-floor fallback and eye height, active unsaved level preservation, operation guards and desktop restoration passed (XR/DOM adapters).');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
