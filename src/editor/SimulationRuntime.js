import * as THREE from 'three';
import behaviorSchema from '../../shared/behaviors.js';
import automationSchema from '../../shared/automation.js';
import {createProductVisual} from './IndustrialPrefabs.js';
import ProductFeedback from './ProductFeedback.js';
import ObjectPlacement from '../lib/ObjectPlacement.js';
import ProductSourceRuntime from './ProductSourceRuntime.js';
import ProcessorRuntime from './ProcessorRuntime.js';
import PalletQueueRuntime from './PalletQueueRuntime.js';

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
    this.productFeedback = new ProductFeedback(ctx);
    this.sourceRuntime = new ProductSourceRuntime(this);
    this.processorRuntime = new ProcessorRuntime(this);
    this.palletQueueRuntime = new PalletQueueRuntime(this);
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
        flowConfigurations.set(id, all.filter(config => ['conveyor', 'source', 'processor', 'palletQueue'].includes(config.type)));
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
            inFlight: 0, entryCount: 0, exitCount: 0, runSeconds: 0, pendingInsert: 0, spawnElapsed: config.spawnInterval, packages: [],
            pallets: new Map(), palletCount: 0, palletCapacity: 0, palletFull: false, transferBlocked: false, routeSequence: 0,
            routedMain: 0, routedBranch: 0, routingUnmatched: 0,
            routingRules: behaviorSchema.conveyorRouting ? behaviorSchema.conveyorRouting.normalizeRules(config.routingRules) : []});
          const helper = new THREE.Group(); helper.name = 'Paquetes de simulación'; helper.userData.editorRuntimeHelper = true;
          object.add(helper); component.helper = helper;
          record.writable.push(descriptor('running', 'boolean', 'En marcha'), descriptor('emergency', 'boolean', 'Parada de emergencia'),
            descriptor('speed', 'number', 'Velocidad (m/s)', -20, 20), descriptor('enabled', 'boolean', 'Habilitado'),
            descriptor('powered', 'boolean', 'Alimentación'), descriptor('paused', 'boolean', 'En pausa'),
            descriptor('autoSpawn', 'boolean', 'Entrada automática'));
        } else if (config.type === 'source') {
          this.sourceRuntime.attach(record, component);
        } else if (config.type === 'processor') {
          this.processorRuntime.attach(record, component);
        } else if (config.type === 'palletQueue') {
          this.palletQueueRuntime.attach(record, component);
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
      this.records.set(id, record);
    });
    this.configureSupply(flowConfigurations);
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
      if (record.components.product && visible(record.object)) this.registerProduct(record.object, record);
    });
    this.products.forEach(product => {
      const candidate = this.findProductBelt(product, 0.05);
      if (candidate) this.captureProduct(product, candidate);
    });
    this.installProductInput();
    this.sourceRuntime.start();
    this.refreshVariables();
    this.event('simulation', 'simulation-start', 'Simulación iniciada.');
  }

  stop() {
    this.stopping = true;
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
    this.records.clear();
    this.products.clear();
    this.scopeGroups.clear(); this.scopeLookup.clear();
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
    if (!record || !record.components.conveyor) return null;
    const group = scope !== 'module' && this.scopeLookup.get(id + '/' + scope);
    if (!group || group.memberIds.length === 1) return {anchorId: id, scope, memberIds: [id], variables: Object.assign({moduleCount: 1}, record.variables)};
    const components = group.memberIds.map(memberId => this.records.get(memberId).components.conveyor);
    const all = key => components.every(component => !!component[key]);
    const any = key => components.some(component => !!component[key]);
    const sum = key => components.reduce((total, component) => total + component[key], 0);
    const variables = {moduleCount: components.length, enabled: all('enabled'), powered: all('powered'), running: all('running'), paused: any('paused'),
      emergency: any('emergency'), autoSpawn: any('autoSpawn'), speed: record.components.conveyor.speed,
      externalSupply: record.components.conveyor.externalSupply, internalSupplyActive: record.components.conveyor.internalSupplyActive,
      supplyMode: record.components.conveyor.supplyMode,
      actualSpeed: components.every(component => component.actualSpeed !== 0) ? record.components.conveyor.actualSpeed : 0,
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
    panel.memberIds.forEach(memberId => this.validateVariable(this.records.get(memberId), key, value));
    panel.memberIds.forEach(memberId => this.setVariable(memberId, key, value));
    return true;
  }

  pathLength(config, route = 'main') { return conveyorLayout ? conveyorLayout.pathLength(config, route) : config.length; }

  pathPoint(config, distance, route = 'main') {
    if (conveyorLayout) return conveyorLayout.pathPoint(config, distance, route);
    return config.axis === 'z' ? {x: 0, z: distance - config.length / 2, tx: 0, tz: 1} : {x: distance - config.length / 2, z: 0, tx: 1, tz: 0};
  }

  pathVector(record, x, z) {
    const vector = new THREE.Vector3(x, 0, z);
    return record.object.userData.editorPrefabKey === 'conveyor' ? vector.applyMatrix3(new THREE.Matrix3().setFromMatrix4(record.object.matrixWorld)) :
      vector.applyQuaternion(record.object.getWorldQuaternion(new THREE.Quaternion()));
  }

  pathUp(record) {
    return record.object.userData.editorPrefabKey === 'conveyor' ? new THREE.Vector3(0, 1, 0).transformDirection(record.object.matrixWorld) :
      new THREE.Vector3(0, 1, 0).applyQuaternion(record.object.getWorldQuaternion(new THREE.Quaternion()));
  }

  pathSurface(record, belt, point, lateral = 0) {
    const local = new THREE.Vector3(point.x - point.tz * lateral, 0, point.z + point.tx * lateral);
    const surface = record.object.userData.editorPrefabKey === 'conveyor' ? local.applyMatrix4(record.object.matrixWorld) :
      local.applyQuaternion(record.object.getWorldQuaternion(new THREE.Quaternion())).add(record.object.getWorldPosition(new THREE.Vector3()));
    return surface.addScaledVector(this.pathUp(record), belt.top);
  }

  tangentScale(record, point) {
    return Math.max(0.00001, this.pathVector(record, point.tx, point.tz).length());
  }

  widthScale(record, point) {
    return this.pathVector(record, point.tx, point.tz).cross(this.pathVector(record, -point.tz, point.tx)).length() / this.tangentScale(record, point);
  }

  productMetadata(product) {
    const entry = product && product.sourceEntry, leaves = [];
    const visit = value => {
      if (value.members && value.members.length) value.members.forEach(visit);
      else leaves.push(value.spec || {});
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
      width: Math.abs(size.x), height: Math.abs(size.y), depth: Math.abs(size.z), units: entry ? entry.units : 1};
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
    if (record && record.components.processor) return this.processorRuntime.command(record, action, value);
    if (record && record.components.palletQueue) return this.palletQueueRuntime.command(record, action, value);
    if (record && record.components.source) return this.sourceRuntime.command(record, action, value);
    if (!belt) throw new Error('El mando necesita una banda transportadora de destino.');
    if (scope !== 'module' && action !== 'insertBox') {
      const panel = this.getPanelSnapshot(id, scope), ids = panel.memberIds;
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

  insertProduct(id) {
    const record = this.records.get(id), belt = record && record.components.conveyor;
    if (!belt) throw new Error('Selecciona una banda para introducir una caja.');
    if (belt.externalSupply) return false;
    if (belt.pendingInsert + belt.packages.length >= belt.config.maxPackages || this.sourceRuntime.liveLoads() >= MAX_PACKAGES) return false;
    // Commands queue one product each. An occupied entry waits instead of
    // allocating overlapping boxes or silently losing the operator's request.
    belt.pendingInsert++;
    this.event(id, 'package-request', 'Caja preparada para la entrada manual.');
    this.refreshVariables();
    return true;
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
      color: (config.color || source.color || '#b78b53').toLowerCase(), quality: config.quality || source.quality || 'good', defect: config.defect || source.defect || 'none'});
    this.products.set(object, product);
    if (!this.ctx.raycontrol) return product;
    const name = this.statePrefix + 'product-' + (++this.productSequence);
    const state = {colliderMesh: object, controller: 'both', raycaster: true, consumeSelect: true, mergeSelection: true, captureSelect: true,
      isSelectable: (hit, controller) => this.validInteraction(object, hit, controller, false),
      onSelectStart: (hit, controller) => {
        if (!this.running || this.ctx.editor && this.ctx.editor.active) return;
        controller = controller || this.ctx.desktopController || this.ctx.camera;
        if (!controller || !this.validInteraction(object, hit, controller, true)) return;
        if (product.heldBy === controller) this.releaseProduct(product);
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
        const product = event && runtime.held.get(event.target);
        if (product && runtime.running && !(runtime.ctx.editor && runtime.ctx.editor.active)) {
          const data = input.controllers && input.controllers.find(entry => entry.controller === event.target);
          if (input.enabled === false || data && (!data.enabled || data.active)) return;
          runtime.releaseProduct(product);
          // Dropping consumes this trigger cycle too: a repeated start must
          // neither grab it again nor fire a native release under the ray.
          if (data) { data.active = true; data.selectionCapture = []; data.captureConsumed = true; }
          return;
        }
        return original.apply(this, arguments);
      };
      this.productInput = {input, original, wrapper}; input.onSelectStart = wrapper;
    }
    if (input && input.addEventListener) {
      const cancel = data => {
        if (data && data.controller) this.releaseHeldProducts(data.controller);
        this.controlFeedback.forEach(entry => {
          const pressed = entry.controllers.delete(data && data.controller);
          entry.hovering.delete(data && data.controller);
          if (pressed && !entry.controllers.size) entry.until = 0;
        });
      };
      input.addEventListener('controllerDisconnected', cancel);
      input.addEventListener('controllerInputCancelled', cancel);
      this.productDisconnectInput = {input, cancel};
    }
    const canvas = this.ctx.renderer && this.ctx.renderer.domElement;
    if (canvas && canvas.addEventListener && canvas.removeEventListener) {
      const handler = event => this.handleProductWheel(event);
      canvas.addEventListener('wheel', handler, {passive: false, capture: true});
      this.productWheelInput = {canvas, handler};
    }
  }

  restoreProductInput() {
    const binding = this.productInput;
    if (binding && binding.input.onSelectStart === binding.wrapper) binding.input.onSelectStart = binding.original;
    this.productInput = null;
    const disconnect = this.productDisconnectInput;
    if (disconnect) {
      disconnect.input.removeEventListener('controllerDisconnected', disconnect.cancel);
      disconnect.input.removeEventListener('controllerInputCancelled', disconnect.cancel);
    }
    this.productDisconnectInput = null;
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

  pickupProduct(product, controller) {
    if (!controller || product.heldBy || this.held.has(controller) || controller.userData && controller.userData.grabbing) return false;
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
    product.heldBy = controller; this.held.set(controller, product);
    Object.defineProperty(product.object, 'industrialHeld', {value: true, configurable: true, writable: true, enumerable: false});
    this.sourceRuntime.picked(product);
    this.processorRuntime.picked(product);
    this.invalidateCollision(product.object);
    this.productFeedback.hold(product.object);
    this.pulse(controller, 0.25, 45);
    this.event(product.record ? product.record.id : 'simulation', 'product-picked', this.ctx.vrMode ?
      'Caja agarrada. Vuelve a pulsar el gatillo para soltarla.' : 'Caja agarrada. Rueda: acercar / alejar. Vuelve a pulsar para soltarla.');
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
        if (projection.distance <= 0.001 && beyond * tangentScale < -0.1 || projection.distance >= length - 0.001 && beyond * tangentScale > 0.1) return;
        const footprint = Math.max(size.x, size.z);
        if (projection.distance < -0.1 || projection.distance > length + 0.1 || Math.abs(projection.lateral) * widthScale + footprint / 2 > belt.config.width * widthScale / 2 + 0.02 ||
          Math.abs(local.y - belt.top - size.y / 2) > tolerance) return;
        const score = Math.abs(local.y - belt.top - size.y / 2) + Math.abs(projection.lateral) * 0.05;
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
    this.held.delete(product.heldBy); product.heldBy = null;
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

  releaseHeldProducts(controller) {
    Array.from(this.held.entries()).forEach(([owner, product]) => {
      if (!controller || owner === controller) this.releaseProduct(product, true);
    });
  }

  onInputModeChange() {
    this.releaseHeldProducts();
    this.controlFeedback.forEach(entry => { entry.controllers.clear(); entry.hovering.clear(); entry.until = 0; });
    const input = this.ctx.raycontrol;
    if (input && input.cancelSelect) input.controllers.forEach(data => input.cancelSelect(data));
  }

  captureProduct(product, candidate) {
    const {record, belt, offset, lateral} = candidate;
    if (belt.packages.length >= belt.config.maxPackages || this.packageCount >= MAX_PACKAGES) return false;
    const item = product.item || {mesh: product.object, authored: !!product.record, product,
      box: new THREE.Box3(), previous: new THREE.Box3(), swept: new THREE.Box3()};
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
    Object.assign(item, {offset: resolvedOffset, lateral, route, bounds: product.bounds, scale: product.scale, exited: false, blocked: false, palletOwnerId: null, palletSlot: null});
    const matrix = this.packageMatrix(record, belt, item.offset, item);
    const world = this.ctx.collisionWorld;
    const options = this.packageCollisionOptions(record, item); options.ignore.push(product.object);
    if (world && world.testBox(item.bounds.clone().applyMatrix4(matrix), options)) return false;
    belt.helper.add(item.mesh); item.beltId = record.id;
    product.item = item;
    this.positionPackage(record, belt, item, matrix);
    item.previous.copy(item.box); item.swept.copy(item.box);
    belt.packages.push(item); this.packageCount++; belt.inFlight = belt.packages.length;
    if (!product.enteredBelts.has(record.id)) {
      product.enteredBelts.add(record.id); belt.entryCount++;
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
    if (!record) throw new Error('El objeto no participa en la simulación actual.');
    const field = record.writable.find(item => item.key === key);
    if (!field) throw new Error('La variable es de solo lectura o no existe.');
    if (typeof value !== field.type || typeof value === 'number' && (!Number.isFinite(value) || value < field.min || value > field.max)) {
      throw new Error('Valor inválido para ' + field.label + '.');
    }
    const belt = record.components.conveyor;
    if (belt && key === 'running' && value && belt.emergency) {
      throw new Error('Restablece la parada de emergencia antes de arrancar la banda.');
    }
    if (belt && key === 'running' && value && !belt.powered) throw new Error('Enciende la alimentación antes de arrancar la banda.');
    const processor = record.components.processor;
    if (processor && key === 'running' && value && processor.emergency) throw new Error('Restablece la parada de emergencia antes de arrancar el proceso.');
    if (processor && key === 'running' && value && !processor.powered) throw new Error('Enciende la alimentación antes de arrancar el proceso.');
  }

  setVariable(id, key, value) {
    const record = this.records.get(id);
    this.validateVariable(record, key, value);
    const belt = record.components.conveyor;
    let changed = false;
    Object.values(record.components).forEach(component => {
      if (Object.prototype.hasOwnProperty.call(component, key) && component[key] !== value) { component[key] = value; changed = true; }
    });
    if (belt) {
      // Emergency is latched: releasing it permits a later explicit Start,
      // but must never restart machinery as a side effect of the reset.
      if ((key === 'emergency' && value || key === 'powered' && !value) && belt.running) {
        belt.running = false;
        this.event(id, 'variable-change', 'running = false (' + (key === 'emergency' ? 'parada de emergencia' : 'apagado') + ')');
      }
      if (key === 'running' && !value || key === 'powered' && !value || key === 'emergency' && value) belt.paused = false;
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
    // A render frame can contain several fixed steps. Update only simulation
    // actors and their descendants, rather than every mesh of the whole room
    // again at each step. A nested sensor shares its ancestor actor's update.
    const actors = new Set(Array.from(this.records.values(), record => record.object));
    const roots = Array.from(actors).filter(object => {
      for (let parent = object.parent; parent; parent = parent.parent) if (actors.has(parent)) return false;
      return true;
    });
    try {
      this.updateHeldProducts();
      while (remaining > 1e-10) {
        const step = Math.min(remaining, STEP);
        this.time += step;
        this.records.forEach(record => this.move(record, step));
        roots.forEach(updateTree);
        this.sourceRuntime.step(step);
        this.processorRuntime.step(step);
        this.palletQueueRuntime.step(step);
        this.records.forEach(record => this.transport(record, step));
        this.scopeGroups.forEach(group => {
          if (group.memberIds.some(id => this.records.get(id).components.conveyor.actualSpeed !== 0)) group.runSeconds += step;
        });
        this.records.forEach(record => this.detect(record));
        this.refreshVariables();
        this.automate();
        remaining -= step;
      }
    } finally {
      this.productFeedback.update(elapsed);
      if (ownsFrame) world.endFrame();
    }
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
        excluded && excluded.mesh === product.object || !visible(product.object) || !product.heldBy && !this.collisionWorld(product.object)) return;
      updateTree(product.object);
      ignore.push(product.object);
      extraBoxes.push(product.bounds.clone().applyMatrix4(product.object.matrixWorld));
    });
    return {ignore, extraBoxes};
  }

  spawn(record, belt, reserved = false) {
    if (belt.externalSupply) return false;
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
      box: new THREE.Box3(), previous: new THREE.Box3(), swept: new THREE.Box3()};
    this.positionPackage(record, belt, item, matrix);
    item.previous.copy(item.box); item.swept.copy(item.box);
    belt.packages.push(item); this.packageCount++; belt.entryCount++;
    const product = this.registerProduct(mesh, null, item); product.bounds.copy(PACKAGE_BOUNDS); product.enteredBelts.add(record.id); item.product = product;
    this.commitRoute(record, belt, product, decision); this.scopeMovement(product, null, record.id);
    this.event(record.id, 'package-entry', 'Entrada de paquete ' + belt.entryCount + '.');
    return true;
  }

  packageMatrix(record, belt, offset, item) {
    const bounds = item && item.bounds || PACKAGE_BOUNDS, scale = item && item.scale || IDENTITY_SCALE;
    const center = bounds.getCenter(new THREE.Vector3()).multiply(scale), route = item && item.route || 'main';
    const point = this.pathPoint(belt.config, offset + this.pathLength(belt.config, route) / 2, route), lateral = item && item.lateral || 0;
    const up = this.pathUp(record), forward = this.pathVector(record, point.tx, point.tz).normalize();
    const right = new THREE.Vector3().crossVectors(forward, up).normalize(), normal = new THREE.Vector3().crossVectors(right, forward).normalize();
    const orientation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(forward, normal, right));
    const world = this.pathSurface(record, belt, point, lateral).addScaledVector(normal, -Math.min(bounds.min.y * scale.y, bounds.max.y * scale.y) + 0.005);
    world.sub(new THREE.Vector3(center.x, 0, center.z).applyQuaternion(orientation));
    return new THREE.Matrix4().compose(world, orientation, scale);
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
    const decision = port === 'branch' ? {route: 'branch', reason: 'merge', ruleIndex: -1} : this.routeDecision(receiver, item.product, reservedAdmissions);
    const route = decision.route, length = this.pathLength(receiver.config, route);
    const sourcePoint = this.pathPoint(belt.config, this.pathLength(belt.config, item.route), item.route);
    const targetPoint = this.pathPoint(receiver.config, 0, route);
    const sourcePosition = this.pathSurface(record, belt, sourcePoint), targetPosition = this.pathSurface(target, receiver, targetPoint);
    const sourceDirection = this.pathVector(record, sourcePoint.tx, sourcePoint.tz).normalize(), targetDirection = this.pathVector(target, targetPoint.tx, targetPoint.tz).normalize();
    if (sourcePosition.distanceTo(targetPosition) > 0.18 || sourceDirection.dot(targetDirection) < 0.85) {
      this.warn(record, 'alignment-' + id, 'Alinea la salida del módulo con la entrada elegida; no se transportan cajas entre equipos separados.'); return blocked;
    }
    if (!receiver.enabled || !receiver.powered || !receiver.running || receiver.paused || receiver.emergency || receiver.speed <= 0 ||
      receiver.palletFull || !visible(target.object) || receiver.packages.length >= receiver.config.maxPackages) return blocked;
    const width = Math.abs(item.bounds.getSize(new THREE.Vector3()).z * item.scale.z);
    if (width + 0.01 > receiver.config.width * this.widthScale(target, targetPoint)) return blocked;
    const candidate = Object.assign({}, item, {route, offset: -length / 2, lateral: 0});
    const matrix = this.packageMatrix(target, receiver, candidate.offset, candidate), box = item.bounds.clone().applyMatrix4(matrix);
    const options = this.packageCollisionOptions(record, item); options.ignore.push(target.object);
    reservations.forEach(reservation => { if (reservation.box) options.extraBoxes.push(reservation.box); });
    if (this.ctx.collisionWorld && this.ctx.collisionWorld.testBox(box, options)) return blocked;
    return {record, belt, item, target, receiver, route, decision, matrix, box, blocked: false};
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

  transport(record, delta) {
    const belt = record.components.conveyor;
    if (!belt) return;
    this.refreshPalletState(record, belt);
    this.refreshTransferState(record, belt);
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
    belt.packages.forEach(item => {
      item.previous.copy(item.box);
      const point = this.pathPoint(belt.config, item.offset + this.pathLength(belt.config, item.route) / 2, item.route);
      let distance = belt.actualSpeed * delta / this.tangentScale(record, point);
      const midpoint = this.pathPoint(belt.config, item.offset + this.pathLength(belt.config, item.route) / 2 + distance / 2, item.route);
      distance = belt.actualSpeed * delta / this.tangentScale(record, midpoint);
      const length = this.pathLength(belt.config, item.route);
      const hasLink = belt.speed >= 0 && !!(item.route === 'branch' && belt.config.junctionMode !== 'merge' ? belt.config.branchId : belt.config.outputId);
      if (hasLink && distance > 0) distance = Math.min(distance, Math.max(0, length / 2 - item.offset));
      const world = this.collisionWorld(item.mesh);
      const lastPoint = this.pathPoint(belt.config, item.offset + length / 2 + distance, item.route);
      const angle = Math.acos(THREE.Math.clamp(this.pathVector(record, point.tx, point.tz).normalize().dot(this.pathVector(record, lastPoint.tx, lastPoint.tz).normalize()), -1, 1));
      // A render/fixed-step chord can cut across a tight bend at high speed.
      // Follow its intermediate poses at at most 2° per bounded subdivision.
      const subdivisions = Math.max(1, Math.min(96, Math.ceil(angle / MAX_ROTATION_STEP)));
      const originOffset = item.offset, options = distance && world ? this.packageCollisionOptions(record, item) : null;
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
      const extent = (item.bounds ? Math.abs(item.bounds.getSize(new THREE.Vector3()).x * item.scale.x) / 2 : PACKAGE_SIZE / 2) /
        this.tangentScale(record, this.pathPoint(belt.config, item.offset + length / 2, item.route));
      item.exited = hasLink ? item.offset >= length / 2 - 1e-8 : Math.abs(item.offset) > length / 2 + extent;
    });
    // Exited packages survive until the next substep so sensors can observe the
    // swept segment that crosses the exit boundary in this substep.
    belt.inFlight = belt.packages.length;
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
    return belt.enabled && belt.powered && belt.running && !belt.paused && !belt.emergency && !belt.palletFull && !belt.transferBlocked && visible(record.object) ? belt.speed : 0;
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
        ['enabled', 'powered', 'paused', 'autoSpawn', 'externalSupply', 'internalSupplyActive', 'supplyMode', 'running', 'speed', 'actualSpeed', 'emergency', 'inFlight', 'entryCount', 'exitCount', 'runSeconds', 'pendingInsert', 'palletCount', 'palletCapacity', 'palletFull', 'transferBlocked', 'routedMain', 'routedBranch', 'routingUnmatched'].forEach(key => { variables[key] = belt[key]; });
      }
      const sensor = record.components.sensor;
      if (record.components.source) Object.assign(variables, this.sourceRuntime.variables(record));
      if (record.components.processor) Object.assign(variables, this.processorRuntime.variables(record));
      if (record.components.palletQueue) Object.assign(variables, this.palletQueueRuntime.variables(record));
      if (sensor) Object.assign(variables, {enabled: sensor.enabled, active: sensor.active, occupied: sensor.occupied, count: sensor.count});
      const product = this.products.get(record.object);
      if (product) Object.assign(variables, {held: !!product.heldBy, onConveyor: !!(product.item && product.item.beltId), onPallet: !!(product.item && product.item.palletOwnerId)});
      if (record.components.automation) variables.enabled = record.components.automation.enabled;
      record.variables = variables;
    });
  }

  automate() {
    // Resolve every condition against one snapshot, then apply writes in stable
    // scene/rule order. Feedback loops cannot recurse within a simulation step.
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
    writes.forEach(write => {
      try { this.setVariable(write.targetId, write.key, write.value); }
      catch (error) { this.warn(write.record, 'write-' + write.index, error.message); }
    });
    const transfers = [];
    this.records.forEach(record => {
      const belt = record.components.conveyor;
      if (!belt) return;
      belt.packages = belt.packages.filter(item => {
        if (!item.exited) return true;
        const transfer = this.transferDetails(record, belt, item, transfers);
        if (transfer) {
          if (transfer.blocked) { belt.transferBlocked = true; return true; }
          transfers.push(transfer); return false;
        }
        if (this.holdWithoutOutput(record, belt)) { belt.transferBlocked = true; return true; }
        const stacked = this.stackPackage(record, belt, item);
        if (stacked === false) return true;
        if (stacked === null) this.disposePackage(item);
        this.packageCount--; belt.exitCount++;
        this.scopeMovement(item.product, record.id, null);
        this.event(record.id, 'package-exit', 'Salida de paquete ' + belt.exitCount + '.');
        return false;
      });
      belt.inFlight = belt.packages.length;
    });
    transfers.forEach(transfer => {
      const {record, belt, item, target, receiver, route, matrix} = transfer;
      if (transfer.sourceBuffer) {
        this.packageCount--; belt.exitCount++; belt.transferBlocked = false;
        if (item.product) item.product.routingDecisions.delete(record.id);
        this.sourceRuntime.receiveBelt(transfer);
        return;
      }
      receiver.helper.add(item.mesh);
      Object.assign(item, {beltId: target.id, route, offset: -this.pathLength(receiver.config, route) / 2, lateral: 0, exited: false, blocked: false});
      this.positionPackage(target, receiver, item, matrix); item.previous.copy(item.box); item.swept.copy(item.box);
      receiver.packages.push(item); receiver.inFlight = receiver.packages.length; receiver.entryCount++;
      this.commitRoute(target, receiver, item.product, transfer.decision);
      belt.exitCount++; belt.transferBlocked = false;
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
}
