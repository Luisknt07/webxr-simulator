import * as THREE from 'three';
import behaviorSchema from '../../shared/behaviors.js';

function visible(object) { for (let node = object; node; node = node.parent) if (!node.visible) return false; return true; }

/** A physical, independent pallet store. It receives existing loads only. */
export default class PalletQueueRuntime {
  constructor(runtime) { this.runtime = runtime; this.sequence = 0; }

  attach(record, component) {
    const config = component.config, helper = new THREE.Group();
    helper.name = 'Cargas de la estiba'; helper.userData.editorRuntimeHelper = true; record.object.add(helper);
    let marker;
    record.object.traverse(object => { if (!marker && object.userData.industrialPallet) marker = object; });
    marker = marker || record.object;
    Object.assign(component, {ownerId: record.id, enabled: true, running: config.running, paused: config.paused, outputInterval: config.outputInterval,
      outputElapsed: config.outputInterval, queue: [], items: [], received: 0, receivedUnits: 0, blocked: false, retryAt: 0, helper});
    component.pallet = {object: marker, config: Object.assign({}, config, {top: marker === record.object ? -.85 : .15, fitMargin: 0}), items: component.items};
    component.inventory = {queue: component.queue, helper, config, enabled: true, running: config.running, paused: config.paused,
      delivered: 0, deliveredUnits: 0, blocked: false, transferBlocked: false};
    record.writable.push({key: 'enabled', type: 'boolean', label: 'Habilitado'}, {key: 'running', type: 'boolean', label: 'En marcha'},
      {key: 'paused', type: 'boolean', label: 'En pausa'}, {key: 'outputInterval', type: 'number', label: 'Intervalo de salida (s)', min: .1, max: 120});
  }

  operational(component) { return component.enabled && component.running && !component.paused; }

  itemFor(product) {
    if (product.item) return product.item;
    product.object.updateWorldMatrix(true, true);
    const box = product.bounds.clone().applyMatrix4(product.object.matrixWorld);
    return product.item = {mesh: product.object, product, authored: !!product.record, bounds: product.bounds, scale: product.scale,
      beltId: null, box, previous: box.clone(), swept: box.clone()};
  }

  top(component, item) {
    const cells = component.config.columns * component.config.rows, cell = item.palletSlot % cells;
    return !component.items.some(other => other !== item && other.palletSlot % cells === cell && other.palletSlot > item.palletSlot);
  }

  canPickup(product) {
    const item = product && product.item, record = item && this.runtime.records.get(item.palletOwnerId), component = record && record.components.palletQueue;
    return !component || this.top(component, item);
  }

  collisionOptions(record, item, reservations = []) {
    const options = this.runtime.packageCollisionOptions(record, item);
    // The wood, guard rail and control post remain real collision geometry.
    options.ignore = options.ignore.filter(object => object !== record.object);
    if (item.mesh) options.ignore.push(item.mesh);
    reservations.forEach(reservation => { if (reservation.box) options.extraBoxes.push(reservation.box); });
    return options;
  }

  placement(record, product, reservations = [], preferredCenter) {
    const component = record.components.palletQueue;
    if (!component || component.queue.length + reservations.length >= component.config.capacity) return null;
    const item = this.itemFor(product), occupied = new Set(component.items.map(value => value.palletSlot));
    reservations.forEach(value => occupied.add(value.slot));
    let best = null;
    for (let slot = 0; slot < component.config.capacity; slot++) {
      if (occupied.has(slot)) continue;
      const target = this.runtime.palletMatrix(component.pallet, item, slot);
      if (!target) continue;
      const box = product.bounds.clone().applyMatrix4(target.matrix), world = this.runtime.ctx.collisionWorld;
      if (world && world.testBox(box, this.collisionOptions(record, item, reservations))) continue;
      const candidate = {slot, matrix: target.matrix, bounds: box, box, height: target.height};
      if (!preferredCenter) return candidate;
      const distance = preferredCenter.distanceTo(box.getCenter(new THREE.Vector3()));
      if (!best || distance < best.distance) best = Object.assign(candidate, {distance});
    }
    return best;
  }

  canReceive(record, entry, manual = false, reservations = []) {
    const component = record && record.components.palletQueue;
    if (!component || !component.enabled || !manual && !this.operational(component) || !visible(record.object) || !entry.product || component.queue.includes(entry)) return false;
    const accepted = !!this.placement(record, entry.product, reservations);
    component.blocked = !accepted;
    return accepted;
  }

