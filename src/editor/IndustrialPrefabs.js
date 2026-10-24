import * as THREE from 'three';
import behaviorSchema from '../../shared/behaviors.js';

const {defaultBehavior, conveyorLayout} = behaviorSchema;

export const conveyorPresets = [
  {id: 'roller-start', label: 'Rodillos / inicio', config: {layout: 'straight', surface: 'rollers', role: 'start', withSensors: true, withPanel: true, withPallet: false}},
  {id: 'roller-middle', label: 'Rodillos / tramo', config: {layout: 'straight', surface: 'rollers', role: 'middle', withSensors: false, withPanel: false, withPallet: false}},
  {id: 'roller-end', label: 'Rodillos / final', config: {layout: 'straight', surface: 'rollers', role: 'end', withSensors: true, withPanel: false, withPallet: false}},
  {id: 'belt-start', label: 'Cinta / inicio', config: {layout: 'straight', surface: 'belt', role: 'start', withSensors: true, withPanel: true, withPallet: false}},
  {id: 'belt-middle', label: 'Cinta / tramo', config: {layout: 'straight', surface: 'belt', role: 'middle', withSensors: false, withPanel: false, withPallet: false}},
  {id: 'belt-end', label: 'Cinta / final', config: {layout: 'straight', surface: 'belt', role: 'end', withSensors: true, withPanel: false, withPallet: false}},
  {id: 'roller-curve-left', label: 'Rodillos / curva izquierda', config: {layout: 'curveLeft', surface: 'rollers', role: 'middle', withSensors: false, withPanel: false, withPallet: false}},
  {id: 'roller-curve-right', label: 'Rodillos / curva derecha', config: {layout: 'curveRight', surface: 'rollers', role: 'middle', withSensors: false, withPanel: false, withPallet: false}},
  {id: 'belt-curve-left', label: 'Cinta / curva izquierda', config: {layout: 'curveLeft', surface: 'belt', role: 'middle', withSensors: false, withPanel: false, withPallet: false}},
  {id: 'belt-curve-right', label: 'Cinta / curva derecha', config: {layout: 'curveRight', surface: 'belt', role: 'middle', withSensors: false, withPanel: false, withPallet: false}},
  {id: 'roller-tee-split', label: 'Rodillos / T desvío', config: {layout: 'tee', surface: 'rollers', role: 'middle', junctionMode: 'split', withSensors: true, withPanel: false, withPallet: false}},
  {id: 'roller-tee-merge', label: 'Rodillos / T unión', config: {layout: 'tee', surface: 'rollers', role: 'middle', junctionMode: 'merge', withSensors: true, withPanel: false, withPallet: false}},
  {id: 'belt-tee-split', label: 'Cinta / T desvío', config: {layout: 'tee', surface: 'belt', role: 'middle', junctionMode: 'split', withSensors: true, withPanel: false, withPallet: false}},
  {id: 'belt-tee-merge', label: 'Cinta / T unión', config: {layout: 'tee', surface: 'belt', role: 'middle', junctionMode: 'merge', withSensors: true, withPanel: false, withPallet: false}}
];
conveyorPresets.forEach(preset => {
  const suppliedByPreviousModule = preset.config.role === 'middle' || preset.config.role === 'end';
  Object.assign(preset.config, {powered: suppliedByPreviousModule, running: suppliedByPreviousModule, paused: false, autoSpawn: false});
});

export const industrialPrefabs = [
  {id: 'conveyor', label: 'Banda transportadora', description: 'Rodillos de acero, motorreductor, sensores y tablero de mando; entrada libre para conectar equipos.'},
  {id: 'sensor', label: 'Sensor de presencia', description: 'Detector configurable para una banda de la escena.'},
  {id: 'plc', label: 'Controlador y panel de mando', description: 'Dashboard, alimentación, arranque, pausa, parada, emergencia y velocidad.'},
  {id: 'product', label: 'Caja manipulable', description: 'Producto de cartón para recoger y colocar manualmente sobre la banda.'}
].concat(conveyorPresets.map(preset => ({id: preset.id, prefab: 'conveyor', variant: preset.id, label: preset.label, description: 'Módulo configurable; enlaza sus puertos con otros transportadores para construir una línea.'})), [
  {id: 'source', label: 'Source / generador de productos', description: 'Genera productos o pallets y los guarda en una cola FIFO limitada, con salida manual o automática.'},
  {id: 'queue', prefab: 'source', variant: 'queue', label: 'Queue / almacén temporal', description: 'Recibe productos de otros procesos y presenta la próxima carga para recogerla o transferirla.'},
  {id: 'processor', label: 'Processor / máquina de proceso', description: 'Procesa cargas con tiempo de ciclo, preparación, operario y métricas independientes.'},
  {id: 'combiner', prefab: 'processor', variant: 'combiner', label: 'Combiner / combinar cargas', description: 'Agrupa varias cargas de entrada en una carga de salida.'},
  {id: 'separator', prefab: 'processor', variant: 'separator', label: 'Separator / separar lotes', description: 'Divide una carga o lote en varias cargas de salida.'},
  {id: 'palletQueue', label: 'Pallet Queue / almacén con estibas', description: 'Almacén independiente con estiba, apilado visible y salidas manuales o automáticas.'}
]);

const kinds = ['conveyor', 'sensor', 'plc', 'control', 'product', 'source', 'processor', 'palletQueue'];

function material(color, extra = {}) {
  const surface = new THREE.MeshStandardMaterial(Object.assign({color, roughness: 0.46, metalness: 0.65}, extra));
  if (extra.name) surface.userData.industrialSurfaceName = extra.name;
  return surface;
}

// Share resources inside each visual component; replacing/removing a sensor
// must never dispose assets belonging to another independently editable actor.
function builder() {
  const geometries = new Map(), materials = new Map();
  const mesh = (name, kind, args, color, position, extra = {}) => {
    const key = kind + JSON.stringify(args), materialKey = color + JSON.stringify(extra);
    if (!geometries.has(key)) geometries.set(key, kind === 'box' ? new THREE.BoxBufferGeometry(...args) : new THREE.CylinderBufferGeometry(...args));
    if (!materials.has(materialKey)) {
      const surface = material(color, extra);
      // Surface names survive geometry refreshes and describe the editable
      // material rather than the generic name of the merged draw below.
      surface.name = extra.name || name;
      materials.set(materialKey, surface);
    }
    const object = new THREE.Mesh(geometries.get(key), materials.get(materialKey));
    object.name = name;
    if (position) object.position.fromArray(position);
    object.castShadow = true; object.receiveShadow = true;
    return object;
  };
  return {
    box: (name, w, h, d, color, position, extra) => mesh(name, 'box', [w, h, d], color, position, extra),
    cylinder: (name, r, h, color, position, sides = 16, extra) => mesh(name, 'cylinder', [r, r, h, sides], color, position, extra)
  };
}

// Static fittings are batched by material: nuts, cooling fins and adjustable
// feet add detail without hundreds of separate draws or matrix traversals.
function batchDetails(group) {
  const batches = new Map(), names = new Map();
  group.children.slice().forEach(mesh => {
    if (!mesh.isMesh || mesh.children.length || Object.keys(mesh.userData).length) return;
    mesh.updateMatrix();
    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    geometry.applyMatrix(mesh.matrix);
    if (!batches.has(mesh.material)) {
      batches.set(mesh.material, []);
      names.set(mesh.material, mesh.material.userData.industrialSurfaceName || mesh.name || mesh.material.name || 'Acabado');
    }
    batches.get(mesh.material).push(geometry);
    group.remove(mesh);
  });
  batches.forEach((parts, mat) => {
    const geometry = new THREE.BufferGeometry();
    ['position', 'normal', 'uv'].forEach(name => {
      const size = parts[0].attributes[name].itemSize;
      const array = new Float32Array(parts.reduce((sum, part) => sum + part.attributes[name].array.length, 0));
      let offset = 0;
      parts.forEach(part => { array.set(part.attributes[name].array, offset); offset += part.attributes[name].array.length; });
      geometry.setAttribute(name, new THREE.BufferAttribute(array, size));
    });
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    // Keep exactly the same batches, topology and persisted mesh names. A
    // material shared while building different components must nevertheless
    // be editable per component (motor housing versus gearbox, for example).
    const surface = mat.clone();
    const prefix = group.name + ' / ';
    const partName = names.get(mat);
    surface.name = partName.indexOf(prefix) === 0 ? partName : prefix + partName;
    const mesh = new THREE.Mesh(geometry, surface); mesh.name = 'Herrajes / ' + group.name;
    mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
    parts.forEach(part => part.dispose());
  });
}

function component(object, key, behaviors) {
  object.userData.editorPrefabKey = key; object.userData.editorPrefabNode = true;
  object.userData.editorDefaultBehaviors = behaviors; return object;
}

function labelTexture(text) {
  if (typeof document !== 'undefined' && document.createElement) {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 64;
    const context = canvas.getContext && canvas.getContext('2d');
    if (context) {
      context.fillStyle = '#18232d'; context.fillRect(0, 0, 512, 64);
      context.fillStyle = '#e6edf1'; context.font = 'bold 35px sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
      context.fillText(text, 256, 34, 490);
      const texture = new THREE.CanvasTexture(canvas); texture.encoding = THREE.sRGBEncoding; return texture;
    }
  }
  const texture = new THREE.DataTexture(new Uint8Array([24, 35, 45, 255]), 1, 1, THREE.RGBAFormat);
  texture.needsUpdate = true; return texture;
}

function label(name, text, width, height, position) {
  const result = new THREE.Mesh(new THREE.PlaneBufferGeometry(width, height), new THREE.MeshBasicMaterial({map: labelTexture(text)}));
  result.name = name; result.position.fromArray(position); return result;
}

