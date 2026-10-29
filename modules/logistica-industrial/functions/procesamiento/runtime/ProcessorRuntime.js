import * as THREE from 'three';
import behaviorSchema from '../../../contracts/behaviors.js';

const MAX_MEMBERS = 128;
const MAX_LOADS = 500;

function visible(object) { for (let node = object; node; node = node.parent) if (!node.visible) return false; return true; }
function total(entries) { return entries.reduce((sum, entry) => sum + entry.units, 0); }

/** Timed, bounded processing stations sharing the same load identities as sources. */
export default class ProcessorRuntime {
  constructor(runtime) {
    this.runtime = runtime;
    this.archive = new Map();
    this.visibility = new Map();
    this.sequence = 0;
  }

  attach(record, component) {
    const config = component.config, layout = this.layout(config);
    Object.assign(component, {enabled: true, powered: config.powered, running: config.running && config.powered && !config.emergency,
      paused: config.paused, emergency: config.emergency, processTime: config.processTime, setupTime: config.setupTime,
      operatorAvailable: config.operatorAvailable, outputInterval: config.outputInterval, jobs: [], slots: Array.from({length: config.parallelism}, () => ({started: false, signature: ''})),
      elapsed: 0, completed: 0, completedUnits: 0, entryCount: 0, receivedUnits: 0,
      setupSeconds: 0, processSeconds: 0, idleSeconds: 0, blockedSeconds: 0, operatorWaitSeconds: 0, downSeconds: 0,
      blocked: false, outputElapsed: config.outputInterval});
    const inventory = (name, position) => {
      const helper = new THREE.Group(); helper.name = name; helper.userData.editorRuntimeHelper = true; record.object.add(helper);
      return {queue: [], helper, position, config, enabled: true, running: true, paused: false, delivered: 0, deliveredUnits: 0, blocked: false, transferBlocked: false};
    };
    component.input = inventory('Entrada del proceso', layout.inputPosition);
    component.output = inventory('Salida del proceso', layout.outputPosition);
    component.work = new THREE.Group(); component.work.name = 'Cargas en proceso'; component.work.userData.editorRuntimeHelper = true; record.object.add(component.work);
    const field = (key, type, label, min, max) => Object.assign({key, type, label}, min === undefined ? {} : {min, max});
    record.writable.push(field('enabled', 'boolean', 'Habilitado'), field('powered', 'boolean', 'Alimentación'), field('running', 'boolean', 'En marcha'),
      field('paused', 'boolean', 'En pausa'), field('emergency', 'boolean', 'Parada de emergencia'), field('operatorAvailable', 'boolean', 'Operario disponible'),
      field('processTime', 'number', 'Tiempo de proceso (s)', .1, 3600), field('setupTime', 'number', 'Tiempo de preparación (s)', 0, 3600),
      field('outputInterval', 'number', 'Intervalo de salida (s)', .1, 120));
  }

  layout(config) { return behaviorSchema.conveyorLayout.processorLayout(config); }
  operational(component) { return component.enabled && component.powered && component.running && !component.paused && !component.emergency; }

  reservedLoads() {
    let reserved = 0;
    this.runtime.records.forEach(record => {
      const processor = record.components.processor;
      if (processor) processor.jobs.forEach(job => { reserved += job.results ? 0 : job.reservation; });
    });
    return reserved;
  }

  fits(record, entry) {
    const layout = this.layout(record.components.processor.config), machineScale = record.object.getWorldScale(new THREE.Vector3());
    const bounds = entry.product ? entry.product.bounds : this.runtime.sourceRuntime.loadBounds(entry);
    const scale = entry.product ? entry.product.scale : entry.scale ? new THREE.Vector3().fromArray(entry.scale) : machineScale;
    const size = bounds.getSize(new THREE.Vector3()).multiply(scale);
    return Math.abs(size.z) <= layout.width * Math.abs(machineScale.z) - .08 && Math.abs(size.x) <= layout.length * Math.abs(machineScale.x) - .1;
  }

  canReceive(record, entry, manual = false, reserved = 0) {
    const processor = record && record.components.processor;
    return !!processor && processor.enabled && (manual || this.operational(processor)) && visible(record.object) &&
      processor.input.queue.length + reserved < processor.config.capacity && !processor.input.queue.includes(entry) &&
      !processor.jobs.some(job => job.inputs.includes(entry)) && this.fits(record, entry);
  }

