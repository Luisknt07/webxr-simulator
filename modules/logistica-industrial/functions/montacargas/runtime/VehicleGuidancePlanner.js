import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
export const GUIDANCE_LIMIT = 8;
export function guidanceVisible(object) { for (let node = object; node; node = node.parent) if (!node.visible) return false; return !!object; }
const position = object => object.getWorldPosition(new THREE.Vector3());
const label = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim().slice(0, 160) : fallback;
function priority(a, b) { return Number(b.preferred) - Number(a.preferred) || Number(!!a.occupied) - Number(!!b.occupied) || a.distanceM - b.distanceM; }
function ownerId(product) { return product.sourceEntry && product.sourceEntry.ownerId || product.item && (product.item.beltId || product.item.palletOwnerId) || product.record && product.record.id || ''; }
function productId(product) { return String(product.record && product.record.id || product.object.userData && product.object.userData.sourcePalletId || product.sourcePalletId || product.sourceEntry && product.sourceEntry.id || product.object.uuid); }
function matchesProduct(product, id) { return !id || [productId(product), product.record && product.record.id, product.sourcePalletId, product.sourceEntry && product.sourceEntry.id].includes(id); }
export function guidanceTraining(driving, record) {
  const training = driving.simulation && driving.simulation.vehicleTraining;
  return training && typeof training.guidance === 'function' ? training.guidance(record) : null;
}
function cellFor(runtime, product) {
  const owner = product.item && runtime.records.get(product.item.palletOwnerId), stock = owner && owner.components.palletQueue;
  return stock && stock.rack && runtime.palletQueueRuntime.rackCell(stock, product.item.palletIndex);
}
function requestedPlacement(runtime, api, record, target, product) {
  const stock = target.record.components.palletQueue, queue = runtime.palletQueueRuntime;
  if (!stock || !queue || target.slotIndex === undefined) return api.missionDestination(record, {targetId: target.targetId});
  if (!queue.operational(stock)) return null;
  let center;
  if (stock.rack) {
    const cell = stock.rack.layout.cells.find(value => value.index === target.slotIndex);
    if (!cell) return null;
    center = product.bounds.getCenter(new THREE.Vector3()).applyMatrix4(queue.rackMatrix(target.record, product, queue.rackPoint(stock, cell)));
  } else {
    const pallet = stock.pallets[target.slotIndex]; if (!pallet) return null;
    center = position(pallet.object);
  }
  const placement = queue.placement(target.record, product, [], center, false, matrix => api.receivingForks(record, product, matrix));
  if (!placement || placement.palletIndex !== target.slotIndex || target.locationCode && placement.locationCode !== target.locationCode) return null;
  return {kind: 'stock', matrix: placement.matrix, placement, targetId: target.targetId};
}

