/* Catalog descriptions are independent of the renderer and project storage.
 * A pending family has no placement action: a label is never a simulated machine.
 */
'use strict';

const conveyorEquipment = require('./conveyor-equipment');
const robotEquipment = require('./robot-equipment');
const vehicleEquipment = require('./vehicle-equipment');
const productEquipment = require('./product-equipment');
const sceneResources = require('./scene-resources');
const warehouseRacks = require('./warehouseRacks');
const VERSION = 1;
const STATUS = {functional: 'Funcional', visual: 'Solo visual', development: 'En desarrollo'};
const FOLDERS = [
  ['scenes', 'Escenarios'], ['models', 'Modelos 3D'], ['materials', 'Materiales'], ['images', 'Imágenes'],
  ['audio', 'Audio'], ['video', 'Vídeo'], ['interfaces', 'Interfaces'], ['missions', 'Misiones'],
  ['templates', 'Plantillas'], ['data', 'Datos']
].map(([id, name]) => ({id, name, parentId: ''}));
const CATEGORIES = [
  {id: 'industrial', name: 'Equipos industriales', children: [
    ['conveyors', 'Transportadores'], ['storage', 'Almacenamiento'], ['machines', 'Máquinas'],
    ['vehicles', 'Robots y vehículos'], ['workstations', 'Puestos de trabajo'], ['control', 'Control e instrumentación']
  ]},
  {id: 'racks', name: 'Estanterías de almacén', children: [['palletized', 'Paletización y cargas largas'], ['picking', 'Picking y pasillos elevados'], ['automated', 'Almacenamiento automático']]},
  {id: 'environment', name: 'Entorno', children: []},
  {id: 'signage', name: 'Señalización', children: []},
  {id: 'interface', name: 'Interfaz', children: []},
  {id: 'education', name: 'Recursos educativos', children: []},
  {id: 'products', name: 'Productos y cargas', children: productEquipment.PRODUCT_TYPES.map(item => [item.value, item.label])},
  {id: 'simulationtools', name: 'Herramientas de simulación', children: []},
  {id: 'files', name: 'Archivos incluidos', children: [['models', 'Modelos 3D'], ['images', 'Imágenes'], ['audio', 'Audio'], ['video', 'Vídeo'], ['source', 'Originales Blender'], ['data', 'Datos y otros']]}
];

