import * as THREE from 'three';
import behaviorSchema from '../../shared/behaviors.js';
import automationSchema from '../../shared/automation.js';
import {createProductVisual} from './IndustrialPrefabs.js';
import ProductFeedback from './ProductFeedback.js';
import ObjectPlacement from '../lib/ObjectPlacement.js';
import ProductSourceRuntime from './ProductSourceRuntime.js';
import ProcessorRuntime from './ProcessorRuntime.js';
import PalletQueueRuntime from './PalletQueueRuntime.js';
import RobotRuntime from './RobotRuntime.js';
import VehicleRuntime from './VehicleRuntime.js';

const {normalizeBehaviors, simulationTypes} = behaviorSchema;
const conveyorLayout = behaviorSchema.conveyorLayout;
const {normalizeRules, compare} = automationSchema;
const STEP = 1 / 60;
const MAX_FRAME = 0.25;
const MAX_PACKAGES = 500;
const PACKAGE_SIZE = 0.25;
const PRODUCT_HOLD_DISTANCE = 0.35;
const PRODUCT_HOLD_MIN = 0.2;
const PRODUCT_HOLD_MAX = 3;
const PRODUCT_PLACEMENT_DISTANCE = 0.22;
const PRODUCT_PREVIEW_DISTANCE = 0.6;
const MAX_ROTATION_STEP = Math.PI / 90;
const IDENTITY_SCALE = new THREE.Vector3(1, 1, 1);
const PACKAGE_BOUNDS = new THREE.Box3(new THREE.Vector3().setScalar(-PACKAGE_SIZE / 2), new THREE.Vector3().setScalar(PACKAGE_SIZE / 2));
let nextRuntimeId = 0;

function visible(object) {
  for (let node = object; node; node = node.parent) if (!node.visible) return false;
  return true;
}

function updateTree(object) {
  object.updateWorldMatrix(true, true);
}

function descriptor(key, type, label, min, max) {
  const result = {key, type, label};
  if (min !== undefined) result.min = min;
  if (max !== undefined) result.max = max;
  return result;
}

function actorBounds(object) {
  const box = new THREE.Box3();
  box.makeEmpty();
  object.traverse(node => {
    if (!node.geometry || node.userData.editorRuntimeHelper || node.userData.editorGeometryReplaced || !visible(node)) return;
    if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
    if (node.geometry.boundingBox) box.union(node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld));
  });
  if (box.isEmpty()) box.setFromCenterAndSize(object.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(0.25, 0.5, 0.5));
  return box;
}

function sensorBounds(object) {
  const box = new THREE.Box3();
  let found = false;
  object.traverse(node => {
    if (!node.geometry || !node.userData.industrialSensorVolume) return;
    if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
    if (node.geometry.boundingBox) { box.union(node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld)); found = true; }
  });
  return found ? box : actorBounds(object);
}

function localBounds(object) {
  updateTree(object);
  const inverse = new THREE.Matrix4().getInverse(object.matrixWorld), box = new THREE.Box3();
  object.traverse(node => {
    if (!node.geometry || !visible(node) || node.userData.editorGeometryReplaced) return;
    if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
    if (node.geometry.boundingBox) box.union(node.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, node.matrixWorld)));
  });
  return box.isEmpty() ? PACKAGE_BOUNDS.clone() : box;
}

/** An isolated teaching simulation. It never opens a connection to a real PLC. */
export default class SimulationRuntime {
  constructor(ctx, document, notify) {
    this.ctx = ctx;
    this.document = document;
    this.notify = notify || (() => {});
    this.onEvent = null;
    this.records = new Map();
    this.events = [];
    this.eventSequence = 0;
    this.time = 0;
    this.droppedSeconds = 0;
    this.packageCount = 0;
    this.running = false;
    this.runSequence = 0;
    this.statePrefix = 'editor-simulation-' + (++nextRuntimeId) + '-';
    this.states = [];
    this.products = new Map();
    this.productSequence = 0;
    this.held = new Map();
    this.scopeGroups = new Map();
    this.scopeLookup = new Map();
    this.controlFeedback = new Map();
    this.actorMatrices = new WeakMap();
    this.productFeedback = new ProductFeedback(ctx);
    this.sourceRuntime = new ProductSourceRuntime(this);
    this.processorRuntime = new ProcessorRuntime(this);
    this.palletQueueRuntime = new PalletQueueRuntime(this);
    this.robotRuntime = typeof RobotRuntime === 'function' ? new RobotRuntime(this) : null;
    this.vehicleRuntime = typeof VehicleRuntime === 'function' ? new VehicleRuntime(this) : null;
    this.productionAnalytics = new behaviorSchema.productionAnalytics.Recorder();
  }

  start(roomId) {
    this.stop();
    this.productFeedback = new ProductFeedback(this.ctx);
    this.roomId = roomId;
    this.runSequence++;
    this.time = 0;
    this.droppedSeconds = 0;
    this.events = [];
    this.running = true;
    const flowConfigurations = new Map();
    this.document.getObjects(roomId).forEach(object => {
      if (!object || object.userData.editorHelper || object.userData.editorRuntimeHelper || object.userData.editorVisualOwnerId || object.userData.industrialRetiredSupply) return;
      const id = object.userData.editorId;
      if (!id || this.records.has(id)) return;
      let configurations;
      try {
        const all = normalizeBehaviors(this.document.getBehaviors(object));
        // A configured upstream still owns its destination while stopped,
        // empty or disabled. Its disabled behavior need not create a record.
        flowConfigurations.set(id, all.filter(config => ['conveyor', 'source', 'processor', 'palletQueue', 'robot'].includes(config.type)));
        configurations = all.filter(config => config.enabled && simulationTypes.includes(config.type));
      }
      catch (error) { this.notify(error.message); return; }
      if (!configurations.length) return;
      const record = {id, object, configurations, components: {}, writable: [], variables: {}, warned: new Set(), position: object.position.clone(), quaternion: object.quaternion.clone(),
        parent: object.parent, siblingIndex: object.parent ? object.parent.children.indexOf(object) : -1,
        scale: object.scale.clone(), matrix: object.matrix.clone(), matrixAutoUpdate: object.matrixAutoUpdate};
      configurations.forEach(config => {
        const component = {config};
        record.components[config.type] = component;
        if (config.type === 'motion') {
          component.elapsed = 0; component.position = 0;
          component.speed = config.speed; component.enabled = true;
          record.writable.push(descriptor('enabled', 'boolean', 'Habilitado'), descriptor('speed', 'number', 'Velocidad', -20, 20));
        } else if (config.type === 'conveyor') {
          Object.assign(component, {enabled: true, powered: config.powered, paused: config.paused, autoSpawn: config.autoSpawn,
            running: config.powered && config.running, speed: config.speed, actualSpeed: 0, emergency: false,
            inFlight: 0, entryCount: 0, exitCount: 0, entryUnits: 0, exitUnits: 0, runSeconds: 0, pendingInsert: 0, spawnElapsed: config.spawnInterval, packages: [],
            pallets: new Map(), palletCount: 0, palletCapacity: 0, palletFull: false, transferBlocked: false, routeSequence: 0,
            routedMain: 0, routedBranch: 0, routingUnmatched: 0,
            actuatorPosition: 0, actuatorAngle: 0, elevatorPosition: 0, mechanismPhase: 'ready', mechanismElapsed: 0,
            operatorAvailable: config.operatorAvailable, manualRelease: false, zonesOccupied: 0,
            routingRules: behaviorSchema.conveyorRouting ? behaviorSchema.conveyorRouting.normalizeRules(config.routingRules) : []});
          const helper = new THREE.Group(); helper.name = 'Paquetes de simulación'; helper.userData.editorRuntimeHelper = true;
          object.add(helper); component.helper = helper;
          record.writable.push(descriptor('running', 'boolean', 'En marcha'), descriptor('emergency', 'boolean', 'Parada de emergencia'),
            descriptor('speed', 'number', 'Velocidad (m/s)', -20, 20), descriptor('enabled', 'boolean', 'Habilitado'),
            descriptor('powered', 'boolean', 'Alimentación'), descriptor('paused', 'boolean', 'En pausa'),
            descriptor('autoSpawn', 'boolean', 'Entrada automática'));
          if (config.mechanism === 'loading') record.writable.push(descriptor('operatorAvailable', 'boolean', 'Operario disponible'));
        } else if (config.type === 'source') {
          this.sourceRuntime.attach(record, component);
        } else if (config.type === 'processor') {
          this.processorRuntime.attach(record, component);
        } else if (config.type === 'palletQueue') {
          this.palletQueueRuntime.attach(record, component);
        } else if (config.type === 'robot' && this.robotRuntime) {
          this.robotRuntime.attach(record, component);
        } else if (config.type === 'vehicle' && this.vehicleRuntime) {
          this.vehicleRuntime.attach(record, component);
        } else if (config.type === 'sensor') {
          Object.assign(component, {enabled: true, active: config.normallyClosed, count: 0, occupied: false, touching: new Set()});
          record.writable.push(descriptor('enabled', 'boolean', 'Habilitado'));
        } else if (config.type === 'automation') {
          component.enabled = true;
          component.rules = normalizeRules(config.rules).map(rule => ({rule, previous: false}));
          record.writable.push(descriptor('enabled', 'boolean', 'Habilitado'));
        }
      });
      record.writable = record.writable.filter((field, index, list) => list.findIndex(other => other.key === field.key) === index);
      ['source', 'palletQueue'].forEach(type => {
        const component = record.components[type]; if (!component) return;
        component.powered = true; component.emergency = false;
        record.writable.push(descriptor('powered', 'boolean', 'Alimentación'), descriptor('emergency', 'boolean', 'Parada de emergencia'));
      });
      this.records.set(id, record);
    });
    this.configureSupply(flowConfigurations);
    if (this.robotRuntime) this.robotRuntime.prepare();
    this.buildScopes();
    this.records.forEach(record => {
      if (record.components.conveyor) this.measureBelt(record);
    });
    if (this.ctx.collisionWorld) {
      this.ctx.collisionWorld.setRoom(roomId);
    }
    this.refreshVariables();
    this.records.forEach(record => {
      if (record.components.control) this.registerControl(record);
      if (record.components.vehicle) this.registerVehicle(record);
      if (record.components.product && visible(record.object)) this.registerProduct(record.object, record);
    });
    this.products.forEach(product => {
      const candidate = this.findProductBelt(product, 0.05);
      if (candidate) this.captureProduct(product, candidate);
    });
    this.installProductInput();
    this.sourceRuntime.start();
    this.refreshVariables();
    this.productionAnalytics.reset(Array.from(this.records.values()).filter(record => this.machineComponent(record)).length);
    this.observeProduction(0); this.productionAnalytics.sample(0, true);
    this.event('simulation', 'simulation-start', 'Simulación iniciada.');
  }

  stop() {
    if (this.ctx.vehicleDriving) this.ctx.vehicleDriving.unmount(true);
    if (this.vehicleRuntime) this.vehicleRuntime.stop();
    this.stopping = true;
    if (this.robotRuntime) this.robotRuntime.stop();
    this.restoreProductInput();
    if (this.ctx.raycontrol) this.states.forEach(entry => {
      if (this.ctx.raycontrol.states[entry.name] !== entry.state) return;
      this.ctx.raycontrol.deactivateState(entry.name);
      delete this.ctx.raycontrol.states[entry.name];
    });
    this.states = [];
    this.held.clear();
    this.controlFeedback.clear();
    this.productFeedback.dispose();
    this.products.forEach(product => { this.restoreProductCollision(product); });
    this.records.forEach(record => {
      record.object.position.copy(record.position);
      record.object.quaternion.copy(record.quaternion);
      record.object.scale.copy(record.scale);
      if (record.object.parent !== record.parent) {
        if (record.object.parent) record.object.parent.remove(record.object);
        if (record.parent) {
          record.parent.add(record.object);
          const current = record.parent.children.indexOf(record.object);
          record.parent.children.splice(current, 1);
          record.parent.children.splice(Math.min(record.siblingIndex, record.parent.children.length), 0, record.object);
        }
      }
      record.object.matrixAutoUpdate = record.matrixAutoUpdate;
      record.object.matrix.copy(record.matrix);
      const belt = record.components.conveyor;
      if (belt) {
        belt.packages.forEach(item => this.disposePackage(item));
        belt.pallets.forEach(pallet => {
          if (pallet.runtimeClone && pallet.object.parent) { pallet.object.parent.remove(pallet.object); this.invalidateCollision(pallet.object); }
        });
        if (belt.helper.parent) belt.helper.parent.remove(belt.helper);
        this.invalidateCollision(belt.helper);
      }
      this.invalidateCollision(record.object);
    });
    this.products.forEach(product => { if (!product.record && product.item) this.disposePackage(product.item); });
    this.sourceRuntime.stop();
    this.processorRuntime.stop();
    this.palletQueueRuntime.stop();
    if (this.document.syncCADAttachments) {
      this.document.syncCADAttachments();
      if (this.document.additions) this.document.additions.forEach(entry => { if (entry.descriptor.type === 'cad' && entry.descriptor.attachment) this.invalidateCollision(entry.object); });
    }
    this.records.clear();
    this.actorMatrices = new WeakMap();
    this.products.clear();
    this.scopeGroups.clear(); this.scopeLookup.clear();
    if (this.robotSourceLinks) this.robotSourceLinks.clear();
    if (this.lineLookup) this.lineLookup.clear();
    this.packageCount = 0;
    this.running = false;
    this.stopping = false;
  }

  configureSupply(configurations) {
    this.records.forEach(record => { if (record.components.conveyor) record.components.conveyor.externalSupply = false; });
    configurations.forEach((configs, id) => configs.forEach(config => {
      const links = conveyorLayout ? conveyorLayout.connections(config) : config.outputId ? [{targetId: config.outputId}] : [];
      links.forEach(link => {
        if (link.targetId === id) return;
        const target = this.records.get(link.targetId);
        if (target && target.components.conveyor) target.components.conveyor.externalSupply = true;
      });
    }));
    this.records.forEach(record => { if (record.components.conveyor) this.updateSupplyState(record.components.conveyor); });
  }

  updateSupplyState(belt) {
    belt.internalSupplyActive = !!belt.autoSpawn && !belt.externalSupply;
    belt.supplyMode = belt.externalSupply ? 'external' : belt.internalSupplyActive ? 'internal' : 'manual';
  }

  registerControl(record) {
    if (!this.ctx.raycontrol || !visible(record.object)) return;
    const config = record.components.control.config;
    const name = this.statePrefix + record.id;
    const feedback = {controllers: new Set(), hovering: new Set(), sequence: 0, until: 0};
    this.controlFeedback.set(record.id, feedback);
    const end = (hit, controller) => { feedback.controllers.delete(controller); };
    const state = {colliderMesh: record.object, controller: 'both', raycaster: true, consumeSelect: true, mergeSelection: true, captureSelect: true,
      isSelectable: (hit, controller) => this.validInteraction(record.object, hit, controller, false),
      onHover: (hit, active, controller) => { feedback.hovering.add(controller); },
      onHoverLeave: (hit, active, controller) => { feedback.hovering.delete(controller); },
      onSelectEnd: end,
      onSelectCancel: (hit, controller) => { end(hit, controller); feedback.until = 0; },
      onSelectStart: (hit, controller) => {
        if (!this.running || !visible(record.object) || this.ctx.editor && this.ctx.editor.active ||
          !this.validInteraction(record.object, hit, controller, true) || feedback.controllers.has(controller)) return;
        // Two hands can press a shared cap, but its mechanical action fires once
        // until the last hand releases it (especially important for toggles).
        const alreadyPressed = feedback.controllers.size > 0;
        feedback.controllers.add(controller); feedback.until = this.time + 0.12;
        if (alreadyPressed) return;
        feedback.sequence++;
        this.pulse(controller, 0.2, 30);
        const targetId = !config.targetId || config.targetId === 'self' ? record.id : config.targetId;
        const target = this.records.get(targetId);
        try {
          if (config.mode === 'command') { this.command(targetId, config.command, config.value, config.scope); return; }
          const field = target && target.writable.find(item => item.key === config.variable);
          if (!field) throw new Error('El control necesita un objeto de destino con la variable ' + config.variable + '.');
          const panel = this.getPanelSnapshot(targetId, config.scope);
          const current = panel ? panel.variables : target.variables;
          const value = config.mode === 'toggle' ? !current[config.variable] : field.type === 'boolean' ? config.value !== 0 : config.value;
          if (panel) this.setScopedVariable(targetId, config.variable, value, config.scope);
          else this.setVariable(targetId, config.variable, value);
        } catch (error) { this.notify(error.message); }
      }};
    this.ctx.raycontrol.addState(name, state); this.ctx.raycontrol.activateState(name);
    this.states.push({name, state});
  }

  getControlFeedback(id) {
    const entry = this.controlFeedback.get(id);
    return {pressed: !!entry && (entry.controllers.size > 0 || this.time < entry.until),
      hovered: !!entry && entry.hovering.size > 0, sequence: entry ? entry.sequence : 0};
  }

  interactionOrigin(controller) {
    const context = controller && controller.getObjectByName('raycasterContext') || controller || this.ctx.camera;
    return context ? context.getWorldPosition(new THREE.Vector3()) : null;
  }

  validInteraction(object, hit, controller, checkObstruction) {
    if (!visible(object) || hit && hit.distance > 6) return false;
    if (!hit && !controller) return true;
    const origin = this.interactionOrigin(controller);
    if (!origin) return true; // Programmatic control calls have no spatial ray.
    if (object.userData.industrialAction) {
      object.updateWorldMatrix(true, false);
      if (object.worldToLocal(origin.clone()).z <= 0.0125) return false;
    }
    const world = this.ctx.collisionWorld;
    return !(checkObstruction && hit && hit.point && world && world.rayBlocked &&
      world.rayBlocked(origin, hit.point, {ignore: [object, controller].filter(Boolean)}));
  }

  pulse(controller, strength, duration) {
    const input = this.ctx.raycontrol;
    const data = input && input.controllers && input.controllers.find(entry => entry.controller === controller);
    const pad = data && data.inputSource && data.inputSource.gamepad;
    if (!pad) return;
    // Optional capability: unsupported/disconnected haptics must never stop an
    // interaction or leave an unhandled asynchronous browser rejection.
    try {
      const actuator = pad.hapticActuators && pad.hapticActuators[0];
      const effect = actuator && actuator.pulse ? actuator.pulse(strength, duration) : pad.vibrationActuator && pad.vibrationActuator.playEffect ?
        pad.vibrationActuator.playEffect('dual-rumble', {duration, startDelay: 0, weakMagnitude: strength, strongMagnitude: strength}) : null;
      if (effect && effect.catch) effect.catch(() => {});
    } catch (error) { /* Haptics are cosmetic. */ }
  }

