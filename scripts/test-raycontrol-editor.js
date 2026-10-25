const assert = require('assert');
const fs = require('fs');
const path = require('path');
const THREE = require('three');
const source = fs.readFileSync(path.join(__dirname, '../src/lib/RayControl.js'), 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace('export var rayMaterial;', 'var rayMaterial;')
  .replace('export default class RayControl', 'class RayControl');
const RayControl = new Function('THREE', 'EventDispatcher', source + '\nreturn RayControl;')(THREE, class {
  dispatchEvent() {}
});
const model = new THREE.Group();
const beam = new THREE.Mesh(new THREE.BoxBufferGeometry(), new THREE.MeshBasicMaterial());
beam.name = 'beam'; model.add(beam);
const ray = new RayControl({assets: {teleport_model: {scene: model}, beam_tex: new THREE.Texture()}, shaders: {basic_vert: '', beam_frag: ''}}, 'right');
const controller = new THREE.Group(); controller.userData.isDesktop = true;
const data = ray.addController(controller, {handedness: 'right'});
const parent = new THREE.Group();
const surface = new THREE.Mesh(new THREE.BoxBufferGeometry(), new THREE.MeshBasicMaterial());
surface.position.z = -2; parent.add(surface); parent.updateMatrixWorld(true); controller.updateMatrixWorld(true);
surface.material.visible = false;
assert(ray.getIntersections(controller, surface).length > 0, 'Native teleport materials stay selectable');
parent.visible = false;
assert.strictEqual(ray.getIntersections(controller, surface).length, 0, 'A hidden ancestor suppresses selection');
parent.visible = true; surface.visible = false;
assert.strictEqual(ray.getIntersections(controller, [surface]).length, 0, 'Hidden array colliders are also ignored');
surface.visible = true;
let customStarts = 0, fallbackStarts = 0, fallbackEnds = 0, hoverLeaves = 0;
const custom = ray.addState('custom', {colliderMesh: surface, consumeSelect: true,
  onSelectStart: () => customStarts++, onHoverLeave: () => hoverLeaves++}, true);
ray.addState('panorama-return', {raycaster: false, onSelectStart: () => fallbackStarts++, onSelectEnd: () => fallbackEnds++}, true);
data.currentIntersection = {state: custom, intersection: {object: surface}};
ray.onSelectStart({target: controller}); ray.onSelectEnd({target: controller});
assert.strictEqual(customStarts, 1); assert.strictEqual(fallbackStarts, 0); assert.strictEqual(fallbackEnds, 0);
custom.consumeSelect = false;
ray.onSelectStart({target: controller}); ray.onSelectEnd({target: controller});
assert.strictEqual(fallbackStarts, 1); assert.strictEqual(fallbackEnds, 1, 'Native panorama background behavior remains available');
ray.disable();
assert.strictEqual(hoverLeaves, 1); assert.strictEqual(data.currentIntersection, null);
assert.deepStrictEqual(data.intersections, {}); assert.strictEqual(data.active, false);
ray.enable(); assert.strictEqual(ray.enabled, true);

function fixture() {
  const assets = new THREE.Group();
  const beam = new THREE.Mesh(new THREE.BoxBufferGeometry(), new THREE.MeshBasicMaterial());
  beam.name = 'beam'; assets.add(beam);
  const ctx = {assets: {teleport_model: {scene: assets}, beam_tex: new THREE.Texture()}, shaders: {basic_vert: '', beam_frag: ''}};
  const ray = new RayControl(ctx, 'right');
  const controller = new THREE.Group(); controller.userData.isDesktop = true;
  const data = ray.addController(controller, {handedness: 'right'});
  controller.updateMatrixWorld(true);
  return {ctx, ray, controller, data};
}

// Visual ownership stops at the nearest registered logical descendant. Keeping
// actualObject and UV coordinates is essential for replacement paintings/graffiti.
const visual = fixture();
const actor = new THREE.Group(); actor.userData.editorId = 'copy-1';
const content = new THREE.Group(); content.userData.editorVisualOwnerId = 'copy-1'; actor.add(content);
const note = new THREE.Group(); note.userData.editorId = 'copy-1/0'; content.add(note);
const noteMesh = new THREE.Mesh(); note.add(noteMesh);
const registered = new Map([[actor.userData.editorId, actor], [note.userData.editorId, note]]);
visual.ctx.editor = {document: {getObject: id => registered.get(id)}};
const uv = new THREE.Vector2(0.2, 0.7), point = new THREE.Vector3(1, 2, 3);
const logicalHit = visual.ray.filterVisible([{object: noteMesh, distance: 2, uv, point}])[0];
assert.strictEqual(logicalHit.object, note, 'Copied descendant retains its own logical identity');
assert.strictEqual(logicalHit.actualObject, noteMesh); assert.strictEqual(logicalHit.uv, uv);
assert.strictEqual(logicalHit.point, point); assert.strictEqual(logicalHit.distance, 2);
const infoHelper = new THREE.Mesh(); infoHelper.userData.editorRuntimeHelper = true;
infoHelper.userData.editorVisualOwnerId = 'copy-1'; actor.add(infoHelper);
const infoHit = visual.ray.filterVisible([{object: infoHelper, distance: 1}])[0];
assert.strictEqual(infoHit.object, actor, 'Interactive information helpers retain their logical owner');
assert.strictEqual(infoHit.actualObject, infoHelper, 'Only decal helpers are transparent to ray selection');
const replacement = new THREE.Group(); replacement.userData.editorVisualOwnerId = 'copy-1/0'; note.add(replacement);
const replacementMesh = new THREE.Mesh(); replacement.add(replacementMesh);
// Imported userData can contain a stale id; only the document owns identities.
replacementMesh.userData.editorId = 'copy-1';
const replacedHit = visual.ray.filterVisible([{object: replacementMesh, distance: 1, uv, point}])[0];
assert.strictEqual(replacedHit.object, note, 'Replacement geometry resolves to its owner rather than the outer actor');
assert.strictEqual(replacedHit.actualObject, replacementMesh); assert.strictEqual(replacedHit.uv, uv);
noteMesh.userData.editorGeometryReplaced = true;
assert.deepStrictEqual(visual.ray.filterVisible([{object: noteMesh}]), [], 'Old replaced geometry never remains clickable');
note.visible = false;
assert.deepStrictEqual(visual.ray.filterVisible([{object: replacementMesh}]), [], 'Hidden owner suppresses replacement hits');

// A decal is closer to the controller than its decorated surface. Both native
// actions and broad room colliders must still receive the original surface hit,
// point and UV coordinates rather than an image projection or decal owner.
const decorated = fixture(), room = new THREE.Group();
const paintSurface = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 2), new THREE.MeshBasicMaterial());
paintSurface.position.z = -2; room.add(paintSurface);
const decalOwner = new THREE.Group(); decalOwner.userData.editorId = 'decal-owner'; room.add(decalOwner);
const decalMesh = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 2), new THREE.MeshBasicMaterial());
decalMesh.position.z = -1.99;
Object.assign(decalMesh.userData, {editorRuntimeHelper: true, editorDecal: true, editorVisualOwnerId: 'decal-owner'});
decalOwner.add(decalMesh); room.updateMatrixWorld(true);
const originalHits = decorated.ray.getIntersections(decorated.controller, paintSurface);
const decoratedHits = decorated.ray.getIntersections(decorated.controller, room);
assert(decoratedHits.length > 0);
assert.strictEqual(decoratedHits[0].object, paintSurface, 'A nearest decal never absorbs graffiti or portal selection');
assert.strictEqual(decoratedHits[0].distance, originalHits[0].distance);
assert.deepStrictEqual(decoratedHits[0].uv.toArray(), originalHits[0].uv.toArray(), 'Native paint UV coordinates remain unchanged');
assert.deepStrictEqual(decoratedHits[0].point.toArray(), originalHits[0].point.toArray());
assert.deepStrictEqual(decorated.ray.getIntersections(decorated.controller, [decalOwner]), [], 'A decal-only state never receives actions');
let decoratedStarts = 0, decalStarts = 0;
decorated.ray.addState('native-decorated-surface', {colliderMesh: room, onSelectStart(hit) {
  assert.strictEqual(hit.object, paintSurface); decoratedStarts++;
}}, true);
decorated.ray.addState('decal-only', {colliderMesh: decalOwner, onSelectStart() { decalStarts++; }}, true);
decorated.ray.execute(decorated.ctx, 0.016, 1);
decorated.ray.onSelectStart({target: decorated.controller}); decorated.ray.onSelectEnd({target: decorated.controller});
assert.strictEqual(decoratedStarts, 1); assert.strictEqual(decalStarts, 0);
paintSurface.material.visible = false;
assert.strictEqual(decorated.ray.getIntersections(decorated.controller, room)[0].object, paintSurface,
  'A decal over an invisible native teleport material still exposes the teleport surface');