const CONTROL_OPTIONS = {
  start: ['Arranque', 'running', 'set', 1, '#31bf68', 'MARCHA'],
  stop: ['Parada', 'running', 'set', 0, '#ce3e43', 'PARAR'],
  emergency: ['Emergencia / rearme', 'emergency', 'toggle', 1, '#e63c30', 'EMERGENCIA'],
  pause: ['Pausa / continuar', 'paused', 'command', 1, '#edb631', 'PAUSA'],
  powerOff: ['Apagar máquina', 'powered', 'command', 0, '#363d45', 'APAGAR'],
  powerOn: ['Encender máquina', 'powered', 'command', 1, '#e8edf0', 'ENCENDER'],
  speedUp: ['Aumentar velocidad', 'speed', 'command', 0.1, '#428cc3', '+ VELOCIDAD'],
  speedDown: ['Reducir velocidad', 'speed', 'command', 0.1, '#428cc3', '- VELOCIDAD'],
  insertBox: ['Insertar caja en la entrada', 'running', 'command', 1, '#9b7ac9', 'INSERTAR CAJA'],
  resetEmergency: ['Rearmar emergencia', 'emergency', 'command', 0, '#edb631', 'REARMAR'],
  generate: ['Generar producto', 'running', 'command', 1, '#9b7ac9', 'GENERAR'],
  dispatch: ['Despachar próxima carga', 'running', 'command', 1, '#428cc3', 'DESPACHAR'],
  clearQueue: ['Vaciar cola', 'running', 'command', 1, '#dc9d45', 'VACIAR COLA'],
  operator: ['Disponibilidad del operario', 'operatorAvailable', 'command', 1, '#7fc7b6', 'OPERARIO']
};

function control(variant = 'start') {
  const option = CONTROL_OPTIONS[variant];
  if (!option) throw new Error('Variante de control no compatible.');
  const [name, variable, mode, value, color, caption] = option;
  const config = {type: 'control', enabled: true, targetId: '@root', variable, mode, value};
  if (mode === 'command') config.command = variant;
  const group = component(new THREE.Group(), 'control', [config]); group.name = name;
  group.userData.editorPrefabVariant = variant; group.userData.industrialAction = variant;
  const make = builder();
  const bezel = make.cylinder('Aro cromado', 0.067, 0.025, '#b9c2c9', [0, 0, 0], 24, {metalness: 0.95, roughness: 0.23});
  const button = make.cylinder('Pulsador ' + name, variant === 'emergency' ? 0.061 : 0.049, variant === 'emergency' ? 0.065 : 0.035, color, [0, 0, 0.025], 24, {metalness: 0.12, roughness: 0.32, emissive: color, emissiveIntensity: 0.12});
  bezel.rotation.x = Math.PI / 2; button.rotation.x = Math.PI / 2;
  button.userData.industrialButton = true;
  // Keep the old bezel/button indices when restoring saved controls.
  group.add(bezel, button);
  if (variant === 'emergency') {
    const collar = make.cylinder('Collar de seguridad', 0.087, 0.012, '#eebc25', [0, 0, 0.008], 24, {metalness: 0.1});
    collar.rotation.x = Math.PI / 2; group.add(collar);
  }
  group.add(label('Rótulo del control', caption, 0.22, 0.037, [0, -0.09, 0.045]));
  return group;
}

function sensor(name = 'Sensor de presencia', width = 1) {
  const group = component(new THREE.Group(), 'sensor', [Object.assign(defaultBehavior('sensor'), {sourceId: '@root'}), defaultBehavior('analytics')]); group.name = name;
  group.userData.industrialSensorWidth = width;
  const make = builder();
  const emitter = make.box('Soporte del emisor', 0.055, 0.53, 0.065, '#74828b', [0, -0.04, -width / 2 - 0.12]);
  const receiver = make.box('Soporte del receptor', 0.055, 0.53, 0.065, '#74828b', [0, -0.04, width / 2 + 0.12]);
  const volume = make.box('Volumen de detección', 0.10, 0.34, width + 0.08, '#4bedc2', [0, 0.02, 0], {metalness: 0, transparent: true, opacity: 0.045, depthWrite: false});
  volume.userData.industrialSensorVolume = true; group.add(emitter, receiver, volume);
  const lamp = make.box('Piloto del sensor', 0.035, 0.027, 0.012, '#304d43', [0, 0.155, width / 2 + 0.198], {emissive: '#42ec81', emissiveIntensity: 0.12});
  lamp.userData.industrialSensorLamp = true; group.add(lamp);
  const details = new THREE.Group(); details.name = 'Células fotoeléctricas';
  [-1, 1].forEach(side => {
    details.add(make.box('Célula fotoeléctrica IP67', 0.072, 0.11, 0.085, '#172630', [0, 0.12, side * (width / 2 + 0.146)]));
    const lens = make.cylinder('Lente óptica', 0.023, 0.012, '#941b1f', [0, 0.12, side * (width / 2 + 0.098)], 16, {roughness: 0.14, metalness: 0.2});
    lens.rotation.x = Math.PI / 2; details.add(lens);
    details.add(make.box('Abrazadera de montaje', 0.11, 0.025, 0.12, '#444f57', [0, -0.22, side * (width / 2 + 0.12)]));
    details.add(make.cylinder('Cable de la célula', 0.008, 0.28, '#171c21', [0.03, -0.05, side * (width / 2 + 0.18)], 8));
  });
  batchDetails(details); group.add(details); return group;
}

function plc() {
  const group = component(new THREE.Group(), 'plc', [defaultBehavior('automation'), defaultBehavior('analytics')]); group.name = 'PLC simulado / panel de mando';
  const make = builder();
  const cabinet = make.box('Armario', 1.02, 1.00, 0.28, '#abb5be', [0, 0.21, 0], {roughness: 0.34, metalness: 0.72});
  const screen = make.box('Pantalla', 0.74, 0.28, 0.024, '#10232d', [0, 0.47, 0.172], {metalness: 0.05, roughness: 0.28, emissive: '#0d2735', emissiveIntensity: 0.35});
  screen.userData.industrialDisplay = true;
  const start = control('start'), stop = control('stop'), emergency = control('emergency');
  // Keep all controls within a standing user's reach without lifting the feet
  // or changing the conveyor's handling plane and connection anchors.
  start.position.set(-0.29, 0.21, 0.17); stop.position.set(0, 0.21, 0.17); emergency.position.set(0.29, 0.21, 0.17);
  // These original five component paths are persisted; append new controls.
  group.add(cabinet, screen, start, stop, emergency);
  [['pause', -0.29, 0.04], ['powerOff', 0, 0.04], ['powerOn', 0.29, 0.04], ['speedUp', 0.29, -0.13], ['speedDown', -0.29, -0.13], ['insertBox', 0, -0.13]].forEach(([variant, x, y]) => {
    const button = control(variant); button.position.set(x, y, 0.17); group.add(button);
  });
  group.children.filter(node => node.userData.editorPrefabKey === 'control').forEach(button => {
    const caption = button.children.find(child => child.name === 'Rótulo del control'); caption.position.z = -0.004;
    if (button.userData.industrialAction === 'emergency') { caption.position.y = -0.10; caption.scale.y = 0.027 / 0.037; }
  });
  const details = new THREE.Group(); details.name = 'Armario y pedestal';
  details.add(make.box('Junta de puerta', 0.98, 0.96, 0.012, '#303b43', [0, 0.21, 0.145]));
  details.add(make.box('Frente de puerta', 0.955, 0.935, 0.012, '#a9b4bd', [0, 0.21, 0.155]));
  details.add(make.box('Marco de pantalla', 0.81, 0.30, 0.025, '#202d39', [0, 0.47, 0.158]));
  details.add(make.box('Pedestal del tablero', 0.1, 0.97, 0.10, '#687681', [0, -0.77, 0]));
  details.add(make.box('Placa de anclaje', 0.34, 0.025, 0.28, '#4b5962', [0, -1.2675, 0]));
  [-0.43, 0.43].forEach(x => [-0.23, 0.65].forEach(y => {
    const screw = make.cylinder('Tornillo de puerta', 0.012, 0.008, '#d0d7dd', [x, y, 0.168], 6); screw.rotation.x = Math.PI / 2; details.add(screw);
  }));
  [-0.11, 0.53].forEach(y => details.add(make.box('Bisagra', 0.035, 0.12, 0.045, '#48565e', [-0.52, y, 0.04])));
  details.add(make.cylinder('Canal de cableado', 0.018, 0.95, '#222c34', [0.085, -0.71, -0.08], 10));
  batchDetails(details); group.add(details);
  group.add(label('Identificación del tablero', 'PLC / TRANSPORTADOR', 0.69, 0.042, [0, 0.655, 0.166]));
  const tower = new THREE.Group(); tower.name = 'Torre luminosa'; tower.position.set(0.37, 0.69, -0.01);
  tower.add(make.cylinder('Soporte de baliza', 0.018, 0.17, '#343f48', [0, 0.085, 0], 12));
  [['powered', '#8da7b4'], ['running', '#2bd979'], ['paused', '#e7b12e'], ['fault', '#e64237']].forEach(([state, color], index) => {
    const lamp = new THREE.Mesh(new THREE.CylinderBufferGeometry(0.045, 0.045, 0.065, 20), material(color, {metalness: 0.1, roughness: 0.25, emissive: color, emissiveIntensity: 0.08}));
    lamp.name = 'Baliza ' + state; lamp.position.y = 0.20 + index * 0.074; lamp.userData.industrialTower = state; tower.add(lamp);
  });
  group.add(tower); return group;
}

function cardboardTexture() {
  const data = new Uint8Array(64 * 64 * 4);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const offset = (y * 64 + x) * 4, grain = ((x * 17 + y * 13 + x * y * 3) % 17) - 8;
    data[offset] = 166 + grain; data[offset + 1] = 123 + grain; data[offset + 2] = 77 + grain; data[offset + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, 64, 64, THREE.RGBAFormat); texture.encoding = THREE.sRGBEncoding; texture.needsUpdate = true; return texture;
}

function shippingTexture() {
  const data = new Uint8Array(128 * 64 * 4);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) {
    const dark = x > 10 && x < 117 && (y > 28 && y < 54 && ((x * 31 + Math.floor(x / 3)) % 11) < 5 || y > 10 && y < 15 && x < 83 || y > 20 && y < 23 && x < 62);
    const offset = (y * 128 + x) * 4; data[offset] = data[offset + 1] = data[offset + 2] = dark ? 29 : 235; data[offset + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, 128, 64, THREE.RGBAFormat); texture.encoding = THREE.sRGBEncoding; texture.needsUpdate = true; return texture;
}

