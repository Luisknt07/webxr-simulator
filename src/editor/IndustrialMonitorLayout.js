import * as THREE from 'three';
import schema from '../../shared/behaviors.js';
import {deriveIndustrialFloorPresentation} from './IndustrialFloorPresentation.js';

const VERSION = 1, TAG = 'Suspensión HMI v1 · ', SIZE = [3, 1.6875, .09];
const round = value => Math.round(value * 1000000) / 1000000;
const near = (a, b) => Math.abs(a - b) < 1e-5;
const polygon = (x, z, width, depth, yaw) => {
  const cosine = Math.cos(yaw), sine = Math.sin(yaw);
  return [[-1, -1], [-1, 1], [1, 1], [1, -1]].map(([a, b]) => [x + a * width / 2 * cosine + b * depth / 2 * sine, z - a * width / 2 * sine + b * depth / 2 * cosine]);
};
const rect = box => [[box[0], box[1]], [box[0], box[3]], [box[2], box[3]], [box[2], box[1]]];
function overlap(first, second) {
  for (const shape of [first, second]) for (let index = 0; index < shape.length; index++) {
    const a = shape[index], b = shape[(index + 1) % shape.length], axis = [a[1] - b[1], b[0] - a[0]];
    const project = points => points.map(point => point[0] * axis[0] + point[1] * axis[1]);
    const left = project(first), right = project(second);
    if (Math.max(...left) <= Math.min(...right) + 1e-7 || Math.max(...right) <= Math.min(...left) + 1e-7) return false;
  }
  return true;
}
function bounds(object, inverseRoom) {
  const result = new THREE.Box3(); object.updateWorldMatrix(true, true);
  const visit = node => {
    if (!node.visible || node.userData.editorHelper || node.userData.editorRuntimeHelper || node.userData.editorDecal || node.userData.industrialSensorVolume || node.userData.editorGeometryReplaced) return;
    if (node.geometry) {
      const positions = node.geometry.attributes && node.geometry.attributes.position;
      if (!positions || positions.count) { if (!node.geometry.boundingBox) node.geometry.computeBoundingBox(); if (node.geometry.boundingBox && !node.geometry.boundingBox.isEmpty()) result.union(node.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverseRoom, node.matrixWorld))); }
    }
    node.children.forEach(visit);
  }; visit(object); return result;
}
function monitorConfig(document, object) { return document.getBehaviors(object).find(value => value.type === 'lineMonitor'); }
function generatedMonitor(object) { return /^(?:\d{2} · )?(?:Monitor 2D · |Monitor · |Supervisión CEDI · )/.test(object.name); }
function oldPedestal(document, object, monitor) {
  const descriptor = object.userData.editorDescriptor || {};
  if (descriptor.type !== 'box' || !['#3d505b', '#405360'].includes(descriptor.color) || object.userData.editorColor || document.getBehaviors(object).length) return false;
  if (!/^(?:\d{2} · )?(?:Soporte de monitor · .+|Base de monitor · .+|Pedestal del monitor(?: CEDI)?|Base del monitor CEDI)$/.test(object.name)) return false;
  const size = object.scale.toArray(), stand = [.12, 1.1, .12].every((value, index) => near(size[index], value)) && near(object.position.y, .55), base = [.85, .07, .65].every((value, index) => near(size[index], value)) && near(object.position.y, .035);
  return (stand || base) && Math.hypot(object.position.x - monitor.position.x, object.position.z - monitor.position.z) < .05;
}
function supportNames(id) { return ['tirante izquierdo', 'tirante derecho', 'perfil de techo'].map(part => TAG + id + ' · ' + part); }

/** Plan only in room coordinates. Every mesh corner uses inverse(roomWorld)
 * times meshWorld; a rotated/scaled room cannot rotate the placement twice. */