  remember(product) {
    if (product && product.record && !this.visibility.has(product.object)) this.visibility.set(product.object, product.object.visible);
  }

  setEntryPose(record, inventory, entry, show, accepting = false) {
    const product = entry.product;
    if (!product || product.heldBy && !accepting) return null;
    this.remember(product);
    product.processorLocked = inventory !== record.components.processor.output;
    product.processorOwnerId = record.id;
    Object.assign(product.object.userData, {sourceProductId: entry.id, sourceOriginId: entry.originId, sourceSku: entry.spec.id,
      sourceUnits: entry.units, sourceLineage: entry.lineage.slice()});
    if (!show) {
      if (product.object.parent !== inventory.helper) inventory.helper.add(product.object);
      product.object.visible = false; product.item.beltId = null; return null;
    }
    return this.runtime.sourceRuntime.present(record, inventory, entry, {accepting});
  }

  showFront(record, inventory) {
    const source = this.runtime.sourceRuntime;
    inventory.queue.slice(1).forEach(entry => { if (entry.product) this.setEntryPose(record, inventory, entry, false); });
    if (inventory.queue[0] && inventory.queue[0].product) return this.setEntryPose(record, inventory, inventory.queue[0], true);
    const product = source.materialize(record, inventory);
    if (product) {
      const entry = inventory.queue[0]; return this.setEntryPose(record, inventory, entry, true);
    }
    return product;
  }

  receive(record, entry, manual = false) {
    if (!this.canReceive(record, entry, manual)) return false;
    const processor = record.components.processor, inventory = processor.input;
    entry.ownerId = record.id; entry.lineage.push(record.id); if (entry.lineage.length > 64) entry.lineage.shift();
    inventory.queue.push(entry); processor.entryCount++; processor.receivedUnits += entry.units;
    this.runtime.sourceRuntime.entries.add(entry);
    if (entry.product) {
      entry.product.sourceId = ''; entry.product.processorLocked = true; entry.product.processorOwnerId = record.id;
      if (inventory.queue.length > 1 && !entry.product.record) this.runtime.sourceRuntime.dematerialize(entry);
      else this.setEntryPose(record, inventory, entry, inventory.queue.length === 1, manual);
    }
    this.showFront(record, inventory);
    this.runtime.event(record.id, 'processor-entry', 'Entrada al proceso: ' + entry.spec.name + ' (' + entry.units + ' ud.).');
    return true;
  }

  beltTransferDetails(record, belt, item, target, portName, reservations = []) {
    const runtime = this.runtime, blocked = {blocked: true};
    if (portName !== 'input' || !item.product) return blocked;
    const entry = item.product.sourceEntry || {product: item.product};
    const reserved = reservations.filter(transfer => transfer.sourceBuffer && transfer.target === target).length;
    if (!this.canReceive(target, entry, false, reserved)) return blocked;
    const point = runtime.pathPoint(belt.config, runtime.pathLength(belt.config, item.route), item.route);
    const to = runtime.sourceRuntime.port(target, false), from = runtime.pathSurface(record, belt, point);
    if (!to || from.distanceTo(to.position) > .18 || runtime.pathVector(record, point.tx, point.tz).normalize().dot(to.direction) < .85 || runtime.pathUp(record).dot(to.up) < .95) return blocked;
    return {record, belt, item, target, receiver: target.components.processor, sourceBuffer: true, blocked: false};
  }

  canPickup(product) {
    const entry = product && product.sourceEntry, record = entry && this.runtime.records.get(entry.ownerId), processor = record && record.components.processor;
    return !processor || processor.output.queue[0] === entry;
  }

  picked(product) {
    const entry = product && product.sourceEntry, record = entry && this.runtime.records.get(entry.ownerId), processor = record && record.components.processor;
    if (!processor || processor.output.queue[0] !== entry) return;
    this.runtime.sourceRuntime.remove(record, entry, 'manual', processor.output);
    product.processorOwnerId = ''; product.processorLocked = false;
    this.showFront(record, processor.output);
    processor.blocked = processor.blocked || processor.output.blocked;
  }

