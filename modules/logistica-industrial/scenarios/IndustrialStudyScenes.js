import * as THREE from 'three';
import schema from '../contracts/behaviors.js';
import ConveyorAssembly from '../functions/bandas/runtime/ConveyorAssembly.js';
import {buildIndustrialLabLines} from './IndustrialLabLines.js';
import {buildIndustrialCediLevel} from './IndustrialCediLevel.js';
import {buildCediEnvironment} from './IndustrialCediEnvironment.js';
import {applyIndustrialFloorPresentation} from '../functions/presentacion/runtime/IndustrialFloorPresentation.js';
import {applyIndustrialMonitorLayout} from '../functions/presentacion/runtime/IndustrialMonitorLayout.js';
import {applyIndustrialMessages} from '../functions/presentacion/runtime/IndustrialMessages.js';
import {applyIndustrialAging} from '../functions/presentacion/runtime/IndustrialAgingPresentation.js';
import {buildIndustrialVehicleStudy} from './IndustrialVehicleStudy.js';
import {studyScene, STUDY_ENVIRONMENT_DEFAULTS} from './StudySceneCatalog.js';

const MACHINE_TYPES = ['source', 'conveyor', 'processor', 'palletQueue', 'robot', 'vehicle'];
const machine = (document, object) => document.getBehaviors(object).find(value => MACHINE_TYPES.includes(value.type));
const patch = (document, object, changes) => document.setBehaviors(object, document.getBehaviors(object).map(value => MACHINE_TYPES.includes(value.type) ? Object.assign({}, value, changes) : value));

/** Real source -> robot -> conveyor -> stock recipes. The Source is generated
 * automatically but withdrawn by the robot, so it never teleports a load to a
 * second machine while the robot is approaching that same load. */
function robotNetwork(document, roomId, definition, scene, options = {}) {
  const assembly = new ConveyorAssembly({document, roomId, root: document.getRoot(roomId), ctx: {scene}, hooks: {renderScene: scene}, assemblyMessage() {}});
  const objects = [], links = [], continuous = options.continuous !== false, sorting = definition.robot === 'scara';
  const add = (type, name, variant, values, position) => {
    const object = document.addPrefab(roomId, type, variant); patch(document, object, values || {});
    document.setProperty(object, 'name', name); document.setTransform(object, {position: position || [0, 1, 0]}); objects.push(object); return object;
  };
  const connect = (from, to, sourcePort = 'output') => {
    if (!assembly.align(from, sourcePort, to, 'input') || !assembly.connect(assembly.pair(to, 'input', from, sourcePort))) throw new Error('No se pudo conectar la línea robótica.');
    links.push({source: from.userData.editorId, sourcePort, target: to.userData.editorId, targetPort: 'input'});
  };
  const catalogue = [
    {id: 'small-case', name: 'Caja pequeña', type: 'box', width: .24, height: .22, depth: .3, mass: 1, base: 'flat', color: '#b98d53', quality: 'good', defect: 'none'},
    {id: 'medium-case', name: 'Caja mediana', type: 'box', width: .32, height: .24, depth: .4, mass: 3, base: 'flat', color: '#bf6848', quality: 'good', defect: 'none'},
    {id: 'inspection-crate', name: sorting ? 'Contenedor pendiente de calidad' : 'Contenedor de expedición', type: 'crate', width: .36, height: .24, depth: .42, mass: 4, base: 'rigid', color: '#4b8395', quality: sorting ? 'defective' : 'good', defect: sorting ? 'surface' : 'none'}
  ];
  try {
    const source = add('source', 'Source · tres formatos / recogida robótica', undefined, {autoGenerate: true, running: true, delivery: 'manual', initialCount: 1, capacity: 16, totalLimit: continuous ? 0 : 6, interval: 4, generationMode: 'sequence', catalog: JSON.stringify(catalogue), withPanel: false}, [.45, 1, 1]);
    const robot = add('robot', sorting ? 'SCARA · alimentación del clasificador' : 'Articulado · recogida y entrega', sorting ? 'scara' : 'articulated-general', Object.assign({}, schema.robots.defaults(sorting ? 'scara' : 'articulated-general'), {
      sourceId: source.userData.editorId, running: true, mode: 'automatic', withPanel: true, reach: sorting ? 1.1 : 1.6,
      baseHeight: sorting ? 1.8 : .65, height: sorting ? .5 : 1.4, payloadKg: sorting ? 5 : 8, speed: 1.2, cycleTime: 2.4, processTime: 0, setupTime: .5,
      approachHeight: .12, requireKnownMass: true, wear: .2}), [0, 0, 0]);
    patch(document, source, {outputId: robot.userData.editorId});
    const conveyor = add('conveyor', sorting ? 'Clasificador · defecto a ramal' : 'Banda · expedición de producto', sorting ? 'distributor' : 'belt', {
      powered: true, running: true, autoSpawn: false, withPanel: false, withSensors: sorting, length: 2.4, speed: .55,
      routing: sorting ? 'rules' : 'primary', routingDefault: 'main', branchSide: 'left',
      routingRules: sorting ? JSON.stringify([{field: 'quality', operator: 'eq', value: 'defective', route: 'branch'}]) : '[]'}, [1.65, 1, -.8]);
    patch(document, robot, {outputId: conveyor.userData.editorId});
    links.push({source: source.userData.editorId, sourcePort: 'output', target: robot.userData.editorId, targetPort: 'input'}, {source: robot.userData.editorId, sourcePort: 'output', target: conveyor.userData.editorId, targetPort: 'input'});
    const stockValues = {running: true, delivery: 'manual', layoutMode: 'fit', palletType: 'euro-1200x800', palletCapacity: 2, capacity: 64, layers: 5, maxStackHeight: 1.8,
      withPanel: false, autoRelease: continuous, releasePolicy: 'stockFull', releaseInterval: 3, autoReleasePressure: true};
    const stock = add('palletQueue', sorting ? 'Conformes · consolidación' : 'Expedición · productos', undefined, stockValues);
    connect(conveyor, stock);
    const receivers = [stock];
    if (sorting) {
      const side = add('conveyor', 'Ramal · pendiente de calidad', 'roller-motor', {powered: true, running: true, autoSpawn: false, withPanel: false, withSensors: false, length: 2.4, speed: .55});
      const rejected = add('palletQueue', 'No conformes · área segregada', undefined, Object.assign({}, stockValues, {palletMaterial: 'plastic'}));
      connect(conveyor, side, 'branch'); connect(side, rejected); receivers.push(rejected);
    }
    const line = {id: definition.id, title: definition.title, mode: 'automatic', continuous, objects, links, sources: [source], receivers, source, receiver: stock, controller: robot,
      expectedUnits: continuous ? 0 : 6, expectedReceiverUnits: continuous ? null : sorting ? [4, 2] : [6], memberIds: objects.map(object => object.userData.editorId)};
    return {objects, cells: [line], lines: [line], sources: [source], receivers, controllers: [robot], links, expectedUnits: line.expectedUnits};
  } finally { assembly.clear(); }
}

