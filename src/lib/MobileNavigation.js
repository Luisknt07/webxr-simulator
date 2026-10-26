const ZERO = () => ({forward: 0, right: 0, vertical: 0, lookX: 0, lookY: 0});
const clamp = (value, low = -1, high = 1) => Math.max(low, Math.min(high, value));

/** Pointer-only input adapter. The main loop applies these axes through the
 * same collision and camera paths as keyboard input; actions reuse its ray. */
export default class MobileNavigation {
  constructor(ctx, options = {}) {
    this.ctx = ctx || {}; this.options = options; this.state = ZERO(); this.pointers = new Map(); this.padOwners = new Map(); this.listeners = []; this.active = false; this.disposed = false;
    this.document = options.document || this.ctx.document || (typeof document === 'undefined' ? null : document);
    this.window = options.window || this.document && this.document.defaultView || (typeof window === 'undefined' ? null : window);
    this.media = this.window && this.window.matchMedia ? this.window.matchMedia('(pointer: coarse)') : null;
    this.cancel = () => this.reset('cancel'); this.refresh = () => this.sync();
    if (this.window) this.listen(this.window, 'blur', this.cancel);
    if (this.document) this.listen(this.document, 'visibilitychange', this.refresh);
    if (this.media && this.media.addEventListener) this.listen(this.media, 'change', this.refresh);
    else if (this.media && this.media.addListener) this.media.addListener(this.refresh);
    this.sync();
  }
  listen(target, type, handler, options) { if (!target || !target.addEventListener) return; target.addEventListener(type, handler, options); this.listeners.push(() => target.removeEventListener(type, handler, options)); }
  coarse() { return typeof this.options.coarse === 'boolean' ? this.options.coarse : Boolean(this.media && this.media.matches); }
  allowed() {
    const ctx = this.ctx, editor = ctx.editor, studio = ctx.studio;
    return this.coarse() && !this.disposed && this.document && !this.document.hidden && !ctx.vrMode && !(ctx.renderer && ctx.renderer.xr && ctx.renderer.xr.isPresenting) &&
      !(editor && (editor.active || editor.initializing || editor.loadingProject)) && !(studio && studio.drawer && !studio.drawer.hidden) && !ctx.mobileNavigationBlocked;
  }
  stopEvent(event) { if (event.preventDefault) event.preventDefault(); if (event.stopPropagation) event.stopPropagation(); }
  call(name, ...args) { const callback = this.options[name]; if (typeof callback === 'function') callback(...args); }
  build() {
    const dom = this.document; if (this.root || !dom || !dom.createElement || !dom.body) return;
    const node = (tag, text, parent, className) => { const element = dom.createElement(tag); if (text) element.textContent = text; if (className) element.className = className; if (parent) parent.appendChild(element); return element; };
    this.root = node('nav', '', dom.body, 'mobile-navigation'); this.root.setAttribute('aria-label', 'Controles táctiles de la escena'); this.root.hidden = true;
    const pad = (kind, title) => {
      const element = node('div', '', this.root, 'mobile-navigation-pad mobile-navigation-' + kind); element.setAttribute('aria-label', title); element.setAttribute('role', 'group');
      const knob = node('span', '', element, 'mobile-navigation-knob'); node('span', kind === 'move' ? 'Caminar' : 'Mirar', element, 'mobile-navigation-pad-title');
      this.listen(element, 'pointerdown', event => {
        if (!this.active || event.pointerType === 'mouse' || this.padOwners.has(kind)) return; this.stopEvent(event);
        const box = element.getBoundingClientRect(), row = {kind, element, knob, centerX: box.left + box.width / 2, centerY: box.top + box.height / 2, radius: Math.max(20, Math.min(box.width, box.height) * .38), lastX: event.clientX, lastY: event.clientY};
        this.pointers.set(event.pointerId, row); this.padOwners.set(kind, event.pointerId); this.capture(element, event.pointerId); if (kind === 'move') this.movePad(row, event);
      });
      this.listen(element, 'pointermove', event => {
        const row = this.pointers.get(event.pointerId); if (!row || row.kind !== kind || !this.active) return; this.stopEvent(event);
        if (kind === 'move') this.movePad(row, event);
        else if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) { this.state.lookX += clamp(event.clientX - row.lastX, -80, 80); this.state.lookY += clamp(event.clientY - row.lastY, -80, 80); row.lastX = event.clientX; row.lastY = event.clientY; }
      });
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => this.listen(element, type, event => this.end(event, type !== 'pointerup'))); return element;
    };
    this.moveElement = pad('move', 'Caminar: arrastra el mando izquierdo'); this.lookElement = pad('look', 'Mirar: desliza el mando derecho');
    const actions = node('div', '', this.root, 'mobile-navigation-actions');
    const button = (text, title, action, holdKind) => {
      const element = node('button', text, actions); element.type = 'button'; element.setAttribute('aria-label', title);
      this.listen(element, 'pointerdown', event => {
        if (!this.active || element.disabled) return; this.stopEvent(event);
        if (holdKind) { if (this.padOwners.has(holdKind)) return; this.padOwners.set(holdKind, event.pointerId); this.pointers.set(event.pointerId, {kind: holdKind, element}); this.capture(element, event.pointerId); }
        action(event); this.updateVertical();
      });
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => this.listen(element, type, event => this.end(event, type !== 'pointerup')));
      if (holdKind) {
        const keyId = 'keyboard-' + title;
        this.listen(element, 'keydown', event => {
          if (!this.active || element.disabled || !['Enter', ' ', 'Spacebar'].includes(event.key) || event.repeat || this.padOwners.has(holdKind)) return;
          this.stopEvent(event); this.padOwners.set(holdKind, keyId); this.pointers.set(keyId, {kind: holdKind, element}); action(event); this.updateVertical();
        });
        this.listen(element, 'keyup', event => { if (['Enter', ' ', 'Spacebar'].includes(event.key)) this.end({pointerId: keyId, button: 0, preventDefault: () => event.preventDefault(), stopPropagation: () => event.stopPropagation()}, false); });
      }
      this.listen(element, 'click', event => {
        if (!this.active || element.disabled || event.detail > 0) return; this.stopEvent(event); action(event);
        if (holdKind === 'interact') this.call('onInteractEnd', event);
        if (holdKind === 'up' || holdKind === 'down') this.state.vertical = 0;
      });
      return element;
    };
    this.interactButton = button('Accionar', 'Accionar el objeto del círculo central', event => this.call('onInteractStart', event), 'interact');
    this.grabButton = button('Coger', 'Coger o soltar la carga apuntada', event => this.call('onGrabToggle', event));
    this.dropButton = button('Soltar', 'Soltar la carga sostenida', event => this.call('onRelease', event));
    this.flightButton = button('Vuelo', 'Activar vuelo dron', event => { this.call('onFlightToggle', event); this.sync(); });
    this.nearButton = button('Acercar', 'Acercar la carga sostenida', event => this.call('onDistance', -120, event));
    this.farButton = button('Alejar', 'Alejar la carga sostenida', event => this.call('onDistance', 120, event));
    this.upButton = button('Subir', 'Subir en vuelo dron', () => {}, 'up'); this.downButton = button('Bajar', 'Bajar en vuelo dron', () => {}, 'down');
  }
  capture(element, id) { if (element.setPointerCapture) { try { element.setPointerCapture(id); } catch (_) { /* Pointer may have ended during a view change. */ } } }
  movePad(row, event) {
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    let x = (event.clientX - row.centerX) / row.radius, y = (event.clientY - row.centerY) / row.radius; const length = Math.hypot(x, y);
    if (length <= .12) x = y = 0; else { const factor = Math.min(1, (length - .12) / .88) / length; x *= factor; y *= factor; }
    this.state.right = x; this.state.forward = -y; row.knob.style.transform = 'translate(' + Math.round(x * row.radius * .7) + 'px,' + Math.round(y * row.radius * .7) + 'px)';
  }
  updateVertical() { this.state.vertical = this.ctx.desktopFlight ? Number(this.padOwners.has('up')) - Number(this.padOwners.has('down')) : 0; }
  end(event, cancelled = false) {
    const row = this.pointers.get(event.pointerId); if (!row) return; cancelled = cancelled || !this.allowed(); this.stopEvent(event); this.pointers.delete(event.pointerId); this.padOwners.delete(row.kind);
    if (row.kind === 'move') { this.state.forward = this.state.right = 0; row.knob.style.transform = ''; }
    if (row.kind === 'look' && cancelled) { this.state.lookX = this.state.lookY = 0; if (this.ctx.desktopLook && this.ctx.desktopLook.reset) this.ctx.desktopLook.reset(); }
    if (row.kind === 'interact') { if (cancelled && this.options.onInteractCancel) this.call('onInteractCancel', event); else this.call('onInteractEnd', cancelled ? {button: 0, pointerId: event.pointerId, cancelled: true, preventDefault() {}, stopPropagation() {}} : event); }
    this.updateVertical(); if (Number.isFinite(event.pointerId) && row.element.releasePointerCapture) { try { row.element.releasePointerCapture(event.pointerId); } catch (_) { /* Capture was already lost. */ } }
  }
  reset(reason = 'cancel') {
    [...this.pointers.keys()].forEach(pointerId => this.end({pointerId, reason, preventDefault() {}, stopPropagation() {}}, true)); this.state = ZERO(); this.padOwners.clear(); if (this.ctx.desktopLook && this.ctx.desktopLook.reset) this.ctx.desktopLook.reset();
  }
  sync() {
    const active = Boolean(this.allowed()); if (active && !this.root) this.build();
    if (this.active && !active) this.reset('hidden');
    if (active !== this.active && this.document && this.document.body && this.document.body.classList) this.document.body.classList.toggle('mobile-navigation-active', active);
    this.active = active; if (!this.root) return active;
    if (this.root.hidden === active) this.root.hidden = !active;
    const flight = Boolean(this.ctx.desktopFlight); if (flight !== this.lastFlight) {
      if (!flight) [...this.pointers].forEach(([pointerId, row]) => { if (row.kind === 'up' || row.kind === 'down') this.end({pointerId, preventDefault() {}, stopPropagation() {}}, true); });
      this.flightButton.textContent = flight ? 'Fin vuelo' : 'Vuelo'; this.flightButton.setAttribute('aria-label', flight ? 'Desactivar vuelo dron' : 'Activar vuelo dron'); this.flightButton.setAttribute('aria-pressed', String(flight)); this.upButton.hidden = this.downButton.hidden = !flight; this.lastFlight = flight;
    } this.updateVertical();
    const simulation = this.ctx.editor && this.ctx.editor.simulation, controller = this.ctx.desktopController, held = Boolean(simulation && simulation.held && simulation.held.has(controller));
    if (this.nearButton.disabled === held) this.nearButton.disabled = this.farButton.disabled = !held;
    const dropDisabled = !held && !(controller && controller.userData && controller.userData.grabbing); if (this.dropButton.disabled !== dropDisabled) this.dropButton.disabled = dropDisabled;
    return active;
  }
  consume() { this.sync(); if (!this.active) return ZERO(); const result = Object.assign({}, this.state, {lookX: clamp(this.state.lookX, -200, 200), lookY: clamp(this.state.lookY, -200, 200)}); this.state.lookX = this.state.lookY = 0; return result; }
  dispose() { if (this.disposed) return; this.reset('dispose'); this.disposed = true; this.active = false; this.listeners.splice(0).forEach(remove => remove()); if (this.media && this.media.removeListener && !this.media.removeEventListener) this.media.removeListener(this.refresh); if (this.document && this.document.body && this.document.body.classList) this.document.body.classList.remove('mobile-navigation-active'); if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root); }
}
