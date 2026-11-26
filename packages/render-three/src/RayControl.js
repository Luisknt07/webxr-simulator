import * as THREE from 'three';
import EventDispatcher from './EventDispatcher.js';

var tempMatrix = new THREE.Matrix4();
export var rayMaterial;
const validStateController = [
  "primary",
  "secondary",
  "both",
  "left",
  "right"
];

export default class RayControl extends EventDispatcher {
  enable() {
    this.enabled = true;
    this.setLineStyle(this.previousLineStyle);
  }

  _sort() {
    this.currentStates = this.currentStates.sort((a,b) => {
      let pa = a.order || 0;
      let pb = b.order || 0;
      return pa - pb;
    });
  }

  disable() {
    this.lineBasic.visible = this.line0.visible = false;
    this.enabled = false;
    this.controllers.forEach(controller => {
      this.cancelSelect(controller);
      this.clearHover(controller);
      if (controller.line0) controller.line0.visible = controller.lineBasic.visible = false;
      if (controller.pointer) controller.pointer.visible = false;
      controller.active = false;
      controller.currentIntersection = null;
      controller.prevIntersection = null;
      controller.intersections = {};
    });
  }

  changeHandedness(primary) {
    if (primary !== this.primary) {
      this.controllers.forEach(controller => {
        this.cancelSelect(controller);
        this.clearHover(controller);
        controller.currentIntersection = null;
        controller.intersections = {};
      });
      this.primary = primary;
      this.secondary = primary === "right" ? "left" : "right";

      this.dispatchEvent("handednessChanged", {primary: this.primary, secondary: this.secondary});
    }
  }

  addState(name, state, activate) {
    if (this.states[name]) {
      console.error(`RayControl state '${name}' already exist, please use a different name.`);
      return;
    }

    state.name = name;

    if (typeof state.raycaster === "undefined") {
      state.raycaster = true;
    }

    if (typeof state.controller === "undefined") {
      state.controller = "primary";
    } else if (!validStateController.includes(state.controller)) {
      console.warn("Invalid controller selector:", state.controller);
      state.controller = "primary";
    }

    this.states[name] = state;

    if (activate === true) {
      this.currentStates.push(state);
    }

    return state;
  }

  activateState(name) {
    if (this.states[name] && !this.currentStates.includes(this.states[name])) {
      this.currentStates.push(this.states[name]);
      this._sort();
    }
  }

  deactivateAll(name) {
    this.currentStates = [];
    this.controllers.forEach(c => {
      this.cancelSelect(c);
      this.clearHover(c);
      c.active = false;
      c.currentIntersection = null;
      c.prevIntersection = null;
      c.intersections = {};
    });
  }

  deactivateState(name) {
    const stateIndex = this.currentStates.findIndex(state => state.name === name);
    if (stateIndex !== -1) {
      this.currentStates.splice(stateIndex, 1);
    }
    this.controllers.forEach(c => {
      if (this.states[name]) this.cancelSelect(c, this.states[name]);
      const leaving = (c.hoverEntries || []).filter(entry => entry.state.name === name);
      leaving.forEach(entry => entry.state.onHoverLeave && entry.state.onHoverLeave(entry.intersection, false, c.controller));
      c.hoverEntries = (c.hoverEntries || []).filter(entry => entry.state.name !== name);
      if (c.intersections[name]) {
        c.intersections[name] = null;
      }
      if (c.currentIntersection && c.currentIntersection.state.name === name) {
        const current = c.currentIntersection;
        if (!leaving.length) current.state.onHoverLeave && current.state.onHoverLeave(current.intersection, false, c.controller);
        c.currentIntersection = null;
        if (!c.selectionCapture) c.active = false;
      }
    });

    this._sort();
  }