/** New deterministic teaching graphs use the production runtime and real ports.
 * A retrabajo cycle records processing; it does not silently repair quality. */
function advancedNetwork(document, roomId, definition, scene) {
  const root = document.getRoot(roomId), assembly = new ConveyorAssembly({document, roomId, root, ctx: {scene}, hooks: {renderScene: scene}, assemblyMessage() {}});
  const objects = [], links = [], sources = [], receivers = [];
  const add = (type, name, variant, changes = {}) => {
    const object = document.addPrefab(roomId, type, variant), original = machine(document, object);
    const defaults = type === 'source' ? {autoGenerate: true, initialCount: 1, totalLimit: 16, delivery: 'automatic', running: true, capacity: 16, interval: 1.6, outputInterval: .6} :
      type === 'conveyor' ? {powered: true, running: true, autoSpawn: false, speed: .65, length: 2.4, rollerPitch: .06, withSensors: ['liftTransfer', 'turntable', 'distributor', 'pusher', 'loading'].includes(original.mechanism)} :
        type === 'processor' ? {powered: true, running: true, processTime: 1.2, setupTime: .4, setupPolicy: 'productChange', requiresOperator: false, delivery: 'automatic', outputInterval: .25, capacity: 16, outputCapacity: 4, length: 2.4} :
          {running: true, delivery: 'manual', capacity: 16, palletCapacity: 2, columns: 2, rows: 2, layers: 2, autoRelease: false};
    patch(document, object, Object.assign({}, defaults, {withPanel: false}, changes));
    document.setProperty(object, 'name', name); document.setTransform(object, {position: [0, 1, 0]}); objects.push(object);
    if (type === 'source' && variant !== 'queue') sources.push(object);
    if (type === 'palletQueue') receivers.push(object);
    return object;
  };
  const connect = (from, to, sourcePort = 'output', targetPort = 'input') => {
    if (!assembly.align(from, sourcePort, to, targetPort)) throw new Error('No se pudieron alinear los equipos de estudio.');
    const assessment = assembly.assessConnection(from, sourcePort, to, targetPort);
    if (!assessment.ready || !assembly.connect(assembly.pair(to, targetPort, from, sourcePort))) throw new Error('Conexión de estudio incompatible: ' + from.name + ' → ' + to.name);
    links.push({source: from.userData.editorId, sourcePort, target: to.userData.editorId, targetPort});
  };
  const product = (id, type = 'box', extra = {}) => Object.assign({id, name: id, type, width: .28, depth: .3, height: .24, mass: 2, base: 'rigid', color: '#62ad9a', quality: 'good', defect: 'none'}, extra);
  const source = (name, catalogue, changes = {}) => add('source', name, undefined, Object.assign({generationMode: 'sequence', catalog: JSON.stringify(catalogue)}, changes));
  const conveyor = (name, variant = 'roller-motor', changes = {}) => add('conveyor', name, variant, changes);
  const fifo = () => add('source', 'FIFO · pulmón de preparación', 'queue', {autoGenerate: false, initialCount: 0});
  let controller, expectedReceiverUnits;
  try {
    if (definition.advanced === 'rework') {
      const inlet = source('Source · 8 conformes + 8 defectuosas', [product('conforme'), product('defectuosa', 'box', {quality: 'defective', defect: 'surface', color: '#cf6a54'})]);
      const queue = fifo(), inspect = add('processor', 'Inspección · lectura de atributos simulados'), sort = conveyor('Decisión · defectuosos a retrabajo', 'distributor', {routing: 'rules', routingDefault: 'main', branchSide: 'right', routingRules: JSON.stringify([{field: 'quality', operator: 'eq', value: 'defective', route: 'branch'}])});
      const accepted = add('palletQueue', 'Conformes · 8 unidades'), side = conveyor('Ramal de retrabajo', 'belt', {length: 3}), rework = add('processor', 'Retrabajo temporizado · conservar calidad original', undefined, {processTime: 4}), pending = add('palletQueue', 'Retrabajadas · 8 pendientes de validación');
      connect(inlet, queue); connect(queue, inspect); connect(inspect, sort); connect(sort, accepted); connect(sort, side, 'branch'); connect(side, rework); connect(rework, pending); controller = sort; expectedReceiverUnits = [8, 8];
    } else if (definition.advanced === 'packing') {
      const inlet = source('Source · 24 productos / 4 formatos', [product('caja'), product('contenedor', 'crate', {color: '#568ac2'}), product('bidon', 'drum', {color: '#cfac53'}), product('botella', 'bottle', {width: .2, depth: .2, color: '#a57db4'})], {totalLimit: 24});
      const queue = fifo(), setup = add('processor', 'Packing · setup por cambio de producto'), combine = add('processor', 'Combiner · dos cargas', 'combiner', {combineCount: 2}), split = add('processor', 'Separator · recuperar originales', 'separator', {splitCount: 2});
      const sort = conveyor('Clasificación · contenedores a ramal', 'distributor', {routing: 'rules', routingDefault: 'main', branchSide: 'right', routingRules: JSON.stringify([{field: 'productType', operator: 'eq', value: 'crate', route: 'branch'}])});
      const general = add('palletQueue', 'General · 18 unidades', undefined, {capacity: 24, palletCapacity: 3}), side = conveyor('Salida de contenedores', 'belt', {length: 3}), crates = add('palletQueue', 'Contenedores · 6 unidades');
      [inlet, queue, setup, combine, split, sort, general].slice(1).forEach((object, index, chain) => connect(index ? chain[index - 1] : inlet, object));
      connect(sort, side, 'branch'); connect(side, crates); controller = sort; expectedReceiverUnits = [18, 6];
    } else if (definition.advanced === 'pallets') {
      const inlet = source('Source · cuatro pallets de cuatro cajas', [product('caja-paletizada')], {loadMode: 'pallet', palletColumns: 2, palletRows: 2, palletLayers: 1, totalLimit: 4, capacity: 4, interval: 7, outputInterval: 2});
      const chains = conveyor('Cadenas · admisión de pallet', 'pallet-chain', {length: 3, width: 1.4}), popup = conveyor('Transferencia a 90° · cadenas elevables', 'popup-chain', {length: 2.8, width: 1.4, routing: 'branch', branchSide: 'left'}), middle = conveyor('Cadenas · enlace perpendicular', 'pallet-chain', {length: 3, width: 1.4}), turn = conveyor('Mesa giratoria · pallet', 'pallet-turntable', {length: 2.8, width: 1.4, routing: 'branch', branchSide: 'left'}), output = conveyor('Cadenas · evacuación', 'pallet-chain', {length: 3, width: 1.4}), stock = add('palletQueue', 'Buffer · cuatro pallets completos', undefined, {acceptsPallets: true, capacity: 4, palletCapacity: 4, width: 1.4, depth: 1.2, columns: 1, rows: 1, layers: 1});
      connect(inlet, chains); connect(chains, popup); connect(popup, middle, 'branch'); connect(middle, turn); connect(turn, output, 'branch'); connect(output, stock); controller = chains; expectedReceiverUnits = [16];
    } else {
      const inlet = source('Source manual · Generar para comenzar', [product('caja-manual')], {autoGenerate: false, initialCount: 0, totalLimit: 4}), station = conveyor('Estación · espera al operario', 'manual-station', {requiresOperator: true, operatorAvailable: false, loadingMode: 'manual'}), stock = add('palletQueue', 'Almacén de práctica manual');
      connect(inlet, station); connect(station, stock); controller = inlet; expectedReceiverUnits = [0];
    }
    patch(document, controller, {withPanel: true});
    controller.traverse(node => { const values = document.getBehaviors(node); if (values.some(value => value.type === 'control')) document.setBehaviors(node, values.map(value => value.type === 'control' ? Object.assign({}, value, {scope: 'line'}) : value)); });
    const line = {id: definition.id, title: definition.title, mode: definition.mode, objects, links, sources, receivers, source: sources[0], receiver: receivers[0], controller, expectedUnits: definition.expectedUnits || 0, expectedReceiverUnits, memberIds: objects.map(object => object.userData.editorId)};
    return {objects, cells: [line], lines: [line], sources, receivers, controllers: [controller], links, expectedUnits: line.expectedUnits};
  } finally { assembly.clear(); }
}

