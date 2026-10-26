const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');

const source = fs.readFileSync(path.join(__dirname, '../src/editor/ScenePerformance.js'), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export default class ScenePerformance', 'class ScenePerformance');
const helper = file => new Function('THREE', fs.readFileSync(path.join(__dirname, '../src/editor', file + '.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class ' + file, 'return class ' + file))(THREE);
const ScenePerformance = new Function('THREE', 'RuntimeResourceMemory', 'CosmeticVisualLod', source + '\nreturn ScenePerformance;')(THREE, helper('RuntimeResourceMemory'), helper('CosmeticVisualLod'));
const disposed = new Map();
function watch(resource) { resource.addEventListener('dispose', () => disposed.set(resource, (disposed.get(resource) || 0) + 1)); return resource; }
function texture() { const result = watch(new THREE.Texture({width: 4, height: 4})); result.needsUpdate = true; return result; }
function mesh(map) { return new THREE.Mesh(watch(new THREE.BoxBufferGeometry()), watch(new THREE.MeshBasicMaterial(map ? {map} : undefined))); }
function setup(roots, extra = {}) {
  const rooms = new Map(roots.map((root, index) => [String(index), {root}]));
  const document = {rooms, getRoot: roomId => rooms.get(String(roomId)) && rooms.get(String(roomId)).root};
  const ctx = Object.assign({scene: new THREE.Group(), renderer: {info: {render: {calls: 13, triangles: 52}, memory: {geometries: 4, textures: 3}}}}, extra);
  return {manager: new ScenePerformance(ctx, document), ctx, document};
}

// Dormant exclusive resources are released once; active/shared/controller data
// survives. The native document and CPU data are unchanged for undo and reentry.
{
  const active = new THREE.Group();
  const inactive = new THREE.Group();
  const sharedTexture = texture();
  const activeMesh = mesh(sharedTexture);
  const inactiveMesh = mesh(texture());
  inactiveMesh.userData.editorId = 'native:1:root.0';
  const nativeData = Object.assign({}, inactiveMesh.userData);
  const geometryData = inactiveMesh.geometry.attributes.position.array;
  const shaderTexture = texture();
  const shaderMaterial = watch(new THREE.ShaderMaterial({uniforms: {maps: {value: [shaderTexture, {nested: sharedTexture}]}}}));
  const shader = new THREE.Mesh(activeMesh.geometry, shaderMaterial);
  const shared = new THREE.Mesh(activeMesh.geometry, activeMesh.material);
  const controller = mesh(texture());
  const controllerCopy = new THREE.Mesh(controller.geometry, controller.material);
  const sharedAttributeGeometry = watch(new THREE.BufferGeometry());
  sharedAttributeGeometry.setAttribute('position', activeMesh.geometry.attributes.position);
  const sharedAttributeMesh = new THREE.Mesh(sharedAttributeGeometry, watch(new THREE.MeshBasicMaterial()));
  active.add(activeMesh);
  inactive.add(inactiveMesh, shader, shared, controllerCopy, sharedAttributeMesh);
  const {manager, ctx} = setup([active, inactive], {assets: {generic_controller_model: {scene: controller}, inactive_model: {scene: inactive}, inactive_texture: inactiveMesh.material.map}});
  ctx.scene.add(active);
  manager.setRoom(0);
  [inactiveMesh.geometry, inactiveMesh.material, inactiveMesh.material.map, shaderMaterial, shaderTexture].forEach(resource => assert.equal(disposed.get(resource), 1));
  [activeMesh.geometry, activeMesh.material, sharedTexture, controller.geometry, controller.material, controller.material.map, sharedAttributeGeometry].forEach(resource => assert.equal(disposed.get(resource), undefined));
  assert.equal(inactiveMesh.geometry.attributes.position.array, geometryData);
  assert.deepEqual(inactiveMesh.userData, nativeData);
  assert.equal(inactiveMesh.visible, true);
  assert.equal(inactive.parent, null);
  assert.equal(manager.getStats().inactiveRooms, 1);
  assert.equal(manager.getStats().triangles, 52);
  const releaseCount = manager.getStats().inactiveGPUEvictions;
  for (let i = 0; i < 180; i++) manager.update(null, 1 / 60);
  manager.setRoom('0');
  assert.equal(manager.getStats().inactiveGPUEvictions, releaseCount, 'Stable frames must not repeatedly dispose inactive resources.');
  const late = mesh(texture());
  inactive.add(late);
  manager.update(null, 1.1);
  assert.equal(disposed.get(late.material.map), 1, 'New resources in an inactive room are discovered without changing rooms.');
  const textureVersion = inactiveMesh.material.map.version;
  const shaderVersion = shaderTexture.version;
  const lateVersion = late.material.map.version;
  manager.setRoom(1);
  assert.equal(inactiveMesh.material.map.version, textureVersion + 1, 'A disposed map must explicitly request WebGL reupload.');
  assert.equal(shaderTexture.version, shaderVersion + 1, 'Shader uniform textures also need reupload.');
  assert.equal(late.material.map.version, lateVersion + 1);
  assert.equal(disposed.get(sharedTexture), undefined, 'Shared textures remain resident across room transitions.');
  manager.setRoom(0);
  assert.equal(disposed.get(inactiveMesh.material.map), 2, 'A resource rendered on reentry may be evicted on the next departure.');
  const identity = inactiveMesh.geometry;
  manager.dispose();
  manager.setRoom(1);
  manager.update(null, 10);
  assert.equal(inactiveMesh.geometry, identity);
}

// Ordinary camera culling is advisory, preserves authored visibility, and has a
// half-metre margin rather than stopping visual effects exactly at the border.
{
  const root = new THREE.Group();
  const front = mesh(); front.position.set(0, 0, -5);
  const behind = mesh(); behind.position.set(0, 0, 5);
  const edge = mesh(); edge.position.set(5.8, 0, -5);
  const group = new THREE.Group(); group.add(front);
  root.add(group, behind, edge);
  const {manager} = setup([root]);
  manager.setRoom(0);
  const camera = new THREE.PerspectiveCamera(90, 1, 0.1, 100);
  root.updateMatrixWorld(true);
  manager.update(camera, 0);
  assert.equal(manager.isVisible(front), true);
  assert.equal(manager.isVisible(group), true);
  assert.equal(manager.isVisible(behind), false);
  assert.equal(manager.isVisible(edge), true);
  assert.equal(behind.visible, true, 'Culling must not write document visibility.');
  behind.frustumCulled = false;
  assert.equal(manager.isVisible(behind), true, 'Keep explicit no-culling meshes active.');
  behind.frustumCulled = true;
  behind.position.z = -5;
  root.updateMatrixWorld(true);
  manager.update(camera, 0);
  assert.equal(manager.isVisible(behind), true, 'Bounds cache expires on the next frame.');
  group.visible = false;
  assert.equal(manager.isVisible(front), false);
  group.visible = true;
  assert.equal(manager.isVisible(new THREE.Group()), true, 'Non-rendering groups with no geometry remain safe.');
}

// XR must use the union of the left and right eye frustums. The ArrayCamera
// aggregate projection is not an appropriate substitute for both eyes.
{
  const root = new THREE.Group();
  const target = mesh(); target.position.set(3, 0, -4); root.add(target);
  const left = new THREE.PerspectiveCamera(30, 1, 0.1, 100); left.position.x = -3; left.updateMatrixWorld(true);
  const right = new THREE.PerspectiveCamera(30, 1, 0.1, 100); right.position.x = 3; right.updateMatrixWorld(true);
  const eyes = new THREE.ArrayCamera([left, right]);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  let requests = 0;
  const {manager, ctx} = setup([root], {vrMode: true, renderer: {xr: {enabled: true, getCamera(value) { assert.equal(value, camera); requests++; return eyes; }}}});
  root.updateMatrixWorld(true);
  manager.setRoom(0);
  manager.update(camera, 0);
  assert.equal(manager.isVisible(target), true);
  assert.equal(requests, 1);
  assert.equal(ctx.renderer.xr.enabled, true);
  ctx.vrMode = false;
  manager.update(left, 0);
  assert.equal(manager.isVisible(target), false);
}

// Context recovery detaches old texture/buffer/program listeners exactly once,
// including private overlays, replaced originals and retained loading/history.
{
  const root = new THREE.Group(), active = mesh(texture()); root.add(active);
  const original = watch(new THREE.MeshStandardMaterial({map: texture()}));
  const hmiOriginal = watch(new THREE.MeshBasicMaterial({map: texture()}));
  const rollerOriginal = watch(new THREE.MeshStandardMaterial({map: texture()}));
  const loaded = texture(), snapshotMesh = mesh(texture()), nativeOriginal = watch(new THREE.MeshBasicMaterial({map: texture()}));
  loaded.image = {width: 2, height: 2, data: new Uint8Array([1, 7, 13, 19])};
  const decal = mesh(texture()), wearMesh = mesh(texture()), convertedGeometry = watch(new THREE.BoxBufferGeometry());
  decal.visible = false; wearMesh.visible = false;
  const bvh = {root: new Uint32Array([3, 11, 27])}; decal.geometry.boundsTree = bvh;
  decal.geometry.addGroup(0, 6, 0); decal.geometry.setDrawRange(0, 12); decal.geometry.computeBoundingBox();
  const rollerMap = texture(), uniformMap = texture();
  active.material.preparedConcreteUniforms = {preparedConcreteMap: {value: uniformMap}};
  const target = watch(new THREE.WebGLRenderTarget(16, 16)); watch(target.texture);
  target.depthTexture = watch(new THREE.DepthTexture(16, 16));
  const surface = {meshes: new Map([[active, {binding: {original}, originals: [original], installed: active.material}]]), copies: new Map([[original, active.material]])};
  surface.groups = [surface];
  const {manager, ctx, document} = setup([root], {
    roomAssets: {records: new Map([['pending-texture', {texture: active.material.map, loaded}]])},
    editor: {
      entities: {target}, materials: {states: new Map([[root, surface]])},
      decals: {states: new Map([[root, {mesh: decal, material: decal.material}]]), convertedResources: new Set([convertedGeometry])},
      wearPaint: {engine: {states: new Map([[root, {mesh: wearMesh, material: wearMesh.material}]]), convertedResources: new Set([convertedGeometry])}},
      industrialVisuals: {
        displays: new Map([[active, {object: active, original: hmiOriginal, installed: active.material}]]),
        rollers: new Map([[active, {object: active, original: rollerOriginal, privateMaterials: [active.material], surfaces: [{texture: rollerMap}]}]])
      }
    }
  });
  root.add(new THREE.Mesh(active.geometry, active.material)); // Shared uploads are released once.
  ctx.scene.add(root);
  document.native = new Map([['original', {material: nativeOriginal}]]);
  document.undoStack = [{additions: [{entry: {object: snapshotMesh}}]}];
  // Start without normal dormant eviction so every count below belongs to loss.
  manager.roomId = '0';
  const textures = [active.material.map, original.map, hmiOriginal.map, rollerOriginal.map, loaded, snapshotMesh.material.map, nativeOriginal.map, rollerMap, uniformMap, decal.material.map, wearMesh.material.map];
  const geometries = [active.geometry, snapshotMesh.geometry, decal.geometry, wearMesh.geometry, convertedGeometry];
  const materials = [active.material, original, hmiOriginal, rollerOriginal, snapshotMesh.material, nativeOriginal, decal.material, wearMesh.material];
  const resources = textures.concat(geometries, materials);
  const imageRefs = textures.map(value => value.image), versions = textures.map(value => value.version);
  const attributes = geometries.flatMap(value => Object.values(value.attributes).concat(value.index ? [value.index] : [])).map(value => ({attribute: value, array: value.array, data: Array.from(value.array)}));
  const colors = materials.map(value => ({material: value, color: value.color, data: value.color.toArray()}));
  const groups = JSON.stringify(decal.geometry.groups), drawRange = Object.assign({}, decal.geometry.drawRange), box = decal.geometry.boundingBox.clone(), bvhData = Array.from(bvh.root), imageData = Array.from(loaded.image.data);
  const expected = {textures: textures.length, renderTargets: 1, geometries: geometries.length, materials: materials.length};
  const assertCpuIntact = () => {
    attributes.forEach(value => { assert.equal(value.attribute.array, value.array); assert.deepEqual(Array.from(value.array), value.data); });
    colors.forEach(value => { assert.equal(value.material.color, value.color); assert.deepEqual(value.color.toArray(), value.data); });
    assert.equal(decal.geometry.boundsTree, bvh); assert.deepEqual(Array.from(bvh.root), bvhData);
    assert.equal(JSON.stringify(decal.geometry.groups), groups); assert.deepEqual(decal.geometry.drawRange, drawRange); assert(decal.geometry.boundingBox.equals(box));
    assert.deepEqual(Array.from(loaded.image.data), imageData); assert.equal(active.geometry, geometries[0]); assert.equal(active.material, materials[0]);
  };
  assert.deepEqual(manager.releaseContextTextureHandles(), expected);
  textures.forEach((value, index) => {
    assert.equal(disposed.get(value), 1); assert.equal(value.image, imageRefs[index]);
    assert.equal(value.version, versions[index] + 1, 'CPU texture requests a future reupload.');
  });
  assert.equal(disposed.get(target), 1);
  [target.texture, target.depthTexture].forEach(value => assert.equal(disposed.get(value), undefined, 'Render-target textures are released only by their target.'));
  geometries.concat(materials).forEach(value => assert.equal(disposed.get(value), 1, 'GPU listener disposal includes invisible/private/shared resources once.'));
  assertCpuIntact();
  assert.deepEqual(manager.releaseContextTextureHandles(), {textures: 0, renderTargets: 0, geometries: 0, materials: 0});
  manager.update(null, 3);
  resources.forEach(value => assert.equal(disposed.get(value), 1, 'Frames during loss cannot repeat eviction.'));
  manager.restoreContextTextureHandles();
  resources.forEach(value => assert.equal(disposed.get(value), 1, 'Restore performs no GPU work.'));
  assertCpuIntact();
  assert.deepEqual(manager.releaseContextTextureHandles(), expected, 'A second independent loss cleans its renderer once.');
  resources.forEach(value => assert.equal(disposed.get(value), 2));
  assertCpuIntact();
  assert.equal(disposed.get(target), 2);
  assert.equal(manager.getStats().contextTextureReleaseCycles, 2);
  assert.equal(manager.getStats().contextReleasedGeometries, geometries.length * 2);
  assert.equal(manager.getStats().contextReleasedMaterials, materials.length * 2);
  manager.dispose();
}

console.log('Scene performance: inactive GPU residency, shared resources, reentry, camera culling, stereo XR and repeated context-loss GPU listener cleanup with exact CPU/BVH/image/color identity passed.');
