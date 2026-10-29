import * as THREE from 'three';
import {productIdentity} from '../../../../modules/logistica-industrial/runtime/SimulationCheckpoint.js';

const SEND_MS = 160;
const GRACE_MS = 1200;
const MAX_REACH = 6;
const MAX_HOLD_REACH = 3.5;

function visible(object) { for (let node = object; node; node = node.parent) if (!node.visible) return false; return true; }
function worldPose(object) {
  object.updateWorldMatrix(true, false);
  return {position: object.getWorldPosition(new THREE.Vector3()).toArray(), quaternion: object.getWorldQuaternion(new THREE.Quaternion()).toArray()};
}

/** Shared grabbing keeps physics on the host. A participant runs only a local
 * collision-aware held preview until its requested release is acknowledged.
 * The host validates reach/availability, reserves the same load and applies
 * movement through the simulator's existing sweep and release mechanisms.
 */
export default class SharedGrabs {
  constructor(experience) {
    this.experience = experience;
    this.runtime = experience.editor.simulation;
    this.local = new Map(); this.pending = new Map(); this.remote = new Map(); this.releasing = new Set();
    this.rawPickup = this.runtime.pickupProduct.bind(this.runtime);
    this.rawRelease = this.runtime.releaseProduct.bind(this.runtime);
    this.rawReleaseHeld = this.runtime.releaseHeldProducts.bind(this.runtime);
    this.originalPickup = this.runtime.pickupProduct;
    this.originalRelease = this.runtime.releaseProduct;
    this.originalReleaseHeld = this.runtime.releaseHeldProducts;
    this.pickupWrapper = (product, controller, inputMode) => this.pickup(product, controller, inputMode);
    this.releaseWrapper = (product, force) => this.release(product, force);
    this.releaseHeldWrapper = (controller, inputMode) => this.releaseHeld(controller, inputMode);
    this.runtime.pickupProduct = this.pickupWrapper;
    this.runtime.releaseProduct = this.releaseWrapper;
    this.runtime.releaseHeldProducts = this.releaseHeldWrapper;
  }

  get holding() { return !!(this.local.size || this.pending.size || this.releasing.size); }
  get room() { return this.experience.room; }
  get userId() { return this.experience.client.user && this.experience.client.user.id; }
  message(value) { this.experience.message(value); }
  find(key) { return Array.from(this.runtime.products.values()).find(product => productIdentity(product) === key); }

  pickup(product, controller, inputMode = 'select') {
    if (!this.room) return this.rawPickup(product, controller, inputMode);
    if (this.room.role === 'observer') { this.message('El observador no puede manipular cargas.'); return false; }
    if (!product || !controller || product.heldBy || this.runtime.held.has(controller)) return false;
    const key = productIdentity(product);
    if (this.local.has(key) || this.pending.has(key)) return false;
    const generation = this.room.id, connection = this.experience.connection;
    const request = {product, controller, inputMode, cancelled: false};
    this.pending.set(key, request);
    const presence = this.experience.pose && this.experience.pose();
    const updatePresence = presence && this.experience.client.roomPose ? this.experience.client.roomPose(this.room.id, presence) : Promise.resolve();
    Promise.resolve(updatePresence).then(() => {
      if (!this.room || this.room.id !== generation || request.cancelled || this.pending.get(key) !== request) return null;
      return connection.action({type: 'grab', objectId: key});
    }).then(result => {
      if (!result) return;
      if (!this.room || this.room.id !== generation || request.cancelled) {
        connection.action({type: 'release', objectId: key}).catch(() => {});
        return;
      }
      const pending = this.pending.get(key);
      if (pending !== request) return;
      this.pending.delete(key);
      if (!this.local.has(key) && !this.beginLocal(key, pending.product, pending.controller, pending.inputMode)) {
        connection.action({type: 'release', objectId: key}).catch(() => {});
      }
    }).catch(error => {
      if (this.pending.get(key) === request) this.pending.delete(key);
      if (!request.cancelled && this.room && this.room.id === generation) this.message('No se pudo agarrar: ' + error.message);
    });
    return true;
  }