  findInput(product, tolerance = .6) {
    product.object.updateWorldMatrix(true, true);
    const center = product.bounds.getCenter(new THREE.Vector3()).applyMatrix4(product.object.matrixWorld);
    let best = null;
    this.runtime.records.forEach(record => {
      const processor = record.components.processor;
      if (!processor || !visible(record.object) || !this.fits(record, product.sourceEntry || {product})) return;
      const matrix = this.runtime.sourceRuntime.frontMatrix(record, product.bounds, product.scale, processor.input.position);
      const bounds = product.bounds.clone().applyMatrix4(matrix), distance = center.distanceTo(bounds.getCenter(new THREE.Vector3()));
      if (distance > tolerance || best && distance >= best.distance) return;
      const entry = product.sourceEntry || {product};
      const accepted = this.canReceive(record, entry, true) && this.runtime.sourceRuntime.canPlace(record, product.bounds, matrix, product);
      best = {record, matrix, bounds, target: record.object, distance, kind: 'top', snapped: distance <= .22, accepted,
        normal: new THREE.Vector3(0, 1, 0).transformDirection(record.object.matrixWorld), point: bounds.getCenter(new THREE.Vector3()).setY(bounds.min.y)};
    });
    return best;
  }

  receiveManual(product, candidate) {
    if (!candidate || !candidate.accepted) return false;
    const entry = this.runtime.sourceRuntime.entryForProduct(candidate.record, product);
    return this.receive(candidate.record, entry, true);
  }

  signature(inputs) { return inputs.map(entry => [entry.spec.id, entry.spec.type, entry.spec.width, entry.spec.height, entry.spec.depth, entry.load.loadMode].join('/')).sort().join('|'); }

  leaves(entries, result = []) {
    entries.forEach(entry => {
      if (entry.members && entry.members.length) this.leaves(entry.members, result);
      else result.push(entry);
    });
    return result;
  }

  expectedOutputs(processor, inputs) { return processor.config.mode === 'separator' ? Math.min(processor.config.splitCount, inputs[0].units) : 1; }

  startJobs(record) {
    const processor = record.components.processor, config = processor.config;
    if (!this.operational(processor) || config.requiresOperator && !processor.operatorAvailable) return;
    for (let slotIndex = 0; slotIndex < processor.slots.length; slotIndex++) {
      if (processor.jobs.some(job => job.slotIndex === slotIndex)) continue;
      const count = config.mode === 'combiner' ? config.combineCount : 1;
      if (processor.output.queue.length >= config.outputCapacity) {
        if (processor.input.queue.length >= count) processor.blocked = true;
        continue;
      }
      if (processor.input.queue.length < count) break;
      const inputs = processor.input.queue.slice(0, count), outputCount = this.expectedOutputs(processor, inputs), reservation = Math.max(0, outputCount - inputs.length);
      if (this.runtime.sourceRuntime.liveLoads() + reservation > MAX_LOADS || this.leaves(inputs).length > MAX_MEMBERS) { processor.blocked = true; break; }
      processor.input.queue.splice(0, count);
      const slot = processor.slots[slotIndex], signature = this.signature(inputs);
      const needsSetup = config.setupPolicy === 'eachBatch' || (config.setupPolicy === 'startup' ? !slot.started : slot.signature !== signature);
      const setup = processor.setupTime > 0 && needsSetup;
      slot.started = true; slot.signature = signature;
      const job = {slotIndex, inputs, reservation, phase: setup ? 'setup' : 'process', elapsed: 0, results: null,
        setupTime: processor.setupTime, processTime: processor.processTime};
      processor.jobs.push(job);
      inputs.forEach(entry => {
        if (entry.product) { this.remember(entry.product); processor.work.add(entry.product.object); entry.product.object.visible = false; entry.product.processorLocked = true; }
      });
      this.runtime.event(record.id, 'processor-job-start', (setup ? 'Preparación' : 'Proceso') + ' · puesto ' + (slotIndex + 1) + '.');
    }
    this.showFront(record, processor.input);
  }

  unregister(product) {
    const runtime = this.runtime, entry = product.stateEntry;
    runtime.productFeedback.remove(product.object); runtime.restoreProductCollision(product);
    if (entry && runtime.ctx.raycontrol && runtime.ctx.raycontrol.states[entry.name] === entry.state) {
      runtime.ctx.raycontrol.deactivateState(entry.name); delete runtime.ctx.raycontrol.states[entry.name];
    }
    runtime.states = runtime.states.filter(value => value !== entry); runtime.products.delete(product.object);
  }

  consume(entry) {
    const product = entry.product;
    if (product && product.record) {
      this.remember(product); this.archive.set(entry.id, product); this.unregister(product); product.object.visible = false;
      entry.archivedProduct = product; entry.product = null;
    } else if (product) this.runtime.sourceRuntime.dematerialize(entry);
    entry.ownerId = ''; this.runtime.sourceRuntime.entries.delete(entry);
  }

