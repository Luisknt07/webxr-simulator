'use strict';

// Shared, versioned definitions. Values are teaching defaults, not commercial
// ratings. Geometry, authoring, documentation and simulation resolve this file.
const VERSION = 1;
const FAMILIES = [
  {id: 'straight', name: 'Rectos', description: 'Transporte en línea de cajas, recipientes o pallets.'},
  {id: 'curved', name: 'Curvos', description: 'Cambio continuo de dirección con radio y ángulo configurables.'},
  {id: 'inclined', name: 'Inclinados', description: 'Transporte entre cotas mediante una superficie inclinada.'},
  {id: 'transfer', name: 'Transferencias', description: 'Cambio de dirección mediante elevación o giro, con enclavamientos.'},
  {id: 'diverter', name: 'Uniones y desvíos', description: 'Clasificación y unión de ramas con mecanismos concretos.'},
  {id: 'accumulation', name: 'Acumuladores', description: 'Retención y liberación por zonas según la disponibilidad siguiente.'},
  {id: 'elevator', name: 'Elevadores', description: 'Traslado vertical entre dos niveles con una plataforma guiada.'},
  {id: 'loading', name: 'Carga y descarga', description: 'Puestos físicos manuales o automáticos, separados del Source lógico.'}
];
const PANEL_ACTIONS = [
  {id: 'start', name: 'Marcha', description: 'Inicia un equipo alimentado, sin emergencia y con sus condiciones satisfechas.'},
  {id: 'stop', name: 'Parar', description: 'Detiene el transporte y conserva las cargas.'},
  {id: 'emergency', name: 'Emergencia', description: 'Enclava la parada. Liberarla requiere una nueva orden de marcha.'},
  {id: 'pause', name: 'Pausa', description: 'Suspende o reanuda el movimiento conservando el estado.'},
  {id: 'powerOff', name: 'Apagar', description: 'Retira la alimentación simulada.'},
  {id: 'powerOn', name: 'Encender', description: 'Habilita la alimentación; no equivale a marcha.'},
  {id: 'speedDown', name: '− Velocidad', description: 'Reduce la consigna del transporte motorizado.'},
  {id: 'insertBox', name: 'Insertar caja', description: 'Ayuda de simulación: solicita una carga compatible si hay espacio. No es una capacidad física del equipo.'},
  {id: 'speedUp', name: '+ Velocidad', description: 'Aumenta la consigna del transporte motorizado.'}
];
const REFERENCES = [
  {id: 'roller-support', title: 'Interroll · Rodillos y ruedas', url: 'https://www.interroll.com/products/rollers-and-wheels', note: 'Criterio general de al menos tres rodillos de apoyo. No asigna una capacidad comercial a este modelo.'},
  {id: 'transfer-principle', title: 'Bosch Rexroth · Transfer System TS 5', url: 'https://www.boschrexroth.com/en/sg/c/transfer-system-ts-5/', note: 'Principios de transferencia elevable, giro y desvío; geometría didáctica propia.'},
  {id: 'gravity-principle', title: 'SOCO SYSTEM · Dimensionado de transportadores', url: 'https://www.socosystem.com/us/articles/how-to-dimension-conveyors', note: 'La pendiente necesaria depende de la carga y su base; no se presenta el modelo cinemático como una validación de ingeniería.'}
];
const PRODUCT_PROFILES = [
  {id: 'box-small', name: 'Caja pequeña', productType: 'box', width: 0.24, height: 0.20, depth: 0.30, mass: 1, base: 'flat'},
  {id: 'box-medium', name: 'Caja mediana', productType: 'box', width: 0.36, height: 0.30, depth: 0.45, mass: 4, base: 'flat'},
  {id: 'box-large', name: 'Caja grande', productType: 'box', width: 0.55, height: 0.45, depth: 0.65, mass: 12, base: 'flat'},
  {id: 'tray', name: 'Bandeja rígida', productType: 'crate', width: 0.40, height: 0.10, depth: 0.60, mass: 2, base: 'rigid'},
  {id: 'container', name: 'Contenedor', productType: 'crate', width: 0.40, height: 0.30, depth: 0.60, mass: 8, base: 'rigid'},
  {id: 'pallet', name: 'Pallet cargado', productType: 'pallet', loadType: 'pallet', width: 0.80, height: 0.65, depth: 1.20, mass: 120, base: 'runners'}
];
const BASE = {layout: 'straight', surface: 'rollers', axis: 'x', role: 'start', length: 4, width: 1,
  drive: 'motor', mechanism: 'transport', rise: 0, supportHeight: 1, rollerPitch: 0.08, maxLoad: 30, clearance: 1,
  withPanel: true, withSensors: true, withPallet: false, autoSpawn: false, speed: 0.4,
  powered: true, running: false, radius: 1.5, curveAngle: 90, branchSide: 'left', junctionMode: 'split',
  actuatorTime: 0.6, turnTime: 1.5, verticalSpeed: 0.4, zoneLength: 1};
