const MODES = [['auto', 'Automático'], ['economy', 'Ahorro'], ['balanced', 'Equilibrado'], ['high', 'Alta'], ['ultra', 'Cinemática']];
const label = value => (MODES.find(row => row[0] === value) || ['', 'Evaluando'])[1];
const finite = value => typeof value === 'number' && Number.isFinite(value);
let nextGraphicsSettings = 0;

/** Device preferences only. The graphics controller owns persistence and GPU
 * limits; this view never changes a project, its lights or authored materials. */
export default class GraphicsSettings {
  constructor(graphics, options = {}) {
    this.graphics = graphics; this.options = options; this.disposed = false;
    const dom = options.document || options.ctx && options.ctx.document || (typeof document === 'undefined' ? null : document);
    if (!dom || !dom.createElement) return;
    const node = (tag, text, parent) => { const element = dom.createElement(tag); if (text !== undefined) element.textContent = text; if (parent) parent.appendChild(element); return element; };
    this.root = node('section'); this.root.className = 'graphics-settings' + (options.compact ? ' graphics-settings-compact' : ''); this.root.setAttribute('aria-label', 'Gráficos de este dispositivo');
    const field = node('label', undefined, this.root), id = 'graphics-mode-' + (++nextGraphicsSettings); field.setAttribute('for', id);
    node('span', 'Calidad gráfica de este dispositivo', field); this.select = node('select', undefined, field); this.select.id = id; this.select.setAttribute('aria-label', 'Calidad gráfica de este dispositivo');
    MODES.forEach(([value, text]) => { const option = node('option', text, this.select); option.value = value; });
    this.select.disabled = !graphics || typeof graphics.setMode !== 'function';
    this.change = () => { if (this.graphics && this.graphics.setMode) { this.graphics.setMode(this.select.value); this.update(); } }; this.select.addEventListener('change', this.change);
    this.effective = node('output', '', this.root); this.effective.className = 'graphics-settings-effective';
    const details = node('details', undefined, this.root); node('summary', 'Resolución y recursos', details); const list = node('dl', undefined, details);
    this.values = {};
    [['target', 'Objetivo'], ['resolution', 'Resolución de renderizado'], ['memory', 'Memoria gráfica estimada'], ['timing', 'Rendimiento medido']].forEach(([key, title]) => { node('dt', title, list); this.values[key] = node('dd', '—', list); });
    if (!options.compact) { const note = node('p', 'Automático adapta la imagen al dispositivo. Esta preferencia se guarda aquí y conserva el escenario.', this.root); note.className = 'graphics-settings-note'; }
    const ai = options.ctx && options.ctx.materialAI;
    if (ai) {
      const section = node('section', undefined, this.root); section.className = 'graphics-ai';
      node('strong', 'IA integrada · materiales', section);
      this.aiStatus = node('output', '', section);
      const actions = node('div', undefined, section); actions.className = 'graphics-ai-actions';
      this.aiEnhance = node('button', 'Mejorar concreto con IA', actions); this.aiEnhance.type = 'button';
      this.aiRestore = node('button', 'Restaurar detalle', actions); this.aiRestore.type = 'button';
      this.aiEnhance.onclick = () => ai.enhance(); this.aiRestore.onclick = () => ai.restore();
      node('p', 'Procesa el detalle de este nivel en el navegador antes de entrar en VR. El visor utiliza la textura terminada.', section);
      this.unsubscribeAI = ai.subscribe(state => {
        const labels = {available: 'Lista para procesar', working: 'Procesando en este navegador…', ready: 'Detalle neuronal aplicado', paused: 'Procesamiento pausado', fallback: 'Se conserva el detalle original'};
        this.aiStatus.textContent = state.reason === 'vr' ? 'VR activa · procesamiento pausado' : !state.active ? 'Disponible en niveles con concreto generado' : (labels[state.status] || 'Lista para procesar') + (state.applied && state.result ? ' · ' + state.result.width + ' × ' + state.result.height + ' px' : '');
        this.aiEnhance.disabled = !state.canEnhance; this.aiRestore.disabled = !state.applied && state.status !== 'working';
      });
    }
    this.unsubscribe = graphics && graphics.subscribe ? graphics.subscribe(state => { if (this.visible()) this.update(state); }) : null; this.update();
  }
  visible() { for (let node = this.root; node; node = node.parentNode) if (node.hidden) return false; return !this.disposed; }
  mount(parent) { if (this.root && parent && !this.disposed) { parent.appendChild(this.root); this.update(); } return this; }
  update(state) {
    if (!this.root || this.disposed) return;
    const graphics = this.graphics; state = state || graphics && (graphics.getState ? graphics.getState() : graphics.getStats && graphics.getStats()) || {};
    const mode = graphics && graphics.getMode ? graphics.getMode() : state.mode || 'auto'; this.select.value = mode;
    const status = {'warming-up': ' · Evaluando rendimiento', pressure: ' · Ajustando al dispositivo', paused: ' · Pausado', 'context-lost': ' · Recuperando gráficos'}[state.status] || '';
    const effective = state.effectiveProfile || state.tier, adapted = mode !== 'auto' && effective && effective !== mode && !status ? ' · Adaptado al rendimiento disponible' : '';
    this.effective.textContent = 'Perfil efectivo: ' + label(effective) + status + adapted;
    this.values.target.textContent = finite(state.targetFPS) ? Math.round(state.targetFPS) + ' FPS' : '—';
    const canvas = this.options.ctx && this.options.ctx.renderer && this.options.ctx.renderer.domElement, scale = finite(state.renderScale) ? Math.round(state.renderScale * 100) + '%' : '—';
    this.values.resolution.textContent = state.xr ? 'Gestionada por el visor XR' : canvas && canvas.width > 0 && canvas.height > 0 ? canvas.width + ' × ' + canvas.height + ' px · ' + scale : scale;
    const performance = this.options.ctx && this.options.ctx.editor && this.options.ctx.editor.performance, resources = !finite(state.estimatedMemoryMB) && performance && performance.getStats ? performance.getStats() : null;
    const memory = finite(state.estimatedMemoryMB) ? state.estimatedMemoryMB : resources && finite(resources.gpuResourceBytesEstimated) ? resources.gpuResourceBytesEstimated / (1024 * 1024) : null;
    this.values.memory.textContent = finite(memory) ? Math.round(memory) + ' MB (estimación)' : 'Sin estimación disponible';
    this.values.timing.textContent = finite(state.fps) ? Math.round(state.fps) + ' FPS' + (finite(state.frameMs) ? ' · ' + state.frameMs.toFixed(1) + ' ms/fotograma' : '') : 'Evaluando…';
  }
  dispose() { if (this.disposed) return; this.disposed = true; if (this.unsubscribe) this.unsubscribe(); if (this.unsubscribeAI) this.unsubscribeAI(); if (this.select) this.select.removeEventListener('change', this.change); if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root); }
}
