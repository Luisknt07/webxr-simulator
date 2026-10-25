import * as THREE from 'three';
import schema from '../../shared/behaviors.js';

const TAG = 'Presentación industrial del piso · v1';
const TYPES = ['conveyor', 'source', 'processor', 'palletQueue'];
const GENERATED_WEAR = 'industrial-floor-v1-';
const round = value => Math.round(value * 1000000) / 1000000;
const grow = (box, margin) => [box[0] - margin, box[1] - margin, box[2] + margin, box[3] + margin];
const intersects = (a, b, margin = 0) => a[0] < b[2] + margin && a[2] > b[0] - margin && a[1] < b[3] + margin && a[3] > b[1] - margin;
const center = box => [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
const rectangle = (x, z, width, depth) => [x - width / 2, z - depth / 2, x + width / 2, z + depth / 2].map(round);
const inside = (box, floor, margin = 0) => box[0] >= floor[0] + margin && box[1] >= floor[1] + margin && box[2] <= floor[2] - margin && box[3] <= floor[3] - margin;
function visible(object, boundary) { for (let node = object; node; node = node.parent) { if (!node.visible) return false; if (node === boundary) break; } return true; }
function config(document, object) { return document.getBehaviors(object).find(value => TYPES.includes(value.type)); }

/** Every geometry corner is transformed by inverse(roomWorld)*meshWorld.
 * Rotated roots, nested actors and nonuniform scales never use a world AABB. */
function localBounds(object, inverseRoom) {
  const bounds = new THREE.Box3(); object.updateWorldMatrix(true, true);
  const visit = node => {
    if (!node.visible || node.userData.editorHelper || node.userData.editorRuntimeHelper || node.userData.editorDecal || node.userData.industrialSensorVolume || node.userData.editorGeometryReplaced) return;
    const geometry = node.geometry, positions = geometry && geometry.attributes && geometry.attributes.position;
    if (geometry && (!positions || positions.count)) {
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      if (geometry.boundingBox && !geometry.boundingBox.isEmpty()) bounds.union(geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverseRoom, node.matrixWorld)));
    }
    node.children.forEach(visit);
  };
  visit(object); return bounds;
}
function freeSegments(minimum, maximum, occupied) {
  const sorted = occupied.filter(row => row[1] > minimum && row[0] < maximum).sort((a, b) => a[0] - b[0]);
  const result = []; let start = minimum;
  sorted.forEach(([a, b]) => { if (a > start) result.push([start, Math.min(a, maximum)]); start = Math.max(start, b); });
  if (start < maximum) result.push([start, maximum]); return result.filter(row => row[1] - row[0] >= 2.8);
}

function functionalBounds(cfg, matrix) {
  const bounds = new THREE.Box3(), include = (x, y, z) => bounds.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(matrix));
  if (cfg.type === 'conveyor') schema.conveyorLayout.pathBranches(cfg).forEach(route => {
    const length = schema.conveyorLayout.pathLength(cfg, route), count = cfg.layout === 'straight' ? 1 : 64, half = cfg.width / 2 + .14;
    for (let index = 0; index <= count; index++) { const point = schema.conveyorLayout.pathPoint(cfg, length * index / count, route); for (const side of [-1, 1]) include(point.x - point.tz * half * side, point.y || 0, point.z + point.tx * half * side); }
  });
  else {
    const layout = cfg.type === 'source' ? schema.conveyorLayout.sourceLayout(cfg) : cfg.type === 'processor' ? schema.conveyorLayout.processorLayout(cfg) : schema.conveyorLayout.palletQueueLayout(cfg);
    for (const x of [-1, 1]) for (const z of [-1, 1]) include(x * (layout.length / 2 + .14), 0, z * (layout.width / 2 + .14));
  }
  return bounds;
}

/** Optional light migration API: plans from serializable addition records
 * without instantiating a prefab or GPU resource. Values are room-local. */
