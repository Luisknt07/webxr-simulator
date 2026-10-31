import * as THREE from 'three';

const WIDTH = 896, HEIGHT = 1024, LAUNCHER_WIDTH = 512, LAUNCHER_HEIGHT = 160;
const COLORS = {background: '#11252f', card: '#203d48', hover: '#315966', text: '#edf8f6', dim: '#aec7ca', accent: '#96e5c5', ink: '#123137', error: '#ffc3bb'};
let serial = 0;
const short = (value, length = 90) => { const text = String(value || ''); return text.length > length ? text.slice(0, length - 1) + '…' : text; };
const number = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

/** Optional voice controls shared by the public viewer and the workspace.
 * The XR surface owns only its panel mesh: it never attaches to or moves a
 * camera, cockpit or vehicle. Native audio/microphone permissions stay in the
 * assistant and are requested only by explicit button actions. */
export class VoiceAssistantPanel {
  constructor({assistant, context = {}, document: dom, anchor} = {}) {
    if (!assistant) throw new Error('VoiceAssistantPanel necesita un asistente.');
    this.assistant = assistant; this.ctx = context; this.document = dom || context.document || (typeof document !== 'undefined' ? document : null); this.anchor = anchor;
    this.stateName = 'voice-assistant-panel-' + (++serial); this.opened = false; this.disposed = false; this.listeners = []; this.controls = {};
    this.model = {}; this.regions = []; this.presses = new Map(); this.hovers = new Map(); this.sampleId = ''; this.dirty = true;
    this.position = new THREE.Vector3(); this.quaternion = new THREE.Quaternion(); this.forward = new THREE.Vector3(); this.right = new THREE.Vector3(); this.rotation = new THREE.Matrix4();
    this.lastXR = this.isXR();
  }

  isXR() { return !!(this.ctx.vrMode || this.ctx.renderer && this.ctx.renderer.xr && this.ctx.renderer.xr.isPresenting); }
  listen(target, type, handler, options) {
    if (!target || !target.addEventListener) return;
    target.addEventListener(type, handler, options); this.listeners.push(() => target.removeEventListener(type, handler, options));
  }
  create(tag, className, text, parent) {
    const node = this.document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; if (parent) parent.appendChild(node); return node;
  }
  buttonControl(key, text, parent, action, className = '') {
    const button = this.create('button', 'voice-assistant-button ' + className, text, parent); button.type = 'button'; button.dataset.voiceAction = key;
    this.listen(button, 'click', () => this.invoke(action)); this.controls[key] = button; return button;
  }
  invoke(action) {
    if (this.disposed) return;
    try { const result = action(); if (result && result.catch) result.catch(() => this.refresh()); }
    catch (_) { this.refresh(); }
  }
  refresh() { if (this.assistant.state) this.update(this.assistant.state()); }

  mount(container) {
    if (this.disposed || this.element || !this.document || !this.document.createElement) return this;
    const dom = this.document, body = dom.body || container || this.anchor;
    if (!body) return this;
    this.launcher = this.create('button', 'voice-assistant-launcher', '', this.anchor || container || body); this.launcher.type = 'button';
    if (!this.anchor && !container) this.launcher.className += ' voice-assistant-launcher-floating';
    this.launcher.dataset.voiceAssistantToggle = ''; this.launcher.setAttribute('aria-expanded', 'false'); this.launcher.setAttribute('aria-controls', this.stateName);
    const icon = this.create('span', 'voice-assistant-wave', '', this.launcher); icon.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < 4; index++) this.create('i', '', '', icon);
    this.create('span', '', 'Voz', this.launcher); this.launcher.title = 'Abrir asistente de voz';
    this.listen(this.launcher, 'click', event => { event.stopPropagation(); this.toggle(); });
    ['pointerdown', 'pointerup', 'mousedown', 'mouseup'].forEach(type => this.listen(this.launcher, type, event => event.stopPropagation()));

