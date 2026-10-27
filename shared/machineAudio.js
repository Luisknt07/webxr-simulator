'use strict';
// Portable authoring settings. Runtime nodes/buffers never enter the document.
const presets = [
  ['auto', 'Según la función del equipo'], ['motor', 'Motor y transmisión'], ['rollers', 'Rodillos en movimiento'], ['belt', 'Cinta transportadora'],
  ['pneumatic', 'Actuador neumático'], ['elevator', 'Elevador y reductora'], ['processor', 'Máquina de proceso'], ['servo', 'Servos y reductores del robot'], ['load', 'Carga y apoyo'],
  ['electric-drive', 'Tracción eléctrica'], ['combustion', 'Motor térmico'], ['hydraulic', 'Bomba hidráulica'], ['horn', 'Bocina de vehículo'], ['reverse-alarm', 'Aviso de reversa'],
  ['button', 'Pulsador mecánico'], ['ventilation', 'Ventilación / HVAC'], ['warehouse', 'Ambiente de almacén'], ['factory', 'Ambiente de fábrica'], ['off', 'Silencio']
].map(([value, label]) => ({value, label}));
const number = (key, label, value, min, max, step) => ({key, label, input: 'number', default: value, min, max, step});
const common = [
  {key: 'preset', label: 'Perfil de sonido', input: 'select', default: 'auto', options: presets},
  {key: 'asset', label: 'Audio propio (vacío usa el perfil)', input: 'audio', default: '', maxLength: 1000},
  number('volume', 'Volumen del emisor', .55, 0, 1, .05), number('playbackRate', 'Velocidad del audio', 1, .25, 3, .05),
  {key: 'loop', label: 'Repetir mientras esté activo', input: 'checkbox', default: true}
];
const fields = common.concat([
  number('range', 'Alcance máximo (m)', 18, 1, 100, .5), number('refDistance', 'Distancia de volumen pleno (m)', 2, .1, 30, .1),
  {key: 'trigger', label: 'Cuándo se escucha', input: 'select', default: 'auto', options: [
    ['auto', 'Según el estado real'], ['running', 'Equipo en movimiento / proceso'], ['cycle', 'Inicio del ciclo'], ['button', 'Al pulsar el botón'], ['always', 'Continuo con el nivel activo']
  ].map(([value, label]) => ({value, label}))}
]);
const zoneFields = common.map(field => Object.assign({}, field, field.key === 'preset' ? {default: 'warehouse'} : field.key === 'volume' ? {default: .3} : {})).concat([
  {key: 'shape', label: 'Forma de la zona', input: 'select', default: 'box', options: [{value: 'box', label: 'Caja'}, {value: 'sphere', label: 'Esfera'}]},
  number('width', 'Ancho de la zona (m)', 8, .1, 200, .5), number('height', 'Alto de la zona (m)', 4, .1, 100, .5), number('depth', 'Fondo de la zona (m)', 8, .1, 200, .5),
  number('radius', 'Radio de la zona (m)', 5, .1, 100, .5), number('fade', 'Desvanecimiento exterior (m)', 3, .1, 30, .1)
]);
function assetReference(value) {
  if (typeof value !== 'string' || value.length > 1000 || /[\x00-\x1f\x7f:%?#\\]/.test(value) || value.startsWith('/') || value && value.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('El audio debe ser una ruta relativa o un archivo importado del proyecto.');
  return value;
}
function normalize(type, value = {}) {
  if (!['machineAudio', 'audioZone'].includes(type) || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Configuración de audio inválida.');
  const definition = type === 'audioZone' ? zoneFields : fields, keys = new Set(['type', 'enabled'].concat(definition.map(field => field.key)));
  if (Object.keys(value).some(key => !keys.has(key))) throw new Error('El audio contiene propiedades desconocidas.');
  const result = {type, enabled: value.enabled === undefined ? true : value.enabled};
  if (typeof result.enabled !== 'boolean') throw new Error('La activación del sonido debe ser verdadero o falso.');
  definition.forEach(field => {
    const entry = value[field.key] === undefined ? field.default : value[field.key];
    if (field.input === 'number' ? typeof entry !== 'number' || !Number.isFinite(entry) || entry < field.min || entry > field.max : field.input === 'checkbox' ? typeof entry !== 'boolean' : field.options ? !field.options.some(option => option.value === entry) : typeof entry !== 'string' || entry.length > field.maxLength) throw new Error('Valor inválido en sonido: ' + field.label + '.');
    result[field.key] = entry;
  });
  assetReference(result.asset);
  if (type === 'machineAudio' && result.refDistance >= result.range) throw new Error('El alcance del sonido debe superar la distancia de volumen pleno.');
  return result;
}
module.exports = {presets, fields, zoneFields, normalize, assetReference};