/** Private resources, no actor IDs; also used for automatically spawned boxes. */
export function createProductVisual(size = 0.25) {
  const make = builder();
  const body = new THREE.Mesh(new THREE.BoxBufferGeometry(size, size, size), material('#ffffff', {name: 'Cartón de embalaje', map: cardboardTexture(), roughness: 0.94, metalness: 0}));
  body.name = 'Caja de cartón'; body.castShadow = true; body.receiveShadow = true; body.geometry.computeBoundingBox();
  const details = new THREE.Group(); details.name = 'Cinta y uniones de cartón';
  details.add(make.box('Cinta superior', size * 0.20, size * 0.008, size * 1.006, '#bc9a63', [0, size * 0.503, 0], {roughness: 0.37, metalness: 0}));
  [-1, 1].forEach(side => {
    details.add(make.box('Cinta frontal', size * 0.20, size * 0.22, size * 0.008, '#bc9a63', [0, size * 0.39, side * size * 0.503], {roughness: 0.37, metalness: 0}));
    details.add(make.box('Pliegue lateral', size * 0.006, size * 0.92, size * 0.006, '#805e39', [side * size * 0.496, 0, size * 0.504], {roughness: 0.9, metalness: 0}));
  });
  details.add(make.box('Unión de las solapas', size * 0.008, size * 0.002, size * 0.98, '#8d703f', [0, size * 0.509, 0], {roughness: 0.7, metalness: 0}));
  batchDetails(details); body.add(details);
  const shippingLabel = new THREE.Mesh(new THREE.PlaneBufferGeometry(size * 0.48, size * 0.24), new THREE.MeshStandardMaterial({map: shippingTexture(), roughness: 0.9, metalness: 0}));
  shippingLabel.name = 'Etiqueta de envío y código de barras'; shippingLabel.position.set(size * 0.19, -size * 0.04, size * 0.502); body.add(shippingLabel);
  return body;
}

function productDimension(value, fallback) { return Number.isFinite(value) ? Math.max(0.03, Math.min(4, value)) : fallback; }

function singleSourceProduct(spec) {
  const make = builder(), group = new THREE.Group();
  const color = /^#[a-f\d]{6}$/i.test(spec.color || '') ? spec.color : '#b98953';
  const type = spec.type === 'carton' ? 'box' : spec.type;
  group.name = spec.name || 'Producto';
  if (type === 'crate') {
    const plastic = {metalness: 0.02, roughness: 0.47};
    group.add(make.box('Fondo reforzado', 1, 0.10, 1, color, [0, 0.05, 0], plastic));
    [-1, 1].forEach(side => {
      group.add(make.box('Borde superior de caja plástica', 1, 0.075, 0.055, color, [0, 0.9625, side * 0.4725], plastic));
      group.add(make.box('Borde lateral superior', 0.055, 0.075, 0.90, color, [side * 0.4725, 0.9625, 0], plastic));
      for (let index = 0; index < 6; index++) {
        const offset = -0.45 + index * 0.18;
        group.add(make.box('Nervio de caja plástica', 0.055, 0.86, 0.055, color, [offset, 0.51, side * 0.4725], plastic));
        group.add(make.box('Nervio lateral de caja plástica', 0.055, 0.86, 0.055, color, [side * 0.4725, 0.51, offset], plastic));
      }
      [0.28, 0.51, 0.74].forEach(y => {
        group.add(make.box('Refuerzo horizontal', 0.95, 0.035, 0.045, color, [0, y, side * 0.4775], plastic));
        group.add(make.box('Refuerzo horizontal lateral', 0.045, 0.035, 0.95, color, [side * 0.4775, y, 0], plastic));
      });
    });
    batchDetails(group);
  } else if (type === 'drum') {
    group.add(make.cylinder('Bidón industrial', 0.48, 0.94, color, [0, 0.50, 0], 32, {metalness: 0.68, roughness: 0.34}));
    [0.035, 0.30, 0.70, 0.965].forEach(y => group.add(make.cylinder('Aro de refuerzo del bidón', 0.50, 0.045, '#8f9aa4', [0, y, 0], 32, {metalness: 0.88, roughness: 0.27})));
    group.add(make.cylinder('Tapa de cierre', 0.475, 0.025, '#a9b3ba', [0, 0.9725, 0], 32));
    group.add(make.cylinder('Tapón roscado', 0.06, 0.02, '#434e58', [0.22, 0.99, 0], 12));
    batchDetails(group);
  } else if (type === 'bottle') {
    const glass = {metalness: 0.02, roughness: 0.13, transparent: true, opacity: 0.67};
    group.add(make.cylinder('Cuerpo de botella', 0.50, 0.69, color, [0, 0.345, 0], 24, glass));
    const shoulder = new THREE.Mesh(new THREE.CylinderBufferGeometry(0.20, 0.50, 0.16, 24), material(color, Object.assign({name: 'Hombro de botella'}, glass)));
    shoulder.name = 'Hombro de botella'; shoulder.position.y = 0.77; group.add(shoulder);
    group.add(make.cylinder('Cuello de botella', 0.20, 0.11, color, [0, 0.905, 0], 24, glass));
    group.add(make.cylinder('Tapón de botella', 0.235, 0.04, '#dce4e9', [0, 0.98, 0], 24, {metalness: 0.02, roughness: 0.48}));
    group.add(make.cylinder('Etiqueta de botella', 0.504, 0.27, '#e2e4d7', [0, 0.39, 0], 24, {metalness: 0, roughness: 0.8}));
    batchDetails(group);
  } else {
    const box = createProductVisual(1);
    box.material.color.set(color); group.add(box);
  }
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
  // Every product uses an exact metric envelope and a bottom-centred origin,
  // regardless of decorative rims, tape, labels or the chosen shape.
  const dimensions = [productDimension(spec.width, 0.25), productDimension(spec.height, 0.25), productDimension(spec.depth, 0.25)];
  const normalised = new THREE.Group(); normalised.name = group.name;
  normalised.add(group);
  group.scale.set(dimensions[0] / size.x, dimensions[1] / size.y, dimensions[2] / size.z);
  group.position.set(-center.x * group.scale.x, -bounds.min.y * group.scale.y, -center.z * group.scale.z);
  return normalised;
}

/** A runtime load owns its resources; a pallet is held as one complete unit. */
export function createSourceProductVisual(spec = {}, config = {}) {
  const root = new THREE.Group(), dimensions = {
    width: productDimension(spec.width, 0.25), height: productDimension(spec.height, 0.25), depth: productDimension(spec.depth, 0.25)
  };
  const productSpec = Object.assign({}, spec, dimensions), single = singleSourceProduct(productSpec);
  const loaded = config.loadMode === 'pallet';
  const integer = value => Math.max(1, Math.min(8, Math.floor(Number.isFinite(value) ? value : 2)));
  const columns = loaded ? integer(config.palletColumns === undefined ? config.palletCols : config.palletColumns) : 1;
  const rows = loaded ? integer(config.palletRows) : 1;
  const layers = loaded ? Math.min(integer(config.palletLayers === undefined ? 1 : config.palletLayers), Math.floor(64 / (columns * rows))) : 1;
  const units = columns * rows * layers;
  const width = loaded ? Math.max(1.2, columns * (dimensions.width + 0.02) - 0.02) : dimensions.width;
  const depth = loaded ? Math.max(1.0, rows * (dimensions.depth + 0.02) - 0.02) : dimensions.depth;
  const height = dimensions.height * layers + (loaded ? 0.15 : 0);
  root.name = (loaded ? 'Pallet / ' : '') + (spec.name || 'Producto');
  if (loaded) {
    const base = pallet(); base.name = 'Pallet de producto'; base.scale.set(width / 1.2, 1, depth / 1.05);
    delete base.userData.industrialPallet; root.add(base);
  }
  for (let layer = 0; layer < layers; layer++) for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const object = layer === 0 && row === 0 && column === 0 ? single : single.clone(true);
    object.position.set((column - (columns - 1) / 2) * (dimensions.width + 0.02), (loaded ? 0.15 : 0) + layer * dimensions.height, (row - (rows - 1) / 2) * (dimensions.depth + 0.02));
    root.add(object);
  }
  root.userData.sourceProduct = {
    id: String(spec.id || ''), sku: String(spec.id || ''), label: String(spec.name || 'Producto'), type: spec.type || 'box',
    width, height, depth, units, loadMode: loaded ? 'pallet' : 'individual',
    palletColumns: columns, palletRows: rows, palletLayers: layers,
    productWidth: dimensions.width, productHeight: dimensions.height, productDepth: dimensions.depth
  };
  root.userData.productUnits = units;
  root.updateMatrixWorld(true);
  if (loaded) {
    // A loaded pallet is one handling unit. Merge its repeated boxes and wood
    // fittings by material instead of rendering dozens of separate packages.
    const flattened = new THREE.Group(); flattened.name = root.name;
    root.traverse(object => {
      if (!object.isMesh) return;
      const mesh = new THREE.Mesh(object.geometry, object.material);
      object.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
      flattened.add(mesh);
    });
    batchDetails(flattened);
    const removed = root.children.slice(); removed.forEach(object => root.remove(object));
    flattened.children.slice().forEach(object => root.add(object));
    disposeDetached(removed, root);
  }
  return root;
}

function product(sourceId = '@root') {
  const object = component(createProductVisual(), 'product', [Object.assign(defaultBehavior('product'), {sourceId})]);
  object.name = 'Caja manipulable'; return object;
}