  outputLinks(record) {
    const config = record.components.conveyor.config, links = [];
    if (config.outputId) links.push({route: 'main', id: config.outputId, port: config.outputPort || 'input'});
    if (config.layout === 'tee' && config.junctionMode !== 'merge' && config.branchId) links.push({route: 'branch', id: config.branchId, port: config.branchPort || 'input'});
    return links;
  }

  buildScopes() {
    // Pickup links belong to supervision/control scopes, not automatic
    // dispatch. A manual forklift and its receiver are part of the line whose
    // real pallet it collects, just as a pick/place robot is. Rebuild after
    // restored configuration as well as initial preparation.
    if (!this.robotSourceLinks) this.robotSourceLinks = new Map(); else this.robotSourceLinks.clear();
    this.records.forEach(record => {
      const robot = record.components.robot, carrier = robot || record.components.vehicle;
      if (!carrier || robot && robot.config.operation === 'process' && robot.config.tool === 'process' || !carrier.config.sourceId || !this.records.has(carrier.config.sourceId)) return;
      const links = this.robotSourceLinks.get(carrier.config.sourceId) || [];
      links.push({id: record.id, port: 'input', route: 'main'}); this.robotSourceLinks.set(carrier.config.sourceId, links);
    });
    const machines = Array.from(this.records.values()).filter(record => record.components.conveyor);
    const outgoing = new Map(), adjacent = new Map();
    machines.forEach(record => { outgoing.set(record.id, []); adjacent.set(record.id, new Set()); });
    machines.forEach(record => this.outputLinks(record).forEach(link => {
      if (link.id === record.id || !outgoing.has(link.id)) return;
      outgoing.get(record.id).push(link.id); adjacent.get(record.id).add(link.id); adjacent.get(link.id).add(record.id);
    }));
    const bind = (anchor, scope, values) => {
      const ids = Array.from(values).sort(), key = ids.join('|');
      if (!this.scopeGroups.has(key)) this.scopeGroups.set(key, {memberIds: ids, members: new Set(ids), entryCount: 0, exitCount: 0, runSeconds: 0});
      this.scopeLookup.set(anchor + '/' + scope, this.scopeGroups.get(key));
    };
    machines.forEach(record => {
      const line = new Set([record.id]), lineQueue = [record.id];
      while (lineQueue.length) adjacent.get(lineQueue.shift()).forEach(id => { if (!line.has(id)) { line.add(id); lineQueue.push(id); } });
      bind(record.id, 'line', line);
      const segment = new Set([record.id]), queue = [record.id];
      while (queue.length) outgoing.get(queue.shift()).forEach(id => {
        if (segment.has(id) || this.records.get(id).components.conveyor.config.withPanel !== false) return;
        segment.add(id); queue.push(id);
      });
      bind(record.id, 'segment', segment);
    });
    // Full production lines also contain generators, queues and processors.
    // Keep the established conveyor-only segment semantics, and derive whole
    // lines from the same persisted flow links, in both directions.
    const production = Array.from(this.records.values()).filter(record => this.machineComponent(record));
    const graph = new Map(production.map(record => [record.id, new Set()]));
    production.forEach(record => this.machineLinks(record).forEach(link => {
      if (!graph.has(link.id) || link.id === record.id) return;
      graph.get(record.id).add(link.id); graph.get(link.id).add(record.id);
    }));
    production.forEach(record => {
      const robot = record.components.robot;
      if (!robot || robot.config.operation !== 'process' || robot.config.tool !== 'process') return;
      const sourceId = robot.config.sourceId || robot.config.targetId;
      if (graph.has(sourceId)) { graph.get(record.id).add(sourceId); graph.get(sourceId).add(record.id); }
    });
    this.lineLookup = new Map();
    production.forEach(record => {
      if (this.lineLookup.has(record.id)) return;
      const members = new Set([record.id]), queue = [record.id];
      while (queue.length) graph.get(queue.shift()).forEach(id => { if (!members.has(id)) { members.add(id); queue.push(id); } });
      const group = {memberIds: Array.from(members).sort(), members, integrated: Array.from(members).some(id => !this.records.get(id).components.conveyor)};
      group.memberIds.forEach(id => this.lineLookup.set(id, group));
    });
  }

  machineComponent(record) { return record && (record.components.conveyor || record.components.source || record.components.processor || record.components.palletQueue || record.components.robot || record.components.vehicle); }

  machineLinks(record) {
    const component = this.machineComponent(record), config = component && component.config;
    if (record.components.robot && config.operation === 'process' && config.tool === 'process') return [];
    const links = record.components.conveyor ? this.outputLinks(record) : config && config.outputId ? [{id: config.outputId, port: config.outputPort || 'input', route: 'main'}] : [];
    if (record.components.robot && config.destinationRulesJson) behaviorSchema.robots.parseDestinationRules(config.destinationRulesJson).forEach(rule => { if (rule.outputId && !links.some(link => link.id === rule.outputId)) links.push({id: rule.outputId, port: 'input', route: 'branch'}); });
    const pulled = this.robotSourceLinks && this.robotSourceLinks.get(record.id) || [];
    return links.concat(pulled.filter(link => !links.some(existing => existing.id === link.id)));
  }

  productionRow(record) {
    const component = this.machineComponent(record); if (!component) return null;
    const config = component.config, v = record.variables, belt = record.components.conveyor, processor = record.components.processor;
    const source = record.components.source, stock = record.components.palletQueue, robot = record.components.robot;
    const row = record.productionRow || (record.productionRow = {});
    Object.assign(row, {id: record.id, name: record.object.name, type: config.type, state: 'idle', isRunning: false,
      obstruction: false, blocked: false, blockReason: '', parallelFractions: null, atCapacity: false,
      entryCount: 0, exitCount: 0, entryUnits: 0, exitUnits: 0, receivedCount: 0, receivedUnits: 0,
      occupied: 0, capacity: 0, nominalCapacityPerMinute: null});
    const free = belt && config.drive !== 'motor';
    const operational = component.enabled !== false && !component.emergency && !component.paused &&
      (free || component.powered !== false && component.running !== false) && visible(record.object);
    row.isRunning = !!operational;
    let useful = false;
    if (belt) {
      Object.assign(row, {entryCount: belt.entryCount, exitCount: belt.exitCount, entryUnits: belt.entryUnits || 0, exitUnits: belt.exitUnits || 0,
        occupied: belt.packages.length, capacity: config.maxPackages});
      row.blocked = !!belt.packages.length && (!!belt.transferBlocked || belt.packages.some(item => item.blocked));
      row.obstruction = !!belt.packages.length && belt.packages.some(item => item.blocked) && !belt.transferBlocked;
      const waitingForOperator = ['waitingOperator', 'waitingManualAction'].includes(belt.mechanismPhase);
      useful = belt.packages.length > 0 && (Math.abs(belt.actualSpeed || 0) > 1e-7 || !waitingForOperator && belt.mechanismPhase !== 'ready');
    } else if (processor) {
      const jobs = processor.jobs, slots = Math.max(1, config.parallelism);
      const working = jobs.filter(job => job.phase === 'process' && !job.results).length;
      const settingUp = jobs.filter(job => job.phase === 'setup' && !job.results).length;
      const completed = jobs.filter(job => job.results || job.phase === 'complete').length;
      Object.assign(row, {entryCount: processor.entryCount, exitCount: processor.output.delivered,
        entryUnits: processor.receivedUnits, exitUnits: processor.output.deliveredUnits,
        occupied: processor.input.queue.length + jobs.length + processor.output.queue.length,
        capacity: config.capacity + slots + config.outputCapacity,
        nominalCapacityPerMinute: processor.completed ? slots * 60 / processor.processTime * processor.completedUnits / processor.completed : null});
      row.blocked = !!processor.blocked && !!(processor.input.queue.length || processor.output.queue.length || completed);
      row.parallelFractions = [working / slots, settingUp / slots, completed / slots];
      if (row.blocked && !working && !settingUp) row.parallelFractions[2] = 1;
      row.atCapacity = working >= slots;
      useful = !!working; if (!useful && settingUp) row.state = 'setup';
      if (config.requiresOperator && !processor.operatorAvailable) { row.parallelFractions = [0, 0, 0]; useful = false; row.state = 'idle'; row.atCapacity = false; }
    } else if (source) {
      const exhausted = config.totalLimit > 0 && source.generated >= config.totalLimit;
      Object.assign(row, {entryCount: source.generated + source.received, exitCount: source.delivered,
        entryUnits: source.generatedUnits + source.receivedUnits, exitUnits: source.deliveredUnits,
        receivedCount: source.received, receivedUnits: source.receivedUnits, occupied: source.queue.length, capacity: config.capacity,
        nominalCapacityPerMinute: source.autoGenerate ? 60 / source.interval * behaviorSchema.productSources.unitsFor(config) : null});
      // Reaching the finite recipe limit is completion, not a jam.
      row.blocked = source.queue.length > 0 && (!!source.transferBlocked || !!source.blocked && !source.generationBlocked);
      row.obstruction = row.blocked && !source.transferBlocked;
      useful = source.autoGenerate && !exhausted && source.queue.length < config.capacity || config.delivery === 'automatic' && source.queue.length > 0;
    } else if (robot) {
      Object.assign(row, {entryCount: robot.received, exitCount: robot.completed, entryUnits: robot.receivedUnits, exitUnits: robot.deliveredUnits,
        occupied: robot.entry ? 1 : 0, capacity: 1, nominalCapacityPerMinute: 60 / Math.max(.1, config.cycleTime + (config.operation === 'process' ? config.processTime : 0))});
      row.blocked = robot.blocked || !!robot.fault; row.obstruction = !!robot.fault; useful = robot.phase !== 'idle' && robot.phase !== 'wait-output';
    } else if (record.components.vehicle) {
      const vehicle = record.components.vehicle;
      Object.assign(row, {entryCount: vehicle.received, exitCount: vehicle.delivered, entryUnits: vehicle.receivedUnits, exitUnits: vehicle.deliveredUnits, occupied: vehicle.entry ? 1 : 0, capacity: 1});
      row.blocked = !!vehicle.blocked || vehicle.missionWaiting === 'capacity'; row.obstruction = !!vehicle.blocked || !!vehicle.missionObstacle; useful = Math.abs(vehicle.actualSpeed) > .001 || !!vehicle.hydraulicMoving;
    } else if (stock) {
      Object.assign(row, {entryCount: stock.received, exitCount: stock.inventory.delivered,
        entryUnits: stock.receivedUnits, exitUnits: stock.inventory.deliveredUnits,
        receivedCount: stock.received, receivedUnits: stock.receivedUnits, occupied: stock.queue.length, capacity: config.capacity});
      // A full final store is occupied inventory. It is not by itself a fault.
      row.blocked = config.delivery === 'automatic' && stock.queue.length > 0 && !!stock.blocked;
      useful = config.delivery === 'automatic' && stock.queue.length > 0;
    }
    if (!operational) { row.blocked = false; row.obstruction = false; }
    if (row.blocked) {
      const link = belt && belt.packages.some(item => item.route === 'branch' && item.exited) ? config.branchId : config.outputId;
      const next = this.records.get(link), target = next && this.machineComponent(next), values = next && next.variables;
      row.blockReason = !link ? 'Sin conexión de salida' : !target ? 'Destino no disponible' :
        values.full || values.palletFull ? 'Destino lleno · contrapresión' :
        target.emergency || target.paused || target.powered === false && !(next.components.conveyor && target.config.drive !== 'motor') || target.running === false && !(next.components.conveyor && target.config.drive !== 'motor') ? 'Equipo siguiente detenido' :
        row.obstruction ? 'Retención por carga u obstáculo · revisar recorrido' : 'Espera de salida · revisar disponibilidad o enlace';
    }
    if (!component.enabled || !visible(record.object) || component.emergency || !free && (component.powered === false || component.running === false)) row.state = 'down';
    else if (component.paused) row.state = 'paused';
    else if (useful && !row.blocked) row.state = 'busy';
    else if (row.blocked) row.state = 'blocked';
    return row;
  }

  observeProduction(delta) {
    this.records.forEach(record => { const row = this.productionRow(record); if (row) this.productionAnalytics.observe(record.id, row, delta); });
  }

  analyticsBoundaries(ids, scope) {
    const members = new Set(ids), incoming = new Set();
    ids.forEach(id => this.machineLinks(this.records.get(id)).forEach(link => { if (members.has(link.id)) incoming.add(link.id); }));
    let inputIds = scope === 'module' ? ids : ids.filter(id => !incoming.has(id));
    let outputIds = scope === 'module' ? ids : ids.filter(id => !this.machineLinks(this.records.get(id)).some(link => members.has(link.id)));
    // A closed loop has no external intake/output; internal laps are not sales.
    if (scope !== 'module' && !inputIds.length) inputIds = [];
    if (scope !== 'module' && !outputIds.length) outputIds = [];
    if (scope !== 'module') {
      const materialFlow = id => { const robot = this.records.get(id).components.robot; return !robot || robot.config.operation !== 'process' || robot.config.tool !== 'process'; };
      inputIds = inputIds.filter(materialFlow); outputIds = outputIds.filter(materialFlow);
    }
    const storageIds = scope === 'module' ? [] : outputIds.filter(id => this.records.get(id).components.palletQueue);
    return {inputIds, outputIds, storageIds};
  }

  productionContents(record) {
    const component = this.machineComponent(record), entries = [];
    const add = (entry, stage, product) => {
      product = product || entry && entry.product;
      // Logical FIFO entries use the same mass, provenance and scale calculation
      // as their visible front load, without creating a mesh or GPU resources.
      const metadata = product ? this.productMetadata(product) : entry ? this.productMetadata({sourceEntry: entry,
        bounds: this.sourceRuntime.loadBounds(entry), scale: entry.scale ? new THREE.Vector3().fromArray(entry.scale) : record.object.getWorldScale(new THREE.Vector3()),
        classification: {loadMode: ['pallet', 'cage'].includes(entry.spec.type) ? 'pallet' : 'individual'}}) : {};
      entries.push(Object.assign({id: entry && entry.id || product && (product.record && product.record.id || product.object.uuid),
        name: entry && entry.spec.name || product && product.object.name || 'Producto', stage}, metadata));
    };
    if (record.components.conveyor) component.packages.forEach(item => add(item.product && item.product.sourceEntry, item.mechanismStage || 'Transporte', item.product));
    else if (record.components.processor) {
      component.input.queue.forEach(entry => add(entry, 'Entrada'));
      component.jobs.forEach(job => (job.results || job.inputs).forEach(entry => add(entry, job.results ? 'Salida en espera' : job.phase === 'setup' ? 'Preparación' : 'Proceso')));
      component.output.queue.forEach(entry => add(entry, 'Salida'));
    } else component.queue.forEach(entry => add(entry, record.components.palletQueue ? 'Estiba ' + ((entry.product && entry.product.item.palletIndex || 0) + 1) : 'FIFO'));
    return entries;
  }

  getAnalyticsSnapshot(id, scope = 'line') {
    if (!this.running) return null;
    const panel = this.getPanelSnapshot(id, scope); if (!panel) return null;
    const ids = panel.memberIds.filter(memberId => this.machineComponent(this.records.get(memberId)));
    const boundaries = this.analyticsBoundaries(ids, scope), rows = ids.map(memberId => this.productionRow(this.records.get(memberId)));
    const summary = this.productionAnalytics.summary(ids);
    const sum = (set, field, stockField) => set.reduce((value, memberId) => {
      const row = this.productionAnalytics.entries.get(memberId).row;
      return value + (Number(row[stockField && boundaries.storageIds.includes(memberId) ? stockField : field]) || 0);
    }, 0);
    const nominal = rows.map(row => row.nominalCapacityPerMinute).filter(value => typeof value === 'number' && Number.isFinite(value) && value > 0);
    const history = this.productionAnalytics.history(ids, boundaries), last = history[history.length - 1];
    Object.assign(summary, {entryCount: sum(boundaries.inputIds, 'entryCount'), exitCount: sum(boundaries.outputIds, 'exitCount', 'receivedCount'),
      entryUnits: sum(boundaries.inputIds, 'entryUnits'), exitUnits: sum(boundaries.outputIds, 'exitUnits', 'receivedUnits'),
      inputRate: last ? last.inputRate : 0, throughputPerMinute: last ? last.outputRate : 0,
      nominalCapacityPerMinute: nominal.length ? Math.min(...nominal) : null,
      capacityBasis: scope === 'module' ? 'Límite teórico de ciclo conocido; excluye setup, paradas y transferencias.' : 'Mínimo de los límites de ciclo conocidos; no estima equipos sin capacidad nominal.'});
    return {time: this.time, observedSeconds: summary.observedSeconds, memberIds: ids, summary, history,
      control: behaviorSchema.productionAnalytics.controlChart(history),
      machines: ids.map(memberId => {
        const record = this.records.get(memberId), entry = this.productionAnalytics.entries.get(memberId), row = entry.row;
        const contents = this.productionContents(record);
        return {id: memberId, name: record.object.name, type: row.type, state: row.state,
          metrics: this.productionAnalytics.summary([memberId]),
          capacity: {configured: row.capacity, occupied: row.occupied, percent: behaviorSchema.productionAnalytics.percent(row.occupied, row.capacity),
            units: contents.reduce((total, content) => total + (content.units || 1), 0), nominalPerMinute: row.nominalCapacityPerMinute, kind: 'cargas'},
          contents};
      })};
  }