  receive(record, entry, manual = false, placement) {
    const component = record && record.components.palletQueue;
    if (!component || !component.enabled || !manual && !this.operational(component) || !visible(record.object) || !entry.product || component.queue.includes(entry)) return false;
    const target = placement || this.placement(record, entry.product);
    if (!target) { component.blocked = true; return false; }
    const product = entry.product, item = this.itemFor(product);
    entry.ownerId = record.id; entry.lineage.push(record.id); if (entry.lineage.length > 64) entry.lineage.shift();
    entry.palletSequence = ++this.sequence;
    component.helper.add(product.object); product.object.visible = true;
    this.runtime.setProductMatrix(product, target.matrix);
    Object.assign(item, {sourceEntry: entry, palletOwnerId: record.id, palletSide: 'queue', palletSlot: target.slot,
      stackHeight: target.height, beltId: null, exited: false, blocked: false});
    item.box.copy(target.bounds); item.previous.copy(item.box); item.swept.copy(item.box);
    product.sourceEntry = entry; product.sourceId = ''; product.processorLocked = false; product.processorOwnerId = '';
    product.enteredBelts.clear();
    Object.assign(product.object.userData, {sourceProductId: entry.id, sourceOriginId: entry.originId, sourceSku: entry.spec.id,
      sourceUnits: entry.units, sourceLineage: entry.lineage.slice()});
    component.items.push(item); component.queue.push(entry); component.received++; component.receivedUnits += entry.units; component.blocked = false;
    this.runtime.sourceRuntime.entries.add(entry); this.order(component);
    this.runtime.event(record.id, 'pallet-queue-entry', 'Carga apilada en la estiba: ' + component.queue.length + '/' + component.config.capacity + '.');
    return true;
  }

  order(component) {
    component.queue.sort((a, b) => {
      const aTop = this.top(component, a.product.item), bTop = this.top(component, b.product.item);
      return Number(bTop) - Number(aTop) || b.palletSequence - a.palletSequence;
    });
  }

  removeItem(component, product) {
    const item = product.item;
    const index = component.items.indexOf(item); if (index !== -1) component.items.splice(index, 1);
    // Receiving storage has already assigned its own slot during a handoff.
    // Removing the source membership must preserve that new ownership.
    if (item.palletOwnerId === component.ownerId) { item.palletOwnerId = null; item.palletSide = null; item.palletSlot = null; }
    component.blocked = false;
    this.order(component);
  }

  picked(product) {
    const item = product && product.item, record = item && this.runtime.records.get(item.palletOwnerId), component = record && record.components.palletQueue;
    if (!component || !this.top(component, item)) return;
    const entry = product.sourceEntry;
    if (!entry || !this.runtime.sourceRuntime.remove(record, entry, 'manual', component.inventory)) return;
    this.removeItem(component, product);
  }

  dispatch(record) {
    const component = record.components.palletQueue;
    this.order(component);
    const entry = component.queue[0];
    if (!entry || !this.operational(component)) return false;
    Object.assign(component.inventory, {enabled: component.enabled, running: component.running, paused: component.paused});
    const product = entry.product;
    const result = this.runtime.sourceRuntime.dispatch(record, component.inventory);
    if (result) this.removeItem(component, product);
    else component.blocked = true;
    return result;
  }

  beltTransferDetails(record, belt, item, target, portName, reservations = []) {
    const runtime = this.runtime, blocked = {blocked: true};
    if (portName !== 'input' || !item.product) return blocked;
    const entry = item.product.sourceEntry || {product: item.product};
    const sameTarget = reservations.filter(value => value.palletQueue && value.target === target).map(value => value.placement);
    const receiver = target.components.palletQueue;
    if (!receiver || !this.operational(receiver) || !visible(target.object)) return blocked;
    const point = runtime.pathPoint(belt.config, runtime.pathLength(belt.config, item.route), item.route), to = runtime.sourceRuntime.port(target, false);
    if (!to || runtime.pathSurface(record, belt, point).distanceTo(to.position) > .18 || runtime.pathVector(record, point.tx, point.tz).normalize().dot(to.direction) < .85 || runtime.pathUp(record).dot(to.up) < .95) return blocked;
    if (!this.canReceive(target, entry, false, sameTarget)) return blocked;
    const placement = this.placement(target, item.product, sameTarget);
    return {record, belt, item, target, receiver, sourceBuffer: true, palletQueue: true, placement, box: placement.bounds, blocked: false};
  }

