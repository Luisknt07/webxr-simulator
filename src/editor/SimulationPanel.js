import TelemetryClient from './TelemetryClient.js';
import TelemetryRecorder, {csv} from './TelemetryRecorder.js';

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function button(label, action) {
  const element = node('button', 'sim-button', label); element.type = 'button';
  element.addEventListener('click', action); return element;
}
function formatted(value) { return typeof value === 'string' ? value : typeof value === 'number' ? Number(value.toFixed(3)).toLocaleString() : value ? 'Sí' : 'No'; }

/** Desktop operator panel; the same simulation variables are available to VR controls. */
export default class SimulationPanel {
  constructor(editor) {
    this.editor = editor;
    this.client = new TelemetryClient();
    this.recorder = new TelemetryRecorder();
    this.payload = null; this.recordProject = null; this.busy = false; this.opened = false;
    this.saved = false; this.storedPayload = null; this.historyRequest = 0;
    this.samples = []; this.lastPaint = -Infinity;
    this.launcher = button('Simulación · variables y datos', () => this.toggle());
    this.launcher.id = 'simulation-launcher';
    this.panel = node('section', 'simulation-panel'); this.panel.hidden = true;
    this.panel.setAttribute('aria-label', 'Monitor de simulación');
    this.panel.addEventListener('keydown', event => event.stopPropagation());
    const head = node('div', 'sim-head'); head.appendChild(node('strong', '', 'SIMULACIÓN / PLC'));
    head.appendChild(button('Cerrar', () => this.toggle(false))); this.panel.appendChild(head);
    this.panel.appendChild(node('p', 'sim-hint', 'Modelo de simulación. Los mandos 3D también funcionan con mouse y controles VR.'));
    this.mode = node('p', 'sim-mode'); this.panel.appendChild(this.mode);
    this.clock = node('p', 'sim-hint'); this.panel.appendChild(this.clock);
    const actions = node('div', 'sim-actions');
    actions.appendChild(button('Probar / reiniciar', () => this.guard(async () => {
      this.editor.enter(); this.editor.leave(); this.samples = []; this.render(true);
    })));
    actions.appendChild(button('Volver a editar', () => this.editor.enter()));
    this.panel.appendChild(actions);
    this.objectSelect = node('select'); this.objectSelect.setAttribute('aria-label', 'Objeto de simulación');
    this.objectSelect.addEventListener('change', () => { this.samples = []; this.render(true); });
    this.panel.appendChild(this.objectSelect);
    this.variables = node('div', 'sim-variables'); this.panel.appendChild(this.variables);
    this.kpis = node('p', 'sim-hint'); this.panel.appendChild(this.kpis);
    this.trend = node('pre', 'sim-trend'); this.trend.setAttribute('aria-label', 'Tendencia de velocidad'); this.panel.appendChild(this.trend);
    this.events = node('div', 'sim-events'); this.events.setAttribute('aria-label', 'Eventos del objeto seleccionado'); this.panel.appendChild(this.events);
    this.panel.appendChild(node('strong', 'sim-title', 'REGISTRO Y ANALÍTICA'));
    this.recordStatus = node('p', 'sim-hint'); this.panel.appendChild(this.recordStatus);
    const recording = node('div', 'sim-actions');
    this.recordButton = button('Grabar sesión', () => this.guard(() => this.record())); recording.appendChild(this.recordButton);
    this.stopButton = button('Finalizar registro', () => { this.endSession(); this.render(true); }); recording.appendChild(this.stopButton);
    this.saveButton = button('Guardar datos en SQLite', () => this.guard(() => this.save())); recording.appendChild(this.saveButton);
    recording.appendChild(button('↓ CSV', () => this.download(false)));
    recording.appendChild(button('↓ JSON', () => this.download(true)));
    recording.appendChild(button('Sesiones guardadas', () => this.guard(() => this.history())));
    this.panel.appendChild(recording);
    this.historyList = node('div', 'sim-history'); this.panel.appendChild(this.historyList);
    if (this.editor.editorEnabled !== false) {
      document.body.appendChild(this.panel); document.body.appendChild(this.launcher);
    }
    this.modeChanged();
  }

  async guard(action) {
    if (this.busy) return;
    this.busy = true;
    try { await action(); } catch (error) { this.editor.toast(error.message || String(error)); }
    finally { this.busy = false; this.render(true); }
  }

  toggle(open = !this.opened) {
    if (this.editor.editorEnabled === false) open = false;
    this.opened = open; this.panel.hidden = !open;
    if (open) { this.editor.hooks.unlock(); this.editor.hooks.clearKeyboard(); this.render(true); }
  }

  modeChanged() {
    this.launcher.hidden = this.editor.editorEnabled === false || this.editor.active || this.editor.ctx.vrMode;
    if (this.editor.editorEnabled === false || this.editor.ctx.vrMode) this.toggle(false);
    if (this.opened) this.render(true);
  }

