'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const read = name => fs.readFileSync(path.join(__dirname, '../src/editor', name + '.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class ' + name, 'return class ' + name);
const Memory = new Function('THREE', read('RuntimeResourceMemory'))(THREE), Lod = new Function('THREE', read('CosmeticVisualLod'))(THREE);
const Performance = new Function('THREE', 'RuntimeResourceMemory', 'CosmeticVisualLod', read('ScenePerformance'))(THREE, Memory, Lod);
const resources = () => ({attributes: new Set(), textures: new Set(), renderTargets: new Set(), cpuArrays: new Set(), audioBuffers: new Set(), encodedStrings: new Set()});
const sample = (textures, targets = []) => { const all = resources(); textures.forEach(texture => all.textures.add(texture)); targets.forEach(target => { all.renderTargets.add(target); all.textures.add(target.texture); if (target.depthTexture) all.textures.add(target.depthTexture); }); return new Memory().sample(all, all, {capabilities: {isWebGL2: true, maxSamples: 4}}); };

// GPU buffers are keyed by upload owner; CPU views retain a single backing store.
{
  const backing = new ArrayBuffer(1024), array = new Float32Array(backing, 0, 100), data = new THREE.InterleavedBuffer(array, 5), index = new THREE.BufferAttribute(new Uint16Array([0, 1, 2]), 1);
  const active = resources(), retained = resources(); active.attributes.add(data); active.attributes.add(data); active.attributes.add(index); retained.attributes = active.attributes;
  let stats = new Memory().sample(active, retained); assert.equal(stats.gpuGeometryBytes, 406); assert.equal(stats.retainedCpuBufferBytes, 1030);
  active.attributes.add(new THREE.BufferAttribute(array, 1)); stats = new Memory().sample(active, retained); assert.equal(stats.gpuGeometryBytes, 806, 'Distinct BufferAttributes upload private GPU buffers even when their CPU array is shared.'); assert.equal(stats.retainedCpuBufferBytes, 1030);
}
{
  const image = {width: 4, height: 4}, texture = new THREE.Texture(image); texture.generateMipmaps = true; texture.minFilter = THREE.LinearMipmapLinearFilter;
  const shared = texture.clone(); shared.image = image; const stats = sample([texture, shared]); assert.equal(stats.gpuTextureBytes, 168); assert.equal(stats.retainedCpuBytesEstimated, 64, 'Private GPU textures can share one decoded CPU image.'); assert(stats.memoryEstimated); assert.equal(stats.estimateConfidence, 'medium'); assert(/not total device VRAM/.test(stats.gpuEstimateScope));
  const normal = new THREE.DataTexture(new Uint16Array(8 * 8 * 4), 8, 8, THREE.RGBAFormat, THREE.HalfFloatType); assert.equal(sample([normal]).gpuTextureBytes, 512);
  const hdr = new THREE.DataTexture(new Float32Array(6), 2, 1, THREE.RGBFormat, THREE.FloatType); assert.equal(sample([hdr]).gpuTextureBytes, 24);
  const packed = new THREE.DataTexture(new Uint16Array(4), 2, 2, THREE.RGBAFormat, THREE.UnsignedShort4444Type); assert.equal(sample([packed]).gpuTextureBytes, 8);
  const compressed = new THREE.CompressedTexture([{data: new Uint8Array(8), width: 4, height: 4}, {data: new Uint8Array(8), width: 2, height: 2}, {data: new Uint8Array(8), width: 1, height: 1}], 4, 4, THREE.RGB_S3TC_DXT1_Format);
  assert.equal(sample([compressed]).gpuTextureBytes, 24); assert.equal(sample([compressed]).retainedCpuBytesEstimated, 24, 'Compressed textures count supplied mip bytes, not an invented RGBA image.');
  const compressedCube = new THREE.CubeTexture(Array.from({length: 6}, () => ({width: 4, height: 4, mipmaps: [{data: new Uint8Array(8), width: 4, height: 4}]}))); compressedCube.format = THREE.RGB_S3TC_DXT1_Format; assert.equal(sample([compressedCube]).gpuTextureBytes, 48); assert.equal(sample([compressedCube]).retainedCpuBytesEstimated, 48);
  const cube = new THREE.CubeTexture(Array.from({length: 6}, () => ({width: 2, height: 2}))); cube.generateMipmaps = true; cube.minFilter = THREE.LinearMipmapLinearFilter; assert.equal(sample([cube]).gpuTextureBytes, 90); assert.equal(sample([cube]).retainedCpuBytesEstimated, 96);
  const volume = new THREE.DataTexture3D(new Uint8Array(32), 2, 2, 2); volume.format = THREE.RGBAFormat; volume.generateMipmaps = true; volume.minFilter = THREE.LinearMipmapLinearFilter; assert.equal(sample([volume]).gpuTextureBytes, 36);
  const layers = new THREE.DataTexture2DArray(new Uint8Array(48), 2, 2, 3); layers.format = THREE.RGBAFormat; layers.generateMipmaps = true; layers.minFilter = THREE.LinearMipmapLinearFilter; assert.equal(sample([layers]).gpuTextureBytes, 60);
  assert.equal(sample([new THREE.Texture()]).estimateConfidence, 'low', 'Unknown dimensions are disclosed rather than guessed.');
}
{
  const target = new THREE.WebGLRenderTarget(4, 4), cube = new THREE.WebGLRenderTargetCube(2, 2), multisample = new THREE.WebGLMultisampleRenderTarget(4, 4); multisample.samples = 4;
  const stats = sample([target.texture], [target]); assert.equal(stats.gpuTextureBytes, 64); assert.equal(stats.gpuRenderTargetBytesEstimated, 128); assert.equal(stats.gpuResourceBytesEstimated, 128); assert.equal(stats.retainedCpuBytesEstimated, 0, 'Render-target image descriptors are not decoded CPU pixels.');
  assert.equal(sample([], [cube]).gpuRenderTargetBytesEstimated, 192); assert.equal(sample([], [multisample]).gpuRenderTargetBytesEstimated, 640);
  const depth = new THREE.WebGLRenderTarget(4, 4, {depthTexture: new THREE.DepthTexture(4, 4)}); assert.equal(sample([], [depth]).gpuResourceBytesEstimated, 96, 'A depth texture replaces the ordinary depth renderbuffer.');
}
{
  const root = new THREE.Group(), texture = new THREE.Texture({width: 1024, height: 1024}); texture.generateMipmaps = true; texture.minFilter = THREE.LinearMipmapLinearFilter;
  for (let index = 0; index < 2; index++) { const material = new THREE.MeshStandardMaterial(); material.preparedConcreteUniforms = {preparedConcreteMap: {value: texture}, preparedConcreteStrength: {value: .85}}; root.add(new THREE.Mesh(new THREE.BoxBufferGeometry(), material)); }
  const rooms = new Map([['hall', {root}]]), document = {rooms, getRoot: () => root}, manager = new Performance({scene: root, renderer: {info: {memory: {}, render: {}}}}, document); manager.setRoom('hall');
  const stats = manager.getStats(); assert.equal(stats.gpuTextureBytes, 5592404, 'The shared prepared albedo in enumerable custom uniforms is counted exactly once including its full mip chain.'); const samples = stats.resourceMemorySamples; for (let index = 0; index < 100; index++) manager.getStats(); assert.equal(manager.getStats().resourceMemorySamples, samples, 'Repeated graphics UI reads use cached estimates.'); manager.dispose();
}
{
  const scene = new THREE.Scene(), active = new THREE.Group(), inactive = new THREE.Group(), old = new THREE.Mesh(new THREE.BoxBufferGeometry(), new THREE.MeshBasicMaterial({map: new THREE.Texture({width: 8, height: 8})}));
  const current = new THREE.Mesh(new THREE.BoxBufferGeometry(), new THREE.MeshBasicMaterial()); active.add(current); scene.add(active, inactive); const rooms = new Map([['hall', {root: active}], ['sound', {root: inactive}]]), document = {rooms, getRoot: id => rooms.get(id).root, undoStack: [{additions: [{entry: {object: old}}]}], assetLibrary: {imports: [{dataUrl: 'data:fixture,retained'}]}};
  let disposed = 0; old.material.map.addEventListener('dispose', () => disposed++);
  const ctx = {scene, assets: {model: {scene: old}}, editor: {objectClipboard: {content: old}}, renderer: {info: {render: {}, memory: {}}, capabilities: {isWebGL2: true}}}, manager = new Performance(ctx, document); manager.setRoom('hall');
  const stats = manager.getStats(), oldBytes = Object.values(old.geometry.attributes).reduce((sum, attribute) => sum + attribute.array.byteLength, old.geometry.index.array.byteLength);
  assert(stats.retainedCpuBytesEstimated >= stats.gpuGeometryBytes + oldBytes + 256); assert.equal(stats.retainedHistorySnapshots, 1); assert.equal(disposed, 1); assert.equal(old.material.map.image.width, 8);
  const samples = stats.resourceMemorySamples; for (let frame = 0; frame < 50; frame++) { manager.invalidate(); manager.update(null, .01); } assert.equal(manager.getStats().resourceMemorySamples, samples, 'Even continuous dirty events cannot rescan all resources every frame.'); manager.update(null, .6); assert.equal(manager.getStats().resourceMemorySamples, samples + 1);
  active.add(old); manager.update(null, 1.1); assert.equal(old.material.map.image.width, 8); assert.equal(disposed, 1, 'Undo/paste resources can become resident without losing their CPU data.'); manager.dispose();
}
console.log('Resource memory estimates: unique/interleaved GPU uploads versus retained CPU stores, mip/normal/float/packed/compressed/cube/3D textures, render/depth/MSAA targets, history/paste/cache retention, once-per-second scans and explicit estimate scope passed.');
