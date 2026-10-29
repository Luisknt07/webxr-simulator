import * as THREE from 'three';
import VehicleCabInteraction from './VehicleCabInteraction.js';
import VehicleDockingMonitor from './VehicleDockingMonitor.js';
import VehicleControlGuide from './VehicleControlGuide.js';
import vehicles from '../../shared/vehicles.js';

const UP = new THREE.Vector3(0, 1, 0);
const ZERO = () => ({throttle: 0, steer: 0, brake: 1, lift: 0, tilt: 0, reach: 0, sideShift: 0, turret: 0});
const DRIVE_KEYS = new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyQ', 'KeyE', 'KeyR', 'KeyT', 'KeyZ', 'KeyX', 'KeyJ', 'KeyL', 'KeyU', 'KeyO', 'KeyF', 'KeyG', 'KeyK', 'KeyH', 'KeyP', 'KeyV', 'KeyB', 'KeyN', 'KeyC', 'Tab']);
const MODES = ['Mástil', 'Alcance / lateral', 'Torreta'];
const VIEWS = ['Cabina', 'Seguimiento'];
VehicleControlGuide.actions.forEach(action => DRIVE_KEYS.add(action.code));
const dead = value => Number.isFinite(value) && Math.abs(value) > .18 ? Math.sign(value) * Math.min(1, (Math.abs(value) - .18) / .82) : 0;
const progressive = (value, exponent) => Math.sign(value) * Math.pow(Math.abs(value), exponent);
const shown = object => { for (let node = object; node; node = node.parent) if (!node.visible) return false; return true; };

/** Input/camera adapter only: load custody and vehicle motion belong to the
 * deterministic runtime. Headset tracking is never overwritten. */
