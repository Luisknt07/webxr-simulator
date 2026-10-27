'use strict';

const {normalizeBehaviors} = require('../shared/behaviors');

const ROOM_IDS = new Set(['hall', 'sound', 'photogrammetry', 'vertigo', 'panoramastereo', 'panorama1', 'panorama2', 'panorama3', 'panorama4', 'panorama5']);
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const IMPORT_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/;
const MAX_OBJECTS = 10000;

class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || 'invalid_request';
  }
}

function invalid(message) { throw new ApiError(400, message); }
function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

// Reject dangerous keys before copying any untrusted JSON into application objects.
function safeTree(value, depth = 0, budget = {count: 0}) {
  if (++budget.count > 500000 || depth > 30) invalid('El documento es demasiado complejo.');
  if (typeof value === 'number' && !Number.isFinite(value)) invalid('El documento contiene un número inválido.');
  if (!value || typeof value !== 'object') return;
  if (!Array.isArray(value) && !plain(value)) invalid('El documento debe contener datos JSON.');
  for (const key of Object.keys(value)) {
    if (UNSAFE_KEYS.has(key)) invalid('El documento contiene una propiedad no permitida.');
    safeTree(value[key], depth + 1, budget);
  }
}

function nameValue(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 160 || /[\u0000-\u001f]/.test(value)) {
    invalid('Escribe un nombre de entre 1 y 160 caracteres.');
  }
  return value.trim();
}

function pathValue(value) {
  if (typeof value !== 'string' || !value || value.length > 1000 || /[\u0000-\u001f?#]/.test(value) ||
      /^[a-z]+:/i.test(value) || /^[\\/]/.test(value)) invalid('La ruta del recurso no es válida.');
  let decoded;
  try { decoded = decodeURIComponent(value); } catch (_) { invalid('La ruta del recurso no es válida.'); }
  if (/[\u0000-\u001f?#:]/.test(decoded) || /^[\\/]/.test(decoded) || decoded.split(/[\\/]/).some(part => part === '..')) {
    invalid('La ruta del recurso no es válida.');
  }
  return value.replace(/\\/g, '/');
}

function vector(value, length, positive) {
  if (!Array.isArray(value) || value.length !== length || value.some(n =>
    typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 1000000 || (positive && n <= 0))) {
    invalid('La transformación del objeto no es válida.');
  }
  return value.slice();
}

function colorValue(value) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) invalid('El color del objeto no es válido.');
  return value.toLowerCase();
}

function stateValue(value, partial, importIds) {
  const state = {};
  for (const field of ['position', 'quaternion', 'scale']) {
    if (value[field] !== undefined) state[field] = vector(value[field], field === 'quaternion' ? 4 : 3, field === 'scale');
    else if (!partial) invalid('Falta la transformación ' + field + '.');
  }
  if (state.quaternion) {
    const length = Math.hypot(...state.quaternion);
    if (length < 0.000001 || Math.abs(length - 1) > 0.01) invalid('La rotación del objeto no es válida.');
    // Unit quaternions already contain IEEE-754 rounding. Re-dividing them on
    // every save changes untouched scenes by a few bits and is not idempotent.
    if (Math.abs(length - 1) > 16 * Number.EPSILON) state.quaternion = state.quaternion.map(n => n / length);
  }
  if (value.visible !== undefined) {
    if (typeof value.visible !== 'boolean') invalid('La visibilidad del objeto no es válida.');
    state.visible = value.visible;
  } else if (!partial) state.visible = true;
  if (value.color !== undefined) state.color = value.color === null ? null : colorValue(value.color);
  if (value.behaviors !== undefined) {
    try { state.behaviors = normalizeBehaviors(value.behaviors); }
    catch (error) { invalid(error.message); }
  }
  if (value.visual !== undefined) state.visual = value.visual === null ? null : descriptorValue(value.visual, importIds);
  return state;
}

function descriptorValue(value, importIds) {
  if (!plain(value)) invalid('El descriptor del recurso no es válido.');
  if (value.type === 'cad') {try{return require('../shared/cad').normalizeDescriptor(value);}catch(error){invalid(error.message);}}
  if (value.prefab !== undefined) {
if (!['conveyor', 'sensor', 'plc', 'control', 'product', 'source', 'processor', 'palletQueue', 'robot', 'vehicle'].includes(value.prefab)) invalid('La plantilla industrial no es compatible.');
    const descriptor = {prefab: value.prefab};
    if (value.variant !== undefined) {
const variants = value.prefab === 'vehicle' ? require('../shared/vehicles.js').variants : value.prefab === 'product' ? require('../shared/product-equipment.js').variants : value.prefab === 'robot' ? require('../shared/robots.js').variants : value.prefab === 'conveyor' ? require('../shared/conveyors.js').presetVariants : value.prefab === 'source' ? ['queue'] : value.prefab === 'processor' ? ['combiner', 'separator'] : value.prefab === 'control' ? ['start', 'stop', 'emergency', 'pause', 'powerOn', 'powerOff', 'speedUp', 'speedDown', 'insertBox', 'resetEmergency', 'generate', 'dispatch', 'clearQueue', 'operator'] : [];
      if (!variants.includes(value.variant)) invalid('La variante del equipo no es compatible.');
      descriptor.variant = value.variant;
    }
    return descriptor;
  }
  if (value.nativeId !== undefined) {
    const match = typeof value.nativeId === 'string' && /^native:([a-zA-Z0-9_-]+):root(?:\.\d+)*$/.exec(value.nativeId);
    if (!match || !ROOM_IDS.has(match[1]) || value.nativeId.length > 400) invalid('La plantilla nativa del recurso no es válida.');
    return {nativeId: value.nativeId};
  }
  if (['box', 'sphere', 'plane', 'cylinder'].includes(value.type)) {
    return {type: value.type, color: colorValue(value.color || '#60a5fa')};
  }
  if (value.type === 'decal' || value.type === 'audioZone') return {type: value.type};
  if (value.type === 'industrialFloor') return require('../shared/industrialFloor').normalize(value);
  if (typeof value.importId === 'string' && IMPORT_ID.test(value.importId)) {
    if (!importIds.has(value.importId)) invalid('Falta un archivo importado utilizado por la escena.');
    return {importId: value.importId};
  }
  return {path: pathValue(value.path)};
}