function localBounds(root, objects) {
  root.updateWorldMatrix(true, true); const inverse = new THREE.Matrix4().getInverse(root.matrixWorld), bounds = new THREE.Box3();
  const visit = object => { if (!object.visible || object.userData.editorHelper || object.userData.editorRuntimeHelper || object.userData.industrialSensorVolume) return;
    if (object.geometry) { if (!object.geometry.boundingBox) object.geometry.computeBoundingBox(); if (object.geometry.boundingBox) bounds.union(object.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld))); } object.children.forEach(visit); };
  objects.forEach(visit); return bounds;
}

// Small, finite teaching cells for standalone XR. The same physical pallet
// crosses Source -> robot -> conveyor(s) -> manual forklift -> floor stock.
// A bounded warehouse shell supplies a real interior without background
// production, texture overlays, extra shadow lights or continuous feed.
function compactVrStudy(document, roomId, definition, scene, options) {
  const objects = [], links = [], conveyors = [], root = document.getRoot(roomId);
  const assembly = new ConveyorAssembly({document, roomId, root, ctx: {scene}, hooks: {renderScene: scene}, assemblyMessage() {}});
  const add = (type, name, variant, config, position) => {
    const object = document.addPrefab(roomId, type, variant); patch(document, object, config);
    document.setProperty(object, 'name', name); document.setTransform(object, {position}); objects.push(object); return object;
  };
  const connect = (from, to, port = 'output') => {
    if (!assembly.align(from, port, to, 'input') || !assembly.connect(assembly.pair(to, 'input', from, port))) throw new Error('No se pudo conectar la célula compacta de RV.');
    links.push({source: from.userData.editorId, sourcePort: port, target: to.userData.editorId, targetPort: 'input'});
  };
  try {
    const source = add('source', 'RV · dos pallets / cuatro cajas cada uno', undefined, {
      running: true, autoGenerate: true, initialCount: 1, totalLimit: 2, capacity: 2, interval: 18, delivery: 'manual', withPanel: false,
      loadMode: 'pallet', palletType: 'euro-1200x800', palletColumns: 2, palletRows: 2, palletLayers: 1,
      generationMode: 'sequence', catalog: JSON.stringify([{id: 'vr-four-boxes', name: 'Caja de práctica RV', type: 'box', variant: 'box-small', width: .3, depth: .3, height: .22, mass: 2, base: 'flat', color: '#b98d53', quality: 'good', defect: 'none'}])}, [-1.3, 1, .8]);
    const robot = add('robot', 'RV · robot de expedición', 'articulated-general', {
      running: true, mode: 'automatic', withPanel: false, sourceId: source.userData.editorId, reach: 3.2, payloadKg: 80,
      tool: 'vacuum', acceptedTypes: 'pallets', requireKnownMass: true, maxProductWidth: 1.3, maxProductDepth: 1.1, maxProductHeight: 1,
      baseHeight: .45, speed: .8, cycleTime: 4, processTime: 0, setupTime: .4, approachHeight: .18}, [0, 0, 0]);
    // The catalogue home scales its horizontal offset with arm reach. At 3.2m
    // that puts the wrist inside a loaded pallet at the adjoining chain input.
    // Author a metric folded waiting pose beside the base, retaining the full
    // configured reach and the same forward/inverse kinematic chain.
    const robotConfig = machine(document, robot), ready = schema.robotKinematics.inverse(robotConfig, {x: .35, y: robotConfig.baseHeight + .65, z: 0});
    if (!ready.reached) throw new Error('La postura de espera de la célula de RV queda fuera del alcance.');
    patch(document, robot, {jointLimitsJson: JSON.stringify(schema.robots.getJointDefinitions(robotConfig).map((joint, index) => ({id: joint.id, min: joint.min, max: joint.max, home: ready.joints[index]})))});
    patch(document, source, {outputId: robot.userData.editorId});
    const turn = definition.compactVR === 'turn', one = definition.compactVR === 'dispatch';
    const entry = add('conveyor', turn ? 'RV · mesa de giro a 90°' : 'RV · banda de recepción', turn ? 'pallet-turntable' : 'pallet-chain', {
      length: turn ? 2.8 : 2.4, width: 1.4, supportHeight: .65, powered: true, running: true, autoSpawn: false,
      withSensors: false, withPanel: one, speed: .25, maxPackages: 1, maxLoad: 150, clearance: 1.5}, [2.4, .65, 0]);
    conveyors.push(entry); patch(document, robot, {outputId: entry.userData.editorId});
    links.push({source: source.userData.editorId, sourcePort: 'output', target: robot.userData.editorId, targetPort: 'input'}, {source: robot.userData.editorId, sourcePort: 'output', target: entry.userData.editorId, targetPort: 'input'});
    let pickup = entry;
    if (!one) {
      pickup = add('conveyor', 'RV · salida / recogida de montacargas', 'pallet-chain', {
        length: 2.4, width: 1.4, supportHeight: .65, powered: true, running: true, autoSpawn: false, withSensors: false,
        withPanel: true, speed: .25, maxPackages: 1, maxLoad: 150, clearance: 1.5}, [0, .65, 0]);
      connect(entry, pickup, turn ? 'branch' : 'output'); conveyors.push(pickup);
    }
    document.setBehaviors(pickup, document.getBehaviors(pickup).concat(Object.assign(schema.defaultBehavior('automation'), {rules: JSON.stringify([
      {sourceId: pickup.userData.editorId, variable: 'transferBlocked', operator: 'eq', value: true, targetId: pickup.userData.editorId, targetVariable: 'running', set: false, edge: 'rising'}])})));
    root.updateWorldMatrix(true, true);
    const config = machine(document, pickup), port = schema.conveyorLayout.ports(config).output;
    const direction = new THREE.Vector3(port.tx, 0, port.tz).applyQuaternion(pickup.quaternion).normalize();
    const end = new THREE.Vector3(port.x, port.y, port.z).applyQuaternion(pickup.quaternion).add(pickup.position);
    const parking = end.clone().addScaledVector(direction, 3.4); parking.y = 0;
    const destination = add('palletQueue', 'RV · bahías de entrega de pallets completos', undefined, {
      running: true, withPanel: false, acceptsPallets: true, palletType: 'euro-1200x800', width: 1.2, depth: .8,
      palletCapacity: 2, capacity: 2, columns: 1, rows: 1, layers: 1, autoRelease: false, delivery: 'manual'}, [parking.x - direction.z * 4.5, 1, parking.z + direction.x * 4.5]);
    document.setTransform(destination, {quaternion: pickup.quaternion.toArray()});
    const vehicle = add('vehicle', 'RV · único montacargas manual', 'forklift-electric-3w', {
      mode: 'manual', powered: true, running: true, parkingBrake: true, forkSpread: .312, sourceId: pickup.userData.editorId,
      outputId: destination.userData.editorId, waypointsJson: '[]', serial: 'RV-COMPACTO', detail: 'balanced'}, parking.toArray());
    document.setTransform(vehicle, {rotation: [0, Math.atan2(-direction.x, -direction.z), 0]});
    links.push({source: pickup.userData.editorId, sourcePort: 'output', target: vehicle.userData.editorId, targetPort: 'input'}, {source: vehicle.userData.editorId, sourcePort: 'output', target: destination.userData.editorId, targetPort: 'input'});
    const line = {id: definition.id, title: definition.title, mode: 'mixed', continuous: false, objects: objects.slice(), links,
      sources: [source], receivers: [destination], source, receiver: destination, controller: robot, expectedUnits: 8,
      expectedReceiverUnits: [8], memberIds: objects.map(object => object.userData.editorId)};
    let environment = null;
    if (!options.preview) {
      const solid = schema.defaultBehavior('collision');
      const part = (name, color, position, scale, behaviors = []) => { const object = document.addPrimitive(roomId, 'box', color);
        document.setProperty(object, 'name', name); document.setTransform(object, {position, scale}); document.setBehaviors(object, behaviors); objects.push(object); return object; };
      const finish = color => Object.assign(schema.defaultBehavior('surfaceMaterial'), {preset: 'custom', color, roughness: .96, metalness: 0, colorMapMode: 'none', clearcoat: 0});
      const floor = part('CEDI · RV suelo continuo', '#657071', [3, -.06, 0], [24, .12, 20], [solid, schema.defaultBehavior('teleport'),
        Object.assign(schema.defaultBehavior('surfaceMaterial'), {preset: 'concrete', color: '#657071', roughness: .98, colorMapMode: 'none', normalStrength: .3, repeatX: 6, repeatY: 5})]);
      // Each wall occupies its own volume. End walls stop at the inner faces
      // of the side walls, avoiding coplanar faces at the four corners.
      const walls = [
        part('CEDI · RV pared posterior', '#777e80', [3, 2.8, -10], [23.84, 5.6, .16], [solid, finish('#777e80')]),
        part('CEDI · RV pared frontal', '#777e80', [3, 2.8, 10], [23.84, 5.6, .16], [solid, finish('#777e80')]),
        part('CEDI · RV pared lateral izquierda', '#777e80', [-9, 2.8, 0], [.16, 5.6, 20.16], [solid, finish('#777e80')]),
        part('CEDI · RV pared lateral derecha', '#777e80', [15, 2.8, 0], [.16, 5.6, 20.16], [solid, finish('#777e80')])
      ];
      const roof = part('CEDI · RV cubierta industrial cerrada', '#56636b', [3, 5.68, 0], [24.16, .16, 20.16], [solid, finish('#56636b')]);
      const beams = [-4, 4].map(z => part('CEDI · RV viga transversal de cubierta', '#414d54', [3, 5.42, z], [23.84, .25, .16], [finish('#414d54')]));
      const fixtures = [];
      for (const z of [-4, 4]) for (const x of [-3, 9]) fixtures.push(part('CEDI · RV luminaria LED de techo', '#d9e0df', [x, 5.25, z], [3.2, .05, .34], [
        Object.assign(finish('#d9e0df'), {emissiveMode: 'custom', emissive: '#e2ede8', emissiveIntensity: .45})]));
      const markings = document.addIndustrialFloorPresentation(roomId, {type: 'industrialFloor', version: 1,
        bounds: [-9, -10, 15, 10], floorY: 0, walkways: [[-7, 5, -5, 9]], zones: [[-3, -4.5, 6.5, 2.6]],
        texts: ['CELDA RV', 'PASILLO'], labels: [[1, 2.1, 0, 2.4, .45, 8], [-6, 7, -Math.PI / 2, 2.4, .45, 9]], signs: [[-6, 4.5, 0, 0, 9]]});
      document.setProperty(markings, 'name', 'RV · pasillos y textos editables'); objects.push(markings); line.objects.push(markings);
      const guide = part('RV · guía de la práctica', '#18303a', [-3.3, 1.7, 2.5], [2.6, 1.15, .05], [Object.assign(schema.defaultBehavior('info'), {
        title: definition.title, text: definition.objective + '\n' + definition.tasks.join('\n') + '\nLímite: dos pallets de cuatro cajas. Libera Freno P para conducir. Detén la banda antes de recoger; retira las uñas antes de reiniciar.', fontSize: .032})]);
      line.objects.push(guide);
      const studio = document.studio || {}, settings = Object.assign(schema.studio.defaultEnvironment(roomId), STUDY_ENVIRONMENT_DEFAULTS, {
        renderQuality: 'balanced', exposure: .87, sunIntensity: .6, ambientIntensity: .25, sky: 'color', skyColor: '#30444c', horizonColor: '#c2cecb', groundColor: '#47545a', sunColor: '#f3f4e8', machineVolume: .18});
      document.setStudio({environments: (studio.environments || []).filter(e => e.roomId !== roomId).concat(settings),
        groups: (studio.groups || []).concat({id: 'compact-vr-' + roomId + '-' + definition.id, name: definition.title, roomId, members: line.objects.map(o => o.userData.editorId)}),
        missions: (studio.missions || []).concat({id: 'compact-vr-mission-' + roomId + '-' + definition.id, name: definition.title, roomId,
          description: definition.objective, help: definition.tasks.join('\n'), start: 'automatic', steps: [{name: 'Entregar los dos pallets con el montacargas', event: 'vehicle-delivered', objectId: vehicle.userData.editorId, target: 2, failEvent: ''}]})});
      (document.studio.spawns || []).filter(v => v.roomId === roomId).forEach(v => {const marker = document.getObject(v.objectId); if (marker) document.setTransform(marker, {position: [4, .02, 8]});});
      const camera = new THREE.PerspectiveCamera(); camera.position.set(10, 4.5, 9); camera.lookAt(1, 1, 0);
      (document.studio.entities || []).filter(v => v.roomId === roomId && v.type === 'camera').forEach(v => {const marker = document.getObject(v.objectId); if (marker) document.setTransform(marker, {position: camera.position.toArray(), quaternion: camera.quaternion.toArray()});});
      environment = {objects: [floor, ...walls, roof, ...beams, ...fixtures], floor, walls, roof, structure: beams, fixtures, environment: settings,
        bounds: {min: [-9, 0, -10], max: [15, 5.6, 10], width: 24, depth: 20, height: 5.6}};
    }
    return {objects, cells: [line], lines: [line], sources: [source], receivers: [destination], controllers: [robot], vehicles: [vehicle],
      conveyors, robot, source, pickup, destination, vehicle, links, expectedUnits: 8, environment, compactVR: true, presetId: definition.id, definition};
  } finally { assembly.clear(); }
}

