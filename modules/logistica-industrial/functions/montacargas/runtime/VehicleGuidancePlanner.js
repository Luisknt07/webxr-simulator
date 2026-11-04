import * as THREE from 'three';
import {dropTargetGeometry} from './VehicleDropPlacement.js';

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
  if (!placement || placement.palletIndex !== target.slotIndex || stock.rack && target.locationCode && placement.locationCode !== target.locationCode) return null;
  return {kind: 'stock', matrix: placement.matrix, placement, targetId: target.targetId};
}

// Rank known unavailable loads/receivers before spending the eight-target
// geometry budget. A busy nearby group must not hide a usable distant target.
// These checks read custody, queue state and dimensions; they do not plan a
// placement, sweep collision geometry, reserve inventory or authorize transfer.
function availableFirst(candidates, count, reason, selectedId = '') {
  candidates.forEach(target => { target.availabilityReason = reason(target); });
  return candidates.sort((a, b) => Number(b.id === selectedId) - Number(a.id === selectedId) || Number(!!a.availabilityReason) - Number(!!b.availabilityReason) || priority(a, b)).slice(0, count);
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
    } else if (stock.config.acceptsPallets) {
      if (metadata.loadMode !== 'pallet') return unavailable;
      const pallet = Number.isInteger(target.slotIndex) && stock.pallets[target.slotIndex];
      if (!pallet) return unavailable;
      const scale = pallet.object.getWorldScale(new THREE.Vector3());
      if (Math.abs(size.x) > stock.config.width*Math.abs(scale.x)+.02 || Math.abs(size.z) > stock.config.depth*Math.abs(scale.z)+.02) return 'La carga es demasiado grande para la bahía seleccionada.';
    }
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
export function buildGuidanceTargets(driving, record, limit = GUIDANCE_LIMIT, selection = null) {
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
  const pinned = selection && selection.product === v.entry.product ? selection : null;
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
    if (stock && stock.config.acceptsPallets && Array.isArray(stock.pallets)) {
      stock.pallets.forEach((pallet,index) => {
        if (mission && Number.isInteger(mission.destinationSlot) && index !== mission.destinationSlot) return;
        const code = 'BAHÍA-'+String(index+1).padStart(2,'0');
        candidates.push({id:'drop:'+target.id+':bay:'+index,targetId:target.id,kind:'drop',name:label(target.object.name,target.id)+' · '+code,record:target,
          slotIndex:index,locationCode:code,occupied:stock.items.some(item => (item.palletIndex || 0) === index),distanceM:position(pallet.object).distanceTo(here),preferred:!!mission || target.id === v.config.outputId});
      });
      return;
    }
    candidates.push({id: 'drop:' + target.id, targetId: target.id, kind: 'drop', name: label(target.object.name, target.id), record: target,
      slotIndex: mission && Number.isInteger(mission.destinationSlot) ? mission.destinationSlot : pinned && pinned.targetId === target.id ? pinned.slotIndex : undefined, locationCode: mission && mission.locationCode || pinned && pinned.targetId === target.id && pinned.locationCode || '',
      distanceM: position(target.object).distanceTo(here), preferred: !!mission || !!v.config.outputId && target.id === v.config.outputId});
  });
  return availableFirst(candidates, count, target => dropAvailabilityReason(runtime, target, v.entry, metadata, size),pinned && pinned.id || '').map(target => {
    const training = runtime.vehicleTraining;
    const destination = !target.availabilityReason && (mission && training && typeof training.destination === 'function' ? training.destination(record) : requestedPlacement(runtime, api, record, target, v.entry.product));
    if (destination && destination.placement && target.slotIndex === undefined) {target.slotIndex = destination.placement.palletIndex; target.locationCode = destination.placement.locationCode || target.locationCode;}
    let reason = target.availabilityReason || (destination ? '' : 'El destino está ocupado, deshabilitado o no admite esta carga.');
    if (!reason && target.slotIndex !== undefined && (!destination.placement || destination.placement.palletIndex !== target.slotIndex || target.record.components.palletQueue.rack && target.locationCode && destination.placement.locationCode !== target.locationCode)) reason = 'Esta ubicación exacta no está disponible para el pallet asignado.';
    const belt = target.record.components.conveyor;
    if (!reason && belt && (belt.packages.length >= belt.config.maxPackages || runtime.packageCount >= 500)) reason = 'La banda de destino no tiene capacidad disponible.';
    const dock = !reason && api.dropDock(record, {targetId: target.targetId}, destination);
    if (!reason && !dock) reason = 'No hay una aproximación de depósito compatible.';
    if (!reason && dock.toolY - v.originWorld.y > v.config.maxLift + v.config.forkBaseHeight + .02) reason = 'La ubicación está por encima de la elevación máxima del equipo.';
    const geometry = dropTargetGeometry(runtime,target,v.entry.product);
    return Object.assign(target, {allowed: !reason, reason, destination: destination || null, dock: dock || null, candidateCount: candidates.length, selectionLimit: count,
      matrix: destination && destination.matrix ? destination.matrix.clone() : geometry && geometry.matrix || null, bounds: v.entry.product.bounds.clone(), product: v.entry.product});
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
function routeEnvelopes(api,record) {
  if(typeof api.mechanismBoxes!=='function')return[routeEnvelope(api,record)];
  record.object.updateWorldMatrix(true,true);
  const v=record.components.vehicle,c=v.config,inverse=new THREE.Matrix4().getInverse(record.object.matrixWorld),scale=record.object.getWorldScale(new THREE.Vector3());
  // Native bodyBox includes the raised operator cab. Reuse its vertical
  // extent, keeping the runtime's canonical local width/length: bodyBox is a
  // world AABB, so rotating that AABB back would inflate X/Z a second time.
  const body=new THREE.Box3(new THREE.Vector3(-c.width/2,.045,-c.length/2),new THREE.Vector3(c.width/2,c.height,c.length/2));
  if(typeof api.bodyBox==='function'){const actual=api.bodyBox(record).clone().applyMatrix4(inverse);body.min.y=Math.min(body.min.y,actual.min.y);body.max.y=Math.max(body.max.y,actual.max.y);}
  const boxes=[body],mechanism=api.mechanismBoxes(record);
  if(mechanism.mast)boxes.push(mechanism.mast.clone().applyMatrix4(inverse));
  for(const box of mechanism.forks||[])boxes.push(box.clone().applyMatrix4(inverse));
  for(const part of mechanism.parts||[])if(part.bounds&&(!nonSolidRoutePart(api,part.object)))boxes.push(part.bounds.clone().applyMatrix4(inverse));
  if(v.entry&&v.entry.product){const product=v.entry.product;product.object.updateWorldMatrix(true,false);boxes.push(product.bounds.clone().applyMatrix4(product.object.matrixWorld).applyMatrix4(inverse));}
  boxes.forEach(box=>{box.min.multiply(scale);box.max.multiply(scale);box.min.y=Math.max(.025,box.min.y);});
  return boxes.filter(box=>!box.isEmpty());
}
function nonSolidRoutePart(api,object){const world=api.runtime&&api.runtime.ctx&&api.runtime.ctx.collisionWorld;return world&&world.isSolid&&!world.isSolid(object);}

// Only vehicle corridors explicitly authored in the level are a driving
// network. Green pedestrian stripes never become a shortcut for a forklift.
function authoredVehicleAisles(driving) {
  const runtime = driving.simulation, document = runtime && runtime.document, studio = document && document.studio;
  const data = studio && studio.moduleData && studio.moduleData['sector.logistics-industrial'], levels = data && data.levels;
  const level = Array.isArray(levels) && levels.find(value => value && value.roomId === runtime.roomId), layout = level && level.facility && level.facility.sharedLayout;
  const rows = layout && layout.aisles && layout.aisles.vehicleRects;
  return Array.isArray(rows) ? rows.slice(0, 16).filter(row => Array.isArray(row) && row.length >= 4 && row.slice(0,4).every(Number.isFinite) && row[2] > row[0] && row[3] > row[1]) : [];
}
const inAisle = (point, rect) => point.x >= rect[0] - .001 && point.x <= rect[2] + .001 && point.z >= rect[1] - .001 && point.z <= rect[3] + .001;
function projectToAisle(point, rect) {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  return rect[2] - rect[0] >= rect[3] - rect[1] ? new THREE.Vector3(clamp(point.x,rect[0],rect[2]), point.y, (rect[1]+rect[3])/2) : new THREE.Vector3((rect[0]+rect[2])/2, point.y, clamp(point.z,rect[1],rect[3]));
}
/** Bounded geometric route over authored vehicle corridors. It is only a
 * candidate: guidanceRoute still sweeps truck, forks, payload and turns against
 * the real scene before drawing it. End connectors are local work-zone access.
 * No paths, progress, authoring data or machine inputs are written. */
export function guidanceAislePath(start, end, rects) {
  if (!rects.length) return [start.clone(),end.clone()];
  if (rects.some(rect => inAisle(start,rect) && inAisle(end,rect))) return [start.clone(),end.clone()];
  const nodes = [], links = [];
  const add = (point, owners) => {nodes.push({point,owners});links.push([]);return nodes.length-1;};
  rects.forEach((rect,index) => add(new THREE.Vector3((rect[0]+rect[2])/2,start.y,(rect[1]+rect[3])/2),[index]));
  for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){
    const a=rects[i],b=rects[j],x0=Math.max(a[0],b[0]),z0=Math.max(a[1],b[1]),x1=Math.min(a[2],b[2]),z1=Math.min(a[3],b[3]);
    if(x1-x0>.02&&z1-z0>.02&&nodes.length<64)add(new THREE.Vector3((x0+x1)/2,start.y,(z0+z1)/2),[i,j]);
  }
  const endpoint = point => {
    const projected=rects.map((rect,index)=>({index,point:projectToAisle(point,rect)}));
    projected.forEach(value=>{value.distance=value.point.distanceTo(point);});
    const nearest=Math.min(...projected.map(value=>value.distance)),id=add(point.clone(),[]);
    // Access the nearest aisle, rather than jumping across a row of racks to
    // an arbitrary remote corridor merely because that gives a shorter graph.
    for(const value of projected.filter(value=>value.distance<=nearest+.05)){
      const index=add(value.point,[value.index]);links[id].push(index);links[index].push(id);
    }
    return id;
  };
  const from=endpoint(start),to=endpoint(end);
  for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++)if(nodes[i].owners.some(owner=>nodes[j].owners.includes(owner))){links[i].push(j);links[j].push(i);}
  const costs=new Array(nodes.length).fill(Infinity),previous=new Array(nodes.length).fill(-1),visited=new Set();costs[from]=0;
  while(visited.size<nodes.length){let at=-1;for(let i=0;i<nodes.length;i++)if(!visited.has(i)&&(at<0||costs[i]<costs[at]))at=i;
    if(at<0||!Number.isFinite(costs[at]))break;if(at===to)break;visited.add(at);
    for(const next of links[at]){const cost=costs[at]+nodes[at].point.distanceTo(nodes[next].point);if(cost<costs[next]){costs[next]=cost;previous[next]=at;}}
  }
  if(!Number.isFinite(costs[to]))return [];
  const result=[];for(let at=to;at>=0;at=previous[at]){result.unshift(nodes[at].point.clone());if(at===from)break;}
  return result.filter((point,index)=>!index||point.distanceTo(result[index-1])>.025);
}

