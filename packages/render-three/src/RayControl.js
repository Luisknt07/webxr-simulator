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
    this.setLineStyle(this.previousLineStyle);
    this.enabled = true;
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
    this.states = {};
    this.currentStates = [];

    var line = ctx.assets['teleport_model'].scene.getObjectByName('beam');

    ctx.assets['beam_tex'].wrapT = THREE.RepeatWrapping;
    ctx.assets['beam_tex'].wrapS = THREE.RepeatWrapping;
    rayMaterial = line.material = new THREE.ShaderMaterial({
      uniforms: {
        time: {value: 0},
        active: {value: 0},
        tex: {value: ctx.assets['beam_tex']}
      },
      vertexShader: ctx.shaders.basic_vert,
      fragmentShader: ctx.shaders.beam_frag,
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
  }

  setLineStyle(lineStyle, controllerData) {
    const basic = lineStyle === 'basic';
    const apply = data => {
      if (!data.line0) return;
      data.lineBasic.visible = data.enabled && basic;
      data.line0.visible = data.enabled && !basic;
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
    if (controllerData && controllerData.enabled && !controllerData.active) {
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

  cancelSelect(controllerData, state) {
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
    if (!this.enabled || this.currentStates.length === 0) { return; }

    rayMaterial.uniforms.time.value = time;

    let firstHit = false;

    var stateIntersections = {};
    for (var c = 0; c < this.controllers.length; c++) {
      let controllerData = this.controllers[c];
      if (!controllerData.enabled) {
        if (!controllerData.inputSuspended) this.cancelSelect(controllerData);
        controllerData.inputSuspended = true;
        if (controllerData.line0) controllerData.line0.visible = controllerData.lineBasic.visible = false;
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
        let intersections = this.getIntersections(controller, state.colliderMesh);
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

    this.line0.scale.z = Math.min(this.rayLength, 1);
    this.lineBasic.scale.z = Math.min(this.rayLength, 1);

    // For each controller, find the closest intersection from all the states
    for (var c = 0; c < this.controllers.length; c++) {
      let controllerData = this.controllers[c];
      if (controllerData.line0) {
        controllerData.line0.scale.z = controllerData.lineBasic.scale.z = Math.min(this.rayLength, 1);
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
          controllerData.line0.scale.z = Math.min(intersection.distance, 1);
          controllerData.lineBasic.scale.z = Math.min(intersection.distance, 1);
        }
      } else {
        controllerData.currentIntersection = null;
      }
      controllerData.hoverEntries = this.selectionEntries(controllerData);
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
    const entries = controllerData.hoverEntries && controllerData.hoverEntries.length ? controllerData.hoverEntries :
      controllerData.currentIntersection ? [controllerData.currentIntersection] : [];
    entries.forEach(entry => entry.state.onHoverLeave && entry.state.onHoverLeave(entry.intersection, false, controllerData.controller));
    controllerData.hoverEntries = [];
    controllerData.prevHoverEntries = [];
  }

  selectionEntries(controllerData) {
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
      if (within(hit.object, current.intersection.object) || within(current.intersection.object, hit.object)) entries.push({state, intersection: hit});
    });
    return entries;
  }

  allowedState(state) { return Boolean(state && (!(this.ctx && this.ctx.vrMode && this.ctx.voicePanelOpen) || state.voiceAssistantPanel === true) && (!(this.ctx && this.ctx.vrMode && this.ctx.studioMenuOpen) || state.xrMenu === true)); }

  getIntersections( controller, colliderMesh ) {
    let raycasterContext = controller.getObjectByName('raycasterContext');
    if (!raycasterContext) {
      console.warn('No raycasterContext found for this controller', controller);
      return [];
    }

    tempMatrix.identity().extractRotation( raycasterContext.matrixWorld );

    this.raycaster.ray.origin.setFromMatrixPosition( raycasterContext.matrixWorld );
    this.raycaster.ray.direction.set( 0, 0, - 1 ).applyMatrix4( tempMatrix );

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
    if (!controllerData.enabled) { this.cancelSelect(controllerData); return; }

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
