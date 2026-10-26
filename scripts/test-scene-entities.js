'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const schema = require('../shared/studio-document');
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.listeners = {}; this.attributes = {}; }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, callback) { (this.listeners[type] || (this.listeners[type] = [])).push(callback); }
  getContext() { return {createImageData: (width, height) => ({data: new Uint8ClampedArray(width * height * 4)}), putImageData: image => { this.image = image; }}; }
}
const source = fs.readFileSync(path.join(__dirname, '../src/studio/SceneEntities.js'), 'utf8').replace(/^import .*$/gm, '').replace('export default class SceneEntities', 'return class SceneEntities');
const environmentSource = fs.readFileSync(path.join(__dirname, '../src/studio/SceneEnvironment.js'), 'utf8').replace(/^import .*$/gm, '').replace('export default class SceneEnvironment', 'return class SceneEnvironment');
const SceneEnvironment = new Function('THREE', 'schema', environmentSource)(THREE, schema);
const SceneEntities = new Function('THREE', 'document', 'SceneEnvironment', source)(THREE, {createElement: tag => new Element(tag)}, SceneEnvironment);

const scene = new THREE.Scene(), root = new THREE.Group(); scene.add(root);
const lightMarker = new THREE.Mesh(new THREE.SphereBufferGeometry(.1, 8, 8), new THREE.MeshBasicMaterial()), cameraMarker = new THREE.Mesh(new THREE.BoxBufferGeometry(), new THREE.MeshBasicMaterial());
lightMarker.userData = {editorId: 'light-marker', editorRoom: 'hall'}; lightMarker.position.set(2, 3, 4); lightMarker.scale.setScalar(.12);
cameraMarker.userData = {editorId: 'camera-marker', editorRoom: 'hall'}; cameraMarker.position.set(5, 2, 6); cameraMarker.rotation.y = .6; cameraMarker.scale.set(.2, .14, .28); root.add(lightMarker, cameraMarker);
const objects = new Map([[lightMarker.userData.editorId, lightMarker], [cameraMarker.userData.editorId, cameraMarker]]);
const data = schema.normalize({version: 1, entities: [{id: 'light-one', objectId: 'light-marker', roomId: 'hall', type: 'pointLight', color: '#ffcc88', intensity: 2, range: 7}, {id: 'camera-one', objectId: 'camera-marker', roomId: 'hall', type: 'camera', fov: 65}]});
assert.throws(() => schema.normalize({version: 1, entities: [data.entities[0], data.entities[0]]}), /repetidos/);
assert.throws(() => schema.normalize({version: 1, entities: [Object.assign({}, data.entities[0], {intensity: -1})]}), /límites/);
assert.throws(() => schema.normalize({version: 1, entities: [Object.assign({}, data.entities[1], {fov: 200})]}), /límites/);
const oldTarget = {old: true}; let renderCalls = 0, disposed = 0;
const renderer = {
  xr: {enabled: true}, info: {autoReset: true}, target: oldTarget, viewport: new THREE.Vector4(4, 5, 800, 600), scissor: new THREE.Vector4(10, 12, 700, 500), scissorTest: true,
  getRenderTarget() { return this.target; }, getViewport(out) { return out.copy(this.viewport); }, getScissor(out) { return out.copy(this.scissor); }, getScissorTest() { return this.scissorTest; },
  setRenderTarget(target) { this.target = target; }, setViewport(x, y, z, w) { if (x.isVector4) this.viewport.copy(x); else this.viewport.set(x, y, z, w); }, setScissor(value) { this.scissor.copy(value); }, setScissorTest(yes) { this.scissorTest = yes; },
  render(actualScene, camera) { assert.equal(actualScene, scene); assert(camera.isPerspectiveCamera); assert.equal(this.xr.enabled, false); assert.equal(this.info.autoReset, false); renderCalls++; },
  readRenderTargetPixels(target, x, y, width, height, pixels) { assert(target.isWebGLRenderTarget); assert.equal(width, 320); assert.equal(height, 180); for (let row = 0; row < height; row++) pixels.fill(row, row * width * 4, (row + 1) * width * 4); }
};
const editor = {document: {studio: data, getObject: id => objects.get(id)}, ctx: {renderer}, roomId: 'hall', active: true, hooks: {renderScene: scene}, camera: new THREE.PerspectiveCamera(), orbit: {target: new THREE.Vector3(), update() {}}, shell: {workspace: 'cameras', workarea: {hidden: false}}, transform: new THREE.Group(), grid: new THREE.Group(), box: new THREE.Group()};
const entities = new SceneEntities(editor); entities.sync();
const light = entities.live.get('light-one').object, camera = entities.live.get('camera-one').object;
assert(light.isPointLight); assert.equal(light.intensity, 2); assert.equal(light.distance, 7); assert.equal(light.color.getHexString(), 'ffcc88'); assert.equal(light.castShadow, false);
assert.deepEqual(light.position.toArray(), [2, 3, 4]); assert.deepEqual(camera.scale.toArray(), [1, 1, 1]); assert.equal(camera.fov, 65);
assert.equal(light.parent, scene); assert.equal(light.userData.editorRuntimeHelper, true);
editor.active = false; entities.sync(); assert.equal(lightMarker.material.visible, false); assert.equal(light.visible, true);
lightMarker.visible = false; entities.sync(); assert.equal(light.visible, false); lightMarker.visible = true;
editor.active = true; entities.sync(); entities.useCamera('camera-one'); assert.deepEqual(editor.camera.position.toArray(), [5, 2, 6]); assert.equal(editor.camera.fov, 65);
assert(Math.abs(editor.camera.quaternion.dot(camera.quaternion)) > .99999);
assert.equal(cameraMarker.material.visible, false, 'An active authored viewpoint must not render the enclosing camera marker.');
assert.equal(cameraMarker.visible, true, 'Private marker hiding never disables the authored camera.');
editor.camera.position.x += 1; entities.sync(); assert.equal(cameraMarker.material.visible, true, 'The marker returns when the editor moves away.');
editor.camera.position.x -= 1; entities.sync(); assert.equal(cameraMarker.material.visible, false);