function rollerTexture() {
  const data = new Uint8Array(64 * 4 * 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 64; x++) {
    const offset = (y * 64 + x) * 4, value = x < 2 ? 74 : 195 + (x * 7 % 22);
    data[offset] = value; data[offset + 1] = value + 3; data[offset + 2] = value + 5; data[offset + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, 64, 4, THREE.RGBAFormat);
  texture.encoding = THREE.sRGBEncoding; texture.wrapS = THREE.RepeatWrapping; texture.needsUpdate = true; return texture;
}

function pallet() {
  const group = new THREE.Group(); group.name = 'Pallet de salida';
  // Origin is the floor underneath the pallet; runtime places packages relative
  // to the upper deck and transforms every slot through this marker's matrix.
  group.userData.industrialPallet = {width: 1.2, depth: 1.05, columns: 4, rows: 3, layers: 4, top: 0.15, side: 1, spacing: 0.29};
  const make = builder(), grain = new Uint8Array(128 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 128; x++) {
    const offset = (y * 128 + x) * 4;
    const fiber = Math.sin(y * 3.3 + Math.sin(x * 0.06)) * 13 + ((x * 7 + y * 31) % 9) - 4;
    grain[offset] = 188 + fiber; grain[offset + 1] = 143 + fiber; grain[offset + 2] = 87 + fiber; grain[offset + 3] = 255;
  }
  const texture = new THREE.DataTexture(grain, 128, 32, THREE.RGBAFormat);
  texture.encoding = THREE.sRGBEncoding; texture.needsUpdate = true;
  const wood = material('#ffffff', {name: 'Tablas de madera', map: texture, roughness: 0.93, metalness: 0});
  const board = (name, w, h, d, position) => {
    const mesh = make.box(name, w, h, d, '#c3a06b', position);
    mesh.material = wood; group.add(mesh);
  };
  [-0.42, -0.21, 0, 0.21, 0.42].forEach(z => {
    board('Tabla superior de madera', 1.2, 0.025, 0.19, [0, 0.1375, z]);
    [-0.49, 0.49].forEach(x => [-0.045, 0.045].forEach(dz => {
      group.add(make.cylinder('Clavo de fijación', 0.006, 0.002, '#5b554a', [x, 0.1505, z + dz], 6, {roughness: 0.8, metalness: 0.3}));
    }));
  });
  [-0.425, 0, 0.425].forEach(z => {
    board('Patín inferior', 1.2, 0.025, 0.15, [0, 0.0125, z]);
    [-0.49, 0, 0.49].forEach(x => group.add(make.box('Taco de madera', 0.145, 0.08, 0.145, '#9f7b49', [x, 0.065, z], {roughness: 0.96, metalness: 0})));
  });
  [-0.49, 0, 0.49].forEach(x => board('Travesaño del pallet', 0.145, 0.02, 1.04, [x, 0.115, 0]));
  batchDetails(group);
  return group;
}

// Right-angle drive: the output shaft crosses the terminal roller, while the
// electric motor runs along the conveyor instead of projecting into the aisle.
// Local origin is the roller shaft; +X points into the module, +Z outwards.
function compactMotor() {
  const motor = new THREE.Group(); motor.name = 'Motorreductor';
  const electric = new THREE.Group(); electric.name = 'Motor eléctrico';
  const reducer = new THREE.Group(); reducer.name = 'Reductor angular';
  const mounting = new THREE.Group(); mounting.name = 'Montaje y transmisión';
  const make = builder();
  const along = (group, name, radius, length, color, position, axis, sides = 24, extra) => {
    const object = make.cylinder(name, radius, length, color, position, sides, extra);
    if (axis === 'x') object.rotation.z = -Math.PI / 2;
    else object.rotation.x = Math.PI / 2;
    group.add(object); return object;
  };
  along(electric, 'Carcasa del motor eléctrico', 0.095, 0.30, '#a7b3b9', [0.29, -0.12, 0.24], 'x', 24, {roughness: 0.32, metalness: 0.8});
  for (let index = 0; index < 14; index++) {
    const angle = index * Math.PI * 2 / 14;
    const fin = make.box('Aleta longitudinal de refrigeración', 0.235, 0.026, 0.009, '#87979d', [0.295, -0.12 + Math.cos(angle) * 0.101, 0.24 + Math.sin(angle) * 0.101]);
    fin.rotation.x = angle; electric.add(fin);
  }
  along(electric, 'Tapa del ventilador', 0.108, 0.046, '#9aa8b1', [0.463, -0.12, 0.24], 'x');
  along(electric, 'Rejilla circular de ventilación', 0.087, 0.003, '#273944', [0.488, -0.12, 0.24], 'x', 24, {roughness: 0.8, metalness: 0.25});
  for (let index = -3; index <= 3; index++) {
    const height = Math.sqrt(0.085 * 0.085 - Math.pow(index * 0.022, 2)) * 2;
    electric.add(make.box('Nervio de la rejilla', 0.004, height, 0.007, '#b8c3cb', [0.491, -0.12, 0.24 + index * 0.022]));
  }
  electric.add(make.box('Caja de conexiones', 0.115, 0.062, 0.11, '#8b9aa4', [0.30, 0.008, 0.24]));
  electric.add(make.box('Tapa de conexiones', 0.123, 0.012, 0.118, '#bcc6cd', [0.30, 0.045, 0.24]));
  [-1, 1].forEach(x => [-1, 1].forEach(z => electric.add(make.cylinder('Tornillo de la tapa', 0.006, 0.005, '#465964', [0.30 + x * 0.046, 0.054, 0.24 + z * 0.044], 6))));
  along(electric, 'Prensaestopas', 0.015, 0.035, '#26333c', [0.381, 0.008, 0.24], 'x', 12);
  along(electric, 'Cable de alimentación', 0.009, 0.082, '#1b252e', [0.435, 0.008, 0.24], 'x', 8);
  along(reducer, 'Brida de entrada al reductor', 0.09, 0.042, '#b3bfc7', [0.121, -0.12, 0.24], 'x');
  reducer.add(make.box('Reductor de tornillo sin fin', 0.20, 0.25, 0.22, '#225b9c', [0, -0.075, 0.20], {roughness: 0.31, metalness: 0.65}));
  // Ribs, end cover and visible fasteners keep the compact housing legible.
  for (let index = -2; index <= 2; index++) reducer.add(make.box('Nervio de fundición del reductor', 0.013, 0.19, 0.008, '#3474bc', [index * 0.037, -0.075, 0.314]));
  along(reducer, 'Tapa del eje de salida', 0.075, 0.015, '#b1bfc9', [0, 0, 0.323], 'z');
  along(reducer, 'Retén del eje de salida', 0.035, 0.004, '#273944', [0, 0, 0.333], 'z', 16);
  [-1, 1].forEach(x => [-1, 1].forEach(y => along(reducer, 'Perno del reductor', 0.009, 0.014, '#c9d3da', [x * 0.077, -0.075 + y * 0.101, 0.335], 'z', 6)));
  along(reducer, 'Tapón de aceite', 0.014, 0.014, '#c4ced5', [0.105, -0.075, 0.18], 'x', 6);
  along(mounting, 'Brida de acoplamiento al rodillo', 0.092, 0.026, '#b1bfc9', [0, 0, 0.072], 'z');
  along(mounting, 'Eje de transmisión protegido', 0.027, 0.17, '#c2ccd2', [0, 0, 0.01], 'z', 16);
  mounting.add(make.box('Ménsula compacta del motor', 0.54, 0.028, 0.29, '#617784', [0.19, -0.25, 0.195]));
  mounting.add(make.box('Anclaje al bastidor', 0.20, 0.17, 0.028, '#81939f', [0, -0.16, 0.075]));
  [-0.02, 0.40].forEach(x => [0.11, 0.28].forEach(z => mounting.add(make.cylinder('Perno de fijación del motor', 0.009, 0.012, '#c3ced5', [x, -0.228, z], 6))));
  [electric, reducer, mounting].forEach(group => {
    batchDetails(group);
    // Preserve the material slot exposed by older saved conveyor models.
    group.children.forEach(mesh => { mesh.name = 'Herrajes / Motorreductor'; });
    motor.add(group);
  });
  return motor;
}

function sourceStructure(layout) {
  const frame = new THREE.Group(), legs = new THREE.Group(), make = builder();
  frame.name = 'Bastidor / FIFO'; legs.name = 'Soportes del generador';
  const length = layout.length, width = layout.width;
  // Keep the handling surface at y=0; the metal ends below the mat to avoid
  // coplanar faces flickering through its matte finish.
  frame.add(make.box('Mesa de próxima carga', length, 0.06, width, '#aab8c2', [0, -0.034, 0], {metalness: 0.65, roughness: 0.70}));
  frame.add(make.box('Superficie antideslizante', length - 0.10, 0.004, width - 0.10, '#34434e', [0, -0.002, 0], {metalness: 0, roughness: 0.96}));
  [-1, 1].forEach(side => {
    frame.add(make.box('Perfil de soporte', length, 0.12, 0.055, '#738693', [0, -0.13, side * (width / 2 - 0.05)]));
    frame.add(make.box('Marca amarilla de zona de carga', length * 0.56, 0.001, 0.025, '#edbc3d', [0, 0.001, side * (width / 2 - 0.08)], {metalness: 0, roughness: 0.8}));
  });
  [-1, 1].forEach(x => [-1, 1].forEach(z => {
    const px = x * (length / 2 - 0.16), pz = z * (width / 2 - 0.16);
    legs.add(make.box('Pata de acero', 0.065, 0.83, 0.065, '#7f929d', [px, -0.585, pz]));
    legs.add(make.cylinder('Pie nivelador', 0.085, 0.02, '#29343e', [px, -0.99, pz], 16, {roughness: 0.78, metalness: 0.2}));
    legs.add(make.cylinder('Husillo regulable', 0.018, 0.08, '#afbdc5', [px, -0.96, pz], 12));
  }));
  [-1, 1].forEach(side => legs.add(make.box('Refuerzo inferior', length - 0.25, 0.05, 0.04, '#677c8a', [0, -0.77, side * (width / 2 - 0.16)])));
  batchDetails(frame); batchDetails(legs); return {frame, legs};
}

function sourcePanel() {
  const panel = new THREE.Group(), make = builder(); panel.name = 'Panel del generador';
  panel.add(make.box('Armario Source', 0.78, 0.82, 0.14, '#879aa7', [0, 0.53, 0], {metalness: 0.68, roughness: 0.39}));
  const display = make.box('Pantalla Source', 0.65, 0.29, 0.018, '#10232d', [0, 0.70, 0.081], {metalness: 0, roughness: 0.3});
  display.userData.industrialDisplay = true; display.userData.industrialSourceDisplay = true; panel.add(display);
  [['start', -0.23, 0.44], ['stop', 0, 0.44], ['pause', 0.23, 0.44], ['generate', -0.23, 0.27], ['dispatch', 0, 0.27], ['clearQueue', 0.23, 0.27]].forEach(([variant, x, y]) => {
    const button = control(variant); button.position.set(x, y, 0.08); button.scale.setScalar(0.82);
    // Mount captions on the cabinet face rather than in front of the caps.
    button.children.find(child => child.name === 'Rótulo del control').position.z = (0.073 - button.position.z) / button.scale.z;
    panel.add(button);
  });
  const support = new THREE.Group(); support.name = 'Pedestal y rótulo Source';
  support.add(make.box('Pedestal del Source', 0.065, 1.04, 0.065, '#657b8a', [0, -0.40, 0]));
  support.add(make.box('Base del Source', 0.27, 0.025, 0.24, '#415564', [0, -0.9275, 0]));
  batchDetails(support); panel.add(support);
  panel.add(label('Identificación Source', 'FIFO / PRÓXIMA CARGA', 0.62, 0.043, [0, 0.895, 0.073]));
  return panel;
}

export function refreshSourceGeometry(root, value) {
  if (!root || root.userData.editorPrefabKey !== 'source') return false;
  const layout = behaviorSchema.productSources.layout(value || {});
  const dimensions = [layout.length, layout.width].join(':');
  const previous = root.userData.industrialSource;
  if (root.userData.industrialSourceDimensions === dimensions) return false;
  const mechanics = sourceStructure(layout), removed = root.children.slice(0, 2);
  removed.forEach((object, index) => {
    const replacement = index === 0 ? mechanics.frame : mechanics.legs;
    preserveHiddenMechanical(object, replacement);
    root.remove(object); root.add(replacement);
    root.children.splice(root.children.indexOf(replacement), 1); root.children.splice(index, 0, replacement);
  });
  const panel = root.children[2];
  if (panel) {
    const oldPosition = previous && previous.panelPosition;
    const nextPosition = [-layout.length / 2 + 0.30, -0.06, layout.width / 2 + 0.27];
    if (!oldPosition || panel.position.distanceTo(new THREE.Vector3().fromArray(oldPosition)) < 0.00001) panel.position.fromArray(nextPosition);
  }
  root.userData.industrialSourceDimensions = dimensions;
  root.userData.industrialSource = Object.assign({}, layout, {queuePosition: [0, 0, 0], floor: -1, panelPosition: [-layout.length / 2 + 0.30, -0.06, layout.width / 2 + 0.27]});
  disposeDetached(removed, root); root.updateMatrixWorld(true); return true;
}

function sourceEquipment(variant, value) {
  const config = Object.assign(defaultBehavior('source'), variant === 'queue' ? {autoGenerate: false} : {}, value || {});
  const root = component(new THREE.Group(), 'source', [config, defaultBehavior('analytics')]);
  root.name = variant === 'queue' ? 'Queue / almacén temporal' : 'Source / generador de productos';
  root.userData.editorSourceTop = 0;
  if (variant) root.userData.editorPrefabVariant = variant;
  // Keep these paths stable when size/product settings resize the platform.
  root.add(new THREE.Group(), new THREE.Group(), sourcePanel());
  refreshSourceGeometry(root, config); return root;
}

function palletQueuePanel() {
  const panel = new THREE.Group(), make = builder(); panel.name = 'Panel del almacén con estibas';
  panel.add(make.box('Armario Pallet Queue', 0.64, 0.72, 0.14, '#8f9da7', [0, 0.39, 0], {metalness: 0.35, roughness: 0.65}));
  const screen = make.box('Pantalla Pallet Queue', 0.54, 0.20, 0.018, '#10232d', [0, 0.555, 0.081], {metalness: 0, roughness: 0.40});
  screen.userData.industrialDisplay = true; screen.userData.industrialPalletQueueDisplay = true; panel.add(screen);
  [['start', -0.15, 0.33], ['stop', 0.15, 0.33], ['pause', -0.15, 0.16], ['dispatch', 0.15, 0.16]].forEach(([variant, x, y]) => {
    const button = control(variant); button.position.set(x, y, 0.08); button.scale.setScalar(0.82);
    button.children.find(child => child.name === 'Rótulo del control').position.z = (0.073 - button.position.z) / button.scale.z;
    panel.add(button);
  });
  const support = new THREE.Group(); support.name = 'Pedestal Pallet Queue';
  support.add(make.box('Pedestal del almacén', 0.065, 1.06, 0.065, '#627987', [0, -0.50, 0]));
  support.add(make.box('Base del almacén', 0.28, 0.025, 0.24, '#405867', [0, -1.0375, 0]));
  batchDetails(support); panel.add(support);
  panel.add(label('Identificación Pallet Queue', 'PALLET QUEUE / ESTIBA', 0.54, 0.036, [0, 0.698, 0.073]));
  return panel;
}

export function refreshPalletQueueGeometry(root, value) {
  if (!root || root.userData.editorPrefabKey !== 'palletQueue') return false;
  const config = Object.assign(defaultBehavior('palletQueue'), value || {}), layout = conveyorLayout.palletQueueLayout(config);
  const fields = ['width', 'depth', 'columns', 'rows', 'layers', 'capacity'], key = JSON.stringify(fields.map(field => config[field]));
  if (root.userData.industrialPalletQueueDimensions === key) return false;
  const holder = root.children[0], wood = holder.children[0], previous = root.userData.industrialPalletQueue;
  const original = wood.userData.industrialPalletWoodSize;
  wood.scale.set(config.width / original[0], 1, config.depth / original[1]);
  holder.position.set(0, -1, 0);
  holder.userData.industrialPallet = {width: config.width, depth: config.depth, columns: config.columns, rows: config.rows,
    layers: config.layers, capacity: config.capacity, top: 0.15};
  const panel = root.children[1], panelPosition = [-layout.length / 2 + 0.30, 0.05, layout.width / 2 + 0.24];
  if (!previous || panel.position.distanceTo(new THREE.Vector3().fromArray(previous.panelPosition)) < 0.00001) panel.position.fromArray(panelPosition);
  root.userData.industrialPalletQueueDimensions = key;
  root.userData.industrialPalletQueue = Object.assign({}, layout, {layout, palletPosition: [0, -1, 0], top: -0.85, floor: -1,
    palletWidth: config.width, palletDepth: config.depth, columns: config.columns, rows: config.rows, layers: config.layers, capacity: config.capacity, panelPosition});
  root.updateMatrixWorld(true); return true;
}

function palletQueueEquipment(value) {
  const config = Object.assign(defaultBehavior('palletQueue'), value || {});
  const root = component(new THREE.Group(), 'palletQueue', [config, defaultBehavior('analytics')]); root.name = 'Pallet Queue / almacén con estibas';
  root.userData.editorPalletQueueTop = 0;
  const holder = new THREE.Group(); holder.name = 'Estiba de almacenamiento';
  const wood = pallet(); wood.name = 'Tablas y herrajes de la estiba'; delete wood.userData.industrialPallet;
  wood.updateWorldMatrix(true, true);
  const woodSize = new THREE.Box3().setFromObject(wood).getSize(new THREE.Vector3());
  wood.userData.industrialPalletWoodSize = [woodSize.x, woodSize.z];
  holder.add(wood); root.add(holder, palletQueuePanel()); refreshPalletQueueGeometry(root, config); return root;
}

function processorPanel() {
  const panel = new THREE.Group(), make = builder(); panel.name = 'Panel de la máquina de proceso';
  const details = new THREE.Group(); details.name = 'Armario y pedestal Processor';
  details.add(make.box('Armario Processor', 1.02, 1.00, 0.20, '#9cabb6', [0, 0.44, 0], {metalness: 0.72, roughness: 0.35}));
  details.add(make.box('Junta de puerta Processor', 0.97, 0.95, 0.012, '#2d3d49', [0, 0.44, 0.106]));
  details.add(make.box('Puerta Processor', 0.94, 0.92, 0.014, '#a8b5be', [0, 0.44, 0.116]));
  details.add(make.box('Marco de pantalla Processor', 0.82, 0.32, 0.026, '#263642', [0, 0.70, 0.131]));
  details.add(make.box('Pedestal Processor', 0.09, 0.97, 0.10, '#667d8b', [0, -0.54, 0]));
  details.add(make.box('Pie del panel Processor', 0.34, 0.025, 0.28, '#465e6e', [0, -1.0375, 0]));
  [-0.42, 0.42].forEach(x => [0.01, 0.88].forEach(y => {
    const screw = make.cylinder('Tornillo de puerta Processor', 0.012, 0.008, '#cbd4da', [x, y, 0.132], 6); screw.rotation.x = Math.PI / 2; details.add(screw);
  }));
  batchDetails(details); panel.add(details);
  const screen = make.box('Pantalla Processor', 0.75, 0.28, 0.018, '#10232d', [0, 0.70, 0.151], {metalness: 0, roughness: 0.27});
  screen.userData.industrialDisplay = true; screen.userData.industrialProcessorDisplay = true; panel.add(screen);
  [['start', -0.29, 0.44], ['stop', 0, 0.44], ['emergency', 0.29, 0.44],
    ['pause', -0.29, 0.27], ['powerOff', 0, 0.27], ['powerOn', 0.29, 0.27],
    ['operator', -0.29, 0.10], ['dispatch', 0, 0.10], ['resetEmergency', 0.29, 0.10]].forEach(([variant, x, y]) => {
    const button = control(variant); button.position.set(x, y, 0.15);
    const caption = button.children.find(child => child.name === 'Rótulo del control'); caption.position.z = -0.022;
    if (y === 0.10) caption.position.y = -0.105;
    if (variant === 'emergency') { caption.position.y = -0.10; caption.scale.y = 0.027 / 0.037; }
    panel.add(button);
  });
  panel.add(label('Identificación Processor', 'PROCESSOR / CONTROL', 0.70, 0.043, [0, 0.885, 0.128]));
  const tower = new THREE.Group(); tower.name = 'Torre luminosa Processor'; tower.position.set(0.37, 0.92, -0.02);
  tower.add(make.cylinder('Soporte de baliza Processor', 0.018, 0.16, '#354b58', [0, 0.08, 0], 12));
  [['powered', '#8da7b4'], ['running', '#2bd979'], ['paused', '#e7b12e'], ['fault', '#e64237']].forEach(([state, color], index) => {
    const lamp = new THREE.Mesh(new THREE.CylinderBufferGeometry(0.043, 0.043, 0.06, 20), material(color, {metalness: 0.1, roughness: 0.25, emissive: color, emissiveIntensity: 0.08}));
    lamp.name = 'Baliza Processor ' + state; lamp.position.y = 0.19 + index * 0.07; lamp.userData.industrialTower = state; tower.add(lamp);
  });
  panel.add(tower); return panel;
}

function processorMechanics(layout, config) {
  const make = builder(), frame = new THREE.Group(), legs = new THREE.Group();
  frame.name = 'Celda de proceso'; legs.name = 'Apoyos de la máquina de proceso';
  const length = layout.length, width = layout.width, chamber = Math.min(1.35, length * 0.46);
  const accent = config.mode === 'combiner' ? '#268a7f' : config.mode === 'separator' ? '#ad7a32' : '#23689d';
  frame.add(make.box('Mesa de proceso inoxidable', length, 0.06, width, '#afbec7', [0, -0.03, 0], {metalness: 0.65, roughness: 0.74}));
  frame.add(make.box('Bancada de la máquina', length - 0.12, 0.34, width - 0.12, accent, [0, -0.25, 0], {metalness: 0.52, roughness: 0.40}));
  [-1, 0, 1].forEach(section => {
    const x = section * length / 3, span = length / 3 - 0.09;
    frame.add(make.box('Junta de tapa de mantenimiento', span, 0.255, 0.008, '#304856', [x, -0.25, width / 2 - 0.056]));
    frame.add(make.box('Tapa de mantenimiento', span - 0.018, 0.237, 0.008, accent, [x, -0.25, width / 2 - 0.048], {metalness: 0.62, roughness: 0.37}));
    frame.add(make.box('Tirador de acceso', Math.min(0.16, span * 0.35), 0.018, 0.016, '#c6d2d9', [x, -0.19, width / 2 - 0.035]));
    [-1, 1].forEach(sx => [-1, 1].forEach(sy => {
      const screw = make.cylinder('Tornillo de tapa de mantenimiento', 0.009, 0.005, '#b7c9d3', [x + sx * (span / 2 - 0.025), -0.25 + sy * 0.092, width / 2 - 0.040], 6);
      screw.rotation.x = Math.PI / 2; frame.add(screw);
    }));
    for (let slot = 0; slot < 5; slot++) frame.add(make.box('Rejilla de ventilación de la máquina', Math.min(0.10, span * 0.28), 0.007, 0.003, '#294451', [x, -0.24 - slot * 0.018, width / 2 - 0.042]));
  });
  [-1, 1].forEach(side => {
    frame.add(make.box('Larguero de aluminio', length, 0.07, 0.055, '#c1ccd3', [0, -0.08, side * (width / 2 - 0.035)], {metalness: 0.88, roughness: 0.24}));
    [-1, 1].forEach(end => {
      const x = end * chamber / 2, z = side * (width / 2 - 0.07);
      frame.add(make.box('Perfil vertical de resguardo', 0.05, 0.86, 0.05, '#aebfc9', [x, 0.43, z]));
      const foot = make.cylinder('Fijación del resguardo', 0.025, 0.018, '#516979', [x, 0.012, z], 8); frame.add(foot);
    });
    frame.add(make.box('Perfil superior del resguardo', chamber + 0.06, 0.05, 0.05, '#aebfc9', [0, 0.86, side * (width / 2 - 0.07)]));
    frame.add(make.box('Guía de transporte', length * 0.28, 0.035, 0.025, '#e2b640', [side * length * 0.355, 0.022, -width / 2 + 0.10], {metalness: 0.2}));
    const x = side * (length / 2 - 0.18);
    [-1, 1].forEach(zSide => {
      const z = zSide * (width / 2 - 0.15);
      legs.add(make.box('Pata de máquina', 0.08, 0.55, 0.08, '#738b9b', [x, -0.705, z]));
      legs.add(make.cylinder('Pie antivibración', 0.105, 0.035, '#293b46', [x, -0.9825, z], 20, {metalness: 0.08, roughness: 0.88}));
      legs.add(make.cylinder('Husillo de nivelación', 0.023, 0.11, '#c2cdd3', [x, -0.93, z], 12));
    });
  });
  // A clear front opening leaves incoming products and manual interaction visible.
  frame.add(make.box('Resguardo posterior transparente', chamber - 0.08, 0.72, 0.012, '#91c8d9', [0, 0.43, -width / 2 + 0.07], {metalness: 0, roughness: 0.12, transparent: true, opacity: 0.24, depthWrite: false}));
  [-1, 1].forEach(side => frame.add(make.box('Travesaño superior del pórtico', 0.065, 0.065, width - 0.09, '#aebfc9', [side * chamber * 0.20, 0.88, 0], {metalness: 0.86, roughness: 0.28})));
  frame.add(make.box('Cabezal fijo de la máquina', chamber * 0.65, 0.15, width * 0.48, accent, [0, 0.89, 0]));
  frame.add(make.box('Banda de precaución', chamber * 0.65, 0.035, 0.008, '#edc348', [0, 0.825, width * 0.24 + 0.006], {metalness: 0, roughness: 0.7}));
  batchDetails(frame); batchDetails(legs); return {frame, legs};
}

function processorWorkingHead() {
  const head = new THREE.Group(), make = builder(); head.name = 'Cabezal móvil de proceso';
  head.position.y = 0.60; head.userData.industrialProcessorHead = true;
  [-0.12, 0.12].forEach(x => head.add(make.cylinder('Vástago del actuador', 0.025, 0.30, '#d0d9de', [x, 0.12, 0], 16, {metalness: 0.96, roughness: 0.18})));
  head.add(make.box('Placa de herramienta', 0.40, 0.055, 0.28, '#617e91', [0, -0.015, 0], {metalness: 0.76, roughness: 0.31}));
  head.add(make.box('Herramienta de proceso', 0.27, 0.045, 0.18, '#e8bf48', [0, -0.065, 0], {metalness: 0.4, roughness: 0.48}));
  batchDetails(head); return head;
}

export function refreshProcessorGeometry(root, value) {
  if (!root || root.userData.editorPrefabKey !== 'processor') return false;
  const config = Object.assign(defaultBehavior('processor'), value || {});
  const layout = conveyorLayout.processorLayout(config), signature = [layout.length, layout.width, config.mode].join(':');
  if (root.userData.industrialProcessorDimensions === signature) return false;
  const previous = root.userData.industrialProcessor, mechanics = processorMechanics(layout, config), removed = root.children.slice(0, 2);
  removed.forEach((object, index) => {
    const replacement = index === 0 ? mechanics.frame : mechanics.legs; preserveHiddenMechanical(object, replacement);
    root.remove(object); root.add(replacement); root.children.splice(root.children.indexOf(replacement), 1); root.children.splice(index, 0, replacement);
  });
  const panelPosition = [-layout.length / 2 + 0.45, 0.05, layout.width / 2 + 0.30], panel = root.children[2];
  if (panel && (!previous || panel.position.distanceTo(new THREE.Vector3().fromArray(previous.panelPosition)) < 0.00001)) panel.position.fromArray(panelPosition);
  root.userData.industrialProcessorDimensions = signature;
  root.userData.industrialProcessor = Object.assign({}, layout, {inputPosition: [-layout.length / 2 + 0.35, 0, 0], outputPosition: [layout.length / 2 - 0.35, 0, 0], floor: -1, panelPosition});
  disposeDetached(removed, root); root.updateMatrixWorld(true); return true;
}

function processorEquipment(variant, value) {
  const config = Object.assign(defaultBehavior('processor'), variant ? {mode: variant} : {}, value || {});
  const root = component(new THREE.Group(), 'processor', [config, defaultBehavior('analytics')]);
  root.name = variant === 'combiner' ? 'Combiner / combinar cargas' : variant === 'separator' ? 'Separator / separar lotes' : 'Processor / máquina de proceso';
  root.userData.editorProcessorTop = 0;
  if (variant) root.userData.editorPrefabVariant = variant;
  root.add(new THREE.Group(), new THREE.Group(), processorPanel(), processorWorkingHead());
  refreshProcessorGeometry(root, config); return root;
}

/** Models use meters; the conveyor root's local y=0 is the roller surface. */
function createBaseIndustrialPrefab(kind, variant) {
  if (!kinds.includes(kind)) throw new Error('Plantilla industrial no compatible.');
  if (kind === 'sensor') return sensor();
  if (kind === 'plc') return plc();
  if (kind === 'control') return control(variant);
  if (kind === 'product') return product('');
  if (kind === 'source') return sourceEquipment(variant);
  if (kind === 'palletQueue') return palletQueueEquipment();
  if (kind === 'processor') return processorEquipment(variant);
  const group = component(new THREE.Group(), 'conveyor', [Object.assign(defaultBehavior('conveyor'), {running: false, powered: false, paused: false, autoSpawn: false}), defaultBehavior('analytics')]);
  group.name = 'Banda transportadora'; group.userData.editorConveyorTop = 0;
  const make = builder(), frame = new THREE.Group(); frame.name = 'Bastidor';
  [-1, 1].forEach(side => {
    frame.add(make.box('Larguero de acero', 4.16, 0.18, 0.035, '#8797a2', [0, -0.16, side * 0.60]));
    frame.add(make.box('Ala superior del perfil', 4.16, 0.025, 0.095, '#b5c0c8', [0, -0.075, side * 0.59]));
    frame.add(make.box('Ala inferior del perfil', 4.16, 0.025, 0.095, '#81919d', [0, -0.245, side * 0.59]));
    for (let index = 0; index < 26; index++) {
      const x = -1.9 + index * 3.8 / 25;
      const bearing = make.cylinder('Cojinete sellado', 0.039, 0.025, '#27343e', [x, -0.065, side * 0.548], 12); bearing.rotation.x = Math.PI / 2; frame.add(bearing);
      const washer = make.cylinder('Arandela del eje', 0.022, 0.01, '#c4cdd2', [x, -0.10, side * 0.625], 12); washer.rotation.x = Math.PI / 2; frame.add(washer);
      const bolt = make.cylinder('Tuerca hexagonal', 0.013, 0.018, '#596b79', [x, -0.10, side * 0.635], 6); bolt.rotation.x = Math.PI / 2; frame.add(bolt);
    }
  });
  [-1.7, 0, 1.7].forEach(x => frame.add(make.box('Travesaño inferior', 0.065, 0.09, 1.12, '#70838f', [x, -0.23, 0])));
  batchDetails(frame);
  const legs = new THREE.Group(); legs.name = 'Soportes telescópicos';
  [-1.65, 1.65].forEach(x => [-0.59, 0.59].forEach(z => {
    legs.add(make.box('Tubo exterior de pata', 0.105, 0.46, 0.105, '#92a1ac', [x, -0.47, z]));
    legs.add(make.box('Tubo telescópico', 0.079, 0.36, 0.079, '#c0c9cf', [x, -0.76, z]));
    legs.add(make.box('Cartela de refuerzo', 0.23, 0.065, 0.13, '#71838f', [x, -0.27, z]));
    legs.add(make.cylinder('Husillo nivelador', 0.018, 0.105, '#a1aeb8', [x, -0.96, z], 12));
    legs.add(make.cylinder('Pie antivibratorio', 0.09, 0.032, '#1e2930', [x, -0.984, z], 20, {metalness: 0.05, roughness: 0.85}));
    for (let index = 0; index < 4; index++) legs.add(make.cylinder('Rosca de ajuste', 0.022, 0.006, '#6c7b86', [x, -0.925 - index * 0.016, z], 10));
    const knob = make.cylinder('Pomo de ajuste', 0.031, 0.045, '#1c2933', [x, -0.66, z + 0.071], 8); knob.rotation.x = Math.PI / 2; legs.add(knob);
  }));
  [-1.65, 1.65].forEach(x => legs.add(make.box('Travesaño de soporte', 0.065, 0.065, 1.20, '#80919d', [x, -0.78, 0])));
  batchDetails(legs);
  const rollers = new THREE.Group(); rollers.name = 'Rodillos';
  const rollerGeometry = new THREE.CylinderBufferGeometry(0.065, 0.065, 1.04, 24);
  const rollerMaterial = material('#e7edf1', {name: 'Rodillos / Acero de los rodillos', roughness: 0.24, metalness: 0.87, map: rollerTexture()});
  for (let index = 0; index < 26; index++) {
    const roller = new THREE.Mesh(rollerGeometry, rollerMaterial); roller.name = 'Rodillo ' + (index + 1); roller.rotation.x = Math.PI / 2;
    roller.position.set(-1.9 + index * 3.8 / 25, -0.065, 0); roller.castShadow = true; roller.receiveShadow = true;
    roller.userData.industrialRoller = {axis: 'y', radius: 0.065, texture: true}; rollers.add(roller);
  }
  const motor = compactMotor();
  const entry = sensor('Sensor de entrada'); entry.position.set(-1.55, 0.18, 0);
  const exit = sensor('Sensor de salida'); exit.position.set(1.55, 0.18, 0);
  const panel = plc(); panel.position.set(0.6, 0.28, 1.15);
  // Reserve retired supply paths without geometry, colliders or product actors.
  // Saved sensor/control/pallet indices must remain stable after removing the
  // old attached preparation table and automatically included manual carton.
  const retiredBox = new THREE.Group(), retiredTable = new THREE.Group(), retiredPallet = new THREE.Group();
  retiredBox.name = 'Entrada libre / anclaje de producto retirado';
  retiredTable.name = 'Entrada libre / anclaje de mesa retirado';
  retiredPallet.name = 'Salida libre / anclaje de pallet retirado';
  [retiredBox, retiredTable, retiredPallet].forEach(anchor => { anchor.userData.industrialRetiredSupply = true; anchor.visible = false; });
  group.add(frame, legs, rollers, motor, entry, exit, panel, retiredBox, retiredTable, retiredPallet);
  return group;
}

const CONVEYOR_GEOMETRY_FIELDS = ['layout', 'surface', 'length', 'width', 'radius', 'curveAngle', 'axis', 'junctionMode', 'branchSide'];
const CONVEYOR_STATE_FIELDS = CONVEYOR_GEOMETRY_FIELDS.concat(['role', 'withSensors', 'withPanel', 'withPallet', 'outputId', 'branchId']);

function conveyorConfig(value = {}) {
  const result = Object.assign({layout: 'straight', surface: 'rollers', length: 4, width: 1, radius: 1.5, curveAngle: 90, axis: 'x', role: 'standalone', junctionMode: 'split', branchSide: 'left', withSensors: true, withPanel: true, withPallet: false}, value, {withPallet: false});
  return Object.assign(result, conveyorLayout.settings(result));
}

function signature(config, fields) { return JSON.stringify(fields.map(key => config[key])); }

function yaw(point) { return -Math.atan2(point.tz, point.tx) || 0; }

function pathAnchor(config, distance, lateral = 0, y = 0, route = 'main') {
  const point = conveyorLayout.pathPoint(config, distance, route);
  return {position: [point.x - point.tz * lateral, y, point.z + point.tx * lateral].map(value => Math.abs(value) < 1e-14 ? 0 : value), quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw(point)).toArray()};
}