  integratedPanelSnapshot(id, group) {
    const records = group.memberIds.map(memberId => this.records.get(memberId)), anchor = this.records.get(id);
    const components = records.map(record => this.machineComponent(record));
    const operating = components.filter(component => !component.config.drive || component.config.drive === 'motor');
    const incoming = new Set(); records.forEach(record => this.machineLinks(record).forEach(link => { if (group.members.has(link.id)) incoming.add(link.id); }));
    const sources = records.filter(record => record.components.source && !incoming.has(record.id));
    const materialFlow = record => !record.components.robot || record.components.robot.config.operation !== 'process' || record.components.robot.config.tool !== 'process';
    const terminals = records.filter(record => materialFlow(record) && !this.machineLinks(record).some(link => group.members.has(link.id)));
    const sum = (values, key) => values.reduce((total, record) => total + (Number(record.variables && record.variables[key]) || 0), 0);
    const belts = records.filter(record => record.components.conveyor), processors = records.filter(record => record.components.processor);
    const robots = records.filter(record => record.components.robot), carriers = robots.filter(materialFlow);
    const anchorBelt = anchor.components.conveyor || belts[0] && belts[0].components.conveyor;
    const motorBelts = belts.filter(record => record.components.conveyor.config.drive === 'motor');
    const runSeconds = Math.max(0, ...belts.map(record => record.components.conveyor.runSeconds || 0), ...robots.map(record => record.components.robot.busySeconds || 0));
    const variables = {moduleCount: records.length, conveyorCount: belts.length, processorCount: processors.length, robotCount: robots.length,
      sourceCount: sources.length, enabled: components.every(component => component.enabled !== false),
      powered: operating.every(component => component.powered !== false), running: operating.every(component => !!component.running),
      paused: components.some(component => !!component.paused), emergency: components.some(component => !!component.emergency),
      speed: anchorBelt ? anchorBelt.speed : 0, actualSpeed: motorBelts.length ? Math.min(...motorBelts.map(record => Math.abs(record.components.conveyor.actualSpeed || 0))) : 0,
      entryCount: sources.length ? sum(sources, 'generated') : sum(records.filter(record => materialFlow(record) && !incoming.has(record.id)), 'entryCount'),
      exitCount: terminals.reduce((total, record) => total + (Number(record.variables[record.components.palletQueue ? 'received' : record.components.processor ? 'exitCount' : record.components.source ? 'delivered' : 'exitCount']) || 0), 0),
      generatedUnits: sum(sources, 'generatedUnits'), storedUnits: sum(terminals.filter(record => record.components.palletQueue), 'receivedUnits'),
      inFlight: sum(belts, 'inFlight') + sum(carriers, 'inFlight'), queued: sum(records, 'queued') + sum(processors, 'outputQueued'),
      completed: sum(processors, 'completed'), robotCycles: sum(robots, 'completed'), palletCount: sum(terminals, 'palletCount'), palletCapacity: sum(terminals, 'palletCapacity'),
      palletFull: terminals.some(record => record.variables.full || record.variables.palletFull),
      transferBlocked: records.some(record => record.variables.transferBlocked || record.variables.blocked),
      utilization: this.productionAnalytics ? this.productionAnalytics.summary(group.memberIds).utilization : 0,
      routedMain: sum(belts, 'routedMain'), routedBranch: sum(belts, 'routedBranch'), routingUnmatched: sum(belts, 'routingUnmatched'),
      externalSupply: true, internalSupplyActive: false, supplyMode: 'external', runSeconds, pendingInsert: sum(belts, 'pendingInsert')};
    return {anchorId: id, scope: 'line', memberIds: group.memberIds.slice(), variables};
  }

  scopeMovement(product, fromId, toId) {
    this.scopeGroups.forEach(group => {
      const from = !!fromId && group.members.has(fromId), to = !!toId && group.members.has(toId);
      if (!from && to) group.entryCount++;
      if (from && !to) group.exitCount++;
    });
    if (product) product.scopeOwnerId = toId || null;
  }

  getPanelSnapshot(id, scope = 'module') {
    const record = this.records.get(id);
    if (!record) return null;
    const line = scope === 'line' && this.lineLookup && this.lineLookup.get(id);
    if (line && line.integrated) return this.integratedPanelSnapshot(id, line);
    if (!record.components.conveyor) return this.machineComponent(record) ? {anchorId: id, scope: 'module', memberIds: [id], variables: Object.assign({moduleCount: 1}, record.variables)} : null;
    const group = scope !== 'module' && this.scopeLookup.get(id + '/' + scope);
    if (!group || group.memberIds.length === 1) return {anchorId: id, scope, memberIds: [id], variables: Object.assign({moduleCount: 1}, record.variables)};
    const components = group.memberIds.map(memberId => this.records.get(memberId).components.conveyor);
    const motorComponents = components.filter(component => component.config.drive === 'motor' || !component.config.drive);
    const all = key => components.every(component => !!component[key]);
    const any = key => components.some(component => !!component[key]);
    const sum = key => components.reduce((total, component) => total + component[key], 0);
    const variables = {moduleCount: components.length, enabled: all('enabled'), powered: motorComponents.every(component => !!component.powered), running: motorComponents.every(component => !!component.running), paused: any('paused'),
      emergency: any('emergency'), autoSpawn: any('autoSpawn'), speed: record.components.conveyor.speed,
      externalSupply: record.components.conveyor.externalSupply, internalSupplyActive: record.components.conveyor.internalSupplyActive,
      supplyMode: record.components.conveyor.supplyMode,
      actualSpeed: motorComponents.every(component => component.actualSpeed !== 0) ? record.components.conveyor.actualSpeed : 0,
      entryCount: group.entryCount, exitCount: group.exitCount, inFlight: sum('inFlight'), pendingInsert: sum('pendingInsert'),
      palletCount: sum('palletCount'), palletCapacity: sum('palletCapacity'), palletFull: any('palletFull'),
      transferBlocked: any('transferBlocked'), runSeconds: group.runSeconds,
      routedMain: sum('routedMain'), routedBranch: sum('routedBranch'), routingUnmatched: sum('routingUnmatched')};
    return {anchorId: id, scope, memberIds: group.memberIds.slice(), variables};
  }

  getScopeVariables(id, scope) { const panel = this.getPanelSnapshot(id, scope); return panel && panel.variables; }

  setScopedVariable(id, key, value, scope = 'module') {
    const panel = this.getPanelSnapshot(id, scope);
    if (!panel) throw new Error('El panel necesita un módulo transportador de destino.');
    const line = scope === 'line' && this.lineLookup && this.lineLookup.get(id);
    if (line) {
      const records = line.memberIds.map(memberId => this.records.get(memberId)).filter(record => record.writable.some(field => field.key === key));
      if (key === 'running' && value && records.some(record => record.components.conveyor && record.components.conveyor.emergency)) throw new Error('Restablece la parada de emergencia de todos los transportadores antes de arrancar.');
      const targets = records.filter(record => key !== 'running' && key !== 'powered' || !record.components.conveyor || record.components.conveyor.config.drive === 'motor');
      targets.forEach(record => this.validateVariable(record, key, value));
      targets.forEach(record => this.setVariable(record.id, key, value));
      if (key === 'running') records.filter(record => record.components.conveyor && record.components.conveyor.config.drive !== 'motor').forEach(record => this.setVariable(record.id, 'paused', !value));
      if (key === 'powered' && !value) records.filter(record => record.components.conveyor && record.components.conveyor.config.drive !== 'motor').forEach(record => this.setVariable(record.id, 'paused', true));
      return true;
    }
    const ids = scope === 'module' ? panel.memberIds : panel.memberIds.filter(memberId => this.records.get(memberId).components.conveyor.config.drive === 'motor');
    ids.forEach(memberId => this.validateVariable(this.records.get(memberId), key, value));
    ids.forEach(memberId => this.setVariable(memberId, key, value));
    return true;
  }

  pathLength(config, route = 'main') { return conveyorLayout ? conveyorLayout.pathLength(config, route) : config.length; }

  pathPoint(config, distance, route = 'main') {
    if (conveyorLayout) return conveyorLayout.pathPoint(config, distance, route);
    return config.axis === 'z' ? {x: 0, z: distance - config.length / 2, tx: 0, tz: 1} : {x: distance - config.length / 2, z: 0, tx: 1, tz: 0};
  }

  pathVector(record, x, z, y = 0) {
    const vector = new THREE.Vector3(x, y, z);
    return record.object.userData.editorPrefabKey === 'conveyor' ? vector.applyMatrix3(new THREE.Matrix3().setFromMatrix4(record.object.matrixWorld)) :
      vector.applyQuaternion(record.object.getWorldQuaternion(new THREE.Quaternion()));
  }

  pathUp(record) {
    return record.object.userData.editorPrefabKey === 'conveyor' ? new THREE.Vector3(0, 1, 0).transformDirection(record.object.matrixWorld) :
      new THREE.Vector3(0, 1, 0).applyQuaternion(record.object.getWorldQuaternion(new THREE.Quaternion()));
  }

  pathSurface(record, belt, point, lateral = 0) {
    const local = new THREE.Vector3(point.x - point.tz * lateral, point.y || 0, point.z + point.tx * lateral);
    const surface = record.object.userData.editorPrefabKey === 'conveyor' ? local.applyMatrix4(record.object.matrixWorld) :
      local.applyQuaternion(record.object.getWorldQuaternion(new THREE.Quaternion())).add(record.object.getWorldPosition(new THREE.Vector3()));
    return surface.addScaledVector(this.pathUp(record), belt.top);
  }

  tangentScale(record, point) {
    return Math.max(0.00001, this.pathVector(record, point.tx, point.tz, point.ty || 0).length());
  }

  widthScale(record, point) {
    return this.pathVector(record, point.tx, point.tz, point.ty || 0).cross(this.pathVector(record, -point.tz, point.tx)).length() / this.tangentScale(record, point);
  }

  productMetadata(product) {
    const entry = product && product.sourceEntry, leaves = [], visiting = new Set();
    const visit = value => {
      if (visiting.has(value)) throw new Error('La procedencia de la carga contiene un ciclo.');
      visiting.add(value);
      if (value.members && value.members.length) value.members.forEach(visit);
      // spec.units describes the contents of one package. The inventory entry
      // already includes every package on the pallet; never replace that total.
      else leaves.push(Object.assign({}, value.spec || {}, {units: value.units || 1}));
      visiting.delete(value);
    };
    if (entry) visit(entry);
    const metadata = product && product.classification || {sku: 'product', productType: 'box', color: '#b78b53', quality: 'good', defect: 'none'};
    const uniform = (field, fallback) => {
      if (!leaves.length) return metadata[field] === undefined ? fallback : metadata[field];
      const values = leaves.map(spec => field === 'sku' ? spec.id : field === 'productType' ? spec.type : spec[field]);
      return values.every(value => value !== undefined && value === values[0]) ? values[0] : field === 'sku' ? undefined : 'mixed';
    };
    const size = product ? product.bounds.getSize(new THREE.Vector3()).multiply(product.scale) : new THREE.Vector3(PACKAGE_SIZE, PACKAGE_SIZE, PACKAGE_SIZE);
    const defects = leaves.map(spec => spec.defect || 'none').filter(value => value !== 'none');
    return {sku: uniform('sku', 'product'), productType: uniform('productType', 'box'), color: uniform('color', '#b78b53'),
      quality: leaves.length ? leaves.some(spec => spec.quality === 'defective') ? 'defective' : leaves.every(spec => spec.quality === 'good') ? 'good' : 'mixed' : metadata.quality,
      defect: leaves.length ? !defects.length ? 'none' : defects.every(value => value === defects[0]) ? defects[0] : 'mixed' : metadata.defect,
      width: Math.abs(size.x), height: Math.abs(size.y), depth: Math.abs(size.z), units: entry ? entry.units : metadata.units || 1,
      mass: entry ? behaviorSchema.productSources.entryMass(entry) : metadata.mass || 1,
      loadMode: metadata.loadMode === 'pallet' || entry && entry.load && entry.load.loadMode === 'pallet' ? 'pallet' : 'individual', base: entry && entry.load && entry.load.loadMode === 'pallet' ? 'runners' : uniform('base', 'flat')};
  }

  routeDecision(belt, product, sequenceOffset = 0) {
    if (belt.config.layout !== 'tee' || belt.config.junctionMode === 'merge') return {route: 'main', reason: 'straight', ruleIndex: -1};
    const routing = behaviorSchema.conveyorRouting;
    if (routing) {
      const metadata = this.productMetadata(product);
      if (belt.config.routing === 'rules') {
        // The authoring schema already validates these rows. Compile once per
        // run so a full downstream queue never reparses JSON every frame.
        const index = belt.routingRules.findIndex(rule => routing.matches(rule, metadata));
        return index >= 0 ? {route: belt.routingRules[index].route, reason: 'rule', ruleIndex: index} :
          {route: belt.config.routingDefault === 'branch' ? 'branch' : 'main', reason: 'default', ruleIndex: -1};
      }
      return routing.decideRoute(belt.config, metadata, belt.routeSequence + sequenceOffset);
    }
    return {route: belt.config.routing === 'branch' || belt.config.routing === 'alternate' && (belt.routeSequence + sequenceOffset) % 2 ? 'branch' : 'main', reason: 'legacy', ruleIndex: -1};
  }

  selectRoute(belt, product, sequenceOffset = 0) {
    if (belt.config.layout !== 'tee' || belt.config.junctionMode === 'merge') return 'main';
    return this.routeDecision(belt, product, sequenceOffset).route;
  }

  commitRoute(record, belt, product, decision) {
    belt.routeSequence++;
    if (product) product.routingDecisions.set(record.id, Object.assign({}, decision));
    if (belt.config.layout !== 'tee' || belt.config.junctionMode === 'merge') return;
    belt[decision.route === 'branch' ? 'routedBranch' : 'routedMain']++;
    if (belt.config.routing === 'rules' && decision.ruleIndex < 0 && decision.reason !== 'manual') belt.routingUnmatched++;
  }

  command(id, action, value, scope = 'module') {
    const record = this.records.get(id), belt = record && record.components.conveyor;
    const line = scope === 'line' && this.lineLookup && this.lineLookup.get(id);
    if (line) return this.commandProductionLine(id, line, action, value);
    const inventory = record && (record.components.source || record.components.palletQueue);
    if (inventory) {
      if (action === 'emergency') return this.setVariable(id, 'emergency', true);
      if (action === 'resetEmergency') return this.setVariable(id, 'emergency', false);
      if (action === 'powerOn' || action === 'powerOff') return this.setVariable(id, 'powered', action === 'powerOn');
    }
    if (record && record.components.processor) return this.processorRuntime.command(record, action, value);
    if (record && record.components.robot) return this.robotRuntime.command(record, action, value);
    if (record && record.components.vehicle) return this.vehicleRuntime.command(record, action, value);
    if (record && record.components.palletQueue) return this.palletQueueRuntime.command(record, action, value);
    if (record && record.components.source) return this.sourceRuntime.command(record, action, value);
    if (!belt) throw new Error('El mando necesita una banda transportadora de destino.');
    if (action === 'emergency') return this.setVariable(id, 'emergency', true);
    if (belt.config.drive !== 'motor') {
      if (action === 'start') {
        if (belt.emergency) throw new Error('Restablece la parada de emergencia antes de liberar los rodillos.');
        return this.setVariable(id, 'paused', false);
      }
      if (action === 'stop' || action === 'powerOff') return this.setVariable(id, 'paused', true);
      if (action === 'pause') return this.setVariable(id, 'paused', !belt.paused);
      if (action === 'powerOn' || action === 'speedUp' || action === 'speedDown') return false;
    }
    if (action === 'operator' && belt.config.mechanism === 'loading') return this.setVariable(id, 'operatorAvailable', !belt.operatorAvailable);
    if (action === 'dispatch' && belt.config.mechanism === 'loading') { belt.manualRelease = true; this.event(id, 'manual-operation-request', 'Carga / descarga solicitada por el operador.'); return true; }
    if (scope !== 'module' && action !== 'insertBox') {
      const panel = this.getPanelSnapshot(id, scope), ids = panel.memberIds.filter(targetId => this.records.get(targetId).components.conveyor.config.drive === 'motor');
      if (action === 'start') ids.forEach(targetId => this.validateVariable(this.records.get(targetId), 'running', true));
      if (action === 'pause') {
        if (!ids.some(targetId => this.records.get(targetId).components.conveyor.running)) return false;
        return this.setScopedVariable(id, 'paused', !panel.variables.paused, scope);
      }
      ids.forEach(targetId => this.command(targetId, action, value, 'module'));
      return true;
    }
    if (action === 'powerOn') return this.setVariable(id, 'powered', true);
    if (action === 'powerOff') return this.setVariable(id, 'powered', false);
    if (action === 'stop') return this.setVariable(id, 'running', false);
    if (action === 'pause') {
      if (!belt.powered || !belt.running) return false;
      return this.setVariable(id, 'paused', !belt.paused);
    }
    if (action === 'start') {
      this.setVariable(id, 'running', true);
      this.setVariable(id, 'paused', false);
      return true;
    }
    if (action === 'resetEmergency') return this.setVariable(id, 'emergency', false);
    if (action === 'speedUp' || action === 'speedDown') {
      const amount = typeof value === 'number' && Number.isFinite(value) && value !== 0 ? Math.abs(value) : 0.1;
      const speed = Math.round(THREE.Math.clamp(belt.speed + (action === 'speedUp' ? amount : -amount), -20, 20) * 1000) / 1000;
      return this.setVariable(id, 'speed', speed);
    }
    if (action === 'insertBox') return this.insertProduct(id);
    throw new Error('Mando de máquina no compatible.');
  }

  commandProductionLine(id, group, action, value) {
    const snapshot = this.integratedPanelSnapshot(id, group), records = group.memberIds.map(memberId => this.records.get(memberId));
    if (action === 'powerOn' || action === 'powerOff') return this.setScopedVariable(id, 'powered', action === 'powerOn', 'line');
    if (action === 'emergency' || action === 'resetEmergency') return this.setScopedVariable(id, 'emergency', action === 'emergency', 'line');
    if (action === 'start' || action === 'stop') return this.setScopedVariable(id, 'running', action === 'start', 'line');
    if (action === 'pause') {
      const operating = records.map(record => this.machineComponent(record)).filter(component => component.config.drive !== 'gravity' && component.config.drive !== 'manual');
      if (operating.length && !operating.some(component => component.running)) return false;
      return this.setScopedVariable(id, 'paused', !snapshot.variables.paused, 'line');
    }
    if (action === 'speedUp' || action === 'speedDown') {
      const amount = typeof value === 'number' && Number.isFinite(value) && value ? Math.abs(value) : .1;
      const targets = records.filter(record => record.components.conveyor && record.components.conveyor.config.drive === 'motor');
      const changes = targets.map(record => {
        const component = record.components.conveyor;
        const definition = component.config.equipmentId && behaviorSchema.conveyorEquipment.getDefinition(component.config.equipmentId);
        const limits = definition && definition.parameters.find(parameter => parameter.key === 'speed');
        const next = Math.round(THREE.Math.clamp(component.speed + (action === 'speedUp' ? amount : -amount), limits && limits.min !== undefined ? limits.min : 0, limits && limits.max !== undefined ? limits.max : 20) * 1000) / 1000;
        this.validateVariable(record, 'speed', next); return {record, next};
      });
      changes.forEach(change => this.setVariable(change.record.id, 'speed', change.next)); return true;
    }
    if (action === 'generate' || action === 'insertBox') {
      const incoming = new Set(); records.forEach(record => this.machineLinks(record).forEach(link => incoming.add(link.id)));
      const source = records.find(record => record.components.source && !incoming.has(record.id));
      return source ? this.sourceRuntime.command(source, 'generate') : this.insertProduct(id);
    }
    // Process-specific actions require choosing that machine on the monitor.
    return this.command(id, action, value, 'module');
  }

