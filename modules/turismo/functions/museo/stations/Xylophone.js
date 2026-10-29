import * as THREE from 'three';
import PositionalAudioPolyphonic from '../../../../../packages/render-three/src/PositionalAudioPolyphonic.js';
import {nativeBehavior, declareNativeBehaviors} from '../../../../../packages/tools/editor/src/NativeBehaviorAdapters.js';

let listener, hallRef, context, lastTick = null;
let extraControlUsers = 0;
const notes = [], sticks = [], homes = new Map(), tips = new Map();
const box = new THREE.Box3(), noteBox = new THREE.Box3();
const raycaster = new THREE.Raycaster(), center = new THREE.Vector2();
const position = new THREE.Vector3();
const raySuspensions = new Map(), legacyRayOwners = new Set();
let legacyRay = null, legacyRayEnabled;

function controllerData(controller) {
  const ray = context.raycontrol;
  return ray && Array.isArray(ray.controllers) ? ray.controllers.find(data => data.controller === controller) : null;
}

function industrialOwnsHand(controller) {
  const simulation = context.editor && context.editor.simulation;
  const data = controllerData(controller);
  return !!(simulation && simulation.held && simulation.held.has(controller) || data && data.active && data.captureConsumed);
}

function suspendRay(controller, suspended) {
  const ray = context.raycontrol, previous = raySuspensions.get(controller);
  const data = controllerData(controller);
  if (previous && (!suspended || previous.data !== data)) {
    previous.data.enabled = previous.enabled;
    raySuspensions.delete(controller);
  }
  if (suspended && data) {
    if (!raySuspensions.has(controller)) raySuspensions.set(controller, {data, enabled: data.enabled});
    data.enabled = false;
  }
  // Old station fixtures have no controller registry. Preserve their previous
  // global state, but never use global disable/enable with production rays.
  if (suspended && ray && !Array.isArray(ray.controllers)) {
    if (!legacyRayOwners.size) { legacyRay = ray; legacyRayEnabled = ray.enabled; ray.disable(); }
    legacyRayOwners.add(controller);
  } else if (legacyRayOwners.delete(controller) && !legacyRayOwners.size) {
    if (legacyRayEnabled !== false && legacyRay) legacyRay.enable();
    legacyRay = null;
  }
}

function restoreRays() {
  Array.from(raySuspensions.keys()).concat(Array.from(legacyRayOwners)).forEach(controller => suspendRay(controller, false));
}

function configureNote(note, config, library) {
  if (!note.userData.sound) {
    note.userData.sound = new PositionalAudioPolyphonic(context.audioListener || listener, 10);
    note.userData.resetY = note.position.y; note.userData.animation = 0;
  }
  const sound = note.userData.sound;
  if (note.userData.editorNoteAsset !== config.asset) {
    note.userData.editorNoteAsset = config.asset;
    const url = library ? library.getURL(config.asset) : "modules/turismo/assets/" + config.asset;
    new THREE.AudioLoader().load(url, buffer => {
      if (note.userData.editorNoteAsset === config.asset) sound.setBuffer(buffer);
    });
  }
  sound.children.forEach(audio => { if (audio.setVolume) audio.setVolume(config.volume); });
}

function addNote(note, config, library) {
  if (notes.indexOf(note) !== -1) return;
  notes.push(note);
  note.userData.animation = 0; note.userData.resetY = note.position.y;
  note.traverse(mesh => {
    if (mesh.material && mesh.material.clone) mesh.material = mesh.material.clone();
  });
  configureNote(note, config, library);
}

function stopNote(note) {
  const sound = note.userData.sound;
  if (sound) sound.children.forEach(audio => { if (audio.isPlaying && audio.stop) audio.stop(); });
}

function removeNote(note) {
  const index = notes.indexOf(note); if (index !== -1) notes.splice(index, 1);
  if (Number.isFinite(note.userData.resetY)) note.position.y = note.userData.resetY;
  note.userData.animation = 0;
  note.traverse(mesh => { if (mesh.material && mesh.material.emissive) mesh.material.emissiveIntensity = 0; });
  stopNote(note); delete note.userData.sound; delete note.userData.editorNoteAsset;
}

function addStick(stick) {
  if (sticks.indexOf(stick) !== -1) return;
  sticks.push(stick); homes.set(stick, stick.parent || hallRef);
  stick.userData.resetPosition = stick.position.clone(); stick.userData.resetRotation = stick.rotation.clone();
  stick.userData.desktopHomePosition = stick.position.clone(); stick.userData.desktopHomeRotation = stick.rotation.clone();
  stick.userData.grabbedBy = null; stick.userData.animation = 0;
  let tip = null;
  stick.traverse(mesh => { if (!tip && mesh.material && mesh.material.color) tip = mesh; });
  if (tip) { tip.material = tip.material.clone(); tips.set(stick, tip); }
}

