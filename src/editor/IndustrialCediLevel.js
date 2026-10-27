import * as THREE from 'three';
import schema from '../../shared/behaviors.js';
import {buildIndustrialCediScenario} from './IndustrialCediScenarios.js';
import {buildCediEnvironment} from './IndustrialCediEnvironment.js';
import {applyIndustrialFinishes} from './IndustrialFinishes.js';
import {applyIndustrialFloorPresentation} from './IndustrialFloorPresentation.js';
import {applyIndustrialMonitorLayout} from './IndustrialMonitorLayout.js';
import {applyIndustrialMessages} from './IndustrialMessages.js';
import {applyIndustrialAging} from './IndustrialAgingPresentation.js';
import {retrofitCediRobotics} from './IndustrialCediRobotics.js';

/** A complete persisted level: physical production graph, CEDI building,
 * authored interior camera/spawn, reusable group and world-space supervision. */
export function buildIndustrialCediLevel(document, roomId, options = {}) {
  const objects = [], own = !document.transaction;
  const authoringRoot = document.getRoot(roomId), roomVisible = authoringRoot.visible;
  if (own) document.begin();
  const primitive = (name, kind, color, position, scale, behaviors = [], rotation = [0, 0, 0]) => {
    const object = document.addPrimitive(roomId, kind, color);
    document.setProperty(object, 'name', name); document.setTransform(object, {position, scale, rotation}); document.setBehaviors(object, behaviors);
    objects.push(object); return object;
  };
  const paint = (name, color, position, width, depth) => primitive(name, 'plane', color, position, [width / 2, depth / 2, 1],
    [Object.assign(schema.defaultBehavior('surfaceMaterial'), {color, metalness: 0, roughness: 1, clearcoat: 0, colorMapMode: 'none'})], [-Math.PI / 2, 0, 0]);
  const structural = [schema.defaultBehavior('collision'), Object.assign(schema.defaultBehavior('surfaceMaterial'), {color: '#58676f', metalness: .45, roughness: .7, colorMapMode: 'none'})];
  try {
    // Magnetic-port authoring inspects visible ancestors. Temporarily expose
    // only this room while synchronously building an inactive level.
    authoringRoot.visible = true;
    document.getObjects(roomId).filter(object => object.name === 'Suelo del nivel' && !document.isNative(object)).forEach(object => document.remove(object));
    const network = buildIndustrialCediScenario(document, roomId, options);
    const robotics = options.robotized ? retrofitCediRobotics(document, roomId, {scene: options.scene, lines: network.lines, allowExpansion: true, continuous: options.continuous === true}) : null;
    if (robotics) {
      network.objects.push(...robotics.objects);
      network.links = network.lines.flatMap(line => line.links || []);
      if (robotics.logistics) {
        const l = robotics.logistics, box = new THREE.Box3(); l.objects.forEach(object => box.expandByObject(object));
        const line = {id: 'robotics-expedition', title: 'Expedición · cadenas y montacargas', description: 'Pallets completos del Source recorren las cadenas. El operario recoge la misma carga desde el extremo y la transporta a las bahías a nivel del piso.', mode: 'manual', objects: l.objects, controller: l.pickup, sources: [l.source], receivers: [l.destination], source: l.source, receiver: l.destination, platformReceivers: [], expectedUnits: l.expectedLoads * l.unitsPerLoad, expectedLoads: l.expectedLoads, expectedReceiverUnits: [0], memberIds: l.objects.map(object => object.userData.editorId), links: [{source: l.source.userData.editorId, sourcePort: 'output', target: l.pickup.userData.editorId, targetPort: 'input'}], bounds: {min: box.min.toArray(), max: box.max.toArray(), width: box.max.x - box.min.x, depth: box.max.z - box.min.z}};
        Object.assign(line, {center: box.getCenter(new THREE.Vector3()).toArray().filter((value, index) => index !== 1), manualTransport: true, expectedReceiverUnits: [l.expectedLoads * l.unitsPerLoad], expectedReceiverLoads: [l.expectedLoads], sourceExpectations: [{id: l.source.userData.editorId, loads: l.expectedLoads, units: l.expectedLoads * l.unitsPerLoad}], routingCoverage: []});
        network.lines.push(line); network.links.push(...line.links); network.sources.push(l.source); network.receivers.push(l.destination); network.controllers.push(l.pickup);
      }
      const bounds = new THREE.Box3(); network.objects.forEach(object => bounds.expandByObject(object));
      network.bounds = {min: bounds.min.toArray(), max: bounds.max.toArray(), width: 2 * Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x)), depth: 2 * Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z))};
    }
    const roomRoot = document.getRoot(roomId);
    roomRoot.updateWorldMatrix(true, true);
    const inverseRoom = new THREE.Matrix4().getInverse(roomRoot.matrixWorld), inverseRoomRotation = roomRoot.getWorldQuaternion(new THREE.Quaternion()).inverse();
    const localPoint = world => world.applyMatrix4(inverseRoom);
    const localOrientation = object => inverseRoomRotation.clone().multiply(object.getWorldQuaternion(new THREE.Quaternion()));
    const localBounds = object => {
      const bounds = new THREE.Box3(); object.updateWorldMatrix(true, true);
      object.traverse(mesh => { if (!mesh.geometry) return; if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox(); if (mesh.geometry.boundingBox) bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverseRoom, mesh.matrixWorld))); });
      return bounds;
    };
    const width = Math.max(44, Math.ceil((network.bounds.width + 16) / 4) * 4);
    const depth = Math.max(40, Math.ceil((network.bounds.depth + 18) / 4) * 4);
    const environment = buildCediEnvironment(document, roomId, {width, depth, centerZ: 0, floor: true});
    const finishes = applyIndustrialFinishes(document, roomId, network.objects, {wear: .16, preserveCustom: true, decals: true});
    const monitors = [], platforms = [], processSigns = [], terminalSigns = [];
    network.lines.forEach(line => {
      // A pallet buffer above ground needs an actual load-bearing deck and a
      // stair, rather than pallets suspended beside the elevator discharge.
      (line.platformReceivers || []).forEach(receiver => {
        const cfg = document.getBehaviors(receiver).find(value => value.type === 'palletQueue'), layout = schema.palletQueues.layout(cfg);
        receiver.updateWorldMatrix(true, true);
        const floorY = localPoint(receiver.localToWorld(new THREE.Vector3(0, -1, 0))).y;
        if (floorY <= .01) return;
        const box = new THREE.Box3();
        [-1, 1].forEach(x => [-1, 1].forEach(z => box.expandByPoint(localPoint(receiver.localToWorld(new THREE.Vector3(x * (layout.length / 2 + .45), -1, z * (layout.width / 2 + .45)))))));
        const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
        const deck = primitive('Plataforma de almacén superior', 'box', '#58676f', [center.x, floorY - .1, center.z], [size.x, .2, size.z], structural);
        const feet = [];
        for (const x of [-1, 1]) for (const z of [-1, 1]) feet.push(primitive('Columna de plataforma', 'box', '#45555f', [center.x + x * (size.x / 2 - .14), (floorY - .2) / 2, center.z + z * (size.z / 2 - .14)], [.18, floorY - .2, .18], structural));
        const steps = [], count = Math.ceil(floorY / .2), rise = floorY / count;
        for (let i = 1; i <= count; i++) steps.push(primitive('Escalón de acceso ' + i, 'box', '#58676f', [center.x, i * rise / 2, box.max.z + .16 + (count - i) * .32], [1.15, i * rise, .32], structural));
        paint('Borde de acceso a plataforma', '#d9b74c', [center.x, floorY + .004, box.max.z - .05], 1.2, .09);
        const platform = {receiverId: receiver.userData.editorId, floorY, deck, feet, steps}; platforms.push(platform); line.platform = platform; line.objects.push(deck, ...feet, ...steps);
      });
      line.controller.updateWorldMatrix(true, true);
      let display; line.controller.traverse(node => { if (!display && node.userData.industrialDisplay) display = node; });
      const anchor = display || line.controller, orientation = localOrientation(anchor);
      const location = localPoint(anchor.getWorldPosition(new THREE.Vector3())).add(new THREE.Vector3(2.35, 0, .05).applyQuaternion(orientation)); location.y = 2;
      const monitor = primitive('Supervisión CEDI · ' + line.title, 'box', '#202f39', location.toArray(), [3.2, 1.8, .12],
        [Object.assign(schema.defaultBehavior('lineMonitor'), {targetId: line.controller.userData.editorId, title: line.title, scope: 'line'})]);
      document.setTransform(monitor, {quaternion: orientation.toArray()});
      const stand = primitive('Pedestal del monitor CEDI', 'box', '#3d505b', [location.x, .55, location.z], [.12, 1.1, .12]);
      const base = primitive('Base del monitor CEDI', 'box', '#3d505b', [location.x, .035, location.z], [.85, .07, .65]);
      line.monitor = monitor; line.objects.push(monitor, stand, base); monitors.push(monitor);
      const working = new THREE.Box3(new THREE.Vector3().fromArray(line.bounds.min), new THREE.Vector3().fromArray(line.bounds.max));
      if (line.platform) [line.platform.deck, ...line.platform.feet, ...line.platform.steps].forEach(object => working.union(localBounds(object)));
      const bounds = {min: working.min.toArray(), max: working.max.toArray(), width: working.max.x - working.min.x, depth: working.max.z - working.min.z}; line.workArea = bounds;
      const centerX = (bounds.min[0] + bounds.max[0]) / 2, centerZ = (bounds.min[2] + bounds.max[2]) / 2;
      const lineWidth = bounds.width + 2.4, lineDepth = bounds.depth + 2.4;
      for (const side of [-1, 1]) {
        paint('Demarcación longitudinal · ' + line.title, '#d9b74c', [centerX + side * lineWidth / 2, .012, centerZ], .08, lineDepth - .08);
        paint('Demarcación transversal · ' + line.title, '#d9b74c', [centerX, .012, centerZ + side * lineDepth / 2], lineWidth, .08);
      }
      const guide = primitive('Guía de red · ' + line.title, 'box', '#182b38', [bounds.min[0] - 2.8, 2.4, bounds.max[2] + .4], [2.6, 1.8, .07],
        [Object.assign(schema.defaultBehavior('info'), {title: (line.mode === 'manual' ? 'MANUAL · ' : 'AUTOMÁTICA · ') + line.title,
          text: (network.continuous && line.mode !== 'manual' ? 'Red automática continua. Source repone productos de diferentes formatos. El almacén llena cuatro estibas y despacha cargas completas para liberar capacidad; hasta cinco niveles según dimensiones. ' : line.description + '\n') + (line.manualTransport ? 'El Source alimenta automáticamente; la recogida y entrega esperan al conductor. Cada pallet conserva 12 unidades.' : line.mode === 'manual' ? 'Empieza vacía. Generar / agarre / acción de operario en el panel y monitor.' : network.continuous ? 'Un PLC controla únicamente esta red.' : 'Total finito: ' + line.expectedUnits + ' unidades. Un PLC controla únicamente esta red.'), fontSize: .045, color: '#eff5fa'})]);
      const post = primitive('Soporte de guía de red', 'box', '#3d505b', [guide.position.x, .75, guide.position.z], [.07, 1.5, .07]);
      line.objects.push(guide, post); processSigns.push(guide);
      line.receivers.forEach((receiver, index) => {
        const cfg = document.getBehaviors(receiver).find(value => value.type === 'palletQueue'), layout = schema.palletQueues.layout(cfg);
        receiver.updateWorldMatrix(true, false);
        const location = localPoint(receiver.localToWorld(new THREE.Vector3(0, .8, layout.width / 2 + .4)));
        const label = primitive('Etiqueta de destino · ' + receiver.name, 'box', '#182b38', location.toArray(), [2.2, .75, .035],
          [Object.assign(schema.defaultBehavior('collision'), {enabled: false}), Object.assign(schema.defaultBehavior('info'), {title: receiver.name,
            text: (network.continuous && line.mode !== 'manual' ? 'Almacén continuo · distribución por tamaño real.\n' : 'Previsto: ' + line.expectedReceiverUnits[index] + ' unidades / ' + line.expectedReceiverLoads[index] + ' cargas.\n') + 'Tope: ' + cfg.capacity + ' cargas en ' + cfg.palletCapacity + ' estibas.\n' + (line.mode === 'manual' ? 'Carga y descarga manual de prácticas.' : 'Contadores de entrada, almacenado y despacho en el monitor de esta red.'), fontSize: .034, color: '#eff5fa'})]);
        document.setTransform(label, {quaternion: localOrientation(receiver).toArray()}); line.objects.push(label); terminalSigns.push(label);
      });
    });
    const front = depth / 2 - 4;
    paint('Ruta peatonal de recepción', '#34545b', [0, .01, front], width - 5, 2.4);
    for (const side of [-1, 1]) paint('Límite de ruta peatonal', '#d9b74c', [0, .016, front + side * 1.35], width - 5, .1);
    // Quiet, compact entrance information; process details remain on the HMI.
    const sign = primitive('CEDI · guía del proceso', 'box', '#182b38', [-width / 2 + 4, 2.65, front - 2.1], [2.3, 2.3, .07],
    [Object.assign(schema.defaultBehavior('info'), {title: network.title, text: network.description + '\nProbar inicia las redes automáticas. Los anexos manuales esperan una acción del usuario. Cada red tiene su PLC y monitor: Analítica y Equipo.', fontSize: .046, color: '#eff5fa'})]);
    primitive('Soporte de guía CEDI', 'box', '#3d505b', [sign.position.x, .75, sign.position.z], [.07, 1.5, .07]);
    const studio = document.studio || {};
    document.setStudio({groups: (studio.groups || []).concat(network.lines.map(line => ({id: 'cedi-' + roomId + '-' + line.id,
      name: line.title, roomId, members: line.objects.map(object => object.userData.editorId)})))});
    (document.studio.spawns || []).filter(item => item.roomId === roomId).forEach(item => {
      const marker = document.getObject(item.objectId); if (marker) document.setTransform(marker, {position: [0, .02, front], rotation: [0, 0, 0]});
    });
    const pose = new THREE.PerspectiveCamera(); pose.position.set(width * .34, 6.2, depth / 2 - 6); pose.lookAt(network.lines[0].center[0], 1, network.lines[0].center[1]);
    (document.studio.entities || []).filter(item => item.roomId === roomId && item.type === 'camera').forEach(item => {
      const marker = document.getObject(item.objectId); if (marker) document.setTransform(marker, {position: pose.position.toArray(), quaternion: pose.quaternion.toArray()});
    });
    const aging = options.industrialAging === false ? null : applyIndustrialAging(document, roomId);
    const messages = applyIndustrialMessages(document, roomId, {enabled: options.industrialMessages !== false});
    const monitorLayout = options.monitorLayout === false ? null : applyIndustrialMonitorLayout(document, roomId, {lines: network.lines});
    if (monitorLayout) objects.push(...monitorLayout.supports);
    const floorPresentation = options.floorPresentation === false ? null : applyIndustrialFloorPresentation(document, roomId, {floorObject: environment.floor, machines: network.objects, lines: network.lines, replaceLegacy: true});
    const retained = object => document.getObject(object.userData.editorId) === object;
    if (own) document.commit();
    return Object.assign(network, {roomId, environment, finishes, monitors, platforms, processSigns, terminalSigns, width, depth, floor: environment.floor, floorPresentation, monitorLayout, messages, aging, robotics,
      objects: Array.from(new Set(network.objects.concat(environment.objects, objects, floorPresentation && floorPresentation.presentation || []))).filter(retained)});
  } catch (error) { if (own) document.cancel(); throw error; }
  finally { authoringRoot.visible = roomVisible; }
}
