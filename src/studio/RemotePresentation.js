import * as THREE from 'three';
import {productIdentity} from './SimulationCheckpoint.js';

function shown(object) { for (let node = object; node; node = node.parent) if (!node.visible) return false; return true; }

/** Smooths a participant's presentation between authoritative checkpoints.
 * It never advances the host clock, changes product identity or allocates GPU
 * resources. New loads, hidden process inputs and large teleports appear at
 * their authoritative pose immediately instead of flying through equipment.
 */
export default class RemotePresentation {
  constructor(duration = 750) {
    this.duration = Math.max(1, Math.min(2000, duration));
    this.previous = new Map(); this.blends = new Map();
    this.position = new THREE.Vector3(); this.quaternion = new THREE.Quaternion(); this.scale = new THREE.Vector3(); this.matrix = new THREE.Matrix4();
  }

  before(runtime) {
    this.runtime = runtime; this.previous.clear();
    runtime.products.forEach(product => {
      product.object.updateWorldMatrix(true, false);
      this.previous.set(productIdentity(product), {matrix: product.object.matrixWorld.clone(), shown: shown(product.object), robotOwnerId: product.robotOwnerId || '', vehicleOwnerId: product.vehicleOwnerId || ''});
    });
  }

  after(runtime) {
    this.runtime = runtime; this.blends.clear();
    const now = performance.now();
    runtime.products.forEach(product => {
      if (product.heldBy || product.robotOwnerId || product.vehicleOwnerId || !shown(product.object)) return;
      const key = productIdentity(product), prior = this.previous.get(key);
      if (!prior || !prior.shown || prior.robotOwnerId || prior.vehicleOwnerId) return;
      product.object.updateWorldMatrix(true, false);
      const target = product.object.matrixWorld.clone();
      const fromPosition = new THREE.Vector3(), fromQuaternion = new THREE.Quaternion(), fromScale = new THREE.Vector3();
      const toPosition = new THREE.Vector3(), toQuaternion = new THREE.Quaternion(), toScale = new THREE.Vector3();
      prior.matrix.decompose(fromPosition, fromQuaternion, fromScale); target.decompose(toPosition, toQuaternion, toScale);
      if (fromPosition.distanceToSquared(toPosition) > 6.25) return;
      const automatic = product.object.matrixAutoUpdate;
      this.blends.set(key, {product, target, fromPosition, fromQuaternion, fromScale, toPosition, toQuaternion, toScale, automatic, at: now});
      runtime.setProductMatrix(product, prior.matrix);
      product.object.matrixAutoUpdate = automatic;
    });
    this.previous.clear();
  }

  tick(runtime = this.runtime) {
    if (!runtime) return;
    const now = performance.now();
    this.blends.forEach((blend, key) => {
      if (!runtime.products.has(blend.product.object) || blend.product.heldBy || blend.product.robotOwnerId || blend.product.vehicleOwnerId) { this.blends.delete(key); return; }
      const alpha = Math.min(1, Math.max(0, (now - blend.at) / this.duration));
      if (alpha === 1) { runtime.setProductMatrix(blend.product, blend.target); blend.product.object.matrixAutoUpdate = blend.automatic; this.blends.delete(key); return; }
      this.position.copy(blend.fromPosition).lerp(blend.toPosition, alpha);
      THREE.Quaternion.slerp(blend.fromQuaternion, blend.toQuaternion, this.quaternion, alpha);
      this.scale.copy(blend.fromScale).lerp(blend.toScale, alpha);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      runtime.setProductMatrix(blend.product, this.matrix);
      blend.product.object.matrixAutoUpdate = blend.automatic;
    });
  }

  clear() {
    const runtime = this.runtime;
    if (runtime) this.blends.forEach(blend => {
      if (runtime.products.has(blend.product.object) && !blend.product.heldBy && !blend.product.robotOwnerId && !blend.product.vehicleOwnerId) { runtime.setProductMatrix(blend.product, blend.target); blend.product.object.matrixAutoUpdate = blend.automatic; }
    });
    this.previous.clear(); this.blends.clear(); this.runtime = null;
  }
}