  insertProduct(id) {
    const record = this.records.get(id), belt = record && record.components.conveyor;
    if (!belt) throw new Error('Selecciona una banda para introducir una caja.');
    if (belt.externalSupply) return false;
    if (!this.productCompatible(record, belt, null)) return false;
    if (belt.pendingInsert + belt.packages.length >= belt.config.maxPackages || this.sourceRuntime.liveLoads() >= MAX_PACKAGES) return false;
    // Commands queue one product each. An occupied entry waits instead of
    // allocating overlapping boxes or silently losing the operator's request.
    belt.pendingInsert++;
    this.event(id, 'package-request', 'Caja preparada para la entrada manual.');
    this.refreshVariables();
    return true;
  }

  registerVehicle(record) {
    if (!this.ctx.raycontrol) return;
    const name = this.statePrefix + 'vehicle-' + record.id, state = {colliderMesh: record.object, controller: 'both', raycaster: true, consumeSelect: true, captureSelect: true,
      isSelectable: (hit, controller) => !this.ctx.drivingVehicle && this.validInteraction(record.object, hit, controller, false),
      onSelectStart: (hit, controller) => { if (this.running && this.ctx.vehicleDriving && this.validInteraction(record.object, hit, controller, true)) this.ctx.vehicleDriving.mount(record.id); }};
    this.ctx.raycontrol.addState(name, state); this.ctx.raycontrol.activateState(name); this.states.push({name, state});
  }

  registerProduct(object, record, item) {
    let product = this.products.get(object);
    if (product) { if (item) product.item = item; return product; }
    product = {object, record: record || null, item: item || null, heldBy: null,
      bounds: localBounds(object), scale: object.getWorldScale(new THREE.Vector3()),
      sourceId: record && record.components.product ? record.components.product.config.sourceId : '',
      enteredBelts: new Set(), routingDecisions: new Map(), previousHeldFlag: Object.getOwnPropertyDescriptor(object, 'industrialHeld')};
    const config = record && record.components.product && record.components.product.config || {}, source = object.userData.sourceProduct || {};
    product.classification = Object.freeze({sku: config.sku || source.sku || 'product', productType: config.productType || source.type || 'box',
      color: (config.color || source.color || '#b78b53').toLowerCase(), quality: config.quality || source.quality || 'good', defect: config.defect || source.defect || 'none',
      mass: config.mass || source.mass || 1, units: config.units || source.units || 1, loadMode: config.loadMode || source.loadMode || 'individual', base: config.base || source.base || 'flat', initialVelocity: config.initialVelocity || 0});
    this.products.set(object, product);
    if (!this.ctx.raycontrol) return product;
    const name = this.statePrefix + 'product-' + (++this.productSequence);
    const state = {colliderMesh: object, controller: 'both', raycaster: true, consumeSelect: true, mergeSelection: true, captureSelect: true,
      isSelectable: (hit, controller) => this.validInteraction(object, hit, controller, false),
      onSelectStart: (hit, controller) => {
        if (!this.running || this.ctx.editor && this.ctx.editor.active) return;
        controller = controller || this.ctx.desktopController || this.ctx.camera;
        if (!controller || !this.validInteraction(object, hit, controller, true)) return;
        if (product.heldBy === controller && product.holdInput !== 'squeeze') this.releaseProduct(product);
        else if (product.heldBy) return;
        else this.pickupProduct(product, controller);
      }};
    product.stateEntry = {name, state};
    this.ctx.raycontrol.addState(name, state); this.ctx.raycontrol.activateState(name);
    this.states.push(product.stateEntry);
    return product;
  }

  installProductInput() {
    const input = this.ctx.raycontrol;
    if (input && typeof input.onSelectStart === 'function') {
      const runtime = this, original = input.onSelectStart;
      const wrapper = function(event) {
        if (runtime.ctx.vrMode && runtime.ctx.studioMenuOpen) return original.apply(this, arguments);
        const product = event && runtime.held.get(event.target);
        const grip = event && runtime.productGripInputs && runtime.productGripInputs.get(event.target);
        if ((product || grip && grip.down && grip.product) && runtime.running && !(runtime.ctx.editor && runtime.ctx.editor.active)) {
          const data = input.controllers && input.controllers.find(entry => entry.controller === event.target);
          if (input.enabled === false || data && (!data.enabled || data.active)) return;
          // The grip owns a held load until grip-up. A simultaneous trigger
          // must neither drop it nor operate a machine behind that load.
          if (product && product.holdInput !== 'squeeze') runtime.releaseProduct(product);
          // Dropping consumes this trigger cycle too: a repeated start must
          // neither grab it again nor fire a native release under the ray.
          if (data) { data.active = true; data.selectionCapture = []; data.captureConsumed = true; }
          return;
        }
        return original.apply(this, arguments);
      };
      this.productInput = {input, original, wrapper}; input.onSelectStart = wrapper;
    }
    this.productGripInputs = new Map();
    if (input && input.addEventListener) {
      const cancel = data => {
        if (data && data.controller) this.releaseHeldProducts(data.controller);
        const grip = this.productGripInputs.get(data && data.controller);
        if (grip) { grip.down = false; grip.product = null; }
        this.controlFeedback.forEach(entry => {
          const pressed = entry.controllers.delete(data && data.controller);
          entry.hovering.delete(data && data.controller);
          if (pressed && !entry.controllers.size) entry.until = 0;
        });
      };
      const connected = data => this.bindProductGrip(data);
      const disconnected = data => { cancel(data); this.unbindProductGrip(data && data.controller); };
      input.addEventListener('controllerConnected', connected);
      input.addEventListener('controllerDisconnected', disconnected);
      input.addEventListener('controllerInputCancelled', cancel);
      this.productDisconnectInput = {input, cancel, connected, disconnected};
      (input.controllers || []).forEach(connected);
    }
    const canvas = this.ctx.renderer && this.ctx.renderer.domElement;
    if (canvas && canvas.addEventListener && canvas.removeEventListener) {
      const handler = event => this.handleProductWheel(event);
      canvas.addEventListener('wheel', handler, {passive: false, capture: true});
      this.productWheelInput = {canvas, handler};
    }
  }

  bindProductGrip(data) {
    const controller = data && data.controller;
    if (!controller || data.desktop || controller.userData && controller.userData.isDesktop ||
      !controller.addEventListener || this.productGripInputs.has(controller)) return;
    const binding = {controller, down: false};
    binding.start = () => {
      const input = this.ctx.raycontrol;
      if (!this.running || this.ctx.drivingVehicle || !this.ctx.vrMode || this.ctx.studioMenuOpen || controller.userData && controller.userData.studioMenuTrigger || this.ctx.editor && this.ctx.editor.active ||
        !input || input.enabled === false || !data.enabled || data.active || binding.down || this.held.has(controller)) return;
      binding.down = true;
      const entries = input.selectionEntries ? input.selectionEntries(data) : [];
      const entry = entries.find(value => {
        const product = value.state && this.products.get(value.state.colliderMesh);
        return product && product.stateEntry && product.stateEntry.state === value.state;
      });
      if (!entry) return;
      const product = this.products.get(entry.state.colliderMesh);
      if (!this.validInteraction(product.object, entry.intersection, controller, true)) return;
      if (this.pickupProduct(product, controller, 'squeeze')) binding.product = product;
    };
    binding.end = () => {
      binding.down = false; binding.product = null;
      this.releaseHeldProducts(controller, 'squeeze');
    };
    controller.addEventListener('squeezestart', binding.start);
    controller.addEventListener('squeezeend', binding.end);
    this.productGripInputs.set(controller, binding);
  }

  unbindProductGrip(controller) {
    const bindings = this.productGripInputs, binding = bindings && bindings.get(controller);
    if (!binding) return;
    controller.removeEventListener('squeezestart', binding.start);
    controller.removeEventListener('squeezeend', binding.end);
    bindings.delete(controller);
  }

  restoreProductInput() {
    this.releaseHeldProducts();
    const binding = this.productInput;
    if (binding && binding.input.onSelectStart === binding.wrapper) binding.input.onSelectStart = binding.original;
    this.productInput = null;
    const disconnect = this.productDisconnectInput;
    if (disconnect) {
      disconnect.input.removeEventListener('controllerConnected', disconnect.connected);
      disconnect.input.removeEventListener('controllerDisconnected', disconnect.disconnected);
      disconnect.input.removeEventListener('controllerInputCancelled', disconnect.cancel);
    }
    this.productDisconnectInput = null;
    if (this.productGripInputs) Array.from(this.productGripInputs.keys()).forEach(controller => this.unbindProductGrip(controller));
    const wheel = this.productWheelInput;
    if (wheel) wheel.canvas.removeEventListener('wheel', wheel.handler, true);
    this.productWheelInput = null;
  }

  handleProductWheel(event) {
    if (!event || !this.running || this.ctx.vrMode || this.ctx.editor && this.ctx.editor.active || event.ctrlKey || event.metaKey ||
      typeof event.deltaY !== 'number' || !Number.isFinite(event.deltaY) || event.deltaY === 0) return false;
    let held = null;
    this.held.forEach((product, controller) => {
      if (controller === this.ctx.desktopController || controller.userData && controller.userData.isDesktop) held = product;
    });
    if (!held) return false;
    const mode = event.deltaMode || 0;
    if (![0, 1, 2].includes(mode)) return false;
    const canvas = this.productWheelInput && this.productWheelInput.canvas;
    const pixels = event.deltaY * (mode === 1 ? 16 : mode === 2 ? canvas && canvas.clientHeight || 800 : 1);
    const distance = Number.isFinite(held.holdDistance) ? held.holdDistance : PRODUCT_HOLD_DISTANCE;
    held.holdDistance = THREE.Math.clamp(distance + THREE.Math.clamp(pixels, -400, 400) * 0.0012, PRODUCT_HOLD_MIN, PRODUCT_HOLD_MAX);
    if (event.preventDefault) event.preventDefault();
    if (event.stopPropagation) event.stopPropagation();
    return true;
  }

  restoreProductCollision(product) {
    if (product.previousHeldFlag) Object.defineProperty(product.object, 'industrialHeld', product.previousHeldFlag);
    else delete product.object.industrialHeld;
    this.invalidateCollision(product.object);
  }

  pickupProduct(product, controller, inputMode = 'select') {
    if (!controller || product.heldBy || this.held.has(controller) || controller.userData && controller.userData.grabbing) return false;
    if (this.ctx.drivingVehicle || product.vehicleOwnerId || product.robotOwnerId || product.robotReservedBy || product.vehicleReservedBy) return false;
    if (!this.processorRuntime.canPickup(product)) return false;
    if (!this.palletQueueRuntime.canPickup(product)) { this.notify('Retira primero las cajas superiores de esta columna de la estiba.'); return false; }
    if (product.item && product.item.palletOwnerId) {
      const owner = this.records.get(product.item.palletOwnerId), belt = owner && owner.components.conveyor;
      const pallet = belt && belt.pallets.get(product.item.palletSide);
      if (pallet) {
        const perLayer = pallet.config.columns * pallet.config.rows, cell = product.item.palletSlot % perLayer;
        if (pallet.items.some(item => item !== product.item && item.palletSlot % perLayer === cell && item.palletSlot > product.item.palletSlot)) {
          this.notify('Retira primero las cajas superiores de esta columna del palet.');
          return false;
        }
      }
    }
    if (product.item && product.item.beltId) {
      const owner = this.records.get(product.item.beltId), belt = owner && owner.components.conveyor;
      if (belt) { belt.packages = belt.packages.filter(item => item !== product.item); belt.inFlight = belt.packages.length; }
      this.packageCount--; product.item.beltId = null;
    }
    this.palletQueueRuntime.picked(product);
    if (product.item && product.item.palletOwnerId) {
      const owner = this.records.get(product.item.palletOwnerId), belt = owner && owner.components.conveyor;
      const pallet = belt && belt.pallets.get(product.item.palletSide);
      if (pallet) {
        pallet.items = pallet.items.filter(item => item !== product.item);
        pallet.blocked = false; pallet.retryAt = 0;
      }
      product.item.palletOwnerId = null; product.item.palletSlot = null;
      if (belt) this.refreshPalletState(owner, belt);
    }
    updateTree(product.object);
    const matrix = product.object.matrixWorld.clone(), root = this.document.getRoot && this.document.getRoot(this.roomId) || this.ctx.scene;
    if (root && root !== product.object.parent) { root.add(product.object); this.setProductMatrix(product, matrix); }
    // Freeze the full world basis, including an authored rotation/nonuniform
    // parent transform. Looking down or twisting a controller only moves it.
    product.holdMatrix = matrix.clone(); product.holdDistance = PRODUCT_HOLD_DISTANCE;
    product.heldBy = controller; product.holdInput = inputMode === 'squeeze' ? 'squeeze' : 'select'; this.held.set(controller, product);
    Object.defineProperty(product.object, 'industrialHeld', {value: true, configurable: true, writable: true, enumerable: false});
    this.sourceRuntime.picked(product);
    this.processorRuntime.picked(product);
    this.invalidateCollision(product.object);
    this.productFeedback.hold(product.object);
    this.pulse(controller, 0.25, 45);
    this.event(product.record ? product.record.id : 'simulation', 'product-picked', this.ctx.vrMode ?
      'Caja agarrada. Gatillo: pulsar de nuevo para soltar. Agarre: mantener y soltar.' : 'Caja agarrada. Rueda: acercar / alejar. Vuelve a pulsar para soltarla.');
    this.refreshVariables();
    return true;
  }

  setProductMatrix(product, matrix) {
    const object = product.object;
    if (object.parent) {
      object.parent.updateWorldMatrix(true, false);
      object.matrix.copy(new THREE.Matrix4().getInverse(object.parent.matrixWorld)).multiply(matrix);
    } else object.matrix.copy(matrix);
    object.matrixAutoUpdate = false;
    object.matrix.decompose(object.position, object.quaternion, object.scale);
    object.matrixWorld.copy(matrix); object.updateMatrixWorld(true);
    this.invalidateCollision(object);
  }

  productCollisionOptions(product, controller) {
    const options = this.packageCollisionOptions({object: product.object}, product.item || {mesh: product.object});
    if (controller) options.ignore.push(controller);
    return options;
  }

  findProductPlacement(product, controller = product.heldBy) {
    const world = this.ctx.collisionWorld;
    if (!world) return null;
    updateTree(product.object);
    const processorInput = this.processorRuntime.findInput(product, PRODUCT_PREVIEW_DISTANCE);
    if (processorInput && processorInput.accepted) return processorInput;
    const palletPlacement = this.palletQueueRuntime.findPlacement(product, PRODUCT_PREVIEW_DISTANCE);
    if (palletPlacement && palletPlacement.accepted) return palletPlacement;
    const options = this.productCollisionOptions(product, controller);
    const beltCandidate = this.findProductBelt(product, PRODUCT_PREVIEW_DISTANCE);
    if (beltCandidate) {
      const {record, belt, offset, lateral, route} = beltCandidate;
      if (belt.packages.length < belt.config.maxPackages && this.packageCount < MAX_PACKAGES) {
        const item = Object.assign({}, product.item || {}, {mesh: product.object, bounds: product.bounds, scale: product.scale, route, lateral});
        const matrix = this.packageMatrix(record, belt, offset, item);
        const bounds = product.bounds.clone().applyMatrix4(matrix);
        const collision = this.packageCollisionOptions(record, item); collision.ignore.push(product.object);
        if (controller) collision.ignore.push(controller);
        const current = product.bounds.clone().applyMatrix4(product.object.matrixWorld);
        const distance = current.getCenter(new THREE.Vector3()).distanceTo(bounds.getCenter(new THREE.Vector3()));
        if (distance <= PRODUCT_PREVIEW_DISTANCE && !world.testBox(bounds, collision)) {
          return {matrix, bounds, target: record.object, kind: 'top', distance,
            normal: this.pathUp(record), point: bounds.getCenter(new THREE.Vector3()).setY(bounds.min.y),
            snapped: distance <= PRODUCT_PLACEMENT_DISTANCE, belt: beltCandidate};
        }
      }
    }
    if (!this.objectPlacement || this.objectPlacement.world !== world) this.objectPlacement = new ObjectPlacement(world);
    const candidate = this.objectPlacement.find(product.object, {bounds: product.bounds, matrix: product.object.matrixWorld,
      ignore: [product.object, controller].filter(Boolean), extraBoxes: options.extraBoxes, surfaceDistance: PRODUCT_PLACEMENT_DISTANCE,
      previewDistance: PRODUCT_PREVIEW_DISTANCE, allowSides: false});
    // A pallet or preparation table is a free support even when it belongs to
    // a conveyor. Its transport surface must use the authoritative belt path,
    // source/line permissions, capacity and counters checked above.
    let support = false;
    for (let node = candidate && candidate.target; node; node = node.parent) {
      if (node.userData.industrialPallet || node.name === 'Mesa de carga manual') support = true;
      const record = this.records.get(node.userData.editorId);
      if (record && record.components.conveyor) return support ? candidate : null;
    }
    return candidate;
  }

  updateProductPlacement(product, controller) {
    const candidate = this.findProductPlacement(product, controller);
    this.productFeedback.placement(product.object, candidate);
    return candidate;
  }

