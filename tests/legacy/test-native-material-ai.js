const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const load = (file, name, args) => new Function(...Object.keys(args), fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-native-material-ai.js"), '../' + file)), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class ' + name, 'return class ' + name))(...Object.values(args));
const MaterialAI = load("packages/tools/ai/src/NativeMaterialAI.js", 'NativeMaterialAI', {}), Prepared = load("packages/render-three/src/PreparedMaterialTextures.js", 'PreparedMaterialTextures', {THREE});
const flush = () => new Promise(resolve => setImmediate(resolve));
async function run() {
  let tier = 'high', calls = 0, resolve, aborted = false; const suspended = [], resumed = [], images = [];
  const ctx = {editor: {roomId: 'hall', projectGeneration: 1}, graphics: {getLimits: () => ({tier, maxAnisotropy: 2}), getStats: () => ({contextLost: false})}, renderer: {xr: {isPresenting: false}, capabilities: {getMaxAnisotropy: () => 4}}};
  ctx.nativeTextureAI = {getStats: () => ({workerActive: !!resolve}), suspend(reason) { suspended.push(reason); }, resume(reason) { resumed.push(reason); },
    enhance(image, options) { calls++; assert.equal(options.tile, true); assert.equal(options.maxInputEdge, 192); assert.equal(image, ctx.preparedMaterials.current.texture.image); return new Promise(done => { resolve = done; options.signal.addEventListener('abort', () => { aborted = true; done(null); }, {once: true}); }); }};
  const canvas = edge => ({width: edge, height: edge, getContext: () => ({drawImage() {}, getImageData: () => ({data: new Uint8Array([100, 120, 140, 255])})})});
  const prepared = ctx.preparedMaterials = new Prepared(ctx, {loadImage: async () => { const image = {width: 256, height: 256}; images.push(image); return image; }, createCanvas: canvas});
  const ai = new MaterialAI(ctx); assert.equal(ai.getStats().canEnhance, false);
  const refs = [], ticket = prepared.acquireConcrete(value => refs.push(value)); await ticket.ready; assert(ai.getStats().canEnhance);
  const original = prepared.current, before = original.mean.toArray();
  let notifications = 0; const unsubscribe = ai.subscribe(() => notifications++); const pending = ai.enhance(); assert.equal(ai.status, 'working'); assert.equal(prepared.current, original, 'The original stays visible while inference runs.');
  assert.equal(await ai.enhance(), false); assert.equal(calls, 1, 'One model job only.');
  resolve({canvas: canvas(576), width: 576, height: 576, stats: {inferenceMs: 23}}); assert.equal(await pending, true); assert(prepared.enhancedImage); assert.equal(ai.status, 'ready'); assert.equal(prepared.current.edge, 1024); assert.deepEqual(prepared.current.mean.toArray(), before); assert.equal(prepared.getStats().source, 'browser-ai-concrete-v1');
  tier = 'economy'; await prepared.update(); assert.equal(prepared.current.edge, 256, 'An AI result still obeys the active GPU texture budget.'); assert.equal(prepared.getStats().estimatedGpuBytes, 256 * 256 * 4 * 4 / 3);
  assert.equal(await ai.enhance(), false, 'The UI does not repeatedly sharpen its previous model output.');
  ai.restore(); await flush(); assert.equal(prepared.enhancedImage, null); assert(ai.getStats().canEnhance); assert.equal(prepared.getStats().source, 'offline-prepared-concrete-v1');
  const cancelling = ai.enhance(); ctx.xrEntryPending = true; ai.tick(); assert(aborted); assert.equal(await cancelling, false); assert.equal(prepared.enhancedImage, null); assert.deepEqual(suspended, ['app-unavailable']);
  for (let index = 0; index < 100; index++) ai.tick(); assert.equal(suspended.length, 1, 'No repeated worker/UI updates on each XR frame.'); assert.equal(await ai.enhance(), false);
  ctx.xrEntryPending = false; ai.tick(); assert.deepEqual(resumed, ['app-unavailable']); assert(ai.getStats().canEnhance, 'Leaving VR resumes the same suspension reason.');
  const stale = ai.enhance(); ctx.editor.projectGeneration++; ai.tick(); assert.equal(await stale, false); assert.equal(prepared.enhancedImage, null);
  const failed = ai.enhance(); resolve(null); assert.equal(await failed, false); assert.equal(ai.status, 'fallback'); assert.equal(prepared.getStats().source, 'offline-prepared-concrete-v1');
  const success = ai.enhance(); resolve({canvas: canvas(576), width: 576, height: 576}); assert(await success); ticket.release(); ai.tick(); assert.equal(ai.status, 'available'); assert.equal(ai.result, null); assert.equal(prepared.enhancedImage, null); assert.equal(prepared.current, null);
  assert(notifications > 4); unsubscribe(); ai.dispose(); prepared.dispose();
  console.log('Native material AI: actual prepared-image application/restoration, GPU tier caps, one job, XR-entry and project cancellation, no per-frame worker notifications, failure fallback and room-release cleanup passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
