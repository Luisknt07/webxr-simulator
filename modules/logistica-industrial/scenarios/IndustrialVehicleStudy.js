import schema from '../contracts/behaviors.js';
import {buildCediEnvironment} from './IndustrialCediEnvironment.js';
import {applyIndustrialAging} from '../functions/presentacion/runtime/IndustrialAgingPresentation.js';
import {applyIndustrialMessages} from '../functions/presentacion/runtime/IndustrialMessages.js';

/** A finite, manually operated truck practice. Every pallet is an ordinary
 * authored product with real pockets, content and tare; no generator or
 * automatic pickup moves it into the student's forks. Distances are metres. */
export function buildIndustrialVehicleStudy(document, roomId, options = {}) {
  const objects = [], lines = [], stations = [], vehicles = [], products = [], receivers = [], conveyors = [];
  const variants = schema.vehicles.VARIANTS.filter(definition => schema.vehicles.supports(definition.preset).forks);
  const own = !document.transaction; if (own) document.begin();
  const patch = (object, type, values) => document.setBehaviors(object, document.getBehaviors(object).map(value => value.type === type ? Object.assign({}, value, values) : value));
  const add = (type, name, variant, values, position) => {
    const object = document.addPrefab(roomId, type, variant); if (values) patch(object, type, values);
    document.setProperty(object, 'name', name); document.setTransform(object, {position}); objects.push(object); return object;
  };
  const solid = schema.defaultBehavior('collision');
  const part = (name, position, scale, color = '#54666e') => {
    const object = document.addPrimitive(roomId, 'box', color); document.setProperty(object, 'name', name);
    document.setTransform(object, {position, scale}); document.setBehaviors(object, [solid]); objects.push(object); return object;
  };
  const guide = (name, text, position) => {
    const object = document.addPrimitive(roomId, 'box', '#18303a'); document.setProperty(object, 'name', name);
    document.setTransform(object, {position, scale: [1.9, .72, .04]});
    document.setBehaviors(object, [Object.assign(schema.defaultBehavior('info'), {title: name, text, fontSize: .029})]); objects.push(object); return object;
  };
  try {
    for (let index = 0; index < variants.length; index++) {
      const definition = variants[index], x = (index % 3 - 1) * 20, z = 30 - Math.floor(index / 3) * 20;
      const prefix = String(index + 1).padStart(2, '0') + ' · ', values = schema.vehicles.defaults(definition.id), lowLift = values.family === 'pallet-truck';
      const vehicle = add('vehicle', prefix + definition.name, definition.id, {mode: 'manual', powered: true, running: true, parkingBrake: true, paused: false, emergency: false,
        forkSpread: .48, forkLength: values.family === 'telehandler' ? 1.2 : values.forkLength, serial: 'PRACTICA-' + String(index + 1).padStart(2, '0'), waypointsJson: '[]', sourceId: '', outputId: ''}, [x - 4, 0, z - 4]);
      vehicles.push(vehicle);
      const industrial = ['rough-terrain', 'telehandler'].includes(values.family), plastic = ['order-picker', 'turret'].includes(values.family);
      const palletType = industrial || plastic ? 'industrial-1200x1000' : 'euro-1200x800', depth = industrial || plastic ? 1 : .8;
      const emptyVariant = plastic ? 'pallet-plastic' : industrial ? 'pallet-industrial' : 'pallet-euro', tare = plastic ? 12 : industrial ? 20 : 25;
      const loaded = add('product', prefix + '12 cajas · ' + (tare + 48) + ' kg con tara', 'pallet-loaded', {sku: 'practice-load-' + (index + 1), units: 12, mass: tare + 48,
        width: 1.2, depth, height: plastic ? .8 : .76, palletType, palletMaterial: plastic ? 'plastic' : 'wood', contents: 'boxes', loadMode: 'pallet'}, [x - 4, 0, z + .4]);
      const empty = add('product', prefix + 'Pallet vacío · segundo ejercicio', emptyVariant, {sku: 'practice-empty-' + (index + 1)}, [x - 1.1, 0, z + .4]); products.push(loaded, empty);
      const stock = add('palletQueue', prefix + 'Destino a piso · dos pallets completos', undefined, {acceptsPallets: true, palletType, palletMaterial: plastic ? 'plastic' : 'wood', width: 1.2, depth,
        palletCapacity: 2, capacity: 2, columns: 1, rows: 1, layers: 1, withPanel: false, running: true, delivery: 'manual', autoRelease: false}, [x - 4, 1, z + 5.2]); receivers.push(stock);
      patch(vehicle, 'vehicle', {sourceId: loaded.userData.editorId, outputId: stock.userData.editorId});
      const rollerHeight = lowLift ? .5 : index % 2 ? .75 : .65, chainHeight = lowLift ? .65 : index % 2 ? 1 : .9;
      const roller = add('conveyor', prefix + 'Rodillos de intercambio · ' + rollerHeight.toFixed(2) + ' m', 'roller-motor', {axis: 'z', length: 2.2, width: 1.4, supportHeight: rollerHeight,
        maxLoad: 600, clearance: 3, rollerPitch: .12, powered: true, running: false, autoSpawn: false, withSensors: false, withPanel: false, outputId: '', maxPackages: 1}, [x + 3.8, rollerHeight, z - 1]);
      const chains = add('conveyor', prefix + 'Cadenas de intercambio · ' + chainHeight.toFixed(2) + ' m', 'pallet-chain', {axis: 'z', length: 2.2, width: 1.4, supportHeight: chainHeight,
        maxLoad: 600, clearance: 3, powered: true, running: false, autoSpawn: false, withSensors: true, withPanel: true, outputId: '', maxPackages: 1}, [x + 3.8, chainHeight, z + 3.2]);
      const rules = ['powered', 'running', 'paused', 'emergency'].flatMap(variable => [false, true].map(value => ({sourceId: chains.userData.editorId, variable, operator: 'eq', value,
        targetId: roller.userData.editorId, targetVariable: variable, set: value, edge: 'rising'})));
      document.setBehaviors(chains, document.getBehaviors(chains).concat(Object.assign(schema.defaultBehavior('automation'), {rules: JSON.stringify(rules)})));
      conveyors.push(roller, chains);
      let rack = null;
      if (['reach', 'turret', 'telehandler'].includes(values.family)) {
        const height = values.family === 'reach' ? 1.8 : values.family === 'turret' ? 2.2 : 1.5, rx = x + 3.8, rz = z + 6.1;
        // The front edge ends with the pallet. An oversized shelf would
        // project back through the real mast while the forks are inserted.
        const supports = [part(prefix + 'Rack · bandeja portante', [rx, height - .05, rz], [depth + .04, .1, 1.6])];
        for (const side of [-1, 1]) for (const end of [-1, 1]) supports.push(part(prefix + 'Rack · columna de apoyo', [rx + side * (depth / 2 + .1), height / 2, rz + end * .75], [.09, height, .09]));
        for (const end of [-1, 1]) supports.push(part(prefix + 'Rack · travesaño bajo bandeja', [rx, height - .13, rz + end * .75], [depth + .29, .16, .08]));
        const receiver = add('palletQueue', prefix + 'Destino elevado · ' + height.toFixed(1) + ' m', undefined, {acceptsPallets: true, palletType, width: 1.2, depth,
          palletCapacity: 1, capacity: 1, columns: 1, rows: 1, layers: 1, withPanel: false, running: true, delivery: 'manual', autoRelease: false}, [rx, height + 1, rz]);
        // Side entry leaves the approach corridor clear of the chain bed.
        document.setTransform(receiver, {rotation: [0, Math.PI / 2, 0]});
        receivers.push(receiver); rack = {receiver, height, supports};
      }
      const special = lowLift ? 'Este equipo eleva sólo centímetros: practica recogida y entrega a piso. Los transportadores altos requieren un montacargas de mástil.' :
        values.family === 'reach' ? 'Retrae la carga antes de circular; extiende el mástil únicamente frente al apoyo elevado.' :
        values.family === 'turret' ? 'Practica el giro lateral de horquillas con el vehículo detenido y alineado con el rack.' :
        values.family === 'telehandler' ? 'Combina elevación y extensión del brazo frente al apoyo; retrae antes de circular.' : 'Practica también transferencia con los rodillos y las cadenas a distintas alturas.';
      const sign = guide(prefix + definition.name, 'Vehículo encendido y en Marcha; libera Freno P para conducir. Recoge 12 cajas como un solo pallet con sus dos uñas; no tomes la carga desde lejos. Transporta bajo y deposita en las dos bahías a piso. ' + special + ' El panel de cadenas gobierna ambos tramos, detenidos al comenzar. Detén siempre el transportador antes de insertar las horquillas.', [x - 5.7, 1.65, z - 6.5]);
      const stationObjects = [vehicle, loaded, empty, stock, roller, chains, sign].concat(rack ? rack.supports.concat(rack.receiver) : []);
      const station = {id: 'vehicle-practice-' + definition.id, title: definition.name, variant: definition.id, center: [x, z], mode: 'manual', vehicle, loaded, empty, stock, roller, chains, rack,
        objects: stationObjects, sources: [], source: loaded, receivers: [stock].concat(rack ? [rack.receiver] : []), receiver: stock, controller: vehicle, links: [], expectedUnits: 0, memberIds: stationObjects.map(object => object.userData.editorId)};
      stations.push(station); lines.push(station);
    }
    let environment = null, floorPresentation = null, aging = null, messages = null;
    if (!options.preview) {
      document.getObjects(roomId).filter(object => object.name === 'Suelo del nivel' && !document.isNative(object)).forEach(object => document.remove(object));
      environment = buildCediEnvironment(document, roomId, {width: 66, depth: 86, floor: true}); objects.push(...environment.objects);
      const plan = {type: 'industrialFloor', version: 1, bounds: [-33, -43, 33, 43], floorY: 0, walkways: [[-12.75, -40, -7.25, 40], [7.25, -40, 12.75, 40], [-30, -22.25, 30, -17.75], [-30, -2.25, 30, 2.25], [-30, 17.75, 30, 22.25], [-30, 38.5, 30, 41.5]], zones: [], bays: [], arrows: [], labels: [], signs: [], crossings: []};
      stations.forEach(station => {
        const [x, z] = station.center; plan.zones.push([x - 7, z - 7.5, x + 7, z + 7.5]); plan.bays.push([x - 6.1, z + 4.3, x - 1.9, z + 6.1]);
        plan.labels.push([x - 4, z - 6.8, 0, 2.7, .5, 1], [x - 4, z + 6.5, 0, 2.7, .5, 2]);
        if (station.rack) plan.bays.push([x + 2.75, z + 5.6, x + 4.85, z + 7.4]);
      });
      for (const x of [-10, 10]) for (const z of [-30, -10, 10, 30]) plan.arrows.push([x, z, 0]);
      const presentation = document.addIndustrialFloorPresentation(roomId, plan); document.setProperty(presentation, 'name', 'Práctica de montacargas · pasillos y puestos'); objects.push(presentation);
      floorPresentation = {presentation, plan, changed: true};
      guide('Práctica de montacargas · once tipologías', 'Cada puesto tiene un vehículo manual, dos pallets y destinos independientes. Acércate al puesto de conducción y pulsa F o el mando de cabina. Libera Freno P, conduce despacio, alinea ambas uñas y usa la ayuda de acoplamiento. Conserva el mismo pallet durante recogida, transporte y entrega. No se generan cargas nuevas ni se vacían los almacenes automáticamente.', [0, 1.7, 39]);
      const studio = document.studio || {};
      document.setStudio({environments: (studio.environments || []).filter(value => value.roomId !== roomId).concat(environment.environment),
        groups: (studio.groups || []).concat(stations.map(station => ({id: 'study-' + roomId + '-' + station.id, name: station.title, roomId, members: station.memberIds}))),
        missions: (studio.missions || []).concat(stations.map(station => ({id: 'forklift-' + roomId + '-' + station.variant, name: 'Depositar · ' + station.title, roomId, description: 'Recoger y entregar una carga completa sin perder sus unidades.', help: 'Alinea dos uñas, recoge, transporta bajo y deposita sobre un apoyo completo.', start: 'manual', steps: [{name: 'Entregar el pallet existente', event: 'vehicle-delivered', objectId: station.vehicle.userData.editorId, target: 1, failEvent: ''}]})))});
      (document.studio.spawns || []).filter(value => value.roomId === roomId).forEach(value => {const object = document.getObject(value.objectId); if (object) document.setTransform(object, {position: [-24, .02, 22]});});
      (document.studio.entities || []).filter(value => value.roomId === roomId && value.type === 'camera').forEach(value => {const object = document.getObject(value.objectId); if (object) document.setTransform(object, {position: [29, 23, 44], rotation: [-.45, .57, 0]});});
      aging = options.industrialAging === false ? null : applyIndustrialAging(document, roomId);
      messages = applyIndustrialMessages(document, roomId, {enabled: options.industrialMessages !== false});
    }
    if (own) document.commit();
    return {objects, lines, cells: lines, stations, vehicles, products, conveyors, sources: [], receivers, controllers: vehicles, links: [], expectedUnits: 0,
      environment, floorPresentation, aging, messages, monitorLayout: {layouts: [], supports: [], warnings: []}};
  } catch (error) {if (own) document.cancel(); throw error;}
}
