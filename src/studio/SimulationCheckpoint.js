import * as THREE from 'three';
import {createProductVisual, createSourceProductVisual} from '../editor/IndustrialPrefabs.js';

const FORMAT = 'hello-studio-execution';
const VERSION = 1;
const MAX_NODES = 60000;
const MAX_OBJECTS = 12000;
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
const TRANSIENT = new Set(['stateEntry', 'previousHeldFlag', 'heldBy']);
const loadIdentities = new WeakMap();

function identity(product) {
  if (product.record) return 'actor:' + product.record.id;
  if (product.sourceEntry) return 'source:' + product.sourceEntry.id;
  if (!loadIdentities.has(product.object)) loadIdentities.set(product.object, 'load:' + product.object.uuid);
  return loadIdentities.get(product.object);
}

function error(message) { throw new Error('No se puede reanudar la sesión: ' + message); }

function objectRegistry(runtime) {
  const keys = new Map(), values = new Map();
  const add = (key, value) => { if (value) { keys.set(value, key); values.set(key, value); } };
  const root = runtime.document.getRoot(runtime.roomId);
  add('room', root);
  runtime.records.forEach(record => { add('record:' + record.id, record); add('actor:' + record.id, record.object); });
  // Author nodes retain stable child paths. Runtime helpers are registered by
  // component role, so generated loads never perturb a source's saved paths.
  const walk = (object, key) => {
    if (!keys.has(object)) add(key, object);
    object.children.forEach((child, index) => {
      if (!child.userData.editorRuntimeHelper) walk(child, keys.get(object) + '/' + index);
    });
  };
  walk(root, 'room');
  runtime.records.forEach(record => {
    const c = record.components;
    [['conveyor', c.conveyor && c.conveyor.helper], ['source', c.source && c.source.helper],
      ['processor/input', c.processor && c.processor.input.helper], ['processor/output', c.processor && c.processor.output.helper],
      ['processor/work', c.processor && c.processor.work], ['palletQueue', c.palletQueue && c.palletQueue.helper]]
      .forEach(([kind, value]) => add('helper:' + record.id + ':' + kind, value));
    if (c.palletQueue && c.palletQueue.pallets) c.palletQueue.pallets.forEach((pallet, index) => add('helper:' + record.id + ':palletQueue/bay/' + index, pallet.object));
  });
  return {keys, values, add};
}

function encodeGraph(value, external) {
  const nodes = [], seen = new Map();
  const encode = value => {
    if (value === undefined) return {u: true};
    if (typeof value === 'number' && !Number.isFinite(value)) return {n: value === Infinity ? '+' : value === -Infinity ? '-' : 'nan'};
    if (!value || typeof value !== 'object') {
      if (typeof value === 'function' || typeof value === 'symbol') error('hay un dato de ejecución no serializable.');
      return value;
    }
    if (external.has(value)) return {e: external.get(value)};
    if (seen.has(value)) return {r: seen.get(value)};
    if (nodes.length >= MAX_NODES) error('el estado es demasiado complejo.');
    const index = nodes.length, node = {};
    nodes.push(node); seen.set(value, index);
    if (Array.isArray(value)) { node.t = 'array'; node.v = value.map(encode); }
    else if (value instanceof Map) { node.t = 'map'; node.v = Array.from(value, pair => pair.map(encode)); }
    else if (value instanceof Set) { node.t = 'set'; node.v = Array.from(value, encode); }
    else if (value.isVector2 || value.isVector3 || value.isVector4 || value.isQuaternion || value.isEuler || value.isMatrix3 || value.isMatrix4) {
      node.t = value.isVector2 ? 'v2' : value.isVector3 ? 'v3' : value.isVector4 ? 'v4' : value.isQuaternion ? 'q' : value.isEuler ? 'euler' : value.isMatrix3 ? 'm3' : 'm4';
      node.v = value.toArray().map(encode);
    } else if (value.isBox3) { node.t = 'box'; node.v = [encode(value.min), encode(value.max)]; }
    else {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) error('un objeto no pertenece a esta escena.');
      node.t = 'object'; node.v = {};
      Object.keys(value).forEach(key => {
        if (!FORBIDDEN.has(key) && !TRANSIENT.has(key)) node.v[key] = encode(value[key]);
      });
    }
    return {r: index};
  };
  const entry = encode(value);
  return {entry, nodes};
}