export function planIndustrialFloorFromRecords(records, options = {}) {
  const compose = row => new THREE.Matrix4().compose(new THREE.Vector3().fromArray(row.position || [0, 0, 0]), new THREE.Quaternion().fromArray(row.quaternion || [0, 0, 0, 1]), new THREE.Vector3().fromArray(row.scale || [1, 1, 1]));
  const floor = options.floorRecord || records.find(row => /(?:piso.*(?:industrial|hormig)|suelo del nivel)/i.test(row.name || '') && ['box', 'plane'].includes((row.descriptor || {}).type));
  let floorBox = new THREE.Box3();
  if (floor) { const primitive = floor.descriptor.type === 'plane' ? new THREE.Box3(new THREE.Vector3(-1, -1, 0), new THREE.Vector3(1, 1, 0)) : new THREE.Box3(new THREE.Vector3(-.5, -.5, -.5), new THREE.Vector3(.5, .5, .5)); floorBox.copy(primitive).applyMatrix4(compose(floor)); }
  const machines = records.map(row => {
    const cfg = (row.behaviors || []).find(value => TYPES.includes(value.type)); if (!cfg || row.visible === false) return null;
    const matrix = compose(row), box = functionalBounds(cfg, matrix); if (box.isEmpty()) return null;
    if (cfg.withPanel) { const p = new THREE.Vector3(0, 0, cfg.width / 2 + .8).applyMatrix4(matrix); box.expandByPoint(p.clone().add(new THREE.Vector3(.5, 0, .5))).expandByPoint(p.clone().sub(new THREE.Vector3(.5, 0, .5))); }
    return {id: row.id, type: cfg.type, config: cfg, box: [box.min.x, box.min.z, box.max.x, box.max.z].map(round)};
  }).filter(Boolean);
  if (floorBox.isEmpty()) { machines.forEach(row => floorBox.expandByPoint(new THREE.Vector3(row.box[0], 0, row.box[1])).expandByPoint(new THREE.Vector3(row.box[2], 0, row.box[3]))); floorBox.expandByVector(new THREE.Vector3(8, 0, 8)); }
  if (!machines.length) return {plan: null, machines, floorRecord: floor};
  return Object.assign(planIndustrialFloor(machines, options.bounds || [floorBox.min.x, floorBox.min.z, floorBox.max.x, floorBox.max.z], options.floorY === undefined ? floorBox.max.y : options.floorY, options), {machines, floorRecord: floor});
}

function groupedZones(machines, lines, floor) {
  const byId = new Map(machines.map(row => [row.id, row])), used = new Set(), groups = [];
  (lines || []).forEach(line => {
    const rows = (line.objects || []).map(object => byId.get(object.userData ? object.userData.editorId : object.id || object)).filter(Boolean);
    if (rows.length) { rows.forEach(row => used.add(row.id)); groups.push(rows); }
  });
  const parent = new Map(machines.map(row => [row.id, row.id]));
  const find = id => { let root = id; while (parent.get(root) !== root) root = parent.get(root); return root; };
  machines.forEach(row => ['outputId', 'branchId'].forEach(key => { const target = row.config[key]; if (parent.has(target)) parent.set(find(target), find(row.id)); }));
  const remaining = new Map(); machines.filter(row => !used.has(row.id)).forEach(row => { const key = find(row.id); if (!remaining.has(key)) remaining.set(key, []); remaining.get(key).push(row); }); groups.push(...remaining.values());
  return groups.slice(0, 64).map(rows => {
    const box = [Infinity, Infinity, -Infinity, -Infinity]; rows.forEach(row => { box[0] = Math.min(box[0], row.box[0]); box[1] = Math.min(box[1], row.box[1]); box[2] = Math.max(box[2], row.box[2]); box[3] = Math.max(box[3], row.box[3]); });
    return [Math.max(floor[0] + .6, box[0] - 1), Math.max(floor[1] + .6, box[1] - 1), Math.min(floor[2] - .6, box[2] + 1), Math.min(floor[3] - .6, box[3] + 1)].map(round);
  }).filter(box => box[2] > box[0] && box[3] > box[1]);
}

/** Geometry-independent planning is also available to migration tools. Boxes
 * are conservative room-local footprints, including the real material path. */
