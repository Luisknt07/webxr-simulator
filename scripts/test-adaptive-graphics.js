'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const quality = require('../shared/graphics-quality');
const source = fs.readFileSync(path.join(__dirname, '../src/lib/AdaptiveGraphics.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class AdaptiveGraphics', 'return class AdaptiveGraphics');
const Adaptive = new Function('quality', source)(quality);
function setup(options = {}) {
  const calls = [], listeners = new Map(), storage = new Map(), renderer = {ratio: 2, getPixelRatio() { return this.ratio; }, setPixelRatio(value) { this.ratio = value; calls.push(value); },
    domElement: {clientWidth: 1600, clientHeight: 1000, addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name)},
    xr: {isPresenting: false, setFramebufferScaleFactor() { throw new Error('r112 XR framebuffer stub must never be called.'); }, setFoveation() { throw new Error('Use the real session layer, never an absent manager API.'); }}};
  const controller = new Adaptive(renderer, Object.assign({window: {devicePixelRatio: 2, document: {hidden: false}}, navigator: {deviceMemory: 8, hardwareConcurrency: 8}, storage: {getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value)}}, options));
  return {controller, renderer, calls, listeners, storage};
}
function feed(controller, seconds, dt = 1 / 60, frame) { for (let elapsed = 0; elapsed < seconds; elapsed += dt) controller.tick(dt, frame); }

assert.equal(quality.initialTier({coarse: true}), 0); assert.equal(quality.initialTier({deviceMemory: 8, hardwareConcurrency: 8}), 1);
assert.equal(quality.ceilingFor('auto', {deviceMemory: 2}), 1);
for (const tier of quality.TIERS) {
  const low = quality.limitsFor(tier, {coarse: true, deviceMemory: 2});
  assert(low.maxPixels <= 800000 && low.shadowMapSize <= 512 && low.xrShadowMapSize <= 1024 && low.pointLights <= 2);
}
assert.equal(quality.targetFrameRate(true, {frameRate: 90}), 90); assert.equal(quality.targetFrameRate(true, null), 72);
assert.throws(() => quality.limitsFor('not-a-tier')); assert.throws(() => quality.ceilingFor('unsafe'));

const f = setup({mode: 'high'}), c = f.controller;
assert.equal(c.getStats().effectiveProfile, 'high'); assert(f.renderer.ratio <= 2 && 1600 * 1000 * f.renderer.ratio * f.renderer.ratio <= 4000000.01);
c.setViewport(3840, 2160, 3); assert(3840 * 2160 * f.renderer.ratio * f.renderer.ratio <= 4000000.01);
feed(c, 15, .2, {loading: true}); assert.equal(c.getStats().effectiveProfile, 'high'); assert.equal(c.getStats().frameMs, null);
feed(c, 4); c.tick(2); feed(c, 1); assert.equal(c.getStats().effectiveProfile, 'high', 'An isolated post-loading spike does not lower quality.');
feed(c, 12, 1 / 30); assert.equal(c.getStats().effectiveProfile, 'economy'); assert.equal(c.getMode(), 'high', 'Pressure lowers the effective tier below the selected ceiling without rewriting the preference.');
feed(c, 36); assert.equal(c.getStats().effectiveProfile, 'balanced', 'Quality recovers slowly after sustained healthy frame pacing.');
feed(c, 40); assert.equal(c.getStats().effectiveProfile, 'high'); feed(c, 45); assert.equal(c.getStats().effectiveProfile, 'high', 'Healthy trials never exceed the selected high ceiling.');
c.setMode('economy'); feed(c, 90); assert.equal(c.getStats().effectiveProfile, 'economy'); assert.equal(f.storage.get('hello-webxr.graphics-mode.v1'), 'economy');

const xr = setup({mode: 'high'}), layer = {fixedFoveation: .25}, session = {frameRate: 90, renderState: {baseLayer: layer}}, beforeXR = xr.calls.length;
xr.controller.tick(1 / 90, {xr: true, session}); assert.equal(xr.controller.getStats().targetFPS, 90); assert.equal(layer.fixedFoveation, .2);
xr.controller.setViewport(3000, 2000, 3); xr.controller.setMode('economy'); feed(xr.controller, 5, 1 / 90, {xr: true, session});
assert.equal(xr.calls.length, beforeXR, 'Changing mode or viewport never changes the desktop pixel ratio while XR owns presentation.'); assert.equal(layer.fixedFoveation, .65);
xr.controller.tick(1 / 60, {xr: false}); assert.equal(layer.fixedFoveation, .25, 'Ending XR restores the actual session layer preference.'); assert(xr.calls.length > beforeXR);
const readOnly = {}; Object.defineProperty(readOnly, 'fixedFoveation', {get: () => .25});
xr.controller.tick(1 / 90, {xr: true, session: {frameRate: 90, renderState: {baseLayer: readOnly}}}); assert.equal(xr.controller.getStats().foveationSupported, false);
xr.controller.tick(1 / 90, {xr: true, session: {frameRate: 90, renderState: {baseLayer: {fixedFoveation: null}}}}); assert.equal(xr.controller.getStats().foveationSupported, false);
xr.controller.tick(1 / 60, {xr: false}); xr.controller.dispose(); assert.equal(xr.renderer.ratio, 2); assert.equal(xr.listeners.size, 0);

let notified = 0; const unsubscribe = c.subscribe(() => notified++); assert.equal(notified, 1);
f.listeners.get('webglcontextlost')({preventDefault() {}}); const lostCount = f.calls.length; c.setViewport(800, 600, 1); feed(c, 5); assert.equal(f.calls.length, lostCount); assert.equal(c.getStats().status, 'context-lost');
f.listeners.get('webglcontextrestored')(); assert.equal(c.getStats().status, 'warming-up'); assert(f.calls.length > lostCount); unsubscribe(); c.dispose(); assert.equal(f.renderer.ratio, 2);
const restored = setup({storage: {getItem: () => 'ultra', setItem() {}}}); assert.equal(restored.controller.getMode(), 'ultra'); restored.controller.dispose();
console.log('Adaptive graphics: pure device/resource ceilings, actual pixel budgets, startup/hidden/loading rejection, sustained pressure and slow recovery, persistent local mode, XR refresh/foveation feature detection without manager stubs or pixel-ratio changes, context recovery and exact renderer restoration passed.');
