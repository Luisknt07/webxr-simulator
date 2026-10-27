import * as THREE from 'three';
import robotSchema from '../../shared/robots.js';
import robotKinematics from '../../shared/robot-kinematics.js';
import {updateRobotPose} from './RobotPrefabs.js';

const MOBILE = new Set(['amr', 'agv', 'mobileManipulator', 'mobileSorter']);
const EPSILON = 1e-6;
const PHASES = {idle: 'Esperando carga', setup: 'Preparación', approach: 'Aproximación', pick: 'Recogiendo', lift: 'Elevando', carry: 'Trasladando', place: 'Depositando', release: 'Entregando', return: 'Retorno', process: 'Procesando', 'wait-output': 'Esperando destino', 'drive-input': 'Viaje a recogida', 'drive-output': 'Viaje a entrega'};
Object.assign(PHASES, {engage: 'Posicionando herramienta', 'process-inplace': 'Proceso en estación', retract: 'Retirando herramienta', 'drive-home': 'Retorno a origen'});
Object.assign(PHASES, {'stow-input': 'Retrayendo brazo para viajar', 'stow-output': 'Retrayendo brazo tras entrega', 'mobile-wait-output': 'Atracado · esperando receptor', 'sorter-load': 'Cargando cinta / bandeja', 'sorter-discharge': 'Descargando al destino seleccionado', 'sorter-reset': 'Rearmando clasificador'});
function visible(object) { for (let node = object; node; node = node.parent) if (!node.visible) return false; return true; }
function vector(point) { return Array.isArray(point) ? new THREE.Vector3().fromArray(point) : new THREE.Vector3(point.x, point.y, point.z); }
function smooth(t) { return t * t * (3 - 2 * t); }

/** Bounded kinematic teaching cell. This is not a safety PLC, SLAM or dynamics solver. */
export default class RobotRuntime {
  constructor(runtime) { this.runtime = runtime; this.processGates = new Map(); }

  prepare() {
    this.processGates.clear();
    this.runtime.records.forEach(record => {
      const robot = record.components.robot; if (!robot || !this.inSitu(robot)) return;
      const source = robot.config.sourceId || robot.config.targetId; if (!source) return;
      const gates = this.processGates.get(source) || []; gates.push(record.id); this.processGates.set(source, gates);
    });
  }

  canDispatch(record, product) {
    const gates = this.processGates.get(record.id);
    return !gates || !!product && gates.every(id => product.robotProcessedBy && product.robotProcessedBy.has(id));
  }

  attach(record, component) {
    const config = component.config;
    let visualRoot = record.object;
    record.object.traverse(node => { if (node.userData.robotRig) visualRoot = node; });
    Object.assign(component, {enabled: true, powered: config.powered, running: config.running && config.powered && !config.emergency,
      paused: !!config.paused, emergency: !!config.emergency, speed: config.speed, phase: 'idle', elapsed: 0,
      phaseElapsed: 0, received: 0, receivedUnits: 0, completed: 0, deliveredUnits: 0, busySeconds: 0, idleSeconds: 0,
      setupSeconds: 0, processSeconds: 0, blockedSeconds: 0, downSeconds: 0, distance: 0, blocked: false, fault: '', entry: null,
      requested: false, started: false, pose: robotKinematics.homePose(config), origin: record.position.clone(), visualRoot, queue: []});
    component.batteryPercent = config.batteryPercent;
    component.originWorld = record.object.getWorldPosition(new THREE.Vector3());
    // Runtime pose gains opening/span during picking. Keep the authored home
    // pose independent so Stop cannot retain the last carton's jaw spacing.
    component.initialPose = robotKinematics.homePose(config);
    const waypoints = robotSchema.parseWaypoints(config);
    component.waypoints = waypoints.map(point => vector(point)); component.waypointSpeeds = waypoints.map(point => point.speed || null);
    component.homeMatrix = record.object.matrixWorld.clone();
    updateRobotPose(visualRoot, component.pose);
    ['enabled', 'powered', 'running', 'paused', 'emergency'].forEach(key => record.writable.push({key, type: 'boolean', label: key}));
    record.writable.push({key: 'speed', type: 'number', min: .05, max: 3, label: 'Factor de velocidad del robot'});
  }

  operational(robot) { return robot.enabled && robot.powered && robot.running && !robot.paused && !robot.emergency && !robot.fault; }
  mobile(robot) { return MOBILE.has(robot.config.family); }
  mobileArm(robot) { return robot.config.family === 'mobileManipulator'; }
  sorter(robot) { return robot.config.family === 'mobileSorter'; }
  outputId(robot) { return robot.activeOutputId || robot.config.outputId; }
  inSitu(robot) { return robot.config.operation === 'process' && robot.config.tool === 'process'; }
  tool(record) { const root = record.components.robot.visualRoot; return root.userData.robotRig && root.userData.robotRig.tool; }

