import * as THREE from 'three';
import behaviorSchema from '../../shared/behaviors.js';
import {createSourceProductVisual} from './IndustrialPrefabs.js';

const sources = behaviorSchema.productSources;
const MAX_LOADS = 500;

function visible(object) {
  for (let node = object; node; node = node.parent) if (!node.visible) return false;
  return true;
}

/** FIFO inventory keeps waiting loads as data and only exposes its first load. */
export default class ProductSourceRuntime {
  constructor(runtime) {
    this.runtime = runtime;
    this.entries = new Set();
    this.sequence = 0;
  }

  attach(record, component) {
    const config = component.config;
    Object.assign(component, {enabled: true, running: config.running, paused: config.paused, autoGenerate: config.autoGenerate,
      interval: config.interval, outputInterval: config.outputInterval, queue: [], elapsed: 0, outputElapsed: config.outputInterval,
      generated: 0, generatedUnits: 0, delivered: 0, deliveredUnits: 0, received: 0, receivedUnits: 0,
      blocked: false, generationBlocked: false, transferBlocked: false});
    const helper = new THREE.Group(); helper.name = 'Productos disponibles'; helper.userData.editorRuntimeHelper = true;
    record.object.add(helper); component.helper = helper;
    const field = (key, type, label, min, max) => Object.assign({key, type, label}, min === undefined ? {} : {min, max});
    record.writable.push(field('enabled', 'boolean', 'Habilitado'), field('running', 'boolean', 'En marcha'), field('paused', 'boolean', 'En pausa'),
      field('autoGenerate', 'boolean', 'Generación automática'), field('interval', 'number', 'Intervalo de generación (s)', 0.1, 120),
      field('outputInterval', 'number', 'Intervalo de salida (s)', 0.1, 120));
  }

  start() {
    this.runtime.records.forEach(record => {
      const source = record.components.source;
      if (!source) return;
      for (let index = 0; index < source.config.initialCount; index++) if (!this.generate(record)) break;
      this.materialize(record);
    });
  }

  liveLoads(includeReservations = true) {
    let logical = 0;
    this.entries.forEach(entry => { if (entry.ownerId && !entry.product) logical++; });
    if (includeReservations) this.runtime.records.forEach(record => { if (record.components.conveyor) logical += record.components.conveyor.pendingInsert; });
    if (includeReservations && this.runtime.processorRuntime) logical += this.runtime.processorRuntime.reservedLoads();
    return this.runtime.products.size + logical;
  }

  variables(record) {
    const source = record.components.source;
    if (!source) return {};
    const first = source.queue[0];
    return {enabled: source.enabled, running: source.running, paused: source.paused, autoGenerate: source.autoGenerate, delivery: source.config.delivery,
      interval: source.interval, outputInterval: source.outputInterval,
      queued: source.queue.length, queuedUnits: source.queue.reduce((total, entry) => total + entry.units, 0), capacity: source.config.capacity,
      full: source.queue.length >= source.config.capacity, empty: source.queue.length === 0,
      nextProduct: first ? first.spec.name : '', nextProductId: first ? first.spec.id : '',
      generated: source.generated, generatedUnits: source.generatedUnits, delivered: source.delivered, deliveredUnits: source.deliveredUnits,
      received: source.received, receivedUnits: source.receivedUnits, blocked: source.blocked,
      generationBlocked: source.generationBlocked, transferBlocked: source.transferBlocked,
      remaining: source.config.totalLimit ? Math.max(0, source.config.totalLimit - source.generated) : -1};
  }

  loadBounds(entry) {
    const size = sources.loadSize(entry.spec, entry.load);
    return new THREE.Box3(new THREE.Vector3(-size.width / 2, 0, -size.depth / 2), new THREE.Vector3(size.width / 2, size.height, size.depth / 2));
  }

  frontMatrix(record, bounds, worldScale, positionOverride) {
    record.object.updateWorldMatrix(true, true);
    const metadata = record.object.userData.industrialSource;
    const position = positionOverride || metadata && metadata.queuePosition || [0, 0, 0];
    const point = Array.isArray(position) ? new THREE.Vector3().fromArray(position) : new THREE.Vector3(position.x || 0, position.y || 0, position.z || 0);
    if (worldScale) {
      point.applyMatrix4(record.object.matrixWorld).addScaledVector(new THREE.Vector3(0, 1, 0).transformDirection(record.object.matrixWorld), .005 - bounds.min.y * Math.abs(worldScale.y));
      return new THREE.Matrix4().compose(point, record.object.getWorldQuaternion(new THREE.Quaternion()), worldScale);
    }
    point.y += 0.005 - bounds.min.y;
    return new THREE.Matrix4().multiplyMatrices(record.object.matrixWorld, new THREE.Matrix4().makeTranslation(point.x, point.y, point.z));
  }

