import * as THREE from 'three';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const matrixOK = value => value && value.isMatrix4 && value.elements.every(finite) && Math.abs(value.determinant()) > 1e-10;
const boxOK = value => value && value.isBox3 && !value.isEmpty() && [value.min.x,value.min.y,value.min.z,value.max.x,value.max.y,value.max.z].every(finite) && value.max.x-value.min.x > .001 && value.max.z-value.min.z > .001;
const polygonOK = value => Array.isArray(value) && value.length === 4 && value.every(point => Array.isArray(point) && point.length >= 3 && point.slice(0,3).every(finite));
const freezePoints = values => Object.freeze(values.map(value => Object.freeze(value.slice(0,3))));
const center = values => values.reduce((sum, point) => sum.add(new THREE.Vector3().fromArray(point)), new THREE.Vector3()).multiplyScalar(.25);
const wrap = angle => Math.atan2(Math.sin(angle),Math.cos(angle));
const text = value => typeof value === 'string' ? value.slice(0,180) : '';

/** Ordered product-base corners in world metres. Detached data, never a support test. */
export function dropPlacementFootprint(bounds, matrix) {
  if (!boxOK(bounds) || !matrixOK(matrix)) return [];
  return [[bounds.min.x,bounds.min.z],[bounds.max.x,bounds.min.z],[bounds.max.x,bounds.max.z],[bounds.min.x,bounds.max.z]].map(point => new THREE.Vector3(point[0],bounds.min.y,point[1]).applyMatrix4(matrix).toArray());
}

/** Exact authored rack/bay geometry even while a live release plan is too far
 * away or blocked by the currently carried load. This never admits/reserves it. */
export function dropTargetGeometry(runtime, target, product) {
  const record = target && target.record, stock = record && record.components && record.components.palletQueue;
  const queue = runtime && runtime.palletQueueRuntime, index = target && target.slotIndex;
  if (!stock || !queue || !product || !boxOK(product.bounds) || !product.scale || !Number.isInteger(index)) return null;
  if (stock.rack) {
    const cell = stock.rack.layout.cells.find(value => value.index === index);
    if (!cell || target.locationCode && cell.code !== target.locationCode) return null;
    const point = queue.rackPoint(stock,cell), matrix = queue.rackMatrix(record,product,point);
    const supportY = record.object.localToWorld(new THREE.Vector3().fromArray(point)).y;
    return matrixOK(matrix) ? {matrix,bounds:product.bounds.clone(),supportY,palletIndex:index,locationCode:cell.code} : null;
  }
  const pallet = stock.pallets && stock.pallets[index];
  if (!stock.config.acceptsPallets || !pallet || !pallet.object) return null;
  pallet.object.updateWorldMatrix(true,false);
  const rotation = pallet.object.getWorldQuaternion(new THREE.Quaternion()), origin = pallet.object.getWorldPosition(new THREE.Vector3());
  const localCenter = product.bounds.getCenter(new THREE.Vector3()).multiply(product.scale);
  const offset = new THREE.Vector3(-localCenter.x,.005-Math.min(product.bounds.min.y*product.scale.y,product.bounds.max.y*product.scale.y),-localCenter.z).applyQuaternion(rotation);
  const matrix = new THREE.Matrix4().compose(origin.clone().add(offset),rotation,product.scale);
  return matrixOK(matrix) ? {matrix,bounds:product.bounds.clone(),supportY:origin.y,palletIndex:index,locationCode:target.locationCode || ''} : null;
}

