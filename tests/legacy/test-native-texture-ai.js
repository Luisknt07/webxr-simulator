const __layout = require("../../tooling/layout.cjs");
'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto'), vm = require('node:vm');
const source = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-native-texture-ai.js"), '../src/lib/NativeTextureAI.js')), 'utf8').replace('export default class NativeTextureAI', 'return class NativeTextureAI');
const NativeAI = new Function(source)();
class Events { constructor() { this.events = new Map(); } addEventListener(name, callback) { if (!this.events.has(name)) this.events.set(name, new Set()); this.events.get(name).add(callback); } removeEventListener(name, callback) { this.events.get(name)?.delete(callback); } fire(name, event = {}) { this.events.get(name)?.forEach(callback => callback(event)); } }
function fixture() {
  const document = new Events(); document.hidden = false; const canvas = new Events(), xr = new Events(); xr.isPresenting = false;
  const ctx = {renderer: {domElement: canvas, xr}, editor: {document: {}}, vrMode: false}, workers = [];
  const canvasFactory = (width, height) => { const object = {width, height}; object.getContext = () => ({drawImage() {}, getImageData: () => ({data: new Uint8ClampedArray(width * height * 4).fill(100)}), createImageData: (w, h) => ({data: new Uint8ClampedArray(w * h * 4)}), putImageData: image => { object.pixels = image.data; }}); return object; };
  const ai = new NativeAI(ctx, {document, canvasFactory, workerFactory: url => { const worker = {url, terminated: false, postMessage(message, transfers) { this.message = message; this.transfers = transfers; }, terminate() { this.terminated = true; }}; workers.push(worker); return worker; }});
  const complete = worker => { const message = worker.message; worker.onmessage({data: {type: 'result', id: message.id, width: message.width * 3, height: message.height * 3, pixels: new Uint8ClampedArray(message.width * message.height * 36).fill(150).buffer, stats: {modelVerified: true}}}); };
  return {ai, ctx, document, canvas, xr, workers, complete};
}
async function lifecycle() {
  for (const prefix of ['/', '/webxr-simulator/']) {
    const deployed = fixture(); deployed.document.baseURI = 'https://local.test' + prefix;
    const request = deployed.ai.enhance({width: 16, height: 16});
    assert.equal(deployed.workers[0].url, 'https://local.test' + prefix + "packages/tools/ai/assets/native-texture-ai-worker.js");
    deployed.ai.dispose(); assert.equal(await request, null);
  }
  const f = fixture(), image = {width: 256, height: 256}; assert.equal(f.workers.length, 0, 'Loading the application does not load a neural runtime.');
  const result = f.ai.enhance(image, {maxInputEdge: 192, key: 'concrete', tile: true}), worker = f.workers[0]; assert.equal(worker.message.width, 192); assert.equal(worker.message.tile, true); assert.equal(worker.transfers.length, 1); assert.equal(worker.message.pixels.byteLength, 192 * 192 * 4); assert(f.ai.getStats().estimatedWorkingBytes <= 96 * 1024 * 1024);
  const coalesced = f.ai.enhance(image, {maxInputEdge: 192, key: 'concrete', tile: true}); assert.equal(coalesced, result); f.complete(worker); const value = await result; assert.equal(await coalesced, value); assert.equal(value.width, 576); assert.equal(value.canvas.pixels[0], 150); assert(worker.terminated); assert.equal(f.ai.getStats().workerActive, false);
  assert((await f.ai.enhance(image, {maxInputEdge: 192, key: 'concrete', tile: true})).cached); assert.equal(f.workers.length, 1);
  assert.equal(await f.ai.enhance(image, {maxInputEdge: 256, maxWorkingBytes: 80 * 1024 * 1024}), null, 'A neural input above the memory estimate ceiling is rejected before allocation.'); assert.equal(f.workers.length, 1);
  const waiting = f.ai.enhance(image, {key: 'vr'}); f.xr.isPresenting = true; f.xr.fire('sessionstart'); assert.equal(await waiting, null); assert(f.workers[1].terminated); assert.equal(await f.ai.enhance(image), null); f.xr.isPresenting = false; f.xr.fire('sessionend');
  const controller = new AbortController(), abort = f.ai.enhance(image, {signal: controller.signal}); controller.abort(); assert.equal(await abort, null); assert(f.workers.at(-1).terminated);
  const hidden = f.ai.enhance(image); f.document.hidden = true; f.document.fire('visibilitychange'); assert.equal(await hidden, null); f.document.hidden = false; f.document.fire('visibilitychange');
  const lost = f.ai.enhance(image); f.canvas.fire('webglcontextlost'); assert.equal(await lost, null); f.canvas.fire('webglcontextrestored');
  const transition = f.ai.enhance(image); f.ctx.roomTransition = true; f.ai.sync(); assert.equal(await transition, null); f.ctx.roomTransition = false;
  const malformed = f.ai.enhance(image), bad = f.workers.at(-1); bad.onmessage({data: {type: 'result', id: bad.message.id, width: 100000, height: 100000, pixels: new ArrayBuffer(1)}}); assert.equal(await malformed, null); assert(bad.terminated);
  const failed = f.ai.enhance(image); f.workers.at(-1).onerror({preventDefault() {}}); assert.equal(await failed, null);
  const timeout = f.ai.enhance(image, {timeoutMs: 1000}); assert.equal(await timeout, null); assert.equal(f.ai.getStats().status, 'timeout');
  const pending = f.ai.enhance(image); f.ai.dispose(); assert.equal(await pending, null); assert.equal(await f.ai.enhance(image), null); assert.equal(f.document.events.get('visibilitychange').size, 0); assert.equal(f.xr.events.get('sessionstart').size, 0); assert.equal(f.canvas.events.get('webglcontextlost').size, 0); assert.deepEqual(image, {width: 256, height: 256});
}
async function preprocess(prefix = '') {
  const bytes = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-native-texture-ai.js"), '../assets/ai/models/super-resolution-espcn-x3-dynamic.onnx'))), buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); const messages = []; let captured;
  class Tensor { constructor(type, data, dims) { this.data = data; this.dims = dims; } dispose() {} }
  const base = 'https://local.test' + prefix + '/assets/ai/';
  const context = {ArrayBuffer, Uint8Array, Uint8ClampedArray, Float32Array, URL, performance, console, crypto: crypto.webcrypto, fetch: async url => { assert.equal(url, base + 'models/super-resolution-espcn-x3-dynamic.onnx'); return {ok: true, arrayBuffer: async () => buffer}; }, importScripts: url => { assert(url.startsWith(base + 'onnxruntime-1.30.0/')); }, ort: {env: {wasm: {}}, Tensor, InferenceSession: {create: async () => ({inputNames: ['input'], outputNames: ['output'], async run(feed) { captured = feed.input; const width = captured.dims[3], height = captured.dims[2], data = new Float32Array(width * height * 9); for (let row = 0; row < height * 3; row++) for (let column = 0; column < width * 3; column++) { const border = row < 15 || row >= height * 3 - 15 || column < 15 || column >= width * 3 - 15; data[row * width * 3 + column] = border ? 0 : captured.data[Math.floor(row / 3) * width + Math.floor(column / 3)]; } return {output: new Tensor('float32', data, [1, 1, height * 3, width * 3])}; }, async release() {} })}}};
  context.self = {location: {href: base + 'native-texture-ai-worker.js'}, crypto: context.crypto, postMessage: message => messages.push(message)};
  vm.runInNewContext(fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-native-texture-ai.js"), '../assets/ai/native-texture-ai-worker.js')), 'utf8'), context);
  const rgba = new Uint8ClampedArray(2 * 2 * 4); for (let index = 0; index < rgba.length; index += 4) { rgba[index] = rgba[index + 1] = rgba[index + 2] = 150; rgba[index + 3] = 255; }
  await context.self.onmessage({data: {type: 'enhance', id: 7, width: 2, height: 2, tile: true, pixels: rgba.buffer}}); const result = messages.find(message => message.type === 'result'); assert(result, JSON.stringify(messages)); assert.deepEqual(Array.from(captured.dims), [1, 1, 12, 12]); assert(captured.data.every(value => Math.abs(value - 150 / 255) < 1e-6)); assert.equal(result.width, 6); assert.equal(result.height, 6); assert.equal(result.stats.circularPadding, 5); assert(new Uint8ClampedArray(result.pixels).every((value, index) => value === (index % 4 === 3 ? 255 : 150)), 'Circular input context and cropped neural output remove zero-padding seams, including narrow source images.'); assert.equal(context.ort.env.wasm.numThreads, 1); assert.equal(context.ort.env.wasm.proxy, false);
}
function integrity() {
  const root = __layout.map(path.join(__layout.oldDir("scripts/test-native-texture-ai.js"), '../assets/ai')), manifest = JSON.parse(fs.readFileSync(__layout.map(path.join(root, 'provenance.json')), 'utf8'));
  manifest.files.forEach(entry => { const buffer = fs.readFileSync(__layout.map(path.join(root, entry.path))); assert.equal(buffer.length, entry.bytes); assert.equal(crypto.createHash('sha256').update(buffer).digest('hex'), entry.sha256); });
  assert.equal(manifest.model.sha256, '85f36ff88cc504a24af5e0602148bc56a8aa09a58eca8c0da2756f3e8186035e'); assert.equal(manifest.model.license, 'Apache-2.0'); assert.equal(manifest.runtime.license, 'MIT'); assert.equal(manifest.runtime.version, '1.30.0');
  const converted = require('../../tooling/assets/prepare-native-ai-model').convert(fs.readFileSync(__layout.map(path.join(root, 'models/super-resolution-10.onnx')))); assert(converted.buffer.equals(fs.readFileSync(__layout.map(path.join(root, 'models/super-resolution-espcn-x3-dynamic.onnx'))))); assert.equal(converted.parameterTensors.length, 8); assert.equal(converted.sha256, manifest.model.inferenceSha256);
}
(async () => { integrity(); await lifecycle(); await preprocess(); await preprocess('/webxr-simulator'); console.log('Native texture AI: official model/runtime integrity, root/subdirectory worker, model and runtime URLs, bounded inputs/estimates/cache, cancellation and periodic preprocessing passed. Neural numerical inference is verified separately in Chrome.'); })().catch(error => { console.error(error); process.exitCode = 1; });
