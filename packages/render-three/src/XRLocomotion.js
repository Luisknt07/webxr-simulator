import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

/** Controller locomotion changes the rig, never the headset's tracked pose.
 * Centering a newly connected/resumed stick is required before it can move. */
export default class XRLocomotion {
  constructor(ctx, options = {}) {
    this.ctx = ctx; this.options = options; this.inputs = new WeakMap(); this.session = null; this.disposed = false;
    this.speed = Number.isFinite(options.speed) ? Math.max(.1, Math.min(5, options.speed)) : 1.5;
    this.deadzone = .18; this.snapAngle = Math.PI / 6;
    this.head = new THREE.Vector3(); this.forward = new THREE.Vector3(); this.right = new THREE.Vector3(); this.desired = new THREE.Vector3();
    this.rigPosition = new THREE.Vector3(); this.offset = new THREE.Vector3(); this.quaternion = new THREE.Quaternion();
    this.rigQuaternion = new THREE.Quaternion(); this.parentQuaternion = new THREE.Quaternion(); this.rotation = new THREE.Matrix4();
    this.axis = new THREE.Vector2();
    this.window = options.window || (typeof window === 'undefined' ? null : window);
    this.onBlur = () => this.reset();
    if (this.window && this.window.addEventListener) this.window.addEventListener('blur', this.onBlur);
  }
  reset() { this.inputs = new WeakMap(); this.session = null; }
  blocked(session) {
    const ctx = this.ctx, editor = ctx.editor;
    return this.disposed || !ctx.vrMode || !session || !ctx.renderer || !ctx.renderer.xr.isPresenting || ctx.xrEntryPending || ctx.xrExitPending ||
      ctx.studioMenuOpen || (ctx.voicePanelOpen || ctx.assistantPanelOpen) || ctx.drivingVehicle || ctx.roomTransition || ctx.goto !== null && ctx.goto !== undefined ||
      session.visibilityState && session.visibilityState !== 'visible' ||
      editor && (editor.active || editor.initializing || editor.loadingProject || editor.busy || editor.creatingScene || editor.document && editor.document.loading);
  }
  axes(source) {
    const pad = source && source.gamepad;
    if (!source || !['left', 'right'].includes(source.handedness) || !pad || pad.mapping !== 'xr-standard' || !pad.axes || pad.axes.length < 2) return null;
    const index = pad.axes.length >= 4 ? 2 : 0;
    const x = pad.axes[index], y = pad.axes[index + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return this.axis.set(Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y)));
  }
  trackedCamera() {
    const ctx = this.ctx; ctx.cameraRig.updateWorldMatrix(true, true);
    // Three r112 composes the tracked ArrayCamera from its matrix and rig.
    // Calling getWorldPosition() on it would rebuild an obsolete local pose.
    return ctx.renderer.xr.getCamera(ctx.camera);
  }
  placeRig(position) {
    const rig = this.ctx.cameraRig;
    rig.position.copy(rig.parent ? rig.parent.worldToLocal(position) : position);
    rig.updateWorldMatrix(true, true);
  }
  move(x, y, delta) {
    const ctx = this.ctx, rig = ctx.cameraRig, camera = this.trackedCamera();
    if (!camera || !camera.matrixWorld) return false;
    this.head.setFromMatrixPosition(camera.matrixWorld);
    this.forward.set(0, 0, -1).transformDirection(camera.matrixWorld); this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-8) {
      this.rotation.extractRotation(rig.matrixWorld); this.forward.set(0, 0, -1).applyMatrix4(this.rotation); this.forward.y = 0;
    }
    this.forward.normalize(); this.right.crossVectors(this.forward, UP).normalize();
    const magnitude = Math.min(1, Math.hypot(x, y)), strength = (magnitude - this.deadzone) / (1 - this.deadzone);
    if (strength <= 0) return false;
    const directionLength = Math.hypot(x, y);
    this.desired.copy(this.head).addScaledVector(this.forward, -y / directionLength * strength * this.speed * delta)
      .addScaledVector(this.right, x / directionLength * strength * this.speed * delta);
    rig.getWorldPosition(this.rigPosition);
    const eyeHeight = THREE.Math.clamp(this.head.y - this.rigPosition.y, .6, 2.3);
    const resolved = ctx.collisionWorld ? ctx.collisionWorld.moveCapsule(this.head, this.desired, {radius: .25, height: eyeHeight, eyeHeight}) : this.desired;
    if (!resolved || !Number.isFinite(resolved.x) || !Number.isFinite(resolved.y) || !Number.isFinite(resolved.z)) return false;
    this.offset.copy(resolved).sub(this.head); if (this.offset.lengthSq() < 1e-14) return false;
    this.rigPosition.add(this.offset); this.placeRig(this.rigPosition); return true;
  }
  turn(direction) {
    const ctx = this.ctx, rig = ctx.cameraRig, camera = this.trackedCamera();
    if (!camera || !camera.matrixWorld) return false;
    this.head.setFromMatrixPosition(camera.matrixWorld); rig.getWorldPosition(this.rigPosition); rig.getWorldQuaternion(this.rigQuaternion);
    this.quaternion.setFromAxisAngle(UP, -Math.sign(direction) * this.snapAngle);
    this.rigPosition.sub(this.head).applyQuaternion(this.quaternion).add(this.head);
    this.rigQuaternion.premultiply(this.quaternion);
    if (rig.parent) this.rigQuaternion.premultiply(rig.parent.getWorldQuaternion(this.parentQuaternion).inverse());
    rig.quaternion.copy(this.rigQuaternion); this.placeRig(this.rigPosition); return true;
  }
  tick(delta = 0) {
    const ctx = this.ctx, xr = ctx.renderer && ctx.renderer.xr, session = xr && xr.getSession && xr.getSession();
    if (this.blocked(session) || !ctx.cameraRig || !ctx.camera || !Number.isFinite(delta) || delta <= 0) { if (this.session) this.reset(); return false; }
    if (this.session !== session) { this.inputs = new WeakMap(); this.session = session; }
    let leftSeen = false, rightSeen = false, moveX = 0, moveY = 0, turnX = 0;
    for (const data of ctx.raycontrol && ctx.raycontrol.controllers || []) {
      const source = data.inputSource, axes = !data.desktop && this.axes(source);
      if (!axes || source.handedness === 'left' && leftSeen || source.handedness === 'right' && rightSeen) continue;
      if (source.handedness === 'left') leftSeen = true; else rightSeen = true;
      let state = this.inputs.get(source);
      if (!state) { state = {armed: false}; this.inputs.set(source, state); }
      const centered = Math.hypot(axes.x, axes.y) <= this.deadzone;
      if (centered) { state.armed = true; continue; }
      if (!state.armed) continue;
      if (source.handedness === 'left') {
        if (ctx.studioLocomotion !== 'teleport') { moveX = axes.x; moveY = axes.y; }
      } else if (Math.abs(axes.x) >= .65) {
        turnX = axes.x; state.armed = false;
      }
    }
    // Apply the same order even when r112 remaps the physical hands' indices.
    let changed = turnX ? this.turn(turnX) : false;
    if (moveX || moveY) changed = this.move(moveX, moveY, Math.min(delta, .05)) || changed;
    if (changed) this.trackedCamera();
    return changed;
  }
  dispose() { if (this.disposed) return; this.disposed = true; this.reset(); if (this.window && this.window.removeEventListener) this.window.removeEventListener('blur', this.onBlur); }
}