function decodeGraph(graph, external) {
  if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length > MAX_NODES) error('el formato del estado es inválido.');
  const types = {v2: THREE.Vector2, v3: THREE.Vector3, v4: THREE.Vector4, q: THREE.Quaternion, euler: THREE.Euler, m3: THREE.Matrix3, m4: THREE.Matrix4};
  const values = graph.nodes.map(node => {
    if (!node || typeof node !== 'object') error('el estado contiene un nodo inválido.');
    if (node.t === 'array') return [];
    if (node.t === 'map') return new Map();
    if (node.t === 'set') return new Set();
    if (node.t === 'object') return {};
    if (node.t === 'box') return new THREE.Box3();
    if (Object.prototype.hasOwnProperty.call(types, node.t)) return new types[node.t]();
    error('el estado contiene un tipo no compatible.');
  });
  const decode = value => {
    if (!value || typeof value !== 'object') return value;
    if (Object.prototype.hasOwnProperty.call(value, 'e')) {
      if (!external.has(value.e)) error('falta el objeto «' + value.e + '».');
      return external.get(value.e);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'r')) {
      if (!Number.isSafeInteger(value.r) || value.r < 0 || value.r >= values.length) error('una referencia está dañada.');
      return values[value.r];
    }
    if (value.u === true) return undefined;
    if (value.n === '+') return Infinity;
    if (value.n === '-') return -Infinity;
    if (value.n === 'nan') return NaN;
    error('un dato del estado está dañado.');
  };
  graph.nodes.forEach((node, index) => {
    const target = values[index];
    if (['array', 'map', 'set', 'box'].includes(node.t) && !Array.isArray(node.v)) error('el contenido de un nodo es inválido.');
    if (node.t === 'array') node.v.forEach(item => target.push(decode(item)));
    else if (node.t === 'map') node.v.forEach(pair => { if (!Array.isArray(pair) || pair.length !== 2) error('un mapa está dañado.'); target.set(decode(pair[0]), decode(pair[1])); });
    else if (node.t === 'set') node.v.forEach(item => target.add(decode(item)));
    else if (node.t === 'box') { target.min = decode(node.v[0]); target.max = decode(node.v[1]); }
    else if (node.t === 'object') {
      if (!node.v || typeof node.v !== 'object' || Array.isArray(node.v)) error('un objeto está dañado.');
      Object.keys(node.v).forEach(key => { if (FORBIDDEN.has(key)) error('el estado contiene una propiedad no permitida.'); target[key] = decode(node.v[key]); });
    } else {
      const lengths = {v2: 2, v3: 3, v4: 4, q: 4, euler: 4, m3: 9, m4: 16};
      const array = Array.isArray(node.v) ? node.v.map(decode) : [];
      if (array.length !== lengths[node.t] || array.some((value, index) => node.t === 'euler' && index === 3 ? !['XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY', 'ZYX'].includes(value) : typeof value !== 'number' || Number.isNaN(value) || !['v2', 'v3', 'v4'].includes(node.t) && !Number.isFinite(value))) error('una transformación está dañada.');
      target.fromArray(array);
    }
  });
  return decode(graph.entry);
}

function configuration(runtime) {
  return JSON.stringify(Array.from(runtime.records, ([id, record]) => [id, record.configurations]).sort((a, b) => a[0].localeCompare(b[0])));
}

function sourceVisual(product) {
  const entry = product.sourceEntry, metadata = product.object.userData.sourceProduct;
  if (entry) return {kind: 'source', spec: entry.spec, load: entry.load};
  if (metadata) return {kind: 'source', spec: {id: metadata.id, name: metadata.label, type: metadata.type,
    width: metadata.productWidth, height: metadata.productHeight, depth: metadata.productDepth,
    color: product.classification.color, mass: metadata.mass, base: metadata.base}, load: {loadMode: metadata.loadMode, palletColumns: metadata.palletColumns,
    palletRows: metadata.palletRows, palletLayers: metadata.palletLayers, palletType: metadata.palletType, palletMaterial: metadata.palletMaterial,
    palletPacking: metadata.palletPacking, palletWidth: metadata.palletWidth, palletDepth: metadata.palletDepth}};
  return {kind: 'box'};
}

/** Captures queues, partial setup/process jobs, timers, source identities,
 * routing decisions, stacks, original consumed products and live transforms.
 * GPU geometry/materials and XR controller handles are deliberately references.
 */
