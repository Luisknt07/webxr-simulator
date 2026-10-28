import * as THREE from 'three';
import behaviorSchema from '../../shared/behaviors.js';
import DynamicDisplayResolution from './DynamicDisplayResolution.js';

const WIDTH = 1024, HEIGHT = 576, PAGE_SIZE = 10, PREVIEW_LIMIT = 4, PREVIEW_TRIANGLES = 10000;
const MAP = {x: 20, y: 116, width: 660, height: 364, right: 680, bottom: 480};
const MACHINE_TYPES = ['conveyor', 'source', 'processor', 'palletQueue', 'robot', 'vehicle'];
const COLORS = {background: '#101e29', card: '#192d3c', text: '#ecf5fb', dim: '#a1b5c4', cyan: '#55d7f2', green: '#43d69b', amber: '#f2be55', red: '#f16b75'};
const COMMANDS = [['start', 'MARCHA'], ['stop', 'PARAR'], ['pause', 'PAUSA'], ['powerOn', 'ENCENDER'], ['powerOff', 'APAGAR'],
  ['emergency', 'EMERGENCIA'], ['resetEmergency', 'REARMAR'], ['speedDown', '− VELOCIDAD'], ['speedUp', '+ VELOCIDAD']];
let nextMonitor = 0;
function visible(object) { for (let node = object; node; node = node.parent) if (!node.visible) return false; return true; }
function number(value) { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
function short(value, length = 46) { const text = String(value === undefined ? '—' : value); return text.length > length ? text.slice(0, length - 1) + '…' : text; }
function valueText(value) { return typeof value === 'boolean' ? value ? 'Sí' : 'No' : typeof value === 'number' ? Number.isInteger(value) ? String(value) : value.toFixed(2) : short(value && typeof value === 'object' ? JSON.stringify(value) : value, 66); }
function rawBehaviors(document, object) { return object.userData.editorBehaviors || object.userData.editorDefaultBehaviors || document.getBehaviors(object); }
function machineConfig(document, object) { return rawBehaviors(document, object).find(value => MACHINE_TYPES.includes(value.type)); }
function destinations(config) {
  const result = [config.outputId, config.branchId].filter(Boolean);
  if (config.type === 'robot' && behaviorSchema.robots && behaviorSchema.robots.parseDestinationRules) behaviorSchema.robots.parseDestinationRules(config).forEach(rule => result.push(rule.outputId));
  return Array.from(new Set(result));
}
function equipmentCommands(selected) {
  if (!selected) return [];
  const config = selected.config;
  if (config.type === 'source') return [['generate', 'GENERAR'], ['dispatch', 'DESPACHAR'], ['clearQueue', 'VACIAR COLA']];
  if (config.type === 'processor') return (config.requiresOperator ? [['operator', 'OPERARIO']] : []).concat(config.delivery === 'manual' ? [['dispatch', 'DESPACHAR']] : []);
  if (config.type === 'robot') return (config.mode === 'manual' ? [['cycle', 'SOLICITAR CICLO']] : []).concat([['home', 'VOLVER A ORIGEN']]);
  if (config.type === 'vehicle') return (['tow', 'cart'].includes(config.family) ? [['couple', 'ENGANCHAR'], ['uncouple', 'DESENGANCHAR']] : [['pickup', 'TOMAR CARGA'], ['release', 'DEPOSITAR']]).concat([['parkingBrake', 'FRENO P'], ['lights', 'LUCES'], ['horn', 'BOCINA']]);
  if (config.type === 'conveyor' && config.mechanism === 'loading' && config.drive !== 'manual') return (
    (config.requiresOperator ? [['operator', 'OPERARIO']] : []).concat(config.loadingMode === 'manual' ? [['dispatch', 'SOLICITAR CICLO']] : []));
  if (config.type === 'palletQueue') return (number(selected.variables.completePallets) > 0 ? [['dispatchPallet', 'RETIRAR ESTIBA COMPLETA']] : []).concat(config.outputId ? [['dispatch', 'DESPACHAR']] : []);
  return [];
}
function stateColor(variables, editing) { return editing ? COLORS.cyan : variables.emergency ? COLORS.red : variables.paused || variables.blocked || variables.transferBlocked || variables.full ? COLORS.amber : variables.powered === false || variables.running === false || variables.enabled === false ? COLORS.dim : COLORS.green; }
function helper(object) { Object.assign(object.userData, {editorRuntimeHelper: true, editorHelper: true, editorNonCollidable: true}); return object; }
function corners(bounds, matrix) {
  const points = [];
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) points.push(new THREE.Vector3(x, y, z).applyMatrix4(matrix));
  return points;
}
function hull(points) {
  const sorted = points.slice().sort((a, b) => a.x - b.x || a.z - b.z), cross = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  if (sorted.length < 3) return sorted;
  const half = values => { const result = []; values.forEach(point => { while (result.length > 1 && cross(result[result.length - 2], result[result.length - 1], point) <= 1e-9) result.pop(); result.push(point); }); return result; };
  return half(sorted).slice(0, -1).concat(half(sorted.slice().reverse()).slice(0, -1));
}
function footprint(object) {
  const points = []; let count = 0; object.updateWorldMatrix(true, true);
  object.traverse(node => {
    if (!node.geometry || !visible(node) || node.userData.editorHelper || node.userData.editorRuntimeHelper || count++ >= 160) return;
    if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
    if (node.geometry.boundingBox && !node.geometry.boundingBox.isEmpty()) points.push(...corners(node.geometry.boundingBox, node.matrixWorld));
  });
  return hull(points);
}
function productOutline(product, type) {
  if (!['drum', 'bottle'].includes(type)) return hull(corners(product.bounds, product.object.matrixWorld));
  const bounds = product.bounds, center = bounds.getCenter(new THREE.Vector3()), radius = bounds.getSize(new THREE.Vector3()).multiplyScalar(.5), points = [];
  for (const y of [bounds.min.y, bounds.max.y]) for (let index = 0; index < 32; index++) {
    const angle = index * Math.PI / 16; points.push(new THREE.Vector3(center.x + Math.cos(angle) * radius.x, y, center.z + Math.sin(angle) * radius.z).applyMatrix4(product.object.matrixWorld));
  }
  return hull(points);
}
function duration(value) { const seconds = Math.max(0, number(value)); return seconds >= 60 ? (seconds / 60).toFixed(1) + ' min' : seconds.toFixed(seconds > 0 && seconds < 1 ? 2 : 1) + ' s'; }
function stateName(value) {
  return {busy: 'Trabajo útil', idle: 'Ocio / espera', setup: 'Preparación', blocked: 'Bloqueada', down: 'Apagada / detenida', paused: 'Pausa',
    queued: 'En cola', processing: 'En proceso', available: 'Disponible', stored: 'Almacenada', held: 'En mano',
    input: 'Entrada', output: 'Salida', transport: 'En transporte', waiting: 'En espera', receive: 'Recepción', actuating: 'Actuación', transfer: 'En transferencia'}[String(value).toLowerCase()] || value;
}
function machineName(config) {
  const definition = config.type === 'conveyor' ? behaviorSchema.conveyorEquipment.resolveVariant(config) :
    config.type === 'robot' ? behaviorSchema.robotEquipment && behaviorSchema.robotEquipment.resolveVariant(config) : config.type === 'vehicle' && behaviorSchema.vehicleEquipment && behaviorSchema.vehicleEquipment.getDefinition(config.variant);
  return definition ? definition.name : config.type === 'source' ? 'Generador / cola FIFO' : config.type === 'processor' ?
    {combiner: 'Combinador', separator: 'Separador', processor: 'Procesador'}[config.mode] || 'Procesador' : config.type === 'palletQueue' ? 'Almacén temporal de estibas' : config.type;
}
function inside(point, polygon) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.z > point.z) !== (b.z > point.z) && point.x < (b.x - a.x) * (point.z - a.z) / (b.z - a.z) + a.x) result = !result;
  }
  return result;
}
function operation(config) {
  if (config.type === 'vehicle') return 'Conducción manual o ruta configurada con aceleración, dirección, frenado y mecanismos de carga. La entrada de horquillas necesita alineación y una carga compatible. Capacidad nominal didáctica ' + config.payloadKg + ' kg; consulta la capacidad efectiva al elevar o extender. No sustituye una tabla de carga certificada.';
  if (config.type === 'robot') {
    const task = {'pick-place': 'Recoge una carga existente y la deposita en el receptor.', process: 'Aproxima la boquilla, opera sobre la carga en su estación y se retira sin transportarla.',
      palletize: 'Recoge cajas y entrega al almacén, que gobierna el patrón y las capas.', transport: 'Transporta una carga entre estaciones por la ruta configurada.'}[config.operation];
    return (task || 'Ejecuta su secuencia cinemática.') + ' Ciclo mínimo ' + config.cycleTime + ' s; preparación ' + config.setupTime + ' s. ' +
      (config.mode === 'manual' ? 'El panel solicita cada ciclo.' : 'Inicia ciclos automáticamente mientras haya carga.') +
      ' Comprueba alcance, masa declarada y disponibilidad del destino. Una parada conserva la carga. No simula fuerzas ni navegación SLAM.';
  }
  if (config.type === 'source') return 'Genera cargas cada ' + config.interval + ' s y conserva una cola limitada a ' + config.capacity + '. Salida ' + (config.delivery === 'automatic' ? 'automática hacia un receptor disponible.' : 'manual: recoger o despachar la próxima carga.');
  if (config.type === 'processor') return (config.mode === 'combiner' ? 'Combina entradas en una carga.' : config.mode === 'separator' ? 'Separa una carga en varias salidas.' : 'Procesa cada carga aceptada.') + ' Ciclo ' + config.processTime + ' s; setup ' + config.setupTime + ' s. ' + (config.requiresOperator ? 'Requiere un operario disponible.' : 'No requiere operario.') + ' Una salida ocupada conserva la carga.';
  if (config.type === 'palletQueue') return 'Almacena hasta ' + config.capacity + ' cargas en ' + config.palletCapacity + ' estibas. Conserva la identidad de cada carga. El retiro manual respeta las cajas superiores; la salida automática espera al receptor.';
  const mechanism = {zones: 'Acumula por zonas y retiene cuando la siguiente está ocupada.', liftTransfer: 'Centra, eleva y transfiere sólo cuando el receptor está disponible.', turntable: 'Centra la carga, gira la mesa y confirma la salida.', pusher: 'El empujador desvía la carga y vuelve a su posición inicial.', steer: 'Orienta las ruedas hacia la salida seleccionada.', distributor: 'Clasifica mediante reglas y confirma el receptor antes de liberar.', merge: 'Reserva el cruce para unir entradas sin superponer cargas.', elevator: 'Recibe, eleva, entrega y regresa al nivel de entrada.', loading: 'Puesto de carga temporizado con liberación según su modo de operación.'}[config.mechanism];
  return (mechanism || 'Transporta sobre la trayectoria y superficie configuradas.') + (config.drive === 'gravity' ? ' Movimiento cinemático por pendiente e impulso de entrada.' : ' Consigna ' + config.speed + ' m/s.') + ' Los sensores de presencia detectan ocupación; no miden calidad real.';
}
function partDescription(name) {
  const descriptions = [
    [/bastidor|soporte|apoyo|pedestal/i, 'Estructura portante y apoyo nivelable del equipo.'],
    [/rodillo|cinta|banda/i, 'Superficie de apoyo y transporte de las cargas.'],
    [/motor|reductor|transmisión/i, 'Accionamiento que transmite el movimiento al transporte.'],
    [/sensor|célula|baliza/i, 'Detección de presencia o señalización del estado simulado.'],
    [/panel|armario/i, 'Protege los mandos y presenta los indicadores del equipo.'],
    [/cabezal|actuador|carro/i, 'Mecanismo móvil asociado al ciclo o a la transferencia.'],
    [/estiba|pallet|bahía/i, 'Posición física de almacenamiento; el retiro respeta el apoyo de las cargas.'],
    [/celda|proceso/i, 'Zona de trabajo que recibe, procesa y entrega las cargas.']
  ];
  const match = descriptions.find(([pattern]) => pattern.test(name)); return match ? match[1] : 'Componente presente en el modelo editable.';
}