/** A bounded manual warehouse: authored loads start on their real supports.
 * Task routes describe chassis centres in room coordinates; they stop in
 * clear approach lanes. The live docking planner supplies the final pose. */
function warehouseVrStudy(document, roomId, definition, options) {
  const objects = [], root = document.getRoot(roomId), racks = schema.warehouseRacks;
  const set = (object, type, values) => document.setBehaviors(object, document.getBehaviors(object).map(config => config.type === type ? Object.assign({}, config, values) : config));
  const add = (type, name, variant, config, position) => {
    const object = document.addPrefab(roomId, type, variant); if (config) set(object, type, config);
    document.setProperty(object, 'name', name); document.setTransform(object, {position}); objects.push(object); return object;
  };
  const stockValues = {running: true, withPanel: false, acceptsPallets: true, palletType: 'euro-1200x800', palletMaterial: 'wood',
    width: 1.2, depth: .8, palletCapacity: 1, capacity: 1, columns: 1, rows: 1, layers: 1, autoRelease: false, delivery: 'manual'};
  const rack = add('palletQueue', 'Almacén · A01 / R01 · ocho ubicaciones selectivas', undefined,
    Object.assign({}, stockValues, racks.defaults('selective'), {rackBays: 2, rackLevels: 2, rackColumns: 2, rackBayWidths: '3, 3', rackSlotDepth: 1.1,
      rackBaseHeight: .3, rackLevelHeight: 1.4, rackAisleCode: 'A01', rackRowCode: 'R01', rackAssignments: '[]'}), [0, 1, -5]);
  const layout = racks.layout(document.getBehaviors(rack).find(config => config.type === 'palletQueue'));
  const upper = layout.cells.find(cell => cell.bay === 0 && cell.level === 1 && cell.column === 0);
  const lower = layout.cells.find(cell => cell.bay === 1 && cell.level === 0 && cell.column === 0);
  const empty = layout.cells.find(cell => cell.bay === 1 && cell.level === 1 && cell.column === 1);
  const incoming = add('palletQueue', 'ENTRADA E01 · recepción a piso', undefined, stockValues, [6, 1, 4]);
  const outgoing = add('palletQueue', 'SALIDA S01 · expedición a piso', undefined, stockValues, [-6, 1, 4]);
  const returns = add('palletQueue', 'DEVOLUCIÓN D01 · revisión a piso', undefined, stockValues, [6, 1, -5]);
  const seed = (name, sku, store, cell, color) => {
    const product = add('product', name, 'pallet-loaded', {sourceId: store.userData.editorId, sku, productType: 'pallet', loadMode: 'pallet',
      // At .72 m total height cargo() retains the standard .144 m Euro
      // pallet. Its real .07488 m openings clear the truck's metal tines.
      units: 4, mass: 33, width: 1.2, depth: .8, height: .72, palletType: 'euro-1200x800', palletMaterial: 'wood', contents: 'boxes', color}, [0, 0, 0]);
    // Match PalletQueueRuntime.rackMatrix: centre X/Z on the support and
    // retain a five-millimetre contact tolerance above the bearing plane.
    const bounds = localBounds(product, [product]), center = bounds.getCenter(new THREE.Vector3());
    document.setTransform(product, {position: [store.position.x + cell.position[0] - center.x, store.position.y + cell.position[1] + .005 - bounds.min.y,
      store.position.z + cell.position[2] - center.z]});
    return product;
  };
  const highPallet = seed('WH-001 · retirada de nivel superior · 4 cajas / 33 kg', 'WH-001', rack, upper, '#b99b67');
  const newPallet = seed('WH-002 · reposición desde entrada · 4 cajas / 33 kg', 'WH-002', incoming, {position: [0, -1, 0]}, '#6d8e9b');
  const lowPallet = seed('WH-003 · devolución desde primer nivel · 4 cajas / 33 kg', 'WH-003', rack, lower, '#b6a57a');
  // One load, one address. Occupied source slots derive their identity from
  // actual initial custody; only the future inbound seat needs reservation.
  set(rack, 'palletQueue', {rackAssignments: JSON.stringify([{locationCode: empty.code, palletId: newPallet.userData.editorId}])});
  const tasks = [
    {id: 'wh-01-expedicion', name: '1 · Retirar WH-001 del nivel superior y entregar en SALIDA S01', productId: highPallet.userData.editorId,
      sourceId: rack.userData.editorId, sourceLocationCode: upper.code, destinationId: outgoing.userData.editorId, destinationSlot: 0,
      pickupRoute: [{x: 0, z: 0}, {x: upper.x, z: 0}, {x: upper.x, z: -2}],
      route: [{x: upper.x, z: 0}, {x: -6, z: 0}, {x: -8.5, z: 7}, {x: -6, z: 7}]},
    {id: 'wh-02-reposicion', name: '2 · Recoger WH-002 de ENTRADA E01 y reponer ' + empty.code, productId: newPallet.userData.editorId,
      sourceId: incoming.userData.editorId, destinationId: rack.userData.editorId, locationCode: empty.code,
      pickupRoute: [{x: -6, z: 7}, {x: 0, z: 7}, {x: 6, z: 7}],
      route: [{x: 6, z: 7}, {x: 8.5, z: 7}, {x: 6, z: 0}, {x: empty.x, z: 0}, {x: empty.x, z: -2}]},
    {id: 'wh-03-devolucion', name: '3 · Retirar WH-003 del primer nivel y entregar en DEVOLUCIÓN D01', productId: lowPallet.userData.editorId,
      sourceId: rack.userData.editorId, sourceLocationCode: lower.code, destinationId: returns.userData.editorId, destinationSlot: 0,
      pickupRoute: [{x: empty.x, z: 0}, {x: lower.x, z: 0}, {x: lower.x, z: -2}],
      route: [{x: lower.x, z: 0}, {x: 6, z: 0}, {x: 6, z: -2}]}
  ];
  const vehicle = add('vehicle', 'RV · montacargas de almacén · misiones guiadas', 'forklift-electric-3w', {
    mode: 'manual', powered: true, running: true, parkingBrake: true, paused: false, emergency: false, forkSpread: .48,
    speed: 1.35, reverseSpeed: .85, maxLift: 3, forkColor: '#aebcc6', detail: 'balanced', serial: 'WH-TRAIN-01',
    sourceId: rack.userData.editorId, outputId: outgoing.userData.editorId, waypointsJson: '[]', trainingTasksJson: JSON.stringify(tasks)}, [0, 0, 5]);
  document.setTransform(vehicle, {rotation: [0, Math.PI, 0]});
  const products = [highPallet, newPallet, lowPallet], receivers = [rack, outgoing, returns];
  const line = {id: definition.id, title: definition.title, mode: 'manual', continuous: false, objects: objects.slice(), links: [],
    sources: [rack, incoming], receivers, source: rack, receiver: outgoing, controller: vehicle, expectedUnits: 12, expectedReceiverUnits: [4, 4, 4],
    memberIds: objects.map(object => object.userData.editorId)};
  let environment = null, floorPresentation = null;
  if (!options.preview) {
    document.getObjects(roomId).filter(object => object.name === 'Suelo del nivel' && !document.isNative(object)).forEach(object => document.remove(object));
    const solid = schema.defaultBehavior('collision');
    const finish = (color, concrete = false) => Object.assign(schema.defaultBehavior('surfaceMaterial'), {preset: concrete ? 'concrete' : 'custom', color,
      roughness: .96, metalness: 0, colorMapMode: concrete ? 'preserve' : 'none', clearcoat: 0, normalStrength: .25, repeatX: 6, repeatY: 5});
    const part = (name, color, position, scale, behaviors) => {
      const object = document.addPrimitive(roomId, 'box', color); document.setProperty(object, 'name', name); document.setTransform(object, {position, scale});
      document.setBehaviors(object, behaviors); objects.push(object); return object;
    };
    const floor = part('CEDI · RV almacén · hormigón continuo', '#7e8988', [0, -.06, 1], [24, .12, 20], [solid, schema.defaultBehavior('teleport'), finish('#7e8988', true)]);
    const walls = [
      part('CEDI · RV almacén · pared posterior', '#929b98', [0, 2.8, -9], [23.84, 5.6, .16], [solid, finish('#929b98', true)]),
      part('CEDI · RV almacén · pared frontal', '#929b98', [0, 2.8, 11], [23.84, 5.6, .16], [solid, finish('#929b98', true)]),
      part('CEDI · RV almacén · pared izquierda', '#929b98', [-12, 2.8, 1], [.16, 5.6, 20.16], [solid, finish('#929b98', true)]),
      part('CEDI · RV almacén · pared derecha', '#929b98', [12, 2.8, 1], [.16, 5.6, 20.16], [solid, finish('#929b98', true)])
    ];
    const roof = part('CEDI · RV almacén · cubierta industrial cerrada', '#66747a', [0, 5.68, 1], [24.16, .16, 20.16], [solid, finish('#66747a')]);
    const structure = [-3, 5].map(z => part('CEDI · RV almacén · viga de cubierta', '#4f5f66', [0, 5.42, z], [23.84, .25, .16], [finish('#4f5f66')]));
    const fixtures = [];
    for (const z of [-3, 5]) for (const x of [-5, 5]) fixtures.push(part('CEDI · RV almacén · luminaria LED', '#e1e7e3', [x, 5.25, z], [3.2, .05, .34], [
      Object.assign(finish('#e1e7e3'), {emissiveMode: 'custom', emissive: '#edf4ed', emissiveIntensity: .45})]));
    const plan = {type: 'industrialFloor', version: 1, bounds: [-12, -9, 12, 11], floorY: 0,
      walkways: [[-11, -7, -9.8, 9]], zones: [[-3.35, -5.85, 3.35, -3.9]], bays: [[5.15, 3.35, 6.85, 4.65], [-6.85, 3.35, -5.15, 4.65], [5.15, -5.65, 6.85, -4.35]],
      arrows: [[-5, 0, -Math.PI / 2], [0, 0, -Math.PI / 2], [5, 0, -Math.PI / 2]],
      texts: ['ENTRADA E01', 'SALIDA S01', 'DEVOLUCIÓN D01', 'PASILLO A01 · FILA R01', 'PASILLO PEATONAL'],
      labels: [[6, 5.15, 0, 2.4, .4, 8], [-6, 5.15, 0, 2.4, .4, 9], [6, -3.85, 0, 2.4, .4, 10], [0, -3.1, 0, 4.8, .4, 11], [-10.4, 2, -Math.PI / 2, 3.2, .4, 12]]};
    const presentation = document.addIndustrialFloorPresentation(roomId, plan); document.setProperty(presentation, 'name', 'Almacén RV · bahías, pasillo y códigos editables'); objects.push(presentation);
    floorPresentation = {presentation, plan, changed: true};
    const studio = document.studio || {}, settings = Object.assign(schema.studio.defaultEnvironment(roomId), STUDY_ENVIRONMENT_DEFAULTS, {
      renderQuality: 'balanced', exposure: .91, sunIntensity: .65, ambientIntensity: .29, sky: 'color', skyColor: '#31444b', horizonColor: '#d0d8d2',
      groundColor: '#58646a', sunColor: '#f4f4ec', machineVolume: .16});
    document.setStudio({environments: (studio.environments || []).filter(item => item.roomId !== roomId).concat(settings),
      groups: (studio.groups || []).concat({id: 'warehouse-vr-' + roomId + '-' + definition.id, name: definition.title, roomId, members: objects.map(object => object.userData.editorId)})});
    (document.studio.spawns || []).filter(value => value.roomId === roomId).forEach(value => { const marker = document.getObject(value.objectId); if (marker) document.setTransform(marker, {position: [2, .02, 7.5]}); });
    const camera = new THREE.PerspectiveCamera(); camera.position.set(10, 4.7, 9.3); camera.lookAt(0, 1, -1);
    (document.studio.entities || []).filter(value => value.roomId === roomId && value.type === 'camera').forEach(value => { const marker = document.getObject(value.objectId); if (marker) document.setTransform(marker, {position: camera.position.toArray(), quaternion: camera.quaternion.toArray()}); });
    environment = {objects: [floor, ...walls, roof, ...structure, ...fixtures], floor, walls, roof, structure, fixtures, environment: settings,
      bounds: {min: [-12, 0, -9], max: [12, 5.6, 11], width: 24, depth: 20, height: 5.6}};
  }
  line.objects = objects.slice(); line.memberIds = objects.map(object => object.userData.editorId);
  return {objects, cells: [line], lines: [line], sources: [rack, incoming], receivers, controllers: [vehicle], vehicles: [vehicle], products, conveyors: [], links: [],
    rack, incoming, outgoing, returns, source: rack, destination: outgoing, vehicle, tasks, layout, seededSlots: [upper, lower], destinationSlot: empty,
    expectedUnits: 12, environment, floorPresentation, compactVR: true, warehouseTraining: true, presetId: definition.id, definition};
}

