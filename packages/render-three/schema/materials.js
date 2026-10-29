/* Serializable surface descriptions shared by the editor and SQLite boundary. */
'use strict';

const defaults = {
  preset: 'custom', name: 'Material personalizado', slot: 'all', color: '#b8c4cc',
  metalness: 0.2, roughness: 0.55, opacity: 1, clearcoat: 0, clearcoatRoughness: 0.3,
  emissiveMode: 'preserve', emissive: '#fff0d2', emissiveIntensity: 1,
  texture: '', colorMapMode: 'preserve', normalMap: '', normalStrength: 1, roughnessMap: '', metalnessMap: '', repeatX: 1, repeatY: 1,
  wear: 0, wearType: 'scratches', wearScale: 1, seed: 1
};
const presets = [
  {id: 'custom', label: 'Personalizado / conservar mapas', description: 'Ajusta el material y conserva las texturas del modelo.', values: {}},
  {id: 'steel', label: 'Acero cepillado', description: 'Acero con acabado satinado.', values: {color: '#bbc5cd', metalness: 0.92, roughness: 0.32}},
  {id: 'aluminum', label: 'Aluminio', description: 'Metal claro con pulido suave.', values: {color: '#d2d9df', metalness: 0.95, roughness: 0.23}},
  {id: 'paintedMetal', label: 'Metal pintado', description: 'Pintura industrial sobre metal.', values: {color: '#326c8e', metalness: 0.35, roughness: 0.38, clearcoat: 0.4, clearcoatRoughness: 0.25}},
  {id: 'wood', label: 'Madera', description: 'Madera con veta procedural si el modelo no aporta textura.', values: {color: '#bd8c52', metalness: 0, roughness: 0.78}},
  {id: 'ceramic', label: 'Cerámica esmaltada', description: 'Cerámica clara con acabado brillante.', values: {color: '#eee9df', metalness: 0, roughness: 0.18, clearcoat: 0.8, clearcoatRoughness: 0.12}},
  {id: 'plastic', label: 'Plástico', description: 'Plástico con acabado satinado.', values: {color: '#588a9a', metalness: 0, roughness: 0.43, clearcoat: 0.18}},
  {id: 'glass', label: 'Vidrio transparente', description: 'Transparencia compatible con este motor WebXR.', values: {color: '#d5edf0', metalness: 0, roughness: 0.06, opacity: 0.24, clearcoat: 1, clearcoatRoughness: 0.04}},
  {id: 'rubber', label: 'Goma / caucho', description: 'Superficie oscura y mate.', values: {color: '#252b30', metalness: 0, roughness: 0.92}},
  {id: 'concrete', label: 'Hormigón', description: 'Hormigón rugoso con grano fino.', values: {color: '#929590', metalness: 0, roughness: 0.96}}
];
const photographic = require('../../../modules/logistica-industrial/functions/presentacion/schema/industrial-pbr.js');
photographic.PROFILES.forEach(profile => presets.push({id:'photo-'+profile.id,label:profile.name+' · PBR CC0',description:'Mapas fotográficos locales de '+profile.provider+'. Se aplica sólo a la parte elegida.',values:{color:profile.color,metalness:profile.metalness,roughness:Math.min(1,profile.roughness/Math.max(.28,profile.roughnessMean)),texture:photographic.path(profile.id,'neutral'),normalMap:photographic.path(profile.id,'normal'),normalStrength:profile.normalStrength,roughnessMap:photographic.path(profile.id,'roughness')}}));
const materialTypes = presets.map(preset => preset.id);
function number(key, label, min, max, step) { return {key, label, input: 'number', default: defaults[key], min, max, step}; }
function text(key, label, maxLength, input = 'text') { return {key, label, input, default: defaults[key], maxLength}; }
const fields = [
  {key: 'preset', label: 'Tipo de material', input: 'select', default: 'custom', options: presets.map(preset => ({value: preset.id, label: preset.label}))},
  text('name', 'Nombre del material', 160), text('slot', 'Parte o material de destino', 220), text('color', 'Color base', 7, 'color'),
  {key: 'colorMapMode', label: 'Textura de color', input: 'select', default: 'preserve', options: [{value: 'preserve', label: 'Conservar / usar imagen de color'}, {value: 'none', label: 'Solo color, sin imagen de color'}]},
  number('metalness', 'Metalizado', 0, 1, 0.05), number('roughness', 'Rugosidad', 0, 1, 0.05), number('opacity', 'Opacidad', 0, 1, 0.05),
  number('clearcoat', 'Barniz', 0, 1, 0.05), number('clearcoatRoughness', 'Rugosidad del barniz', 0, 1, 0.05),
  {key: 'emissiveMode', label: 'Emisión', input: 'select', default: defaults.emissiveMode, options: [{value: 'preserve', label: 'Conservar emisión del modelo'}, {value: 'custom', label: 'Luminiscencia personalizada'}]},
  text('emissive', 'Color de emisión', 7, 'color'), number('emissiveIntensity', 'Intensidad de emisión', 0, 5, 0.05),
  text('texture', 'Imagen de color (vacío conserva la original)', 1000, 'image'), text('normalMap', 'Mapa de normales', 1000, 'image'), number('normalStrength', 'Intensidad del relieve fino', 0, 3, .05),
  text('roughnessMap', 'Mapa de rugosidad', 1000, 'image'), text('metalnessMap', 'Mapa de metalizado', 1000, 'image'),
  number('repeatX', 'Repeticiones U', 0.05, 100, 0.05), number('repeatY', 'Repeticiones V', 0.05, 100, 0.05),
  number('wear', 'Desgaste general', 0, 1, 0.05),
  {key: 'wearType', label: 'Tipo de desgaste', input: 'select', default: 'scratches', options: [['scratches', 'Rayaduras'], ['rust', 'Óxido'], ['dirt', 'Suciedad'], ['chips', 'Desconchados']].map(([value, label]) => ({value, label}))},
  number('wearScale', 'Repeticiones del desgaste', 0.1, 20, 0.1), number('seed', 'Variación de la superficie', 0, 65535, 1)
];