  canPlace(record, bounds, matrix, product) {
    const runtime = this.runtime, world = runtime.ctx.collisionWorld;
    if (!world) return true;
    const options = runtime.packageCollisionOptions(record, product && (product.item || {mesh: product.object}));
    if (product) options.ignore.push(product.object);
    // An already displayed pallet remains on its support while real tines
    // enter its declared openings. Only those tines are excluded: a chassis,
    // mast or a newly generated overlapping load must still block placement.
    if (product && product.object.visible && runtime.vehicleRuntime) {
      product.object.updateWorldMatrix(true, true);
      if (matrix.elements.every((value, index) => Math.abs(value - product.object.matrixWorld.elements[index]) < 1e-5)) runtime.records.forEach(vehicle => {
        if (!vehicle.components.vehicle) return;
        if (runtime.vehicleRuntime.pocketClearance(vehicle, product, -1) && runtime.vehicleRuntime.pocketClearance(vehicle, product, 1)) {
          const rig = runtime.vehicleRuntime.rig(vehicle); if (rig && rig.forks) options.ignore.push(rig.forks);
        }
      });
    }
    return !world.testBox(bounds.clone().applyMatrix4(matrix), options);
  }

  /** Expose an existing FIFO load only after its actual body fits the tray.
   * A completed processor load may already have a mesh: it needs the same
   * clearance check as a newly materialized Source load before becoming visible.
   */
  present(record, source, entry, options = {}) {
    const product = entry && entry.product;
    if (!product) return null;
    // A captured hand owns its pose. Never hide or pull an in-flight grab back
    // to an inventory display, even if a caller still holds the old entry.
    if (product.heldBy && !options.accepting) { source.blocked = true; return null; }
    const matrix = this.frontMatrix(record, product.bounds, product.scale, source.position);
    if (!this.canPlace(record, product.bounds, matrix, product)) {
      product.object.visible = false; source.blocked = true; return null;
    }
    if (product.object.parent !== source.helper) source.helper.add(product.object);
    this.runtime.setProductMatrix(product, matrix);
    product.object.visible = true;
    product.scale.copy(product.object.getWorldScale(new THREE.Vector3()));
    if (product.item) {
      product.item.beltId = null;
      product.item.box.copy(product.bounds).applyMatrix4(matrix);
      product.item.previous.copy(product.item.box); product.item.swept.copy(product.item.box);
    }
    return product;
  }

  materialize(record, source = record.components.source) {
    const entry = source && source.queue[0];
    if (!entry || !visible(record.object)) return null;
    if (entry.product) return this.present(record, source, entry);
    const bounds = this.loadBounds(entry), scale = entry.scale && new THREE.Vector3().fromArray(entry.scale), matrix = this.frontMatrix(record, bounds, scale, source.position);
    if (!this.canPlace(record, bounds, matrix)) { source.blocked = true; return null; }
    const object = createSourceProductVisual(entry.spec, entry.load);
    object.name = entry.spec.name + ' · ' + entry.id;
    object.userData.editorRuntimeHelper = true; object.userData.editorCollisionBody = true;
    Object.assign(object.userData, {sourceProductId: entry.id, sourceOriginId: entry.originId, sourceSku: entry.spec.id,
      sourceUnits: entry.units, sourceLineage: entry.lineage.slice()});
    if (object.userData.sourceProduct) object.userData.sourceProduct.units = entry.units;
    source.helper.add(object); object.updateWorldMatrix(true, true);
    const item = {mesh: object, sourceEntry: entry, beltId: null, box: new THREE.Box3(), previous: new THREE.Box3(), swept: new THREE.Box3()};
    const product = this.runtime.registerProduct(object, null, item);
    item.product = product; item.bounds = product.bounds; item.scale = product.scale;
    product.sourceId = ''; product.sourceEntry = entry; entry.product = product;
    this.runtime.setProductMatrix(product, this.frontMatrix(record, product.bounds, scale, source.position));
    product.scale.copy(object.getWorldScale(new THREE.Vector3()));
    entry.scale = product.scale.toArray();
    item.box.copy(product.bounds).applyMatrix4(object.matrixWorld); item.previous.copy(item.box); item.swept.copy(item.box);
    // The real model can include a bottle neck or pallet overhang beyond the
    // conservative inventory estimate. Never leave that body in another load.
    if (!this.canPlace(record, product.bounds, object.matrixWorld, product)) {
      this.dematerialize(entry); source.blocked = true; return null;
    }
    return product;
  }