export function planIndustrialFloor(machines, floorBounds, floorY = 0, options = {}) {
  const floor = floorBounds.map(round), clearance = .60, width = 1.6, obstacles = machines.map(row => row.box).concat(options.obstacles || []).map(box => grow(box, clearance));
  const plan = {type: 'industrialFloor', version: 1, bounds: floor, floorY: round(floorY), walkways: [], zones: groupedZones(machines, options.lines, floor), bays: [], arrows: [], labels: [], signs: [], crossings: []};
  const add = (key, value) => { if (plan[key].length < schema.industrialFloor.LIMITS[key]) plan[key].push(value.map(round)); };
  const lane = axis => {
    const across = axis === 'z' ? [floor[0], floor[2]] : [floor[1], floor[3]], along = axis === 'z' ? [floor[1], floor[3]] : [floor[0], floor[2]];
    const candidates = [0, (across[0] + across[1]) / 2, across[0] + 2.2, across[1] - 2.2];
    for (let value = across[0] + 3; value < across[1] - 2; value += 3) candidates.push(value);
    const choices = [...new Set(candidates.map(round))].filter(value => value > across[0] + 1.2 && value < across[1] - 1.2).map(value => {
      const blocked = obstacles.filter(box => axis === 'z' ? value + width / 2 > box[0] && value - width / 2 < box[2] : value + width / 2 > box[1] && value - width / 2 < box[3]).map(box => axis === 'z' ? [box[1], box[3]] : [box[0], box[2]]);
      const segments = freeSegments(along[0] + 1.5, along[1] - 1.5, blocked);
      return {value, segments, score: segments.reduce((sum, row) => sum + row[1] - row[0], 0) - Math.abs(value - (across[0] + across[1]) / 2) * .14};
    }).sort((a, b) => b.score - a.score);
    const chosen = [];
    choices.forEach(choice => { if (chosen.length < 2 && choice.score > 3 && chosen.every(row => Math.abs(row.value - choice.value) > 5)) chosen.push(choice); });
    chosen.forEach(choice => choice.segments.forEach(([a, b]) => {
      const box = axis === 'z' ? rectangle(choice.value, (a + b) / 2, width, b - a) : rectangle((a + b) / 2, choice.value, b - a, width);
      if (!obstacles.some(obstacle => intersects(box, obstacle, -.00001))) add('walkways', box);
    }));
  };
  lane('z'); lane('x');
  const vertical = plan.walkways.filter(box => box[3] - box[1] > box[2] - box[0]), horizontal = plan.walkways.filter(box => box[3] - box[1] <= box[2] - box[0]);
  vertical.forEach(a => horizontal.forEach(b => {
    const x = center(a)[0], z = center(b)[1], crossing = rectangle(x, z, 2.4, 1.5);
    if (intersects(a, b) && inside(crossing, floor, .6) && !obstacles.some(box => intersects(crossing, box))) add('crossings', crossing);
  }));
  plan.walkways.forEach((box, index) => {
    const [x, z] = center(box), alongZ = box[3] - box[1] > box[2] - box[0], length = alongZ ? box[3] - box[1] : box[2] - box[0], yaw = alongZ ? 0 : -Math.PI / 2;
    for (let position = 2; position < length - 1; position += 9) add('arrows', [alongZ ? x : box[0] + position, alongZ ? box[1] + position : z, yaw]);
    if (length > 5) add('labels', [x, z, alongZ ? -Math.PI / 2 : 0, 2.6, .55, 4]);
    if (index < 4 && length > 5) {
      const point = alongZ ? [x + 1.05, box[1] + .8] : [box[0] + .8, z + 1.05];
      const stand = rectangle(point[0], point[1], .45, .45); if (inside(stand, floor, .6) && !obstacles.some(obstacle => intersects(stand, obstacle)) && !plan.walkways.some(walkway => intersects(stand, walkway))) add('signs', [point[0], point[1], yaw, 0, 4]);
    }
  });
  const occupiedBays = [];
  const chooseBay = (row, bayWidth, bayDepth) => {
    const [x, z] = center(row.box), gap = .85;
    const choices = [rectangle(row.box[0] - gap - bayWidth / 2, z, bayWidth, bayDepth), rectangle(row.box[2] + gap + bayWidth / 2, z, bayWidth, bayDepth), rectangle(x, row.box[1] - gap - bayDepth / 2, bayWidth, bayDepth), rectangle(x, row.box[3] + gap + bayDepth / 2, bayWidth, bayDepth)];
    return choices.filter(box => inside(box, floor, 1) && !obstacles.some(obstacle => intersects(box, obstacle)) && !plan.walkways.some(walkway => intersects(box, walkway, .15)) && !occupiedBays.some(other => intersects(box, other, .3))).sort((a, b) => {
      const distance = box => { const p = center(box); return Math.min(...plan.walkways.map(walkway => { const q = center(walkway); return Math.hypot(p[0] - q[0], p[1] - q[1]); }), 100); }; return distance(a) - distance(b);
    })[0];
  };
  const destinations = machines.filter(row => ['source', 'palletQueue', 'processor'].includes(row.type));
  destinations.filter((row, index) => index % Math.max(1, Math.ceil(destinations.length / 12)) === 0).slice(0, 12).forEach(row => {
    const bay = chooseBay(row, row.type === 'palletQueue' ? 3.2 : 2.6, row.type === 'processor' ? 1.4 : 2.1); if (!bay) return;
    occupiedBays.push(bay); add('bays', bay); const p = center(bay), label = row.type === 'source' ? 1 : row.type === 'palletQueue' ? 2 : 3;
    add('labels', [p[0], p[1], 0, Math.min(2.7, bay[2] - bay[0] - .2), .55, label]);
    const sign = rectangle(bay[0] - .4, bay[1] + .3, .35, .35); if (inside(sign, floor, .5) && !obstacles.some(box => intersects(box, sign)) && !plan.walkways.some(walkway => intersects(walkway, sign))) add('signs', [bay[0] - .4, bay[1] + .3, 0, 1, label]);
  });
  plan.zones.forEach(box => {
    const labelBox = rectangle(center(box)[0], box[3] - .45, 2.8, .5);
    if (inside(labelBox, floor, .5) && !obstacles.some(obstacle => intersects(labelBox, obstacle)) && !plan.walkways.some(walkway => intersects(labelBox, walkway))) add('labels', [center(labelBox)[0], center(labelBox)[1], 0, 2.8, .5, 0]);
  });
  return {plan: schema.industrialFloor.normalize(plan), obstacles, clearance, occupiedBays};
}