export function deriveIndustrialMonitorLayout(document, roomId, options = {}) {
  const derived = deriveIndustrialFloorPresentation(document, roomId), root = document.getRoot(roomId), objects = document.getObjects(roomId);
  const monitors = objects.filter(object => monitorConfig(document, object) && (options.includeCustom || generatedMonitor(object)));
  if (!derived.plan || !monitors.length) return {version: VERSION, layouts: [], warnings: [], removedLegacyIds: [], report: {monitors: 0}};
  const inverse = derived.inverseRoom, floorY = derived.plan.floorY, floor = derived.plan.bounds, machines = derived.machines, machineIds = new Set(machines.map(row => row.id));
  const roof = objects.find(object => /CEDI · Cubierta interior cerrada/.test(object.name)), roofBox = roof && bounds(roof, inverse);
  const ceilingY = Number.isFinite(options.ceilingY) ? options.ceilingY : roofBox && !roofBox.isEmpty() ? roofBox.min.y - .025 : floorY + 7.9;
  const monitorIds = new Set(monitors.map(object => object.userData.editorId)), removedLegacyIds = objects.filter(object => monitors.some(monitor => oldPedestal(document, object, monitor))).map(object => object.userData.editorId), removed = new Set(removedLegacyIds);
  const paint = objects.find(object => object.userData.editorDescriptor && object.userData.editorDescriptor.type === 'industrialFloor'), paintPlan = paint && paint.userData.editorDescriptor;
  const walkways = (paintPlan && paintPlan.walkways || []).map(rect), bays = (paintPlan && paintPlan.bays || []).map(rect);
  const obstacles = machines.map(row => rect([row.box[0] - .3, row.box[1] - .3, row.box[2] + .3, row.box[3] + .3]));
  objects.filter(object => !monitorIds.has(object.userData.editorId) && !machineIds.has(object.userData.editorId) && !removed.has(object.userData.editorId) && !object.name.startsWith(TAG) && object !== derived.floor && object !== paint).forEach(object => {
    const box = bounds(object, inverse); if (!box.isEmpty() && box.min.y < floorY + 3.1 && box.max.y > floorY + .08 && box.max.x - box.min.x < 8 && box.max.z - box.min.z < 8) obstacles.push(rect([box.min.x - .25, box.min.z - .25, box.max.x + .25, box.max.z + .25]));
  });
  const layouts = [], warnings = [], occupied = [];
  const inside = shape => shape.every(point => point[0] >= floor[0] + .8 && point[0] <= floor[2] - .8 && point[1] >= floor[1] + .8 && point[1] <= floor[3] - .8);
  monitors.forEach(monitor => {
    const id = monitor.userData.editorId, config = monitorConfig(document, monitor), targetId = config.targetId === 'self' || !config.targetId ? id : config.targetId, target = document.getObject(targetId);
    if (!target || !machineIds.has(targetId)) { warnings.push({monitorId: id, reason: 'El monitor no tiene un equipo industrial válido como destino.'}); return; }
    const names = supportNames(id), supports = names.map(name => objects.find(object => object.name === name));
    if (!options.force && supports.every(Boolean)) {
      const yaw = new THREE.Euler().setFromQuaternion(monitor.quaternion, 'YXZ').y, body = polygon(monitor.position.x, monitor.position.z, monitor.scale.x + .5, .6, yaw); occupied.push(body);
      layouts.push({monitorId: id, targetId, existing: true, position: monitor.position.toArray(), quaternion: monitor.quaternion.toArray(), scale: monitor.scale.toArray(), ceilingY, supportIds: supports.map(object => object.userData.editorId)}); return;
    }
    if (ceilingY <= floorY + 3.3) { warnings.push({monitorId: id, reason: 'El techo no deja espacio seguro para suspender esta pantalla.'}); return; }
    target.updateWorldMatrix(true, true); let panel; target.traverse(node => { if (!panel && node.userData.industrialDisplay) panel = node; });
    const anchor = (panel || target).getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse), basis = new THREE.Matrix4().multiplyMatrices(inverse, (panel || target).matrixWorld), forward = new THREE.Vector3(0, 0, 1).transformDirection(basis), baseYaw = Math.atan2(forward.x, forward.z);
    const candidates = [], consider = (x, z, yaw) => {
      const body = polygon(x, z, SIZE[0] + .5, .65, yaw), normal = [Math.sin(yaw), Math.cos(yaw)];
      const operators = [-1, 1].map(side => polygon(x + normal[0] * side, z + normal[1] * side, .85, .85, 0));
      if (!inside(body) || operators.some(shape => !inside(shape)) || obstacles.concat(occupied, walkways, bays).some(other => overlap(body, other)) || operators.some(shape => obstacles.concat(occupied).some(other => overlap(shape, other)))) return;
      const distance = Math.hypot(x - anchor.x, z - anchor.z), dx = x - anchor.x, dz = z - anchor.z, lateral = Math.abs(dx * Math.cos(baseYaw) - dz * Math.sin(baseYaw)), front = Math.abs(dx * Math.sin(baseYaw) + dz * Math.cos(baseYaw));
      candidates.push({x, z, yaw, body, operators, distance, score: distance + front * .4 + 1.8 / (lateral + .5) + (Math.abs(Math.sin(yaw - baseYaw)) > .5 ? .4 : 0)});
    };
    for (const yaw of [baseYaw, baseYaw + Math.PI / 2]) for (let radius = 2; radius <= 10; radius += .75) for (let step = 0; step < 24; step++) { const angle = step * Math.PI / 12; consider(anchor.x + Math.cos(angle) * radius, anchor.z + Math.sin(angle) * radius, yaw); }
    if (!candidates.length) for (let x = floor[0] + 2.5; x < floor[2] - 2; x += 1.5) for (let z = floor[1] + 2.5; z < floor[3] - 2; z += 1.5) for (const yaw of [baseYaw, baseYaw + Math.PI / 2]) consider(x, z, yaw);
    candidates.sort((a, b) => a.score - b.score); const chosen = candidates[0];
    if (!chosen) { warnings.push({monitorId: id, reason: 'No hay un espacio lateral libre de equipos, pasillos y otras pantallas; el monitor conserva su ubicación.'}); return; }
    occupied.push(chosen.body);
    layouts.push({monitorId: id, targetId, existing: false, position: [chosen.x, floorY + 2.15, chosen.z].map(round), quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), chosen.yaw).toArray().map(round), scale: SIZE.slice(), ceilingY: round(ceilingY), distanceFromPanel: round(chosen.distance), body: chosen.body.map(point => point.map(round)), operatorAreas: chosen.operators.map(shape => shape.map(point => point.map(round))), supportIds: []});
  });
  return {version: VERSION, layouts, warnings, removedLegacyIds, obstacles, walkways, bays, report: {monitors: monitors.length, placed: layouts.filter(row => !row.existing).length, existing: layouts.filter(row => row.existing).length, warnings: warnings.length, ceilingY: round(ceilingY)}};
}