// Rank known unavailable loads/receivers before spending the eight-target
// geometry budget. A busy nearby group must not hide a usable distant target.
// These checks read custody, queue state and dimensions; they do not plan a
// placement, sweep collision geometry, reserve inventory or authorize transfer.
function availableFirst(candidates, count, reason) {
  candidates.forEach(target => { target.availabilityReason = reason(target); });
  return candidates.sort((a, b) => Number(!!a.availabilityReason) - Number(!!b.availabilityReason) || priority(a, b)).slice(0, count);
}
function pickupAvailabilityReason(api, record, product) {
  const runtime = api.runtime, v = record.components.vehicle;
  if (!guidanceVisible(product.object)) return 'La carga no está visible.';
  if (product.heldBy || product.robotOwnerId || product.robotReservedBy) return 'Espera: la carga sigue en manos del robot o de otro operador.';
  if (product.vehicleReservedBy && product.vehicleReservedBy !== record.id || !api.transferableCart(record, product)) return 'La carga está reservada por otro vehículo.';
  if (runtime.processorRuntime && !runtime.processorRuntime.canPickup(product) || runtime.palletQueueRuntime && !runtime.palletQueueRuntime.canPickup(product)) return 'La estación todavía no permite retirar esta carga.';
  const existing = product.sourceEntry, owner = existing && runtime.records.get(existing.ownerId), inventory = owner && (owner.components.source || owner.components.processor && owner.components.processor.output);
  if (inventory && inventory.queue[0] !== existing) return 'Retira primero el pallet accesible de esta estación.';
  const belt = product.item && runtime.records.get(product.item.beltId);
  if (belt && belt.components.conveyor && Math.abs(belt.components.conveyor.actualSpeed) > .025) return 'Detén la banda antes de retirar el pallet.';
  const metadata = runtime.productMetadata(product);
  if (!Number.isFinite(metadata.mass) || metadata.mass > api.capacity(v, metadata) + 1e-6) return 'La carga supera la capacidad disponible del equipo.';
  return '';
}
function pickupReason(api, record, product) {
  const runtime = api.runtime, v = record.components.vehicle;
  if (!api.compatible(product) || !api.productPockets(product)) return 'La carga no tiene entradas compatibles para ambas horquillas.';
  const stock = product.item && runtime.records.get(product.item.palletOwnerId);
  if (stock && !runtime.palletQueueRuntime.rackAccess(stock, product, null, true)) return 'Retira primero la carga accesible de esta posición.';
  if (stock && stock.components.palletQueue.rack) {
    const cell = runtime.palletQueueRuntime.rackCell(stock.components.palletQueue, product.item.palletIndex);
    if (cell && cell.requiredReachM > v.config.forkLength + (v.config.maxReach || 0) + .05) return 'Este equipo no tiene alcance suficiente para la posición del pallet.';
  }
  return '';
}
function dropAvailabilityReason(runtime, target, entry, metadata, size) {
  const record = target.record, c = record.components, stock = c.palletQueue, product = entry.product;
  const unavailable = 'El destino está ocupado, deshabilitado o no admite esta carga.';
  if (stock) {
    if (!runtime.palletQueueRuntime.operational(stock) || target.occupied || stock.queue.length >= stock.config.capacity) return unavailable;
    if (stock.rack) {
      const cell = target.cell, accepted = stock.rack.definition.acceptedLoad, pallet = metadata.loadMode === 'pallet' || metadata.productType === 'pallet';
      if (accepted === 'pallet' && !pallet || accepted === 'individual' && pallet) return unavailable;
      if (cell && (Math.abs(size.x) > cell.width + .001 || Math.abs(size.z) > cell.depth + .001 || Math.abs(size.y) > cell.clearHeight + .001 || metadata.mass > cell.capacityKg + .001)) return unavailable;
    } else if (stock.config.acceptsPallets && metadata.loadMode !== 'pallet') return unavailable;
  }
  if (c.processor && runtime.processorRuntime && !runtime.processorRuntime.canReceive(record, entry)) return unavailable;
  if (c.source && (!c.source.enabled || !c.source.running || c.source.paused || c.source.queue.length || !runtime.sourceRuntime.fits(record, entry))) return unavailable;
  if (c.conveyor && (c.conveyor.packages.length >= c.conveyor.config.maxPackages || runtime.packageCount >= 500 ||
      runtime.admissionReady && !runtime.admissionReady(record, c.conveyor, false) || runtime.productCompatible && !runtime.productCompatible(record, c.conveyor, product, false))) return unavailable;
  return '';
}
function pickupApproach(api, record, target) {
  const product = target.product, pockets = api.productPockets(product), direction = new THREE.Vector3(0, 0, 1).applyQuaternion(product.object.getWorldQuaternion(new THREE.Quaternion()));
  const base = Math.atan2(direction.x, direction.z), axes = pockets.approachAxes || ['x', 'z'], here = position(record.object), choices = [];
  const owner = api.runtime.records.get(target.targetId), stock = owner && owner.components.palletQueue;
  const cell = stock && stock.rack && api.runtime.palletQueueRuntime.rackCell(stock, product.item.palletIndex);
  for (const axis of axes) for (const side of [0, Math.PI]) {
    const yaw = base + (axis === 'x' ? Math.PI / 2 : 0) + side, dock = api.pickupDock(record, {targetId: target.targetId, yaw}, product);
    if (!dock) continue;
    if (cell) {const local = owner.object.worldToLocal(dock.position.clone()); if (cell.pickFace === 'front' && local.z < cell.position[2] - .05 || cell.pickFace === 'rear' && local.z > cell.position[2] + .05) continue;}
    choices.push({dock, distance: dock.position.distanceTo(here)});
  }
  choices.sort((a,b) => a.distance - b.distance); return choices[0] && choices[0].dock;
}

