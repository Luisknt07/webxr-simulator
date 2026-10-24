const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');

const source = fs.readFileSync(path.join(__dirname, '../src/editor/ScenePerformance.js'), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export default class ScenePerformance', 'class ScenePerformance');
const ScenePerformance = new Function('THREE', source + '\nreturn ScenePerformance;')(THREE);
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

console.log('Scene performance: inactive GPU residency, shared resources, reentry, camera culling and stereo XR passed.');