export function captureSimulation(runtime, options = {}) {
  if (!runtime.roomId || !runtime.records.size) throw new Error('Inicia la simulación antes de guardar una sesión.');
  if (runtime.held.size && options.allowHeld !== true) throw new Error('Suelta las cargas antes de guardar la sesión.');
  const registry = objectRegistry(runtime), allProducts = Array.from(runtime.products.values());
  runtime.processorRuntime.archive.forEach(product => { if (!allProducts.includes(product)) allProducts.push(product); });
  if (allProducts.length > 500) throw new Error('La sesión supera el límite de 500 cargas, incluidas las originales archivadas.');
  const active = new Set(runtime.products.values());
  const descriptors = [];
  allProducts.forEach((product, index) => {
    registry.add('product:' + index, product);
    if (!product.record) registry.add('load:' + index, product.object);
  });
  allProducts.forEach((product, index) => {
    const object = product.object;
    object.updateWorldMatrix(true, false);
    if (!registry.keys.has(object) || !registry.keys.has(object.parent)) error('la carga no pertenece al escenario.');
    descriptors.push({index, identity: identity(product), actorId: product.record && product.record.id || null, active: active.has(product),
      key: registry.keys.get(object), parent: registry.keys.get(object.parent), matrix: object.matrix.toArray(), visible: object.visible,
      matrixAutoUpdate: object.matrixAutoUpdate,
      position: object.position.toArray(), quaternion: object.quaternion.toArray(), scale: object.scale.toArray(),
      visual: product.record ? null : sourceVisual(product), name: object.name,
      metadata: Object.keys(object.userData).filter(key => key.startsWith('source') || key === 'productUnits')
        .reduce((result, key) => { result[key] = object.userData[key]; return result; }, {})});
  });
  const records = Array.from(runtime.records, ([id, record]) => {
    record.object.updateWorldMatrix(true, false);
    return {id, components: record.components, warned: record.warned,
      parent: registry.keys.get(record.object.parent), matrix: record.object.matrix.toArray(), visible: record.object.visible,
      matrixAutoUpdate: record.object.matrixAutoUpdate,
      position: record.object.position.toArray(), quaternion: record.object.quaternion.toArray(), scale: record.object.scale.toArray()};
  });
  const graph = encodeGraph({records,
    products: allProducts.map((product, index) => ({index, data: Object.assign({}, product)})),
    source: {entries: runtime.sourceRuntime.entries, sequence: runtime.sourceRuntime.sequence},
    processor: {archive: runtime.processorRuntime.archive, visibility: runtime.processorRuntime.visibility, sequence: runtime.processorRuntime.sequence},
    palletSequence: runtime.palletQueueRuntime.sequence,
    scopes: runtime.scopeGroups, scopeLookup: runtime.scopeLookup,
    time: runtime.time, droppedSeconds: runtime.droppedSeconds, packageCount: runtime.packageCount,
    productSequence: runtime.productSequence, runSequence: runtime.runSequence, eventSequence: runtime.eventSequence,
    events: runtime.events, running: runtime.running,
    productionAnalytics: runtime.productionAnalytics && runtime.productionAnalytics.exportState({historySamples: options.analyticsHistorySamples})}, registry.keys);
  return {format: FORMAT, version: VERSION, roomId: runtime.roomId, configuration: configuration(runtime), descriptors, graph};
}

function transform(object, saved, registry) {
  const parent = registry.values.get(saved.parent);
  if (!parent || !parent.isObject3D || !Array.isArray(saved.matrix) || saved.matrix.length !== 16 || saved.matrix.some(value => !Number.isFinite(value))) error('la posición de un objeto no es válida.');
  parent.add(object);
  object.matrix.fromArray(saved.matrix);
  object.matrixAutoUpdate = saved.matrixAutoUpdate === true;
  if (object.matrixAutoUpdate && saved.position && saved.quaternion && saved.scale) {
    if (![saved.position, saved.scale].every(value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)) ||
      !Array.isArray(saved.quaternion) || saved.quaternion.length !== 4 || !saved.quaternion.every(Number.isFinite)) error('la transformación de un objeto está dañada.');
    object.position.fromArray(saved.position); object.quaternion.fromArray(saved.quaternion); object.scale.fromArray(saved.scale);
  } else object.matrix.decompose(object.position, object.quaternion, object.scale);
  object.visible = saved.visible !== false;
  object.updateWorldMatrix(true, true);
}