  generate(record) {
    const source = record.components.source;
    if (!source || !source.enabled || !visible(record.object)) return false;
    const config = source.config;
    if (source.queue.length >= config.capacity || config.totalLimit && source.generated >= config.totalLimit || this.liveLoads() >= MAX_LOADS) {
      source.generationBlocked = true; source.blocked = true; return false;
    }
    const spec = sources.specAt(config, source.generated);
    const entry = {id: record.id + ':' + this.runtime.runSequence + ':' + (++this.sequence), originId: record.id, ownerId: record.id,
      spec: Object.assign({}, spec), load: {loadMode: config.loadMode, palletColumns: config.palletColumns, palletRows: config.palletRows, palletLayers: config.palletLayers,
        palletType: config.palletType, palletMaterial: config.palletMaterial, palletPacking: config.palletPacking, palletWidth: config.palletWidth, palletDepth: config.palletDepth},
      units: sources.unitsFor(config, spec), lineage: [record.id], product: null};
    this.entries.add(entry); source.queue.push(entry); source.generated++; source.generatedUnits += entry.units;
    source.generationBlocked = false;
    this.runtime.event(record.id, 'source-generated', 'Carga generada: ' + spec.name + ' (' + entry.units + ' ud.).');
    this.materialize(record);
    return true;
  }

  dematerialize(entry) {
    const product = entry.product;
    if (!product) return;
    entry.product = null;
    if (product.record) {
      // Authored assets belong to the document. Emptying a queue releases that
      // real object; stopping has already restored its original authored pose.
      if (!this.runtime.stopping) {
        product.object.updateWorldMatrix(true, true);
        const matrix = product.object.matrixWorld.clone(), root = this.runtime.document.getRoot && this.runtime.document.getRoot(this.runtime.roomId) || this.runtime.ctx.scene;
        if (root) root.add(product.object);
        this.runtime.setProductMatrix(product, matrix);
      }
      return;
    }
    this.runtime.disposePackage(product.item || {mesh: product.object});
  }

  remove(record, entry, mode, source = record.components.source) {
    const index = source.queue.indexOf(entry);
    if (index === -1) return false;
    source.queue.splice(index, 1); source.delivered++; source.deliveredUnits += entry.units;
    entry.ownerId = ''; source.blocked = false; source.transferBlocked = false;
    const type = record.components.processor ? 'processor-exit' : record.components.palletQueue ? 'pallet-queue-exit' : 'source-delivered';
    this.runtime.event(record.id, type, 'Salida ' + mode + ': ' + entry.spec.name + ' (' + entry.units + ' ud.).');
    return true;
  }

  picked(product) {
    const entry = product && product.sourceEntry, record = entry && this.runtime.records.get(entry.ownerId);
    if (!record || !record.components.source || !this.remove(record, entry, 'manual')) return;
    // The next load waits until the held load has physically cleared the tray.
    this.materialize(record);
  }

  port(record, outgoing, portName = 'input') {
    const source = record.components.source, belt = record.components.conveyor, processor = record.components.processor, palletQueue = record.components.palletQueue;
    let point;
    if (source) {
      const layout = sources.layout(source.config);
      point = outgoing ? layout.outlet : layout.input || layout.inlet;
    } else if (processor) {
      const layout = behaviorSchema.conveyorLayout.processorLayout(processor.config);
      point = outgoing ? layout.outlet : layout.input;
    } else if (palletQueue) {
      const layout = behaviorSchema.conveyorLayout.palletQueueLayout(palletQueue.config);
      point = outgoing ? layout.outlet : layout.input;
    } else if (belt) {
      const route = portName === 'branch' ? 'branch' : 'main';
      point = this.runtime.pathPoint(belt.config, outgoing ? this.runtime.pathLength(belt.config, route) : 0, route);
    }
    if (!point) return null;
    record.object.updateWorldMatrix(true, false);
    const position = source || processor || palletQueue ? new THREE.Vector3(point.x, point.y || 0, point.z).applyMatrix4(record.object.matrixWorld) : this.runtime.pathSurface(record, belt, point);
    const direction = new THREE.Vector3(point.tx, point.ty || 0, point.tz).transformDirection(record.object.matrixWorld);
    const up = new THREE.Vector3(0, 1, 0).transformDirection(record.object.matrixWorld);
    return {position, direction, up, point};
  }