function equipmentParts(selected) {
  if (selected.config.type === 'vehicle' && behaviorSchema.vehicleEquipment) {
    const definition = behaviorSchema.vehicleEquipment.getDefinition(selected.config.variant);
    if (definition) return definition.components.map((name, index) => ({id: 'vehicle-part-' + index, name, match: [name], function: partDescription(name)}));
  }
  const registry = selected.config.type === 'robot' ? behaviorSchema.robotEquipment : behaviorSchema.conveyorEquipment;
  const definition = ['conveyor', 'robot'].includes(selected.config.type) && registry && registry.resolveVariant(selected.config);
  if (definition) return definition.parts.filter(part => {
    let found = false; selected.object.traverse(node => { if (visible(node) && !node.userData.editorRuntimeHelper && (part.match || []).some(match => (node.name || '').toLowerCase().includes(match.toLowerCase()))) found = true; }); return found;
  });
  const names = new Set(); selected.object.traverse(node => { if (visible(node) && node.name && node.children.length && !node.userData.editorRuntimeHelper && node !== selected.object && !node.userData.editorPrefabKey) names.add(node.name); });
  return Array.from(names).slice(0, 100).map((name, index) => ({id: 'part-' + index, name, match: [name], function: partDescription(name)}));
}

// A shaded projection of the actual instance, not a catalogue thumbnail. It
// shares no GPU scene/material and cannot disturb the active WebXR renderer.
function previewMeshes(object) {
  const meshes = []; object.updateWorldMatrix(true, true);
  const inverse = new THREE.Matrix4().getInverse(object.matrixWorld), scale = new THREE.Matrix4().makeScale(object.scale.x, object.scale.y, object.scale.z);
  object.traverse(mesh => {
    const geometry = mesh.geometry, position = geometry && geometry.attributes && geometry.attributes.position;
    if (!mesh.isMesh || !position || !visible(mesh) || mesh.userData.editorHelper || mesh.userData.industrialSensorVolume || meshes.length >= 400) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (!materials.some(material => material && material.visible !== false && (material.opacity === undefined || material.opacity >= .2))) return;
    const names = []; for (let parent = mesh; parent && parent !== object; parent = parent.parent) if (parent.name) names.push(parent.name.toLowerCase());
    meshes.push({mesh, geometry, position, materials, names: names.join(' / '), matrix: new THREE.Matrix4().multiplyMatrices(scale, inverse).multiply(mesh.matrixWorld),
      count: Math.floor((geometry.index ? geometry.index.count : position.count) / 3)});
  }); return meshes;
}

function previewModel(meshes, parts, turn = 0) {
  const bounds = new THREE.Box3(), partBounds = parts.map(() => new THREE.Box3()), faces = [];
  // Back-face removal keeps all faces of the included industrial catalogue
  // intact; exceptionally dense replacements receive a bounded preview only.
  const count = meshes.reduce((sum, value) => sum + value.count, 0), step = Math.max(1, Math.ceil(count / (PREVIEW_TRIANGLES * 2))); let ordinal = 0;
  const light = new THREE.Vector3(-.4, 1, 1.7).normalize(), camera = new THREE.Vector3(1, 1.1, 1).normalize();
  const project = point => ({x: (point.x - point.z) * .7071, y: (point.x + point.z) * .3536 - point.y * .866, depth: point.dot(camera)});
  meshes.forEach(entry => {
    const {geometry, position, materials} = entry, matrix = new THREE.Matrix4().makeRotationY(turn * Math.PI / 2).multiply(entry.matrix);
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const box = geometry.boundingBox.clone().applyMatrix4(matrix); bounds.union(box);
    const matches = parts.map(part => (part.match || []).some(match => entry.names.includes(match.toLowerCase())));
    matches.forEach((matched, index) => { if (matched) partBounds[index].union(box); });
    for (let face = 0; face < entry.count; face++, ordinal++) {
      if (ordinal % step || faces.length >= PREVIEW_TRIANGLES) continue;
      const start = face * 3, group = (geometry.groups || []).find(group => start >= group.start && start < group.start + group.count), material = materials[group ? group.materialIndex : 0] || materials[0];
      if (!material || material.visible === false || material.opacity < .2) continue;
      const vertices = [0, 1, 2].map(index => new THREE.Vector3().fromBufferAttribute(position, geometry.index ? geometry.index.array[start + index] : start + index).applyMatrix4(matrix));
      const normal = new THREE.Vector3().crossVectors(vertices[1].clone().sub(vertices[0]), vertices[2].clone().sub(vertices[0])).normalize();
      if (material.side !== THREE.DoubleSide && normal.dot(camera) < 0) continue;
      const color = material.color ? material.color.clone() : new THREE.Color('#82929d'), shade = .42 + .58 * Math.max(0, normal.dot(light));
      color.multiplyScalar(shade); if (material.emissive) color.add(material.emissive.clone().multiplyScalar(.35));
      const points = vertices.map(project);
      faces.push({points, depth: points.reduce((sum, point) => sum + point.depth, 0) / 3, color: '#' + color.getHexString(), part: matches.findIndex(Boolean)});
    }
  });
  if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 1, 1));
  const projected = corners(bounds, new THREE.Matrix4()).map(project), xs = projected.map(point => point.x), ys = projected.map(point => point.y);
  return {faces: faces.sort((a, b) => a.depth - b.depth), parts: parts.map((part, index) => Object.assign({}, part, {point: partBounds[index].isEmpty() ? null : project(partBounds[index].getCenter(new THREE.Vector3()))})),
    triangleCount: faces.length, sourceTriangles: count, meshCount: meshes.length, bounds: {minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys)}};
}

/** World-space, ray-operated HMI. Simulation remains the sole source of machine
 * state; canvases, hit regions and render resources never enter the document. */
export default class LineMonitorSystem {
  constructor(ctx, document, simulation) {
    this.ctx = ctx; this.document = document; this.simulation = simulation;
    this.entries = new Map(); this.roomId = null;
    this.inventory = []; this.inventoryStamp = []; this.inventoryDirty = true; this.scanElapsed = 1;
    this.prefix = 'industrial-line-monitor-' + (++nextMonitor) + '-';
    this.previewCache = new Map(); this.stats = {draws: 0, previewBuilds: 0};
    this.displayResolution = new DynamicDisplayResolution(ctx, WIDTH, HEIGHT);
  }

  invalidate() { this.inventoryDirty = true; this.entries.forEach(entry => { entry.dirty = true; }); }

  targetId(entry) { return !entry.config.targetId || entry.config.targetId === 'self' ? entry.owner.userData.editorId : entry.config.targetId; }

  owners(roomId, delta) {
    this.scanElapsed += Math.max(0, number(delta));
    const history = this.document.undoStack || [], redo = this.document.redoStack || [];
    const stamp = [this.document.objects && this.document.objects.size, history[history.length - 1], redo[redo.length - 1], this.document.loadGeneration];
    if (this.inventoryDirty || stamp.some((value, index) => value !== this.inventoryStamp[index]) || !this.document.objects && this.scanElapsed >= .25) {
      this.inventory = this.document.getObjects(roomId).filter(owner => rawBehaviors(this.document, owner).some(value => value.type === 'lineMonitor'));
      this.inventoryStamp = stamp; this.inventoryDirty = false; this.scanElapsed = 0;
    }
    return this.inventory;
  }

  create(owner, config) {
    const dom = this.ctx.document || (typeof document !== 'undefined' ? document : null);
    if (!dom || !dom.createElement) return null;
    const canvas = dom.createElement('canvas'); canvas.width = 256; canvas.height = 144;
    const drawing = canvas.getContext && canvas.getContext('2d'); if (!drawing) return null;
    const texture = new THREE.CanvasTexture(canvas); texture.encoding = THREE.sRGBEncoding;
    texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter; texture.generateMipmaps = false;
    const material = new THREE.MeshBasicMaterial({map: texture, toneMapped: false});
    const geometry = new THREE.PlaneBufferGeometry(.98, .98);
    const plane = helper(new THREE.Mesh(geometry, material));
    plane.name = 'Monitor de línea · pantalla privada'; plane.position.z = .516; owner.add(plane);
    const backPlane = helper(new THREE.Mesh(geometry, material));
    backPlane.name = 'Monitor de línea · pantalla posterior'; backPlane.position.z = -.516; backPlane.rotation.y = Math.PI; owner.add(backPlane);
    // Each outward-facing plane uses the same unmodified UVs. Rotating the rear
    // geometry preserves readable text and identical button coordinates there.
    const entry = {owner, config, canvas, drawing, texture, plane, backPlane, planes: [plane, backPlane], selectedId: config.targetId, page: 'diagram', detailPage: 0, eventPage: 0, analysisPage: 0, equipmentPage: 0, equipmentOffset: 0,
      moduleOnly: false, focused: false, selectedProductId: null, previewPart: '', preview: null, regions: [], presses: new Map(), dirty: true, elapsed: 0, editing: true, active: false, notice: '', signature: '', model: null};
    const state = {colliderMesh: entry.planes, controller: 'both', raycaster: true, consumeSelect: true, mergeSelection: true, captureSelect: true,
      isSelectable: (hit, controller) => this.valid(entry, hit, controller),
      onSelectStart: (hit, controller) => this.press(entry, hit, controller),
      onSelectEnd: (hit, controller) => this.release(entry, controller),
      onSelectCancel: (hit, controller) => this.release(entry, controller)};
    entry.name = this.prefix + owner.userData.editorId; entry.state = state;
    const input = this.ctx.raycontrol;
    if (input && input.addState) input.addState(entry.name, state);
    this.entries.set(owner, entry); return entry;
  }

  valid(entry, hit, controller) {
    const face = hit && (hit.actualObject || hit.object);
    if (!this.simulation.running || entry.editing || !visible(entry.owner) || !hit || !hit.uv || hit.distance > 6 || !entry.planes.includes(face) || !face.visible) return false;
    const input = this.ctx.raycontrol;
    if (input && input.enabled === false) return false;
    const origin = this.simulation.interactionOrigin ? this.simulation.interactionOrigin(controller) : controller && controller.getWorldPosition(new THREE.Vector3());
    face.updateWorldMatrix(true, false);
    if (origin && face.worldToLocal(origin.clone()).z <= 0) return false;
    return !this.simulation.validInteraction || this.simulation.validInteraction(entry.owner, hit, controller, true);
  }

  release(entry, controller) { if (entry.presses.delete(controller)) entry.dirty = true; }

