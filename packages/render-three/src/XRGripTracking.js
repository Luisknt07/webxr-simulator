import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const FINGERS = ['thumb', 'index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];
const JOINTS = ['wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'];
FINGERS.slice(1).forEach(finger => ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'].forEach(part => JOINTS.push(finger + '-' + part)));
const inputHelper = object => {
  Object.assign(object.userData, {editorRuntimeHelper: true, editorNonCollidable: true, xrInputVisual: true});
  object.frustumCulled = false; object.raycast = () => {}; return object;
};

// These glove fingers animate controller buttons; they are not measured finger
// tracking. Real XRHand input uses a separate, strictly measured joint path.
class XRInputVisual {
  constructor(grip) {
    this.grip = grip; this.root = inputHelper(new THREE.Group()); this.root.name = 'XR input visual'; this.root.visible = false; grip.add(this.root);
    this.geometry = new Set(); this.materials = new Set(); this.links = []; this.joints = new Map(); this.fingers = []; this.batches = [];
    this.sphere = this.geometryOf(new THREE.SphereBufferGeometry(1, 8, 6));
    this.cylinder = this.geometryOf(new THREE.CylinderBufferGeometry(1, 1, 1, 6));
    this.dark = this.material(0x263c45); this.shell = this.material(0xe6eff0); this.glove = this.material(0x9dbdb9); this.accent = this.material(0x37d6bd); this.jointMaterial = this.material(0xc3eeea);
    this.controller = inputHelper(new THREE.Group()); this.controller.name = 'Motion controller · local fallback'; this.root.add(this.controller);
    this.mesh(this.controller, this.cylinder, this.dark, [0, -.021, .006], [.019, .105, .021]).rotation.x = -.24;
    this.mesh(this.controller, this.sphere, this.shell, [0, .037, -.018], [.033, .022, .046]);
    this.mesh(this.controller, this.cylinder, this.dark, [-.011, .058, -.025], [.009, .008, .009]);
    this.mesh(this.controller, this.sphere, this.accent, [.014, .056, -.012], [.005, .004, .005]);
    this.trigger = this.mesh(this.controller, this.sphere, this.dark, [0, .024, -.050], [.014, .018, .008]);
    this.hand = inputHelper(new THREE.Group()); this.hand.name = 'Animated controller glove'; this.root.add(this.hand);
    this.mesh(this.hand, this.sphere, this.glove, [0, -.007, .031], [.036, .041, .021]);
    this.mesh(this.hand, this.cylinder, this.dark, [0, -.051, .027], [.024, .022, .021]);
    [0, 1, 2, 3].forEach(index => {
      const joints = [], base = inputHelper(new THREE.Group()); base.position.set((index - 1.5) * .018, .024, .020); this.hand.add(base);
      let parent = base; const length = index === 3 ? .019 : .023;
      for (let segment = 0; segment < 3; segment++) {
        const pivot = inputHelper(new THREE.Group()); parent.add(pivot); joints.push(pivot);
        this.mesh(pivot, this.sphere, this.jointMaterial, [0, 0, 0], [.007, .007, .007]);
        const bone = this.mesh(pivot, this.cylinder, this.glove, [0, 0, -length / 2], [.006, length, .006]); bone.rotation.x = Math.PI / 2;
        parent = inputHelper(new THREE.Group()); parent.position.z = -length; pivot.add(parent);
      }
      this.fingers.push(joints);
    });
    this.thumb = inputHelper(new THREE.Group()); this.hand.add(this.thumb);
    this.mesh(this.thumb, this.sphere, this.glove, [0, 0, -.016], [.012, .012, .026]);
    this.tracked = inputHelper(new THREE.Group()); this.tracked.name = 'Tracked XRHand · measured joints'; this.tracked.visible = false;
    JOINTS.forEach(name => {const mesh = this.mesh(this.tracked, this.sphere, this.jointMaterial, [0, 0, 0], [.007, .007, .007]); mesh.name = name; this.joints.set(name, mesh);});
    FINGERS.forEach(finger => {
      const names = JOINTS.filter(name => name.startsWith(finger + '-')); let previous = 'wrist';
      names.forEach(name => {const mesh = this.mesh(this.tracked, this.cylinder, this.glove, [0, 0, 0], [.005, 1, .005]); this.links.push({mesh, from: previous, to: name}); previous = name;});
    });
    this.direction = new THREE.Vector3(); this.matrix = new THREE.Matrix4(); this.inverse = new THREE.Matrix4(); this.hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
    this.buildBatches(this.root); this.buildBatches(this.tracked);
  }
  geometryOf(value) {this.geometry.add(value); return value;}
  material(color) {const material = new THREE.MeshLambertMaterial({color}); this.materials.add(material); return material;}
  mesh(parent, geometry, material, position, scale) {
    const mesh = inputHelper(new THREE.Object3D()); mesh.geometry = geometry; mesh.material = material;
    mesh.position.fromArray(position); mesh.scale.fromArray(scale); parent.add(mesh); return mesh;
  }
  buildBatches(root) {
    const groups = new Map(); root.traverse(node => {if (node.geometry && node.material) {const key = node.geometry.uuid + ':' + node.material.uuid; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(node);}});
    groups.forEach(sources => {const first = sources[0], mesh = inputHelper(new THREE.InstancedMesh(first.geometry, first.material, sources.length)); root.add(mesh); this.batches.push({root, mesh, sources});});
  }
  syncBatches(root) {
    root.updateWorldMatrix(true, true); this.inverse.getInverse(root.matrixWorld);
    this.batches.filter(batch => batch.root === root).forEach(batch => {
      batch.sources.forEach((source, index) => {batch.mesh.setMatrixAt(index, source.visible ? this.matrix.multiplyMatrices(this.inverse, source.matrixWorld) : this.hiddenMatrix);});
      batch.mesh.instanceMatrix.needsUpdate = true;
    });
  }
  update(source, frame, reference, controller) {
    const active = Boolean(source && controller.visible !== false), tracked = active && source.hand;
    this.root.visible = active && !tracked; this.tracked.visible = false;
    if (!active) return;
    if (tracked) {
      if (!reference || !frame || typeof frame.getJointPose !== 'function' || !this.grip.parent) return;
      if (this.tracked.parent !== this.grip.parent) this.grip.parent.add(this.tracked);
      let count = 0;
      this.joints.forEach((mesh, name) => {
        const joint = source.hand.get ? source.hand.get(name) : source.hand[name]; let pose;
        try {pose = joint && frame.getJointPose(joint, reference);} catch (_) {pose = null;}
        mesh.visible = Boolean(pose && pose.transform && pose.transform.matrix);
        if (mesh.visible) {mesh.position.setFromMatrixPosition(this.matrix.fromArray(pose.transform.matrix)); mesh.scale.setScalar(Math.min(.012, Math.max(.004, pose.radius || .007))); count++;}
      });
      this.links.forEach(link => {
        const from = this.joints.get(link.from), to = this.joints.get(link.to); link.mesh.visible = from.visible && to.visible;
        if (!link.mesh.visible) return;
        this.direction.subVectors(to.position, from.position); const length = this.direction.length();
        link.mesh.position.copy(from.position).add(to.position).multiplyScalar(.5); link.mesh.scale.set(.005, length, .005);
        if (length > 1e-6) link.mesh.quaternion.setFromUnitVectors(UP, this.direction.divideScalar(length));
      });
      this.tracked.visible = count > 0; this.syncBatches(this.tracked); controller.userData.xrHandVisualMode = 'tracked'; return;
    }
    const buttons = source.gamepad && source.gamepad.buttons || [], pressed = index => Math.max(0, Math.min(1, Number(buttons[index] && (buttons[index].value || buttons[index].pressed)) || 0));
    const trigger = pressed(0), grip = Math.max(pressed(1), controller.userData.vehicleCabGrip && controller.userData.vehicleCabGrip.held ? 1 : 0);
    const side = source.handedness === 'left' ? -1 : 1;
    this.controller.scale.x = side; this.thumb.position.set(side * .031, -.01, .027); this.thumb.rotation.set(.65 + grip * .5, -side * .65, -side * .5);
    this.fingers.forEach((joints, finger) => joints.forEach((joint, index) => {joint.rotation.x = .15 + (finger === 0 ? trigger : .36 + grip * .64) * (index === 0 ? 1.1 : 1.35);}));
    this.trigger.rotation.x = -trigger * .25; this.syncBatches(this.root); controller.userData.xrHandVisualMode = 'controller-animated';
  }
  dispose() {if (this.root.parent) this.root.parent.remove(this.root); if (this.tracked.parent) this.tracked.parent.remove(this.tracked); this.geometry.forEach(value => value.dispose()); this.materials.forEach(value => value.dispose());}
}

/** r112 exposes targetRaySpace only. Reuse one additional Group per controller
 * for the native gripSpace pose; newer Three versions can provide it directly. */
export function createXRGrip(renderer, controller, index) {
  const managed = typeof renderer.xr.getControllerGrip === 'function';
  const grip = managed ? renderer.xr.getControllerGrip(index) : new THREE.Group();
  if (!managed) {grip.matrixAutoUpdate = false; grip.visible = false;}
  grip.name = 'XR grip · ' + index; grip.userData.xrManagedGrip = managed; grip.userData.editorRuntimeHelper = true;
  if (!grip.xrInputVisual) grip.xrInputVisual = new XRInputVisual(grip);
  controller.userData.gripObject = grip; return grip;
}
export function updateXRGrip(renderer, controller, source, frame) {
  const grip = controller.userData.gripObject; if (!grip) return;
  const visual = grip.xrInputVisual;
  const reference = renderer.xr.getReferenceSpace && renderer.xr.getReferenceSpace();
  if (!source) {grip.visible = false; if (visual) visual.update(null, frame, reference, controller); return;}
  if (grip.userData.xrManagedGrip) {if (visual) visual.update(source, frame, reference, controller); return;}
  let pose = null;
  if (source.gripSpace && reference && frame && frame.getPose) {
    try {pose = frame.getPose(source.gripSpace, reference);} catch (_) { /* Lost/ended XR frame. */ }
  }
  grip.visible = Boolean(pose && pose.transform && pose.transform.matrix);
  if (grip.visible) {grip.matrix.fromArray(pose.transform.matrix); grip.matrix.decompose(grip.position, grip.quaternion, grip.scale); grip.updateMatrixWorld(true);}
  if (visual) {visual.update(source, frame, reference, controller); visual.root.visible = visual.root.visible && grip.visible;}
}

export function disposeXRGrip(controller) {
  const grip = controller.userData.gripObject, visual = grip && grip.xrInputVisual;
  if (visual) {visual.dispose(); delete grip.xrInputVisual;}
  delete controller.userData.xrHandVisualMode;
}
