/* Catalogue of our procedural teaching robots, not copies of branded products. */
'use strict';
const robots = require('./robots.js');
const VERSION = 1;
const REFERENCES = [
  {id: 'classification', title: 'IFR · Clasificación por estructura mecánica', url: 'https://ifr.org/industrial-robots', note: 'Distingue cartesianos, SCARA, articulados, paralelos, cilíndricos y polares; la colaboración se trata aparte.'},
  {id: 'articulated', title: 'KUKA · Robots industriales', url: 'https://www.kuka.com/en-us/products/robotics-systems/industrial-robots/', note: 'Aplicaciones y variedad de arquitecturas; nuestros parámetros no son fichas de esos modelos.'},
  {id: 'scara', title: 'Epson · Robots SCARA', url: 'https://epson.ca/For-Work/Robots/SCARA/c/w810', note: 'Familias de montaje y manipulación SCARA, con distintos alcances según modelo.'},
  {id: 'delta', title: 'ABB · IRB 360 FlexPicker', url: 'https://library.e.abb.com/public/f03878770fef4c2c93757953373aed9b/IRB%20360_datasheet_20220829.pdf', note: 'Referencia del principio paralelo y picking; seguimiento continuo de bandas es una función específica del controlador real.'},
  {id: 'cartesian', title: 'Yamaha · Robots cartesianos XY-X', url: 'https://global.yamaha-motor.com/business/robot/lineup/xyx/', note: 'Variantes de guías lineales, pórtico y gestión de cables.'},
  {id: 'palletizer', title: 'FANUC · Serie M-410', url: 'https://www.fanuc.eu/eu-en/m-410-series', note: 'Paletizado y despaletizado con modelos de cuatro y cinco ejes; aquí se implementa una arquitectura de cuatro.'},
  {id: 'mobile', title: 'MiR · Diferencias AMR y AGV', url: 'https://mobile-industrial-robots.com/blog/agv-vs-amr-whats-the-difference', note: 'Diferencia entre navegación flexible y recorridos guiados; el simulador no incorpora SLAM.'},
  {id: 'amr', title: 'OMRON · AMR serie LD', url: 'https://robotics.omron.com/products/mobile-robots/ld-series/', note: 'Referencia de plataforma, percepción, transporte y misiones; no se atribuyen sus especificaciones a nuestro modelo.'},
  {id: 'shuttle', title: 'Daifuku · Shuttle Rack M', url: 'https://www.daifuku.com/es/solution/intralogistics/products/automated-warehouse/multi-shuttle-asrs/', note: 'Referencia de shuttle de almacenamiento y secuenciación; nuestro carro es una transferencia lineal, sin WMS ni rack multinivel completo.'},
  {id: 'sorting', title: 'Dematic · AMR', url: 'https://www.dematic.com/en-us/solutions/amr/', note: 'Transporte de contenedores y clasificación por destino; no implica que exista clasificación robótica por visión en este simulador.'}
];
const PARTS = [
  {id: 'base', name: 'Base y anclajes', function: 'Apoyo del robot en el piso o en una plataforma; establece su sistema de coordenadas.', match: ['Base', 'Pedestal', 'Anclaje', 'Bastidor']},
  {id: 'links', name: 'Eslabones y guías', function: 'Definen el alcance y la trayectoria del efector mediante la cinemática propia de cada arquitectura.', match: ['Brazo', 'Eslabón', 'Guía', 'Columna', 'Carril', 'Pórtico']},
  {id: 'joints', name: 'Ejes y accionamientos', function: 'Articulaciones limitadas y animadas; no se simulan par, inercia ni temperatura del servo.', match: ['Junta', 'Articulación', 'Servo', 'Reductor', 'Motor']},
  {id: 'tool', name: 'Herramienta y brida', function: 'Sujeta una carga, la deposita o ejecuta el tiempo de proceso configurado.', match: ['Pinza', 'Ventosa', 'Herramienta', 'Brida', 'Horquilla', 'Plataforma']},
  {id: 'cables', name: 'Cables y protecciones', function: 'Detalle visual de alimentación y neumática; no es un cálculo de cableado industrial.', match: ['Cable', 'Manguera', 'Protección', 'Fuelle']},
  {id: 'panel', name: 'Control y HMI', function: 'Marcha, pausa, parada, alimentación y emergencia sobre el estado real de esta instancia.', match: ['PLC', 'Panel', 'Pantalla', 'Botón']}
];
const ACTIONS = [
  {id: 'start', name: 'Marcha', description: 'Inicia o reanuda la secuencia con alimentación y sin emergencia.'},
  {id: 'stop', name: 'Parar', description: 'Detiene el movimiento conservando la carga y la secuencia.'},
  {id: 'pause', name: 'Pausa', description: 'Suspende temporalmente el ciclo.'},
  {id: 'emergency', name: 'Emergencia', description: 'Enclava una parada simulada; necesita rearme y una nueva orden.'},
  {id: 'powerOff', name: 'Apagar', description: 'Retira la alimentación simulada.'},
  {id: 'powerOn', name: 'Encender', description: 'Habilita la alimentación; no inicia por sí sola el movimiento.'},
  {id: 'speedDown', name: '− Velocidad', description: 'Reduce la consigna.'},
  {id: 'speedUp', name: '+ Velocidad', description: 'Aumenta la consigna dentro del límite configurado.'}
];
const PRODUCT_PROFILES = [
  {id: 'box-light', name: 'Caja ligera', productType: 'box', width: 0.24, height: 0.2, depth: 0.3, mass: 1, base: 'flat'},
  {id: 'box-medium', name: 'Caja mediana', productType: 'box', width: 0.36, height: 0.3, depth: 0.45, mass: 4, base: 'flat'},
  {id: 'crate', name: 'Contenedor rígido', productType: 'crate', width: 0.4, height: 0.3, depth: 0.6, mass: 8, base: 'rigid'},
  {id: 'pallet', name: 'Pallet cargado', productType: 'pallet', loadType: 'pallet', width: 0.8, height: 0.65, depth: 1.2, mass: 120, base: 'runners'}
];
const DESCRIPTIONS = {
  'articulated-general': 'Brazo serial de seis ejes con pinza, límites articulares y recogida / entrega coordinadas con los equipos conectados.',
  'articulated-process': 'Brazo con boquilla de proceso: aproxima, opera sobre el producto en su estación y se retira, sin sujetar ni transportar la carga.',
  collaborative: 'Variante de carcasa redondeada y velocidad inicial reducida. La apariencia no certifica una aplicación colaborativa ni detección de fuerza.',
  scara: 'Dos brazos en el plano horizontal, husillo vertical y giro de muñeca; manipulación ligera entre estaciones.',
  delta: 'Mecanismo paralelo suspendido para picking ligero con tres cadenas cerradas y orientación de herramienta.',
  cartesian: 'Pórtico con guías XYZ, carrera configurable y traslado de una carga dentro de su volumen rectangular.',
  palletizer: 'Brazo de cuatro ejes con herramienta nivelada; entrega cajas al almacén de pallets que determina el patrón y las capas.',
  amr: 'Plataforma para misiones entre estaciones. El recorrido y la comprobación de obstáculos son aproximaciones geométricas, sin SLAM ni mapas de un LiDAR real.',
  agv: 'Vehículo sobre una ruta de puntos configurada, con admisión y entrega coordinadas. La guía es lógica; no se interpreta una cinta magnética desde una cámara.',
  'cylindrical-rpp': 'Robot RPP con columna giratoria, guía vertical y corredera radial; recogida, proceso y entrega dentro de un volumen cilíndrico limitado.',
  'polar-rrp': 'Robot RRP con giro, inclinación y brazo telescópico. La orientación de la herramienta sigue la inclinación; no dispone de una muñeca orientable independiente.',
  'mobile-manipulator': 'Base móvil y brazo de seis ejes coordinados: atraque, recogida, retracción para viaje y depósito mediante la misma carga física; el brazo se mueve con la base detenida.',
  'mobile-sorter-crossbelt': 'Plataforma móvil con cinta transversal; selecciona un receptor mediante SKU, tipo, color, calidad o dimensiones y transfiere la carga con descarga animada.',
  'mobile-sorter-tilttray': 'Plataforma móvil con bandeja inclinable; selecciona un receptor inferior compatible y combina la inclinación y el desplazamiento de la carga hasta la entrega.',
  shuttle: 'Carro de transferencia sobre carril con carrera limitada, para conectar dos estaciones; no incluye un almacén AS/RS multinivel completo.'
};
function definition(option) {
  const preset = robots.defaults(option.id), family = robots.FAMILIES.find(item => item.id === option.family), mobile = family.mobility === 'mobile';
  const referenceIds = ['classification', option.family === 'agv' ? 'mobile' : option.family];
  if (mobile) referenceIds.push('mobile');
  const parts = PARTS.filter(part => !(mobile && option.family !== 'mobileManipulator' && ['links', 'joints'].includes(part.id)) && !(part.id === 'panel' && !preset.withPanel)).map(part => Object.assign({}, part));
  if (mobile) parts.splice(1, 0, {id: 'drive', name: 'Chasis, ruedas y sensores', function: 'Desplazan la plataforma por las misiones y muestran su estado de movimiento.', match: ['Chasis', 'Rueda', 'Escáner', 'Sensor', 'Lidar']});
  return {id: 'robot.' + option.id, version: VERSION, family: option.family, variant: option.id, name: option.name,
    description: DESCRIPTIONS[option.id], status: 'ready', prefab: 'robot', preset,
    dimensions: {length: preset.length, width: preset.width, height: preset.baseHeight + preset.height, units: 'm'},
    axes: family.axes, mobility: family.mobility, parts, components: parts.map(part => part.name),
    parameters: robots.fields().filter(field => !['sourceId', 'targetId', 'outputId', 'jointLimitsJson', 'waypointsJson'].includes(field.key)).map(field => Object.assign({provenance: 'didactic'}, field)),
    ports: ['input', 'output'], actions: ACTIONS, sensors: [{id: 'load', name: 'Carga retenida', type: 'simulated'}, {id: 'destination', name: 'Receptor disponible', type: 'simulated'}],
    productProfiles: PRODUCT_PROFILES.filter(profile => robots.acceptsProduct(preset, profile)),
    operations: mobile && option.family !== 'mobileManipulator' || option.family === 'shuttle' ? ['transport'] : option.id === 'articulated-process' ? ['process'] : ['pick-place', 'palletize'],
    simulationLevel: 'Cinemática y eventos discretos: secuencia, una carga retenida, reservas de receptor y estados por instancia; sin dinámica de cuerpos rígidos.',
    alarms: ['Falta equipo de recogida', 'Falta receptor', 'Fuera de alcance', 'Receptor ocupado', 'Carga incompatible', 'Emergencia'],
    provenance: {geometry: 'Modelo procedural original en metros, con partes y redondeos de complejidad acotada.', parameters: 'Valores didácticos personalizables, no prestaciones de un fabricante.', behavior: 'Intercambio de productos del simulador; sin conexión a un robot físico ni certificación de seguridad.'},
    references: REFERENCES.filter(reference => referenceIds.includes(reference.id))};
}
const EQUIPMENT = robots.VARIANTS.map(definition);
function getEquipment(id) { if (typeof id !== 'string') return null; const key = id.replace(/^robot\./, ''); return EQUIPMENT.find(item => item.id === id || item.variant === key) || null; }
function listEquipment(options = {}) { return EQUIPMENT.filter(item => (!options.family || item.family === options.family) && (options.readyOnly === false || item.status === 'ready')); }
function resolveVariant(value) { return typeof value === 'string' ? getEquipment(value) : value && getEquipment(value.equipmentId || value.variant || (robots.getDefinition(value.family) || {}).id); }
module.exports = {VERSION, FAMILIES: robots.FAMILIES, EQUIPMENT, PARTS, ACTIONS, PANEL_ACTIONS: ACTIONS, PRODUCT_PROFILES, REFERENCES,
  getEquipment, getDefinition: getEquipment, listEquipment, resolveVariant};
