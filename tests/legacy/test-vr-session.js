const __layout = require("../../tooling/layout.cjs");
'use strict';
// Session requests, floor negotiation and the actual entry guards run without
// a physical headset. The browser XR and DOM boundaries are controlled adapters.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const studioSchema = require('../../packages/project-model/shared/studio-document.js');
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
  const renderer = options.renderer || {xr: {setReferenceSpaceType(type) { renderer.space = type; }, setSession(value) {
    assigned.push(value); if (options.assignFailure) throw new Error('WebGL unavailable');
  }}};
  const text = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-vr-session.js"), '../src/lib/VRButton.js')), 'utf8').replace('export { VRButton };', 'return VRButton;');
  const button = new Function('navigator', 'document', 'window', text)(navigator, document, {isSecureContext: options.insecure !== true})
    .createButton(renderer, (type, info) => events.push({type, info}), options.canStart, options.vrOptions);
  await tick();
  return {button, events, renderer, assigned, requests};
}
function productionHelpers(context) {
  const text = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-vr-session.js"), '../src/index.js')), 'utf8');
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

  function eventManager(mode = 'deferred') {
    const xr = new THREE.EventDispatcher(); xr.isPresenting = false;
    xr.setReferenceSpaceType = type => { xr.space = type; };
    xr.getSession = () => xr.session;
    xr.start = () => { xr.dispatchEvent({type: 'sessionstart'}); xr.isPresenting = true; };
    xr.setSession = value => {
      xr.session = value;
      if (mode === 'sync') xr.start();
      if (mode === 'reject') return Promise.reject(new Error('Async WebGL session setup failed'));
      // This is r112's real signature: undefined while reference-space setup
      // continues asynchronously and readiness arrives through sessionstart.
    };
    return {xr};
  }
  const actualManager = eventManager(), deferredStart = await setup({renderer: actualManager});
  const entering = deferredStart.button.onclick(); await tick();
  assert.equal(deferredStart.button.disabled, true); assert.deepEqual(deferredStart.events, [], 'A void setSession must not announce immersive readiness before the manager event.');
  const assignedSession = actualManager.xr.session; actualManager.xr.session = session(); actualManager.xr.start(); await tick();
  assert.deepEqual(deferredStart.events, [], 'Readiness from a different XR session is ignored.');
  actualManager.xr.isPresenting = false; actualManager.xr.session = assignedSession; actualManager.xr.start(); await entering;
  assert.equal(deferredStart.events[0].type, 'sessionStarted'); assert.equal(actualManager.xr._listeners.sessionstart.length, 0, 'The readiness listener is released after entry.');
  await assignedSession.end();
  const syncManager = eventManager('sync'), synchronousStart = await setup({renderer: syncManager}); await synchronousStart.button.onclick();
  assert.equal(synchronousStart.events[0].type, 'sessionStarted', 'Registering before assignment supports an immediate manager event.'); await syncManager.xr.session.end();
  const cancelledManager = eventManager(), cancelledStart = await setup({renderer: cancelledManager}); const cancellation = cancelledStart.button.onclick(); await tick(); await cancelledManager.xr.session.end(); await cancellation;
  assert.equal(cancelledManager.xr.session.ended, 1); assert.deepEqual(cancelledStart.events, []); assert.equal(cancelledStart.button.textContent, 'Entrar en VR');
  assert.equal(cancelledManager.xr._listeners.sessionstart.length, 0, 'Ending during setup removes readiness listeners and timers.');
  const timeoutManager = eventManager(), timedOut = await setup({renderer: timeoutManager, vrOptions: {sessionStartTimeoutMs: 10}}); await timedOut.button.onclick();
  assert.equal(timeoutManager.xr.session.ended, 1); assert.deepEqual(timedOut.events, []); assert.equal(timedOut.button.textContent, 'Reintentar VR'); assert.equal(timeoutManager.xr._listeners.sessionstart.length, 0);
  const rejectManager = eventManager('reject'), asyncFailure = await setup({renderer: rejectManager}); await asyncFailure.button.onclick();
  assert.equal(rejectManager.xr.session.ended, 1); assert.deepEqual(asyncFailure.events, []); assert.equal(asyncFailure.button.textContent, 'Reintentar VR');

  const rates = session(); rates.frameRate = 90; rates.supportedFrameRates = new Float32Array([72, 90, 120]); rates.rateRequests = [];
  rates.updateTargetFrameRate = rate => { rates.rateRequests.push(rate); return Promise.resolve(); };
  const requestedRate = await setup({request: () => Promise.resolve(rates), vrOptions: {preferredFrameRate: 72}}); await requestedRate.button.onclick();
  assert.deepEqual(rates.rateRequests, [72]); assert.equal(rates.frameRate, 90, 'Requesting a rate does not claim the runtime has applied it.'); await rates.end();
  for (const value of [undefined, 80, NaN, 15]) {
    rates.rateRequests = []; const safe = await setup({request: () => Promise.resolve(rates), vrOptions: {preferredFrameRate: value}}); await safe.button.onclick();
    assert.deepEqual(rates.rateRequests, [], 'Absent, invalid or unsupported preferences retain the runtime rate.'); await rates.end();
  }
  rates.updateTargetFrameRate = () => Promise.reject(new Error('Runtime refused optional rate'));
  const rateRejected = await setup({request: () => Promise.resolve(rates), vrOptions: {preferredFrameRate: 72}}); await rateRejected.button.onclick(); await tick();
  assert.equal(rateRejected.events[0].type, 'sessionStarted'); assert.equal(rateRejected.button.textContent, 'Salir de VR', 'A rejected optional frame-rate request never turns successful entry into failure.'); await rates.end();
  delete rates.updateTargetFrameRate; const unavailableRate = await setup({request: () => Promise.resolve(rates), vrOptions: {preferredFrameRate: 72}}); await unavailableRate.button.onclick(); assert.equal(unavailableRate.events[0].type, 'sessionStarted'); await rates.end();

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
  const insecurePolyfill = await setup({insecure: true}); assert.equal(insecurePolyfill.button.href, 'https://localhost/');
  assert.equal(insecurePolyfill.button.textContent, 'VR requiere HTTPS'); assert.deepEqual(insecurePolyfill.requests, [], 'An exposed/polyfilled navigator.xr never bypasses the secure-origin requirement.');
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