  aligned(from, to, portName = 'input') {
    const a = this.port(from, true), b = this.port(to, false, portName);
    return !!a && !!b && a.position.distanceTo(b.position) <= 0.18 && a.direction.dot(b.direction) >= 0.85 && a.up.dot(b.up) >= 0.95;
  }

  receive(record, entry) {
    const source = record && record.components.source;
    if (!source || !source.enabled || !source.running || source.paused || !visible(record.object) || source.queue.length >= source.config.capacity || !this.fits(record, entry)) return false;
    if (entry.product && entry.product.record && source.queue.length) return false;
    if (entry.ownerId === record.id || source.queue.includes(entry)) return false;
    const hadFront = source.queue.length > 0;
    source.queue.push(entry); entry.ownerId = record.id;
    entry.lineage.push(record.id); if (entry.lineage.length > 64) entry.lineage.shift();
    source.received++; source.receivedUnits += entry.units;
    if (entry.product) {
      if (hadFront) this.dematerialize(entry);
      else {
        const product = entry.product;
        Object.assign(product.object.userData, {sourceLineage: entry.lineage.slice()});
        this.present(record, source, entry);
      }
    }
    this.materialize(record);
    this.runtime.event(record.id, 'source-received', 'Carga recibida: ' + entry.spec.name + ' (' + entry.units + ' ud.).');
    return true;
  }

  fits(record, entry) {
    const layout = sources.layout(record.components.source.config), scale = record.object.getWorldScale(new THREE.Vector3());
    const bounds = entry.product ? entry.product.bounds : this.loadBounds(entry), size = bounds.getSize(new THREE.Vector3());
    const loadScale = entry.product ? entry.product.scale : entry.scale ? new THREE.Vector3().fromArray(entry.scale) : scale;
    return Math.abs(size.x * loadScale.x) <= layout.length * Math.abs(scale.x) - .1 &&
      Math.abs(size.z * loadScale.z) <= layout.width * Math.abs(scale.z) - .1;
  }

  beltTransferDetails(record, belt, item, target, portName, reservations = []) {
    if (target && target.components.palletQueue) return this.runtime.palletQueueRuntime.beltTransferDetails(record, belt, item, target, portName, reservations);
    if (target && target.components.processor) return this.runtime.processorRuntime.beltTransferDetails(record, belt, item, target, portName, reservations);
    const receiver = target && target.components.source, runtime = this.runtime;
    const blocked = {blocked: true};
    if (!receiver || target === record || portName !== 'input' || !item.product ||
      !this.fits(target, item.product.sourceEntry || {product: item.product})) return blocked;
    const point = runtime.pathPoint(belt.config, runtime.pathLength(belt.config, item.route), item.route);
    const from = runtime.pathSurface(record, belt, point), to = this.port(target, false);
    const direction = runtime.pathVector(record, point.tx, point.tz).normalize();
    if (!to || from.distanceTo(to.position) > .18 || direction.dot(to.direction) < .85 || runtime.pathUp(record).dot(to.up) < .95) return blocked;
    const reserved = reservations.filter(transfer => transfer.sourceBuffer && transfer.target === target).length;
    if (item.product.record && (receiver.queue.length || reserved)) return blocked;
    if (!receiver.enabled || !receiver.running || receiver.paused || !visible(target.object) || receiver.queue.length + reserved >= receiver.config.capacity) return blocked;
    if (!receiver.queue.length && !reserved && !this.canPlace(target, item.product.bounds, this.frontMatrix(target, item.product.bounds, item.product.scale), item.product)) return blocked;
    return {record, belt, item, target, receiver, sourceBuffer: true, blocked: false};
  }