  press(entry, hit, controller) {
    if (!this.valid(entry, hit, controller) || entry.presses.has(controller)) return;
    const x = hit.uv.x * WIDTH, y = (1 - hit.uv.y) * HEIGHT;
    const region = entry.regions.slice().reverse().find(item => x >= item.x && x <= item.x + item.width && y >= item.y && y <= item.y + item.height &&
      (!item.polygon || inside({x, z: y}, item.polygon)));
    if (!region || region.disabled) return;
    const pressed = Array.from(entry.presses.values()).some(key => key === region.key);
    entry.presses.set(controller, region.key); entry.dirty = true;
    if (pressed) return; // One virtual button has one action until both hands release it.
    if (this.simulation.pulse) this.simulation.pulse(controller, .18, 25);
    if (region.product) { entry.selectedProductId = region.product; return; }
    if (region.part !== undefined) { entry.previewPart = region.part; return; }
    if (region.key === 'preview-turn') { entry.previewTurn = ((entry.previewTurn || 0) + 1) % 4; return; }
    if (region.node) { entry.selectedId = region.node; entry.selectedProductId = null; entry.previewPart = ''; entry.detailPage = 0; return; }
    if (region.key === 'view') { entry.focused = !entry.focused; return; }
    if (region.page) { entry.page = region.page; return; }
    if (region.analysis !== undefined) { entry.analysisPage = region.analysis; return; }
    if (region.equipment !== undefined) { entry.equipmentPage = region.equipment; entry.equipmentOffset = 0; return; }
    if (region.key === 'machine-previous' || region.key === 'machine-next') {
      const ids = entry.model.records.map(record => record.id), current = ids.indexOf(entry.selectedId);
      entry.selectedId = ids[(current + (region.key === 'machine-next' ? 1 : -1) + ids.length) % ids.length]; entry.selectedProductId = null; entry.previewPart = ''; entry.equipmentOffset = 0; entry.detailPage = 0; return;
    }
    if (region.key === 'scope') { entry.moduleOnly = !entry.moduleOnly; return; }
    if (region.key === 'previous' || region.key === 'next') {
      const key = entry.page === 'events' ? 'eventPage' : entry.page === 'analytics' ? 'analysisPage' : entry.page === 'equipment' ? 'equipmentOffset' : 'detailPage';
      entry[key] = Math.max(0, entry[key] + (region.key === 'next' ? 1 : -1)); return;
    }
    if (!region.action) return;
    const scope = region.targetId ? 'module' : entry.moduleOnly ? 'module' : entry.config.scope || 'line';
    const targetId = region.targetId || (entry.moduleOnly ? entry.selectedId : this.targetId(entry));
    if (region.targetId) {
      const selected = entry.model.records.find(record => record.id === region.targetId);
      if (!selected || !equipmentCommands(selected).some(([action]) => action === region.action)) return;
    }
    try {
      // A separate red emergency and yellow reset must not toggle each other.
      if (region.action === 'emergency') {
        const panel = this.simulation.getPanelSnapshot(targetId, scope), ids = panel && panel.memberIds || [targetId];
        ids.forEach(id => {
          const record = this.simulation.records.get(id);
          if (!record) return;
          if (record.writable.some(field => field.key === 'emergency')) {
            if (!record.variables.emergency) this.simulation.command(id, 'emergency', undefined, 'module');
          } else if (record.writable.some(field => field.key === 'running')) this.simulation.command(id, 'stop', undefined, 'module');
        });
      } else this.simulation.command(targetId, region.action, undefined, scope);
      entry.notice = '';
    } catch (error) { entry.notice = short(error.message, 110); }
  }

  records(entry, roomId) {
    const live = this.simulation.running && !entry.editing;
    const targetId = this.targetId(entry);
    const snapshot = live && this.simulation.getPanelSnapshot(targetId, entry.config.scope || 'line');
    const all = new Map();
    const objects = snapshot && snapshot.memberIds && this.document.getObject ? snapshot.memberIds.map(id => this.document.getObject(id)).filter(Boolean) : this.document.getObjects(roomId);
    objects.forEach(object => {
      const config = machineConfig(this.document, object); if (!config) return;
      const id = object.userData.editorId, record = live && this.simulation.records.get(id);
      all.set(id, {id, object, config, record, variables: record ? record.variables : Object.assign({}, config,
        {state: 'EDITAR / PROBAR', actualSpeed: 0, entryCount: 0, exitCount: 0, generated: 0, delivered: 0, queued: 0, utilization: 0, completed: 0})});
    });
    let ids = snapshot && snapshot.memberIds;
    if (!ids) {
      const selected = new Set(all.has(targetId) ? [targetId] : []), queue = Array.from(selected);
      if (entry.config.scope !== 'module') while (queue.length) {
        const id = queue.shift();
        all.forEach(item => {
          const current = all.get(id), outgoing = destinations(current.config).includes(item.id) || ['robot', 'vehicle'].includes(item.config.type) && item.config.sourceId === id;
          const incoming = destinations(item.config).includes(id) || ['robot', 'vehicle'].includes(current.config.type) && current.config.sourceId === item.id;
          if ((outgoing || incoming) && !selected.has(item.id)) { selected.add(item.id); queue.push(item.id); }
        });
      }
      ids = Array.from(selected);
    }
    const records = ids.map(id => all.get(id)).filter(Boolean);
    if (!records.some(record => record.id === entry.selectedId)) entry.selectedId = records[0] && records[0].id;
    return {records, snapshot, live};
  }