export function deriveIndustrialFloorPresentation(document, roomId, options = {}) {
  const root = document.getRoot(roomId); if (!root) throw new Error('Nivel industrial desconocido.'); root.updateWorldMatrix(true, true);
  const inverse = new THREE.Matrix4().getInverse(root.matrixWorld), objects = document.getObjects(roomId);
  const candidates = objects.filter(object => /(?:piso.*(?:industrial|hormig)|suelo del nivel)/i.test(object.name) && object.userData.editorDescriptor && ['box', 'plane'].includes(object.userData.editorDescriptor.type)).map(object => ({object, box: localBounds(object, inverse)})).filter(row => !row.box.isEmpty()).sort((a, b) => (b.box.max.x - b.box.min.x) * (b.box.max.z - b.box.min.z) - (a.box.max.x - a.box.min.x) * (a.box.max.z - a.box.min.z));
  const floor = options.floorObject || candidates.length && candidates[0].object;
  const machines = (options.machines || objects).filter(object => config(document, object)).map(object => {
    const cfg = config(document, object), matrix = new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld), box = localBounds(object, inverse); box.union(functionalBounds(cfg, matrix)); if (box.isEmpty()) return null;
    let motor = object.getObjectByName('Motorreductor'), motorPoint = motor && visible(motor, object) ? motor.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse).toArray() : null;
    const forward = new THREE.Vector3(1, 0, 0).transformDirection(matrix);
    return {id: object.userData.editorId, type: cfg.type, config: cfg, object, box: [box.min.x, box.min.z, box.max.x, box.max.z].map(round), motorPoint, center: box.getCenter(new THREE.Vector3()).toArray(), yaw: Math.atan2(-forward.x, -forward.z)};
  }).filter(Boolean);
  if (!machines.length) return {floor, machines, plan: null, report: {reason: 'No hay equipos industriales en este nivel.'}};
  let floorBox = floor && localBounds(floor, inverse);
  if (!floorBox || floorBox.isEmpty()) { floorBox = new THREE.Box3(); machines.forEach(row => floorBox.expandByPoint(new THREE.Vector3(row.box[0], 0, row.box[1])).expandByPoint(new THREE.Vector3(row.box[2], 0, row.box[3]))); floorBox.expandByVector(new THREE.Vector3(8, 0, 8)); }
  const machineIds = new Set(machines.map(row => row.id));
  const groundFixtures = objects.filter(object => object !== floor && !machineIds.has(object.userData.editorId) && object.userData.editorDescriptor && object.userData.editorDescriptor.type !== 'industrialFloor').map(object => ({object, headLevelPanel: document.getBehaviors(object).some(value => ['lineMonitor', 'info'].includes(value.type))})).filter(row => row.headLevelPanel || /(?:pedestal|soporte|base.*monitor|columna|escalón|plataforma|pórtico|poste|protección.*muelle)/i.test(row.object.name)).map(row => ({box: localBounds(row.object, inverse), maximumBottom: floorBox.max.y + (row.headLevelPanel ? 1.85 : .3)})).filter(row => !row.box.isEmpty() && row.box.min.y <= row.maximumBottom && row.box.max.y > floorBox.max.y + .07 && row.box.max.x - row.box.min.x < 8 && row.box.max.z - row.box.min.z < 8).map(row => [row.box.min.x, row.box.min.z, row.box.max.x, row.box.max.z].map(round));
  const planned = planIndustrialFloor(machines, [floorBox.min.x, floorBox.min.z, floorBox.max.x, floorBox.max.z], floorBox.max.y, Object.assign({}, options, {obstacles: (options.obstacles || []).concat(groundFixtures)}));
  return Object.assign(planned, {floor, floorBox, machines, root, inverseRoom: inverse, report: {machines: machines.length, groundFixtures: groundFixtures.length, walkways: planned.plan.walkways.length, zones: planned.plan.zones.length, bays: planned.plan.bays.length, crossings: planned.plan.crossings.length, signs: planned.plan.signs.length}});
}

