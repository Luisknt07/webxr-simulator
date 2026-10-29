'use strict';
const VERSION = 1;
const SHAPES = {straight: 'Recta', l: 'L', t: 'T con clasificación', y: 'Unión en Y'};
const TECHNOLOGIES = {rollers: 'Rodillos', belt: 'Banda continua'};
const TURN_TYPES = {transfer: 'Transferencia rectangular a 90°', curve: 'Curva continua a 90°'};
const numberWords = {un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12};
const fold = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function count(text, suffix) { const match = text.match(new RegExp('\\b(\\d+|' + Object.keys(numberWords).join('|') + ')\\s+(?:' + suffix + ')\\b')); return match ? Number(match[1]) || numberWords[match[1]] : null; }
function bounded(value, min, max, fallback) { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; }
function normalizePlan(input = {}) {
  const shape = Object.prototype.hasOwnProperty.call(SHAPES, input.shape) ? input.shape : 'l';
  const minimum = shape === 'straight' ? 1 : shape === 'l' ? 3 : 4;
  const requestedCount = Number.isFinite(Number(input.conveyorCount)) ? Math.round(Number(input.conveyorCount)) : minimum;
  const technology = Object.prototype.hasOwnProperty.call(TECHNOLOGIES, input.technology) ? input.technology : 'rollers';
  const turn = input.turn === 'curve' ? 'curve' : 'transfer', warnings = [];
  if (requestedCount < minimum) warnings.push('Esta forma requiere al menos ' + minimum + ' módulos; se propone esa cantidad para conservar uniones reales.');
  if (requestedCount > 12) warnings.push('Se propone un máximo de 12 transportadores por construcción para mantenerla manejable.');
  if (shape === 'y' && technology === 'belt') warnings.push('La unión en Y utiliza el módulo angular de rodillos compatible con el catálogo; sus rectas pueden ser de banda.');
  const routing = ['color', 'quality', 'productType', 'percentage', 'alternate'].includes(input.routing) ? input.routing : 'color';
  const kinds = Array.isArray(input.productKinds) ? input.productKinds.filter(value => ['box', 'crate', 'bottle', 'drum'].includes(value)) : [];
  const plan = {version: VERSION, title: typeof input.title === 'string' && input.title.trim() ? input.title.trim().slice(0, 120) : 'Línea ' + SHAPES[shape],
    shape, technology, turn, conveyorCount: bounded(requestedCount, minimum, 12, minimum), productCount: Math.round(bounded(input.productCount, 1, 8, 3)),
    length: bounded(input.length, 1.2, 6, 2.4), width: bounded(input.width, .6, 1.4, .8), speed: bounded(input.speed, .1, 1.5, .55),
    quantity: Math.round(bounded(input.quantity, 0, 200, 24)), automatic: input.automatic !== false, monitor: input.monitor !== false, routing,
    productKinds: kinds.length ? Array.from(new Set(kinds)) : ['box'], processor: ['process', 'combiner', 'separator'].includes(input.processor) ? input.processor : '',
    processTime: bounded(input.processTime, .1, 3600, 3), setupTime: bounded(input.setupTime, 0, 3600, 1),
    understood: input.understood !== false, sourceText: String(input.sourceText || '').slice(0, 2000), warnings};
  if (plan.productKinds.some(value => value === 'bottle' || value === 'drum') && plan.technology === 'rollers') warnings.push('Las botellas y bidones se generan con base rígida; revisa dimensiones y estabilidad antes de usar otros productos.');
  if (!plan.understood) warnings.push('No se identificó una petición de transportadores. Elige una forma y cantidad o describe una línea del catálogo.');
  return plan;
}
function planFromInstruction(instruction, overrides = {}) {
  const text = fold(instruction).slice(0, 2000), explicitShape = text.match(/\b(?:en|forma de|tipo|una|hagan(?: una)?|formen(?: una)?)\s+([lty])\b/);
  const shape = explicitShape ? explicitShape[1] : /\bclasific|desvio|ramal/.test(text) ? 't' : /\besquina|90\s*(?:grados|°)/.test(text) ? 'l' : /\brect[ao]|linea recta/.test(text) ? 'straight' : 'l';
  const kinds = []; if (/caja|carton/.test(text)) kinds.push('box'); if (/contenedor|caja plastica|caja reutilizable/.test(text)) kinds.push('crate'); if (/botella/.test(text)) kinds.push('bottle'); if (/bidon|tambor/.test(text)) kinds.push('drum');
  const values = {sourceText: String(instruction || '').slice(0, 2000), shape, understood: /transport|rodill|banda|cinta|linea|source|generador|productos|monitor/.test(text),
    conveyorCount: count(text, 'transportadores?|bandas?|cintas?|modulos?') || (shape === 'straight' ? 3 : shape === 'l' ? 3 : 4),
    productCount: count(text, 'tipos? de productos?|tipos? de cajas?|perfiles?') || 3,
    quantity: /continu[oa]|sin limite|siempre/.test(text) ? 0 : count(text, 'productos?|unidades?|cajas?') || 24,
    technology: /rodill/.test(text) ? 'rollers' : /\bbandas?\b|\bcintas?\b|correa|tapete|lona/.test(text) ? 'belt' : 'rollers',
    turn: /sin curva|no curv|rectangular|transferencia|escuadra/.test(text) ? 'transfer' : /curv/.test(text) ? 'curve' : 'transfer',
    automatic: !/\bmanual|operario/.test(text), monitor: !/sin (?:un )?monitor|sin pantalla/.test(text), productKinds: kinds,
    routing: /porcentaje|por ciento|%/.test(text) ? 'percentage' : /defecto|calidad/.test(text) ? 'quality' : /por tipo/.test(text) ? 'productType' : /altern/.test(text) ? 'alternate' : 'color',
    processor: /combiner|combinador|agrupar/.test(text) ? 'combiner' : /separator|separador|separar/.test(text) ? 'separator' : /procesador|proceso|packing|sellado/.test(text) ? 'process' : ''};
  const length = text.match(/(?:largo|longitud|tramos? de)\s*(\d+(?:[.,]\d+)?)\s*(?:m|metros?)\b/); if (length) values.length = Number(length[1].replace(',', '.'));
  const speed = text.match(/(?:velocidad(?: de)?|a)\s*(\d+(?:[.,]\d+)?)\s*m\s*\/\s*s/); if (speed) values.speed = Number(speed[1].replace(',', '.'));
  return normalizePlan(Object.assign(values, overrides));
}
function planSummary(value) { const p = normalizePlan(value), corner = p.shape === 'l' ? ', ' + TURN_TYPES[p.turn].toLowerCase() : ''; return p.conveyorCount + ' módulos de transporte en ' + SHAPES[p.shape] + corner + '; ' + p.productCount + ' perfiles de producto, ' + (p.quantity ? p.quantity + ' cargas' : 'generación continua') + ', ' + (p.automatic ? 'flujo automático' : 'carga manual') + ', Source y almacén final' + (p.monitor ? ', monitor vinculado a toda la línea.' : '.'); }
module.exports = {VERSION, SHAPES, TECHNOLOGIES, TURN_TYPES, normalizePlan, planFromInstruction, planSummary};
