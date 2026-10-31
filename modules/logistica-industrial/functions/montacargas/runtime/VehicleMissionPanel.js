const STAGES = [
  {id: 'approach', title: 'Aproximación', instruction: 'Sigue las flechas hasta el pallet asignado.', hint: 'Acércate despacio y deja espacio para centrar las horquillas.'},
  {id: 'pickup', title: 'Recogida', instruction: 'Alinea ambas horquillas y recoge el pallet indicado.', hint: 'Comprueba la altura y la inserción de ambas horquillas antes de tomar la carga.'},
  {id: 'transport', title: 'Transporte', instruction: 'Conduce por las flechas hasta el destino asignado.', hint: 'Lleva la carga baja y comprueba que el pasillo esté libre antes de avanzar.'},
  {id: 'align', title: 'Alineación', instruction: 'Centra el pallet en la ubicación indicada.', hint: 'Compara la altura, el ángulo y el desvío lateral en el plano antes de depositar.'},
  {id: 'drop', title: 'Depósito', instruction: 'Apoya el pallet en su ubicación y confirma el depósito.', hint: 'La carga debe quedar apoyada en el destino asignado. Ajusta la posición si la operación no está disponible.'},
  {id: 'withdraw', title: 'Retirada', instruction: 'Retrocede despacio hasta retirar ambas horquillas.', hint: 'La misión se confirma cuando las dos horquillas estén fuera del pallet y la carga permanezca apoyada.'}
];
const cleanName = value => String(value || '').replace(/^\d+\s*·\s*/, '');
const integer = value => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
const setText = (element, value) => { const text = String(value || ''); if (element.textContent !== text) element.textContent = text; };

/** A read-only view of verified training progress. Opening advice or the mission
 * list never changes physical custody, awards points or advances a lesson. */
