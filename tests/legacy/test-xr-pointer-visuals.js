'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const read = file => fs.readFileSync(path.join(__dirname, '../../packages/render-three/src/', file), 'utf8').replace(/^import .*;\r?\n/gm, '');
const Ray = new Function('THREE', 'EventDispatcher', read('RayControl.js').replace('export var rayMaterial;', 'var rayMaterial;').replace('export default class RayControl', 'class RayControl') + '\nreturn RayControl;')(THREE, class {dispatchEvent() {}});
const {createXRGrip, updateXRGrip, disposeXRGrip} = new Function('THREE', read('XRGripTracking.js').replace(/^export /gm, '') + '\nreturn {createXRGrip,updateXRGrip,disposeXRGrip};')(THREE);
const close = (a, b, message) => assert(Math.abs(a - b) < 1e-5, message || `${a} != ${b}`);

// A real ray starts at targetRaySpace. A distant button retains its exact UVs
// and the visible metric beam/cursor terminates on that same point.
const ctx = {}, ray = new Ray(ctx), scene = new THREE.Scene(), rig = new THREE.Group(); scene.add(rig);
rig.position.set(3, 0, 1); rig.rotation.y = .25;
const right = new THREE.Group(), left = new THREE.Group(); rig.add(right, left); left.position.x = -.25;
const data = ray.addController(right, {handedness: 'right'}), leftData = ray.addController(left, {handedness: 'left'});
const surface = new THREE.Mesh(new THREE.PlaneBufferGeometry(.6, .4), new THREE.MeshBasicMaterial()); surface.position.z = -3; rig.add(surface);
let selected = 0; ray.addState('dashboard', {colliderMesh: surface, controller: 'both', captureSelect: true, consumeSelect: true, onSelectStart: hit => {assert.equal(hit.actualObject || hit.object, surface); selected++;}}, true);
scene.updateMatrixWorld(true); ray.execute(ctx, .016, 0);
assert(data.pointer.visible && leftData.pointer.visible); assert.notEqual(data.pointer, leftData.pointer);
close(data.currentIntersection.intersection.uv.x, .5); close(data.line0.scale.z, 3);
const endpoint = new THREE.Vector3(0, 0, -1).applyMatrix4(data.line0.matrixWorld), point = data.currentIntersection.intersection.point;
// updatePointer updates the origin, not the visual child matrix until render.
scene.updateMatrixWorld(true); endpoint.set(0, 0, -1).applyMatrix4(data.line0.matrixWorld); close(endpoint.distanceTo(point), 0);
close(data.pointer.getWorldPosition(new THREE.Vector3()).distanceTo(point), .002);
ray.onSelectStart({target: right}); ray.execute(ctx, .016, 1); assert.equal(data.pointer.children[0].material.color.getHex(), 0xffd169); ray.onSelectEnd({target: right}); assert.equal(selected, 1);
let cancelled = 0; ray.states.dashboard.onSelectCancel = () => cancelled++;
ray.onSelectStart({target: right}); right.userData.xrRaySuppressed = true; ray.execute(ctx, .016, 2);
assert.equal(cancelled, 1); assert(!data.pointer.visible); assert(!data.line0.visible); assert.equal(data.currentIntersection, null); assert.deepEqual(ray.selectionEntries(data), []);
ray.onSelectStart({target: right}); ray.onSelectEnd({target: right}); assert.equal(selected, 2, 'A captured wheel hand cannot also fire a dashboard.');
right.userData.xrRaySuppressed = false; ray.execute(ctx, .016, 3); assert(data.pointer.visible);
ray.onSelectStart({target: right}); right.visible = false; ray.execute(ctx, .016, 4);
assert.equal(cancelled, 2); assert(!data.pointer.visible && !data.line0.visible); assert.equal(data.currentIntersection, null);
assert.deepEqual(ray.getIntersections(right, surface), [], 'A lost targetRay pose cannot reuse the previous matrix for dashboard input.');
ray.onSelectStart({target: right}); assert(!data.active); right.visible = true; ray.execute(ctx, .016, 5); assert(data.pointer.visible);
assert.equal(data.raycasterContext.children.filter(node => node.name === 'XR precise hit cursor').length, 1);
assert.equal(leftData.raycasterContext.children.filter(node => node.name === 'XR precise hit cursor').length, 1, 'Cloning the ray never duplicates the other hand cursor.');