export default class VehicleDriving {
  constructor(ctx, simulation, options = {}) {
    this.ctx = ctx; this.simulation = simulation; this.options = options; this.keys = new Set(); this.blockedKeys = new Set(); this.touches = new Map(); this.padState = new WeakMap();
    this.document = options.document || ctx.document || (typeof document === 'undefined' ? null : document);
    this.window = options.window || this.document && this.document.defaultView || (typeof window === 'undefined' ? null : window);
    this.mode = 0; this.viewIndex = 0; this.chase = false; this.listeners = []; this.position = new THREE.Vector3(); this.rotation = new THREE.Quaternion();
    this.controlGuide = new VehicleControlGuide(); this.operatorIntent = 'auto'; this.xrControlMode = 'cab'; this.worldPage = 'cab';
    if (this.window) {
      this.listen(this.window, 'keydown', event => this.key(event, true), true); this.listen(this.window, 'keyup', event => this.key(event, false), true);
      this.listen(this.window, 'blur', () => this.resetInput());
    }
    if (this.document) {
      this.listen(this.document, 'visibilitychange', () => this.resetInput());
      this.listen(this.document, 'pointerlockchange', () => { if (this.id && !this.ctx.vrMode) { this.resetInput(); this.updateHUD(); } });
    }
    this.cab = new VehicleCabInteraction(this);
    this.docking = new VehicleDockingMonitor(this);
    ctx.vehicleDriving = this;
  }
  listen(target, type, callback, options) { if (!target || !target.addEventListener) return; target.addEventListener(type, callback, options); this.listeners.push(() => target.removeEventListener(type, callback, options)); }
  notify(message) { if (this.options.notify) this.options.notify(message); else if (this.ctx.editor && this.ctx.editor.toast) this.ctx.editor.toast(message); }
  authority() { const room = this.ctx.studio && this.ctx.studio.room; return !room || room.role === 'host'; }
  record() { return this.id && this.simulation.records.get(this.id); }
  blocked() {
    const ctx = this.ctx, editor = ctx.editor, studio = ctx.studio;
    const xr = ctx.renderer && ctx.renderer.xr, session = xr && xr.getSession && xr.getSession();
    return !this.authority() || !this.simulation.running || editor && (editor.active || editor.loadingProject || editor.busy || editor.simulationPaused) ||
      ctx.studioMenuOpen || ctx.roomTransition || ctx.xrEntryPending || ctx.xrExitPending || this.document && this.document.hidden ||
      studio && studio.drawer && !studio.drawer.hidden || ctx.vrMode && (!session || session.visibilityState && session.visibilityState !== 'visible' || ctx.raycontrol && ctx.raycontrol.enabled === false);
  }
  panelSelectable(controller) {
    // A ray emitted by a hand on the physical wheel/lever must not capture its
    // trigger and cancel the grasp. Keep the other hand available for buttons.
    const cab = this.cab, hand = controller && cab && cab.hands.get(controller);
    const data = hand && hand.data || controller && this.ctx.raycontrol && this.ctx.raycontrol.controllers && this.ctx.raycontrol.controllers.find(value => value.controller === controller);
    if (!hand && !data) return true;
    if (hand && (hand.control || hand.hover || cab.owns(hand.source))) return false;
    const pose = hand ? cab.pose(hand) : data.grip && data.grip.visible !== false ? data.grip : data.controller;
    if (!pose) return false;
    const point = pose.getWorldPosition(new THREE.Vector3());
    return !cab.controls.some(control => {cab.frame(control); return cab.distance(control, point) <= Math.max(.16, control.descriptor.grabDistance || .105);});
  }
  placeCabPanel(plane, position) {
    plane.position.fromArray(position);
    plane.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), plane.position, UP));
  }
  cabPanelLayout() {
    const rig = this.visualRoot && this.visualRoot.userData.vehicleRig, cab = rig && rig.cabDimensions;
    // Look past the side of the actual front pillar, with room for half the
    // widest menu. This keeps the forward road and the physical controls free
    // instead of putting a taller floating dashboard through the roof bars.
    const pillarAngle = cab ? Math.atan2(cab.x, cab.z - rig.driverSeat.position.z) : Math.atan2(.5, .78);
    const angle = Math.min(70 * Math.PI / 180, pillarAngle + 24 * Math.PI / 180), radius = 1.25;
    const x = Math.sin(angle) * radius, z = Math.cos(angle) * radius;
    return {controls: [-x, .20, z], alignment: [-x, -.34, z], front: {position: [x, .08, z], width: .68, height: .3825}, mirror: {position: [x, .405, z], width: .36, height: .2025}};
  }
  nearest() {
    if (!this.ctx.camera || !this.simulation.running) return null;
    const point = this.ctx.camera.getWorldPosition(new THREE.Vector3()); let best = null, distance = 5;
    this.simulation.records.forEach(record => { if (!record.components.vehicle || !shown(record.object)) return; const next = record.object.getWorldPosition(new THREE.Vector3()).distanceTo(point); if (next < distance) { best = record; distance = next; } }); return best;
  }
  visual(record) { let found; record.object.traverse(node => { if (node.userData.vehicleRig) found = node; }); return found; }
  mount(id) {
    if (this.id) return this.id === id;
    if (!this.authority()) { this.notify('En una sala compartida, la conducción la controla el anfitrión.'); return false; }
    const record = this.simulation.records.get(id); if (!record || !record.components.vehicle || !shown(record.object) || this.blocked()) return false;
    if (record.components.vehicle.towedBy) { this.notify('Desengancha el remolque antes de operarlo de forma independiente.'); return false; }
    if (this.simulation.held.size) { this.notify('Deposita la carga de tus manos antes de conducir.'); return false; }
    if (Math.abs(record.components.vehicle.actualSpeed || 0) > .15) { this.notify('Detén el vehículo antes de subir.'); return false; }
    const visual = this.visual(record), rig = visual && visual.userData.vehicleRig, seat = rig && rig.driverSeat;
    if (!seat || !this.ctx.cameraRig) { this.notify('Este vehículo no dispone de puesto de conducción.'); return false; }
    const cameraRig = this.ctx.cameraRig, camera = this.ctx.camera;
    cameraRig.updateWorldMatrix(true, true); seat.updateWorldMatrix(true, false);
    this.saved = {rigPosition: cameraRig.position.clone(), rigQuaternion: cameraRig.quaternion.clone(), cameraPosition: camera.position.clone(), cameraQuaternion: camera.quaternion.clone(), flight: this.ctx.desktopFlight};
    this.id = id; this.seat = seat; this.visualRoot = visual; this.roomId = this.simulation.roomId; this.ctx.drivingVehicle = id; this.ctx.desktopFlight = false; this.mode = 0;
    record.components.vehicle.driving = true; this.viewIndex = 0; this.chase = false; this.docking.visible = true; this.docking.page = 'alignment';
    this.operatorIntent = 'auto'; this.guidedEntry = null; this.guideUpdated = -Infinity; this.hudUpdated = -Infinity; this.xrControlMode = 'cab'; this.worldPage = 'cab';
    const vehicleRotation = record.object.getWorldQuaternion(new THREE.Quaternion());
    this.mountHead = new THREE.Vector3(); this.yawOffset = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI);
    if (this.ctx.vrMode) {
      const tracked = this.ctx.renderer.xr.getCamera(camera), head = new THREE.Vector3().setFromMatrixPosition(tracked.matrixWorld);
      this.mountHead.copy(head).applyMatrix4(new THREE.Matrix4().getInverse(cameraRig.matrixWorld));
      const forward = new THREE.Vector3(0, 0, -1).transformDirection(tracked.matrixWorld), target = new THREE.Vector3(0, 0, 1).applyQuaternion(vehicleRotation);
      const deltaYaw = Math.atan2(target.x, target.z) - Math.atan2(forward.x, forward.z), initial = cameraRig.getWorldQuaternion(new THREE.Quaternion()).premultiply(new THREE.Quaternion().setFromAxisAngle(UP, deltaYaw));
      this.yawOffset.copy(vehicleRotation).inverse().multiply(initial);
    } else { camera.position.set(0, 0, 0); camera.quaternion.set(0, 0, 0, 1); }
    this.resetInput(); this.releaseCursor(); this.cab.mount(visual); this.buildHUD(); if (this.help) this.help.open = false; this.buildWorldPanel(record); this.docking.mount(); this.follow(); this.updateHUD();
    this.notify(this.ctx.vrMode ? 'Cabina RV activa: agarre lateral en volante o palancas; stick izquierdo avanza, gatillo izquierdo frena. Click del stick derecho abre los mandos; B derecho permite bajar detenido.' : 'Cabina: Encender (B) → Marcha (V) → liberar Freno P (P). Sigue la guía resaltada; Tab alterna cursor y mirada.'); return true;
  }
  resetInput(preservePads = false) { this.keys.forEach(key => this.blockedKeys.add(key)); this.keys.clear(); this.touches.clear(); if (!preservePads) this.padState = new WeakMap(); if (this.cab) this.cab.reset(); const record = this.record(); if (record && this.simulation.vehicleRuntime) this.simulation.vehicleRuntime.setInput(record, ZERO()); }
  releaseCursor() {
    if (this.ctx.vrMode) return false;
    const look = this.ctx.desktopLook;
    if (look && look.unlock) look.unlock(); else if (this.document && this.document.pointerLockElement && this.document.exitPointerLock) this.document.exitPointerLock();
    return true;
  }
  toggleCursor() {
    if (this.ctx.vrMode) return false;
    this.resetInput(); const look = this.ctx.desktopLook;
    if (this.document && this.document.pointerLockElement || look && look.isLocked) this.releaseCursor(); else if (look && look.lock) look.lock();
    this.updateHUD(); return true;
  }
  state(record = this.record()) {
    if (!record) return null; const vehicle = record.components.vehicle;
    return Object.assign({}, record.variables || {}, {powered: vehicle.powered, running: vehicle.running, paused: vehicle.paused, emergency: vehicle.emergency,
      parkingBrake: vehicle.parkingBrake, lights: vehicle.lights, batteryPercent: vehicle.batteryPercent, actualSpeed: vehicle.actualSpeed, warning: vehicle.warning});
  }
  guidance(state) {
    if (state.emergency) return this.ctx.vrMode ? 'Emergencia activa: pulsa Rearmar en el tablero y después Marcha.' : 'Emergencia activa: pulsa Rearmar (Shift+Y) y después Marcha (V).';
    if (state.batteryPercent <= 0) return 'Batería agotada: configura la carga antes de operar.';
    if (!state.powered) return '1. Pulsa Encender' + (this.ctx.vrMode ? '' : ' (B)') + '. Después Marcha y desactiva Freno P.';
    if (!state.running || state.paused) return '2. Pulsa Marcha' + (this.ctx.vrMode ? '' : ' (V)') + '. Después desactiva Freno P.';
    if (state.parkingBrake) return '3. Desactiva Freno P' + (this.ctx.vrMode ? '' : ' (P)') + ' para desplazarte.';
    return state.warning || 'Listo para conducir.';
  }
  command(action) {
    const record = this.record(); if (!record) return false;
    if (this.blocked()) { this.notify('Cierra el menú o reanuda la simulación para usar la cabina.'); return false; }
    try { if (action === 'mode') { this.mode = (this.mode + 1) % MODES.length; this.updateHUD(); return true; } if (action === 'exit') return this.unmount();
      if (action === 'cursor') return this.toggleCursor();
      if (action === 'controls') { this.worldPage = this.worldPage === 'cab' ? 'controls' : 'cab'; this.resetInput(); this.paintWorldPanel(); return true; }
      if (action === 'xrControls') { this.resetInput(); this.xrControlMode = this.xrControlMode === 'cab' ? 'controllers' : 'cab'; this.hudUpdated = -Infinity; this.updateHUD(); return true; }
      if (action === 'depositIntent') { this.operatorIntent = 'deposit'; this.guideUpdated = -Infinity; this.hudUpdated = -Infinity; this.updateHUD(); return true; }
      if (action === 'forkCameraMode') { this.docking.forkCamera.toggleMode(); this.docking.update(true); return true; }
      if (action === 'forkCameraSide') { this.docking.forkCamera.switchSide(); return true; }
      if (action === 'view') return this.cycleView();
      if (action === 'dockingHelp') { this.docking.toggle(); this.updateHUD(); return true; }
      if (action === 'forkCamera') { this.docking.toggleCamera(); this.updateHUD(); return true; }
      if (['stop', 'powerOff', 'emergency', 'parkingBrake'].includes(action)) this.resetInput();
      const result = this.simulation.command(record.id, action);
      if (result !== false && action === 'pickup' && record.components.vehicle.entry) this.operatorIntent = 'transport';
      if (result !== false && action === 'release' && !record.components.vehicle.entry) this.operatorIntent = 'auto';
      this.guideUpdated = this.hudUpdated = -Infinity; this.updateHUD();
      if (['powerOn', 'start', 'stop', 'powerOff', 'emergency', 'resetEmergency', 'parkingBrake'].includes(action)) this.notify(this.guidance(this.state(record)));
      else if (result === false && record.components.vehicle.warning) this.notify(record.components.vehicle.warning);
      return result; }
    catch (error) { this.notify(error.message); return false; }
  }
  key(event, down) {
    const target = event.target || {}, typing = target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName || '');
    if (!down) { this.blockedKeys.delete(event.code); this.keys.delete(event.code); }
    if (!this.id) { if (down && event.code === 'KeyF' && !event.repeat && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && !event.isComposing && !typing && !(this.ctx.editor && this.ctx.editor.active)) { const record = this.nearest(); if (record) { event.preventDefault(); this.mount(record.id); } } return; }
    if (!DRIVE_KEYS.has(event.code) || typing || event.ctrlKey || event.altKey || event.metaKey) return;
    event.preventDefault(); if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    if (!down) { this.keys.delete(event.code); return; }
    if (this.blocked()) { this.resetInput(); return; }
    if (this.blockedKeys.has(event.code)) return;
    const action = VehicleControlGuide.shortcut(event);
    if (event.isComposing || event.shiftKey && !action && !event.repeat) { this.keys.delete(event.code); return; }
    if (event.shiftKey && event.repeat) { this.keys.delete(event.code); return; }
    this.keys.add(event.code); if (event.repeat) return;
    if (action) this.command(action);
  }
  xrInput(input) {
    const ctx = this.ctx;
    for (const data of ctx.raycontrol && ctx.raycontrol.controllers || []) {
      const source = data.inputSource, pad = source && source.gamepad;
      if (data.desktop || data.enabled === false || !source || source.hand || source.targetRayMode && source.targetRayMode !== 'tracked-pointer' || !['left', 'right'].includes(source.handedness) || !pad || pad.mapping !== 'xr-standard') continue;
      const axes = pad.axes || [], index = axes.length >= 4 ? 2 : 0, x = dead(axes[index]), y = dead(axes[index + 1]), buttons = pad.buttons || [];
      const pressed = index => !!(buttons[index] && (buttons[index].pressed || buttons[index].value > .6));
      let state = this.padState.get(source);
      if (!state) { state = {armed: false, grip: pressed(1), click: pressed(3), secondary: pressed(5)}; this.padState.set(source, state); }
      const grip = pressed(1), click = pressed(3), secondary = pressed(5);
      if (this.cab.releasedSources.has(source)) state.armed = false;
      const physical = this.cab.owns(source);
      if (!x && !y && !grip && !click && !secondary) state.armed = true;
      if (state.armed) {
        // Fine stick movement meters traction/direction gently; full travel
        // retains full authority. The runtime owns actual acceleration/rates.
        if (source.handedness === 'left') {
          input.throttle = progressive(-y, 1.35);
          if (this.xrControlMode === 'controllers' || !this.cab.controls.some(control => control.channel === 'steer')) input.steer = progressive(x, 1.5);
          if (this.xrControlMode === 'controllers' && grip && !physical) input.brake = 1;
          if (this.xrControlMode === 'cab' && pressed(0)) input.brake = Math.max(input.brake, Math.min(1, buttons[0].value || 1));
          if (click && !state.click) this.command('horn');
        }
        else {
          if (this.xrControlMode === 'controllers') {
            if (this.mode === 0) { input.lift = -y; input.tilt = x; } else if (this.mode === 1) { input.reach = -y; input.sideShift = x; } else { input.lift = -y; input.turret = x; }
            if (grip && !state.grip && !physical) this.command(this.record().components.vehicle.entry ? 'release' : 'pickup');
          }
          if (click && !state.click) this.command(this.xrControlMode === 'cab' ? 'controls' : 'mode');
          if (secondary && !state.secondary) { this.unmount(); return; }
        }
      }
      state.grip = grip; state.click = click; state.secondary = secondary;
    }
  }
  beforeStep() {
    const record = this.record(); if (!this.id) { this.updateHUD(); return; }
    if (!record || this.simulation.roomId !== this.roomId || !shown(record.object)) { this.unmount(true); return; }
    const vehicle = record.components.vehicle;
    if (this.blocked()) { this.resetInput(); this.machineInputBlocked = true; this.updateHUD(); return; }
    if (!vehicle.enabled || !vehicle.powered || !vehicle.running || vehicle.paused || vehicle.emergency) {
      if (!this.machineInputBlocked) this.resetInput(); this.machineInputBlocked = true;
      // A stopped cockpit retains command buttons (including B to exit), but
      // cannot forward hydraulic/drive axes or stale held controls.
      if (this.ctx.vrMode) this.xrInput(ZERO()); this.resetInput(true); this.updateHUD(); return;
    }
    if (this.machineInputBlocked) { this.resetInput(); this.machineInputBlocked = false; }
    const key = code => this.keys.has(code) || [...this.touches.values()].includes(code), axis = (a, b) => Number(key(a)) - Number(key(b));
    const input = {throttle: axis('KeyW', 'KeyS'), steer: axis('KeyD', 'KeyA'), brake: key('Space') ? 1 : 0,
      lift: axis('KeyQ', 'KeyE') + axis('ArrowUp', 'ArrowDown'), tilt: axis('KeyT', 'KeyR'), reach: axis('KeyX', 'KeyZ'), sideShift: axis('KeyL', 'KeyJ'), turret: axis('KeyO', 'KeyU')};
    this.cab.sample();
    if (this.ctx.vrMode) this.xrInput(input);
    this.cab.apply(input);
    if (vehicle.entry && input.lift < -.05) this.operatorIntent = 'deposit';
    Object.keys(input).forEach(key => { input[key] = Math.max(-1, Math.min(1, input[key])); });
    if (this.id) this.simulation.vehicleRuntime.setInput(record, input); this.updateHUD();
  }
  follow() {
    const record = this.record(); if (!record || !this.seat) return;
    const rig = this.ctx.cameraRig; record.object.updateWorldMatrix(true, true); this.seat.getWorldPosition(this.position);
    const worldRotation = record.object.getWorldQuaternion(new THREE.Quaternion()).multiply(this.yawOffset);
    if (this.chase && !this.ctx.vrMode) this.position.add(new THREE.Vector3(0, 1.5, -4).applyQuaternion(record.object.getWorldQuaternion(new THREE.Quaternion())));
    this.position.sub(this.mountHead.clone().applyQuaternion(worldRotation));
    rig.position.copy(rig.parent ? rig.parent.worldToLocal(this.position.clone()) : this.position);
    rig.quaternion.copy(rig.parent ? rig.parent.getWorldQuaternion(new THREE.Quaternion()).inverse().multiply(worldRotation) : worldRotation); rig.updateWorldMatrix(true, true);
  }
  cycleView() {
    if (this.ctx.vrMode) { this.docking.toggle(); this.updateHUD(); return true; }
    this.viewIndex = (this.viewIndex + 1) % VIEWS.length; this.chase = this.viewIndex === 1;
    if (this.ctx.desktopLook && this.ctx.desktopLook.reset) this.ctx.desktopLook.reset();
    this.ctx.camera.position.set(0, 0, 0); this.ctx.camera.quaternion.set(0, 0, 0, 1);
    this.follow(); this.updateHUD(); return true;
  }
  unmount(force = false) {
    if (!this.id) return true; const record = this.record(), ctx = this.ctx, rig = ctx.cameraRig, camera = ctx.camera;
    let destination;
    if (!force && record) {
      if (Math.abs(record.components.vehicle.actualSpeed || 0) > .1) { this.notify('Frena el vehículo antes de bajar.'); return false; }
      const config = record.components.vehicle.config, center = record.object.getWorldPosition(new THREE.Vector3());
      for (const side of [-1, 1]) {
        const point = record.object.localToWorld(new THREE.Vector3(side * (config.width / 2 + .65), 1.6, 0));
        point.y = center.y + 1.6;
        if (!ctx.collisionWorld || ctx.collisionWorld.canOccupyCapsule(point, {radius: .25, height: 1.6, eyeHeight: 1.6})) { destination = point; break; }
      }
      if (!destination) { this.notify('No hay espacio junto al vehículo para bajar.'); return false; }
    }
    this.resetInput(); if (record && this.simulation.vehicleRuntime) { this.simulation.vehicleRuntime.setInput(record, ZERO()); record.components.vehicle.parkingBrake = true; record.components.vehicle.driving = false; }
    const saved = this.saved;
    let localHead;
    if (ctx.vrMode && destination) {
      rig.updateWorldMatrix(true, true);
      localHead = new THREE.Vector3().setFromMatrixPosition(ctx.renderer.xr.getCamera(camera).matrixWorld).applyMatrix4(new THREE.Matrix4().getInverse(rig.matrixWorld));
    }
    if (saved) {
      rig.position.copy(saved.rigPosition); rig.quaternion.copy(saved.rigQuaternion);
      if (!ctx.vrMode) { camera.position.copy(saved.cameraPosition); camera.quaternion.copy(saved.cameraQuaternion); }
      ctx.desktopFlight = saved.flight;
      rig.updateWorldMatrix(true, true);
      if (destination) {
        const head = ctx.vrMode ? localHead.applyMatrix4(rig.matrixWorld) : camera.getWorldPosition(new THREE.Vector3());
        const nextRig = rig.getWorldPosition(new THREE.Vector3()).add(destination.sub(head));
        rig.position.copy(rig.parent ? rig.parent.worldToLocal(nextRig) : nextRig);
      }
    }
    this.cab.clear(); this.docking.unmount(); this.removeWorldPanel(); this.id = null; this.seat = null; this.saved = null; ctx.drivingVehicle = null; if (ctx.resetCollisionPose) ctx.resetCollisionPose(); this.updateHUD(); return true;
  }
  features() { const record = this.record(); return record ? vehicles.supports(record.components.vehicle.config) : {}; }
  definitions() { const record = this.record(); return record ? VehicleControlGuide.definitions(this.features(), record.components.vehicle.config) : []; }
  updateGuide(force = false) {
    const record = this.record(); if (!record) return;
    const vehicle = record.components.vehicle, entry = vehicle.entry, now = this.simulation.time || 0;
    if (entry !== this.guidedEntry) { this.operatorIntent = entry ? 'transport' : 'auto'; this.guidedEntry = entry; force = true; }
    const signature = [vehicle.powered, vehicle.running, vehicle.paused, vehicle.emergency, vehicle.parkingBrake, this.blocked(), this.ctx.vrMode, this.operatorIntent].join('|');
    if (!force && signature === this.guideSignature && now >= this.guideUpdated && now - this.guideUpdated < .2) return;
    this.guideUpdated = now; this.guideSignature = signature;
    this.nextStep = this.controlGuide.evaluate({vehicle, features: this.features(), docking: this.docking.snapshot, blocked: this.blocked(), xr: !!this.ctx.vrMode, intent: this.operatorIntent});
    const action = this.nextStep.action;
    const channel = /^(lift|alignHeight)/.test(action) ? 'lift' : /^(tilt|alignTilt)/.test(action) ? 'tilt' : /^(retract|extend)/.test(action) ? 'reach' : /^(side|alignLateral)/.test(action) && this.features().sideShift ? 'sideShift' : /^turret/.test(action) ? 'turret' : /^(steer|alignYaw|alignLateral)/.test(action) ? 'steer' : null;
    this.cab.setGuidance(this.ctx.vrMode ? channel : null);
  }
  controlButton(action, parent) {
    const dom = this.document, definition = VehicleControlGuide.actions.find(value => value.action === action);
    if (!definition) return null;
    const button = dom.createElement('button'); button.type = 'button';
    const label = dom.createElement('span'), key = dom.createElement('kbd'); label.textContent = definition.label; key.className = 'vehicle-control-key'; key.textContent = definition.key;
    button.appendChild(label); button.appendChild(key); button.controlLabel = label; button.setAttribute('aria-label', definition.label + ' (' + definition.key + ')');
    if (definition.continuous) {
      button.dataset.vehicleHold = definition.code;
      this.listen(button, 'pointerdown', event => { if (!this.id || this.blocked()) return; event.preventDefault(); this.touches.set(event.pointerId, definition.code); if (button.setPointerCapture) button.setPointerCapture(event.pointerId); });
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => this.listen(button, type, event => this.touches.delete(event.pointerId)));
    } else { button.dataset.vehicleCommand = action; this.listen(button, 'click', () => this.command(action)); this.actionButtons.set(action, button); }
    this.controlButtons.set(action, button); if (parent.controls) parent.controls.push(button); parent.appendChild(button); return button;
  }
  buildHUD() {
    const dom = this.document; if (this.hud || !dom || !dom.body || !dom.createElement) return;
    const element = (tag, name, parent, text) => { const node = dom.createElement(tag); node.className = name; if (text) node.textContent = text; parent.appendChild(node); return node; };
    const hud = dom.createElement('section'); hud.className = 'vehicle-driving-hud'; hud.setAttribute('aria-label', 'Puesto de conducción'); this.hud = hud;
    const header = element('div', 'vehicle-driving-header', hud);
    this.status = element('strong', 'vehicle-driving-name', header);
    const summary = element('div', 'vehicle-driving-summary', header); this.telemetry = element('span', '', summary); this.phase = element('span', 'vehicle-control-status', summary);
    const guide = element('div', 'vehicle-next-step', hud); this.guideTitle = element('span', 'vehicle-next-step-title', guide, 'Siguiente paso');
    this.guideText = element('span', 'vehicle-next-step-text', guide); this.guideText.setAttribute('aria-live', 'polite'); this.guideText.setAttribute('aria-atomic', 'true'); this.guideElement = guide;
    this.actionButtons = new Map(); this.controlButtons = new Map(); this.controlGroups = [];
    const groups = element('div', 'vehicle-control-groups vehicle-driving-actions', hud);
    const group = (parent, title, name) => { const node = element('div', 'vehicle-control-group', parent); node.dataset.group = name; node.controls = []; node.heading = element('h3', 'vehicle-control-group-title', node, title); this.controlGroups.push(node); return node; };
    const drive = group(groups, '1 · Conducción', 'drive');
    ['powerOn', 'start', 'parkingBrake', 'brake', 'emergency', 'exit'].forEach(action => this.controlButton(action, drive));
    const cargo = group(groups, '2 · Carga y descarga', 'cargo'); this.cargoGroup = cargo;
    ['pickup', 'release', 'liftUp', 'liftDown', 'depositIntent', 'forkCamera', 'couple', 'uncouple'].forEach(action => this.controlButton(action, cargo));
    const details = element('details', 'vehicle-driving-help', hud); this.help = details; element('summary', '', details, 'Todos los mandos · dirección, hidráulica y seguridad');
    this.hint = element('p', '', details);
    const secondary = element('div', 'vehicle-control-groups vehicle-driving-actions', details);
    const movement = group(secondary, 'Dirección · mantener pulsado', 'movement'); ['driveForward', 'driveReverse', 'steerLeft', 'steerRight'].forEach(action => this.controlButton(action, movement));
    const hydraulic = group(secondary, 'Hidráulica · mantener pulsado', 'hydraulic'); ['tiltBack', 'tiltForward', 'retract', 'extend', 'sideLeft', 'sideRight', 'turretLeft', 'turretRight'].forEach(action => this.controlButton(action, hydraulic));
    const safety = group(secondary, 'Energía y seguridad', 'safety'); ['stop', 'pause', 'powerOff', 'resetEmergency', 'lights', 'horn'].forEach(action => this.controlButton(action, safety));
    const view = group(secondary, 'Vista y opciones', 'view'); ['view', 'dockingHelp', 'forkCameraMode', 'forkCameraSide', 'cursor', 'mode'].forEach(action => this.controlButton(action, view));
    this.viewButton = this.actionButtons.get('view'); this.viewButton.dataset.vehicleView = '';
    this.dockingButton = this.actionButtons.get('dockingHelp'); this.dockingButton.dataset.vehicleDockingHelp = '';
    this.forkCameraButton = this.actionButtons.get('forkCamera'); this.forkCameraButton.dataset.vehicleForkCamera = '';
    ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach(type => this.listen(hud, type, event => { if (event.stopPropagation) event.stopPropagation(); }));
    dom.body.appendChild(hud);
  }
  updateHUD() {
    this.docking.update(); this.updateGuide();
    if (this.worldPanel) this.worldPanel.plane.visible = !!this.ctx.vrMode && !!this.id;
    if (!this.hud) { if (this.id) this.buildHUD(); else return; }
    const record = this.record(); this.hud.hidden = !record || this.ctx.vrMode || this.ctx.editor && this.ctx.editor.active;
    if (!record) return;
    const v = this.state(record), vehicle = record.components.vehicle, next = this.nextStep || {}, now = this.simulation.time || 0;
    const signature = [record.id, v.powered, v.running, v.paused, v.emergency, v.parkingBrake, this.viewIndex, this.docking.visible, this.docking.cameraEnabled, this.mode, next.stage, next.action, this.operatorIntent, this.xrControlMode, this.worldPage].join('|');
    if (signature === this.hudSignature && now >= this.hudUpdated && now - this.hudUpdated < .2) return;
    this.hudUpdated = now; this.hudSignature = signature;
    const phase = v.emergency ? 'Emergencia' : !v.powered ? 'Apagado' : v.paused ? 'En pausa' : v.running ? 'En marcha' : 'Detenido';
    this.status.textContent = record.object.name;
    this.telemetry.textContent = Number(v.actualSpeed || 0).toFixed(2) + ' m/s · Altura ' + Number(v.lift || v.liftHeight || vehicle.pose && vehicle.pose.lift || 0).toFixed(2) + ' m · Carga ' + Number(v.loadKg || 0).toFixed(0) + ' kg';
    this.phase.textContent = phase + ' · Freno P ' + (v.parkingBrake ? 'activo' : 'libre'); this.phase.dataset.tone = v.emergency ? 'danger' : v.parkingBrake || !v.powered ? 'warning' : 'ready';
    this.guideTitle.textContent = next.title || 'Siguiente paso';
    this.guideText.textContent = [next.instruction, next.control && 'Mando: ' + next.control, next.reason].filter(Boolean).join(' · ');
    this.guideElement.dataset.tone = v.emergency ? 'danger' : next.canAct ? 'ready' : 'warning';
    this.hint.textContent = 'Pulsa la tecla indicada o el botón. Los mandos de movimiento se mantienen pulsados. Tab alterna cursor y mirada; Esc libera el mouse. Sólo se muestran las funciones de este vehículo.';
    this.viewButton.controlLabel.textContent = 'Vista: ' + VIEWS[this.viewIndex];
    this.actionButtons.get('mode').controlLabel.textContent = 'Sticks RV: ' + MODES[this.mode];
    this.dockingButton.setAttribute('aria-pressed', String(this.docking.visible)); this.forkCameraButton.setAttribute('aria-pressed', String(this.docking.cameraEnabled));
    const supported = new Set(this.definitions().map(value => value.action));
    const active = {powerOn: v.powered, powerOff: !v.powered, start: v.running && !v.paused && !v.emergency, pause: v.paused, parkingBrake: v.parkingBrake, lights: v.lights, emergency: v.emergency};
    const related = {alignHeight: ['liftUp', 'liftDown'], alignYaw: ['steerLeft', 'steerRight'], alignLateral: this.features().sideShift ? ['sideLeft', 'sideRight'] : ['steerLeft', 'steerRight']};
    this.controlButtons.forEach((button, action) => {
      button.hidden = !supported.has(action) || action === 'depositIntent' && !vehicle.entry;
      button.disabled = this.blocked();
      button.dataset.recommended = String(!!next.canAct && (next.action === action || (related[next.action] || []).includes(action)));
      if (action in active) button.setAttribute('aria-pressed', String(!!active[action]));
    });
    this.cargoGroup.heading.textContent = this.features().hitch && !this.features().forks && !this.features().platform ? '2 · Enganche y remolque' : '2 · Carga y descarga';
    this.controlGroups.forEach(group => { group.hidden = group.controls.every(button => button.hidden); });
    if (this.worldPanel) this.paintWorldPanel();
  }
  buildWorldPanel() {
    if (!this.document || !this.document.createElement) return;
    const canvas = this.document.createElement('canvas'); canvas.width = 1024; canvas.height = 640; const context = canvas.getContext && canvas.getContext('2d'); if (!context) return;
    const texture = new THREE.CanvasTexture(canvas); texture.encoding = THREE.sRGBEncoding; texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter;
    const plane = new THREE.Mesh(new THREE.PlaneBufferGeometry(.82, .512), new THREE.MeshBasicMaterial({map: texture}));
    plane.name = 'Consola de conducción'; plane.userData.editorRuntimeHelper = true;
    plane.visible = !!this.ctx.vrMode; this.seat.add(plane); this.worldPanel = {plane, context, texture, actions: [], regions: [], signature: ''};
    const name = this.simulation.statePrefix + 'vehicle-driving-panel', state = {colliderMesh: plane, controller: 'both', raycaster: true, consumeSelect: true, mergeSelection: true, captureSelect: true,
      isSelectable: (hit, controller) => !!this.id && !!this.ctx.vrMode && plane.visible && !this.blocked() && this.panelSelectable(controller),
      onSelectStart: (hit, controller) => { if (!state.isSelectable(hit, controller) || !hit || !hit.uv) return; const x = hit.uv.x * 1024, y = (1 - hit.uv.y) * 640;
        const region = this.worldPanel.regions.find(value => x >= value.x && x < value.x + value.w && y >= value.y && y < value.y + value.h); if (region) this.command(region.action);
      }};
    const input = this.ctx.raycontrol; if (input) { input.addState(name, state); input.activateState(name); this.worldState = {name, state}; }
    this.paintWorldPanel();
  }
  paintWorldPanel() {
    const panel = this.worldPanel, record = this.record(); if (!panel || !record) return;
    const v = this.state(record), next = this.nextStep || {}, full = this.worldPage === 'controls';
    const signature = [v.actualSpeed, v.lift, v.loadKg, v.parkingBrake, v.powered, v.running, v.paused, v.emergency, next.stage, next.instruction, next.reason, next.action, this.mode, this.xrControlMode, this.worldPage, this.operatorIntent, this.docking.visible, this.docking.cameraEnabled].map(value => typeof value === 'number' ? value.toFixed(1) : value).join('|');
    if (panel.signature === signature) return; panel.signature = signature;
    panel.plane.scale.setScalar(full ? 1 : .68); this.placeCabPanel(panel.plane, this.cabPanelLayout().controls);
    const c = panel.context, text = (value, x, y, width, size = 25, lines = 2) => {
      c.font = size + 'px sans-serif'; const words = String(value || '').split(/\s+/); let line = '', row = 0;
      words.forEach(word => { const candidate = line ? line + ' ' + word : word; if (line && (c.measureText ? c.measureText(candidate).width : candidate.length * size * .54) > width) { if (row < lines) c.fillText(line, x, y + row * (size + 6)); row++; line = word; } else line = candidate; });
      if (row < lines) c.fillText(line, x, y + row * (size + 6));
    };
    c.fillStyle = '#0b1d28'; c.fillRect(0, 0, 1024, 640); c.fillStyle = '#8ce4d3'; text(full ? 'MANDOS DEL VEHÍCULO' : 'CABINA · ' + (this.xrControlMode === 'cab' ? 'MANDOS FÍSICOS' : 'STICKS ALTERNATIVOS'), 28, 42, 950, 29, 1);
    c.fillStyle = '#eff6fb'; text(Number(v.actualSpeed || 0).toFixed(2) + ' m/s · ' + Number(v.loadKg || 0).toFixed(0) + ' kg · ' + (!v.powered ? 'APAGADO' : v.emergency ? 'EMERGENCIA' : v.running ? 'MARCHA' : 'PARADO') + ' · Freno ' + (v.parkingBrake ? 'P' : 'libre'), 28, 81, 965, 25, 1);
    c.fillStyle = '#f1d286'; text(next.title || 'Siguiente paso', 28, 120, 960, 26, 1);
    c.fillStyle = '#edf5f8'; text(next.instruction, 28, 154, 955, 24, full ? 1 : 2);
    if (!full) { c.fillStyle = '#a9c5cf'; text(this.xrControlMode === 'cab' ? 'Agarre lateral: volante / palancas. Stick izq.: avanzar y retroceder. Gatillo izq.: frenar.' : 'Stick izq.: conducir. Stick der.: hidráulica. Agarre der.: tomar / depositar. Agarre izq.: frenar.', 28, 225, 960, 24, 2); }
    const definitions = this.definitions().filter(value => !value.continuous && !['view', 'cursor', 'forkCameraSide', 'forkCameraMode'].includes(value.action) && (value.action !== 'depositIntent' || record.components.vehicle.entry));
    const supported = new Set(definitions.map(value => value.action));
    let actions = full ? definitions.map(value => [value.action, value.label]) : [!v.powered ? 'powerOn' : !v.running || v.paused ? 'start' : 'parkingBrake', record.components.vehicle.entry ? this.operatorIntent === 'deposit' ? 'release' : 'depositIntent' : 'pickup', 'emergency', 'exit'].filter(action => supported.has(action)).map(action => [action, VehicleControlGuide.actions.find(value => value.action === action).label]);
    actions = actions.concat([['xrControls', this.xrControlMode === 'cab' ? 'RV: Cabina → Sticks' : 'RV: Sticks → Cabina'], ['controls', full ? 'Volver a la cabina' : 'Todos los mandos']]);
    panel.actions = actions; panel.regions = [];
    const columns = full ? 3 : 2, rows = Math.ceil(actions.length / columns), top = full ? 190 : 310, bottom = 590, height = (bottom - top) / rows, width = 1024 / columns;
    const active = {powerOn: v.powered, start: v.running && !v.paused && !v.emergency, parkingBrake: v.parkingBrake, lights: v.lights, emergency: v.emergency};
    actions.forEach(([action, label], index) => {
      const x = index % columns * width + 12, y = top + Math.floor(index / columns) * height + 4, w = width - 24, h = height - 8;
      panel.regions.push({action, x, y, w, h}); c.fillStyle = action === 'emergency' ? '#763b41' : next.action === action && next.canAct ? '#655326' : active[action] ? '#226856' : '#254450'; c.fillRect(x, y, w, h);
      c.fillStyle = '#edf7fa'; text(action === 'mode' ? 'Hidráulica: ' + MODES[this.mode] : label, x + 14, y + Math.min(32, h * .56), w - 28, full ? 21 : 27, full ? 1 : 2);
    });
    c.fillStyle = '#a9c5cf'; text('Apunta y pulsa el gatillo · Click del stick derecho: abrir mandos · B derecho: bajar detenido', 28, 625, 970, 20, 1); panel.texture.needsUpdate = true;
  }
  removeWorldPanel() { const panel = this.worldPanel, input = this.ctx.raycontrol; if (this.worldState && input) { const {name,state}=this.worldState; if (input.deactivateState) input.deactivateState(name); if (input.removeState) input.removeState(name); else if (input.states&&input.states[name]===state) delete input.states[name]; } this.worldState=null; if (panel) { if (panel.plane.parent) panel.plane.parent.remove(panel.plane); panel.plane.geometry.dispose(); panel.plane.material.dispose(); panel.texture.dispose(); } this.worldPanel=null; }
  dispose() { this.unmount(true); this.cab.dispose(); this.docking.dispose(); this.listeners.forEach(off=>off()); this.listeners=[]; if (this.hud && this.hud.remove) this.hud.remove(); this.hud=null; if (this.ctx.vehicleDriving===this) delete this.ctx.vehicleDriving; }
}