function resource(id, name, category, description, options = {}) {
  const action = options.action || null;
  return Object.assign({
    id: 'library:' + id, version: VERSION, name, technicalName: id, category, subcategory: '',
    kind: category === 'industrial' ? 'equipment' : category === 'interface' ? 'interface' : category === 'education' ? 'mission' : 'resource',
    description, tags: [], synonyms: [], thumbnail: null, model: action && action.type === 'prefab' ? action : null,
    dependencies: [], dimensions: {units: 'm', configurable: false}, components: [], parameters: [], ports: [],
    simulation: null, interaction: [], origin: 'library', license: 'MIT · código del proyecto',
    status: action ? 'visual' : 'development', action, reason: action ? '' : 'Esta familia todavía no tiene un modelo y comportamiento compatibles. No se puede insertar como máquina funcional.'
  }, options);
}
function prefab(id, name, subcategory, description, kind, variant, options = {}) {
  return resource(id, name, 'industrial', description, Object.assign({
    subcategory, action: {type: 'prefab', kind, variant}, status: 'functional',
    thumbnail: {type: 'procedural', key: id}, simulation: kind,
    interaction: ['Ratón y teclado', 'Mandos WebXR'], tags: ['industria', 'logística', 'didáctico'],
    dimensions: {units: 'm', configurable: true}, reason: ''
  }, options));
}
const CONVEYOR_FAMILIES = conveyorEquipment.FAMILIES;
const LEGACY_CONVEYOR_IDS = {straight: 'conveyor.straight', curved: 'conveyor.curve', inclined: 'conveyor.incline', transfer: 'conveyor.transfer', diverter: 'conveyor.junction', accumulation: 'conveyor.accumulator', elevator: 'conveyor.elevator', loading: 'conveyor.loading'};
const REFERENCE_VARIANTS = {straight: 'roller-motor', curved: 'roller-curve', inclined: 'belt-incline', transfer: 'popup-belt', diverter: 'distributor', accumulation: 'roller-zones', elevator: 'box-elevator', loading: 'loading-table'};
function conveyorResources() {
  return conveyorEquipment.listEquipment({readyOnly: true}).map(definition => {
    // Existing favorite references stay attached to their reference variant.
    // Other variants have their own IDs; no instance or asset file is copied.
    const reference = definition.variant === REFERENCE_VARIANTS[definition.family];
    const id = reference && LEGACY_CONVEYOR_IDS[definition.family] || definition.id;
    const parameters = (definition.parameters || []).map(parameter => typeof parameter === 'string' ? parameter : parameter.label || parameter.name || parameter.key);
    return prefab(id, definition.name, 'conveyors', definition.description, definition.prefab || 'conveyor', definition.variant, {
      equipmentId: definition.id, equipmentVersion: definition.version, family: definition.family, variant: definition.variant,
      definition, authoredState: definition.authoredState || 'updated',
      components: (definition.parts || []).map(part => part.name),
      parameters: parameters.length ? parameters : ['Dimensiones', 'Configuración del mecanismo', 'Productos compatibles', 'Sensores', 'Conexiones'],
      ports: (definition.ports || []).map(port => typeof port === 'string' ? port : port.name || port.id),
      dimensions: Object.assign({units: 'm', configurable: true}, definition.dimensions || {}),
      productProfiles: definition.productProfiles || definition.products || [],
      provenance: definition.provenance, references: definition.references || [],
      simulation: definition.simulationLevel || 'Movimiento cinemático y lógica de eventos; no certificación física',
      synonyms: ['banda', 'cinta', 'rodillos', 'transportador', definition.family === 'curved' ? 'esquina L giro' : '', definition.family === 'diverter' ? 'T clasificar sorter merge split' : ''],
      tags: ['industria', 'logística', definition.family, definition.variant, 'didáctico']
    });
  });
}
function robotResources() {
  const legacy = {'articulated-general': 'vehicle.industrial', collaborative: 'vehicle.collaborative', amr: 'vehicle.mobile', 'cylindrical-rpp': 'vehicle.cylindrical', 'polar-rrp': 'vehicle.polar', 'mobile-manipulator': 'vehicle.mobile-manipulator', 'mobile-sorter-crossbelt': 'vehicle.sorter'};
  return robotEquipment.listEquipment({readyOnly: true}).map(definition => prefab(legacy[definition.variant] || definition.id, definition.name, 'vehicles', definition.description, 'robot', definition.variant, {
    equipmentId: definition.id, equipmentVersion: definition.version, family: definition.family, variant: definition.variant, definition,
    components: definition.components, parameters: ['Arquitectura y herramienta', 'Alcance y carga', 'Ejes y límites', 'Origen y receptor', 'Tiempo de ciclo y setup', 'Diseño de piezas', 'Acabados por pieza'],
    dimensions: Object.assign({configurable: true}, definition.dimensions), ports: ['Recogida', 'Entrega'],
    simulation: definition.simulationLevel, productProfiles: definition.productProfiles, provenance: definition.provenance, references: definition.references,
    tags: ['robot', 'robótica', 'industria', definition.family, definition.mobility], synonyms: ['robot', 'manipulador', 'robótica', definition.family, definition.variant, definition.family === 'palletizer' ? 'paletizador paletizado estibas' : '']
  }));
}
function vehicleResources() {
  const legacy = {'forklift-electric-4w': 'vehicle.forklift', 'pallet-truck-manual': 'vehicle.pallet-truck', 'transport-cart': 'vehicle.cart'};
  return vehicleEquipment.definitions.map(definition => prefab(legacy[definition.id] || 'vehicle.' + definition.id, definition.name, 'vehicles', definition.description, 'vehicle', definition.id, {
    equipmentId: 'vehicle.' + definition.id, equipmentVersion: 1, family: definition.family, variant: definition.id, definition,
    components: definition.components, parameters: ['Tipología y dimensiones', 'Carga y centro de carga', 'Elevación y mecanismos', 'Conducción manual', 'Rutas', 'Colores y desgaste'],
    dimensions: {width: definition.preset.width, length: definition.preset.length, height: definition.preset.height, units: 'm', configurable: true},
    simulation: 'Conducción y mecanismos cinemáticos, transporte de una carga identificada', references: definition.references,
    tags: ['vehículo', 'logística', definition.family], synonyms: ['montacargas', 'carretilla', definition.family, definition.id]
  }));
}
function productResources() {
  return productEquipment.listEquipment().map(definition => resource(definition.id === 'box-small' ? 'product.box' : 'product.' + definition.id, definition.name, 'products', definition.description, {
    action: {type: 'prefab', kind: 'product', variant: definition.id}, model: {type: 'prefab', kind: 'product', variant: definition.id}, thumbnail: {type: 'procedural', key: 'product.' + definition.id},
    status: 'functional', simulation: 'product', variant: definition.id, family: definition.preset.productType, subcategory: definition.preset.productType,
    components: ['Cuerpo y cierres', 'Etiqueta / SKU', 'Manipulación y clasificación'], parameters: ['Modelo', 'Ancho, alto y fondo', 'Masa total', 'Unidades', 'Tipo / calidad', 'Colores', 'Formato de pallet'],
    dimensions: {width: definition.preset.width, height: definition.preset.height, depth: definition.preset.depth, units: 'm', configurable: true},
    interaction: ['Ratón y teclado', 'Mandos WebXR', 'Equipos compatibles'], tags: ['producto', 'carga', definition.preset.productType], synonyms: [definition.id, 'producto', 'carga', definition.preset.productType], reason: ''
  }));
}
function rackResources() {
  return warehouseRacks.SYSTEMS.map(system => prefab(system.id === 'selective' ? 'storage.rack' : system.id === 'vertical-lift' ? 'storage.automatic' : 'rack.' + system.id,
    system.label, system.category, system.description, 'palletQueue', system.id, {
      category: 'racks', kind: 'equipment', family: system.mechanism, variant: system.id,
      components: ['Estructura y apoyos', 'Ubicaciones independientes', 'Panel de mando', 'Inventario y conexiones'],
      parameters: ['Módulos', 'Niveles', 'Posiciones a fondo', 'Dimensiones y holguras', 'Carga por posición y nivel', 'Referencia por calle', 'Salida y mecanismo'],
      ports: ['Entrada de cargas', 'Salida de cargas'], tags: ['almacén', 'estantería', 'rack', system.category, system.policy, system.acceptedLoad],
      synonyms: [system.id, system.acceptedLoad === 'pallet' ? 'pallets estibas montacargas' : 'cajas bandejas picking', 'almacenamiento configurable']
    }));
}
const RESOURCES = [
  ...conveyorResources(),
  ...robotResources(),
  ...vehicleResources(),
  prefab('storage.queue', 'Acumulador FIFO', 'storage', 'Cola temporal con capacidad limitada, recepción de equipos y despacho manual o automático. Sin generación automática al insertarla.', 'source', 'queue', {ports: ['Entrada', 'Salida'], components: ['Superficie de carga', 'Soportes', 'Panel HMI'], parameters: ['Capacidad', 'Modo de despacho', 'Conexiones']}),
  prefab('storage.pallet', 'Almacén con estibas', 'storage', 'Almacenamiento temporal independiente con apilado visible, capacidad, retirada de la carga superior y despacho automático o manual.', 'palletQueue', undefined, {ports: ['Entrada', 'Salida'], components: ['Estiba', 'Cargas apiladas', 'Panel HMI'], parameters: ['Filas', 'Columnas', 'Capas', 'Capacidad', 'Conexiones'], synonyms: ['pallet queue', 'estibas', 'suelo', 'almacén']}),
  ...rackResources(),
  resource('storage.dispenser', 'Dispensador de pallets', 'industrial', 'Separación y entrega controlada de estibas vacías.', {subcategory: 'storage'}),
  prefab('source.generator', 'Generador de productos', '', 'Función lógica Source con catálogo de hasta ocho tipos, dimensiones y calidad, generación individual o en pallets, cola limitada y conexiones de flujo. Su representación de trabajo no es una estación de alimentación industrial certificada.', 'source', undefined, {category: 'simulationtools', kind: 'simulationtool', ports: ['Entrada', 'Salida'], components: ['Representación de cola', 'Generación lógica', 'Panel HMI'], parameters: ['Catálogo', 'Intervalo', 'Límite', 'Capacidad', 'Tamaño', 'Calidad', 'Conexiones'], synonyms: ['source', 'generador', 'productos', 'origen']}),
  prefab('processor.process', 'Máquina de proceso', 'machines', 'Modelo didáctico de proceso por tiempos. Setup, capacidad paralela, operario, bloqueo y utilización independientes por instancia.', 'processor', undefined, {ports: ['Entrada', 'Salida'], components: ['Cámara de proceso', 'Soportes', 'Panel HMI'], parameters: ['Tiempo de proceso', 'Setup', 'Capacidad', 'Operario', 'Conexiones'], synonyms: ['processor', 'proceso', 'maquina']}),
  prefab('processor.combine', 'Combinador', 'machines', 'Agrupa varias cargas en una salida conservando unidades y procedencia. No representa un robot o mecanismo físico de ensamble.', 'processor', 'combiner', {ports: ['Entrada', 'Salida'], components: ['Cámara de proceso', 'Panel HMI'], parameters: ['Entradas por ciclo', 'Tiempo', 'Setup', 'Capacidad'], synonyms: ['combiner', 'ensamble', 'combinar']}),
  prefab('processor.separate', 'Separador', 'machines', 'Divide lotes conservando sus unidades y procedencia, con capacidad y tiempos propios.', 'processor', 'separator', {ports: ['Entrada', 'Salida'], components: ['Cámara de proceso', 'Panel HMI'], parameters: ['Salidas por lote', 'Tiempo', 'Setup', 'Capacidad'], synonyms: ['separator', 'separar', 'dividir']}),
  ...[['filler', 'Llenadora / dosificadora'], ['packer', 'Empacadora / selladora'], ['labeler', 'Etiquetadora'], ['palletizer', 'Paletizadora']].map(([id, name]) => resource('machine.' + id, name, 'industrial', 'Familia con mecánica y comportamiento propios pendientes de implementación.', {subcategory: 'machines'})),
  resource('workstation.table', 'Mesa de trabajo', 'industrial', 'Puesto de trabajo independiente con dimensiones y apoyos propios.', {subcategory: 'workstations'}),
  prefab('control.sensor', 'Sensor de presencia', 'control', 'Detector configurable enlazado a un transportador de la escena. Estado visual y eventos de detección.', 'sensor', undefined, {components: ['Detector', 'Soporte'], parameters: ['Equipo', 'Posición de detección'], synonyms: ['fotocélula', 'sensor', 'detector']}),
  prefab('control.panel', 'Controlador / panel', 'control', 'Panel de mando HMI con encendido, marcha, pausa, parada, emergencia y velocidad. Selecciona explícitamente el equipo o alcance controlado.', 'plc', undefined, {components: ['Gabinete', 'Botones', 'HMI', 'Soporte'], parameters: ['Equipo controlado', 'Alcance'], synonyms: ['plc', 'hmi', 'botones', 'panel', 'controlador']}),
  resource('environment.floor', 'Suelo', 'environment', 'Plano visual editable. Añade los componentes de colisión o teletransporte según el uso.', {action: {type: 'primitive', kind: 'plane'}, status: 'visual', thumbnail: {type: 'procedural', key: 'environment.floor'}, dimensions: {units: 'm', configurable: true}, components: ['Malla'], parameters: ['Escala', 'Material', 'Color'], reason: ''}),
  resource('environment.block', 'Bloque', 'environment', 'Geometría básica para construir paredes, soportes y elementos visuales.', {action: {type: 'primitive', kind: 'box'}, status: 'visual', thumbnail: {type: 'procedural', key: 'environment.block'}, dimensions: {units: 'm', configurable: true}, components: ['Malla'], parameters: ['Escala', 'Material', 'Color'], reason: ''}),
  resource('signage.decal', 'Decal', 'signage', 'Proyecta una imagen o desgaste sobre una superficie. Elige la imagen y apunta al suelo, pared o equipo.', {action: {type: 'decal'}, status: 'functional', components: ['Proyector de decal'], parameters: ['Imagen', 'Tamaño', 'Opacidad', 'Desgaste'], interaction: ['Colocación en superficie'], reason: '', synonyms: ['flecha', 'marca', 'etiqueta', 'pintura', 'desgaste']}),
  resource('widget.lineMonitor', 'Monitor de producción', 'interface', 'Pantalla 3D con plano, analítica y controles de producción. Al insertarla puedes vincularla al equipo seleccionado o elegir otro equipo y el alcance de toda la línea, un tramo o un solo módulo.', {
    action: {type: 'studio', method: 'addLineMonitor'}, kind: 'interface', status: 'functional', reason: '', thumbnail: {type: 'procedural', key: 'widget.lineMonitor'},
    components: ['Pantalla 3D', 'Monitor de línea', 'Vínculo al equipo'], parameters: ['Equipo', 'Alcance', 'Título', 'Posición', 'Escala'], dimensions: {width: 3, height: 1.6875, depth: .09, units: 'm', configurable: true},
    simulation: 'Plano y datos reales de la línea conectada', interaction: ['Puntero', 'Mandos WebXR'], synonyms: ['monitor', 'pantalla', 'dashboard', 'analítica', 'widget', 'hmi', 'plano']
  }),
  ...[['text', 'Texto'], ['counter', 'Contador'], ['indicator', 'Indicador'], ['progress', 'Barra de progreso'], ['button', 'Botón']].map(([kind, name]) => resource('interface.' + kind, name, 'interface', 'Widget configurable vinculado a una variable o acción real. Presentación en escritorio, mundo 3D o ambos; la representación 3D conserva su uso en WebXR.', {
    action: {type: 'widget', kind}, status: 'functional', reason: '', components: ['Widget', 'Vínculo de datos'], parameters: ['Texto', 'Objeto', 'Variable', 'Acción', 'Presentación', 'Posición', 'Color'], simulation: 'Vínculo con las variables del equipo seleccionado', interaction: ['Escritorio', 'Mundo 3D / WebXR'], synonyms: [kind, 'interfaz', 'hmi', 'widget']
  })),
  resource('education.mission', 'Objetivo de misión', 'education', 'Misión con pasos y condiciones basados en eventos reales de la simulación. Permite progreso individual persistente cuando hay una cuenta iniciada.', {action: {type: 'studio', method: 'addMission'}, status: 'functional', reason: '', components: ['Misión', 'Pasos', 'Condiciones de evaluación'], parameters: ['Objetivo', 'Eventos', 'Equipo', 'Cantidad', 'Ayuda', 'Inicio', 'Fallo'], simulation: 'Eventos de salida confirmados', synonyms: ['misión', 'objetivo', 'evaluación', 'instrucción']}),
  ...productResources()
];

