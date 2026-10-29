import * as THREE from 'three';

const HELD_COLOR = '#50d9ff';
const RELEASE_COLOR = '#42e4a4';
const PLACEMENT_COLOR = '#ffd34a';
const RELEASE_SECONDS = 0.18;
const MAX_BINDINGS = 16;
const OUTLINE_MARGIN = 0.006;
const NO_RAYCAST = () => {};

function helperFlags(object) {
  Object.defineProperties(object.userData, {
    editorRuntimeHelper: {value: true, configurable: true},
    editorHelper: {value: true, configurable: true},
    editorNonCollidable: {value: true, configurable: true}
  });
  object.raycast = NO_RAYCAST;
  return object;
}

function within(object, parent) {
  for (let node = object; node; node = node.parent) if (node === parent) return true;
  return false;
}

function visible(object) {
  for (let node = object; node; node = node.parent) if (!node.visible) return false;
  return true;
}

/** Private, disposable outlines. Authored product poses/materials stay intact. */
export default class ProductFeedback {
  constructor(ctx) {
    this.ctx = ctx || {};
    this.bindings = new Map();
    this.scratch = new THREE.Box3();
    this.disposed = false;
    this.root = helperFlags(new THREE.Group());
    this.root.name = 'Feedback de productos';
    this.root.matrixAutoUpdate = false;
    const scene = this.ctx.scene;
    if (scene && scene.add) scene.add(this.root);
  }

  hold(object) {
    const scene = this.ctx.scene;
    if (this.disposed || !scene || !object || !object.isObject3D || object === scene || !within(object, scene)) return false;
    let entry = this.bindings.get(object);
    if (!entry) {
      if (this.bindings.size >= MAX_BINDINGS) {
        const flash = Array.from(this.bindings.values()).find(value => !value.held);
        if (!flash) return false;
        this.remove(flash.object);
      }
      const bounds = new THREE.Box3(), helper = helperFlags(new THREE.Box3Helper(bounds, HELD_COLOR));
      helper.name = 'Caja sostenida';
      helper.material.transparent = true;
      helper.material.opacity = 0.95;
      helper.material.depthWrite = false;
      helper.material.depthTest = true;
      helper.material.toneMapped = false;
      helper.renderOrder = 20;
      entry = {object, helper, bounds, held: true, remaining: 0};
      this.bindings.set(object, entry);
      this.root.add(helper);
    }
    entry.held = true; entry.remaining = 0;
    entry.helper.material.color.set(HELD_COLOR); entry.helper.material.opacity = 0.95;
    this.update(0);
    return true;
  }

  release(object) {
    const entry = this.bindings.get(object);
    if (!entry || !entry.held) return false;
    this.placement(object, null);
    entry.held = false; entry.remaining = RELEASE_SECONDS;
    entry.helper.material.color.set(RELEASE_COLOR); entry.helper.material.opacity = 0.95;
    this.update(0);
    return true;
  }

  placement(object, candidate) {
    const entry = this.bindings.get(object);
    if (this.disposed || !entry || !entry.held) return false;
    entry.placement = candidate || null;
    if (!candidate) {
      if (entry.destination) entry.destination.visible = false;
      if (entry.surface) entry.surface.visible = false;
      return true;
    }
    if (!candidate.bounds || candidate.bounds.isEmpty()) return this.placement(object, null);
    if (!entry.destination) {
      entry.destinationBounds = new THREE.Box3(); entry.surfaceBounds = new THREE.Box3();
      ['destination', 'surface'].forEach(key => {
        const helper = helperFlags(new THREE.Box3Helper(entry[key + 'Bounds'], PLACEMENT_COLOR));
        helper.name = key === 'destination' ? 'Posición de depósito' : 'Superficie compatible';
        helper.material.transparent = true; helper.material.opacity = 0.8;
        helper.material.depthWrite = false; helper.material.depthTest = true;
        helper.material.toneMapped = false; helper.renderOrder = 21;
        entry[key] = helper; this.root.add(helper);
      });
    }
    entry.destinationBounds.copy(candidate.bounds).expandByScalar(0.004);
    entry.surfaceBounds.copy(candidate.bounds);
    entry.surfaceBounds.max.y = entry.surfaceBounds.min.y + 0.004;
    entry.surfaceBounds.min.y -= 0.004;
    entry.surfaceBounds.expandByScalar(0.025);
    entry.destination.material.color.set(candidate.snapped ? RELEASE_COLOR : PLACEMENT_COLOR);
    entry.destination.material.opacity = candidate.snapped ? 0.95 : 0.65;
    const scene = this.ctx.scene;
    const shown = this.runtimeVisible() && visible(object) && (!candidate.target || within(candidate.target, scene) && visible(candidate.target));
    entry.destination.visible = shown; entry.surface.visible = shown;
    return true;
  }