  layout(entry, roomId) {
    const data = this.records(entry, roomId), ids = new Set(data.records.map(record => record.id));
    const points = [], paths = [], links = [], products = [], pallets = [], mechanisms = [], decks = [], robots = [], vehicles = [];
    const linked = new Set();
    data.records.forEach(item => {
      item.object.updateWorldMatrix(true, false);
      item.position = item.object.getWorldPosition(new THREE.Vector3()); points.push(item.position);
      if (item.config.type === 'conveyor') behaviorSchema.conveyorLayout.pathBranches(item.config).forEach(route => {
        const length = behaviorSchema.conveyorLayout.pathLength(item.config, route), path = [], left = [], right = [], rollers = [];
        const steps = Math.max(24, Math.min(160, Math.ceil(length / .08))), width = item.config.width;
        const at = (distance, side = 0) => {
          const point = behaviorSchema.conveyorLayout.pathPoint(item.config, distance, route);
          return new THREE.Vector3(point.x - point.tz * side, point.y || 0, point.z + point.tx * side).applyMatrix4(item.object.matrixWorld);
        };
        for (let index = 0; index <= steps; index++) {
          const distance = length * index / steps;
          path.push(at(distance)); left.push(at(distance, width / 2)); right.push(at(distance, -width / 2));
        }
        if (item.config.surface === 'rollers' && item.config.mechanism !== 'loading') {
          const count = Math.max(2, Math.min(80, Math.floor(length / (item.config.rollerPitch || .12))));
          for (let index = 0; index < count; index++) { const distance = length * (index + .5) / count; rollers.push([at(distance, width * .47), at(distance, -width * .47)]); }
        }
        const contour = left.concat(right.slice().reverse()); points.push(...contour);
        paths.push({id: item.id, route, points: path, left, right, contour, rollers, width, surface: item.config.surface,
          mechanism: item.config.mechanism, color: stateColor(item.variables, !data.live), chains: item.config.surface === 'chains' ?
            [-.28, .28].map(side => path.map((point, index) => at(length * index / steps, width * side))) : []});
      });
      if (item.config.type === 'robot') {
        const config = item.config, component = item.record && item.record.components.robot;
        const pose = component && component.pose || behaviorSchema.robotKinematics && behaviorSchema.robotKinematics.homePose(config);
        const mobile = ['amr', 'agv', 'mobileManipulator', 'mobileSorter', 'shuttle', 'cartesian'].includes(config.family);
        const length = mobile ? config.length : Math.max(.35, Math.min(.8, config.reach * .3)), width = mobile ? config.width : length;
        const contour = hull(corners(new THREE.Box3(new THREE.Vector3(-length / 2, 0, -width / 2), new THREE.Vector3(length / 2, .05, width / 2)), item.object.matrixWorld));
        points.push(...contour); decks.push({id: item.id, contour, type: 'robot'});
        const matrix = component && component.visualRoot ? component.visualRoot.matrixWorld : item.object.matrixWorld;
        const world = value => (Array.isArray(value) ? new THREE.Vector3().fromArray(value) : new THREE.Vector3(value.x, value.y, value.z)).applyMatrix4(matrix);
        const tcp = pose && pose.tcp ? world(pose.tcp) : item.position.clone(), segments = [];
        if (pose && pose.deltaElbows) pose.deltaElbows.forEach(leg => segments.push([world(leg.base), world(leg.elbow), world(pose.deltaPlatform)]));
        else if (pose && pose.frames && pose.frames.length) segments.push(pose.frames.map(frame => world(frame.position)).concat([tcp]));
        let route = [];
        if (['amr', 'agv', 'mobileManipulator', 'mobileSorter'].includes(config.family) && behaviorSchema.robots) {
          const routeMatrix = component && component.homeMatrix || item.object.matrixWorld;
          route = component && component.route ? component.route.map(segment => (segment.position || segment).clone()) : behaviorSchema.robots.parseWaypoints(config).map(point => new THREE.Vector3(point.x, point.y, point.z).applyMatrix4(routeMatrix));
        }
        segments.forEach(segment => points.push(...segment)); points.push(...route, tcp);
        robots.push({id: item.id, contour, tcp, segments, route, color: stateColor(item.variables, !data.live)});
      }
      if (item.config.type === 'vehicle') {
        const config = item.config, component = item.record && item.record.components.vehicle;
        const contour = hull(corners(new THREE.Box3(new THREE.Vector3(-config.width / 2, 0, -config.length / 2), new THREE.Vector3(config.width / 2, .05, config.length / 2)), item.object.matrixWorld));
        decks.push({id: item.id, contour, type: 'vehicle'}); points.push(...contour);
        let rig; item.object.traverse(node => { if (node.userData.vehicleRig) rig = node.userData.vehicleRig; });
        const forkMatrix = rig && rig.forks ? rig.forks.matrixWorld : new THREE.Matrix4().multiplyMatrices(item.object.matrixWorld, new THREE.Matrix4().makeTranslation(0, config.forkBaseHeight + config.initialLift, config.length / 2));
        const tcp = new THREE.Vector3().setFromMatrixPosition(forkMatrix), segments = [];
        if (!['tow', 'cart'].includes(config.family)) for (const side of [-1, 1]) segments.push([new THREE.Vector3(side * config.forkSpread / 2, 0, 0).applyMatrix4(forkMatrix), new THREE.Vector3(side * config.forkSpread / 2, 0, config.forkLength).applyMatrix4(forkMatrix)]);
        const route = component && component.route ? component.route.map(segment => segment.position.clone()) : behaviorSchema.vehicles.parseWaypoints(config).map(point => new THREE.Vector3(point.x, 0, point.z).applyMatrix4(item.object.matrixWorld));
        segments.forEach(segment => points.push(...segment)); points.push(tcp, ...route);
        vehicles.push({id: item.id, contour, tcp, segments, route, color: stateColor(item.variables, !data.live)});
      }
      if (!['conveyor', 'palletQueue', 'robot', 'vehicle'].includes(item.config.type)) {
        const factory = item.config.type === 'source' ? behaviorSchema.conveyorLayout.sourceLayout : behaviorSchema.conveyorLayout.processorLayout;
        const dimensions = factory(item.config), bounds = new THREE.Box3(new THREE.Vector3(-dimensions.length / 2, 0, -dimensions.width / 2), new THREE.Vector3(dimensions.length / 2, .05, dimensions.width / 2));
        const contour = hull(corners(bounds, item.object.matrixWorld)); points.push(...contour); decks.push({id: item.id, contour, type: item.config.type});
      }
      item.object.traverse(node => {
        const motion = node.userData.industrialConveyorMechanism;
        if (!motion || ['cleat', 'steer'].includes(motion.kind) || !visible(node)) return;
        const contour = footprint(node); if (contour.length < 3) return;
        mechanisms.push({id: item.id, kind: motion.kind, contour, height: node.getWorldPosition(new THREE.Vector3()).y,
          phase: item.variables.mechanismPhase || '', progress: item.variables.actuatorProgress}); points.push(...contour);
      });
      if (item.config.type === 'palletQueue') {
        const layout = behaviorSchema.conveyorLayout.palletQueueLayout(item.config);
        (layout.pallets || []).forEach((bay, index) => {
          const point = new THREE.Vector3().fromArray(bay.position).applyMatrix4(item.object.matrixWorld);
          const contour = hull(corners(new THREE.Box3(new THREE.Vector3(-bay.width / 2, 0, -bay.depth / 2), new THREE.Vector3(bay.width / 2, .1, bay.depth / 2)),
            new THREE.Matrix4().multiplyMatrices(item.object.matrixWorld, new THREE.Matrix4().makeTranslation(...bay.position))));
          points.push(...contour); pallets.push({id: item.id, index: index + 1, point, contour, units: data.live ? number(item.variables['pallet' + (index + 1) + 'Units']) : 0,
            full: data.live && item.variables['pallet' + (index + 1) + 'Full']});
        });
      }
      const connections = destinations(item.config).filter(id => ids.has(id)).map(targetId => [item.id, targetId]);
      if (['robot', 'vehicle'].includes(item.config.type) && ids.has(item.config.sourceId)) connections.push([item.config.sourceId, item.id]);
      connections.forEach(([sourceId, targetId]) => {
        const key = sourceId + '>' + targetId; if (linked.has(key)) return; linked.add(key);
        const source = data.records.find(record => record.id === sourceId);
        const target = data.records.find(record => record.id === targetId);
        source.object.updateWorldMatrix(true, false);
        target.object.updateWorldMatrix(true, false);
        links.push({source: source.object.getWorldPosition(new THREE.Vector3()), target: target.object.getWorldPosition(new THREE.Vector3())});
      });
    });
    if (data.live) this.simulation.products.forEach(product => {
      // Current custody wins over provenance. A load manually moved to another
      // line must not remain painted on its original Source's monitor as well.
      const activeOwner = product.vehicleOwnerId || product.object.userData.vehicleOwnerId || product.robotOwnerId || product.object.userData.robotOwnerId || product.item && (product.item.beltId || product.item.palletOwnerId) || product.processorOwnerId || product.sourceEntry && product.sourceEntry.ownerId;
      const ownerId = activeOwner || product.sourceEntry && product.sourceEntry.originId || product.sourceId;
      if (!ids.has(ownerId) || !visible(product.object)) return;
      product.object.updateWorldMatrix(true, false);
      const metadata = this.simulation.productMetadata ? this.simulation.productMetadata(product) : product.classification || {};
      const size = product.bounds.getSize(new THREE.Vector3()).multiply(product.object.getWorldScale(new THREE.Vector3()));
      const type = product.sourceEntry && product.sourceEntry.load && product.sourceEntry.load.loadMode === 'pallet' ? 'pallet' : product.classification && product.classification.productType || 'box';
      products.push({point: product.bounds.clone().applyMatrix4(product.object.matrixWorld).getCenter(new THREE.Vector3()),
        contour: productOutline(product, type), id: product.sourceEntry && product.sourceEntry.id || product.record && product.record.id || product.object.uuid,
        type, name: product.object.name || 'Producto', ownerId, sku: metadata.sku, quality: metadata.quality, defect: metadata.defect,
        size: {width: Math.abs(size.x), height: Math.abs(size.y), depth: Math.abs(size.z)},
        color: product.sourceEntry && product.sourceEntry.spec && product.sourceEntry.spec.color || product.classification && product.classification.color || '#c7a368',
        units: product.sourceEntry && product.sourceEntry.units || 1,
        stage: product.heldBy ? 'held' : product.robotOwnerId || product.vehicleOwnerId ? 'transport' : product.item && product.item.mechanismStage || (product.processorLocked ? 'PROCESSING' : 'AVAILABLE')});
    });
    const focus = entry.focused && entry.selectedId;
    const focusedPoints = focus && paths.concat(decks, pallets).filter(item => item.id === focus).flatMap(item => item.contour);
    const bounds = new THREE.Box3().setFromPoints(focusedPoints && focusedPoints.length ? focusedPoints : points);
    if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 0, 1));
    const size = bounds.getSize(new THREE.Vector3()), scale = Math.min(600 / Math.max(2, size.x + 1), 312 / Math.max(2, size.z + 1));
    const center = bounds.getCenter(new THREE.Vector3());
    const project = point => ({x: 350 + (point.x - center.x) * scale, y: 298 + (point.z - center.z) * scale});
    if (entry.selectedProductId && !products.some(product => product.id === entry.selectedProductId)) entry.selectedProductId = null;
    const events = data.live ? this.simulation.events.filter(event => ids.has(event.objectId)).slice().reverse() : [];
    const analytics = data.live && ['diagram', 'analytics', 'equipment', 'control'].includes(entry.page) && this.simulation.getAnalyticsSnapshot ? this.simulation.getAnalyticsSnapshot(
      entry.moduleOnly ? entry.selectedId : this.targetId(entry), entry.moduleOnly ? 'module' : entry.config.scope || 'line') : null;
    return Object.assign(data, {paths, links, products, pallets, decks, mechanisms, robots, vehicles, project, scale, events, analytics});
  }

  text(entry, text, x, y, size = 16, color = COLORS.text, maxWidth = WIDTH - x - 18) {
    const context = entry.drawing; context.fillStyle = color; context.font = size + 'px sans-serif'; let value = short(text, 112);
    const width = value => context.measureText ? context.measureText(value).width : value.length * size * .56;
    if (width(value) > maxWidth) { while (value.length > 1 && width(value + '…') > maxWidth) value = value.slice(0, -1); value += '…'; }
    context.fillText(value, x, y);
  }

  button(entry, key, label, x, y, width, height, extra = {}) {
    const pressed = Array.from(entry.presses.values()).includes(key), context = entry.drawing;
    const intent = {start: '#246247', stop: '#593846', pause: '#66532e', emergency: '#822d3c', resetEmergency: '#66532e'}[key];
    context.fillStyle = extra.disabled ? '#26313b' : pressed ? '#467f90' : intent || (extra.active ? '#356270' : '#244455');
    context.fillRect(x, y + (pressed ? 3 : 0), width, height - (pressed ? 3 : 0));
    if (context.strokeRect) { context.strokeStyle = extra.disabled ? '#425563' : key === 'emergency' ? '#ff8d97' : extra.active ? COLORS.cyan : '#466776'; context.lineWidth = extra.active ? 2 : 1; context.strokeRect(x, y + (pressed ? 3 : 0), width, height - (pressed ? 3 : 0)); }
    this.text(entry, label, x + 10, y + height / 2 + 6, extra.fontSize || 16, extra.disabled ? '#8da2b2' : COLORS.text, width - 20);
    entry.regions.push(Object.assign({key, x, y, width, height}, extra));
  }

  poly(entry, points, project, fill, stroke, width = 1) {
    if (!points || points.length < 3) return;
    const context = entry.drawing; context.beginPath();
    points.forEach((point, index) => { const p = project(point); context[index ? 'lineTo' : 'moveTo'](p.x, p.y); }); context.closePath();
    if (fill) { context.fillStyle = fill; context.fill(); }
    if (stroke) { context.strokeStyle = stroke; context.lineWidth = width; context.stroke(); }
  }

  line(entry, points, project, color, width = 1) {
    if (!points.length) return; const context = entry.drawing; context.beginPath();
    points.forEach((point, index) => { const p = project(point); context[index ? 'lineTo' : 'moveTo'](p.x, p.y); });
    context.strokeStyle = color; context.lineWidth = width; context.stroke();
  }

  screenBounds(points, project) {
    const values = points.map(project), xs = values.map(point => point.x), ys = values.map(point => point.y);
    return {x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys)};
  }

  preview(selected, entry) {
    const meshes = previewMeshes(selected.object), key = selected.id + ':' + (entry.previewTurn || 0);
    const signature = JSON.stringify([selected.object.name, selected.config, meshes.map(value => [value.geometry.uuid, value.position.version, value.names, value.mesh.visible, value.matrix.elements,
      value.materials.map(material => material && [material.uuid, material.color && material.color.getHex(), material.opacity, material.visible])])]);
    const cached = this.previewCache.get(key);
    if (cached && cached.signature === signature) { this.previewCache.delete(key); this.previewCache.set(key, cached); return cached; }
    if (cached) { cached.canvas.width = cached.canvas.height = 0; this.previewCache.delete(key); }
    const dom = this.ctx.document || (typeof document !== 'undefined' ? document : null), canvas = dom.createElement('canvas'); canvas.width = 438; canvas.height = 326;
    const model = previewModel(meshes, equipmentParts(selected), entry.previewTurn || 0), context = canvas.getContext('2d');
    const bounds = model.bounds, scale = Math.min(372 / Math.max(.1, bounds.maxX - bounds.minX), 246 / Math.max(.1, bounds.maxY - bounds.minY));
    model.project = point => ({x: 219 + (point.x - (bounds.minX + bounds.maxX) / 2) * scale, y: 155 + (point.y - (bounds.minY + bounds.maxY) / 2) * scale});
    context.fillStyle = '#122432'; context.fillRect(0, 0, canvas.width, canvas.height);
    this.previewFaces(context, model);
    const value = {signature, canvas, model}; this.previewCache.set(key, value); this.stats.previewBuilds++;
    while (this.previewCache.size > PREVIEW_LIMIT) { const first = this.previewCache.keys().next().value, obsolete = this.previewCache.get(first); obsolete.canvas.width = obsolete.canvas.height = 0; this.previewCache.delete(first); }
    return value;
  }

  previewFaces(context, model, offset = {x: 0, y: 0}, highlight) {
    model.faces.forEach(face => {
      if (highlight !== undefined && (!model.parts[face.part] || model.parts[face.part].name !== highlight)) return;
      context.beginPath(); face.points.forEach((point, index) => { const p = model.project(point); context[index ? 'lineTo' : 'moveTo'](p.x + offset.x, p.y + offset.y); }); context.closePath();
      context.fillStyle = highlight !== undefined ? 'rgba(85,215,242,.48)' : face.color; context.fill();
    });
  }

  drawPreview(entry, selected) {
    const cached = this.preview(selected, entry), model = cached.model, context = entry.drawing, offset = {x: 20, y: 190};
    entry.preview = model;
    if (context.drawImage) context.drawImage(cached.canvas, offset.x, offset.y);
    else { context.fillStyle = '#122432'; context.fillRect(offset.x, offset.y, 438, 326); this.previewFaces(context, model, offset); }
    if (entry.previewPart) this.previewFaces(context, model, offset, entry.previewPart);
    const parts = model.parts.filter(part => part.point).slice(0, 4), slots = [[8, 10], [294, 10], [8, 278], [294, 278]];
    entry.previewLabels = [];
    parts.forEach((part, index) => {
      const [x, y] = slots[index], point = model.project(part.point), width = 136;
      this.line(entry, [{x: offset.x + x + width / 2, y: offset.y + y + 18}, {x: offset.x + point.x, y: offset.y + point.y}], value => value, entry.previewPart === part.name ? COLORS.cyan : '#6b8b9f', 1);
      this.button(entry, 'preview-part:' + selected.id + ':' + index, short(part.name, 19), offset.x + x, offset.y + y, width, 36, {part: part.name, fontSize: 13, active: entry.previewPart === part.name});
      entry.previewLabels.push({name: part.name, point, x: offset.x + x, y: offset.y + y, width, height: 36});
    });
    this.text(entry, 'Modelo actual · geometría y colores', 28, 544, 14, COLORS.dim, 428);
  }

  drawDiagram(entry, model, selected) {
    const context = entry.drawing; context.fillStyle = COLORS.card; context.fillRect(MAP.x, MAP.y, MAP.width, MAP.height);
    context.save(); context.beginPath(); context.rect(MAP.x, MAP.y, MAP.width, MAP.height); context.clip();
    model.links.forEach(link => this.line(entry, [link.source, link.target], model.project, '#3b5b70', 2));
    const region = (id, contour) => {
      const box = this.screenBounds(contour, model.project), x = Math.max(MAP.x, box.x), y = Math.max(MAP.y, box.y);
      const width = Math.min(MAP.right, box.x + box.width) - x, height = Math.min(MAP.bottom, box.y + box.height) - y;
      if (width <= 0 || height <= 0) return;
      entry.regions.push({key: 'shape:' + id, node: id, x, y, width, height,
        polygon: contour.map(point => { const value = model.project(point); return {x: value.x, z: value.y}; })});
    };
    model.decks.forEach(deck => { this.poly(entry, deck.contour, model.project, deck.type === 'robot' ? '#625739' : deck.type === 'processor' ? '#34576b' : '#4b6875', '#9fb4bd'); region(deck.id, deck.contour); });
    model.paths.forEach(path => { this.poly(entry, path.contour, model.project, path.surface === 'rollers' ? '#536976' : '#355966', null); region(path.id, path.contour); });
    model.paths.forEach(path => {
      // Only exterior ribbon edges are outlined at T junctions: a branch must
      // not draw a fictitious barrier across the shared transport surface.
      path.contour.forEach((point, index) => {
        const next = path.contour[(index + 1) % path.contour.length], middle = point.clone().add(next).multiplyScalar(.5);
        if (model.paths.some(other => other !== path && other.id === path.id && inside(middle, other.contour))) return;
        this.line(entry, [point, next], model.project, path.color, path.id === entry.selectedId ? 2 : 1);
      });
      path.rollers.forEach(roller => this.line(entry, roller, model.project, '#c6d1d6', Math.max(.8, Math.min(3, model.scale * .075))));
      if (!path.rollers.length && path.surface !== 'chains') for (let index = 2; index < path.left.length - 1; index += 3)
        this.line(entry, [path.left[index], path.right[index]], model.project, '#6e8e9b', .6);
      path.chains.forEach(chain => this.line(entry, chain, model.project, '#a6b7bd', Math.max(1.5, model.scale * .1)));
      const index = Math.max(1, Math.floor(path.points.length * .7)), end = model.project(path.points[index]), previous = model.project(path.points[index - 1]);
      const angle = Math.atan2(end.y - previous.y, end.x - previous.x);
      context.beginPath(); context.moveTo(end.x - Math.cos(angle - .5) * 7, end.y - Math.sin(angle - .5) * 7); context.lineTo(end.x, end.y);
      context.lineTo(end.x - Math.cos(angle + .5) * 7, end.y - Math.sin(angle + .5) * 7); context.strokeStyle = COLORS.text; context.lineWidth = 1.4; context.stroke();
    });
    model.mechanisms.forEach(mechanism => {
      context.globalAlpha = .40; this.poly(entry, mechanism.contour, model.project, '#d6ad41', '#ffe29b', 1.5); context.globalAlpha = 1;
    });
    (model.robots || []).concat(model.vehicles || []).forEach(robot => {
      if (context.setLineDash) context.setLineDash([4, 4]); this.line(entry, robot.route, model.project, '#7e9cba', 1); if (context.setLineDash) context.setLineDash([]);
      robot.segments.forEach(segment => {
        this.line(entry, segment, model.project, '#263844', Math.max(3, Math.min(12, model.scale * .16)));
        this.line(entry, segment, model.project, robot.color, Math.max(1.5, Math.min(7, model.scale * .1)));
        segment.forEach(point => { const p = model.project(point); context.fillStyle = '#d6e4eb'; context.fillRect(p.x - 2, p.y - 2, 4, 4); });
      });
      const tcp = model.project(robot.tcp); context.strokeStyle = '#fbe09b'; context.lineWidth = 1.5;
      context.beginPath(); context.moveTo(tcp.x - 4, tcp.y); context.lineTo(tcp.x + 4, tcp.y); context.moveTo(tcp.x, tcp.y - 4); context.lineTo(tcp.x, tcp.y + 4); context.stroke();
    });
    model.pallets.forEach(pallet => {
      this.poly(entry, pallet.contour, model.project, '#786649', pallet.full ? COLORS.amber : '#b39e72', 1);
      region(pallet.id, pallet.contour);
    });
    model.products.forEach(product => {
      this.poly(entry, product.contour, model.project, product.color, '#ead8ad', .8);
      if (product.type === 'pallet') {
        const box = this.screenBounds(product.contour, model.project); this.text(entry, product.units + ' u', box.x + 2, box.y + 11, 9, '#f6f2de');
      }
    });
    model.pallets.forEach(pallet => {
      const box = this.screenBounds(pallet.contour, model.project);
      if (box.width < 24 || box.height < 20) return;
      const label = 'E' + pallet.index + ':' + pallet.units, width = Math.min(box.width - 2, label.length * 5 + 4);
      context.fillStyle = '#182b35'; context.fillRect(box.x + 1, box.y + box.height - 12, width, 11);
      this.text(entry, label, box.x + 3, box.y + box.height - 3, 9, pallet.full ? COLORS.amber : COLORS.text);
    });
    const used = [], intersects = (a, b) => a.x < b.x + b.width + 6 && a.x + a.width + 6 > b.x && a.y < b.y + b.height + 4 && a.y + a.height + 4 > b.y;
    entry.captionRects = used; // Private render diagnostics; never document data or hit geometry.
    const bodyBounds = model.paths.concat(model.decks, model.pallets, model.products).map(item => this.screenBounds(item.contour, model.project));
    model.records.forEach((item, index) => {
      const position = model.project(item.position), paths = model.paths.filter(path => path.id === item.id), deck = model.decks.find(deck => deck.id === item.id);
      const contours = paths.flatMap(path => path.contour).concat(model.pallets.filter(pallet => pallet.id === item.id).flatMap(pallet => pallet.contour), deck ? deck.contour : []);
      const box = contours.length ? this.screenBounds(contours, model.project) : {x: position.x - 10, y: position.y - 10, width: 20, height: 20};
      const type = item.config.type === 'source' ? item.object.userData && item.object.userData.editorPrefabVariant === 'queue' || /\b(?:fifo|queue)\b/i.test(item.object.name) ? 'FIFO' : 'SOURCE' :
        item.config.type === 'robot' ? 'ROBOT' : item.config.type === 'vehicle' ? 'VEHÍCULO' : item.config.type === 'processor' ? 'PROCESO' : item.config.type === 'palletQueue' ? 'ESTIBAS' : item.config.layout === 'tee' ? 'DESVÍO' : 'BANDA';
      const caption = short(String(index + 1).padStart(2, '0') + ' · ' + type, 12);
      context.font = '12px sans-serif';
      const width = Math.ceil(context.measureText ? context.measureText(caption).width : caption.length * 7.2) + 2;
      const center = Math.max(24, Math.min(676 - width, position.x - width / 2)), above = box.y - 19, below = box.y + box.height + 7;
      const rows = index % 2 ? [above, below, above - 19, below + 19] : [below, above, below + 19, above - 19];
      const candidates = rows.map(y => ({x: center, y})).concat(
        {x: box.x + box.width + 7, y: position.y - 7}, {x: box.x - width - 7, y: position.y - 7}).map(point => Object.assign(point, {width, height: 14}));
      const label = candidates.find(candidate => candidate.x >= 24 && candidate.x + width <= 676 && candidate.y >= MAP.y + 3 && candidate.y + 14 <= MAP.bottom - 3 &&
        !used.some(previous => intersects(candidate, previous)) && !bodyBounds.some(body => intersects(candidate, body)));
      if (label) { used.push(Object.assign({id: item.id, text: caption}, label)); this.text(entry, caption, label.x, label.y + 11, 12, item.id === entry.selectedId ? COLORS.cyan : COLORS.text); }
      const x = Math.max(MAP.x, position.x - 12), y = Math.max(MAP.y, position.y - 12), hitWidth = Math.min(MAP.right, position.x + 12) - x, height = Math.min(MAP.bottom, position.y + 12) - y;
      if (hitWidth > 0 && height > 0) entry.regions.push({key: 'node:' + item.id, node: item.id, x, y, width: hitWidth, height});
    });
    model.products.forEach(product => {
      const box = this.screenBounds(product.contour, model.project), x = Math.max(MAP.x, box.x), y = Math.max(MAP.y, box.y);
      const width = Math.min(MAP.right, box.x + box.width) - x, height = Math.min(MAP.bottom, box.y + box.height) - y;
      if (width <= 0 || height <= 0) return;
      entry.regions.push({key: 'product:' + product.id, product: product.id, x, y, width, height,
        polygon: product.contour.map(point => { const p = model.project(point); return {x: p.x, z: p.y}; })});
      if (product.id === entry.selectedProductId) this.poly(entry, product.contour, model.project, null, COLORS.cyan, 2);
    });
    context.restore();
    const product = model.products.find(item => item.id === entry.selectedProductId);
    this.drawOverviewCharts(entry, model);
    context.fillStyle = COLORS.card; context.fillRect(20, 492, 660, 76);
    this.text(entry, product ? 'Producto · ' + product.name : selected ? 'Equipo · ' + selected.object.name : 'Selecciona un equipo en el plano', 32, 513, 17, COLORS.cyan, 636);
    const quality = product && ({good: 'Conforme', defective: 'Defectuosa', mixed: 'Mixta'}[product.quality] || product.quality || 'Sin atributo');
    const stock = selected && selected.config.type === 'palletQueue' && selected.variables;
    this.text(entry, product ? 'SKU ' + (product.sku || 'Mixto') + ' · ' + product.size.width.toFixed(2) + ' × ' + product.size.depth.toFixed(2) + ' × ' + product.size.height.toFixed(2) + ' m · ' + product.units + ' u · ' + quality :
      stock ? 'Inventario actual: ' + valueText(stock.queuedUnits) + ' u · recibidas: ' + valueText(stock.receivedUnits) + ' u · despachadas: ' + valueText(stock.deliveredUnits) + ' u' :
        selected ? machineName(selected.config) + ' · ' + stateName(selected.variables.state || (selected.variables.running ? 'En marcha' : 'Detenida')) + ' · consulta su ficha en EQUIPO' : 'Plano a escala · cargas, trayectorias y estados en tiempo real', 32, 536, 14, COLORS.dim, 636);
    if (product) this.text(entry, 'Estado: ' + stateName(product.stage) + ' · Defecto: ' + ({none: 'Ninguno', mixed: 'Mixto'}[product.defect] || product.defect || 'Sin atributo'), 32, 558, 13, COLORS.dim, 636);
    else if (stock) this.text(entry, 'Estibas completas retiradas: ' + valueText(stock.dispatchedPallets) + ' · ocupadas ahora: ' + valueText(stock.palletCount), 32, 558, 13, COLORS.dim, 636);
    this.button(entry, 'view', entry.focused ? 'VER LÍNEA COMPLETA' : 'ENFOCAR EQUIPO', 700, 510, 304, 38, {disabled: !selected});
    const target = 90 / Math.max(.01, model.scale), magnitude = Math.pow(10, Math.floor(Math.log10(target)));
    const ruler = magnitude * (target / magnitude >= 5 ? 5 : target / magnitude >= 2 ? 2 : 1), pixels = ruler * model.scale;
    this.line(entry, [{x: 30, y: 468}, {x: 30 + pixels, y: 468}], point => point, COLORS.dim, 1.5);
    this.text(entry, ruler + ' m', 33 + pixels, 471, 12, COLORS.dim);
  }

  drawOverviewCharts(entry, model) {
    const analytics = model.analytics, summary = analytics && analytics.summary || {}, observed = analytics && number(analytics.observedSeconds);
    const cards = [['INGRESOS', number(summary.entryUnits) + ' u', COLORS.cyan], ['SALIDAS (ACUM.)', number(summary.exitUnits) + ' u', COLORS.green],
      ['TRABAJO ÚTIL', observed ? number(summary.utilization).toFixed(1) + '%' : '—', COLORS.green], ['CARGA / LÍMITE', observed ? number(summary.loadPercent).toFixed(1) + '%' : '—', summary.atCapacity ? COLORS.amber : COLORS.cyan]];
    cards.forEach(([label, value, color], index) => {
      const x = 700 + index % 2 * 156, y = 116 + Math.floor(index / 2) * 76; entry.drawing.fillStyle = COLORS.card; entry.drawing.fillRect(x, y, 148, 66);
      this.text(entry, label, x + 10, y + 21, 12, COLORS.dim, 130); this.text(entry, value, x + 10, y + 51, 25, color, 130);
    });
    const stocks = model.records.filter(record => record.config.type === 'palletQueue');
    if (stocks.length && model.live) {
      const current = stocks.reduce((sum, record) => sum + number(record.variables.queuedUnits), 0), retired = stocks.reduce((sum, record) => sum + number(record.variables.dispatchedPallets), 0);
      this.text(entry, 'Stock actual ' + current + ' u · retiradas ' + retired + ' estibas', 702, 272, 12, COLORS.dim, 300);
    }
    this.plot(entry, 'Flujo (unidades / min)', analytics && analytics.history || [], [{key: 'inputRate', label: 'Ingresos', color: COLORS.cyan}, {key: 'outputRate', label: 'Entregas', color: COLORS.green}], {x: 700, y: 276, width: 304, height: 218});
  }

  plot(entry, title, samples, series, box, options = {}) {
    const context = entry.drawing, area = {x: box.x + 40, y: box.y + 34, width: box.width - 52, height: box.height - 78};
    context.fillStyle = COLORS.card; context.fillRect(box.x, box.y, box.width, box.height);
    this.text(entry, title, box.x + 12, box.y + 21, 16, COLORS.text, box.width - 24);
    const levels = options.levels || [], values = samples.flatMap(sample => series.map(line => sample[line.key])).concat(levels.map(level => level.value)).filter(Number.isFinite);
    if (!samples.length || !values.length) { this.text(entry, 'Sin muestras todavía', box.x + 20, box.y + 75, 15, COLORS.dim); return; }
    const maximum = options.maximum || Math.max(1, ...values) * 1.08, minimum = 0;
    const start = number(samples[0].time), end = Math.max(start + 1, number(samples[samples.length - 1].time));
    const project = sample => ({x: area.x + (number(sample.time) - start) / (end - start) * area.width,
      y: area.y + area.height - (number(sample.value) - minimum) / (maximum - minimum) * area.height});
    for (let index = 0; index <= 4; index++) {
      const y = area.y + index * area.height / 4; this.line(entry, [{x: area.x, y}, {x: area.x + area.width, y}], point => point, '#304959', .6);
      this.text(entry, (maximum * (1 - index / 4)).toFixed(maximum < 10 ? 1 : 0), box.x + 3, y + 4, 12, COLORS.dim, 35);
    }
    context.save(); context.beginPath(); context.rect(area.x, area.y, area.width, area.height); context.clip();
    levels.forEach(level => {
      if (!Number.isFinite(level.value)) return; const y = project({time: start, value: level.value}).y;
      context.setLineDash([5, 4]); this.line(entry, [{x: area.x, y}, {x: area.x + area.width, y}], point => point, level.color || COLORS.amber, 1); context.setLineDash([]);
    });
    series.forEach(line => {
      const points = samples.filter(sample => Number.isFinite(sample[line.key])).map(sample => project({time: sample.time, value: sample[line.key]}));
      this.line(entry, points, point => point, line.color, 1.8);
      if (points.length === 1) { context.fillStyle = line.color; context.fillRect(points[0].x - 2, points[0].y - 2, 4, 4); }
      if (options.control && options.control.ready) samples.forEach(sample => {
        const value = sample[line.key]; if (value >= options.control.lcl && value <= options.control.ucl) return;
        const point = project({time: sample.time, value}); context.fillStyle = COLORS.red; context.fillRect(point.x - 2, point.y - 2, 4, 4);
      });
    });
    context.restore();
    this.text(entry, start.toFixed(0) + ' s', area.x, area.y + area.height + 14, 12, COLORS.dim);
    this.text(entry, end.toFixed(0) + ' s', area.x + area.width - 42, area.y + area.height + 14, 12, COLORS.dim);
    series.forEach((line, index) => this.text(entry, line.label, box.x + 12 + index * box.width / series.length, box.y + box.height - 9, 12, line.color, box.width / series.length - 20));
  }

  drawAnalytics(entry, model) {
    entry.analysisPage = Math.min(2, entry.analysisPage);
    ['INDICADORES', 'TENDENCIAS', 'CONTROL I‑MR'].forEach((label, index) => this.button(entry, 'analysis-' + index, label, 20 + index * 330, 112, 318, 36, {analysis: index, active: entry.analysisPage === index}));
    const analytics = model.analytics;
    if (!analytics) { this.text(entry, 'Pulsa Probar para observar métricas y construir el historial real.', 30, 190, 20, COLORS.dim); return; }
    const summary = analytics.summary || {}, history = analytics.history || [], observed = number(analytics.observedSeconds);
    if (entry.analysisPage === 0) {
      const percent = value => observed ? number(value).toFixed(1) + '%' : '—';
      const cards = [
        ['Utilización útil', percent(summary.utilization), COLORS.cyan], ['Disponibilidad', percent(summary.availability), COLORS.green],
        ['Carga / límite configurado', percent(summary.loadPercent), summary.atCapacity ? COLORS.amber : COLORS.cyan],
        ['Producción entregada', number(summary.exitUnits) + ' u · ' + number(summary.throughputPerMinute).toFixed(1) + ' u/min', COLORS.green],
        ['Ingresos de producto', number(summary.entryUnits) + ' unidades', COLORS.cyan],
        ['Capacidad de ciclos conocidos', Number.isFinite(summary.nominalCapacityPerMinute) ? summary.nominalCapacityPerMinute.toFixed(1) + ' u/min' : 'Sin referencia de ciclo', COLORS.dim]
      ];
      cards.forEach(([label, value, color], index) => {
        const x = 20 + index % 3 * 332, y = 158 + Math.floor(index / 3) * 98;
        entry.drawing.fillStyle = COLORS.card; entry.drawing.fillRect(x, y, 320, 88); this.text(entry, label, x + 12, y + 24, 15, COLORS.dim, 296);
        this.text(entry, value, x + 12, y + 62, index === 3 ? 20 : 24, color, 296);
      });
      const states = [['Trabajo útil', 'busySeconds', COLORS.green], ['Ocio', 'idleSeconds', COLORS.dim], ['Preparación', 'setupSeconds', COLORS.cyan],
        ['Bloqueo', 'blockedSeconds', COLORS.red], ['Apagado / parada', 'downSeconds', '#66778d'], ['Pausa', 'pausedSeconds', COLORS.amber]];
      const total = states.reduce((sum, [, key]) => sum + number(summary[key]), 0); let x = 24;
      this.text(entry, 'Tiempo observado ' + duration(observed) + ' · En marcha ' + duration(summary.runningSeconds) + ' · tiempos medios por equipo', 24, 375, 15, COLORS.dim);
      states.forEach(([, key, color]) => {
        const width = total ? number(summary[key]) / total * 976 : 0; entry.drawing.fillStyle = color; entry.drawing.fillRect(x, 389, width, 18); x += width;
      });
      states.forEach(([label, key, color], index) => this.text(entry, label + ': ' + duration(summary[key]), 24 + index % 3 * 332, 434 + Math.floor(index / 3) * 30, 15, color, 316));
      this.text(entry, summary.jamSuspected ? 'POSIBLE ATASCO: ' + short(summary.blockReason || 'Obstrucción persistente.', 90) : summary.congestion ? 'CONGESTIÓN / ESPERA PROLONGADA: ' + short(summary.blockReason, 85) : summary.blocked ? 'BLOQUEO: ' + short(summary.blockReason || 'Receptor o capacidad no disponible.', 95) : summary.atCapacity ? 'Al menos un equipo está al límite de capacidad; consulta su ficha.' : 'Sin bloqueo ni saturación detectados.', 24, 494, 14,
        summary.jamSuspected ? COLORS.red : summary.blocked || summary.atCapacity ? COLORS.amber : COLORS.green);
      this.text(entry, 'Capacidad nominal de ciclos conocidos: excluye setup, paradas y transferencias. Utilización no es OEE.', 24, 514, 12, COLORS.dim);
    } else if (entry.analysisPage === 1) {
      this.plot(entry, 'Flujo de unidades / minuto', history, [{key: 'inputRate', label: 'Ingresos', color: COLORS.cyan}, {key: 'outputRate', label: 'Producción', color: COLORS.green}], {x: 20, y: 158, width: 482, height: 316});
      this.plot(entry, 'Carga y utilización (%)', history, [{key: 'loadPercent', label: 'Carga / límite', color: COLORS.amber}, {key: 'utilization', label: 'Utilización útil', color: COLORS.green}], {x: 520, y: 158, width: 484, height: 316}, {maximum: Math.max(100, ...history.map(sample => number(sample.loadPercent)))});
      this.text(entry, history.length + ' muestras reales · la carga usa el límite configurado; la huella física puede llenarse antes.', 24, 496, 13, COLORS.dim);
      this.text(entry, 'Las tasas describen unidades que cruzaron los límites del alcance, no movimiento entre módulos internos.', 24, 514, 12, COLORS.dim);
    } else {
      const control = analytics.control || {}, window = Math.max(1, number(control.window) || 120), samples = history.slice(-window);
      const levels = control.ready ? [{value: control.center, color: COLORS.green}, {value: control.lcl, color: COLORS.amber}, {value: control.ucl, color: COLORS.amber}] : [];
      this.plot(entry, 'Producción · individuos (u/min)', samples, [{key: 'outputRate', label: 'Producción observada', color: COLORS.cyan}], {x: 20, y: 158, width: 600, height: 316}, {levels, control});
      const moving = control.movingRanges || samples.slice(1).map((sample, index) => ({time: sample.time, value: Math.abs(number(sample.outputRate) - number(samples[index].outputRate))}));
      this.plot(entry, 'Rango móvil (u/min)', moving, [{key: 'value', label: 'Cambio entre muestras', color: COLORS.cyan}], {x: 638, y: 158, width: 366, height: 316},
        {levels: control.ready ? [{value: control.mrCenter, color: COLORS.green}, {value: control.mrUcl, color: COLORS.amber}] : []});
      this.text(entry, control.ready ? 'Centro ' + number(control.center).toFixed(2) + ' · LCI ' + number(control.lcl).toFixed(2) + ' · LCS ' + number(control.ucl).toFixed(2) + ' u/min · ventana ' + window + ' muestras' :
        'Calentando: ' + number(control.samples) + '/20 muestras. Sin diagnóstico de control todavía.', 24, 496, 14, control.ready ? COLORS.green : COLORS.amber);
      this.text(entry, 'I‑MR: límites estadísticos. Rojo = fuera de rango; arranques influyen. No son tolerancias ni seguridad.', 24, 514, 12, COLORS.dim);
    }
    this.text(entry, 'Analítica ' + (entry.analysisPage + 1) + '/3 · ' + (entry.moduleOnly ? 'equipo seleccionado' : 'alcance del monitor'), 240, 546, 15, COLORS.dim, 560);
  }

  drawEquipment(entry, model, selected) {
    ['INFORMACIÓN', 'CONTENIDOS', 'PARTES', 'FUNCIONAMIENTO'].forEach((label, index) => this.button(entry, 'equipment-' + index, label, 20 + index * 248, 112, 236, 36, {equipment: index, active: entry.equipmentPage === index}));
    if (!selected) { this.text(entry, 'No hay un equipo conectado al monitor.', 30, 190, 20, COLORS.dim); return; }
    this.button(entry, 'machine-previous', '◀', 20, 153, 38, 36);
    this.button(entry, 'machine-next', '▶', 966, 153, 38, 36);
    this.text(entry, selected.object.name, 72, 177, 20, COLORS.cyan, 686);
    this.button(entry, 'preview-turn', 'GIRAR VISTA', 774, 153, 180, 36);
    this.drawPreview(entry, selected);
    const measured = model.analytics && model.analytics.machines && model.analytics.machines.find(machine => machine.id === selected.id), capacity = measured && measured.capacity;
    let rows = [];
    if (entry.equipmentPage === 0) {
      rows = [['ID', selected.id], ['Tipo / modo', machineName(selected.config)],
        ['Estado', stateName(measured && measured.state || selected.variables.state || (selected.variables.running ? 'En marcha' : 'Detenida'))],
        ['Límite de cargas', capacity ? valueText(capacity.occupied) + ' / ' + valueText(capacity.configured) : valueText(selected.config.capacity || selected.config.maxPackages)],
        ['Uso del límite', capacity ? valueText(capacity.percent) + '%' : 'Disponible al ejecutar'],
        ['Carga presente', capacity ? valueText(capacity.units) + ' unidades' : valueText(selected.variables.queued || selected.variables.inFlight)],
        [selected.config.type === 'processor' ? 'Ciclo / preparación' : selected.config.type === 'source' ? 'Intervalo de generación' : 'Dimensiones / distribución',
          selected.config.type === 'processor' ? valueText(selected.config.processTime) + ' s / ' + valueText(selected.config.setupTime) + ' s' : selected.config.type === 'source' ? valueText(selected.config.interval) + ' s' :
            selected.config.type === 'palletQueue' ? selected.config.layoutMode === 'fit' ? 'Por dimensiones · hasta ' + selected.config.layers + ' niveles' : selected.config.columns + ' × ' + selected.config.rows + ' × ' + selected.config.layers + ' · ' + selected.config.palletCapacity + ' estibas' : selected.config.length + ' × ' + selected.config.width + ' m'],
        ['Operario', selected.config.requiresOperator ? selected.variables.operatorAvailable ? 'Disponible' : 'Requerido / no disponible' : 'No requerido']];
      if (selected.config.type === 'palletQueue') rows.splice(3, 0,
        ['Inventario actual', valueText(selected.variables.queuedUnits) + ' u · ' + valueText(selected.variables.queued) + ' cargas'],
        ['Recibidas acumuladas', valueText(selected.variables.receivedUnits) + ' unidades'],
        ['Despachadas acumuladas', valueText(selected.variables.deliveredUnits) + ' unidades'],
        ['Estibas retiradas', valueText(selected.variables.dispatchedPallets)],
        ['Estibas completas', valueText(selected.variables.completePallets) + ' / ' + valueText(selected.config.palletCapacity)],
        ['Capacidad física', selected.config.layoutMode === 'fit' ? 'Depende de las dimensiones reales de cada carga' : 'Según retícula configurada'],
        ['Retiro automático', selected.config.autoRelease ? selected.config.releasePolicy === 'stockFull' ? 'Al completar todas las estibas' : 'Al completar una estiba' : 'Desactivado']);
      if (selected.config.type === 'robot') rows.splice(3, 0,
        ['Secuencia', selected.variables.phaseText || (model.live ? selected.variables.phase : 'Disponible al ejecutar')],
        ['Herramienta / operación', selected.config.tool + ' / ' + selected.config.operation],
        ['Carga / capacidad', valueText(selected.variables.loadKg) + ' / ' + valueText(selected.config.payloadKg) + ' kg'],
        ['Alcance nominal', valueText(selected.config.reach) + ' m'],
        ['Ciclo / preparación', valueText(selected.config.cycleTime) + ' s / ' + valueText(selected.config.setupTime) + ' s'],
        ['Recogida / receptor', short(selected.config.sourceId || 'Sin vincular', 25) + ' → ' + short(selected.config.outputId || 'Sin vincular', 25)],
        ['TCP local (m)', [selected.variables.tcpX, selected.variables.tcpY, selected.variables.tcpZ].map(value => number(value).toFixed(2)).join(' / ')],
        ['Interbloqueo', selected.variables.faultLabel || selected.variables.fault || 'Sin alarma']);
    } else if (entry.equipmentPage === 1) {
      const contents = measured && measured.contents || [];
      rows = contents.map((load, index) => [String(index + 1).padStart(2, '0') + ' · ' + short(load.name || load.sku || load.id, 35),
        (load.units || 1) + ' u · ' + short(stateName(load.stage), 20) + ' · ' + number(load.width).toFixed(2) + ' × ' + number(load.depth).toFixed(2) + ' × ' + number(load.height).toFixed(2) + ' m']);
      if (!rows.length) rows.push(['Sin cargas registradas', !model.live ? 'Pulsa Probar para ver las cargas reales.' : measured ? 'El equipo está vacío.' : 'Aún no hay telemetría de contenidos.']);
      if (selected.config.type === 'palletQueue') rows.unshift(['Inventario actual', valueText(selected.variables.queuedUnits) + ' unidades en ' + valueText(selected.variables.queued) + ' cargas'],
        ['Retiradas de stock', valueText(selected.variables.deliveredUnits) + ' u · ' + valueText(selected.variables.dispatchedPallets) + ' estibas completas']);
    } else if (entry.equipmentPage === 2) {
      rows = equipmentParts(selected).map(part => [part.name, part.function]);
    } else {
      const words = operation(selected.config).split(' '), lines = []; let line = '';
      words.forEach(word => { if ((line + ' ' + word).length > 72) { lines.push(line); line = word; } else line += (line ? ' ' : '') + word; }); if (line) lines.push(line);
      rows = lines.map((line, index) => [index ? '' : 'Secuencia', line]);
      rows.push(['Condición de bloqueo', model.analytics && model.analytics.summary && model.analytics.summary.blockReason || 'La transferencia exige espacio y un receptor compatible.']);
      rows.push(['Modelo', 'Simulación didáctica de eventos y cinemática; sin conexión a un PLC real.']);
    }
    entry.drawing.font = '15px sans-serif';
    const rowWidth = value => entry.drawing.measureText ? entry.drawing.measureText(value).width : value.length * 8;
    rows = rows.flatMap(([key, value]) => {
      const text = String(value), result = []; let remaining = text;
      while (remaining.length > 47 || rowWidth(remaining) > 352) {
        let end = Math.min(46, remaining.length - 1); while (end > 1 && rowWidth(remaining.slice(0, end)) > 352) end--;
        const space = remaining.lastIndexOf(' ', end); if (space > end / 2) end = space;
        result.push([result.length ? '' : key, remaining.slice(0, end)]); remaining = remaining.slice(end).trim();
      }
      result.push([result.length ? '' : key, remaining]); return result;
    });
    const pageSize = 8;
    const pages = Math.max(1, Math.ceil(rows.length / pageSize)); entry.equipmentOffset = Math.min(entry.equipmentOffset, pages - 1);
    rows.slice(entry.equipmentOffset * pageSize, (entry.equipmentOffset + 1) * pageSize).forEach(([key, value], index) => {
      const y = 217 + index * 38; entry.drawing.fillStyle = entry.previewPart === key ? '#244b5d' : index % 2 ? COLORS.card : '#132632'; entry.drawing.fillRect(478, y - 19, 526, 37);
      this.text(entry, key, 488, y + 2, 13, COLORS.dim, 142); this.text(entry, value, 642, y + 2, 15, COLORS.text, 352);
      if (entry.equipmentPage === 2 && key) entry.regions.push({key: 'part-row:' + selected.id + ':' + index, part: key, x: 478, y: y - 19, width: 526, height: 37});
    });
    this.button(entry, 'previous', '◀ ANTERIOR', 478, 520, 160, 38, {disabled: entry.equipmentOffset === 0});
    this.button(entry, 'next', 'SIGUIENTE ▶', 844, 520, 160, 38, {disabled: entry.equipmentOffset >= pages - 1});
    this.text(entry, (entry.equipmentOffset + 1) + ' / ' + pages, 718, 545, 16, COLORS.dim, 104);
  }

  drawControl(entry, model, selected) {
    const targets = entry.moduleOnly ? model.records.filter(record => record.id === entry.selectedId) : model.records;
    entry.drawing.fillStyle = COLORS.card; entry.drawing.fillRect(20, 116, 660, 442); entry.drawing.fillRect(700, 116, 304, 442);
    this.text(entry, entry.moduleOnly ? 'CONTROL · EQUIPO SELECCIONADO' : 'CONTROL · RED CONECTADA', 36, 148, 18, COLORS.cyan, 624);
    this.text(entry, entry.moduleOnly && selected ? selected.object.name : model.records.length + ' equipos · las otras redes son independientes', 36, 175, 15, COLORS.dim, 624);
    COMMANDS.forEach(([action, label], index) => {
      const field = ['powerOn', 'powerOff'].includes(action) ? 'powered' : ['speedUp', 'speedDown'].includes(action) ? 'speed' : action === 'resetEmergency' ? 'emergency' : action === 'pause' ? 'paused' : 'running';
      const supported = targets.some(record => !(record.config.type === 'vehicle' && ['pause', 'speedUp', 'speedDown'].includes(action)) && Object.prototype.hasOwnProperty.call(record.variables, field) &&
        (!['powered', 'speed'].includes(field) || record.config.type !== 'conveyor' || !record.config.drive || record.config.drive === 'motor'));
      this.button(entry, action, label, 36 + index % 3 * 212, 194 + Math.floor(index / 3) * 72, 200, 54, {action, disabled: !model.live || !supported});
    });
    this.text(entry, 'EMERGENCIA detiene y queda enclavada.', 36, 446, 17, COLORS.red, 624);
    this.text(entry, 'REARMAR libera la emergencia; MARCHA vuelve a iniciar.', 36, 477, 15, COLORS.dim, 624);
    this.text(entry, 'El alcance de la cabecera define qué equipos reciben cada orden.', 36, 516, 14, COLORS.dim, 624);
    this.text(entry, 'ACCIÓN MANUAL DEL EQUIPO', 716, 147, 15, COLORS.cyan, 272);
    this.text(entry, selected ? selected.object.name : 'Sin equipo', 716, 176, 18, COLORS.text, 272);
    this.text(entry, 'Actúa sólo sobre esta selección.', 716, 201, 13, COLORS.dim, 272);
    const contextual = equipmentCommands(selected);
    contextual.forEach(([action, label], index) => {
      const text = action === 'operator' ? label + ': ' + (selected.variables.operatorAvailable ? 'DISPONIBLE' : 'NO DISPONIBLE') : label;
      this.button(entry, 'equipment-action-' + action, text, 716, 220 + index * 58, 272, 46, {action, targetId: selected.id, disabled: !model.live, fontSize: 14});
    });
    if (!contextual.length) {
      this.text(entry, selected && selected.config.type === 'palletQueue' ? 'Sin una estiba completa' : 'Este equipo no requiere', 716, 253, 16, COLORS.dim);
      this.text(entry, selected && selected.config.type === 'palletQueue' ? 'disponible para retirar.' : 'una acción manual de ciclo.', 716, 279, 16, COLORS.dim);
    }
    this.button(entry, 'machine-previous', '◀ EQUIPO', 716, 420, 132, 40);
    this.button(entry, 'machine-next', 'EQUIPO ▶', 856, 420, 132, 40);
    this.button(entry, 'equipment-link', 'VER FICHA Y MODELO', 716, 482, 272, 42, {page: 'equipment'});
  }

  draw(entry, model) {
    const context = entry.drawing; entry.regions = [];
    if (context.setTransform) context.setTransform(entry.canvas.width / WIDTH, 0, 0, entry.canvas.height / HEIGHT, 0, 0);
    context.fillStyle = COLORS.background; context.fillRect(0, 0, WIDTH, HEIGHT);
    this.text(entry, short(entry.config.title || 'SUPERVISIÓN DE LÍNEA', 36), 20, 30, 23, COLORS.text, 500);
    this.text(entry, model.live ? 'EN VIVO · ' + model.records.length + ' equipos' : 'EDITAR · Pulsa Probar para operar', 20, 55, 15, model.live ? COLORS.green : COLORS.cyan);
    const selected = model.records.find(record => record.id === entry.selectedId), aggregate = entry.moduleOnly && selected ? selected.variables : model.snapshot && model.snapshot.variables || {};
    const measured = model.analytics && model.analytics.summary || {};
    const firstNumber = (...values) => number(values.find(value => typeof value === 'number' && Number.isFinite(value)));
    this.text(entry, 'Entradas ' + firstNumber(measured.entryUnits, aggregate.entryUnits, aggregate.entryCount, aggregate.generated, aggregate.received) + ' u' +
      '   Salidas ' + firstNumber(measured.exitUnits, aggregate.exitUnits, aggregate.exitCount, aggregate.delivered) + ' u' +
      '   En línea ' + firstNumber(aggregate.inFlight, aggregate.queued), 540, 30, 16);
    const status = aggregate.emergency ? 'EMERGENCIA' : aggregate.paused ? 'PAUSA' : aggregate.palletFull ? 'ESTIBAS LLENAS' :
      aggregate.transferBlocked ? 'ESPERANDO SALIDA' : aggregate.powered === false ? 'APAGADA' : aggregate.running === false ? 'DETENIDA' : 'OPERATIVA';
    this.text(entry, 'Utilización ' + firstNumber(measured.utilization, aggregate.utilization).toFixed(1) + '% · ' + status, 540, 55, 15,
      aggregate.emergency ? COLORS.red : aggregate.palletFull || aggregate.transferBlocked ? COLORS.amber : COLORS.dim);
    ['diagram', 'analytics', 'equipment', 'control', 'details', 'events'].forEach((page, index) => this.button(entry, page, ['RESUMEN', 'ANALÍTICA', 'EQUIPO', 'CONTROL', 'VARIABLES', 'EVENTOS'][index], 20 + index * 116, 70, 108, 36, {page, active: entry.page === page, fontSize: 14}));
    const scopeLabel = {line: 'LÍNEA', segment: 'TRAMO', module: 'MÓDULO'}[entry.config.scope || 'line'];
    this.button(entry, 'scope', entry.moduleOnly ? 'ALCANCE: MÓDULO' : 'ALCANCE: ' + scopeLabel, 724, 70, 280, 36);
    if (entry.page === 'diagram') {
      this.drawDiagram(entry, model, selected);
    } else if (entry.page === 'analytics') {
      this.drawAnalytics(entry, model);
    } else if (entry.page === 'equipment') {
      this.drawEquipment(entry, model, selected);
    } else if (entry.page === 'control') {
      this.drawControl(entry, model, selected);
    } else if (entry.page === 'details') {
      this.text(entry, selected ? selected.object.name : 'Sin equipo conectado', 20, 134, 20, COLORS.cyan);
      const keys = selected ? Object.keys(selected.variables).sort() : [], pages = Math.max(1, Math.ceil(keys.length / PAGE_SIZE));
      entry.detailPage = Math.min(entry.detailPage, pages - 1);
      keys.slice(entry.detailPage * PAGE_SIZE, (entry.detailPage + 1) * PAGE_SIZE).forEach((key, index) => {
        context.fillStyle = index % 2 ? COLORS.card : '#132632'; context.fillRect(20, 149 + index * 33, 984, 32);
        this.text(entry, key, 32, 171 + index * 33); this.text(entry, valueText(selected.variables[key]), 425, 171 + index * 33);
      });
      this.text(entry, 'Página ' + (entry.detailPage + 1) + '/' + pages + ' · todas las variables del equipo', 240, 546, 15, COLORS.dim, 560);
    } else {
      const pages = Math.max(1, Math.ceil(model.events.length / PAGE_SIZE)); entry.eventPage = Math.min(entry.eventPage, pages - 1);
      model.events.slice(entry.eventPage * PAGE_SIZE, (entry.eventPage + 1) * PAGE_SIZE).forEach((event, index) => this.text(entry,
        number(event.time).toFixed(1) + ' s · ' + event.type + ' · ' + short(event.message, 83), 24, 142 + index * 33, 15));
      if (!model.events.length) this.text(entry, 'No hay eventos de esta línea.', 24, 160, 18, COLORS.dim);
      this.text(entry, 'Página ' + (entry.eventPage + 1) + '/' + pages + ' · eventos de la línea', 240, 546, 15, COLORS.dim, 560);
    }
    if (['analytics', 'details', 'events'].includes(entry.page)) {
      this.button(entry, 'previous', '◀ ANTERIOR', 20, 520, 180, 38);
      this.button(entry, 'next', 'SIGUIENTE ▶', 824, 520, 180, 38);
    }
    if (entry.notice) this.text(entry, entry.notice, 20, 572, 13, COLORS.red);
    entry.texture.needsUpdate = true; entry.dirty = false; this.stats.draws++;
  }

  remove(owner) {
    const entry = this.entries.get(owner); if (!entry) return;
    const input = this.ctx.raycontrol;
    if (input && input.states && input.states[entry.name] === entry.state) {
      input.deactivateState(entry.name); delete input.states[entry.name];
    }
    entry.presses.clear(); entry.preview = null; entry.previewLabels = []; entry.planes.forEach(plane => { if (plane.parent) plane.parent.remove(plane); });
    entry.plane.geometry.dispose(); entry.plane.material.dispose(); entry.texture.dispose(); entry.canvas.width = entry.canvas.height = 0; this.entries.delete(owner);
  }

  sync(roomId, delta = 0, editing = false) {
    roomId = String(roomId);
    if (this.roomId !== roomId) { this.dispose(); this.roomId = roomId; }
    const found = new Set();
    this.owners(roomId, delta).forEach(owner => {
      const config = rawBehaviors(this.document, owner).find(value => value.type === 'lineMonitor' && value.enabled !== false);
      if (!config) return; found.add(owner);
      const entry = this.entries.get(owner) || this.create(owner, config); if (!entry) return;
      if (JSON.stringify(entry.config) !== JSON.stringify(config) || entry.editing !== editing) { entry.dirty = true; entry.signature = ''; }
      entry.config = config; entry.editing = editing;
      const performance = this.ctx.performanceVisibility;
      const shown = visible(owner) && (!performance || !performance.isVisible || performance.isVisible(owner)); entry.planes.forEach(plane => { plane.visible = shown; });
      this.displayResolution.update(entry, delta, editing, shown);
      const active = shown && !editing && this.simulation.running, input = this.ctx.raycontrol;
      if (entry.active !== active && input) {
        if (active) input.activateState(entry.name); else { input.deactivateState(entry.name); entry.presses.clear(); }
        entry.active = active; entry.dirty = true;
      }
      entry.elapsed += Math.max(0, Math.min(1, number(delta)));
      const interval = 1 / Math.max(1, Math.min(10, number(config.refreshHz) || 4));
      if (!shown || !entry.dirty && entry.elapsed < interval) return;
      entry.elapsed = 0;
      const model = this.layout(entry, roomId); entry.model = model;
      const analytics = model.analytics, samples = analytics && analytics.history || [];
      const analyticsSignature = analytics && [analytics.observedSeconds, analytics.summary,
        analytics.machines.map(machine => [machine.id, machine.state, machine.metrics, machine.capacity, machine.contents]),
        samples.length, samples[0] && samples[0].time, samples[samples.length - 1], analytics.control];
      const signature = JSON.stringify([editing, entry.page, entry.detailPage, entry.eventPage, entry.analysisPage, entry.equipmentPage, entry.equipmentOffset, entry.selectedId, entry.selectedProductId, entry.focused, entry.moduleOnly,
        model.records.map(item => [item.id, item.object.name, item.object.matrixWorld.elements, item.config, item.variables]),
        model.products.map(item => [item.contour.map(point => point.toArray()), item.stage, item.sku, item.quality, item.defect]), model.events.map(item => item.id), model.snapshot && model.snapshot.variables, analyticsSignature]);
      if (entry.dirty || signature !== entry.signature) { entry.signature = signature; this.draw(entry, model); }
    });
    Array.from(this.entries.keys()).forEach(owner => { if (!found.has(owner)) this.remove(owner); });
  }

  dispose() {
    Array.from(this.entries.keys()).forEach(owner => this.remove(owner)); this.roomId = null;
    this.previewCache.forEach(value => { value.canvas.width = value.canvas.height = 0; }); this.previewCache.clear();
    this.inventory = []; this.inventoryStamp = []; this.inventoryDirty = true; this.scanElapsed = 1;
  }
}
