import guidePlan from '../../shared/guided-scene-plan.js';
import {buildGuidedScene, guidedPlanDiagram} from './GuidedSceneBuilder.js';

const EXAMPLE = 'Quiero un modelo con 3 transportadores de rodillos que hagan una L, ingresen 3 tipos de productos y un monitor de información.';
/** Conversational, local catalogue guide. It deliberately exposes the parsed
 * plan for review instead of representing a keyword parser as a language model. */
export default class SceneGuideChat {
  constructor(editor, options = {}) { this.editor = editor; this.options = options; this.layer = null; this.mode = 'assisted'; this.plan = guidePlan.planFromInstruction(EXAMPLE); }
  open() {
    const e = this.editor; if (!e.active || e.ctx.vrMode || e.loadingProject) return;
    this.close(); const dom = e.ctx.document || document, roomId = e.roomId, generation = e.projectGeneration;
    this.origin = {roomId, generation}; this.returnFocus = dom.activeElement;
    const node = this.node = (tag, text, parent) => { const value = dom.createElement(tag); if (text !== undefined) value.textContent = text; if (parent) parent.appendChild(value); return value; };
    const layer = this.layer = node('div', undefined, dom.body); layer.className = 'scene-guide-overlay'; layer.setAttribute('role', 'dialog'); layer.setAttribute('aria-modal', 'true'); layer.setAttribute('aria-label', 'Guía de construcción de escenarios');
    const card = node('section', undefined, layer); card.className = 'scene-guide-card';
    const header = node('div', undefined, card); header.className = 'scene-guide-header'; node('h2', 'Construye tu escenario', header);
    const close = node('button', 'Cerrar', header); close.type = 'button'; close.onclick = () => this.close();
    node('p', 'Describe una línea o configura sus parámetros. La guía local utiliza los equipos precargados y muestra la propuesta antes de crearla.', card);
    const modes = node('div', undefined, card); modes.className = 'scene-guide-modes';
    this.assisted = node('button', 'Construcción asistida', modes); this.manual = node('button', 'Configurar a mi manera', modes);
    this.assisted.type = this.manual.type = 'button'; this.assisted.onclick = () => this.setMode('assisted'); this.manual.onclick = () => this.setMode('manual');
    const grid = node('div', undefined, card); grid.className = 'scene-guide-grid'; const left = node('section', undefined, grid), right = node('section', undefined, grid);
    this.chat = node('div', undefined, left); const label = node('label', 'Describe lo que necesitas', this.chat); this.prompt = node('textarea', undefined, label); this.prompt.rows = 4; this.prompt.maxLength = 2000; this.prompt.value = this.lastPrompt || EXAMPLE;
    const interpret = node('button', 'Interpretar instrucciones', this.chat); interpret.type = 'button'; interpret.onclick = () => this.interpret();
    this.log = node('div', undefined, this.chat); this.log.className = 'scene-guide-log'; this.log.setAttribute('role', 'log'); this.log.setAttribute('aria-live', 'polite');
    node('h3', 'Propuesta y configuración', left); this.fields = {};
    const form = node('div', undefined, left); form.className = 'scene-guide-fields';
    const field = (key, labelText, choices, type = 'number') => { const label = node('label', labelText, form), control = node(choices ? 'select' : 'input', undefined, label); if (choices) Object.entries(choices).forEach(([value, text]) => { const option = node('option', text, control); option.value = value; }); else { control.type = type; if (type === 'number') { control.step = ['length', 'width', 'speed', 'processTime', 'setupTime'].includes(key) ? '.1' : '1'; control.min = key === 'quantity' || key === 'setupTime' ? '0' : key === 'speed' ? '.1' : '1'; } } this.fields[key] = control; control.onchange = () => this.readFields(); return control; };
    field('title', 'Nombre de la línea', null, 'text').maxLength = 120;
    field('shape', 'Forma de la línea', guidePlan.SHAPES); field('technology', 'Superficie de transporte', guidePlan.TECHNOLOGIES); field('turn', 'Esquina de la L', guidePlan.TURN_TYPES);
    field('conveyorCount', 'Módulos de transporte').max = '12'; field('productCount', 'Perfiles de productos').max = '8';
    field('quantity', 'Cargas totales (0 = continuo)').max = '200'; field('length', 'Longitud de cada recta (m)').max = '6'; field('speed', 'Velocidad (m/s)').max = '1.5';
    field('routing', 'Clasificación en T', {color: 'Color', quality: 'Calidad simulada', productType: 'Tipo de producto', percentage: 'Reparto 50 / 50', alternate: 'Alternar salidas'});
    field('processor', 'Proceso intermedio', {'': 'Sin procesador', process: 'Proceso temporizado', combiner: 'Combiner', separator: 'Separator'});
    const check = (key, text, checked) => { const label = node('label', undefined, left); label.className = 'scene-guide-check'; const input = node('input', undefined, label); input.type = 'checkbox'; input.checked = checked; node('span', text, label); input.onchange = () => this.readFields(); this.fields[key] = input; };
    check('automatic', 'Funcionamiento automático', this.plan.automatic); check('monitor', 'Incluir monitor vinculado a toda la línea', this.plan.monitor);
    const root = e.document.getRoot(roomId), hasMachines = e.document.getObjects(roomId).some(object => { for (let node = object; node && node !== root; node = node.parent) if (!node.visible) return false; return e.document.getBehaviors(object).some(value => ['source', 'conveyor', 'processor', 'palletQueue'].includes(value.type)); });
    check('environment', 'Preparar entorno CEDI para este nivel vacío', !hasMachines); this.fields.environment.disabled = hasMachines;
    node('h3', 'Esquema de la propuesta', right); this.preview = node('div', undefined, right); this.preview.className = 'scene-guide-preview';
    this.summary = node('p', '', right); this.summary.className = 'scene-guide-summary'; this.warnings = node('ul', undefined, right);
    node('p', 'La L rectangular utiliza una transferencia entre rodillos; la alternativa curva utiliza un arco continuo. Las conexiones, Source y almacenamiento se crean con componentes funcionales.', right);
    node('p', 'Se añadirá la propuesta al nivel actual. Puedes deshacer la construcción completa con una sola acción.', right);
    this.error = node('p', '', card); this.error.className = 'scene-guide-error'; this.error.setAttribute('role', 'alert');
    const actions = node('div', undefined, card); actions.className = 'scene-guide-actions'; const cancel = node('button', 'Cancelar', actions); cancel.type = 'button'; cancel.onclick = () => this.close(); this.build = node('button', 'Crear propuesta en este nivel', actions); this.build.type = 'button'; this.build.className = 'primary'; this.build.onclick = () => this.construct();
    layer.onkeydown = event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); this.close(); } if (event.key === 'Tab') { const focusable = Array.from(layer.querySelectorAll('button,input,select,textarea')).filter(value => { for (let node = value; node && node !== layer; node = node.parentNode) if (node.hidden || node.disabled) return false; return true; }); const first = focusable[0], last = focusable[focusable.length - 1]; if (event.shiftKey && dom.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && dom.activeElement === last) { event.preventDefault(); first.focus(); } } };
    this.fillFields(); this.setMode(this.mode); this.refresh(); (this.mode === 'assisted' ? this.prompt : this.fields.title).focus();
  }
  setMode(mode) { this.mode = mode === 'manual' ? 'manual' : 'assisted'; if (!this.layer) return; this.chat.hidden = this.mode !== 'assisted'; this.assisted.setAttribute('aria-pressed', String(this.mode === 'assisted')); this.manual.setAttribute('aria-pressed', String(this.mode === 'manual')); if (this.mode === 'manual') { this.plan.understood = true; this.refresh(); } }
  fillFields() { Object.entries(this.fields).forEach(([key, control]) => { if (key === 'environment') return; if (control.type === 'checkbox') control.checked = this.plan[key]; else control.value = this.plan[key] === undefined ? '' : this.plan[key]; }); }
  readFields() { const values = Object.assign({}, this.plan, {understood: true}); Object.entries(this.fields).forEach(([key, control]) => { if (key === 'environment') return; values[key] = control.type === 'checkbox' ? control.checked : control.type === 'number' ? Number(control.value) : control.value; }); this.plan = guidePlan.normalizePlan(values); this.fillFields(); this.refresh(); }
  interpret() { this.lastPrompt = this.prompt.value; this.plan = guidePlan.planFromInstruction(this.lastPrompt); this.fillFields(); this.log.textContent = ''; this.node('p', this.lastPrompt, this.log); this.node('p', this.plan.understood ? 'Entendido. Revisa las cantidades, la esquina y el modo de trabajo de la propuesta.' : 'Puedo construir rectas, L, T y uniones Y con equipos del catálogo. Describe una de esas líneas o configura los parámetros.', this.log); this.refresh(); }
  refresh() { if (!this.layer) return; this.preview.innerHTML = guidedPlanDiagram(this.plan); this.summary.textContent = guidePlan.planSummary(this.plan); this.warnings.textContent = ''; this.plan.warnings.forEach(value => this.node('li', value, this.warnings)); this.build.disabled = !this.plan.understood; }
  async construct() {
    const e = this.editor; this.error.textContent = '';
    if (!e.active || e.ctx.vrMode || e.loadingProject || e.projectGeneration !== this.origin.generation || e.roomId !== this.origin.roomId) { this.error.textContent = 'El proyecto o nivel cambió. Abre de nuevo la guía en el destino.'; return; }
    this.build.disabled = true;
    try {
      const result = await e.perform(() => { const built = buildGuidedScene(e.document, e.roomId, this.plan, {scene: e.hooks.renderScene, environment: this.fields.environment.checked}); e.select(built.controller); return built; });
      if (!result || !result.controller) throw new Error('No se pudo crear la propuesta. Revisa la operación y vuelve a intentarlo.');
      this.close(); if (e.focus) e.focus(); e.toast('Línea creada con Source, conexiones y almacenamiento. Pulsa Probar para operarla.');
    } catch (error) { if (this.error) this.error.textContent = error.message || 'No se pudo crear la propuesta.'; if (this.build) this.build.disabled = false; }
  }
  close() { if (this.layer && this.layer.parentNode) this.layer.parentNode.removeChild(this.layer); this.layer = null; if (this.returnFocus && this.returnFocus.focus) this.returnFocus.focus(); this.returnFocus = null; }
  dispose() { this.close(); }
}
