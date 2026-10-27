import * as THREE from 'three';
import schema from '../../shared/behaviors.js';

const PREFIX = 'Robótica CEDI · ';
const machine = (document, object, type) => document.getBehaviors(object).find(value => value.type === type);
const patch = (document, object, type, changes) => document.setBehaviors(object, document.getBehaviors(object).map(value => value.type === type ? Object.assign({}, value, changes) : value));
function roomBox(object, inverse) {
  object.updateWorldMatrix(true, true); const box = new THREE.Box3();
  object.traverse(node => { if (!node.geometry || !node.visible || node.userData.editorRuntimeHelper) return; if (!node.geometry.boundingBox) node.geometry.computeBoundingBox(); box.union(node.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, node.matrixWorld))); }); return box;
}
function stagingPosition(document, original, occupied, inverse, allowExpansion) {
  const bounds = new THREE.Box3(); occupied.forEach(item => bounds.union(item.box));
  if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-4, 0, -4), new THREE.Vector3(4, 2, 4));
  const preferred = new THREE.Vector3(bounds.max.x + 4.5, 0, bounds.min.z + 4);
  const rows = original.map(object => ({object, box: roomBox(object, inverse)})).filter(row => !row.box.isEmpty());
  let floors = rows.filter(row => row.box.max.y >= -.25 && row.box.max.y <= .3 && row.box.max.y - row.box.min.y <= .3 && row.box.max.x - row.box.min.x >= 4 && row.box.max.z - row.box.min.z >= 4);
  const authored = floors.filter(row => /(?:CEDI.*Piso|Piso.*(?:industrial|hormigón))/i.test(row.object.name)); if (authored.length) floors = authored;
  floors.sort((a, b) => b.box.getSize(new THREE.Vector3()).lengthSq() - a.box.getSize(new THREE.Vector3()).lengthSq());
  if (!floors.length && !allowExpansion) return null;
  const floorObjects = new Set(floors.map(row => row.object)), obstacles = occupied.map(row => row.box).concat(rows.filter(row => !floorObjects.has(row.object) &&
    (document.getBehaviors(row.object).some(value => value.type === 'collision' && value.enabled !== false) || /(?:muro|pared|columna|pedestal|escalón|plataforma)/i.test(row.object.name))).map(row => row.box));
  const candidates = [preferred];
  if (!allowExpansion) scan: for (const floor of floors) for (let x = floor.box.min.x + 1.5; x + 3.6 < floor.box.max.x; x += 2) for (let z = floor.box.min.z + 2; z + 4.6 < floor.box.max.z; z += 2) {
    candidates.push(new THREE.Vector3(x, floor.box.max.y, z)); if (candidates.length >= 10000) break scan;
  }
  candidates.sort((a, b) => a.distanceToSquared(preferred) - b.distanceToSquared(preferred));
  const roomMatrix = new THREE.Matrix4().getInverse(inverse), down = new THREE.Vector3(0, -1, 0).transformDirection(roomMatrix), verticalScale = new THREE.Vector3().setFromMatrixColumn(roomMatrix, 1).length();
  const ray = new THREE.Raycaster(); ray.near = 0; ray.far = .4 * verticalScale;
  return candidates.find(point => {
    const zone = new THREE.Box3(new THREE.Vector3(point.x - 1.1, point.y + .02, point.z - 1.8), new THREE.Vector3(point.x + 3.5, point.y + 2.6, point.z + 4.5));
    if (obstacles.some(box => box.intersectsBox(zone))) return false;
    return allowExpansion || floors.some(({box, object}) => Math.abs(point.y - box.max.y) < .05 && zone.min.x >= box.min.x + .4 && zone.max.x <= box.max.x - .4 && zone.min.z >= box.min.z + .4 && zone.max.z <= box.max.z - .4 &&
      [zone.min.x, point.x, zone.max.x].every(x => [zone.min.z, point.z, zone.max.z].every(z => {
        ray.set(new THREE.Vector3(x, point.y + .18, z).applyMatrix4(roomMatrix), down);
        return ray.intersectObject(object, true).some(hit => Math.abs(hit.point.clone().applyMatrix4(inverse).y - point.y) < .04);
      })));
  }) || null;
}

/** Opt-in, one undo. Existing flows and source ownership stay intact: a nozzle
 * processes the same conveyor load in situ. Vehicles receive actual handling
 * units; individual stock cartons are never relabelled as a movable pallet. */
