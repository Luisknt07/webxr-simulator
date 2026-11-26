import * as THREE from 'three';

const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const vectorOption = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const FINGERS = ['thumb', 'index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];
const PARTS = ['phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal'];

// Thumb opposition, five independent curls and finger spread. These are visual
// poses for controllers, never a replacement for measured XRHand joints.
export const HAND_GRAB_POSES = Object.freeze({
  generic:    {curl: [.55, .65, .70, .76, .80], opposition: .45, spread: .02},
  controller: {curl: [.44, .40, .78, .83, .87], opposition: .40, spread: .01},
  pinch:      {curl: [.60, .65, .24, .30, .36], opposition: .88, spread: .08},
  pingpong:   {curl: [.43, .28, .74, .80, .83], opposition: .60, spread: .04},
  bowling:    {curl: [.20, .26, .30, .33, .37], opposition: .12, spread: .22},
  drawer:     {curl: [.22, .78, .82, .86, .88], opposition: .18, spread: .01},
  joystick:   {curl: [.18, .67, .75, .81, .85], opposition: .25, spread: .02},
  plate:      {curl: [.35, .22, .27, .31, .35], opposition: .68, spread: .12},
  pole:       {curl: [.58, .80, .85, .89, .93], opposition: .58, spread: .01},
  relax:      {curl: [.10, .12, .18, .23, .29], opposition: .08, spread: .07},
  stick:      {curl: [.49, .73, .87, .91, .94], opposition: .66, spread: .01},
  flat:       {curl: [0, 0, 0, .01, .02], opposition: 0, spread: .13},
  tweak:      {curl: [.55, .59, .55, .72, .81], opposition: .90, spread: .07},
  knob:       {curl: [.48, .58, .66, .73, .80], opposition: .68, spread: .10},
  clip:       {curl: [.46, .42, .74, .82, .87], opposition: .86, spread: .02},
  point:      {curl: [.32, 0, .74, .82, .87], opposition: .36, spread: .02}
});

/** Bounded, object-local contact envelope. Bounds are collected on acquisition,
 * not with a scene traversal or triangle raycast on every XR frame. */
export class HandContactShape {
  constructor(object, options = {}) {
    options = Object.assign({}, object.userData.handGrab, options);
    this.object = object; this.box = new THREE.Box3();
    this.inverse = new THREE.Matrix4(); this.toShape = new THREE.Matrix4();
    this.point = new THREE.Vector3(); this.center = new THREE.Vector3(); this.size = new THREE.Vector3();
    object.updateWorldMatrix(true, true); this.inverse.getInverse(object.matrixWorld);
    const matrix = new THREE.Matrix4(), box = new THREE.Box3();
    object.traverse(node => {
      if (!node.geometry || node.userData.xrInputVisual || node.userData.editorRuntimeHelper) return;
      if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
      if (!node.geometry.boundingBox) return;
      matrix.multiplyMatrices(this.inverse, node.matrixWorld);
      this.box.union(box.copy(node.geometry.boundingBox).applyMatrix4(matrix));
    });
    if (this.box.isEmpty()) this.box.set(new THREE.Vector3(-.025, -.025, -.025), new THREE.Vector3(.025, .025, .025));
    this.box.getCenter(this.center); this.box.getSize(this.size);
    this.kind = ['sphere', 'torus', 'box'].includes(options.shape) ? options.shape : (/Sphere/.test(object.geometry && object.geometry.type || '') ? 'sphere' : 'box');
    this.radius = Number.isFinite(options.radius) && options.radius > 0 ? options.radius : Math.max(this.size.x, this.size.y, this.size.z) / 2;
    this.tube = Number.isFinite(options.tube) ? clamp(options.tube, .006, .06) : .014;
    this.axis = new THREE.Vector3().fromArray(vectorOption(options.axis) ? options.axis : [0, 0, 1]).normalize();
    if(this.axis.lengthSq()<.5)this.axis.copy(Z);
    if (vectorOption(options.center)) this.center.fromArray(options.center);
    this.half = this.size.clone().multiplyScalar(.5);
    const dimensions = this.size.toArray().sort((a, b) => a - b);
    this.profile = Object.prototype.hasOwnProperty.call(HAND_GRAB_POSES, options.profile) ? options.profile :
      this.kind === 'torus' ? 'pole' : this.kind === 'sphere' ? (this.radius > .065 ? 'bowling' : 'knob') :
      dimensions[2] < .035 ? 'pinch' : dimensions[0] < .018 && dimensions[1] > .065 ? 'plate' :
      dimensions[2] > dimensions[1] * 2.8 ? 'stick' : 'generic';
  }
  update(root) {
    this.object.updateWorldMatrix(true, false); root.updateWorldMatrix(true, false);
    this.inverse.getInverse(this.object.matrixWorld); this.toShape.multiplyMatrices(this.inverse, root.matrixWorld);
    // Conservative skin clearance with a nonuniformly scaled ancestor.
    const e = this.toShape.elements;
    this.clearance = .006 * Math.max(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10]));
  }
  distance(point) {
    const p = this.point.copy(point).applyMatrix4(this.toShape).sub(this.center);
    if (this.kind === 'sphere') return p.length() - this.radius - this.clearance;
    if (this.kind === 'torus') {
      const axial = p.dot(this.axis), radial = Math.sqrt(Math.max(0, p.lengthSq() - axial * axial));
      return Math.hypot(radial - this.radius, axial) - this.tube - this.clearance;
    }
    const x = Math.abs(p.x) - this.half.x, y = Math.abs(p.y) - this.half.y, z = Math.abs(p.z) - this.half.z;
    return Math.hypot(Math.max(0, x), Math.max(0, y), Math.max(0, z)) + Math.min(Math.max(x, y, z), 0) - this.clearance;
  }
}