  addController(controller, inputSource, raycasterContext) {
    const existing = this.controllers.find(data => data.controller === controller);
    if (existing && existing.inputSource === inputSource) return existing;
    // WebXR may reuse a target-ray Group for a replacement input source. Its
    // old captures and gamepad must not survive a different physical hand.
    if (existing) this.removeController(controller);
    // Each XR hand needs its own ray origin. Sharing the primary hand's Group
    // reparents it and silently prevents the other hand from selecting anything.
    const customContext = Boolean(raycasterContext);
    raycasterContext = raycasterContext || (this.raycasterContext.parent ? this.raycasterContext.clone(true) : this.raycasterContext);
    if (!customContext) raycasterContext.children.filter(child => child.name === 'XR precise hit cursor').forEach(child => raycasterContext.remove(child));
    let controllerData = {
      controller: controller,
      inputSource: inputSource,
      desktop: Boolean(controller.userData.isDesktop),
      enabled: true,
      active: false,
      stateHit: {},
      intersections: {},
      currentIntersection: null,
      hit: false
    };
    controllerData.raycasterContext = raycasterContext;
    if (!customContext) {
      controllerData.line0 = raycasterContext.children[0];
      controllerData.lineBasic = raycasterContext.children[1];
    }

    this.controllers.push(controllerData);

    controller.add(raycasterContext);
    if (!controllerData.desktop) this.createPointer(controllerData);
    this.setLineStyle(this.previousLineStyle, controllerData);

    this.dispatchEvent("controllerConnected", controllerData);
    return controllerData;
  }

  removeController(controller) {
    const index = this.controllers.findIndex(controllerData => controllerData.controller === controller);
    if (index === -1) return;
    const controllerData = this.controllers[index];
    this.cancelSelect(controllerData);
    this.clearHover(controllerData);
    if (controllerData.pointer) {
      controllerData.pointer.traverse(node => {if (node.material) node.material.dispose();});
      controllerData.pointer.parent.remove(controllerData.pointer);
    }
    this.controllers.splice(index, 1);
    if (controllerData.raycasterContext.parent === controller) controller.remove(controllerData.raycasterContext);
    this.dispatchEvent("controllerDisconnected", controllerData);
  }

  constructor(ctx, primary) {
    super();
    this.ctx = ctx;

    if (typeof primary === "undefined") {
      this.primary = "right";
      this.secondary = "left";
    } else {
      this.primary = primary;
      this.secondary = primary === "right" ? "left" : "right";
    }

    this.controllers = [];

    this.previousLineStyle = 'pretty';
    this.enabled = true;
    this.raycaster = new THREE.Raycaster();
    this.touchRaycaster = new THREE.Raycaster();
    this.states = {};
    this.currentStates = [];

    // Metric forward-only geometry keeps the beam endpoint aligned to the
    // actual hit, independently of optional imported teleport/model assets.
    var line = new THREE.Mesh(new THREE.BoxBufferGeometry(.0024, .0024, 1).translate(0, 0, -.5));
    const texture = ctx.assets && ctx.assets.beam_tex || new THREE.DataTexture(new Uint8Array([100, 240, 212, 255]), 1, 1, THREE.RGBAFormat);
    this.ownedTexture = ctx.assets && ctx.assets.beam_tex ? null : texture;
    texture.needsUpdate = true;
    texture.wrapT = THREE.RepeatWrapping;
    texture.wrapS = THREE.RepeatWrapping;
    const shaders = ctx.shaders || {};
    rayMaterial = line.material = new THREE.ShaderMaterial({
      uniforms: {
        time: {value: 0},
        active: {value: 0},
        tex: {value: texture}
      },
      vertexShader: shaders.basic_vert || 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: shaders.beam_frag || 'varying vec2 vUv;uniform sampler2D tex;void main(){gl_FragColor=texture2D(tex,vUv);}',
      blending: THREE.AdditiveBlending,
      transparent: true
    });

    line.renderOrder = 10;

    line.name = 'line';
    this.rayLength = 5;
    line.scale.z = this.rayLength;

    this.line0 = line.clone();
    this.line0.visible = true;

    this.raycasterContext = new THREE.Group();
    this.raycasterContext.add(this.line0);
    this.raycasterContext.name = 'raycasterContext';

    var geometry = new THREE.BufferGeometry().setFromPoints( [ new THREE.Vector3( 0, 0, 0 ), new THREE.Vector3( 0, 0, - 1 ) ] );

    this.lineBasic = new THREE.Line( geometry );
    this.lineBasic.name = 'line';
    this.lineBasic.scale.z = 5;
    this.lineBasic.visible = false;
    this.raycasterContext.add(this.lineBasic);
    this.pointerRingGeometry = new THREE.RingBufferGeometry(.65, 1, 24);
    this.pointerDotGeometry = new THREE.CircleBufferGeometry(.22, 12);
  }

