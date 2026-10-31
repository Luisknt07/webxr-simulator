import * as THREE from 'three';
import trainingSchema from '../schema/vehicle-training.js';

const position = object => object.getWorldPosition(new THREE.Vector3());
const horizontal = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const RADIUS = .85;
const STAGES = [
  {id: 'approach', title: 'Acércate al pallet', instruction: 'Acércate al pallet asignado; las flechas orientan el recorrido de recogida.'},
  {id: 'pickup', title: 'Recoge el pallet', instruction: 'Detente, introduce ambas horquillas y pulsa Recoger.'},
  {id: 'transport', title: 'Transporta la carga', instruction: 'Conduce por la ruta señalada con la carga baja.'},
  {id: 'align', title: 'Alinea con el destino', instruction: 'Alinea el pallet con la ubicación exacta y bájalo hasta el apoyo.'},
  {id: 'drop', title: 'Deposita la carga', instruction: 'El apoyo está preparado. Detente y pulsa Depositar.'},
  {id: 'withdraw', title: 'Retira las horquillas', instruction: 'Retrocede despacio hasta retirar ambas horquillas del pallet.'}
];

/** Verified manual warehouse lessons. State lives in the vehicle component so
 * execution checkpoints preserve progress together with physical custody. */
export default class VehicleTrainingRuntime {
  constructor(runtime) { this.runtime = runtime; this.programs = new WeakMap(); this.stageReadiness = new WeakMap(); }
  state(record) { return record && record.components.vehicle && record.components.vehicle.training; }
  tasks(record) {
    const config = record.components.vehicle.config;
    let program = this.programs.get(config);
    if (!program || program.json !== config.trainingTasksJson) { program = {json: config.trainingTasksJson, tasks: trainingSchema.parse(config)}; this.programs.set(config, program); }
    return program.tasks;
  }
  variables(record) {
    const s = this.state(record); if (!s) return {};
    const tasks = this.tasks(record), task = tasks[s.index], scoring = s.scoring;
    return {warehouseTaskId: task && task.id || '', warehousePhase: s.phase, warehouseStage: this.stage(record, false), warehouseCompleted: s.completed.length, warehouseTotal: tasks.length, warehouseRouteIndex: s.waypointIndex, warehouseRouteComplete: this.routeComplete(record), warehouseStatus: s.error || s.status || '', warehouseScore: scoring ? scoring.score : 0, warehouseScoreMax: trainingSchema.score.maximum(tasks), warehouseErrorCount: scoring ? scoring.errorCount : 0, warehouseLastPoints: scoring && scoring.feedback ? scoring.feedback.points : 0, warehouseFeedback: scoring && scoring.feedback ? scoring.feedback.text || scoring.feedback.message || '' : ''};
  }
  stage(record, probe = true) {
    const s = this.state(record);
    if (!s) return '';
    const complete = this.routeComplete(record);
    if (s.phase === 'pickup' && complete || !['pickup', 'drop'].includes(s.phase) || s.phase === 'drop' && !complete) {
      this.stageReadiness.delete(record);
      return s.phase === 'pickup' ? 'pickup' : s.phase === 'drop' ? 'transport' : s.phase;
    }
    const api = this.runtime.vehicleRuntime, pickup = s.phase === 'pickup', method = pickup ? 'pickupPlan' : 'releasePlan', pending = pickup ? 'approach' : 'align';
    if (!api || typeof api[method] !== 'function') { this.stageReadiness.delete(record); return pending; }
    const tasks = this.tasks(record), entry = record.components.vehicle.entry, cached = this.stageReadiness.get(record);
    const valid = cached && cached.training === s && cached.tasks === tasks && cached.index === s.index && cached.entry === entry && cached.phase === s.phase && cached.routeFault === s.routeFault;
    // Variable snapshots refresh every simulation frame. They only expose the
    // last read-only UI probe; pickup/drop commands still check the live plan.
    if (!probe) return valid ? cached.stage : pending;
    const clock = Number.isFinite(this.runtime.time) ? this.runtime.time : s.scoring && Number.isFinite(s.scoring.clock) ? s.scoring.clock : Date.now() / 1000;
    if (valid && clock >= cached.time && clock - cached.time < .2) return cached.stage;
    const target = pickup ? this.product(this.task(record).productId) : this.destination(record);
    const plan = pickup && !target ? null : api[method](record, target);
    const stage = plan && plan.ready ? pickup ? 'pickup' : 'drop' : pending;
    this.stageReadiness.set(record, {training: s, tasks, index: s.index, entry, phase: s.phase, routeFault: s.routeFault, time: clock, stage});
    return stage;
  }
  scoringGuidance(record) {
    const s = this.state(record), tasks = this.tasks(record), scoring = s.scoring, stage = this.stage(record), stageIndex = STAGES.findIndex(item => item.id === stage), current = STAGES[stageIndex];
    const rewards = trainingSchema.score.rewards(scoring, tasks), badges = rewards.filter(reward => reward.code === 'clean').map(reward => ({id: 'clean:' + reward.taskId, title: 'Misión sin errores', taskId: reward.taskId}));
    if (scoring && s.phase === 'complete') badges.push({id: 'warehouse-certified', title: 'Práctica completada', taskId: ''});
    return {stage, stageIndex: stage === 'complete' ? STAGES.length : stageIndex, stageTitle: current ? current.title : stage === 'complete' ? 'Práctica completada' : 'Revisa la misión', instruction: current ? current.instruction : s.error || 'Todas las misiones están verificadas.', stages: STAGES.map((item, index) => ({id: item.id, title: item.title, status: stage === 'complete' || stageIndex > index ? 'completed' : stageIndex === index ? 'active' : 'locked'})), score: scoring ? scoring.score : 0, scoreMax: trainingSchema.score.maximum(tasks), feedback: scoring && scoring.feedback ? Object.assign({}, scoring.feedback) : null, rewards, errorCount: scoring ? scoring.errorCount : 0, missionErrors: scoring ? scoring.missionErrors[s.index] || 0 : 0, badges};
  }
  publishScore(record, feedback) {
    if (feedback) this.runtime.event(record.id, 'warehouse-score-' + feedback.kind, JSON.stringify(feedback));
  }
  reward(record, code) {
    const s = this.state(record); if (!s) return;
    this.publishScore(record, trainingSchema.score.award(s.scoring, this.task(record), code));
  }
  onAttemptFailed(record, action, plan = {}) {
    const s = this.state(record), task = this.task(record);
    if (!s || !task || !s.scoring || s.error || ['withdraw', 'complete', 'error'].includes(s.phase)) return;
    let code = action === 'pickup' ? 'unsafe-pickup' : 'unsafe-drop';
    const product = plan.candidate && plan.candidate.product;
    if (action === 'pickup' && product) {
      const owner = product.sourceEntry && product.sourceEntry.ownerId || product.item && product.item.palletOwnerId;
      if (this.runtime.palletQueueRuntime.palletIdentity(product) !== task.productId || owner !== task.sourceId || task.sourceLocationCode && product.object.userData.sourceRackLocationCode !== task.sourceLocationCode) code = 'wrong-pallet';
    }
    if (action === 'drop' && (plan.targetId && plan.targetId !== task.destinationId || plan.placement && (task.locationCode && plan.placement.locationCode !== task.locationCode || task.destinationSlot !== undefined && plan.placement.palletIndex !== task.destinationSlot) || plan.trainingRejected && plan.kind !== 'stock')) code = 'wrong-destination';
    const retry = action === 'pickup' ? 'Comprueba el pallet asignado, completa la aproximación, detente y alinea ambas horquillas.' : 'Sigue la ruta y alinea la carga con la ubicación exacta antes de depositar.';
    this.publishScore(record, trainingSchema.score.penalize(s.scoring, task, s.index, code, plan.reason || 'La maniobra todavía no es segura.', retry));
  }
  onCollision(record) {
    const s = this.state(record), task = this.task(record);
    if (!s || !task || s.error || ['complete', 'error'].includes(s.phase)) return;
    this.publishScore(record, trainingSchema.score.penalize(s.scoring, task, s.index, 'collision', 'Contacto con un obstáculo; la maniobra se ha detenido.', 'Frena, comprueba el espacio de la carga y retrocede para despejar el obstáculo.'));
  }
  task(record) { const s = this.state(record); return s && this.tasks(record)[s.index]; }
  product(id) { return Array.from(this.runtime.products.values()).find(product => this.runtime.palletQueueRuntime.palletIdentity(product) === id); }
  world(point) {
    const root = this.runtime.document.getRoot(this.runtime.roomId);
    const p = new THREE.Vector3(point.x, 0, point.z);
    if (root) { root.updateWorldMatrix(true, false); p.applyMatrix4(root.matrixWorld); }
    return {x: p.x, y: p.y, z: p.z};
  }
  route(record) { const task = this.task(record), s = this.state(record); return task && s ? (s.phase === 'pickup' ? task.pickupRoute : s.phase === 'drop' ? task.route : []).map(point => this.world(point)) : []; }
  beginRoute(record, phase) {
    const s = this.state(record), v = record.components.vehicle, p = position(record.object);
    Object.assign(s, {phase, waypointIndex: 0, lastPosition: p.toArray(), lastDistance: v.distance, legStart: p.toArray(), legDistance: 0, routeFault: false});
  }
  prepare() {
    const seeded = new Set();
    this.runtime.records.forEach(record => {
      if (!record.components.vehicle) return;
      const tasks = this.tasks(record); if (!tasks.length) return;
      record.components.vehicle.training = {index: 0, completed: [], phase: 'pickup', waypointIndex: 0, status: '', error: '', routeFault: false, legDistance: 0};
      const scoring = trainingSchema.score.create(tasks);
      if (scoring) record.components.vehicle.training.scoring = scoring;
      this.beginRoute(record, 'pickup');
      try {
        // Resolve every authored binding before taking initial custody. A
        // missing receiver must be reported before the learner lifts a load.
        for (const task of tasks) {
          const product = this.product(task.productId), source = this.runtime.records.get(task.sourceId), destination = this.runtime.records.get(task.destinationId), store = destination && destination.components.palletQueue;
          if (!product || !source || !source.components.palletQueue || !store) throw new Error('Falta una carga, origen o destino de la misión: ' + task.name + '.');
          const size = product.bounds.getSize(new THREE.Vector3()).multiply(product.scale), mass = Number(this.runtime.productMetadata(product).mass);
          if (store.rack) {
            const cell = store.rack.layout.cells.find(cell => task.locationCode ? cell.code === task.locationCode : cell.index === task.destinationSlot);
            if (!cell || task.destinationSlot !== undefined && cell.index !== task.destinationSlot || Math.abs(size.x) > cell.width + .001 || Math.abs(size.z) > cell.depth + .001 || Math.abs(size.y) > cell.clearHeight + .001 || mass > cell.capacityKg + .001) throw new Error('La ubicación de destino no existe o no admite este pallet: ' + task.name + '.');
          } else if (task.locationCode || !Number.isInteger(task.destinationSlot) || !store.pallets[task.destinationSlot] || !store.config.acceptsPallets || Math.abs(size.x) > store.config.width + .02 || Math.abs(size.z) > store.config.depth + .02) throw new Error('La bahía de destino no existe o no admite este pallet: ' + task.name + '.');
          const origin = source.components.palletQueue;
          if (task.sourceLocationCode && (!origin.rack || !origin.rack.layout.cells.some(cell => cell.code === task.sourceLocationCode))) throw new Error('La ubicación de origen no existe: ' + task.name + '.');
        }
        for (const task of tasks) {
          if (seeded.has(task.productId)) continue;
          const product = this.product(task.productId), source = this.runtime.records.get(task.sourceId), store = source && source.components.palletQueue;
          if (!product || !store) throw new Error('Falta el pallet o el almacén de origen de ' + task.name + '.');
          const api = this.runtime.palletQueueRuntime;
          if (store.rack && task.sourceLocationCode) api.assignLocation(source, {locationCode: task.sourceLocationCode, palletId: task.productId});
          product.object.updateWorldMatrix(true, true);
          const center = product.bounds.clone().applyMatrix4(product.object.matrixWorld).getCenter(new THREE.Vector3());
          const placement = api.placement(source, product, [], center);
          const currentRotation = product.object.getWorldQuaternion(new THREE.Quaternion()), desiredRotation = new THREE.Quaternion();
          if (placement) placement.matrix.decompose(new THREE.Vector3(), desiredRotation, new THREE.Vector3());
          if (!placement || position(product.object).distanceTo(new THREE.Vector3().setFromMatrixPosition(placement.matrix)) > .04 || currentRotation.angleTo(desiredRotation) > .04 || task.sourceLocationCode && placement.locationCode !== task.sourceLocationCode) throw new Error('El pallet inicial no está apoyado en su ubicación: ' + task.productId + '.');
          const entry = this.runtime.sourceRuntime.entryForProduct(source, product);
          if (!api.receive(source, entry, true, placement)) throw new Error('No se pudo registrar el pallet inicial: ' + task.productId + '.');
          seeded.add(task.productId);
        }
        this.beginRoute(record, 'pickup');
      } catch (error) {
        const s = this.state(record); s.error = error.message; s.status = error.message; s.phase = 'error';
        this.runtime.event(record.id, 'warehouse-training-error', error.message);
      }
    });
  }
  routeComplete(record) { const s = this.state(record); return !!s && !s.routeFault && s.waypointIndex >= this.route(record).length; }
  continuousApproach(record) {
    const s = this.state(record), v = record.components.vehicle;
    if (!s || s.routeFault || !Array.isArray(s.lastPosition) || s.lastPosition.length !== 3 || !s.lastPosition.every(Number.isFinite) || !Number.isFinite(s.lastDistance) || !Number.isFinite(v.distance)) return false;
    const moved = horizontal(position(record.object), new THREE.Vector3().fromArray(s.lastPosition)), traveled = v.distance - s.lastDistance;
    // A physically docked learner can take another driven approach. This is
    // read-only: advisory arrows are not credited or rewritten. Check the
    // latest movement as well, so a teleport before the next tick cannot pass.
    return traveled >= -.001 && moved <= .15 && moved <= Math.max(0, traveled) + .025;
  }
  guidance(record) {
    const s = this.state(record); if (!s) return null;
    const tasks = this.tasks(record), task = tasks[s.index];
    return Object.assign({taskId: task && task.id || '', title: task && task.name || 'Práctica completada', phase: s.phase, route: this.route(record), waypointIndex: s.waypointIndex, completed: s.completed.length, total: tasks.length, routeComplete: this.routeComplete(record), pickupRouteAdvisory: s.phase === 'pickup', routeFault: !!s.routeFault, status: s.error || s.status || (s.phase === 'pickup' ? 'Recoge el pallet indicado. Las flechas de recogida son orientación; una aproximación válida también permite tomarlo.' : s.phase === 'drop' ? 'Sigue las flechas hasta la ubicación asignada.' : s.phase === 'withdraw' ? 'Retira ambas horquillas para confirmar el depósito.' : 'Todas las misiones verificadas.')}, task ? {productId: task.productId, sourceId: task.sourceId, sourceLocationCode: task.sourceLocationCode || '', destinationId: task.destinationId, locationCode: task.locationCode || '', destinationSlot: task.destinationSlot} : {}, this.scoringGuidance(record));
  }
  validatePickup(record, product) {
    const s = this.state(record); if (!s) return '';
    const task = this.task(record);
    if (s.phase !== 'pickup' || !task) return s.error || 'Continúa la misión activa antes de recoger otra carga.';
    const item = product.item, owner = product.sourceEntry && product.sourceEntry.ownerId || item && item.palletOwnerId;
    if (this.runtime.palletQueueRuntime.palletIdentity(product) !== task.productId || owner !== task.sourceId || task.sourceLocationCode && product.object.userData.sourceRackLocationCode !== task.sourceLocationCode) return 'Recoge el pallet asignado en el origen indicado por la misión.';
    if (!this.routeComplete(record) && !this.continuousApproach(record)) return 'Se detectó un cambio de posición sin conducción. Vuelve al último punto válido y acércate conduciendo al pallet.';
    return '';
  }
  validateDrop(record, destination) {
    const s = this.state(record); if (!s) return '';
    const task = this.task(record), entry = record.components.vehicle.entry;
    if (!task || s.phase !== 'drop' || !entry || this.runtime.palletQueueRuntime.palletIdentity(entry.product) !== task.productId) return 'Esta carga no corresponde a la misión activa.';
    if (!destination || destination.targetId !== task.destinationId || destination.kind !== 'stock') return 'Deposita en la ubicación asignada, no en otra superficie.';
    const p = destination.placement;
    if (!p || task.locationCode && p.locationCode !== task.locationCode || task.destinationSlot !== undefined && p.palletIndex !== task.destinationSlot) return 'El pallet debe quedar en la posición exacta indicada por su código.';
    if (!this.routeComplete(record)) return 'Completa la ruta señalada antes de confirmar el depósito.';
    return '';
  }
  destination(record) {
    const task = this.task(record), s = this.state(record), entry = record.components.vehicle.entry;
    if (!task || !s || s.phase !== 'drop' || !entry) return null;
    const target = this.runtime.records.get(task.destinationId), store = target && target.components.palletQueue;
    if (!store || !this.runtime.palletQueueRuntime.operational(store)) return null;
    let preferred;
    if (store.rack) {
      const cell = store.rack.layout.cells.find(cell => task.locationCode ? cell.code === task.locationCode : cell.index === task.destinationSlot);
      if (!cell) return null;
      preferred = new THREE.Vector3().setFromMatrixPosition(this.runtime.palletQueueRuntime.rackMatrix(target, entry.product, this.runtime.palletQueueRuntime.rackPoint(store, cell)));
    } else if (Number.isInteger(task.destinationSlot)) { const bay = store.pallets[task.destinationSlot]; if (!bay) return null; preferred = position(bay.object); }
    const placement = this.runtime.palletQueueRuntime.placement(target, entry.product, [], preferred, false, matrix => this.runtime.vehicleRuntime.receivingForks(record, entry.product, matrix));
    if (!placement || task.locationCode && placement.locationCode !== task.locationCode || task.destinationSlot !== undefined && placement.palletIndex !== task.destinationSlot) return null;
    return {kind: 'stock', targetId: target.id, matrix: placement.matrix, placement};
  }
  onPickup(record) {
    const s = this.state(record); if (!s) return;
    const entry = record.components.vehicle.entry, active = this.task(record);
    if (s.phase !== 'pickup' || !active || !entry || this.runtime.palletQueueRuntime.palletIdentity(entry.product) !== active.productId || !this.routeComplete(record) && !this.continuousApproach(record)) return;
    this.beginRoute(record, 'drop'); s.status = '';
    this.reward(record, 'pickup');
    const task = this.task(record), target = this.runtime.records.get(task.destinationId);
    try { if (target && target.components.palletQueue && target.components.palletQueue.rack && task.locationCode) this.runtime.palletQueueRuntime.assignLocation(target, {locationCode: task.locationCode, palletId: task.productId}); }
    catch (error) { s.error = error.message; s.status = error.message; s.phase = 'error'; }
    this.runtime.event(record.id, 'warehouse-task-picked', task.name + ' · ' + task.productId);
  }
  onDrop(record, product, destination) {
    const s = this.state(record); if (!s) return;
    const task = this.task(record), item = product.item;
    // Observe the actual receiver after custody has succeeded, not a command.
    if (s.phase !== 'drop' || record.components.vehicle.entry || !task || this.runtime.palletQueueRuntime.palletIdentity(product) !== task.productId || !product.sourceEntry || product.sourceEntry.ownerId !== task.destinationId || !item || item.palletOwnerId !== task.destinationId || task.locationCode && product.object.userData.sourceRackLocationCode !== task.locationCode || task.destinationSlot !== undefined && item.palletIndex !== task.destinationSlot || !destination || destination.kind !== 'stock' || destination.targetId !== task.destinationId || !this.routeComplete(record)) return;
    s.phase = 'withdraw'; s.status = ''; s.depositedProductId = task.productId;
  }
  withdrawn(record, product) {
    const api = this.runtime.vehicleRuntime, forks = api.rig(record).forks, c = record.components.vehicle.config;
    if (!forks) return false;
    forks.updateWorldMatrix(true, false); product.object.updateWorldMatrix(true, true);
    const local = product.bounds.clone().applyMatrix4(new THREE.Matrix4().getInverse(forks.matrixWorld).multiply(product.object.matrixWorld));
    return ![-1, 1].some(side => local.intersectsBox(new THREE.Box3(new THREE.Vector3(side * c.forkSpread / 2 - c.forkWidth / 2 - .025, -c.forkThickness - .025, -.025), new THREE.Vector3(side * c.forkSpread / 2 + c.forkWidth / 2 + .025, .025, c.forkLength + .025))));
  }
  step(delta) {
    this.runtime.records.forEach(record => {
      const s = this.state(record); if (!s || s.error || ['complete','error'].includes(s.phase)) return;
      const task = this.task(record), v = record.components.vehicle;
      if (s.scoring && !v.paused && Number.isFinite(delta) && delta > 0) s.scoring.clock = Math.min(1e10, s.scoring.clock + delta);
      if (s.phase === 'withdraw') {
        const product = this.product(s.depositedProductId);
        if (!product || !product.sourceEntry || product.sourceEntry.ownerId !== task.destinationId || !product.item || product.item.palletOwnerId !== task.destinationId || task.locationCode && product.object.userData.sourceRackLocationCode !== task.locationCode || task.destinationSlot !== undefined && product.item.palletIndex !== task.destinationSlot || !this.withdrawn(record, product)) return;
        this.reward(record, 'complete');
        if (s.scoring && s.scoring.missionErrors[s.index] === 0) this.reward(record, 'clean');
        s.completed.push(task.id); this.runtime.event(record.id, 'warehouse-task-completed', task.id + ' · ' + task.name + ' · ubicación verificada');
        s.index++; delete s.depositedProductId;
        if (s.scoring) s.scoring.cooldowns = {};
        if (s.index >= this.tasks(record).length) { s.phase = 'complete'; s.status = 'Todas las misiones verificadas.'; this.runtime.event(record.id, 'warehouse-training-completed', 'Práctica de almacén completada.'); }
        else this.beginRoute(record, 'pickup');
        return;
      }
      const points = this.route(record);
      // Once every corridor checkpoint is driven, the docking phase remains
      // free for centimetre-level positioning and fork withdrawal.
      if (s.waypointIndex >= points.length) return;
      const p = position(record.object), previous = new THREE.Vector3().fromArray(s.lastPosition), movement = horizontal(p, previous), traveled = Math.max(0, v.distance - s.lastDistance), allowed = Math.max(.025, Math.max(v.config.speed, v.config.reverseSpeed) * delta + .012);
      if (movement > allowed || movement > traveled + .025) { s.routeFault = true; s.status = 'Vuelve al último punto válido y recorre las flechas conduciendo.'; }
      if (s.routeFault && horizontal(p, new THREE.Vector3().fromArray(s.legStart)) < RADIUS) { s.routeFault = false; s.status = ''; s.legDistance = 0; }
      if (!s.routeFault) s.legDistance += Math.min(movement, traveled);
      const next = points[s.waypointIndex];
      if (!s.routeFault && next && horizontal(p, next) <= RADIUS && s.legDistance + RADIUS >= horizontal(new THREE.Vector3().fromArray(s.legStart), next)) {
        s.waypointIndex++; s.legStart = p.toArray(); s.legDistance = 0; s.status = '';
        if (s.phase === 'drop' && s.waypointIndex >= points.length) this.reward(record, 'route');
      }
      s.lastPosition = p.toArray(); s.lastDistance = v.distance;
    });
  }
  validateState(record) {
    const s = this.state(record), tasks = this.tasks(record);
    if (!tasks.length) return !s;
    if (!s || !Number.isInteger(s.index) || s.index < 0 || s.index > tasks.length || !Array.isArray(s.completed) || s.completed.length !== s.index || !s.completed.every((id, index) => id === tasks[index].id) || !['pickup','drop','withdraw','complete','error'].includes(s.phase) || (s.phase === 'complete') !== (s.index === tasks.length)) return false;
    const entry = record.components.vehicle.entry;
    if (!trainingSchema.score.validate(s.scoring, tasks, s, entry && this.runtime.palletQueueRuntime.palletIdentity(entry.product) || '')) return false;
    const task = tasks[s.index] || tasks[tasks.length - 1], route = s.phase === 'pickup' ? task.pickupRoute : task.route, v = record.components.vehicle;
    if (!Number.isInteger(s.waypointIndex) || s.waypointIndex < 0 || s.waypointIndex > route.length || typeof s.routeFault !== 'boolean' || s.routeFault && s.waypointIndex >= route.length || !['lastPosition','legStart'].every(key => Array.isArray(s[key]) && s[key].length === 3 && s[key].every(Number.isFinite)) || !Number.isFinite(s.lastDistance) || s.lastDistance < 0 || s.lastDistance > v.distance + .001 || !Number.isFinite(s.legDistance) || s.legDistance < 0) return false;
    if (s.phase === 'drop') return !!v.entry && this.runtime.palletQueueRuntime.palletIdentity(v.entry.product) === task.productId;
    if (['pickup','withdraw','complete'].includes(s.phase) && v.entry) return false;
    if (s.phase === 'withdraw') {
      const product = this.product(s.depositedProductId);
      return s.depositedProductId === task.productId && !!product && !!product.sourceEntry && product.sourceEntry.ownerId === task.destinationId && !!product.item && product.item.palletOwnerId === task.destinationId && (!task.locationCode || product.object.userData.sourceRackLocationCode === task.locationCode) && (task.destinationSlot === undefined || product.item.palletIndex === task.destinationSlot) && s.waypointIndex === route.length;
    }
    return true;
  }
}
