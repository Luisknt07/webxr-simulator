'use strict';

// A bounded teaching recipe. Contacts remain owned by the existing source and
// receiving equipment; a program cannot invent stock or assign product poses.
const automation = require('../../flujo-materiales/schema/automation.js');
const VERSION = 1, MAX_POINTS = 8, MAX_JSON = 16000;
const FAMILIES = ['articulated', 'palletizer', 'scara', 'cartesian', 'cylindrical', 'polar', 'delta'];
const DEFAULTS = {version: VERSION, name: 'Recoger, trasladar y depositar', sourceId: '', outputId: '', speed: .45, clearance: .18,
  gripWait: .2, releaseWait: .2, via: [], returnPoint: null, repeat: false};
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function number(value, min, max, label) { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(label + ': valor fuera de rango.'); return value; }
function point(value, label) {
  if (!plain(value) || Object.keys(value).some(key => !['x', 'y', 'z'].includes(key))) throw new Error(label + ': usa {x,y,z} en metros locales.');
  return {x: number(value.x, -20, 20, label + ' X'), y: number(value.y, -5, 20, label + ' Y'), z: number(value.z, -20, 20, label + ' Z')};
}
function normalize(value) {
  if (typeof value === 'string') { if (value.length > MAX_JSON) throw new Error('El programa supera 16.000 caracteres.'); try { value = JSON.parse(value); } catch (_) { throw new Error('Programa JSON inválido.'); } }
  if (!plain(value) || Object.keys(value).some(key => !Object.prototype.hasOwnProperty.call(DEFAULTS, key))) throw new Error('El programa contiene campos no admitidos.');
  const p = Object.assign({}, DEFAULTS, value);
  if (p.version !== VERSION) throw new Error('Versión del programa no compatible.');
  if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 80 || /[\x00-\x1f\x7f]/.test(p.name)) throw new Error('Nombre del programa inválido.');
  p.name = p.name.trim();
  ['sourceId', 'outputId'].forEach(key => { if (typeof p[key] !== 'string' || p[key].length > 400) throw new Error('Conexión de programa inválida.'); automation.objectReference(p[key], true); });
  p.speed = number(p.speed, .05, 3, 'Velocidad'); p.clearance = number(p.clearance, .02, 1, 'Altura de aproximación');
  p.gripWait = number(p.gripWait, 0, 10, 'Espera de recogida'); p.releaseWait = number(p.releaseWait, 0, 10, 'Espera de depósito');
  if (typeof p.repeat !== 'boolean') throw new Error('La repetición debe ser booleana.');
  if (!Array.isArray(p.via) || p.via.length > MAX_POINTS || Array.from({length: p.via.length}, (_, i) => i).some(i => !Object.prototype.hasOwnProperty.call(p.via, i))) throw new Error('Usa como máximo ocho puntos de paso.');
  p.via = p.via.map((value, i) => point(value, 'Punto de paso ' + (i + 1)));
  p.returnPoint = p.returnPoint === null ? null : point(p.returnPoint, 'Retorno');
  return p;
}
function compatible(config) { return FAMILIES.includes(config.family) && config.operation !== 'process' && config.tool !== 'process'; }
function normalizeConfig(config) {
  if (!config.taskProgramJson) { if (config.taskEnabled) throw new Error('Crea y valida una tarea antes de activarla.'); return ''; }
  const p = normalize(config.taskProgramJson);
  if (config.taskEnabled) {
    if (!compatible(config)) throw new Error('La tarea programada requiere un robot fijo de recogida y depósito.');
    if (!p.sourceId || !p.outputId || p.sourceId === p.outputId) throw new Error('La tarea necesita dos equipos distintos: origen y receptor.');
    if (p.sourceId !== config.sourceId || p.outputId !== config.outputId) throw new Error('Las conexiones del programa no coinciden con las del robot.');
  }
  return JSON.stringify(p);
}
function forConfig(config) { return config.taskEnabled ? normalize(config.taskProgramJson) : null; }
function defaults(config = {}) { return normalize(Object.assign({}, DEFAULTS, {sourceId: config.sourceId || '', outputId: config.outputId || '', speed: config.speed || DEFAULTS.speed, clearance: config.approachHeight || DEFAULTS.clearance})); }
const tuple = value => Array.isArray(value) ? value.slice() : [value.x, value.y, value.z];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function preview(config, value, endpoints, kinematics) {
  const program = normalize(value);
  if (!compatible(config)) throw new Error('Previsualización disponible para robots fijos de manipulación.');
  if (!endpoints || !endpoints.pickup || !endpoints.place) throw new Error('Selecciona un origen y un receptor presentes en el nivel.');
  const pickup = tuple(point(endpoints.pickup, 'Recogida')), place = tuple(point(endpoints.place, 'Depósito'));
  const home = kinematics.homePose(config), start = endpoints.startPose || home, approach = pickup.slice(), above = place.slice();
  approach[1] += program.clearance; above[1] += program.clearance;
  const stages = [{id: 'approach', name: '1 · Aproximar a la carga', position: approach, carrying: false},
    {id: 'pick', name: '2 · Descender y tomar', position: pickup, carrying: false},
    {id: 'grip', name: '3 · Confirmar agarre', position: pickup, carrying: true, wait: program.gripWait},
    {id: 'lift', name: '4 · Elevar con la carga', position: approach, carrying: true}];
  program.via.forEach((p, i) => stages.push({id: 'via-' + i, name: '5 · Trasladar por punto ' + (i + 1), position: tuple(p), carrying: true}));
  stages.push({id: 'carry', name: '6 · Aproximar al receptor', position: above, carrying: true},
    {id: 'place', name: '7 · Bajar y depositar', position: place, carrying: true},
    {id: 'release', name: '8 · Confirmar entrega', position: place, carrying: false, wait: program.releaseWait},
    {id: 'return', name: '9 · Retornar sin carga', position: program.returnPoint ? tuple(program.returnPoint) : tuple(home.tcp), carrying: false});
  const frames = [], path = [tuple(start.tcp)]; let from = tuple(start.tcp), seed = start.joints.slice(), elapsed = 0;
  stages.forEach(stage => {
    const duration = stage.wait === undefined ? Math.max(.2, dist(from, stage.position) / program.speed) : Math.max(.1, stage.wait), count = stage.wait === undefined ? 18 : 1;
    for (let i = 1; i <= count; i++) {
      const f = i / count, smooth = f * f * (3 - 2 * f), target = from.map((v, axis) => v + (stage.position[axis] - v) * smooth);
      const pose = kinematics.inverse(config, {x: target[0], y: target[1], z: target[2]}, seed);
      if (pose.reached === false || pose.error > config.positionTolerance) throw new Error(stage.name + ': coordenada fuera de alcance o límites.');
      seed = pose.joints.slice(); frames.push({at: elapsed + duration * f, pose, phase: stage.id, label: stage.name, carrying: stage.carrying});
    }
    elapsed += duration; path.push(stage.position.slice()); from = stage.position.slice();
  });
  if (elapsed > 600) throw new Error('Reduce el recorrido: la previsualización supera diez minutos.');
  return {program, stages, frames, path, pickup, place, duration: elapsed, initialPose: start, payloadSize: endpoints.payloadSize || [.25, .25, .25], provenance: endpoints.provenance || 'Coordenadas de estaciones del nivel'};
}
module.exports = {VERSION, MAX_POINTS, MAX_JSON, FAMILIES, DEFAULTS, defaults, normalize, normalizeConfig, forConfig, compatible, preview};