  newEntry(record, inputs, members, units, spec, load) {
    const entry = {id: record.id + ':' + this.runtime.runSequence + ':p' + (++this.sequence), originId: inputs[0].originId,
      ownerId: record.id, spec: Object.assign({}, spec), load: Object.assign({}, load), units,
      lineage: inputs[0].lineage.concat(record.id).slice(-64), scale: inputs[0].scale && inputs[0].scale.slice(), product: null};
    if (members && members.length) entry.members = members;
    this.runtime.sourceRuntime.entries.add(entry); return entry;
  }

  combine(record, inputs) {
    const members = this.leaves(inputs), units = total(inputs);
    inputs.forEach(entry => this.consume(entry));
    const spec = {id: 'lot', name: 'Lote de ' + units + ' unidades', type: 'crate', width: .58, height: .34, depth: .42, color: '#668ba0'};
    return [this.newEntry(record, inputs, members, units, spec, {loadMode: 'individual', palletColumns: 1, palletRows: 1, palletLayers: 1})];
  }

  split(record, input, count) {
    if (count === 1) return [input];
    const leaves = this.leaves([input]), groups = Array.from({length: count}, () => []);
    let groupIndex = 0, remainingGroup = Math.ceil(input.units / count);
    leaves.forEach(leaf => {
      let units = leaf.units;
      while (units > 0) {
        const take = Math.min(units, remainingGroup);
        // Each fraction keeps the original source leaf, its own route and
        // quantity. Append only the lot's shared processing after that route;
        // another input's Source or private upstream inspection is not ours.
        const lineage = (leaf.lineage || []).slice(), lotRoute = input.lineage || [];
        let shared = -1;
        for (let index = lineage.length - 1; index >= 0; index--) {
          shared = lotRoute.lastIndexOf(lineage[index]); if (shared >= 0) break;
        }
        const route = lineage.concat(lotRoute.slice(shared + 1).filter(id => {
          const owner = this.runtime.records.get(id); return owner && owner.components.processor;
        }), record.id).filter((id, index, values) => !index || id !== values[index - 1]).slice(-64);
        const member = Object.assign({}, leaf, {units: take, product: null, lineage: route});
        if (leaf.load && leaf.load.loadMode === 'pallet') {
          const tare = Number.isFinite(leaf.load.palletTare) ? leaf.load.palletTare : behaviorSchema.productSources.pallets.dimensions(leaf.load, true).tare;
          member.load = Object.assign({}, leaf.load, {palletTare: tare * take / leaf.units});
        }
        if (take !== leaf.units) delete member.archivedProduct;
        groups[groupIndex].push(member); units -= take; remainingGroup -= take;
        if (!remainingGroup && groupIndex < count - 1) { groupIndex++; remainingGroup = Math.ceil((input.units - groups.slice(0, groupIndex).reduce((sum, rows) => sum + total(rows), 0)) / (count - groupIndex)); }
      }
    });
    this.consume(input);
    return groups.filter(group => group.length).map(group => {
      const units = total(group), one = group.length === 1 && units === 1, member = group[0];
      const spec = one ? member.spec : {id: 'group', name: 'Grupo de ' + units + ' unidades', type: 'crate', width: .5, height: .3, depth: .38, color: '#8e7654'};
      const entry = this.newEntry(record, [input], group, units, spec, {loadMode: 'individual', palletColumns: 1, palletRows: 1, palletLayers: 1});
      if (one) Object.assign(entry, {originId: member.originId, lineage: member.lineage.slice(), scale: member.scale && member.scale.slice()});
      if (one && member.archivedProduct) {
        const original = member.archivedProduct; original.object.visible = true;
        const product = this.runtime.registerProduct(original.object, original.record, original.item);
        // New split load IDs differ from the retained source-leaf ID. Remove
        // the actual recovered product, whichever output ID archived it.
        this.archive.forEach((archived, key) => { if (archived === original) this.archive.delete(key); });
        entry.product = product; product.sourceEntry = entry; product.item.sourceEntry = entry; product.processorOwnerId = record.id;
        member.archivedProduct = product;
        product.item.product = product; product.item.bounds = product.bounds; product.item.scale = product.scale;
        product.object.visible = false;
      }
      return entry;
    });
  }

