import * as THREE from 'three';

const MAX_CANDIDATES = 2048, MAX_DECISIONS = 64, INTERVAL = .16;
const OWNERS = ['conveyor', 'source', 'processor', 'palletQueue'];
const FUNCTIONAL = ['control', 'sensor', 'product', 'plc'];
const DYNAMIC_FLAGS = ['industrialDynamicGeometry', 'industrialSteerBank', 'industrialSteerRest', 'industrialRoller', 'industrialBelt', 'industrialProcessorHead', 'industrialWorkpoint', 'industrialPallet', 'sourceProduct', 'productUnits'];
function materials(mesh) { return Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []; }
function candidate(mesh) {
  if (!mesh.isMesh || mesh.children.length || !mesh.geometry || mesh.isSkinnedMesh || mesh.isInstancedMesh || mesh.morphTargetInfluences || Object.keys(mesh.geometry.morphAttributes || {}).length || mesh.userData.industrialCosmeticDetail !== true) return false;
  if (DYNAMIC_FLAGS.some(key => mesh.geometry.userData && mesh.geometry.userData[key])) return false;
  let owned = false;
  for (let node = mesh; node; node = node.parent) {
    const data = node.userData || {}, behaviors = data.editorBehaviors || data.editorDefaultBehaviors || [];
    if (data.editorHelper || data.editorRuntimeHelper || data.editorVisualOwnerId || data.editorGeometryReplaced || data.editorDecal ||
      data.industrialButton || data.industrialAction || data.industrialDisplay || data.industrialSourceDisplay || data.industrialProcessorDisplay || data.industrialPalletQueueDisplay ||
      data.industrialSensorLamp || data.industrialSensorVolume || data.industrialTower || data.industrialZoneLamp || DYNAMIC_FLAGS.some(key => data[key]) ||
      FUNCTIONAL.includes(data.editorPrefabKey) || behaviors.some(value => ['lineMonitor', 'control', 'sensor', 'product', 'animation', 'info'].includes(value.type)) || (node.animations || []).length) return false;
    if (OWNERS.includes(data.editorPrefabKey)) { if (data.editorNative === true) return false; owned = true; }
  }
  return owned && materials(mesh).length > 0 && materials(mesh).every(material => material && !material.isShaderMaterial && !material.isRawShaderMaterial && !material.transparent && material.opacity === 1 && !material.skinning && !material.morphTargets);
}
function visible(object) { for (let node = object; node; node = node.parent) if (!node.visible) return false; return true; }

/** Only factory-approved static fittings may omit draws. Layer mask zero is a
 * temporary renderer filter: no authored visibility, materials, geometry or
 * collision representation changes. Functional ancestors always win. */