/** Controller animation uses the skin's own local joint frames. Contact stops
 * each finger separately along its closing arc, before it enters the object.
 * All temporary transforms are reused; no scene nodes or meshes are allocated. */
export default class XRHandPose {
  constructor(hand) {
    this.hand = hand; this.rotation = new THREE.Quaternion(); this.target = new THREE.Quaternion();
    this.matrix = new THREE.Matrix4(); this.parentMatrix = new THREE.Matrix4();
    this.point = new THREE.Vector3(); this.previous = new THREE.Vector3(); this.sample = new THREE.Vector3();
    this.chains = FINGERS.map(finger => (finger === 'thumb' ? ['metacarpal', 'phalanx-proximal', 'phalanx-distal', 'tip'] : PARTS.concat('tip')).map(part => hand.bones.get(finger + '-' + part)));
    this.ancestors = this.chains.map(chain => {const nodes=[];for(let node=chain[0].parent;node&&node!==hand.root;node=node.parent)nodes.unshift(node);return nodes;});
    this.curls = [0, 0, 0, 0, 0]; this.limits = [1, 1, 1, 1, 1]; this.solveTime = 0;
    this.profile = 'relax'; this.initialized = false;
  }
  reset() {this.initialized = false; this.shape = null; this.interaction = null; this.solveTime = 0;}
  quaternion(bone, finger, segment, curl, pose, target) {
    target.copy(this.hand.rest.get(bone.name).quaternion);
    const side = this.hand.side === 'left' ? -1 : 1;
    if (finger === 0 && segment === 0) {
      target.multiply(this.rotation.setFromAxisAngle(X, -pose.opposition * .55));
      target.multiply(this.rotation.setFromAxisAngle(Y, side * pose.opposition * .14));
      target.multiply(this.rotation.setFromAxisAngle(Z, -side * pose.opposition * .14));
    } else {
      const angle = finger === 0 ? curl * (segment === 1 ? .68 : .90) : curl * [1.12, 1.48, 1.05][segment];
      target.multiply(this.rotation.setFromAxisAngle(X, -angle));
      if (finger > 0 && segment === 0) target.multiply(this.rotation.setFromAxisAngle(Y, -side * (finger - 2.1) * pose.spread));
    }
    return target;
  }
  collides(finger, curl, pose) {
    const chain = this.chains[finger];
    // Forward kinematics in hand-root coordinates, without updating the scene.
    this.parentMatrix.identity();
    for (const node of this.ancestors[finger]) {node.updateMatrix(); this.parentMatrix.multiply(node.matrix);}
    for (let segment = 0; segment < chain.length; segment++) {
      const bone = chain[segment], rest = this.hand.rest.get(bone.name);
      if (segment < chain.length - 1) this.quaternion(bone, finger, segment, curl, pose, this.target);
      else this.target.copy(rest.quaternion);
      this.matrix.compose(rest.position, this.target, rest.scale); this.parentMatrix.multiply(this.matrix);
      this.point.setFromMatrixPosition(this.parentMatrix);
      if (segment) for (let t = 0; t <= 1; t += .25) {
        this.sample.copy(this.previous).lerp(this.point, t);
        if (this.shape.distance(this.sample) < 0) return true;
      }
      this.previous.copy(this.point);
    }
    return false;
  }
  update(trigger, grip, input = {}, interaction, delta = 1 / 72) {
    const dt = Number.isFinite(delta) ? clamp(delta, 0, .05) : 1 / 72;
    const targetObject = interaction && interaction.object;
    if (targetObject !== this.interaction || interaction && interaction.profile !== this.requestedProfile) {
      this.interaction = targetObject; this.requestedProfile = interaction && interaction.profile;
      this.shape = targetObject && targetObject.isObject3D ? new HandContactShape(targetObject, interaction) : null;
      this.solveTime = 1;
    }
    const held = interaction && interaction.held;
    this.profile = input.pointing ? 'point' : this.shape ? this.shape.profile : grip > .03 ? 'controller' : 'relax';
    const pose = HAND_GRAB_POSES[this.profile], amount = this.shape && this.profile !== 'point' ? (held ? 1 : .25 + Math.max(trigger, grip) * .5) : 1;
    for (let finger = 0; finger < 5; finger++) {
      let value = this.shape || input.pointing ? pose.curl[finger] * amount :
        finger === 0 ? .10 + (input.thumbTouched ? .40 : .22) * grip : finger === 1 ? .12 + .78 * trigger : .12 + finger * .035 + grip * .70;
      this.curls[finger] = clamp(value);
    }
    this.solveTime += dt;
    if (this.shape && held && this.solveTime >= 1 / 30) {
      this.solveTime = 0; this.shape.update(this.hand.root);
      for (let finger = 0; finger < 5; finger++) {
        const desired = this.curls[finger]; let safe = 0, blocked = 0;
        // If the wrist approaches through a surface, opening is preferable to
        // forcing an already penetrating finger deeper into that surface.
        if (this.collides(finger, 0, pose)) {this.limits[finger] = 0; continue;}
        for (let step = 1; step <= 8; step++) {
          const value = desired * step / 8;
          if (this.collides(finger, value, pose)) {blocked = value; break;}
          safe = value;
        }
        if (blocked) for (let step = 0; step < 5; step++) {const value = (safe + blocked) / 2; if (this.collides(finger, value, pose)) blocked = value; else safe = value;}
        this.limits[finger] = safe;
      }
    } else if (!this.shape || !held) this.limits.fill(1);
    const blend = this.initialized ? 1 - Math.exp(-dt / .055) : 1;
    for(let finger=0;finger<this.chains.length;finger++)for(let segment=0;segment<this.chains[finger].length-1;segment++){
      const bone=this.chains[finger][segment];
      this.quaternion(bone, finger, segment, Math.min(this.curls[finger], this.limits[finger]), pose, this.target);
      bone.quaternion.slerp(this.target, blend);
    }
    this.initialized = true;
    this.hand.root.userData.handGrabPose = this.profile;
  }
}