function folded(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase(); }
function defaultFolder(kind) { return ({model: 'models', image: 'images', audio: 'audio', video: 'video', material: 'materials', scene: 'scenes', template: 'templates', interface: 'interfaces', mission: 'missions'})[kind] || 'data'; }
function assetResource(entry) {
  const project = Boolean(entry.importId || entry.id);
  return {
    id: 'asset:' + (entry.importId || entry.id || entry.path), version: VERSION, name: entry.name, technicalName: entry.path,
    category: 'files', subcategory: entry.kind === 'source' ? 'source' : defaultFolder(entry.kind),
    tags: [entry.extension, entry.kind], synonyms: [], description: entry.kind === 'source' ? 'Original de Blender. Conserva su archivo fuente y utiliza el GLB exportado para colocarlo en WebXR.' : 'Archivo ' + String(entry.extension || entry.kind).toUpperCase() + (project ? ' importado en este proyecto.' : ' incluido en la aplicación.'),
    thumbnail: entry.thumbnailPath || null, model: entry.kind === 'model' ? {path: entry.path, importId: entry.importId} : null,
    dependencies: [], dimensions: {units: 'Unidades del recurso original', configurable: false}, components: [], parameters: [], ports: [], simulation: null,
    interaction: [], origin: project ? 'project' : 'library', license: project ? 'Aportado por el proyecto; comprobar licencia del original' : 'Conservar atribución y licencia del recurso original',
    status: 'visual', reason: '', asset: entry, action: ['model', 'image'].includes(entry.kind) ? {type: 'asset', entry} : null,
    folderId: defaultFolder(entry.kind), kind: entry.kind
  };
}
function projectResources(templates = [], scenes = [], widgets = [], missions = []) {
  return templates.map(template => ({
    id: 'template:' + template.id, version: template.version || VERSION, name: template.name, technicalName: template.id,
    origin: 'project', kind: 'template', status: 'functional', category: 'templates', tags: ['plantilla'], synonyms: [],
    description: 'Plantilla reutilizable de ' + (template.objects || []).length + ' objetos. Colocarla crea instancias independientes.',
    folderId: 'templates', components: [], parameters: [], ports: [], dependencies: [], dimensions: {units: 'm'},
    interaction: [], license: 'Proyecto', action: {type: 'template', template}
  })).concat(scenes.map(scene => ({
    id: 'scene:' + scene.id, version: VERSION, name: scene.name, technicalName: scene.id, origin: 'project', kind: 'scene',
    status: 'functional', category: 'scenes', folderId: 'scenes', tags: ['escenario', 'sala'], synonyms: [],
    description: 'Escenario del proyecto. Abrir conserva sus objetos y configuración.', components: [], parameters: [], ports: [], dependencies: [], dimensions: {units: 'm'}, interaction: [], license: 'Proyecto',
    action: {type: 'scene', roomId: scene.id}
  }))).concat(widgets.map(widget => ({
    id: 'widget:' + widget.id, version: VERSION, name: widget.name, technicalName: widget.id, origin: 'project', kind: 'interface',
    status: 'functional', category: 'interface', folderId: 'interfaces', tags: [widget.kind, 'widget', 'interfaz'], synonyms: [],
    description: 'Widget ' + widget.kind + ' del escenario ' + widget.roomId + '. Edita su fuente de datos, apariencia y representación en Interfaz.',
    components: ['Widget', 'Vínculo de datos'], parameters: ['Texto', 'Variable', 'Objeto', 'Presentación'], ports: [], dependencies: [], dimensions: {units: 'm'}, interaction: ['Mundo 3D', 'Escritorio'], license: 'Proyecto',
    action: {type: 'workspace', workspace: 'interface'}
  })), missions.map(mission => ({
    id: 'mission:' + mission.id, version: VERSION, name: mission.name, technicalName: mission.id, origin: 'project', kind: 'mission',
    status: 'functional', category: 'education', folderId: 'missions', tags: ['misión', 'objetivo', 'evaluación'], synonyms: [],
    description: 'Misión del escenario ' + mission.roomId + '. Sus pasos se evalúan con eventos reales del simulador.',
    components: ['Misión', 'Pasos'], parameters: ['Condiciones', 'Objetivo', 'Ayuda'], ports: [], dependencies: [], dimensions: {units: 'm'}, interaction: [], license: 'Proyecto',
    action: {type: 'workspace', workspace: 'logic'}
  }))).map(item => Object.assign({thumbnail: null, model: null, simulation: null, reason: ''}, item));
}
function normalizeOrganization(value) {
  value = value && typeof value === 'object' ? value : {};
  const ids = new Set(), folders = [];
  (Array.isArray(value.folders) ? value.folders : []).slice(0, 200).forEach(folder => {
    if (!folder || typeof folder.id !== 'string' || !folder.id || ids.has(folder.id) || typeof folder.name !== 'string' || !folder.name.trim()) return;
    ids.add(folder.id); folders.push({id: folder.id.slice(0, 400), name: folder.name.trim().slice(0, 160), parentId: typeof folder.parentId === 'string' ? folder.parentId.slice(0, 400) : ''});
  });
  const resourceIds = new Set(), resources = [];
  (Array.isArray(value.resources) ? value.resources : []).slice(0, 10000).forEach(row => {
    if (!row || typeof row.id !== 'string' || !row.id || resourceIds.has(row.id)) return;
    resourceIds.add(row.id);
    resources.push({id: row.id.slice(0, 1200), name: typeof row.name === 'string' ? row.name.slice(0, 160) : '', folderId: typeof row.folderId === 'string' ? row.folderId.slice(0, 400) : ''});
  });
  return {folders, resources, favorites: Array.from(new Set((Array.isArray(value.favorites) ? value.favorites : []).filter(id => typeof id === 'string' && id.length <= 1200))).slice(0, 2000)};
}
function foldersFor(organization) {
  const result = FOLDERS.map(folder => Object.assign({}, folder));
  organization.folders.forEach(folder => {
    const found = result.find(item => item.id === folder.id);
    if (found) Object.assign(found, folder); else result.push(Object.assign({}, folder));
  });
  return result;
}
function applyOrganization(resources, organization) {
  const entries = new Map(organization.resources.map(row => [row.id, row]));
  return resources.map(resource => {
    const entry = entries.get(resource.id);
    return entry ? Object.assign({}, resource, {name: entry.name || resource.name, folderId: entry.folderId || resource.folderId}) : resource;
  });
}
function matches(resource, query) {
  const haystack = folded([resource.name, resource.technicalName, resource.description].concat(resource.tags || [], resource.synonyms || []).join(' '));
  return folded(query).split(/\s+/).filter(Boolean).every(term => haystack.includes(term));
}
function folderContains(folderId, resourceFolderId, folders) {
  if (!folderId) return true;
  const visited = new Set();
  let current = resourceFolderId;
  while (current && !visited.has(current)) {
    if (current === folderId) return true;
    visited.add(current);
    const parent = folders.find(folder => folder.id === current);
    current = parent && parent.parentId;
  }
  return false;
}

module.exports = {VERSION, STATUS, FOLDERS, CATEGORIES, CONVEYOR_FAMILIES, ROBOT_FAMILIES: robotEquipment.FAMILIES, VEHICLE_FAMILIES: vehicleEquipment.families,
  MOBILITY_FAMILIES: robotEquipment.FAMILIES.concat(vehicleEquipment.families), PRODUCT_TYPES: productEquipment.PRODUCT_TYPES,
  RESOURCES, conveyorResources, robotResources, vehicleResources, productResources, rackResources, assetResource, projectResources, normalizeOrganization, foldersFor, applyOrganization, matches, folderContains, defaultFolder, sceneResources};
