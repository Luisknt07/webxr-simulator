const SVG_NS = 'http://www.w3.org/2000/svg';
const text = (value, maximum = 420) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maximum) : '';
const content = (node, value) => {if (node.textContent !== value) node.textContent = value;};
let serial = 0;

/** A visible companion for the current practice. This component never narrates,
 * requests microphone access on mount, creates an agent, or changes the world.
 * It delegates voice and chat to the application's existing assistant services. */
export class PracticeGuideAvatar {
  constructor({context = {}, document: dom, window: view, getPracticeState} = {}) {
    this.ctx = context;
    this.document = dom || context.document || (typeof document === 'undefined' ? null : document);
    this.window = view || this.document && this.document.defaultView || (typeof window === 'undefined' ? null : window);
    this.getPracticeState = getPracticeState;
    this.id = 'practice-guide-avatar-' + (++serial);
    this.listeners = [];
    this.expanded = false;
    this.disposed = false;
    this.voiceState = {};
    this.permission = 'unknown';
    this.notice = '';
  }

  create(tag, className, content, parent) {
    const node = this.document.createElement(tag);
    if (className) node.className = className;
    if (content) node.textContent = content;
    if (parent) parent.appendChild(node);
    return node;
  }

  listen(target, type, callback, options) {
    if (!target || !target.addEventListener) return;
    target.addEventListener(type, callback, options);
    this.listeners.push(() => target.removeEventListener(type, callback, options));
  }

  svg(tag, attributes, parent) {
    const node = this.document.createElementNS ? this.document.createElementNS(SVG_NS, tag) : this.document.createElement(tag);
    for (const [name, value] of Object.entries(attributes || {})) node.setAttribute(name, String(value));
    if (parent) parent.appendChild(node);
    return node;
  }