function projectedAdvisoryIndex(here, anchor, authored, original) {
  const points=[anchor,...authored];let best=null;
  for(let segment=Math.max(1,original+1);segment<points.length;segment++){
    const a=points[segment-1],b=points[segment],dx=b.x-a.x,dz=b.z-a.z,length2=dx*dx+dz*dz;if(length2<.0016)continue;
    const t=Math.max(0,Math.min(1,((here.x-a.x)*dx+(here.z-a.z)*dz)/length2)),distance=Math.hypot(here.x-a.x-dx*t,here.z-a.z-dz*t);
    if(distance<=.85&&(!best||distance<best.distance-1e-6||Math.abs(distance-best.distance)<=1e-6&&segment>best.segment))best={segment,t,distance};
  }
  return best?Math.max(original,Math.min(authored.length,best.segment-1+(best.t>=.999?1:0))):original;
}

/** Reuse an explicitly authored manual corridor, without running its actions.
 * Runtime waypoints are already normalized into world coordinates at attach.
 * Each pickup/drop ends one leg; selecting another receiver never borrows it.
 * Progress is a read-only projection, not routeIndex, custody or task credit. */
export function guidanceAdvisoryRoute(driving, record, target) {
  const v = record && record.components.vehicle, phase = v && v.entry ? 'drop' : 'pickup';
  if (!v || v.config.mode !== 'manual' || !target || target.allowed !== true || target.kind !== phase || !target.targetId || !Array.isArray(v.route) || !v.route.length || v.route.length > 48) return null;
  let start = 0;
  for (let end = 0; end < v.route.length; end++) {
    const terminal = v.route[end];
    if (!terminal || !['pickup', 'drop'].includes(terminal.action)) continue;
    if (terminal.action === phase && terminal.targetId === target.targetId) {
      const rows = v.route.slice(start, end + 1), anchor = start ? v.route[start - 1].position : v.originWorld;
      if (!finitePoint(anchor) || rows.some(row => !row || !finitePoint(row.position))) return null;
      const route = rows.map(row => ({x:row.position.x, z:row.position.z})), path = [anchor, ...rows.map(row => row.position)], here = position(record.object);
      let nearest = null;
      for (let segment = 1; segment < path.length; segment++) {
        const a = path[segment - 1], b = path[segment], dx = b.x - a.x, dz = b.z - a.z, length2 = dx * dx + dz * dz;
        if (length2 < .0016) continue;
        const t = Math.max(0, Math.min(1, ((here.x - a.x) * dx + (here.z - a.z) * dz) / length2));
        const distance = Math.hypot(here.x - a.x - dx * t, here.z - a.z - dz * t);
        if (distance <= .85 && (!nearest || distance < nearest.distance - 1e-6 || Math.abs(distance - nearest.distance) <= 1e-6 && segment > nearest.segment)) nearest = {segment, t, distance};
      }
      const waypointIndex = nearest ? Math.min(route.length, nearest.segment - 1 + (nearest.t >= .999 ? 1 : 0)) : 0;
      return {phase, route, waypointIndex, advisory:true};
    }
    start = end + 1;
  }
  return null;
}