  beginLocal(key, product, controller, inputMode = 'select') {
    const grip = inputMode === 'squeeze' && this.runtime.productGripInputs && this.runtime.productGripInputs.get(controller);
    if (!this.runtime.running || inputMode === 'squeeze' && (!grip || !grip.down) ||
      !this.runtime.products.has(product.object) || !this.rawPickup(product, controller, inputMode)) return false;
    this.local.set(key, {product, controller, at: performance.now(), lastSent: 0, sending: false});
    return true;
  }

  releaseHeld(controller, inputMode) {
    // A network lease can arrive after the physical hand has already let go.
    // Cancel the request now; its eventual acknowledgement releases the lease.
    this.pending.forEach((request, key) => {
      if ((!controller || request.controller === controller) && (!inputMode || request.inputMode === inputMode)) {
        request.cancelled = true;
        this.pending.delete(key);
      }
    });
    return this.rawReleaseHeld(controller, inputMode);
  }

  release(product, force = false) {
    if (!this.room) return this.rawRelease(product, force);
    const key = productIdentity(product), entry = this.local.get(key);
    if (!entry) return false; // Remote hands are released by authority events.
    const pose = worldPose(product.object);
    if (!this.rawRelease(product, force)) return false;
    this.local.delete(key); this.releasing.add(key);
    const generation = this.room.id;
    this.experience.connection.action({type: 'release', objectId: key, pose}).catch(error => this.message('La liberación se recuperará con el estado del anfitrión: ' + error.message))
      .finally(() => { if (this.room && this.room.id === generation) this.releasing.delete(key); });
    return true;
  }

  participant(userId) { const room = this.latestRoom || this.room; return room && room.participants && room.participants.find(person => person.id === userId && person.online); }

  validGrab(product, person, controller) {
    if (!product || !person || !person.pose || !visible(product.object) || product.heldBy) return false;
    product.object.updateWorldMatrix(true, false);
    const center = product.bounds.clone().applyMatrix4(product.object.matrixWorld).getCenter(new THREE.Vector3());
    const origin = new THREE.Vector3().fromArray(person.pose.position);
    if (origin.distanceTo(center) > MAX_REACH) return false;
    const world = this.runtime.ctx.collisionWorld;
    return !(world && world.rayBlocked && world.rayBlocked(origin, center, {ignore: [product.object, controller]}));
  }

  cancelRemote(key, reason) {
    const entry = this.remote.get(key);
    if (entry) { this.rawRelease(entry.product, true); this.removeRemote(key); }
    if (this.room && this.room.role === 'host') this.experience.connection.action({type: 'release', objectId: key, reason}).catch(() => {});
  }

  removeRemote(key) {
    const entry = this.remote.get(key);
    if (entry && entry.controller.parent) entry.controller.parent.remove(entry.controller);
    this.remote.delete(key);
  }

  moveRemote(entry, pose) {
    const person = this.participant(entry.userId);
    if (!person || !person.pose || !pose || !Array.isArray(pose.position) || pose.position.length !== 3 || pose.position.some(value => !Number.isFinite(value))) return false;
    const position = new THREE.Vector3().fromArray(pose.position), eye = new THREE.Vector3().fromArray(person.pose.position);
    if (position.distanceTo(eye) > MAX_HOLD_REACH) return false;
    // The box basis stays as grabbed. Only the controller position changes;
    // updateHeldProducts performs the same swept collision check as local XR.
    const controller = entry.controller;
    controller.quaternion.fromArray(person.pose.quaternion);
    controller.position.copy(position).sub(new THREE.Vector3(0, -.025, -(entry.product.holdDistance || .35)).applyQuaternion(controller.quaternion));
    controller.updateWorldMatrix(true, false);
    this.runtime.updateHeldProducts();
    entry.at = performance.now();
    return true;
  }

