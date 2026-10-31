import * as THREE from 'three';
import RayControl from './src/RayControl.js';
import XRLocomotion from './src/XRLocomotion.js';
import {createXRGrip, updateXRGrip} from './src/XRGripTracking.js';

const UP = new THREE.Vector3(0, 1, 0), WALK_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const clamp = value => Math.max(-1, Math.min(1, value));

export default class BrowserInput {
  constructor(ctx, canvas, options = {}) {
    this.ctx = ctx; this.canvas = canvas; this.options = options; this.listeners = []; this.keys = new Set(); this.axes = {x: 0, y: 0}; this.pointers = new Map(); this.controllers = [];
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ'); this.forward = new THREE.Vector3(); this.right = new THREE.Vector3(); this.from = new THREE.Vector3(); this.to = new THREE.Vector3();
    const beam = new THREE.Mesh(new THREE.BoxBufferGeometry(.004, .004, 1)); beam.name = 'beam'; beam.position.z = -.5;
    const beamRoot = new THREE.Group(); beamRoot.add(beam);
    this.texture = new THREE.DataTexture(new Uint8Array([100, 240, 212, 255]), 1, 1, THREE.RGBAFormat); this.texture.needsUpdate = true;
    // RayControl's optional decorative beam is procedural here, so no museum
    // controller/model/shader asset enters the public dependency graph.
    ctx.assets = {teleport_model: {scene: beamRoot}, beam_tex: this.texture};
    ctx.shaders = {basic_vert: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}', beam_frag: 'varying vec2 vUv;uniform sampler2D tex;uniform float time;uniform float active;void main(){gl_FragColor=texture2D(tex,vUv);}'};
    const unusedMaterial = beam.material;
    this.ray = ctx.raycontrol = new RayControl(ctx, 'right'); this.ray.setLineStyle('basic'); unusedMaterial.dispose();
    this.desktop = new THREE.Group(); this.desktop.userData.isDesktop = true; this.desktop.userData.grabbing = null;
    this.desktop.position.set(.2, -.2, -.45); this.desktop.boundingBox = new THREE.Box3();
    const aim = new THREE.Group(); aim.name = 'raycasterContext'; aim.position.copy(this.desktop.position).negate(); aim.visible = false;
    this.desktop.add(aim); ctx.camera.add(this.desktop); ctx.desktopController = this.desktop;
    ctx.desktopControllerData = this.ray.addController(this.desktop, {handedness: 'right'}, aim);
    this.document = canvas.ownerDocument || document;
    const input = this;
    ctx.desktopLook = {get isLocked() {return input.document.pointerLockElement === canvas;}, lock: () => this.lockLook(), unlock: () => this.unlockLook(), reset: () => {this.clearDrag(); this.lockPress = null;}};
    this.locomotion = new XRLocomotion(ctx); ctx.xrLocomotion = this.locomotion;
    for (let index = 0; index < 2; index++) {
      const controller = ctx.renderer.xr.getController(index), grip = createXRGrip(ctx.renderer, controller, index);
      controller.boundingBox = new THREE.Box3(); controller.userData.grabbing = null;
      ctx.cameraRig.add(controller); ctx.cameraRig.add(grip); this.controllers.push(controller);
      this.listen(controller, 'connected', event => {const data = this.ray.addController(controller, event.data); data.grip = grip;});
      this.listen(controller, 'disconnected', () => {this.ray.removeController(controller); grip.visible = false;});
      this.listen(controller, 'selectstart', () => this.ray.onSelectStart({target: controller}));
      this.listen(controller, 'selectend', () => this.ray.onSelectEnd({target: controller}));
    }
    ctx.controllers = this.controllers;
    this.listen(window, 'keydown', event => {if (this.walkAllowed() && WALK_KEYS.has(event.code) && !event.ctrlKey && !event.metaKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) {event.preventDefault(); this.keys.add(event.code);}});
    this.listen(window, 'keyup', event => this.keys.delete(event.code)); this.listen(window, 'blur', () => this.reset());
    this.listen(document, 'visibilitychange', () => {if (document.hidden) this.reset();});
    this.listen(canvas, 'contextmenu', event => event.preventDefault());
    this.listen(canvas, 'pointerdown', event => {
      if (!this.lookAllowed() || event.button !== 0) return;
      if (this.options.desktopPointerLock && !this.pointerLockUnavailable && (!event.pointerType || event.pointerType === 'mouse')) {
        // The first press only captures the mouse. A later press uses the
        // centre ray, never the browser cursor's former screen coordinates.
        this.lockPress = {id: event.pointerId, select: ctx.desktopLook.isLocked};
        if (!ctx.desktopLook.isLocked) this.lockLook();
        return;
      }
      this.drag = {id: event.pointerId, x: event.clientX, y: event.clientY, distance: 0}; canvas.setPointerCapture(event.pointerId);
    });
    this.listen(canvas, 'pointermove', event => {
      if (ctx.desktopLook.isLocked) return;
      if (this.options.desktopPointerLock && !this.pointerLockUnavailable && (!event.pointerType || event.pointerType === 'mouse')) return;
      if (!this.drag || this.drag.id !== event.pointerId) return;
      if (!(event.buttons & 1)) {this.clearDrag(); return;}
      const x = event.clientX - this.drag.x, y = event.clientY - this.drag.y; this.drag.distance += Math.hypot(x, y); this.drag.x = event.clientX; this.drag.y = event.clientY;
      this.look(x, y);
    });
    this.listen(this.document, 'pointermove', event => {if (ctx.desktopLook.isLocked && this.lookAllowed()) this.look(event.movementX, event.movementY);});
    this.listen(canvas, 'pointerup', event => {
      const press = this.lockPress; this.lockPress = null;
      if (press) {if (press.id === event.pointerId && press.select && ctx.desktopLook.isLocked) this.select(); return;}
      const drag = this.drag; this.drag = null; if (drag && drag.id === event.pointerId && drag.distance < 8) this.select();
    });
    this.listen(canvas, 'pointercancel', () => {this.clearDrag(); this.lockPress = null;});
    this.listen(canvas, 'lostpointercapture', () => {this.drag = null;});
    this.listen(window, 'pointerup', event => {if (this.drag && this.drag.id === event.pointerId) this.clearDrag();});
    this.listen(this.document, 'pointerlockchange', () => {this.clearDrag(); if (!ctx.desktopLook.isLocked) this.lockPress = null;});
    this.listen(this.document, 'pointerlockerror', () => this.disablePointerLock());
    this.buildTouch();
  }
  listen(target, name, handler, options) {target.addEventListener(name, handler, options); this.listeners.push(() => target.removeEventListener(name, handler, options));}
  clearDrag() {
    const drag = this.drag; this.drag = null;
    if (drag && this.canvas.hasPointerCapture && this.canvas.hasPointerCapture(drag.id)) this.canvas.releasePointerCapture(drag.id);
  }
  lookAllowed() {return !this.disposed && !this.ctx.vrMode && !this.ctx.publicDialogOpen && !this.ctx.studioMenuOpen && !this.ctx.voicePanelOpen;}
  disablePointerLock() {this.pointerLockUnavailable = true; this.clearDrag(); this.lockPress = null;}
  lockLook() {
    if (!this.lookAllowed() || this.pointerLockUnavailable || this.canvas.isConnected === false) return;
    if (typeof this.canvas.requestPointerLock !== 'function') {this.disablePointerLock(); return;}
    this.clearDrag();
    try {const request = this.canvas.requestPointerLock(); if (request && request.catch) request.catch(() => this.disablePointerLock());}
    catch (_) {this.disablePointerLock();}
  }
  unlockLook() {
    this.clearDrag(); this.lockPress = null;
    if (this.document.pointerLockElement === this.canvas && this.document.exitPointerLock) this.document.exitPointerLock();
  }
  look(x, y) {
    if (this.ctx.vrMode || !Number.isFinite(x) || !Number.isFinite(y)) return;
    this.euler.setFromQuaternion(this.ctx.camera.quaternion, 'YXZ'); this.euler.y -= x * .003; this.euler.x = Math.max(-1.45, Math.min(1.45, this.euler.x - y * .003));
    this.ctx.camera.quaternion.setFromEuler(this.euler);
  }
  select() {
    if (this.ctx.vrMode || this.ctx.voicePanelOpen || this.options.canInteract && !this.options.canInteract()) return;
    this.ctx.scene.updateMatrixWorld(true); this.ray.execute(this.ctx, 0, 0);
    this.ray.onSelectStart({target: this.desktop}); this.ray.onSelectEnd({target: this.desktop});
  }
  buildTouch() {
    const root = document.createElement('nav'); root.className = 'xr-browser-touch'; root.setAttribute('aria-label', 'Controles táctiles'); this.touch = root;
    for (const kind of ['move', 'look']) {
      const pad = document.createElement('div'); pad.className = 'touch-pad'; pad.textContent = kind === 'move' ? 'Caminar' : 'Mirar'; pad.setAttribute('role', 'group'); pad.setAttribute('aria-label', pad.textContent); root.appendChild(pad);
      this.listen(pad, 'pointerdown', event => {if (Array.from(this.pointers.values()).some(value => value.kind === kind)) return; event.preventDefault(); const box = pad.getBoundingClientRect(); this.pointers.set(event.pointerId, {kind, x: event.clientX, y: event.clientY, cx: box.x + box.width / 2, cy: box.y + box.height / 2, radius: box.width / 2}); pad.setPointerCapture(event.pointerId);});
      this.listen(pad, 'pointermove', event => {
        const point = this.pointers.get(event.pointerId); if (!point) return; event.preventDefault();
        if (point.kind === 'move') {this.axes.x = clamp((event.clientX - point.cx) / point.radius); this.axes.y = clamp((point.cy - event.clientY) / point.radius);}
        else this.look(event.clientX - point.x, event.clientY - point.y);
        point.x = event.clientX; point.y = event.clientY;
      });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) this.listen(pad, type, event => {const point = this.pointers.get(event.pointerId); this.pointers.delete(event.pointerId); if (point && point.kind === 'move') this.axes.x = this.axes.y = 0;});
    }
    const use = document.createElement('button'); use.textContent = 'Usar'; use.type = 'button'; use.className = 'touch-use'; this.listen(use, 'click', () => this.select()); root.appendChild(use); document.body.appendChild(root);
  }
  reset() {
    this.keys.clear(); this.axes.x = this.axes.y = 0; this.pointers.clear(); this.clearDrag(); this.lockPress = null; this.locomotion.reset();
    this.ray.controllers.forEach(data => this.ray.cancelSelect(data));
    if (this.options.onReset) this.options.onReset();
  }
  xrChanged(active) {this.reset(); this.ctx.desktopControllerData.enabled = !active; if (active) this.ctx.desktopLook.unlock();}
  walkAllowed() {return !this.ctx.voicePanelOpen && (!this.options.canWalk || this.options.canWalk());}
  step(delta, frame) {
    const ctx = this.ctx, session = ctx.renderer.xr.getSession();
    if (ctx.vrMode && session) {
      this.controllers.forEach((controller, index) => {
        const source = session.inputSources[index], previous = this.ray.controllers.find(data => data.controller === controller);
        updateXRGrip(ctx.renderer, controller, source, frame);
        if (previous && previous.inputSource === source) return;
        if (previous) controller.dispatchEvent({type: 'disconnected', data: previous.inputSource});
        if (source) controller.dispatchEvent({type: 'connected', data: source});
      });
      this.locomotion.tick(delta);
    } else if (this.walkAllowed()) {
      const key = code => Number(this.keys.has(code)), x = key('KeyD') + key('ArrowRight') - key('KeyA') - key('ArrowLeft') + this.axes.x,
        y = key('KeyW') + key('ArrowUp') - key('KeyS') - key('ArrowDown') + this.axes.y;
      if (x || y) {
        ctx.camera.getWorldDirection(this.forward); this.forward.y = 0; this.forward.normalize(); this.right.crossVectors(this.forward, UP).normalize();
        ctx.camera.getWorldPosition(this.from); this.to.copy(this.from).addScaledVector(this.forward, clamp(y) * delta * 2).addScaledVector(this.right, clamp(x) * delta * 2);
        const resolved = ctx.collisionWorld ? ctx.collisionWorld.moveCapsule(this.from, this.to, {radius: .25, height: 1.65, eyeHeight: 1.65}) : this.to;
        ctx.cameraRig.position.add(resolved.clone().sub(this.from));
      }
    }
    ctx.scene.updateMatrixWorld(true);
    this.controllers.forEach(controller => {const grip = controller.userData.gripObject, point = (grip && grip.visible ? grip : controller).getWorldPosition(new THREE.Vector3()); controller.boundingBox.setFromCenterAndSize(point, new THREE.Vector3(.10, .10, .10));});
    this.desktop.boundingBox.setFromCenterAndSize(this.desktop.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(.10, .10, .10));
    this.ray.execute(ctx, delta, this.options.time ? this.options.time() : 0);
  }
  dispose() {
    this.unlockLook(); this.disposed = true; this.reset(); this.listeners.splice(0).forEach(off => off()); this.locomotion.dispose();
    this.ray.controllers.slice().forEach(data => this.ray.removeController(data.controller));
    const geometry = new Set(), materials = new Set(); [this.ray.raycasterContext, this.desktop].forEach(root => root.traverse(node => {if (node.geometry) geometry.add(node.geometry); if (node.material) materials.add(node.material);}));
    geometry.forEach(value => value.dispose()); materials.forEach(value => value.dispose()); this.texture.dispose();
    this.controllers.forEach(controller => {ctxRemove(controller); ctxRemove(controller.userData.gripObject);}); ctxRemove(this.desktop); this.touch.remove();
  }
}
function ctxRemove(object) {if (object && object.parent) object.parent.remove(object);}
