/* Metric cargo recipes shared by insertion, authoring and source generation. */
'use strict';
const VERSION = 1;
const PRODUCT_TYPES = [
  ['box', 'Caja de cartón'], ['crate', 'Caja plástica'], ['tote', 'Contenedor abierto'], ['bottle', 'Botella'], ['jerrycan', 'Garrafa'],
  ['drum', 'Tambor'], ['sack', 'Saco'], ['cylinder', 'Cilindro'], ['reel', 'Bobina'], ['pallet', 'Pallet'], ['cage', 'Jaula / contenedor metálico']
].map(([value, label]) => ({value, label}));
const BASE = {variant: '', productType: 'box', width: .3, height: .25, depth: .4, mass: 2, color: '#b48a52', labelColor: '#ece9d9', capColor: '#384b5c',
  sku: 'product', quality: 'good', defect: 'none', base: 'flat', units: 1, loadMode: 'individual', palletType: 'euro-1200x800', palletMaterial: 'wood', contents: 'boxes'};
const recipe = (id, name, changes) => ({id, name, status: 'ready', family: 'cargo', preset: Object.assign({}, BASE, changes, {variant: id, sku: id}),
  description: name + ' paramétrico, con masa, dimensiones y atributos de clasificación editables.'});
const VARIANTS = [
  recipe('box-small', 'Caja pequeña', {width: .24, height: .2, depth: .3, mass: 1}), recipe('box-medium', 'Caja mediana', {width: .4, height: .3, depth: .5, mass: 4}),
  recipe('box-large', 'Caja grande', {width: .6, height: .45, depth: .65, mass: 12}), recipe('carton-bundle', 'Paquete de cajas flejadas', {width: .55, height: .48, depth: .7, mass: 18, units: 6}),
  recipe('crate', 'Caja plástica reforzada', {productType: 'crate', width: .4, height: .3, depth: .6, mass: 5, color: '#477c9d', base: 'rigid'}),
  recipe('tote', 'Contenedor abierto', {productType: 'tote', width: .4, height: .25, depth: .6, mass: 3, color: '#558e82', base: 'rigid'}),
  recipe('bottle', 'Botella con tapón', {productType: 'bottle', width: .12, height: .32, depth: .12, mass: 1, color: '#61978b', capColor: '#e2d8b4', base: 'unstable'}),
  recipe('jerrycan', 'Garrafa con asa', {productType: 'jerrycan', width: .28, height: .42, depth: .22, mass: 12, color: '#c8b477', base: 'rigid'}),
  recipe('drum', 'Tambor industrial', {productType: 'drum', width: .58, height: .88, depth: .58, mass: 80, color: '#527c9c', base: 'rigid'}),
  recipe('sack', 'Saco cosido', {productType: 'sack', width: .5, height: .22, depth: .75, mass: 25, color: '#b4a37d', base: 'unstable'}),
  recipe('cylinder', 'Cilindro con válvula', {productType: 'cylinder', width: .27, height: 1.2, depth: .27, mass: 45, color: '#657f70', base: 'unstable'}),
  recipe('reel', 'Bobina de cable', {productType: 'reel', width: .7, height: .7, depth: .5, mass: 65, color: '#a7834f', base: 'unstable'}),
  recipe('pallet-euro', 'Pallet europeo vacío · 1200 × 800', {productType: 'pallet', width: 1.2, height: .144, depth: .8, mass: 25, base: 'runners', loadMode: 'pallet'}),
  recipe('pallet-industrial', 'Pallet industrial vacío · 1200 × 1000', {productType: 'pallet', width: 1.2, height: .15, depth: 1, mass: 20, base: 'runners', loadMode: 'pallet', palletType: 'industrial-1200x1000'}),
  recipe('pallet-plastic', 'Pallet plástico vacío', {productType: 'pallet', width: 1.2, height: .16, depth: 1, mass: 12, base: 'runners', loadMode: 'pallet', palletMaterial: 'plastic', palletType: 'industrial-1200x1000', color: '#47768b'}),
  recipe('pallet-loaded', 'Pallet cargado con cajas', {productType: 'pallet', width: 1.2, height: 1.1, depth: .8, mass: 145, units: 24, base: 'runners', loadMode: 'pallet'}),
  recipe('cage', 'Jaula metálica sobre pallet', {productType: 'cage', width: 1.2, height: 1.1, depth: .8, mass: 50, color: '#8f9b9d', base: 'runners', loadMode: 'pallet'})
];
const variants = VARIANTS.map(item => item.id);
function getDefinition(id) { if (typeof id !== 'string') return null; return VARIANTS.find(item => item.id === id.replace(/^product\./, '')) || null; }
function defaults(id) { const definition = getDefinition(id); return Object.assign({}, definition ? definition.preset : BASE); }
function fields() {
  const n = (key, label, min, max, step) => ({key, label, input: 'number', default: BASE[key], min, max, step});
  const c = (key, label, options) => ({key, label, input: 'select', default: BASE[key], options});
  const color = (key, label) => ({key, label, input: 'color', default: BASE[key], maxLength: 7});
  return [c('variant', 'Modelo de producto / carga', [{value: '', label: 'Conservar modelo original'}].concat(VARIANTS.map(item => ({value: item.id, label: item.name})))),
    c('productType', 'Tipo de producto', PRODUCT_TYPES), n('width', 'Ancho · m', .05, 4, .01), n('height', 'Alto · m', .03, 4, .01), n('depth', 'Fondo · m', .05, 4, .01), n('mass', 'Masa total de esta carga · kg', .01, 3000, .1),
    n('units', 'Unidades contenidas', 1, 64, 1), c('loadMode', 'Unidad de manipulación', [{value: 'individual', label: 'Individual / paquete'}, {value: 'pallet', label: 'Pallet completo'}]),
    c('palletType', 'Formato de pallet', [{value: 'euro-1200x800', label: '1200 × 800 mm'}, {value: 'industrial-1200x1000', label: '1200 × 1000 mm'}, {value: 'half-800x600', label: '800 × 600 mm'}, {value: 'custom', label: 'Personalizado'}]),
    c('palletMaterial', 'Material del pallet', [{value: 'wood', label: 'Madera'}, {value: 'plastic', label: 'Plástico'}]),
    c('contents', 'Contenido visual del pallet', [{value: 'boxes', label: 'Cajas'}, {value: 'crates', label: 'Cajas plásticas'}, {value: 'bottles', label: 'Botellas'}]),
    color('color', 'Color del cuerpo / clasificación'), color('labelColor', 'Color de etiqueta'), color('capColor', 'Color de tapa / fleje')];
}
function normalize(value = {}, id) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.keys(value).some(key => ['__proto__', 'prototype', 'constructor'].includes(key))) throw new Error('Producto inválido.');
  if (id && !getDefinition(id)) throw new Error('Modelo de producto no compatible.');
  const result = Object.assign({}, defaults(id || value.variant), value);
  fields().forEach(field => {
    const item = result[field.key];
    if (field.input === 'number' && (typeof item !== 'number' || !Number.isFinite(item) || item < field.min || item > field.max || field.key === 'units' && !Number.isInteger(item))) throw new Error('Valor de producto fuera de rango: ' + field.label + '.');
    if (field.input === 'select' && !field.options.some(option => option.value === item)) throw new Error('Opción de producto no compatible: ' + field.label + '.');
    if (field.input === 'color' && (typeof item !== 'string' || !/^#[a-f0-9]{6}$/i.test(item))) throw new Error('El color del producto debe tener formato #RRGGBB.');
  });
  if (typeof result.sku !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(result.sku)) throw new Error('SKU de producto inválido.');
  if (!['flat', 'rigid', 'runners', 'unstable'].includes(result.base)) throw new Error('Base del producto inválida.');
  if (!['good', 'defective'].includes(result.quality) || !['none', 'damaged', 'surface', 'dimension', 'incomplete'].includes(result.defect) || result.quality === 'good' && result.defect !== 'none') throw new Error('Calidad o defecto del producto inválido.');
  if (result.quality === 'defective' && result.defect === 'none') result.defect = 'damaged';
  if (result.loadMode === 'pallet') result.base = 'runners';
  return result;
}
function forkPockets(height = .144) { return {bottom: height * .22, top: height * .74, deck: height * .74, minSpread: .28, maxSpread: .75, entryAxes: ['x', 'z']}; }
function listEquipment() { return VARIANTS.map(item => Object.assign({variant: item.id, prefab: 'product', parameters: fields(), parts: ['Cuerpo', 'Cierre', 'Etiqueta'], provenance: {parameters: 'Dimensiones y masa didácticas editables; no certificación de capacidad.'}}, item)); }
module.exports = {VERSION, PRODUCT_TYPES, VARIANTS, variants, BASE, defaults, fields, normalize, getDefinition, getEquipment: getDefinition, listEquipment, forkPockets};