export function buildStudyScene(document, roomId, id, options = {}) {
  const definition = studyScene(id), root = document.getRoot(roomId), scene = options.scene || root, own = !document.transaction;
  if (own) document.begin();
  try {
    if (definition.warehouseTraining) {const built = warehouseVrStudy(document, roomId, definition, options); if (own) document.commit(); return built;}
    if (definition.compactVR) {const built = compactVrStudy(document, roomId, definition, scene, options); if (own) document.commit(); return built;}
    if (definition.vehicles) {
      const built = buildIndustrialVehicleStudy(document, roomId, options);
      if (!options.preview) configureStudyEnvironment(document, roomId, built);
      if (own) document.commit(); return Object.assign(built, {presetId: id, definition});
    }
    if (definition.kind) {
      const built = buildIndustrialCediLevel(document, roomId, {kind: definition.kind, scene, robotized: definition.robotized === true, continuous: options.continuous !== false, floorPresentation: !options.preview && options.floorPresentation !== false, monitorLayout: !options.preview && options.monitorLayout !== false, industrialMessages: !options.preview && options.industrialMessages !== false, industrialAging: !options.preview && options.industrialAging !== false});
      if (!options.preview) { configureStudyEnvironment(document, roomId, built); addStudyMission(document, roomId, definition, built.lines); }
      if (own) document.commit(); return Object.assign(built, {presetId: id, definition});
    }
    const built = definition.robot ? robotNetwork(document, roomId, definition, scene, options) : definition.cellId ? buildIndustrialLabLines(document, roomId, {scene, cellIds: [definition.cellId], continuous: options.continuous === true}) : advancedNetwork(document, roomId, definition, scene);
    const lines = built.cells || built.lines, bounds = localBounds(root, built.objects), center = bounds.getCenter(new THREE.Vector3());
    built.objects.forEach(object => document.setTransform(object, {position: object.position.clone().sub(new THREE.Vector3(center.x, 0, center.z)).toArray()}));
    const compact = localBounds(root, built.objects), extent = compact.getSize(new THREE.Vector3());
    if (!options.preview) {
      document.getObjects(roomId).filter(object => object.name === 'Suelo del nivel' && !document.isNative(object)).forEach(object => document.remove(object));
      const width = Math.max(24, Math.ceil((extent.x + 14) / 4) * 4), depth = Math.max(24, Math.ceil((extent.z + 14) / 4) * 4);
      const environment = buildCediEnvironment(document, roomId, {width, depth, floor: true});
      const extras = [], primitive = (name, color, position, scale, behaviors) => { const object = document.addPrimitive(roomId, 'box', color); document.setProperty(object, 'name', name); document.setTransform(object, {position, scale}); document.setBehaviors(object, behaviors || []); extras.push(object); return object; };
      lines.forEach(line => {
        const monitor = primitive('Monitor · ' + definition.title, '#202f39', [compact.min.x - 2.4, 2, compact.max.z + 1.7], [3.2, 1.8, .12], [Object.assign(schema.defaultBehavior('lineMonitor'), {targetId: line.controller.userData.editorId, title: definition.title, scope: 'line'})]);
        line.monitor = monitor; primitive('Pedestal del monitor', '#405360', [monitor.position.x, .55, monitor.position.z], [.12, 1.1, .12]);
        const sign = primitive('Guía · ' + definition.title, '#182b38', [compact.min.x - 2.4, 2, compact.max.z + 3.8], [3.2, 2.2, .07], [Object.assign(schema.defaultBehavior('info'), {title: definition.title, text: definition.objective + '\n' + definition.tasks.map((task, index) => (index + 1) + '. ' + task).join('\n'), fontSize: .032, color: '#eff5fa'})]);
        line.objects.push(monitor, sign);
      });
      // The elevator lesson keeps an accessible, load-bearing upper destination.
      if (definition.cellId === 'elevator') {
        const receiver = lines[0].receiver, floorY = receiver.position.y - 1;
        if (floorY > .1) {
          primitive('Plataforma de descarga superior', '#63737e', [receiver.position.x, floorY - .1, receiver.position.z], [5.4, .2, 4.5], [schema.defaultBehavior('collision'), schema.defaultBehavior('teleport')]);
          const count = Math.ceil(floorY / .2); for (let step = 1; step <= count; step++) { const height = floorY * step / count; primitive('Escalón de acceso ' + step, '#63737e', [receiver.position.x, height / 2, receiver.position.z + 2.4 + (count - step) * .32], [1.1, height, .32], [schema.defaultBehavior('collision'), schema.defaultBehavior('teleport')]); }
        }
      }
      const studio = document.studio || {}, front = depth / 2 - 3;
      document.setStudio({environments: (studio.environments || []).filter(item => item.roomId !== roomId).concat(environment.environment), groups: (studio.groups || []).concat(lines.map(line => ({id: 'study-' + roomId + '-' + id, name: definition.title, roomId, members: Array.from(new Set(line.objects.concat(extras).map(object => object.userData.editorId)))})))});
      (document.studio.spawns || []).filter(item => item.roomId === roomId).forEach(item => { const object = document.getObject(item.objectId); if (object) document.setTransform(object, {position: [0, .02, front]}); });
      const pose = new THREE.PerspectiveCamera(); pose.position.set(extent.x * .35 + 3, Math.max(5, extent.x * .18), front - 2); pose.lookAt(0, 1, 0);
      (document.studio.entities || []).filter(item => item.roomId === roomId && item.type === 'camera').forEach(item => { const object = document.getObject(item.objectId); if (object) document.setTransform(object, {position: pose.position.toArray(), quaternion: pose.quaternion.toArray()}); });
      built.environment = environment; built.objects = Array.from(new Set(built.objects.concat(environment.objects, extras))); configureStudyEnvironment(document, roomId, built); addStudyMission(document, roomId, definition, lines);
    }
    built.sources = lines.flatMap(line => line.sources); built.receivers = lines.flatMap(line => line.receivers); built.controllers = lines.map(line => line.controller); built.lines = lines; built.presetId = id; built.definition = definition;
    if (!options.preview) {
      built.aging = options.industrialAging === false ? null : applyIndustrialAging(document, roomId);
      built.messages = applyIndustrialMessages(document, roomId, {enabled: options.industrialMessages !== false});
    }
    if (!options.preview && options.monitorLayout !== false) {
      built.monitorLayout = applyIndustrialMonitorLayout(document, roomId, {lines}); built.objects = built.objects.concat(built.monitorLayout.supports).filter(object => document.getObject(object.userData.editorId) === object);
    }
    if (!options.preview && options.floorPresentation !== false) {
      built.floorPresentation = applyIndustrialFloorPresentation(document, roomId, {floorObject: built.environment && built.environment.floor, machines: built.objects, lines, replaceLegacy: true});
      if (built.floorPresentation.presentation) built.objects.push(built.floorPresentation.presentation);
      built.objects = Array.from(new Set(built.objects)).filter(object => document.getObject(object.userData.editorId) === object);
    }
    if (own) document.commit(); return built;
  } catch (error) { if (own) document.cancel(); throw error; }
}

