'use strict';
// Real Three.js/RayControl and VRButton; only the headset session and DOM are
// adapters. Exit must dispatch the ordinary session-end lifecycle.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const source = fs.readFileSync(path.join(__dirname, 'test-immersive-studio-menu.js'), 'utf8');
const boundary = source.indexOf('async function run()'); assert(boundary > 0);
const {harness, aim, toggleMenu} = new Function('require', '__dirname', source.slice(0, boundary) + '\nreturn {harness, aim, toggleMenu};')(require, __dirname);
const vrSource = fs.readFileSync(path.join(__dirname, '../src/lib/VRButton.js'), 'utf8').replace('export { VRButton };', 'return VRButton;');
const settle = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; };

async function setup() {
  const f = harness(), events = [], xr = new THREE.EventDispatcher(), session = new THREE.EventDispatcher();
  f.ctx.vrMode = false; f.ctx.renderer.xr = xr; xr.isPresenting = false;
  xr.getSession = () => xr.session; xr.setReferenceSpaceType = () => {};
  xr.setSession = value => { xr.session = value; xr.isPresenting = true; xr.dispatchEvent({type: 'sessionstart'}); };
  session.requestReferenceSpace = async type => ({type}); session.endCalls = 0;
  session.end = async () => { session.endCalls++; if (session.refuse) throw new Error('Device refused end'); if (session.wait) await session.wait; session.dispatchEvent({type: 'end'}); };
  const document = {createElement() { return {style: {}, setAttribute() {}, removeAttribute() {}}; }};
  const navigator = {xr: {isSessionSupported: async () => true, requestSession: async () => session}};
  const VRButton = new Function('navigator', 'document', 'window', vrSource)(navigator, document, {isSecureContext: true});
  const button = VRButton.createButton(f.ctx.renderer, status => {
    events.push(status); f.ctx.vrMode = status === 'sessionStarted';
    f.menu.setVR(f.ctx.vrMode);
    if (!f.ctx.vrMode) { xr.session = null; xr.isPresenting = false; }
  });
  await settle(); await button.onclick(); toggleMenu(f, 0);
  assert(f.ctx.vrMode && f.menu.opened); assert.deepEqual(events, ['sessionStarted']);
  async function clickExit(hand = 1) {
    f.menu.tick(.016); const region = f.menu.regions.find(value => value.key === 'exit-vr');
    assert(region && !region.disabled, 'Exit is reachable from the real canvas hit region.');
    const target = f.controls[hand]; aim(f, target.controller, f.menu.panel, (region.x + region.width / 2) / 1024, 1 - (region.y + region.height / 2) / 960);
    f.ctx.raycontrol.execute(f.ctx, .016, .5);
    assert.equal(f.menu.regionAt(target.data.currentIntersection.intersection).key, 'exit-vr');
    f.ctx.raycontrol.onSelectStart({target: target.controller}); f.ctx.raycontrol.onSelectEnd({target: target.controller}); await settle();
  }
  return {f, events, xr, session, button, clickExit};
}

async function run() {
  const valid = await setup();
  for (const page of ['home', 'account', 'register', 'settings', 'controls']) {
    valid.f.menu.navigate(page); valid.f.menu.busy = true; valid.f.menu.tick(.016);
    const exit = valid.f.menu.regions.find(region => region.key === 'exit-vr');
    assert(exit && !exit.disabled && exit.y >= 0 && exit.y + exit.height <= 960, 'Every page keeps exit available, even while account work is busy.');
  }
  valid.f.menu.fields.password = 'disposable-exit-fixture'; await valid.clickExit(0);
  assert.equal(valid.session.endCalls, 1); assert.deepEqual(valid.events, ['sessionStarted', 'sessionEnded']);
  assert.equal(valid.button.textContent, 'Entrar en VR'); assert.equal(valid.button.disabled, false);
  assert.equal(valid.f.ctx.vrMode, false); assert.equal(valid.f.ctx.studioMenuOpen, false);
  assert.equal(valid.f.menu.group, null); assert.equal(valid.f.menu.fields.password, ''); assert.equal(valid.xr.getSession(), null); assert.equal(Boolean(valid.f.ctx.xrExitPending), false); valid.f.menu.dispose();

  const refused = await setup(); refused.session.refuse = true; refused.f.menu.busy = true;
  await refused.clickExit();
  assert.equal(refused.f.ctx.vrMode, true); assert(refused.f.menu.opened); assert.equal(refused.f.menu.exiting, false);
  assert.match(refused.f.menu.error, /reintent/i); assert.deepEqual(refused.events, ['sessionStarted']); assert.equal(Boolean(refused.f.ctx.xrExitPending), false);
  refused.session.refuse = false; await refused.clickExit(0);
  assert.equal(refused.session.endCalls, 2); assert.deepEqual(refused.events, ['sessionStarted', 'sessionEnded']); refused.f.menu.dispose();

  const pending = await setup(), end = deferred(); pending.session.wait = end.promise;
  await pending.clickExit(0); assert.equal(pending.f.menu.exiting, true); assert.equal(pending.f.ctx.vrMode, true); assert.equal(pending.f.ctx.xrExitPending, true, 'Locomotion and direct contact remain blocked while the headset is ending the session.');
  await pending.f.menu.exitVR(); assert.equal(pending.session.endCalls, 1, 'The second hand cannot issue a second end request while exit is pending.');
  end.resolve(); await settle(); assert.equal(pending.f.ctx.vrMode, false); assert.equal(pending.f.menu.group, null); pending.f.menu.dispose();

  for (const missing of [null, {}]) {
    const unavailable = await setup(); unavailable.xr.session = missing; await unavailable.clickExit();
    assert.equal(unavailable.session.endCalls, 0); assert.equal(unavailable.f.ctx.vrMode, true); assert(unavailable.f.menu.opened);
    assert.match(unavailable.f.menu.error, /sesión.*activa/i); unavailable.f.menu.dispose();
  }
  console.log('VR menu exit: real controller rays and VRButton session-end lifecycle, every page/busy state, single pending exit, rejection/retry, missing session, desktop state and resource/credential cleanup passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
