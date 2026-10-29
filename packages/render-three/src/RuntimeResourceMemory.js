import * as THREE from 'three';

function compressedFormat(format) { return format >= 33776 && format <= 33779 || format >= 35840 && format <= 35843 || format === 36196 || format >= 37808 && format <= 37821; }

function dimensions(image) {
  if (!image) return null;
  const width = image.videoWidth || image.naturalWidth || image.width, height = image.videoHeight || image.naturalHeight || image.height;
  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0 ? [width, height, Math.max(1, image.depth || 1)] : null;
}
function pixelBytes(texture) {
  if ([THREE.UnsignedShort4444Type, THREE.UnsignedShort5551Type, THREE.UnsignedShort565Type].includes(texture.type)) return 2;
  if (texture.type === THREE.UnsignedInt248Type) return 4;
  const channels = [THREE.AlphaFormat, THREE.LuminanceFormat, THREE.RedFormat, THREE.RedIntegerFormat, THREE.DepthFormat].includes(texture.format) ? 1 :
    [THREE.LuminanceAlphaFormat, THREE.RGFormat, THREE.RGIntegerFormat].includes(texture.format) ? 2 : [THREE.RGBFormat, THREE.RGBIntegerFormat].includes(texture.format) ? 3 : 4;
  const size = [THREE.UnsignedShortType, THREE.ShortType, THREE.HalfFloatType].includes(texture.type) ? 2 : [THREE.UnsignedIntType, THREE.IntType, THREE.FloatType].includes(texture.type) ? 4 : 1;
  return channels * size;
}
function mipBytes(size, bytes, generate, volume = false) {
  let [width, height, depth] = size, result = width * height * depth * bytes;
  if (generate) while (width > 1 || height > 1 || volume && depth > 1) { width = Math.max(1, Math.floor(width / 2)); height = Math.max(1, Math.floor(height / 2)); if (volume) depth = Math.max(1, Math.floor(depth / 2)); result += width * height * depth * bytes; }
  return result;
}
function textureBytes(texture, targetInfo, rendererCaps) {
  const compressed = texture.isCompressedTexture || compressedFormat(texture.format), usesMipmaps = texture.generateMipmaps && ![THREE.NearestFilter, THREE.LinearFilter].includes(texture.minFilter);
  let unknown = 0;
  const face = image => {
    const levels = image && image.mipmaps || texture.mipmaps || [];
    if (levels.length) return levels.reduce((sum, mip) => {
      if (compressed && mip.data && Number.isFinite(mip.data.byteLength)) return sum + mip.data.byteLength;
      const size = dimensions(mip); if (!size) { unknown++; return sum; } return sum + mipBytes(size, pixelBytes(texture), false);
    }, 0);
    const size = dimensions(image); if (!size) { unknown++; return 0; }
    if (compressed) { unknown++; return 0; }
    // WebGL1 may resize NPOT images before upload. This remains logical image
    // storage, not a driver allocation query; flag the reduced confidence.
    if (usesMipmaps && rendererCaps && rendererCaps.isWebGL2 === false && (!THREE.Math.isPowerOfTwo(size[0]) || !THREE.Math.isPowerOfTwo(size[1]))) unknown++;
    return mipBytes(size, pixelBytes(texture), usesMipmaps, texture.isDataTexture3D === true);
  };
  const images = Array.isArray(texture.image) ? texture.image : targetInfo && targetInfo.faces === 6 ? Array(6).fill(texture.image) : [texture.image];
  return {bytes: images.reduce((sum, image) => sum + face(image), 0), unknown};
}

/** Logical backing-store estimates only. Browser WebGL exposes neither total
 * device VRAM nor precise per-resource driver allocations. Keep CPU buffers,
 * decoded images and authoring history separate from GPU residency estimates. */