function closeArray(value, expected) { return value.length === expected.length && value.every((item, index) => Math.abs(item - expected[index]) < 0.00001); }

function setAnchor(object, next, previous) {
  // Component transforms are authored data. Auto-placement follows dimension
  // changes only while the component still occupies its previous auto pose.
  if (!previous || closeArray(object.position.toArray(), previous.position)) object.position.fromArray(next.position);
  if (!previous || closeArray(object.quaternion.toArray(), previous.quaternion) || closeArray(object.quaternion.toArray(), previous.quaternion.map(value => -value))) object.quaternion.fromArray(next.quaternion);
}

function setAutoVisible(object, value, previous) {
  if (!object || object.visible !== previous) return;
  object.visible = value;
}

function componentAnchors(config) {
  const length = conveyorLayout.pathLength(config), margin = Math.min(0.45, length * 0.2);
  return {
    entry: pathAnchor(config, margin, 0, 0.18), exit: pathAnchor(config, length - margin, 0, 0.18),
    panel: pathAnchor(config, length * 0.65, config.width / 2 + 0.65, 0.28)
  };
}

function preserveHiddenMechanical(previous, next) {
  let hidden = false;
  previous.traverse(node => { if (node.userData.editorGeometryReplaced) hidden = true; });
  if (!hidden) return;
  next.traverse(node => {
    if (!node.isMesh) return;
    node.userData.editorGeometryReplaced = true;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach(mat => { mat.visible = false; });
  });
}