  entryForProduct(record, product) {
    let item = product.item;
    if (!item) {
      product.object.updateWorldMatrix(true, true);
      const box = product.bounds.clone().applyMatrix4(product.object.matrixWorld);
      item = product.item = {mesh: product.object, authored: !!product.record, product, bounds: product.bounds, scale: product.scale,
        beltId: null, box, previous: box.clone(), swept: box.clone()};
    }
    let entry = product.sourceEntry;
    if (!entry) {
      // Legacy procedural belt cartons can enter a buffer too. Their existing
      // physical load becomes the inventory entry; nothing is regenerated.
      const size = product.bounds.getSize(new THREE.Vector3());
      const metadata = product.object.userData.sourceProduct, classification = this.runtime.productMetadata(product);
      const authored = product.record && product.record.components.product && product.record.components.product.config || {};
      const totalUnits = classification.units || 1, palletMode = classification.loadMode === 'pallet';
      const load = Object.assign({loadMode: palletMode ? 'pallet' : 'individual', palletColumns: 1, palletRows: 1, palletLayers: 1}, metadata || {}, authored);
      const tare = palletMode ? Math.min(classification.mass, behaviorSchema.productSources.pallets.dimensions(load, true).tare) : 0;
      load.palletTare = tare;
      entry = {id: record.id + ':' + this.runtime.runSequence + ':' + (++this.sequence), originId: record.id, ownerId: '',
        spec: {id: classification.sku, name: metadata && metadata.label || product.object.name || 'Caja', type: classification.productType,
          width: metadata && metadata.productWidth || Math.abs(size.x), height: metadata && metadata.productHeight || Math.abs(size.y), depth: metadata && metadata.productDepth || Math.abs(size.z), color: classification.color,
          mass: Math.max(0, classification.mass - tare) / totalUnits, base: classification.base,
          quality: classification.quality, defect: classification.defect},
        load, units: totalUnits,
        lineage: [record.id], scale: product.scale.toArray(), product};
      product.sourceEntry = entry; if (item) item.sourceEntry = entry; this.entries.add(entry);
      Object.assign(product.object.userData, {sourceProductId: entry.id, sourceOriginId: entry.originId, sourceSku: entry.spec.id, sourceUnits: entry.units});
    }
    return entry;
  }

  receiveBelt(transfer) {
    const {record, item, target} = transfer, product = item.product;
    const entry = this.entryForProduct(record, product);
    item.beltId = null; item.exited = false;
    const received = target.components.processor ? this.runtime.processorRuntime.receive(target, entry) :
      target.components.palletQueue ? this.runtime.palletQueueRuntime.receive(target, entry, false, transfer.placement) : this.receive(target, entry);
    if (!received) throw new Error('La cola cambió durante una transferencia desde la banda.');
    product.enteredBelts.delete(record.id);
    product.routingDecisions.delete(record.id);
    this.runtime.scopeMovement(product, record.id, null);
    this.runtime.event(record.id, 'package-transfer', 'Carga transferida a ' + (target.object.name || target.id) + '.');
  }

  dispatch(record, source = record.components.source) {
    const runtime = this.runtime, entry = source && source.queue[0];
    if (!source || !entry || !source.enabled || !source.running || source.paused || !visible(record.object)) return false;
    const target = runtime.records.get(source.config.outputId);
    const blocked = () => { source.transferBlocked = true; source.blocked = true; return false; };
    if (entry.product && (entry.product.robotReservedBy || entry.product.robotOwnerId || entry.product.vehicleReservedBy || entry.product.vehicleOwnerId)) return blocked();
    if (runtime.robotRuntime && !runtime.robotRuntime.canDispatch(record, entry.product)) return blocked();
    if (!target || target === record || !this.aligned(record, target, source.config.outputPort)) return blocked();
    if (target.components.palletQueue) {
      if (!this.materialize(record, source) || !runtime.palletQueueRuntime.canReceive(target, entry)) return blocked();
      this.remove(record, entry, 'automática', source);
      if (!runtime.palletQueueRuntime.receive(target, entry)) throw new Error('La estiba cambió durante una transferencia.');
      this.materialize(record, source); return true;
    }
    if (target.components.processor) {
      if (!runtime.processorRuntime.canReceive(target, entry)) return blocked();
      this.remove(record, entry, 'automática', source);
      if (!runtime.processorRuntime.receive(target, entry)) throw new Error('El procesador cambió durante una transferencia.');
      this.materialize(record, source); return true;
    }
    if (target.components.source) {
      const receiver = target.components.source;
      if (!receiver.enabled || !receiver.running || receiver.paused || receiver.queue.length >= receiver.config.capacity || !visible(target.object) || !this.fits(target, entry)) return blocked();
      if (entry.product && entry.product.record && receiver.queue.length) return blocked();
      // A visible incoming load must fit the empty receiver before committing
      // either inventory. Non-front entries remain data until the tray clears.
      if (!receiver.queue.length) {
        const bounds = entry.product ? entry.product.bounds : this.loadBounds(entry), scale = entry.product ? entry.product.scale : entry.scale && new THREE.Vector3().fromArray(entry.scale);
        const matrix = this.frontMatrix(target, bounds, scale);
        if (!this.canPlace(target, bounds, matrix, entry.product)) return blocked();
      }
      this.remove(record, entry, 'automática', source);
      if (!this.receive(target, entry)) throw new Error('La cola cambió durante una transferencia de producto.');
      this.materialize(record, source); return true;
    }
    const belt = target.components.conveyor;
    if (!belt || source.config.outputPort === 'branch' && !(belt.config.layout === 'tee' && belt.config.junctionMode === 'merge') ||
      !runtime.admissionReady(target, belt)) return blocked();
    const product = this.materialize(record, source);
    if (!product) return blocked();
    const route = source.config.outputPort === 'branch' ? 'branch' : 'main';
    const point = runtime.pathPoint(belt.config, 0, route), extent = product.bounds.getSize(new THREE.Vector3()).multiply(product.scale);
    if (Math.abs(extent.z) + 0.01 > belt.config.width * runtime.widthScale(target, point)) return blocked();
    if (!runtime.captureProduct(product, {record: target, belt, offset: -runtime.pathLength(belt.config, route) / 2, lateral: 0, route})) return blocked();
    this.remove(record, entry, 'automática', source); this.materialize(record, source);
    return true;
  }

