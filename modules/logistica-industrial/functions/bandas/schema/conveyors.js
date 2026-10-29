/* Geometry-independent conveyor paths. Shared by authoring, rendering and simulation. */
'use strict';

const presetVariants = ['roller-start', 'roller-middle', 'roller-end', 'belt-start', 'belt-middle', 'belt-end',
  'roller-curve-left', 'roller-curve-right', 'belt-curve-left', 'belt-curve-right', 'roller-tee-split', 'roller-tee-merge', 'belt-tee-split', 'belt-tee-merge'];
require('./conveyor-equipment.js').EQUIPMENT.forEach(equipment => { if (!presetVariants.includes(equipment.variant)) presetVariants.push(equipment.variant); });

// Paths are evaluated many times per product and fixed step. Normalize only
// the geometry fields here; copying every PLC/catalogue field is unnecessary.
function pathSettings(value = {}) {
  const positive = (key, fallback) => typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] > 0 ? value[key] : fallback;
  const width = positive('width', 1);
  return {
    layout: ['straight', 'curveLeft', 'curveRight', 'tee'].includes(value.layout) ? value.layout : 'straight',
    axis: value.axis === 'z' ? 'z' : 'x', length: positive('length', 4), width,
    radius: Math.max(width / 2 + 0.1, positive('radius', 1.5)),
    curveAngle: Math.max(15, Math.min(180, positive('curveAngle', 90))),
    rise: typeof value.rise === 'number' && Number.isFinite(value.rise) ? value.rise : 0,
    gradeProfile: value.gradeProfile === 'smooth' ? 'smooth' : 'linear',
    junctionMode: value.junctionMode === 'merge' ? 'merge' : 'split', branchSide: value.branchSide === 'right' ? 'right' : 'left',
    mechanism: value.mechanism, mergeAngle: value.mergeAngle
  };
}
function settings(value = {}) {
  const geometry = pathSettings(value);
  // Preserve the public settings contract, including arbitrary caller fields.
  delete geometry.mechanism; delete geometry.mergeAngle;
  return Object.assign({}, value, geometry);
}

function pathBranches(config) { return config && config.layout === 'tee' ? ['main', 'branch'] : ['main']; }
function teeRadius(config) { return Math.max(0.05, Math.min(config.width * 0.75, config.length / 2 - 0.05)); }
function pathLength(value, route = 'main') {
  return rawLength(pathSettings(value), route);
}
function rawLength(config, route = 'main') {
  if (config.layout === 'curveLeft' || config.layout === 'curveRight') return config.radius * config.curveAngle * Math.PI / 180;
  if (config.layout === 'tee' && route === 'branch') { if (['liftTransfer', 'turntable', 'pusher', 'steer', 'distributor', 'merge'].includes(config.mechanism)) return config.length; const radius = teeRadius(config); return config.length - radius * 2 + radius * Math.PI / 2; }
  return config.length;
}