/** Only generated monitor poses, their three ceiling supports and membership
 * of groups containing that monitor change. Machine records remain literal. */
export function applyIndustrialMonitorLayout(document, roomId, options = {}) {
  const plan = deriveIndustrialMonitorLayout(document, roomId, options), changed = plan.layouts.filter(row => !row.existing), affectedObjectIds = [], addedObjectIds = [], removedLegacyIds = [], affectedGroupIds = [], supports = [];
  if (options.enabled === false || !changed.length) return Object.assign({}, plan, {changed: false, affectedObjectIds, addedObjectIds, removedLegacyIds, affectedGroupIds, supports});
  const own = !document.transaction; if (own) document.begin();
  try {
    const remove = new Set(), memberships = new Map();
    changed.forEach(layout => {
      const monitor = document.getObject(layout.monitorId), names = supportNames(layout.monitorId);
      document.getObjects(roomId).filter(object => oldPedestal(document, object, monitor) || names.includes(object.name) && object.userData.editorDescriptor && object.userData.editorDescriptor.type === 'box').forEach(object => remove.add(object.userData.editorId));
      document.setTransform(monitor, {position: layout.position, quaternion: layout.quaternion, scale: layout.scale}); affectedObjectIds.push(layout.monitorId);
      const yaw = new THREE.Euler().setFromQuaternion(monitor.quaternion, 'YXZ').y, top = layout.position[1] + SIZE[1] / 2, length = layout.ceilingY - top, cosine = Math.cos(yaw), sine = Math.sin(yaw), partIds = [];
      const make = (name, position, scale) => {
        const part = document.addPrimitive(roomId, 'box', '#3a454a'); document.setProperty(part, 'name', name); document.setTransform(part, {position: position.map(round), scale: scale.map(round), quaternion: layout.quaternion});
        document.setBehaviors(part, [Object.assign(schema.defaultBehavior('collision'), {enabled: false}), Object.assign(schema.defaultBehavior('surfaceMaterial'), {preset: 'paintedMetal', color: '#3a454a', colorMapMode: 'none', roughness: .86, metalness: .18, clearcoat: 0})]); supports.push(part); partIds.push(part.userData.editorId); addedObjectIds.push(part.userData.editorId); return part;
      };
      [-1, 1].forEach((side, index) => make(names[index], [layout.position[0] + side * SIZE[0] * .31 * cosine, top + length / 2, layout.position[2] - side * SIZE[0] * .31 * sine], [.035, length, .035]));
      make(names[2], [layout.position[0], layout.ceilingY, layout.position[2]], [SIZE[0] * .7, .04, .16]); layout.supportIds = partIds; memberships.set(layout.monitorId, partIds);
    });
    remove.forEach(id => { const object = document.getObject(id); if (object) { document.remove(object); removedLegacyIds.push(id); } });
    const groups = (document.studio.groups || []).map(group => {
      const relevant = [...memberships.keys()].filter(id => group.members.includes(id)); if (!relevant.length && !group.members.some(id => remove.has(id))) return group;
      affectedGroupIds.push(group.id); return Object.assign({}, group, {members: [...new Set(group.members.filter(id => !remove.has(id)).concat(...relevant.map(id => memberships.get(id))))]});
    });
    if (affectedGroupIds.length) document.setStudio({groups});
    (options.lines || []).forEach(line => { if (!line.objects) return; const ids = line.objects.filter(object => memberships.has(object.userData.editorId)).flatMap(object => memberships.get(object.userData.editorId)); line.objects = line.objects.filter(object => !remove.has(object.userData.editorId)).concat(ids.map(id => document.getObject(id))); });
    if (own) document.commit();
    return Object.assign({}, plan, {changed: true, affectedObjectIds, addedObjectIds, removedLegacyIds, affectedGroupIds, supports});
  } catch (error) { if (own) document.cancel(); throw error; }
}