function disposeDetached(objects, root) {
  const live = new Set();
  const resources = (object, visit) => object.traverse(node => {
    if (node.geometry) visit(node.geometry);
    const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
    materials.forEach(mat => { visit(mat); Object.keys(mat).forEach(key => { if (mat[key] && mat[key].isTexture) visit(mat[key]); }); });
  });
  resources(root, resource => live.add(resource));
  const removed = new Set();
  objects.forEach(object => resources(object, resource => {
    if (live.has(resource) || removed.has(resource)) return;
    removed.add(resource); resource.dispose();
  }));
}

function resizeSensorVisual(object, width) {
  const previousWidth = object.userData.industrialSensorWidth === undefined ? 1 : object.userData.industrialSensorWidth;
  if (Math.abs(previousWidth - width) < 0.00001) return;
  const replacement = sensor(object.name, width), removed = object.children.slice(0, 5);
  preserveHiddenMechanical(object, replacement);
  const children = replacement.children.slice();
  removed.forEach(child => object.remove(child));
  children.forEach(child => object.add(child));
  children.forEach((child, index) => {
    object.children.splice(object.children.indexOf(child), 1); object.children.splice(index, 0, child);
  });
  object.userData.industrialSensorWidth = width;
  disposeDetached(removed, object);
}

function planarDistanceSq(point, polyline) {
  let closest = Infinity;
  for (let index = 1; index < polyline.length; index++) {
    const a = polyline[index - 1], b = polyline[index], dx = b.x - a.x, dz = b.z - a.z;
    const fraction = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    closest = Math.min(closest, Math.pow(point.x - a.x - fraction * dx, 2) + Math.pow(point.z - a.z - fraction * dz, 2));
  }
  return closest;
}