const nestedDecal = new THREE.Mesh(new THREE.PlaneBufferGeometry(), new THREE.MeshBasicMaterial());
decalMesh.add(nestedDecal); room.updateMatrixWorld(true);
assert.deepStrictEqual(decorated.ray.getIntersections(decorated.controller, nestedDecal), [], 'Decal descendant meshes are also transparent to ray input');

// Native callbacks, a new component and a legacy action share the same hit.
// A separate collider at the same distance must remain unrelated.
const merged = fixture();
const owner = new THREE.Group();
const mesh = new THREE.Mesh(new THREE.BoxBufferGeometry(), new THREE.MeshBasicMaterial());
mesh.position.z = -2; owner.add(mesh); owner.updateMatrixWorld(true);
const unrelated = new THREE.Mesh(new THREE.BoxBufferGeometry(), new THREE.MeshBasicMaterial());
unrelated.position.z = -2; unrelated.updateMatrixWorld(true);
const counts = {};
const callback = (name, event) => (hit, control) => {
  const key = name + ':' + event; counts[key] = (counts[key] || 0) + 1;
  assert.strictEqual(hit.object, name === 'unrelated' ? unrelated : mesh);
  if (event !== 'hover' && event !== 'leave') assert.strictEqual(control, merged.controller);
};
['native', 'component', 'legacy', 'unrelated'].forEach(name => {
  merged.ray.addState(name, {
    colliderMesh: name === 'unrelated' ? unrelated : name === 'component' ? owner : mesh,
    mergeSelection: name !== 'native', consumeSelect: name !== 'native',
    onHover: callback(name, 'hover'), onHoverLeave: callback(name, 'leave'),
    onSelectStart: callback(name, 'start'), onSelectEnd: callback(name, 'end')
  }, true);
});
let backgroundStarts = 0;
merged.ray.addState('background', {raycaster: false, onSelectStart() { backgroundStarts++; }}, true);
merged.ray.execute(merged.ctx, 0.016, 1);
merged.ray.onSelectStart({target: merged.controller}); merged.ray.onSelectEnd({target: merged.controller});
['native', 'component', 'legacy'].forEach(name => {
  assert.strictEqual(counts[name + ':hover'], 1);
  assert.strictEqual(counts[name + ':start'], 1);
  assert.strictEqual(counts[name + ':end'], 1);
});
assert.strictEqual(counts['unrelated:start'], undefined, 'Equal-distance unrelated objects do not join selection');
assert.strictEqual(backgroundStarts, 0, 'Any merged consuming component prevents background actions');
merged.ray.deactivateState('component');
assert.strictEqual(counts['component:leave'], 1, 'Removing a merged secondary component balances its hover');
merged.ray.disable();
assert.strictEqual(counts['native:leave'], 1); assert.strictEqual(counts['legacy:leave'], 1);
assert.strictEqual(counts['component:leave'], 1, 'Disable must not emit duplicate secondary leaves');
merged.ray.enable(); merged.ray.execute(merged.ctx, 0.016, 2);
merged.ray.deactivateAll();
assert.strictEqual(counts['native:leave'], 2); assert.strictEqual(counts['legacy:leave'], 2);
assert.deepStrictEqual(merged.data.hoverEntries, []); assert.deepStrictEqual(merged.data.intersections, {});