  command(record, action) {
    const source = record.components.source;
    let result;
    if (action === 'generate' || action === 'insertBox') result = this.generate(record);
    else if (action === 'dispatch') result = this.dispatch(record);
    else if (action === 'clearQueue') {
      source.queue.slice().forEach(entry => { entry.ownerId = ''; this.dematerialize(entry); this.entries.delete(entry); });
      source.queue = []; source.blocked = false; source.generationBlocked = false; source.transferBlocked = false; result = true;
      this.runtime.event(record.id, 'source-cleared', 'Cola vaciada por el operador.');
    } else if (action === 'start' || action === 'powerOn') { this.runtime.setVariable(record.id, 'paused', false); result = this.runtime.setVariable(record.id, 'running', true); }
    else if (action === 'stop' || action === 'powerOff') { this.runtime.setVariable(record.id, 'paused', false); result = this.runtime.setVariable(record.id, 'running', false); }
    else if (action === 'pause') result = this.runtime.setVariable(record.id, 'paused', !source.paused);
    else throw new Error('Mando del generador no compatible.');
    this.runtime.refreshVariables(); return result;
  }

  step(delta) {
    this.runtime.records.forEach(record => {
      const source = record.components.source;
      if (!source || !source.enabled || !visible(record.object)) return;
      source.blocked = false; source.transferBlocked = false;
      const atLimit = source.config.totalLimit && source.generated >= source.config.totalLimit;
      source.generationBlocked = source.queue.length >= source.config.capacity || !!atLimit || this.liveLoads() >= MAX_LOADS;
      if (source.running && !source.paused && source.autoGenerate) {
        source.elapsed = Math.min(source.interval, source.elapsed + delta);
        if (source.elapsed >= source.interval && this.generate(record)) source.elapsed = 0;
      }
      this.materialize(record);
      if (source.running && !source.paused && source.config.delivery === 'automatic') {
        source.outputElapsed = Math.min(source.outputInterval, source.outputElapsed + delta);
        if (source.outputElapsed >= source.outputInterval && source.queue.length && this.dispatch(record)) source.outputElapsed = 0;
      }
      source.blocked = source.blocked || source.generationBlocked || source.transferBlocked;
    });
  }

  disposed(product) {
    const entry = product && product.sourceEntry;
    if (!entry) return;
    if (entry.product === product) entry.product = null;
    if (!entry.ownerId) this.entries.delete(entry);
  }

  stop() {
    this.entries.forEach(entry => { entry.ownerId = ''; if (entry.product && this.runtime.products.has(entry.product.object)) this.dematerialize(entry); });
    this.runtime.records.forEach(record => {
      const source = record.components.source;
      if (source) { source.queue = []; if (source.helper.parent) source.helper.parent.remove(source.helper); }
    });
    this.entries.clear();
  }
}
