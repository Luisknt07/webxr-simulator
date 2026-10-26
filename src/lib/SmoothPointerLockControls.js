import * as THREE from 'three';

/** Desktop look only. XR poses and held objects retain their own transforms. */
export default class SmoothPointerLockControls extends THREE.EventDispatcher {
  constructor(camera, domElement) {
    super(); this.camera = camera; this.domElement = domElement; this.document = domElement.ownerDocument || document;
    this.isLocked = false; this.sensitivity = .00125; this.smoothingSeconds = .055; this.pending = new THREE.Vector2();
    this.mousemove = event => {
      if (!this.isLocked) return;
      this.queueLook(event.movementX || event.mozMovementX || 0, event.movementY || event.mozMovementY || 0);
    };
    this.lockchange = () => { this.isLocked = this.document.pointerLockElement === this.domElement; this.reset(); this.dispatchEvent({type: this.isLocked ? 'lock' : 'unlock'}); };
    this.blur = () => this.reset(); this.connect();
  }
  connect() {
    if (this.connected) return; this.connected = true;
    this.document.addEventListener('mousemove', this.mousemove); this.document.addEventListener('pointerlockchange', this.lockchange);
    if (this.document.defaultView) this.document.defaultView.addEventListener('blur', this.blur);
  }
  disconnect() {
    if (!this.connected) return; this.connected = false;
    this.document.removeEventListener('mousemove', this.mousemove); this.document.removeEventListener('pointerlockchange', this.lockchange);
    if (this.document.defaultView) this.document.defaultView.removeEventListener('blur', this.blur); this.reset();
  }
  reset() { this.pending.set(0, 0); this.touchPending = false; }
  queueLook(dx, dy) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    this.pending.x = THREE.Math.clamp(this.pending.x + THREE.Math.clamp(dx, -200, 200) * this.sensitivity, -.7, .7);
    this.pending.y = THREE.Math.clamp(this.pending.y + THREE.Math.clamp(dy, -200, 200) * this.sensitivity, -.7, .7);
  }
  addLookDelta(dx, dy) { if (!this.connected || !Number.isFinite(dx) || !Number.isFinite(dy) || !dx && !dy) return; this.touchPending = true; this.queueLook(dx, dy); }
  update(delta) {
    if (!this.isLocked && !this.touchPending || !Number.isFinite(delta) || delta <= 0) return;
    if (this.pending.lengthSq() < 1e-14) { this.touchPending = false; return; }
    const alpha = 1 - Math.exp(-Math.min(delta, .1) / this.smoothingSeconds), step = this.pending.clone().multiplyScalar(alpha);
    this.pending.sub(step); const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    euler.y -= step.x; euler.x = THREE.Math.clamp(euler.x - step.y, -Math.PI / 2 + .001, Math.PI / 2 - .001);
    if (Math.abs(euler.x) >= Math.PI / 2 - .001) this.pending.y = 0;
    this.camera.quaternion.setFromEuler(euler); this.camera.updateMatrix(); this.dispatchEvent({type: 'change'});
  }
  getObject() { return this.camera; }
  getDirection(value) { return value.set(0, 0, -1).applyQuaternion(this.camera.quaternion); }
  moveForward(distance) { const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0), forward = new THREE.Vector3().crossVectors(this.camera.up, right); this.camera.position.addScaledVector(forward, distance); }
  moveRight(distance) { this.camera.position.addScaledVector(new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0), distance); }
  lock() {
    if (!this.connected || this.domElement.isConnected === false || typeof this.domElement.requestPointerLock !== 'function') return;
    // Pointer-lock permission is independent of the click's world action.
    // Denied/unsupported capture must not interrupt an HMI or leave a rejected
    // promise behind; pointerlockchange remains the source of locked state.
    try { const request = this.domElement.requestPointerLock(); if (request && typeof request.catch === 'function') request.catch(() => {}); }
    catch (_) { /* Browsers may also reject inactive documents synchronously. */ }
  }
  unlock() { this.reset(); if (this.document.exitPointerLock) this.document.exitPointerLock(); }
  dispose() { this.disconnect(); }
}