// Logical owner rewriting is retained for native components, but two physical
// sibling buttons do not merge merely because they share an equipment actor.
const actor = new THREE.Group(); actor.userData.editorId = 'equipment';
const a = new THREE.Mesh(), b = new THREE.Mesh(); actor.add(a, b);
const stateA = {mergeSelection: true}, stateB = {mergeSelection: true}; ray.states.a = stateA; ray.states.b = stateB;
data.currentIntersection = {state: stateA, intersection: {object: actor, actualObject: a, distance: 1}};
data.intersections = {a: data.currentIntersection.intersection, b: {object: actor, actualObject: b, distance: 1}};
assert.equal(ray.selectionEntries(data).length, 1, 'A neighbouring button never receives the original button press.');
ray.dispose(); assert.equal(ray.controllers.length, 0);

// Both runtimes call this bridge. It renders without any downloaded model and
// follows gripSpace, while controller rays remain in targetRaySpace.
const reference = {}, renderer = {xr: {getReferenceSpace: () => reference}}, controller = new THREE.Group(); rig.add(controller);
const grip = createXRGrip(renderer, controller, 0); rig.add(grip); const visual = grip.xrInputVisual;
const source = {handedness: 'right', gripSpace: {}, gamepad: {buttons: [{value: 0}, {value: 0}]}};
const matrix = new THREE.Matrix4().makeTranslation(.2, 1.2, -.4).toArray(), frame = {getPose: () => ({transform: {matrix}})};
updateXRGrip(renderer, controller, source, frame); assert(grip.visible && visual.root.visible); assert.equal(controller.userData.xrHandVisualMode, 'controller-animated');
const neutralIndex = visual.fingers[0][0].rotation.x, neutralGrip = visual.fingers[1][0].rotation.x;
source.gamepad.buttons[0].value = .9; source.gamepad.buttons[1].value = 1; updateXRGrip(renderer, controller, source, frame);
assert(visual.fingers[0][0].rotation.x > neutralIndex && visual.fingers[1][0].rotation.x > neutralGrip);
const allocation = [visual.geometry.size, visual.materials.size, grip.children.length, rig.children.length];
for (let index = 0; index < 1000; index++) updateXRGrip(renderer, controller, source, frame);
assert.deepEqual([visual.geometry.size, visual.materials.size, grip.children.length, rig.children.length], allocation, 'Pose updates allocate no geometry, materials or scene nodes.');
assert(visual.batches.filter(batch => batch.root === visual.root).length <= 8, 'Local controller and glove share at most eight instanced draw batches per hand.');
assert.equal(new THREE.Raycaster().intersectObject(visual.root, true).length, 0, 'Hands/controllers cannot intercept dashboard or teleport rays.');
updateXRGrip(renderer, controller, source, {getPose: () => null}); assert(!grip.visible && !visual.root.visible, 'Lost controller tracking never leaves a floating glove.');

// A real XRHand is drawn only from valid measured joint poses. A lost joint is
// hidden rather than extrapolated or replaced with controller finger animation.
const hand = new Map([['wrist', {}], ['index-finger-metacarpal', {}], ['index-finger-phalanx-proximal', {}]]);
const tracked = {handedness: 'left', hand, targetRayMode: 'tracked-pointer'}, poses = new Map([...hand.values()].map((joint, index) => [joint, {radius: .006, transform: {matrix: new THREE.Matrix4().makeTranslation(.1, 1.1 + .02 * index, -.3).toArray()}}]));
updateXRGrip(renderer, controller, tracked, {getJointPose: joint => poses.get(joint)});
assert(!visual.root.visible && visual.tracked.visible); assert.equal(controller.userData.xrHandVisualMode, 'tracked'); assert.equal(visual.tracked.parent, rig);
assert(visual.joints.get('wrist').visible); assert(!visual.joints.get('thumb-tip').visible); close(visual.joints.get('wrist').position.y, 1.1);
poses.clear(); updateXRGrip(renderer, controller, tracked, {getJointPose: joint => poses.get(joint)}); assert(!visual.tracked.visible);
updateXRGrip(renderer, controller, null); assert(!visual.root.visible && !visual.tracked.visible);
const owned = [...visual.geometry, ...visual.materials]; let disposed = 0; owned.forEach(value => value.addEventListener('dispose', () => disposed++));
disposeXRGrip(controller); assert.equal(disposed, owned.length); assert(!grip.xrInputVisual); assert(!rig.children.includes(visual.tracked)); assert.equal(grip.children.length, 0); disposeXRGrip(controller);
console.log('XR pointer/visuals: exact distant hit, independent cursors, sibling button isolation, wheel ray suppression, local instanced controller/glove, measured hand joints, tracking loss, stable pose resources and disposal passed.');
