/* HELLO Studio local inference worker. Runtime/model licences and checksums are
 * distributed beside this file; model is the trained ONNX Model Zoo ESPCN x3. */
'use strict';
const MODEL_SHA256 = 'f2645a31409ac2487242e1d8c42e627c3651dd1f6605f55bd0ca1754535ce62f';
const MODEL_URL = new URL('models/super-resolution-espcn-x3-dynamic.onnx', self.location.href).href;
let busy = false;
const clamp = value => Math.min(255, Math.max(0, Math.round(value)));
function sample(data, width, height, x, y, tile) {
  const wrap = (value, size) => (value % size + size) % size, floorX = Math.floor(x), floorY = Math.floor(y);
  const left = tile ? wrap(floorX, width) : Math.max(0, Math.min(width - 1, floorX)), top = tile ? wrap(floorY, height) : Math.max(0, Math.min(height - 1, floorY)), right = tile ? wrap(floorX + 1, width) : Math.min(width - 1, left + 1), bottom = tile ? wrap(floorY + 1, height) : Math.min(height - 1, top + 1), a = tile ? x - floorX : Math.max(0, Math.min(1, x - left)), b = tile ? y - floorY : Math.max(0, Math.min(1, y - top));
  return data[top * width + left] * (1 - a) * (1 - b) + data[top * width + right] * a * (1 - b) + data[bottom * width + left] * (1 - a) * b + data[bottom * width + right] * a * b;
}
self.onmessage = async event => {
  const message = event.data || {}, id = message.id, width = message.width, height = message.height;
  const tile = message.tile === true, padding = tile ? 5 : 0, modelWidth = width + padding * 2, modelHeight = height + padding * 2;
  if (message.type !== 'enhance' || busy) return;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || modelWidth > 256 || modelHeight > 256 || !(message.pixels instanceof ArrayBuffer) || message.pixels.byteLength !== width * height * 4) { self.postMessage({type: 'error', id, error: 'Dimensiones de IA no válidas.'}); return; }
  busy = true; let session, input, output; const started = performance.now();
  try {
    self.postMessage({type: 'progress', id, stage: 'loading-runtime'});
    importScripts(new URL('onnxruntime-1.30.0/ort.wasm.min.js', self.location.href).href);
    ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false; ort.env.wasm.wasmPaths = new URL('onnxruntime-1.30.0/', self.location.href).href;
    const response = await fetch(MODEL_URL); if (!response.ok) throw new Error('El modelo local no está disponible.'); const model = await response.arrayBuffer();
    if (!self.crypto || !self.crypto.subtle) throw new Error('La IA local requiere un origen HTTPS seguro.');
    const digest = new Uint8Array(await self.crypto.subtle.digest('SHA-256', model)), actual = Array.from(digest, value => value.toString(16).padStart(2, '0')).join(''); if (actual !== MODEL_SHA256) throw new Error('La integridad del modelo local no coincide.');
    session = await ort.InferenceSession.create(model, {executionProviders: ['wasm'], graphOptimizationLevel: 'all', logSeverityLevel: 3});
    const source = new Uint8ClampedArray(message.pixels), y = new Float32Array(width * height), cb = new Float32Array(width * height), cr = new Float32Array(width * height), alpha = new Float32Array(width * height);
    for (let pixel = 0; pixel < y.length; pixel++) { const offset = pixel * 4, r = source[offset], g = source[offset + 1], b = source[offset + 2]; y[pixel] = (.299 * r + .587 * g + .114 * b) / 255; cb[pixel] = -.168736 * r - .331264 * g + .5 * b + 128; cr[pixel] = .5 * r - .418688 * g - .081312 * b + 128; alpha[pixel] = source[offset + 3]; }
    let modelY = y;
    if (padding) { modelY = new Float32Array(modelWidth * modelHeight); for (let row = 0; row < modelHeight; row++) for (let column = 0; column < modelWidth; column++) modelY[row * modelWidth + column] = y[(((row - padding) % height + height) % height) * width + ((column - padding) % width + width) % width]; }
    input = new ort.Tensor('float32', modelY, [1, 1, modelHeight, modelWidth]); self.postMessage({type: 'progress', id, stage: 'inferencing'}); const inferenceStarted = performance.now();
    const outputs = await session.run({[session.inputNames[0]]: input}); output = outputs[session.outputNames[0]];
    if (!output || output.dims.length !== 4 || output.dims[0] !== 1 || output.dims[1] !== 1 || output.dims[2] !== modelHeight * 3 || output.dims[3] !== modelWidth * 3) throw new Error('El modelo produjo dimensiones inesperadas.');
    const inferenceMs = performance.now() - inferenceStarted, outWidth = width * 3, outHeight = height * 3, luminance = output.data, rgba = new Uint8ClampedArray(outWidth * outHeight * 4);
    for (let row = 0; row < outHeight; row++) for (let column = 0; column < outWidth; column++) { const pixel = row * outWidth + column, offset = pixel * 4, x = (column + .5) / 3 - .5, z = (row + .5) / 3 - .5, modelPixel = (row + padding * 3) * (modelWidth * 3) + column + padding * 3, yy = Math.max(0, Math.min(1, luminance[modelPixel])) * 255, blue = sample(cb, width, height, x, z, tile) - 128, red = sample(cr, width, height, x, z, tile) - 128; rgba[offset] = clamp(yy + 1.402 * red); rgba[offset + 1] = clamp(yy - .344136 * blue - .714136 * red); rgba[offset + 2] = clamp(yy + 1.772 * blue); rgba[offset + 3] = clamp(sample(alpha, width, height, x, z, tile)); }
    if (input.dispose) input.dispose(); input = null; if (output.dispose) output.dispose(); output = null; await session.release(); session = null;
    self.postMessage({type: 'result', id, width: outWidth, height: outHeight, pixels: rgba.buffer, stats: {provider: 'wasm-single-thread', runtimeVersion: '1.30.0', model: 'espcn-x3-bsd300-onnx10', modelVerified: true, inputWidth: width, inputHeight: height, circularPadding: padding, inferenceMs, workerMs: performance.now() - started}}, [rgba.buffer]);
  } catch (error) { self.postMessage({type: 'error', id, error: error && error.message || 'No se pudo ejecutar el modelo local.'}); }
  finally { if (input && input.dispose) input.dispose(); if (output && output.dispose) output.dispose(); if (session) { try { await session.release(); } catch (_) { /* Worker owner terminates on every result. */ } } busy = false; }
};
