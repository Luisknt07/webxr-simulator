import * as THREE from 'three';
import schema from '../contracts/behaviors.js';

export const WAREHOUSE_MISSION_PREFIX = 'Aprendizaje almacén · ';
const GROUP_PREFIX = 'warehouse-mission-enhancement-';
const component = (document, object, type) => document.getBehaviors(object).find(value => value.type === type);
const id = object => object.userData.editorId;
const topObjects = (document, roomId) => document.getObjects(roomId).filter(object => object.parent === document.getRoot(roomId));
const shown = object => { for (let node = object; node; node = node.parent) if (!node.visible) return false; return true; };

function boundsIn(root, object) {
  root.updateWorldMatrix(true, true);
  const inverse = new THREE.Matrix4().getInverse(root.matrixWorld), bounds = new THREE.Box3();
  const visit = node => {
    if (!node.visible || node.userData.editorHelper || node.userData.editorRuntimeHelper || node.userData.industrialSensorVolume) return;
    if (node.geometry) {
      if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
      if (node.geometry.boundingBox) bounds.union(node.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, node.matrixWorld)));
    }
    node.children.forEach(visit);
  };
  visit(object); return bounds;
}

/** Read-only inspection of the authored room. Floor and ceiling slabs do not
 * become aisle obstacles. Each imported mesh is checked separately so a
 * warehouse shell's enclosing group never fills its otherwise empty interior. */
export function inspectWarehouseMissionRoom(document, roomId) {
  const root = document.getRoot(roomId);
  if (!root) throw new Error('El nivel elegido no existe.');
  root.updateWorldMatrix(true, true);
  const objects = topObjects(document, roomId).filter(shown), floors = [], obstacles = [];
  for (const object of objects) {
    if (object.name.startsWith(WAREHOUSE_MISSION_PREFIX)) continue;
    const machine = document.getBehaviors(object).find(config => ['source', 'conveyor', 'processor', 'robot', 'palletQueue', 'vehicle', 'product'].includes(config.type));
    if (machine) {
      if (machine.type !== 'vehicle') { const box = boundsIn(root, object); if (!box.isEmpty()) obstacles.push({objectId: id(object), bounds: box}); }
      continue;
    }
    object.traverse(mesh => {
      if (mesh.userData.industrialFloorObstacleBounds && shown(mesh)) {
        for (const values of mesh.userData.industrialFloorObstacleBounds) {
          const box = new THREE.Box3(new THREE.Vector3(...values.slice(0, 3)), new THREE.Vector3(...values.slice(3))).applyMatrix4(new THREE.Matrix4().multiplyMatrices(new THREE.Matrix4().getInverse(root.matrixWorld), mesh.matrixWorld));
          obstacles.push({objectId: id(object), bounds: box});
        }
      }
      if (!mesh.geometry || !shown(mesh) || mesh.userData.editorHelper || mesh.userData.editorRuntimeHelper || mesh.userData.industrialFloorMarking) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      if (!mesh.geometry.boundingBox) return;
      const box = mesh.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(new THREE.Matrix4().getInverse(root.matrixWorld), mesh.matrixWorld));
      const size = box.getSize(new THREE.Vector3());
      if (size.x >= 14 && size.z >= 12 && size.y < .5 && Math.abs(box.max.y) < .4) floors.push(box);
      else if (box.max.y > .12 && box.min.y < 3.6) obstacles.push({objectId: id(object), bounds: box});
    });
  }
  floors.sort((a, b) => b.getSize(new THREE.Vector3()).x * b.getSize(new THREE.Vector3()).z - a.getSize(new THREE.Vector3()).x * a.getSize(new THREE.Vector3()).z);
  return {roomId, objects, floors, obstacles};
}