  runtimeVisible() {
    const editor = this.ctx.editor;
    if (editor && editor.active && !this.ctx.vrMode) return false;
    return !(editor && editor.simulation && editor.simulation.running === false);
  }

  measure(entry) {
    const object = entry.object;
    object.updateWorldMatrix(true, true);
    entry.bounds.makeEmpty();
    const visit = node => {
      const data = node.userData || {};
      // Spawned products are runtime-owned meshes and physical collision bodies.
      // They remain valid explicit roots; unrelated helper descendants do not.
      const productRoot = node === object && data.editorCollisionBody === true;
      if (!node.visible || !productRoot && (data.editorHelper || data.editorRuntimeHelper)) return;
      const geometry = !data.editorGeometryReplaced && node.geometry;
      const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
      if (geometry && (!materials.length || materials.some(material => material && material.visible !== false && material.opacity !== 0))) {
        if (geometry.boundingBox) this.scratch.copy(geometry.boundingBox);
        else if (geometry.attributes && geometry.attributes.position) this.scratch.setFromBufferAttribute(geometry.attributes.position);
        else this.scratch.makeEmpty();
        if (!this.scratch.isEmpty()) entry.bounds.union(this.scratch.applyMatrix4(node.matrixWorld));
      }
      node.children.forEach(visit);
    };
    visit(object);
    if (entry.bounds.isEmpty() || !entry.bounds.min.toArray().concat(entry.bounds.max.toArray()).every(Number.isFinite)) return false;
    entry.bounds.expandByScalar(OUTLINE_MARGIN);
    return true;
  }

  update(delta = 0) {
    if (this.disposed) return;
    const elapsed = typeof delta === 'number' && Number.isFinite(delta) ? Math.max(0, Math.min(delta, 0.25)) : 0;
    const scene = this.ctx.scene;
    this.root.visible = this.runtimeVisible();
    this.bindings.forEach(entry => {
      if (!scene || !within(entry.object, scene)) { this.remove(entry.object); return; }
      if (!entry.held) {
        entry.remaining = Math.max(0, entry.remaining - elapsed);
        if (entry.remaining <= 0.000001) { this.remove(entry.object); return; }
        entry.helper.material.opacity = 0.95 * entry.remaining / RELEASE_SECONDS;
      }
      entry.helper.visible = this.root.visible && visible(entry.object) && this.measure(entry);
      if (entry.held && entry.placement) this.placement(entry.object, entry.placement);
    });
    // Bounds are in world coordinates. Cancel an optional transform on the
    // scene so Box3Helper can use those coordinates without double transforms.
    if (scene && scene.updateWorldMatrix) {
      scene.updateWorldMatrix(true, false);
      this.root.matrix.getInverse(scene.matrixWorld);
      this.root.matrixWorldNeedsUpdate = true;
      this.root.updateMatrixWorld(true);
    }
  }

  remove(object) {
    const entry = this.bindings.get(object);
    if (!entry) return false;
    this.bindings.delete(object);
    [entry.helper, entry.destination, entry.surface].filter(Boolean).forEach(helper => {
      this.root.remove(helper); helper.geometry.dispose(); helper.material.dispose();
    });
    return true;
  }

  dispose() {
    if (this.disposed) return;
    Array.from(this.bindings.keys()).forEach(object => this.remove(object));
    if (this.root.parent) this.root.parent.remove(this.root);
    this.disposed = true;
  }
}