  icon(name, parent) {
    const node = this.svg('svg', {viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true'}, parent);
    const paths = {
      voice: ['M4 10v4m4-7v10m4-13v16m4-13v10m4-7v4'],
      mic: ['M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5Z', 'M6 10v2a6 6 0 0 0 12 0v-2M12 18v4m-4 0h8'],
      chat: ['M21 11a8 8 0 0 1-8 8H8l-5 3 1.5-6A8 8 0 1 1 21 11Z', 'M8 11h.01M12 11h.01M16 11h.01'],
      close: ['m7 7 10 10M17 7 7 17'],
      settings: ['M4 7h16M4 17h16M8 4v6m8 4v6']
    };
    for (const d of paths[name] || []) this.svg('path', {d}, node);
    return node;
  }

  portrait(parent) {
    const svg = this.svg('svg', {viewBox: '0 0 88 102', role: 'img', 'aria-label': 'Guía de prácticas con casco y auricular', class: 'st-guide-portrait'}, parent);
    // Original, lightweight vector character. The helmet, headset, jacket and
    // face remain legible at the small size used by the scene HUD.
    this.svg('ellipse', {cx: 44, cy: 96, rx: 32, ry: 5, fill: '#021b23', opacity: .4}, svg);
    this.svg('path', {d: 'M12 94v-9c0-15 13-25 32-25s32 10 32 25v9Z', fill: '#147d7f', stroke: '#47d8ce', 'stroke-width': 1.2}, svg);
    this.svg('path', {d: 'm27 67 10 27h14l10-27-10-5H37Z', fill: '#073c4b'}, svg);
    this.svg('path', {d: 'm27 72 8 22m26-22-8 22', stroke: '#d5f6ac', 'stroke-width': 4}, svg);
    this.svg('path', {d: 'M36 55v10l8 8 8-8V55', fill: '#c99071'}, svg);
    this.svg('rect', {x: 26, y: 23, width: 36, height: 39, rx: 16, fill: '#e6b28c', stroke: '#ffe4c9', 'stroke-width': .7}, svg);
    this.svg('path', {d: 'M27 34c0-21 34-23 34 0l-5-7-15 2-12 8Z', fill: '#263238'}, svg);
    this.svg('path', {d: 'M22 28C22 9 33 3 44 3s22 6 22 25Z', fill: '#68f1d5', stroke: '#b7ffed', 'stroke-width': 1.2}, svg);
    this.svg('path', {d: 'M40 4v18m8-18v18', stroke: '#199f9d', 'stroke-width': 2.3}, svg);
    this.svg('path', {d: 'M20 27h48v5H20Z', fill: '#279b9e', stroke: '#83f9df', 'stroke-width': 1}, svg);
    this.svg('path', {d: 'M24 37v9m40-9v9', stroke: '#062b39', 'stroke-width': 7}, svg);
    this.svg('path', {d: 'M65 43v8l-11 5', stroke: '#c3fff0', 'stroke-width': 2, fill: 'none'}, svg);
    this.svg('rect', {x: 50, y: 53, width: 8, height: 4, rx: 2, fill: '#073340'}, svg);
    this.svg('path', {d: 'M33 39h7m8 0h7', stroke: '#583b32', 'stroke-width': 1.7, 'stroke-linecap': 'round'}, svg);
    for (const cx of [36, 51]) this.svg('circle', {cx, cy: 43, r: 1.4, fill: '#193039'}, svg);
    this.svg('path', {d: 'm43 44-2 6h4m-7 4q6 4 12-1', stroke: '#9a5e4b', 'stroke-width': 1.2, 'stroke-linecap': 'round', fill: 'none'}, svg);
    this.svg('path', {d: 'M18 83h10m32 0h10M44 75v19', stroke: '#7fe9dc', 'stroke-width': 1}, svg);
    this.svg('rect', {x: 17, y: 77, width: 11, height: 8, rx: 2, fill: '#e9fcf0'}, svg);
    this.svg('path', {d: 'm20 81 2 2 4-4', stroke: '#0e827f', 'stroke-width': 1.5, fill: 'none'}, svg);
    return svg;
  }

  button(name, label, parent, action) {
    const button = this.create('button', 'st-guide-action st-guide-action-' + name, '', parent);
    button.type = 'button';
    button.setAttribute('data-guide-action', name);
    button.setAttribute('aria-label', label);
    button.title = label;
    this.icon(name, button);
    this.create('span', '', label, button);
    this.listen(button, 'click', event => {event.stopPropagation(); this.invoke(action);});
    return button;
  }

  mount(host) {
    if (this.disposed || this.element || !this.document || !this.document.createElement) return this;
    const parent = host || this.document.body;
    if (!parent) return this;
    this.element = this.create('section', 'st-practice-guide', '', parent);
    this.element.setAttribute('data-practice-guide-avatar', '');
    this.element.setAttribute('data-expanded', 'false');
    this.element.setAttribute('aria-label', 'Tu guía de práctica');
    this.element.hidden = true;
    this.launcher = this.create('button', 'st-guide-launcher', '', this.element);
    this.launcher.type = 'button';
    this.launcher.setAttribute('aria-expanded', 'false');
    this.launcher.setAttribute('aria-controls', this.id);
    this.launcher.setAttribute('aria-label', 'Abrir la guía del paso actual');
    this.portrait(this.launcher);
    const identity = this.create('span', 'st-guide-identity', '', this.launcher);
    this.create('strong', '', 'Tu guía', identity);
    this.activity = this.create('span', 'st-guide-activity', 'Disponible', identity);
    this.listen(this.launcher, 'click', event => {event.stopPropagation(); this.setExpanded(!this.expanded);});
    const actions = this.create('div', 'st-guide-actions', '', this.element);
    actions.setAttribute('aria-label', 'Voz y consultas');
    this.voiceButton = this.button('voice', 'Voz', actions, () => this.toggleVoice());
    this.microphoneButton = this.button('mic', 'Mic', actions, () => this.toggleMicrophone());
    this.chatButton = this.button('chat', 'Chat', actions, () => this.openChat());

    this.bubble = this.create('section', 'st-guide-bubble', '', this.element);
    this.bubble.id = this.id;
    this.bubble.hidden = true;
    this.bubble.setAttribute('aria-label', 'Indicación del paso actual');
    const header = this.create('header', 'st-guide-bubble-header', '', this.bubble);
    this.stepLabel = this.create('span', 'st-guide-step', 'PASO ACTUAL', header);
    this.closeButton = this.button('close', 'Cerrar indicación', header, () => this.setExpanded(false));
    this.heading = this.create('h3', '', '', this.bubble);
    this.instruction = this.create('p', 'st-guide-instruction', '', this.bubble);
    this.status = this.create('p', 'st-guide-status', '', this.bubble);
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.settingsButton = this.button('settings', 'Ajustes de voz', this.bubble, () => this.openVoicePanel());

    // Contain pointer gestures without intercepting keyboard movement globally.
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'touchstart', 'touchend', 'wheel']) this.listen(this.element, type, event => event.stopPropagation());
    this.listen(this.document, 'keydown', event => {
      if (this.expanded && (event.key === 'Escape' || event.code === 'Escape')) this.setExpanded(false);
    });
    this.listen(this.document, 'visibilitychange', () => {if (this.document.hidden) this.setExpanded(false);});
    this.observePermission();
    this.update();
    return this;
  }