function layoutFor(document, roomId, inspection, options) {
  const supplied = options.layout;
  const floor = inspection.floors[0];
  const bounds = options.usableBounds || (floor && [floor.min.x + .4, floor.min.z + .4, floor.max.x - .4, floor.max.z - .4]);
  if (!bounds || bounds.length !== 4 || bounds.some(value => !Number.isFinite(value)) || bounds[2] <= bounds[0] || bounds[3] <= bounds[1]) throw new Error('No se encontró un piso útil; indica los límites inspeccionados del almacén.');
  const floorY = options.floorY === undefined ? floor ? floor.max.y : 0 : options.floorY;
  if (!Number.isFinite(floorY)) throw new Error('Altura del piso inválida.');
  if (supplied && supplied.kind === 'checked-corridors') {
    const poses = supplied.poses, radius = supplied.corridorRadius;
    if (!poses || !['rack', 'incoming', 'outgoing', 'returns', 'vehicle'].every(key => Array.isArray(poses[key]) && poses[key].length === 3 && poses[key].every(Number.isFinite)) || !Number.isFinite(radius) || radius < 1.3 || radius > 2) throw new Error('El trazado compacto necesita cinco poses métricas y pasillos comprobados de al menos 2,6 m.');
    for (const key of ['rack', 'incoming', 'outgoing', 'returns']) if (Math.abs(poses[key][1] - floorY - 1) > .01) throw new Error('Los apoyos compactos deben conservar la altura del piso.');
    if (Math.abs(poses.vehicle[1] - floorY) > .03) throw new Error('El montacargas debe comenzar apoyado en el piso.');
    const validRoutes = routes => Array.isArray(routes) && routes.length === 3 && routes.every(route => Array.isArray(route) && route.length >= 2 && route.length <= 24 && route.every(point => point && Object.keys(point).every(key => ['x', 'z'].includes(key)) && Number.isFinite(point.x) && Number.isFinite(point.z) && Math.abs(point.x) <= 250 && Math.abs(point.z) <= 250));
    if (!validRoutes(supplied.pickupRoutes) || !validRoutes(supplied.deliveryRoutes)) throw new Error('El trazado compacto necesita las seis rutas explícitas y completas.');
    const rectangles = [], actor = (key, hx, hz) => { const pose = poses[key]; rectangles.push({kind: key, bounds: [pose[0] - hx, pose[2] - hz, pose[0] + hx, pose[2] + hz]}); };
    actor('rack', 3.4, .85); for (const key of ['incoming', 'outgoing', 'returns']) actor(key, .85, .65); actor('vehicle', .95, 1.8);
    const segment = (a, b, kind) => rectangles.push({kind, bounds: [Math.min(a.x, b.x) - radius, Math.min(a.z, b.z) - radius, Math.max(a.x, b.x) + radius, Math.max(a.z, b.z) + radius]});
    const allRoutes = supplied.pickupRoutes.concat(supplied.deliveryRoutes);
    allRoutes.forEach((route, index) => { for (let i = 1; i < route.length; i++) segment(route[i - 1], route[i], 'route-' + index + '-' + i); });
    segment({x: poses.vehicle[0], z: poses.vehicle[2]}, supplied.pickupRoutes[0][0], 'vehicle-start');
    // Each exact docking lane also remains clear of original equipment. Its
    // source/destination support is intentionally the endpoint of the lane.
    const seats = [{x: poses.rack[0] - 2.22, z: poses.rack[2]}, {x: poses.incoming[0], z: poses.incoming[2]}, {x: poses.rack[0] + .78, z: poses.rack[2]}];
    const drops = [{x: poses.outgoing[0], z: poses.outgoing[2]}, {x: poses.rack[0] + 2.22, z: poses.rack[2]}, {x: poses.returns[0], z: poses.returns[2]}];
    supplied.pickupRoutes.forEach((route, index) => segment(route[route.length - 1], seats[index], 'pickup-dock-' + index));
    supplied.deliveryRoutes.forEach((route, index) => segment(route[route.length - 1], drops[index], 'drop-dock-' + index));
    for (const rectangle of rectangles) {
      const box = rectangle.bounds;
      if (box[0] < bounds[0] || box[1] < bounds[1] || box[2] > bounds[2] || box[3] > bounds[3]) throw new Error('El trazado compacto sale del piso útil: ' + rectangle.kind + '.');
      const blocked = inspection.obstacles.find(row => { const b = row.bounds; return b.max.x + .15 > box[0] && b.min.x - .15 < box[2] && b.max.z + .15 > box[1] && b.min.z - .15 < box[3] && b.max.y > floorY + .12 && b.min.y < floorY + 3.4; });
      if (blocked) throw new Error('El trazado compacto cruza un objeto existente: ' + rectangle.kind + ' / ' + blocked.objectId + '.');
    }
    const center = [poses.rack[0], poses.rack[2] + 5], at = (x, y, z) => [center[0] + x, floorY + y, center[1] + z];
    return Object.assign({center, floorY, usableBounds: bounds.slice(), footprint: [Math.min(...rectangles.map(row => row.bounds[0])), Math.min(...rectangles.map(row => row.bounds[1])), Math.max(...rectangles.map(row => row.bounds[2])), Math.max(...rectangles.map(row => row.bounds[3]))], at,
      pickupRoutes: supplied.pickupRoutes, deliveryRoutes: supplied.deliveryRoutes, checkedCorridors: rectangles, corridorRadius: radius, arrows: supplied.arrows || []}, poses);
  }
  const footprint = center => [center[0] - 10.5, center[1] - 6.8, center[0] + 10.5, center[1] + 8.7];
  const fits = box => box[0] >= bounds[0] && box[1] >= bounds[1] && box[2] <= bounds[2] && box[3] <= bounds[3];
  const clear = box => !inspection.obstacles.some(row => {
    const b = row.bounds;
    return b.max.x + .6 > box[0] && b.min.x - .6 < box[2] && b.max.z + .6 > box[1] && b.min.z - .6 < box[3] && b.max.y > floorY + .12 && b.min.y < floorY + 3.4;
  });
  let center = supplied && supplied.center;
  if (center && (!Array.isArray(center) || center.length !== 2 || center.some(value => !Number.isFinite(value)))) throw new Error('Centro de almacén inválido.');
  if (!center) {
    const candidates = [];
    for (let z = bounds[1] + 6.8; z <= bounds[3] - 8.7 + .001; z += 1) for (let x = bounds[0] + 10.5; x <= bounds[2] - 10.5 + .001; x += 1) candidates.push([x, z]);
    candidates.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
    center = candidates.find(value => clear(footprint(value)));
  }
  if (!center || !fits(footprint(center)) || !clear(footprint(center))) throw new Error('La zona de misiones no cabe libre de obstáculos. Conserva el nivel y elige otra zona.');
  const at = (x, y, z) => [center[0] + x, floorY + y, center[1] + z];
  return {center: center.slice(), floorY, usableBounds: bounds.slice(), footprint: footprint(center),
    rack: at(0, 1, -5), incoming: at(6, 1, 4), outgoing: at(-6, 1, 4), returns: at(6, 1, -5), vehicle: at(0, 0, 5), at};
}

