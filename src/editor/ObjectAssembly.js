import * as THREE from 'three';
import ObjectPlacement from '../lib/ObjectPlacement.js';

const EPSILON = 1e-7;
const FREE_COLOR = 0xffd54a;
const CONTACT_COLOR = 0x86e7cf;
const NO_RAYCAST = () => {};
const Z = new THREE.Vector3(0, 0, 1);

function visible(object) {
  for (let node = object; node; node = node.parent) if (node.visible === false) return false;
  return true;
}

/** Surface alignment for loose objects. It never reparents objects or changes behaviors. */
export default class ObjectAssembly {
  constructor(editor) {
    this.editor = editor;
    this.placement = new ObjectPlacement(editor.collisionWorld);
    this.enabled = true;
    this.snapDistance = 0.18;
    this.previewDistance = 0.7;
    this.releaseDistance = 0.4;
    this.drag = null;
    this.candidate = null;
    this.helperGroup = null;
  }

  supported(object) {
    if (!object || !object.isObject3D || !visible(object)) return false;
    const document = this.editor.document;
    if (document.getEditableObject && document.getEditableObject(object) !== object) return false;
    const data = object.userData || {};
    if (data.editorHelper || data.editorRuntimeHelper) return false;
    const behaviors = document.getBehaviors(object);
    if (behaviors.some(config => ['conveyor', 'sensor', 'control', 'portal', 'float', 'painting', 'graffiti', 'note',
      'billboard', 'info', 'decal', 'sound', 'animation', 'news', 'teleport', 'motion'].includes(config.type))) return false;
    if (behaviors.some(config => config.type === 'collision' && (config.enabled === false || config.mode === 'trigger'))) return false;
    const product = behaviors.find(config => config.type === 'product');
    if (product) return product.enabled !== false;
    if (data.editorPrefabKey) return data.editorPrefabKey === 'product';
    // Original room architecture, portals and information panels retain their
    // native interactions; user-created primitives and imported models can snap.
    if (document.isNative && document.isNative(object)) return false;
    const descriptor = data.editorDescriptor || document.getVisualDescriptor && document.getVisualDescriptor(object);
    return Boolean(descriptor && !descriptor.nativeId && descriptor.type !== 'decal');
  }

  localBounds(object) {
    object.updateWorldMatrix(true, true);
    if (!Number.isFinite(object.matrixWorld.determinant()) || Math.abs(object.matrixWorld.determinant()) < EPSILON) return null;
    const inverse = new THREE.Matrix4().getInverse(object.matrixWorld), result = new THREE.Box3();
    object.traverse(mesh => {
      if (!mesh.isMesh || !mesh.geometry || !visible(mesh) || mesh.userData.editorGeometryReplaced) return;
      for (let node = mesh; node; node = node.parent) {
        const data = node.userData || {};
        if (data.editorHelper || data.editorRuntimeHelper || data.industrialSensorVolume) return;
        if (node === object) break;
      }
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (materials.every(material => !material || material.visible === false || material.opacity === 0)) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      if (!mesh.geometry.boundingBox || mesh.geometry.boundingBox.isEmpty()) return;
      const matrix = new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
      result.union(mesh.geometry.boundingBox.clone().applyMatrix4(matrix));
    });
    return result.isEmpty() || !Number.isFinite(result.min.lengthSq() + result.max.lengthSq()) ? null : result;
  }

  find(object, extra = {}) {
    const bounds = this.drag && this.drag.object === object ? this.drag.bounds : this.localBounds(object);
    if (!bounds) return null;
    object.updateWorldMatrix(true, true);
    return this.placement.find(object, Object.assign({
      root: this.editor.root, bounds, matrix: object.matrixWorld.clone(), ignore: [object],
      surfaceDistance: this.snapDistance, sideDistance: this.snapDistance,
      previewDistance: this.previewDistance, allowSides: true
    }, extra));
  }

  begin(object) {
    this.drag = this.enabled && this.supported(object) ? {object, bounds: this.localBounds(object), latch: null} : null;
    if (this.drag) this.rememberSafePose(object);
    this.refresh(object);
  }

  rememberSafePose(object) {
    const drag = this.drag, world = this.editor.collisionWorld;
    if (!drag || !drag.bounds || !world || typeof world.testBox !== 'function') return;
    object.updateWorldMatrix(true, true);
    const matrix = object.matrixWorld.clone(), box = drag.bounds.clone().applyMatrix4(matrix);
    if (matrix.elements.every(Number.isFinite) && !world.testBox(box, {ignore: [object]})) {
      drag.safeMatrix = matrix; drag.safeBox = box;
    }
  }