// Handedness changes clear cached hits immediately; controller removal also
// cleans every merged hover entry instead of leaving an object highlighted.
const handed = fixture();
const handedSurface = new THREE.Mesh(new THREE.BoxBufferGeometry(), new THREE.MeshBasicMaterial());
handedSurface.position.z = -2; handedSurface.updateMatrixWorld(true);
let handLeaves = 0, handStarts = 0;
handed.ray.addState('primary', {colliderMesh: handedSurface, onHoverLeave() { handLeaves++; }, onSelectStart() { handStarts++; }}, true);
handed.ray.execute(handed.ctx, 0.016, 1);
assert(handed.data.currentIntersection);
handed.ray.changeHandedness('left'); handed.ray.execute(handed.ctx, 0.016, 2);
assert.strictEqual(handed.data.currentIntersection, null); assert.strictEqual(handLeaves, 1);
handed.ray.onSelectStart({target: handed.controller}); assert.strictEqual(handStarts, 0);
handed.ray.changeHandedness('right'); handed.ray.execute(handed.ctx, 0.016, 3);
handed.ray.removeController(handed.controller);
assert.strictEqual(handLeaves, 2); assert.strictEqual(handed.ray.controllers.length, 0);
handed.ray.removeController(handed.controller); assert.strictEqual(handed.ray.controllers.length, 0);

// Desktop never receives VR-only background release events.
const desktop = fixture();
let vrEvents = 0;
desktop.ray.addState('vr-background', {raycaster: false, vrOnly: true,
  onSelectStart() { vrEvents++; }, onSelectEnd() { vrEvents++; }}, true);
desktop.ray.onSelectStart({target: desktop.controller}); desktop.ray.onSelectEnd({target: desktop.controller});
assert.strictEqual(vrEvents, 0);

