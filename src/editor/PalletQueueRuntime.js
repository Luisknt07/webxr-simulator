import * as THREE from 'three';
import behaviorSchema from '../../shared/behaviors.js';

function visible(object) { for (let node = object; node; node = node.parent) if (!node.visible) return false; return true; }

/** A physical, independent pallet store. It receives existing loads only. */
export default class PalletQueueRuntime {
  constructor(runtime) { this.runtime = runtime; this.sequence = 0; }

  attach(record, component) {
    const config = behaviorSchema.palletQueues.settings(component.config), helper = new THREE.Group(); component.config = config;
    helper.name = 'Cargas de la estiba'; helper.userData.editorRuntimeHelper = true; record.object.add(helper);
    const layout = behaviorSchema.conveyorLayout.palletQueueLayout(config);
    Object.assign(component, {ownerId: record.id, enabled: true, running: config.running, paused: config.paused, outputInterval: config.outputInterval,
      outputElapsed: config.outputInterval, releaseElapsed: 0, dispatchedPallets: 0, queue: [], items: [], received: 0, receivedUnits: 0, blocked: false, retryAt: 0, helper});
    component.pallets = (layout.pallets || [{index: 0, position: [0, -1, 0]}]).map(bay => {
      const marker = new THREE.Group(); marker.name = 'Posición de pallet ' + (bay.index + 1);
      marker.userData.editorRuntimeHelper = true; marker.position.fromArray(bay.position); helper.add(marker);
      return {object: marker, config: Object.assign({}, config, {top: config.palletHeight, fitMargin: 0}), items: [], full: false};
    });
    component.pallet = component.pallets[0];
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
    if (component.config.layoutMode === 'fit') {
      const a = item.fitPlacement;
      return !a || !component.items.some(other => {
        const b = other.fitPlacement;
        return other !== item && b && other.palletIndex === item.palletIndex && b.y > a.y &&
          a.x < b.x + b.width - 1e-7 && a.x + a.width > b.x + 1e-7 && a.z < b.z + b.depth - 1e-7 && a.z + a.depth > b.z + 1e-7;
      });
    }
    const cells = component.config.columns * component.config.rows, cell = item.palletSlot % cells;
    return !component.items.some(other => other !== item && (other.palletIndex || 0) === (item.palletIndex || 0) && other.palletSlot % cells === cell && other.palletSlot > item.palletSlot);
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

  fitPlacement(record, product, reservations, markFull) {
    const component = record.components.palletQueue, config = component.config, item = this.itemFor(product), packing = behaviorSchema.palletQueues.pallets;
    for (let palletIndex = 0; palletIndex < component.pallets.length; palletIndex++) {
      const pallet = component.pallets[palletIndex], reserved = reservations.filter(value => value.palletIndex === palletIndex);
      const quota = behaviorSchema.palletQueues.bayCapacity(config, palletIndex);
      if (!quota || pallet.full || pallet.items.length + reserved.length >= quota) continue;
      const existing = pallet.items.map(value => value.fitPlacement).concat(reserved.map(value => value.fitPlacement)).filter(Boolean);
      pallet.object.updateWorldMatrix(true, false);
      const inverse = new THREE.Matrix4().getInverse(pallet.object.matrixWorld), origin = pallet.object.getWorldPosition(new THREE.Vector3());
      const quaternion = pallet.object.getWorldQuaternion(new THREE.Quaternion());
      let geometricallyFits = false;
      for (const turned of [false, true]) {
        const rotation = quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), turned ? Math.PI / 2 : 0));
        const unit = new THREE.Matrix4().compose(origin, rotation, item.scale);
        const local = product.bounds.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, unit)), size = local.getSize(new THREE.Vector3());
        const placement = packing.place(config.width, config.depth, {width: size.x, depth: size.z, height: size.y}, existing, config.layers, false, config.maxStackHeight);
        if (!placement) continue;
        geometricallyFits = true; placement.rotated = turned;
        const center = new THREE.Vector3(placement.x + placement.width / 2 - config.width / 2, config.palletHeight + .005 + placement.y + placement.height / 2, placement.z + placement.depth / 2 - config.depth / 2).applyMatrix4(pallet.object.matrixWorld);
        center.sub(product.bounds.getCenter(new THREE.Vector3()).multiply(item.scale).applyQuaternion(rotation));
        const matrix = new THREE.Matrix4().compose(center, rotation, item.scale), box = product.bounds.clone().applyMatrix4(matrix), world = this.runtime.ctx.collisionWorld;
        if (world && world.testBox(box, this.collisionOptions(record, item, reservations))) continue;
        const used = new Set(pallet.items.map(value => value.palletSlot).concat(reserved.map(value => value.slot)));
        let slot = 0; while (used.has(slot)) slot++;
        return {slot, globalSlot: palletIndex * 500 + slot, palletIndex, matrix, bounds: box, box, height: size.y, fitPlacement: placement};
      }
      // A full footprint/5-layer stack is complete even when its nominal load
      // quota is larger. Oversize loads never seal an otherwise empty bay.
      const physical = product.bounds.getSize(new THREE.Vector3()).multiply(item.scale), bayScale = pallet.object.getWorldScale(new THREE.Vector3());
      const fitsEmpty = packing.place(config.width, config.depth, {width: Math.abs(physical.x / bayScale.x), depth: Math.abs(physical.z / bayScale.z), height: Math.abs(physical.y / bayScale.y)}, [], config.layers, true, config.maxStackHeight);
      if (markFull && !geometricallyFits && pallet.items.length && fitsEmpty) pallet.full = true;
    }
    return null;
  }

  placement(record, product, reservations = [], preferredCenter, markFull = false, receivingIgnore) {
    const component = record.components.palletQueue;
    if (!component || component.queue.length + reservations.length >= component.config.capacity) return null;
    const item = this.itemFor(product), perPallet = component.config.acceptsPallets ? 1 : component.config.columns * component.config.rows * component.config.layers;
    // Authored pallets keep their metadata in the visual child; generated
    // loads keep it on the root. Resolve both through the custody runtime.
    if (component.config.acceptsPallets && this.runtime.productMetadata(product).loadMode !== 'pallet') return null;
    if (component.config.layoutMode === 'fit' && !component.config.acceptsPallets) return this.fitPlacement(record, product, reservations, markFull);
    const occupied = new Set(component.items.map(value => (value.palletIndex || 0) * perPallet + value.palletSlot));
    reservations.forEach(value => occupied.add(value.globalSlot === undefined ? value.slot : value.globalSlot));
    let best = null;
    for (let globalSlot = 0; globalSlot < component.config.capacity; globalSlot++) {
      if (occupied.has(globalSlot)) continue;
      const palletIndex = Math.floor(globalSlot / perPallet), slot = globalSlot % perPallet, pallet = component.pallets[palletIndex];
      if (!pallet) continue;
      let target;
      if (component.config.acceptsPallets) {
        pallet.object.updateWorldMatrix(true, false);
        const rotation = pallet.object.getWorldQuaternion(new THREE.Quaternion()), scale = pallet.object.getWorldScale(new THREE.Vector3());
        const physical = item.bounds.getSize(new THREE.Vector3()).multiply(item.scale);
        if (Math.abs(physical.x) > component.config.width * Math.abs(scale.x) + .02 || Math.abs(physical.z) > component.config.depth * Math.abs(scale.z) + .02) continue;
        const center = item.bounds.getCenter(new THREE.Vector3()).multiply(item.scale);
        const offset = new THREE.Vector3(-center.x, .005 - Math.min(item.bounds.min.y * item.scale.y, item.bounds.max.y * item.scale.y), -center.z).applyQuaternion(rotation);
        target = {matrix: new THREE.Matrix4().compose(pallet.object.getWorldPosition(new THREE.Vector3()).add(offset), rotation, item.scale), height: Math.abs(physical.y)};
      } else target = this.runtime.palletMatrix(pallet, item, slot);
      if (!target) continue;
      const box = product.bounds.clone().applyMatrix4(target.matrix), world = this.runtime.ctx.collisionWorld;
      const options = this.collisionOptions(record, item, reservations);
      // Only the carrier runtime supplies this callback, after proving both
      // tines fit the pallet pockets at this exact final placement. Normal
      // stock queries keep every vehicle/chassis/mast collision unchanged.
      if (typeof receivingIgnore === 'function') options.ignore.push(...receivingIgnore(target.matrix));
      if (world && world.testBox(box, options)) continue;
      const candidate = {slot, globalSlot, palletIndex, matrix: target.matrix, bounds: box, box, height: target.height};
      if (!preferredCenter) return candidate;
      const distance = preferredCenter.distanceTo(box.getCenter(new THREE.Vector3()));
      if (!best || distance < best.distance) best = Object.assign(candidate, {distance});
    }
    return best;
  }

  canReceive(record, entry, manual = false, reservations = []) {
    const component = record && record.components.palletQueue;
    if (!component || !component.enabled || !manual && !this.operational(component) || !visible(record.object) || !entry.product || component.queue.includes(entry)) return false;
    const accepted = !!this.placement(record, entry.product, reservations, undefined, !manual);
    component.blocked = !accepted;
    return accepted;
  }

  receive(record, entry, manual = false, placement) {
    const component = record && record.components.palletQueue;
    if (!component || !component.enabled || !manual && !this.operational(component) || !visible(record.object) || !entry.product || component.queue.includes(entry)) return false;
    const target = placement || this.placement(record, entry.product, [], undefined, true);
    if (!target) { component.blocked = true; return false; }
    const product = entry.product, item = this.itemFor(product);
    entry.ownerId = record.id; entry.lineage.push(record.id); if (entry.lineage.length > 64) entry.lineage.shift();
    entry.palletSequence = ++this.sequence;
    component.helper.add(product.object); product.object.visible = true;
    this.runtime.setProductMatrix(product, target.matrix);
    Object.assign(item, {sourceEntry: entry, palletOwnerId: record.id, palletSide: 'queue', palletSlot: target.slot,
      palletIndex: target.palletIndex || 0, stackHeight: target.height, beltId: null, exited: false, blocked: false});
    item.fitPlacement = target.fitPlacement || null;
    item.box.copy(target.bounds); item.previous.copy(item.box); item.swept.copy(item.box);
    product.sourceEntry = entry; product.sourceId = ''; product.processorLocked = false; product.processorOwnerId = '';
    product.enteredBelts.clear();
    Object.assign(product.object.userData, {sourceProductId: entry.id, sourceOriginId: entry.originId, sourceSku: entry.spec.id,
      sourceUnits: entry.units, sourceLineage: entry.lineage.slice()});
    component.items.push(item); component.pallets[item.palletIndex].items.push(item); component.queue.push(entry); component.received++; component.receivedUnits += entry.units; component.blocked = false;
    if (component.pallets[item.palletIndex].items.length >= behaviorSchema.palletQueues.bayCapacity(component.config, item.palletIndex)) component.pallets[item.palletIndex].full = true;
    if (target.fitPlacement) {
      const pallet = component.pallets[item.palletIndex], pack = behaviorSchema.palletQueues.pallets;
      if (!pack.place(component.config.width, component.config.depth, target.fitPlacement, pallet.items.map(value => value.fitPlacement), component.config.layers, true, component.config.maxStackHeight)) pallet.full = true;
    }
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
    component.pallets.forEach(pallet => { const index = pallet.items.indexOf(item); if (index !== -1) { pallet.items.splice(index, 1); pallet.full = false; } });
    // Receiving storage has already assigned its own slot during a handoff.
    // Removing the source membership must preserve that new ownership.
    if (item.palletOwnerId === component.ownerId) { item.palletOwnerId = null; item.palletSide = null; item.palletSlot = null; item.palletIndex = null; }
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

  findPlacement(product, tolerance = .6, receivingIgnore) {
    product.object.updateWorldMatrix(true, true);
    const current = product.bounds.clone().applyMatrix4(product.object.matrixWorld), center = current.getCenter(new THREE.Vector3());
    let best = null;
    this.runtime.records.forEach(record => {
      const component = record.components.palletQueue;
      if (!component || !component.enabled || !visible(record.object)) return;
      const candidate = this.placement(record, product, [], center, false, receivingIgnore);
      if (!candidate) {
        const config = component.config, layout = behaviorSchema.conveyorLayout.palletQueueLayout(config);
        record.object.updateWorldMatrix(true, false);
        const up = new THREE.Vector3(0, 1, 0).transformDirection(record.object.matrixWorld), inverse = new THREE.Matrix4().getInverse(record.object.matrixWorld);
        layout.pallets.forEach(bay => {
          const height = component.items.filter(item => (item.palletIndex || 0) === bay.index).reduce((max, item) => Math.max(max, item.box.clone().applyMatrix4(inverse).max.y), layout.palletTop);
          const region = new THREE.Box3(new THREE.Vector3(bay.position[0] - config.width / 2, layout.palletTop, bay.position[2] - config.depth / 2),
            new THREE.Vector3(bay.position[0] + config.width / 2, Math.max(layout.palletTop + .2, height + .5), bay.position[2] + config.depth / 2)).applyMatrix4(record.object.matrixWorld);
          const distance = center.distanceTo(region.clampPoint(center, new THREE.Vector3()));
          if (distance <= tolerance && (!best || distance < best.distance)) best = {record, target: record.object, distance, palletIndex: bay.index, accepted: false, kind: 'top', normal: up};
        });
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
      if (!component || !visible(record.object) || !this.operational(component)) return;
      if (component.config.autoRelease) {
        const complete = component.pallets.map((pallet, index) => this.bayFull(component, index));
        const pressure = component.config.autoReleasePressure && this.runtime.sourceRuntime.liveLoads() >= 425;
        const ready = complete.some(Boolean) && (component.config.releasePolicy === 'palletFull' || complete.every(Boolean) || pressure);
        component.releaseElapsed = ready ? component.releaseElapsed + delta : 0;
        if (ready && component.releaseElapsed + 1e-8 >= component.config.releaseInterval) { this.releasePallet(record, complete.indexOf(true)); component.releaseElapsed = 0; }
      }
      if (component.config.delivery !== 'automatic') return;
      component.outputElapsed = Math.min(component.outputInterval, component.outputElapsed + delta);
      if (component.outputElapsed >= component.outputInterval && component.queue.length && this.dispatch(record)) component.outputElapsed = 0;
    });
  }

  variables(record) {
    const component = record.components.palletQueue;
    const occupancies = component.pallets.map((pallet, index) => ({loads: pallet.items.length, units: pallet.items.reduce((sum, item) => sum + (item.product.sourceEntry ? item.product.sourceEntry.units : 1), 0), full: this.bayFull(component, index), capacity: behaviorSchema.palletQueues.bayCapacity(component.config, index), layers: pallet.items.reduce((max, item) => Math.max(max, item.fitPlacement ? item.fitPlacement.layer : Math.floor(item.palletSlot / (component.config.columns * component.config.rows)) + 1), 0)}));
    const details = {}; occupancies.forEach((pallet, index) => { details['pallet' + (index + 1) + 'Units'] = pallet.units; details['pallet' + (index + 1) + 'Full'] = pallet.full; });
    return Object.assign({enabled: component.enabled, running: component.running, paused: component.paused, outputInterval: component.outputInterval,
      received: component.received, receivedUnits: component.receivedUnits, delivered: component.inventory.delivered, deliveredUnits: component.inventory.deliveredUnits,
      queued: component.queue.length, queuedUnits: component.queue.reduce((sum, entry) => sum + entry.units, 0), capacity: component.config.capacity,
      full: component.queue.length >= component.config.capacity || occupancies.every(pallet => pallet.full), empty: !component.queue.length, blocked: component.blocked,
      dispatchedPallets: component.dispatchedPallets, autoRelease: component.config.autoRelease, releasePolicy: component.config.releasePolicy,
      occupancy: component.queue.length / component.config.capacity * 100, columns: component.config.columns, rows: component.config.rows, layers: component.config.layers,
      palletCapacity: component.pallets.length, palletCount: occupancies.filter(pallet => pallet.loads).length, completePallets: occupancies.filter(pallet => pallet.full).length,
      palletOccupancies: JSON.stringify(occupancies)}, details);
  }

  bayFull(component, index) {
    const pallet = component.pallets[index], quota = behaviorSchema.palletQueues.bayCapacity(component.config, index);
    return !!quota && (pallet.full || pallet.items.length >= quota);
  }

  releasePallet(record, index) {
    const component = record.components.palletQueue, pallet = component.pallets[index];
    if (!this.operational(component) || !pallet || !this.bayFull(component, index) || pallet.items.some(item => item.product.heldBy)) return false;
    const entries = component.queue.filter(entry => entry.product && entry.product.item.palletIndex === index), units = entries.reduce((sum, entry) => sum + entry.units, 0);
    entries.forEach(entry => {
      const product = entry.product;
      this.runtime.sourceRuntime.remove(record, entry, 'despacho de estiba', component.inventory);
      this.removeItem(component, product);
      // Same bounded retirement path as process consumption: generated bodies
      // are disposed; authored assets are archived for exact stop/checkpoint.
      this.runtime.processorRuntime.consume(entry);
    });
    pallet.full = false; component.dispatchedPallets++; component.blocked = false;
    this.runtime.event(record.id, 'pallet-dispatched', 'Estiba ' + (index + 1) + ': ' + entries.length + ' cargas / ' + units + ' unidades despachadas.');
    return true;
  }

  command(record, action) {
    const runtime = this.runtime, component = record.components.palletQueue;
    let result;
    if (action === 'dispatch') result = this.dispatch(record);
    else if (action === 'dispatchPallet') result = this.releasePallet(record, component.pallets.findIndex((pallet, index) => this.bayFull(component, index)));
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
      component.pallets.forEach(pallet => { pallet.items.length = 0; });
      component.items.length = 0; component.queue.length = 0;
    });
  }
}
