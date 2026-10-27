import * as THREE from 'three';
import schema from '../../shared/behaviors.js';

const PREFIX = 'Robótica CEDI · ';
const machine = (document, object, type) => document.getBehaviors(object).find(value => value.type === type);
const patch = (document, object, type, changes) => document.setBehaviors(object, document.getBehaviors(object).map(value => value.type === type ? Object.assign({}, value, changes) : value));
const MACHINE_TYPES = ['conveyor', 'source', 'processor', 'palletQueue', 'robot', 'vehicle'];
const roleNames = {loading: 'Carga', transfer: 'Transferencia', unloading: 'Descarga'};
// Room visibility is a viewer/navigation state. Authoring another room must
// still inspect its visible equipment and physical floor beneath that root.
const shown = (object, roomRoot) => { for (let node = object; node && node !== roomRoot; node = node.parent) if (!node.visible) return false; return true; };
function roomBox(object, inverse, roomRoot) {
  object.updateWorldMatrix(true, true); const box = new THREE.Box3();
  object.traverse(node => { if (!node.geometry || !shown(node, roomRoot) || node.userData.editorRuntimeHelper) return; if (!node.geometry.boundingBox) node.geometry.computeBoundingBox(); box.union(node.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, node.matrixWorld))); }); return box;
}
function stagingPosition(document, original, occupied, inverse, allowExpansion, roomRoot) {
  const bounds = new THREE.Box3(); occupied.forEach(item => bounds.union(item.box));
  if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-4, 0, -4), new THREE.Vector3(4, 2, 4));
  const preferred = new THREE.Vector3(bounds.max.x + 6, 0, bounds.min.z + 4);
  const rows = original.map(object => ({object, box: roomBox(object, inverse, roomRoot)})).filter(row => !row.box.isEmpty());
  let floors = rows.filter(row => row.box.max.y >= -.25 && row.box.max.y <= .3 && row.box.max.y - row.box.min.y <= .3 && row.box.max.x - row.box.min.x >= 4 && row.box.max.z - row.box.min.z >= 4);
  const authored = floors.filter(row => /(?:CEDI.*Piso|Piso.*(?:industrial|hormigón))/i.test(row.object.name)); if (authored.length) floors = authored;
  floors.sort((a, b) => b.box.getSize(new THREE.Vector3()).lengthSq() - a.box.getSize(new THREE.Vector3()).lengthSq());
  if (!floors.length && !allowExpansion) return null;
  const floorObjects = new Set(floors.map(row => row.object)), obstacles = occupied.map(row => row.box).concat(rows.filter(row => !floorObjects.has(row.object) &&
    (document.getBehaviors(row.object).some(value => value.type === 'collision' && value.enabled !== false) || /(?:muro|pared|columna|pedestal|escalón|plataforma)/i.test(row.object.name))).map(row => row.box));
  const candidates = [preferred];
  if (!allowExpansion) scan: for (const floor of floors) for (let x = floor.box.min.x + 4.5; x + 7.5 < floor.box.max.x; x += 2) for (let z = floor.box.min.z + 2; z + 6 < floor.box.max.z; z += 2) {
    candidates.push(new THREE.Vector3(x, floor.box.max.y, z)); if (candidates.length >= 10000) break scan;
  }
  candidates.sort((a, b) => a.distanceToSquared(preferred) - b.distanceToSquared(preferred));
  const roomMatrix = new THREE.Matrix4().getInverse(inverse), down = new THREE.Vector3(0, -1, 0).transformDirection(roomMatrix), verticalScale = new THREE.Vector3().setFromMatrixColumn(roomMatrix, 1).length();
  const ray = new THREE.Raycaster(); ray.near = 0; ray.far = .4 * verticalScale;
  return candidates.find(point => {
    const zone = new THREE.Box3(new THREE.Vector3(point.x - 4.4, point.y + .02, point.z - 1.8), new THREE.Vector3(point.x + 7.4, point.y + 2.9, point.z + 5.8));
    if (obstacles.some(box => box.intersectsBox(zone))) return false;
    return allowExpansion || floors.some(({box, object}) => Math.abs(point.y - box.max.y) < .05 && zone.min.x >= box.min.x + .4 && zone.max.x <= box.max.x - .4 && zone.min.z >= box.min.z + .4 && zone.max.z <= box.max.z - .4 &&
      [zone.min.x, point.x, zone.max.x].every(x => [zone.min.z, point.z, zone.max.z].every(z => {
        ray.set(new THREE.Vector3(x, point.y + .18, z).applyMatrix4(roomMatrix), down);
        return ray.intersectObject(object, true).some(hit => Math.abs(hit.point.clone().applyMatrix4(inverse).y - point.y) < .04);
      })));
  }) || null;
}