// Removing an unrelated component during a native press must not turn its
// uncaptured release into an empty capture. Teleport still uses the new point.
const nativeRelease = fixture();
const nativeTarget = new THREE.Mesh(new THREE.BoxBufferGeometry(), new THREE.MeshBasicMaterial());
let releasedAt = null;
const travel = nativeRelease.ray.addState('travel', {colliderMesh: nativeTarget,
  onSelectEnd: hit => { releasedAt = hit.point.x; }}, true);
nativeRelease.ray.addState('unrelated-control', {colliderMesh: new THREE.Group(), captureSelect: true}, true);
nativeRelease.data.currentIntersection = {state: travel, intersection: {object: nativeTarget, point: new THREE.Vector3(1, 0, 0)}};
nativeRelease.ray.onSelectStart({target: nativeRelease.controller});
nativeRelease.ray.deactivateState('unrelated-control'); nativeRelease.ray.deactivateState('unknown');
assert.strictEqual(nativeRelease.data.selectionCapture, null);
nativeRelease.data.currentIntersection.intersection = {object: nativeTarget, point: new THREE.Vector3(2, 0, 0)};
nativeRelease.ray.onSelectEnd({target: nativeRelease.controller});
assert.strictEqual(releasedAt, 2, 'Native releases keep their current endpoint after unrelated state cleanup');

// Native proximity grabbing may suspend one ray between input events, before
// another render frame. Its quick release cannot activate a background action.
nativeRelease.ray.onSelectStart({target: nativeRelease.controller});
nativeRelease.data.enabled = false; releasedAt = null;
nativeRelease.ray.onSelectEnd({target: nativeRelease.controller});
assert.strictEqual(releasedAt, null); assert.strictEqual(nativeRelease.data.active, false);

// Non-spatial native actions (panorama return, for example) must obey the same
// handedness selector as spatial states. Repeated room activation is idempotent.
const backgroundHands = fixture();
backgroundHands.controller.userData.isDesktop = false;
const leftHand = new THREE.Group();
const leftSource = {handedness: 'left', gamepad: {id: 'old-left'}};
const leftData = backgroundHands.ray.addController(leftHand, leftSource);
let primaryBackground = 0, bothBackground = 0, cancelledReplacement = 0;
backgroundHands.ray.addState('primary-return', {raycaster: false, controller: 'primary',
  onSelectStart() { primaryBackground++; }, onSelectEnd() { primaryBackground++; }}, true);
backgroundHands.ray.addState('bilateral-return', {raycaster: false, controller: 'both',
  onSelectStart() { bothBackground++; }, onSelectEnd() { bothBackground++; }}, true);
backgroundHands.ray.activateState('primary-return'); backgroundHands.ray.activateState('bilateral-return');
assert.strictEqual(backgroundHands.ray.currentStates.length, 2, 'Activating an existing native state cannot duplicate its callbacks');
backgroundHands.ray.onSelectStart({target: leftHand}); backgroundHands.ray.onSelectEnd({target: leftHand});
assert.strictEqual(primaryBackground, 0, 'Secondary hand never starts or releases primary-only panorama return');
assert.strictEqual(bothBackground, 2, 'Explicit bilateral native backgrounds remain usable from either hand');
backgroundHands.ray.changeHandedness('left');
backgroundHands.ray.onSelectStart({target: leftHand}); backgroundHands.ray.onSelectEnd({target: leftHand});
assert.strictEqual(primaryBackground, 2);
const replacementCapture = backgroundHands.ray.addState('replacement-button', {colliderMesh: surface, controller: 'both', captureSelect: true,
  onSelectCancel() { cancelledReplacement++; }}, true);
leftData.currentIntersection = {state: replacementCapture, intersection: {object: surface}};
backgroundHands.ray.onSelectStart({target: leftHand});
const nextSource = {handedness: 'right', gamepad: {id: 'new-right'}};
const replacementData = backgroundHands.ray.addController(leftHand, nextSource);
assert.notStrictEqual(replacementData, leftData);
assert.strictEqual(replacementData.inputSource, nextSource, 'A reused XR target-ray group receives its replacement gamepad and handedness');
assert.strictEqual(cancelledReplacement, 1, 'Replacing an input source releases the original physical capture');
assert.strictEqual(replacementData.active, false); assert.strictEqual(replacementData.currentIntersection, null);
assert.strictEqual(leftHand.children.filter(child => child.name === 'raycasterContext').length, 1, 'A reused XR group keeps one ray origin');
assert.strictEqual(backgroundHands.ray.addController(leftHand, nextSource), replacementData, 'An identical connection notification stays idempotent');

console.log('RayControl: hidden hierarchy, native teleport materials, logical clone/visual replacement identities, UV preservation through decals, merged native/component/legacy selection, unrelated occlusion, balanced hover cleanup, handedness and VR-only desktop filtering passed.');