  tick(snapshot) {
    if (this.recorder.active) {
      this.recorder.capture(snapshot);
      if (!this.recorder.active) {
        this.payload = this.recorder.payload;
        this.saved = false; this.storedPayload = null;
        this.editor.toast('Registro finalizado al alcanzar el límite de datos. Puedes guardarlo o exportarlo.');
      }
    }
    if (this.opened && snapshot.time - this.lastPaint >= 0.25) this.render(false, snapshot);
  }

  endSession() {
    if (!this.recorder.active) return;
    this.payload = this.recorder.stop(this.editor.simulation.getSnapshot());
    this.saved = false; this.storedPayload = null;
  }

  async record() {
    if (this.recorder.active) return;
    if (this.payload && !this.saved) throw new Error('Guarda o exporta el registro anterior antes de iniciar otro.');
    // Saving always uses authored poses, before running moving components.
    if (!this.editor.currentProject || this.editor.dirty) {
      this.editor.enter();
      const saved = await this.editor.saveProject();
      if (!saved || this.editor.dirty) throw new Error('Guarda el proyecto antes de grabar datos.');
    }
    if (this.editor.active) this.editor.leave();
    const snapshot = this.editor.simulation.getSnapshot();
    if (!snapshot.objects.some(object => object.analyticsInterval !== undefined)) throw new Error('Añade el componente Analítica a un objeto para registrar sus variables.');
    this.recordProject = Object.assign({}, this.editor.currentProject);
    this.recorder.start({projectRevision: this.recordProject.revision, roomId: this.editor.roomId}, snapshot);
    this.payload = null; this.saved = false; this.storedPayload = null;
    this.editor.toast('Registro iniciado. Las muestras y eventos pertenecen a esta versión del proyecto.');
  }

  async save() {
    this.endSession();
    if (!this.payload || !this.recordProject) throw new Error('Graba una sesión primero.');
    const payload = this.payload, project = Object.assign({}, this.recordProject);
    if (this.storedPayload === payload) return this.editor.toast('Esta sesión ya está guardada en SQLite.');
    const run = await this.client.save(project.id, payload);
    // A late response belongs to the captured recording, never to a newer one.
    if (this.payload === payload && this.recordProject && this.recordProject.id === project.id) {
      this.saved = true; this.storedPayload = payload;
    }
    this.editor.toast('Sesión guardada en SQLite · ' + run.sampleCount + ' muestras.');
    if (!this.editor.currentProject || this.editor.currentProject.id === project.id) {
      try { await this.history(project); }
      catch (_) { this.editor.toast('Datos guardados en SQLite. No se pudo actualizar el historial; puedes consultarlo de nuevo.'); }
    }
  }