function plain(value) { return value && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function assetReference(value) {
  if (typeof value !== 'string' || value.length > 1000 || /[\x00-\x1f\x7f:%?#\\]/.test(value) || value.startsWith('/') || value && value.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error('La textura debe ser una ruta relativa o un archivo importado.');
  }
  return value;
}
function getPreset(id) {
  const preset = presets.find(item => item.id === id);
  if (!preset) throw new Error('Tipo de material no compatible.');
  return Object.assign({}, defaults, preset.values, {preset: preset.id, name: preset.id === 'custom' ? defaults.name : preset.label});
}
const MAX_ASSIGNMENTS = 32;
function normalizeAssignment(value = {}, strict = false) {
  if (!plain(value) || value.type !== undefined && value.type !== 'surfaceMaterial') throw new Error('Material de superficie inválido.');
  if (strict && Object.keys(value).some(key => !['type', 'enabled'].concat(fields.map(field => field.key)).includes(key))) throw new Error('La asignación de material contiene propiedades no compatibles.');
  const result = Object.assign({type: 'surfaceMaterial', enabled: true}, getPreset(value.preset === undefined ? 'custom' : value.preset));
  if (value.enabled !== undefined) {
    if (typeof value.enabled !== 'boolean') throw new Error('La activación del material debe ser verdadero o falso.');
    result.enabled = value.enabled;
  }
  fields.forEach(field => {
    if (value[field.key] === undefined) return;
    const item = value[field.key];
    if (field.input === 'number') {
      if (typeof item !== 'number' || !Number.isFinite(item) || item < field.min || item > field.max || field.key === 'seed' && !Number.isInteger(item)) throw new Error('Valor fuera de rango en material: ' + field.label + '.');
    } else if (field.input === 'select') {
      if (!field.options.some(option => option.value === item)) throw new Error('Opción de material no compatible: ' + field.label + '.');
    } else if (field.input === 'color') {
      if (typeof item !== 'string' || !/^#[a-f0-9]{6}$/i.test(item)) throw new Error('El color del material debe tener formato #RRGGBB.');
    } else if (typeof item !== 'string' || item.length > field.maxLength) throw new Error('Texto de material demasiado largo o inválido.');
    result[field.key] = field.input === 'color' ? item.toLowerCase() : item;
  });
  // Old projects and guarded upgrades retain their literal descriptions.
  // Absence means the source model's normal scale; new photo presets opt in.
  if (value.normalStrength === undefined && !result.preset.startsWith('photo-')) delete result.normalStrength;
  if (!/^(?:all|index:(?:0|[1-9][0-9]{0,2})|mesh:(?:root|(?:0|[1-9][0-9]{0,4})(?:\.(?:0|[1-9][0-9]{0,4})){0,47}):(?:0|[1-9][0-9]{0,2})|(?:name|part):[^\x00-\x1f\x7f]+)$/.test(result.slot) || result.slot.startsWith('index:') && Number(result.slot.slice(6)) > 255 || result.slot.startsWith('mesh:') && Number(result.slot.slice(result.slot.lastIndexOf(':') + 1)) > 255) throw new Error('Selecciona una parte o un material de destino válido.');
  ['texture', 'normalMap', 'roughnessMap', 'metalnessMap'].forEach(key => assetReference(result[key]));
  return result;
}

function normalizeMaterial(value = {}) {
  const result = normalizeAssignment(value);
  const overrides = value.overrides === undefined ? [] : value.overrides;
  if (!Array.isArray(overrides) || overrides.length >= MAX_ASSIGNMENTS) throw new Error('Un objeto admite hasta ' + MAX_ASSIGNMENTS + ' asignaciones de material.');
  result.overrides = overrides.map(item => normalizeAssignment(item, true));
  return result;
}
function assignments(value) {
  const normalized = normalizeMaterial(value);
  const base = Object.assign({}, normalized); delete base.overrides;
  return [base].concat(normalized.overrides);
}
function fromAssignments(values, enabled = true) {
  if (!Array.isArray(values) || !values.length || values.length > MAX_ASSIGNMENTS || typeof enabled !== 'boolean') throw new Error('Lista de asignaciones de material inválida.');
  const entries = values.map(value => normalizeAssignment(value, true));
  return normalizeMaterial(Object.assign({}, entries[0], {enabled, overrides: entries.slice(1)}));
}

module.exports = {presets, materialTypes, fields, defaults, getPreset, normalizeMaterial, assignments, fromAssignments, MAX_ASSIGNMENTS};
