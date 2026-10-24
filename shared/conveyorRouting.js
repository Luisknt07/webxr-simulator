/* Declarative product routing. Shared by the editor, SQLite and simulation. */
'use strict';

const MAX_RULES = 16;
const MAX_RULES_JSON = 16000;
const productTypes = ['box', 'crate', 'drum', 'bottle'];
const qualities = ['good', 'defective'];
const defects = ['none', 'damaged', 'surface', 'dimension', 'incomplete'];
const option = (value, label) => ({value, label});
const fields = [
  {value: 'color', label: 'Color de clasificación', type: 'string'},
  {value: 'sku', label: 'Código / SKU', type: 'string'},
  {value: 'productType', label: 'Tipo de producto', type: 'string', options: [option('box', 'Caja de cartón'), option('crate', 'Caja plástica'), option('drum', 'Bidón'), option('bottle', 'Botella')]},
  {value: 'quality', label: 'Calidad', type: 'string', options: [option('good', 'Conforme'), option('defective', 'Defectuoso')]},
  {value: 'defect', label: 'Defecto', type: 'string', options: [option('none', 'Ninguno'), option('damaged', 'Dañado'), option('surface', 'Acabado / superficie'), option('dimension', 'Dimensiones'), option('incomplete', 'Incompleto')]},
  {value: 'width', label: 'Ancho (m)', type: 'number'},
  {value: 'height', label: 'Alto (m)', type: 'number'},
  {value: 'depth', label: 'Fondo (m)', type: 'number'},
  {value: 'units', label: 'Unidades de la carga', type: 'number'}
];
const operatorsByType = {
  string: [option('eq', 'Es igual a'), option('neq', 'Es diferente de')],
  number: [option('eq', '='), option('neq', '≠'), option('lt', '<'), option('lte', '≤'), option('gt', '>'), option('gte', '≥')]
};
function plain(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function normalizedValue(field, value) {
  if (field.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000000 ||
      field.value === 'units' && !Number.isInteger(value)) throw new Error('Valor numérico de clasificación inválido.');
    return value;
  }
  if (typeof value !== 'string' || !value || value.length > 160 || /[\x00-\x1f\x7f]/.test(value)) throw new Error('Valor de clasificación inválido.');
  if (field.value === 'color') {
    if (!/^#[a-f0-9]{6}$/i.test(value)) throw new Error('El color de clasificación debe ser #RRGGBB.');
    return value.toLowerCase();
  }
  if (field.value === 'sku' && !/^[a-zA-Z0-9_-]{1,64}$/.test(value)) throw new Error('El código / SKU admite hasta 64 letras, números, guiones o guiones bajos.');
  if (field.options && !field.options.some(entry => entry.value === value)) throw new Error('Opción de clasificación inválida.');
  return value;
}
function normalizeRules(value) {
  let rows = value === undefined ? [] : value;
  if (typeof rows === 'string') {
    if (rows.length > MAX_RULES_JSON) throw new Error('Las reglas de clasificación son demasiado grandes.');
    try { rows = JSON.parse(rows); } catch (_) { throw new Error('Las reglas de clasificación deben contener una lista JSON válida.'); }
  }
  if (!Array.isArray(rows) || rows.length > MAX_RULES) throw new Error('La clasificación admite hasta 16 reglas.');
  return rows.map(row => {
    if (!plain(row) || Object.keys(row).some(key => !['field', 'operator', 'value', 'route'].includes(key))) throw new Error('La regla de clasificación contiene campos no compatibles.');
    const field = fields.find(entry => entry.value === row.field);
    if (!field || !operatorsByType[field.type].some(entry => entry.value === row.operator)) throw new Error('Campo u operador de clasificación inválido.');
    if (!['main', 'branch'].includes(row.route)) throw new Error('La salida de clasificación debe ser recta o lateral.');
    return {field: row.field, operator: row.operator, value: normalizedValue(field, row.value), route: row.route};
  });
}
function normalizeRulesJSON(value) { return JSON.stringify(normalizeRules(value)); }
function matches(rule, metadata) {
  if (!metadata || !Object.prototype.hasOwnProperty.call(metadata, rule.field)) return false;
  if (rule.field !== 'sku' && metadata[rule.field] === 'mixed') return false;
  const field = fields.find(entry => entry.value === rule.field);
  let value;
  // Mixed, unavailable, or invalid attributes never satisfy a negative rule.
  try { value = normalizedValue(field, metadata[rule.field]); } catch (_) { return false; }
  switch (rule.operator) {
    case 'eq': return value === rule.value;
    case 'neq': return value !== rule.value;
    case 'lt': return value < rule.value;
    case 'lte': return value <= rule.value;
    case 'gt': return value > rule.value;
    case 'gte': return value >= rule.value;
    default: return false;
  }
}
function sequenceIndex(value) { return Number.isSafeInteger(value) && value >= 0 ? value : 0; }
function percentageRoute(sequence, percentage) {
  const index = sequenceIndex(sequence), value = typeof percentage === 'number' && Number.isFinite(percentage) ? Math.max(0, Math.min(100, percentage)) : 50;
  // Balanced deterministic allocation: the first N loads contain floor(N*p/100)
  // branches. Call with the same ordinal when a downstream machine is blocked.
  return Math.floor((index + 1) * value / 100 + 1e-10) > Math.floor(index * value / 100 + 1e-10) ? 'branch' : 'main';
}
function decideRoute(config = {}, metadata = {}, sequence = 0) {
  const mode = config.routing || 'primary';
  if (mode === 'branch') return {route: 'branch', reason: 'fixed', ruleIndex: -1};
  if (mode === 'alternate') return {route: sequenceIndex(sequence) % 2 ? 'branch' : 'main', reason: 'alternate', ruleIndex: -1};
  if (mode === 'percentage') return {route: percentageRoute(sequence, config.branchPercentage), reason: 'percentage', ruleIndex: -1};
  if (mode === 'rules') {
    const rules = normalizeRules(config.routingRules);
    for (let index = 0; index < rules.length; index++) {
      if (matches(rules[index], metadata)) return {route: rules[index].route, reason: 'rule', ruleIndex: index};
    }
    return {route: config.routingDefault === 'branch' ? 'branch' : 'main', reason: 'default', ruleIndex: -1};
  }
  return {route: 'main', reason: 'fixed', ruleIndex: -1};
}
function selectRoute(config, metadata, sequence) { return decideRoute(config, metadata, sequence).route; }

module.exports = {MAX_RULES, MAX_RULES_JSON, productTypes, qualities, defects, fields, operatorsByType,
  normalizeRules, normalizeRulesJSON, matches, percentageRoute, decideRoute, selectRoute};