function removeStick(stick) {
  if (stick.userData.grabbedBy) release(stick.userData.grabbedBy, true);
  if (stick.userData.resetPosition) stick.position.copy(stick.userData.resetPosition);
  if (stick.userData.resetRotation) stick.rotation.copy(stick.userData.resetRotation);
  stick.userData.animation = 0;
  const index = sticks.indexOf(stick); if (index !== -1) sticks.splice(index, 1);
  homes.delete(stick); tips.delete(stick);
}

export function setup(ctx, hall) {
  context = ctx; hallRef = hall; listener = new THREE.AudioListener();
  for (let i = 0; i < 13; i++) {
    const note = hall.getObjectByName('xnote0' + (i < 10 ? '0' + i : i));
    if (!note) continue;
    note.geometry.computeBoundingBox(); note.material = new THREE.MeshLambertMaterial();
    note.material.color.setHSL(i / 13, 0.9, 0.2); note.material.emissive = note.material.color.clone(); note.material.emissiveIntensity = 0;
    const config = {type: 'note', asset: 'ogg/xylophone' + (i + 1) + '.ogg', volume: 1};
    declareNativeBehaviors(note, [config]); addNote(note, config);
  }
  ['left', 'right'].forEach(side => {
    const stick = hall.getObjectByName('xylostick-' + side);
    if (!stick) return;
    declareNativeBehaviors(stick, [{type: 'grab', distance: 6, returnOnRelease: true}]); addStick(stick);
  });
  ctx.editorXylophone = {addNote, removeNote, addStick, removeStick, tick: execute,
    releaseHeld(controller) { releaseAllHeld(ctx, controller); }, acquireControls() {
    if (extraControlUsers++ === 0 && ctx.room !== 0) enter(ctx);
    return () => {
      extraControlUsers = Math.max(0, extraControlUsers - 1);
      if (!extraControlUsers && ctx.room !== 0) exit(ctx);
    };
  }};
}

function releaseAllHeld(ctx, onlyController) {
  const controllers = new Set(onlyController ? [onlyController] : (ctx.controllers || []).concat(ctx.desktopController || []));
  // A copied stick can retain its owner while the browser replaces the active
  // XR controller list. Include registered owners so mode changes release it.
  sticks.forEach(stick => { if (stick.userData.grabbedBy && (!onlyController || stick.userData.grabbedBy === onlyController)) controllers.add(stick.userData.grabbedBy); });
  controllers.forEach(controller => {
    if (!controller || !controller.userData || sticks.indexOf(controller.userData.grabbing) === -1) return;
    release(controller, true);
  });
  if (onlyController) suspendRay(onlyController, false);
  else restoreRays();
}

export function enter(ctx) {
  ctx.camera.add(listener);
  ctx.controllers.forEach(controller => {
    controller.addEventListener('selectstart', onSelectStart); controller.addEventListener('selectend', onSelectEnd);
  });
  ctx.desktopController.addEventListener('griptoggle', onDesktopGripToggle);
}

export function exit(ctx) {
  releaseAllHeld(ctx);
  ctx.camera.remove(listener);
  ctx.controllers.forEach(controller => {
    if (controller.userData.grabbing && sticks.indexOf(controller.userData.grabbing) !== -1) release(controller, true);
    controller.removeEventListener('selectstart', onSelectStart); controller.removeEventListener('selectend', onSelectEnd);
  });
  if (ctx.desktopController.userData.grabbing && sticks.indexOf(ctx.desktopController.userData.grabbing) !== -1) release(ctx.desktopController, true);
  ctx.desktopController.removeEventListener('griptoggle', onDesktopGripToggle);
  notes.forEach(stopNote); lastTick = null;
}

function isVisible(object) {
  let attached = false;
  for (let current = object; current; current = current.parent) {
    if (!current.visible) return false;
    if (current === context.scene) attached = true;
  }
  return attached;
}

function setStickColor(stick, color) {
  const tip = tips.get(stick); if (tip && tip.material.color) tip.material.color.set(color);
}

function collide(controller, stick) {
  if (!nativeBehavior(stick, 'grab') || !isVisible(stick)) return false;
  box.setFromObject(stick); return controller.boundingBox && controller.boundingBox.intersectsBox(box);
}

function animateNote(note, delta) {
  const data = note.userData;
  if (data.animation > 0) {
    data.animation = Math.max(0, data.animation - delta * 4);
    note.traverse(mesh => { if (mesh.material && mesh.material.emissive) mesh.material.emissiveIntensity = data.animation; });
    note.position.y = data.resetY - data.animation * 0.005;
  }
}