function rawPoint(config, distance, route) {
  const length = rawLength(config, route), s = Math.max(0, Math.min(length, distance));
  let x, z, tx, tz;
  if (config.layout === 'curveLeft' || config.layout === 'curveRight') {
    const side = config.layout === 'curveLeft' ? -1 : 1, angle = config.curveAngle * Math.PI / 180;
    const phi = s / config.radius;
    x = config.radius * (Math.sin(phi) - Math.sin(angle) / 2);
    z = side * config.radius * (1 - Math.cos(phi) - (1 - Math.cos(angle)) / 2);
    tx = Math.cos(phi); tz = side * Math.sin(phi);
  } else if (config.layout === 'tee' && route === 'branch' && ['liftTransfer', 'turntable', 'pusher', 'steer', 'distributor', 'merge'].includes(config.mechanism)) {
    const side = config.branchSide === 'left' ? -1 : 1, half = config.length / 2;
    if (config.junctionMode === 'merge') {
      if (s <= half) {
        const angle = (config.mechanism === 'merge' ? config.mergeAngle || 45 : 90) * Math.PI / 180;
        x = (s - half) * Math.cos(angle); z = side * (half - s) * Math.sin(angle); tx = Math.cos(angle); tz = -side * Math.sin(angle);
      }
      else { x = s - half; z = 0; tx = 1; tz = 0; }
    } else if (s <= half) { x = s - half; z = 0; tx = 1; tz = 0; }
    else { x = 0; z = side * (s - half); tx = 0; tz = side; }
  } else if (config.layout === 'tee' && route === 'branch') {
    const side = config.branchSide === 'left' ? -1 : 1, radius = teeRadius(config);
    const leg = config.length / 2 - radius, arc = radius * Math.PI / 2;
    if (config.junctionMode === 'merge') {
      if (s <= leg) { x = 0; z = side * (config.length / 2 - s); tx = 0; tz = -side; }
      else if (s < leg + arc) { const phi = (s - leg) / radius; x = radius * (1 - Math.cos(phi)); z = side * radius * (1 - Math.sin(phi)); tx = Math.sin(phi); tz = -side * Math.cos(phi); }
      else { x = radius + s - leg - arc; z = 0; tx = 1; tz = 0; }
    } else {
      if (s <= leg) { x = -config.length / 2 + s; z = 0; tx = 1; tz = 0; }
      else if (s < leg + arc) { const phi = (s - leg) / radius; x = -radius + radius * Math.sin(phi); z = side * radius * (1 - Math.cos(phi)); tx = Math.cos(phi); tz = side * Math.sin(phi); }
      else { x = 0; z = side * (radius + s - leg - arc); tx = 0; tz = side; }
    }
  } else { x = -config.length / 2 + s; z = 0; tx = 1; tz = 0; }
  const extra = distance < 0 ? distance : distance > length ? distance - length : 0;
  x += tx * extra; z += tz * extra;
  // A smooth transition has horizontal tangents at both interfaces. The same
  // derivative drives ports, roller frames and gravity, rather than rendering
  // a curved deck over a simulation that still assumes one constant slope.
  const t = s / length, smooth = config.gradeProfile === 'smooth';
  const y = config.mechanism === 'elevator' ? s > length / 2 ? config.rise : 0 : config.rise * (smooth ? t * t * (3 - 2 * t) : t);
  const ty = config.mechanism === 'elevator' ? 0 : config.rise / length * (smooth ? 6 * t * (1 - t) : 1);
  if (config.axis === 'z') return {x: -z, y, z: x, tx: -tz, ty, tz: tx};
  return {x, y, z, tx, ty, tz};
}

function pathPoint(value, distance, route = 'main') { return rawPoint(pathSettings(value), Number.isFinite(distance) ? distance : 0, route); }
function ports(value) {
  const config = settings(value), result = {
    input: Object.assign(rawPoint(config, 0, 'main'), {incoming: true, route: 'main'}),
    output: Object.assign(rawPoint(config, rawLength(config), 'main'), {incoming: false, route: 'main'})
  };
  if (config.layout === 'tee') {
    const incoming = config.junctionMode === 'merge';
    result.branch = Object.assign(rawPoint(config, incoming ? 0 : rawLength(config, 'branch'), 'branch'), {incoming, route: 'branch'});
  }
  Object.entries(result).forEach(([name, port]) => Object.assign(port, {width: config.width, height: port.y || 0,
    surface: config.surface || 'rollers', drive: config.drive || 'motor', direction: port.incoming ? 'input' : 'output',
    loadClass: config.surface === 'chains' || /pallet/.test(config.equipmentId || '') ? 'pallet' : 'unit',
    coordination: ['ready', 'occupied', 'transferComplete']}, config.mechanism === 'liftTransfer' && config.surface === 'chains' ? {surface: name === 'branch' ? 'chains' : 'rollers', transferRequirement: 'pallet-runners'} : {}));
  return result;
}

