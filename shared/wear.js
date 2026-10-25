'use strict';

const patterns = ['image', 'rust', 'grime', 'scratches', 'chipped'];
const MAX_STAMPS = 256;
const MAX_STAMP_JSON = 131072;
const MAX_LAYERS = 64, MAX_LAYER_STAMPS = 2048, MAX_LAYER_JSON = 512000;
const patternDefaults = {
  rust: {roughness: 0.92, metalness: 0.03, bumpScale: 0.0035},
  grime: {roughness: 0.87, metalness: 0.01, bumpScale: 0.002},
  scratches: {roughness: 0.42, metalness: 0.72, bumpScale: 0.0007},
  chipped: {roughness: 0.56, metalness: 0.66, bumpScale: 0.0018}
};

function plain(value) { return value && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function vector(value, length, min, max, label) {
  if (!Array.isArray(value) || value.length !== length || value.some(number => typeof number !== 'number' || !Number.isFinite(number) || number < min || number > max)) throw new Error('Valor inválido en ' + label + ' de la brocha.');
  return value.map(number => Object.is(number, -0) ? 0 : number);
}
function normalizeStamps(value = '[]') {
  let list = value;
  if (typeof value === 'string') {
    if (value.length > MAX_STAMP_JSON) throw new Error('La pincelada supera el tamaño permitido.');
    try { list = JSON.parse(value); } catch (error) { throw new Error('Las marcas de la brocha deben ser un array JSON.'); }
  }
  if (!Array.isArray(list) || list.length > MAX_STAMPS) throw new Error('Una pincelada admite como máximo ' + MAX_STAMPS + ' marcas.');
  return list.map(stamp => {
    if (!plain(stamp) || Object.keys(stamp).some(key => !['position', 'quaternion', 'scale'].includes(key))) throw new Error('Marca de brocha inválida.');
    const position = vector(stamp.position, 3, -10000, 10000, 'posición');
    const quaternion = vector(stamp.quaternion, 4, -1.001, 1.001, 'rotación');
    const length = Math.sqrt(quaternion.reduce((sum, number) => sum + number * number, 0));
    if (Math.abs(length - 1) > 0.01) throw new Error('La rotación de la brocha debe ser un cuaternión normalizado.');
    const scale = stamp.scale === undefined ? [1, 1, 1] : vector(stamp.scale, 3, 0.05, 4, 'escala');
    return {position, quaternion: quaternion.map(number => number / length), scale};
  });
}
function normalizeStampJSON(value) { return JSON.stringify(normalizeStamps(value)); }
function normalizeLayers(value = '[]') {
  let list = value;
  if (typeof value === 'string') {
    if (value.length > MAX_LAYER_JSON) throw new Error('Las capas de desgaste superan el tamaño permitido.');
    try { list = JSON.parse(value); } catch (error) { throw new Error('Las capas de desgaste deben ser un array JSON.'); }
  }
  if (!Array.isArray(list) || list.length > MAX_LAYERS) throw new Error('Un objeto admite como máximo ' + MAX_LAYERS + ' capas de desgaste.');
  const ids = new Set(); let total = 0;
  return list.map((layer, index) => {
    if (!plain(layer)) throw new Error('Capa de desgaste inválida.');
    const id = layer.id === undefined ? 'wear-' + (index + 1) : layer.id;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(id) || ids.has(id)) throw new Error('Identificador de capa inválido o duplicado.');
    ids.add(id);
    const pattern = layer.pattern === undefined ? 'rust' : layer.pattern;
    if (!patternDefaults[pattern]) throw new Error('Patrón de desgaste no compatible.');
    const color = layer.color === undefined ? '#ffffff' : layer.color;
    if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Color de desgaste inválido.');
    const numeric = (key, fallback, min, max, integer) => {
      const number = layer[key] === undefined ? fallback : layer[key];
      if (typeof number !== 'number' || !Number.isFinite(number) || number < min || number > max || integer && !Number.isInteger(number)) throw new Error('Valor inválido en ' + key + ' de la capa de desgaste.');
      return number;
    };
    const matrix = layer.matrix === undefined ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] : vector(layer.matrix, 16, -1000000, 1000000, 'matriz');
    if (matrix[3] !== 0 || matrix[7] !== 0 || matrix[11] !== 0 || matrix[15] !== 1) throw new Error('La matriz de desgaste debe ser una transformación afín.');
    const determinant = matrix[0] * (matrix[5] * matrix[10] - matrix[6] * matrix[9]) - matrix[4] * (matrix[1] * matrix[10] - matrix[2] * matrix[9]) + matrix[8] * (matrix[1] * matrix[6] - matrix[2] * matrix[5]);
    if (Math.abs(determinant) < 1e-12) throw new Error('La matriz de desgaste debe ser invertible.');
    const stamps = normalizeStamps(layer.stamps === undefined ? [] : layer.stamps);
    total += Math.max(1, stamps.length);
    if (total > MAX_LAYER_STAMPS) throw new Error('Un objeto admite como máximo ' + MAX_LAYER_STAMPS + ' marcas de desgaste.');
    return {id, pattern, color: color.toLowerCase(), width: numeric('width', 1, 0.01, 100), height: numeric('height', 1, 0.01, 100), depth: numeric('depth', 0.3, 0.001, 100),
      opacity: numeric('opacity', 0.8, 0, 1), density: numeric('density', 0.65, 0, 1), roughness: numeric('roughness', patternDefaults[pattern].roughness, 0, 1),
      metalness: numeric('metalness', patternDefaults[pattern].metalness, 0, 1), seed: numeric('seed', 1, 0, 2147483647, true), matrix, stamps};
  });
}
function normalizeLayerJSON(value) {
  const result = JSON.stringify(normalizeLayers(value));
  if (result.length > MAX_LAYER_JSON) throw new Error('Las capas de desgaste superan el tamaño permitido.');
  return result;
}
function clamp(value, min = 0, max = 1) { return Math.max(min, Math.min(max, value)); }
function smooth(a, b, value) { const t = clamp((value - a) / (b - a)); return t * t * (3 - 2 * t); }
function hash(x, y, seed) {
  let value = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1274126177);
  value = Math.imul(value ^ value >>> 13, 1274126177);
  return ((value ^ value >>> 16) >>> 0) / 4294967295;
}
function noise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed), c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function grain(x, y, seed) { return noise(x * 3, y * 3, seed) * 0.5 + noise(x * 9, y * 9, seed + 37) * 0.3 + noise(x * 29, y * 29, seed + 83) * 0.2; }

