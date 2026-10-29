import * as THREE from 'three';
import schema from '../../../../modules/logistica-industrial/contracts/behaviors.js';

const MACHINE_TYPES = ['source', 'conveyor', 'processor', 'palletQueue'];
export function monitorTarget(document, object, roomId) {
  const root = document.getRoot(roomId);
  for (let node = object; node && node !== root; node = node.parent) {
    const values = document.getBehaviors(node);
    if (values.some(value => MACHINE_TYPES.includes(value.type))) return node;
    const control = values.find(value => ['lineMonitor', 'control'].includes(value.type));
    if (control && control.targetId) { const target = document.getObject(control.targetId); if (target && document.getObjects(roomId).includes(target) && document.getBehaviors(target).some(value => MACHINE_TYPES.includes(value.type))) return target; }
  }
  return null;
}
export function createLineMonitor(document, roomId, target, options = {}) {
  const targetObject = monitorTarget(document, target, roomId);
  const monitor = document.addPrimitive(roomId, 'box', '#142433');
  document.setProperty(monitor, 'name', options.name || 'Monitor de producción');
  document.setTransform(monitor, {position: options.position || [0, 1.9, 2], scale: [3, 1.6875, .09]});
  document.setBehaviors(monitor, [Object.assign(schema.defaultBehavior('lineMonitor'), {targetId: targetObject ? targetObject.userData.editorId : '', scope: options.scope || 'line', title: String(options.title || options.name || 'Monitor de producción').slice(0, 120)})]);
  return monitor;
}
/** A normal editor object, with an explicit local-machine binding dialog. */
export default class MonitorWidgetTools {
  constructor(editor) { this.editor = editor; this.dialog = null; }
  add() {
    const e = this.editor;
    if (!e.active || e.ctx.vrMode) return;
    return e.perform(() => {
      const target = monitorTarget(e.document, e.selected, e.roomId), position = e.orbit.target.clone();
      const root = e.document.getRoot(e.roomId); root.updateWorldMatrix(true, false); root.worldToLocal(position); position.y = 1.9;
      if (target) { target.updateWorldMatrix(true, false); position.copy(root.worldToLocal(target.getWorldPosition(new THREE.Vector3()))).add(new THREE.Vector3(0, .9, 2.2)); }
      const own = !e.document.transaction; let object;
      if (own) e.document.begin();
      try { object = createLineMonitor(e.document, e.roomId, target, {position: position.toArray()}); if (own) e.document.commit(); }
      catch (error) { if (own) e.document.cancel(); throw error; }
      e.select(object); this.openBinding(object); return object;
    });
  }
  openBinding(object = this.editor.selected) {
    const e = this.editor, config = object && e.document.getBehaviors(object).find(value => value.type === 'lineMonitor');
    if (!config || !e.active || e.ctx.vrMode) return;
    this.close(); const dom = e.ctx.document || document, roomId = e.roomId, generation = e.projectGeneration; this.returnFocus = dom.activeElement;
    const node = (tag, text, parent) => { const value = dom.createElement(tag); if (text !== undefined) value.textContent = text; if (parent) parent.appendChild(value); return value; };
    const layer = this.dialog = node('div', undefined, dom.body); layer.className = 'scene-guide-overlay'; layer.setAttribute('role', 'dialog'); layer.setAttribute('aria-modal', 'true'); layer.setAttribute('aria-label', 'Vincular monitor');
    const form = node('form', undefined, layer); form.className = 'scene-guide-card scene-monitor-card'; node('h2', 'Vincular monitor', form);
    node('p', 'Selecciona un equipo. El alcance Línea incluye sus equipos conectados y conserva las funciones del monitor en escritorio y VR.', form);
    const label = node('label', 'Equipo principal', form), select = node('select', undefined, label), empty = node('option', 'Sin vínculo', select); empty.value = '';
    e.document.getObjects(roomId).filter(target => e.document.getBehaviors(target).some(value => MACHINE_TYPES.includes(value.type))).forEach(target => { const option = node('option', target.name || target.userData.editorId, select); option.value = target.userData.editorId; }); select.value = config.targetId;
    const scopeLabel = node('label', 'Alcance', form), scope = node('select', undefined, scopeLabel); [['line', 'Toda la línea conectada'], ['segment', 'Tramo de transportadores'], ['module', 'Sólo este equipo']].forEach(([value, text]) => { const option = node('option', text, scope); option.value = value; }); scope.value = config.scope;
    const titleLabel = node('label', 'Título', form), title = node('input', undefined, titleLabel); title.value = config.title; title.maxLength = 120;
    const error = node('p', '', form); error.className = 'scene-guide-error'; error.setAttribute('role', 'alert');
    const actions = node('div', undefined, form); actions.className = 'scene-guide-actions'; const cancel = node('button', 'Cancelar', actions); cancel.type = 'button'; cancel.onclick = () => this.close(); const apply = node('button', 'Aplicar vínculo', actions); apply.type = 'submit'; apply.className = 'primary';
    form.onsubmit = event => { event.preventDefault(); if (generation !== e.projectGeneration || roomId !== e.roomId || !e.active || e.document.getObject(object.userData.editorId) !== object) { error.textContent = 'El nivel cambió. Vuelve a seleccionar el monitor.'; return; }
      if (select.value && !e.document.getObjects(roomId).some(target => target.userData.editorId === select.value && e.document.getBehaviors(target).some(value => MACHINE_TYPES.includes(value.type)))) { error.textContent = 'Selecciona un equipo del nivel actual.'; return; }
      e.perform(() => { e.document.setBehaviors(object, e.document.getBehaviors(object).map(value => value.type === 'lineMonitor' ? Object.assign({}, value, {targetId: select.value, scope: scope.value, title: title.value.trim() || 'Monitor de producción'}) : value)); if (e.lineMonitors) e.lineMonitors.invalidate(); this.close(); return object; }); };
    layer.onkeydown = event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); this.close(); } if (event.key === 'Tab') { const focusable = Array.from(layer.querySelectorAll('button,input,select')).filter(value => !value.disabled), first = focusable[0], last = focusable[focusable.length - 1]; if (event.shiftKey && dom.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && dom.activeElement === last) { event.preventDefault(); first.focus(); } } }; select.focus();
  }
  close() { if (this.dialog && this.dialog.parentNode) this.dialog.parentNode.removeChild(this.dialog); this.dialog = null; if (this.returnFocus && this.returnFocus.focus) this.returnFocus.focus(); this.returnFocus = null; }
  dispose() { this.close(); }
}