export default class RuntimeResourceMemory {
  constructor() { this.samples = 0; }
  sample(resident, retained, details = {}) {
    this.samples++;
    const buffers = new Set(), images = new Set(), targetTextures = new Map(); let cpuBytes = 0, unknown = 0;
    const addBuffer = value => { if (!value || !ArrayBuffer.isView(value) || !value.buffer || buffers.has(value.buffer)) return; buffers.add(value.buffer); cpuBytes += value.buffer.byteLength; };
    (retained.attributes || []).forEach(attribute => addBuffer(attribute.array));
    (retained.cpuArrays || []).forEach(addBuffer);
    (retained.renderTargets || []).forEach(target => { if (target.texture) targetTextures.set(target.texture, {faces: target.isWebGLRenderTargetCube || target.isWebGLCubeRenderTarget || target.texture.isCubeTexture ? 6 : 1}); if (target.depthTexture) targetTextures.set(target.depthTexture, {faces: 1}); });
    const cpuImage = (image, decode) => {
      if (!image || typeof image !== 'object' || images.has(image)) return; images.add(image);
      if (Array.isArray(image)) { image.forEach(value => cpuImage(value, decode)); return; }
      if (image.data && ArrayBuffer.isView(image.data)) addBuffer(image.data);
      else if (decode) { const size = dimensions(image); if (size) cpuBytes += size[0] * size[1] * size[2] * 4; }
      (image.mipmaps || []).forEach(value => cpuImage(value, false));
    };
    (retained.textures || []).forEach(texture => { cpuImage(texture.image, !texture.isCompressedTexture && !compressedFormat(texture.format) && !targetTextures.has(texture) && !texture.isRenderTargetTexture); (texture.mipmaps || []).forEach(mip => cpuImage(mip, false)); });
    let geometryBytes = 0; (resident.attributes || []).forEach(attribute => { if (attribute.array && Number.isFinite(attribute.array.byteLength)) geometryBytes += attribute.array.byteLength; else unknown++; });
    let gpuTextureBytes = 0; const textureEstimates = new Map();
    (resident.textures || []).forEach(texture => { const estimate = textureBytes(texture, targetTextures.get(texture), details.capabilities); textureEstimates.set(texture, estimate.bytes); gpuTextureBytes += estimate.bytes; unknown += estimate.unknown; });
    let renderbuffers = 0, targetBytes = 0;
    (resident.renderTargets || []).forEach(target => {
      const faces = targetTextures.get(target.texture) && targetTextures.get(target.texture).faces || 1, pixels = target.width * target.height * faces;
      if (!Number.isFinite(pixels) || pixels <= 0) { unknown++; return; }
      const depth = target.depthBuffer && !target.depthTexture ? pixels * (target.stencilBuffer ? 4 : 2) : 0;
      const samples = target.isWebGLMultisampleRenderTarget && (!details.capabilities || details.capabilities.isWebGL2 !== false) ? Math.max(0, Math.min(target.samples || 0, details.capabilities && details.capabilities.maxSamples || target.samples || 0)) : 0;
      const multi = samples * pixels * (pixelBytes(target.texture) + (target.depthBuffer ? target.stencilBuffer ? 4 : 2 : 0));
      renderbuffers += depth + multi; targetBytes += (textureEstimates.get(target.texture) || 0) + (textureEstimates.get(target.depthTexture) || 0) + depth + multi;
    });
    const audioBytes = (retained.audioBuffers || new Set()); let audio = 0; audioBytes.forEach(buffer => { const size = buffer.length * buffer.numberOfChannels * 4; if (Number.isFinite(size)) audio += size; });
    let encoded = 0; (retained.encodedStrings || new Set()).forEach(value => { encoded += value.length * 2; });
    return {gpuGeometryBytes: geometryBytes, uniqueGeometryBufferBytes: geometryBytes, gpuTextureBytes, gpuRenderTargetBytesEstimated: targetBytes, gpuRenderbufferBytesEstimated: renderbuffers,
      gpuResourceBytesEstimated: geometryBytes + gpuTextureBytes + renderbuffers, retainedCpuBytesEstimated: cpuBytes + audio + encoded,
      retainedCpuBufferBytes: [...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0), retainedEncodedAssetBytesEstimated: encoded, retainedAudioBytesEstimated: audio,
      retainedHistorySnapshots: details.historySnapshots || 0, resourceMemorySamples: this.samples, memoryUnknownResources: unknown,
      estimateKind: 'reachable-resource-backing-stores', estimateConfidence: unknown ? 'low' : 'medium', memoryEstimated: true,
      gpuEstimateScope: 'Active room and known global resources; logical allocation estimate, not total device VRAM. Excludes drawing buffer, XR compositor, driver overhead and other tabs.',
      cpuEstimateScope: 'Unique retained buffers, decoded images, encoded assets and audio, including inactive rooms, undo/redo and clipboard resource roots; excludes JS object/history metadata, browser/driver caches and other tabs.'};
  }
}