  observePermission() {
    const permissions = this.window && this.window.navigator && this.window.navigator.permissions;
    if (!permissions || typeof permissions.query !== 'function') return;
    // query() only observes browser permission; it never opens a permission prompt.
    Promise.resolve().then(() => permissions.query({name: 'microphone'})).then(status => {
      if (this.disposed) return;
      this.permissionStatus = status;
      const refresh = () => {
        if (this.disposed) return;
        this.permission = ['granted', 'denied', 'prompt'].includes(status.state) ? status.state : 'unknown';
        this.renderVoice();
      };
      this.listen(status, 'change', refresh);
      refresh();
    }).catch(() => {/* The browser may not expose microphone permission queries. */});
  }

  connectVoice() {
    const voice = this.ctx.voiceAssistant;
    if (voice === this.voice) return;
    if (this.unsubscribe) this.unsubscribe();
    this.unsubscribe = null;
    this.voice = voice || null;
    this.voiceState = voice && typeof voice.state === 'function' ? voice.state() : {};
    if (voice && typeof voice.subscribe === 'function') this.unsubscribe = voice.subscribe(state => {
      if (this.disposed || this.voice !== voice) return;
      this.voiceState = state || {};
      this.renderVoice();
    });
  }

  invoke(action) {
    if (this.disposed) return false;
    try {
      const result = action();
      if (result && typeof result.catch === 'function') result.catch(() => this.showNotice('No se pudo abrir esta ayuda. Vuelve a intentarlo.'));
      return result;
    } catch (_) {this.showNotice('No se pudo abrir esta ayuda. Vuelve a intentarlo.'); return false;}
  }

  setExpanded(open) {
    if (this.disposed || !this.element) return false;
    this.expanded = !!open;
    this.bubble.hidden = !this.expanded;
    this.element.setAttribute('data-expanded', String(this.expanded));
    this.launcher.setAttribute('aria-expanded', String(this.expanded));
    this.launcher.setAttribute('aria-label', this.expanded ? 'Ocultar la guía del paso actual' : 'Abrir la guía del paso actual');
    return this.expanded;
  }

  showNotice(message) {this.notice = text(message); this.setExpanded(true); this.renderVoice();}

  toggleVoice() {
    this.connectVoice();
    if (!this.voice || typeof this.voice.setEnabled !== 'function') {this.showNotice('La voz no está disponible. Puedes consultar la guía y el registro.'); return false;}
    this.notice = '';
    const value = this.voice.setEnabled(!this.voiceState.enabled);
    this.voiceState = this.voice.state ? this.voice.state() : {...this.voiceState, enabled: !!value};
    this.renderVoice();
    return value;
  }

  toggleMicrophone() {
    this.connectVoice();
    if (!this.voice || typeof this.voice.listen !== 'function') {this.showNotice('El micrófono no está disponible. Usa Chat para escribir tu consulta.'); return false;}
    if (this.permission === 'denied') {this.showNotice('Micrófono bloqueado. Permite su uso en los ajustes de este sitio del navegador o escribe en Chat.'); return false;}
    const model = this.voiceState, supported = model.recognitionSupported === true || model.capabilities && model.capabilities.recognition === true;
    if (!supported) {this.showNotice('Este navegador no ofrece dictado. Usa Chat para escribir tu consulta.'); return false;}
    this.notice = '';
    this.setExpanded(true);
    // The only capture invocation in this component is this explicit user action.
    return this.voice.listen();
  }

  openChat() {
    const workspace = this.ctx.assistantWorkspace;
    this.notice = '';
    if (workspace && typeof workspace.open === 'function') {
      const opened = workspace.open();
      if (opened !== false) this.setExpanded(false);
      return opened;
    }
    const panel = this.ctx.voicePanel;
    if (panel && typeof panel.open === 'function') {
      const opened = panel.open();
      if (opened !== false) {
        this.setExpanded(false);
        if (panel.questionInput && panel.questionInput.focus) panel.questionInput.focus({preventScroll: true});
      }
      return opened;
    }
    this.showNotice('El chat no está disponible en esta sesión. La guía de la práctica sigue disponible.');
    return false;
  }

  openVoicePanel() {
    if (this.ctx.voicePanel && typeof this.ctx.voicePanel.open === 'function') {this.setExpanded(false); return this.ctx.voicePanel.open();}
    this.showNotice('Los ajustes de voz no están disponibles en esta sesión.');
    return false;
  }