    this.element = this.create('section', 'voice-assistant-panel', '', body); this.element.id = this.stateName; this.element.hidden = true;
    this.element.dataset.voiceAssistantPanel = ''; this.element.setAttribute('role', 'dialog'); this.element.setAttribute('aria-labelledby', this.stateName + '-title');
    const header = this.create('div', 'voice-assistant-header', '', this.element), title = this.create('div', '', '', header);
    this.create('span', 'voice-assistant-eyebrow', 'GUÍA DEL SIMULADOR', title);
    const heading = this.create('h2', '', 'Asistente de voz', title); heading.id = this.stateName + '-title';
    this.closeButton = this.buttonControl('close', '×', header, () => this.close(), 'voice-assistant-close'); this.closeButton.setAttribute('aria-label', 'Cerrar asistente de voz');

    this.status = this.create('p', 'voice-assistant-status', '', this.element); this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    this.caption = this.create('p', 'voice-assistant-caption', '', this.element); this.caption.setAttribute('aria-live', 'polite'); this.caption.setAttribute('aria-atomic', 'true');
    const toggles = this.create('div', 'voice-assistant-toggles', '', this.element);
    this.buttonControl('enabled', 'Activar voz', toggles, () => this.assistant.setEnabled(!this.model.enabled), 'voice-assistant-primary');
    const auto = this.create('label', 'voice-assistant-auto', '', toggles), checkbox = this.create('input', '', '', auto); checkbox.type = 'checkbox';
    checkbox.setAttribute('aria-label', 'Narrar instrucciones automáticamente'); this.controls.automatic = checkbox; this.create('span', '', 'Guía automática', auto);
    this.listen(checkbox, 'change', () => this.assistant.setAutomatic(checkbox.checked));

    const queries = this.create('div', 'voice-assistant-queries', '', this.element); queries.setAttribute('aria-label', 'Consultar ayuda del simulador');
    [['next', 'Siguiente paso'], ['objective', 'Mi objetivo'], ['controls', 'Controles'], ['content', 'Qué estoy viendo']].forEach(([intent, label]) => this.buttonControl(intent, label, queries, () => this.assistant.ask(intent)));

    const settings = this.create('div', 'voice-assistant-settings', '', this.element), voiceLabel = this.create('label', 'voice-assistant-field', '', settings);
    this.create('span', '', 'Voz del dispositivo', voiceLabel); this.controls.voice = this.create('select', '', '', voiceLabel); this.controls.voice.setAttribute('aria-label', 'Voz del dispositivo');
    this.listen(this.controls.voice, 'change', () => this.assistant.setVoice(this.controls.voice.value));
    const ranges = this.create('div', 'voice-assistant-ranges', '', settings);
    this.range('volume', 'Volumen de voz', 0, 1, .05, ranges, value => this.assistant.setVolume(value));
    this.range('rate', 'Velocidad', .6, 1.5, .05, ranges, value => this.assistant.setRate(value));

    const sampleLabel = this.create('label', 'voice-assistant-field', '', this.element); this.create('span', '', 'Probar grabación', sampleLabel);
    const sampleRow = this.create('div', 'voice-assistant-sample', '', sampleLabel); this.controls.sample = this.create('select', '', '', sampleRow); this.controls.sample.setAttribute('aria-label', 'Grabación de prueba');
    this.listen(this.controls.sample, 'change', () => { this.sampleId = this.controls.sample.value; this.dirty = true; });
    this.buttonControl('samplePlay', 'Escuchar', sampleRow, () => this.assistant.playSample(this.sampleId));
    const actions = this.create('div', 'voice-assistant-actions', '', this.element);
    this.buttonControl('repeat', 'Repetir', actions, () => this.assistant.repeat()); this.buttonControl('stop', 'Detener', actions, () => this.assistant.stop());
    this.buttonControl('mic', 'Micrófono', actions, () => this.model.listening ? this.assistant.stop() : this.assistant.listen());
    this.hint = this.create('p', 'voice-assistant-hint', 'Consulta por voz o usa los botones de ayuda.', this.element);