function beltTexture() {
  const data = new Uint8Array(128 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 128; x++) {
    const offset = (y * 128 + x) * 4, value = x < 2 ? 82 : 31 + ((x * 17 + y * 7) % 9);
    data[offset] = value; data[offset + 1] = value + 5; data[offset + 2] = value + 8; data[offset + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, 128, 32, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.RepeatWrapping;
  texture.encoding = THREE.sRGBEncoding; texture.needsUpdate = true; return texture;
}

function ribbonGeometry(points, width, height) {
  const vertices = [], normals = [], uv = [];
  const add = (point, side) => {
    vertices.push(point.x - point.tz * width * side, height, point.z + point.tx * width * side);
    normals.push(0, 1, 0); uv.push(point.distance, side + 0.5);
  };
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index];
    add(a, -0.5); add(a, 0.5); add(b, -0.5);
    add(a, 0.5); add(b, 0.5); add(b, -0.5);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere(); return geometry;
}

function createPathMechanics(config) {
  const make = builder(), frame = new THREE.Group(), legs = new THREE.Group(), rollers = new THREE.Group();
  frame.name = 'Bastidor'; legs.name = 'Soportes telescópicos'; rollers.name = 'Rodillos';
  const paths = conveyorLayout.pathBranches(config).map(route => {
    const length = conveyorLayout.pathLength(config, route), steps = Math.max(2, Math.min(512, Math.ceil(length / 0.14)));
    const points = [];
    for (let index = 0; index <= steps; index++) points.push(Object.assign({distance: length * index / steps}, conveyorLayout.pathPoint(config, length * index / steps, route)));
    return {route, length, points};
  });
  const railKeys = new Set(), supportPoints = [], rollerKeys = new Set();
  const onOtherDeck = (point, route, margin = 0) => paths.some(path => path.route !== route && planarDistanceSq(point, path.points) < Math.pow(config.width / 2 - margin, 2));
  const addTube = (name, from, to, y, depth, height, color) => {
    const dx = to.x - from.x, dz = to.z - from.z;
    const mesh = make.box(name, Math.sqrt(dx * dx + dz * dz) + 0.006, height, depth, color, [(from.x + to.x) / 2, y, (from.z + to.z) / 2]);
    mesh.rotation.y = -Math.atan2(dz, dx); frame.add(mesh);
  };
  paths.forEach(path => {
    for (let index = 1; index < path.points.length; index++) {
      const from = path.points[index - 1], to = path.points[index];
      [-1, 1].forEach(side => {
        const offset = side * (config.width / 2 + 0.1);
        const a = {x: from.x - from.tz * offset, z: from.z + from.tx * offset};
        const b = {x: to.x - to.tz * offset, z: to.z + to.tx * offset};
        const mid = {x: (a.x + b.x) / 2, z: (a.z + b.z) / 2};
        const key = [mid.x.toFixed(3), mid.z.toFixed(3), yaw(from).toFixed(2)].join(':');
        // Open the side wall wherever the other T branch joins the deck.
        if (railKeys.has(key) || onOtherDeck(mid, path.route, 0.005)) return;
        railKeys.add(key);
        addTube('Larguero de acero', a, b, -0.16, 0.035, 0.18, '#8797a2');
        addTube('Ala superior del perfil', a, b, -0.075, 0.095, 0.025, '#b5c0c8');
        addTube('Ala inferior del perfil', a, b, -0.245, 0.095, 0.025, '#81919d');
      });
    }
    const count = Math.max(2, Math.min(12, Math.ceil(path.length / 2.6)));
    for (let index = 0; index < count; index++) {
      const distance = path.length < 0.7 ? path.length / 2 : 0.35 + (path.length - 0.7) * index / Math.max(1, count - 1);
      const point = conveyorLayout.pathPoint(config, distance, path.route);
      if (supportPoints.some(other => Math.pow(point.x - other.x, 2) + Math.pow(point.z - other.z, 2) < 0.3)) continue;
      supportPoints.push(point);
      [-1, 1].forEach(side => {
        const x = point.x - point.tz * side * (config.width / 2 + 0.09), z = point.z + point.tx * side * (config.width / 2 + 0.09);
        const leg = make.box('Tubo exterior de pata', 0.105, 0.46, 0.105, '#92a1ac', [x, -0.47, z]); leg.rotation.y = yaw(point); legs.add(leg);
        const inner = make.box('Tubo telescópico', 0.079, 0.36, 0.079, '#c0c9cf', [x, -0.76, z]); inner.rotation.y = yaw(point); legs.add(inner);
        legs.add(make.cylinder('Husillo nivelador', 0.018, 0.105, '#a1aeb8', [x, -0.96, z], 12));
        legs.add(make.cylinder('Pie antivibratorio', 0.09, 0.032, '#1e2930', [x, -0.984, z], 16, {metalness: 0.05, roughness: 0.85}));
        const knob = make.cylinder('Pomo de ajuste', 0.031, 0.045, '#1c2933', [x - point.tz * side * 0.071, -0.66, z + point.tx * side * 0.071], 8);
        knob.rotation.set(Math.PI / 2, yaw(point), 0, 'YXZ'); legs.add(knob);
      });
      const crossbar = make.box('Travesaño de soporte', 0.065, 0.065, config.width + 0.2, '#80919d', [point.x, -0.78, point.z]);
      crossbar.rotation.y = yaw(point); legs.add(crossbar);
      const upper = make.box('Travesaño inferior', 0.065, 0.09, config.width + 0.12, '#70838f', [point.x, -0.23, point.z]);
      upper.rotation.y = yaw(point); frame.add(upper);
    }
  });
  const rollerMaterial = material('#e7edf1', {name: 'Rodillos / Acero de los rodillos', roughness: 0.24, metalness: 0.87, map: rollerTexture()});
  const addRoller = point => {
    const key = [point.x.toFixed(3), point.z.toFixed(3), yaw(point).toFixed(2)].join(':');
    if (rollerKeys.has(key)) return;
    rollerKeys.add(key);
    const roller = make.cylinder('Rodillo', 0.065, config.width + 0.04, '#e7edf1', [point.x, -0.065, point.z], 24);
    roller.rotation.set(Math.PI / 2, yaw(point), 0, 'YXZ'); roller.material = rollerMaterial; rollers.add(roller);
    [-1, 1].forEach(side => {
      const lateral = side * (config.width / 2 + 0.048);
      const bearing = make.cylinder('Cojinete sellado', 0.039, 0.025, '#27343e', [point.x - point.tz * lateral, -0.065, point.z + point.tx * lateral], 10);
      bearing.rotation.copy(roller.rotation); frame.add(bearing);
      const boltOffset = side * (config.width / 2 + 0.135);
      const bolt = make.cylinder('Tuerca hexagonal', 0.013, 0.018, '#596b79', [point.x - point.tz * boltOffset, -0.10, point.z + point.tx * boltOffset], 6);
      bolt.rotation.copy(roller.rotation); frame.add(bolt);
    });
  };
  if (config.surface === 'belt') {
    const beltMaterial = material('#edf3f6', {name: 'Superficie de la cinta', map: beltTexture(), roughness: 0.88, metalness: 0.03, side: THREE.DoubleSide});
    paths.forEach((path, index) => {
      const top = new THREE.Mesh(ribbonGeometry(path.points, config.width, index ? -0.0005 : 0), beltMaterial);
      top.name = 'Cinta continua / ' + path.route; top.castShadow = true; top.receiveShadow = true;
      top.userData.industrialBelt = {textureAxis: 'x', metersPerRepeat: 1, direction: -1, scaleAxis: config.axis};
      rollers.add(top);
      const underside = new THREE.Mesh(ribbonGeometry(path.points, config.width, -0.105), material('#17232a', {name: 'Retorno de la cinta', roughness: 0.85, metalness: 0.1, side: THREE.DoubleSide}));
      underside.name = 'Retorno de cinta / ' + path.route; frame.add(underside);
    });
    Object.keys(conveyorLayout.ports(config)).forEach(name => addRoller(conveyorLayout.ports(config)[name]));
  } else {
    paths.forEach(path => {
      const count = Math.max(2, Math.min(640, Math.ceil(path.length / 0.15)));
      for (let index = 0; index < count; index++) {
        const point = conveyorLayout.pathPoint(config, 0.10 + Math.max(0, path.length - 0.2) * index / Math.max(1, count - 1), path.route);
        // Main rollers cover the transfer junction; avoid crossing rollers on
        // the branch until it has cleared that main surface.
        if (path.route === 'branch' && planarDistanceSq(point, paths[0].points) < Math.pow(config.width / 2, 2)) continue;
        addRoller(point);
      }
    });
  }
  // Rotation is a texture offset: all equal rollers can be one static collider
  // and one draw call, including on long/curved modules.
  const movingBelts = rollers.children.filter(node => node.userData.industrialBelt);
  movingBelts.forEach(node => rollers.remove(node)); batchDetails(rollers);
  rollers.children.forEach(node => { node.name = 'Rodillos agrupados'; node.userData.industrialRoller = {axis: 'y', radius: 0.065, texture: true}; });
  movingBelts.forEach(node => rollers.add(node));
  batchDetails(frame); batchDetails(legs);
  return {frame, legs, rollers};
}

/** Refresh only mechanical visuals, preserving every editable actor identity. */
export function refreshConveyorGeometry(root, value) {
  if (!root || root.userData.editorPrefabKey !== 'conveyor' || root.children.length < 10) return false;
  const config = conveyorConfig(value), previous = conveyorConfig(root.userData.industrialConveyorConfig || {});
  if (root.userData.industrialConveyorConfig && signature(config, CONVEYOR_STATE_FIELDS) === signature(previous, CONVEYOR_STATE_FIELDS)) return false;
  const nextAnchors = componentAnchors(config), oldAnchors = componentAnchors(previous);
  const oldGeometry = signature(previous, CONVEYOR_GEOMETRY_FIELDS), nextGeometry = signature(config, CONVEYOR_GEOMETRY_FIELDS);
  if (oldGeometry !== nextGeometry) {
    const parts = createPathMechanics(config), removed = [];
    [parts.frame, parts.legs, parts.rollers].forEach((group, index) => {
      const old = root.children[index]; preserveHiddenMechanical(old, group); removed.push(old);
      root.remove(old); root.add(group);
      // Object3D.add appends; restore exact persisted component order.
      root.children.splice(root.children.indexOf(group), 1); root.children.splice(index, 0, group);
    });
    disposeDetached(removed, root);
  }
  // Couple to the real terminal drum/first roller. Keep the motor parallel to
  // travel on the outside of curves and opposite a T branch; mirroring only Z
  // leaves its body pointing into the module on either side of the conveyor.
  const motor = root.children[3], motorPoint = conveyorLayout.pathPoint(config, config.surface === 'belt' ? 0 : 0.10);
  const motorSide = config.layout === 'curveRight' || config.layout === 'tee' && config.branchSide === 'right' ? -1 : 1;
  const motorOffset = motorSide * (config.width / 2 + 0.055);
  motor.rotation.set(0, yaw(motorPoint), 0);
  motor.scale.set(1, 1, motorSide);
  motor.position.set(motorPoint.x - motorPoint.tz * motorOffset, -0.065, motorPoint.z + motorPoint.tx * motorOffset);
  const entry = root.children[4], exit = root.children[5], panel = root.children[6];
  setAnchor(entry, nextAnchors.entry, oldAnchors.entry); setAnchor(exit, nextAnchors.exit, oldAnchors.exit);
  setAnchor(panel, nextAnchors.panel, oldAnchors.panel);
  [entry, exit].forEach(sensor => {
    resizeSensorVisual(sensor, config.width);
    setAutoVisible(sensor, config.withSensors, previous.withSensors);
  });
  setAutoVisible(panel, config.withPanel, previous.withPanel);
  root.userData.industrialConveyorConfig = Object.assign({}, config);
  enforceConveyorOptions(root, config);
  return true;
}

function enforceConveyorOptions(root, value) {
  if (!root || root.userData.editorPrefabKey !== 'conveyor' || root.children.length < 10) return;
  const config = conveyorConfig(value);
  if (!config.withSensors) { root.children[4].visible = false; root.children[5].visible = false; }
  if (!config.withPanel) root.children[6].visible = false;
  root.children[7].visible = false; root.children[8].visible = false; root.children[9].visible = false;
}

export function createIndustrialPrefab(kind, variant, value) {
  if (kind === 'palletQueue') {
    if (variant !== undefined) throw new Error('Variante de almacén con estibas no compatible.');
    return palletQueueEquipment(value);
  }
  if (kind === 'processor') {
    if (variant !== undefined && !['combiner', 'separator'].includes(variant)) throw new Error('Variante de proceso no compatible.');
    return processorEquipment(variant, value);
  }
  if (kind === 'source') {
    if (variant !== undefined && variant !== 'queue') throw new Error('Variante de generador no compatible.');
    return sourceEquipment(variant, value);
  }
  let config = value;
  if (kind === 'conveyor' && variant !== undefined) {
    const preset = conveyorPresets.find(item => item.id === variant);
    if (!preset) throw new Error('Variante de transportador no compatible.');
    config = Object.assign({}, preset.config, value || {});
  }
  const object = createBaseIndustrialPrefab(kind, kind === 'conveyor' ? undefined : variant);
  if (kind !== 'conveyor') return object;
  if (variant) object.userData.editorPrefabVariant = variant;
  const behavior = object.userData.editorDefaultBehaviors.find(item => item.type === 'conveyor');
  Object.assign(behavior, config || {});
  if (behavior.role === 'start') object.traverse(node => {
    (node.userData.editorDefaultBehaviors || []).forEach(component => { if (component.type === 'control') component.scope = 'segment'; });
  });
  refreshConveyorGeometry(object, behavior);
  return object;
}

// SceneDocument already receives this factory in headless tests and production.
// Keeping refresh on the factory avoids another module/import injection layer.
createIndustrialPrefab.refresh = (object, config) => {
  if (object && object.userData.editorPrefabKey === 'source') return refreshSourceGeometry(object, config);
  if (object && object.userData.editorPrefabKey === 'processor') return refreshProcessorGeometry(object, config);
  if (object && object.userData.editorPrefabKey === 'palletQueue') return refreshPalletQueueGeometry(object, config);
  return refreshConveyorGeometry(object, config);
};
createIndustrialPrefab.enforceOptions = enforceConveyorOptions;

