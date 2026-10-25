import * as THREE from 'three';
import ConveyorAssembly from './ConveyorAssembly.js';
import {liveMachine, liveProduct, livePalletSource} from './IndustrialContinuousExamples.js';

const HANDLING_DETECTORS = new Set(['loading', 'liftTransfer', 'turntable', 'pusher', 'steer', 'merge', 'distributor', 'elevator']);
const MACHINE_TYPES = ['source', 'conveyor', 'processor', 'palletQueue'];
const rule = (field, value, operator = 'eq') => ({field, operator, value, route: 'branch'});

/** Finite, editable production networks. Each network owns one PLC. Manual
 * catalogue equipment stays manual in explicitly labelled, empty annexes. */
export function buildIndustrialCediScenario(document, roomId, options = {}) {
  const kind = options.kind || 'sorting';
  const continuous = options.continuous === true;
  if (!['sorting', 'packing'].includes(kind)) throw new Error('Selecciona el CEDI de clasificación o de empaque.');
  const root = document.getRoot(roomId), scene = options.scene || root;
  if (!root) throw new Error('El escenario CEDI necesita un nivel disponible.');
  const assembly = new ConveyorAssembly({document, roomId, root, ctx: {scene}, hooks: {renderScene: scene}, assemblyMessage() {}});
  const objects = [], links = [], sources = [], receivers = [], controllers = [], lines = [], own = !document.transaction;
  const title = kind === 'sorting' ? 'CEDI · Clasificación multietapa y pallets' : 'CEDI · Empaque, rutas y transporte multinivel';
  const description = continuous ? 'Operación continua: referencias de distintos tamaños y tipos, clasificación trazable y almacenes de cuatro estibas. Se aprovecha la huella real de cada pallet en hasta cinco niveles y se despachan cargas completas para liberar capacidad. Cada red tiene un PLC y monitor; los anexos manuales esperan al operario.' : kind === 'sorting' ?
    '96 unidades automáticas. Dos alimentaciones con FIFO, inspección y unión en Y abastecen seis decisiones por defecto, calidad, SKU, color, tipo y dimensiones. Otra red transporta cuatro pallets de ocho cajas. Los dos anexos manuales vacíos permiten practicar sin motores ocultos. Cada red tiene su PLC y monitor.' :
    '96 unidades automáticas. Empaque y combinación se unen con una alimentación individual: la regla de cantidad separa lotes antes de dividirlos y repartir sus unidades al 25/75 %. Otra red transporta cuatro tipos por curvas, elevador, pendientes suaves, gravedad y alternancia. Pallets y anexos manuales completan el catálogo conservando trazabilidad.';
  if (own) document.begin();
  let active;
  const config = object => document.getBehaviors(object).find(value => MACHINE_TYPES.includes(value.type));
  const patch = (object, changes) => document.setBehaviors(object, document.getBehaviors(object).map(value => MACHINE_TYPES.includes(value.type) ? Object.assign({}, value, changes) : value));
  const beginLine = (id, name, text, mode = 'automatic') => {
    active = {id, title: name, description: text, mode, objects: [], links: [], sources: [], receivers: [], sourceExpectations: [], expectedReceiverUnits: [], expectedReceiverLoads: [], routingCoverage: [], platformReceivers: [], expectedUnits: 0, expectedLoads: 0};
    lines.push(active); return active;
  };
  function add(type, name, variant, changes = {}) {
    const object = document.addPrefab(roomId, type, variant), initial = config(object);
    const defaults = type === 'conveyor' ? {speed: .75, autoSpawn: false, withSensors: initial.drive !== 'manual' && HANDLING_DETECTORS.has(initial.mechanism), withPanel: false, powered: true, running: true, maxPackages: 24, rollerPitch: .06} :
      type === 'source' ? {withPanel: false, running: true, autoGenerate: true, delivery: 'automatic', initialCount: 1, totalLimit: 32, capacity: 12, interval: 1.6, outputInterval: .7} :
      type === 'processor' ? {withPanel: false, powered: true, running: true, requiresOperator: false, setupPolicy: 'productChange', setupTime: .4, processTime: .8, capacity: 12, outputCapacity: 1, delivery: 'automatic', outputInterval: .25, length: 2.4} :
      {withPanel: false, running: true, delivery: 'manual', palletCapacity: 1, width: 1.6, depth: 1.6, columns: 2, rows: 2, layers: 2, capacity: 8};
    patch(object, liveMachine(Object.assign({}, initial, defaults, changes), continuous, receivers.length, active.mode === 'manual')); document.setProperty(object, 'name', name); document.setTransform(object, {position: [0, 1, 0]}); objects.push(object); active.objects.push(object); return object;
  }
  function connect(from, to, sourcePort = 'output', targetPort = 'input', moveFrom = false) {
    if (!assembly.align(moveFrom ? to : from, moveFrom ? targetPort : sourcePort, moveFrom ? from : to, moveFrom ? sourcePort : targetPort)) throw new Error('No se pueden alinear los puertos CEDI: ' + from.name + ' → ' + to.name);
    const assessment = assembly.assessConnection(from, sourcePort, to, targetPort);
    if (!assessment.ready || !assembly.connect(assembly.pair(to, targetPort, from, sourcePort))) throw new Error('Conexión CEDI no válida: ' + from.name + ' → ' + to.name + '. ' + assessment.reasons.map(value => value.message).join(' '));
    const link = {source: from.userData.editorId, sourcePort, target: to.userData.editorId, targetPort}; links.push(link); active.links.push(link);
  }
  const product = (id, name, changes = {}) => liveProduct(Object.assign({id, name, type: 'box', width: .28, depth: .3, height: .25, color: '#b78b53', quality: 'good', defect: 'none', mass: 1, base: 'flat'}, changes), continuous);
  const feed = (name, catalogue, changes = {}) => {
    if (continuous && active.mode !== 'manual') name = name.replace('Source de cuatro cargas completas', 'Source continuo de cargas completas').replace('Source de 24 cajas', 'Source continuo de cajas').replace('Source de ocho cajas azules', 'Source continuo de cajas azules');
    const values = Object.assign({generationMode: 'sequence', catalog: JSON.stringify(catalogue)}, changes);
    const object = add('source', name, undefined, values.loadMode === 'pallet' ? livePalletSource(values, continuous, kind === 'packing') : values); sources.push(object); active.sources.push(object);
    const value = config(object), loads = active.mode === 'manual' ? 0 : value.totalLimit, units = loads * (value.loadMode === 'pallet' ? value.palletColumns * value.palletRows * value.palletLayers : 1);
    active.sourceExpectations.push({id: object.userData.editorId, loads, units}); active.expectedUnits += units; active.expectedLoads += loads; return object;
  };
  const fifo = name => add('source', name, 'queue', {autoGenerate: false, initialCount: 0, capacity: 16});
  const conveyor = (name, variant = 'roller-motor', changes = {}) => add('conveyor', name, variant, Object.assign({length: 2.4}, changes));
  const process = (name, variant, changes = {}) => add('processor', name, variant, changes);
  const buffer = (name, units, changes = {}, loads = units) => {
    if (continuous && active.mode !== 'manual') name = name.replace('16 unidades por salida', 'almacenamiento por salida');
    const object = add('palletQueue', name, undefined, Object.assign({palletCapacity: Math.max(1, Math.ceil(units / 8)), capacity: Math.max(8, units)}, changes)); receivers.push(object); active.receivers.push(object); active.expectedReceiverUnits.push(units); active.expectedReceiverLoads.push(loads); return object;
  };
  function classifier(name, variant, rules, changes = {}) {
    const object = conveyor(name, variant, Object.assign({length: 2.8, routing: 'rules', routingDefault: 'main', routingRules: JSON.stringify(rules)}, changes)); active.routingCoverage.push({id: object.userData.editorId, mode: config(object).routing, fields: rules.map(value => value.field)}); return object;
  }
  function measured(list) {
    scene.updateMatrixWorld(true); root.updateWorldMatrix(true, true); const inverse = new THREE.Matrix4().getInverse(root.matrixWorld), box = new THREE.Box3();
    const visit = object => {
      if (!object.visible || object.userData.editorHelper || object.userData.editorRuntimeHelper || object.userData.industrialSensorVolume) return;
      if (object.geometry) { if (!object.geometry.boundingBox) object.geometry.computeBoundingBox(); if (object.geometry.boundingBox) box.union(object.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld))); }
      object.children.forEach(visit);
    }; list.forEach(visit); return box;
  }
  function finish(controller) {
    active.continuous = continuous && active.mode !== 'manual';
    if (active.continuous) active.description = active.title + '. Alimentación continua con trazabilidad de cargas y atributos. Cuatro estibas se distribuyen por dimensiones reales, con hasta cinco niveles. El despacho de estibas completas libera capacidad; los contadores de entrada, almacenado y salida permiten seguir la producción.';
    active.controller = controller; patch(controller, {withPanel: true}); controllers.push(controller);
    controller.traverse(node => { const values = document.getBehaviors(node); if (values.some(value => value.type === 'control' && value.targetId === controller.userData.editorId)) document.setBehaviors(node, values.map(value => value.type === 'control' ? Object.assign({}, value, {scope: 'line'}) : value)); });
    active.source = active.sources[0]; active.receiver = active.receivers[0];
  }
  function pallets() {
    beginLine('pallet-logistics', 'Pallets · cadenas, giro y elevación', '32 unidades en cuatro pallets de ocho cajas: cadenas, transferencia elevable a 90°, mesa giratoria y elevador. Almacén superior con plataforma y escalera.');
    const source = feed('Pallets · Source de cuatro cargas completas', [product('pallet-carton', 'Caja paletizada', {width: .3, depth: .3, height: .22})], {loadMode: 'pallet', palletColumns: 2, palletRows: 2, palletLayers: 2, totalLimit: 4, capacity: 4, interval: 10, outputInterval: 3});
    const chains = conveyor('Pallets · cadenas de admisión', 'pallet-chain', {length: 3, width: 1.4}), popup = conveyor('Pallets · cadenas elevables a 90°', 'popup-chain', {length: 2.8, width: 1.4, routing: 'branch', branchSide: 'left'});
    const middle = conveyor('Pallets · transferencia entre equipos', 'pallet-chain', {length: 3, width: 1.4}), turn = conveyor('Pallets · mesa giratoria enclavada', 'pallet-turntable', {length: 2.8, width: 1.4, routing: 'branch', branchSide: 'left'});
    const lift = conveyor('Pallets · elevador al almacén superior', 'pallet-elevator', {length: 2.8, width: 1.4, rise: 1.2, verticalSpeed: .6}), upper = conveyor('Pallets · evacuación superior', 'pallet-chain', {length: 3, width: 1.4, supportHeight: 2.2});
    const stock = buffer('Pallets · cuatro posiciones completas en plataforma', 32, {acceptsPallets: true, palletCapacity: 4, capacity: 4, width: 1.4, depth: 1.2, columns: 1, rows: 1, layers: 1}, 4);
    connect(source, chains); connect(chains, popup); connect(popup, middle, 'branch'); connect(middle, turn); connect(turn, lift, 'branch'); connect(lift, upper); connect(upper, stock); active.platformReceivers.push(stock); finish(chains);
  }
  function manualAnnex(variant) {
    const table = variant === 'loading-table';
    beginLine('manual-' + variant, table ? 'Manual · mesa de carga libre' : 'Manual · estación con operario', table ? 'Anexo manual vacío. Pulsa GENERAR en el Source, toma la caja con clic/grip y deposítala o retírala. La mesa no tiene motor y no despacha automáticamente.' : 'Anexo manual vacío. Genera una caja, habilita Operario disponible en Equipo del monitor y solicita Despachar. La estación espera una acción del operario.', 'manual');
    const source = feed('Manual · Source sin generación automática', [product('manual-carton', 'Caja para practicar agarre')], {autoGenerate: false, initialCount: 0, totalLimit: 4, delivery: table ? 'manual' : 'automatic'});
    const station = conveyor(table ? 'Manual · mesa libre sin motor' : 'Manual · estación pendiente del operario', variant, table ? {} : {requiresOperator: true, operatorAvailable: false, loadingMode: 'manual'}), stock = buffer('Manual · almacén de prácticas', 0);
    connect(source, station); connect(station, stock); finish(source);
  }
  try {
    if (kind === 'sorting') {
      beginLine('attribute-sorting', 'Clasificación · ocho perfiles y seis decisiones', '64 unidades: ocho perfiles reproducibles, FIFO e inspección en dos entradas, unión Y y acumulación. Reglas por defecto, calidad, SKU, color, tipo, ancho, alto y fondo; ocho piezas por perfil. La reserva recibe productos futuros sin coincidencia.');
      const catalogue = [product('surface-case', 'Caja con defecto superficial', {quality: 'defective', defect: 'surface', color: '#c26950'}), product('damaged-case', 'Caja dañada', {quality: 'defective', defect: 'damaged', color: '#cc9250'}), product('priority-sku', 'Caja SKU prioritario'), product('blue-case', 'Caja azul', {color: '#3355dd'}), product('crate-case', 'Contenedor rígido', {type: 'crate', width: .32, depth: .36, base: 'rigid', color: '#50a88a'}), product('wide-case', 'Caja ancha', {width: .5}), product('tall-case', 'Caja alta', {height: .5}), product('long-case', 'Caja larga', {depth: .65})];
      const a = feed('A · Source de ocho referencias', catalogue), aFifo = fifo('A · FIFO de recepción'), inspectA = process('A · Inspección y registro'), first = conveyor('A · Alimentación motorizada');
      const merge = conveyor('Y · unión coordinada de dos entradas', 'merge-angle', {length: 3.2, mergeAngle: 45, branchSide: 'left'}), zones = conveyor('Acumulación · seis zonas sin presión', 'roller-zones', {length: 6, zoneLength: 1}), inspection = process('Clasificación · identificación de atributos simulados', undefined, {processTime: .6, setupTime: .2});
      connect(a, aFifo); connect(aFifo, inspectA); connect(inspectA, first); connect(first, merge); connect(merge, zones); connect(zones, inspection);
      const b = feed('B · Source de mezcla inversa reproducible', catalogue.slice().reverse()), bFifo = fifo('B · FIFO de recepción'), inspectB = process('B · Inspección y registro'), curve = conveyor('B · aproximación curva a 45°', 'roller-curve', {layout: 'curveRight', curveAngle: 45, radius: 1.8}), diagonal = conveyor('B · banda de entrega angular', 'belt', {length: 3});
      connect(diagonal, merge, 'output', 'branch', true); connect(curve, diagonal, 'output', 'input', true); connect(inspectB, curve, 'output', 'input', true); connect(bFifo, inspectB, 'output', 'input', true); connect(b, bFifo, 'output', 'input', true);
      const decisions = [['Defecto superficial', 'pusher', [rule('defect', 'surface')], 8], ['Calidad observada', 'distributor', [rule('quality', 'defective')], 8], ['SKU prioritario', 'steer', [rule('sku', 'priority-sku')], 8], ['Color azul', 'distributor', [rule('color', '#3355dd')], 8], ['Tipo contenedor', 'distributor', [rule('productType', 'crate')], 8], ['Dimensiones especiales', 'distributor', [rule('width', .4, 'gt'), rule('height', .4, 'gt'), rule('depth', .5, 'gt')], 24]];
      let previous = inspection;
      decisions.forEach(([name, variant, rules, count], index) => {
        const sorter = classifier((index + 1) + ' · ' + name, variant, rules, {branchSide: 'right'}); connect(previous, sorter);
        const branch = conveyor('Ramal · ' + name, 'belt', {length: 3.6}), stock = buffer('Almacén · ' + name, count); connect(sorter, branch, 'branch'); connect(branch, stock);
        if (index < decisions.length - 1) { const gap = conveyor('Espaciado entre decisiones ' + (index + 1), 'belt', {length: 2.2}); connect(sorter, gap); previous = gap; } else previous = sorter;
      });
      const fallback = buffer('Reserva · productos sin coincidencia', 0); connect(previous, fallback); finish(first); pallets(); manualAnnex('loading-table'); manualAnnex('manual-station');
    } else {
      beginLine('packing-units', 'Empaque · cantidad y reparto 25/75', '32 unidades: 24 pasan por Combiner de dos y ocho llegan individualmente por una segunda entrada Y. La regla units ≥ 2 deriva los lotes a Separator; sus unidades salen 18/6 con reparto lateral del 25 %. Las ocho individuales van a otro almacén. La L es una transferencia rectangular de 1 × 1 m.');
      const a = feed('Empaque · Source de 24 cajas', [product('packing-green', 'Caja de empaque verde', {color: '#50a88a'}), product('packing-orange', 'Caja de empaque naranja', {color: '#cc9250'})], {totalLimit: 24}), queue = fifo('Empaque · FIFO de preparación'), packing = process('Empaque · setup y ciclo'), combine = process('Combiner · dos unidades trazables', 'combiner', {combineCount: 2});
      const approach = conveyor('L rectangular · recta larga de aproximación', 'roller-motor', {length: 4.5}), corner = conveyor('L rectangular · transferencia real a 90°', 'popup-belt', {length: 1, width: 1, routing: 'branch', branchSide: 'left'}), outgoing = conveyor('L rectangular · recta perpendicular', 'roller-motor', {length: 4.5});
      const merge = conveyor('Y · combinar flujo en lotes e individual', 'merge-angle', {length: 3.2, mergeAngle: 45, branchSide: 'left'}), byUnits = classifier('Cantidad · separar carga compuesta de individual', 'distributor', [rule('units', 2, 'gte')], {branchSide: 'left'});
      connect(a, queue); connect(queue, packing); connect(packing, combine); connect(combine, approach); connect(approach, corner); connect(corner, outgoing, 'branch'); connect(outgoing, merge); connect(merge, byUnits);
      const b = feed('Individuales · Source de ocho cajas azules', [product('packing-single', 'Caja individual azul', {color: '#3355dd'})], {totalLimit: 8, interval: 3}), bQueue = fifo('Individuales · FIFO'), bCurve = conveyor('Individuales · curva de aproximación a la Y', 'roller-curve', {layout: 'curveRight', curveAngle: 45, radius: 1.8}), bFeed = conveyor('Individuales · banda de entrega', 'belt', {length: 2.8});
      connect(bFeed, merge, 'output', 'branch', true); connect(bCurve, bFeed, 'output', 'input', true); connect(bQueue, bCurve, 'output', 'input', true); connect(b, bQueue, 'output', 'input', true);
      const singles = conveyor('Individuales · salida sin combinación', 'belt'), singleStock = buffer('Individuales · ocho unidades', 8); connect(byUnits, singles); connect(singles, singleStock);
      const batchFeed = conveyor('Lotes · alimentación del Separator', 'belt'), split = process('Separator · recuperar las dos unidades de origen', 'separator', {splitCount: 2, outputCapacity: 2}), percentage = conveyor('Reparto · 25 % lateral / 75 % recto', 'pusher', {length: 2.8, routing: 'percentage', branchPercentage: 25, branchSide: 'left'});
      active.routingCoverage.push({id: percentage.userData.editorId, mode: 'percentage', fields: []}); connect(byUnits, batchFeed, 'branch'); connect(batchFeed, split); connect(split, percentage);
      const main = conveyor('Reparto · evacuación del 75 %', 'belt'), mainStock = buffer('Reparto · 18 unidades de salida recta', 18, {palletCapacity: 3, capacity: 24}), side = conveyor('Reparto · evacuación del 25 %', 'belt'), sideStock = buffer('Reparto · seis unidades de salida lateral', 6);
      connect(percentage, main); connect(main, mainStock); connect(percentage, side, 'branch'); connect(side, sideStock); finish(approach);

      beginLine('multilevel-mixed', 'Multitipo · curvas, cotas y alternancia', '32 unidades de caja, contenedor, bidón y botella sobre bases planas o rígidas. Estación automática, curvas continua/modular, elevador y cuatro transiciones vuelven a la altura inicial. Rodillos libres con impulso real, giro de rodillos y alternancia 16/16.');
      const catalogue = [product('mixed-box', 'Caja pequeña', {width: .24, depth: .28, height: .22}), product('mixed-crate', 'Contenedor rígido', {type: 'crate', width: .32, depth: .36, height: .24, base: 'rigid', color: '#50a88a'}), product('mixed-drum', 'Bidón de base plana', {type: 'drum', width: .28, depth: .28, height: .34, base: 'rigid', color: '#d2a951'}), product('mixed-bottle', 'Botella de base rígida', {type: 'bottle', width: .2, depth: .2, height: .3, base: 'rigid', color: '#557bb5'})];
      const mixed = feed('Multitipo · Source de cuatro formatos', catalogue), load = conveyor('Multitipo · estación automática', 'automatic-station', {loadingMode: 'automatic'}), curve = conveyor('Multitipo · curva de banda continua', 'belt-curve', {radius: 1.8}), zones = conveyor('Multitipo · cuatro zonas de banda', 'belt-zones', {length: 4, zoneLength: 1});
      const lift = conveyor('Multitipo · elevador de cajas y recipientes', 'box-elevator', {rise: 1.2, verticalSpeed: .6}), upper = conveyor('Multitipo · rodillos superiores', 'roller-motor', {length: 2.4, supportHeight: 2.2});
      const cleats = conveyor('Multitipo · ascenso con tacos +0,6 m', 'cleated-incline', {length: 4, rise: .6, supportHeight: 2.2, gradeProfile: 'smooth'}), modular = conveyor('Multitipo · descenso modular −0,8 m', 'modular-incline', {length: 4, rise: -.8, supportHeight: 2.8, gradeProfile: 'smooth'}), descent = conveyor('Multitipo · descenso continuo −0,6 m', 'belt-incline', {length: 4, rise: -.6, supportHeight: 2, gradeProfile: 'smooth'}), gravity = conveyor('Multitipo · rodillos libres −0,4 m', 'roller-gravity', {length: 4, rise: -.4, supportHeight: 1.4, gradeProfile: 'smooth', rollingResistance: .005});
      const modularCurve = conveyor('Multitipo · curva modular a nivel de piso', 'modular-curve', {radius: 1.8}), turn = conveyor('Multitipo · giro de rodillos a 90°', 'roller-turntable', {length: 2.4, routing: 'branch', branchSide: 'left'}), evacuation = conveyor('Multitipo · evacuación del giro', 'belt'), alternate = conveyor('Multitipo · alternancia de salidas', 'steer', {length: 2.8, routing: 'alternate', branchSide: 'right'});
      active.routingCoverage.push({id: alternate.userData.editorId, mode: 'alternate', fields: []});
      const mainStock2 = buffer('Multitipo · 16 unidades por salida recta', 16), side2 = conveyor('Multitipo · salida lateral', 'belt'), sideStock2 = buffer('Multitipo · 16 unidades por salida lateral', 16);
      const chain = [mixed, load, curve, zones, lift, upper, cleats, modular, descent, gravity, modularCurve, turn]; chain.slice(1).forEach((object, index) => connect(chain[index], object)); connect(turn, evacuation, 'branch'); connect(evacuation, alternate); connect(alternate, mainStock2); connect(alternate, side2, 'branch'); connect(side2, sideStock2); finish(load);
      pallets(); manualAnnex('loading-table'); manualAnnex('manual-station');
    }
    // Separate whole networks into wide aisles without scaling their interfaces.
    let cursor = 0;
    lines.forEach(line => { const before = measured(line.objects), center = before.getCenter(new THREE.Vector3()), extent = before.getSize(new THREE.Vector3()), shift = new THREE.Vector3(-center.x, 0, cursor - before.max.z); line.objects.forEach(object => document.setTransform(object, {position: object.position.clone().add(shift).toArray()})); cursor -= extent.z + 9; });
    const before = measured(objects), center = before.getCenter(new THREE.Vector3()); objects.forEach(object => document.setTransform(object, {position: object.position.clone().sub(new THREE.Vector3(center.x, 0, center.z)).toArray()}));
    const boundsOf = list => { const box = measured(list); return {min: box.min.toArray(), max: box.max.toArray(), width: box.max.x - box.min.x, depth: box.max.z - box.min.z}; };
    lines.forEach(line => { line.bounds = boundsOf(line.objects); line.center = [(line.bounds.min[0] + line.bounds.max[0]) / 2, (line.bounds.min[2] + line.bounds.max[2]) / 2]; line.memberIds = line.objects.map(object => object.userData.editorId); line.sourceIds = line.sources.map(object => object.userData.editorId); line.bufferIds = line.receivers.map(object => object.userData.editorId); line.catalogueCoverage = Array.from(new Set(line.objects.map(config).filter(value => value.type === 'conveyor').map(value => value.equipmentId))); });
    const automatic = lines.filter(line => line.mode === 'automatic'), expectedUnits = automatic.reduce((sum, line) => sum + line.expectedUnits, 0), expectedLoads = automatic.reduce((sum, line) => sum + line.expectedReceiverLoads.reduce((total, count) => total + count, 0), 0);
    const coverage = {variants: Array.from(new Set(lines.flatMap(line => line.catalogueCoverage))).sort(), fields: Array.from(new Set(lines.flatMap(line => line.routingCoverage.flatMap(value => value.fields)))).sort(), modes: Array.from(new Set(lines.flatMap(line => line.routingCoverage.map(value => value.mode)))).sort(), productTypes: Array.from(new Set(sources.flatMap(object => JSON.parse(config(object).catalog).map(value => value.type)))).sort()};
    if (own) document.commit();
    return {kind, title, description, continuous, objects, controllers, sources, receivers, lines, cells: lines, groups: lines, links, bounds: boundsOf(objects), coverage, memberIds: objects.map(object => object.userData.editorId), sourceIds: sources.map(object => object.userData.editorId), receiverIds: receivers.map(object => object.userData.editorId), expectedReceiverUnits: lines.flatMap(line => line.expectedReceiverUnits), expectedReceiverLoads: lines.flatMap(line => line.expectedReceiverLoads), expectedUnits, expectedLoads: continuous ? 0 : expectedLoads, sensorPolicy: 'Presencia en transferencias y decisiones; ocupación propia en zonas. Calidad y color son atributos simulados.'};
  } catch (error) { if (own) document.cancel(); throw error; }
  finally { assembly.clear(); }
}