  renderVoice() {
    if (this.disposed || !this.element) return;
    const state = this.voiceState || {}, busy = state.thinking || state.synthesizing;
    const phase = state.listening ? 'listening' : state.speaking ? 'speaking' : busy ? 'thinking' : state.enabled ? 'ready' : 'off';
    this.element.setAttribute('data-voice-state', phase);
    this.element.setAttribute('data-microphone-permission', this.permission);
    content(this.activity, state.listening ? 'Escuchando' : state.speaking ? 'Hablando' : busy ? 'Consultando' : 'Tu siguiente paso');
    this.voiceButton.setAttribute('aria-pressed', String(!!state.enabled));
    this.voiceButton.setAttribute('aria-label', state.enabled ? 'Desactivar voz' : 'Activar voz');
    this.voiceButton.title = state.enabled ? 'Desactivar voz' : 'Activar voz';
    this.microphoneButton.setAttribute('aria-pressed', String(!!state.listening));
    this.microphoneButton.setAttribute('aria-label', state.listening ? 'Terminar pregunta por voz' : 'Preguntar por voz');
    this.microphoneButton.title = this.permission === 'denied' ? 'Micrófono bloqueado por el navegador' : state.listening ? 'Terminar pregunta por voz' : 'Preguntar por voz';
    this.chatButton.setAttribute('aria-pressed', String(!!(this.ctx.assistantPanelOpen || this.ctx.voicePanelOpen)));
    const remote = state.capabilities && state.capabilities.remoteAnswer;
    content(this.status, this.notice || (state.listening ? 'Escuchando. Pulsa Mic de nuevo para terminar.' : state.error || text(state.status, 220)) || (remote ? 'Asistente conectado. Puedes preguntar por voz o en Chat.' : 'Guía de la práctica. Pulsa Voz para escuchar o Chat para consultar.'));
  }

  update(state) {
    if (this.disposed) return;
    if (!this.element) this.mount();
    if (!this.element) return;
    this.connectVoice();
    const editor = this.ctx.editor, controller = editor && editor.practiceController;
    const xr = this.ctx.vrMode || this.ctx.renderer && this.ctx.renderer.xr && this.ctx.renderer.xr.isPresenting;
    if (state === undefined) {
      // The host may update every frame. Observe the native practice at most
      // four times per second; its snapshot can include inventory and telemetry.
      const now = Date.now();
      if (this.lastController !== controller || this.lastStateAt === undefined || now - this.lastStateAt >= 250) {
        this.lastController = controller; this.lastStateAt = now;
        try {this.practiceState = this.getPracticeState ? this.getPracticeState() : controller && (!controller.current || controller.current()) && controller.state && controller.state();}
        catch (_) {this.practiceState = null;}
      }
      state = this.practiceState;
    }
    const visible = !!state && !xr && !(editor && editor.active);
    this.element.hidden = !visible;
    if (!visible) {this.setExpanded(false); return;}
    const session = state.session || {}, completed = session.passed === true;
    const step = state.step || {}, stepIndex = Number.isFinite(Number(session.stepIndex)) ? Number(session.stepIndex) : Array.isArray(session.completedSteps) ? session.completedSteps.length : 0;
    const title = text(step.title, 140) || 'Explora la práctica';
    const instruction = text(step.action || step.instruction || state.lastMessage || state.plan && state.plan.objective);
    const key = [controller && controller.attemptId || '', step.id || stepIndex, completed, title, instruction].join('|');
    if (key !== this.instructionKey) {
      this.instructionKey = key;
      this.notice = '';
      content(this.stepLabel, completed ? 'PRÁCTICA COMPLETADA' : 'PASO ' + Math.max(1, Math.min(6, stepIndex + 1)) + ' DE 6');
      content(this.heading, completed ? 'Trabajo verificado' : title);
      content(this.instruction, completed ? 'Has completado las misiones. Consulta tu evaluación y las siguientes prácticas.' : instruction || 'Consulta Misiones para conocer la tarea actual y Registro para realizar las comprobaciones.');
    }
    if ((this.ctx.practiceReadingPanelOpen || this.ctx.assistantPanelOpen || this.ctx.voicePanelOpen || this.ctx.studioMenuOpen) && this.expanded) this.setExpanded(false);
    this.renderVoice();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.unsubscribe) this.unsubscribe();
    this.unsubscribe = null;
    this.listeners.splice(0).forEach(remove => remove());
    if (this.element && this.element.parentNode) this.element.parentNode.removeChild(this.element);
    this.element = null;
    this.voice = null;
    this.permissionStatus = null;
  }
}

export default PracticeGuideAvatar;
