// Uses real Three.js transforms/mixers, with adapters for ray input and WebAudio.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const behaviorSchema = require('../shared/behaviors.js');
const {definitions, normalizeBehaviors, defaultBehavior} = behaviorSchema;

definitions.forEach(definition => {
  const defaults = defaultBehavior(definition.type);
  assert.deepEqual(normalizeBehaviors([{type: definition.type}]), [defaults]);
  assert.deepEqual(normalizeBehaviors([defaults]), [defaults]);
});
assert.deepEqual(normalizeBehaviors(), []);
assert.equal(normalizeBehaviors([{type: 'portal', enabled: false}])[0].enabled, false);
assert.equal(normalizeBehaviors([{type: 'info', color: '#ABCDEF'}])[0].color, '#abcdef');
assert(!Object.hasOwn(normalizeBehaviors([{type: 'float', onSelectStart: 'ignored'}])[0], 'onSelectStart'));
assert.throws(() => normalizeBehaviors([{type: 'unknown'}]), /compatible/);
assert.throws(() => normalizeBehaviors([{type: 'portal'}, {type: 'portal'}]), /repetirse/);
assert.throws(() => normalizeBehaviors(Array(17).fill({type: 'float'})), /16/);
assert.throws(() => normalizeBehaviors([{type: 'portal', room: 1.5}]), /rango/);
assert.equal(normalizeBehaviors([{type: 'portal', hoverScale: 0.8}])[0].hoverScale, 0.8,
  'Native portals can expand within their original scale below one');
assert.throws(() => normalizeBehaviors([{type: 'portal', hoverScale: 0}]), /rango/);
assert.throws(() => normalizeBehaviors([{type: 'float', amplitude: -1}]), /rango/);
assert.throws(() => normalizeBehaviors([{type: 'float', speed: Infinity}]), /rango/);
assert.throws(() => normalizeBehaviors([{type: 'grab', returnOnRelease: 'yes'}]), /inválido/);
assert.throws(() => normalizeBehaviors([{type: 'info', text: 'x'.repeat(2001)}]), /largo/);
assert.throws(() => normalizeBehaviors([{type: 'info', color: '#abc'}]), /color/);
assert.throws(() => normalizeBehaviors([{type: 'portal', event: 'click'}]), /Opción/);
for (const asset of ['https://evil.test/a.ogg', '//evil.test/a.ogg', '/etc/a.ogg', '../a.ogg',
  'a/../b.ogg', 'C:\\a.ogg', 'javascript:alert(1)', '%2e%2e/a.ogg', 'a.ogg?redirect=x', 'a\u0000.ogg']) {
  assert.throws(() => normalizeBehaviors([{type: 'sound', asset}]), /archivo/);
  assert.throws(() => normalizeBehaviors([{type: 'news', url: asset}]), /archivo/);
}
assert.equal(normalizeBehaviors([{type: 'sound', asset: 'batch-123-file-1'}])[0].asset, 'batch-123-file-1');