  applyPose(record, pose, options = {}) {
    const r = record.components.robot, product = r.entry && r.entry.product || r.candidate && r.candidate.product;
    if (options.preserveGrip) return updateRobotPose(r.visualRoot, pose);
    pose.open = r.entry ? 0 : 1;
    if (product) {
      const size = product.bounds.getSize(new THREE.Vector3()).multiply(product.scale), productRotation = r.loadQuaternion || product.object.getWorldQuaternion(new THREE.Quaternion());
      const toolRotation = r.visualRoot.getWorldQuaternion(new THREE.Quaternion()).multiply(new THREE.Quaternion().fromArray(pose.quaternion));
      const jawAxis = new THREE.Vector3(0, 0, 1).applyQuaternion(toolRotation);
      pose.gripSpan = ['x', 'y', 'z'].reduce((sum, axis) => {
        const direction = new THREE.Vector3(); direction[axis] = 1; direction.applyQuaternion(productRotation);
        return sum + Math.abs(jawAxis.dot(direction)) * Math.abs(size[axis]);
      }, 0);
    }
    return updateRobotPose(r.visualRoot, pose);
  }

  restorePose(record, pose) {
    const r = record.components.robot; r.pose = robotKinematics.validatePose(r.config, pose);
    return this.applyPose(record, r.pose, {preserveGrip: true});
  }

  variables(record) {
    const r = record.components.robot;
    return {enabled: r.enabled, powered: r.powered, running: r.running, paused: r.paused, emergency: r.emergency, speed: r.speed,
      family: r.config.family, operation: r.config.operation, phase: r.phase, phaseText: PHASES[r.phase] || r.phase, blocked: r.blocked, fault: r.fault, faultLabel: r.fault,
      inFlight: r.entry || r.processingProduct ? 1 : 0, queued: r.entry ? 1 : 0, received: r.received, entryCount: r.received, exitCount: r.completed,
      receivedUnits: r.receivedUnits, deliveredUnits: r.deliveredUnits, completed: r.completed, capacity: 1,
      payloadKg: r.config.payloadKg, loadKg: r.entry ? this.runtime.productMetadata(r.entry.product).mass : 0,
      cycleProgress: r.phase === 'idle' ? 0 : Math.round(r.phaseElapsed / Math.max(.01, r.duration || 1) * 100),
      runSeconds: r.busySeconds, busySeconds: r.busySeconds, processSeconds: r.processSeconds, idleSeconds: r.idleSeconds, setupSeconds: r.setupSeconds, batteryPercent: r.batteryPercent,
      blockedSeconds: r.blockedSeconds, downSeconds: r.downSeconds, distance: r.distance,
      utilization: r.elapsed ? r.busySeconds / r.elapsed * 100 : 0,
      activeOutputId: this.outputId(r), sorterMode: this.sorter(r) ? r.config.sorterMode : '',
      joints: JSON.stringify(r.pose.joints || []), tcpX: r.pose.tcp.x, tcpY: r.pose.tcp.y, tcpZ: r.pose.tcp.z};
  }

  command(record, action, value) {
    const r = record.components.robot, runtime = this.runtime;
    if (action === 'resetEmergency') { r.fault = ''; return runtime.setVariable(record.id, 'emergency', false); }
    if (action === 'emergency') return runtime.setVariable(record.id, 'emergency', true);
    if (action === 'powerOn' || action === 'powerOff') return runtime.setVariable(record.id, 'powered', action === 'powerOn');
    if (action === 'start' || action === 'stop') return runtime.setVariable(record.id, 'running', action === 'start');
    if (action === 'pause') return runtime.setVariable(record.id, 'paused', !r.paused);
    if (action === 'speedUp' || action === 'speedDown') return runtime.setVariable(record.id, 'speed', THREE.Math.clamp(r.speed + (action === 'speedUp' ? .1 : -.1), .05, 3));
    if (action === 'dispatch' || action === 'insertBox' || action === 'cycle') {
      if (!this.operational(r)) return false;
      r.requested = true; return true;
    }
    if (action === 'home') {
      if (r.entry || r.candidate) throw new Error('Termina el ciclo con carga antes de volver a origen.');
      if (!this.operational(r)) return false;
      if (this.mobile(r)) { this.navigation(record, r.originWorld.clone(), 'drive-home'); return true; }
      return this.moveTo(record, vector(robotKinematics.homePose(r.config).tcp), 'return');
    }
    throw new Error('Mando del robot no compatible: ' + action);
  }

  fault(record, message) {
    const r = record.components.robot;
    if (r.fault !== message) this.runtime.event(record.id, 'robot-interlock', message);
    r.fault = message; r.running = false; r.blocked = true;
    if (!r.entry) this.unreserve(r);
    return false;
  }

  unreserve(robot) {
    if (robot.candidate && robot.candidate.product.robotReservedBy) delete robot.candidate.product.robotReservedBy;
    robot.candidate = null;
  }

  sources(record) {
    const r = record.components.robot;
    if (r.config.sourceId) return [this.runtime.records.get(r.config.sourceId)].filter(Boolean);
    if (this.inSitu(r) && r.config.targetId) return [this.runtime.records.get(r.config.targetId)].filter(Boolean);
    return Array.from(this.runtime.records.values()).filter(other => other !== record && this.runtime.machineLinks(other).some(link => link.id === record.id));
  }