export default class VehicleMissionPanel {
  constructor(document, options = {}) {
    this.document = document; this.now = options.now || (() => Date.now());
    this.feedbackDuration = options.feedbackDuration || 6500; this.mode = options.mode || 'embedded'; this.visible = true;
  }
  static viewModel(lesson, tasks = []) {
    if (!lesson) return null;
    const total = integer(lesson.total || tasks.length), completed = Math.min(total, integer(lesson.completed));
    const complete = total > 0 && completed === total && lesson.phase === 'complete';
    const fallback = lesson.phase === 'pickup' ? lesson.routeComplete ? 'pickup' : 'approach' : lesson.phase === 'drop' ? lesson.routeComplete ? 'align' : 'transport' : lesson.phase;
    const stage = complete ? 'complete' : lesson.stage || fallback;
    const stages = (Array.isArray(lesson.stages) && lesson.stages.length ? lesson.stages : STAGES.map(item => ({id: item.id, title: item.title, status: complete ? 'completed' : item.id === stage ? 'active' : 'locked'})))
      .map(item => ({id: item.id, title: item.title || (STAGES.find(value => value.id === item.id) || {}).title || '', status: ['completed', 'active', 'locked'].includes(item.status) ? item.status : 'locked'}));
    const stageIndex = stages.findIndex(item => item.status === 'active'), current = STAGES.find(item => item.id === stage) || {};
    const task = tasks[completed];
    const title = complete ? '¡Práctica completada!' : cleanName(lesson.title || task && task.name || 'Misión de almacén');
    const stageTitle = complete ? 'Todas las misiones verificadas' : lesson.stageTitle || current.title || 'Revisa la misión';
    const instruction = complete ? 'Has completado la recogida, el transporte y el depósito de todas las cargas.' : lesson.instruction || current.instruction || lesson.status || 'Revisa la indicación antes de continuar.';
    const feedback = lesson.feedback && lesson.feedback.id !== undefined ? lesson.feedback : null;
    const retry = feedback && feedback.kind === 'error' && feedback.retry;
    const hint = retry || lesson.hint || current.hint || instruction;
    const stageProgress = complete ? 1 : stages.length ? stages.filter(item => item.status === 'completed').length / stages.length : 0;
    const progress = total ? Math.min(100, Math.round((completed + (complete ? 0 : stageProgress)) / total * 100)) : 0;
    const scoreMax = integer(lesson.scoreMax), score = integer(lesson.score);
    const badges = (Array.isArray(lesson.badges) ? lesson.badges : []).filter(item => item && item.unlocked !== false).map(item => typeof item === 'string' ? {id: item, title: item} : {id: item.id, title: item.title || item.name || ''}).filter(item => item.title);
    return {taskId: lesson.taskId || '', title, stage, stageTitle, instruction, hint, stages, stageIndex, completed, total, complete, progress, score, scoreMax, badges, feedback,
      routeFault: !!lesson.routeFault, status: lesson.status || '', missionNumber: complete ? total : Math.min(total, completed + 1),
      tasks: tasks.map((item, index) => ({id: item.id || String(index), title: cleanName(item.name), status: index < completed ? 'completed' : !complete && index === completed ? 'active' : 'locked'}))};
  }
  create(tag, className, parent) {
    const element = this.document.createElement(tag); if (className) element.className = className; if (parent) parent.appendChild(element); return element;
  }
  mount(parent) {
    this.unmount(); if (!this.document || !this.document.createElement) return null;
    this.element = this.create('section', 'vehicle-training-progress vehicle-mission-panel', parent);
    this.element.dataset.vehicleTraining = ''; this.element.dataset.vehicleMissionPanel = ''; this.element.dataset.mode = this.mode;
    this.element.setAttribute('aria-label', 'Misiones de almacén'); this.element.hidden = true;
    const bar = this.create('div', 'vehicle-mission-scorebar', this.element);
    this.kicker = this.create('span', 'vehicle-mission-kicker', bar);
    this.score = this.create('span', 'vehicle-mission-score', bar); this.score.setAttribute('aria-label', 'Puntuación verificada');
    this.title = this.create('strong', 'vehicle-mission-title', this.element);
    const progress = this.create('div', 'vehicle-mission-progress-row', this.element);
    this.progressLabel = this.create('span', 'vehicle-mission-progress-label', progress);
    this.progress = this.create('progress', 'vehicle-mission-progress', progress); this.progress.max = 100; this.progress.setAttribute('aria-label', 'Progreso de las misiones');
    this.stageLabel = this.create('p', 'vehicle-mission-stage-label', this.element);
    this.stageList = this.create('ol', 'vehicle-mission-stages', this.element); this.stageList.setAttribute('aria-label', 'Pasos de la misión activa');
    this.instruction = this.create('p', 'vehicle-mission-instruction', this.element);
    this.recovery = this.create('p', 'vehicle-mission-recovery', this.element); this.recovery.hidden = true;
    this.feedback = this.create('div', 'vehicle-mission-feedback', this.element); this.feedback.hidden = true;
    this.feedbackPoints = this.create('strong', 'vehicle-mission-feedback-points', this.feedback);
    this.feedbackMessage = this.create('span', '', this.feedback);
    this.badges = this.create('div', 'vehicle-mission-badges', this.element); this.badges.setAttribute('aria-label', 'Insignias obtenidas'); this.badges.hidden = true;
    const drawers = this.create('div', 'vehicle-mission-drawers', this.element);
    this.help = this.create('details', 'vehicle-mission-help', drawers);
    this.helpSummary = this.create('summary', '', this.help); this.helpSummary.textContent = 'Consejo para este paso';
    this.helpText = this.create('p', '', this.help);
    this.missions = this.create('details', 'vehicle-mission-list', drawers);
    this.missionsSummary = this.create('summary', '', this.missions);
    this.missionList = this.create('ol', '', this.missions);
    this.unlockNote = this.create('p', 'vehicle-mission-unlock-note', this.missions);
    this.announcement = this.create('p', 'vehicle-mission-announcement', this.element); this.announcement.setAttribute('aria-live', 'polite'); this.announcement.setAttribute('aria-atomic', 'true');
    this.stopEvent = event => { if (event.stopPropagation) event.stopPropagation(); };
    ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'keydown'].forEach(type => this.element.addEventListener(type, this.stopEvent));
    return this.element;
  }
  setVisible(visible) { this.visible = !!visible; if (this.element) this.element.hidden = !this.visible || !this.model; }
  update(lesson, tasks = []) {
    if (!this.element) return;
    const model = VehicleMissionPanel.viewModel(lesson, tasks); this.model = model; this.element.hidden = !model || !this.visible;
    if (!model) { this.feedback.hidden = true; this.feedbackId = this.stepKey = null; return; }
    this.element.dataset.stage = model.stage; this.element.dataset.complete = String(model.complete);
    setText(this.kicker, model.complete ? 'Objetivo alcanzado' : 'Misión ' + model.missionNumber + ' de ' + model.total);
    this.score.hidden = !model.scoreMax; setText(this.score, model.score + ' / ' + model.scoreMax + ' pts');
    this.score.setAttribute('aria-label', 'Puntuación verificada: ' + model.score + ' de ' + model.scoreMax + ' puntos');
    setText(this.title, model.title); this.title.title = model.title; setText(this.progressLabel, model.completed + ' / ' + model.total + ' verificadas');
    this.progress.value = model.progress; this.progress.setAttribute('aria-valuetext', model.completed + ' de ' + model.total + ' misiones verificadas; ' + model.progress + ' por ciento del recorrido de aprendizaje');
    setText(this.stageLabel, (model.stageIndex >= 0 ? 'Paso ' + (model.stageIndex + 1) + ' de ' + model.stages.length + ' · ' : '') + model.stageTitle);
    this.stageList.hidden = model.complete;
    const stageSignature = JSON.stringify(model.stages);
    if (stageSignature !== this.stageSignature) {
      this.clear(this.stageList);
      model.stages.forEach(item => { const node = this.create('li', '', this.stageList); node.dataset.stage = item.id; node.dataset.status = item.status; node.title = item.title; if (item.status === 'active') node.setAttribute('aria-current', 'step'); node.setAttribute('aria-label', item.title + ': ' + (item.status === 'completed' ? 'verificado' : item.status === 'active' ? 'paso actual' : 'pendiente')); });
      this.stageSignature = stageSignature;
    }
    setText(this.instruction, model.instruction); setText(this.helpText, model.hint);
    this.recovery.hidden = !model.routeFault; setText(this.recovery, model.routeFault ? model.status || 'Vuelve al último punto válido y recorre las flechas conduciendo.' : '');
    setText(this.helpSummary, model.feedback && model.feedback.kind === 'error' ? 'Cómo corregirlo' : 'Consejo para este paso');
    const taskSignature = JSON.stringify(model.tasks);
    if (taskSignature !== this.taskSignature) {
      this.clear(this.missionList);
      model.tasks.forEach(item => {
        const row = this.create('li', '', this.missionList); row.dataset.status = item.status;
        if (item.status === 'active') row.setAttribute('aria-current', 'step');
        const name = this.create('span', '', row); name.textContent = item.title;
        const status = this.create('small', '', row); status.textContent = item.status === 'completed' ? 'Verificada' : item.status === 'active' ? 'En curso' : 'Bloqueada';
      });
      this.taskSignature = taskSignature;
    }
    setText(this.missionsSummary, 'Misiones · ' + model.completed + '/' + model.total);
    setText(this.unlockNote, model.complete ? 'Todas las misiones están verificadas.' : 'La siguiente misión se desbloquea al depositar la carga y retirar ambas horquillas.');
    const badgeSignature = JSON.stringify(model.badges);
    if (badgeSignature !== this.badgeSignature) {
      this.clear(this.badges); model.badges.slice(-2).forEach(item => { const badge = this.create('span', 'vehicle-mission-badge', this.badges); badge.textContent = '★ ' + item.title; badge.dataset.badgeId = item.id || ''; }); this.badgeSignature = badgeSignature;
    }
    this.badges.hidden = !model.badges.length;
    const stepKey = [model.taskId, model.stage, model.complete].join(':');
    const freshFeedback = model.feedback && String(model.feedback.id) !== this.feedbackId;
    if (freshFeedback) {
      const event = model.feedback, points = Number.isFinite(event.points) ? event.points : 0;
      this.feedbackId = String(event.id); this.feedbackUntil = this.now() + this.feedbackDuration;
      this.feedback.dataset.kind = event.kind === 'error' ? 'error' : 'reward';
      setText(this.feedbackPoints, (points > 0 ? '+' : points < 0 ? '−' : '') + Math.abs(points) + ' pts');
      setText(this.feedbackMessage, event.message || 'Acción verificada.'); this.feedback.hidden = false;
      if (event.kind === 'error') this.help.open = true;
      else if (stepKey !== this.stepKey) this.help.open = false;
      setText(this.announcement, (event.kind === 'error' ? 'Revisa este intento. ' : 'Bien hecho. ') + (event.message || '') + ' ' + points + ' puntos.' + (event.retry ? ' ' + event.retry : ''));
    } else {
      this.feedback.hidden = !model.feedback || this.now() >= (this.feedbackUntil || 0);
      if (stepKey !== this.stepKey) { this.help.open = false; setText(this.announcement, model.title + '. ' + model.stageTitle + '. ' + model.instruction); }
    }
    this.stepKey = stepKey;
  }
  clear(element) { while (element.firstChild) element.removeChild(element.firstChild); }
  unmount() {
    if (this.element) { ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'keydown'].forEach(type => this.element.removeEventListener(type, this.stopEvent)); this.element.remove(); }
    this.element = this.model = null; this.stageSignature = this.taskSignature = this.badgeSignature = this.feedbackId = this.stepKey = null; this.feedbackUntil = 0;
  }
  dispose() { this.unmount(); }
}
