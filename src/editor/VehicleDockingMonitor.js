import * as THREE from 'three';
import VehicleForkCamera from './VehicleForkCamera.js';

const WIDTH = 768, HEIGHT = 432;
const COLORS = {ready: '#71e6b3', near: '#f1c66c', blocked: '#ff8f93'};
const finite = value => Number.isFinite(value);
const point = value => Array.isArray(value) && value.length >= 3 && value.every(finite);
const polygon = value => Array.isArray(value) && value.length >= 3 && value.every(point);
const measure = (value, scale, suffix) => finite(value) ? (value * scale).toFixed(1) + suffix : '—';

/** Read-only contour guidance plus an optional, bounded real-camera feed. Both
 * use the runtime's physical pickup/release data and never mutate custody. */
export default class VehicleDockingMonitor {
  constructor(driving) { this.driving = driving; this.ctx = driving.ctx; this.visible = true; this.page = 'alignment'; this.lastUpdate = -Infinity; this.forkCamera = new VehicleForkCamera(driving); }
  get cameraEnabled() { return this.forkCamera.enabled && this.cameraSupported; }
  toggleCamera() { if (!this.cameraSupported) return false; const enabled = this.forkCamera.setEnabled(!this.forkCamera.enabled); this.update(true); return enabled; }
  renderBefore(scene, delta) { return this.forkCamera.renderBefore(scene, delta); }
  postRender() { return this.forkCamera.postRender(); }
  mount() {
    this.unmount(); const dom = this.driving.document;
    if (!dom || !dom.createElement) return;
    this.canvas = dom.createElement('canvas'); this.canvas.width = WIDTH; this.canvas.height = HEIGHT;
    this.canvas.setAttribute('aria-label', 'Plano de alineación de horquillas y pallet');
    this.context = this.canvas.getContext && this.canvas.getContext('2d'); if (!this.context) return;
    this.element = dom.createElement('section'); this.element.className = 'vehicle-docking-monitor'; this.element.dataset.vehicleDockingMonitor = '';
    this.element.setAttribute('aria-label', 'Ayuda de alineación');
    this.summary = dom.createElement('p'); this.summary.className = 'vehicle-docking-summary'; this.summary.setAttribute('aria-live', 'polite');
    this.body = dom.createElement('div'); this.body.className = 'vehicle-docking-body'; this.body.appendChild(this.canvas);
    this.feed = dom.createElement('section'); this.feed.className = 'vehicle-fork-camera'; this.feed.dataset.vehicleForkCamera = '';
    const header = dom.createElement('div'); header.className = 'vehicle-fork-camera-header';
    this.cameraButton = dom.createElement('button'); this.cameraButton.type = 'button'; this.cameraButton.textContent = 'Cámara de horquillas · C'; this.cameraButton.dataset.vehicleForkCameraToggle = '';
    this.sideButton = dom.createElement('button'); this.sideButton.type = 'button'; this.sideButton.textContent = 'Cambiar lado · Shift+N'; this.sideButton.dataset.vehicleForkCameraSide = '';
    this.cameraModeButton = dom.createElement('button'); this.cameraModeButton.type = 'button'; this.cameraModeButton.textContent = 'Vista: Entrada'; this.cameraModeButton.dataset.vehicleForkCameraMode = '';
    this.feedViewport = dom.createElement('div'); this.feedViewport.className = 'vehicle-fork-camera-viewport'; this.feedViewport.dataset.vehicleForkCameraViewport = ''; this.feedViewport.setAttribute('aria-label', 'Cámara real de horquillas y pallet');
    header.appendChild(this.cameraButton); header.appendChild(this.cameraModeButton); header.appendChild(this.sideButton); this.feed.appendChild(header); this.feed.appendChild(this.feedViewport);
    this.cameraClick = () => { if (!this.driving.blocked()) this.toggleCamera(); };
    this.sideClick = () => { if (!this.driving.blocked()) this.forkCamera.switchSide(); };
    this.cameraModeClick = () => { if (!this.driving.blocked()) { this.forkCamera.toggleMode(); this.update(true); } };
    this.cameraButton.addEventListener('click', this.cameraClick); this.sideButton.addEventListener('click', this.sideClick);
    this.cameraModeButton.addEventListener('click', this.cameraModeClick);
    this.body.appendChild(this.feed); this.element.appendChild(this.body); this.element.appendChild(this.summary); if (dom.body) dom.body.appendChild(this.element);
    this.click = event => {
      if (event.stopPropagation) event.stopPropagation();
      if (this.driving.blocked()) return;
      const rect = this.canvas.getBoundingClientRect && this.canvas.getBoundingClientRect();
      if (!rect || !rect.width || !rect.height) return;
      this.select((event.clientX - rect.left) * WIDTH / rect.width, (event.clientY - rect.top) * HEIGHT / rect.height);
    };
    this.canvas.addEventListener('click', this.click);
    this.stopEvent = event => { if (event.stopPropagation) event.stopPropagation(); };
    ['pointerdown', 'mousedown', 'mouseup'].forEach(type => this.element.addEventListener(type, this.stopEvent));
    this.texture = new THREE.CanvasTexture(this.canvas); this.texture.encoding = THREE.sRGBEncoding; this.texture.minFilter = THREE.LinearFilter; this.texture.generateMipmaps = false;
    this.plane = new THREE.Mesh(new THREE.PlaneBufferGeometry(.66, .37125), new THREE.MeshBasicMaterial({map: this.texture}));
    this.plane.name = 'Monitor de alineación de cargas'; this.plane.position.set(-.79, -.13, .68); this.plane.rotation.y = Math.PI;
    this.plane.userData.editorRuntimeHelper = true; this.driving.seat.add(this.plane);
    const rig = this.driving.visualRoot && this.driving.visualRoot.userData.vehicleRig;
    this.cameraSupported = !!(rig && rig.forks && rig.config && !['tow', 'cart'].includes(rig.config.family));
    if (this.cameraSupported) this.forkCamera.mount({element: this.feedViewport, parent: this.driving.seat});
    const input = this.ctx.raycontrol;
    this.stateName = this.driving.simulation.statePrefix + 'vehicle-docking-monitor';
    this.state = {colliderMesh: this.plane, controller: 'both', raycaster: true, consumeSelect: true, mergeSelection: true, captureSelect: true,
      isSelectable: () => !!this.driving.id && !!this.ctx.vrMode && !!this.plane && this.plane.visible && !this.driving.blocked(),
      onSelectStart: hit => { if (this.state.isSelectable() && hit && hit.uv) this.select(hit.uv.x * WIDTH, (1 - hit.uv.y) * HEIGHT); }};
    if (input) { input.addState(this.stateName, this.state); input.activateState(this.stateName); }
    this.lastUpdate = -Infinity; this.update(true);
  }
  select(x, y) {
    if (y >= 15 && y <= 57) {
      if (x >= WIDTH - 320 && x <= WIDTH - 168 && this.cameraSupported) { this.toggleCamera(); return true; }
      if (x >= WIDTH - 488 && x <= WIDTH - 332 && this.cameraSupported) { this.forkCamera.toggleMode(); this.update(true); return true; }
      if (x >= WIDTH - 156 && x <= WIDTH - 16) { this.page = this.page === 'alignment' ? 'guide' : 'alignment'; this.update(true); return true; }
    } return false;
  }
  toggle() { this.visible = !this.visible; this.update(true); return this.visible; }
  update(force = false) {
    if (!this.element) return;
    const driving = this.driving, record = driving.record(), available = !!record && this.visible && !(this.ctx.editor && this.ctx.editor.active);
    this.element.hidden = !available || !!this.ctx.vrMode;
    if (this.plane) this.plane.visible = available && !!this.ctx.vrMode;
    this.forkCamera.setAvailable(available && !this.driving.blocked());
    this.feed.hidden = !this.cameraSupported || !this.cameraEnabled; this.cameraButton.setAttribute('aria-pressed', String(!!this.cameraEnabled));
    this.cameraModeButton.textContent = 'Vista: ' + (this.forkCamera.mode === 'entry' ? 'Entrada' : 'Puntas') + ' · Shift+C';
    this.element.dataset.camera = this.cameraEnabled ? 'on' : 'off';
    if (!available) return;
    const now = typeof performance === 'undefined' ? Date.now() : performance.now();
    if (!force && now - this.lastUpdate < 100) return; this.lastUpdate = now;
    const runtime = driving.simulation.vehicleRuntime;
    this.snapshot = (runtime && runtime.getDockingState && runtime.getDockingState(record)) || {ready: false, reason: 'Esperando datos de alineación', severity: 'blocked'};
    const data = this.snapshot, blocked = driving.blocked();
    this.severity = data.ready && !blocked ? 'ready' : data.severity === 'near' && !blocked ? 'near' : 'blocked';
    const reason = blocked ? 'Controles bloqueados: cierra el menú o reanuda la simulación.' : data.reason || 'Ajusta la posición y la altura de las horquillas.';
    const phase = data.phase === 'drop' ? 'DEPÓSITO' : 'TOMA DE PALLET';
    this.summary.textContent = (this.severity === 'ready' ? 'LISTO · ' : this.severity === 'near' ? 'AJUSTAR · ' : 'NO DISPONIBLE · ') + reason;
    this.element.dataset.state = this.severity; this.canvas.setAttribute('aria-label', phase + '. ' + this.summary.textContent);
    this.paint(data, phase, reason); this.texture.needsUpdate = true;
  }
  paint(data, phase, reason) {
    const c = this.context, accent = COLORS[this.severity];
    c.fillStyle = '#0b1d28'; c.fillRect(0, 0, WIDTH, HEIGHT); c.fillStyle = accent; c.font = 'bold 26px sans-serif'; c.fillText((data.phase === 'drop' ? 'DEPÓSITO' : 'TOMA') + ' · ' + (this.severity === 'ready' ? 'LISTO' : this.severity === 'near' ? 'AJUSTAR' : 'REVISAR'), 20, 40);
    if (this.cameraSupported) { c.fillStyle = this.cameraEnabled ? '#226856' : '#294551'; c.fillRect(WIDTH - 320, 15, 152, 42); c.fillStyle = '#eff8fa'; c.font = '20px sans-serif'; c.fillText(this.cameraEnabled ? 'CÁMARA ON' : 'CÁMARA OFF', WIDTH - 309, 43); }
    if (this.cameraSupported) { c.fillStyle = '#294551'; c.fillRect(WIDTH - 488, 15, 156, 42); c.fillStyle = '#eff8fa'; c.font = '20px sans-serif'; c.fillText(this.forkCamera.mode === 'entry' ? 'ENTRADA' : 'PUNTAS', WIDTH - 474, 43); }
    c.fillStyle = '#294551'; c.fillRect(WIDTH - 156, 15, 140, 42); c.fillStyle = '#eff8fa'; c.font = '20px sans-serif'; c.fillText(this.page === 'alignment' ? 'GUÍA' : 'PLANO', WIDTH - 133, 43);
    // Minimal DOM fixtures do not implement paths; production canvas always
    // does. Measurements and accessible state remain available independently.
    if (!c.beginPath) return;
    if (this.page === 'guide') { this.paintGuide(c); return; }
    const box = {x: 18, y: 72, w: 423, h: 287}; c.fillStyle = '#132b37'; c.fillRect(box.x, box.y, box.w, box.h);
    this.paintContours(c, data.geometry || {}, box);
    const x = 462, errors = data.errors || {}, insertion = data.insertion || {}, stability = data.stability || {};
    c.fillStyle = '#e4f4f9'; c.font = 'bold 21px sans-serif'; this.text(c, data.targetName || (data.phase === 'drop' ? 'Sin receptor próximo' : 'Sin pallet próximo'), x, 95, 280);
    const lines = [
      ['Desvío lateral', measure(errors.lateralM, 100, ' cm')], ['Altura', measure(errors.verticalM, 100, ' cm')],
      ['Ángulo', measure(errors.yawRad, 180 / Math.PI, '°')], ['Inserción', measure(insertion.actualM, 100, ' cm') + ' / ' + measure(insertion.requiredM, 100, ' cm')],
      ['Carga / capacidad', measure(stability.loadKg, 1, ' kg') + ' / ' + measure(stability.capacityKg, 1, ' kg')]
    ];
    lines.forEach(([label, value], index) => { const y = 128 + index * 39; c.font = '17px sans-serif'; c.fillStyle = '#a9c5cf'; c.fillText(label, x, y); c.font = 'bold 21px sans-serif'; c.fillStyle = '#edf8fa'; c.fillText(value, x, y + 23); });
    c.fillStyle = '#aac6ce'; c.font = '15px sans-serif'; c.fillText('VISTA SUPERIOR · metros · frente ↑', 29, 348);
    c.fillStyle = accent; c.font = 'bold 20px sans-serif'; this.text(c, reason, 20, 389, WIDTH - 40, 24, 2);
  }
  paintContours(c, geometry, area) {
    const frame = geometry.frame || {}, origin = point(frame.position) ? frame.position : [0, 0, 0], yaw = finite(frame.yaw) ? frame.yaw : 0;
    // +Z is vehicle forward and the seated operator's right is -X.
    const local = p => { const dx = p[0] - origin[0], dz = p[2] - origin[2]; return [-dx * Math.cos(yaw) + dz * Math.sin(yaw), -dx * Math.sin(yaw) - dz * Math.cos(yaw)]; };
    const groups = [
      {polys: [geometry.chassis].filter(polygon), fill: '#365462', stroke: '#9ab5c0', width: 2},
      {polys: [geometry.target].filter(polygon), fill: '#765f36', stroke: COLORS[this.severity], width: 3},
      {polys: (geometry.pockets || []).filter(polygon), fill: '#091b24', stroke: '#ffd78c', width: 2},
      {polys: (geometry.forks || []).filter(polygon), fill: '#c0d0da', stroke: '#f0f7fa', width: 2}
    ];
    const points = groups.flatMap(group => group.polys.flatMap(poly => poly.map(local)));
    if (!points.length) { c.fillStyle = '#a8c4ce'; c.font = '18px sans-serif'; c.fillText('Sin geometría de acoplamiento', area.x + 34, area.y + area.h / 2); return; }
    let minX = -1, maxX = 1, minY = -.5, maxY = .5;
    points.forEach(p => { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); });
    const scale = Math.min((area.w - 50) / (maxX - minX), (area.h - 50) / (maxY - minY));
    const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
    const screen = p => { const q = local(p); return [area.x + area.w / 2 + (q[0] - centerX) * scale, area.y + (area.h - 20) / 2 + (q[1] - centerY) * scale]; };
    this.projection = {origin: origin.slice(), yaw, scale, screen};
    c.strokeStyle = '#284954'; c.lineWidth = 1;
    for (let xx = Math.ceil(minX * 2) / 2; xx <= maxX; xx += .5) { const x = area.x + area.w / 2 + (xx - centerX) * scale; c.beginPath(); c.moveTo(x, area.y + 10); c.lineTo(x, area.y + area.h - 25); c.stroke(); }
    groups.forEach(group => group.polys.forEach(poly => { c.beginPath(); poly.map(screen).forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath(); c.fillStyle = group.fill; c.strokeStyle = group.stroke; c.lineWidth = group.width; c.fill(); c.stroke(); }));
    const base = screen(origin); c.strokeStyle = '#80ddcf'; c.lineWidth = 2; c.beginPath(); c.moveTo(base[0], base[1]); c.lineTo(base[0], base[1] - 26); c.lineTo(base[0] - 5, base[1] - 19); c.moveTo(base[0], base[1] - 26); c.lineTo(base[0] + 5, base[1] - 19); c.stroke();
    const ruler = .5 * scale; c.strokeStyle = '#bdd2d9'; c.beginPath(); c.moveTo(area.x + 12, area.y + area.h - 38); c.lineTo(area.x + 12 + ruler, area.y + area.h - 38); c.stroke(); c.fillStyle = '#bdd2d9'; c.font = '14px sans-serif'; c.fillText('0.5 m', area.x + 12, area.y + area.h - 43);
  }
  paintGuide(c) {
    const rows = this.ctx.vrMode ? ['1 · Agarra el volante para alinear ambas horquillas.', '2 · Usa las palancas de altura e inclinación con agarre.', '3 · Detente: verde confirma la validación real.', '4 · Pulsa Tomar / Depositar en el tablero de la cabina.', 'CÁMARA muestra las uñas; ENTRADA / PUNTAS cambia la vista.', 'Pulsa la imagen para cambiar lado; el visor no se mueve.'] : ['1 · A / D: alinea ambas horquillas con los huecos.', '2 · Q / E: altura · R / T: inclinación · W / S: aproximar.', '3 · Espacio: frena; verde confirma el apoyo real.', '4 · G: tomar · Shift+K: preparar depósito · K: depositar.', 'C: cámara · Shift+C: entrada / puntas · Shift+N: lado.', 'Sigue la siguiente acción resaltada en los mandos.'];
    c.font = '22px sans-serif'; c.fillStyle = '#d8edf4'; rows.forEach((row, index) => this.text(c, row, 25, 100 + index * 47, WIDTH - 50));
    c.fillStyle = '#f1c66c'; c.font = '18px sans-serif'; c.fillText('Amarillo: ajustar · Rojo: revisar impedimento · Verde: operación disponible', 25, 407);
  }
  text(c, value, x, y, width, lineHeight = 24, maxLines = 1) {
    const words = String(value).split(/\s+/); let line = '', index = 0;
    words.forEach(word => { const candidate = line ? line + ' ' + word : word;
      if (line && c.measureText(candidate).width > width && index < maxLines - 1) { c.fillText(line, x, y + index++ * lineHeight); line = word; } else line = candidate; });
    while (line && c.measureText(line).width > width) line = line.slice(0, -2); c.fillText(line, x, y + index * lineHeight);
  }
  unmount() {
    this.forkCamera.unmount();
    const input = this.ctx.raycontrol;
    if (input && this.stateName) { if (input.deactivateState) input.deactivateState(this.stateName); if (input.removeState) input.removeState(this.stateName); else if (input.states && input.states[this.stateName] === this.state) delete input.states[this.stateName]; }
    if (this.plane) { if (this.plane.parent) this.plane.parent.remove(this.plane); this.plane.geometry.dispose(); this.plane.material.dispose(); }
    if (this.texture) this.texture.dispose(); if (this.canvas && this.click) this.canvas.removeEventListener('click', this.click);
    if (this.cameraButton) this.cameraButton.removeEventListener('click', this.cameraClick); if (this.sideButton) this.sideButton.removeEventListener('click', this.sideClick);
    if (this.cameraModeButton) this.cameraModeButton.removeEventListener('click', this.cameraModeClick);
    if (this.element) { ['pointerdown', 'mousedown', 'mouseup'].forEach(type => this.element.removeEventListener(type, this.stopEvent)); this.element.remove(); }
    this.body = this.feed = this.feedViewport = this.cameraButton = this.sideButton = this.cameraModeButton = null; this.cameraSupported = false;
    this.plane = this.texture = this.element = this.canvas = this.context = this.state = this.stateName = this.snapshot = null;
  }
  dispose() { this.unmount(); this.forkCamera.dispose(); }
}