export function execute(ctx, delta, time) {
  // Factories also tick copies outside the hall; update once per frame.
  if (lastTick === time && ctx.room !== undefined) return;
  lastTick = time;
  const controllers = (ctx.controllers || []).concat(ctx.desktopController || []);
  controllers.forEach(controller => {
    if (ctx.vrMode && ctx.studioMenuOpen) { suspendRay(controller, false); return; }
    const held = controller.userData.grabbing;
    let nearStick = false;
    const nativeHeld = held && sticks.indexOf(held) !== -1;
    if (nativeHeld) updateHeldStick(controller);
    else if (!controller.userData.isDesktop && !industrialOwnsHand(controller)) sticks.forEach(stick => {
      const near = collide(controller, stick); nearStick = nearStick || near;
      if (!stick.userData.grabbedBy) setStickColor(stick, near ? 0xffffff : 0xaaaaaa);
    });
    suspendRay(controller, !!nativeHeld || nearStick);
  });
  Array.from(raySuspensions.keys()).forEach(controller => { if (!controllers.includes(controller)) suspendRay(controller, false); });
  sticks.forEach(stick => {
    if (stick.userData.animation > 0 && !stick.userData.grabbedBy) {
      position.copy(stick.userData.resetPosition).sub(stick.position).multiplyScalar(0.1); stick.position.add(position);
      if (position.length() < 0.01) stick.userData.animation = 0;
    }
  });
  notes.forEach(note => {
    const config = nativeBehavior(note, 'note');
    if (config) configureNote(note, config, ctx.editor && ctx.editor.library);
    animateNote(note, delta);
  });
}

function updateHeldStick(controller) {
  const held = controller.userData.grabbing;
  const tip = tips.get(held) || held.children[0] || held;
  box.setFromObject(tip).expandByScalar(-0.01);
  let collisions = controller.userData.editorNoteCollisions;
  if (!collisions) collisions = controller.userData.editorNoteCollisions = new Set();
  notes.forEach(note => {
    const config = nativeBehavior(note, 'note'); noteBox.setFromObject(note);
    if (config && isVisible(note) && box.intersectsBox(noteBox)) {
      if (!collisions.has(note)) { collisions.add(note); note.userData.sound.play(); note.userData.animation = 1; setStickColor(held, 0xffffff); }
    } else collisions.delete(note);
  });
}

function grab(controller, stick) {
  if (stick.userData.grabbedBy) stick.userData.grabbedBy.userData.grabbing = null;
  homes.set(stick, stick.parent || hallRef);
  stick.userData.desktopHomePosition.copy(stick.position); stick.userData.desktopHomeRotation.copy(stick.rotation);
  stick.position.set(0, 0, 0); stick.rotation.set(0, 0, 0); controller.add(stick);
  controller.userData.grabbing = stick; controller.userData.editorNoteCollisions = new Set();
  controller.userData.noteCollisions = null; stick.userData.grabbedBy = controller; stick.userData.animation = 0;
  setStickColor(stick, 0xaaaaaa);
  suspendRay(controller, true);
}

function release(controller, forceReturn) {
  const stick = controller.userData.grabbing; if (!stick || sticks.indexOf(stick) === -1) return;
  const config = nativeBehavior(stick, 'grab');
  const parent = homes.get(stick) || hallRef;
  stick.getWorldPosition(position); const quaternion = stick.getWorldQuaternion(new THREE.Quaternion());
  parent.add(stick); stick.position.copy(parent.worldToLocal(position));
  if (forceReturn || !config || config.returnOnRelease) {
    if (controller.userData.isDesktop || forceReturn) stick.position.copy(stick.userData.desktopHomePosition);
    stick.rotation.copy(stick.userData.resetRotation); stick.userData.animation = controller.userData.isDesktop || forceReturn ? 0 : 1;
  } else {
    const parentRotation = parent.getWorldQuaternion(new THREE.Quaternion()).inverse();
    stick.quaternion.copy(parentRotation.multiply(quaternion)); stick.userData.animation = 0;
  }
  stick.userData.grabbedBy = null; controller.userData.grabbing = null; controller.userData.editorNoteCollisions = null; controller.userData.noteCollisions = null;
  suspendRay(controller, false);
}

function onDesktopGripToggle() {
  if (context.editor && context.editor.active) return;
  const controller = context.desktopController;
  if (industrialOwnsHand(controller)) return;
  if (controller.userData.grabbing) { release(controller, false); return; }
  context.scene.updateMatrixWorld(true); raycaster.setFromCamera(center, context.camera); raycaster.far = 30;
  const hits = raycaster.intersectObjects(sticks, true);
  for (const hit of hits) {
    let stick = hit.object;
    while (stick && sticks.indexOf(stick) === -1) stick = stick.parent;
    const config = stick && nativeBehavior(stick, 'grab');
    if (config && isVisible(stick) && !stick.userData.grabbedBy && hit.distance <= config.distance) { grab(controller, stick); return; }
  }
}

export function onSelectStart(event) {
  if (context.vrMode && (context.studioMenuOpen || event.target.userData.studioMenuTrigger)) return;
  if (context.editor && context.editor.active) return;
  const controller = event.target; if (controller.userData.grabbing || industrialOwnsHand(controller)) return;
  for (const stick of sticks) if (collide(controller, stick)) { grab(controller, stick); return false; }
  return true;
}

export function onSelectEnd(event) {
  if (context.vrMode && (context.studioMenuOpen || event.target.userData.studioMenuTrigger)) return;
  if (context.editor && context.editor.active) return;
  if (event.target.userData.grabbing && sticks.indexOf(event.target.userData.grabbing) !== -1) { release(event.target, false); return false; }
  return true;
}
