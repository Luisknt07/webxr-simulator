import * as THREE from 'three';
import ConveyorAssembly from '../functions/bandas/runtime/ConveyorAssembly.js';
import {buildConveyorExample} from '../functions/bandas/runtime/ConveyorExamples.js';
import {liveMachine, livePalletSource} from './IndustrialContinuousExamples.js';

const CELL_DEFINITIONS = [
  ['transfer-l', '01 · L rectangular — transferencia a 90°', 'automatic', [-18, 20]],
  ['sorting', '02 · Inspección y clasificación automática', 'automatic', [18, 20]],
  ['merge', '03 · Unión en Y y acumulación', 'automatic', [-18, 0]],
  ['elevator', '04 · Transporte entre niveles', 'automatic', [18, 0]],
  ['pallets', '05 · Pallets — transferencia y giro', 'automatic', [-18, -20]],
  ['assembly', '06 · Combiner y Separator', 'automatic', [18, -20]],
  ['rectangle', '07 · Circuito rectangular', 'automatic', [-18, -40]],
  ['gravity', '08 · Preparación y rodillos por gravedad', 'automatic', [18, -40]],
  ['manual-l', '09 · Línea en L — curva de rodillos', 'automatic', [-18, -60]]
];
// Plain transport needs no duplicated entry/exit detector at every joint.
// Zone conveyors already contain their own per-zone occupancy sensors.
const DETECTED_MECHANISMS = new Set(['loading', 'liftTransfer', 'turntable', 'pusher', 'steer', 'merge', 'distributor', 'elevator']);

/** Complete, editable authoring graphs. Every connection goes through the same
 * physical port validation and saved configuration as the editor's magnet. */
