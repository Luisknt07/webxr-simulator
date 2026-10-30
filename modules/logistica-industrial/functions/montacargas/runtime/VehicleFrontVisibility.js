/** Presentation-only sight aid for the occupied truck. Collision meshes,
 * wheel/lever interaction, authored materials and load custody stay intact. */
export default class VehicleFrontVisibility {
  constructor(driving) {this.driving = driving; this.entries = []; this.materials = new Map(); this.active = false; this.allocations = 0;}
  mount(root) {
    this.unmount(); this.root = root; this.rig = root && root.userData.vehicleRig;
    const rig = this.rig; if (!rig || !rig.forks) return;
    const meshes = new Set(), visit = object => {if (object) object.traverse(node => {
      // Keep only the horizontal blades and entry tips opaque. Upright heels
      // otherwise resemble two false prongs in front of the pallet pockets.
      if (node.isMesh && node.material && !node.userData.vehicleForkBlade) meshes.add(node);
    });};
    visit(rig.mast || rig.reach); visit(rig.boom); visit(rig.forks);
    (rig.cabPosts || []).filter(post => post.end > 0).forEach(post => visit(post.object));
    visit(rig.frontGlass); visit(rig.dashboard); visit(rig.dashSupport);
    this.entries = [...meshes].map(mesh => ({mesh, material: mesh.material, castShadow: mesh.castShadow}));
    this.update();
  }
  ghost(material) {
    if (!material || !material.clone) return material;
    if (!this.materials.has(material)) {
      const clone = material.clone(); clone.name = material.name + ' · visión holográfica';
      clone.transparent = true; clone.opacity = Math.min(.07, material.opacity === undefined ? 1 : material.opacity);
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
    if (active === this.active) return;
    this.entries.forEach(entry => {
      entry.mesh.material = active ? Array.isArray(entry.material) ? entry.material.map(material => this.ghost(material)) : this.ghost(entry.material) : entry.material;
      entry.mesh.castShadow = active ? false : entry.castShadow;
    });
    this.active = active;
  }
  getStats() {return {active: this.active, meshes: this.entries.length, materials: this.materials.size, allocations: this.allocations};}
  unmount() {
    this.entries.forEach(entry => {entry.mesh.material = entry.material; entry.mesh.castShadow = entry.castShadow;});
    this.materials.forEach(material => material.dispose()); this.materials.clear(); this.entries = []; this.active = false; this.root = this.rig = null;
  }
  dispose() {this.unmount();}
}
