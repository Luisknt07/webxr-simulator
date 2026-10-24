/* Shared by the browser editor and the SQLite HTTP validation boundary. */
'use strict';
const {normalizeRules, objectReference} = require('./automation.js');
const conveyorLayout = require('./conveyors.js');
const materialSchema = require('./materials.js');
const wearSchema = require('./wear.js');
const productSources = require('./productSources.js');
const processors = require('./processors.js');
const palletQueues = require('./palletQueues.js');
const conveyorRouting = require('./conveyorRouting.js');

function number(key, label, value, min, max, step) {
  return {key, label, input: 'number', default: value, min, max, step};
}
function text(key, label, value, maxLength, input) {
  return {key, label, input: input || 'text', default: value, maxLength};
}
function checkbox(key, label, value) {
  return {key, label, input: 'checkbox', default: value};
}

const definitions = [
  {type: 'portal', label: 'Portal / cambiar de sala', fields: [
    {key: 'room', label: 'Sala de destino', input: 'room', default: 0, min: 0, max: 9, step: 1},
    {key: 'event', label: 'Activar al', input: 'select', default: 'press', options: [
      {value: 'press', label: 'Pulsar'}, {value: 'release', label: 'Soltar'}
    ]},
    // Native portals use absolute local scales, including Vertigo's 0.8.
    number('hoverScale', 'Escala al apuntar', 1.5, 0.01, 8, 0.1)
  ]},
  {type: 'float', label: 'Flotación', fields: [
    number('amplitude', 'Amplitud (m)', 0.02, 0, 2, 0.01), number('speed', 'Velocidad', 3, 0, 20, 0.1)
  ]},
  {type: 'painting', label: 'Cuadro / acercar imagen', fields: [
    number('distance', 'Distancia de activación (m)', 3, 0.1, 30, 0.1),
    number('zoom', 'Tamaño al acercar', 0.4, 0.01, 2, 0.01), number('ratio', 'Proporción de imagen', 1, 0.01, 10, 0.01)
  ]},
  {type: 'graffiti', label: 'Superficie de pintura', fields: [
    number('distance', 'Distancia para pintar (m)', 1, 0.1, 20, 0.1),
    number('brushSize', 'Tamaño del pincel', 0.2, 0.001, 2, 0.001), number('opacity', 'Opacidad', 1, 0, 1, 0.05)
  ]},
  {type: 'note', label: 'Nota de xilófono', fields: [
    text('asset', 'Archivo de audio', 'ogg/xylophone1.ogg', 1000, 'audio'), number('volume', 'Volumen', 1, 0, 2, 0.05)
  ]},
  {type: 'grab', label: 'Agarrar objeto', fields: [
    number('distance', 'Distancia máxima (m)', 6, 0.1, 30, 0.1), checkbox('returnOnRelease', 'Volver al soltar', true)
  ]},
  {type: 'billboard', label: 'Orientarse hacia el visitante', fields: []},
  {type: 'info', label: 'Panel de información', fields: [
    text('title', 'Título', '', 160), text('text', 'Texto', '', 2000, 'textarea'),
    number('fontSize', 'Tamaño de letra', 0.05, 0.01, 1, 0.01), text('color', 'Color de texto', '#ffffff', 7, 'color')
  ]},
  {type: 'decal', label: 'Decal / imagen sobre superficie', fields: [
    text('asset', 'Imagen', '', 1000, 'image'), text('targetId', 'Superficie de destino', '', 400, 'object'),
    number('width', 'Ancho (m)', 1, 0.01, 100, 0.01), number('height', 'Alto (m)', 1, 0.01, 100, 0.01),
    number('depth', 'Profundidad de proyección (m)', 0.3, 0.001, 100, 0.01),
    number('opacity', 'Opacidad', 1, 0, 1, 0.05), text('color', 'Color', '#ffffff', 7, 'color'),
    {key: 'pattern', label: 'Efecto', input: 'select', default: 'image', options: [
      ['image', 'Imagen'], ['rust', 'Óxido'], ['grime', 'Suciedad'], ['scratches', 'Rayas'], ['chipped', 'Pintura saltada']
    ].map(([value, label]) => ({value, label}))},
    number('seed', 'Variación', 1, 0, 2147483647, 1), number('wearDensity', 'Densidad del desgaste', 0.65, 0, 1, 0.05),
    number('roughness', 'Rugosidad del desgaste', 0.85, 0, 1, 0.05), number('metalness', 'Metal del desgaste', 0.08, 0, 1, 0.05),
    text('stamps', 'Huellas de brocha', '[]', wearSchema.MAX_STAMP_JSON, 'textarea')
  ]},
  {type: 'surfaceMaterial', label: 'Material de superficie', fields: materialSchema.fields},
  {type: 'surfaceWear', label: 'Desgaste con brocha', fields: [text('layers', 'Capas de desgaste', '[]', 512000, 'textarea')]},
  {type: 'sound', label: 'Sonido espacial', fields: [
    text('asset', 'Archivo de audio', '', 1000, 'audio'), number('volume', 'Volumen', 1, 0, 2, 0.05),
    checkbox('autoplay', 'Reproducir automáticamente', false), number('interval', 'Intervalo automático (s)', 2, 0.2, 120, 0.1)
  ]},
  {type: 'animation', label: 'Animación del modelo', fields: [
    text('clip', 'Nombre del clip (vacío = primero)', '', 160), number('speed', 'Velocidad', 1, 0, 5, 0.1),
    checkbox('loop', 'Repetir', false)
  ]},
  {type: 'news', label: 'Pantalla de noticias', fields: [
    text('url', 'Archivo JSON', 'tweets.json', 1000), text('hashtag', 'Etiqueta', '#helloWebXR', 160),
    number('interval', 'Cambiar noticia cada (s)', 3, 1, 120, 1)
  ]},
  {type: 'teleport', label: 'Superficie de teletransporte VR', fields: []},
  {type: 'collision', label: 'Colisiones', fields: [
    {key: 'mode', label: 'Respuesta', input: 'select', default: 'solid', options: [
      {value: 'solid', label: 'Sólido · bloquear movimiento'}, {value: 'trigger', label: 'Detección · permitir atravesar'}
    ]}
  ]},
  {type: 'motion', label: 'Movimiento configurable', fields: [
    {key: 'mode', label: 'Movimiento', input: 'select', default: 'linear', options: [
      {value: 'linear', label: 'Lineal'}, {value: 'rotation', label: 'Rotación'}, {value: 'oscillate', label: 'Oscilación'}
    ]},
    {key: 'axis', label: 'Eje local', input: 'select', default: 'x', options: ['x', 'y', 'z'].map(value => ({value, label: value.toUpperCase()}))},
    number('speed', 'Velocidad (m/s o rad/s)', 0.4, -20, 20, 0.05),
    number('amplitude', 'Amplitud de oscilación (m)', 0.5, 0, 20, 0.05)
  ]},
  {type: 'conveyor', label: 'Banda transportadora simulada', fields: [
    {key: 'layout', label: 'Tipología', input: 'select', default: 'straight', options: [['straight', 'Recta'], ['curveLeft', 'Curva izquierda'], ['curveRight', 'Curva derecha'], ['tee', 'Unión en T']].map(([value, label]) => ({value, label}))},
    {key: 'surface', label: 'Superficie', input: 'select', default: 'rollers', options: [{value: 'rollers', label: 'Rodillos'}, {value: 'belt', label: 'Cinta continua'}]},
    {key: 'role', label: 'Función en la línea', input: 'select', default: 'standalone', options: [['standalone', 'Equipo independiente'], ['start', 'Inicio / alimentación'], ['middle', 'Tramo intermedio'], ['end', 'Final']].map(([value, label]) => ({value, label}))},
    {key: 'axis', label: 'Eje de transporte', input: 'select', default: 'x', options: [{value: 'x', label: 'X'}, {value: 'z', label: 'Z'}]},
    number('length', 'Longitud de recorrido (m)', 4, 0.1, 100, 0.1),
    number('width', 'Ancho (m)', 1, 0.1, 20, 0.1),
    number('radius', 'Radio de curva (m)', 1.5, 0.2, 50, 0.1), number('curveAngle', 'Ángulo de curva (°)', 90, 15, 180, 15),
    {key: 'junctionMode', label: 'Función de la T', input: 'select', default: 'split', options: [{value: 'split', label: 'Distribuir hacia dos salidas'}, {value: 'merge', label: 'Unir dos entradas'}]},
    {key: 'branchSide', label: 'Lado del ramal', input: 'select', default: 'left', options: [{value: 'left', label: 'Izquierda'}, {value: 'right', label: 'Derecha'}]},
    {key: 'routing', label: 'Distribuir productos', input: 'select', default: 'primary', options: [{value: 'primary', label: 'Salida recta'}, {value: 'branch', label: 'Ramal lateral'}, {value: 'alternate', label: 'Alternar salidas'}, {value: 'rules', label: 'Clasificar por atributos'}, {value: 'percentage', label: 'Distribuir por porcentaje'}]},
    text('routingRules', 'Reglas de clasificación', '[]', conveyorRouting.MAX_RULES_JSON, 'textarea'),
    {key: 'routingDefault', label: 'Salida si ninguna regla coincide', input: 'select', default: 'main', options: [{value: 'main', label: 'Salida recta'}, {value: 'branch', label: 'Ramal lateral'}]},
    number('branchPercentage', 'Porcentaje hacia el ramal lateral', 50, 0, 100, 0.1),
    checkbox('withSensors', 'Incluir sensores', true), checkbox('withPanel', 'Incluir panel de mando', true), checkbox('withPallet', 'Pallet incorporado antiguo', false),
    text('outputId', 'Salida recta → módulo', '', 400, 'object'),
    {key: 'outputPort', label: 'Entrada del siguiente módulo', input: 'select', default: 'input', options: [{value: 'input', label: 'Entrada principal'}, {value: 'branch', label: 'Entrada lateral de T (unión)'}]},
    text('branchId', 'Ramal → módulo', '', 400, 'object'),
    {key: 'branchPort', label: 'Entrada del ramal conectado', input: 'select', default: 'input', options: [{value: 'input', label: 'Entrada principal'}, {value: 'branch', label: 'Entrada lateral de T (unión)'}]},
    number('speed', 'Velocidad (m/s)', 0.4, -20, 20, 0.05), checkbox('running', 'Arranque inicial', true),
    checkbox('powered', 'Alimentación inicial', true), checkbox('paused', 'Pausa inicial', false),
    checkbox('autoSpawn', 'Generador de respaldo (sin alimentación externa)', true),
    number('spawnInterval', 'Intervalo del generador de respaldo (s)', 3, 0.1, 120, 0.1),
    number('maxPackages', 'Máximo de paquetes', 20, 1, 100, 1)
  ]},
  {type: 'source', label: 'Source / generador y cola FIFO', fields: [
    checkbox('running', 'En marcha', true), checkbox('paused', 'Pausa inicial', false), checkbox('autoGenerate', 'Generar automáticamente', true),
    {key: 'generationMode', label: 'Selección de productos', input: 'select', default: 'single', options: [{value: 'single', label: 'Un solo tipo'}, {value: 'sequence', label: 'Catálogo en secuencia'}, {value: 'random', label: 'Catálogo aleatorio'}]},
    {key: 'productType', label: 'Tipo de producto', input: 'select', default: 'box', options: [['box', 'Caja de cartón'], ['crate', 'Caja plástica'], ['drum', 'Bidón'], ['bottle', 'Botella']].map(([value, label]) => ({value, label}))},
    number('width', 'Ancho del producto (m)', 0.25, 0.05, 2, 0.05), number('height', 'Alto del producto (m)', 0.25, 0.05, 2, 0.05), number('depth', 'Fondo del producto (m)', 0.25, 0.05, 2, 0.05),
    text('color', 'Color del producto', '#b78b53', 7, 'color'), text('catalog', 'Catálogo de productos', '[]', productSources.MAX_CATALOG_JSON, 'textarea'),
    {key: 'quality', label: 'Calidad del producto', input: 'select', default: 'good', options: [{value: 'good', label: 'Conforme'}, {value: 'defective', label: 'Defectuoso'}]},
    {key: 'defect', label: 'Tipo de defecto simulado', input: 'select', default: 'none', options: conveyorRouting.fields.find(field => field.value === 'defect').options},
    number('defectRate', 'Porcentaje de defectos simulados', 0, 0, 100, 0.1),
    number('seed', 'Semilla de mezcla', 1, 0, 2147483647, 1),
    {key: 'loadMode', label: 'Unidad de carga', input: 'select', default: 'individual', options: [{value: 'individual', label: 'Producto individual'}, {value: 'pallet', label: 'Pallet completo'}]},
    number('palletColumns', 'Columnas del pallet', 2, 1, 8, 1), number('palletRows', 'Filas del pallet', 2, 1, 8, 1), number('palletLayers', 'Capas del pallet', 1, 1, 4, 1),
    number('capacity', 'Capacidad de cola (cargas)', 8, 1, 64, 1), number('interval', 'Generar cada (s)', 3, 0.1, 120, 0.1),
    number('initialCount', 'Cargas iniciales', 0, 0, 64, 1), number('totalLimit', 'Límite total (0 = continuo)', 0, 0, 100000, 1),
    {key: 'delivery', label: 'Entrega de la cola', input: 'select', default: 'manual', options: [{value: 'manual', label: 'Retirar manualmente'}, {value: 'automatic', label: 'Conexión de flujo automática'}]},
    text('outputId', 'Flujo → siguiente equipo', '', 400, 'object'),
    {key: 'outputPort', label: 'Entrada del equipo siguiente', input: 'select', default: 'input', options: [{value: 'input', label: 'Entrada principal'}, {value: 'branch', label: 'Entrada lateral de T'}]},
    number('outputInterval', 'Despachar cada (s)', 1, 0.1, 120, 0.1)
  ]},
  {type: 'processor', label: 'Máquina de procesamiento / Combiner / Separator', fields: [
    {key: 'mode', label: 'Tipo de procesamiento', input: 'select', default: 'process', options: [['process', 'Procesar una carga'], ['combiner', 'Combiner · agrupar cargas'], ['separator', 'Separator · dividir lotes / pallets']].map(([value, label]) => ({value, label}))},
    checkbox('powered', 'Alimentación inicial', false), checkbox('running', 'Arranque inicial', false), checkbox('paused', 'Pausa inicial', false), checkbox('emergency', 'Emergencia inicial', false),
    number('processTime', 'Tiempo de proceso por ciclo (s)', 5, 0.1, 3600, 0.1), number('setupTime', 'Tiempo de preparación / setup (s)', 2, 0, 3600, 0.1),
    {key: 'setupPolicy', label: 'Realizar preparación', input: 'select', default: 'productChange', options: [['startup', 'Al iniciar la máquina'], ['productChange', 'Al iniciar y cambiar de producto'], ['eachBatch', 'En cada ciclo']].map(([value, label]) => ({value, label}))},
    checkbox('requiresOperator', 'Requiere operario', false), checkbox('operatorAvailable', 'Operario disponible al iniciar', false),
    number('capacity', 'Capacidad de entrada (cargas)', 8, 1, 64, 1), number('parallelism', 'Puestos de proceso simultáneos', 1, 1, 8, 1), number('outputCapacity', 'Capacidad de salida (cargas)', 8, 1, 64, 1),
    number('combineCount', 'Cargas por combinación', 2, 2, 16, 1), number('splitCount', 'Máximo de grupos de salida', 2, 2, 16, 1),
    number('length', 'Largo de la máquina (m)', 3, 1.5, 8, 0.1), number('width', 'Ancho de la máquina (m)', 1.6, 0.6, 6, 0.1),
    {key: 'delivery', label: 'Entrega de productos procesados', input: 'select', default: 'automatic', options: [{value: 'manual', label: 'Retirar manualmente'}, {value: 'automatic', label: 'Conexión de flujo automática'}]},
    text('outputId', 'Flujo → siguiente equipo', '', 400, 'object'),
    {key: 'outputPort', label: 'Entrada del equipo siguiente', input: 'select', default: 'input', options: [{value: 'input', label: 'Entrada principal'}, {value: 'branch', label: 'Entrada lateral de T'}]},
    number('outputInterval', 'Despachar cada (s)', 0.5, 0.1, 120, 0.1)
  ]},
  {type: 'palletQueue', label: 'Pallet Queue / almacén temporal con estibas', fields: [
    checkbox('running', 'Aceptar y entregar productos', true), checkbox('paused', 'Pausa inicial', false),
    number('width', 'Ancho de la estiba (m)', 1.2, 0.4, 4, 0.05), number('depth', 'Fondo de la estiba (m)', 1.05, 0.4, 4, 0.05),
    number('columns', 'Columnas de productos', 4, 1, 8, 1), number('rows', 'Filas de productos', 3, 1, 8, 1), number('layers', 'Niveles de apilado', 4, 1, 8, 1),
    number('capacity', 'Capacidad del almacén (cargas)', 48, 1, 128, 1),
    {key: 'delivery', label: 'Retiro de productos almacenados', input: 'select', default: 'manual', options: [{value: 'manual', label: 'Retirar manualmente'}, {value: 'automatic', label: 'Conexión de flujo automática'}]},
    text('outputId', 'Flujo → siguiente equipo', '', 400, 'object'),
    {key: 'outputPort', label: 'Entrada del equipo siguiente', input: 'select', default: 'input', options: [{value: 'input', label: 'Entrada principal'}, {value: 'branch', label: 'Entrada lateral de T'}]},
    number('outputInterval', 'Despachar cada (s)', 1, 0.1, 120, 0.1)
  ]},
  {type: 'sensor', label: 'Sensor de presencia simulado', fields: [
    text('sourceId', 'Banda de origen', '', 400, 'object'), checkbox('normallyClosed', 'Contacto normalmente cerrado', false)
  ]},
  {type: 'product', label: 'Producto manipulable / caja', fields: [
    text('sourceId', 'Banda preferida (vacío = cercana)', '', 400, 'object'),
    text('sku', 'Código / SKU', 'product', 64),
    {key: 'productType', label: 'Tipo de producto', input: 'select', default: 'box', options: conveyorRouting.fields.find(field => field.value === 'productType').options},
    text('color', 'Color de clasificación', '#b78b53', 7, 'color'),
    {key: 'quality', label: 'Calidad', input: 'select', default: 'good', options: [{value: 'good', label: 'Conforme'}, {value: 'defective', label: 'Defectuoso'}]},
    {key: 'defect', label: 'Defecto', input: 'select', default: 'none', options: conveyorRouting.fields.find(field => field.value === 'defect').options}
  ]},
  {type: 'automation', label: 'Automatización por reglas', fields: [text('rules', 'Reglas JSON (sin ejecutar código)', '[]', 32000, 'textarea')]},
  {type: 'analytics', label: 'Registro de variables', fields: [number('interval', 'Muestrear cada (s)', 1, 0.1, 60, 0.1)]},
  {type: 'control', label: 'Control de simulación (ratón / VR)', fields: [
    text('targetId', 'Objeto controlado (vacío = este)', '', 400, 'object'),
    {key: 'scope', label: 'Alcance del panel', input: 'select', default: 'module', options: [{value: 'module', label: 'Solo este módulo'}, {value: 'segment', label: 'Hasta el siguiente panel'}, {value: 'line', label: 'Toda la línea conectada'}]},
    {key: 'variable', label: 'Variable', input: 'select', default: 'running', options: ['running', 'emergency', 'enabled', 'speed', 'powered', 'paused', 'autoSpawn', 'autoGenerate', 'interval', 'outputInterval', 'processTime', 'setupTime', 'operatorAvailable'].map(value => ({value, label: value}))},
    {key: 'mode', label: 'Acción', input: 'select', default: 'set', options: [{value: 'set', label: 'Asignar'}, {value: 'toggle', label: 'Alternar'}, {value: 'command', label: 'Mando de máquina'}]},
    {key: 'command', label: 'Mando', input: 'select', default: 'start', options: [
      ['start', 'Arrancar'], ['stop', 'Parar'], ['pause', 'Pausar / continuar'], ['powerOn', 'Encender'], ['powerOff', 'Apagar'],
      ['speedUp', 'Aumentar velocidad'], ['speedDown', 'Reducir velocidad'], ['insertBox', 'Insertar caja'], ['resetEmergency', 'Rearmar emergencia'],
      ['generate', 'Generar una carga'], ['dispatch', 'Despachar primera carga'], ['clearQueue', 'Vaciar cola'], ['operator', 'Alternar disponibilidad del operario']
    ].map(([value, label]) => ({value, label}))},
    number('value', 'Valor (0 = falso; 1 = verdadero)', 1, -20, 20, 0.05)
  ]}
];