export function retrofitCediRobotics(document, roomId, options = {}) {
  const root = document.getRoot(roomId), own = !document.transaction, added = [], robots = [], vehicles = [], products = [], warnings = [];
  if (own) document.begin();
  try {
    root.updateWorldMatrix(true, true); const inverse = new THREE.Matrix4().getInverse(root.matrixWorld), original = document.getObjects(roomId).slice();
    const lines = options.lines || [], candidates = lines.length ? lines.filter(line => line.mode !== 'manual').map(line => ({line,
      object: line.objects.find(object => { const c = machine(document, object, 'conveyor'); return c && c.drive === 'motor' && c.layout === 'straight' && c.mechanism === 'transport' && c.surface !== 'chains'; })})).filter(item => item.object) :
      original.filter(object => { const c = machine(document, object, 'conveyor'); return c && c.drive === 'motor' && c.layout === 'straight' && c.mechanism === 'transport' && c.surface !== 'chains'; }).map(object => ({object}));
    const occupied = original.filter(object => ['conveyor', 'source', 'processor', 'palletQueue', 'robot', 'vehicle'].some(type => machine(document, object, type))).map(object => ({object, box: roomBox(object, inverse)}));
    for (const {object, line} of candidates.slice(0, options.robotCount || 2)) {
      if (original.some(item => item.name.startsWith(PREFIX) && machine(document, item, 'robot') && machine(document, item, 'robot').sourceId === object.userData.editorId)) continue;
      const config = machine(document, object, 'conveyor'), port = schema.conveyorLayout.ports(config).output;
      const contact = new THREE.Vector3(port.x, port.y || 0, port.z).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld));
      const direction = new THREE.Vector3(port.tx, port.ty || 0, port.tz).transformDirection(new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld)), lateral = new THREE.Vector3(-direction.z, 0, direction.x);
      const floorY = object.position.y - (config.supportHeight || 1), offset = config.width / 2 + .95;
      const positions = [1, -1].flatMap(side => [0, -.55, .55].map(along => contact.clone().addScaledVector(lateral, side * offset).addScaledVector(direction, along).setY(floorY)));
      const position = positions.find(p => !occupied.some(item => item.object !== object && item.box.intersectsBox(new THREE.Box3(new THREE.Vector3(p.x - .38, floorY + .03, p.z - .38), new THREE.Vector3(p.x + .38, floorY + .75, p.z + .38)))));
      if (!position) { warnings.push('No hay base libre junto a ' + object.name + '; mueve el equipo y vuelve a integrar.'); continue; }
      const robot = document.addPrefab(roomId, 'robot', 'articulated-process');
      patch(document, robot, 'robot', Object.assign({}, schema.robots.defaults('articulated-process'), {sourceId: object.userData.editorId, targetId: '', outputId: '', withPanel: false,
        running: true, mode: 'automatic', reach: 2.6, baseHeight: .95, cycleTime: 1, processTime: .35, setupTime: .15, speed: 1.8, wear: .22}));
      document.setProperty(robot, 'name', PREFIX + 'proceso sobre ' + object.name); document.setTransform(robot, {position: position.toArray()});
      added.push(robot); robots.push(robot); occupied.push({object: robot, box: roomBox(robot, inverse)});
      if (line) { line.objects.push(robot); line.memberIds = Array.from(new Set((line.memberIds || []).concat(robot.userData.editorId))); }
    }
    // Existing profiles retain their type, dimensions, quality and count. Only
    // the requested visual recipe is made explicit, preserving routing rules.
    original.forEach(object => {
      const source = machine(document, object, 'source'); if (!source || !source.catalog) return;
      const rows = schema.productSources.normalizeCatalog(source.catalog);
      const updated = rows.map((spec, index) => Object.assign({}, spec, {variant: spec.variant || ({box: ['box-small', 'box-medium', 'box-large'][index % 3], crate: 'crate', drum: 'drum', bottle: 'bottle', tote: 'tote', jerrycan: 'jerrycan', sack: 'sack', cylinder: 'cylinder', reel: 'reel', pallet: 'pallet-euro', cage: 'cage'}[spec.type] || 'box-medium')}));
      if (rows.length) patch(document, object, 'source', {catalog: JSON.stringify(updated)});
    });
    if (options.vehicles !== false && !original.some(object => object.name === PREFIX + 'montacargas de expedición')) {
      const staging = stagingPosition(document, original, occupied, inverse, options.allowExpansion === true);
      if (!staging) warnings.push('No hay una zona interior libre y apoyada para el montacargas y sus pallets; libera espacio y vuelve a integrar.');
      else {
      const {x, y, z} = staging;
      const vehicle = document.addPrefab(roomId, 'vehicle', 'forklift-electric-4w');
      patch(document, vehicle, 'vehicle', {mode: 'manual', powered: true, withPanel: true});
      document.setProperty(vehicle, 'name', PREFIX + 'montacargas de expedición'); document.setTransform(vehicle, {position: [x, y, z]}); added.push(vehicle); vehicles.push(vehicle);
      ['pallet-loaded', 'pallet-plastic'].forEach((variant, index) => {
        const product = document.addPrefab(roomId, 'product', variant); document.setProperty(product, 'name', PREFIX + (index ? 'pallet plástico retornable' : 'pallet de expedición · 24 unidades'));
        document.setTransform(product, {position: [x + index * 2.2, y, z + 3.6]}); added.push(product); products.push(product);
      });
      const sign = document.addPrimitive(roomId, 'box', '#1e3641'); document.setProperty(sign, 'name', PREFIX + 'guía de montacargas'); document.setTransform(sign, {position: [x + 2.6, y + 1.5, z], scale: [1.6, .8, .04]});
      document.setBehaviors(sign, [Object.assign(schema.defaultBehavior('info'), {title: 'Expedición con montacargas', text: 'Sube al vehículo y conduce hacia el pallet. Alinea las dos horquillas con las aberturas, eleva y transporta la carga completa. Los pallets preparados son unidades reales; las cajas individuales de otro almacén mantienen su propio inventario.', fontSize: .035})]); added.push(sign);
      }
    }
    const studio = document.studio || {};
    if (added.length) document.setStudio({groups: (studio.groups || []).concat({id: 'cedi-robotics-' + roomId + '-' + added[0].userData.editorId, name: 'Robótica y expedición CEDI', roomId, members: added.map(object => object.userData.editorId)})});
    if (own) document.commit(); return {objects: added, robots, vehicles, products, warnings, changed: added.length > 0};
  } catch (error) { if (own) document.cancel(); throw error; }
}
