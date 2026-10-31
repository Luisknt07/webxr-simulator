import * as THREE from 'three';

const MAX_SEGMENTS = 6000;
const POSE_KEYS = ['lift', 'reach', 'tilt', 'sideShift', 'turret', 'boomAngle'];
const color = value => new THREE.Color(value).convertSRGBToLinear();
const shown = (object, root) => {for (let node = object; node && node !== root; node = node.parent) if (!node.visible) return false; return true;};

/** Presentation-only sight aid for the occupied truck. Collision meshes,
 * wheel/lever interaction, authored materials and load custody stay intact. */
export default class VehicleFrontVisibility {
  constructor(driving) {
    this.driving = driving; this.entries = []; this.materials = new Map(); this.active = false; this.allocations = 0;
    this.inverse = new THREE.Matrix4(); this.matrix = new THREE.Matrix4(); this.instance = new THREE.Matrix4();
    this.poseValues = new Float64Array(POSE_KEYS.length); this.poseValues.fill(NaN); this.wireUpdates = 0;
  }
  mount(root) {
    this.unmount(); this.root = root; this.rig = root && root.userData.vehicleRig;
    const rig = this.rig; if (!rig || !rig.forks) return;
    const meshes = new Set(), visit = object => {if (object) object.traverse(node => {
      // Keep only the horizontal blades and entry tips opaque. Upright heels
      // otherwise resemble two false prongs in front of the pallet pockets.
      if (node.isMesh && node.material && !node.userData.vehicleForkBlade && !node.userData.editorRuntimeHelper && !node.userData.editorHelper && !node.userData.vehicleDecal) meshes.add(node);
    });};
    visit(rig.mast || rig.reach); visit(rig.boom); visit(rig.forks);
    (rig.cabPosts || []).filter(post => post.end > 0).forEach(post => visit(post.object));
    visit(rig.frontGlass); visit(rig.dashboard); visit(rig.dashSupport);
    this.entries = [...meshes].map(mesh => ({mesh, material: mesh.material, castShadow: mesh.castShadow}));
    this.createWire();
    this.update();
  }
  wireColor(entry) {
    const material = Array.isArray(entry.material) ? entry.material[0] : entry.material;
    const role = entry.mesh.userData.industrialMaterialRole || material.userData && material.userData.industrialMaterialRole || '';
    const components = entry.mesh.userData.industrialComponents || [];
    const label = components.length > 1 ? '' : entry.mesh.name;
    if (/hidr[aá]ul|manguera|v[aá]stago|cilindro|cadena/i.test(label)) return color('#68b9ed');
    if (role === 'frame') return color(this.rig.config.frameColor || '#e3be52').lerp(color('#ffe2a0'), .25);
    if (role === 'accent') return color(this.rig.config.accentColor || '#263540').lerp(color(this.rig.config.frameColor || '#e3be52'), .7).lerp(color('#e2e8e8'), .15);
    if (role === 'red' || role === 'light') return color('#efb35d');
    if (role === 'glass') return color('#95d5c5');
    return color('#91bdcf');
  }
  createWire() {
    if (!this.root || !this.entries.length) return;
    const candidates = []; let total = 0;
    this.entries.forEach(entry => {
      const mesh = entry.mesh, geometry = mesh.geometry;
      if (!geometry || !geometry.attributes || !geometry.attributes.position) return;
      const edges = new THREE.EdgesGeometry(geometry, 35), positions = edges.attributes.position;
      const local = new Float32Array(positions.array); edges.dispose();
      // Repeated chain links need a readable skeletal outline, not hundreds
      // of superimposed rings. Sample the whole instanced run evenly.
      const instances = mesh.isInstancedMesh ? Math.max(0, Math.min(mesh.count, 16)) : 1;
      for (let instance = 0; instance < instances; instance++) {
        candidates.push({mesh, instance: mesh.isInstancedMesh ? Math.floor(instance * mesh.count / instances) : -1, local, color: this.wireColor(entry)});
        total += local.length / 6;
      }
    });
    // Sampling shares a fixed budget across all components, including the
    // chain instances. A detailed mast cannot allocate an unbounded wire mesh.
    const stride = Math.max(1, Math.ceil(total / MAX_SEGMENTS));
    let cursor = 0, vertices = 0; this.wireSources = [];
    candidates.forEach(source => {
      const selected = [];
      for (let offset = 0; offset + 5 < source.local.length; offset += 6, cursor++) if (cursor % stride === 0 && vertices / 2 < MAX_SEGMENTS) {
        for (let index = 0; index < 6; index++) selected.push(source.local[offset + index]); vertices += 2;
      }
      if (!selected.length) return;
      this.wireSources.push({mesh: source.mesh, instance: source.instance, local: new Float32Array(selected), offset: vertices - selected.length / 3, visible: shown(source.mesh, this.root), color: source.color});
    });
    this.wireSegments = vertices / 2; this.wireTruncated = total > MAX_SEGMENTS;
    if (!vertices) return;
    const positions = new Float32Array(vertices * 3), colors = new Float32Array(vertices * 3);
    this.wireSources.forEach(source => {for (let index = 0; index < source.local.length / 3; index++) source.color.toArray(colors, (source.offset + index) * 3);});
    const geometry = this.wireGeometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setDrawRange(0, vertices);
    const material = this.wireMaterial = new THREE.LineBasicMaterial({vertexColors: THREE.VertexColors, transparent: true, opacity: .8, depthTest: true, depthWrite: false, toneMapped: false});
    const wire = this.wire = new THREE.LineSegments(geometry, material); wire.name = 'Holograma alámbrico por componentes';
    wire.frustumCulled = false; wire.raycast = () => {}; wire.visible = false;
    Object.assign(wire.userData, {editorRuntimeHelper: true, editorHelper: true, editorCollisionDisabled: true, vehicleHologramWire: true});
    this.root.add(wire); this.allocations += 2; this.updateWire(true);
  }
  updateWire(force = false) {
    if (!this.wire) return;
    const pose = this.rig.pose || {}; let changed = force;
    POSE_KEYS.forEach((key, index) => {const value = Number.isFinite(pose[key]) ? pose[key] : 0; if (this.poseValues[index] !== value) changed = true; this.poseValues[index] = value;});
    this.wireSources.forEach(source => {const visible = shown(source.mesh, this.root); if (visible !== source.visible) changed = true; source.visible = visible;});
    if (!changed) return;
    this.root.updateWorldMatrix(true, true); this.inverse.getInverse(this.root.matrixWorld);
    const positions = this.wireGeometry.attributes.position.array;
    this.wireSources.forEach(source => {
      this.matrix.multiplyMatrices(this.inverse, source.mesh.matrixWorld);
      if (source.instance >= 0) {source.mesh.getMatrixAt(source.instance, this.instance); this.matrix.multiply(this.instance);}
      const e = this.matrix.elements, local = source.local; let target = source.offset * 3;
      for (let index = 0; index < local.length; index += 3) {
        const x = local[index], y = local[index + 1], z = local[index + 2];
        positions[target++] = source.visible ? e[0] * x + e[4] * y + e[8] * z + e[12] : 0;
        positions[target++] = source.visible ? e[1] * x + e[5] * y + e[9] * z + e[13] : 0;
        positions[target++] = source.visible ? e[2] * x + e[6] * y + e[10] * z + e[14] : 0;
      }
    });
    this.wireGeometry.attributes.position.needsUpdate = true; this.wireGeometry.computeBoundingBox(); this.wireUpdates++;
  }
  ghost(material) {
    if (!material || !material.clone) return material;
    if (!this.materials.has(material)) {
      const clone = material.clone(); clone.name = material.name + ' · visión holográfica';
      clone.transparent = true; clone.opacity = Math.min(.012, material.opacity === undefined ? 1 : material.opacity);
      // Nested mast profiles otherwise accumulate a milky reflection veil.
      // Only the temporary clones reduce reflection strength, not the room.
      if (Number.isFinite(clone.envMapIntensity)) clone.envMapIntensity *= .25;
      // Do not leave a solid depth silhouette or opaque mast shadow in front
      // of the pallet. Geometry, collider flags and transforms are unchanged.
      clone.depthWrite = false; clone.needsUpdate = true;
      this.materials.set(material, clone); this.allocations++;
    }
    return this.materials.get(material);
  }
  update() {
    const driving = this.driving, root = driving.visualRoot;
    if (root && root.userData.vehicleRig !== this.rig) {this.mount(root); return;}
    const active = !!(driving.id && driving.holographicGuide && driving.holographicGuide.enabled && this.rig && this.rig.forks && this.entries.length);
    if (active === this.active) {if (active) this.updateWire(); return;}
    this.entries.forEach(entry => {
      entry.mesh.material = active ? Array.isArray(entry.material) ? entry.material.map(material => this.ghost(material)) : this.ghost(entry.material) : entry.material;
      entry.mesh.castShadow = active ? false : entry.castShadow;
    });
    this.active = active;
    if (this.wire) {this.wire.visible = active; if (active) this.updateWire(true);}
  }
  getStats() {return {active: this.active, meshes: this.entries.length, materials: this.materials.size, allocations: this.allocations};}
  getWireStats() {return {segments: this.wireSegments || 0, limit: MAX_SEGMENTS, drawCalls: this.wire && this.active ? 1 : 0, updates: this.wireUpdates, sources: this.wireSources ? this.wireSources.length : 0, truncated: !!this.wireTruncated};}
  unmount() {
    this.entries.forEach(entry => {entry.mesh.material = entry.material; entry.mesh.castShadow = entry.castShadow;});
    this.materials.forEach(material => material.dispose()); this.materials.clear(); this.entries = []; this.active = false; this.root = this.rig = null;
    if (this.wire && this.wire.parent) this.wire.parent.remove(this.wire);
    if (this.wireGeometry) this.wireGeometry.dispose(); if (this.wireMaterial) this.wireMaterial.dispose();
    this.wire = this.wireGeometry = this.wireMaterial = null; this.wireSources = []; this.wireSegments = 0; this.wireTruncated = false; this.poseValues.fill(NaN);
  }
  dispose() {this.unmount();}
}