  async applyEvent(event, roomUpdate) {
    if (roomUpdate) this.latestRoom = roomUpdate;
    const payload = event && event.type === 'action' && event.payload;
    if (payload && payload.type === 'simulation' && payload.action === 'reset') { this.detach(); return true; }
    if (!payload || !['grab', 'pose-object', 'release'].includes(payload.type) || !this.room) return false;
    const key = payload.objectId;
    if (payload.type === 'release') {
      const local = this.local.get(key);
      if (local && (payload.ownerId === this.userId || event.userId === this.userId || this.room.hostId === event.userId)) {
        this.rawRelease(local.product, true); this.local.delete(key);
      }
      this.pending.delete(key); this.releasing.delete(key);
      if (payload.reason && (payload.ownerId === this.userId || event.userId === this.userId)) this.message(payload.reason);
      if (this.room.role === 'host') {
        const remote = this.remote.get(key);
        if (remote) { if (payload.pose) this.moveRemote(remote, payload.pose); this.rawRelease(remote.product, true); this.removeRemote(key); }
      }
      return true;
    }
    if (this.room.role !== 'host') return true;
    if (payload.type === 'grab') {
      if (event.userId === this.userId) {
        const pending = this.pending.get(key);
        if (pending && !this.local.has(key)) { this.pending.delete(key); if (!this.beginLocal(key, pending.product, pending.controller, pending.inputMode)) this.cancelRemote(key, 'Esta carga ya no está disponible.'); }
        return true;
      }
      if (this.remote.has(key)) return true;
      const person = this.participant(event.userId), product = this.find(key), controller = new THREE.Group();
      controller.name = 'Mando remoto'; controller.userData.editorRuntimeHelper = true;
      if (person && person.pose) { controller.position.fromArray(person.pose.position); controller.quaternion.fromArray(person.pose.quaternion); }
      this.runtime.ctx.scene.add(controller);
      if (!this.validGrab(product, person, controller) || !this.rawPickup(product, controller)) {
        controller.parent.remove(controller); this.cancelRemote(key, 'La carga está ocupada, fuera de alcance o detrás de un obstáculo.'); return true;
      }
      this.remote.set(key, {product, controller, userId: event.userId, at: performance.now()});
    } else {
      const entry = this.remote.get(key);
      if (entry && entry.userId === event.userId && !this.moveRemote(entry, payload.pose)) this.cancelRemote(key, 'La carga debe permanecer cerca del usuario y en una posición válida.');
    }
    return true;
  }

  receiveRoom(room) {
    this.latestRoom = room;
    const locks = new Map((room.locks || []).map(lock => [lock.objectId, lock]));
    const now = performance.now();
    this.local.forEach((entry, key) => {
      const lock = locks.get(key);
      if (now - entry.at > GRACE_MS && (!lock || lock.userId !== this.userId)) {
        this.rawRelease(entry.product, true); this.local.delete(key); this.message('Se liberó una reserva vencida; recuperando el estado de la sala.');
      }
    });
    this.remote.forEach((entry, key) => {
      const lock = locks.get(key), person = this.participant(entry.userId);
      if (now - entry.at > GRACE_MS && (!lock || lock.userId !== entry.userId || !person)) {
        this.rawRelease(entry.product, true); this.removeRemote(key);
      }
    });
  }

  tick() {
    if (!this.room) return;
    if ((this.room.role !== 'host' || this.experience.editor.simulationPaused) && (this.local.size || this.remote.size)) this.runtime.updateHeldProducts();
    const now = performance.now();
    this.local.forEach((entry, key) => {
      if (entry.sending || now - entry.lastSent < SEND_MS) return;
      entry.sending = true; entry.lastSent = now;
      this.experience.connection.action({type: 'pose-object', objectId: key, pose: worldPose(entry.product.object)})
        .catch(error => { if (this.local.get(key) === entry) { this.rawRelease(entry.product, true); this.local.delete(key); this.message('Se perdió la reserva: ' + error.message); } })
        .finally(() => { entry.sending = false; });
    });
  }

  detach() {
    this.pending.forEach(request => { request.cancelled = true; });
    this.local.forEach(entry => this.rawRelease(entry.product, true));
    this.remote.forEach(entry => { this.rawRelease(entry.product, true); if (entry.controller.parent) entry.controller.parent.remove(entry.controller); });
    this.local.clear(); this.remote.clear(); this.pending.clear(); this.releasing.clear();
    this.latestRoom = null;
  }

  dispose() {
    this.detach();
    if (this.runtime.pickupProduct === this.pickupWrapper) this.runtime.pickupProduct = this.originalPickup;
    if (this.runtime.releaseProduct === this.releaseWrapper) this.runtime.releaseProduct = this.originalRelease;
    if (this.runtime.releaseHeldProducts === this.releaseHeldWrapper) this.runtime.releaseHeldProducts = this.originalReleaseHeld;
  }
}
