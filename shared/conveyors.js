/* Geometry-independent conveyor paths. Shared by authoring, rendering and simulation. */
'use strict';

const presetVariants = ['roller-start', 'roller-middle', 'roller-end', 'belt-start', 'belt-middle', 'belt-end',
  'roller-curve-left', 'roller-curve-right', 'belt-curve-left', 'belt-curve-right', 'roller-tee-split', 'roller-tee-merge', 'belt-tee-split', 'belt-tee-merge'];

function settings(value = {}) {
  const positive = (key, fallback) => typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] > 0 ? value[key] : fallback;
  const width = positive('width', 1);
  return Object.assign({}, value, {
    layout: ['straight', 'curveLeft', 'curveRight', 'tee'].includes(value.layout) ? value.layout : 'straight',
    axis: value.axis === 'z' ? 'z' : 'x', length: positive('length', 4), width,
    radius: Math.max(width / 2 + 0.1, positive('radius', 1.5)),
    curveAngle: Math.max(15, Math.min(180, positive('curveAngle', 90))),
    junctionMode: value.junctionMode === 'merge' ? 'merge' : 'split', branchSide: value.branchSide === 'right' ? 'right' : 'left'
  });
}

function pathBranches(config) { return settings(config).layout === 'tee' ? ['main', 'branch'] : ['main']; }
function teeRadius(config) { return Math.max(0.05, Math.min(config.width * 0.75, config.length / 2 - 0.05)); }
function pathLength(value, route = 'main') {
  const config = settings(value);
  if (config.layout === 'curveLeft' || config.layout === 'curveRight') return config.radius * config.curveAngle * Math.PI / 180;
  if (config.layout === 'tee' && route === 'branch') { const radius = teeRadius(config); return config.length - radius * 2 + radius * Math.PI / 2; }
  return config.length;
}

function rawPoint(config, distance, route) {
  const length = pathLength(config, route), s = Math.max(0, Math.min(length, distance));
  let x, z, tx, tz;
  if (config.layout === 'curveLeft' || config.layout === 'curveRight') {
    const side = config.layout === 'curveLeft' ? -1 : 1, angle = config.curveAngle * Math.PI / 180;
    const phi = s / config.radius;
    x = config.radius * (Math.sin(phi) - Math.sin(angle) / 2);
    z = side * config.radius * (1 - Math.cos(phi) - (1 - Math.cos(angle)) / 2);
    tx = Math.cos(phi); tz = side * Math.sin(phi);
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
  if (config.axis === 'z') return {x: -z, z: x, tx: -tz, tz: tx};
  return {x, z, tx, tz};
}

function pathPoint(value, distance, route = 'main') { return rawPoint(settings(value), Number.isFinite(distance) ? distance : 0, route); }
function ports(value) {
  const config = settings(value), result = {
    input: Object.assign(pathPoint(config, 0), {incoming: true, route: 'main'}),
    output: Object.assign(pathPoint(config, pathLength(config)), {incoming: false, route: 'main'})
  };
  if (config.layout === 'tee') {
    const incoming = config.junctionMode === 'merge';
    result.branch = Object.assign(pathPoint(config, incoming ? 0 : pathLength(config, 'branch'), 'branch'), {incoming, route: 'branch'});
  }
  return result;
}

function closestPath(value, x, z, route = 'main') {
  const config = settings(value), length = pathLength(config, route);
  const steps = config.layout === 'straight' || route === 'main' && config.layout === 'tee' ? 1 : Math.max(32, Math.min(180, Math.ceil(length / 0.025)));
  let best = null, previous = pathPoint(config, 0, route);
  for (let index = 1; index <= steps; index++) {
    const next = pathPoint(config, length * index / steps, route), dx = next.x - previous.x, dz = next.z - previous.z;
    const fraction = Math.max(0, Math.min(1, ((x - previous.x) * dx + (z - previous.z) * dz) / (dx * dx + dz * dz || 1)));
    const distance = length * (index - 1 + fraction) / steps, point = pathPoint(config, distance, route);
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
  sourceLayout: require('./productSources.js').layout, processorLayout: require('./processors.js').layout,
  palletQueueLayout: require('./palletQueues.js').layout};