function geometryMatches(observed, expected) {
  if (!polygonOK(observed) || !polygonOK(expected)) return false;
  return observed.every(point => expected.some(wanted => new THREE.Vector3().fromArray(point).distanceTo(new THREE.Vector3().fromArray(wanted)) <= .08));
}
function snapshotMatch(snapshot,target,footprint) {
  const destination = snapshot && snapshot.destination;
  if (!snapshot || snapshot.phase !== 'drop' || !destination || destination.id !== target.targetId) return false;
  if (target.locationCode && destination.locationCode && target.locationCode !== destination.locationCode) return false;
  if (target.slotIndex !== undefined && destination.palletIndex !== undefined && target.slotIndex !== destination.palletIndex) return false;
  return geometryMatches(snapshot.geometry && snapshot.geometry.target,footprint);
}
function stage(model) {
  if (!model.valid || !model.canAlign) return 'blocked';
  if (!model.operational || Math.abs(model.speedMps) > .06) return 'stop';
  if (model.physicallyReady) return 'ready';
  const e = model.errors;
  if (Math.hypot(e.lateralM,e.longitudinalM) > 1.2) return 'approach';
  if (Math.abs(e.yawRad) > .12 || Math.abs(e.lateralM) > .06 || Math.abs(e.longitudinalM) > .06) return 'align';
  if (Math.abs(e.verticalM) > .06) return 'height';
  return 'verify';
}
/** Correction signs are opposite to the measured load displacement. */
export function dropPlacementInstruction(model) {
  if (!model || !model.valid) return 'Conserva la carga: no hay una posición de descarga válida para marcar.';
  if (!model.canAlign) return model.reason || 'La ubicación está ocupada o no admite esta carga. Conserva el pallet.';
  if (!model.operational) return 'Habilita el vehículo y conserva la carga antes de ajustar la descarga.';
  if (Math.abs(model.speedMps) > .06) return 'Frena y detén el montacargas antes de depositar.';
  if (model.physicallyReady) return 'Apoyo confirmado en la ubicación marcada. Deposita la carga y retira ambas horquillas lentamente.';
  const e = model.errors, cm = value => Math.round(Math.abs(value)*100), location = model.locationCode || model.targetName;
  const pending = model.planningBlocked ? ' El apoyo todavía no está despejado o confirmado; no deposites.' : '';
  if (model.stage === 'approach') return 'Lleva el pallet a '+location+' siguiendo la ruta; el contorno amarillo marca su base final, no autoriza soltarlo.';
  if (Math.abs(e.yawRad) > .12) return 'En la vista superior, alinea el pallet con el contorno: corrige '+Math.round(Math.abs(e.yawRad)*180/Math.PI)+'° '+(e.yawRad > 0 ? 'hacia la izquierda.' : 'hacia la derecha.')+pending;
  if (Math.abs(e.lateralM) > .06) return 'En la vista superior, desplaza la carga '+cm(e.lateralM)+' cm '+(e.lateralM > 0 ? 'a la izquierda' : 'a la derecha')+' para hacer coincidir ambos contornos.'+pending;
  if (Math.abs(e.longitudinalM) > .06) return 'En la vista superior, corrige la profundidad '+cm(e.longitudinalM)+' cm '+(e.longitudinalM > 0 ? 'hacia abajo' : 'hacia arriba')+' del plano; avanza o retrocede según la orientación del montacargas.'+pending;
  if (Math.abs(e.verticalM) > .06) return (e.verticalM > 0 ? 'Baja' : 'Eleva')+' la carga '+cm(e.verticalM)+' cm hasta la base del contorno; aún no deposites.'+pending;
  if (model.planningBlocked) return 'La base marcada sigue asignada, pero el apoyo todavía no está despejado o confirmado. Conserva la carga y revisa altura, horquillas y obstáculos; no deposites.';
  return model.snapshotMatches && model.snapshotReason ? model.snapshotReason : 'Base alineada visualmente. Baja con suavidad y espera la confirmación física del apoyo antes de depositar.';
}

/** Detached read-only unload model. A target outline is an alignment reference;
 * only a matching physical docking snapshot can confirm a safe release. */