function wearLayers(document, floor, derived) {
  const plan = derived.plan, root = derived.root, y = plan.floorY + .004, ownerMatrix = new THREE.Matrix4().multiplyMatrices(derived.inverseRoom, floor.matrixWorld);
  const basis = new THREE.Matrix4().compose(new THREE.Vector3(0, y, 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2), new THREE.Vector3(1, 1, 1));
  const matrix = new THREE.Matrix4().getInverse(ownerMatrix).multiply(basis).toArray(); matrix[3] = matrix[7] = matrix[11] = 0; matrix[15] = 1;
  const stamp = (x, z, yaw = 0, scale = [1, 1, 1]) => ({position: [x, -z, 0], quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), yaw).toArray(), scale});
  const make = (id, pattern, color, width, height, opacity, stamps, seed, roughness = .96) => ({id: GENERATED_WEAR + id, pattern, color, width, height, depth: .035, opacity, density: .62, roughness, metalness: 0, seed, matrix: matrix.slice(), stamps});
  const oil = derived.machines.filter(row => row.motorPoint && row.motorPoint[1] - plan.floorY < 2.2).filter((row, index, rows) => index % Math.max(1, Math.ceil(rows.length / 16)) === 0).slice(0, 16).map(row => stamp(row.motorPoint[0] + .08, row.motorPoint[2] - .06));
  const stations = derived.machines.filter(row => ['source', 'processor', 'palletQueue'].includes(row.type)).filter((row, index, rows) => index % Math.max(1, Math.ceil(rows.length / 16)) === 0).slice(0, 16).map(row => stamp(center(row.box)[0], row.box[3] + .12, row.yaw));
  const tires = plan.bays.slice(0, 8).flatMap(box => { const p = center(box); return [-1, 1].map(side => stamp(p[0] + side * .3, p[1])); });
  const edges = [], box = plan.bounds;
  for (const side of [-1, 1]) {
    const x = side < 0 ? box[0] + .22 : box[2] - .22, z = side < 0 ? box[1] + .22 : box[3] - .22;
    for (let index = 0; index < 6; index++) { edges.push(stamp(x, box[1] + (box[3] - box[1]) * (index + .5) / 6)); edges.push(stamp(box[0] + (box[2] - box[0]) * (index + .5) / 6, z, Math.PI / 2)); }
  }
  return [make('motor-oil', 'grime', '#222b23', .70, .45, .64, oil, 732, .36), make('station-scratches', 'scratches', '#c0c5b9', 1.35, .32, .50, stations, 928), make('wheel-traces', 'grime', '#394338', .19, 2.4, .46, tires, 433), make('border-dirt', 'grime', '#3e493d', .48, 3.6, .48, edges, 863)].filter(layer => layer.stamps.length);
}

/** Additive, synchronous and undoable. The versioned actor is the idempotence
 * marker; authored machines, port references and customized materials stay literal. */
