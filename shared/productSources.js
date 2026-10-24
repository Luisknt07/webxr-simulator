'use strict';

const types = ['box', 'crate', 'drum', 'bottle'];
const MAX_CATALOG = 8;
const MAX_CATALOG_JSON = 16000;
const qualities = ['good', 'defective'];
const defects = ['none', 'damaged', 'surface', 'dimension', 'incomplete'];
function plain(value) { return value && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function normalizeQuality(quality = 'good', defect = 'none') {
  if (!qualities.includes(quality) || !defects.includes(defect)) throw new Error('Calidad o defecto del producto inválido.');
  if (quality === 'good' && defect !== 'none') throw new Error('Un producto conforme no puede tener un defecto.');
  return {quality, defect: quality === 'defective' && defect === 'none' ? 'damaged' : defect};
}
function normalizeCatalog(value) {
  let rows = value === undefined ? [] : value;
  if (typeof rows === 'string') {
    if (rows.length > MAX_CATALOG_JSON) throw new Error('El catálogo de productos es demasiado grande.');
    try { rows = JSON.parse(rows); } catch (_) { throw new Error('El catálogo debe contener una lista válida de productos.'); }
  }
  if (!Array.isArray(rows) || rows.length > MAX_CATALOG) throw new Error('El catálogo admite hasta 8 tipos de producto.');
  const ids = new Set(), keys = ['id', 'name', 'type', 'width', 'height', 'depth', 'color', 'quality', 'defect'];
  return rows.map(row => {
    if (!plain(row) || Object.keys(row).some(key => !keys.includes(key))) throw new Error('El producto contiene campos no compatibles.');
    if (typeof row.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(row.id) || ids.has(row.id)) throw new Error('Cada producto necesita un código único de hasta 64 caracteres.');
    ids.add(row.id);
    if (typeof row.name !== 'string' || !row.name.trim() || row.name.length > 160 || /[\x00-\x1f]/.test(row.name)) throw new Error('Escribe un nombre válido para el producto.');
    if (!types.includes(row.type)) throw new Error('Tipo de producto no compatible.');
    ['width', 'height', 'depth'].forEach(key => {
      if (typeof row[key] !== 'number' || !Number.isFinite(row[key]) || row[key] < 0.05 || row[key] > 2) throw new Error('Las dimensiones del producto deben estar entre 0,05 y 2 metros.');
    });
    if (typeof row.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(row.color)) throw new Error('El color del producto debe ser #RRGGBB.');
    return Object.assign({id: row.id, name: row.name.trim(), type: row.type, width: row.width, height: row.height, depth: row.depth, color: row.color.toLowerCase()}, normalizeQuality(row.quality, row.defect));
  });
}
function normalizeCatalogJSON(value) { return JSON.stringify(normalizeCatalog(value)); }
function singleSpec(config = {}) {
  return {id: 'product', name: 'Producto', type: types.includes(config.productType) ? config.productType : 'box',
    width: config.width || 0.25, height: config.height || 0.25, depth: config.depth || 0.25, color: config.color || '#b78b53',
    quality: config.quality === 'defective' ? 'defective' : 'good',
    defect: config.quality === 'defective' ? (defects.includes(config.defect) && config.defect !== 'none' ? config.defect : 'damaged') : 'none'};
}
function unitsFor(config = {}) { return config.loadMode === 'pallet' ? (config.palletColumns || 2) * (config.palletRows || 2) * (config.palletLayers || 1) : 1; }
function loadSize(spec, config = {}) {
  if (config.loadMode !== 'pallet') return {width: spec.width, height: spec.height, depth: spec.depth};
  return {width: Math.max(1.2, (config.palletColumns || 2) * (spec.width + 0.02) - 0.02),
    depth: Math.max(1, (config.palletRows || 2) * (spec.depth + 0.02) - 0.02), height: 0.15 + (config.palletLayers || 1) * spec.height};
}
function defectAt(config, index) {
  const rate = typeof config.defectRate === 'number' && Number.isFinite(config.defectRate) ? Math.max(0, Math.min(100, config.defectRate)) : 0;
  if (rate === 0) return false;
  if (rate === 100) return true;
  // A separate salt leaves the catalogue's random type selection unchanged.
  // Index is the generated load ordinal, so retries do not roll quality again.
  let hash = ((config.seed === undefined ? 1 : config.seed) ^ Math.imul(Math.max(0, Math.floor(index)) + 1, 0x85ebca6b) ^ 0xa5a5a5a5) >>> 0;
  hash ^= hash >>> 16; hash = Math.imul(hash, 0x7feb352d); hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b); hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296 < rate / 100;
}
function specAt(config, index) {
  const rows = normalizeCatalog(config.catalog || '[]');
  let spec;
  if (config.generationMode === 'single' || !rows.length) spec = singleSpec(config);
  else {
    let selected = Math.max(0, Math.floor(index)) % rows.length;
    if (config.generationMode === 'random') {
      let hash = ((config.seed === undefined ? 1 : config.seed) ^ Math.imul(Math.max(0, Math.floor(index)) + 1, 0x9e3779b1)) >>> 0;
      hash ^= hash >>> 16; hash = Math.imul(hash, 0x7feb352d); hash ^= hash >>> 15;
      selected = (hash >>> 0) % rows.length;
    }
    spec = Object.assign({}, rows[selected]);
  }
  if (spec.quality === 'good' && defectAt(config, index)) {
    spec.quality = 'defective';
    spec.defect = defects.includes(config.defect) && config.defect !== 'none' ? config.defect : 'damaged';
  }
  return spec;
}
function layout(config = {}) {
  const rows = config.generationMode === 'single' ? [singleSpec(config)] : normalizeCatalog(config.catalog || '[]');
  if (!rows.length) rows.push(singleSpec(config));
  const loads = rows.map(spec => loadSize(spec, config));
  const length = Math.max(1.7, ...loads.map(load => load.width + 0.24)), width = Math.max(1.4, ...loads.map(load => load.depth + 0.24));
  const input = {x: -length / 2, y: 0, z: 0, tx: 1, tz: 0}, outlet = {x: length / 2, y: 0, z: 0, tx: 1, tz: 0};
  return {length, width, input, inlet: input, outlet, output: outlet, slots: [{x: 0, y: 0, z: 0}], queuePosition: [0, 0, 0], deckHeight: 0, floor: -1};
}
module.exports = {types, qualities, defects, MAX_CATALOG, MAX_CATALOG_JSON, normalizeCatalog, normalizeCatalogJSON, normalizeQuality, singleSpec, unitsFor, loadSize, defectAt, specAt, layout};
