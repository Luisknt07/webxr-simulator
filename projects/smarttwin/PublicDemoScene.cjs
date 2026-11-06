'use strict';

/** A bounded, authored public cell. The private transfer lesson is the base,
 * never its output asset: its identities, vehicle aisle and pallet custody
 * remain intact. Additional equipment uses the same production components. */
function buildPublicDemoScene({THREE, schema, document, roomId, scene, base, ConveyorAssembly}) {
  if (!base || !base.robot || !base.pickup || !base.vehicle) throw new Error('La demostración necesita su célula de transferencia nativa.');
  const additions = [], machineTypes = ['source', 'robot', 'conveyor', 'palletQueue', 'product'];
  const config = object => document.getBehaviors(object).find(value => machineTypes.includes(value.type));
  const patch = (object, changes) => document.setBehaviors(object, document.getBehaviors(object).map(value => machineTypes.includes(value.type) ? Object.assign({}, value, changes) : value));
  const add = (type, name, variant, values, position) => {
    const object = document.addPrefab(roomId, type, variant); patch(object, values);
    document.setProperty(object, 'name', name); document.setTransform(object, {position}); additions.push(object); return object;
  };
  const part = (name, color, position, scale, behaviors = []) => {
    const object = document.addPrimitive(roomId, 'box', color);
    document.setProperty(object, 'name', name); document.setTransform(object, {position, scale}); document.setBehaviors(object, behaviors); additions.push(object); return object;
  };

  // An independent, low-payload carton cell. Four cartons terminate in its
  // own stock; this arm never lifts one of the 33 kg completed pallets.
  const source = add('source', 'DEMOSTRACIÓN · cuatro cajas de inspección', undefined, {
    running: true, autoGenerate: true, initialCount: 1, totalLimit: 4, capacity: 2, interval: 6,
    delivery: 'manual', withPanel: false, loadMode: 'individual', generationMode: 'sequence',
    catalog: JSON.stringify([{id: 'demo-inspection-carton', name: 'Caja de inspección · 2 kg', type: 'box', variant: 'box-small', width: .3, depth: .3, height: .22, mass: 2, base: 'flat', color: '#5c9eac', quality: 'good', defect: 'none'}])
  }, [-5.8, 1, -4.7]);
  const robot = add('robot', 'DEMOSTRACIÓN · robot de inspección y transferencia', 'articulated-general', {
    running: true, powered: true, mode: 'automatic', operation: 'pick-place', withPanel: true,
    sourceId: source.userData.editorId, reach: 2.2, payloadKg: 12, toolMassKg: 1.5,
    tool: 'vacuum', acceptedTypes: 'boxes', requireKnownMass: true, maxProductWidth: .45, maxProductDepth: .45, maxProductHeight: .4,
    baseHeight: .45, speed: .8, cycleTime: 4, processTime: 0, setupTime: .4, approachHeight: .18, wear: .25
  }, [-4.5, 0, -6]);
  patch(source, {outputId: robot.userData.editorId});
  const robotConfig = config(robot), ready = schema.robotKinematics.inverse(robotConfig, {x: .35, y: robotConfig.baseHeight + .65, z: 0});
  if (!ready.reached) throw new Error('La postura del segundo robot no es alcanzable.');
  patch(robot, {jointLimitsJson: JSON.stringify(schema.robots.getJointDefinitions(robotConfig).map((joint, index) => ({id: joint.id, min: joint.min, max: joint.max, home: ready.joints[index]})))});
  const belt = add('conveyor', 'DEMOSTRACIÓN · rodillos para cajas inspeccionadas', 'roller-motor', {
    powered: true, running: true, autoSpawn: false, withPanel: false, withSensors: false,
    length: 2.4, width: .7, supportHeight: 1, speed: .35, maxPackages: 2, maxLoad: 25, clearance: .6
  }, [-2.85, 1, -7.05]);
  patch(robot, {outputId: belt.userData.editorId});
  const receiver = add('palletQueue', 'DEMOSTRACIÓN · cuatro cajas verificadas', undefined, {
    running: true, withPanel: false, acceptsPallets: false, palletCapacity: 1, capacity: 4,
    columns: 2, rows: 2, layers: 1, autoRelease: false, delivery: 'manual', layoutMode: 'grid'
  }, [0, 1, 0]);
  const assembly = new ConveyorAssembly({document, roomId, root: document.getRoot(roomId), ctx: {scene}, hooks: {renderScene: scene}, assemblyMessage() {}});
  try {
    if (!assembly.align(belt, 'output', receiver, 'input') || !assembly.connect(assembly.pair(receiver, 'input', belt, 'output'))) throw new Error('No se pudo conectar el rodillo secundario con su recepción.');
  } finally {assembly.clear();}

  // A real native rack with addressed, occupied and free positions. It stands
  // beyond the vehicle's original delivery/turning corridor, facing its aisle.
  const rack = add('palletQueue', 'DEMOSTRACIÓN · estantería selectiva A01 / R01', 'selective', Object.assign({}, schema.warehouseRacks.defaults('selective'), {
    running: true, withPanel: false, rackBays: 1, rackLevels: 2, rackColumns: 2, rackBayWidth: 3,
    rackBaseHeight: .3, rackLevelHeight: 1.4, rackSlotDepth: 1.1, rackAisleCode: 'A01', rackRowCode: 'R01', rackAssignments: '[]',
    acceptsPallets: true, delivery: 'manual', autoRelease: false
  }), [8, 1, -6]);
  const rackConfig = config(rack), rackLayout = schema.warehouseRacks.layout(rackConfig), cell = rackLayout.cells[0];
  const stock = add('product', 'DEMO-STOCK-01 · pallet de reserva · 4 cajas / 33 kg', 'pallet-loaded', {
    sourceId: rack.userData.editorId, sku: 'DEMO-STOCK-01', productType: 'pallet', loadMode: 'pallet', units: 4, mass: 33,
    width: 1.2, depth: .8, height: .72, palletType: 'euro-1200x800', palletMaterial: 'wood', contents: 'boxes', color: '#b69a6e'
  }, [0, 0, 0]);
  stock.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(stock), center = bounds.getCenter(new THREE.Vector3());
  document.setTransform(stock, {position: [rack.position.x + cell.position[0] - center.x, rack.position.y + cell.position[1] + .005 - bounds.min.y, rack.position.z + cell.position[2] - center.z]});

  // Two native line scopes, one analytic board. Each screen reads its own
  // connected material-flow graph; no invented link joins separate cells.
  const monitor = (name, target, x) => part(name, '#18303a', [x, 2.4, -9.65], [3.1, 1.8, .12], [Object.assign(schema.defaultBehavior('lineMonitor'), {targetId: target.userData.editorId, scope: 'line', title: name, refreshHz: 2})]);
  const primaryMonitor = monitor('SMART-TWIN · Paletizado y transporte en vivo', base.robot, .25);
  const secondaryMonitor = monitor('SMART-TWIN · Inspección de cajas en vivo', robot, 3.65);
  part('DEMOSTRACIÓN · soporte del tablero analítico', '#344b55', [1.95, 1.3, -9.72], [6.7, .14, .18]);
  for (const x of [.25, 3.65]) part('DEMOSTRACIÓN · pedestal del tablero', '#344b55', [x, .66, -9.72], [.12, 1.32, .16]);

  const secondaryLinks = [
    {source: source.userData.editorId, sourcePort: 'output', target: robot.userData.editorId, targetPort: 'input'},
    {source: robot.userData.editorId, sourcePort: 'output', target: belt.userData.editorId, targetPort: 'input'},
    {source: belt.userData.editorId, sourcePort: 'output', target: receiver.userData.editorId, targetPort: 'input'}
  ];
  const studio = document.studio || {};
  document.setStudio({groups: (studio.groups || []).concat({id: 'public-demo-secondary-hall', name: 'Demostración · inspección de cuatro cajas', roomId, members: [source, robot, belt, receiver].map(object => object.userData.editorId)})});
  const guide = base.objects.find(object => /guía de la práctica/.test(object.name));
  if (guide) document.setBehaviors(guide, document.getBehaviors(guide).map(value => value.type === 'info' ? Object.assign({}, value, {
    title: 'SMART-TWIN · Demostración integrada',
    text: 'Dos robots trabajan con cajas individuales. La línea principal forma dos pallets de cuatro cajas; los transportadores los llevan al montacargas. La célula secundaria inspecciona cuatro cajas.\nAcércate al montacargas para conducir y recoger en la salida de rodillos. Las bahías y la estantería A01/R01 admiten pallets completos.\nConsulta los dos monitores para ver el plano, variables y analítica real de cada línea. Lote finito: ocho cajas principales y cuatro de inspección.'
  }) : value));
  base.objects.push(...additions); base.conveyors.push(belt); base.controllers.push(robot); base.sources.push(source); base.receivers.push(receiver, rack); base.links.push(...secondaryLinks);
  return Object.assign(base, {publicDemo: true, secondary: {source, robot, belt, receiver, expectedUnits: 4}, rack, stock, rackLayout, monitors: [primaryMonitor, secondaryMonitor]});
}

module.exports = {buildPublicDemoScene};