export default class CosmeticVisualLod {
  constructor() {
    this.entries = new Map(); this.list = []; this.cursor = 0; this.elapsed = INTERVAL; this.policy = ''; this.disposed = false;
    this.center = new THREE.Vector3(); this.scale = new THREE.Vector3(); this.eye = new THREE.Vector3(); this.sphere = new THREE.Sphere();
    this.stats = {cosmeticLodCandidates: 0, cosmeticLodHidden: 0, cosmeticLodDrawCallsAvoidedEstimated: 0, cosmeticLodDecisions: 0, cosmeticLodMaxDecisionsPerFrame: 0, cosmeticLodLimit: MAX_CANDIDATES};
  }
  restore(entry) { if (entry.hidden && entry.mesh.layers.mask === 0) entry.mesh.layers.mask = entry.mask; entry.hidden = false; entry.inView = false; }
  clear() { this.entries.forEach(entry => this.restore(entry)); this.entries.clear(); this.list.length = 0; this.cursor = 0; this.updateStats(); }
  reconcile(root) {
    if (this.disposed) return;
    const retained = new Set();
    if (root) root.traverse(mesh => {
      if (retained.size >= MAX_CANDIDATES || !candidate(mesh)) return;
      let entry = this.entries.get(mesh);
      if (!entry) { entry = {mesh, mask: mesh.layers.mask, hidden: false, inView: false}; this.entries.set(mesh, entry); }
      else if (!entry.hidden) entry.mask = mesh.layers.mask;
      retained.add(mesh);
    });
    this.entries.forEach((entry, mesh) => { if (!retained.has(mesh)) { this.restore(entry); this.entries.delete(mesh); } });
    this.list = [...this.entries.values()]; this.cursor %= Math.max(1, this.entries.size); this.updateStats();
  }
  update(cameras, delta, limits = {}, viewportHeight = 720, frustums = []) {
    if (this.disposed) return;
    const tier = limits.tier || 'high', lower = tier === 'economy' || tier === 'balanced';
    const signature = tier + ':' + limits.visualDistanceScale;
    if (signature !== this.policy) { this.policy = signature; this.elapsed = INTERVAL; if (!lower) this.entries.forEach(entry => this.restore(entry)); this.updateStats(); }
    this.elapsed += Math.max(0, Number.isFinite(delta) ? delta : 0);
    if (!lower || !cameras.length || this.elapsed < INTERVAL || !this.entries.size) return;
    this.elapsed = 0; const entries = this.list, distanceScale = Math.max(.35, Math.min(2, limits.visualDistanceScale || 1));
    const maxDistance = (tier === 'economy' ? 14 : 28) * distanceScale, minPixels = tier === 'economy' ? 4 : 2.5;
    const count = Math.min(MAX_DECISIONS, entries.length);
    for (let index = 0; index < count; index++) {
      const entry = entries[this.cursor++ % entries.length], mesh = entry.mesh;
      if (!candidate(mesh)) { this.restore(entry); continue; }
      if (!visible(mesh)) { this.restore(entry); continue; }
      mesh.updateWorldMatrix(true, false); if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere(); const bound = mesh.geometry.boundingSphere;
      if (!bound || !Number.isFinite(bound.radius)) { this.restore(entry); continue; }
      this.center.copy(bound.center).applyMatrix4(mesh.matrixWorld); mesh.getWorldScale(this.scale); const radius = bound.radius * Math.max(Math.abs(this.scale.x), Math.abs(this.scale.y), Math.abs(this.scale.z));
      let distance = Infinity, pixels = 0;
      cameras.forEach(camera => {
        // ScenePerformance already resolved world matrices. XR eyes in r112
        // carry a tracked matrixWorld that getWorldPosition() would overwrite
        // from their unrelated local transform, dropping the camera-rig offset.
        this.eye.setFromMatrixPosition(camera.matrixWorld); const away = Math.max(.01, this.eye.distanceTo(this.center) - radius); distance = Math.min(distance, away);
        const projected = camera.isOrthographicCamera ? radius * 2 * viewportHeight / Math.max(.001, (camera.top - camera.bottom) / camera.zoom) : radius * viewportHeight * Math.abs(camera.projectionMatrix.elements[5]) / away;
        pixels = Math.max(pixels, projected);
      });
      const hide = entry.hidden ? distance > maxDistance * .8 || pixels < minPixels * 1.35 : distance > maxDistance * 1.15 || pixels < minPixels;
      if (hide && !entry.hidden && mesh.layers.mask) { entry.mask = mesh.layers.mask; mesh.layers.mask = 0; entry.hidden = true; }
      else if (!hide) this.restore(entry);
      this.sphere.center.copy(this.center); this.sphere.radius = radius; entry.inView = frustums.length ? frustums.some(frustum => frustum.intersectsSphere(this.sphere)) : true;
    }
    this.cursor %= entries.length; this.stats.cosmeticLodDecisions += count; this.stats.cosmeticLodMaxDecisionsPerFrame = Math.max(this.stats.cosmeticLodMaxDecisionsPerFrame, count); this.updateStats();
  }
  updateStats() {
    let hidden = 0, avoided = 0;
    this.entries.forEach(entry => { if (entry.hidden) { hidden++; if (entry.inView) avoided += Array.isArray(entry.mesh.material) ? Math.max(1, entry.mesh.geometry.groups.length) : 1; } });
    this.stats.cosmeticLodCandidates = this.entries.size; this.stats.cosmeticLodHidden = hidden; this.stats.cosmeticLodDrawCallsAvoidedEstimated = avoided;
  }
  getStats() { return Object.assign({}, this.stats); }
  dispose() { this.clear(); this.disposed = true; }
}