function reportFor(document, roomId, group, changed, extra = {}) {
  const objects = group.members.map(value => document.getObject(value)).filter(Boolean);
  const vehicle = objects.find(object => component(document, object, 'vehicle') && JSON.parse(component(document, object, 'vehicle').trainingTasksJson || '[]').some(task => task.id === 'learn-wh-01'));
  const tasks = vehicle ? JSON.parse(component(document, vehicle, 'vehicle').trainingTasksJson) : [];
  const object = value => value && document.getObject(value), rack = object(tasks[0] && tasks[0].sourceId);
  return Object.assign({changed, roomId, groupId: group.id, objects, objectIds: objects.map(id), vehicle, vehicleId: vehicle && id(vehicle), tasks,
    rack, incoming: object(tasks[1] && tasks[1].sourceId), outgoing: object(tasks[0] && tasks[0].destinationId), returns: object(tasks[2] && tasks[2].destinationId), products: tasks.map(task => object(task.productId)),
    productIds: tasks.map(task => task.productId), sourceIds: [...new Set(tasks.map(task => task.sourceId))], destinationIds: [...new Set(tasks.map(task => task.destinationId))], expectedUnits: 12}, extra);
}

/** Add one manual warehouse lesson to an existing room. The original floor,
 * architecture, robot, line, pallets, camera and room settings stay authored.
 * A persisted group and name prefix make repeat application a no-op. */