/** Read-only suggestions. Final readiness always comes from getDockingState;
 * missionDestination/pickupDock are the same planners used by the real truck.
 * No reservations, transfer commands, routes or authored data are changed. */
export function buildGuidanceTargets(driving, record, limit = GUIDANCE_LIMIT) {
  const runtime = driving.simulation, api = runtime && runtime.vehicleRuntime, v = record && record.components.vehicle;
  if (!api || !v || !api.rig(record).forks) return [];
  const here = position(record.object), candidates = [], count = Math.max(1, Math.min(GUIDANCE_LIMIT, limit)), mission = guidanceTraining(driving, record);
  if (mission && ['withdraw', 'complete'].includes(mission.phase)) return [];
  if (!v.entry) {
    runtime.products.forEach(product => {
      if (!product || !product.object || !guidanceVisible(product.object) || !api.compatible(product)) return;
      if (mission && (mission.phase !== 'pickup' || !matchesProduct(product, mission.productId))) return;
      const cell = cellFor(runtime, product);
      if (mission && mission.sourceLocationCode && (!cell || cell.code !== mission.sourceLocationCode)) return;
      product.object.updateWorldMatrix(true, true);
      const id = ownerId(product), center = product.bounds.getCenter(new THREE.Vector3()).applyMatrix4(product.object.matrixWorld);
      candidates.push({id: 'pickup:' + productId(product), targetId: id, kind: 'pickup', name: label(product.object.name, 'Pallet') + (cell ? ' · ' + cell.code : ''), product,
        locationCode: cell && cell.code || '', slotIndex: cell && cell.index, distanceM: center.distanceTo(here), preferred: !!mission || !!v.config.sourceId && id === v.config.sourceId});
    });
    return availableFirst(candidates, count, target => pickupAvailabilityReason(api, record, target.product)).map(target => {
      let reason = target.availabilityReason || pickupReason(api, record, target.product);
      const dock = !reason && pickupApproach(api, record, target);
      if (!reason && !dock) reason = 'No hay una aproximación de horquillas compatible con este pallet.';
      if (!reason && dock.toolY - v.originWorld.y > v.config.maxLift + v.config.forkBaseHeight + .02) reason = 'El pallet está por encima de la elevación máxima del equipo.';
      return Object.assign(target, {allowed: !reason, reason, dock: dock || null, candidateCount: candidates.length, selectionLimit: count,
        matrix: target.product.object.matrixWorld.clone(), bounds: target.product.bounds.clone()});
    });
  }
  if (mission && (mission.phase !== 'drop' || !matchesProduct(v.entry.product, mission.productId))) return [];
  const metadata = runtime.productMetadata(v.entry.product), size = v.entry.product.bounds.getSize(new THREE.Vector3()).multiply(v.entry.product.scale);
  runtime.records.forEach(target => {
    if (target === record || !guidanceVisible(target.object) || !(target.components.palletQueue || target.components.conveyor || target.components.processor || target.components.source)) return;
    if (mission && target.id !== mission.destinationId) return;
    const stock = target.components.palletQueue;
    if (stock && stock.rack) {
      const cells = stock.rack.layout.cells, occupied = new Set(stock.items.map(item => item.palletIndex));
      cells.forEach(cell => {
        if (mission && (mission.locationCode ? cell.code !== mission.locationCode : Number.isInteger(mission.destinationSlot) && cell.index !== mission.destinationSlot)) return;
        const center = target.object.localToWorld(new THREE.Vector3().fromArray(runtime.palletQueueRuntime.rackPoint(stock, cell)));
        candidates.push({id: 'drop:' + target.id + ':' + cell.code, targetId: target.id, kind: 'drop', name: label(target.object.name, target.id) + ' · ' + cell.code,
          record: target, cell, locationCode: cell.code, slotIndex: cell.index, occupied: occupied.has(cell.index), distanceM: center.distanceTo(here), preferred: !!mission || !occupied.has(cell.index) && target.id === v.config.outputId});
      });
      return;
    }
    candidates.push({id: 'drop:' + target.id, targetId: target.id, kind: 'drop', name: label(target.object.name, target.id), record: target,
      slotIndex: mission && Number.isInteger(mission.destinationSlot) ? mission.destinationSlot : undefined, locationCode: mission && mission.locationCode || '',
      distanceM: position(target.object).distanceTo(here), preferred: !!mission || !!v.config.outputId && target.id === v.config.outputId});
  });
  return availableFirst(candidates, count, target => dropAvailabilityReason(runtime, target, v.entry, metadata, size)).map(target => {
    const training = runtime.vehicleTraining;
    const destination = !target.availabilityReason && (mission && training && typeof training.destination === 'function' ? training.destination(record) : requestedPlacement(runtime, api, record, target, v.entry.product));
    let reason = target.availabilityReason || (destination ? '' : 'El destino está ocupado, deshabilitado o no admite esta carga.');
    if (!reason && target.slotIndex !== undefined && (!destination.placement || destination.placement.palletIndex !== target.slotIndex || target.locationCode && destination.placement.locationCode !== target.locationCode)) reason = 'Esta ubicación exacta no está disponible para el pallet asignado.';
    const belt = target.record.components.conveyor;
    if (!reason && belt && (belt.packages.length >= belt.config.maxPackages || runtime.packageCount >= 500)) reason = 'La banda de destino no tiene capacidad disponible.';
    const dock = !reason && api.dropDock(record, {targetId: target.targetId}, destination);
    if (!reason && !dock) reason = 'No hay una aproximación de depósito compatible.';
    if (!reason && dock.toolY - v.originWorld.y > v.config.maxLift + v.config.forkBaseHeight + .02) reason = 'La ubicación está por encima de la elevación máxima del equipo.';
    return Object.assign(target, {allowed: !reason, reason, destination: destination || null, dock: dock || null, candidateCount: candidates.length, selectionLimit: count,
      matrix: destination && destination.matrix ? destination.matrix.clone() : null, bounds: v.entry.product.bounds.clone(), product: v.entry.product});
  });
}