  finish(record, job) {
    const processor = record.components.processor;
    if (processor.config.mode === 'combiner') job.results = this.combine(record, job.inputs);
    else if (processor.config.mode === 'separator') job.results = this.split(record, job.inputs[0], this.expectedOutputs(processor, job.inputs));
    else job.results = job.inputs;
    processor.completed++; processor.completedUnits += total(job.inputs); job.phase = 'complete'; job.elapsed = job.processTime;
    job.results.forEach(entry => { entry.ownerId = record.id; if (entry.product) entry.product.processorLocked = false; });
    this.runtime.event(record.id, 'processor-complete', 'Proceso terminado: ' + total(job.results) + ' unidades.');
  }

  flush(record) {
    const processor = record.components.processor;
    processor.jobs.forEach(job => {
      if (!job.results) return;
      while (job.results.length && processor.output.queue.length < processor.config.outputCapacity) {
        const entry = job.results.shift(); processor.output.queue.push(entry);
        if (entry.product) this.setEntryPose(record, processor.output, entry, processor.output.queue.length === 1);
      }
      if (job.results.length) processor.blocked = true;
    });
    processor.jobs = processor.jobs.filter(job => !job.results || job.results.length);
    this.showFront(record, processor.output);
    processor.blocked = processor.blocked || processor.output.blocked;
  }

  syncOutput(processor) {
    processor.output.enabled = processor.enabled; processor.output.running = processor.powered && processor.running && !processor.emergency;
    processor.output.paused = processor.paused;
  }

  dispatch(record) {
    const processor = record.components.processor;
    this.syncOutput(processor);
    const result = this.runtime.sourceRuntime.dispatch(record, processor.output);
    processor.blocked = processor.blocked || processor.output.blocked; return result;
  }

  step(delta) {
    this.runtime.records.forEach(record => {
      const processor = record.components.processor;
      if (!processor || !visible(record.object)) return;
      const config = processor.config;
      const previousOutputBlocked = processor.output.blocked;
      processor.elapsed += delta; processor.blocked = false; processor.output.blocked = false;
      this.flush(record);
      if (!this.operational(processor)) { processor.downSeconds += delta * config.parallelism; return; }
      if (config.requiresOperator && !processor.operatorAvailable) {
        let waiting = Math.floor(processor.input.queue.length / (config.mode === 'combiner' ? config.combineCount : 1));
        processor.slots.forEach((slot, index) => {
          const job = processor.jobs.find(value => value.slotIndex === index);
          if (job && job.results) processor.blockedSeconds += delta;
          else if (job || waiting > 0) { processor.operatorWaitSeconds += delta; if (!job) waiting--; }
          else processor.idleSeconds += delta;
        });
      } else {
        this.startJobs(record);
        processor.slots.forEach((slot, slotIndex) => {
          const job = processor.jobs.find(value => value.slotIndex === slotIndex);
          if (!job) {
            const waiting = processor.input.queue.length >= (config.mode === 'combiner' ? config.combineCount : 1);
            if (waiting && (processor.blocked || processor.output.queue.length >= config.outputCapacity) || previousOutputBlocked && processor.output.queue.length) processor.blockedSeconds += delta;
            else processor.idleSeconds += delta;
            return;
          }
          if (job.results) { processor.blockedSeconds += delta; return; }
          let remaining = delta;
          if (job.phase === 'setup') {
            const step = Math.min(remaining, Math.max(0, job.setupTime - job.elapsed));
            job.elapsed += step; processor.setupSeconds += step; remaining -= step;
            if (job.elapsed >= job.setupTime - 1e-10) { job.phase = 'process'; job.elapsed = 0; }
          }
          if (job.phase === 'process' && remaining > 0) {
            const step = Math.min(remaining, Math.max(0, job.processTime - job.elapsed));
            job.elapsed += step; processor.processSeconds += step; remaining -= step;
            if (job.elapsed >= job.processTime - 1e-10) this.finish(record, job);
          }
          if (remaining > 0) {
            if (job.results && processor.output.queue.length >= config.outputCapacity) processor.blockedSeconds += remaining;
            else processor.idleSeconds += remaining;
          }
        });
        this.flush(record);
      }
      if (config.delivery === 'automatic') {
        processor.outputElapsed = Math.min(processor.outputInterval, processor.outputElapsed + delta);
        if (processor.outputElapsed >= processor.outputInterval && processor.output.queue.length && this.dispatch(record)) processor.outputElapsed = 0;
      }
    });
  }