  candidate(record) {
    const runtime = this.runtime;
    for (const source of this.sources(record)) {
      if (!visible(source.object) || source === record) continue;
      const belt = source.components.conveyor, processor = source.components.processor, stock = source.components.palletQueue;
      const inventory = source.components.source || processor && processor.output;
      let product;
      if (inventory && inventory.queue.length) product = runtime.sourceRuntime.materialize(source, inventory);
      else if (stock) product = stock.queue.map(entry => entry.product).find(value => value && runtime.palletQueueRuntime.canPickup(value));
      else if (belt) {
        // The conveyor deliberately retains a stopped load 0.30 m before its
        // endpoint. Pick/process at that real retained pose, not beyond it.
        const item = belt.packages.slice().sort((a, b) => b.offset - a.offset).find(item => item.offset >= runtime.pathLength(belt.config, item.route) / 2 - .31 && item.product && !item.product.robotReservedBy);
        product = item && item.product;
      }
      if (source.components.product) product = runtime.products.get(source.object);
      if (!product || product.heldBy || product.vehicleOwnerId || product.vehicleReservedBy || product.robotOwnerId || product.robotReservedBy || !visible(product.object)) continue;
      if (runtime.processorRuntime && !runtime.processorRuntime.canPickup(product) || runtime.palletQueueRuntime && !runtime.palletQueueRuntime.canPickup(product)) continue;
      if (this.inSitu(record.components.robot) && product.robotProcessedBy && product.robotProcessedBy.has(record.id)) continue;
      return {source, inventory, product};
    }
    return null;
  }

  worldContact(product, matrix, record) {
    product.object.updateWorldMatrix(true, true);
    record = record || this.runtime.records.get(product.robotOwnerId);
    const robot = record && record.components.robot, supported = robot && ['platform', 'fork'].includes(robot.config.tool);
    const bounds = product.bounds, top = new THREE.Vector3((bounds.min.x + bounds.max.x) / 2, supported ? bounds.min.y : bounds.max.y, (bounds.min.z + bounds.max.z) / 2);
    return top.applyMatrix4(matrix || product.object.matrixWorld);
  }

  local(record, world) { record.object.updateWorldMatrix(true, false); return world.clone().applyMatrix4(new THREE.Matrix4().getInverse(record.object.matrixWorld)); }
  solve(record, world) { const r = record.components.robot; return robotKinematics.inverse(r.config, this.local(record, world), r.pose.joints); }
  reachable(record, world) { const pose = this.solve(record, world); return pose.reached !== false && (pose.error || 0) <= record.components.robot.config.positionTolerance; }

  destination(record, entry) {
    const target = this.runtime.records.get(this.outputId(record.components.robot)), product = entry.product, runtime = this.runtime;
    if (!target || target === record || !visible(target.object)) return null;
    const source = target.components.source, processor = target.components.processor, stock = target.components.palletQueue, belt = target.components.conveyor;
    let matrix, placement;
    if (processor) {
      if (!runtime.processorRuntime.canReceive(target, entry)) return null;
      matrix = runtime.sourceRuntime.frontMatrix(target, product.bounds, product.scale, processor.input.position);
    } else if (stock) {
      if (!runtime.palletQueueRuntime.operational(stock)) return null;
      placement = runtime.palletQueueRuntime.placement(target, product); if (!placement) return null; matrix = placement.matrix;
    } else if (source) {
      if (!source.enabled || !source.running || source.paused || source.queue.length >= source.config.capacity || !runtime.sourceRuntime.fits(target, entry)) return null;
      matrix = runtime.sourceRuntime.frontMatrix(target, product.bounds, product.scale);
    } else if (belt) {
      if (!runtime.admissionReady(target, belt, false) || !runtime.productCompatible(target, belt, product) || belt.packages.length >= belt.config.maxPackages) return null;
      const item = Object.assign({}, product.item, {bounds: product.bounds, scale: product.scale, route: 'main', lateral: 0});
      matrix = runtime.packageMatrix(target, belt, -runtime.pathLength(belt.config) / 2, item);
    } else return null;
    if (!runtime.sourceRuntime.canPlace(target, product.bounds, matrix, product)) return null;
    return {target, matrix, placement};
  }

  pick(record) {
    const r = record.components.robot, c = r.candidate, runtime = this.runtime;
    if (!c || c.product.heldBy || c.product.vehicleOwnerId || c.product.vehicleReservedBy || c.product.robotOwnerId || !visible(c.product.object) || c.product.robotReservedBy !== record.id) return false;
    const toolPoint = this.tool(record) ? this.tool(record).getWorldPosition(new THREE.Vector3()) : vector(r.pose.tcp).applyMatrix4(record.object.matrixWorld);
    if ((!this.mobile(r) || this.mobileArm(r)) && toolPoint.distanceTo(this.worldContact(c.product, null, record)) > r.config.positionTolerance) return false;
    const product = c.product, source = c.source, belt = source.components.conveyor;
    const entry = runtime.sourceRuntime.entryForProduct(source, product);
    if (c.inventory && c.inventory.queue[0] !== entry || belt && !belt.packages.includes(product.item)) return false;
    if (c.inventory && !runtime.sourceRuntime.remove(source, entry, 'robot', c.inventory)) return false;
    if (source.components.palletQueue) runtime.palletQueueRuntime.picked(product);
    if (belt) {
      belt.packages = belt.packages.filter(item => item !== product.item); belt.inFlight = belt.packages.length;
      belt.exitCount++; belt.exitUnits += entry.units; runtime.packageCount--; product.item.beltId = null;
    }
    entry.ownerId = record.id; entry.lineage.push(record.id); entry.lineage = entry.lineage.slice(-64);
    r.entry = entry; r.queue = [entry]; r.received++; r.receivedUnits += entry.units;
    r.pickSource = source;
    delete product.robotReservedBy; product.robotOwnerId = record.id; product.object.userData.robotOwnerId = record.id; product.processorLocked = true; product.processorOwnerId = record.id;
    r.loadQuaternion = product.object.getWorldQuaternion(new THREE.Quaternion());
    Object.defineProperty(product.object, 'industrialHeld', {value: true, configurable: true, writable: true, enumerable: false});
    const tool = this.tool(record); if (tool) { const matrix = product.object.matrixWorld.clone(); tool.add(product.object); runtime.setProductMatrix(product, matrix); }
    runtime.sourceRuntime.entries.add(entry); runtime.invalidateCollision(product.object);
    runtime.event(record.id, 'robot-picked', 'Carga tomada: ' + entry.spec.name + ' · ' + entry.units + ' ud.');
    if (c.inventory) runtime.sourceRuntime.materialize(source, c.inventory);
    r.candidate = null;
    return true;
  }