  updateHeldProducts() {
    this.held.forEach((product, controller) => {
      controller.updateWorldMatrix(true, false);
      updateTree(product.object);
      const previous = product.bounds.clone().applyMatrix4(product.object.matrixWorld);
      const distance = product.holdDistance || PRODUCT_HOLD_DISTANCE;
      const matrix = (product.holdMatrix || product.object.matrixWorld).clone();
      let position;
      const desktop = controller === this.ctx.desktopController || controller.userData && controller.userData.isDesktop;
      if (desktop && this.ctx.camera) {
        // Desktop interaction aims through the central camera reticle. The
        // virtual hand is offset for native grabbing, so use its depth only.
        const camera = this.ctx.camera; camera.updateWorldMatrix(true, false);
        const eye = camera.getWorldPosition(new THREE.Vector3());
        const forward = new THREE.Vector3(0, 0, -1).transformDirection(camera.matrixWorld);
        const handDepth = Math.max(0, controller.getWorldPosition(new THREE.Vector3()).sub(eye).dot(forward));
        const center = eye.addScaledVector(forward, handDepth + distance);
        const centerOffset = product.bounds.getCenter(new THREE.Vector3()).applyMatrix3(new THREE.Matrix3().setFromMatrix4(matrix));
        position = center.sub(centerOffset);
      } else position = new THREE.Vector3(0, -0.025, -distance).applyMatrix4(controller.matrixWorld);
      matrix.setPosition(position);
      const desiredBox = product.bounds.clone().applyMatrix4(matrix);
      const movement = desiredBox.getCenter(new THREE.Vector3()).sub(previous.getCenter(new THREE.Vector3()));
      const world = this.ctx.collisionWorld;
      if (world) {
        const options = this.productCollisionOptions(product, controller);
        const result = world.sweepBox(previous, movement, options);
        position.add(result.movement).sub(movement);
        matrix.setPosition(position);
        // A contact can still be obstructed by a moving scene object. Retain
        // the last valid pose rather than entering a solid surface.
        if (world.testBox(product.bounds.clone().applyMatrix4(matrix), options)) {
          this.updateProductPlacement(product, controller);
          return;
        }
      }
      this.setProductMatrix(product, matrix);
      this.updateProductPlacement(product, controller);
    });
  }

  findProductBelt(product, tolerance = 0.6) {
    updateTree(product.object);
    const center = product.bounds.clone().applyMatrix4(product.object.matrixWorld).getCenter(new THREE.Vector3());
    const size = product.bounds.getSize(new THREE.Vector3()).multiply(product.scale);
    size.set(Math.abs(size.x), Math.abs(size.y), Math.abs(size.z));
    let candidate = null;
    this.records.forEach(record => {
      const belt = record.components.conveyor;
      if (!belt || !visible(record.object)) return;
      if (product.sourceId && product.sourceId !== record.id) {
        const line = this.scopeLookup.get(product.sourceId + '/line');
        if (!line || !line.members.has(record.id)) return;
      }
      const rotation = record.object.getWorldQuaternion(new THREE.Quaternion());
      const local = center.clone().sub(record.object.getWorldPosition(new THREE.Vector3())).applyQuaternion(rotation.clone().inverse());
      if (record.object.userData.editorPrefabKey === 'conveyor') {
        const authoredLocal = center.clone().applyMatrix4(new THREE.Matrix4().getInverse(record.object.matrixWorld));
        local.x = authoredLocal.x; local.z = authoredLocal.z;
        local.y = center.clone().sub(record.object.getWorldPosition(new THREE.Vector3())).dot(this.pathUp(record));
      }
      const routes = conveyorLayout ? conveyorLayout.pathBranches(belt.config) : ['main'];
      routes.forEach(route => {
        const projection = conveyorLayout ? conveyorLayout.closestPath(belt.config, local.x, local.z, route) :
          {distance: local[belt.config.axis] + belt.config.length / 2, lateral: local[belt.config.axis === 'x' ? 'z' : 'x']};
        const length = this.pathLength(belt.config, route);
        const nearest = this.pathPoint(belt.config, projection.distance, route);
        const beyond = (local.x - nearest.x) * nearest.tx + (local.z - nearest.z) * nearest.tz;
        const tangentScale = this.tangentScale(record, nearest), widthScale = this.widthScale(record, nearest);
        const surfaceHeight = this.pathSurface(record, belt, nearest, projection.lateral).sub(record.object.getWorldPosition(new THREE.Vector3())).dot(this.pathUp(record));
        if (projection.distance <= 0.001 && beyond * tangentScale < -0.1 || projection.distance >= length - 0.001 && beyond * tangentScale > 0.1) return;
        const footprint = Math.max(size.x, size.z);
        if (projection.distance < -0.1 || projection.distance > length + 0.1 || Math.abs(projection.lateral) * widthScale + footprint / 2 > belt.config.width * widthScale / 2 + 0.02 ||
          Math.abs(local.y - surfaceHeight - size.y / 2) > tolerance) return;
        if (!this.productCompatible(record, belt, product, false)) return;
        const score = Math.abs(local.y - surfaceHeight - size.y / 2) + Math.abs(projection.lateral) * 0.05;
        if (!candidate || score < candidate.score) candidate = {record, belt, offset: projection.distance - length / 2, lateral: projection.lateral, route, score};
      });
    });
    return candidate;
  }

  releaseProduct(product, force = false) {
    if (!product.heldBy) return false;
    const controller = product.heldBy;
    const placement = this.findProductPlacement(product, controller);
    const processorInput = this.processorRuntime.findInput(product);
    const palletPlacement = this.palletQueueRuntime.findPlacement(product);
    let onPallet = false;
    if (!processorInput && palletPlacement) {
      if (palletPlacement.accepted) onPallet = this.palletQueueRuntime.receiveManual(product, palletPlacement);
      if (!onPallet && !force) { this.notify('La estiba no tiene una celda disponible para esta carga.'); return false; }
    }
    let onProcessor = false;
    if (processorInput) {
      onProcessor = this.processorRuntime.receiveManual(product, processorInput);
      if (!onProcessor && !force) { this.notify('No hay espacio disponible en la entrada del proceso.'); return false; }
    }
    let candidate = this.findProductBelt(product);
    if (onProcessor || onPallet) candidate = null;
    if (candidate && !this.captureProduct(product, candidate)) {
      if (!force) { this.notify('No hay espacio libre para colocar la caja en la banda.'); return false; }
      candidate = null;
    }
    this.held.delete(product.heldBy); product.heldBy = null; product.holdInput = null;
    this.restoreProductCollision(product);
    this.productFeedback.release(product.object);
    this.pulse(controller, 0.15, 25);
    if (!candidate && !onProcessor && !onPallet) {
      // A loose product settles onto the first solid surface below it. The
      // shared sweep prevents it from falling through floors or other boxes.
      const world = this.ctx.collisionWorld;
      if (placement && placement.snapped) this.setProductMatrix(product, placement.matrix);
      else if (world) {
        const bounds = product.bounds.clone().applyMatrix4(product.object.matrixWorld);
        const result = world.sweepBox(bounds, new THREE.Vector3(0, -3, 0), this.productCollisionOptions(product, controller));
        if (result.blocked) {
          const matrix = product.object.matrixWorld.clone();
          matrix.setPosition(new THREE.Vector3().setFromMatrixPosition(matrix).add(result.movement));
          this.setProductMatrix(product, matrix);
        }
      }
    }
    this.event(product.record ? product.record.id : 'simulation', 'product-released', onPallet ? 'Carga apilada en la estiba.' : onProcessor ? 'Carga colocada en la entrada del proceso.' : candidate ? 'Caja colocada en la banda.' : 'Caja soltada.');
    this.refreshVariables();
    return true;
  }

  releaseHeldProducts(controller, inputMode) {
    Array.from(this.held.entries()).forEach(([owner, product]) => {
      if ((!controller || owner === controller) && (!inputMode || product.holdInput === inputMode)) this.releaseProduct(product, true);
    });
  }

  onInputModeChange() {
    this.releaseHeldProducts();
    if (this.productGripInputs) this.productGripInputs.forEach(binding => { binding.down = false; binding.product = null; });
    this.controlFeedback.forEach(entry => { entry.controllers.clear(); entry.hovering.clear(); entry.until = 0; });
    const input = this.ctx.raycontrol;
    if (input && input.cancelSelect) input.controllers.forEach(data => input.cancelSelect(data));
  }

  captureProduct(product, candidate, receivingIgnore = []) {
    const {record, belt, offset, lateral} = candidate;
    if (!this.productCompatible(record, belt, product) || !this.admissionReady(record, belt, false)) return false;
    if (belt.packages.length >= belt.config.maxPackages || this.packageCount >= MAX_PACKAGES) return false;
    const existingItem = product.item;
    let item = Object.assign({}, existingItem || {mesh: product.object, authored: !!product.record, product,
      box: new THREE.Box3(), previous: new THREE.Box3(), swept: new THREE.Box3()});
    let decision = product.routingDecisions.get(record.id) || this.routeDecision(belt, product);
    let route = candidate.route || decision.route, resolvedOffset = offset;
    if (belt.config.layout === 'tee' && belt.config.junctionMode !== 'merge') {
      const distance = offset + this.pathLength(belt.config, route) / 2;
      const main = this.pathPoint(belt.config, distance, 'main'), branch = this.pathPoint(belt.config, distance, 'branch');
      if (Math.hypot(main.x - branch.x, main.z - branch.z) < 0.0001) {
        route = decision.route;
        resolvedOffset = distance - this.pathLength(belt.config, route) / 2;
      } else decision = {route, reason: 'manual', ruleIndex: -1};
    }
    Object.assign(item, {offset: resolvedOffset, lateral, route, bounds: product.bounds, scale: product.scale, exited: false, blocked: false, palletOwnerId: null, palletSlot: null,
      mechanismStage: 'receive', mechanismElapsed: 0, mechanismHeight: 0, gravityVelocity: product.classification.initialVelocity || 0});
    item.mechanismYaw = belt.config.junctionMode === 'merge' && route === 'branch' ? (belt.config.branchSide === 'left' ? 1 : -1) * (belt.config.mergeAngle || 45) * Math.PI / 180 : 0;
    const matrix = this.packageMatrix(record, belt, item.offset, item);
    const world = this.ctx.collisionWorld;
    // A carrier may supply its fork mesh only after validating both tines in
    // the final pallet pockets. Keep all chassis, mast and receiver collisions.
    const options = this.packageCollisionOptions(record, item); options.ignore.push(product.object, ...receivingIgnore);
    if (world && world.testBox(item.bounds.clone().applyMatrix4(matrix), options)) return false;
    if (existingItem) { Object.assign(existingItem, item); item = existingItem; }
    belt.helper.add(item.mesh); item.beltId = record.id;
    product.item = item;
    this.positionPackage(record, belt, item, matrix);
    item.previous.copy(item.box); item.swept.copy(item.box);
    belt.packages.push(item); this.packageCount++; belt.inFlight = belt.packages.length;
    if (!product.enteredBelts.has(record.id)) {
      product.enteredBelts.add(record.id); belt.entryCount++; belt.entryUnits += this.productMetadata(product).units;
      this.commitRoute(record, belt, product, decision);
      this.scopeMovement(product, product.scopeOwnerId, record.id);
      this.event(record.id, 'package-entry', 'Entrada manual de caja ' + belt.entryCount + '.');
    }
    return true;
  }

  measureBelt(record) {
    const belt = record.components.conveyor;
    updateTree(record.object);
    let surface;
    record.object.traverse(node => {
      if (surface === undefined && typeof node.userData.editorConveyorTop === 'number' && Number.isFinite(node.userData.editorConveyorTop)) {
        surface = node.localToWorld(new THREE.Vector3(0, node.userData.editorConveyorTop, 0));
      }
    });
    const origin = record.object.getWorldPosition(new THREE.Vector3());
    const up = this.pathUp(record);
    belt.top = surface ? surface.clone().sub(origin).dot(up) : Math.max(0, actorBounds(record.object).max.y - origin.y);
  }

  setupPallet(record) {
    const belt = record.components.conveyor;
    // Pallets are independent machines. Keep this legacy entry point inert so
    // an old saved marker can never revive automatic endpoint pallets.
    if (!belt) return;
    belt.palletTemplate = null; belt.palletTemplates = new Map();
    belt.palletCount = 0; belt.palletCapacity = 0; belt.palletFull = false;
  }