export function addWarehouseMissionExperience(document, roomId, options = {}) {
  const root = document.getRoot(roomId);
  if (!root) throw new Error('El nivel elegido no existe.');
  const groupId = GROUP_PREFIX + roomId, studio = document.studio || {}, previous = (studio.groups || []).find(group => group.id === groupId);
  if (previous) {
    if (previous.members.some(value => !document.getObject(value))) throw new Error('La práctica está incompleta; restaura su grupo antes de volver a aplicarla.');
    const report = reportFor(document, roomId, previous, false);
    if (!report.vehicle || report.tasks.length !== 3 || report.productIds.some(value => !document.getObject(value))) throw new Error('La práctica existente no conserva sus tres misiones.');
    return report;
  }
  if (topObjects(document, roomId).some(object => object.name.startsWith(WAREHOUSE_MISSION_PREFIX))) throw new Error('Existe una práctica parcial sin su grupo de identificación.');
  // Complete spatial inspection and validation before the first scene mutation.
  const inspection = inspectWarehouseMissionRoom(document, roomId), plan = layoutFor(document, roomId, inspection, options);
  const originals = inspection.objects.map(id), objects = [], changedIds = [], own = !document.transaction;
  if (own) document.begin();
  const set = (object, type, values) => { document.setBehaviors(object, document.getBehaviors(object).map(config => config.type === type ? Object.assign({}, config, values) : config)); };
  const add = (type, name, variant, values, position) => {
    const object = document.addPrefab(roomId, type, variant); if (values) set(object, type, values);
    document.setProperty(object, 'name', WAREHOUSE_MISSION_PREFIX + name); document.setTransform(object, {position}); objects.push(object); return object;
  };
  try {
    const stock = {running: true, withPanel: false, acceptsPallets: true, palletType: 'euro-1200x800', palletMaterial: 'wood', width: 1.2, depth: .8,
      palletCapacity: 1, capacity: 1, columns: 1, rows: 1, layers: 1, autoRelease: false, delivery: 'manual'};
    // Pick a unique address prefix without renaming any existing rack.
    const prefixes = new Set(inspection.objects.map(object => component(document, object, 'palletQueue')).filter(config => config && schema.warehouseRacks.isRack(config)).map(schema.warehouseRacks.addressPrefix));
    let aisle = 'A01'; for (let index = 1; prefixes.has(aisle + '-R01'); index++) aisle = 'A' + String(index + 1).padStart(2, '0');
    const rack = add('palletQueue', 'rack selectivo ' + aisle + ' / R01', undefined, Object.assign({}, stock, schema.warehouseRacks.defaults('selective'), {
      rackBays: 2, rackLevels: 2, rackColumns: 2, rackBayWidths: '3, 3', rackSlotDepth: 1.1, rackBaseHeight: .3, rackLevelHeight: 1.4,
      rackAisleCode: aisle, rackRowCode: 'R01', rackAssignments: '[]', withPanel: false}), plan.rack);
    const layout = schema.warehouseRacks.layout(component(document, rack, 'palletQueue'));
    const upper = layout.cells.find(cell => cell.bay === 0 && cell.level === 1 && cell.column === 0);
    const lower = layout.cells.find(cell => cell.bay === 1 && cell.level === 0 && cell.column === 0);
    const empty = layout.cells.find(cell => cell.bay === 1 && cell.level === 1 && cell.column === 1);
    const incoming = add('palletQueue', 'ENTRADA E01 · recepción', undefined, stock, plan.incoming);
    const outgoing = add('palletQueue', 'SALIDA S01 · expedición', undefined, stock, plan.outgoing);
    const returns = add('palletQueue', 'DEVOLUCIÓN D01 · revisión', undefined, stock, plan.returns);
    const seed = (name, sku, store, cell, color) => {
      const product = add('product', name, 'pallet-loaded', {sourceId: id(store), sku, productType: 'pallet', loadMode: 'pallet', units: 4, mass: 33,
        width: 1.2, depth: .8, height: .72, palletType: 'euro-1200x800', palletMaterial: 'wood', contents: 'boxes', color}, [0, 0, 0]);
      const box = boundsIn(product, product), center = box.getCenter(new THREE.Vector3());
      document.setTransform(product, {position: [store.position.x + cell.position[0] - center.x, store.position.y + cell.position[1] + .005 - box.min.y, store.position.z + cell.position[2] - center.z]});
      return product;
    };
    const highPallet = seed('WH-001 · retirada superior · 4 cajas / 33 kg', 'WH-001', rack, upper, '#b99b67');
    const newPallet = seed('WH-002 · recepción · 4 cajas / 33 kg', 'WH-002', incoming, {position: [0, -1, 0]}, '#6d8e9b');
    const lowPallet = seed('WH-003 · devolución · 4 cajas / 33 kg', 'WH-003', rack, lower, '#b6a57a');
    set(rack, 'palletQueue', {rackAssignments: JSON.stringify([{locationCode: empty.code, palletId: id(newPallet)}])});
    const point = (x, z) => ({x: plan.center[0] + x, z: plan.center[1] + z});
    const tasks = [
      {id: 'learn-wh-01', name: '1 · Retirar WH-001 del nivel superior y entregar en SALIDA S01', scoring: true, productId: id(highPallet), sourceId: id(rack), sourceLocationCode: upper.code, destinationId: id(outgoing), destinationSlot: 0,
        pickupRoute: [point(0, 0), point(upper.x, 0), point(upper.x, -2)], route: [point(upper.x, 0), point(-6, 0), point(-8.5, 7), point(-6, 7)]},
      {id: 'learn-wh-02', name: '2 · Recoger WH-002 de ENTRADA E01 y reponer ' + empty.code, scoring: true, productId: id(newPallet), sourceId: id(incoming), destinationId: id(rack), locationCode: empty.code,
        pickupRoute: [point(-6, 7), point(0, 7), point(6, 7)], route: [point(6, 7), point(8.5, 7), point(6, 0), point(empty.x, 0), point(empty.x, -2)]},
      {id: 'learn-wh-03', name: '3 · Retirar WH-003 del primer nivel y entregar en DEVOLUCIÓN D01', scoring: true, productId: id(lowPallet), sourceId: id(rack), sourceLocationCode: lower.code, destinationId: id(returns), destinationSlot: 0,
        pickupRoute: [point(empty.x, 0), point(lower.x, 0), point(lower.x, -2)], route: [point(lower.x, 0), point(6, 0), point(6, -2)]}
    ];
    if (plan.pickupRoutes) tasks.forEach((task, index) => { task.pickupRoute = plan.pickupRoutes[index]; task.route = plan.deliveryRoutes[index]; });
    let vehicle = inspection.objects.find(object => { const config = component(document, object, 'vehicle'); return config && config.mode === 'manual' && (!config.trainingTasksJson || config.trainingTasksJson === '[]') && !document.isNative(object); });
    const reusedVehicle = !!vehicle, vehicleValues = {mode: 'manual', powered: true, running: true, parkingBrake: true, paused: false, emergency: false, forkSpread: .48,
      speed: 1.35, reverseSpeed: .85, maxLift: 3, detail: 'balanced', sourceId: id(rack), outputId: id(outgoing), waypointsJson: '[]', trainingTasksJson: JSON.stringify(tasks)};
    if (vehicle) { vehicleValues.maxLift = Math.max(3, component(document, vehicle, 'vehicle').maxLift); set(vehicle, 'vehicle', vehicleValues); document.setTransform(vehicle, {position: plan.vehicle}); objects.push(vehicle); changedIds.push(id(vehicle)); }
    else vehicle = add('vehicle', 'montacargas manual · misiones', 'forklift-electric-3w', Object.assign({serial: 'WH-LEARN-01'}, vehicleValues), plan.vehicle);
    document.setTransform(vehicle, {rotation: [0, Math.PI, 0]});
    const bay = position => [position[0] - .85, position[2] - .65, position[0] + .85, position[2] + .65];
    const floorPlan = {type: 'industrialFloor', version: 1, bounds: plan.footprint, floorY: plan.floorY,
      walkways: [], zones: [[plan.center[0] - 3.35, plan.center[1] - 5.85, plan.center[0] + 3.35, plan.center[1] - 3.9]],
      bays: [bay(plan.incoming), bay(plan.outgoing), bay(plan.returns)], arrows: plan.arrows || [-5, 0, 5].map(x => [plan.center[0] + x, plan.center[1], -Math.PI / 2]),
      texts: ['ENTRADA E01', 'SALIDA S01', 'DEVOLUCIÓN D01', 'PASILLO ' + aisle + ' · FILA R01'],
      labels: [[plan.incoming[0], plan.incoming[2] + 1.15, 0, 2.4, .4, 8], [plan.outgoing[0], plan.outgoing[2] + 1.15, 0, 2.4, .4, 9],
        [plan.returns[0], plan.returns[2] + 1.15, 0, 2.4, .4, 10], [plan.rack[0], plan.rack[2] + 1.9, 0, 4.8, .4, 11]], signs: []};
    const presentation = document.addIndustrialFloorPresentation(roomId, floorPlan); document.setProperty(presentation, 'name', WAREHOUSE_MISSION_PREFIX + 'bahías y códigos de piso'); objects.push(presentation);
    const group = {id: groupId, name: 'Aprendizaje · misiones de almacén', roomId, members: objects.map(id)};
    document.setStudio({groups: (document.studio && document.studio.groups || []).concat(group)});
    if (own) document.commit();
    return reportFor(document, roomId, group, true, {rack, incoming, outgoing, returns, products: [highPallet, newPallet, lowPallet], layout, seededSlots: [upper, lower], destinationSlot: empty,
      plan, floorPresentation: {presentation, plan: floorPlan}, preservedObjectIds: originals.filter(value => !changedIds.includes(value)), changedObjectIds: changedIds, reusedVehicle, reusedIncomingPallet: false});
  } catch (error) { if (own) document.cancel(); throw error; }
}