  release(record) {
    const r = record.components.robot, entry = r.entry, runtime = this.runtime;
    const destination = this.destination(record, entry); if (!destination) { r.blocked = true; return false; }
    const target = destination.target, product = entry.product;
    if (this.sorter(r) && this.worldContact(product, null, record).distanceTo(this.worldContact(product, destination.matrix, record)) > r.config.positionTolerance) {
      this.sorterDischarge(record); return false;
    }
    // The selected pallet cell can change while the arm travels. Reposition to
    // the current valid cell before committing; never teleport between stacks.
    if ((!this.mobile(r) || this.mobileArm(r)) && this.worldContact(product).distanceTo(this.worldContact(product, destination.matrix)) > r.config.positionTolerance) {
      if (!this.reachable(record, this.worldContact(product, destination.matrix))) return this.fault(record, 'Destino fuera del alcance configurado.');
      r.destination = destination; this.moveTo(record, this.local(record, this.worldContact(product, destination.matrix)), 'place'); return false;
    }
    product.robotOwnerId = ''; delete product.object.userData.robotOwnerId; product.processorLocked = false; product.processorOwnerId = '';
    runtime.restoreProductCollision(product);
    let accepted;
    if (target.components.processor) accepted = runtime.processorRuntime.receive(target, entry);
    else if (target.components.palletQueue) accepted = runtime.palletQueueRuntime.receive(target, entry, false, destination.placement);
    else if (target.components.source) accepted = runtime.sourceRuntime.receive(target, entry);
    else accepted = runtime.captureProduct(product, {record: target, belt: target.components.conveyor, offset: -runtime.pathLength(target.components.conveyor.config) / 2, lateral: 0, route: 'main'});
    if (!accepted) {
      product.robotOwnerId = record.id; product.object.userData.robotOwnerId = record.id; product.processorLocked = true; product.processorOwnerId = record.id;
      Object.defineProperty(product.object, 'industrialHeld', {value: true, configurable: true, writable: true, enumerable: false});
      r.blocked = true; return false;
    }
    if (target.components.conveyor) entry.ownerId = '';
    r.completed++; r.deliveredUnits += entry.units; r.entry = null; r.queue = []; r.blocked = false;
    runtime.event(record.id, 'robot-delivered', 'Carga entregada a ' + (target.object.name || target.id) + '.');
    return true;
  }

  moveTo(record, localTarget, phase) {
    const r = record.components.robot;
    const pose = robotKinematics.inverse(r.config, localTarget, r.pose.joints);
    if (pose.reached === false || pose.error > r.config.positionTolerance) return this.fault(record, 'Trayectoria fuera del alcance o de los límites de articulación.');
    r.from = vector(r.pose.tcp); r.to = vector(pose.tcp); r.fromJoints = r.pose.joints.slice(); r.toJoints = pose.joints.slice(); r.phase = phase; r.phaseElapsed = 0;
    r.duration = Math.max(.12, r.config.cycleTime / 6, r.from.distanceTo(r.to) / r.speed);
    return true;
  }

  carryPose(record) {
    const r = record.components.robot; if (!r.entry) return true;
    const product = r.entry.product, tool = this.tool(record); record.object.updateWorldMatrix(true, true);
    const contact = tool ? tool.getWorldPosition(new THREE.Vector3()) : vector(r.pose.tcp).applyMatrix4(record.object.matrixWorld);
    const supported = ['platform', 'fork'].includes(r.config.tool);
    const localTop = new THREE.Vector3((product.bounds.min.x + product.bounds.max.x) / 2, supported ? product.bounds.min.y : product.bounds.max.y, (product.bounds.min.z + product.bounds.max.z) / 2).multiply(product.scale).applyQuaternion(r.loadQuaternion);
    const matrix = new THREE.Matrix4().compose(contact.sub(localTop), r.loadQuaternion, product.scale);
    return this.placeCarried(record, matrix);
  }

  placeCarried(record, matrix) {
    const r = record.components.robot, product = r.entry && r.entry.product; if (!product) return true;
    const world = this.runtime.ctx.collisionWorld, next = product.bounds.clone().applyMatrix4(matrix);
    if (world && product.item && product.item.box && product.item.box.getCenter(new THREE.Vector3()).distanceTo(next.getCenter(new THREE.Vector3())) > .00001) {
      const options = this.runtime.packageCollisionOptions(record, product.item);
      options.ignore.push(product.object);
      if (r.pickSource) options.ignore.push(r.pickSource.object);
      const output = this.runtime.records.get(this.outputId(r)); if (output) options.ignore.push(output.object);
      const movement = next.getCenter(new THREE.Vector3()).sub(product.item.box.getCenter(new THREE.Vector3()));
      const sweep = world.sweepBox && world.sweepBox(product.item.box, movement, options);
      if (sweep && sweep.blocked || world.testBox(next, options)) { r.blocked = true; return false; }
    }
    this.runtime.setProductMatrix(product, matrix);
    if (product.item) { product.item.box.copy(product.bounds).applyMatrix4(matrix); product.item.previous.copy(product.item.box); product.item.swept.copy(product.item.box); }
    return true;
  }