/** Read-only floor route, deliberately not autonomous navigation. Every leg
 * is checked against the real collision world with the truck, fork and load
 * envelope. A blocked leg hides all arrows beyond it. Turns use a conservative
 * swept envelope too; a thin floor ray alone cannot prove vehicle clearance. */
export function guidanceRoute(driving, record, mission = guidanceTraining(driving, record), selectedTarget = null) {
  if (!mission) mission = guidanceAdvisoryRoute(driving, record, selectedTarget);
  const floor = record.components.vehicle.originWorld.y, here = position(record.object).setY(floor + .035), aisles = authoredVehicleAisles(driving);
  // A selected live pallet/receiver can still have useful navigation without a
  // preprogrammed itinerary. Aisles win when supplied; elsewhere this is a
  // checked local approach, never an invented autopilot or task requirement.
  if (!mission && selectedTarget && selectedTarget.allowed && selectedTarget.dock && record.components.vehicle.config.mode === 'manual') {
    const dock=selectedTarget.dock,forward=new THREE.Vector3(Math.sin(dock.yaw),0,Math.cos(dock.yaw)),end=dock.position.clone().addScaledVector(forward,-.65).setY(here.y),path=guidanceAislePath(here,end,aisles);
    mission={phase:selectedTarget.kind,route:path.slice(1),waypointIndex:0,advisory:true,local:true};
  }
  const raw = mission && mission.route;
  if (!Array.isArray(raw) || !raw.length || !['pickup', 'drop'].includes(mission.phase)) return null;
  const authored = raw.slice(0, 64).filter(finitePoint).map(value => new THREE.Vector3(value.x, floor + .035, value.z));
  if (!authored.length || authored.length !== Math.min(raw.length, 64)) return {arrows: [], points: [], blockedAt: null, blocked: true, clear: false, distanceM: 0, index: 0, total: 0, note: 'Ruta no válida; detén el vehículo y revisa los puntos.'};
  let index = Math.max(0, Math.min(authored.length, Number.isInteger(mission.waypointIndex) ? mission.waypointIndex : 0));
  const advisory=!!(mission.advisory || mission.phase==='pickup'&&mission.pickupRouteAdvisory || mission.phase==='drop'&&mission.dropRouteAdvisory);
  if(advisory&&!mission.advisory&&!mission.routeFault)index=projectedAdvisoryIndex(here,record.components.vehicle.originWorld,authored,index);
  let points = [here, ...authored.slice(index)];
  // Rejoin the legal vehicle network for transit legs. Local docking/work-zone
  // connectors retain the exact authored approach needed by the native task.
  if(aisles.length&&!mission.local){const routed=[here];for(let i=1;i<points.length;i++){
    const start=points[i-1],end=points[i],insideStart=aisles.some(rect=>inAisle(start,rect)),insideEnd=aisles.some(rect=>inAisle(end,rect));
    const leg=insideStart&&insideEnd?guidanceAislePath(start,end,aisles):[start,end];
    if(!leg.length)return{arrows:[],points:[here],blockedAt:here,blocked:true,clear:false,distanceM:0,index,total:authored.length,advisory,note:'No hay conexión entre estos pasillos de vehículos. Revisa el acceso al destino.'};
    routed.push(...leg.slice(1));}points=routed.slice(0,65);}
  // Mission waypoint routes stop at a safe pre-approach. Continue the visible
  // reference toward the real pocket/support when that leg has been completed.
  if(selectedTarget&&selectedTarget.allowed&&selectedTarget.dock&&index>=authored.length){const dock=selectedTarget.dock,forward=new THREE.Vector3(Math.sin(dock.yaw),0,Math.cos(dock.yaw)),end=dock.position.clone().addScaledVector(forward,-.65).setY(here.y);if(end.distanceTo(here)>.08)points.push(end);}
  const arrows = [], api = driving.simulation.vehicleRuntime, world = driving.ctx.collisionWorld;
  const locals = routeEnvelopes(api, record), local=locals.reduce((box,value)=>box.union(value),new THREE.Box3()), options = api.collisionOptions(record, record.components.vehicle.entry && record.components.vehicle.entry.product), canCheck = !!(world && world.sweepBox && world.testBox);
  const facing = new THREE.Vector3(0, 0, 1).transformDirection(record.object.matrixWorld);
  const clearPoints = [here.clone()];
  let blocked = false, blockedAt = null, distanceM = 0, verified = canCheck, previousYaw = Math.atan2(facing.x, facing.z), dockingLimit=false;
  points.forEach((point, i) => {if (i) distanceM += Math.hypot(point.x - points[i - 1].x, point.z - points[i - 1].z);});
  for (let i = 1; i < points.length; i++) {
    const start = points[i - 1], end = points[i], direction = end.clone().sub(start), length = direction.length();
    if (length < .04) continue;
    const travelYaw = Math.atan2(direction.x, direction.z), headingDelta = Math.atan2(Math.sin(travelYaw - previousYaw), Math.cos(travelYaw - previousYaw));
    // Route arrows indicate travel direction, including backing out of a rack.
    // Do not invent a 180° turn of the chassis while its forks remain inserted.
    const yaw = Math.abs(headingDelta) > Math.PI / 2 ? travelYaw + Math.PI : travelYaw, startAt = start.clone().setY(floor), endAt = end.clone().setY(floor);
    if (canCheck) {
      const movement=endAt.clone().sub(startAt);let fraction=1,hit=false;
      for(const envelope of locals){const box=routeBoxAt(envelope,startAt,yaw),endBox=routeBoxAt(envelope,endAt,yaw),startsBlocked=world.testBox(box,options),sweep=world.sweepBox(box,movement,options),endsBlocked=world.testBox(endBox,options);hit=hit||startsBlocked||sweep.blocked||endsBlocked;if(startsBlocked)fraction=0;else if(sweep.blocked)fraction=Math.min(fraction,Number.isFinite(sweep.fraction)?sweep.fraction:0);else if(endsBlocked)fraction=0;}
      if(hit){
        blocked=true;blockedAt=start.clone();
        // The last metres into a pallet are deliberately height-sensitive.
        // Keep the verified clear prefix visible, instead of erasing every
        // arrow just because low tines would touch wood farther ahead.
        if(selectedTarget&&selectedTarget.dock&&(index>=authored.length||mission.local)&&i===points.length-1&&Math.abs(headingDelta)<.05&&fraction*length>.18){
          const safe=Math.max(0,fraction-.05/length),endSafe=start.clone().addScaledVector(direction,safe);blockedAt=endSafe.clone();clearPoints.push(endSafe);
          const travel=direction.clone().normalize(),safeLength=length*safe;for(let distance=Math.min(.45,safeLength/2);distance<safeLength&&arrows.length<GUIDANCE_ROUTE_ARROWS;distance+=1.05)arrows.push({position:start.clone().addScaledVector(travel,distance),yaw:travelYaw});dockingLimit=true;
        }
        break;
      }
      if (previousYaw !== undefined && Math.abs(yaw-previousYaw)>.002) {
        const angle = Math.atan2(Math.sin(yaw - previousYaw), Math.cos(yaw - previousYaw)), pieces = Math.max(1, Math.ceil(Math.abs(angle) / (Math.PI / 18)));
        const radius = Math.hypot(Math.max(Math.abs(local.min.x), Math.abs(local.max.x)), Math.max(Math.abs(local.min.z), Math.abs(local.max.z))), skin = radius * Math.abs(angle) / (2 * pieces);
        for (let sample = 0; sample <= pieces; sample++) {
          // Keep the mast, forks and cargo separate: a single tall enclosing
          // cuboid falsely blocked every truck bed even with empty low tines.
          if(locals.some(envelope=>{const turnBox=routeBoxAt(envelope,startAt,previousYaw+angle*sample/pieces);turnBox.min.x-=skin;turnBox.max.x+=skin;turnBox.min.z-=skin;turnBox.max.z+=skin;return world.testBox(turnBox,options);})){blocked = true; break;}
        }
        if (blocked) {blockedAt = start.clone(); break;}
      }
    } else {verified = false; break;}
    direction.normalize();
    for (let distance = Math.min(.55, length / 2); distance < length && arrows.length < GUIDANCE_ROUTE_ARROWS; distance += 1.05) arrows.push({position: start.clone().addScaledVector(direction, distance), yaw: travelYaw});
    clearPoints.push(end.clone());
    previousYaw = yaw;
  }
  return {arrows, points: canCheck ? clearPoints : [], blockedAt, blocked, clear: verified && !blocked, distanceM, index, total: authored.length, advisory, local:!!mission.local,dockingLimit, note: dockingLimit ? 'Aproximación al pallet: sigue el tramo libre y detente en la marca. Ajusta altura y alineación con la cámara antes de introducir las horquillas.' : blocked ? 'Ruta bloqueada: frena y revisa el pasillo. No continúes por las flechas.' : !verified ? 'Sin comprobación física disponible: revisa el pasillo antes de avanzar.' : mission.local ? aisles.length ? 'Ruta orientativa por pasillos de vehículos · revisada con la carga actual; completa el atraque con la cámara.' : 'Guía de aproximación en espacio libre · comprueba el entorno; el recorrido no limita una maniobra segura.' : advisory ? 'Ruta orientativa manual · pasillo comprobado con la carga actual; conduce y completa la alineación con la cámara.' : 'Ruta guiada manual · pasillo comprobado con la carga actual; observa el entorno.'};
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
    // Use the actual oriented truck/fork/load envelope. The old enclosing
    // square hid valid dock approaches beside a rail even though the native
    // truck fitted the opening, leaving the user without any useful arrows.
    const floor=record.components.vehicle.originWorld.y,local=routeEnvelope(api,record),box=routeBoxAt(local,start.clone().setY(floor),dock.yaw),options=api.collisionOptions(record,target.product);
    if (world.testBox && world.testBox(box,options) || world.sweepBox(box,end.clone().sub(start),options).blocked) return null;
  }
  return {start, end, yaw: dock.yaw, y: record.components.vehicle.originWorld.y + .025};
}
