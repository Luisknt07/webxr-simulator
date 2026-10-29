'use strict';

// Optional, additive extension of editor format 1. Older documents need no migration.
const ROOM_IDS = ['hall', 'sound', 'photogrammetry', 'vertigo', 'panoramastereo', 'panorama1', 'panorama2', 'panorama3', 'panorama4', 'panorama5'];
const ROOM_NAMES = ['Sala principal', 'Sala de sonido', 'Fotogrametría', 'Vértigo', 'Panorama estéreo', 'Panorama 1', 'Panorama 2', 'Panorama 3', 'Panorama 4', 'Panorama 5'];

// A Studio label is optional metadata, never the inventory of existing levels.
// Native and legacy rooms remain available before their assets are activated.
function sceneEntries(document = {}) {
  const studio = document.studio || {}, names = new Map((studio.scenes || []).map(scene => [scene.id, scene.name]));
  return ROOM_IDS.map((id, index) => ({id, index, name: names.get(id) || ROOM_NAMES[index], custom: names.has(id), initial: studio.startRoomId === id}));
}
function hasSceneContent(document = {}, roomId) {
  const studio = document.studio || {};
  if (['environments', 'entities', 'spawns', 'widgets', 'missions', 'groups'].some(key => (studio[key] || []).some(item => item.roomId === roomId))) return true;
  if (document.rooms && !(document.rooms instanceof Map)) {
    const room = document.rooms[roomId];
    if (room && ((room.additions || []).length || (room.overrides || []).length)) return true;
  }
  if (document.additions && Array.from(document.additions.values()).some(entry => entry.roomId === roomId)) return true;
  if (document.overrides && Array.from(document.overrides.keys()).some(id => id.startsWith('native:' + roomId + ':'))) return true;
  const pending = document.pendingRooms && document.pendingRooms.get(roomId);
  return !!(pending && ((pending.additions || []).length || (pending.nativeVisuals || []).length));
}
function defaultEnvironment(roomId) {
  return {roomId: choice(roomId, ROOM_IDS), sky: 'day', skyColor: '#83b9ef', horizonColor: '#e5f1fa', groundColor: '#657383', sunColor: '#fff4df', sunIntensity: 1, ambientIntensity: 0.4};
}
// The previous New level command hid every native actor and created only a
// floor. Repair that precise live-document shape without changing saved data
// or treating a renamed native scene as an empty custom level.
function environmentFor(document = {}, roomId) {
  const studio = document.studio || {};
  const explicit = (studio.environments || []).find(item => item.roomId === roomId);
  if (explicit) return explicit;
  if (!(studio.scenes || []).some(item => item.id === roomId) || typeof document.getObjects !== 'function' || !document.additions || typeof document.additions.values !== 'function') return null;
  const native = document.getObjects(roomId).filter(object => document.isNative ? document.isNative(object) : object.userData && object.userData.editorNative);
  if (!native.length || native.some(object => object.visible !== false)) return null;
  const ground = Array.from(document.additions.values()).some(entry => {
    const object = entry.object, quaternion = object && object.quaternion;
    return entry.roomId === roomId && entry.descriptor && entry.descriptor.type === 'plane' && object && object.visible !== false && Math.abs(object.position.y) < 0.1 && quaternion && Math.abs(2 * (quaternion.y * quaternion.z - quaternion.w * quaternion.x)) > 0.95;
  });
  return ground ? defaultEnvironment(roomId) : null;
}
const DEFAULT_FOLDERS = new Set(['scenes', 'models', 'materials', 'images', 'audio', 'video', 'interfaces', 'missions', 'templates', 'data']);
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const copy = value => JSON.parse(JSON.stringify(value));
function text(value, maximum = 160, empty = false) {
  if (typeof value !== 'string' || value.length > maximum || (!empty && !value.trim())) throw new Error('Texto de Studio inválido.');
  return value.trim();
}
function id(value) { const result = text(value, 450); if (['__proto__', 'constructor', 'prototype'].includes(result)) throw new Error('Identificador reservado.'); return result; }
function resourceId(value) { const result = text(value, 1200); if (['__proto__', 'constructor', 'prototype'].includes(result)) throw new Error('Identificador reservado.'); return result; }
function list(value, maximum, map) {
  if (!Array.isArray(value) || value.length > maximum) throw new Error('Lista de Studio fuera de sus límites.');
  return value.map(item => { if (!plain(item)) throw new Error('Registro de Studio inválido.'); return map(item); });
}
function number(value, min, max) { if (!Number.isFinite(value) || value < min || value > max) throw new Error('Valor de Studio fuera de sus límites.'); return value; }
function choice(value, allowed) { if (!allowed.includes(value)) throw new Error('Opción de Studio no compatible.'); return value; }
function environmentValue(item) {
  const result = defaultEnvironment(item.roomId);
  result.sky = choice(item.sky === undefined ? result.sky : item.sky, ['day', 'color', 'native']);
  ['skyColor', 'horizonColor', 'groundColor', 'sunColor'].forEach(key => {
    if (item[key] === undefined) return;
    if (typeof item[key] !== 'string' || !/^#[0-9a-f]{6}$/i.test(item[key])) throw new Error('Color de entorno inválido.');
    result[key] = item[key].toLowerCase();
  });
  ['sunIntensity', 'ambientIntensity'].forEach(key => { if (item[key] !== undefined) result[key] = number(item[key], 0, 5); });
  // Keep these additions optional so opening a legacy project does not rewrite
  // its untouched rooms. Runtime/UI defaults apply until an author saves them.
  if (item.renderQuality !== undefined) result.renderQuality = choice(item.renderQuality, ['performance', 'balanced', 'high']);
  if (item.exposure !== undefined) result.exposure = number(item.exposure, .4, 2);
  ['shadows', 'machineSounds'].forEach(key => {
    if (item[key] === undefined) return;
    if (typeof item[key] !== 'boolean') throw new Error('La opción del entorno debe ser verdadero o falso.');
    result[key] = item[key];
  });
  ['machineVolume', 'ambientVolume'].forEach(key => { if (item[key] !== undefined) result[key] = number(item[key], 0, 1); });
  if (item.ambientPreset !== undefined) result.ambientPreset = choice(item.ambientPreset, ['off', 'warehouse', 'factory', 'ventilation']);
  if (item.ambientSound !== undefined) result.ambientSound = require('../../../modules/logistica-industrial/functions/presentacion/schema/machineAudio').assetReference(item.ambientSound);
  return result;
}
function unique(rows, key, label) {
  const seen = new Set();
  rows.forEach(row => { if (seen.has(row[key])) throw new Error(label + ' repetidos.'); seen.add(row[key]); });
  return rows;
}
function entityValue(item) {
  if (!plain(item)) throw new Error('Entidad de Studio inválida.');
  return {
    id: id(item.id), objectId: id(item.objectId), roomId: choice(item.roomId, ROOM_IDS), type: choice(item.type, ['pointLight', 'camera']),
    color: /^#[0-9a-f]{6}$/i.test(item.color || '') ? item.color.toLowerCase() : '#ffffff',
    intensity: number(item.intensity === undefined ? 1 : item.intensity, 0, 20), range: number(item.range === undefined ? 8 : item.range, 0, 1000), fov: number(item.fov === undefined ? 55 : item.fov, 10, 120)
  };
}
function safe(value, depth = 0) {
  if (depth > 32) throw new Error('Datos de Studio demasiado profundos.');
  if (value === null || ['string', 'boolean'].includes(typeof value) || typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) { value.forEach(item => safe(item, depth + 1)); return; }
  if (!plain(value)) throw new Error('Datos de Studio inválidos.');
  Object.keys(value).forEach(key => { if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Clave de Studio reservada.'); safe(value[key], depth + 1); });
}
function normalize(value) {
  if (value === undefined || value === null) return null;
  safe(value);
  if (!plain(value) || value.version !== 1 || JSON.stringify(value).length > 8 * 1024 * 1024) throw new Error('Extensión de Studio incompatible o demasiado grande.');
  const result = {version: 1};
  if (value.startRoomId !== undefined) result.startRoomId = choice(value.startRoomId, ROOM_IDS);
  if (value.scenes !== undefined) result.scenes = unique(list(value.scenes, 10, item => ({id: choice(item.id, ROOM_IDS), name: text(item.name)})), 'id', 'Escenarios');
  if (value.environments !== undefined) result.environments = unique(list(value.environments, 10, environmentValue), 'roomId', 'Entornos de niveles');
  if (value.organization !== undefined) {
    const source = value.organization;
    if (!plain(source)) throw new Error('Organización de proyecto inválida.');
    result.organization = {
      folders: list(source.folders || [], 500, item => ({id: id(item.id), name: text(item.name), parentId: item.parentId == null ? null : id(item.parentId)})),
      resources: list(source.resources || [], 10000, item => ({id: resourceId(item.id), name: text(item.name || item.id), folderId: item.folderId == null ? null : id(item.folderId)})),
      favorites: source.favorites === undefined ? [] : Array.isArray(source.favorites) ? Array.from(new Set(source.favorites.map(resourceId))) : (() => { throw new Error('Favoritos inválidos.'); })()
    };
    if (result.organization.favorites.length > 10000) throw new Error('Demasiados favoritos.');
    const folders = new Map(result.organization.folders.map(item => [item.id, item]));
    if (folders.size !== result.organization.folders.length) throw new Error('Carpetas repetidas.');
    folders.forEach(item => {
      if (item.parentId && !folders.has(item.parentId) && !DEFAULT_FOLDERS.has(item.parentId)) throw new Error('La carpeta de destino no existe.');
      const visited = new Set([item.id]); let parent = item.parentId;
      while (folders.has(parent)) { if (visited.has(parent)) throw new Error('Las carpetas no pueden contenerse a sí mismas.'); visited.add(parent); parent = folders.get(parent).parentId; }
    });
    unique(result.organization.resources, 'id', 'Recursos');
    result.organization.resources.forEach(item => { if (item.folderId && !folders.has(item.folderId) && !DEFAULT_FOLDERS.has(item.folderId)) throw new Error('La carpeta del recurso no existe.'); });
  }
  if (value.groups !== undefined) result.groups = list(value.groups, 1000, item => ({id: id(item.id), name: text(item.name), roomId: choice(item.roomId, ROOM_IDS), members: Array.isArray(item.members) && item.members.length <= 1000 ? Array.from(new Set(item.members.map(id))) : (() => { throw new Error('Grupo inválido.'); })()}));
  if (value.templates !== undefined) result.templates = list(value.templates, 100, item => {
    if (!Array.isArray(item.objects) || !item.objects.length || item.objects.length > 100) throw new Error('Plantilla inválida.');
    item.objects.forEach(object => {
      if (!plain(object) || object.format !== 'hello-webxr-object' || object.version !== 1 || !plain(object.record) || !Array.isArray(object.sources)) throw new Error('Objeto de plantilla incompatible.');
      if (object.studioEntity !== undefined) entityValue(object.studioEntity);
    });
    const template = {id: id(item.id), name: text(item.name), version: 1, objects: copy(item.objects)};
    if (item.linkedStudio !== undefined) {
      if (!plain(item.linkedStudio) || Object.keys(item.linkedStudio).some(key => !['version', 'widgets', 'missions', 'spawns', 'groups'].includes(key))) throw new Error('Componentes de plantilla incompatibles.');
      template.linkedStudio = normalize(item.linkedStudio);
    }
    return template;
  });
  if (value.widgets !== undefined) result.widgets = list(value.widgets, 200, item => ({
    id: id(item.id), name: text(item.name), roomId: choice(item.roomId, ROOM_IDS),
    kind: choice(item.kind, ['text', 'counter', 'indicator', 'progress', 'button']),
    text: text(item.text || item.name, 650), objectId: item.objectId ? id(item.objectId) : '', variable: text(item.variable || 'entryCount', 80),
    action: choice(item.action || 'start', ['start', 'stop', 'pause', 'powerOn', 'powerOff', 'insertBox', 'speedUp', 'speedDown']),
    presentation: choice(item.presentation || 'world', ['world', 'desktop', 'both']), visible: item.visible !== false,
    color: /^#[0-9a-f]{6}$/i.test(item.color || '') ? item.color : '#51ebd2',
    position: Array.isArray(item.position) && item.position.length === 3 ? item.position.map(n => number(n, -10000, 10000)) : [0, 1.5, -1],
    maximum: number(item.maximum === undefined ? 100 : item.maximum, 0.0001, 1000000)
  }));
  if (value.missions !== undefined) result.missions = list(value.missions, 100, item => ({
    id: id(item.id), name: text(item.name), roomId: choice(item.roomId, ROOM_IDS), description: text(item.description || item.name, 2000), help: text(item.help || '', 2000, true),
    start: choice(item.start || 'automatic', ['automatic', 'manual']),
    steps: list(item.steps, 50, step => ({name: text(step.name), event: text(step.event, 80), objectId: step.objectId ? id(step.objectId) : '', target: number(step.target, 1, 1000000),
      failEvent: text(step.failEvent || '', 80, true)}))
  }));
  ['groups', 'templates', 'widgets', 'missions'].forEach(key => { if (result[key]) unique(result[key], 'id', 'Identificadores de ' + key); });
  if (value.spawns !== undefined) result.spawns = unique(list(value.spawns, 100, item => ({objectId: id(item.objectId), roomId: choice(item.roomId, ROOM_IDS)})), 'objectId', 'Puntos de aparición');
  if (value.entities !== undefined) {
    result.entities = unique(list(value.entities, 100, entityValue), 'id', 'Entidades');
    unique(result.entities, 'objectId', 'Marcadores de entidades');
    ROOM_IDS.forEach(roomId => { if (result.entities.filter(item => item.roomId === roomId && item.type === 'pointLight').length > 16) throw new Error('Cada sala admite como máximo dieciséis luces puntuales adicionales.'); });
  }
  return result;
}
module.exports = {normalize, ROOM_IDS, ROOM_NAMES, sceneEntries, hasSceneContent, defaultEnvironment, environmentFor};