    // Events are contained at the controls. The surrounding world retains its
    // pointer and keyboard handlers whenever this small panel is closed.
    ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'touchstart', 'touchend', 'wheel', 'keyup'].forEach(type => this.listen(this.element, type, event => event.stopPropagation()));
    this.listen(this.element, 'keydown', event => { event.stopPropagation(); if (event.key === 'Escape' || event.code === 'Escape') { event.preventDefault(); this.close(); } });
    this.listen(dom, 'keydown', event => { if (this.opened && (event.key === 'Escape' || event.code === 'Escape')) { event.stopPropagation(); event.preventDefault(); this.close(); } });
    this.listen(dom, 'visibilitychange', () => { if (dom.hidden && this.opened) this.close(); });
    this.listen(dom.defaultView, 'resize', () => this.placeDesktop());
    this.listen(this.ctx.raycontrol, 'controllerDisconnected', data => { const controller = data && data.controller; this.presses.delete(controller); this.hovers.delete(controller); this.dirty = true; });
    this.unsubscribe = this.assistant.subscribe ? this.assistant.subscribe(model => this.update(model)) : null;
    this.refresh(); this.updateVisibility(); return this;
  }

  range(key, label, min, max, step, parent, action) {
    const field = this.create('label', 'voice-assistant-range', '', parent), line = this.create('span', 'voice-assistant-range-label', '', field);
    this.create('span', '', label, line); this.controls[key + 'Value'] = this.create('output', '', '', line);
    const input = this.create('input', '', '', field); Object.assign(input, {type: 'range', min: String(min), max: String(max), step: String(step)}); input.setAttribute('aria-label', label); this.controls[key] = input;
    this.listen(input, 'input', () => action(number(input.value, min)));
  }
  options(select, values, selected, signatureKey) {
    const signature = JSON.stringify(values.map(item => [item.id, item.label]));
    if (this[signatureKey] !== signature) {
      while (select.firstChild) select.removeChild(select.firstChild);
      values.forEach(item => { const option = this.create('option', '', item.label, select); option.value = item.id; }); this[signatureKey] = signature;
    }
    select.value = values.some(item => item.id === selected) ? selected : values[0] && values[0].id || '';
  }
  update(model = {}) {
    if (this.disposed) return;
    this.model = model; this.dirty = true;
    if (!this.element) return;
    const speech = model.speechSupported !== undefined ? model.speechSupported : model.capabilities && model.capabilities.speech;
    const recognition = model.recognitionSupported !== undefined ? model.recognitionSupported : model.capabilities && model.capabilities.recognition;
    this.status.textContent = model.error || model.status || 'Listo para ayudarte.';
    this.element.dataset.voiceState = model.error ? 'error' : model.listening ? 'listening' : model.speaking ? 'speaking' : model.enabled ? 'ready' : 'off';
    this.caption.textContent = model.transcript || 'Escucha una indicación o consulta el siguiente paso.';
    this.controls.enabled.textContent = model.enabled ? 'Voz activada' : 'Activar voz'; this.controls.enabled.setAttribute('aria-pressed', String(!!model.enabled));
    this.controls.automatic.checked = !!model.automatic;
    const voices = [{id: 'auto', label: 'Automática · español'}].concat((model.voices || []).filter(voice => voice.id !== 'auto').map(voice => ({id: voice.id, label: voice.name + (voice.lang ? ' · ' + voice.lang : '')})));
    this.options(this.controls.voice, voices, model.voiceId || 'auto', 'voiceSignature'); this.controls.voice.disabled = !speech;
    const volume = number(model.volume, .8), rate = number(model.rate, 1);
    this.controls.volume.value = String(volume); this.controls.volumeValue.textContent = Math.round(volume * 100) + '%';
    this.controls.rate.value = String(rate); this.controls.rateValue.textContent = rate.toFixed(2).replace(/0$/, '') + '×';
    const samples = model.samples || []; if (!samples.some(sample => sample.id === this.sampleId)) this.sampleId = samples[0] && samples[0].id || '';
    this.options(this.controls.sample, samples.length ? samples : [{id: '', label: 'Sin grabaciones disponibles'}], this.sampleId, 'sampleSignature');
    this.controls.sample.disabled = !samples.length; this.controls.samplePlay.disabled = !samples.length;
    this.controls.repeat.disabled = !model.transcript; this.controls.stop.disabled = !model.speaking && !model.listening;
    this.controls.mic.disabled = !recognition; this.controls.mic.textContent = model.listening ? 'Cancelar escucha' : 'Micrófono'; this.controls.mic.setAttribute('aria-pressed', String(!!model.listening));
    this.controls.mic.title = recognition ? 'Haz una pregunta con el micrófono del dispositivo' : 'El dictado no está disponible en este navegador';
    this.hint.textContent = !speech ? 'Este navegador muestra subtítulos. Puedes probar las grabaciones.' : !recognition ? 'Micrófono no disponible aquí. Usa las consultas rápidas.' : model.listening ? 'Escuchando tu pregunta. Pulsa de nuevo para cancelar.' : 'El micrófono se activa solo cuando lo pulsas.';
    if (this.isXR() && this.xrPanel) this.opened ? this.paintXR() : this.paintXRLauncher();
  }

  open() {
    if (this.disposed || this.opened) return this.opened;
    if (!this.element) this.mount();
    if (!this.element) return false;
    if (this.isXR() && !this.ensureXR()) return false;
    if (this.ctx.beforeVoicePanelOpen) this.ctx.beforeVoicePanelOpen();
    this.opened = true; this.lastXR = this.isXR(); this.ctx.voicePanelOpen = true;
    if (this.ctx.desktopLook) { if (this.ctx.desktopLook.unlock) this.ctx.desktopLook.unlock(); if (this.ctx.desktopLook.reset) this.ctx.desktopLook.reset(); }
    if (this.ctx.editor && this.ctx.editor.hooks && this.ctx.editor.hooks.clearKeyboard) this.ctx.editor.hooks.clearKeyboard();
    this.updateVisibility();
    if (this.isXR()) { this.cancelWorldInput(); this.setXRLayout(true); this.placeXR(); this.installXRState(); this.paintXR(); }
    else { this.placeDesktop(); if (this.closeButton && this.closeButton.focus) this.closeButton.focus({preventScroll: true}); }
    return true;
  }
  close() {
    if (this.disposed) return false;
    const wasOpen = this.opened; this.opened = false; this.ctx.voicePanelOpen = false; this.presses.clear(); this.hovers.clear(); this.regions = [];
    const ray = this.ctx.raycontrol; if (ray && this.xrState && ray.states && ray.states[this.stateName] === this.xrState) ray.deactivateState(this.stateName);
    if (this.isXR() && this.xrPanel) { this.setXRLayout(false); this.placeXR(); this.paintXRLauncher(); this.installXRState(); }
    this.updateVisibility();
    if (wasOpen && !this.isXR() && this.launcher && this.launcher.focus) this.launcher.focus({preventScroll: true});
    return false;
  }
  toggle() { return this.opened ? this.close() : this.open(); }
  updateVisibility() {
    const xr = this.isXR(); if (this.element) this.element.hidden = !this.opened || xr;
    if (this.launcher) { this.launcher.hidden = xr; this.launcher.setAttribute('aria-expanded', String(this.opened)); }
    if (this.xrPanel) this.xrPanel.visible = xr && !this.xrSuspended;
  }
  placeDesktop() {
    if (!this.opened || this.isXR() || !this.element || !this.element.style) return;
    const dom = this.document, view = dom.defaultView;
    if (!view || !dom.querySelector) return;
    const viewportWidth = view.innerWidth, viewportHeight = view.innerHeight;
    if (!viewportWidth || !viewportHeight) return;
    const bounds = selector => { const element = dom.querySelector(selector); if (!element || element.hidden || !element.getBoundingClientRect) return null; const rect = element.getBoundingClientRect(); return rect.width && rect.height ? rect : null; };
    const camera = bounds('.vehicle-docking-monitor'), guidance = bounds('.vehicle-guidance-panel'), width = Math.min(340, viewportWidth - 24);
    let top = viewportHeight <= 620 ? 68 : viewportWidth <= 720 ? 78 : 76, right = viewportWidth <= 720 ? 12 : 18;
    if (camera) {
      const beside = viewportWidth - camera.left + 12, left = viewportWidth - beside - width;
      if (left >= Math.max(12, guidance ? guidance.right + 12 : 12)) right = beside;
      else top = Math.max(top, camera.bottom + 12, guidance ? guidance.bottom + 12 : 0);
    } else if (guidance && viewportWidth - right - width < guidance.right + 12) top = Math.max(top, guidance.bottom + 12);
    // A short viewport still provides a scrollable set of native controls.
    top = Math.min(top, Math.max(68, viewportHeight - 160));
    this.element.style.top = top + 'px'; this.element.style.right = right + 'px'; this.element.style.maxHeight = Math.max(100, viewportHeight - top - 12) + 'px';
  }

  ensureXR() {
    if (this.xrPanel) return true;
    if (!this.document || !this.ctx.scene || !this.ctx.camera || !this.ctx.raycontrol) return false;
    const canvas = this.document.createElement('canvas'); canvas.width = WIDTH; canvas.height = HEIGHT;
    const drawing = canvas.getContext && canvas.getContext('2d'); if (!drawing) return false;
    const texture = new THREE.CanvasTexture(canvas); texture.encoding = THREE.sRGBEncoding; texture.generateMipmaps = false; texture.minFilter = texture.magFilter = THREE.LinearFilter;
    const material = new THREE.MeshBasicMaterial({map: texture, toneMapped: false, depthTest: false, depthWrite: false});
    const panel = new THREE.Mesh(new THREE.PlaneBufferGeometry(.98, 1.12), material); panel.name = 'Asistente de voz · panel'; panel.visible = false; panel.renderOrder = 10001; panel.frustumCulled = false;
    Object.assign(panel.userData, {editorHelper: true, editorRuntimeHelper: true, editorNonCollidable: true, voiceAssistantPanel: true}); this.ctx.scene.add(panel);
    this.xrCanvas = canvas; this.xrDrawing = drawing; this.xrTexture = texture; this.xrPanel = panel;
    this.xrState = {voiceAssistantPanel: true, xrMenu: true, vrOnly: true, controller: 'both', raycaster: true, captureSelect: true, consumeSelect: true,
      colliderMesh: panel, isSelectable: (hit, controller) => this.validXR(hit, controller),
      onHover: (hit, pressed, controller) => this.hoverXR(hit, controller), onHoverLeave: (hit, pressed, controller) => this.hoverXR(null, controller),
      onSelectStart: (hit, controller) => this.pressXR(hit, controller), onSelectEnd: (hit, controller) => this.releaseXR(controller), onSelectCancel: (hit, controller) => this.releaseXR(controller)};
    this.installXRState(); return true;
  }
  installXRState() {
    const ray = this.ctx.raycontrol; if (!ray || !ray.states || !this.xrState) return;
    if (!ray.states[this.stateName]) ray.addState(this.stateName, this.xrState);
    if (this.isXR() && !this.xrSuspended && ray.states[this.stateName] === this.xrState) ray.activateState(this.stateName);
  }
  cancelWorldInput() {
    const ray = this.ctx.raycontrol; if (!ray) return;
    (ray.controllers || []).forEach(data => { if (ray.cancelSelect) ray.cancelSelect(data); if (ray.clearHover) ray.clearHover(data); data.currentIntersection = null; data.prevIntersection = null; data.intersections = {}; });
  }
  placeXR() {
    const camera = this.ctx.camera, xr = this.ctx.renderer && this.ctx.renderer.xr;
    const head = xr && xr.isPresenting && xr.getCamera ? xr.getCamera(camera) : camera;
    if (!head || !this.xrPanel) return;
    if (head === camera && head.updateWorldMatrix) head.updateWorldMatrix(true, false);
    this.position.setFromMatrixPosition(head.matrixWorld); this.rotation.extractRotation(head.matrixWorld); this.quaternion.setFromRotationMatrix(this.rotation);
    this.forward.set(0, 0, -1).applyQuaternion(this.quaternion); this.forward.y = 0; if (this.forward.lengthSq() < .01) this.forward.set(0, 0, -1); this.forward.normalize();
    this.xrPanel.position.copy(this.position).addScaledVector(this.forward, this.opened ? 1.4 : 1.6);
    if (this.opened) this.xrPanel.position.y = this.position.y - .08;
    else { this.right.set(-this.forward.z, 0, this.forward.x); this.xrPanel.position.addScaledVector(this.right, -.65); this.xrPanel.position.y = this.position.y + .25; }
    this.xrPanel.lookAt(this.position); this.xrPanel.updateWorldMatrix(true, false);
  }
  setXRLayout(expanded) {
    if (!this.xrCanvas || !this.xrPanel) return;
    const width = expanded ? WIDTH : LAUNCHER_WIDTH, height = expanded ? HEIGHT : LAUNCHER_HEIGHT;
    if (this.xrCanvas.width !== width || this.xrCanvas.height !== height) { this.xrCanvas.width = width; this.xrCanvas.height = height; this.dirty = true; }
    this.xrPanel.scale.set(expanded ? 1 : .25 / .98, expanded ? 1 : .078125 / 1.12, 1);
  }
  validXR(hit, controller) {
    const ray = this.ctx.raycontrol, data = ray && (ray.controllers || []).find(value => value.controller === controller), object = hit && (hit.actualObject || hit.object);
    return !!(this.isXR() && !this.xrSuspended && this.xrPanel && this.xrPanel.visible && hit && hit.uv && Number.isFinite(hit.distance) && hit.distance <= 5 && object === this.xrPanel && (!data || !data.desktop && data.enabled !== false));
  }
  regionXR(hit) {
    if (!hit || !hit.uv || !this.xrCanvas) return null; const x = hit.uv.x * this.xrCanvas.width, y = (1 - hit.uv.y) * this.xrCanvas.height;
    return this.regions.slice().reverse().find(region => x >= region.x && x <= region.x + region.width && y >= region.y && y <= region.y + region.height) || null;
  }
  hoverXR(hit, controller) {
    const region = this.validXR(hit, controller) && this.regionXR(hit), key = region && region.key || '';
    if (this.hovers.get(controller) !== key) { key ? this.hovers.set(controller, key) : this.hovers.delete(controller); this.dirty = true; }
  }
  pressXR(hit, controller) {
    if (!this.validXR(hit, controller) || this.presses.has(controller)) return;
    const region = this.regionXR(hit); if (!region || region.disabled) return;
    const held = Array.from(this.presses.values()).includes(region.key); this.presses.set(controller, region.key); this.dirty = true;
    if (!held) this.invoke(region.action);
  }
  releaseXR(controller) { if (this.presses.delete(controller)) this.dirty = true; }
  xrText(text, x, y, size = 25, color = COLORS.text, weight = 'normal') {
    const d = this.xrDrawing; d.font = weight + ' ' + size + 'px sans-serif'; d.fillStyle = color; d.textAlign = 'left'; d.fillText(String(text || ''), x, y);
  }
  xrWrap(text, x, y, width, lines = 3, size = 27, color = COLORS.text) {
    const d = this.xrDrawing; d.font = size + 'px sans-serif'; const words = String(text || '').split(/\s+/); let line = '', count = 0;
    for (let index = 0; index < words.length; index++) {
      const next = line ? line + ' ' + words[index] : words[index], measured = d.measureText ? d.measureText(next).width : next.length * size * .55;
      if (measured > width && line) { this.xrText(count === lines - 1 ? short(line, Math.max(1, line.length - 2)) + '…' : line, x, y + count * (size + 9), size, color); if (++count >= lines) return; line = words[index]; }
      else line = next;
    }
    if (count < lines) this.xrText(line, x, y + count * (size + 9), size, color);
  }
  xrButton(key, label, x, y, width, height, action, {accent = false, disabled = false, size = 26} = {}) {
    const d = this.xrDrawing, highlighted = Array.from(this.hovers.values()).includes(key) || Array.from(this.presses.values()).includes(key);
    d.fillStyle = disabled ? '#1b3039' : accent ? COLORS.accent : highlighted ? COLORS.hover : COLORS.card; d.fillRect(x, y, width, height);
    d.font = 'bold ' + size + 'px sans-serif'; d.fillStyle = disabled ? '#6e8b94' : accent ? COLORS.ink : COLORS.text; d.textAlign = 'center'; d.fillText(label, x + width / 2, y + height / 2 + size * .35); d.textAlign = 'left';
    this.regions.push({key, x, y, width, height, action, disabled});
  }
  cycleSample(direction) {
    const samples = this.model.samples || []; if (!samples.length) return;
    const index = samples.findIndex(sample => sample.id === this.sampleId); this.sampleId = samples[(Math.max(0, index) + direction + samples.length) % samples.length].id; this.dirty = true;
    if (this.controls.sample) this.controls.sample.value = this.sampleId;
  }
  cycleVoice() {
    const voices = [{id: 'auto'}].concat(this.model.voices || []), index = voices.findIndex(voice => voice.id === this.model.voiceId); this.assistant.setVoice(voices[(index + 1 + voices.length) % voices.length].id);
  }
  paintXRLauncher() {
    if (!this.xrDrawing || this.opened) return;
    this.regions = []; this.xrButton('launcher', 'Voz', 0, 0, LAUNCHER_WIDTH, LAUNCHER_HEIGHT, () => this.open(), {size: 76});
    const d = this.xrDrawing; d.fillStyle = COLORS.accent;
    [[68, 62, 36], [88, 48, 64], [108, 56, 48]].forEach(([x, y, height]) => d.fillRect(x, y, 8, height));
    this.xrTexture.needsUpdate = true; this.dirty = false;
  }
  paintXR() {
    if (!this.xrDrawing || !this.opened) return;
    const d = this.xrDrawing, m = this.model, samples = m.samples || [], sample = samples.find(value => value.id === this.sampleId), speech = m.speechSupported !== undefined ? m.speechSupported : m.capabilities && m.capabilities.speech;
    const recognition = m.recognitionSupported !== undefined ? m.recognitionSupported : m.capabilities && m.capabilities.recognition;
    this.regions = []; d.fillStyle = COLORS.background; d.fillRect(0, 0, WIDTH, HEIGHT); d.fillStyle = '#193642'; d.fillRect(0, 0, WIDTH, 110);
    this.xrText('Asistente de voz', 38, 52, 35, COLORS.text, 'bold'); this.xrText('GUÍA DEL SIMULADOR', 40, 87, 20, COLORS.accent);
    this.xrButton('close', 'Cerrar', 712, 26, 146, 58, () => this.close());
    this.xrText(short(m.error || m.status || 'Listo para ayudarte.', 64), 40, 150, 24, m.error ? COLORS.error : COLORS.accent);
    this.xrWrap(m.transcript || 'Consulta el siguiente paso o prueba una grabación.', 40, 192, 812, 3, 27);
    this.xrButton('enabled', m.enabled ? 'Voz activada' : 'Activar voz', 40, 291, 396, 58, () => this.assistant.setEnabled(!m.enabled), {accent: !!m.enabled});
    this.xrButton('automatic', 'Guía automática: ' + (m.automatic ? 'sí' : 'no'), 460, 291, 396, 58, () => this.assistant.setAutomatic(!m.automatic), {size: 25});
    [['next', 'Siguiente paso'], ['objective', 'Mi objetivo'], ['controls', 'Controles'], ['content', 'Qué estoy viendo']].forEach(([intent, label], index) => this.xrButton(intent, label, index % 2 ? 460 : 40, 370 + Math.floor(index / 2) * 76, 396, 58, () => this.assistant.ask(intent)));
    this.xrText('GRABACIONES DE PRUEBA', 40, 549, 20, COLORS.dim);
    this.xrButton('samplePrevious', '‹', 40, 569, 70, 58, () => this.cycleSample(-1), {disabled: !samples.length, size: 34});
    this.xrButton('samplePlay', sample ? '▶  ' + short(sample.label, 35) : 'Sin grabaciones', 126, 569, 644, 58, () => this.assistant.playSample(this.sampleId), {disabled: !sample, size: 24});
    this.xrButton('sampleNext', '›', 786, 569, 70, 58, () => this.cycleSample(1), {disabled: !samples.length, size: 34});
    const volume = number(m.volume, .8), rate = number(m.rate, 1);
    this.xrText('Volumen de voz · ' + Math.round(volume * 100) + '%', 40, 675, 25, COLORS.dim);
    this.xrButton('volumeDown', '−', 638, 643, 100, 50, () => this.assistant.setVolume(Math.max(0, volume - .1)), {size: 32});
    this.xrButton('volumeUp', '+', 756, 643, 100, 50, () => this.assistant.setVolume(Math.min(1, volume + .1)), {size: 32});
    this.xrText('Velocidad · ' + rate.toFixed(2).replace(/0$/, '') + '×', 40, 740, 25, COLORS.dim);
    this.xrButton('rateDown', '−', 638, 708, 100, 50, () => this.assistant.setRate(Math.max(.6, rate - .1)), {size: 32});
    this.xrButton('rateUp', '+', 756, 708, 100, 50, () => this.assistant.setRate(Math.min(1.5, rate + .1)), {size: 32});
    const voice = (m.voices || []).find(value => value.id === m.voiceId);
    this.xrButton('voice', speech ? 'Voz: ' + short(voice ? voice.name : 'Automática · español', 46) : 'Subtítulos y grabaciones', 40, 777, 816, 54, () => this.cycleVoice(), {disabled: !speech, size: 24});
    this.xrButton('repeat', 'Repetir', 40, 850, 396, 58, () => this.assistant.repeat(), {disabled: !m.transcript});
    this.xrButton('stop', 'Detener', 460, 850, 396, 58, () => this.assistant.stop(), {disabled: !m.speaking && !m.listening});
    this.xrButton('mic', m.listening ? 'Cancelar escucha' : recognition ? 'Preguntar con micrófono' : 'Micrófono no disponible · usa las consultas', 40, 928, 816, 58, () => m.listening ? this.assistant.stop() : this.assistant.listen(), {disabled: !recognition, size: 24});
    this.xrTexture.needsUpdate = true; this.dirty = false;
  }

  step(delta = 0) {
    if (this.disposed) return;
    const xr = this.isXR(); if (xr !== this.lastXR) { this.lastXR = xr; this.close(); if (!xr) this.releaseXRResources(); }
    const session = xr && this.ctx.renderer && this.ctx.renderer.xr && this.ctx.renderer.xr.getSession && this.ctx.renderer.xr.getSession();
    this.xrSuspended = !!(session && session.visibilityState && session.visibilityState !== 'visible');
    if (this.opened && this.xrSuspended) this.close();
    if (xr && !this.xrSuspended && this.ensureXR()) {
      this.setXRLayout(this.opened); this.installXRState();
      if (!this.opened) this.placeXR();
      if (this.dirty) this.opened ? this.paintXR() : this.paintXRLauncher();
    } else if (xr && this.xrState && this.ctx.raycontrol) this.ctx.raycontrol.deactivateState(this.stateName);
    this.updateVisibility();
    if (this.opened && !xr) { this.layoutElapsed = (this.layoutElapsed || 0) + Math.max(0, number(delta, 0)); if (this.layoutElapsed >= .25) { this.layoutElapsed = 0; this.placeDesktop(); } }
  }
  releaseXRResources() {
    const ray = this.ctx.raycontrol;
    if (ray && this.xrState && ray.states && ray.states[this.stateName] === this.xrState) { ray.deactivateState(this.stateName); delete ray.states[this.stateName]; }
    if (this.xrPanel) { if (this.xrPanel.parent) this.xrPanel.parent.remove(this.xrPanel); this.xrPanel.geometry.dispose(); this.xrPanel.material.dispose(); }
    if (this.xrTexture) this.xrTexture.dispose(); if (this.xrCanvas) this.xrCanvas.width = this.xrCanvas.height = 1;
    this.xrPanel = this.xrState = this.xrTexture = this.xrCanvas = this.xrDrawing = null;
  }
  dispose() {
    if (this.disposed) return;
    this.close(); this.releaseXRResources(); if (typeof this.unsubscribe === 'function') this.unsubscribe(); this.unsubscribe = null;
    this.listeners.splice(0).forEach(remove => remove());
    [this.element, this.launcher].forEach(node => { if (node && node.parentNode) node.parentNode.removeChild(node); });
    this.element = this.launcher = null; this.controls = {}; this.presses.clear(); this.hovers.clear(); this.disposed = true;
  }
}

export default VoiceAssistantPanel;