  constrain(object) {
    const drag = this.drag, world = this.editor.collisionWorld;
    if (!drag || !drag.bounds || !world || typeof world.sweepBox !== 'function' || typeof world.testBox !== 'function') return false;
    object.updateWorldMatrix(true, true);
    const raw = object.matrixWorld.clone();
    if (!raw.elements.every(Number.isFinite)) return false;
    // Existing authored overlaps must remain escapable. Begin constraining only
    // after the user has reached the first unobstructed pose.
    if (!drag.safeMatrix) { this.rememberSafePose(object); return false; }
    if (raw.elements.slice(0, 12).some((value, index) => Math.abs(value - drag.safeMatrix.elements[index]) > EPSILON)) {
      drag.safeMatrix = drag.safeBox = null; this.rememberSafePose(object); return false;
    }
    const movement = new THREE.Vector3().setFromMatrixPosition(raw).sub(new THREE.Vector3().setFromMatrixPosition(drag.safeMatrix));
    if (movement.lengthSq() < EPSILON * EPSILON) return false;
    const options = {ignore: [object]}, sweep = world.sweepBox(drag.safeBox, movement, options);
    if (!sweep || !sweep.movement || !Number.isFinite(sweep.movement.lengthSq())) return false;
    const accepted = sweep.movement.clone(), currentBox = drag.safeBox.clone().translate(accepted);
    if (sweep.blocked) {
      // A bounded set of axis sweeps lets the box slide along a solid surface
      // instead of freezing when the pointer keeps pushing slightly into it.
      const remainder = movement.clone().sub(accepted);
      ['x', 'y', 'z'].sort((a, b) => Math.abs(remainder[b]) - Math.abs(remainder[a])).forEach(axis => {
        if (Math.abs(remainder[axis]) < EPSILON) return;
        const step = new THREE.Vector3(); step[axis] = remainder[axis];
        const slide = world.sweepBox(currentBox, step, options);
        if (!slide || !slide.movement || !Number.isFinite(slide.movement.lengthSq())) return;
        accepted.add(slide.movement); currentBox.translate(slide.movement);
      });
    }
    if (world.testBox(currentBox, options)) accepted.set(0, 0, 0);
    if (accepted.distanceToSquared(movement) < EPSILON * EPSILON) return false;
    const matrix = drag.safeMatrix.clone(); matrix.elements[12] += accepted.x; matrix.elements[13] += accepted.y; matrix.elements[14] += accepted.z;
    return this.apply(object, matrix);
  }

  apply(object, matrix) {
    const worldPosition = new THREE.Vector3().setFromMatrixPosition(matrix);
    const position = object.parent ? object.parent.worldToLocal(worldPosition) : worldPosition;
    if (!Number.isFinite(position.lengthSq()) || position.distanceToSquared(object.position) < EPSILON * EPSILON) return false;
    // Only translation changes. In particular, grabbing a prefab child beneath
    // a rotated, scaled machine must never tilt or resize the box.
    this.editor.document.setTransform(object, {position: position.toArray()});
    object.updateWorldMatrix(true, true);
    if (this.editor.collisionWorld && this.editor.collisionWorld.invalidate) this.editor.collisionWorld.invalidate(object);
    return true;
  }

  update(object) {
    if (!this.enabled || !this.supported(object)) { this.clear(); return false; }
    if (!this.drag || this.drag.object !== object) this.begin(object);
    const drag = this.drag;
    if (!drag || !drag.bounds) return false;
    let changed = this.constrain(object);
    // TransformControls supplies an unsnapped pose on every pointer move.
    // Measure that pose against the latched surface with a wider release range,
    // allowing movement along a table while a deliberate pull lifts it free.
    let candidate = drag.latch && this.find(object, {
      targets: [drag.latch.target], surfaceDistance: this.releaseDistance,
      sideDistance: this.releaseDistance, previewDistance: this.releaseDistance
    });
    if (candidate && (candidate.kind !== drag.latch.kind || candidate.normal.dot(drag.latch.normal) < 0.98)) candidate = null;
    if (!candidate) { drag.latch = null; candidate = this.find(object); }
    if (candidate && candidate.snapped) {
      changed = this.apply(object, candidate.matrix) || changed;
      drag.latch = candidate;
    } else drag.latch = null;
    this.candidate = candidate;
    this.rememberSafePose(object);
    this.draw(candidate, Boolean(drag.latch));
    return changed;
  }