function definitionFor(type) {
  return definitions.find(definition => definition.type === type) || null;
}

function plain(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

// References are resolved by AssetLibrary on this origin. Never accept a scheme,
// absolute path, traversal, query, fragment or an encoded alternate spelling.
function assetReference(value, allowEmpty) {
  if (typeof value !== 'string' || value.length > 1000 || (!allowEmpty && !value) ||
    /[\x00-\x1f\x7f:%?#\\]/.test(value) || value.startsWith('/') ||
    (value && value.split('/').some(segment => !segment || segment === '.' || segment === '..'))) {
    throw new Error('La referencia de archivo debe ser una ruta relativa o un archivo importado.');
  }
  return value;
}

function defaultBehavior(type) {
  const definition = definitionFor(type);
  if (!definition) throw new Error('Función de objeto no compatible: ' + String(type));
  if (type === 'surfaceMaterial') return materialSchema.normalizeMaterial({type});
  const result = {type, enabled: true};
  definition.fields.forEach(field => { result[field.key] = field.default; });
  return result;
}

function normalizeBehaviors(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list) || list.length > 16) throw new Error('El objeto admite hasta 16 funciones.');
  const types = new Set();
  return list.map(value => {
    if (!plain(value) || typeof value.type !== 'string') throw new Error('Función de objeto inválida.');
    const definition = definitionFor(value.type);
    if (!definition) throw new Error('Función de objeto no compatible: ' + value.type);
    if (types.has(value.type)) throw new Error('Una función no puede repetirse en el mismo objeto.');
    types.add(value.type);
    if (value.type === 'surfaceMaterial') return materialSchema.normalizeMaterial(value);
    const result = defaultBehavior(value.type);
    if (value.enabled !== undefined) {
      if (typeof value.enabled !== 'boolean') throw new Error('La activación de una función debe ser verdadero o falso.');
      result.enabled = value.enabled;
    }
    definition.fields.forEach(field => {
      if (value[field.key] === undefined) return;
      const item = value[field.key];
      const label = definition.label + ': ' + field.label;
      if (field.input === 'number' || field.input === 'room') {
        if (typeof item !== 'number' || !Number.isFinite(item) || item < field.min || item > field.max ||
          (field.input === 'room' && !Number.isInteger(item))) throw new Error('Valor fuera de rango en ' + label + '.');
      } else if (field.input === 'checkbox') {
        if (typeof item !== 'boolean') throw new Error('Valor inválido en ' + label + '.');
      } else if (field.input === 'select') {
        if (!field.options.some(option => option.value === item)) throw new Error('Opción inválida en ' + label + '.');
      } else if (field.input === 'color') {
        if (typeof item !== 'string' || !/^#[a-f0-9]{6}$/i.test(item)) throw new Error('El color debe tener formato #RRGGBB.');
      } else if (typeof item !== 'string' || item.length > field.maxLength) {
        throw new Error('Texto demasiado largo o inválido en ' + label + '.');
      }
      result[field.key] = field.input === 'color' ? item.toLowerCase() : item;
    });
    if (value.type === 'sound' || value.type === 'note') assetReference(result.asset, value.type === 'sound');
    if (value.type === 'decal') {
      assetReference(result.asset, true); objectReference(result.targetId, true);
      if (!Number.isInteger(result.seed)) throw new Error('La variación del desgaste debe ser un entero.');
      result.stamps = wearSchema.normalizeStampJSON(result.stamps);
    }
    if (value.type === 'surfaceWear') result.layers = wearSchema.normalizeLayerJSON(result.layers);
    if (value.type === 'source') {
      result.catalog = productSources.normalizeCatalogJSON(result.catalog); objectReference(result.outputId, true);
      ['seed', 'palletColumns', 'palletRows', 'palletLayers', 'capacity', 'initialCount', 'totalLimit'].forEach(key => { if (!Number.isInteger(result[key])) throw new Error('El valor de ' + key + ' debe ser un entero.'); });
      if (result.initialCount > result.capacity || result.totalLimit && result.initialCount > result.totalLimit) throw new Error('Las cargas iniciales superan la capacidad o el límite total.');
      if (productSources.unitsFor(result) > 64) throw new Error('Un pallet admite hasta 64 productos.');
    }
    if (value.type === 'processor') {
      objectReference(result.outputId, true);
      ['capacity', 'parallelism', 'outputCapacity', 'combineCount', 'splitCount'].forEach(key => { if (!Number.isInteger(result[key])) throw new Error('El valor de ' + key + ' debe ser un entero.'); });
      if (result.mode === 'combiner' && result.combineCount > result.capacity) throw new Error('La capacidad de entrada debe admitir todas las cargas de una combinación.');
      if (result.mode === 'separator' && result.splitCount > result.outputCapacity) throw new Error('La capacidad de salida debe admitir los grupos de una separación.');
    }
    if (value.type === 'palletQueue') {
      objectReference(result.outputId, true);
      ['capacity', 'columns', 'rows', 'layers'].forEach(key => { if (!Number.isInteger(result[key])) throw new Error('El valor de ' + key + ' debe ser un entero.'); });
      if (result.capacity > result.columns * result.rows * result.layers) throw new Error('La capacidad supera las posiciones disponibles en la estiba.');
    }
    if (value.type === 'news') assetReference(result.url, false);
    if (value.type === 'sensor' || value.type === 'product') objectReference(result.sourceId, true);
    if (value.type === 'product') {
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(result.sku)) throw new Error('El código / SKU admite hasta 64 letras, números, guiones o guiones bajos.');
      if (result.quality === 'good' && result.defect !== 'none') throw new Error('Un producto conforme no puede tener un defecto.');
      if (result.quality === 'defective' && result.defect === 'none') result.defect = 'damaged';
    }
    if (value.type === 'control') objectReference(result.targetId, true);
    if (value.type === 'control' && result.variable === 'speed' && result.mode === 'toggle') throw new Error('La velocidad se controla con la acción Asignar.');
    if (value.type === 'control' && ['interval', 'outputInterval', 'processTime', 'setupTime'].includes(result.variable) && result.mode === 'toggle') throw new Error('Los tiempos se controlan con la acción Asignar.');
    if (value.type === 'conveyor' && !Number.isInteger(result.maxPackages)) throw new Error('El máximo de paquetes debe ser un entero.');
    if (value.type === 'conveyor') {
      result.withPallet = false;
      result.routingRules = conveyorRouting.normalizeRulesJSON(result.routingRules);
      objectReference(result.outputId, true); objectReference(result.branchId, true);
      if (['curveLeft', 'curveRight'].includes(result.layout) && result.radius < result.width / 2 + 0.1) throw new Error('El radio de curva debe ser al menos la mitad del ancho más 0.1 m.');
      if (result.layout === 'tee' && result.length < result.width * 2) throw new Error('La unión en T necesita un largo de al menos dos veces su ancho.');
    }
    if (value.type === 'automation') result.rules = JSON.stringify(normalizeRules(result.rules));
    return result;
  });
}

const simulationTypes = ['motion', 'conveyor', 'source', 'processor', 'palletQueue', 'sensor', 'product', 'automation', 'analytics', 'control'];
module.exports = {definitions, definitionFor, defaultBehavior, normalizeBehaviors, assetReference, simulationTypes, conveyorLayout, productSources, processors, palletQueues, conveyorRouting};
