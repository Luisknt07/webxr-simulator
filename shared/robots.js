/* Shared robot authoring boundary. SI units; these are editable teaching models,
 * never a manufacturer's load chart, safety rating or controller program. */
'use strict';
const automation = require('./automation.js');

const VERSION = 1;
const MAX_WAYPOINTS = 48, MAX_WAYPOINT_JSON = 10000, MAX_JOINT_JSON = 3000;
const FAMILIES = [
  {id: 'articulated', name: 'Articulados de 6 ejes', axes: 6, mobility: 'fixed', description: 'Manipulación y procesos con un brazo serial y muñeca orientable.'},
  {id: 'scara', name: 'SCARA de 4 ejes', axes: 4, mobility: 'fixed', description: 'Dos eslabones horizontales, carrera vertical y giro de herramienta.'},
  {id: 'delta', name: 'Delta paralelo', axes: 4, mobility: 'fixed', description: 'Tres cadenas paralelas y giro de herramienta para picking ligero.'},
  {id: 'cartesian', name: 'Cartesianos / pórticos XYZ', axes: 3, mobility: 'fixed', description: 'Tres guías lineales ortogonales con volumen rectangular.'},
  {id: 'palletizer', name: 'Paletizadores de 4 ejes', axes: 4, mobility: 'fixed', description: 'Brazo con orientación nivelada de la herramienta para cajas.'},
  {id: 'amr', name: 'AMR de transporte', axes: 0, mobility: 'mobile', description: 'Plataforma móvil con misiones entre estaciones y comprobación de obstáculos.'},
  {id: 'agv', name: 'AGV guiados', axes: 0, mobility: 'mobile', description: 'Transporte siguiendo una ruta de puntos predefinida.'},
  {id: 'shuttle', name: 'Shuttle sobre carril', axes: 1, mobility: 'rail', description: 'Carro con recorrido lineal limitado por un carril físico.'},
  {id: 'cylindrical', name: 'Cilíndricos RPP', axes: 3, mobility: 'fixed', description: 'Giro de columna, elevación vertical y extensión radial.'},
  {id: 'polar', name: 'Polares RRP', axes: 3, mobility: 'fixed', description: 'Giro de base, inclinación y brazo telescópico radial.'},
  {id: 'mobileManipulator', name: 'Manipuladores móviles', axes: 6, mobility: 'mobile', description: 'Base móvil con brazo de seis ejes; estaciona antes de manipular y retrae el brazo para viajar.'},
  {id: 'mobileSorter', name: 'Clasificadores móviles', axes: 2, mobility: 'mobile', description: 'Transporta una carga hasta su destino y la descarga con cinta transversal o bandeja inclinable.'}
];
const TOOLS = [
  {id: 'gripper', name: 'Pinza paralela', description: 'Sujeción cinemática lateral de una carga.'},
  {id: 'vacuum', name: 'Ventosas', description: 'Prensión superior simulada; no calcula vacío ni porosidad.'},
  {id: 'fork', name: 'Horquillas', description: 'Apoyo inferior para pallets; no certifica estabilidad.'},
  {id: 'platform', name: 'Plataforma', description: 'Apoyo y transferencia de una carga por misión.'},
  {id: 'process', name: 'Herramienta de proceso', description: 'Ejecuta un tiempo de operación y registra la transformación.'}
];
const OPERATIONS = [
  {id: 'pick-place', name: 'Recoger y depositar'}, {id: 'process', name: 'Procesar producto'},
  {id: 'palletize', name: 'Entregar a paletizado'}, {id: 'transport', name: 'Transportar entre estaciones'}
];
const DEFAULTS = {
  family: 'articulated', variant: 'articulated-general', enabled: true,
  powered: true, running: false, paused: false, emergency: false, mode: 'automatic', withPanel: true,
  operation: 'pick-place', speed: 0.65, payloadKg: 12, reach: 1.4,
  length: .8, width: .8, height: 1.6, baseHeight: .45,
  tool: 'gripper', cycleTime: 4, processTime: 2, setupTime: 0, approachHeight: 0.18,
  positionTolerance: 0.025, sourceId: '', targetId: '', outputId: '',
  waypointsJson: '[]', jointLimitsJson: '[]', acceptedTypes: 'all', requireKnownMass: false,
  maxProductWidth: 1.2, maxProductHeight: 1.5, maxProductDepth: 1.2,
  batteryPercent: 100, batteryDrainPerMeter: 0.025,
  destinationRulesJson: '[]', sorterMode: 'crossbelt', dischargeTime: 1, transferTolerance: .10, dockDistance: .65,
  frameColor: '#e87825', accentColor: '#26333f', toolColor: '#aebdc7', finish: 'painted',
  wear: 0.16, detail: 'balanced', filletRadius: 0.025, chamferSize: 0.012, mountingHoles: true
};
function variant(id, family, name, preset) { return {id, family, name, preset: Object.assign({}, DEFAULTS, preset, {family, variant: id})}; }
const VARIANTS = [
  variant('articulated-general', 'articulated', 'Articulado de manipulación', {}),
  variant('articulated-process', 'articulated', 'Articulado de proceso', {tool: 'process', operation: 'process', processTime: 5, frameColor: '#426d94'}),
  variant('collaborative', 'articulated', 'Brazo de apariencia colaborativa', {payloadKg: 8, reach: 1.3, length: .5, width: .5, height: 1.4, baseHeight: .35, speed: 0.3, frameColor: '#d4dce2', accentColor: '#4b9ca9', filletRadius: 0.04}),
  variant('scara', 'scara', 'SCARA de ensamblaje', {payloadKg: 5, reach: 1.1, baseHeight: 1, height: 0.5, cycleTime: 2, tool: 'vacuum', frameColor: '#e2e7e9'}),
  variant('delta', 'delta', 'Delta de picking', {payloadKg: 3, reach: 1.3, baseHeight: 0.9, height: 1.6, length: 2.4, width: 2.2, tool: 'vacuum', cycleTime: 1.5, maxProductWidth: 0.5, maxProductDepth: 0.5, maxProductHeight: 0.5}),
  variant('cartesian', 'cartesian', 'Pórtico XYZ', {payloadKg: 40, reach: 3, length: 4, width: 2.4, height: 1.7, baseHeight: 0.8, cycleTime: 5, frameColor: '#4e7894'}),
  variant('palletizer', 'palletizer', 'Paletizador de cajas', {payloadKg: 60, reach: 2.6, length: 1.2, width: 1.2, baseHeight: .65, tool: 'vacuum', operation: 'palletize', cycleTime: 5, frameColor: '#d69a28'}),
  variant('amr', 'amr', 'AMR de plataforma', {payloadKg: 250, length: 1.2, width: 0.8, height: 0.38, baseHeight: 0, tool: 'platform', operation: 'transport', speed: 0.8, frameColor: '#4778a1', maxProductWidth: 1.2, maxProductDepth: 1.2}),
  variant('agv', 'agv', 'AGV de plataforma guiada', {payloadKg: 400, length: 1.5, width: 0.9, height: 0.42, baseHeight: 0, tool: 'platform', operation: 'transport', speed: 0.6, frameColor: '#b5a433', maxProductWidth: 1.2, maxProductDepth: 1.4}),
  variant('shuttle', 'shuttle', 'Shuttle de transferencia lineal', {payloadKg: 120, length: 5, width: 1.2, height: 0.5, baseHeight: 0.4, tool: 'platform', operation: 'transport', speed: 0.7, frameColor: '#4778a1', maxProductWidth: 1.2, maxProductDepth: 1.2}),
  variant('cylindrical-rpp', 'cylindrical', 'Cilíndrico RPP de manipulación', {reach: 1.8, baseHeight: .55, height: 1.4, tool: 'vacuum', frameColor: '#4e7894'}),
  variant('polar-rrp', 'polar', 'Polar RRP telescópico', {reach: 2, baseHeight: .9, height: 1.4, frameColor: '#dc9d31'}),
  variant('mobile-manipulator', 'mobileManipulator', 'AMR con manipulador de seis ejes', {reach: 1.8, payloadKg: 12, length: 1.3, width: .85, height: .4, baseHeight: 1, tool: 'gripper', operation: 'pick-place', speed: .65, frameColor: '#4b9ca9', maxProductWidth: .6, maxProductDepth: .6, maxProductHeight: .6}),
  variant('mobile-sorter-crossbelt', 'mobileSorter', 'Clasificador móvil de cinta transversal', {payloadKg: 30, length: 1.1, width: .85, height: .65, baseHeight: 0, tool: 'platform', operation: 'transport', speed: .8, frameColor: '#3d81ac', sorterMode: 'crossbelt', maxProductWidth: .65, maxProductDepth: .65, maxProductHeight: .6}),
  variant('mobile-sorter-tilttray', 'mobileSorter', 'Clasificador móvil de bandeja inclinable', {payloadKg: 20, length: 1.1, width: .85, height: .65, baseHeight: 0, tool: 'platform', operation: 'transport', speed: .8, frameColor: '#b7a13c', sorterMode: 'tilttray', transferTolerance: .3, maxProductWidth: .65, maxProductDepth: .65, maxProductHeight: .6})
];
function getDefinition(id) {
  if (typeof id !== 'string') return null;
  const key = id.replace(/^robot\./, '');
  return VARIANTS.find(item => item.id === key) || VARIANTS.find(item => item.family === key) || null;
}
function defaults(id) { const definition = getDefinition(id); return Object.assign({}, definition ? definition.preset : DEFAULTS); }
function number(key, label, min, max, step) { return {key, label, input: 'number', default: DEFAULTS[key], min, max, step}; }
function text(key, label, maxLength, input = 'text') { return {key, label, input, default: DEFAULTS[key], maxLength}; }
function choice(key, label, options) { return {key, label, input: 'select', default: DEFAULTS[key], options: options.map(item => typeof item === 'string' ? {value: item, label: item} : {value: item.id, label: item.name})}; }
function check(key, label) { return {key, label, input: 'checkbox', default: DEFAULTS[key]}; }
function fields() {
  return [choice('family', 'Arquitectura del robot', FAMILIES), choice('variant', 'Modelo / configuración inicial', VARIANTS),
    choice('mode', 'Modo', [{id: 'automatic', name: 'Automático'}, {id: 'manual', name: 'Manual · iniciar desde el panel'}]),
    choice('operation', 'Operación', OPERATIONS), choice('tool', 'Herramienta', TOOLS),
    check('powered', 'Alimentado'), check('running', 'En marcha al iniciar'), check('paused', 'Pausado'), check('emergency', 'Emergencia enclavada'), check('withPanel', 'Panel de control propio'),
    number('speed', 'Velocidad TCP / desplazamiento · m/s', 0.05, 3, 0.05), number('payloadKg', 'Carga máxima simulada · kg', 0.1, 3000, 0.5), number('reach', 'Alcance nominal del brazo sin herramienta · m', 0.3, 10, 0.05),
    number('length', 'Largo / carrera X · m', 0.5, 30, 0.05), number('width', 'Ancho / carrera Z · m', 0.3, 15, 0.05), number('height', 'Altura / carrera vertical · m', 0.15, 8, 0.05), number('baseHeight', 'Altura de base sobre el piso · m', 0, 5, 0.05),
    number('cycleTime', 'Tiempo mínimo de ciclo · s', 0.2, 3600, 0.1), number('processTime', 'Tiempo de proceso · s', 0, 3600, 0.1), number('setupTime', 'Preparación inicial · s', 0, 3600, 0.1),
    number('approachHeight', 'Separación de aproximación · m', 0.02, 1, 0.01), number('positionTolerance', 'Tolerancia geométrica · m', 0.002, 0.15, 0.001),
    text('sourceId', 'Equipo de recogida', 400, 'object'), text('targetId', 'Objetivo de proceso opcional', 400, 'object'), text('outputId', 'Equipo receptor', 400, 'object'),
    text('waypointsJson', 'Ruta AMR / AGV [{x,y,z,speed?}] · hasta 48 puntos', MAX_WAYPOINT_JSON, 'textarea'), text('jointLimitsJson', 'Límites [{id,min,max,home?}] · rad / m', MAX_JOINT_JSON, 'textarea'),
    choice('acceptedTypes', 'Cargas admitidas', [{id: 'all', name: 'Todas las compatibles'}, {id: 'units', name: 'Productos individuales'}, {id: 'pallets', name: 'Pallets completos'}, {id: 'boxes', name: 'Cajas y contenedores'}]),
    check('requireKnownMass', 'Exigir masa declarada del producto'), number('maxProductWidth', 'Ancho máximo del producto · m', 0.05, 4, 0.05), number('maxProductHeight', 'Alto máximo del producto · m', 0.05, 4, 0.05), number('maxProductDepth', 'Fondo máximo del producto · m', 0.05, 4, 0.05),
    number('batteryPercent', 'Batería inicial · % (móviles)', 0, 100, 1), number('batteryDrainPerMeter', 'Consumo didáctico · %/m (móviles)', 0, 5, 0.005),
    text('destinationRulesJson', 'Destinos por producto [{field,operator,value,outputId}]', 16000, 'textarea'),
    choice('sorterMode', 'Descarga del clasificador móvil', [{id: 'crossbelt', name: 'Cinta transversal'}, {id: 'tilttray', name: 'Bandeja inclinable'}]),
    number('dischargeTime', 'Tiempo de carga / descarga móvil · s', .2, 30, .1), number('transferTolerance', 'Desnivel máximo de descarga móvil · m', .01, .3, .01), number('dockDistance', 'Separación de atraque del brazo móvil · m', .25, 2, .05),
    text('frameColor', 'Color · carcasa / bastidor', 7, 'color'), text('accentColor', 'Color · juntas / protecciones', 7, 'color'), text('toolColor', 'Color · herramienta', 7, 'color'),
    choice('finish', 'Acabado estructural', [{id: 'painted', name: 'Metal pintado'}, {id: 'steel', name: 'Acero satinado'}, {id: 'aluminum', name: 'Aluminio'}, {id: 'polymer', name: 'Polímero'}]),
    number('wear', 'Desgaste superficial', 0, 1, 0.05), choice('detail', 'Detalle geométrico', [{id: 'low', name: 'Ligero'}, {id: 'balanced', name: 'Equilibrado'}, {id: 'high', name: 'Alto · piezas clave'}]),
    number('filletRadius', 'Radio de redondeo de carcasas · m', 0, 0.12, 0.005), number('chamferSize', 'Chaflán de placas · m', 0, 0.08, 0.002), check('mountingHoles', 'Perforaciones de montaje visibles')];
}
function plain(value) { return value && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function jsonList(value, maxLength, maxItems, label) {
  let rows = value === undefined ? [] : value;
  if (typeof rows === 'string') { if (rows.length > maxLength) throw new Error(label + ': texto demasiado grande.'); try { rows = JSON.parse(rows); } catch (_) { throw new Error(label + ': JSON inválido.'); } }
  if (!Array.isArray(rows) || rows.length > maxItems) throw new Error(label + ': lista demasiado grande o inválida.');
  return rows;
}
function parseWaypoints(value = {}) {
  const rows = jsonList(plain(value) ? value.waypointsJson : value, MAX_WAYPOINT_JSON, MAX_WAYPOINTS, 'Ruta del robot');
  return rows.map(row => {
    if (!plain(row) || Object.keys(row).some(key => !['x', 'y', 'z', 'speed'].includes(key))) throw new Error('Punto de ruta no compatible.');
    const point = {};
    ['x', 'y', 'z'].forEach(key => { const item = row[key] === undefined && key === 'y' ? 0 : row[key]; if (typeof item !== 'number' || !Number.isFinite(item) || Math.abs(item) > 250) throw new Error('Las coordenadas de ruta deben estar entre −250 y 250 m.'); point[key] = item; });
    if (row.speed !== undefined) { if (typeof row.speed !== 'number' || !Number.isFinite(row.speed) || row.speed < 0.05 || row.speed > 3) throw new Error('Velocidad de ruta fuera de rango.'); point.speed = row.speed; }
    return point;
  });
}
function baseJoints(config) {
  const joint = (id, kind, axis, min, max, home = 0) => ({id, kind, axis, min, max, home, unit: kind === 'revolute' ? 'rad' : 'm'});
  // Fold toward the base, with the tool pointing down. The former generic
  // pose stretched the wrist horizontally across adjacent work surfaces.
  if (config.family === 'articulated' || config.family === 'mobileManipulator') return [joint('J1', 'revolute', 'y', -Math.PI, Math.PI), joint('J2', 'revolute', 'z', -1.4, 2.6, 1.4), joint('J3', 'revolute', 'z', -2.7, 2.7, -2.4), joint('J4', 'revolute', 'x', -Math.PI, Math.PI), joint('J5', 'revolute', 'z', -2.2, 2.2, -.5707963267948966), joint('J6', 'revolute', 'x', -Math.PI * 2, Math.PI * 2)];
  if (config.family === 'cylindrical') return [joint('J1', 'revolute', 'y', -Math.PI, Math.PI), joint('J2', 'prismatic', 'y', 0, config.height, config.height * .45), joint('J3', 'prismatic', 'x', .15, config.reach, config.reach * .55)];
  if (config.family === 'polar') return [joint('J1', 'revolute', 'y', -Math.PI, Math.PI), joint('J2', 'revolute', 'z', -.35, 1.35, .3), joint('J3', 'prismatic', 'x', .15, config.reach, config.reach * .55)];
  if (config.family === 'mobileSorter') return [joint('J1', 'prismatic', 'x', -config.length - config.maxProductDepth, config.length + config.maxProductDepth), joint('J2', 'revolute', 'z', -.55, .55)];
  if (config.family === 'scara') return [joint('J1', 'revolute', 'y', -Math.PI, Math.PI), joint('J2', 'revolute', 'y', -2.7, 2.7, 1), joint('J3', 'prismatic', 'y', 0, config.height, config.height * 0.35), joint('J4', 'revolute', 'y', -Math.PI * 2, Math.PI * 2)];
  if (config.family === 'delta') return [joint('J1', 'revolute', 'z', -0.5, 1.6, 0.65), joint('J2', 'revolute', 'z', -0.5, 1.6, 0.65), joint('J3', 'revolute', 'z', -0.5, 1.6, 0.65), joint('J4', 'revolute', 'y', -Math.PI, Math.PI)];
  if (config.family === 'cartesian') return [joint('J1', 'prismatic', 'x', -config.length / 2, config.length / 2), joint('J2', 'prismatic', 'z', -config.width / 2, config.width / 2), joint('J3', 'prismatic', 'y', 0, config.height, config.height * 0.5)];
  if (config.family === 'palletizer') return [joint('J1', 'revolute', 'y', -Math.PI, Math.PI), joint('J2', 'revolute', 'z', -1.4, 2.6, 0.8), joint('J3', 'revolute', 'z', -2.7, 2.7, -1.45), joint('J4', 'revolute', 'y', -Math.PI * 2, Math.PI * 2)];
  if (config.family === 'shuttle') return [joint('J1', 'prismatic', 'x', -config.length * 0.35, config.length * 0.35)];
  return [];
}
function getJointDefinitions(value = {}) {
  const config = Object.assign({}, defaults(value.variant || value.family), value), joints = baseJoints(config);
  const rows = jsonList(config.jointLimitsJson, MAX_JOINT_JSON, 6, 'Límites articulares'), seen = new Set();
  rows.forEach(row => {
    if (!plain(row) || Object.keys(row).some(key => !['id', 'min', 'max', 'home'].includes(key)) || seen.has(row.id)) throw new Error('Límite articular inválido o repetido.');
    seen.add(row.id); const joint = joints.find(item => item.id === row.id);
    if (!joint || !Number.isFinite(row.min) || !Number.isFinite(row.max) || row.min < joint.min || row.max > joint.max || row.min >= row.max) throw new Error('El límite articular debe permanecer dentro del recorrido del modelo.');
    if (row.home !== undefined && (!Number.isFinite(row.home) || row.home < row.min || row.home > row.max)) throw new Error('La posición inicial queda fuera del límite articular.');
    joint.min = row.min; joint.max = row.max; joint.home = row.home === undefined ? Math.max(row.min, Math.min(row.max, joint.home)) : row.home;
  });
  return joints;
}
function objectReference(value) { return automation.objectReference(value, true); }
function parseDestinationRules(value = {}) {
  const rows = jsonList(plain(value) ? value.destinationRulesJson : value, 16000, 16, 'Destinos del clasificador');
  const routing = require('./conveyorRouting.js');
  return rows.map(row => {
    if (!plain(row) || Object.keys(row).some(key => !['field', 'operator', 'value', 'outputId'].includes(key))) throw new Error('Regla de destino inválida.');
    const rule = routing.normalizeRules([{field: row.field, operator: row.operator, value: row.value, route: 'main'}])[0];
    if (!row.outputId) throw new Error('Cada regla necesita un equipo receptor.');
    objectReference(row.outputId); return {field: rule.field, operator: rule.operator, value: rule.value, outputId: row.outputId};
  });
}
function destinationFor(config, metadata) {
  const match = require('./conveyorRouting.js').matches;
  return (parseDestinationRules(config).find(rule => match(rule, metadata)) || {}).outputId || config.outputId;
}
function normalize(value = {}) {
  if (!plain(value)) throw new Error('Configuración de robot inválida.');
  const result = Object.assign({type: 'robot'}, defaults(value.variant || value.family));
  if (value.enabled !== undefined) { if (typeof value.enabled !== 'boolean') throw new Error('Activación de robot inválida.'); result.enabled = value.enabled; }
  fields().forEach(field => {
    if (value[field.key] === undefined) return;
    const item = value[field.key];
    if (field.input === 'number') { if (typeof item !== 'number' || !Number.isFinite(item) || item < field.min || item > field.max) throw new Error('Valor fuera de rango: ' + field.label + '.'); }
    else if (field.input === 'checkbox') { if (typeof item !== 'boolean') throw new Error('Valor booleano inválido: ' + field.label + '.'); }
    else if (field.input === 'select') { if (!field.options.some(option => option.value === item)) throw new Error('Opción no compatible: ' + field.label + '.'); }
    else if (field.input === 'color') { if (typeof item !== 'string' || !/^#[a-f0-9]{6}$/i.test(item)) throw new Error('El color debe tener formato #RRGGBB.'); }
    else if (typeof item !== 'string' || item.length > field.maxLength || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(item)) throw new Error('Texto de robot inválido: ' + field.label + '.');
    result[field.key] = field.input === 'color' ? item.toLowerCase() : item;
  });
  // A family edit keeps that architecture; a preset selection should apply its
  // complete preset in the editor, rather than silently overwrite user values.
  if (getDefinition(result.variant).family !== result.family) result.variant = getDefinition(result.family).id;
  if ((result.tool === 'process') !== (result.operation === 'process')) throw new Error('La herramienta de proceso requiere la operación de proceso; para transportar una carga elige pinza, ventosas o plataforma.');
  ['sourceId', 'targetId', 'outputId'].forEach(key => objectReference(result[key]));
  const waypoints = parseWaypoints(result);
  if (['amr', 'agv', 'mobileManipulator', 'mobileSorter'].includes(result.family) && waypoints.some(point => Math.abs(point.y) > result.positionTolerance)) throw new Error('La ruta de un AMR o AGV debe permanecer sobre el piso local (Y = 0).');
  if (result.family === 'mobileSorter' && result.tool !== 'platform') throw new Error('El clasificador móvil usa su plataforma de cinta o bandeja.');
  result.destinationRulesJson = JSON.stringify(parseDestinationRules(result));
  result.waypointsJson = JSON.stringify(waypoints);
  getJointDefinitions(result);
  result.jointLimitsJson = JSON.stringify(jsonList(result.jointLimitsJson, MAX_JOINT_JSON, 6, 'Límites articulares'));
  return result;
}
function validate(value) { return normalize(value); }
function productCompatibility(value = {}, metadata = {}) {
  const config = Object.assign({}, defaults(value.variant || value.family), value);
  if (!plain(metadata)) return {accepted: false, reason: 'Metadatos de carga inválidos.', massKnown: false};
  const pallet = metadata.loadType === 'pallet' || metadata.loadMode === 'pallet' || metadata.productType === 'pallet' || metadata.type === 'pallet';
  if (config.acceptedTypes === 'pallets' && !pallet || config.acceptedTypes === 'units' && pallet || config.acceptedTypes === 'boxes' && (pallet || !['box', 'crate'].includes(metadata.productType || metadata.type))) return {accepted: false, reason: 'Tipo de carga no admitido.', massKnown: false};
  const mass = metadata.massKg !== undefined ? metadata.massKg : metadata.weightKg !== undefined ? metadata.weightKg : metadata.mass;
  const massKnown = typeof mass === 'number' && Number.isFinite(mass) && mass > 0;
  if (mass !== undefined && !massKnown) return {accepted: false, reason: 'Masa de producto inválida.', massKnown: false};
  if (!massKnown && config.requireKnownMass) return {accepted: false, reason: 'La carga necesita una masa declarada.', massKnown};
  if (massKnown && mass > config.payloadKg + 1e-8) return {accepted: false, reason: 'La carga supera la capacidad simulada del robot.', massKnown};
  const size = metadata.size || {}, dimensions = {width: metadata.width === undefined ? size.x : metadata.width, height: metadata.height === undefined ? size.y : metadata.height, depth: metadata.depth === undefined ? size.z : metadata.depth};
  for (const key of ['width', 'height', 'depth']) {
    const dimension = dimensions[key]; if (dimension === undefined) continue;
    if (typeof dimension !== 'number' || !Number.isFinite(dimension) || dimension <= 0) return {accepted: false, reason: 'Dimensiones de producto inválidas.', massKnown};
    if (dimension > config['maxProduct' + key[0].toUpperCase() + key.slice(1)] + 1e-5) return {accepted: false, reason: 'El volumen de la carga supera el gálibo configurado.', massKnown};
  }
  return {accepted: true, reason: massKnown ? '' : 'Masa no declarada: comprobación de carga no disponible.', massKnown};
}
function acceptsProduct(value, metadata) { return productCompatibility(value, metadata).accepted; }
module.exports = {VERSION, FAMILIES, VARIANTS, variants: VARIANTS.map(item => item.id), TOOLS, OPERATIONS, DEFAULTS, MAX_WAYPOINTS, MAX_WAYPOINT_JSON, MAX_JOINT_JSON,
  defaults, fields, getDefinition, normalize, validate, parseWaypoints, parseDestinationRules, destinationFor, getJointDefinitions, productCompatibility, acceptsProduct};