export function restoreSimulation(runtime, saved, options = {}) {
  if (!saved || saved.format !== FORMAT || saved.version !== VERSION || !Array.isArray(saved.descriptors) || saved.descriptors.length > 500 ||
    typeof saved.roomId !== 'string' || typeof saved.configuration !== 'string') error('el formato o la versión no son compatibles.');
  if (!saved.graph || !Array.isArray(saved.graph.nodes) || saved.graph.nodes.length > MAX_NODES) error('el estado está dañado.');
  const reuse = options.reuse === true && runtime.roomId === saved.roomId && runtime.records.size && configuration(runtime) === saved.configuration;
  if (reuse && runtime.held.size) error('suelta las cargas antes de actualizar el estado compartido.');
  if (runtime.ctx && runtime.ctx.vehicleDriving && runtime.ctx.drivingVehicle) runtime.ctx.vehicleDriving.unmount(true);
  if (!reuse) runtime.start(saved.roomId);
  try {
    if (configuration(runtime) !== saved.configuration) error('cambió la configuración del escenario.');
    if (runtime.records.size > MAX_OBJECTS) error('hay demasiados objetos.');
    // Shared-room updates retain meshes, materials and real interaction states
    // for unchanged loads. Full session restores rebuild only runtime products.
    const desired = new Map(saved.descriptors.map(descriptor => [descriptor.identity, descriptor]));
    const retained = new Map();
    Array.from(runtime.products.values()).forEach(product => {
      const descriptor = desired.get(identity(product));
      if (reuse && descriptor && descriptor.active && !!descriptor.actorId === !!product.record) {
        retained.set(descriptor.identity, product);
        return;
      }
      if (product.record) runtime.processorRuntime.unregister(product);
      else runtime.disposePackage(product.item || {mesh: product.object});
    });
    const registry = objectRegistry(runtime);
    const reconstructed = new Map();
    const identities = new Set();
    saved.descriptors.forEach((descriptor, index) => {
      if (!descriptor || descriptor.index !== index || typeof descriptor.identity !== 'string' || typeof descriptor.key !== 'string' || typeof descriptor.parent !== 'string') error('la lista de cargas está dañada.');
      if (identities.has(descriptor.identity) || descriptor.identity.length > 400 || typeof descriptor.active !== 'boolean') error('la identidad de una carga está repetida o dañada.');
      identities.add(descriptor.identity);
      const record = descriptor.actorId && runtime.records.get(descriptor.actorId);
      if (descriptor.actorId && (!record || !record.components.product)) error('falta una carga original.');
      if (descriptor.key !== (record ? 'actor:' + record.id : 'load:' + index)) error('la referencia de una carga está dañada.');
      const visual = descriptor.visual;
      if (!record && (!visual || !['source', 'box'].includes(visual.kind))) error('una carga no es compatible.');
      const prior = retained.get(descriptor.identity);
      const object = prior ? prior.object : record ? record.object : visual.kind === 'source' ? createSourceProductVisual(visual.spec, visual.load) : createProductVisual();
      if (!record) {
        object.userData.editorRuntimeHelper = true;
        object.userData.editorCollisionBody = true;
        registry.add(descriptor.key, object);
        loadIdentities.set(object, descriptor.identity);
      }
      if (descriptor.metadata && typeof descriptor.metadata === 'object') Object.keys(descriptor.metadata).forEach(key => {
        if (key.startsWith('source') || key === 'productUnits') object.userData[key] = descriptor.metadata[key];
      });
      object.name = typeof descriptor.name === 'string' ? descriptor.name.slice(0, 200) : object.name;
      const product = prior || (descriptor.active ? runtime.registerProduct(object, record || null, null) : {object, record: record || null});
      registry.add('product:' + index, product);
      reconstructed.set(index, product);
    });
    const state = decodeGraph(saved.graph, registry.values);
    if (!state || !Array.isArray(state.records) || state.records.length !== runtime.records.size || !Array.isArray(state.products)) error('faltan equipos o cargas.');
    state.records.forEach(recordState => {
      const record = runtime.records.get(recordState.id);
      if (!record || !recordState.components) error('un equipo ya no existe.');
      const componentTypes = Object.keys(record.components).sort();
      if (JSON.stringify(Object.keys(recordState.components).sort()) !== JSON.stringify(componentTypes)) error('cambiaron los componentes de un equipo.');
      componentTypes.forEach(type => {
        if (!recordState.components[type] || JSON.stringify(recordState.components[type].config) !== JSON.stringify(record.components[type].config)) error('cambió la configuración de un componente.');
      });
      const attachedComponents = record.components;
      record.components = recordState.components;
      ['source', 'palletQueue'].forEach(type => {
        const component = record.components[type];
        if (!component) return;
        if (component.powered === undefined) component.powered = true;
        if (component.emergency === undefined) component.emergency = false;
      });
      const store = record.components.palletQueue;
      // Older single-pallet checkpoints have no bay list. Their existing
      // support marker and exact slot ownership remain valid in the first bay.
      if (store && !store.pallets) {
        store.pallets = [store.pallet || attachedComponents.palletQueue.pallet];
        store.pallet = store.pallets[0];
        store.pallet.items = store.items.slice();
        store.items.forEach(item => { item.palletIndex = 0; });
      }
      record.warned = recordState.warned;
      transform(record.object, recordState, registry);
    });
    state.products.forEach(productState => {
      const product = reconstructed.get(productState.index);
      if (!product || !productState.data || productState.data.object !== product.object) error('la identidad de una carga está dañada.');
      Object.keys(productState.data).forEach(key => { if (!TRANSIENT.has(key)) product[key] = productState.data[key]; });
      product.heldBy = null;
    });
    // Articulated meshes are derived state. Restore the product's saved bounds
    // and scale first (gripper span depends on both), then rebuild the rig pose
    // before applying any product transform relative to its restored tool.
    runtime.records.forEach(record => {
      const robot = record.components.robot;
      if (robot) {
        if (robot.entry && (!robot.entry.product || robot.entry.product.robotOwnerId !== record.id || !Array.isArray(robot.queue) || !robot.queue.includes(robot.entry))) error('el robot perdió la propiedad de su carga.');
        if (robot.candidate && (!robot.candidate.product || robot.candidate.product.robotReservedBy !== record.id)) error('la reserva de recogida del robot está dañada.');
        if (!runtime.robotRuntime || !robot.pose || !Array.isArray(robot.pose.joints) || robot.pose.joints.length > 6 || robot.pose.joints.some(value => !Number.isFinite(value))) error('la postura del robot está dañada.');
        if (typeof runtime.robotRuntime.restorePose !== 'function') error('la versión del robot no admite la validación de postura.');
        runtime.robotRuntime.restorePose(record, robot.pose);
      }
      const vehicle = record.components.vehicle;
      if (vehicle) {
        if (vehicle.entry && (!vehicle.entry.product || vehicle.entry.product.vehicleOwnerId !== record.id || !Array.isArray(vehicle.queue) || !vehicle.queue.includes(vehicle.entry))) error('el vehículo perdió la propiedad de su carga.');
        if (vehicle.missionCandidate && vehicle.missionCandidate.vehicleReservedBy !== record.id) error('la reserva de recogida del vehículo está dañada.');
        const pose = vehicle.pose, numeric = ['lift', 'tilt', 'reach', 'sideShift', 'turret', 'steer', 'wheelRoll', 'boomAngle'];
        if (!runtime.vehicleRuntime || !pose || typeof pose !== 'object' || Array.isArray(pose) ||
          numeric.some(key => !Number.isFinite(pose[key])) || typeof pose.lights !== 'boolean' ||
          Object.keys(pose).some(key => !numeric.includes(key) && key !== 'lights')) error('la postura del vehículo está dañada.');
        const c = vehicle.config, margin = 1e-6;
        if (pose.lift < -margin || pose.lift > c.maxLift + margin || Math.abs(pose.tilt) > c.tiltLimit + margin ||
          pose.reach < -margin || pose.reach > c.maxReach + margin || Math.abs(pose.sideShift) > c.maxSideShift + margin ||
          Math.abs(pose.turret) > c.turretLimit + margin || Math.abs(pose.steer) > c.steerLimit + margin ||
          pose.boomAngle < -.08 - margin || pose.boomAngle > c.boomAngleLimit + margin) error('un mecanismo del vehículo está fuera de su recorrido.');
        if (vehicle.entry && (!vehicle.loadMatrix || !vehicle.loadMatrix.isMatrix4 || vehicle.loadMatrix.elements.some(value => !Number.isFinite(value)))) error('el acoplamiento de la carga del vehículo está dañado.');
        if (!Number.isFinite(vehicle.actualSpeed) || !Number.isFinite(vehicle.steering)) error('el movimiento del vehículo está dañado.');
        if (vehicle.longitudinalAcceleration === undefined) vehicle.longitudinalAcceleration = 0;
        if (!Number.isFinite(vehicle.longitudinalAcceleration)) error('la aceleración del vehículo está dañada.');
        // A shared participant keeps host speed telemetry but has no driving
        // authority. A manually resumed owner starts stationary and requires
        // fresh input, avoiding movement from a key held before saving.
        vehicle.input = {throttle: 0, steer: 0, brake: 1, lift: 0, tilt: 0, reach: 0, sideShift: 0, turret: 0};
        vehicle.inputAge = Infinity; vehicle.driving = false;
        if (!reuse && c.mode !== 'automatic') { vehicle.actualSpeed = 0; vehicle.longitudinalAcceleration = 0; }
        if (runtime.vehicleRuntime.applyPose(record, pose, false) === false) error('no se pudo restablecer el mecanismo del vehículo.');
      }
    });
    saved.descriptors.forEach(descriptor => transform(reconstructed.get(descriptor.index).object, descriptor, registry));
    reconstructed.forEach(product => {
      if (product.robotReservedBy) {
        const owner = runtime.records.get(product.robotReservedBy), robot = owner && owner.components.robot;
        if (!robot || !robot.candidate || robot.candidate.product !== product || product.robotOwnerId || product.vehicleOwnerId || product.vehicleReservedBy) error('una carga tiene una reserva de robot inconsistente.');
      }
      if (product.vehicleReservedBy) {
        const owner = runtime.records.get(product.vehicleReservedBy),vehicle=owner&&owner.components.vehicle;
        if(!vehicle||vehicle.missionCandidate!==product||product.robotReservedBy||product.robotOwnerId||product.vehicleOwnerId)error('una carga tiene una reserva de vehículo inconsistente.');
      }
      if (product.robotOwnerId && product.vehicleOwnerId) error('una carga no puede pertenecer a un robot y un vehículo a la vez.');
      if (product.robotOwnerId) {
        const owner = runtime.records.get(product.robotOwnerId);
        if (!owner || !owner.components.robot || !owner.components.robot.entry || owner.components.robot.entry.product !== product) error('la carga retenida no corresponde al robot.');
        delete product.object.userData.vehicleOwnerId;
        product.object.userData.robotOwnerId = product.robotOwnerId;
        Object.defineProperty(product.object, 'industrialHeld', {value: true, configurable: true, writable: true, enumerable: false});
      } else if (product.vehicleOwnerId) {
        const owner = runtime.records.get(product.vehicleOwnerId), vehicle = owner && owner.components.vehicle;
        if (!vehicle || !vehicle.entry || vehicle.entry.product !== product || !Array.isArray(vehicle.queue) || !vehicle.queue.includes(vehicle.entry)) error('la carga retenida no corresponde al vehículo.');
        delete product.object.userData.robotOwnerId;
        product.object.userData.vehicleOwnerId = product.vehicleOwnerId;
        Object.defineProperty(product.object, 'industrialHeld', {value: true, configurable: true, writable: true, enumerable: false});
      } else {
        delete product.object.userData.robotOwnerId;
        delete product.object.userData.vehicleOwnerId;
        runtime.restoreProductCollision(product);
      }
    });
    runtime.sourceRuntime.entries = state.source.entries;
    runtime.sourceRuntime.sequence = state.source.sequence;
    runtime.processorRuntime.archive = state.processor.archive;
    runtime.processorRuntime.visibility = state.processor.visibility;
    runtime.processorRuntime.sequence = state.processor.sequence;
    runtime.palletQueueRuntime.sequence = state.palletSequence;
    runtime.scopeGroups = state.scopes; runtime.scopeLookup = state.scopeLookup;
    ['time', 'droppedSeconds', 'packageCount', 'productSequence', 'runSequence', 'eventSequence', 'events', 'running'].forEach(key => { runtime[key] = state[key]; });
    runtime.records.forEach(record => {
      const belt = record.components.conveyor;
      if (belt) { if (belt.entryUnits === undefined) belt.entryUnits = belt.entryCount; if (belt.exitUnits === undefined) belt.exitUnits = belt.exitCount; }
    });
    runtime.refreshVariables();
    if (runtime.productionAnalytics) { runtime.observeProduction(0); runtime.productionAnalytics.importState(state.productionAnalytics); }
    if (runtime.ctx.collisionWorld) runtime.ctx.collisionWorld.invalidate();
    return runtime.getSnapshot();
  } catch (cause) {
    runtime.stop();
    throw cause;
  }
}

export const simulationCheckpointVersion = VERSION;
export function productIdentity(product) { return identity(product); }