const PARTS = [
  {id: 'frame', name: 'Bastidor y guías', function: 'Sostienen la carga y mantienen el ancho útil del recorrido.', match: ['Bastidor', 'Larguero', 'Guía', 'Perfil', 'Resguardo']},
  {id: 'supports', name: 'Apoyos nivelables', function: 'Transmiten las cargas al piso; permiten nivelar la estructura.', match: ['Soportes telescópicos', 'Pata', 'Pie', 'Husillo']},
  {id: 'surface', name: 'Superficie de transporte', function: 'Apoya y desplaza la base del producto sobre el recorrido definido.', match: ['Rodillos', 'Rodillo', 'Cinta continua', 'Retorno de cinta', 'Cadena', 'Banda modular', 'Taco']},
  {id: 'drive', name: 'Accionamiento', function: 'El motorreductor transmite el movimiento a la superficie. Está ausente en la variante por gravedad.', match: ['Motorreductor', 'Motor', 'Reductor', 'Transmisión']},
  {id: 'sensors', name: 'Sensores de presencia', function: 'Detectan ocupación del volumen y flancos de entrada/salida. La calidad es un atributo del producto, no una medición de estos sensores.', match: ['Sensor', 'Entrada', 'Salida']},
  {id: 'panel', name: 'Panel de control', function: 'Opera el módulo, tramo o línea y muestra variables reales de la simulación.', match: ['PLC', 'Panel', 'Control', 'Armario', 'Pantalla']}
];
const PARAMETERS = [
  {key: 'length', label: 'Longitud', unit: 'm', min: 0.8, max: 20},
  {key: 'width', label: 'Ancho útil', unit: 'm', min: 0.3, max: 3},
  {key: 'supportHeight', label: 'Altura de transporte sobre el piso', unit: 'm', min: 0.5, max: 5},
  {key: 'speed', label: 'Consigna', unit: 'm/s', min: 0, max: 3},
  {key: 'maxLoad', label: 'Carga admisible simulada', unit: 'kg', min: 0.1, max: 3000},
  {key: 'clearance', label: 'Altura libre', unit: 'm', min: 0.1, max: 4},
  {key: 'withSensors', label: 'Sensores de presencia', input: 'boolean'},
  {key: 'withPanel', label: 'Panel propio', input: 'boolean'}
];
function definition(variant, family, name, description, preset, extra) {
  const settings = Object.assign({}, BASE, preset, {equipmentId: 'conveyor.' + variant, equipmentVersion: VERSION});
  const parts = PARTS.filter(part => !(settings.drive !== 'motor' && ['drive', 'panel'].includes(part.id)) &&
    !(settings.withSensors === false && part.id === 'sensors')).map(part => Object.assign({}, part));
  const parameters = PARAMETERS.filter(parameter => !(settings.drive !== 'motor' && ['speed', 'withPanel'].includes(parameter.key))).map(parameter => Object.assign({provenance: 'didactic'}, parameter));
  if (settings.surface === 'rollers') parameters.push({key: 'rollerPitch', label: 'Paso de rodillos', unit: 'm', min: 0.04, max: 0.3, provenance: 'didactic'});
  if (family === 'curved') parameters.push({key: 'radius', label: 'Radio del eje', unit: 'm', min: 0.4, max: 8, provenance: 'didactic'},
    {key: 'curveAngle', label: 'Ángulo de curva', unit: '°', min: 15, max: 180, provenance: 'user'},
    {key: 'layout', label: 'Sentido', input: 'select', options: ['curveLeft', 'curveRight'], provenance: 'user'});
  if (family === 'inclined' || family === 'elevator' || settings.drive === 'gravity') parameters.push(Object.assign({key: 'rise', label: 'Diferencia de nivel', unit: 'm', provenance: 'user'}, family === 'elevator' ? {min: 0.3, max: 5} : {}));
  if (family === 'accumulation') parameters.push({key: 'zoneLength', label: 'Longitud de zona', unit: 'm', provenance: 'didactic'});
  if (['transfer', 'diverter'].includes(family)) {
    parameters.push({key: 'actuatorTime', label: 'Tiempo de actuación', unit: 's', provenance: 'didactic'});
    parts.push({id: 'mechanism', name: 'Mecanismo de transferencia', function: 'Recibe una carga, comprueba el receptor y ejecuta su secuencia antes de liberar la carga.', match: ['Transferencia', 'Elevable', 'Giratoria', 'Empujador', 'Orientable', 'Desvío', 'Actuador']});
  }
  if (family === 'elevator') {
    parts.push({id: 'mechanism', name: 'Plataforma y guías verticales', function: 'Eleva la carga entre dos niveles y confirma la posición antes de entregar.', match: ['Elevador', 'Plataforma', 'Guía vertical', 'Actuador']});
    parameters.push({key: 'verticalSpeed', label: 'Velocidad vertical', unit: 'm/s', min: 0.05, max: 2, provenance: 'didactic'});
  }
  if (settings.mechanism === 'turntable') {
    parameters.find(parameter => parameter.key === 'supportHeight').min = 0.6;
    parameters.push({key: 'turnTime', label: 'Tiempo de giro', unit: 's', min: 0.1, max: 60, provenance: 'didactic'});
  }
  if (settings.mechanism === 'merge') parameters.push({key: 'mergeAngle', label: 'Ángulo de unión', unit: '°', min: 30, max: 90, provenance: 'user'});
  if (family === 'loading') parts.find(part => part.id === 'surface').match.push('Mesa de carga', 'Superficie antideslizante');
  if (settings.loadingMode === 'manual') parameters.push({key: 'operatorAvailable', label: 'Operario disponible', input: 'boolean', provenance: 'user'},
    {key: 'operationTime', label: 'Tiempo de manipulación', unit: 's', provenance: 'didactic'});
  return Object.assign({id: settings.equipmentId, version: VERSION, family, variant, name, description, status: 'ready', prefab: 'conveyor', preset: settings,
    authoredState: family === 'straight' || family === 'curved' ? 'updated' : 'new',
    dimensions: {length: settings.length, width: settings.width, height: 1 + Math.max(0, settings.rise), units: 'm'},
    parts, components: parts.map(part => part.name), parameters,
    ports: settings.layout === 'tee' ? ['input', 'output', 'branch'] : ['input', 'output'],
    actions: settings.withPanel ? PANEL_ACTIONS : [],
    sensors: settings.withSensors ? [{id: 'entry', name: 'Presencia de entrada', type: 'presence'}, {id: 'exit', name: 'Presencia de salida', type: 'presence'}] : [],
    productProfiles: PRODUCT_PROFILES.filter(profile => settings.surface === 'chains' || variant === 'pallet-elevator' || variant === 'pallet-turntable' ? profile.id === 'pallet' : profile.id !== 'pallet'),
    simulationLevel: 'Eventos discretos y cinemática con comprobaciones geométricas; no es dinámica de cuerpos rígidos.',
    alarms: ['Salida ocupada', 'Producto incompatible', 'Emergencia'],
    provenance: {geometry: 'Modelo procedural propio en metros; mismo modelo en biblioteca, escena y visor.', parameters: 'Valores didácticos editables, sin ficha de fabricante ni certificación de capacidad.', behavior: 'Secuencia cinemática aproximada y enclavada; no conexión a un PLC real.'},
    references: REFERENCES.filter(reference => reference.id !== 'gravity-principle' || settings.drive === 'gravity')}, extra || {});
}
const EQUIPMENT = [
  definition('roller-motor', 'straight', 'Rodillos motorizados', 'Rodillos accionados, motorreductor lateral compacto, sensores y el panel original de nueve mandos.'),
  definition('belt', 'straight', 'Banda continua', 'Superficie de banda continua con retorno, tambores y accionamiento.', {surface: 'belt'}),
  definition('roller-gravity', 'straight', 'Rodillos por gravedad', 'Tramo sin motor ni panel eléctrico. La pendiente descendente o un impulso de entrada mueve la carga mediante una aproximación cinemática.', {drive: 'gravity', rise: -0.16, withPanel: false, withSensors: false, running: true}),
  definition('pallet-chain', 'straight', 'Cadenas para pallets', 'Pistas de cadenas sostienen una base con patines; admisión limitada a cargas compatibles.', {surface: 'chains', width: 1.2, maxLoad: 600}),
  definition('roller-curve', 'curved', 'Curva de rodillos', 'Rodillos radiales en una trayectoria circular continua; radio, ángulo y sentido editables.', {layout: 'curveLeft', length: 3, radius: 1.5}),
  definition('belt-curve', 'curved', 'Curva de banda', 'Banda de superficie anular continua para cambiar la dirección del flujo.', {surface: 'belt', layout: 'curveLeft', length: 3, radius: 1.5}),
  definition('modular-curve', 'curved', 'Curva de banda modular', 'Superficie modular curva con recorrido continuo y retorno.', {surface: 'modular', layout: 'curveLeft', length: 3, radius: 1.5}),
  definition('belt-incline', 'inclined', 'Banda inclinada', 'Tramo inclinado entre dos cotas. Comprueba la estabilidad de la carga y la pendiente configurada.', {surface: 'belt', rise: 0.8}),
  definition('cleated-incline', 'inclined', 'Banda inclinada con tacos', 'Tacos transversales acompañan la carga en la pendiente.', {surface: 'belt', rise: 1.2, cleats: true}),
  definition('modular-incline', 'inclined', 'Banda modular inclinada', 'Módulos de banda y apoyos adaptados a la diferencia de altura.', {surface: 'modular', rise: 0.8}),
  definition('popup-belt', 'transfer', 'Correas elevables', 'Correas transversales entre rodillos: posicionar, esperar receptor, elevar, transferir y bajar.', {layout: 'tee', mechanism: 'liftTransfer', length: 2.4, routing: 'branch'}),
  definition('popup-chain', 'transfer', 'Cadenas elevables para pallets', 'Transferencia elevable transversal para una base con patines, con receptor enclavado.', {layout: 'tee', mechanism: 'liftTransfer', surface: 'chains', length: 2.8, width: 1.2, maxLoad: 600, routing: 'branch'}),
  definition('roller-turntable', 'transfer', 'Mesa giratoria de rodillos', 'Mesa con pivote y secuencia de giro; la carga gira con la mesa antes de salir.', {layout: 'tee', mechanism: 'turntable', length: 2.4, routing: 'branch'}),
  definition('pallet-turntable', 'transfer', 'Mesa giratoria para pallets', 'Giro de una carga con patines en una plataforma dimensionada para pallets.', {layout: 'tee', mechanism: 'turntable', surface: 'chains', length: 2.8, width: 1.4, maxLoad: 600, routing: 'branch'}),
  definition('pusher', 'diverter', 'Desvío por empujador', 'Empujador lateral con carrera, espera y retorno; necesita una rama receptora libre.', {layout: 'tee', mechanism: 'pusher', length: 2.4, routing: 'alternate'}),
  definition('steer', 'diverter', 'Ruedas orientables', 'Ruedas con orientación actuada para seleccionar una salida compatible.', {layout: 'tee', mechanism: 'steer', length: 2.4, routing: 'alternate'}),
  definition('merge-angle', 'diverter', 'Unión angular coordinada', 'Dos entradas con ángulo configurable y reserva de ocupación de la zona común; no admite dos cargas simultáneas en el cruce.', {layout: 'tee', mechanism: 'merge', junctionMode: 'merge', mergeAngle: 45, length: 3.2}),
  definition('distributor', 'diverter', 'Distribuidor de rutas', 'Desvío actuado con reglas de clasificación, porcentajes o alternancia y espera de salida.', {layout: 'tee', mechanism: 'distributor', length: 2.8, routing: 'alternate'}),
  definition('roller-zones', 'accumulation', 'Acumulador de rodillos por zonas', 'Detecta cada zona y retiene la carga si la siguiente está ocupada.', {mechanism: 'zones', length: 4, zoneLength: 1}),
  definition('belt-zones', 'accumulation', 'Acumulador de banda por zonas', 'Zonas de banda independientes con retención y liberación coordinadas.', {mechanism: 'zones', surface: 'belt', length: 4, zoneLength: 1}),
  definition('box-elevator', 'elevator', 'Elevador de cajas', 'Plataforma guiada: recibir, posicionar, subir, confirmar nivel, entregar y regresar.', {mechanism: 'elevator', length: 2.4, rise: 2}),
  definition('pallet-elevator', 'elevator', 'Elevador de pallets', 'Elevador con pistas de cadenas para una carga con patines entre dos niveles.', {mechanism: 'elevator', surface: 'chains', length: 2.8, width: 1.4, maxLoad: 600, rise: 2}),
  definition('loading-table', 'loading', 'Mesa de carga y descarga', 'Puesto físico de apoyo sin transporte oculto. Las cargas se manipulan manualmente.', {mechanism: 'loading', drive: 'manual', length: 1.6, withPanel: false, withSensors: false, loadingMode: 'manual', requiresOperator: false}),
  definition('manual-station', 'loading', 'Estación con operario', 'Puesto de manipulación con disponibilidad de operario y tiempo de atención configurables.', {mechanism: 'loading', length: 1.8, loadingMode: 'manual', requiresOperator: true, operatorAvailable: false, operationTime: 2}),
  definition('automatic-station', 'loading', 'Estación automática de carga', 'Estación física de admisión y entrega coordinada; no crea productos sin una orden de simulación o un Source conectado.', {mechanism: 'loading', length: 1.8, loadingMode: 'automatic', requiresOperator: false})
];
const ALIASES = {
  'roller-start': 'roller-motor', 'roller-middle': 'roller-motor', 'roller-end': 'roller-motor',
  'belt-start': 'belt', 'belt-middle': 'belt', 'belt-end': 'belt',
  'roller-curve-left': 'roller-curve', 'roller-curve-right': 'roller-curve',
  'belt-curve-left': 'belt-curve', 'belt-curve-right': 'belt-curve',
  'roller-tee-split': 'distributor', 'belt-tee-split': 'distributor',
  'roller-tee-merge': 'merge-angle', 'belt-tee-merge': 'merge-angle'
};
function getDefinition(idOrVariant) {
  if (!idOrVariant || typeof idOrVariant !== 'string') return null;
  const variant = idOrVariant.replace(/^conveyor\./, '');
  return EQUIPMENT.find(value => value.id === idOrVariant || value.variant === variant || value.variant === ALIASES[variant]) || null;
}
function resolveVariant(value) {
  if (typeof value === 'string') return getDefinition(value);
  if (!value || typeof value !== 'object') return null;
  if (value.equipmentId) return getDefinition(value.equipmentId);
  if (value.variant) return getDefinition(value.variant);
  // Legacy objects retain their original schema and behavior. This lookup is
  // documentation only; opening a viewer never silently migrates a saved scene.
  if (value.mechanism === 'elevator') return getDefinition(value.surface === 'chains' ? 'pallet-elevator' : 'box-elevator');
  if (value.mechanism === 'zones') return getDefinition(value.surface === 'belt' ? 'belt-zones' : 'roller-zones');
  if (value.layout === 'tee') return getDefinition(value.junctionMode === 'merge' ? 'merge-angle' : 'distributor');
  if (value.layout === 'curveLeft' || value.layout === 'curveRight') return getDefinition(value.surface === 'rollers' ? 'roller-curve' : value.surface === 'modular' ? 'modular-curve' : 'belt-curve');
  return getDefinition(value.drive === 'gravity' ? 'roller-gravity' : value.surface === 'chains' ? 'pallet-chain' : value.surface === 'belt' ? 'belt' : 'roller-motor');
}
function listEquipment(options = {}) {
  return EQUIPMENT.filter(value => (!options.family || value.family === options.family) && (options.readyOnly === false || value.status === 'ready'));
}
module.exports = {VERSION, FAMILIES, EQUIPMENT, PANEL_ACTIONS, PRODUCT_PROFILES, REFERENCES, ALIASES, getDefinition, resolveVariant, listEquipment};