  palletFor(record, belt, side, route = 'main') {
    if (!belt.palletTemplate) return null;
    if (belt.config.junctionMode === 'merge') route = 'main';
    const template = belt.palletTemplates && belt.palletTemplates.get(route);
    if (!template) return null;
    side = side < 0 ? -1 : 1;
    const key = route + ':' + belt.config.axis + ':' + side;
    if (belt.pallets.has(key)) return belt.pallets.get(key);
    let object = template.object, runtimeClone = false;
    if (!template.pathAware && belt.config.axis !== 'x' || side < 0) {
      // Reversing a machine must not drag an already loaded pallet across the
      // scene. Keep its stacks and add a physical receiving pallet at that exit.
      object = template.object.clone(true); object.name = 'Palet de salida ' + (side < 0 ? 'inversa' : 'Z');
      object.userData.editorRuntimeHelper = true;
      object.traverse(node => { if (node.isMesh) node.userData.editorCollisionBody = true; });
      object.position.copy(template.position); object.quaternion.copy(template.quaternion); object.scale.copy(template.scale);
      if (template.pathAware) {
        const point = this.pathPoint(belt.config, -1.6, route);
        object.position.set(point.x, template.position.y, point.z);
        object.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-point.tz, point.tx) || 0);
      } else if (belt.config.axis === 'z') {
        object.position.set(template.position.z, template.position.y, Math.abs(template.position.x) * side);
        object.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2));
      } else object.position.x = Math.min(-Math.abs(template.position.x), template.baseBounds.min.x - template.config.width * Math.abs(template.scale.x) / 2 - 0.1);
      record.object.add(object); runtimeClone = true;
      updateTree(object); this.invalidateCollision(object);
    }
    const pallet = {key, side, object, runtimeClone, config: template.config, items: [], blocked: false, retryAt: 0};
    belt.pallets.set(key, pallet);
    return pallet;
  }

  refreshPalletState(record, belt) {
    const current = this.palletFor(record, belt, Math.sign(belt.speed || 1), belt.packages[0] && belt.packages[0].route || 'main');
    let count = 0, capacity = 0;
    belt.pallets.forEach(pallet => { count += pallet.items.length; capacity += pallet.config.capacity; });
    belt.palletCount = count; belt.palletCapacity = capacity;
    belt.palletFull = !!current && (current.items.length >= current.config.capacity || current.blocked);
    belt.actualSpeed = this.beltSpeed(record, belt);
  }

  palletMatrix(pallet, item, slot) {
    const config = pallet.config, perLayer = config.columns * config.rows;
    const cell = slot % perLayer, column = cell % config.columns, row = Math.floor(cell / config.columns), layer = Math.floor(slot / perLayer);
    updateTree(pallet.object);
    const rotation = pallet.object.getWorldQuaternion(new THREE.Quaternion());
    const palletScale = pallet.object.getWorldScale(new THREE.Vector3());
    const physical = item.bounds.getSize(new THREE.Vector3()).multiply(item.scale);
    physical.set(Math.abs(physical.x), Math.abs(physical.y), Math.abs(physical.z));
    const margin = Number.isFinite(config.fitMargin) ? config.fitMargin : .01;
    if (physical.x + margin > config.width * Math.abs(palletScale.x) / config.columns + 1e-6 ||
      physical.z + margin > config.depth * Math.abs(palletScale.z) / config.rows + 1e-6) return null;
    let height = 0;
    for (let lower = 0; lower < layer; lower++) {
      const support = pallet.items.find(entry => entry.palletSlot === lower * perLayer + cell);
      if (!support) return null;
      height += support.stackHeight + 0.005;
    }
    const local = new THREE.Vector3(-config.width / 2 + (column + 0.5) * config.width / config.columns,
      config.top, -config.depth / 2 + (row + 0.5) * config.depth / config.rows);
    const center = item.bounds.getCenter(new THREE.Vector3()).multiply(item.scale);
    const offset = new THREE.Vector3(-center.x, height + 0.005 - Math.min(item.bounds.min.y * item.scale.y, item.bounds.max.y * item.scale.y), -center.z);
    const position = pallet.object.localToWorld(local).add(offset.applyQuaternion(rotation));
    return {matrix: new THREE.Matrix4().compose(position, rotation, item.scale), height: physical.y};
  }

  stackPackage(record, belt, item) {
    const pallet = this.palletFor(record, belt, Math.sign(item.offset || belt.speed || 1), item.route);
    if (!pallet) return null;
    if (pallet.items.length >= pallet.config.capacity || pallet.retryAt > this.time) return false;
    const occupied = new Set(pallet.items.map(entry => entry.palletSlot));
    for (let slot = 0; slot < pallet.config.capacity; slot++) {
      if (occupied.has(slot)) continue;
      const target = this.palletMatrix(pallet, item, slot);
      if (!target) continue;
      const world = this.ctx.collisionWorld, options = this.packageCollisionOptions(record, item);
      // The pallet may sit near an input table or another part of its own
      // machine. Only transport ignores the complete conveyor hierarchy.
      options.ignore = options.ignore.filter(object => object !== record.object);
      options.ignore.push(item.mesh);
      if (world && world.testBox(item.bounds.clone().applyMatrix4(target.matrix), options)) continue;
      this.positionPackage(record, belt, item, target.matrix);
      Object.assign(item, {palletOwnerId: record.id, palletSide: pallet.key, palletSlot: slot, stackHeight: target.height, beltId: null});
      item.previous.copy(item.box); item.swept.copy(item.box);
      pallet.items.push(item); pallet.blocked = false; pallet.retryAt = 0;
      if (item.product) item.product.enteredBelts.delete(record.id);
      this.refreshPalletState(record, belt);
      this.event(record.id, 'package-stacked', 'Caja apilada en el palet: ' + belt.palletCount + '.');
      return true;
    }
    pallet.blocked = true; pallet.retryAt = this.time + 0.2;
    this.refreshPalletState(record, belt);
    return false;
  }

  event(objectId, type, message) {
    const event = {id: this.runSequence + ':' + (++this.eventSequence), time: this.time, objectId, type, message: String(message).slice(0, 1000)};
    this.events.push(event);
    if (this.events.length > 200) this.events.shift();
    if (typeof this.onEvent === 'function') this.onEvent(Object.assign({}, event));
  }

  warn(record, key, message) {
    if (record.warned.has(key)) return;
    record.warned.add(key); this.notify(message); this.event(record.id, 'configuration-warning', message);
  }

  validateVariable(record, key, value) {
    const vehicle = record && record.components.vehicle;
    if (vehicle && key === 'running' && value && (vehicle.emergency || !vehicle.powered)) throw new Error('Enciende y rearma el vehículo antes de habilitarlo.');
    const robot = record && record.components.robot;
    if (robot && key === 'running' && value && robot.emergency) throw new Error('Restablece la emergencia antes de arrancar el robot.');
    if (robot && key === 'running' && value && !robot.powered) throw new Error('Enciende la alimentación antes de arrancar el robot.');
    if (robot && key === 'running' && value && robot.fault) throw new Error('Rearma la alarma del robot antes de arrancar.');
    if (!record) throw new Error('El objeto no participa en la simulación actual.');
    const field = record.writable.find(item => item.key === key);
    if (!field) throw new Error('La variable es de solo lectura o no existe.');
    if (typeof value !== field.type || typeof value === 'number' && (!Number.isFinite(value) || value < field.min || value > field.max)) {
      throw new Error('Valor inválido para ' + field.label + '.');
    }
    const belt = record.components.conveyor;
    if (belt && belt.config.drive !== 'motor' && key === 'paused' && !value && belt.emergency) throw new Error('Restablece la parada de emergencia antes de liberar los rodillos.');
    if (belt && key === 'speed' && belt.config.equipmentId) {
      const definition = behaviorSchema.conveyorEquipment.getDefinition(belt.config.equipmentId), parameter = definition.parameters.find(item => item.key === 'speed');
      if (parameter && (value < parameter.min || value > parameter.max)) throw new Error('La velocidad está fuera del intervalo de esta variante.');
    }
    if (belt && key === 'running' && value && belt.emergency) {
      throw new Error('Restablece la parada de emergencia antes de arrancar la banda.');
    }
    if (belt && key === 'running' && value && !belt.powered) throw new Error('Enciende la alimentación antes de arrancar la banda.');
    const processor = record.components.processor;
    if (processor && key === 'running' && value && processor.emergency) throw new Error('Restablece la parada de emergencia antes de arrancar el proceso.');
    if (processor && key === 'running' && value && !processor.powered) throw new Error('Enciende la alimentación antes de arrancar el proceso.');
    const inventory = record.components.source || record.components.palletQueue;
    if (inventory && key === 'running' && value && inventory.emergency) throw new Error('Restablece la parada de emergencia de la línea antes de arrancar.');
    if (inventory && key === 'running' && value && inventory.powered === false) throw new Error('Enciende la alimentación de la línea antes de arrancar.');
  }

  setVariable(id, key, value) {
    const record = this.records.get(id);
    this.validateVariable(record, key, value);
    const belt = record.components.conveyor;
    let changed = false;
    Object.values(record.components).forEach(component => {
      if (Object.prototype.hasOwnProperty.call(component, key) && component[key] !== value) { component[key] = value; changed = true; }
    });
    const inventory = record.components.source || record.components.palletQueue;
    if (inventory && (key === 'powered' && !value || key === 'emergency' && value)) { inventory.running = false; inventory.paused = false; }
    const robot = record.components.robot;
    if (robot) {
      if (key === 'emergency' && value || key === 'powered' && !value) robot.running = false;
      if (key === 'emergency' && !value) robot.fault = '';
      if (key === 'running' || key === 'powered' && !value || key === 'emergency' && value) robot.paused = false;
    }
    const vehicle = record.components.vehicle;
    if (vehicle) {
      if (key === 'running' && value) { vehicle.missionObstacle = false; vehicle.blocked = false; }
      if (key === 'emergency' && value || key === 'powered' && !value) { vehicle.running = false; vehicle.actualSpeed = 0; this.vehicleRuntime.setInput(record, {brake: 1}); }
      if (key === 'running' || key === 'emergency' && value || key === 'powered' && !value) vehicle.paused = false;
    }
    if (belt) {
      // Emergency is latched: releasing it permits a later explicit Start,
      // but must never restart machinery as a side effect of the reset.
      if ((key === 'emergency' && value || key === 'powered' && !value) && belt.running) {
        belt.running = false;
        this.event(id, 'variable-change', 'running = false (' + (key === 'emergency' ? 'parada de emergencia' : 'apagado') + ')');
      }
      if (key === 'running' && !value || key === 'powered' && !value || key === 'emergency' && value) belt.paused = belt.config.drive !== 'motor';
      if (key === 'running' && value) belt.paused = false;
      if (key === 'speed') this.refreshPalletState(record, belt);
      belt.actualSpeed = this.beltSpeed(record, belt);
      this.updateSupplyState(belt);
    }
    const processor = record.components.processor;
    if (processor) {
      if (key === 'emergency' && value || key === 'powered' && !value) processor.running = false;
      if (key === 'running' || key === 'powered' && !value || key === 'emergency' && value) processor.paused = false;
    }
    const palletQueue = record.components.palletQueue;
    if (palletQueue && key === 'running') palletQueue.paused = false;
    const source = record.components.source;
    if (source && key === 'running') source.paused = false;
    this.refreshVariables();
    if (changed) this.event(id, 'variable-change', key + ' = ' + value);
    return true;
  }

  execute(delta) {
    if (!this.running || this.ctx.editor && this.ctx.editor.active || typeof delta !== 'number' || !Number.isFinite(delta) || delta <= 0) return;
    const elapsed = Math.min(delta, MAX_FRAME);
    this.droppedSeconds += Math.max(0, delta - elapsed);
    let remaining = elapsed;
    const world = this.ctx.collisionWorld;
    const ownsFrame = world && world.beginFrame && world.endFrame && !world.frameActive;
    if (ownsFrame) world.beginFrame();
    try {
      this.updateHeldProducts();
      while (remaining > 1e-10) {
        const step = Math.min(remaining, STEP);
        this.time += step;
        this.records.forEach(record => this.move(record, step));
        this.syncActorMatrices();
        this.sourceRuntime.step(step);
        this.processorRuntime.step(step);
        this.palletQueueRuntime.step(step);
        if (this.robotRuntime) this.robotRuntime.step(step);
        if (this.vehicleRuntime) this.vehicleRuntime.step(step);
        this.records.forEach(record => this.transport(record, step));
        this.scopeGroups.forEach(group => {
          if (group.memberIds.some(id => this.records.get(id).components.conveyor.actualSpeed !== 0)) group.runSeconds += step;
        });
        this.records.forEach(record => this.detect(record));
        this.refreshVariables();
        this.automate();
        this.observeProduction(step); this.productionAnalytics.sample(this.time);
        remaining -= step;
      }
    } finally {
      this.productFeedback.update(elapsed);
      if (ownsFrame) world.endFrame();
    }
  }

  syncActorMatrices() {
    // A static PLC or conveyor can contain hundreds of cosmetic meshes. The
    // fixed simulation step only needs to propagate a changed actor transform;
    // machinery runtimes already update their articulated/load transforms.
    // Check every actor (including nested sensors/motion actors), so moving a
    // parent, reparenting a load or adding a new child is observed immediately.
    this.records.forEach(record => {
      const object = record.object;
      object.updateWorldMatrix(true, false);
      let saved = this.actorMatrices.get(object);
      const elements = object.matrixWorld.elements;
      let changed = !saved || saved.parent !== object.parent || saved.children !== object.children.length;
      if (!changed) for (let index = 0; index < 16; index++) if (saved.matrix[index] !== elements[index]) { changed = true; break; }
      if (!changed) return;
      object.updateWorldMatrix(false, true);
      if (!saved) { saved = {matrix: new Array(16)}; this.actorMatrices.set(object, saved); }
      for (let index = 0; index < 16; index++) saved.matrix[index] = elements[index];
      saved.parent = object.parent; saved.children = object.children.length;
    });
  }

  invalidateCollision(object) {
    const world = this.ctx.collisionWorld;
    if (world && world.invalidate) world.invalidate(object);
  }

  move(record, delta) {
    const motion = record.components.motion;
    if (!motion || !motion.enabled || !visible(record.object)) return;
    motion.elapsed += delta;
    const config = motion.config;
    const world = this.collisionWorld(record.object);
    const previousPhase = motion.position;
    const phaseDelta = delta * motion.speed;
    if (!phaseDelta) return;
    if (config.mode === 'rotation') {
      const axis = new THREE.Vector3(); axis[config.axis] = 1;
      // Checking intermediate orientations prevents a long, thin actor from
      // rotating through an obstacle and ending on its other side in one step.
      const subdivisions = Math.max(1, Math.ceil(Math.abs(phaseDelta) / MAX_ROTATION_STEP));
      const rotation = new THREE.Quaternion().setFromAxisAngle(axis, phaseDelta / subdivisions);
      const previous = new THREE.Quaternion();
      for (let index = 0; index < subdivisions; index++) {
        previous.copy(record.object.quaternion);
        record.object.quaternion.multiply(rotation);
        this.invalidateCollision(record.object);
        if (world && !world.canPlaceObject(record.object, {ignore: [record.object]})) {
          record.object.quaternion.copy(previous);
          updateTree(record.object);
          this.invalidateCollision(record.object);
          break;
        }
        motion.position += phaseDelta / subdivisions;
      }
    } else {
      const offset = new THREE.Vector3();
      offset[config.axis] = config.mode === 'oscillate' ?
        (Math.sin(previousPhase + phaseDelta) - Math.sin(previousPhase)) * config.amplitude : phaseDelta;
      offset.applyQuaternion(record.quaternion);
      // Integrate from the resolved pose. A blocked actor must never accumulate
      // a distant target that would make it jump when the obstacle is removed.
      const desired = record.object.position.clone().add(offset);
      const result = world && world.moveObject(record.object, desired, {ignore: [record.object]});
      record.object.position.copy(result ? result.position : desired);
      this.invalidateCollision(record.object);
      motion.position += config.mode === 'oscillate' || !result ? phaseDelta : phaseDelta * result.fraction;
    }
  }

  collisionWorld(object) {
    const world = this.ctx.collisionWorld;
    return world && (!world.isSolid || world.isSolid(object)) ? world : null;
  }

  packageCollisionOptions(record, excluded) {
    const ignore = [record.object], extraBoxes = [];
    // During an accepted handoff both decks support the same body. Their broad
    // AABBs overlap on inclines; inventory collisions remain explicit below.
    const previous = excluded && excluded.transferSourceId && this.records.get(excluded.transferSourceId);
    if (previous && excluded.beltId === record.id && excluded.offset < -this.pathLength(record.components.conveyor.config, excluded.route) / 2 +
      Math.max(excluded.bounds.getSize(new THREE.Vector3()).x * Math.abs(excluded.scale.x), .3)) ignore.push(previous.object);
    this.records.forEach(source => {
      const belt = source.components.conveyor;
      const palletQueue = source.components.palletQueue;
      if (palletQueue) palletQueue.items.forEach(item => {
        ignore.push(item.mesh);
        if (item !== excluded && visible(item.mesh) && this.collisionWorld(item.mesh)) extraBoxes.push(item.box);
      });
      if (!belt) return;
      belt.packages.forEach(item => {
        ignore.push(item.mesh);
        // Dynamic packages are tested using their current boxes rather than a
        // collision-world snapshot from earlier in this fixed simulation step.
        if (item !== excluded && visible(item.mesh) && this.collisionWorld(item.mesh)) extraBoxes.push(item.box);
      });
      belt.pallets.forEach(pallet => pallet.items.forEach(item => {
        ignore.push(item.mesh);
        if (item !== excluded && visible(item.mesh) && this.collisionWorld(item.mesh)) extraBoxes.push(item.box);
      }));
    });
    // Retained products can also be left loose beside a pallet. Keep them in
    // the dynamic obstacle set, or collision snapshots would skip their body
    // while testing the explicitly supplied package boxes.
    this.products.forEach(product => {
      const item = product.item;
      // A station's own FIFO is internal inventory. Receiving another load at
      // its intake must not collide with that station's displayed first load.
      if (product.processorLocked && product.processorOwnerId === record.id) return;
      if (item && (item === excluded || item.beltId || item.palletOwnerId) ||
        excluded && excluded.mesh === product.object || !visible(product.object) || !product.heldBy && !product.robotOwnerId && !product.vehicleOwnerId && !this.collisionWorld(product.object)) return;
      updateTree(product.object);
      ignore.push(product.object);
      extraBoxes.push(product.bounds.clone().applyMatrix4(product.object.matrixWorld));
    });
    return {ignore, extraBoxes};
  }

  spawn(record, belt, reserved = false) {
    if (belt.externalSupply) return false;
    if (!this.admissionReady(record, belt, false) || !this.productCompatible(record, belt, null)) return false;
    const reservation = reserved && belt.pendingInsert > 0 ? 1 : 0;
    if (belt.packages.length >= belt.config.maxPackages || this.packageCount >= MAX_PACKAGES || this.sourceRuntime.liveLoads() - reservation >= MAX_PACKAGES) return false;
    const decision = this.routeDecision(belt), route = decision.route, offset = -Math.sign(belt.speed || 1) * this.pathLength(belt.config, route) / 2;
    const matrix = this.packageMatrix(record, belt, offset, {route});
    const world = this.collisionWorld(record.object);
    // An occupied entry is normal when packages queue. Test its prospective
    // volume before allocating GPU geometry/materials for another package.
    if (world && world.testBox(PACKAGE_BOUNDS.clone().applyMatrix4(matrix), this.packageCollisionOptions(record))) return false;
    const mesh = createProductVisual(PACKAGE_SIZE);
    mesh.userData.editorRuntimeHelper = true; mesh.userData.editorCollisionBody = true;
    mesh.matrixAutoUpdate = false; mesh.name = 'Paquete ' + (belt.entryCount + 1);
    belt.helper.add(mesh);
    const item = {mesh, offset, route, beltId: record.id, bounds: PACKAGE_BOUNDS.clone(), scale: IDENTITY_SCALE.clone(),
      box: new THREE.Box3(), previous: new THREE.Box3(), swept: new THREE.Box3(), mechanismStage: 'receive', mechanismElapsed: 0,
      mechanismHeight: 0, gravityVelocity: 0};
    this.positionPackage(record, belt, item, matrix);
    item.previous.copy(item.box); item.swept.copy(item.box);
    belt.packages.push(item); this.packageCount++; belt.entryCount++; belt.entryUnits++;
    const product = this.registerProduct(mesh, null, item); product.bounds.copy(PACKAGE_BOUNDS); product.enteredBelts.add(record.id); item.product = product;
    this.commitRoute(record, belt, product, decision); this.scopeMovement(product, null, record.id);
    this.event(record.id, 'package-entry', 'Entrada de paquete ' + belt.entryCount + '.');
    return true;
  }

  packageMatrix(record, belt, offset, item) {
    const bounds = item && item.bounds || PACKAGE_BOUNDS, scale = item && item.scale || IDENTITY_SCALE;
    const center = bounds.getCenter(new THREE.Vector3()).multiply(scale), route = item && item.route || 'main';
    const point = Object.assign({}, this.pathPoint(belt.config, offset + this.pathLength(belt.config, route) / 2, route)), lateral = item && item.lateral || 0;
    if (belt.config.mechanism === 'elevator') point.y = item && typeof item.mechanismHeight === 'number' ? item.mechanismHeight : offset <= 0 ? 0 : belt.config.rise;
    if (belt.config.mechanism === 'liftTransfer' && item && item.mechanismStage !== 'receive') point.y += belt.actuatorPosition * .055 * Math.max(0, 1 - Math.max(0, offset) / (this.pathLength(belt.config, route) / 2));
    let heading = point;
    if (item && ['liftTransfer', 'pusher', 'steer', 'distributor', 'merge', 'turntable'].includes(belt.config.mechanism)) {
      const yaw = typeof item.mechanismYaw === 'number' ? item.mechanismYaw : 0;
      heading = belt.config.axis === 'z' ? {tx: -Math.sin(yaw), tz: Math.cos(yaw)} : {tx: Math.cos(yaw), tz: Math.sin(yaw)};
    }
    const up = this.pathUp(record), forward = this.pathVector(record, heading.tx, heading.tz, heading.ty || 0).normalize();
    const right = new THREE.Vector3().crossVectors(forward, up).normalize(), normal = new THREE.Vector3().crossVectors(right, forward).normalize();
    const orientation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(forward, normal, right));
    if (item && item.orientationOffset) orientation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), item.orientationOffset));
    const world = this.pathSurface(record, belt, point, lateral).addScaledVector(normal, -Math.min(bounds.min.y * scale.y, bounds.max.y * scale.y) + 0.005);
    world.sub(new THREE.Vector3(center.x, 0, center.z).applyQuaternion(orientation));
    const matrix = new THREE.Matrix4().compose(world, orientation, scale);
    if (belt.config.gradeProfile === 'smooth' && belt.config.rise && belt.config.layout === 'straight' && belt.config.mechanism !== 'elevator') {
      // A rigid load spans more than the centre tangent of a convex/concave
      // transition. Lift its lower plane just enough to clear the whole cubic
      // profile, including the flat decks before/after the two interfaces.
      const length = this.pathLength(belt.config, route), alongZ = belt.config.axis === 'z';
      const pathFrame = record.object.userData.editorPrefabKey === 'conveyor' ? record.object.matrixWorld :
        new THREE.Matrix4().compose(record.object.getWorldPosition(new THREE.Vector3()), record.object.getWorldQuaternion(new THREE.Quaternion()), IDENTITY_SCALE);
      const frames = this.smoothSupportFrames || (this.smoothSupportFrames = new WeakMap());
      let cached = frames.get(record.object);
      if (!cached || !cached.frame.equals(pathFrame)) {
        cached = {frame: pathFrame.clone(), inverse: new THREE.Matrix4().getInverse(pathFrame)}; frames.set(record.object, cached);
      }
      const bottomY = scale.y < 0 ? bounds.max.y : bounds.min.y;
      let first = Infinity, last = -Infinity;
      for (const x of [bounds.min.x, bounds.max.x]) for (const z of [bounds.min.z, bounds.max.z]) {
        const corner = new THREE.Vector3(x, bottomY, z).applyMatrix4(matrix).applyMatrix4(cached.inverse);
        const distance = (alongZ ? corner.z : corner.x) + length / 2;
        first = Math.min(first, distance); last = Math.max(last, distance);
      }
      const candidates = [first, last], add = distance => { if (distance > first && distance < last) candidates.push(distance); };
      add(0); add(length);
      const horizontal = this.pathVector(record, alongZ ? 0 : 1, alongZ ? 1 : 0), vertical = this.pathVector(record, 0, 0, 1);
      const verticalProjection = normal.dot(vertical), denominator = normal.dot(up);
      if (Math.abs(verticalProjection) > 1e-8 && denominator > 1e-8) {
        // d/ds(surface - lower plane) = 0 at these at most two roots.
        const targetSlope = -normal.dot(horizontal) / verticalProjection;
        const discriminant = 1 - 4 * targetSlope * length / (6 * belt.config.rise);
        if (discriminant >= 0) {
          const root = Math.sqrt(discriminant);
          for (const t of [(1 - root) / 2, (1 + root) / 2]) if (t > 0 && t < 1) add(t * length);
        }
        const bottom = new THREE.Vector3(bounds.getCenter(new THREE.Vector3()).x, bottomY, bounds.getCenter(new THREE.Vector3()).z).applyMatrix4(matrix);
        let lift = 0;
        candidates.forEach(distance => {
          const surface = this.pathSurface(record, belt, this.pathPoint(belt.config, distance, route), lateral);
          lift = Math.max(lift, (surface.sub(bottom).dot(normal) + .005) / denominator);
        });
        if (lift > 1e-10) { world.addScaledVector(up, lift); matrix.setPosition(world); }
      }
    }
    return matrix;
  }

  positionPackage(record, belt, item, matrix = this.packageMatrix(record, belt, item.offset, item)) {
    item.mesh.matrix.copy(new THREE.Matrix4().getInverse(belt.helper.matrixWorld)).multiply(matrix);
    item.mesh.matrixWorld.copy(matrix);
    item.mesh.matrix.decompose(item.mesh.position, item.mesh.quaternion, item.mesh.scale);
    item.mesh.updateMatrixWorld(true);
    item.box.copy(item.bounds || PACKAGE_BOUNDS).applyMatrix4(matrix);
    this.invalidateCollision(item.mesh);
  }

  transferDetails(record, belt, item, reservations = []) {
    if (this.robotRuntime && !this.robotRuntime.canDispatch(record, item.product)) return {blocked: true};
    if (belt.speed < 0) return null;
    const branch = item.route === 'branch' && belt.config.layout === 'tee' && belt.config.junctionMode !== 'merge';
    const id = branch ? belt.config.branchId : belt.config.outputId;
    if (!id) return null;
    const target = this.records.get(id), receiver = target && target.components.conveyor;
    const blocked = {blocked: true};
    const port = branch ? belt.config.branchPort : belt.config.outputPort;
    if (target && (target.components.source || target.components.processor || target.components.palletQueue)) return this.sourceRuntime.beltTransferDetails(record, belt, item, target, port, reservations);
    if (!receiver || target === record) {
      this.warn(record, 'output-' + id, 'La salida necesita otro módulo transportador válido.'); return blocked;
    }
    if (port === 'branch' && !(receiver.config.layout === 'tee' && receiver.config.junctionMode === 'merge')) {
      this.warn(record, 'port-' + id, 'La entrada de ramal necesita un módulo T configurado para unir flujos.'); return blocked;
    }
    const reservedAdmissions = reservations.filter(transfer => transfer.receiver === receiver && !transfer.sourceBuffer).length;
    if (receiver.config.equipmentId) {
      const reservedMass = reservations.filter(transfer => transfer.receiver === receiver && !transfer.sourceBuffer).reduce((sum, transfer) => sum + this.productMetadata(transfer.item.product).mass, 0);
      const inTransitMass = receiver.packages.reduce((sum, load) => sum + this.productMetadata(load.product).mass, 0);
      if (reservedMass + inTransitMass + this.productMetadata(item.product).mass > receiver.config.maxLoad + 1e-8) return blocked;
    }
    const decision = port === 'branch' ? {route: 'branch', reason: 'merge', ruleIndex: -1} : this.routeDecision(receiver, item.product, reservedAdmissions);
    const route = decision.route, length = this.pathLength(receiver.config, route);
    const sourcePoint = this.pathPoint(belt.config, this.pathLength(belt.config, item.route), item.route);
    const targetPoint = this.pathPoint(receiver.config, 0, route);
    const sourcePosition = this.pathSurface(record, belt, sourcePoint), targetPosition = this.pathSurface(target, receiver, targetPoint);
    const sourceDirection = this.pathVector(record, sourcePoint.tx, sourcePoint.tz, sourcePoint.ty || 0).normalize(), targetDirection = this.pathVector(target, targetPoint.tx, targetPoint.tz, targetPoint.ty || 0).normalize();
    if (sourcePosition.distanceTo(targetPosition) > 0.18 || sourceDirection.dot(targetDirection) < 0.85) {
      this.warn(record, 'alignment-' + id, 'Alinea la salida del módulo con la entrada elegida; no se transportan cajas entre equipos separados.'); return blocked;
    }
    if ((belt.config.equipmentId || receiver.config.equipmentId) && Math.abs(sourceDirection.dot(this.pathUp(record)) - targetDirection.dot(this.pathUp(target))) > .015) {
      this.warn(record, 'transition-' + id, 'El cambio de pendiente requiere una transición física preparada o un elevador con interfaces horizontales.'); return blocked;
    }
    if (!this.admissionReady(target, receiver) || !this.productCompatible(target, receiver, item.product)) return blocked;
    if (this.singleLoadMechanism(receiver) && reservedAdmissions) return blocked;
    const width = Math.abs(item.bounds.getSize(new THREE.Vector3()).z * item.scale.z);
    if (width + 0.01 > receiver.config.width * this.widthScale(target, targetPoint)) return blocked;
    const candidate = Object.assign({}, item, {route, offset: -length / 2, lateral: 0, mechanismHeight: 0, orientationOffset: 0,
      mechanismYaw: receiver.config.junctionMode === 'merge' && route === 'branch' ? (receiver.config.branchSide === 'left' ? 1 : -1) * (receiver.config.mergeAngle || 45) * Math.PI / 180 : 0});
    const sourcePose = this.packageMatrix(record, belt, this.pathLength(belt.config, item.route) / 2, item);
    const sourceForward = new THREE.Vector3().setFromMatrixColumn(sourcePose, 0).normalize();
    const targetPose = this.packageMatrix(target, receiver, candidate.offset, candidate), targetForward = new THREE.Vector3().setFromMatrixColumn(targetPose, 0).normalize();
    const targetUp = new THREE.Vector3().setFromMatrixColumn(targetPose, 1).normalize();
    candidate.orientationOffset = Math.atan2(targetUp.dot(new THREE.Vector3().crossVectors(targetForward, sourceForward)), targetForward.dot(sourceForward));
    const matrix = this.packageMatrix(target, receiver, candidate.offset, candidate), box = item.bounds.clone().applyMatrix4(matrix);
    const lateral = this.pathVector(target, -targetPoint.tz, targetPoint.tx).normalize(), size = item.bounds.getSize(new THREE.Vector3());
    const projectedWidth = ['x', 'y', 'z'].reduce((sum, axis, index) => sum + Math.abs(new THREE.Vector3().setFromMatrixColumn(matrix, index).dot(lateral)) * size[axis], 0);
    if (projectedWidth > receiver.config.width * this.widthScale(target, targetPoint) + .00001) return blocked;
    const options = this.packageCollisionOptions(record, item); options.ignore.push(target.object);
    reservations.forEach(reservation => { if (reservation.box) options.extraBoxes.push(reservation.box); });
    if (this.ctx.collisionWorld && this.ctx.collisionWorld.testBox(box, options)) return blocked;
    return {record, belt, item, target, receiver, route, decision, matrix, box, orientationOffset: candidate.orientationOffset, blocked: false};
  }

  holdWithoutOutput(record, belt) {
    return true;
  }

  refreshTransferState(record, belt) {
    belt.transferBlocked = false;
    const side = Math.sign(belt.speed || 1);
    const nearExit = belt.packages.find(item => item.offset * side >= this.pathLength(belt.config, item.route) / 2 - 0.3);
    if (!nearExit) return;
    const transfer = this.transferDetails(record, belt, nearExit);
    belt.transferBlocked = !!transfer && transfer.blocked || !transfer && this.holdWithoutOutput(record, belt);
  }

  productCompatible(record, belt, product, warn = true) {
    if (!conveyorLayout.productCompatibility) return true;
    const metadata = this.productMetadata(product);
    const result = conveyorLayout.productCompatibility(belt.config, metadata);
    if (result.ok && belt.config.equipmentId) {
      const currentMass = belt.packages.reduce((total, item) => total + (item.product === product ? 0 : this.productMetadata(item.product).mass), 0);
      if (currentMass + metadata.mass > belt.config.maxLoad + 1e-8) { result.ok = false; result.reasons.push({code: 'total-mass', message: 'La masa total de las cargas supera la capacidad configurada del módulo.'}); }
    }
    if (!result.ok && warn) this.warn(record, 'product-' + result.reasons[0].code, result.reasons[0].message);
    return result.ok;
  }

  singleLoadMechanism(belt) {
    return ['liftTransfer', 'turntable', 'pusher', 'steer', 'merge', 'distributor', 'elevator', 'loading'].includes(belt.config.mechanism);
  }

  admissionReady(record, belt, operating = true) {
    if (!visible(record.object) || !belt.enabled || belt.palletFull || belt.packages.length >= belt.config.maxPackages) return false;
    if (this.singleLoadMechanism(belt) && (belt.packages.length || belt.mechanismPhase !== 'ready')) return false;
    if (!operating) return true;
    if (belt.config.drive === 'manual') return false;
    return belt.config.drive === 'gravity' ? !belt.paused && !belt.emergency : belt.powered && belt.running && !belt.paused && !belt.emergency && belt.speed > 0;
  }

  mechanismPose(record, belt, item, changes) {
    const candidate = Object.assign({}, item, changes), matrix = this.packageMatrix(record, belt, item.offset, candidate);
    const world = this.collisionWorld(item.mesh), options = this.packageCollisionOptions(record, item);
    if (world) {
      const nextBox = item.bounds.clone().applyMatrix4(matrix), delta = nextBox.getCenter(new THREE.Vector3()).sub(item.box.getCenter(new THREE.Vector3()));
      if (world.sweepBox(item.box, delta, options).blocked || world.testBox(nextBox, options)) {
        this.warn(record, 'actuator-collision', 'El mecanismo está bloqueado por una carga u obstáculo; libera su recorrido.'); return false;
      }
    }
    Object.assign(item, changes); this.positionPackage(record, belt, item, matrix); return true;
  }

  updateMechanism(record, belt, delta) {
    const config = belt.config;
    if (!this.singleLoadMechanism(belt)) return;
    if (!belt.enabled || !belt.powered || !belt.running || belt.paused || belt.emergency || !visible(record.object)) return;
    const item = belt.packages[0];
    if (item && config.mechanism === 'pusher') {
      const half = Math.abs(item.bounds.getSize(new THREE.Vector3()).z * item.scale.z) / 2;
      belt.actuatorStroke = Math.max(0, config.width / 2 + .12 - half) + config.length / 2;
      belt.actuatorContact = Math.max(0, config.width / 2 + .12 - half) / belt.actuatorStroke;
    }
    const approach = (value, target, amount) => value < target ? Math.min(target, value + amount) : Math.max(target, value - amount);
    if (!item) {
      const wasReturning = belt.mechanismPhase !== 'ready';
      belt.actuatorPosition = approach(belt.actuatorPosition, 0, delta / config.actuatorTime);
      belt.actuatorAngle = approach(belt.actuatorAngle, 0, Math.PI / 2 * delta / config.turnTime);
      belt.elevatorPosition = approach(belt.elevatorPosition, 0, config.verticalSpeed * delta);
      belt.mechanismPhase = belt.actuatorPosition || belt.actuatorAngle || belt.elevatorPosition ? 'returning' : 'ready';
      if (wasReturning && belt.mechanismPhase === 'ready') this.event(record.id, 'mechanism-ready', 'Mecanismo en posición de recepción.');
      return;
    }
    if (item.offset < -1e-8 || item.mechanismStage === 'transfer') { belt.mechanismPhase = item.mechanismStage === 'transfer' ? 'delivering' : 'receiving'; return; }
    if (item.route !== 'branch' && !['elevator', 'loading'].includes(config.mechanism)) { item.mechanismStage = 'transfer'; belt.mechanismPhase = 'delivering'; return; }
    if (config.mechanism === 'loading') {
      if (config.requiresOperator && !belt.operatorAvailable) { belt.mechanismPhase = 'waitingOperator'; return; }
      if (config.loadingMode === 'manual' && !belt.manualRelease && item.mechanismStage === 'receive') { belt.mechanismPhase = 'waitingManualAction'; return; }
    }
    if (item.mechanismStage === 'receive') {
      const exit = this.transferDetails(record, belt, item);
      if (!exit || exit.blocked) { belt.mechanismPhase = 'waitingDestination'; return; }
      item.mechanismStage = 'actuating'; item.mechanismElapsed = 0;
      this.event(record.id, 'mechanism-positioned', 'Carga centrada; destino disponible; comienza la actuación.');
    }
    const duration = config.mechanism === 'elevator' ? Math.abs(config.rise) / config.verticalSpeed :
      ['turntable', 'merge'].includes(config.mechanism) ? config.turnTime : config.mechanism === 'loading' ? config.operationTime : config.actuatorTime;
    const nextElapsed = Math.min(duration, (item.mechanismElapsed || 0) + delta), progress = duration ? nextElapsed / duration : 1;
    const changes = {};
    if (config.mechanism === 'elevator') changes.mechanismHeight = config.rise * progress;
    if (config.mechanism === 'turntable') changes.mechanismYaw = (config.branchSide === 'left' ? -1 : 1) * Math.PI / 2 * progress;
    if (config.mechanism === 'merge') changes.mechanismYaw = (config.branchSide === 'left' ? 1 : -1) * (config.mergeAngle || 45) * Math.PI / 180 * (1 - progress);
    if (!this.mechanismPose(record, belt, item, changes)) { belt.mechanismPhase = 'blocked'; return; }
    item.mechanismElapsed = nextElapsed;
    belt.mechanismPhase = config.mechanism === 'elevator' ? 'lifting' : config.mechanism === 'turntable' ? 'rotating' : config.mechanism === 'loading' ? 'operating' : 'actuating';
    if (config.mechanism === 'elevator') belt.elevatorPosition = item.mechanismHeight;
    if (['turntable', 'merge'].includes(config.mechanism)) belt.actuatorAngle = item.mechanismYaw;
    if (['liftTransfer', 'steer', 'distributor'].includes(config.mechanism)) belt.actuatorPosition = progress;
    if (config.mechanism === 'pusher') belt.actuatorPosition = progress * belt.actuatorContact;
    if (progress >= 1) { item.mechanismStage = 'transfer'; belt.manualRelease = false; belt.mechanismPhase = 'delivering'; this.event(record.id, 'mechanism-transfer', 'Posición de transferencia confirmada; entrega habilitada.'); }
  }

  itemTransportDistance(record, belt, item, delta, distance) {
    const config = belt.config, point = this.pathPoint(config, item.offset + this.pathLength(config, item.route) / 2, item.route);
    if (config.drive === 'gravity') {
      if (!belt.enabled || belt.paused || belt.emergency || !visible(record.object)) return 0;
      const tangent = this.pathVector(record, point.tx, point.tz, point.ty || 0).normalize();
      const acceleration = -9.81 * tangent.y - 9.81 * config.rollingResistance * Math.sqrt(Math.max(0, 1 - tangent.y * tangent.y));
      const previous = item.gravityVelocity || 0;
      item.gravityVelocity = Math.max(0, Math.min(5, previous + acceleration * delta));
      // Exact stopping distance for a flat run with rolling resistance.
      const duration = acceleration < 0 && previous + acceleration * delta < 0 ? previous / -acceleration : delta;
      return Math.max(0, previous * duration + acceleration * duration * duration / 2) / this.tangentScale(record, point);
    }
    if (config.drive === 'manual') return 0;
    if (this.singleLoadMechanism(belt) && item.mechanismStage !== 'transfer') return Math.min(distance, Math.max(0, -item.offset));
    if (config.mechanism === 'zones' && distance > 0) {
      const length = this.pathLength(config, item.route), coordinate = item.offset + length / 2, zone = Math.min(Math.ceil(length / config.zoneLength) - 1, Math.floor(coordinate / config.zoneLength));
      const nextOccupied = belt.packages.some(other => other !== item && Math.floor((other.offset + length / 2) / config.zoneLength) === zone + 1);
      if (nextOccupied || zone === Math.ceil(length / config.zoneLength) - 1 && belt.transferBlocked) {
        const extent = Math.abs(item.bounds.getSize(new THREE.Vector3()).x * item.scale.x) / this.tangentScale(record, point) / 2;
        const stop = Math.min(length, (zone + 1) * config.zoneLength) - extent - .025;
        return Math.min(distance, Math.max(0, stop - coordinate));
      }
    }
    return distance;
  }

  transport(record, delta) {
    const belt = record.components.conveyor;
    if (!belt) return;
    this.refreshPalletState(record, belt);
    this.refreshTransferState(record, belt);
    this.updateMechanism(record, belt, delta);
    belt.actualSpeed = this.beltSpeed(record, belt);
    if (belt.pendingInsert && visible(record.object) && this.spawn(record, belt, true)) belt.pendingInsert--;
    if (belt.actualSpeed) {
      belt.runSeconds += delta;
      if (!belt.externalSupply) belt.spawnElapsed += delta;
      if (belt.internalSupplyActive && belt.spawnElapsed >= belt.config.spawnInterval) {
        const spawned = this.spawn(record, belt);
        belt.spawnElapsed = spawned ? belt.spawnElapsed % belt.config.spawnInterval : Math.min(belt.spawnElapsed, belt.config.spawnInterval);
      }
    }
    if (belt.config.mechanism === 'zones') belt.zoneSpeeds = Array.from({length: Math.ceil(this.pathLength(belt.config) / belt.config.zoneLength)}, () => 0);
    belt.packages.forEach(item => {
      item.previous.copy(item.box);
      if (item.product && (item.product.robotReservedBy || item.product.vehicleReservedBy)) { item.swept.copy(item.box); return; }
      const point = this.pathPoint(belt.config, item.offset + this.pathLength(belt.config, item.route) / 2, item.route);
      let distance = belt.actualSpeed * delta / this.tangentScale(record, point);
      const midpoint = this.pathPoint(belt.config, item.offset + this.pathLength(belt.config, item.route) / 2 + distance / 2, item.route);
      distance = belt.actualSpeed * delta / this.tangentScale(record, midpoint);
      distance = this.itemTransportDistance(record, belt, item, delta, distance);
      const length = this.pathLength(belt.config, item.route);
      const hasLink = belt.speed >= 0 && !!(item.route === 'branch' && belt.config.junctionMode !== 'merge' ? belt.config.branchId : belt.config.outputId);
      if ((hasLink || belt.config.drive === 'gravity' || belt.config.equipmentId) && distance > 0) distance = Math.min(distance, Math.max(0, length / 2 - item.offset));
      const world = this.collisionWorld(item.mesh);
      const lastPoint = this.pathPoint(belt.config, item.offset + length / 2 + distance, item.route);
      const angle = Math.acos(THREE.Math.clamp(this.pathVector(record, point.tx, point.tz).normalize().dot(this.pathVector(record, lastPoint.tx, lastPoint.tz).normalize()), -1, 1));
      // A render/fixed-step chord can cut across a tight bend at high speed.
      // Follow its intermediate poses at at most 2° per bounded subdivision.
      const subdivisions = Math.max(1, Math.min(96, Math.ceil(angle / MAX_ROTATION_STEP)));
      const originOffset = item.offset, options = distance && world ? this.packageCollisionOptions(record, item) : null;
      if (options && hasLink && item.offset > length / 2 - Math.max(item.bounds.getSize(new THREE.Vector3()).x * Math.abs(item.scale.x), .3)) {
        const handoff = this.transferDetails(record, belt, item);
        if (handoff && !handoff.blocked && handoff.target) options.ignore.push(handoff.target.object);
      }
      const wasBlocked = item.blocked;
      item.blocked = false; item.swept.copy(item.previous); item.sweepSegments = [];
      for (let part = 0; part < subdivisions; part++) {
        const previous = item.box.clone(), nextOffset = originOffset + distance * (part + 1) / subdivisions;
        const matrix = this.packageMatrix(record, belt, nextOffset, item);
        const targetBox = item.bounds.clone().applyMatrix4(matrix);
        let traveled = nextOffset - item.offset;
        if (options) {
          const movement = targetBox.getCenter(new THREE.Vector3()).sub(previous.getCenter(new THREE.Vector3()));
          const result = world.sweepBox(previous, movement, options);
          traveled *= result.fraction;
          if (!result.blocked && world.testBox(targetBox, options)) { traveled = 0; result.blocked = true; }
          item.blocked = result.blocked;
        }
        item.offset += traveled;
        this.positionPackage(record, belt, item);
        item.sweepSegments.push(previous.union(item.box)); item.swept.union(item.box);
        if (item.blocked) break;
      }
      if (item.blocked && !wasBlocked) this.event(record.id, 'package-blocked', 'Un obstáculo ha detenido un paquete.');
      if (item.blocked && belt.config.drive === 'gravity') item.gravityVelocity = 0;
      if (belt.config.drive === 'gravity' && item.offset >= length / 2 - 1e-8 && belt.transferBlocked) item.gravityVelocity = 0;
      if (belt.zoneSpeeds) {
        const zone = Math.min(belt.zoneSpeeds.length - 1, Math.max(0, Math.floor((originOffset + length / 2) / belt.config.zoneLength)));
        belt.zoneSpeeds[zone] = Math.max(belt.zoneSpeeds[zone], Math.abs(item.offset - originOffset) * this.tangentScale(record, point) / delta);
      }
      if (belt.config.mechanism === 'pusher' && item.mechanismStage === 'transfer' && item.route === 'branch') belt.actuatorPosition = belt.actuatorContact + (1 - belt.actuatorContact) * Math.max(0, Math.min(1, item.offset / (length / 2)));
      const extent = (item.bounds ? Math.abs(item.bounds.getSize(new THREE.Vector3()).x * item.scale.x) / 2 : PACKAGE_SIZE / 2) /
        this.tangentScale(record, this.pathPoint(belt.config, item.offset + length / 2, item.route));
      item.exited = hasLink ? item.offset >= length / 2 - 1e-8 : Math.abs(item.offset) > length / 2 + extent;
    });
    // Exited packages survive until the next substep so sensors can observe the
    // swept segment that crosses the exit boundary in this substep.
    belt.inFlight = belt.packages.length;
    if (belt.config.drive === 'gravity') {
      belt.actualSpeed = belt.packages.reduce((max, item) => Math.max(max, item.gravityVelocity || 0), 0);
      if (belt.actualSpeed) belt.runSeconds += delta;
    }
    if (belt.config.mechanism === 'zones') {
      const occupied = new Set(belt.packages.map(item => Math.floor((item.offset + this.pathLength(belt.config, item.route) / 2) / belt.config.zoneLength)));
      belt.zonesOccupied = occupied.size;
      belt.zoneOccupied = Array.from({length: Math.ceil(this.pathLength(belt.config) / belt.config.zoneLength)}, (_, index) => occupied.has(index));
      const drivenSpeed = belt.actualSpeed;
      belt.actualSpeed = Math.max(0, ...belt.zoneSpeeds);
      if (drivenSpeed && !belt.actualSpeed) belt.runSeconds -= delta;
    }
  }

  disposePackage(item) {
    this.productFeedback.remove(item.mesh);
    if (item.authored) {
      if (!this.stopping && item.mesh.parent) {
        updateTree(item.mesh);
        const matrix = item.mesh.matrixWorld.clone(), root = this.document.getRoot && this.document.getRoot(this.roomId) || this.ctx.scene;
        if (root) root.add(item.mesh);
        if (item.product) { this.setProductMatrix(item.product, matrix); item.product.item = null; item.product.enteredBelts.delete(item.beltId); }
      }
      item.beltId = null;
      this.invalidateCollision(item.mesh);
      return;
    }
    if (item.mesh.parent) item.mesh.parent.remove(item.mesh);
    this.invalidateCollision(item.mesh);
    const product = this.products.get(item.mesh);
    if (product) {
      this.sourceRuntime.disposed(product);
      const entry = product.stateEntry;
      if (entry && this.ctx.raycontrol && this.ctx.raycontrol.states[entry.name] === entry.state) {
        this.ctx.raycontrol.deactivateState(entry.name); delete this.ctx.raycontrol.states[entry.name];
      }
      this.states = this.states.filter(state => state !== entry);
      this.products.delete(item.mesh);
    }
    const geometries = new Set(), materials = new Set(), textures = new Set();
    item.mesh.traverse(node => {
      if (node.geometry) geometries.add(node.geometry);
      (Array.isArray(node.material) ? node.material : [node.material]).filter(Boolean).forEach(material => materials.add(material));
    });
    materials.forEach(material => Object.values(material).forEach(value => { if (value && value.isTexture) textures.add(value); }));
    textures.forEach(texture => texture.dispose());
    materials.forEach(material => material.dispose());
    geometries.forEach(geometry => geometry.dispose());
  }

  beltSpeed(record, belt) {
    if (belt.config.drive !== 'motor') return 0;
    if (this.singleLoadMechanism(belt) && (belt.mechanismPhase === 'returning' || belt.packages.length && belt.packages[0].offset >= -1e-8 && belt.packages[0].mechanismStage !== 'transfer')) return 0;
    return belt.enabled && belt.powered && belt.running && !belt.paused && !belt.emergency && !belt.palletFull && (!belt.transferBlocked || belt.config.mechanism === 'zones') && visible(record.object) ? belt.speed : 0;
  }

  detect(record) {
    const sensor = record.components.sensor;
    if (!sensor) return;
    const bounds = sensorBounds(record.object);
    let occupied = false;
    const touching = new Set();
    if (sensor.enabled && visible(record.object)) {
      const candidates = sensor.config.sourceId ? [this.records.get(sensor.config.sourceId)] : [];
      candidates.forEach(source => {
        if (!source || !source.components.conveyor) return;
        source.components.conveyor.packages.forEach(item => {
          const swept = item.sweepSegments ? item.sweepSegments.some(segment => segment.intersectsBox(bounds)) : item.swept.intersectsBox(bounds);
          if (swept) { occupied = true; touching.add(item.mesh); }
        });
      });
      if (sensor.config.sourceId && (!candidates[0] || !candidates[0].components.conveyor)) this.warn(record, 'source', 'El sensor ' + record.object.name + ' necesita una banda de origen válida.');
    }
    // Count products, rather than only a clear-to-obstructed beam edge. Two
    // queued cartons can cover the optical volume without a full empty step.
    touching.forEach(mesh => {
      if (!sensor.touching.has(mesh)) { sensor.count++; this.event(record.id, 'sensor-detected', 'Paquete detectado: ' + sensor.count + '.'); }
    });
    sensor.touching = touching;
    sensor.occupied = occupied;
    const active = sensor.enabled && visible(record.object) && (sensor.config.normallyClosed ? !occupied : occupied);
    if (active !== sensor.active) { sensor.active = active; this.event(record.id, 'sensor-edge', 'active = ' + active); }
  }

  refreshVariables() {
    this.records.forEach(record => {
      const variables = {};
      const motion = record.components.motion;
      if (motion) Object.assign(variables, {enabled: motion.enabled, speed: motion.speed, position: motion.position});
      const belt = record.components.conveyor;
      if (belt) {
        this.updateSupplyState(belt);
        ['enabled', 'powered', 'paused', 'autoSpawn', 'externalSupply', 'internalSupplyActive', 'supplyMode', 'running', 'speed', 'actualSpeed', 'emergency', 'inFlight', 'entryCount', 'exitCount', 'runSeconds', 'pendingInsert', 'palletCount', 'palletCapacity', 'palletFull', 'transferBlocked', 'routedMain', 'routedBranch', 'routingUnmatched',
          'actuatorPosition', 'actuatorAngle', 'elevatorPosition', 'mechanismPhase', 'operatorAvailable', 'zonesOccupied', 'entryUnits', 'exitUnits'].forEach(key => { variables[key] = belt[key]; });
        if (belt.actuatorStroke !== undefined) variables.actuatorStroke = belt.actuatorStroke;
        const mechanism = belt.config.mechanism, ready = belt.mechanismPhase === 'ready';
        const turnLimit = mechanism === 'merge' ? (belt.config.mergeAngle || 45) * Math.PI / 180 : Math.PI / 2;
        Object.assign(variables, {mechanismReady: ready, mechanismBusy: !ready,
          atLowerLevel: mechanism === 'elevator' && Math.abs(belt.elevatorPosition) < 1e-5,
          atUpperLevel: mechanism === 'elevator' && Math.abs(belt.elevatorPosition - belt.config.rise) < 1e-5,
          actuatorRetracted: belt.actuatorPosition < 1e-5 && Math.abs(belt.actuatorAngle) < 1e-5,
          actuatorExtended: belt.actuatorPosition >= 1 - 1e-5 || ['turntable', 'merge'].includes(mechanism) && Math.abs(belt.actuatorAngle) >= turnLimit - 1e-5});
        if (belt.zoneOccupied) belt.zoneOccupied.forEach((occupied, index) => { variables['zone' + (index + 1) + 'Occupied'] = occupied; });
        if (belt.zoneSpeeds) belt.zoneSpeeds.forEach((speed, index) => { variables['zone' + (index + 1) + 'Speed'] = speed; });
      }
      const sensor = record.components.sensor;
      if (record.components.source) Object.assign(variables, this.sourceRuntime.variables(record));
      if (record.components.processor) Object.assign(variables, this.processorRuntime.variables(record));
      if (record.components.palletQueue) Object.assign(variables, this.palletQueueRuntime.variables(record));
      if (record.components.robot && this.robotRuntime) Object.assign(variables, this.robotRuntime.variables(record));
      if (record.components.vehicle && this.vehicleRuntime) Object.assign(variables, this.vehicleRuntime.variables(record));
      const inventory = record.components.source || record.components.palletQueue;
      if (inventory) Object.assign(variables, {powered: inventory.powered !== false, emergency: !!inventory.emergency});
      if (sensor) Object.assign(variables, {enabled: sensor.enabled, active: sensor.active, occupied: sensor.occupied, count: sensor.count});
      const product = this.products.get(record.object);
      if (product) Object.assign(variables, {held: !!product.heldBy, onConveyor: !!(product.item && product.item.beltId), onPallet: !!(product.item && product.item.palletOwnerId)});
      if (record.components.automation) variables.enabled = record.components.automation.enabled;
      record.variables = variables;
    });
  }

  automate() {
    // Resolve every condition against one snapshot. Feedback loops cannot
    // recurse within a step, and contradictory PLC controllers never win by
    // their incidental traversal order.
    const writes = [];
    this.records.forEach(record => {
      const automation = record.components.automation;
      if (!automation || !automation.enabled || !visible(record.object)) return;
      automation.rules.forEach((entry, index) => {
        const rule = entry.rule;
        const source = this.records.get(rule.sourceId === 'self' ? record.id : rule.sourceId);
        const targetId = rule.targetId === 'self' ? record.id : rule.targetId;
        const target = this.records.get(targetId);
        if (!source || !target || !Object.prototype.hasOwnProperty.call(source.variables, rule.variable) || !target.writable.some(field => field.key === rule.targetVariable)) {
          this.warn(record, 'rule-' + index, 'La regla ' + (index + 1) + ' de ' + record.object.name + ' tiene una referencia o variable no disponible.');
          entry.previous = false; return;
        }
        const condition = compare(source.variables[rule.variable], rule.operator, rule.value);
        const fire = rule.edge === 'level' ? condition : rule.edge === 'rising' ? condition && !entry.previous : !condition && entry.previous;
        entry.previous = condition;
        if (fire) writes.push({record, index, targetId, key: rule.targetVariable, value: rule.set});
      });
    });
    const arbitration = new Map();
    writes.forEach(write => {
      const key = write.targetId + ':' + write.key, previous = arbitration.get(key);
      if (!previous) arbitration.set(key, {write, conflict: false});
      else if (previous.write.value !== write.value) {
        previous.conflict = true;
        this.warn(write.record, 'controller-conflict-' + key, 'Órdenes de automatización contradictorias sobre ' + write.targetId + '.' + write.key + '; se conserva el estado hasta resolver las reglas.');
      }
    });
    arbitration.forEach(({write, conflict}) => {
      if (conflict) return;
      try { this.setVariable(write.targetId, write.key, write.value); }
      catch (error) { this.warn(write.record, 'write-' + write.index, error.message); }
    });
    const transfers = [];
    this.records.forEach(record => {
      const belt = record.components.conveyor;
      if (!belt) return;
      belt.packages = belt.packages.filter(item => {
        if (item.product && (item.product.robotReservedBy || item.product.vehicleReservedBy)) return true;
        if (!item.exited) return true;
        const transfer = this.transferDetails(record, belt, item, transfers);
        if (transfer) {
          if (transfer.blocked) { belt.transferBlocked = true; return true; }
          transfers.push(transfer); return false;
        }
        if (this.holdWithoutOutput(record, belt)) { belt.transferBlocked = true; return true; }
        const stacked = this.stackPackage(record, belt, item);
        if (stacked === false) return true;
        this.confirmClassification(record, belt, item);
        if (stacked === null) this.disposePackage(item);
        this.packageCount--; belt.exitCount++; belt.exitUnits += this.productMetadata(item.product).units;
        this.scopeMovement(item.product, record.id, null);
        this.event(record.id, 'package-exit', 'Salida de paquete ' + belt.exitCount + '.');
        return false;
      });
      belt.inFlight = belt.packages.length;
    });
    transfers.forEach(transfer => {
      const {record, belt, item, target, receiver, route, matrix} = transfer;
      this.confirmClassification(record, belt, item);
      if (transfer.sourceBuffer) {
        this.packageCount--; belt.exitCount++; belt.exitUnits += this.productMetadata(item.product).units; belt.transferBlocked = false;
        if (item.product) item.product.routingDecisions.delete(record.id);
        this.sourceRuntime.receiveBelt(transfer);
        return;
      }
      receiver.helper.add(item.mesh);
      Object.assign(item, {beltId: target.id, transferSourceId: record.id, route, offset: -this.pathLength(receiver.config, route) / 2, lateral: 0, exited: false, blocked: false,
        mechanismStage: 'receive', mechanismElapsed: 0, mechanismHeight: 0,
        mechanismYaw: receiver.config.junctionMode === 'merge' && route === 'branch' ? (receiver.config.branchSide === 'left' ? 1 : -1) * (receiver.config.mergeAngle || 45) * Math.PI / 180 : 0,
        orientationOffset: transfer.orientationOffset || 0,
        gravityVelocity: Math.abs(belt.actualSpeed || item.gravityVelocity || 0)});
      this.positionPackage(target, receiver, item, matrix); item.previous.copy(item.box); item.swept.copy(item.box);
      receiver.packages.push(item); receiver.inFlight = receiver.packages.length; receiver.entryCount++; receiver.entryUnits += this.productMetadata(item.product).units;
      this.commitRoute(target, receiver, item.product, transfer.decision);
      belt.exitCount++; belt.exitUnits += this.productMetadata(item.product).units; belt.transferBlocked = false;
      if (item.product) { item.product.enteredBelts.delete(record.id); item.product.routingDecisions.delete(record.id); item.product.enteredBelts.add(target.id); }
      this.scopeMovement(item.product, record.id, target.id);
      this.event(record.id, 'package-transfer', 'Caja transferida a ' + (target.object.name || target.id) + '.');
    });
    this.refreshVariables();
  }

  getSnapshot() {
    return {
      time: this.time, droppedSeconds: this.droppedSeconds, running: this.running,
      objects: Array.from(this.records.values()).map(record => {
        const types = record.configurations.map(config => config.type);
        const analytics = record.components.analytics;
        const result = {id: record.id, name: record.object.name || record.id, type: types.find(type => type !== 'analytics') || 'analytics', types,
          variables: Object.assign({}, record.variables), writable: record.writable.map(field => Object.assign({}, field)),
          analytics: {enabled: !!analytics, interval: analytics ? analytics.config.interval : 1}};
        if (analytics) result.analyticsInterval = analytics.config.interval;
        return result;
      }),
      events: this.events.map(event => Object.assign({}, event))
    };
  }

  confirmClassification(record, belt, item) {
    if (belt.config.layout !== 'tee' || belt.config.routing !== 'rules' || !item.product) return;
    const decision = item.product.routingDecisions.get(record.id);
    if (!decision || decision.ruleIndex < 0) return;
    this.event(record.id, 'classification-confirmed', 'Clasificación confirmada en salida ' + decision.route + ', regla ' + (decision.ruleIndex + 1) + '.');
  }
}
