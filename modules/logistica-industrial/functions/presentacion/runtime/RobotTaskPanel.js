import * as THREE from 'three';
import robots from '../../robots/schema/robots.js';
import kinematics from '../../robots/schema/robot-kinematics.js';
import tasks from '../../robots/schema/robot-task-program.js';
import products from '../../flujo-materiales/schema/productSources.js';

export const ROBOT_TASK_STYLE = `.equipment-study .robot-task-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.equipment-study .robot-task-fields label{display:flex;flex-direction:column;gap:4px;font-size:12px}.equipment-study .robot-task-fields input,.equipment-study .robot-task-fields select{box-sizing:border-box;width:100%;min-width:0;max-width:100%}.equipment-study .robot-task-fields input[type=checkbox]{width:18px;height:18px;margin:0;align-self:flex-start}.equipment-study .robot-task-coordinates{font-size:12px;line-height:1.5;border-left:3px solid #76d6cf;padding:8px;margin:10px 0;background:#213844}.equipment-study .robot-task-points{width:100%;border-collapse:collapse;font-size:12px;margin:10px 0}.equipment-study .robot-task-points td,.equipment-study .robot-task-points th{padding:4px;text-align:left}.equipment-study .robot-task-points input{width:100%;min-width:48px}.equipment-study .robot-task-points button{padding:6px}.equipment-study .robot-task-actions{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}.equipment-study .robot-task-timeline{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin:10px 0;padding:0;list-style:none}.equipment-study .robot-task-timeline li{border:1px solid #405b68;border-radius:6px;padding:7px;font-size:11px}.equipment-study .robot-task-timeline li[data-current=true]{border-color:#9be2cf;background:#285d58}.equipment-study .robot-task-map{width:100%;height:220px;display:block;border:1px solid #405b68;border-radius:8px;background:#10232d}.equipment-study .robot-task-status{min-height:30px;font-size:12px;line-height:1.5;color:#c5e9e1}.equipment-study .robot-task-code{width:100%;height:240px;font:12px/1.45 ui-monospace,monospace}.equipment-study .robot-task-telemetry{font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap}@media(max-width:520px){.equipment-study .robot-task-fields{grid-template-columns:1fr}.equipment-study .robot-task-timeline{grid-template-columns:repeat(2,minmax(0,1fr))}}`;
const node = (d, tag, text, cls) => { const n = d.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
const xyz = value => ({x: value.x, y: value.y, z: value.z});
const format = p => ['x', 'y', 'z'].map(key => key.toUpperCase() + ' ' + p[key].toFixed(3)).join(' · ');

/** Robot-local task authoring over the existing controller. Preview owns only
 * its numeric poses and the viewer's labelled disposable study geometry. */
export default class RobotTaskPanel {
  constructor(viewer) { this.viewer = viewer; this.document = viewer.document; this.scope = viewer.scope; this.config = this.scope.description.config; this.disposed = false; this.playing = false; this.time = 0; this.program = this.config.taskProgramJson ? tasks.normalize(this.config.taskProgramJson) : tasks.defaults(this.config); }
  current() { return !this.disposed && this.viewer.scope === this.scope && this.viewer.current(); }
  editable() { return this.current() && this.viewer.editable(); }
  button(parent, text, callback) { const b = node(this.document, 'button', text); b.type = 'button'; b.addEventListener('click', callback); parent.appendChild(b); return b; }
  text(parent, value, cls) { parent.appendChild(node(this.document, 'p', value, cls)); }
  field(parent, title, key, options = {}) {
    const d = this.document, label = node(d, 'label', title), input = node(d, options.values ? 'select' : 'input');
    input.setAttribute('data-robot-task-field', key);
    if (options.values) for (const [value, title] of options.values) { const n = node(d, 'option', title); n.value = value; input.appendChild(n); }
    else { input.type = options.type || 'number'; if (options.min !== undefined) input.min = String(options.min); if (options.max !== undefined) input.max = String(options.max); if (options.step !== undefined) input.step = String(options.step); }
    if (input.type === 'checkbox') input.checked = !!this.program[key]; else input.value = String(this.program[key] === undefined ? '' : this.program[key]);
    input.addEventListener('input', () => this.invalidate()); input.addEventListener('change', () => { this.invalidate(); if (key === 'sourceId' || key === 'outputId') this.refreshEndpoints(); });
    label.appendChild(input); parent.appendChild(label); this.fields.set(key, input); return input;
  }
  stations(outgoing) {
    const v = this.viewer, room = v.editor ? v.editor.roomId : v.documentModel.roomId || 'hall';
    return (v.documentModel.getObjects ? v.documentModel.getObjects(room) : []).filter(object => {
      if (object === this.scope.object || !object.visible || object.userData.editorRuntimeHelper) return false;
      return this.behaviors(object).some(b => (outgoing ? ['source', 'processor', 'conveyor', 'palletQueue'] : ['source', 'processor', 'conveyor', 'palletQueue', 'product']).includes(b.type));
    }).slice(0, 200);
  }
  behaviors(object) { try { return this.viewer.documentModel.getBehaviors(object) || []; } catch (_) { return []; } }
  mount(host) {
    const d = this.document; this.host = host; this.fields = new Map();
    host.appendChild(node(d, 'h2', 'Programar una tarea del robot'));
    this.text(host, 'Define cómo recoger, trasladar y entregar una carga entre dos equipos del nivel. X/Y/Z se expresan en metros respecto a la base del robot; Y es altura.');
    if (!tasks.compatible(this.config)) { this.text(host, 'Este editor de tareas corresponde a robots fijos de manipulación. Esta variante conserva su controlador especializado de transporte o proceso.', 'study-note'); return this; }
    const form = node(d, 'div', undefined, 'robot-task-fields');
    this.field(form, 'Nombre de la tarea', 'name', {type: 'text'});
    this.enabled = this.field(form, 'Usar esta tarea al iniciar un ciclo', 'enabled', {type: 'checkbox'}); this.enabled.checked = !!this.config.taskEnabled;
    this.field(form, '1 · Equipo donde recoger', 'sourceId', {values: [['', 'Seleccionar origen'], ...this.stations(false).map(o => [o.userData.editorId, o.name || o.userData.editorId])]});
    this.field(form, '2 · Equipo donde depositar', 'outputId', {values: [['', 'Seleccionar receptor'], ...this.stations(true).map(o => [o.userData.editorId, o.name || o.userData.editorId])]});
    this.field(form, 'Velocidad TCP · m/s', 'speed', {min: .05, max: 3, step: .05});
    this.field(form, 'Altura libre de aproximación · m', 'clearance', {min: .02, max: 1, step: .01});
    this.field(form, 'Pausa al tomar · s', 'gripWait', {min: 0, max: 10, step: .1});
    this.field(form, 'Pausa antes de entregar · s', 'releaseWait', {min: 0, max: 10, step: .1});
    this.field(form, 'Repetir ciclos mientras exista carga', 'repeat', {type: 'checkbox'}); host.appendChild(form);
    this.coordinates = node(d, 'p', '', 'robot-task-coordinates'); host.appendChild(this.coordinates);
    this.text(host, 'Los contactos de recogida y depósito los calcula la estación y la carga reales. Así se conserva el apoyo, la identidad y la propiedad del producto. Los puntos siguientes controlan el traslado intermedio.', 'study-meta');
    host.appendChild(node(d, 'h3', 'Trayectoria de traslado · puntos TCP locales'));
    this.table = node(d, 'table', undefined, 'robot-task-points'); host.appendChild(this.table); this.pointRows = []; this.fillPoints(this.program.via);
    this.addPoint = this.button(host, '+ Añadir punto de paso', () => { if (this.pointRows.length >= tasks.MAX_POINTS) return; this.addPointRow({x: .6, y: this.config.baseHeight + .6, z: 0}); this.invalidate(); });
    const back = node(d, 'details'), summary = node(d, 'summary', 'Retorno · origen articular o coordenada TCP'); back.appendChild(summary);
    this.customReturn = node(d, 'input'); this.customReturn.type = 'checkbox'; this.customReturn.checked = !!this.program.returnPoint;
    const returnLabel = node(d, 'label', ' Volver a una coordenada personalizada'); returnLabel.appendChild(this.customReturn); back.appendChild(returnLabel);
    this.returnInputs = this.coordinateInputs(back, this.program.returnPoint || xyz(kinematics.homePose(this.config).tcp));
    this.customReturn.addEventListener('change', () => this.invalidate()); host.appendChild(back);
    const actions = node(d, 'div', undefined, 'robot-task-actions'); this.validateButton = this.button(actions, 'Validar y previsualizar', () => this.validate());
    this.playButton = this.button(actions, '▶ Simular ciclo', () => { if (!this.preview && !this.validate()) return; this.playing = true; this.playButton.textContent = '▶ Reproduciendo'; });
    this.pauseButton = this.button(actions, 'Ⅱ Pausar', () => { this.playing = false; this.playButton.textContent = '▶ Continuar'; });
    this.stepButton = this.button(actions, '▸ Paso siguiente', () => this.nextStage());
    this.stopButton = this.button(actions, '■ Restablecer vista', () => this.stop()); host.appendChild(actions);
    this.map = node(d, 'canvas', undefined, 'robot-task-map'); this.map.width = 760; this.map.height = 260; this.map.setAttribute('aria-label', 'Trayectoria programada: planta XZ y alzado XY'); host.appendChild(this.map);
    this.timeline = node(d, 'ol', undefined, 'robot-task-timeline'); host.appendChild(this.timeline);
    this.telemetry = node(d, 'pre', '', 'robot-task-telemetry'); host.appendChild(this.telemetry);
    this.status = node(d, 'p', 'Completa las conexiones y valida para simular sin modificar el escenario.', 'robot-task-status'); this.status.setAttribute('role', 'status'); host.appendChild(this.status);
    this.text(host, 'Previsualización cinemática aislada: muestra el orden, TCP, ejes y una carga de demostración. El controlador del escenario conserva las comprobaciones de colisión, alcance, capacidad y entrega; no se transfiere inventario desde esta ficha.', 'study-note');
    const codeDetails = node(d, 'details'); codeDetails.appendChild(node(d, 'summary', 'Código JSON de la tarea · importar y exportar parámetros'));
    this.code = node(d, 'textarea', undefined, 'robot-task-code'); this.code.value = JSON.stringify(this.program, null, 2); this.code.maxLength = tasks.MAX_JSON; this.code.readOnly = !this.editable(); this.code.setAttribute('aria-label', 'Programa declarativo del robot');
    this.code.addEventListener('input', () => this.invalidate()); codeDetails.appendChild(this.code);
    this.button(codeDetails, 'Cargar JSON en los parámetros', () => { try { this.load(tasks.normalize(this.code.value)); this.status.textContent = 'JSON cargado. Valida el recorrido antes de aplicarlo.'; } catch (error) { this.invalidate(); this.status.textContent = error.message; } });
    this.button(codeDetails, 'Actualizar JSON desde parámetros', () => { try { this.code.value = JSON.stringify(this.read(), null, 2); this.status.textContent = 'Código actualizado con los parámetros visibles.'; } catch (error) { this.status.textContent = error.message; } }); host.appendChild(codeDetails);
    this.applyButton = this.button(host, 'Guardar tarea en este robot', () => this.apply()); this.applyButton.disabled = true;
    if (!this.editable()) this.text(host, 'Vista pública de aprendizaje: puedes previsualizar; guardar y activar la tarea requiere abrir un proyecto con permiso de edición.', 'study-note');
    this.refreshEndpoints(); return this;
  }
  coordinateInputs(parent, value) { return ['x', 'y', 'z'].map(key => { const label = node(this.document, 'label', key.toUpperCase()), input = node(this.document, 'input'); input.type = 'number'; input.step = '.01'; input.min = key === 'y' ? '-5' : '-20'; input.max = '20'; input.value = String(value[key]); input.addEventListener('input', () => this.invalidate()); label.appendChild(input); parent.appendChild(label); return input; }); }
  fillPoints(points) { this.table.textContent = ''; this.pointRows = []; const head = node(this.document, 'tr'); for (const label of ['Paso', 'X · m', 'Y · m', 'Z · m', '']) head.appendChild(node(this.document, 'th', label)); this.table.appendChild(head); points.forEach(p => this.addPointRow(p)); }
  addPointRow(point) { const row = node(this.document, 'tr'), item = {row, inputs: []}; row.appendChild(node(this.document, 'td', String(this.pointRows.length + 1))); for (const key of ['x', 'y', 'z']) { const td = node(this.document, 'td'), input = node(this.document, 'input'); input.type = 'number'; input.step = '.01'; input.value = String(point[key]); input.setAttribute('aria-label', 'Punto ' + (this.pointRows.length + 1) + ' ' + key.toUpperCase()); input.addEventListener('input', () => this.invalidate()); td.appendChild(input); row.appendChild(td); item.inputs.push(input); } const td = node(this.document, 'td'); this.button(td, 'Quitar', () => { this.pointRows = this.pointRows.filter(value => value !== item); row.remove(); this.invalidate(); }); row.appendChild(td); this.table.appendChild(row); this.pointRows.push(item); }
  read() { const p = {version: 1}; for (const [key, input] of this.fields) if (key !== 'enabled') p[key] = input.type === 'checkbox' ? !!input.checked : ['speed', 'clearance', 'gripWait', 'releaseWait'].includes(key) ? Number(input.value) : input.value; p.via = this.pointRows.map(row => Object.fromEntries(['x', 'y', 'z'].map((key, i) => [key, Number(row.inputs[i].value)]))); p.returnPoint = this.customReturn.checked ? Object.fromEntries(['x', 'y', 'z'].map((key, i) => [key, Number(this.returnInputs[i].value)])) : null; return tasks.normalize(p); }
  load(program) { this.stop(); this.program = program; for (const [key, input] of this.fields) if (key !== 'enabled') { if (input.type === 'checkbox') input.checked = program[key]; else input.value = String(program[key]); } this.fillPoints(program.via); this.customReturn.checked = !!program.returnPoint; const back = program.returnPoint || xyz(kinematics.homePose(this.config).tcp); this.returnInputs.forEach((input, i) => input.value = String(back[['x', 'y', 'z'][i]])); this.code.value = JSON.stringify(program, null, 2); this.preview = null; this.applyButton.disabled = true; this.refreshEndpoints(); }
  invalidate() { this.preview = null; this.playing = false; if (this.applyButton) this.applyButton.disabled = true; if (this.status) this.status.textContent = 'Parámetros modificados. Valida de nuevo el recorrido.'; if (this.viewer.clearTaskPreview) this.viewer.clearTaskPreview(); }
  findObject(id) { return this.viewer.documentModel.getObject ? this.viewer.documentModel.getObject(id) : this.stations(false).find(o => o.userData.editorId === id); }
  endpoints(program) {
    const input = this.findObject(program.sourceId), output = this.findObject(program.outputId); if (!input || !output || input === output || !this.stations(false).includes(input) || !this.stations(true).includes(output)) throw new Error('Selecciona dos equipos distintos del nivel actual.');
    const object = this.scope.object; object.updateWorldMatrix(true, true); const inverse = new THREE.Matrix4().getInverse(object.matrixWorld), sim = this.viewer.simulation, records = sim && sim.records;
    const r = records && records.get(this.scope.id), source = records && records.get(program.sourceId), target = records && records.get(program.outputId);
    const candidates = source && source.components, inventory = candidates && (candidates.source || candidates.processor && candidates.processor.output || candidates.palletQueue);
    const product = inventory && inventory.queue && inventory.queue[0] && inventory.queue[0].product || candidates && candidates.conveyor && candidates.conveyor.packages.map(p => p.product).filter(Boolean).sort((a, b) => (b.item.offset || 0) - (a.item.offset || 0))[0] || candidates && candidates.product && sim.products.get(input);
    const sourceConfig = this.behaviors(input).find(c => c.type === 'source'), spec = sourceConfig && products.specAt(sourceConfig, 0), size = product ? product.bounds.getSize(new THREE.Vector3()).multiply(product.scale) : spec ? products.loadSize(spec, sourceConfig) : {width: .25, height: .25, depth: .25};
    const payloadSize = product ? [size.x, size.y, size.z] : [size.width, size.height, size.depth], height = payloadSize[1], depth = kinematics.getToolContactDepth(this.config, height), under = ['fork', 'platform'].includes(this.config.tool);
    const bounds = product ? product.bounds : new THREE.Box3(new THREE.Vector3(-payloadSize[0] / 2, 0, -payloadSize[2] / 2), new THREE.Vector3(payloadSize[0] / 2, height, payloadSize[2] / 2)), scale = product ? product.scale : new THREE.Vector3(1, 1, 1);
    const contact = matrix => new THREE.Vector3((bounds.min.x + bounds.max.x) / 2, under ? bounds.min.y : bounds.max.y - depth / Math.max(.000001, scale.y), (bounds.min.z + bounds.max.z) / 2).applyMatrix4(matrix).applyMatrix4(inverse);
    const station = (node, record, outgoing) => {
      node.updateWorldMatrix(true, true);
      if (record && sim.sourceRuntime && (record.components.source || record.components.processor)) return sim.sourceRuntime.frontMatrix(record, bounds, scale, record.components.processor && (outgoing ? record.components.processor.output.position : record.components.processor.input.position));
      if (record && record.components.conveyor && sim.packageMatrix) return sim.packageMatrix(record, record.components.conveyor, outgoing ? sim.pathLength(record.components.conveyor.config) / 2 - .30 : -sim.pathLength(record.components.conveyor.config) / 2, {bounds, scale, route: 'main', lateral: 0});
      let metadata; node.traverse(child => { if (!metadata) metadata = child.userData.industrialSource || child.userData.industrialPalletQueue || child.userData.industrialProcessor; });
      const p = metadata && (metadata.queuePosition || (outgoing ? metadata.outputPosition : metadata.inputPosition)) || [0, 0, 0], local = new THREE.Vector3().fromArray(p); local.y += .005;
      return new THREE.Matrix4().multiplyMatrices(node.matrixWorld, new THREE.Matrix4().makeTranslation(local.x, local.y, local.z));
    };
    const pickup = contact(product ? (product.object.updateWorldMatrix(true, true), product.object.matrixWorld) : station(input, source, true)), place = contact(station(output, target, false));
    return {pickup: xyz(pickup), place: xyz(place), payloadSize, provenance: product ? 'Recogida medida en la carga existente; receptor calculado desde su estación' : 'Referencia calculada con la configuración y posición actuales de las estaciones', startPose: r && r.components.robot && r.components.robot.pose || kinematics.homePose(this.config)};
  }
  refreshEndpoints() { if (!this.coordinates) return; try { const p = this.read(), e = this.endpoints(p); this.coordinates.textContent = 'Recogida TCP · ' + format(e.pickup) + ' m\nDepósito TCP · ' + format(e.place) + ' m\n' + e.provenance; } catch (error) { this.coordinates.textContent = error.message; } }
  validate() { try { if (!this.current()) throw new Error('El equipo o el proyecto cambió.'); this.stop(); const p = this.read(); if (!p.sourceId || !p.outputId) throw new Error('Completa origen y receptor.'); const e = this.endpoints(p); this.preview = tasks.preview(this.config, p, e, kinematics); this.validatedText = JSON.stringify(p); this.code.value = JSON.stringify(p, null, 2); this.time = 0; this.timeline.textContent = ''; this.stageRows = this.preview.stages.map(stage => { const li = node(this.document, 'li', stage.name); this.timeline.appendChild(li); return {stage, li}; }); this.applyButton.disabled = !this.editable(); this.status.textContent = 'Recorrido cinemático válido · ' + this.preview.duration.toFixed(1) + ' s · ' + this.preview.frames.length + ' muestras. Comprueba el ciclo con las colisiones reales al ejecutar el escenario.'; this.present(this.preview.frames[0]); return true; } catch (error) { this.preview = null; this.applyButton.disabled = true; this.status.textContent = error.message; return false; } }
  present(frame) { if (!this.preview || !frame || !this.current()) return; this.frame = frame; this.stageRows.forEach(row => row.li.setAttribute('data-current', String(row.stage.id === frame.phase))); this.telemetry.textContent = frame.label + '\nTCP · ' + format(frame.pose.tcp) + ' m\nEjes · ' + frame.pose.joints.map((q, i) => 'J' + (i + 1) + ' ' + q.toFixed(3)).join(' · ') + '\n' + (frame.carrying ? 'Carga de demostración sujeta' : 'Herramienta libre'); if (this.viewer.previewTaskPose) this.viewer.previewTaskPose({joints: frame.pose.joints.slice(), tcp: xyz(frame.pose.tcp), phase: frame.phase, carrying: frame.carrying, payloadSize: this.preview.payloadSize, pickup: {x: this.preview.pickup[0], y: this.preview.pickup[1], z: this.preview.pickup[2]}, path: this.preview.path}); this.drawMap(frame); }
  update(delta) { if (this.disposed || !this.playing || !this.preview) return; if (!this.current()) { this.dispose(); return; } this.time = Math.min(this.preview.duration, this.time + Math.min(.1, Math.max(0, delta))); const frame = this.preview.frames.find(f => f.at >= this.time) || this.preview.frames[this.preview.frames.length - 1]; this.present(frame); if (this.time >= this.preview.duration) { this.playing = false; this.playButton.textContent = '▶ Repetir vista'; this.status.textContent = 'Previsualización completada: recogida, traslado, entrega y retorno. El escenario no se ha modificado.'; this.time = 0; } }
  nextStage() { if (!this.preview && !this.validate()) return; this.playing = false; const frames = this.preview.frames, at = this.frame ? frames.indexOf(this.frame) : -1, next = frames.slice(at + 1).find(frame => !this.frame || frame.phase !== this.frame.phase) || frames[frames.length - 1]; this.time = next.at; this.present(next); }
  stop() { this.playing = false; this.time = 0; this.frame = null; if (this.playButton) this.playButton.textContent = '▶ Simular ciclo'; if (this.viewer.clearTaskPreview) this.viewer.clearTaskPreview(); }
  drawMap(frame) { const c = this.map.getContext('2d'); if (!c || !c.fillText || !this.preview) return; const w = this.map.width, h = this.map.height; c.clearRect(0, 0, w, h); c.fillStyle = '#10232d'; c.fillRect(0, 0, w, h); for (const [i, axes, title] of [[0, [0, 2], 'Planta · X / Z'], [1, [0, 1], 'Alzado · X / Y']]) { const points = this.preview.path, values = axes.map(axis => points.map(p => p[axis])), min = values.map(a => Math.min(...a)), max = values.map(a => Math.max(...a)), scale = Math.min((w / 2 - 60) / Math.max(.1, max[0] - min[0]), (h - 70) / Math.max(.1, max[1] - min[1])), project = p => [i * w / 2 + 25 + (p[axes[0]] - min[0]) * scale, h - 35 - (p[axes[1]] - min[1]) * scale]; c.fillStyle = '#d9eeeb'; c.font = '14px sans-serif'; c.fillText(title, i * w / 2 + 20, 24); c.strokeStyle = '#60d5de'; c.lineWidth = 3; c.beginPath(); points.forEach((p, index) => { const q = project(p); if (index) c.lineTo(...q); else c.moveTo(...q); }); c.stroke(); points.forEach((p, index) => { const q = project(p); c.fillStyle = '#b8cacf'; c.beginPath(); c.arc(q[0], q[1], 3, 0, Math.PI * 2); c.fill(); c.fillText(String(index), q[0] + 5, q[1] - 4); }); const at = project([frame.pose.tcp.x, frame.pose.tcp.y, frame.pose.tcp.z]); c.fillStyle = frame.carrying ? '#ffc866' : '#a7efd0'; c.beginPath(); c.arc(at[0], at[1], 7, 0, Math.PI * 2); c.fill(); } }
  async apply() {
    try {
      if (!this.editable() || !this.preview || JSON.stringify(this.read()) !== this.validatedText) throw new Error('Valida de nuevo la tarea antes de guardarla.');
      const v = this.viewer, object = this.scope.object, e = v.editor, program = this.read(), current = v.documentModel.getBehaviors(object), robot = current.find(c => c.type === 'robot');
      const context = {document: e.document, roomId: e.roomId, generation: e.projectGeneration};
      const config = robots.normalize(Object.assign({}, robot, {taskEnabled: !!this.enabled.checked, taskProgramJson: JSON.stringify(program), sourceId: program.sourceId, outputId: program.outputId, speed: program.speed, approachHeight: program.clearance, mode: 'manual', running: false}));
      if (!v.current() || !v.editable()) throw new Error('Los permisos o el proyecto cambiaron.');
      this.stop(); v.close();
      await e.perform(() => {
        if (!e.canEditDocument() || e.document !== context.document || e.roomId !== context.roomId || e.projectGeneration !== context.generation || context.document.getObject(this.scope.id) !== object) throw new Error('El proyecto o los permisos cambiaron.');
        e.setEquipmentBehaviors(object, current.map(c => c.type === 'robot' ? config : c));
      });
      v.notify('Tarea guardada. El robot queda detenido en modo manual: enciende e inicia un ciclo desde su panel. Ctrl+Z permite deshacer. Guarda el proyecto para conservarla.');
    } catch (error) { if (this.status && this.current()) this.status.textContent = error.message; else this.viewer.notify(error.message); }
  }
  dispose() { if (this.disposed) return; this.stop(); this.disposed = true; this.preview = null; }
}
