'use strict';
const pallets = require('./palletTypes.js');
const productEquipment = require('./product-equipment.js');

const types = productEquipment.PRODUCT_TYPES.map(item => item.value);
const MAX_CATALOG = 8;
const MAX_CATALOG_JSON = 16000;
const palletPlanCache = new Map();
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
  const ids = new Set(), keys = ['id', 'name', 'type', 'width', 'height', 'depth', 'color', 'quality', 'defect', 'mass', 'base', 'variant', 'units'];
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
    if (row.mass !== undefined && (typeof row.mass !== 'number' || !Number.isFinite(row.mass) || row.mass < .01 || row.mass > 3000)) throw new Error('La masa del producto debe estar entre 0,01 y 3000 kg.');
    if (row.base !== undefined && !['flat', 'rigid', 'runners', 'unstable'].includes(row.base)) throw new Error('Base de producto no compatible.');
    if (row.variant !== undefined && !productEquipment.variants.includes(row.variant)) throw new Error('Modelo de producto no compatible.');
    if (row.variant && productEquipment.getDefinition(row.variant).preset.productType !== row.type) throw new Error('El modelo visual no coincide con el tipo del producto.');
    if (row.units !== undefined && (!Number.isInteger(row.units) || row.units < 1 || row.units > 64)) throw new Error('Las unidades del producto deben estar entre 1 y 64.');
    const physical = Object.assign({}, row.mass === undefined ? {} : {mass: row.mass}, row.base === undefined ? {} : {base: row.base}, row.variant === undefined ? {} : {variant: row.variant}, row.units === undefined ? {} : {units: row.units});
    return Object.assign({id: row.id, name: row.name.trim(), type: row.type, width: row.width, height: row.height, depth: row.depth, color: row.color.toLowerCase()}, normalizeQuality(row.quality, row.defect), physical);
  });
}
function normalizeCatalogJSON(value) { return JSON.stringify(normalizeCatalog(value)); }
function singleSpec(config = {}) {
  return Object.assign({id: 'product', name: 'Producto', type: types.includes(config.productType) ? config.productType : 'box',
    width: config.width || 0.25, height: config.height || 0.25, depth: config.depth || 0.25, color: config.color || '#b78b53',
    mass: config.mass || 1, base: config.base || 'flat',
    quality: config.quality === 'defective' ? 'defective' : 'good',
    defect: config.quality === 'defective' ? (defects.includes(config.defect) && config.defect !== 'none' ? config.defect : 'damaged') : 'none'},
  config.productVariant ? {variant: config.productVariant} : {}, config.units === undefined ? {} : {units: config.units});
}
function assertLoadCompatible(spec, config = {}) {
  const recipe = spec.variant && productEquipment.getDefinition(spec.variant);
  if (recipe && recipe.preset.productType !== spec.type) throw new Error('El modelo visual no coincide con el tipo del producto.');
  if (config.loadMode === 'pallet' && (['pallet', 'cage'].includes(spec.type) || recipe && recipe.preset.loadMode === 'pallet')) {
    throw new Error('El producto ya es una carga paletizada. Usa la unidad de manipulación Individual para generar el pallet completo sin añadir otro pallet debajo.');
  }
  return true;
}
function palletPlan(spec, config = {}) {
  assertLoadCompatible(spec, config);
  const base = pallets.dimensions(config, true);
  if (config.palletPacking === 'fit') {
    // Layout/ports query the same catalogue sizes every simulation substep.
    // Cache only immutable numeric plans; no meshes, products or GPU ownership.
    const key = JSON.stringify([base.width, base.depth, base.height, base.material, base.type, spec.width, spec.height, spec.depth, Math.min(5, config.palletLayers || 1)]);
    if (palletPlanCache.has(key)) return palletPlanCache.get(key);
    const placements = pallets.pack(base.width, base.depth, spec, Math.min(5, config.palletLayers || 1), 64);
    placements.forEach(Object.freeze); Object.freeze(placements);
    const plan = Object.freeze(Object.assign(base, {placements, units: placements.length, height: base.height + placements.reduce((top, item) => Math.max(top, item.y + item.height), 0)}));
    if (palletPlanCache.size >= 64) palletPlanCache.delete(palletPlanCache.keys().next().value);
    palletPlanCache.set(key, plan); return plan;
  }
  const columns = config.palletColumns || 2, rows = config.palletRows || 2, layers = config.palletLayers || 1;
  const neededWidth = columns * (spec.width + .02) - .02, neededDepth = rows * (spec.depth + .02) - .02;
  if (base.type !== 'custom' && (neededWidth > base.width + 1e-8 || neededDepth > base.depth + 1e-8)) throw new Error('La cuadricula de productos supera el formato de pallet elegido.');
  const width = base.type === 'custom' ? Math.max(base.width, neededWidth) : base.width, depth = base.type === 'custom' ? Math.max(base.depth, neededDepth) : base.depth;
  return Object.assign(base, {width, depth, units: columns * rows * layers, height: base.height + layers * spec.height});
}
function unitsFor(config = {}, spec = singleSpec(config)) {
  const contained = Number.isInteger(spec.units) && spec.units >= 1 && spec.units <= 64 ? spec.units : 1;
  return (config.loadMode === 'pallet' ? palletPlan(spec, config).units : 1) * contained;
}
/** Inventory quantities are authoritative; spec.units describes the recipe's
 * package contents and must never replace a fraction's actual unit count. */
function entryMass(entry, ancestors = new Set()) {
  if (!entry || typeof entry !== 'object') return 0;
  if (ancestors.has(entry)) throw new Error('La procedencia de la carga contiene un ciclo.');
  ancestors.add(entry);
  const members = Array.isArray(entry.members) && entry.members.length ? entry.members : null;
  let mass = members ? members.reduce((sum, member) => sum + entryMass(member, ancestors), 0) :
    (entry.spec && Number.isFinite(entry.spec.mass) ? entry.spec.mass : 1) * (Number.isFinite(entry.units) && entry.units >= 0 ? entry.units : 1);
  if (entry.load && entry.load.loadMode === 'pallet') mass += Number.isFinite(entry.load.palletTare) ? entry.load.palletTare : pallets.dimensions(entry.load, true).tare;
  ancestors.delete(entry); return mass;
}
function loadSize(spec, config = {}) {
  if (config.loadMode !== 'pallet') return {width: spec.width, height: spec.height, depth: spec.depth};
  const plan = palletPlan(spec, config); return {width: plan.width, depth: plan.depth, height: plan.height};
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
module.exports = {types, qualities, defects, MAX_CATALOG, MAX_CATALOG_JSON, normalizeCatalog, normalizeCatalogJSON, normalizeQuality, singleSpec, assertLoadCompatible, unitsFor, entryMass, palletPlan, pallets, loadSize, defectAt, specAt, layout};