const loads = [], audioNodes = [];
class AudioAdapter extends THREE.Object3D {
  constructor() { super(); this.isPlaying = false; this.plays = 0; this.stops = 0; audioNodes.push(this); }
  setVolume(value) { this.volume = value; }
  setRefDistance(value) { this.distance = value; }
  setBuffer(value) { this.buffer = value; }
  play() { this.isPlaying = true; this.plays++; }
  stop() { this.isPlaying = false; this.stops++; }
}
class AudioLoaderAdapter {
  load(url, success, progress, error) { loads.push({url, success, error}); }
}
const runtimeThree = Object.assign({}, THREE, {PositionalAudio: AudioAdapter, AudioLoader: AudioLoaderAdapter});
const source = fs.readFileSync(path.join(__dirname, '../src/editor/BehaviorRuntime.js'), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export default class BehaviorRuntime', 'return class BehaviorRuntime');
const BehaviorRuntime = new Function('THREE', 'behaviorSchema', source)(runtimeThree, behaviorSchema);

function harness(objects) {
  const nativeState = {colliderMesh: objects[0]};
  const notices = [], teleport = [];
  const ctx = {
    editor: {active: false}, audioListener: {}, goto: 0,
    raycontrol: {
      states: {'original-state': nativeState}, active: new Set(['original-state']),
      addState(name, state) { assert(!this.states[name]); this.states[name] = state; },
      activateState(name) { this.active.add(name); },
      deactivateState(name) { this.active.delete(name); }
    },
    teleport: {
      onHover(point, active) { teleport.push(['hover', point, active]); },
      onHoverLeave() { teleport.push(['leave']); },
      onSelectStart(controller) { teleport.push(['start', controller]); },
      onSelectEnd(point) { teleport.push(['end', point]); }
    }
  };
  const document = {getObjects: () => objects, getBehaviors: object => object.userData.editorBehaviors || object.userData.editorDefaultBehaviors || []};
  const runtime = new BehaviorRuntime(ctx, document, {getURL: asset => 'assets/' + asset}, notice => notices.push(notice));
  return {ctx, runtime, notices, nativeState, teleport};
}

// Decals belong to the persistent renderer. Play/VR must not create a second
// adapter, report an unavailable function, or interfere with a portal component
// attached to the same logical object.
const decalOnly = new THREE.Group();
decalOnly.userData.editorBehaviors = [{type: 'decal', asset: 'paintings/sign.png'}];
const decoratedPortal = new THREE.Group();
decoratedPortal.userData.editorBehaviors = [{type: 'decal', asset: 'paintings/sign.png'}, {type: 'portal', room: 2}];
const decalHarness = harness([decalOnly, decoratedPortal]);
decalHarness.ctx.editorBehaviorAdapters = {decal() { throw new Error('The persistent decal renderer owns this function'); }};
decalHarness.runtime.start('hall');
assert.deepEqual(decalHarness.notices, []);
assert.equal(decalHarness.runtime.components.length, 1, 'Only the portal creates a play-mode component');
assert.equal(decalHarness.runtime.states.length, 1, 'A decal alone never registers an interactive collider');
decalHarness.runtime.states[0].state.onSelectStart({}, {});
assert.equal(decalHarness.ctx.goto, 2, 'The original portal remains functional on a decorated object');
decalHarness.runtime.stop();
assert.deepEqual(decalHarness.notices, []);

const original = new THREE.Object3D();
original.userData.editorDefaultBehaviors = [{type: 'portal', room: 1}];
original.userData.editorNativeBehaviorTypes = ['portal'];
const first = new THREE.Group();
first.position.set(1, 2, 3);
first.scale.set(2, 3, 4);
first.userData.editorBehaviors = [
  {type: 'portal', room: 4, hoverScale: 2}, {type: 'float', amplitude: 0.5, speed: 1},
  {type: 'info', title: 'Independent'}, {type: 'sound', asset: 'ogg/test.ogg', volume: 0.4}
];
const second = new THREE.Group();
second.userData.editorBehaviors = [{type: 'portal', room: 5, event: 'release'}, {type: 'sound', asset: 'ogg/test.ogg', autoplay: true, interval: 1}];
const floor = new THREE.Mesh();
floor.userData.editorBehaviors = [{type: 'teleport'}];
first.add(floor);
const visualContent = new THREE.Group();
visualContent.userData.editorVisualOwnerId = 'first-wrapper';
visualContent.userData.editorDefaultBehaviors = first.userData.editorBehaviors;
first.add(visualContent);
const h = harness([original, first, second, floor]);
let clicked = 0, ticked = 0, disposed = 0;
h.ctx.editorBehaviorAdapters = {info: (ctx, object, config, library) => {
  assert.equal(object, first); assert.equal(config.title, 'Independent'); assert(library.getURL);
  return {state: {onSelectStart() { clicked++; }}, execute() { ticked++; }, dispose() { disposed++; }};
}};
h.runtime.start('hall');
assert.equal(h.runtime.states.length, 3, 'One selection state per object, including nested assets exactly once');
assert.equal(audioNodes.length, 2, 'Copied sound properties create distinct audio players');
const firstState = h.runtime.states.find(entry => entry.state.colliderMesh === first).state;
const secondState = h.runtime.states.find(entry => entry.state.colliderMesh === second).state;
const floorState = h.runtime.states.find(entry => entry.state.colliderMesh === floor).state;
assert.equal(firstState.mergeSelection, true);
firstState.onHover({}, false, {});
assert.deepEqual(first.scale.toArray(), [4, 6, 8]);
firstState.onSelectStart({point: new THREE.Vector3()}, {});
assert.equal(h.ctx.goto, 4); assert.equal(clicked, 1);
assert.equal(audioNodes[0].plays, 0, 'Click while loading queues playback');
loads[0].success({id: 'first-buffer'}); loads[1].success({id: 'second-buffer'});
assert.equal(audioNodes[0].plays, 1); assert.equal(audioNodes[1].plays, 1);
assert.notEqual(audioNodes[0], audioNodes[1]);
h.runtime.execute(1, 1);
assert.equal(audioNodes[0].plays, 1); assert.equal(audioNodes[1].plays, 2, 'Autoplay intervals tick without timers');
assert(Math.abs(first.position.y - (2 + Math.sin(1) * 0.5)) < 1e-8);
second.visible = false;
h.runtime.execute(0.1, 1.1);
assert.equal(audioNodes[1].isPlaying, false, 'Hiding an object stops its automatic audio');
h.runtime.execute(2, 3.1);
assert.equal(audioNodes[1].plays, 2, 'Hidden autoplay never restarts');
second.visible = true;
h.runtime.execute(0, 3.1);
assert.equal(audioNodes[1].plays, 3, 'Showing an object resumes autoplay');
assert.equal(ticked, 4);
secondState.onSelectStart({}, {}); assert.equal(h.ctx.goto, 4);
secondState.onSelectEnd({}, {}); assert.equal(h.ctx.goto, 5, 'Release portal fires only on release');
const point = new THREE.Vector3(2, 0, 4);
floorState.onHover({point}, false, {}); floorState.onSelectStart({point}, {}); floorState.onSelectEnd({point}, {});
assert.deepEqual(h.teleport.map(event => event[0]), ['hover', 'start', 'end']);
h.ctx.editor.active = true;
firstState.onSelectStart({}, {}); h.runtime.execute(1, 2);
assert.equal(clicked, 1); assert.equal(ticked, 4, 'Editor mode never executes game components');
h.runtime.stop();
assert.deepEqual(first.position.toArray(), [1, 2, 3]); assert.deepEqual(first.scale.toArray(), [2, 3, 4]);
assert.equal(disposed, 1); assert.equal(audioNodes[0].parent, null); assert(!audioNodes[0].isPlaying);
assert.equal(h.ctx.raycontrol.states['original-state'], h.nativeState);
assert.deepEqual(Object.keys(h.ctx.raycontrol.states), ['original-state'], 'Cleanup removes only owned states');

// Panoramic and door portals use ShaderMaterial effects in addition to their
// destination. A copied material must animate and highlight independently.
const portalSource = new THREE.Mesh(new THREE.SphereBufferGeometry(), new THREE.ShaderMaterial({
  uniforms: {time: {value: 11}, selected: {value: 0.7}}
}));
portalSource.userData.editorId = 'native-portal';
portalSource.userData.editorDefaultBehaviors = [{type: 'portal', room: 4}];
portalSource.userData.editorNativeBehaviorTypes = ['portal'];
function copiedPortal(id) {
  const object = new THREE.Group();
  object.userData.editorId = id;
  object.userData.editorBehaviors = [{type: 'portal', room: 4, event: 'release', hoverScale: 1.2}];
  object.add(new THREE.Mesh(portalSource.geometry, portalSource.material.clone()));
  return object;
}
const portalFirst = copiedPortal('copied-portal-1'), portalSecond = copiedPortal('copied-portal-2');
const nestedPortal = copiedPortal('independent-child'); portalFirst.add(nestedPortal);
const ownVisual = new THREE.Mesh(portalSource.geometry, portalSource.material.clone());
ownVisual.userData.editorVisualOwnerId = 'copied-portal-1'; portalFirst.add(ownVisual);
const foreignVisual = new THREE.Mesh(portalSource.geometry, portalSource.material.clone());
foreignVisual.userData.editorVisualOwnerId = 'another-owner'; portalFirst.add(foreignVisual);
const hiddenSource = new THREE.Mesh(portalSource.geometry, portalSource.material.clone());
hiddenSource.userData.editorGeometryReplaced = true; portalFirst.add(hiddenSource);
const helperVisual = new THREE.Mesh(portalSource.geometry, portalSource.material.clone());
helperVisual.userData.editorRuntimeHelper = true; portalFirst.add(helperVisual);
const portalHarness = harness([portalSource, portalFirst, portalSecond, nestedPortal]);
portalHarness.runtime.start('hall');
const firstPortalState = portalHarness.runtime.states.find(entry => entry.state.colliderMesh === portalFirst).state;
const secondPortalState = portalHarness.runtime.states.find(entry => entry.state.colliderMesh === portalSecond).state;
const firstUniforms = portalFirst.children[0].material.uniforms;
const secondUniforms = portalSecond.children[0].material.uniforms;
const nestedUniforms = nestedPortal.children[0].material.uniforms;
assert.equal(firstUniforms.selected.value, 0, 'A copied hover is cleared when playback starts');
assert.equal(secondUniforms.selected.value, 0);
assert.equal(portalSource.material.uniforms.selected.value, 0.7, 'The native material belongs to its original station');
firstPortalState.onHover({}, false, {});
portalHarness.runtime.execute(0.25, 3);
assert.equal(firstUniforms.time.value, 11.25, 'The copied shader advances from its captured phase');
assert.equal(firstUniforms.selected.value, 0.1);
assert.equal(secondUniforms.selected.value, 0, 'Hovering one copy never highlights another');
assert.equal(ownVisual.material.uniforms.selected.value, 0.1, 'An actor can animate its own replacement visual');
assert.equal(nestedUniforms.selected.value, 0, 'A parent portal never owns the effects of another logical object');
assert.equal(foreignVisual.material.uniforms.selected.value, 0.7, 'Replacement visuals retain their own owner');
assert.equal(hiddenSource.material.uniforms.time.value, 11, 'Replaced geometry stays untouched');
assert.equal(helperVisual.material.uniforms.time.value, 11, 'Runtime helpers stay untouched');
firstPortalState.onHoverLeave({}, false, {}); secondPortalState.onHover({}, false, {});
portalHarness.runtime.execute(0.25, 3.25);
assert(Math.abs(firstUniforms.selected.value - 0.09) < 1e-10, 'Hover fades independently after leaving');
assert.equal(secondUniforms.selected.value, 0.1);
assert.equal(nestedUniforms.time.value, 11.5);
assert.equal(portalSource.material.uniforms.time.value, 11);
firstPortalState.onSelectEnd({}, {}); assert.equal(portalHarness.ctx.goto, 4);
portalHarness.ctx.editor.active = true;
portalHarness.runtime.execute(1, 4.25); assert.equal(firstUniforms.time.value, 11.5);
portalHarness.runtime.stop();
assert.equal(firstUniforms.time.value, 11, 'Returning to the editor restores the captured shader phase');
assert.equal(secondUniforms.time.value, 11);
assert.equal(firstUniforms.selected.value, 0); assert.equal(secondUniforms.selected.value, 0);
assert.equal(ownVisual.material.uniforms.selected.value, 0);
assert.equal(portalSource.material.uniforms.selected.value, 0.7);
assert.deepEqual(portalFirst.scale.toArray(), [1, 1, 1]);

// A stale asynchronous audio load must never restart a scene after editing.
const late = new THREE.Group(); late.userData.editorBehaviors = [{type: 'sound', asset: 'ogg/late.ogg', autoplay: true}];
const lateHarness = harness([late]); lateHarness.runtime.start('hall');
const lastAudio = audioNodes[audioNodes.length - 1], lastLoad = loads[loads.length - 1];
lateHarness.runtime.stop(); lastLoad.success({id: 'late'});
assert.equal(lastAudio.plays, 0); assert.equal(lastAudio.parent, null);

// Fresh mixers bind identical clips against each instance's own hierarchy.
const animated = new THREE.Object3D();
animated.animations = [new THREE.AnimationClip('Move', 1, [new THREE.NumberKeyframeTrack('.position[x]', [0, 1], [0, 2])])];
animated.userData.editorBehaviors = [{type: 'animation', clip: 'Move', speed: 1}];
const animatedCopy = animated.clone();
const animationHarness = harness([animated, animatedCopy]); animationHarness.runtime.start('hall');
animationHarness.runtime.states.find(entry => entry.state.colliderMesh === animated).state.onSelectStart({}, {});
animationHarness.runtime.execute(0.25, 0.25);
assert.equal(animated.position.x, 0.5); assert.equal(animatedCopy.position.x, 0);
animationHarness.runtime.stop();
assert.equal(animated.position.x, 0, 'Stopping restores the model pose before editing or serializing');
assert.equal(animatedCopy.position.x, 0);

// Replacing an actor's model must animate its visible clip hierarchy, even when
// the hidden source still exposes a different clip with the same name.
const replacedActor = new THREE.Group(); replacedActor.userData.editorId = 'replaced-actor';
replacedActor.userData.editorBehaviors = [{type: 'animation', clip: 'Move'}];
const hiddenOriginal = new THREE.Group();
hiddenOriginal.animations = [new THREE.AnimationClip('Move', 1, [new THREE.NumberKeyframeTrack('.position[x]', [0, 1], [0, 20])])];
hiddenOriginal.visible = false; replacedActor.add(hiddenOriginal);
const fitWrapper = new THREE.Group(); fitWrapper.userData.editorVisualOwnerId = 'replaced-actor';
const replacementModel = new THREE.Group();
replacementModel.animations = [new THREE.AnimationClip('Move', 1, [new THREE.NumberKeyframeTrack('.position[x]', [0, 1], [0, 4])])];
fitWrapper.add(replacementModel); replacedActor.add(fitWrapper);
const replacementHarness = harness([replacedActor]); replacementHarness.runtime.start('hall');
replacementHarness.runtime.states[0].state.onSelectStart({}, {});
replacementHarness.runtime.execute(0.25, 0.25);
assert.equal(replacementModel.position.x, 1, 'Replacement clip binds to the model that owns it');
assert.equal(hiddenOriginal.position.x, 0); assert.equal(replacedActor.position.x, 0); assert.equal(fitWrapper.position.x, 0);
replacementHarness.runtime.stop(); assert.equal(replacementModel.position.x, 0);
replacedActor.userData.editorBehaviors[0].clip = 'Missing';
replacementHarness.runtime.start('hall');
assert.equal(replacementHarness.runtime.states.length, 0);
assert(replacementHarness.notices.some(message => message.includes('Missing')));
replacedActor.userData.editorBehaviors[0].clip = 'Move'; replacementModel.animations = [];
replacementHarness.runtime.start('hall');
assert.equal(replacementHarness.runtime.states.length, 0, 'A replacement without the configured clip never animates hidden original geometry');
replacementHarness.runtime.stop();

// Frustum activity pauses shader-only work without freezing physical poses,
// selections or positional audio.
const awayPortal = copiedPortal('away-portal');
const awayFloat = new THREE.Group(); awayFloat.userData.editorBehaviors = [{type: 'float', amplitude: 1, speed: 1}];
const awayAnimated = animated.clone(); awayAnimated.animations = animated.animations;
awayAnimated.userData.editorBehaviors = [{type: 'animation', clip: 'Move'}];
const awaySound = new THREE.Group(); awaySound.userData.editorBehaviors = [{type: 'sound', asset: 'ogg/test.ogg', autoplay: true}];
const away = harness([awayPortal, awayFloat, awayAnimated, awaySound]);
let inView = false;
away.ctx.performanceVisibility = {isVisible: () => inView};
away.runtime.start('hall');
const awayAudio = audioNodes[audioNodes.length - 1]; loads[loads.length - 1].success({id: 'audio'});
away.runtime.states.find(entry => entry.state.colliderMesh === awayAnimated).state.onSelectStart({}, {});
away.runtime.execute(0.25, 0.25);
assert.equal(awayPortal.children[0].material.uniforms.time.value, 11, 'Offscreen portal shader effects pause.');
assert(Math.abs(awayFloat.position.y - Math.sin(0.25)) < 1e-10, 'Offscreen floating keeps advancing its physical pose.');
assert.equal(awayAnimated.position.x, 0.5, 'Offscreen animation mixers keep moving physical doors and machinery.');
assert.equal(awayAudio.plays, 1, 'Positional audio remains active outside the camera view.');
away.runtime.states.find(entry => entry.state.colliderMesh === awayPortal).state.onSelectEnd({}, {});
assert.equal(away.ctx.goto, 4, 'Culling visual updates never removes an interaction.');
inView = true;
away.runtime.execute(0.25, 0.5);
assert.equal(awayPortal.children[0].material.uniforms.time.value, 11.25, 'Visible effects resume.');
assert(Math.abs(awayFloat.position.y - Math.sin(0.5)) < 1e-10, 'Floating follows continuous time when it returns to view.');
assert.equal(awayAnimated.position.x, 1, 'Animation follows continuous time when it returns to view.');
away.runtime.stop();
assert.equal(awayFloat.position.y, 0); assert.equal(awayAnimated.position.x, 0);

console.log('Behavior components: strict shared schemas, safe asset references, independent copies and portal shader effects, multi-component selection, nested discovery, native-state preservation, edit/play restoration, VR teleport, async audio cleanup, separate mixers, replacement-model animation bindings and offscreen cosmetic suspension passed.');