  dock(record, station, outgoing) {
    const port = this.runtime.sourceRuntime.port(station, outgoing);
    const r = record.components.robot;
    const position = port ? port.position.clone().addScaledVector(port.direction, (outgoing ? 1 : -1) * (this.mobileArm(r) ? r.config.dockDistance : r.config.length / 2 + .12)) : station.object.getWorldPosition(new THREE.Vector3());
    position.y = record.components.robot.originWorld.y; return position;
  }

  navigation(record, destination, phase) {
    const r = record.components.robot; r.phase = phase; r.phaseElapsed = 0;
    const authored = r.waypoints.map((point, index) => ({position: point.clone().applyMatrix4(r.homeMatrix), speed: r.waypointSpeeds[index]}));
    r.route = (phase === 'drive-output' ? authored : authored.slice().reverse()).concat([{position: destination, speed: null}]); r.routeIndex = 0;
  }

  chassisBox(record, position, quaternion) {
    const r = record.components.robot, c = r.config;
    record.object.updateWorldMatrix(true, false);
    const at = position || record.object.getWorldPosition(new THREE.Vector3()), rotation = quaternion || record.object.getWorldQuaternion(new THREE.Quaternion());
    const high = this.mobileArm(r) ? c.baseHeight + c.reach * .65 : c.baseHeight + c.height + .025;
    return new THREE.Box3(new THREE.Vector3(-c.length / 2, 0, -c.width / 2), new THREE.Vector3(c.length / 2, high, c.width / 2))
      .applyMatrix4(new THREE.Matrix4().compose(at, rotation, record.object.getWorldScale(new THREE.Vector3())));
  }