function interactionValue(value, importIds) {
  if (value == null) return {type: 'none'};
  if (!plain(value) || !['none', 'room', 'toggle', 'sound', 'message', 'teleport'].includes(value.type)) invalid('La interacción no es compatible.');
  const result = {type: value.type};
  if (value.type === 'room') {
    if (!Number.isInteger(value.room) || value.room < 0 || value.room > 9) invalid('La sala de destino no es válida.');
    result.room = value.room;
  } else if (value.type === 'toggle') {
    if (typeof value.targetId !== 'string' || value.targetId.length > 400) invalid('El objeto de destino no es válido.');
    result.targetId = value.targetId;
  } else if (value.type === 'sound') {
    if (typeof value.asset !== 'string' || value.asset.length > 1000) invalid('El sonido no es válido.');
    if (value.asset && !importIds.has(value.asset)) pathValue(value.asset);
    result.asset = value.asset;
  } else if (value.type === 'message') {
    if (typeof value.text !== 'string' || value.text.length > 650) invalid('El mensaje debe tener hasta 650 caracteres.');
    result.text = value.text;
  }
  return result;
}

function validateDocument(data, normalizeImport) {
  safeTree(data);
  if (!plain(data) || data.format !== 'hello-webxr-editor' || data.version !== 1 || !plain(data.rooms)) {
    invalid('Este documento no es un escenario compatible del editor.');
  }
  const imports = data.imports === undefined ? [] : data.imports;
  if (!Array.isArray(imports) || imports.length > 10000) invalid('La biblioteca importada no es válida.');
  const importIds = new Set();
  for (const record of imports) {
    if (!plain(record) || typeof record.id !== 'string' || !IMPORT_ID.test(record.id) || importIds.has(record.id)) {
      invalid('Hay un archivo importado inválido o repetido.');
    }
    importIds.add(record.id);
    pathValue(record.path);
    if (record.importId !== undefined && record.importId !== record.id) invalid('La referencia del archivo importado no coincide.');
    if (record.batchId !== undefined && (typeof record.batchId !== 'string' || !IMPORT_ID.test(record.batchId))) invalid('El grupo de archivos importados no es válido.');
  }
  const rooms = {};
  const objectIds = new Set();
  let count = 0;
  for (const roomId of Object.keys(data.rooms)) {
    if (!ROOM_IDS.has(roomId)) invalid('El escenario contiene una sala desconocida.');
    const room = data.rooms[roomId];
    if (!plain(room) || !Array.isArray(room.overrides) || !Array.isArray(room.additions)) invalid('Los datos de la sala no son válidos.');
    count += room.overrides.length + room.additions.length;
    if (count > MAX_OBJECTS) invalid('El escenario contiene demasiados objetos.');
    const overrides = room.overrides.map(item => {
      if (!plain(item) || typeof item.id !== 'string' || !item.id.startsWith('native:' + roomId + ':') ||
          !/^native:[a-zA-Z0-9_-]+:root(?:\.\d+)*$/.test(item.id) || item.id.length > 400 || objectIds.has(item.id)) {
        invalid('La referencia nativa no es válida o está repetida.');
      }
      objectIds.add(item.id);
      return Object.assign({id: item.id}, stateValue(item, true, importIds));
    });
    const additions = room.additions.map(item => {
      if (!plain(item) || typeof item.id !== 'string' || !/^custom-[a-zA-Z0-9_-]{1,150}$/.test(item.id) || objectIds.has(item.id)) {
        invalid('El identificador del objeto no es válido o está repetido.');
      }
      objectIds.add(item.id);
      const record = Object.assign({id: item.id, name: nameValue(item.name), descriptor: descriptorValue(item.descriptor, importIds),
        interaction: interactionValue(item.interaction, importIds)}, stateValue(item, false, importIds));
      if (item.nodes !== undefined) {
        if (!(record.descriptor.nativeId || record.descriptor.prefab) || !plain(item.nodes)) invalid('Los componentes descendientes no son válidos.');
        record.nodes = {};
        for (const nodePath of Object.keys(item.nodes)) {
          const node = item.nodes[nodePath];
          if (!/^\d+(?:\.\d+)*$/.test(nodePath) || nodePath.length > 200 || !plain(node)) invalid('La ruta de componente descendiente no es válida.');
          if (++count > MAX_OBJECTS) invalid('El escenario contiene demasiados objetos.');
          const nodeState = Object.assign({name: node.name === '' ? '' : nameValue(node.name)}, stateValue(node, false, importIds));
          if (node.interaction !== undefined) nodeState.interaction = interactionValue(node.interaction, importIds);
          record.nodes[nodePath] = nodeState;
        }
      }
      return record;
    });
    rooms[roomId] = {overrides, additions};
  }
  const result = {format: data.format, version: 1, rooms, imports: imports.map(normalizeImport)};
  if (data.studio !== undefined) {
    try { result.studio = require('../shared/studio-document').normalize(data.studio); }
    catch (error) { invalid(error.message); }
  }
  return result;
}

module.exports = {ApiError, invalid, plain, safeTree, nameValue, pathValue, validateDocument};