export function applyIndustrialFloorPresentation(document, roomId, options = {}) {
  const existing = document.getObjects(roomId).find(object => object.userData.editorDescriptor && object.userData.editorDescriptor.type === 'industrialFloor' && object.userData.editorDescriptor.version === 1);
  const derived = deriveIndustrialFloorPresentation(document, roomId, options);
  if (options.enabled === false || !derived.plan || existing && !options.force) return {presentation: existing || null, floor: derived.floor, plan: existing ? existing.userData.editorDescriptor : derived.plan, affectedObjectIds: [], addedObjectIds: [], removedLegacyIds: [], changed: false, wearLayers: 0, report: derived.report};
  const own = !document.transaction; if (own) document.begin(); const addedObjectIds = [], removedLegacyIds = [];
  try {
    if (existing) { removedLegacyIds.push(existing.userData.editorId); document.remove(existing); }
    let floor = derived.floor;
    if (!floor) {
      const b = derived.plan.bounds; floor = document.addPrimitive(roomId, 'box', '#777c76'); document.setProperty(floor, 'name', 'Piso industrial · hormigón mate'); document.setTransform(floor, {position: [(b[0] + b[2]) / 2, derived.plan.floorY - .06, (b[1] + b[3]) / 2], scale: [b[2] - b[0], .12, b[3] - b[1]]}); document.setBehaviors(floor, [schema.defaultBehavior('collision'), schema.defaultBehavior('teleport')]); addedObjectIds.push(floor.userData.editorId); rootUpdate(derived.root);
    }
    const behaviors = document.getBehaviors(floor).slice();
    if (!behaviors.some(value => value.type === 'surfaceMaterial') && !floor.userData.editorColor) behaviors.push(Object.assign(schema.defaultBehavior('surfaceMaterial'), {preset: 'concrete', color: '#777c76', metalness: 0, roughness: .97, clearcoat: 0, colorMapMode: 'preserve', repeatX: (derived.plan.bounds[2] - derived.plan.bounds[0]) / 4, repeatY: (derived.plan.bounds[3] - derived.plan.bounds[1]) / 4}));
    const wear = behaviors.find(value => value.type === 'surfaceWear'), current = JSON.parse(wear && wear.layers || '[]');
    const preserved = current.filter(layer => !String(layer.id).startsWith(GENERATED_WEAR) && layer.id !== 'cedi-floor-tire-wear');
    let available = Math.max(0, 2048 - preserved.reduce((sum, layer) => sum + Math.max(1, (layer.stamps || []).length), 0));
    const generated = wearLayers(document, floor, derived).slice(0, Math.max(0, 64 - preserved.length)).map(layer => { const value = Object.assign({}, layer, {stamps: layer.stamps.slice(0, available)}); available -= value.stamps.length; return value; }).filter(layer => layer.stamps.length);
    document.setBehaviors(floor, behaviors.filter(value => value.type !== 'surfaceWear').concat([{type: 'surfaceWear', enabled: wear ? wear.enabled : true, layers: JSON.stringify(preserved.concat(generated))}]));
    if (options.replaceLegacy === true) document.getObjects(roomId).filter(object => object !== floor && object.userData.editorDescriptor && object.userData.editorDescriptor.type === 'plane' && /^(?:Ruta peatonal central|Límite peatonal|Cruce peatonal|Paso de peatones|Flecha de circulación|Delimitación ·|Demarcación longitudinal ·|Demarcación transversal ·|Ruta peatonal de recepción|Límite de ruta peatonal)/.test(object.name) && !object.userData.editorColor && document.getBehaviors(object).every(value => value.type === 'surfaceMaterial' && !value.texture && !(value.overrides || []).length && ['#f5ca36', '#d9b74c', '#385c60', '#555f65', '#edf1ef', '#d4effa', '#78cbf0', '#34545b'].includes(value.color))).forEach(object => { removedLegacyIds.push(object.userData.editorId); document.remove(object); });
    const presentation = document.addIndustrialFloorPresentation(roomId, derived.plan); document.setProperty(presentation, 'name', TAG); addedObjectIds.push(presentation.userData.editorId);
    if (own) document.commit();
    return {presentation, floor, plan: derived.plan, affectedObjectIds: [presentation.userData.editorId, floor.userData.editorId], addedObjectIds, removedLegacyIds, changed: true, wearLayers: generated.length, report: Object.assign({}, derived.report, {meshes: presentation.children[0].children.length, stamps: generated.reduce((sum, layer) => sum + layer.stamps.length, 0)})};
  } catch (error) { if (own) document.cancel(); throw error; }
}
function rootUpdate(root) { root.updateWorldMatrix(true, true); }