export function buildDropPlacement(driving, record, target, snapshot) {
  const v = record && record.components && record.components.vehicle, product = v && v.entry && v.entry.product;
  if (!product || !target || target.kind !== 'drop') return null;
  const runtime = driving && driving.simulation, geometry = dropTargetGeometry(runtime,target,product);
  const sourceMatrix = geometry && geometry.matrix || target.matrix, bounds = target.bounds || product.bounds;
  product.object.updateWorldMatrix(true,false);
  const valid = matrixOK(sourceMatrix) && boxOK(bounds) && matrixOK(product.object.matrixWorld);
  const matrix = valid ? sourceMatrix.clone() : null, localBounds = boxOK(bounds) ? bounds.clone() : null, actualMatrix = product.object.matrixWorld.clone();
  const desired = valid ? dropPlacementFootprint(localBounds,matrix) : [], actual = valid ? dropPlacementFootprint(product.bounds,actualMatrix) : [];
  const targetFootprint = freezePoints(desired), actualFootprint = freezePoints(actual), targetCenter = valid ? center(desired) : null, actualCenter = valid ? center(actual) : null;
  const errors = {lateralM:null,longitudinalM:null,verticalM:null,yawRad:null};
  if (valid) {
    const right = new THREE.Vector3(1,0,0).transformDirection(matrix), depth = new THREE.Vector3(0,0,1).transformDirection(matrix), delta = actualCenter.clone().sub(targetCenter);
    const forward = new THREE.Vector3(0,0,1).transformDirection(actualMatrix);
    errors.lateralM = delta.dot(right); errors.longitudinalM = delta.dot(depth); errors.verticalM = actualCenter.y-targetCenter.y;
    errors.yawRad = wrap(Math.atan2(forward.x,forward.z)-Math.atan2(depth.x,depth.z));
  }
  const matches = valid && snapshotMatch(snapshot,target,desired), api = runtime && runtime.vehicleRuntime;
  const operational = !!(api && typeof api.operational === 'function' && api.operational(v)), speed = finite(v.actualSpeed) ? v.actualSpeed : 0;
  const admissible = !!(valid && target.allowed), availabilityReason = text(target.availabilityReason);
  const canAlign = !!(valid && !availabilityReason && (admissible || geometry)), planningBlocked = canAlign && !admissible;
  const ready = !!(admissible && matches && snapshot.ready && operational && Math.abs(speed) <= .06);
  const physicalSupport = matches && snapshot.support, samples = physicalSupport && physicalSupport.samples, measured = polygonOK(samples);
  const contacts = physicalSupport && Array.isArray(physicalSupport.contacts) && physicalSupport.contacts.length === 4 && physicalSupport.contacts.every(value => typeof value === 'boolean') ? physicalSupport.contacts : null;
  const supportY = geometry && finite(geometry.supportY) ? geometry.supportY : targetCenter && targetCenter.y;
  const supportCorners = desired.map((point,index) => {
    const sample = measured ? samples.reduce((best,value) => !best || Math.hypot(value[0]-point[0],value[2]-point[2]) < Math.hypot(best[0]-point[0],best[2]-point[2]) ? value : best,null) : null;
    return Object.freeze({point:Object.freeze(point.slice()),gapM:sample ? actual[index][1]-sample[1] : actual[index][1]-supportY,contact:contacts ? contacts[index] : null});
  });
  const productId = text(product.record && product.record.id || product.sourcePalletId || product.sourceEntry && product.sourceEntry.id || product.object.uuid), entryId = text(v.entry.id);
  const slotIndex = target.slotIndex !== undefined ? target.slotIndex : target.destination && target.destination.placement && target.destination.placement.palletIndex;
  const locationCode = text(target.locationCode || geometry && geometry.locationCode || target.destination && target.destination.placement && target.destination.placement.locationCode);
  const dock = target.dock ? {position:target.dock.position && target.dock.position.clone(),yaw:target.dock.yaw,toolY:target.dock.toolY} : null;
  const model = {phase:'drop',id:target.id,targetId:target.targetId,targetName:text(target.name),entryId,productId,selectionKey:[entryId || productId,target.id,slotIndex,locationCode].join('|'),locationCode,slotIndex,
    matrix,bounds:localBounds,worldBounds:valid ? localBounds.clone().applyMatrix4(matrix) : null,actualMatrix,targetFootprint,actualFootprint,
    target:Object.freeze({id:target.targetId,name:text(target.name),locationCode,slotIndex,footprint:targetFootprint,supportY,bottomY:targetCenter && targetCenter.y}),
    load:Object.freeze({footprint:actualFootprint,bottomY:actualCenter && actualCenter.y}),errors:Object.freeze(errors),dock,valid,admissible,canAlign,planningBlocked,availabilityReason,operational,speedMps:speed,
    physicallyReady:ready,ready,snapshotMatches:!!matches,exactSlotMatch:!!matches,snapshotReason:matches ? text(snapshot.reason) : '',
    reason:!valid ? 'La posición seleccionada no tiene una geometría válida.' : !canAlign ? availabilityReason || text(target.reason) : planningBlocked ? 'La posición marcada sigue asignada; el apoyo todavía no está despejado o confirmado.' : ready ? text(snapshot.reason) : matches ? text(snapshot.reason) : 'El apoyo físico todavía no coincide con la ubicación seleccionada.',
    support:Object.freeze({matched:!!matches,measured:!!measured,count:contacts ? contacts.filter(Boolean).length : null,total:4,corners:Object.freeze(supportCorners)}),
    stability:snapshot && snapshot.stability ? Object.freeze(Object.assign({},snapshot.stability)) : null};
  model.stage = stage(model); model.instruction = dropPlacementInstruction(model); return Object.freeze(model);
}