  findPlacement(product, tolerance = .6) {
    product.object.updateWorldMatrix(true, true);
    const current = product.bounds.clone().applyMatrix4(product.object.matrixWorld), center = current.getCenter(new THREE.Vector3());
    let best = null;
    this.runtime.records.forEach(record => {
      const component = record.components.palletQueue;
      if (!component || !component.enabled || !visible(record.object)) return;
      const candidate = this.placement(record, product, [], center);
      if (!candidate) {
        const config = component.config, layout = behaviorSchema.conveyorLayout.palletQueueLayout(config);
        record.object.updateWorldMatrix(true, false);
        const up = new THREE.Vector3(0, 1, 0).transformDirection(record.object.matrixWorld), inverse = new THREE.Matrix4().getInverse(record.object.matrixWorld);
        const height = component.items.reduce((max, item) => Math.max(max, item.box.clone().applyMatrix4(inverse).max.y), layout.palletTop);
        const region = new THREE.Box3(new THREE.Vector3(-config.width / 2, layout.palletTop, -config.depth / 2),
          new THREE.Vector3(config.width / 2, Math.max(layout.palletTop + .2, height + .5), config.depth / 2)).applyMatrix4(record.object.matrixWorld);
        const distance = center.distanceTo(region.clampPoint(center, new THREE.Vector3()));
        if (distance <= tolerance && (!best || distance < best.distance)) best = {record, target: record.object, distance, accepted: false, kind: 'top', normal: up};
        return;
      }
      const distance = center.distanceTo(candidate.bounds.getCenter(new THREE.Vector3()));
      if (distance > tolerance || best && best.distance <= distance) return;
      best = Object.assign({}, candidate, {record, target: record.object, kind: 'top', distance, snapped: distance <= .22, accepted: true,
        normal: new THREE.Vector3(0, 1, 0).transformDirection(record.object.matrixWorld), point: candidate.bounds.getCenter(new THREE.Vector3()).setY(candidate.bounds.min.y)});
    });
    return best;
  }

  receiveManual(product, placement) {
    if (!placement || !placement.accepted) return false;
    const entry = this.runtime.sourceRuntime.entryForProduct(placement.record, product);
    return this.receive(placement.record, entry, true, placement);
  }

  step(delta) {
    this.runtime.records.forEach(record => {
      const component = record.components.palletQueue;
      if (!component || !visible(record.object) || !this.operational(component) || component.config.delivery !== 'automatic') return;
      component.outputElapsed = Math.min(component.outputInterval, component.outputElapsed + delta);
      if (component.outputElapsed >= component.outputInterval && component.queue.length && this.dispatch(record)) component.outputElapsed = 0;
    });
  }

  variables(record) {
    const component = record.components.palletQueue;
    return {enabled: component.enabled, running: component.running, paused: component.paused, outputInterval: component.outputInterval,
      received: component.received, receivedUnits: component.receivedUnits, delivered: component.inventory.delivered, deliveredUnits: component.inventory.deliveredUnits,
      queued: component.queue.length, queuedUnits: component.queue.reduce((sum, entry) => sum + entry.units, 0), capacity: component.config.capacity,
      full: component.queue.length >= component.config.capacity, empty: !component.queue.length, blocked: component.blocked,
      occupancy: component.queue.length / component.config.capacity * 100, columns: component.config.columns, rows: component.config.rows, layers: component.config.layers};
  }

  command(record, action) {
    const runtime = this.runtime, component = record.components.palletQueue;
    let result;
    if (action === 'dispatch') result = this.dispatch(record);
    else if (action === 'start') { runtime.setVariable(record.id, 'paused', false); result = runtime.setVariable(record.id, 'running', true); }
    else if (action === 'stop') result = runtime.setVariable(record.id, 'running', false);
    else if (action === 'pause') result = runtime.setVariable(record.id, 'paused', !component.paused);
    else throw new Error('Mando de estiba no compatible.');
    runtime.refreshVariables(); return result;
  }

  stop() {
    this.runtime.records.forEach(record => {
      const component = record.components.palletQueue;
      if (!component) return;
      if (component.helper.parent) component.helper.parent.remove(component.helper);
      component.items.length = 0; component.queue.length = 0;
    });
  }
}
