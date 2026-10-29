import * as THREE from 'three';
import schema from '../contracts/behaviors.js';
import {buildIndustrialLabLines} from './IndustrialLabLines.js';
import {applyIndustrialFinishes} from '../functions/presentacion/runtime/IndustrialFinishes.js';
import {buildCediEnvironment} from './IndustrialCediEnvironment.js';
import {applyIndustrialFloorPresentation} from '../functions/presentacion/runtime/IndustrialFloorPresentation.js';
import {applyIndustrialMonitorLayout} from '../functions/presentacion/runtime/IndustrialMonitorLayout.js';
import {applyIndustrialMessages} from '../functions/presentacion/runtime/IndustrialMessages.js';
import {applyIndustrialAging} from '../functions/presentacion/runtime/IndustrialAgingPresentation.js';
import {retrofitCediRobotics} from './IndustrialCediRobotics.js';

/** A persisted, editable teaching floor. Signs/markings use ordinary document
 * records, so saving/reopening does not depend on a temporary preview scene. */
export function buildIndustrialLab(document, roomId, options = {}) {
  const objects = [], signs = [], markings = [], monitors = [];
  const authoringRoot = document.getRoot(roomId), roomVisible = authoringRoot.visible;
  const own = !document.transaction;
  if (own) document.begin();
  function primitive(name, type, color, position, scale, rotation = [0, 0, 0], behaviors = []) {
    const object = document.addPrimitive(roomId, type, color);
    document.setProperty(object, 'name', name);
    document.setTransform(object, {position, scale, rotation});
    document.setBehaviors(object, behaviors); objects.push(object); return object;
  }
  function stripe(name, x, z, width, depth, color = '#f5ca36', layer = 1) {
    const object = primitive(name, 'plane', color, [x, .004 + layer * .006, z], [width / 2, depth / 2, 1], [-Math.PI / 2, 0, 0],
      [Object.assign(schema.defaultBehavior('surfaceMaterial'), {color, metalness: 0, roughness: 1, clearcoat: 0, colorMapMode: 'none'})]);
    markings.push(object); return object;
  }
  function sign(title, text, x, z, width = 2.2, y = 2.65, stand = true) {
    const info = Object.assign(schema.defaultBehavior('info'), {title, text, fontSize: .045, color: '#f2f8ff'});
    // Equal X/Y scale preserves the information canvas' letter proportions.
    const object = primitive('Rótulo · ' + title, 'box', '#172d42', [x, y, z], [width, width, .07], [0, 0, 0], [info]);
    if (stand) primitive('Soporte de rótulo · ' + title, 'box', '#343e47', [x, (y - width / 2) / 2, z], [.06, y - width / 2, .06]);
    signs.push(object); return object;
  }
  function arrow(x, z, yaw = 0, color = '#d4effa') {
    const forward = {x: Math.sin(yaw), z: -Math.cos(yaw)}, side = {x: Math.cos(yaw), z: Math.sin(yaw)};
    const tip = {x: x + forward.x * .45, z: z + forward.z * .45};
    const points = [-1, 1].map(direction => ({x: x - forward.x * .2 + side.x * direction * .35, z: z - forward.z * .2 + side.z * direction * .35}));
    points.push({x: x - forward.x * .55, z: z - forward.z * .55});
    for (const point of points) {
      const dx = tip.x - point.x, dz = tip.z - point.z, length = Math.hypot(dx, dz);
      // Leave a tiny joint between strokes; the three paint planes never
      // occupy the same pixels at their shared arrow tip.
      const end = {x: tip.x - dx / length * .13, z: tip.z - dz / length * .13};
      const object = stripe('Flecha de circulación', (end.x + point.x) / 2, (end.z + point.z) / 2, .06, length - .13, color, 2);
      document.setTransform(object, {rotation: [-Math.PI / 2, 0, Math.atan2(-dx, -dz)]});
    }
  }
  try {
    authoringRoot.visible = true;
    document.getObjects(roomId).filter(object => object.name === 'Suelo del nivel' && !document.isNative(object)).forEach(object => document.remove(object));
    const floor = primitive('Piso industrial · hormigón mate', 'box', '#777c76', [0, -.06, -15], [72, .12, 120], [0, 0, 0],
      [schema.defaultBehavior('collision'), schema.defaultBehavior('teleport'), Object.assign(schema.defaultBehavior('surfaceMaterial'), {preset: 'concrete', color: '#777c76', metalness: 0, roughness: .97, colorMapMode: 'preserve', repeatX: 18, repeatY: 30})]);
    const building = buildCediEnvironment(document, roomId, {width: 72, depth: 120, centerZ: -15, floor: false}, {floorObject: floor});
    objects.push(...building.objects);
    // Wide central pedestrian route, with cross aisles in front of each cell.
    const crossings = [31, 11, -9, -29, -49, -69].sort((a, b) => a - b);
    let previous = -72;
    crossings.concat(43.25).forEach(z => {
      const end = Math.min(42, z - 1.25), depth = end - previous;
      if (depth > 0) {
        stripe('Ruta peatonal central', 0, (end + previous) / 2, 4.8, depth, '#385c60', 0);
        for (const x of [-2.55, 2.55]) stripe('Límite peatonal', x, (end + previous) / 2, .12, depth);
      }
      previous = z + 1.25;
    });
    for (const z of crossings) {
      stripe('Cruce peatonal', 0, z, 66, 2.5, '#555f65', 0);
      for (let x = -2; x <= 2; x += .8) stripe('Paso de peatones', x, z, .45, 2.2, '#edf1ef', 1);
      arrow(0, z - 4);
    }
    const lines = buildIndustrialLabLines(document, roomId, options);
    const robotics = options.robotized === true ? retrofitCediRobotics(document, roomId, {scene: options.scene, lines: lines.cells, continuous: options.continuous === true}) : null;
    if (robotics) lines.objects.push(...robotics.objects);
    const finishes = applyIndustrialFinishes(document, roomId, lines.objects, {wear: .12, preserveCustom: true, decals: true});
    lines.cells.forEach((cell, index) => {
      const center = cell.center || [index % 2 ? 18 : -18, 20 - Math.floor(index / 2) * 20];
      const [x, z] = center;
      if (cell.id === 'elevator') {
        const position = cell.receiver.position;
        primitive('Plataforma de descarga superior · teletransporte', 'box', '#63737e', [position.x, 1.9, position.z], [5.4, .2, 4.5], [0, 0, 0],
          [schema.defaultBehavior('collision'), schema.defaultBehavior('teleport')]);
        for (const dx of [-2.45, 2.45]) for (const dz of [-2, 2]) primitive('Soporte de entrepiso', 'box', '#364957', [position.x + dx, .95, position.z + dz], [.16, 1.9, .16]);
        for (const dx of [-2.6, 2.6]) {
          // Leave a real opening at transport height for the incoming deck and
          // any future receiver connected to the opposite output port.
          for (const dz of [-1.55, 1.55]) primitive('Baranda lateral superior · paso de banda', 'box', '#edbc35', [position.x + dx, 3.05, position.z + dz], [.07, .07, 1.3]);
          for (const dz of [-2, 2]) primitive('Poste de protección superior', 'box', '#edbc35', [position.x + dx, 2.55, position.z + dz], [.07, 1.1, .07]);
        }
        primitive('Baranda posterior superior', 'box', '#edbc35', [position.x, 3.05, position.z - 2.2], [5.2, .07, .07]);
        for (let step = 0; step < 8; step++) {
          const height = (step + 1) * .25;
          primitive('Escalón de acceso · teletransporte', 'box', '#667882', [position.x + 1.5, height / 2, position.z + 4.5 - step * .3], [1.2, height, .32], [0, 0, 0],
            [schema.defaultBehavior('collision'), schema.defaultBehavior('teleport')]);
        }
        cell.description += ' Accede a la descarga por los escalones o mediante el teletransporte al entrepiso.';
      }
      for (const edge of [-1, 1]) {
        stripe('Delimitación · ' + cell.title, x + edge * 14.3, z, .1, 15.9);
        stripe('Delimitación · ' + cell.title, x, z + edge * 8, 28.6, .1);
      }
      sign(cell.title,
        options.continuous ? 'OPERACIÓN CONTINUA\n' + cell.description + '\nEstibas de madera/plástico. Cinco niveles como máximo; distribución según dimensiones.' : 'LÍNEA AUTOMÁTICA\n' + cell.description.split('. ')[0] + '.\n16 unidades → 4 estibas.\nPLC y monitor: mandos de toda la línea.',
        x + (x < 0 ? -15.4 : 15.4), z + 6.4, 2.2);
      // One separate supervisory station beside the physical PLC. Its controls
      // bind to the full persisted flow graph rather than another line's data.
      cell.controller.updateWorldMatrix(true, true);
      let panel;
      cell.controller.traverse(node => { if (!panel && node.userData.industrialDisplay) panel = node; });
      const reference = panel || cell.controller;
      const orientation = reference.getWorldQuaternion(new THREE.Quaternion());
      const location = reference.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(2.35, 0, .05).applyQuaternion(orientation));
      location.y = 2;
      const monitor = primitive('Monitor 2D · ' + cell.title, 'box', '#202f39', location.toArray(), [3.2, 1.8, .12], [0, 0, 0],
        [Object.assign(schema.defaultBehavior('lineMonitor'), {targetId: cell.controller.userData.editorId, title: cell.title, scope: 'line'})]);
      document.setTransform(monitor, {quaternion: orientation.toArray()});
      const stand = primitive('Soporte de monitor · ' + cell.title, 'box', '#3d505b', [location.x, .55, location.z], [.12, 1.1, .12]);
      const base = primitive('Base de monitor · ' + cell.title, 'box', '#3d505b', [location.x, .035, location.z], [.85, .07, .65]);
      cell.monitor = monitor; monitors.push(monitor); cell.objects.push(monitor, stand, base);
      // Reusable logical group lets the whole example be copied as a template.
      cell.objects.forEach(object => { if (!object.name.startsWith(String(index + 1).padStart(2, '0') + ' · ')) document.setProperty(object, 'name', String(index + 1).padStart(2, '0') + ' · ' + object.name); });
      arrow(x - 8, z + 3.7, Math.PI / 2, '#78cbf0');
      arrow(x + 3, z + 3.7, Math.PI / 2, '#78cbf0');
    });
    if (robotics && robotics.logistics) {
      const l = robotics.logistics, box = new THREE.Box3(); l.objects.forEach(object => box.expandByObject(object)); const center = box.getCenter(new THREE.Vector3());
      const cell = {id: 'robotics-expedition', title: 'Expedición · cadenas y montacargas', description: 'Pallets completos reales del Source esperan al operario en el extremo de las cadenas; el montacargas los lleva al destino sin cambiar sus unidades.', mode: 'manual', center: [center.x, center.z], objects: l.objects, source: l.source, sources: [l.source], receiver: l.destination, receivers: [l.destination], controller: l.pickup, links: [{source: l.source.userData.editorId, sourcePort: 'output', target: l.pickup.userData.editorId, targetPort: 'input'}], expectedUnits: l.expectedLoads * l.unitsPerLoad};
      const monitor = primitive('Monitor 2D · expedición con montacargas', 'box', '#202f39', [l.pickup.position.x + 2.2, 2, l.pickup.position.z + 2.1], [3.2, 1.8, .12], [0, 0, 0], [Object.assign(schema.defaultBehavior('lineMonitor'), {targetId: l.pickup.userData.editorId, title: cell.title, scope: 'line'})]);
      cell.memberIds = l.objects.map(object => object.userData.editorId);
      cell.monitor = monitor; cell.objects.push(monitor); monitors.push(monitor); lines.cells.push(cell);
    }
    sign('CEDI · LABORATORIO', lines.cells.length + ' áreas de producción.\n01: L rectangular y transferencia a 90°.\nSource → proceso → cuatro estibas.\nUn PLC y monitor por línea.\nVR: gatillo / agarre lateral.', 0, 37, 2.4, 4, false);
    for (const side of [-1, 1]) primitive('Pórtico de entrada · soporte', 'box', '#343e47', [side * 3.2, 1.5, 37], [.08, 3, .08]);
    primitive('Pórtico de entrada · travesaño', 'box', '#343e47', [0, 3, 37], [6.4, .08, .08]);
    const studio = document.studio || {};
    document.setStudio({startRoomId: roomId,
      environments: (studio.environments || []).filter(item => item.roomId !== roomId).concat(building.environment),
      groups: (studio.groups || []).concat(lines.cells.map((cell, index) => ({id: 'lab-' + roomId + '-' + index, name: cell.title, roomId, members: cell.objects.map(object => object.userData.editorId)})))
    });
    (document.studio.spawns || []).filter(item => item.roomId === roomId).forEach(item => {
      const object = document.getObject(item.objectId); if (object) {
        document.setTransform(object, {position: [0, .02, 34], rotation: [0, 0, 0]});
        document.setBehaviors(object, [Object.assign(schema.defaultBehavior('collision'), {enabled: false})]);
      }
    });
    (document.studio.entities || []).filter(item => item.roomId === roomId && item.type === 'camera').forEach(item => {
      const object = document.getObject(item.objectId); if (!object) return;
      const camera = new THREE.PerspectiveCamera(); camera.position.set(-6, 6.2, 32); camera.lookAt(-18, .85, 20);
      document.setTransform(object, {position: camera.position.toArray(), quaternion: camera.quaternion.toArray()});
    });
    const aging = options.industrialAging === false ? null : applyIndustrialAging(document, roomId);
    const messages = applyIndustrialMessages(document, roomId, {enabled: options.industrialMessages !== false});
    const monitorLayout = options.monitorLayout === false ? null : applyIndustrialMonitorLayout(document, roomId, {lines: lines.cells});
    if (monitorLayout) objects.push(...monitorLayout.supports);
    const floorPresentation = options.floorPresentation === false ? null : applyIndustrialFloorPresentation(document, roomId, {floorObject: floor, machines: lines.objects, lines: lines.cells, replaceLegacy: true});
    const retained = object => document.getObject(object.userData.editorId) === object;
    const floorMarkings = markings.filter(retained).concat(floorPresentation && floorPresentation.presentation || []);
    if (own) document.commit();
    return Object.assign(lines, {floor, building, objects: Array.from(new Set(objects.concat(lines.objects, floorMarkings))).filter(retained), signs, markings: floorMarkings, monitors, finishes, floorPresentation, monitorLayout, messages, aging, robotics});
  } catch (error) { if (own) document.cancel(); throw error; }
  finally { authoringRoot.visible = roomVisible; }
}