// A didactic admission envelope, not a certification of contact dynamics or a
// commercial load rating. Old scenes without a declared equipment identity keep
// their historical geometric envelope until the user adopts a catalogue model.
function productCompatibility(value = {}, product = {}) {
  const config = settings(value), reasons = [], add = (code, message) => reasons.push({code, message});
  const width = Math.abs(product.depth || product.width || 0), length = Math.abs(product.width || 0), height = Math.abs(product.height || 0);
  if (width > config.width + 0.00001) add('width', 'La carga supera el ancho útil del transportador.');
  if (!config.equipmentId) return {ok: !reasons.length, reasons, simulationLevel: 'kinematic'};
  const pallet = product.loadMode === 'pallet' || product.productType === 'pallet';
  const palletEquipment = config.surface === 'chains' || /pallet/.test(config.equipmentId);
  if (pallet !== palletEquipment) add('load-class', pallet ? 'Esta variante transporta unidades; utiliza un transportador para pallets.' : 'Esta variante necesita una carga sobre pallet.');
  if (height > (config.clearance || 3)) add('clearance', 'La carga supera la altura libre configurada.');
  if (product.mass > (config.maxLoad || 50)) add('mass', 'La masa de la carga supera la capacidad configurada.');
  if (['rollers', 'chains'].includes(config.surface) && ['unstable', 'flexible'].includes(product.base)) add('base', 'La base necesita una superficie continua o una bandeja de soporte.');
  if (config.surface === 'rollers' && length < 3 * (config.rollerPitch || .15) - 0.00001) add('roller-support', 'La base no mantiene tres rodillos en apoyo; reduce el paso de rodillos o utiliza una banda.');
  if (config.surface === 'chains' && product.base !== 'runners') add('pallet-base', 'Las cadenas requieren patines de pallet alineados con el transporte.');
  if (/curve/i.test(config.layout) && Math.hypot(length, width) / 2 > config.radius - config.width / 2) add('curve-radius', 'El radio interior no admite la envolvente de esta carga.');
  const slope = Math.abs(Math.atan2(config.rise * (config.gradeProfile === 'smooth' ? 1.5 : 1), rawLength(config)));
  if (config.mechanism !== 'elevator' && slope > Math.atan2(Math.max(.001, length), Math.max(.001, height))) add('stability', 'La proporción y la pendiente no cumplen el límite didáctico de estabilidad.');
  if (config.mechanism !== 'elevator' && slope > Math.PI / 9 && !config.cleats && config.drive !== 'gravity') add('slope', 'Para esta pendiente utiliza tacos y un producto compatible.');
  if (config.drive === 'gravity' && pallet) add('gravity-pallet', 'El modelo didáctico de gravedad admite unidades; usa un módulo específico para pallets.');
  return {ok: !reasons.length, reasons, simulationLevel: 'kinematic'};
}

function closestPath(value, x, z, route = 'main') {
  const config = pathSettings(value), length = rawLength(config, route);
  const steps = config.layout === 'straight' || route === 'main' && config.layout === 'tee' ? 1 : Math.max(32, Math.min(180, Math.ceil(length / 0.025)));
  let best = null, previous = rawPoint(config, 0, route);
  for (let index = 1; index <= steps; index++) {
    const next = rawPoint(config, length * index / steps, route), dx = next.x - previous.x, dz = next.z - previous.z;
    const fraction = Math.max(0, Math.min(1, ((x - previous.x) * dx + (z - previous.z) * dz) / (dx * dx + dz * dz || 1)));
    const distance = length * (index - 1 + fraction) / steps, point = rawPoint(config, distance, route);
    const ex = x - point.x, ez = z - point.z, distanceSq = ex * ex + ez * ez;
    if (!best || distanceSq < best.distanceSq) best = Object.assign({distance, distanceSq, lateral: -point.tz * ex + point.tx * ez}, point);
    previous = next;
  }
  return best;
}

function connections(config = {}) {
  const result = [];
  if (config.outputId) result.push({port: 'output', targetId: config.outputId, targetPort: config.outputPort === 'branch' ? 'branch' : 'input'});
  if (config.layout === 'tee' && config.junctionMode !== 'merge' && config.branchId) result.push({port: 'branch', targetId: config.branchId, targetPort: config.branchPort === 'branch' ? 'branch' : 'input'});
  return result;
}

module.exports = {presetVariants, settings, pathBranches, pathLength, pathPoint, ports, closestPath, connections,
  productCompatibility, equipment: require('./conveyor-equipment.js'),
  sourceLayout: require('../../flujo-materiales/schema/productSources.js').layout, processorLayout: require('../../procesamiento/schema/processors.js').layout,
  palletQueueLayout: require('../../almacenamiento/schema/palletQueues.js').layout};
