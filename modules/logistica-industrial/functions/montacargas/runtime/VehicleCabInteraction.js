import * as THREE from 'three';
import vehicles from '../schema/vehicles.js';
import VehicleCabLabels from './VehicleCabLabels.js';

const CHANNELS = new Set(['lift', 'tilt', 'reach', 'sideShift', 'turret']);
const clamp = value => Math.max(-1, Math.min(1, value));
const visible = object => {for (let node = object; node; node = node.parent) if (!node.visible) return false; return true;};
const pressed = hand => {const pad = hand.source.gamepad, button = pad && pad.mapping === 'xr-standard' && pad.buttons && pad.buttons[1]; return button ? !!(button.pressed || button.value > .6) : hand.eventGrip === true;};
const neutral = hand => !(hand.source.gamepad && (hand.source.gamepad.axes || []).some(value => Number.isFinite(value) && Math.abs(value) > .18)) &&
  !(hand.source.gamepad && (hand.source.gamepad.buttons || []).some(button => button && (button.pressed || button.value > .6)));

/** Local cab interactions only. Tracking remains owned by WebXR, while the
 * existing VehicleRuntime retains all motion, payload and safety decisions. */
export default class VehicleCabInteraction {
  constructor(driving) {
    this.driving = driving; this.ctx = driving.ctx; this.hands = new Map(); this.controls = []; this.consumedSources = new Set(); this.releasedSources = new Set(); this.neutralChannels = new Set();
    this.input = this.ctx.raycontrol; this.cancelled = () => this.reset();
    this.labels = new VehicleCabLabels(this.ctx, {document: driving.document});
    if (this.input && this.input.addEventListener) this.input.addEventListener('controllerInputCancelled', this.cancelled);
  }
  mount(root) {
    this.clear(); const rig = root && root.userData.vehicleRig, controls = rig && rig.controls;
    if (!controls) return;
    const features = vehicles.supports(rig.config || {});
    const add = (descriptor, kind) => {
      if (!descriptor || !descriptor.object || !descriptor.object.parent || kind === 'lever' && (!CHANNELS.has(descriptor.id) || !features[descriptor.id])) return;
      const axis = new THREE.Vector3().fromArray(descriptor.axis || [0, 0, 1]).normalize();
      const u = new THREE.Vector3(1, 0, 0); if (Math.abs(u.dot(axis)) > .9) u.set(0, 1, 0);
      u.addScaledVector(axis, -u.dot(axis)).normalize(); const v = new THREE.Vector3().crossVectors(axis, u).normalize();
      this.controls.push({descriptor, kind, object: descriptor.object, channel: kind === 'wheel' ? 'steer' : descriptor.id, axis, u, v,
        rest: descriptor.restQuaternion ? descriptor.restQuaternion.clone() : descriptor.object.quaternion.clone(), frame: new THREE.Matrix4(), inverse: new THREE.Matrix4(),
        origin: new THREE.Vector3().fromArray(descriptor.pivotLocal || [0, 0, 0]), value: 0, owner: null});
    };
    add(controls.wheel || controls.steering, 'wheel'); (controls.levers || []).forEach(value => add(value, 'lever'));
    this.labels.mount(root, this.controls); this.syncLabels();
  }
  setGuidance(control) {this.labels.setGuidance(control); this.syncLabels();}
  syncLabels() {this.labels.sync(!!this.driving.id && !this.driving.blocked(), this.hands);}
  pose(hand) {
    // A lost gripSpace pose must release the control, never reuse a stale hand.
    if (hand.data.grip && hand.source.gripSpace) return visible(hand.data.grip) ? hand.data.grip : null;
    return hand.data.grip && visible(hand.data.grip) ? hand.data.grip : visible(hand.data.controller) ? hand.data.controller : null;
  }
  syncHands() {
    const connected = new Set();
    for (const data of this.input && this.input.controllers || []) {
      const source = data.inputSource, controller = data.controller;
      if (!controller || data.desktop || data.enabled === false || !source || source.hand || source.targetRayMode && source.targetRayMode !== 'tracked-pointer' || !['left', 'right'].includes(source.handedness)) continue;
      connected.add(controller); let hand = this.hands.get(controller);
      if (hand && hand.source !== source) {this.removeHand(hand); hand = null;}
      if (!hand) {
        hand = {data, source, controller, armed: false, previousGrip: false, eventGrip: null, control: null, hover: null};
        hand.start = () => {hand.eventGrip = true;}; hand.end = () => {hand.eventGrip = false;};
        controller.addEventListener('squeezestart', hand.start); controller.addEventListener('squeezeend', hand.end);
        this.hands.set(controller, hand);
      }
      hand.data = data;
    }
    for (const hand of Array.from(this.hands.values())) if (!connected.has(hand.controller)) this.removeHand(hand);
  }
  frame(control) {
    const object = control.object; object.parent.updateWorldMatrix(true, false);
    control.frame.multiplyMatrices(object.parent.matrixWorld, new THREE.Matrix4().compose(object.position, control.rest, object.scale)); control.inverse.getInverse(control.frame);
  }
  local(control, point) {return point.clone().applyMatrix4(control.inverse).sub(control.origin);}
  angle(control, point) {const local = this.local(control, point); return Math.atan2(local.dot(control.v), local.dot(control.u));}
  distance(control, point) {
    const descriptor = control.descriptor;
    if (control.kind === 'lever' || descriptor.gripOnly) return descriptor.grip ? descriptor.grip.getWorldPosition(new THREE.Vector3()).distanceTo(point) : control.object.getWorldPosition(new THREE.Vector3()).distanceTo(point);
    const local = this.local(control, point), plane = local.clone().addScaledVector(control.axis, -local.dot(control.axis));
    if (plane.lengthSq() < 1e-6) return Infinity;
    return plane.normalize().multiplyScalar(descriptor.radius || .17).add(control.origin).applyMatrix4(control.frame).distanceTo(point);
  }
  ghost(hand, pose, active) {
    if (!hand.ghost) {
      const geometry = new THREE.SphereBufferGeometry(.038, 10, 6), material = new THREE.MeshBasicMaterial({color: '#75efd0', transparent: true, opacity: .55, depthWrite: false});
      hand.ghost = new THREE.Mesh(geometry, material); hand.ghost.name = 'Contacto de mano · cabina'; hand.ghost.userData.editorRuntimeHelper = true;
    }
    if (hand.ghost.parent !== pose) pose.add(hand.ghost);
    hand.ghost.visible = !!(hand.hover || hand.control); hand.ghost.material.color.set(active ? '#f4cb62' : '#75efd0');
  }
  take(hand, control, point) {
    if (control.owner) return false;
    const record = this.driving.record(), vehicle = record && record.components.vehicle;
    // Start from the physical control angle, not the logical steering sign.
    // A rim faces the operator (inputSign=-1); a rear-pointing tiller uses+1.
    // Regrabbing either at a nonzero steer must not flip it on the first frame.
    control.value = control.kind === 'wheel' ? clamp((vehicle && vehicle.pose.steer || 0) / (vehicle && vehicle.config.steerLimit || 1) * (control.descriptor.inputSign === undefined ? 1 : control.descriptor.inputSign)) : 0;
    if (control.kind === 'wheel') {
      // Road-wheel steering is rate-limited and can lag a directly held rim.
      // Regrab the angle the hand actually sees, rather than that older pose.
      const relative = control.rest.clone().inverse().multiply(control.object.quaternion);
      const twist = relative.x * control.axis.x + relative.y * control.axis.y + relative.z * control.axis.z;
      const angle = 2 * Math.atan2(twist, relative.w), wrapped = Math.atan2(Math.sin(angle), Math.cos(angle));
      if (Number.isFinite(wrapped)) control.value = clamp(wrapped / (control.descriptor.maxAngle || 1.25));
    }
    hand.control = control; control.owner = hand; hand.startPoint = this.local(control, point); hand.lastLocal = hand.startPoint.clone();
    hand.lastAngle = this.angle(control, point); hand.rotation = control.value * (control.descriptor.maxAngle || 1.25);
    this.haptic(hand, .25); return true;
  }
  haptic(hand, strength) {
    try {const pad = hand.source.gamepad, actuator = pad && pad.hapticActuators && pad.hapticActuators[0]; if (actuator && actuator.pulse) {const pending = actuator.pulse(strength, 25); if (pending && pending.catch) pending.catch(() => {});}} catch (_) { /* Optional feedback. */ }
  }
  release(hand, requireNeutral = true) {
    const control = hand.control;
    if (control) {
      this.releasedSources.add(hand.source); delete control.object.userData.cabControlValue;
      this.neutralChannels.add(control.channel);
      if (control.kind === 'lever') control.object.quaternion.copy(control.rest);
      control.owner = null; control.value = 0; hand.control = null;
    }
    if (requireNeutral) hand.armed = false;
  }
  updateControl(hand, point) {
    const control = hand.control, descriptor = control.descriptor;
    const local = this.local(control, point);
    if (hand.lastLocal.distanceTo(local) > .4 || this.distance(control, point) > (descriptor.releaseDistance || .42)) {this.release(hand); return;}
    if (control.kind === 'wheel') {
      const angle = this.angle(control, point); let delta = angle - hand.lastAngle;
      if (delta > Math.PI) delta -= Math.PI * 2; if (delta < -Math.PI) delta += Math.PI * 2;
      if (Math.abs(delta) > Math.PI / 2) {this.release(hand); return;}
      const limit = descriptor.maxAngle || 1.25; hand.rotation = Math.max(-limit, Math.min(limit, hand.rotation + delta)); control.value = hand.rotation / limit; hand.lastAngle = angle;
    } else control.value = clamp(local.clone().sub(hand.startPoint).dot(control.axis) / (descriptor.travel || .13));
    hand.lastLocal.copy(local); control.object.userData.cabControlValue = control.value;
    const rotationAxis = new THREE.Vector3().fromArray(control.kind === 'wheel' ? descriptor.axis || [0, 0, 1] : descriptor.rotationAxis || [1, 0, 0]).normalize();
    control.object.quaternion.copy(control.rest).multiply(new THREE.Quaternion().setFromAxisAngle(rotationAxis, control.value * (descriptor.maxAngle || (control.kind === 'wheel' ? 1.25 : .35))));
  }
  sample() {
    this.consumedSources.clear(); this.releasedSources.clear(); this.syncHands();
    const active = this.ctx.vrMode && this.driving.id && !this.driving.blocked() && (!this.input || this.input.enabled !== false);
    if (!active) {this.reset(); return;}
    this.controls.forEach(control => this.frame(control));
    for (const hand of this.hands.values()) {
      const pose = this.pose(hand), grip = pressed(hand);
      if (!pose || hand.data.selectionCapture) {this.release(hand); hand.hover = null; hand.previousGrip = grip; if (hand.ghost) hand.ghost.visible = false; continue;}
      const point = pose.getWorldPosition(new THREE.Vector3()); hand.hover = null;
      if (!grip) {this.release(hand, false); if (neutral(hand)) hand.armed = true;}
      let nearest = null, best = Infinity;
      this.controls.forEach(control => {const distance = this.distance(control, point); if (distance <= (control.descriptor.grabDistance || .105) && distance < best) {nearest = control; best = distance;}});
      hand.hover = nearest;
      if (grip && hand.armed && !hand.previousGrip && nearest) {this.consumedSources.add(hand.source); this.take(hand, nearest, point);}
      if (hand.control && grip) {this.consumedSources.add(hand.source); this.updateControl(hand, point);}
      // A second hand cannot steal a control or turn its blocked grip into a
      // cargo action. A new release/press is required after the owner lets go.
      if (grip && nearest && !hand.control) this.consumedSources.add(hand.source);
      this.ghost(hand, pose, !!hand.control); hand.previousGrip = grip;
    }
    this.neutralChannels.forEach(channel => {
      const handedness = channel === 'steer' ? 'left' : 'right', axis = ['steer', 'tilt', 'sideShift', 'turret'].includes(channel) ? 0 : 1;
      const isNeutral = Array.from(this.hands.values()).filter(hand => hand.source.handedness === handedness).every(hand => {
        const axes = hand.source.gamepad && hand.source.gamepad.axes || [], start = axes.length >= 4 ? 2 : 0;
        return !Number.isFinite(axes[start + axis]) || Math.abs(axes[start + axis]) <= .18;
      });
      if (isNeutral) this.neutralChannels.delete(channel);
    });
    this.syncLabels();
  }
  owns(source) {return this.consumedSources.has(source);}
  apply(input) {
    this.neutralChannels.forEach(channel => {input[channel] = 0;});
    this.controls.forEach(control => {if (control.owner) input[control.channel] = clamp(control.value * (control.descriptor.inputSign === undefined ? control.kind === 'lever' && control.channel === 'lift' ? -1 : 1 : control.descriptor.inputSign));});
  }
  reset() {
    this.hands.forEach(hand => {this.release(hand); hand.hover = null; hand.previousGrip = pressed(hand); if (hand.ghost) hand.ghost.visible = false;}); this.consumedSources.clear();
    this.syncLabels();
  }
  removeHand(hand) {
    this.release(hand); hand.controller.removeEventListener('squeezestart', hand.start); hand.controller.removeEventListener('squeezeend', hand.end);
    if (hand.ghost) {if (hand.ghost.parent) hand.ghost.parent.remove(hand.ghost); hand.ghost.geometry.dispose(); hand.ghost.material.dispose();}
    this.hands.delete(hand.controller);
  }
  clear() {Array.from(this.hands.values()).forEach(hand => this.removeHand(hand)); this.controls = []; this.consumedSources.clear(); this.releasedSources.clear(); this.neutralChannels.clear(); this.labels.clear();}
  dispose() {this.clear(); if (this.input && this.input.removeEventListener) this.input.removeEventListener('controllerInputCancelled', this.cancelled);}
}