  variables(record) {
    const processor = record.components.processor, config = processor.config;
    const operational = this.operational(processor), waitingOperator = operational && config.requiresOperator && !processor.operatorAvailable && !!(processor.jobs.length || processor.input.queue.length);
    const settingUp = processor.jobs.some(job => job.phase === 'setup'), processing = processor.jobs.some(job => job.phase === 'process');
    const setupJobs = processor.jobs.filter(job => job.phase === 'setup');
    const state = !processor.enabled || !processor.powered ? 'OFF' : processor.emergency ? 'EMERGENCY' : !processor.running ? 'STOPPED' : processor.paused ? 'PAUSED' : waitingOperator ? 'WAITING_OPERATOR' : processor.blocked ? 'BLOCKED' : settingUp ? 'SETUP' : processing ? 'PROCESSING' : 'IDLE';
    return {enabled: processor.enabled, powered: processor.powered, running: processor.running, paused: processor.paused, emergency: processor.emergency,
      operatorAvailable: processor.operatorAvailable, processTime: processor.processTime, setupTime: processor.setupTime, outputInterval: processor.outputInterval, state,
      busy: !!processor.jobs.length, settingUp, waitingOperator, blocked: processor.blocked,
      full: processor.input.queue.length >= config.capacity, empty: !processor.input.queue.length && !processor.jobs.length && !processor.output.queue.length,
      queued: processor.input.queue.length, queuedUnits: total(processor.input.queue), outputQueued: processor.output.queue.length,
      capacity: config.capacity, parallelism: config.parallelism, outputCapacity: config.outputCapacity, activeJobs: processor.jobs.length,
      progress: processor.jobs.length ? Math.max(...processor.jobs.map(job => job.phase === 'complete' ? 100 : job.phase === 'setup' ? 0 : Math.min(100, job.elapsed / job.processTime * 100))) : 0,
      setupProgress: setupJobs.length ? Math.max(...setupJobs.map(job => job.setupTime ? job.elapsed / job.setupTime * 100 : 100)) : 0,
      setupRemaining: setupJobs.length ? Math.max(...setupJobs.map(job => Math.max(0, job.setupTime - job.elapsed))) : 0,
      entryCount: processor.entryCount, exitCount: processor.output.delivered, receivedUnits: processor.receivedUnits, deliveredUnits: processor.output.deliveredUnits,
      completed: processor.completed, completedUnits: processor.completedUnits,
      utilization: processor.elapsed ? processor.processSeconds / (processor.elapsed * config.parallelism) * 100 : 0,
      setupSeconds: processor.setupSeconds, processSeconds: processor.processSeconds, idleSeconds: processor.idleSeconds,
      blockedSeconds: processor.blockedSeconds, operatorWaitSeconds: processor.operatorWaitSeconds, downSeconds: processor.downSeconds,
      nominalCapacity: config.parallelism * 60 / processor.processTime};
  }

  command(record, action) {
    const runtime = this.runtime, processor = record.components.processor;
    if (action === 'dispatch') return this.dispatch(record);
    if (action === 'operator') return runtime.setVariable(record.id, 'operatorAvailable', !processor.operatorAvailable);
    if (action === 'powerOn') return runtime.setVariable(record.id, 'powered', true);
    if (action === 'powerOff') return runtime.setVariable(record.id, 'powered', false);
    if (action === 'stop') return runtime.setVariable(record.id, 'running', false);
    if (action === 'start') { runtime.setVariable(record.id, 'running', true); return runtime.setVariable(record.id, 'paused', false); }
    if (action === 'pause') return runtime.setVariable(record.id, 'paused', !processor.paused);
    if (action === 'emergency') return runtime.setVariable(record.id, 'emergency', true);
    if (action === 'resetEmergency') return runtime.setVariable(record.id, 'emergency', false);
    throw new Error('Mando de proceso no compatible.');
  }

  stop() {
    this.visibility.forEach((wasVisible, object) => { object.visible = wasVisible; });
    this.runtime.records.forEach(record => {
      const processor = record.components.processor;
      if (!processor) return;
      [processor.input.helper, processor.output.helper, processor.work].forEach(helper => { if (helper.parent) helper.parent.remove(helper); });
      processor.input.queue = []; processor.output.queue = []; processor.jobs = [];
    });
    this.archive.clear(); this.visibility.clear();
  }
}