export function guidanceTargetReady(snapshot, target) {
  if (!snapshot || !snapshot.ready || !target || !target.allowed) return false;
  if (target.kind === 'drop') {
    if (snapshot.phase !== 'drop' || !snapshot.destination || snapshot.destination.id !== target.targetId) return false;
    if (target.locationCode && snapshot.destination.locationCode && snapshot.destination.locationCode !== target.locationCode) return false;
    if (target.slotIndex !== undefined && snapshot.destination.palletIndex !== undefined && target.slotIndex !== snapshot.destination.palletIndex) return false;
    // A receiver ID is not a position: different levels and slots share it.
    // Exact physical support geometry remains necessary even with task tags.
  } else if (snapshot.phase !== 'pickup') return false;
  if (snapshot.productId && !matchesProduct(target.product, snapshot.productId)) return false;
  if (!snapshot.geometry || !Array.isArray(snapshot.geometry.target) || snapshot.geometry.target.length !== 4 || !target.matrix || !target.bounds) return false;
  const observed = snapshot.geometry.target.reduce((sum, point) => sum.add(new THREE.Vector3().fromArray(point)), new THREE.Vector3()).multiplyScalar(.25);
  const expected = target.bounds.getCenter(new THREE.Vector3()); expected.y = target.bounds.min.y; expected.applyMatrix4(target.matrix);
  return expected.distanceTo(observed) < .08;
}