/** Deterministic, private RGBA colour + packed height/roughness/metalness maps. */
function generateWear(pattern, seed = 1, density = 0.65, size = 128) {
  if (!patternDefaults[pattern]) throw new Error('Patrón de desgaste no compatible.');
  if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647 || typeof density !== 'number' || !Number.isFinite(density) || density < 0 || density > 1) throw new Error('Semilla o densidad de desgaste inválida.');
  if (![32, 64, 128, 256, 512].includes(size)) throw new Error('Resolución de desgaste no compatible.');
  const data = new Uint8Array(size * size * 4), materialData = new Uint8Array(size * size * 4);
  const scratches = [];
  if (pattern === 'scratches') for (let index = 0; index < Math.round(6 + density * 34); index++) {
    const angle = (hash(index, 1, seed) - 0.5) * 0.8, length = 0.12 + hash(index, 2, seed) * 0.8;
    scratches.push({x: hash(index, 3, seed), y: hash(index, 4, seed), dx: Math.cos(angle) * length, dy: Math.sin(angle) * length, width: 0.0008 + Math.pow(hash(index, 5, seed), 3) * 0.005});
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + 0.5) / size, v = (y + 0.5) / size, nx = u * 2 - 1, ny = v * 2 - 1;
    const coarse = grain(u, v, seed), fine = noise(u * 92, v * 92, seed + 127), dots = hash(x, y, seed + 331);
    const flakes = noise(u * 37, v * 37, seed + 197), pores = noise(u * 151, v * 151, seed + 211);
    const radius = Math.sqrt(nx * nx + ny * ny), edge = 0.71 + grain(u * 1.7, v * 1.7, seed + 511) * 0.24;
    const falloff = 1 - smooth(edge - 0.2, edge, radius);
    let alpha = smooth((1 - density) * 0.78, (1 - density) * 0.78 + 0.28, coarse) * falloff;
    let red, green, blue, height = coarse, roughness = 0.9, metalness = 0.02;
    if (pattern === 'rust') {
      const pitting = smooth(0.38, 0.8, pores) * .34, oxide = smooth(.28, .72, flakes);
      red = 43 + oxide * 111 + coarse * 35 + dots * 13; green = 19 + oxide * 51 + coarse * 23; blue = 9 + oxide * 17 + fine * 9;
      height = clamp(.23 + flakes * .32 + pitting); roughness = .85 + pores * .15;
      alpha *= .72 + fine * .28;
    } else if (pattern === 'grime') {
      const streak = noise(u * 47, v * 3, seed + 619), dust = smooth(.25, .77, coarse);
      red = 24 + coarse * 39 + dust * 21; green = 26 + coarse * 33 + dust * 16; blue = 21 + coarse * 27 + dust * 9;
      alpha *= .24 + streak * .58 + flakes * .18; height = .48 + coarse * .08; roughness = .72 + fine * .23;
    } else if (pattern === 'scratches') {
      let line = 0, groove = 0;
      scratches.forEach(scratch => {
        const dx = u - scratch.x, dy = v - scratch.y, lengthSq = scratch.dx * scratch.dx + scratch.dy * scratch.dy;
        const t = clamp((dx * scratch.dx + dy * scratch.dy) / lengthSq, -0.5, 0.5);
        const distance = Math.sqrt(Math.pow(dx - t * scratch.dx, 2) + Math.pow(dy - t * scratch.dy, 2));
        const taper = 1 - smooth(.34, .5, Math.abs(t));
        const broken = .55 + noise(u * 71, v * 5, seed + 401) * .45;
        line = Math.max(line, (1 - smooth(scratch.width * .2, scratch.width + .45 / size, distance)) * taper * broken);
        groove = Math.max(groove, (1 - smooth(scratch.width, scratch.width * 2.5 + .75 / size, distance)) * taper);
      });
      alpha = Math.max(line, groove * .30) * falloff * (.66 + fine * .34);
      const glint = smooth(.05, .6, line);
      red = 49 + glint * 146 + fine * 33; green = 53 + glint * 150 + fine * 31; blue = 55 + glint * 152 + fine * 29;
      height = .5 - line * .26; roughness = .28 + fine * .28; metalness = .74 + fine * .25;
    } else {
      const islands = coarse * .72 + flakes * .28, threshold = .40 + (1 - density) * .19;
      const boundary = smooth(threshold, threshold + .13, islands), core = smooth(threshold + .09, threshold + .18, islands);
      alpha = boundary * falloff * (.8 + fine * .2);
      // A dark paint lip surrounds the newly exposed, brighter substrate.
      red = 38 + core * 116 + fine * 23; green = 41 + core * 123 + fine * 21; blue = 43 + core * 127 + fine * 19;
      height = .48 - core * .23; roughness = .38 + fine * .28; metalness = .72 + fine * .26;
    }
    const index = (y * size + x) * 4;
    data[index] = clamp(red, 0, 255); data[index + 1] = clamp(green, 0, 255); data[index + 2] = clamp(blue, 0, 255); data[index + 3] = density === 0 ? 0 : Math.round(clamp(alpha) * 255);
    materialData[index] = Math.round(clamp(height) * 255); materialData[index + 1] = Math.round(clamp(roughness) * 255); materialData[index + 2] = Math.round(clamp(metalness) * 255); materialData[index + 3] = 255;
  }
  return {width: size, height: size, data, materialData};
}

module.exports = {patterns, patternDefaults, MAX_STAMPS, MAX_STAMP_JSON, MAX_LAYERS, MAX_LAYER_STAMPS, MAX_LAYER_JSON, normalizeStamps, normalizeStampJSON, normalizeLayers, normalizeLayerJSON, generateWear};