  end() {
    const object = this.drag && this.drag.object;
    this.drag = null;
    this.refresh(object || this.editor.selected);
  }

  refresh(object) {
    if (!this.enabled || !this.supported(object)) { this.clear(); return; }
    this.candidate = this.find(object);
    this.draw(this.candidate, Boolean(this.candidate && this.candidate.distance < 0.015));
  }

  message(text) { if (this.editor.assemblyMessage) this.editor.assemblyMessage(text || ''); }

  ensureHelpers() {
    if (this.helperGroup) return true;
    const scene = this.editor.hooks && this.editor.hooks.renderScene || this.editor.ctx && this.editor.ctx.scene;
    if (!scene) return false;
    const group = this.helperGroup = new THREE.Group(); group.name = 'Ensamble de objetos';
    group.matrixAutoUpdate = false;
    this.faceGeometry = new THREE.PlaneBufferGeometry(1, 1);
    this.faceMaterial = new THREE.MeshBasicMaterial({color: FREE_COLOR, side: THREE.DoubleSide,
      transparent: true, opacity: 0.22, depthTest: false, depthWrite: false});
    this.face = new THREE.Mesh(this.faceGeometry, this.faceMaterial);
    this.frame = new THREE.Box3Helper(new THREE.Box3(), FREE_COLOR);
    this.frame.material.depthTest = false; this.frame.material.depthWrite = false;
    this.frame.material.transparent = true; this.frame.material.opacity = 0.9;
    this.contactGeometry = new THREE.RingBufferGeometry(0.045, 0.065, 20);
    this.contactMaterial = new THREE.MeshBasicMaterial({color: FREE_COLOR, side: THREE.DoubleSide,
      transparent: true, opacity: 0.95, depthTest: false, depthWrite: false});
    this.contact = new THREE.Mesh(this.contactGeometry, this.contactMaterial);
    group.add(this.face, this.frame, this.contact);
    group.traverse(node => {
      Object.assign(node.userData, {editorHelper: true, editorRuntimeHelper: true});
      node.raycast = NO_RAYCAST; node.renderOrder = 50;
    });
    scene.add(group);
    return true;
  }

  draw(candidate, connected) {
    if (!candidate) {
      if (this.helperGroup) this.helperGroup.visible = false;
      this.message('Ensamble de objetos · Acerca la caja a una superficie o a otra caja.');
      return;
    }
    if (!this.ensureHelpers()) return;
    const group = this.helperGroup, parent = group.parent;
    parent.updateWorldMatrix(true, false);
    group.matrix.copy(new THREE.Matrix4().getInverse(parent.matrixWorld)); group.visible = true;
    const color = connected ? CONTACT_COLOR : FREE_COLOR;
    this.faceMaterial.color.setHex(color); this.contactMaterial.color.setHex(color); this.frame.material.color.setHex(color);
    const bounds = candidate.worldBounds || candidate.bounds;
    if (!bounds || bounds.isEmpty()) { group.visible = false; return; }
    this.frame.box.copy(bounds);
    const normal = candidate.normal.clone().normalize();
    const point = candidate.point.clone().addScaledVector(normal, 0.004);
    const size = bounds.getSize(new THREE.Vector3());
    const horizontal = Math.abs(normal.y) > 0.8;
    this.face.position.copy(point); this.face.quaternion.setFromUnitVectors(Z, normal);
    const width = horizontal ? size.x : Math.abs(normal.x) > Math.abs(normal.z) ? size.z : size.x;
    const height = horizontal ? size.z : size.y;
    this.face.scale.set(Math.max(0.08, width), Math.max(0.08, height), 1);
    this.contact.position.copy(point).addScaledVector(normal, 0.002);
    this.contact.quaternion.copy(this.face.quaternion);
    group.updateMatrixWorld(true);
    this.message(connected ? 'Objeto colocado · Arrastra para despegarlo o deslizarlo.' :
      'Superficie compatible en amarillo · Acerca el objeto para colocarlo.');
  }

  clear() {
    this.drag = null; this.candidate = null;
    if (this.helperGroup && this.helperGroup.parent) this.helperGroup.parent.remove(this.helperGroup);
    [this.faceGeometry, this.contactGeometry, this.frame && this.frame.geometry,
      this.faceMaterial, this.contactMaterial, this.frame && this.frame.material].forEach(resource => { if (resource) resource.dispose(); });
    this.helperGroup = this.faceGeometry = this.faceMaterial = this.face = this.frame = null;
    this.contactGeometry = this.contactMaterial = this.contact = null;
    this.message('');
  }

  reset() { this.clear(); }
}
