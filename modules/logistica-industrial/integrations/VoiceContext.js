import {studyScene} from '../scenarios/StudySceneCatalog.js';

const text = (value, limit = 1000) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
const join = (...values) => values.map(value => text(value)).filter(Boolean).join(' ').slice(0, 1200);
const roomIds = ['hall','sound','photogrammetry','vertigo','panoramastereo','panorama1','panorama2','panorama3','panorama4','panorama5'];

/** A read-only domain adapter. The portable voice service receives plain text,
 * never the document, machine commands, inventory or education callbacks. */
export function createVoiceSnapshot(ctx = {}, supplied = {}) {
  const editor = supplied.editor || ctx.editor, simulation = supplied.simulation || editor && editor.simulation || ctx.demo && ctx.demo.simulation;
  const driving = supplied.driving || editor && editor.vehicleDriving || ctx.demo && ctx.demo.driving;
  const document = supplied.document || editor && editor.document;
  const roomId = simulation && simulation.roomId || editor && editor.roomId || document && document.roomId || roomIds[ctx.room] || 'hall';
  const project = editor && editor.currentProject || supplied.project || document && document.project || {}, projectId = project.id || 'public-demo';
  const paused = !!(editor && (editor.simulationPaused || editor.loadingProject || editor.busy) || ctx.roomTransition || ctx.demo && ctx.demo.paused);
  const base = {projectId, roomId, sessionKey: projectId + ':' + roomId + ':' + (simulation && simulation.runSequence || ''), paused,
    running: !!(simulation && simulation.running), controls: 'Camina con W, A, S y D. Mira con el ratón. En el visor, usa el stick izquierdo para caminar y el derecho para girar. Abre Voz para escuchar o repetir la ayuda.',
    objective: 'Explora los equipos y consulta el contenido disponible.', content: 'SmartTwin permite explorar y practicar procesos con sistemas conectados.'};
  let definition;
  const templateId = project.librarySceneId || project.templateId || project.publicSceneId;
  try { if (templateId) definition = studyScene(templateId); } catch (_) { /* Other projects publish their own content. */ }
  if (definition) { base.objective = text(definition.objective); base.content = join(definition.title, definition.description); }
  const selected = editor && editor.selected;
  if (selected && document && document.getBehaviors) {
    const info = document.getBehaviors(selected).find(config => config.type === 'info');
    if (info) base.content = join(info.title || selected.name, info.text);
  }
  if (!base.content || base.content === 'SmartTwin permite explorar y practicar procesos con sistemas conectados.') {
    const infoObjects = document && document.getObjects ? document.getObjects(roomId) : [];
    for (const object of infoObjects) {
      const info = document.getBehaviors(object).find(config => config.type === 'info' && config.text);
      if (info) { base.content = join(info.title || object.name, info.text); break; }
    }
  }
  let record = driving && driving.record && driving.record();
  if (!record && simulation && simulation.records) record = Array.from(simulation.records.values()).find(record => record.components.vehicle && record.components.vehicle.training);
  if (!record && simulation && simulation.records) record = Array.from(simulation.records.values()).find(record => record.components.vehicle);
  const vehicle = record && record.components.vehicle;
  const lesson = record && simulation.vehicleTraining && simulation.vehicleTraining.guidance(record);
  const guide = driving && driving.id === (record && record.id) && driving.holographicGuide && driving.holographicGuide.getState();
  let next = driving && driving.id === (record && record.id) && driving.nextStep;
  // Opening the help panel blocks movement, but that UI gate is not an
  // operational fault. Evaluate existing physical interlocks without it.
  if (vehicle && driving && driving.id === record.id && driving.controlGuide && simulation.vehicleRuntime) {
    const cached = driving.docking && driving.docking.snapshot, docking = cached && cached.phase === (vehicle.entry ? 'drop' : 'pickup') ? cached : simulation.vehicleRuntime.getDockingState(record);
    next = driving.controlGuide.evaluate({vehicle, features: driving.features(), docking, blocked: false, xr: !!ctx.vrMode, intent: driving.operatorIntent});
  }
  if (vehicle) base.controls = ctx.vrMode
    ? 'Apunta a los botones con el rayo del mando. Usa los controles del montacargas para el volante y las palancas. Abre la cámara, el plano o el holograma desde Visión y ayuda. El botón Voz permite pedir o repetir instrucciones.'
    : 'F para subir o bajar. B enciende, V habilita la marcha y P libera el freno. W y S avanzan o retroceden; A y D giran. Q y E elevan o bajan. G toma la carga y K la deposita. C activa la cámara; Shift más G alterna el holograma. Espacio frena.';
  if (lesson) {
    const completed = lesson.phase === 'complete' && lesson.completed === lesson.total && lesson.total > 0;
    const location = lesson.phase === 'pickup' ? lesson.sourceLocationCode : lesson.locationCode;
    const targetRecord = simulation.records.get(lesson.phase === 'pickup' ? lesson.sourceId : lesson.destinationId);
    const targetName = location || targetRecord && targetRecord.object.name || '';
    base.objective = completed ? 'Práctica completada. Se han verificado las ' + lesson.total + ' misiones.' : join(lesson.title, targetName && 'Ubicación asignada: ' + targetName + '.');
    let instruction = lesson.status;
    if (completed) instruction = base.objective;
    else if (lesson.phase === 'error') instruction = lesson.status;
    else if (lesson.phase === 'withdraw') instruction = 'Retira ambas horquillas lentamente. La misión se confirma después de liberar el pallet.';
    else {
      instruction = join(next && next.instruction, guide && guide.instruction, lesson.status);
      if (!driving || !driving.id) instruction = join('Acércate al montacargas y sube para comenzar.', lesson.status);
    }
    const stage = next && next.stage || guide && guide.phase || lesson.stage || lesson.phase;
    const points = lesson.scoreMax > 0 ? 'Puntuación: ' + lesson.score + ' de ' + lesson.scoreMax + ' puntos.' : '';
    base.guidance = {key: [record.id, lesson.taskId, lesson.phase, stage, lesson.stage, !!lesson.routeComplete, !!lesson.routeFault].join(':'),
      text: join(lesson.title, targetName && 'Destino o punto de recogida: ' + targetName + '.', lesson.stageTitle, lesson.instruction, instruction, points),
      critical: !!(vehicle.emergency || vehicle.blocked || lesson.routeFault || lesson.phase === 'error'),
      completed, completionVerified: completed, sampleId: completed ? 'completed' : lesson.phase === 'error' || lesson.routeFault ? 'safety' : lesson.phase === 'withdraw' || lesson.phase === 'drop' && lesson.routeComplete ? 'deposit' : lesson.phase === 'drop' ? 'route' : 'pickup'};
    return base;
  }
  if (vehicle && next) {
    base.guidance = {key: record.id + ':' + next.stage + ':' + (guide && guide.phase || ''), text: join(next.title, next.instruction, guide && guide.instruction, next.control && 'Control: ' + next.control), critical: !!(vehicle.emergency || vehicle.blocked), sampleId: /emergency|blocked|parking|energy/.test(next.stage) ? 'safety' : vehicle.entry ? 'deposit' : 'pickup', completed: false, completionVerified: false};
    return base;
  }
  const studio = document && document.studio, education = ctx.studio && ctx.studio.education;
  const mission = studio && studio.missions && studio.missions.find(mission => mission.roomId === roomId);
  if (mission && education) {
    const progress = education.progress && education.progress.get(education.key(mission));
    const completed = !!progress && progress.status === 'completed';
    base.objective = join(mission.name || mission.title, mission.description || mission.objective);
    base.guidance = {key: mission.id + ':' + (progress && progress.status || 'ready') + ':' + (progress && progress.step || 0), text: completed ? join('Misión completada.', base.objective) : join(base.objective, 'Consulta el contenido y los controles de esta escena.'), completed, completionVerified: completed, sampleId: completed ? 'completed' : 'welcome'};
  } else base.guidance = {key: 'explore:' + roomId + ':' + (selected && selected.userData.editorId || ''), text: join(base.content, base.objective), sampleId: 'welcome', completed: false, completionVerified: false};
  return base;
}