export function buildIndustrialLabLines(document, roomId, options = {}) {
  const continuous = options.continuous === true;
  const root = document.getRoot(roomId), scene = options.scene || root;
  const assembly = new ConveyorAssembly({document, roomId, root, ctx: {scene}, hooks: {renderScene: scene}, assemblyMessage() {}});
  const cells = [], objects = [], own = !document.transaction;
  if (own) document.begin();
  const patch = (object, values) => document.setBehaviors(object, document.getBehaviors(object).map(config =>
    ['conveyor', 'source', 'processor', 'palletQueue'].includes(config.type) ? Object.assign({}, config, values) : config));
  let cell;
  function add(kind, name, variant, values = {}) {
    const object = document.addPrefab(roomId, kind, variant);
    document.setProperty(object, 'name', name);
    const initial = document.getBehaviors(object).find(config => config.type === kind);
    const common = kind === 'conveyor' ? {length: 2.2, speed: .55, withSensors: DETECTED_MECHANISMS.has(initial.mechanism), withPanel: false, autoSpawn: false, powered: true, running: true} :
      kind === 'source' ? {withPanel: false, capacity: 12, running: true, autoGenerate: false, delivery: 'manual', initialCount: 0, totalLimit: 16, interval: 2, outputInterval: 1.2} :
      kind === 'processor' ? {withPanel: false, powered: true, running: true, processTime: 1.8, setupTime: 1, setupPolicy: 'productChange', length: 2.2, capacity: 8, outputCapacity: 8, delivery: 'automatic', requiresOperator: false} :
      {withPanel: false, running: true, capacity: 16, columns: 2, rows: 2, layers: 1, palletCapacity: 4, delivery: 'manual'};
    patch(object, liveMachine(Object.assign({}, initial, common, values), continuous, objects.filter(value => document.getBehaviors(value).some(config => config.type === 'palletQueue')).length));
    document.setTransform(object, {position: [cell.center[0] - 8, 1, cell.center[1]]});
    cell.objects.push(object); objects.push(object); return object;
  }
  function connect(from, to, sourcePort = 'output', targetPort = 'input', moveFrom = false) {
    const fixed = moveFrom ? to : from, moving = moveFrom ? from : to;
    const fixedPort = moveFrom ? targetPort : sourcePort, movingPort = moveFrom ? sourcePort : targetPort;
    if (!assembly.align(fixed, fixedPort, moving, movingPort)) throw new Error('No se pueden alinear ' + from.name + ' y ' + to.name);
    const assessment = assembly.assessConnection(from, sourcePort, to, targetPort);
    if (!assessment.ready || !assembly.connect(assembly.pair(to, targetPort, from, sourcePort))) throw new Error('Conexión de ejemplo no válida: ' + from.name + ' → ' + to.name + '. ' + assessment.reasons.map(reason => reason.message).join(' '));
    cell.links.push({source: from.userData.editorId, sourcePort, target: to.userData.editorId, targetPort});
  }
  const source = (name, values = {}) => {
    let configured = Object.assign({autoGenerate: true, delivery: 'automatic', initialCount: 1}, continuous ? {width: .45, depth: .35, height: .3, mass: 4} : {}, values);
    if (continuous && configured.catalog) configured.catalog = JSON.stringify(JSON.parse(configured.catalog).map(value => Object.assign({}, value, {width: .45, depth: .35, height: .3, mass: 4})));
    if (continuous && configured.loadMode === 'pallet') {
      configured = livePalletSource(Object.assign({}, configured, {width: .5, depth: .3, height: .23, mass: 2}), true);
      name = name.replace('pallets completos de cuatro cajas', 'pallets completos multinivel');
    }
    return add('source', name, undefined, configured);
  };
  const queue = (name, values = {}) => add('source', name, 'queue', values);
  const storage = (name, values = {}) => add('palletQueue', continuous ? name.replace('dos estibas', 'cuatro estibas') : name, undefined, values);
  const conveyor = (name, variant = 'roller-motor', values = {}) => add('conveyor', name, variant, values);
  const processor = (name, variant, values = {}) => add('processor', name, variant, values);
  function finish() {
    cell.continuous = continuous;
    if (continuous) cell.description = 'OPERACIÓN CONTINUA. ' + cell.title + '. Source repone las cargas automáticamente; el almacén aprovecha la huella de las estibas en hasta cinco niveles. Al llenarse, una estiba completa se despacha para liberar capacidad. El panel y monitor gobiernan únicamente esta línea.';
    cell.controller = cell.controller || cell.objects.find(object => document.getBehaviors(object).some(config => config.type === 'conveyor')) || cell.objects.find(object => document.getBehaviors(object).some(config => config.type === 'processor'));
    patch(cell.controller, {withPanel: true});
    cell.controller.traverse(node => {
      const configs = document.getBehaviors(node);
      if (configs.some(config => config.type === 'control' && config.targetId === cell.controller.userData.editorId))
        document.setBehaviors(node, configs.map(config => config.type === 'control' ? Object.assign({}, config, {scope: 'line'}) : config));
    });
    scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3();
    const extendVisible = object => {
      if (!object.visible) return;
      if (object.geometry) {
        if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
        if (object.geometry.boundingBox) bounds.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
      }
      object.children.forEach(extendVisible);
    };
    cell.objects.forEach(extendVisible);
    const center = bounds.getCenter(new THREE.Vector3()), shift = new THREE.Vector3(cell.center[0] - center.x, 0, cell.center[1] - center.z);
    cell.objects.forEach(object => document.setTransform(object, {position: object.position.clone().add(shift).toArray()}));
    cell.first = cell.objects[0]; cell.last = cell.receiver || cell.objects[cell.objects.length - 1];
    cell.sources = cell.sources || [cell.source]; cell.receivers = cell.receivers || [cell.receiver];
    cell.sourceIds = cell.sources.map(object => object.userData.editorId);
    cell.bufferIds = cell.receivers.map(object => object.userData.editorId);
    cell.memberIds = cell.objects.filter(object => document.getBehaviors(object).some(config => ['source', 'conveyor', 'processor', 'palletQueue'].includes(config.type))).map(object => object.userData.editorId);
    cell.bounds = {width: bounds.max.x - bounds.min.x, depth: bounds.max.z - bounds.min.z};
    if (cell.bounds.width > 28 || cell.bounds.depth > 15) throw new Error('La celda ' + cell.id + ' excede su zona de trabajo.');
    cells.push(cell);
  }
  try {
    for (const [id, title, mode, center] of CELL_DEFINITIONS) {
      if (options.cellIds && !options.cellIds.includes(id)) continue;
      cell = {id, title, mode, center, objects: [], links: [], manualActions: []};
      if (id === 'manual-l') {
        const supply = source('Source · alimentación automática de la L');
        const load = conveyor('Puesto de carga · ciclo automático', 'manual-station', {loadingMode: 'automatic', requiresOperator: false, operatorAvailable: true, operationTime: 1});
        const curve = conveyor('Curva de rodillos a 90°', 'roller-curve');
        const end = conveyor('Salida de la curva');
        const stock = storage('Buffer de salida · cuatro estibas');
        connect(supply, load); connect(load, curve); connect(curve, end); connect(end, stock);
        cell.description = 'Automática. Source alimenta el puesto temporizado; cada caja recorre la curva real de 90° y ocupa una de cuatro estibas. El panel gobierna toda la línea. Puedes pausar la alimentación y retirar o depositar cargas manualmente con ratón o mandos VR.';
        cell.source = supply; cell.receiver = stock; cell.manualInlet = load;
      } else if (id === 'sorting') {
        const supply = source('Alimentación · lotes verdes y rojos', {generationMode: 'sequence', catalog: JSON.stringify([
          {id: 'good', name: 'Caja conforme', type: 'box', width: .3, height: .25, depth: .3, color: '#63b8a0', quality: 'good', defect: 'none'},
          {id: 'reject', name: 'Caja con defecto', type: 'box', width: .3, height: .25, depth: .3, color: '#d7564a', quality: 'defective', defect: 'damaged'}])});
        const fifo = queue('FIFO · pulmón de entrada', {delivery: 'automatic'}), input = conveyor('Banda de alimentación', 'belt');
        const inspection = processor('Inspección · setup 1 s / proceso 1,8 s');
        const sorter = conveyor('Clasificador · desvío de defectuosos', 'distributor', {routing: 'rules', routingDefault: 'main', routingRules: JSON.stringify([{field: 'quality', operator: 'eq', value: 'defective', route: 'branch'}])});
        const good = storage('Salida A · dos estibas conformes', {capacity: 8, palletCapacity: 2}), reject = storage('Salida B · dos estibas rechazadas', {capacity: 8, palletCapacity: 2});
        connect(supply, fifo); connect(fifo, input); connect(input, inspection); connect(inspection, sorter); connect(sorter, good); connect(sorter, reject, 'branch');
        cell.description = 'Automática. Source genera una secuencia finita de cajas conformes y defectuosas. FIFO alimenta la inspección; la regla de calidad deriva defectuosos a B y conformes a A. Los sensores detectan presencia; la calidad es un atributo simulado del producto.';
        cell.source = supply; cell.receivers = [good, reject]; cell.receiver = good;
      } else if (id === 'merge') {
        const a = source('Entrada A · cajas de cartón', {totalLimit: 8, color: '#ba8f54'});
        const first = conveyor('Entrada A · banda', 'belt'), merge = conveyor('Unión en Y · reserva del cruce', 'merge-angle', {length: 3.2});
        const b = source('Entrada B · cajas azules', {totalLimit: 8, color: '#468fbd'}), second = conveyor('Entrada B · banda', 'belt');
        const accumulation = conveyor('Acumulación · tres zonas', 'roller-zones', {length: 3, zoneLength: 1});
        const output = storage('Buffer · cuatro estibas de ambas entradas');
        connect(a, first); connect(first, merge); connect(merge, accumulation); connect(accumulation, output);
        connect(second, merge, 'output', 'branch', true); connect(b, second, 'output', 'input', true);
        cell.description = 'Automática. Dos Source de ocho cajas comparten una unión angular de 45°. La zona común se reserva antes de entregar cada carga. La acumulación ajusta sus zonas si se bloquea la salida; ambos colores se almacenan en cuatro estibas.';
        cell.sources = [a, b]; cell.source = a; cell.receiver = output;
      } else if (id === 'elevator') {
        const supply = source('Source · elevador de cajas', {interval: 4});
        const input = conveyor('Recepción inferior'), lift = conveyor('Elevador · subir, entregar y retornar', 'box-elevator', {length: 2.4});
        const upper = conveyor('Salida superior · cota 3 m', 'belt', {supportHeight: 3});
        const output = storage('Buffer superior · cuatro estibas');
        connect(supply, input); connect(input, lift); connect(lift, upper); connect(upper, output);
        cell.description = 'Automática. El elevador recibe abajo, confirma posición, sube dos metros, entrega al nivel superior y regresa. Dieciséis cargas llegan físicamente a cuatro estibas superiores. El panel único controla alimentación, elevador y descarga.';
        cell.source = supply; cell.receiver = output;
      } else if (id === 'pallets') {
        const supply = source('Source · pallets completos de cuatro cajas', {loadMode: 'pallet', palletColumns: 2, palletRows: 2, palletLayers: 1, width: .3, depth: .3, height: .22, totalLimit: 4, interval: 9, capacity: 4});
        const chains = conveyor('Cadenas · admisión de pallets', 'pallet-chain', {length: 2.2, width: 1.4});
        const transfer = conveyor('Transferencia de cadenas a 90°', 'popup-chain', {length: 2.8, width: 1.4, routing: 'branch'});
        const middle = conveyor('Transporte de pallets', 'pallet-chain', {length: 2.2, width: 1.4});
        const turn = conveyor('Mesa giratoria · giro enclavado', 'pallet-turntable', {length: 2.8, routing: 'branch'});
        const output = storage('Buffer · cuatro pallets completos', {acceptsPallets: true, width: 1.4, depth: 1.2, columns: 1, rows: 1, layers: 1, capacity: 4});
        connect(supply, chains); connect(chains, transfer); connect(transfer, middle, 'branch'); connect(middle, turn); connect(turn, output, 'branch');
        cell.description = 'Automática. Cuatro pallets completos circulan sobre pistas compatibles con patines. La transferencia eleva cadenas antes de derivar; la mesa gira y espera al receptor. Cada pallet conserva sus cuatro cajas visibles en una posición independiente del buffer.';
        cell.source = supply; cell.receiver = output;
      } else if (id === 'assembly') {
        const supply = source('Source · unidades para combinación', {interval: 3});
        const combine = processor('Combiner · agrupar dos unidades', 'combiner', {combineCount: 2});
        const divide = processor('Separator · recuperar las unidades', 'separator', {splitCount: 2});
        const output = storage('Buffer · cuatro estibas de productos separados');
        connect(supply, combine); connect(combine, divide); connect(divide, output);
        cell.description = 'Automática. El Combiner espera dos cargas, realiza setup y forma un lote conservando las identidades. El Separator procesa ese lote y devuelve sus dos unidades. La estiba almacena los resultados y muestra su capacidad y ocupación.';
        cell.source = supply; cell.receiver = output;
      } else if (id === 'rectangle') {
        const supply = source('Source · entrada al circuito rectangular', continuous ? {outputInterval: 6} : {});
        const inlet = conveyor('Unión de entrada al circuito', 'merge-angle', {length: 2.2, mergeAngle: 90, branchSide: 'right'});
        let previous = inlet, exit;
        for (let side = 0; side < 4; side++) {
          const corner = conveyor('Circuito · curva ' + (side + 1), 'roller-curve', {radius: 1.1});
          connect(previous, corner);
          if (side === 3) { previous = corner; break; }
          const straight = side === 1 ? conveyor('Desvío · descarga del circuito', 'distributor', {length: 2.2, branchSide: 'right', routing: continuous ? 'percentage' : 'branch', branchPercentage: continuous ? 90 : 50}) : conveyor('Circuito · recta ' + (side + 2));
          if (side === 1) exit = straight;
          connect(corner, straight); previous = straight;
        }
        if (!assembly.connect(assembly.pair(inlet, 'input', previous, 'output'))) throw new Error('No coincide el cierre físico del circuito.');
        cell.links.push({source: previous.userData.editorId, sourcePort: 'output', target: inlet.userData.editorId, targetPort: 'input'});
        connect(supply, inlet, 'output', 'branch', true);
        const output = storage('Buffer rectangular · cuatro estibas'); connect(exit, output, 'branch');
        cell.description = 'Automática. Source entra por una unión lateral del circuito rectangular; el distribuidor descarga las cajas a cuatro estibas. Las cuatro rectas y curvas permanecen conectadas: cambia la ruta del distribuidor para ensayar retorno y contrapresión. No aparecen cajas sin origen.';
        cell.receiver = output; cell.source = supply;
      } else if (id === 'gravity') {
        const supply = source('Source · preparación automática');
        const feed = conveyor('Alimentador · impulso al tramo libre', 'belt-incline', {length: 1.4, rise: .2, gradeProfile: 'smooth'});
        const gravity = conveyor('Rodillos por gravedad · pendiente con transiciones', 'roller-gravity', {length: 4, rise: -.2, supportHeight: 1.2, gradeProfile: 'smooth', rollingResistance: .005});
        const unload = storage('Buffer inferior · cuatro estibas');
        connect(supply, feed); connect(feed, gravity); connect(gravity, unload);
        cell.description = 'Automática. El alimentador entrega impulso a los rodillos libres; una pendiente con extremos horizontales conecta físicamente ambos equipos. Las cajas descienden por gravedad hasta cuatro estibas, sin motor oculto en los rodillos. Las cargas también se pueden retirar manualmente.';
        cell.source = supply; cell.receiver = unload; cell.manualInlet = gravity;
      } else if (id === 'transfer-l') {
        const supply = source('Source · alimentación de la L rectangular');
        const input = conveyor('Recta larga · aproximación a transferencia', 'roller-motor', {length: 4.5});
        const transfer = conveyor('Transferencia a 90° · correas elevables entre rodillos', 'popup-belt', {length: 1, width: 1, routing: 'branch', branchSide: 'left'});
        const output = conveyor('Recta perpendicular · evacuación de transferencia', 'roller-motor', {length: 4.5});
        const stock = storage('Buffer de L rectangular · cuatro estibas');
        connect(supply, input); connect(input, transfer); connect(transfer, output, 'branch'); connect(output, stock);
        cell.description = 'Automática. Dos rectas largas forman una L rectangular mediante correas elevables a 90°, sin rodillos cruzados ni curva. La detección posiciona la caja, confirma la salida libre y eleva las correas para transferirla perpendicularmente. Un panel y su monitor controlan toda la línea hasta cuatro estibas.';
        cell.source = supply; cell.receiver = stock;
      }
      finish();
    }
    if (own) document.commit();
    return {cells, objects};
  } catch (error) { if (own) document.cancel(); throw error; }
  finally { assembly.clear(); }
}