  download(json) {
    const payload = this.recorder.active ? this.recorder.payload : this.payload;
    if (!payload) return this.editor.toast('Graba o abre una sesión antes de exportar.');
    const blob = new Blob([json ? JSON.stringify(payload, null, 2) : csv(payload)], {type: json ? 'application/json' : 'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob), link = node('a');
    link.href = url; link.download = 'simulacion-' + new Date().toISOString().replace(/[:.]/g, '-') + (json ? '.json' : '.csv'); link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (!this.recorder.active) this.saved = true;
  }

  async history(project = this.editor.currentProject || this.recordProject) {
    if (!project) throw new Error('Guarda un proyecto para consultar sus sesiones.');
    project = Object.assign({}, project);
    const request = ++this.historyRequest;
    const currentProjectId = this.editor.currentProject && this.editor.currentProject.id;
    const runs = await this.client.list(project.id);
    if (request !== this.historyRequest || currentProjectId !== (this.editor.currentProject && this.editor.currentProject.id)) return;
    this.historyList.textContent = '';
    this.historyList.appendChild(node('p', 'sim-hint', 'Sesiones de ' + (project.name || project.id)));
    if (!runs.length) this.historyList.appendChild(node('p', 'sim-hint', 'Este proyecto todavía no tiene sesiones guardadas.'));
    runs.slice(0, 30).forEach(run => {
      this.historyList.appendChild(button(new Date(run.startedAt).toLocaleString() + ' · ' + formatted(run.duration) + ' s · v' + run.projectRevision, () => this.guard(async () => {
        if (this.recorder.active || this.payload && !this.saved) throw new Error('Finaliza y guarda o exporta el registro actual antes de abrir otro.');
        const previous = this.payload;
        const stored = await this.client.get(project.id, run.id);
        if (this.recorder.active || this.payload !== previous || currentProjectId !== (this.editor.currentProject && this.editor.currentProject.id)) {
          throw new Error('El proyecto o registro cambió mientras se abría la sesión. Vuelve a elegirla.');
        }
        this.payload = {projectRevision: stored.projectRevision, roomId: stored.roomId, startedAt: stored.startedAt,
          endedAt: stored.endedAt, duration: stored.duration, samples: stored.samples, events: stored.events};
        this.recordProject = project; this.saved = true; this.storedPayload = this.payload;
        this.editor.toast('Sesión abierta. Puedes descargar sus datos como CSV o JSON.');
      })));
    });
  }

  render(force, snapshot = this.editor.simulation.getSnapshot()) {
    this.lastPaint = snapshot.time;
    this.mode.textContent = this.editor.active ? 'EDICIÓN · usa Probar para ejecutar sensores y movimientos' : 'EN EJECUCIÓN · ' + formatted(snapshot.time) + ' s';
    this.clock.textContent = snapshot.droppedSeconds > 0 ? 'Reloj de simulación: ' + formatted(snapshot.time) + ' s · ' +
      formatted(snapshot.droppedSeconds) + ' s descartados por pausas entre cuadros.' : '';
    const signature = snapshot.objects.map(object => object.id + ':' + object.name).join('|');
    if (signature !== this.objectSignature) {
      const selected = this.objectSelect.value; this.objectSelect.textContent = '';
      snapshot.objects.forEach(object => { const option = node('option', '', object.name + ' · ' + object.type + ' · ' + object.id); option.value = object.id; this.objectSelect.appendChild(option); });
      if (snapshot.objects.some(object => object.id === selected)) this.objectSelect.value = selected;
      this.objectSignature = signature;
    }
    const object = snapshot.objects.find(object => object.id === this.objectSelect.value) || snapshot.objects[0];
    const controlSignature = object ? object.id + ':' + JSON.stringify(object.writable) : 'empty';
    if (force || controlSignature !== this.controlSignature) {
      this.variables.textContent = ''; this.readouts = new Map();
      if (!object) this.variables.appendChild(node('p', 'sim-hint', 'Añade una banda preestablecida o componentes de movimiento, sensores y automatización.'));
      if (object) Object.keys(object.variables).forEach(key => {
        const row = node('div', 'sim-variable'); row.appendChild(node('span', '', key));
        const writable = object.writable.find(field => field.key === key);
        if (writable) {
          const input = node('input'); input.type = writable.type === 'boolean' ? 'checkbox' : 'number'; input.step = '0.05';
          if (writable.min !== undefined) input.min = writable.min;
          if (writable.max !== undefined) input.max = writable.max;
          input.setAttribute('aria-label', object.name + ' · ' + key);
          input.addEventListener('change', () => {
            try { this.editor.simulation.setVariable(object.id, key, writable.type === 'boolean' ? input.checked : Number(input.value)); }
            catch (error) { this.editor.toast(error.message); }
            this.render(false);
          }); row.appendChild(input); this.readouts.set(key, input);
        } else { const value = node('output'); row.appendChild(value); this.readouts.set(key, value); }
        this.variables.appendChild(row);
      });
      if (object && (object.types || [object.type]).includes('source')) {
        const actions = node('div', 'sim-actions');
        [['generate', 'Generar carga'], ['dispatch', 'Despachar primera'], ['clearQueue', 'Vaciar cola']].forEach(([command, label]) => {
          const control = button(label, () => {
            try {
              const result = this.editor.simulation.command(object.id, command);
              if (result === false) this.editor.toast(command === 'generate' ? 'La generación espera espacio o alcanzó su límite.' : 'La entrega espera un destino conectado, alineado y disponible.');
            } catch (error) { this.editor.toast(error.message); }
            this.render(false);
          });
          control.disabled = this.editor.active; actions.appendChild(control);
        });
        this.variables.appendChild(actions);
      }
      if (object && (object.types || [object.type]).includes('palletQueue')) {
        const actions = node('div', 'sim-actions');
        [['start', 'Aceptar productos'], ['stop', 'Detener almacén'], ['pause', 'Pausa / continuar'], ['dispatch', 'Despachar caja superior']].forEach(([command, label]) => {
          const control = button(label, () => {
            try {
              if (this.editor.simulation.command(object.id, command) === false) this.editor.toast('El almacén espera una carga accesible y un destino conectado, alineado y disponible.');
            } catch (error) { this.editor.toast(error.message); }
            this.render(false);
          });
          control.disabled = this.editor.active; actions.appendChild(control);
        });
        this.variables.appendChild(actions);
      }
      if (object && (object.types || [object.type]).includes('processor')) {
        const actions = node('div', 'sim-actions');
        [['powerOn', 'Encender'], ['start', 'Marcha'], ['pause', 'Pausa / continuar'], ['stop', 'Parar'], ['powerOff', 'Apagar'], ['resetEmergency', 'Rearmar emergencia'], ['operator', 'Operario disponible / ausente'], ['dispatch', 'Despachar producto']].forEach(([command, label]) => {
          const control = button(label, () => {
            try {
              const result = this.editor.simulation.command(object.id, command);
              if (result === false) this.editor.toast('La máquina espera sus condiciones de operación, productos o espacio en el destino.');
            } catch (error) { this.editor.toast(error.message); }
            this.render(false);
          });
          control.disabled = this.editor.active; actions.appendChild(control);
        });
        this.variables.appendChild(actions);
      }
      this.controlSignature = controlSignature;
    }
    if (object) Object.keys(object.variables).forEach(key => {
      const output = this.readouts.get(key); if (!output || document.activeElement === output) return;
      const value = object.variables[key];
      if (output.tagName === 'INPUT') { if (output.type === 'checkbox') output.checked = value; else output.value = value; }
      else output.textContent = formatted(value);
    });
    this.kpis.textContent = object && typeof object.variables.exitCount === 'number' && typeof object.variables.runSeconds === 'number' ?
      'Rendimiento simulado: ' + formatted(snapshot.time > 0 ? object.variables.exitCount / snapshot.time * 60 : 0) + ' paquetes/min · Tiempo en marcha: ' +
      formatted(snapshot.time > 0 ? Math.min(100, object.variables.runSeconds / snapshot.time * 100) : 0) + ' % del tiempo simulado.' : '';
    if (object && typeof object.variables.queued === 'number') this.kpis.textContent = 'Cola: ' + formatted(object.variables.queued) + ' / ' + formatted(object.variables.capacity) +
      ' cargas · Unidades generadas: ' + formatted(object.variables.generatedUnits) + ' · Entregadas: ' + formatted(object.variables.deliveredUnits) +
      (object.variables.blocked ? ' · ESPERANDO ESPACIO O SALIDA' : '');
    if (object && (object.types || [object.type]).includes('processor')) this.kpis.textContent = 'Estado: ' + formatted(object.variables.state) +
      ' · Entrada: ' + formatted(object.variables.queued) + '/' + formatted(object.variables.capacity) + ' · Puestos: ' + formatted(object.variables.activeJobs) + '/' + formatted(object.variables.parallelism) +
      ' · Salida: ' + formatted(object.variables.outputQueued) + '/' + formatted(object.variables.outputCapacity) + ' · Utilización: ' + formatted(object.variables.utilization) + ' %' +
      ' · Capacidad nominal: ' + formatted(object.variables.nominalCapacity) + ' ciclos/min (sin setup ni esperas)';
    if (object && (object.types || [object.type]).includes('palletQueue')) this.kpis.textContent = 'Almacén: ' + formatted(object.variables.queued) + '/' + formatted(object.variables.capacity) +
      ' cargas · Ocupación: ' + formatted(object.variables.occupancy) + ' % · Unidades: ' + formatted(object.variables.queuedUnits) +
      (object.variables.full ? ' · LLENO' : object.variables.blocked ? ' · BLOQUEADO' : '');
    if (object && (object.types || [object.type]).includes('conveyor') && typeof object.variables.routedMain === 'number') this.kpis.textContent +=
      ' · Clasificadas: principal ' + formatted(object.variables.routedMain) + ' / lateral ' + formatted(object.variables.routedBranch) +
      (typeof object.variables.routingUnmatched === 'number' ? ' · Sin coincidencia: ' + formatted(object.variables.routingUnmatched) : '') + ' (decisiones al entrar)';
    if (object && typeof object.variables.actualSpeed === 'number' && !this.editor.active) {
      this.samples.push(object.variables.actualSpeed); if (this.samples.length > 50) this.samples.shift();
      const max = Math.max(0.01, ...this.samples.map(Math.abs)), glyphs = '▁▂▃▄▅▆▇█';
      this.trend.textContent = 'Velocidad efectiva · m/s\n' + this.samples.map(value => glyphs[Math.min(7, Math.floor(Math.abs(value) / max * 7))]).join('');
    } else this.trend.textContent = '';
    this.events.textContent = '';
    snapshot.events.filter(event => object && event.objectId === object.id).slice(-5).reverse().forEach(event => this.events.appendChild(node('p', '', formatted(event.time) + ' s · ' + event.message)));
    const payload = this.recorder.active ? this.recorder.payload : this.payload;
    this.recordStatus.textContent = this.recorder.active ? '● Grabando · ' + payload.samples.length + ' muestras' : payload ?
      formatted(payload.duration) + ' s · ' + payload.samples.length + ' muestras · ' + payload.events.length + ' eventos · ' + (this.saved ? 'conservado' : 'pendiente de guardar') : 'Añade Analítica a los objetos y graba una sesión para conservar las variables.';
    this.recordButton.disabled = this.recorder.active || this.busy;
    this.stopButton.disabled = !this.recorder.active;
    this.saveButton.disabled = !payload || this.busy;
  }
}