export const GUIDANCE_ROUTE_ARROWS = 64;
const finitePoint = value => value && Number.isFinite(value.x) && Number.isFinite(value.z) && (value.y === undefined || Number.isFinite(value.y));
function routeBoxAt(localBox, point, yaw) {
  return localBox.clone().applyMatrix4(new THREE.Matrix4().compose(point, new THREE.Quaternion().setFromAxisAngle(UP, yaw), new THREE.Vector3(1, 1, 1)));
}
function routeEnvelope(api, record) {
  const v = record.components.vehicle, c = v.config, rig = api.rig(record), inverse = new THREE.Matrix4().getInverse(record.object.matrixWorld);
  const scale = record.object.getWorldScale(new THREE.Vector3()), box = new THREE.Box3(new THREE.Vector3(-c.width / 2, .05, -c.length / 2), new THREE.Vector3(c.width / 2, c.height, c.length / 2));
  const forks = guidanceForkBox(api, record);
  if (forks) box.union(forks.clone().applyMatrix4(inverse));
  if (v.entry && v.entry.product) {
    const product = v.entry.product; product.object.updateWorldMatrix(true, false);
    box.union(product.bounds.clone().applyMatrix4(product.object.matrixWorld).applyMatrix4(inverse));
  }
  box.min.multiply(scale); box.max.multiply(scale); box.expandByScalar(.035); box.min.y = Math.max(.025, box.min.y);
  return box;
}

/** Read-only floor route, deliberately not autonomous navigation. Every leg
 * is checked against the real collision world with the truck, fork and load
 * envelope. A blocked leg hides all arrows beyond it. Turns use a conservative
 * swept envelope too; a thin floor ray alone cannot prove vehicle clearance. */
export function guidanceRoute(driving, record, mission = guidanceTraining(driving, record)) {
  const floor = record.components.vehicle.originWorld.y, raw = mission && mission.route;
  if (!Array.isArray(raw) || !raw.length || !['pickup', 'drop'].includes(mission.phase)) return null;
  const authored = raw.slice(0, 64).filter(finitePoint).map(value => new THREE.Vector3(value.x, floor + .035, value.z));
  if (!authored.length || authored.length !== Math.min(raw.length, 64)) return {arrows: [], points: [], blockedAt: null, blocked: true, clear: false, distanceM: 0, index: 0, total: 0, note: 'Ruta no válida; detén el vehículo y revisa los puntos.'};
  const index = Math.max(0, Math.min(authored.length, Number.isInteger(mission.waypointIndex) ? mission.waypointIndex : 0));
  const here = position(record.object).setY(floor + .035), points = [here, ...authored.slice(index)], arrows = [], api = driving.simulation.vehicleRuntime, world = driving.ctx.collisionWorld;
  const local = routeEnvelope(api, record), options = api.collisionOptions(record, record.components.vehicle.entry && record.components.vehicle.entry.product), canCheck = !!(world && world.sweepBox && world.testBox);
  const facing = new THREE.Vector3(0, 0, 1).transformDirection(record.object.matrixWorld);
  const clearPoints = [here.clone()];
  let blocked = false, blockedAt = null, distanceM = 0, verified = canCheck, previousYaw = Math.atan2(facing.x, facing.z);
  points.forEach((point, i) => {if (i) distanceM += Math.hypot(point.x - points[i - 1].x, point.z - points[i - 1].z);});
  for (let i = 1; i < points.length; i++) {
    const start = points[i - 1], end = points[i], direction = end.clone().sub(start), length = direction.length();
    if (length < .04) continue;
    const travelYaw = Math.atan2(direction.x, direction.z), headingDelta = Math.atan2(Math.sin(travelYaw - previousYaw), Math.cos(travelYaw - previousYaw));
    // Route arrows indicate travel direction, including backing out of a rack.
    // Do not invent a 180° turn of the chassis while its forks remain inserted.
    const yaw = Math.abs(headingDelta) > Math.PI / 2 ? travelYaw + Math.PI : travelYaw, startAt = start.clone().setY(floor), endAt = end.clone().setY(floor);
    if (canCheck) {
      const box = routeBoxAt(local, startAt, yaw), endBox = routeBoxAt(local, endAt, yaw);
      if (world.testBox(box, options) || world.sweepBox(box, endAt.clone().sub(startAt), options).blocked || world.testBox(endBox, options)) {blocked = true; blockedAt = start.clone(); break;}
      if (previousYaw !== undefined) {
        const angle = Math.atan2(Math.sin(yaw - previousYaw), Math.cos(yaw - previousYaw)), pieces = Math.max(1, Math.ceil(Math.abs(angle) / (Math.PI / 18)));
        const radius = Math.hypot(Math.max(Math.abs(local.min.x), Math.abs(local.max.x)), Math.max(Math.abs(local.min.z), Math.abs(local.max.z))), skin = radius * Math.abs(angle) / (2 * pieces);
        for (let sample = 0; sample <= pieces; sample++) {
          const turnBox = routeBoxAt(local, startAt, previousYaw + angle * sample / pieces);
          // Cover the angular interval between samples, including a raised
          // load clipping a thin post while the chassis itself is clear.
          turnBox.min.x -= skin; turnBox.max.x += skin; turnBox.min.z -= skin; turnBox.max.z += skin;
          if (world.testBox(turnBox, options)) {blocked = true; break;}
        }
        if (blocked) {blockedAt = start.clone(); break;}
      }
    } else {verified = false; break;}
    direction.normalize();
    for (let distance = Math.min(.55, length / 2); distance < length && arrows.length < GUIDANCE_ROUTE_ARROWS; distance += 1.05) arrows.push({position: start.clone().addScaledVector(direction, distance), yaw: travelYaw});
    clearPoints.push(end.clone());
    previousYaw = yaw;
  }
  return {arrows, points: canCheck ? clearPoints : [], blockedAt, blocked, clear: verified && !blocked, distanceM, index, total: authored.length, note: blocked ? 'Ruta bloqueada: frena y revisa el pasillo. No continúes por las flechas.' : !verified ? 'Sin comprobación física disponible: revisa el pasillo antes de avanzar.' : 'Ruta guiada manual · pasillo comprobado con la carga actual; observa el entorno.'};
}