function configureStudyEnvironment(document, roomId, built) {
  const environments = document.studio && document.studio.environments || [];
  const current = environments.find(item => item.roomId === roomId) || schema.studio.defaultEnvironment(roomId);
  const environment = Object.assign({}, current, STUDY_ENVIRONMENT_DEFAULTS, {roomId});
  document.setStudio({environments: environments.filter(item => item.roomId !== roomId).concat(environment),
    entities: (document.studio && document.studio.entities || []).map(entity => entity.roomId === roomId && entity.type === 'pointLight' ? Object.assign({}, entity, {intensity: .65}) : entity)});
  if (built.environment && built.environment.environment) built.environment.environment = environment;
}

function addStudyMission(document, roomId, definition, lines) {
  const steps = lines.filter(line => line.mode !== 'manual').map(line => ({name: 'Transferir una carga · ' + line.title, event: 'package-transfer', objectId: line.controller.userData.editorId, target: 1, failEvent: ''}));
  if (!steps.length) steps.push({name: 'Generar y transferir una carga manual', event: 'package-transfer', objectId: lines[0].source.userData.editorId, target: 1, failEvent: ''});
  document.setStudio({missions: (document.studio && document.studio.missions || []).concat({id: 'study-mission-' + roomId + '-' + definition.id, name: definition.title, roomId, description: definition.objective, help: definition.tasks.join('\n'), start: 'automatic', steps})});
}

export function studySceneReport(document, built, roomId) {
  const lines = built.lines || built.cells, continuous = lines.some(line => line.continuous);
  return {roomId, presetId: built.presetId, title: built.definition.title, mode: built.definition.mode, difficulty: built.definition.difficulty,
    continuous, expectedUnits: continuous ? 0 : built.expectedUnits || built.definition.expectedUnits || (built.definition.cellId ? 16 : 0),
    environment: Object.assign({}, (document.studio && document.studio.environments || []).find(item => item.roomId === roomId) || {}),
    objectIds: built.objects.map(object => object.userData.editorId), sourceIds: lines.flatMap(line => line.sources.map(object => object.userData.editorId)), receiverIds: lines.flatMap(line => line.receivers.map(object => object.userData.editorId)),
    lines: lines.map(line => ({id: line.id, title: line.title, mode: line.mode, controllerId: line.controller.userData.editorId, monitorId: line.monitor && line.monitor.userData.editorId,
      machineIds: line.objects.filter(object => machine(document, object)).map(object => object.userData.editorId), expectedReceiverUnits: line.expectedReceiverUnits || null, links: line.links || []}))};
}
