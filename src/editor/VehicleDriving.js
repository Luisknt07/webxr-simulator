import * as THREE from 'three';
import VehicleCabInteraction from './VehicleCabInteraction.js';

const UP = new THREE.Vector3(0, 1, 0);
const ZERO = () => ({throttle: 0, steer: 0, brake: 1, lift: 0, tilt: 0, reach: 0, sideShift: 0, turret: 0});
const DRIVE_KEYS = new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyQ', 'KeyE', 'KeyR', 'KeyT', 'KeyZ', 'KeyX', 'KeyJ', 'KeyL', 'KeyU', 'KeyO', 'KeyF', 'KeyG', 'KeyK', 'KeyH', 'KeyP', 'KeyV', 'KeyB', 'KeyN', 'KeyC', 'Tab']);
const MODES = ['Mástil', 'Alcance / lateral', 'Torreta'];
const WORLD_TOP = 210, WORLD_BOTTOM = 610, WORLD_ROW_HEIGHT = 400 / 7;
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
    this.mode = 0; this.chase = false; this.listeners = []; this.position = new THREE.Vector3(); this.rotation = new THREE.Quaternion();
    if (this.window) {
      this.listen(this.window, 'keydown', event => this.key(event, true), true); this.listen(this.window, 'keyup', event => this.key(event, false), true);
      this.listen(this.window, 'blur', () => this.resetInput());
    }
    if (this.document) {
      this.listen(this.document, 'visibilitychange', () => this.resetInput());
      this.listen(this.document, 'pointerlockchange', () => { if (this.id && !this.ctx.vrMode) { this.resetInput(); this.updateHUD(); } });
    }
    this.cab = new VehicleCabInteraction(this);
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
    record.components.vehicle.driving = true;
    const vehicleRotation = record.object.getWorldQuaternion(new THREE.Quaternion());
    this.mountHead = new THREE.Vector3(); this.yawOffset = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI);
    if (this.ctx.vrMode) {
      const tracked = this.ctx.renderer.xr.getCamera(camera), head = new THREE.Vector3().setFromMatrixPosition(tracked.matrixWorld);
      this.mountHead.copy(head).applyMatrix4(new THREE.Matrix4().getInverse(cameraRig.matrixWorld));
      const forward = new THREE.Vector3(0, 0, -1).transformDirection(tracked.matrixWorld), target = new THREE.Vector3(0, 0, 1).applyQuaternion(vehicleRotation);
      const deltaYaw = Math.atan2(target.x, target.z) - Math.atan2(forward.x, forward.z), initial = cameraRig.getWorldQuaternion(new THREE.Quaternion()).premultiply(new THREE.Quaternion().setFromAxisAngle(UP, deltaYaw));
      this.yawOffset.copy(vehicleRotation).inverse().multiply(initial);
    } else { camera.position.set(0, 0, 0); camera.quaternion.set(0, 0, 0, 1); }
    this.resetInput(); this.releaseCursor(); this.cab.mount(visual); this.buildHUD(); this.buildWorldPanel(record); this.follow(); this.updateHUD();
    this.notify(this.ctx.vrMode ? 'RV: acerca un mando al volante o palanca y mantén el agarre. Sticks como alternativa · B para bajar.' : 'Cabina: Encender → Marcha → desactivar Freno P. Tab alterna cursor y mirada; Esc libera el cursor.'); return true;
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
    if (state.emergency) return 'Emergencia activa: pulsa Rearmar y después Marcha.';
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
      if (['stop', 'powerOff', 'emergency', 'parkingBrake'].includes(action)) this.resetInput();
      const result = this.simulation.command(record.id, action); this.updateHUD();
      if (['powerOn', 'start', 'stop', 'powerOff', 'emergency', 'resetEmergency', 'parkingBrake'].includes(action)) this.notify(this.guidance(this.state(record)));
      else if (result === false && record.components.vehicle.warning) this.notify(record.components.vehicle.warning);
      return result; }
    catch (error) { this.notify(error.message); return false; }
  }
  key(event, down) {
    const target = event.target || {}, typing = target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName || '');
    if (!down) { this.blockedKeys.delete(event.code); this.keys.delete(event.code); }
    if (!this.id) { if (down && event.code === 'KeyF' && !event.repeat && !typing && !(this.ctx.editor && this.ctx.editor.active)) { const record = this.nearest(); if (record) { event.preventDefault(); this.mount(record.id); } } return; }
    if (!DRIVE_KEYS.has(event.code) || typing) return;
    event.preventDefault(); if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    if (!down) { this.keys.delete(event.code); return; }
    if (this.blocked()) { this.resetInput(); return; }
    if (this.blockedKeys.has(event.code)) return;
    this.keys.add(event.code); if (event.repeat) return;
    if (event.code === 'Tab') { this.toggleCursor(); return; }
    const commands = {KeyF: 'exit', KeyG: 'pickup', KeyK: 'release', KeyH: 'horn', KeyP: 'parkingBrake', KeyV: 'start', KeyB: 'powerOn', KeyN: 'lights'};
    if (event.code === 'KeyC' && !this.ctx.vrMode) { this.chase = !this.chase; return; }
    if (commands[event.code]) this.command(commands[event.code]);
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
        if (source.handedness === 'left') { input.throttle = progressive(-y, 1.35); input.steer = progressive(x, 1.5); if (grip && !physical) input.brake = 1; if (click && !state.click) this.command('horn'); }
        else {
          if (this.mode === 0) { input.lift = -y; input.tilt = x; } else if (this.mode === 1) { input.reach = -y; input.sideShift = x; } else { input.lift = -y; input.turret = x; }
          if (click && !state.click) this.command('mode');
          if (grip && !state.grip && !physical) this.command(this.record().components.vehicle.entry ? 'release' : 'pickup');
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
    this.cab.clear(); this.removeWorldPanel(); this.id = null; this.seat = null; this.saved = null; ctx.drivingVehicle = null; if (ctx.resetCollisionPose) ctx.resetCollisionPose(); this.updateHUD(); return true;
  }
  buildHUD() {
    const dom = this.document; if (this.hud || !dom || !dom.body || !dom.createElement) return;
    const hud = dom.createElement('section'); hud.className = 'vehicle-driving-hud'; hud.setAttribute('aria-label', 'Conducción y manipulación de cargas'); this.hud = hud;
    this.status = dom.createElement('strong'); hud.appendChild(this.status);
    this.hint = dom.createElement('p'); hud.appendChild(this.hint);
    const actions = dom.createElement('div'); actions.className = 'vehicle-driving-actions'; hud.appendChild(actions);
    this.actionButtons = new Map();
    [['powerOn', 'Encender'], ['start', 'Marcha'], ['powerOff', 'Apagar'], ['parkingBrake', 'Freno P'], ['pickup', 'Tomar carga'], ['release', 'Depositar'], ['couple', 'Enganchar'], ['uncouple', 'Desenganchar'], ['horn', 'Bocina'], ['lights', 'Luces'], ['emergency', 'Emergencia'], ['resetEmergency', 'Rearmar'], ['mode', 'Modo hidráulico'], ['exit', 'Bajar · F']].forEach(([action, label]) => { const button = dom.createElement('button'); button.type = 'button'; button.textContent = label; button.dataset.vehicleCommand = action; this.listen(button, 'click', () => this.command(action)); this.actionButtons.set(action, button); actions.appendChild(button); });
    const pads = dom.createElement('div'); pads.className = 'vehicle-driving-pads'; hud.appendChild(pads);
    [['KeyW', 'Avanzar'], ['KeyS', 'Retroceder'], ['KeyA', 'Izquierda'], ['KeyD', 'Derecha'], ['Space', 'Frenar'], ['KeyQ', 'Elevar'], ['KeyE', 'Bajar carga'], ['KeyR', 'Inclinar −'], ['KeyT', 'Inclinar +'], ['KeyZ', 'Retraer'], ['KeyX', 'Extender'], ['KeyJ', 'Lateral −'], ['KeyL', 'Lateral +'], ['KeyU', 'Torreta −'], ['KeyO', 'Torreta +']].forEach(([code, label]) => { const button = dom.createElement('button'); button.type = 'button'; button.textContent = label; button.dataset.vehicleHold = code; this.listen(button, 'pointerdown', event => { if (!this.id || this.blocked()) return; event.preventDefault(); this.touches.set(event.pointerId, code); if (button.setPointerCapture) button.setPointerCapture(event.pointerId); }); ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => this.listen(button, type, event => this.touches.delete(event.pointerId))); pads.appendChild(button); });
    // HUD gestures belong to the cockpit, rather than the canvas world ray.
    ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach(type => this.listen(hud, type, event => { if (event.stopPropagation) event.stopPropagation(); }));
    dom.body.appendChild(hud);
  }
  updateHUD() {
    if (this.worldPanel) this.worldPanel.plane.visible = !!this.ctx.vrMode && !!this.id;
    if (!this.hud) { if (this.id) this.buildHUD(); else return; }
    const record = this.record(); this.hud.hidden = !record || this.ctx.vrMode || this.ctx.editor && this.ctx.editor.active;
    if (!record) return; const v = this.state(record), state = record.components.vehicle;
    const phase = v.emergency ? 'EMERGENCIA' : !v.powered ? 'APAGADO' : v.paused ? 'PAUSADO' : v.running ? 'EN MARCHA' : 'LISTO / PARADO';
    this.status.textContent = record.object.name + ' · Energía: ' + (v.powered ? 'ENCENDIDA' : 'APAGADA') + ' · ' + phase + ' · Freno P: ' + (v.parkingBrake ? 'ACTIVO' : 'LIBRE') + ' · ' + Number(v.actualSpeed || 0).toFixed(2) + ' m/s · Elevación ' + Number(v.lift || v.liftHeight || state.lift || 0).toFixed(2) + ' m · Carga ' + Number(v.loadKg || 0).toFixed(0) + ' kg';
    this.hint.textContent = this.guidance(v) + ' · Tab: cursor / mirar · Esc: liberar cursor · WASD conducir · Q/E elevar · R/T inclinar · Z/X alcance · J/L lateral · U/O torreta · Espacio frenar · G/K carga · F bajar';
    const toggles = {powerOn: v.powered, powerOff: !v.powered, start: v.running && !v.paused && !v.emergency, parkingBrake: v.parkingBrake, lights: v.lights, emergency: v.emergency};
    this.actionButtons.forEach((button, action) => { if (action in toggles) button.setAttribute('aria-pressed', String(!!toggles[action])); });
    if (this.worldPanel) this.paintWorldPanel();
  }
  buildWorldPanel(record) {
    if (!this.document || !this.document.createElement) return; const canvas = this.document.createElement('canvas'); canvas.width = 1024; canvas.height = 640; const context = canvas.getContext && canvas.getContext('2d'); if (!context) return;
    const texture = new THREE.CanvasTexture(canvas); texture.encoding = THREE.sRGBEncoding;
    const plane = new THREE.Mesh(new THREE.PlaneBufferGeometry(.82, .512), new THREE.MeshBasicMaterial({map: texture})); plane.name = 'Consola de conducción'; plane.position.set(0, -.36, .70); plane.rotation.y = Math.PI; plane.userData.editorRuntimeHelper = true;
    plane.visible = !!this.ctx.vrMode; this.seat.add(plane); const actions = [['powerOn','ENCENDER'],['start','MARCHA'],['powerOff','APAGAR'],['parkingBrake','FRENO P'],['pickup','TOMAR'],['release','DEPOSITAR'],['couple','ENGANCHAR'],['uncouple','DESENGANCHAR'],['lights','LUCES'],['horn','BOCINA'],['emergency','EMERGENCIA'],['resetEmergency','REARMAR'],['mode','HIDRÁULICA'],['exit','BAJAR']];
    this.worldPanel = {plane, context, texture, actions, signature: ''};
    const name = this.simulation.statePrefix + 'vehicle-driving-panel', state = {colliderMesh: plane, controller: 'both', raycaster: true, consumeSelect: true, mergeSelection: true, captureSelect: true,
      isSelectable: () => !!this.id && !!this.ctx.vrMode && plane.visible && !this.blocked(), onSelectStart: hit => { if (!this.ctx.vrMode || !plane.visible || !hit || !hit.uv || this.blocked()) return; const x = hit.uv.x * 1024, y = (1-hit.uv.y) * 640; if (y < WORLD_TOP || y >= WORLD_BOTTOM || x < 0 || x > 1024) return; const index = Math.floor((y-WORLD_TOP)/WORLD_ROW_HEIGHT) * 2 + (x >= 512 ? 1 : 0); if (actions[index]) this.command(actions[index][0]); }};
    const input = this.ctx.raycontrol; if (input) { input.addState(name, state); input.activateState(name); this.worldState = {name, state}; }
    this.paintWorldPanel();
  }
  paintWorldPanel() {
    const panel = this.worldPanel, record = this.record(); if (!panel || !record) return;
    const v = this.state(record), signature = [v.actualSpeed, v.lift, v.loadKg, v.parkingBrake, v.powered, v.running, v.paused, v.emergency, v.warning, v.batteryPercent, this.mode].map(value => typeof value === 'number' ? value.toFixed(1) : value).join('|');
    if (panel.signature === signature) return; panel.signature = signature; const c = panel.context;
    c.fillStyle='#0b1d28'; c.fillRect(0,0,1024,640); c.fillStyle='#8ce4d3'; c.font='bold 34px sans-serif'; c.fillText('PUESTO DE CONDUCCIÓN',32,54);
    c.fillStyle='#eff6fb'; c.font='28px sans-serif'; c.fillText(Number(v.actualSpeed||0).toFixed(2)+' m/s · Carga '+Number(v.loadKg||0).toFixed(0)+' kg',32,104); c.font='24px sans-serif'; c.fillText('Energía '+(v.powered?'ENCENDIDA':'APAGADA')+' · '+(v.emergency?'EMERGENCIA':v.paused?'PAUSADO':v.running?'MARCHA':'PARADO')+' · Freno P '+(v.parkingBrake?'ACTIVO':'LIBRE'),32,148); c.font='21px sans-serif'; c.fillText(this.guidance(v),32,187);
    const active={powerOn:v.powered,powerOff:!v.powered,start:v.running&&!v.paused&&!v.emergency,parkingBrake:v.parkingBrake,lights:v.lights,emergency:v.emergency};
    panel.actions.forEach(([action,label],index)=>{const x=index%2*512,y=WORLD_TOP+Math.floor(index/2)*WORLD_ROW_HEIGHT; c.fillStyle=action==='emergency'?'#763b41':active[action]?'#226856':'#254450';c.fillRect(x+14,y+4,484,WORLD_ROW_HEIGHT-8);c.fillStyle='#edf7fa';c.font='bold 24px sans-serif';c.fillText(action==='mode'?label+' · '+MODES[this.mode]:label,x+30,y+WORLD_ROW_HEIGHT*.65);}); panel.texture.needsUpdate=true;
  }
  removeWorldPanel() { const panel = this.worldPanel, input = this.ctx.raycontrol; if (this.worldState && input) { const {name,state}=this.worldState; if (input.deactivateState) input.deactivateState(name); if (input.removeState) input.removeState(name); else if (input.states&&input.states[name]===state) delete input.states[name]; } this.worldState=null; if (panel) { if (panel.plane.parent) panel.plane.parent.remove(panel.plane); panel.plane.geometry.dispose(); panel.plane.material.dispose(); panel.texture.dispose(); } this.worldPanel=null; }
  dispose() { this.unmount(true); this.cab.dispose(); this.listeners.forEach(off=>off()); this.listeners=[]; if (this.hud && this.hud.remove) this.hud.remove(); this.hud=null; if (this.ctx.vehicleDriving===this) delete this.ctx.vehicleDriving; }
}