export function guidanceForkBox(api, record) {
  const rig = api.rig(record), c = record.components.vehicle.config;
  if (!rig || !rig.forks) return null;
  rig.forks.updateWorldMatrix(true, false);
  return new THREE.Box3(new THREE.Vector3(-c.forkSpread / 2 - c.forkWidth / 2, -c.forkThickness, 0),
    new THREE.Vector3(c.forkSpread / 2 + c.forkWidth / 2, .015, c.forkLength)).applyMatrix4(rig.forks.matrixWorld);
}

/** A short local docking corridor only. It is never a route from the operator
 * to a distant bay, and an obstacle suppresses the chevrons instead of drawing
 * through equipment. The full truck remains governed by normal collisions. */
export function guidanceApproach(driving, record, target) {
  const api = driving.simulation.vehicleRuntime, world = driving.ctx.collisionWorld, dock = target && target.dock;
  if (!target || !target.allowed || !dock) return null;
  const forward = new THREE.Vector3(Math.sin(dock.yaw), 0, Math.cos(dock.yaw)), c = record.components.vehicle.config;
  const start = dock.position.clone().addScaledVector(forward, -2.2), end = dock.position.clone().addScaledVector(forward, -.65);
  if (world && world.sweepBox) {
    const radius = Math.hypot(c.width, c.length) / 2, height = Math.max(c.height, c.forkBaseHeight + (record.components.vehicle.pose.lift || 0));
    const box = new THREE.Box3(new THREE.Vector3(-radius, .05, -radius), new THREE.Vector3(radius, height, radius)).translate(start);
    if (world.sweepBox(box, end.clone().sub(start), api.collisionOptions(record, target.product)).blocked) return null;
  }
  return {start, end, yaw: dock.yaw, y: record.components.vehicle.originWorld.y + .025};
}