function localMatrix(rootInverse, object) { object.updateWorldMatrix(true, true); return new THREE.Matrix4().multiplyMatrices(rootInverse, object.matrixWorld); }
function configurations(document, objects, roomRoot) { return objects.map(object => ({object, config: document.getBehaviors(object).find(value => MACHINE_TYPES.includes(value.type))})).filter(row => row.config && shown(row.object, roomRoot)); }
function baseSupported(position, base, floors, inverse) {
  const matrix = new THREE.Matrix4().getInverse(inverse), ray = new THREE.Raycaster(); ray.near = 0; ray.far = .4 * new THREE.Vector3().setFromMatrixColumn(matrix, 1).length();
  const down = new THREE.Vector3(0, -1, 0).transformDirection(matrix);
  return floors.some(row => Math.abs(row.box.max.y - position.y) < .06 && base.min.x >= row.box.min.x + .15 && base.max.x <= row.box.max.x - .15 && base.min.z >= row.box.min.z + .15 && base.max.z <= row.box.max.z - .15 &&
    [base.min.x, base.max.x].every(x => [base.min.z, base.max.z].every(z => {ray.set(new THREE.Vector3(x, position.y + .18, z).applyMatrix4(matrix), down); return ray.intersectObject(row.object, true).some(hit => Math.abs(hit.point.clone().applyMatrix4(inverse).y - position.y) < .04);})));
}
function contactPoints(row, inverse, outgoing, maximumHeight) {
  const c = row.config, object = row.object, matrix = localMatrix(inverse, object), points = [];
  if (c.type === 'conveyor') {
    const length = schema.conveyorLayout.pathLength(c), point = schema.conveyorLayout.pathPoint(c, outgoing ? length - .30 : 0);
    for (const height of [.2, maximumHeight]) points.push(new THREE.Vector3(point.x, (point.y || 0) + height + .005, point.z).applyMatrix4(matrix));
  } else if (c.type === 'palletQueue') {
    const layout = schema.palletQueues.layout(c), top = Math.min(c.maxStackHeight || maximumHeight * c.layers, maximumHeight * c.layers);
    layout.pallets.forEach(bay => { for (const x of [-1, 1]) for (const z of [-1, 1]) for (const height of [maximumHeight, top + maximumHeight]) points.push(new THREE.Vector3(bay.position[0] + x * Math.max(0, c.width / 2 - .12), -1 + layout.palletTop + 1 + height, bay.position[2] + z * Math.max(0, c.depth / 2 - .12)).applyMatrix4(matrix)); });
  } else {
    const position = c.type === 'processor' ? schema.processors.layout(c)[outgoing ? 'outputPosition' : 'inputPosition'] : [0, 0, 0];
    for (const height of [.2, maximumHeight]) points.push(new THREE.Vector3(position[0], position[1] + height + .005, position[2]).applyMatrix4(matrix));
  }
  return points;
}
function cellPlacement(document, edge, occupied, inverse, maximumHeight, floors, allowExpansion) {
  const picks = contactPoints(edge.source, inverse, true, maximumHeight), places = contactPoints(edge.target, inverse, false, maximumHeight);
  const first = picks[0], last = places[0], center = first.clone().add(last).multiplyScalar(.5);
  const direction = last.clone().sub(first).setY(0); if (direction.lengthSq() < .01) direction.set(1, 0, 0); direction.normalize();
  const normal = new THREE.Vector3(-direction.z, 0, direction.x), sourceConfig = edge.source.config;
  const floorY = new THREE.Vector3(0, -(sourceConfig.type === 'conveyor' ? sourceConfig.supportHeight || 1 : 1), 0).applyMatrix4(localMatrix(inverse, edge.source.object)).y;
  const targets = picks.concat(places), baseHeight = .85, approachHeight = .38;
  for (const side of [1, -1]) for (const offset of [1.5, 1.85, 2.2]) for (const along of [0, -.5, .5]) {
    const position = center.clone().addScaledVector(normal, side * offset).addScaledVector(direction, along).setY(floorY), base = new THREE.Box3(new THREE.Vector3(position.x - .53, floorY + .025, position.z - .53), new THREE.Vector3(position.x + .53, floorY + baseHeight + .06, position.z + .53));
    if (occupied.some(row => row.box.intersectsBox(base))) continue;
    if (!allowExpansion && !baseSupported(position, base, floors, inverse)) continue;
    const yaw = Math.atan2(-(center.z - position.z), center.x - position.x), rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), matrix = new THREE.Matrix4().compose(position, rotation, new THREE.Vector3(1, 1, 1)), local = new THREE.Matrix4().getInverse(matrix);
    const reach = Math.max(2.6, Math.ceil((Math.max(...targets.map(point => point.clone().sub(position.clone().add(new THREE.Vector3(0, baseHeight, 0))).length())) + .65) * 10) / 10);
    if (reach > 5.5) continue;
    const config = Object.assign({}, schema.robots.defaults('articulated-general'), {reach, baseHeight, approachHeight, payloadKg: 120, running: true, mode: 'automatic', withPanel: false, speed: 1.6, cycleTime: 1.8, processTime: 0, setupTime: .2, maxProductWidth: 2, maxProductDepth: 2, maxProductHeight: 2, wear: .25});
    // The generic catalogue home points its tool across the adjoining deck.
    // Fold upward before materializing the first product in a real cell.
    const home = schema.robotKinematics.inverse(config, {x: reach * .25, y: baseHeight + reach * .65, z: 0});
    if (!home.reached) continue;
    config.jointLimitsJson = JSON.stringify(schema.robots.getJointDefinitions(config).map((joint, index) => ({id: joint.id, min: joint.min, max: joint.max, home: home.joints[index]})));
    const high = Math.max(...picks.map(point => point.y)) + approachHeight;
    const paths = targets.concat(targets.map(point => point.clone().setY(Math.max(point.y + approachHeight, high))));
    if (!paths.every(point => {const pose = schema.robotKinematics.inverse(config, point.clone().applyMatrix4(local)); return pose.reached !== false && (pose.error || 0) < config.positionTolerance;})) continue;
    return {position, rotation, config, picks, places, base};
  }
  return null;
}

