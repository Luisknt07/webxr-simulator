'use strict';

const TIERS = ['economy', 'balanced', 'high', 'ultra'];
const MODES = ['auto'].concat(TIERS);
const PROFILES = [
  {maxPixelRatio: 1, maxPixels: 1000000, shadowMapSize: 512, xrShadowMapSize: 512, shadowRadius: 9, xrShadowRadius: 8, pointLights: 2, maxAnisotropy: 2, visualDistanceScale: .65, fixedFoveation: .65},
  {maxPixelRatio: 1.5, maxPixels: 2000000, shadowMapSize: 1024, xrShadowMapSize: 512, shadowRadius: 11, xrShadowRadius: 9, pointLights: 4, maxAnisotropy: 4, visualDistanceScale: 1, fixedFoveation: .4},
  {maxPixelRatio: 2, maxPixels: 4000000, shadowMapSize: 2048, xrShadowMapSize: 1024, shadowRadius: 13, xrShadowRadius: 11, pointLights: 6, maxAnisotropy: 8, visualDistanceScale: 1.35, fixedFoveation: .2},
  {maxPixelRatio: 2.5, maxPixels: 6000000, shadowMapSize: 2048, xrShadowMapSize: 1024, shadowRadius: 14, xrShadowRadius: 11, pointLights: 8, maxAnisotropy: 8, visualDistanceScale: 1.8, fixedFoveation: .1}
];
function hints(input = {}) {
  const positive = value => Number.isFinite(value) && value > 0 ? value : null;
  const agent = typeof input.userAgent === 'string' ? input.userAgent : '';
  return {coarse: !!input.coarse, deviceMemory: positive(input.deviceMemory), hardwareConcurrency: positive(input.hardwareConcurrency),
    mobile: !!input.mobile || /Android|Mobile|iPhone|iPad/i.test(agent), standaloneXR: !!input.standaloneXR || /OculusBrowser|Quest(?:\s|\))|Wolvic/i.test(agent)};
}
function initialTier(input, mode = 'auto') {
  if (!MODES.includes(mode)) throw new Error('Modo gráfico no compatible.');
  if (mode !== 'auto') return TIERS.indexOf(mode);
  const h = hints(input);
  return h.coarse || h.deviceMemory && h.deviceMemory <= 4 || h.hardwareConcurrency && h.hardwareConcurrency <= 4 ? 0 : 1;
}
function ceilingFor(mode = 'auto', input = {}) {
  if (!MODES.includes(mode)) throw new Error('Modo gráfico no compatible.');
  if (mode !== 'auto') return TIERS.indexOf(mode);
  const h = hints(input);
  if (h.deviceMemory && h.deviceMemory <= 2 || h.hardwareConcurrency && h.hardwareConcurrency <= 2) return 1;
  if (h.coarse || h.deviceMemory && h.deviceMemory <= 4) return 2;
  return 3;
}
function limitsFor(tier = 1, input = {}) {
  const index = typeof tier === 'string' ? TIERS.indexOf(tier) : tier;
  if (!Number.isInteger(index) || index < 0 || index >= TIERS.length) throw new Error('Nivel gráfico no compatible.');
  const h = hints(input), result = Object.assign({tier: TIERS[index]}, PROFILES[index]);
  if (h.coarse) {
    result.maxPixelRatio = Math.min(result.maxPixelRatio, 1.5); result.maxPixels = Math.min(result.maxPixels, 1500000);
    result.shadowMapSize = Math.min(result.shadowMapSize, 1024); result.pointLights = Math.min(result.pointLights, 4);
    result.maxAnisotropy = Math.min(result.maxAnisotropy, 4); result.visualDistanceScale = Math.min(result.visualDistanceScale, 1.1);
  }
  if (h.deviceMemory && h.deviceMemory <= 2) {
    result.maxPixels = Math.min(result.maxPixels, 800000); result.maxPixelRatio = Math.min(result.maxPixelRatio, 1);
    result.shadowMapSize = result.xrShadowMapSize = 512; result.pointLights = Math.min(result.pointLights, 2);
    result.maxAnisotropy = Math.min(result.maxAnisotropy, 2); result.visualDistanceScale = Math.min(result.visualDistanceScale, .75);
  }
  // These are application-owned cache/work limits, not a claim about physical
  // headset RAM or a replacement for measuring the actual session frame rate.
  result.nativeTextureCacheBytes = (h.standaloneXR ? 96 : h.mobile || h.coarse ? 64 : 256) * 1024 * 1024;
  result.assetLoadConcurrency = h.standaloneXR || h.mobile || h.coarse ? 2 : 3;
  if (h.standaloneXR) { result.pointLights = Math.min(result.pointLights, 4); result.xrShadowMapSize = Math.min(result.xrShadowMapSize, 512); result.maxAnisotropy = Math.min(result.maxAnisotropy, 4); result.visualDistanceScale = Math.min(result.visualDistanceScale, 1.35); }
  return result;
}
function pixelRatioFor(width, height, dpr, limits) {
  const w = Math.max(1, Number(width) || 1), h = Math.max(1, Number(height) || 1), native = Math.max(.1, Number(dpr) || 1);
  return Math.min(native, limits.maxPixelRatio, Math.sqrt(limits.maxPixels / (w * h)));
}
function targetFrameRate(xr, session) { return xr ? session && Number.isFinite(session.frameRate) && session.frameRate >= 30 ? session.frameRate : 72 : 60; }
module.exports = {TIERS, MODES, PROFILES, hints, initialTier, ceilingFor, limitsFor, pixelRatioFor, targetFrameRate};