const container = new Element('section'); entities.showPreview('camera-one', container); entities.tick(0);
entities.target.addEventListener('dispose', () => disposed++);
assert.equal(renderCalls, 1); assert.equal(renderer.target, oldTarget); assert.deepEqual(renderer.viewport.toArray(), [4, 5, 800, 600]); assert.deepEqual(renderer.scissor.toArray(), [10, 12, 700, 500]); assert.equal(renderer.scissorTest, true); assert.equal(renderer.xr.enabled, true); assert.equal(renderer.info.autoReset, true);
assert.equal(entities.preview.canvas.image.data[0], 179, 'Render-target rows are inverted for the canvas image.');
entities.tick(.01); assert.equal(renderCalls, 1); entities.tick(.125); assert.equal(renderCalls, 2);
assert.equal(editor.transform.visible, true); assert.equal(cameraMarker.material.visible, false, 'Preview restores the active viewpoint marker policy.');
renderer.render = () => { throw new Error('GPU fixture'); }; entities.tick(.125); assert(entities.preview.status.textContent.includes('GPU fixture')); assert.equal(renderer.target, oldTarget); assert.equal(renderer.xr.enabled, true);
editor.ctx.vrMode = true; entities.tick(.1); assert.equal(entities.preview, null); assert.equal(disposed, 1); assert.equal(container.children.length, 0);
editor.roomId = 'sound'; entities.sync(); assert.equal(entities.live.size, 0); assert.equal(light.parent, null); assert.equal(lightMarker.material.visible, true);
entities.dispose();
// Adaptive light budgets operate on derived Three lights, leaving their saved
// records, marker visibility and intensities intact when tiers/cameras change.
{
  const budgetScene = new THREE.Scene(), budgetRoot = new THREE.Group(), markers = new Map(), entries = [];
  budgetScene.add(budgetRoot);
  for (let index = 0; index < 4; index++) {
    const marker = new THREE.Mesh(new THREE.BoxBufferGeometry(), new THREE.MeshBasicMaterial()); marker.position.set(index * 10, 3, 0);
    Object.assign(marker.userData, {editorId: 'budget-marker-' + index, editorRoom: 'hall'}); markers.set(marker.userData.editorId, marker); budgetRoot.add(marker);
    entries.push({id: 'budget-light-' + index, objectId: marker.userData.editorId, roomId: 'hall', type: 'pointLight', color: '#fff0dc', intensity: .65, range: 40});
  }
  let limit = 1;
  const budgetDocument = {studio: {entities: entries}, getObject: id => markers.get(id)}, saved = JSON.stringify(budgetDocument.studio);
  const eye = new THREE.PerspectiveCamera(); eye.position.set(0, 2, 0);
  const host = {document: budgetDocument, ctx: {graphics: {getLimits: () => ({pointLights: limit})}, camera: eye}, camera: eye, roomId: 'hall', active: false, hooks: {renderScene: budgetScene}};
  const budgetEntities = new SceneEntities(host); budgetEntities.sync();
  assert.equal(budgetEntities.stats.pointLights, 1); assert(budgetEntities.live.get('budget-light-0').object.visible);
  eye.position.x = 30; budgetEntities.sync(); assert(budgetEntities.live.get('budget-light-3').object.visible);
  assert.equal(Array.from(budgetEntities.live.values()).filter(entry => entry.object.visible).length, 1);
  limit = 4; budgetEntities.sync(); assert.equal(budgetEntities.stats.pointLights, 4);
  assert(Array.from(budgetEntities.live.values()).every(entry => entry.object.intensity === .65 && !entry.object.castShadow));
  assert.equal(JSON.stringify(budgetDocument.studio), saved);
  assert(Array.from(markers.values()).every(marker => marker.visible && marker.material.visible === false), 'Quality does not hide authored actors or turn their markers back on in public mode.');
  delete host.ctx.graphics; budgetEntities.sync(); assert.equal(budgetEntities.stats.pointLights, 4);
  budgetEntities.dispose(); markers.forEach(marker => { assert.equal(marker.material.visible, true); marker.geometry.dispose(); marker.material.dispose(); });
}
console.log('Scene entities: real point lights/cameras, physical pose independent of marker scale, settings, hidden-room release, bounded single-renderer preview, pixel orientation, error restoration and XR cleanup passed (renderer adapter).');