  createPointer(data) {
    const pointer = data.pointer = new THREE.Group(); pointer.name = 'XR precise hit cursor'; pointer.visible = false;
    Object.assign(pointer.userData, {editorRuntimeHelper: true, editorNonCollidable: true, xrInputVisual: true});
    for (const geometry of [this.pointerRingGeometry, this.pointerDotGeometry]) {
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({color: 0x66f4db, depthWrite: false, side: THREE.DoubleSide, toneMapped: false}));
      mesh.renderOrder = 1001; mesh.raycast = () => {}; pointer.add(mesh);
    }
    pointer.traverse(node => {node.frustumCulled = false;}); data.raycasterContext.add(pointer);
  }

  dispose() {
    this.syncXRSession(null);
    this.disable(); this.controllers.slice().forEach(data => this.removeController(data.controller));
    [this.line0.geometry, this.lineBasic.geometry, this.pointerRingGeometry, this.pointerDotGeometry].forEach(geometry => geometry.dispose());
    this.line0.material.dispose(); this.lineBasic.material.dispose(); if (this.ownedTexture) this.ownedTexture.dispose();
    this.currentStates = []; this.states = {};
  }

  updatePointer(data) {
    const pointer = data.pointer; if (!pointer) return;
    const current = data.currentIntersection, hit = current && current.intersection;
    pointer.visible = Boolean(this.enabled && data.enabled && data.controller.visible !== false && !data.controller.userData.xrRaySuppressed && !data.controller.userData.xrTouchActive && hit && hit.point && current.state.teleport !== true);
    if (!pointer.visible) return;
    data.raycasterContext.updateWorldMatrix(true, false);
    pointer.position.copy(hit.point); data.raycasterContext.worldToLocal(pointer.position); pointer.position.z += .002;
    // Fixed angular size, bounded in metres; the centre remains the exact mesh
    // intersection and its original UVs, never snapped to a nearby button.
    pointer.scale.setScalar(Math.min(.014, Math.max(.004, hit.distance * .0035)));
    pointer.children.forEach(mesh => mesh.material.color.setHex(data.active ? 0xffd169 : 0x66f4db));
  }

  setLineStyle(lineStyle, controllerData) {
    const basic = lineStyle === 'basic';
    const apply = data => {
      if (!data.line0) return;
      const visible = this.enabled && data.enabled && (data.desktop || data.controller.visible !== false) && !data.controller.userData.xrRaySuppressed && !data.controller.userData.xrTouchActive;
      data.lineBasic.visible = visible && basic;
      data.line0.visible = visible && !basic;
    };
    if (controllerData) apply(controllerData);
    else {
      this.lineBasic.visible = basic;
      this.line0.visible = !basic;
      this.controllers.forEach(apply);
    }
    this.previousLineStyle = lineStyle;
  }

  /*
  selector could be: left, right, both, primary, secondary
  */
  matchController(controllerData, selector) {
    const handedness = controllerData.inputSource && controllerData.inputSource.handedness;

    return (
      (selector === handedness)  ||
      (selector === "both" && (handedness === "right" || handedness === "left")) ||
      (selector === "primary" && this.primary === handedness) ||
      (selector === "secondary" && this.secondary === handedness)
    );
  }

  onSelectStart(evt) {
    if (!this.enabled) { return; }

    let controller = evt.target;
    let controllerData = this.controllers.find(c => c.controller === controller);
    if (controllerData && controllerData.inputSource.hand && !(controller.userData.xrHandContact && controller.userData.xrHandContact.valid)) return;
    if (controllerData && controllerData.enabled && (controllerData.desktop || controller.visible !== false) && !controller.userData.xrTouchActive && !controllerData.controller.userData.xrRaySuppressed && !controllerData.active) {
      controllerData.active = true;
      const selected = this.selectionEntries(controllerData);
      // Industrial controls capture their original press until release. Native
      // teleport/graffiti still use the current hit at release as before.
      controllerData.selectionCapture = selected.some(entry => entry.state.captureSelect) ? selected.slice() : null;
      controllerData.captureConsumed = !!controllerData.selectionCapture && selected.some(entry => entry.state.consumeSelect);
      selected.forEach(entry => entry.state.onSelectStart && entry.state.onSelectStart(entry.intersection, controller));

      // Check no raycaster states
      this.currentStates.forEach(state => {
        if (!this.allowedState(state)) return;
        if (selected.some(entry => entry.state.consumeSelect)) return;
        if (controllerData.desktop && state.vrOnly) {
          return;
        }
        if (!this.matchController(controllerData, state.controller)) return;
        if (state.onSelectStart && !state.raycaster) {
          state.onSelectStart(controllerData.intersections[state.name], controller);
        }
      });
    }
  }

  releaseHandTouch(data, cancel = false, state) {
    const touch = data.handTouch, entry = touch && touch.entry;
    if (state && (!entry || entry.state !== state)) return;
    if (touch) {touch.entry = null; touch.armed = false;}
    delete data.controller.userData.xrTouchActive;
    if (!entry) return;
    const callback = cancel ? entry.state.onSelectCancel : entry.state.onSelectEnd;
    if (callback) callback(entry.hit, touch.token);
    if (entry.state.onHoverLeave) entry.state.onHoverLeave(entry.hit, false, touch.token);
  }

  updateHandTouch(data) {
    const ctx = this.ctx, controller = data.controller, contact = controller.userData.xrHandContact;
    const xr = ctx.renderer && ctx.renderer.xr, session = xr && xr.getSession && xr.getSession();
    const editor = ctx.editor, blocked = !ctx.vrMode || !this.enabled || data.enabled === false || data.desktop || !data.inputSource || !data.inputSource.hand ||
      !contact || !contact.pokeValid || controller.userData.grabbing || controller.userData.xrRaySuppressed ||
      ctx.publicDialogOpen || ctx.xrEntryPending || ctx.xrExitPending || ctx.roomTransition ||
      xr && xr.getSession && !session || session && session.visibilityState && session.visibilityState !== 'visible' ||
      editor && (editor.active || editor.initializing || editor.loadingProject || editor.busy || editor.importingFiles);
    if (blocked) {this.releaseHandTouch(data, true); return;}
    const parent = controller.userData.gripObject && controller.userData.gripObject.parent || controller.parent;
    if (!parent) {this.releaseHandTouch(data, true); return;}
    parent.updateWorldMatrix(true, false);
    let touch = data.handTouch;
    if (!touch) {
      touch = data.handTouch = {armed: false, entry: null, wrist: new THREE.Vector3()};
      // Independent identity balances a physical press without releasing a
      // simultaneous native trigger. The origin is the measured wrist.
      touch.token = {userData: {xrDirectTouch: true}, controller,
        getWorldPosition: target => target.copy(touch.wrist), getObjectByName: () => null};
    }
    touch.wrist.copy(contact.wrist).applyMatrix4(parent.matrixWorld);
    const tip = contact.indexTip.clone().applyMatrix4(parent.matrixWorld), distal = contact.indexDistal.clone().applyMatrix4(parent.matrixWorld);
    const direction = tip.clone().sub(distal), length = direction.length();
    if (length < .003 || length > .09 || data.active) {this.releaseHandTouch(data, true); return;}
    direction.divideScalar(length);
    // Search around the actual fingertip, never a long pointer. Both sides of
    // the press threshold remain measurable, avoiding jitter/repeat clicks.
    const origin = tip.clone().addScaledVector(direction, -.04), ray = this.touchRaycaster;
    ray.set(origin, direction); ray.near = 0; ray.far = .08;
    let near = null;
    for (const state of this.currentStates) {
      if (!state.handTouchable || state.teleport || !this.allowedState(state) || !this.matchController(data, state.controller)) continue;
      const mesh = state.handTouchMesh || state.colliderMesh;
      if (!mesh) continue;
      const hits = this.filterVisible(Array.isArray(mesh) ? ray.intersectObjects(mesh, true) : ray.intersectObject(mesh, true));
      for (const hit of hits) {
        if (state.isSelectable && !state.isSelectable(hit, touch.token)) continue;
        if (hit.face) {
          const normal = hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix((hit.actualObject || hit.object).matrixWorld)).normalize();
          if (normal.dot(direction) > -.25) continue;
        }
        const world = ctx.collisionWorld;
        if (world && world.rayBlocked && world.rayBlocked(touch.wrist, hit.point, {ignore: [hit.object, controller]})) continue;
        if (!near || hit.distance < near.hit.distance) near = {state, hit};
        break;
      }
    }
    controller.userData.xrTouchActive = !!near;
    if (touch.entry) {
      const entry = touch.entry;
      if (!near || near.state !== entry.state || (near.hit.actualObject || near.hit.object) !== (entry.hit.actualObject || entry.hit.object) || near.hit.distance - .04 > .025) {
        this.releaseHandTouch(data);
        // Sliding to another cap requires withdrawal before another press.
        controller.userData.xrTouchActive = !!near;
        if(!near)touch.armed=true;
      }
      return;
    }
    if (!near) {touch.armed = true; return;}
    if (!touch.armed || contact.pinching || near.hit.distance - .04 > contact.indexRadius + .003) return;
    touch.armed = false; touch.entry = near;
    if (near.state.onHover) near.state.onHover(near.hit, true, touch.token);
    if (near.state.onSelectStart) near.state.onSelectStart(near.hit, touch.token);
  }

  syncXRSession(session) {
    if(this.inputSession===session)return;
    if(this.inputSession){
      if(this.inputSession.removeEventListener)for(const [name,listener]of this.sessionListeners||[])this.inputSession.removeEventListener(name,listener);
      this.controllers.filter(data=>!data.desktop).forEach(data=>{this.cancelSelect(data);this.clearHover(data);});
    }
    this.inputSession=session;this.sessionListeners=[];
    if(!session||!session.addEventListener)return;
    // Three r112 forwards select but not squeeze. Preserve the native squeeze
    // event for controller cargo grips in both browser entry points.
    const squeeze=event=>{const data=this.controllers.find(entry=>entry.inputSource===event.inputSource);if(data&&!data.desktop&&!event.inputSource.hand)data.controller.dispatchEvent({type:event.type,data:event.inputSource});};
    const cancel=event=>{if(event.type!=='end'&&session.visibilityState==='visible')return;this.controllers.forEach(data=>{this.cancelSelect(data);this.clearHover(data);});};
    for(const [name,listener]of [['squeezestart',squeeze],['squeezeend',squeeze],['visibilitychange',cancel],['end',cancel]]){session.addEventListener(name,listener);this.sessionListeners.push([name,listener]);}
  }

  cancelSelect(controllerData, state) {
    this.releaseHandTouch(controllerData, true, state);
    if (state && !controllerData.selectionCapture) return;
    const entries = controllerData.selectionCapture || [];
    entries.filter(entry => !state || entry.state === state).forEach(entry => {
      if (entry.state.onSelectCancel) entry.state.onSelectCancel(entry.intersection, controllerData.controller);
    });
    controllerData.selectionCapture = state ? entries.filter(entry => entry.state !== state) : null;
    if (!state) {
      controllerData.active = false;
      controllerData.captureConsumed = false;
      this.dispatchEvent('controllerInputCancelled', controllerData);
    }
  }

  execute(ctx, delta, time) {
    const xr=ctx.renderer&&ctx.renderer.xr;
    this.syncXRSession(ctx.vrMode&&xr&&xr.getSession?xr.getSession():null);
    if (!this.enabled || this.currentStates.length === 0) { this.controllers.forEach(data => {if (data.pointer) data.pointer.visible = false;}); return; }

    this.line0.material.uniforms.time.value = time;

    let firstHit = false;

    var stateIntersections = {};
    for (var c = 0; c < this.controllers.length; c++) {
      let controllerData = this.controllers[c];
      this.updateHandTouch(controllerData);
      if(controllerData.active&&controllerData.inputSource.hand&&!(controllerData.controller.userData.xrHandContact&&controllerData.controller.userData.xrHandContact.valid))this.cancelSelect(controllerData);
      // r112 hides targetRaySpace when getPose() returns null, but keeps its
      // previous matrix. Never actuate or hover from that stale tracked pose.
      if (!controllerData.enabled || !controllerData.desktop && controllerData.controller.visible === false || controllerData.controller.userData.xrRaySuppressed) {
        if (!controllerData.inputSuspended && (controllerData.active || controllerData.selectionCapture)) this.cancelSelect(controllerData);
        controllerData.inputSuspended = true;
        if (controllerData.line0) controllerData.line0.visible = controllerData.lineBasic.visible = false;
        if (controllerData.pointer) controllerData.pointer.visible = false;
        this.clearHover(controllerData);
        controllerData.currentIntersection = null;
        controllerData.intersections = {};
        continue;
      }
      controllerData.inputSuspended = false;
      if (controllerData.line0 && !controllerData.line0.visible && !controllerData.lineBasic.visible) this.setLineStyle(this.previousLineStyle, controllerData);

      for (var i = 0; i < this.currentStates.length; i++) {
        let state = this.currentStates[i];
        if (!this.allowedState(state)) { controllerData.intersections[state.name] = null; continue; }
        if (!state.raycaster) {
          continue;
        }
        if (state.handTouchOnly) {controllerData.intersections[state.name] = null; continue;}
        if (controllerData.desktop && state.vrOnly) {
          controllerData.intersections[state.name] = null;
          continue;
        }

        // Check if this controller should be active on this state
        if (!this.matchController(controllerData, state.controller)) {
          controllerData.intersections[state.name] = null;
          continue;
        }

        let controller = controllerData.controller;
        let active = controllerData.active;
        const near=state.handGrabHit&&controllerData.inputSource.hand&&state.handGrabHit(controller);
        let intersections = near ? [near] : this.getIntersections(controller, state.colliderMesh);
        if (state.isSelectable) intersections = intersections.filter(hit => state.isSelectable(hit, controller));

        if (intersections.length > 0) {
          // Use just the closest object
          controllerData.intersections[state.name] = intersections[0];
          controllerData.stateHit[state.name] = true;
        } else {
          controllerData.intersections[state.name] = null;
        }
      }
    }

    this.line0.scale.z = this.lineBasic.scale.z = this.rayLength;

    // For each controller, find the closest intersection from all the states
    for (var c = 0; c < this.controllers.length; c++) {
      let controllerData = this.controllers[c];
      if (controllerData.line0) {
        controllerData.line0.scale.z = controllerData.lineBasic.scale.z = this.rayLength;
      }
      controllerData.prevHoverEntries = controllerData.hoverEntries || [];
      let intersections = Object.entries(controllerData.intersections).filter(i => i[1] && this.states[i[0]] && this.allowedState(this.states[i[0]]));
      if (intersections.length > 0) {

        intersections.sort((a,b) => {
          return a[1].distance - b[1].distance;
        });

        const intersectionData = intersections[0];
        const intersection = intersectionData[1];
        const state = this.states[intersectionData[0]];

        controllerData.prevIntersection = controllerData.currentIntersection;
        controllerData.currentIntersection = {
          state, intersection
        };

        if (state.lineStyleOnIntersection) {
          this.setLineStyle(state.lineStyleOnIntersection, controllerData);
        } else {
          this.setLineStyle('advanced', controllerData);
        }

        if (controllerData.line0) {
          controllerData.line0.scale.z = controllerData.lineBasic.scale.z = intersection.distance;
        }
      } else {
        controllerData.currentIntersection = null;
      }
      controllerData.hoverEntries = this.selectionEntries(controllerData);
      controllerData.controller.userData.xrHandPointing = controllerData.hoverEntries.some(entry => entry.state.handTouchable && !entry.state.teleport);
      this.updatePointer(controllerData);
    }

    // A visual actor may have several components and a legacy action. Each one
    // gets balanced hover/selection events while unrelated objects remain occluded.
    for (var c = 0; c < this.controllers.length; c++) {
      let controllerData = this.controllers[c];
      (controllerData.prevHoverEntries || []).forEach(previous => {
        const retained = (controllerData.hoverEntries || []).some(current =>
          previous.state === current.state && previous.intersection.object === current.intersection.object);
        if (!retained && previous.state.onHoverLeave) previous.state.onHoverLeave(previous.intersection, false, controllerData.controller);
      });
      (controllerData.hoverEntries || []).forEach(entry => {
        if (entry.state.onHover) entry.state.onHover(entry.intersection, controllerData.active, controllerData.controller);
      });
    }
  }

  clearHover(controllerData) {
    delete controllerData.controller.userData.xrHandPointing;
    const entries = controllerData.hoverEntries && controllerData.hoverEntries.length ? controllerData.hoverEntries :
      controllerData.currentIntersection ? [controllerData.currentIntersection] : [];
    entries.forEach(entry => entry.state.onHoverLeave && entry.state.onHoverLeave(entry.intersection, false, controllerData.controller));
    controllerData.hoverEntries = [];
    controllerData.prevHoverEntries = [];
  }

  selectionEntries(controllerData) {
    if (!controllerData.enabled || !controllerData.desktop && controllerData.controller.visible === false || controllerData.controller.userData.xrRaySuppressed) return [];
    const current = controllerData.currentIntersection;
    if (!current || !this.allowedState(current.state)) return [];
    const entries = [current];
    Object.keys(controllerData.intersections).forEach(name => {
      const state = this.states[name], hit = controllerData.intersections[name];
      if (!state || !this.allowedState(state) || state === current.state || !hit || (!state.mergeSelection && !current.state.mergeSelection)) return;
      if (Math.abs(hit.distance - current.intersection.distance) > 0.025) return;
      const within = (object, parent) => {
        for (let node = object; node; node = node.parent) if (node === parent) return true;
        return false;
      };
      const actual = hit.actualObject || hit.object, currentActual = current.intersection.actualObject || current.intersection.object;
      if (within(actual, currentActual) || within(currentActual, actual)) entries.push({state, intersection: hit});
    });
    return entries;
  }

  allowedState(state) { return Boolean(state && !(state.teleport && this.ctx.teleport && this.ctx.teleport.blocked && this.ctx.teleport.blocked()) && (!(this.ctx && this.ctx.vrMode && this.ctx.voicePanelOpen) || state.voiceAssistantPanel === true) && (!(this.ctx && this.ctx.vrMode && this.ctx.studioMenuOpen) || state.xrMenu === true)); }

  getIntersections( controller, colliderMesh ) {
    if (!colliderMesh || !controller.userData.isDesktop && controller.visible === false || controller.userData.xrRaySuppressed) return [];
    let raycasterContext = controller.getObjectByName('raycasterContext');
    if (!raycasterContext) {
      console.warn('No raycasterContext found for this controller', controller);
      return [];
    }

    raycasterContext.updateWorldMatrix(true, false);
    tempMatrix.identity().extractRotation( raycasterContext.matrixWorld );

    this.raycaster.ray.origin.setFromMatrixPosition( raycasterContext.matrixWorld );
    this.raycaster.ray.direction.set( 0, 0, - 1 ).transformDirection( tempMatrix );

    if (Array.isArray(colliderMesh)) {
      return this.filterVisible(this.raycaster.intersectObjects(colliderMesh, true));
    } else {
      return this.filterVisible(this.raycaster.intersectObject(colliderMesh, true));
    }
  }

  filterVisible(intersections) {
    // Hidden objects must not remain clickable. Invisible materials are intentional
    // on native teleport surfaces, so visibility here concerns the scene graph only.
    return intersections.filter(hit => {
      if (hit.object.userData.editorGeometryReplaced) return false;
      for (let object = hit.object; object; object = object.parent) {
        // A projected image decorates its underlying surface. It must never
        // consume a native portal/paint/teleport hit or replace the surface UVs.
        if (!object.visible || object.userData.editorDecal) return false;
      }
      return true;
    }).map(hit => {
      const actual = hit.object;
      const document = this.ctx.editor && this.ctx.editor.document;
      for (let object = actual; object; object = object.parent) {
        // Logical descendants of a copied actor own their own functions (for
        // example each xylophone note). Stop before an outer visual wrapper.
        const logicalId = object.userData.editorId;
        if (logicalId && (!document || document.getObject(logicalId) === object)) {
          return object === actual ? hit : Object.assign({}, hit, {actualObject: actual, object});
        }
        const id = object.userData.editorVisualOwnerId;
        if (!id) continue;
        for (let owner = object.parent; owner; owner = owner.parent) {
          if (owner.userData.editorId === id) return Object.assign({}, hit, {actualObject: actual, object: owner});
        }
      }
      return hit;
    });
  }

  onSelectEnd(evt) {
    if (!this.enabled) { return; }

    let controllerData = this.controllers.find(c => c.controller === evt.target)
    if (!controllerData || !controllerData.active) { return; }
    if (!controllerData.enabled || !controllerData.desktop && controllerData.controller.visible === false || controllerData.controller.userData.xrRaySuppressed) { this.cancelSelect(controllerData); return; }

    if (controllerData) {
      const captured = controllerData.selectionCapture || this.selectionEntries(controllerData);
      captured.filter(entry => !this.allowedState(entry.state)).forEach(entry => entry.state.onSelectCancel && entry.state.onSelectCancel(entry.intersection, controllerData.controller));
      const selected = captured.filter(entry => this.allowedState(entry.state));
      selected.forEach(entry => entry.state.onSelectEnd && entry.state.onSelectEnd(entry.intersection, controllerData.controller));

      // Check no raycaster states
      this.currentStates.forEach(state => {
        if (!this.allowedState(state)) return;
        if (controllerData.captureConsumed || selected.some(entry => entry.state.consumeSelect)) return;
        if (controllerData.desktop && state.vrOnly) return;
        if (!this.matchController(controllerData, state.controller)) return;
        if (state.onSelectEnd && !state.raycaster) {
          state.onSelectEnd(null, controllerData.controller);
        }
      });
    }

    controllerData.active = false;
    controllerData.selectionCapture = null;
    controllerData.captureConsumed = false;
  }
}