  navigate(record, delta) {
    const r = record.components.robot, segment = r.route[r.routeIndex]; if (!segment) return true;
    const target = segment.position || segment, speed = Math.min(r.speed, segment.speed || r.speed);
    const current = record.object.getWorldPosition(new THREE.Vector3()), difference = target.clone().sub(current); difference.y = 0;
    const distance = difference.length(); let travel = Math.min(distance, delta * speed);
    if (distance <= r.config.positionTolerance) { r.routeIndex++; return r.routeIndex >= r.route.length; }
    const world = this.runtime.ctx.collisionWorld;
    const yaw = Math.atan2(difference.x, difference.z), rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    if (this.mobileArm(r) || this.sorter(r)) {
      const currentRotation = record.object.getWorldQuaternion(new THREE.Quaternion()), angle = 2 * Math.acos(Math.min(1, Math.abs(currentRotation.dot(rotation))));
      if (angle > .001) rotation.copy(currentRotation).slerp(rotation.clone().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), Math.min(1, delta * 2 / angle));
      if (angle > .12) travel = 0;
    }
    const next = current.clone().addScaledVector(difference, travel / distance);
    const box = this.chassisBox(record, next, rotation);
    const ignore = [record.object]; if (r.entry) ignore.push(r.entry.product.object);
    // Route following stops at an obstacle. No hidden teleport, SLAM or inferred
    // safe path is substituted for the author's configured corridor.
    const options = {ignore, extraBoxes: []}, movement = next.clone().sub(current);
    if (world && (world.sweepBox && movement.lengthSq() > EPSILON * EPSILON && world.sweepBox(this.chassisBox(record), movement, options).blocked || world.testBox(box, options))) { r.blocked = true; return false; }
    r.blocked = false;
    const previousPosition = record.object.position.clone(), previousQuaternion = record.object.quaternion.clone();
    if (record.object.parent) next.applyMatrix4(new THREE.Matrix4().getInverse(record.object.parent.matrixWorld));
    record.object.position.copy(next);
    const parentRotation = record.object.parent ? record.object.parent.getWorldQuaternion(new THREE.Quaternion()).inverse() : new THREE.Quaternion();
    record.object.quaternion.copy(parentRotation.multiply(rotation));
    record.object.updateMatrix(); record.object.updateWorldMatrix(true, true);
    if (!this.carryPose(record)) {
      // A tall/overhanging load can hit an obstruction above or beside the
      // platform's own footprint. Reject the complete body+load movement.
      record.object.position.copy(previousPosition); record.object.quaternion.copy(previousQuaternion);
      record.object.updateMatrix(); record.object.updateWorldMatrix(true, true); this.runtime.invalidateCollision(record.object);
      r.blocked = true; return false;
    }
    r.distance += travel; this.runtime.invalidateCollision(record.object);
    r.batteryPercent = Math.max(0, r.batteryPercent - travel * r.config.batteryDrainPerMeter);
    if (!r.batteryPercent) this.fault(record, 'Batería agotada · recarga o reinicia la práctica.');
    return false;
  }

  begin(record) {
    const r = record.components.robot, c = this.candidate(record); if (!c) return;
    if (this.mobile(r) && r.batteryPercent <= 0) return this.fault(record, 'Batería agotada · recarga o reinicia la práctica.');
    const metadata = this.runtime.productMetadata(c.product);
    // An in-situ nozzle carries its tool, not the mass of the stationary part.
    if (!this.inSitu(r)) {
      if (metadata.mass > r.config.payloadKg + EPSILON) return this.fault(record, 'Carga de ' + metadata.mass.toFixed(2) + ' kg supera ' + r.config.payloadKg + ' kg.');
      const verdict = robotSchema.acceptsProduct(r.config, metadata);
      if (verdict === false || verdict && verdict.accepted === false) return this.fault(record, 'Producto o herramienta incompatible con esta configuración.');
    }
    const selectedOutput = robotSchema.destinationFor(r.config, metadata);
    if (!this.inSitu(r) && (!selectedOutput || !this.runtime.records.has(selectedOutput))) { r.blocked = true; return; }
    const point = this.worldContact(c.product, null, record);
    if (!this.mobile(r) && !this.reachable(record, point)) return this.fault(record, 'Producto fuera del alcance configurado.');
    r.activeOutputId = selectedOutput; r.candidate = c; c.product.robotReservedBy = record.id; r.requested = false; r.blocked = false;
    if (this.mobile(r)) { this.navigation(record, this.dock(record, c.source, true), 'drive-input'); return; }
    r.pickPoint = this.local(record, point);
    const above = r.pickPoint.clone(); above.y += r.config.approachHeight;
    r.approachPoint = this.reachable(record, above.clone().applyMatrix4(record.object.matrixWorld)) ? above : r.pickPoint;
    if (!r.started && r.config.setupTime > 0) { r.phase = 'setup'; r.phaseElapsed = 0; r.duration = r.config.setupTime; }
    else this.moveTo(record, r.approachPoint, 'approach');
    r.started = true;
  }

  advance(record, delta) {
    const r = record.components.robot;
    if (r.phase === 'idle') { if (r.config.mode !== 'manual' || r.requested) this.begin(record); return; }
    if (r.phase === 'drive-input' || r.phase === 'drive-output' || r.phase === 'drive-home') {
      if (!this.navigate(record, delta)) return;
      if (r.phase === 'drive-home') { r.phase = 'idle'; return; }
      if (r.phase === 'drive-input') {
        if (this.mobileArm(r)) { this.armAtInput(record); return; }
        if (!this.pick(record)) { this.unreserve(r); r.phase = 'idle'; return; }
        if (this.sorter(r)) { this.sorterLoad(record); return; }
        const target = this.runtime.records.get(this.outputId(r)); this.navigation(record, this.dock(record, target, false), 'drive-output');
      } else if (this.mobileArm(r)) { this.armAtOutput(record); return; }
      else if (this.sorter(r)) { this.sorterDischarge(record, delta); return; }
      else r.phase = 'release';
      this.carryPose(record); return;
    }
    if (r.phase === 'mobile-wait-output') { this.armAtOutput(record); return; }
    if (r.phase === 'sorter-load' || r.phase === 'sorter-discharge' || r.phase === 'sorter-reset') { this.sorterStep(record, delta); return; }
    if (r.phase === 'release') {
      if (this.release(record)) {
        if (this.mobileArm(r)) this.moveTo(record, vector(robotKinematics.homePose(r.config).tcp), 'stow-output');
        else if (this.sorter(r)) { r.phase = 'sorter-reset'; r.phaseElapsed = 0; r.duration = r.config.dischargeTime; r.sorterFrom = r.pose.joints.slice(); }
        else if (this.mobile(r)) r.phase = 'idle';
        else this.moveTo(record, vector(robotKinematics.homePose(r.config).tcp), 'return');
      }
      return;
    }
    const previousElapsed = r.phaseElapsed, previousPose = r.pose;
    r.phaseElapsed += delta;
    const complete = r.phaseElapsed + EPSILON >= r.duration;
    if (['approach', 'pick', 'lift', 'carry', 'place', 'return', 'engage', 'retract', 'stow-input', 'stow-output'].includes(r.phase)) {
      const fraction = smooth(Math.min(1, r.phaseElapsed / r.duration));
      const pose = robotKinematics.forward(r.config, r.fromJoints.map((value, index) => value + (r.toJoints[index] - value) * fraction));
      r.pose = pose; this.applyPose(record, pose);
      if (!this.carryPose(record)) { r.pose = previousPose; r.phaseElapsed = previousElapsed; this.applyPose(record, previousPose); return; }
      r.blocked = false;
    }
    if (!complete) return;
    if (r.phase === 'setup') this.moveTo(record, r.approachPoint, 'approach');
    else if (r.phase === 'approach') this.moveTo(record, r.pickPoint, this.inSitu(r) ? 'engage' : 'pick');
    else if (r.phase === 'engage') {
      if (!r.candidate || r.candidate.product.robotReservedBy !== record.id) { this.unreserve(r); r.phase = 'idle'; return; }
      r.processingProduct = r.candidate.product; r.received++; r.receivedUnits += this.runtime.productMetadata(r.processingProduct).units;
      r.phase = 'process-inplace'; r.phaseElapsed = 0; r.duration = Math.max(.001, r.config.processTime);
    } else if (r.phase === 'process-inplace') {
      const product = r.processingProduct, entry = this.runtime.sourceRuntime.entryForProduct(r.candidate.source, product), units = this.runtime.productMetadata(product).units;
      if (!product.robotProcessedBy) product.robotProcessedBy = new Set(); product.robotProcessedBy.add(record.id);
      entry.processHistory = (entry.processHistory || []).concat({robotId: record.id, at: this.runtime.time, operation: 'process', inSitu: true}).slice(-64);
      r.completed++; r.deliveredUnits += units; r.processingProduct = null;
      this.runtime.event(record.id, 'robot-process-complete', 'Proceso completado en estación · ' + units + ' ud. · conserva propietario.');
      this.moveTo(record, r.approachPoint, 'retract');
    } else if (r.phase === 'retract') { this.unreserve(r); this.moveTo(record, vector(robotKinematics.homePose(r.config).tcp), 'return'); }
    else if (r.phase === 'pick') {
      if (!this.pick(record)) { this.unreserve(r); r.phase = 'idle'; return; }
      this.moveTo(record, r.approachPoint, 'lift');
    } else if (r.phase === 'lift' && this.mobileArm(r)) {
      const loadHeight = r.entry.product.bounds.getSize(new THREE.Vector3()).multiply(r.entry.product.scale).y;
      const stow = new THREE.Vector3(Math.min(r.config.length * .3, r.config.reach * .3), Math.max(r.config.baseHeight + .45, r.config.height + loadHeight + .25), 0);
      this.moveTo(record, stow, 'stow-input');
    } else if (r.phase === 'stow-input') {
      const target = this.runtime.records.get(this.outputId(r)); this.navigation(record, this.dock(record, target, false), 'drive-output');
    } else if (r.phase === 'stow-output') r.phase = 'idle';
    else if (r.phase === 'lift' || r.phase === 'wait-output') {
      const destination = this.destination(record, r.entry);
      if (!destination) { r.phase = 'wait-output'; r.blocked = true; return; }
      const point = this.local(record, this.worldContact(r.entry.product, destination.matrix)); r.destination = destination;
      if (!this.reachable(record, point.clone().applyMatrix4(record.object.matrixWorld))) return this.fault(record, 'Destino fuera del alcance configurado.');
      r.placePoint = point; const above = point.clone(); above.y += r.config.approachHeight;
      r.blocked = false; this.moveTo(record, this.reachable(record, above.clone().applyMatrix4(record.object.matrixWorld)) ? above : point, 'carry');
    } else if (r.phase === 'carry') {
      if (r.config.operation === 'process' && r.config.processTime > 0) { r.phase = 'process'; r.phaseElapsed = 0; r.duration = r.config.processTime; }
      else this.moveTo(record, r.placePoint, 'place');
    } else if (r.phase === 'process') {
      // Processing annotates the same load. It cannot create arbitrary stock.
      r.entry.processHistory = (r.entry.processHistory || []).concat({robotId: record.id, at: this.runtime.time, operation: 'process'}).slice(-64);
      this.moveTo(record, r.placePoint, 'place');
    } else if (r.phase === 'place') r.phase = 'release';
    else if (r.phase === 'return') r.phase = 'idle';
  }

  armAtInput(record) {
    const r = record.components.robot; if (!r.candidate) { r.phase = 'idle'; return; }
    const point = this.worldContact(r.candidate.product, null, record);
    if (!this.reachable(record, point)) return this.fault(record, 'Atraque de recogida fuera del alcance del brazo móvil.');
    r.pickPoint = this.local(record, point); const above = r.pickPoint.clone(); above.y += r.config.approachHeight;
    r.approachPoint = this.reachable(record, above.clone().applyMatrix4(record.object.matrixWorld)) ? above : r.pickPoint;
    if (!r.started && r.config.setupTime > 0) { r.phase = 'setup'; r.phaseElapsed = 0; r.duration = r.config.setupTime; }
    else this.moveTo(record, r.approachPoint, 'approach');
    r.started = true;
  }

  armAtOutput(record) {
    const r = record.components.robot, destination = this.destination(record, r.entry);
    if (!destination) { r.phase = 'mobile-wait-output'; r.blocked = true; return; }
    const point = this.local(record, this.worldContact(r.entry.product, destination.matrix));
    if (!this.reachable(record, point.clone().applyMatrix4(record.object.matrixWorld))) return this.fault(record, 'Atraque de entrega fuera del alcance del brazo móvil.');
    r.destination = destination; r.placePoint = point; const above = point.clone(); above.y += r.config.approachHeight;
    r.blocked = false; this.moveTo(record, this.reachable(record, above.clone().applyMatrix4(record.object.matrixWorld)) ? above : point, 'carry');
  }

  sorterLoad(record) {
    const r = record.components.robot, product = r.entry.product;
    product.object.updateWorldMatrix(true, false); r.loadFromMatrix = product.object.matrixWorld.clone();
    this.applyPose(record, robotKinematics.forward(r.config, [0, 0]));
    const contact = this.tool(record).getWorldPosition(new THREE.Vector3());
    const offset = new THREE.Vector3((product.bounds.min.x + product.bounds.max.x) / 2, product.bounds.min.y, (product.bounds.min.z + product.bounds.max.z) / 2).multiply(product.scale).applyQuaternion(r.loadQuaternion);
    r.loadToMatrix = new THREE.Matrix4().compose(contact.sub(offset), r.loadQuaternion, product.scale);
    r.phase = 'sorter-load'; r.phaseElapsed = 0; r.duration = r.config.dischargeTime;
  }

  sorterDischarge(record, delta = 1 / 60) {
    const r = record.components.robot, destination = this.destination(record, r.entry);
    if (!destination) { r.blocked = true; return false; }
    const point = this.worldContact(r.entry.product, destination.matrix, record), origin = record.object.getWorldPosition(new THREE.Vector3());
    const direction = point.clone().sub(origin); direction.y = 0;
    const yaw = Math.atan2(-direction.z, direction.x), parent = record.object.parent ? record.object.parent.getWorldQuaternion(new THREE.Quaternion()).inverse() : new THREE.Quaternion();
    const desiredRotation = parent.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
    const angleToDock = 2 * Math.acos(Math.min(1, Math.abs(record.object.quaternion.dot(desiredRotation))));
    if (angleToDock > .002) {
      const previous = record.object.quaternion.clone();
      record.object.quaternion.slerp(desiredRotation, Math.min(1, delta * 2 / angleToDock)); record.object.updateWorldMatrix(true, true);
      const world = this.runtime.ctx.collisionWorld, ignore = [record.object, r.entry.product.object];
      if (world && world.testBox(this.chassisBox(record), {ignore, extraBoxes: []}) || !this.carryPose(record)) {
        record.object.quaternion.copy(previous); record.object.updateWorldMatrix(true, true); this.runtime.invalidateCollision(record.object); r.blocked = true; return false;
      }
      this.runtime.invalidateCollision(record.object); r.blocked = false; return false;
    }
    record.object.quaternion.copy(desiredRotation);
    record.object.updateWorldMatrix(true, true);
    const local = this.local(record, point), dy = local.y - robotKinematics.homePose(r.config).tcp.y;
    if (Math.abs(dy) > (r.config.sorterMode === 'tilttray' ? r.config.transferTolerance : Math.min(r.config.transferTolerance, r.config.positionTolerance)) + EPSILON || r.config.sorterMode === 'tilttray' && dy > -.02) return this.fault(record, r.config.sorterMode === 'tilttray' ? 'La bandeja necesita un receptor inferior dentro del desnivel configurado.' : 'La cinta transversal necesita un receptor a su altura.');
    const angle = r.config.sorterMode === 'tilttray' ? Math.atan2(dy, Math.abs(local.x)) : 0;
    const reach = Math.hypot(local.x, r.config.sorterMode === 'tilttray' ? dy : 0);
    if (reach > robotSchema.getJointDefinitions(r.config)[0].max || Math.abs(angle) > .55 || Math.abs(local.z) > .05) return this.fault(record, 'Receptor fuera del alcance físico de la descarga transversal.');
    r.sorterFrom = r.pose.joints.slice(); r.sorterTarget = [reach, angle]; r.sorterDestination = destination;
    r.phase = 'sorter-discharge'; r.phaseElapsed = 0; r.duration = r.config.dischargeTime; r.blocked = false; return true;
  }

  sorterStep(record, delta) {
    const r = record.components.robot, previousElapsed = r.phaseElapsed, previousPose = r.pose;
    r.phaseElapsed += delta; const fraction = smooth(Math.min(1, r.phaseElapsed / r.duration));
    if (r.phase === 'sorter-load') {
      const a = new THREE.Vector3(), b = new THREE.Vector3(), qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), sa = new THREE.Vector3(), sb = new THREE.Vector3();
      r.loadFromMatrix.decompose(a, qa, sa); r.loadToMatrix.decompose(b, qb, sb);
      if (!this.placeCarried(record, new THREE.Matrix4().compose(a.lerp(b, fraction), qa.slerp(qb, fraction), sa.lerp(sb, fraction)))) { r.phaseElapsed = previousElapsed; return; }
    } else {
      const joints = r.phase === 'sorter-reset' ? r.sorterFrom.map(value => value * (1 - fraction)) : r.sorterTarget.map((value, index) => r.sorterFrom[index] + (value - r.sorterFrom[index]) * fraction);
      r.pose = robotKinematics.forward(r.config, joints); this.applyPose(record, r.pose);
      if (!this.carryPose(record)) { r.phaseElapsed = previousElapsed; r.pose = previousPose; this.applyPose(record, previousPose); return; }
    }
    r.blocked = false;
    if (r.phaseElapsed + EPSILON < r.duration) return;
    if (r.phase === 'sorter-load') { const target = this.runtime.records.get(this.outputId(r)); this.navigation(record, this.dock(record, target, false), 'drive-output'); }
    else if (r.phase === 'sorter-discharge') r.phase = 'release';
    else r.phase = 'idle';
  }

  step(delta) {
    this.runtime.records.forEach(record => {
      const r = record.components.robot; if (!r) return;
      r.elapsed += delta;
      if (!this.operational(r) || !visible(record.object)) { r.downSeconds += delta; return; }
      if (r.blocked) r.blockedSeconds += delta;
      else if (r.phase === 'setup') r.setupSeconds += delta;
      else if (r.phase === 'idle') r.idleSeconds += delta;
      else r.busySeconds += delta;
      if (['process', 'process-inplace'].includes(r.phase) && !r.blocked) r.processSeconds += delta;
      this.advance(record, delta);
    });
  }

  stop() {
    this.runtime.records.forEach(record => {
      const r = record.components.robot; if (!r) return;
      this.unreserve(r);
      if (r.entry && r.entry.product) { const product = r.entry.product; delete product.robotOwnerId; delete product.object.userData.robotOwnerId; product.processorLocked = false; product.processorOwnerId = ''; this.runtime.restoreProductCollision(product); }
      updateRobotPose(r.visualRoot, r.initialPose);
    });
    this.processGates.clear();
  }
}