/** Explicit migration, one undo: interpose real pick/place custody on existing
 * edges. Existing machines, products, capacities and world poses are retained.
 * A separate real pallet feed teaches forklift unloading; cartons in ordinary
 * stock are never relabelled as a fictitious complete pallet. */
export function retrofitCediRobotics(document, roomId, options = {}) {
  const root = document.getRoot(roomId), own = !document.transaction, added = [], robots = [], vehicles = [], products = [], warnings = [], cells = [];
  if (own) document.begin();
  try {
    root.updateWorldMatrix(true, true); const inverse = new THREE.Matrix4().getInverse(root.matrixWorld), original = document.getObjects(roomId).slice();
    const lines = options.lines || [], rows = configurations(document, original, root), byId = new Map(rows.map(row => [row.object.userData.editorId, row]));
    const legacy = rows.filter(row => row.config.type === 'robot' && row.object.name.includes(PREFIX + 'proceso sobre '));
    const occupied = rows.filter(row => !legacy.includes(row)).map(row => ({object: row.object, box: roomBox(row.object, inverse, root)}));
    const floorRows = original.map(object => ({object, box: roomBox(object, inverse, root)})).filter(row => !row.box.isEmpty() && row.box.max.y <= .3 && row.box.max.y >= -.25 && row.box.getSize(new THREE.Vector3()).x >= 3 && row.box.getSize(new THREE.Vector3()).z >= 3);
    original.filter(object => !byId.has(object.userData.editorId) && document.getBehaviors(object).some(value => value.type === 'collision' && value.enabled !== false) && !floorRows.some(row => row.object === object)).forEach(object => occupied.push({object, box: roomBox(object, inverse, root)}));
    const automatic = row => !lines.length || lines.some(line => line.mode !== 'manual' && line.objects.includes(row.object));
    const unitConveyor = row => row && row.config.type === 'conveyor' && row.config.drive !== 'manual' && row.config.drive !== 'gravity' && !row.config.requiresOperator && row.config.loadingMode !== 'manual' && row.config.surface !== 'chains' && row.config.layout === 'straight' && !row.config.rise && ['transport', 'zones', 'loading'].includes(row.config.mechanism);
    const edges = rows.filter(row => automatic(row) && row.config.outputId).map(source => ({source, target: byId.get(source.config.outputId)})).filter(edge => edge.target && edge.source.config.loadMode !== 'pallet');
    const categories = {
      loading: edges.filter(edge => ['source', 'processor'].includes(edge.source.config.type) && unitConveyor(edge.target)).sort((a, b) => Number(b.source.config.type === 'source') - Number(a.source.config.type === 'source')),
      transfer: edges.filter(edge => unitConveyor(edge.source) && ['conveyor', 'processor', 'source'].includes(edge.target.config.type) && edge.target.config.surface !== 'chains'),
      unloading: edges.filter(edge => unitConveyor(edge.source) && edge.target.config.type === 'palletQueue' && !edge.target.config.acceptsPallets).sort((a, b) => a.target.config.palletCapacity - b.target.config.palletCapacity)
    };
    let installed = 0;
    for (const role of ['loading', 'transfer', 'unloading'].slice(0, options.robotCount || 3)) {
      if (rows.some(row => row.config.type === 'robot' && row.object.name.includes(PREFIX + roleNames[role] + ' · '))) continue;
      let chosen;
      for (const edge of categories[role]) {
        if (cells.some(cell => cell.source === edge.source.object)) continue;
        const line = lines.find(item => item.objects.includes(edge.source.object)), sources = line ? line.sources || [] : rows.filter(row => row.config.type === 'source').map(row => row.object);
        const heights = sources.flatMap(object => {const value = machine(document, object, 'source'); return value ? schema.productSources.normalizeCatalog(value.catalog || '[]').map(spec => spec.height) : [];});
        const maximumHeight = Math.max(.5, ...heights.filter(Number.isFinite)), placement = cellPlacement(document, edge, occupied, inverse, maximumHeight, floorRows, options.allowExpansion === true);
        if (placement) { chosen = {edge, line, placement}; break; }
      }
      if (!chosen) { if (categories[role].length) warnings.push('No hay una base apoyada y alcance libre para la célula de ' + roleNames[role].toLowerCase() + '; conserva el enlace original.'); continue; }
      const {edge, line, placement} = chosen, reused = legacy.shift(), robot = reused ? reused.object : document.addPrefab(roomId, 'robot', 'articulated-general');
      patch(document, robot, 'robot', Object.assign({}, placement.config, {sourceId: edge.source.object.userData.editorId, outputId: edge.target.object.userData.editorId, targetId: ''}));
      document.setProperty(robot, 'name', PREFIX + roleNames[role] + ' · ' + edge.source.object.name); document.setTransform(robot, {position: placement.position.toArray(), quaternion: placement.rotation.toArray()});
      patch(document, edge.source.object, edge.source.config.type, {outputId: robot.userData.editorId, outputPort: 'input'});
      if (!reused) added.push(robot); robots.push(robot); installed++; occupied.push({object: robot, box: roomBox(robot, inverse, root)});
      const cell = {role, robot, source: edge.source.object, target: edge.target.object}; cells.push(cell);
      if (line) {
        if (!line.objects.includes(robot)) line.objects.push(robot); line.memberIds = Array.from(new Set((line.memberIds || []).concat(robot.userData.editorId)));
        line.links = (line.links || []).filter(link => !(link.source === edge.source.object.userData.editorId && link.target === edge.target.object.userData.editorId)).concat([{source: edge.source.object.userData.editorId, sourcePort: 'output', target: robot.userData.editorId, targetPort: 'input'}, {source: robot.userData.editorId, sourcePort: 'output', target: edge.target.object.userData.editorId, targetPort: 'input'}]);
      }
    }
    // Existing profiles retain their type, dimensions, quality and count. Only
    // the requested visual recipe is made explicit, preserving routing rules.
    original.forEach(object => {
      const source = machine(document, object, 'source'); if (!source || !source.catalog) return;
      const rows = schema.productSources.normalizeCatalog(source.catalog);
      const updated = rows.map((spec, index) => Object.assign({}, spec, {variant: spec.variant || ({box: ['box-small', 'box-medium', 'box-large'][index % 3], crate: 'crate', drum: 'drum', bottle: 'bottle', tote: 'tote', jerrycan: 'jerrycan', sack: 'sack', cylinder: 'cylinder', reel: 'reel', pallet: 'pallet-euro', cage: 'cage'}[spec.type] || 'box-medium')}));
      if (rows.length) patch(document, object, 'source', {catalog: JSON.stringify(updated)});
    });
    let logistics = null;
    const existingStation = rows.find(row => row.config.type === 'source' && row.object.name.includes(PREFIX + 'Source · pallets completos de producción') && row.config.outputId && rows.some(other => other.config.type === 'vehicle' && other.config.sourceId === row.config.outputId && byId.has(other.config.outputId)));
    if (options.vehicles !== false && !existingStation) {
      const staging = stagingPosition(document, original, occupied, inverse, options.allowExpansion === true, root);
      if (!staging) warnings.push('No hay una zona interior libre y apoyada para el montacargas y sus pallets; libera espacio y vuelve a integrar.');
      else {
      const {x, y, z} = staging;
      const oldVehicle = rows.find(row => row.config.type === 'vehicle' && row.object.name.includes(PREFIX + 'montacargas de expedición') && schema.vehicles.supports(row.config).forks), vehicle = oldVehicle ? oldVehicle.object : document.addPrefab(roomId, 'vehicle', 'forklift-electric-4w');
      const source = document.addPrefab(roomId, 'source');
      patch(document, source, 'source', {autoGenerate: true, running: true, initialCount: 1, totalLimit: options.continuous === true ? 0 : 4, interval: 10, capacity: 4, delivery: 'automatic', withPanel: false, loadMode: 'pallet', palletType: 'euro-1200x800', palletColumns: 3, palletRows: 2, palletLayers: 2, generationMode: 'sequence', catalog: JSON.stringify([{id: 'robotics-expedition', name: 'Caja de expedición', type: 'box', variant: 'box-medium', width: .35, depth: .35, height: .28, mass: 4, base: 'flat', color: '#b98b50', quality: 'good', defect: 'none'}])});
      const pickup = document.addPrefab(roomId, 'conveyor', 'pallet-chain'); patch(document, pickup, 'conveyor', {length: 3, width: 1.4, autoSpawn: false, withPanel: true, withSensors: true, running: true, powered: true, speed: .3, maxPackages: 1, outputId: ''});
      document.setBehaviors(pickup, document.getBehaviors(pickup).concat(Object.assign(schema.defaultBehavior('automation'), {rules: JSON.stringify([{sourceId: pickup.userData.editorId, variable: 'transferBlocked', operator: 'eq', value: true, targetId: pickup.userData.editorId, targetVariable: 'running', set: false, edge: 'rising'}])})));
      const stock = document.addPrefab(roomId, 'palletQueue'); patch(document, stock, 'palletQueue', {running: true, withPanel: false, acceptsPallets: true, palletType: 'euro-1200x800', width: 1.2, depth: .8, palletCapacity: 2, capacity: 2, columns: 1, rows: 1, layers: 1, delivery: 'manual', autoRelease: false});
      patch(document, source, 'source', {outputId: pickup.userData.editorId});
      patch(document, vehicle, 'vehicle', Object.assign(oldVehicle ? {} : {mode: 'manual', powered: true, running: true, parkingBrake: true, forkSpread: .312}, {sourceId: pickup.userData.editorId, outputId: stock.userData.editorId}));
      if (!oldVehicle) {document.setProperty(vehicle, 'name', PREFIX + 'montacargas de expedición'); document.setTransform(vehicle, {position: [x + 4, y, z], rotation: [0, -Math.PI / 2, 0]});}
      else warnings.push('El montacargas existente conserva su posición y ajustes; condúcelo a la nueva estación y alinea las uñas con sus huecos.');
      const sourceLength = schema.productSources.layout(machine(document, source, 'source')).length;
      document.setProperty(source, 'name', PREFIX + 'Source · pallets completos de producción'); document.setTransform(source, {position: [x - 1.5 - sourceLength / 2, y + 1, z]});
      document.setProperty(pickup, 'name', PREFIX + 'cadenas · recogida por montacargas'); document.setTransform(pickup, {position: [x, y + 1, z]});
      document.setProperty(stock, 'name', PREFIX + 'destino · pallets completos'); document.setTransform(stock, {position: [x + 2, y + 1, z + 4]});
      added.push(source, pickup, stock); if (!oldVehicle) added.push(vehicle); vehicles.push(vehicle); logistics = {source, pickup, destination: stock, vehicle, expectedLoads: options.continuous === true ? 0 : 4, unitsPerLoad: 12};
      const sign = document.addPrimitive(roomId, 'box', '#1e3641'); document.setProperty(sign, 'name', PREFIX + 'guía de montacargas'); document.setTransform(sign, {position: [x - 2.5, y + 1.8, z + 4.8], scale: [2.4, 1.1, .04]});
      document.setBehaviors(sign, [Object.assign(schema.defaultBehavior('info'), {title: 'Expedición real · 12 unidades por pallet', text: 'El Source alimenta las cadenas; el enclavamiento de salida detiene el motor al llegar el pallet. Confirma el paro local antes de recoger. Alinea las dos uñas (separación 0,312 m por el extremo), eleva, retira y deposita en las bahías. Cuando las horquillas estén fuera, pulsa Marcha para el siguiente pallet. Las cajas de otros almacenes no se convierten en pallets ficticios.', fontSize: .035})]); added.push(sign); logistics.objects = [source, pickup, stock, vehicle, sign];
      }
    }
    const studio = document.studio || {};
    if (added.length) document.setStudio({groups: (studio.groups || []).concat({id: 'cedi-robotics-' + roomId + '-' + added[0].userData.editorId, name: 'Robótica y expedición CEDI', roomId, members: added.map(object => object.userData.editorId)})});
    if (own) document.commit(); return {objects: added, robots, vehicles, products, cells, logistics, warnings, changed: added.length > 0 || installed > 0};
  } catch (error) { if (own) document.cancel(); throw error; }
}
