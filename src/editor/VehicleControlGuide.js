// Shared presentation metadata and read-only coaching. The vehicle runtime
// remains responsible for command validation, physical movement and custody.
const command = (action, label, code, key, vr, section = 'operation', shift = false, capability = '') =>
  Object.freeze({action, label, code, key, shift, vr, section, capability, continuous: false});
const hold = (action, label, code, key, vr, capability = '') =>
  Object.freeze({action, label, code, key, shift: false, vr, section: 'movement', capability, continuous: true});
const ACTIONS = Object.freeze([
  command('powerOn', 'Encender', 'KeyB', 'B', 'Botón Encender de la cabina'),
  command('start', 'Marcha', 'KeyV', 'V', 'Botón Marcha de la cabina'),
  command('powerOff', 'Apagar', 'KeyB', 'Shift+B', 'Botón Apagar de la cabina', 'operation', true),
  command('stop', 'Detener', 'KeyV', 'Shift+V', 'Botón Parar de la cabina', 'operation', true),
  command('pause', 'Pausar / reanudar', 'KeyP', 'Shift+P', 'Botón Pausa de la cabina', 'operation', true),
  command('parkingBrake', 'Freno de estacionamiento', 'KeyP', 'P', 'Mando Freno P de la cabina'),
  command('emergency', 'Emergencia', 'KeyY', 'Y', 'Pulsador rojo de emergencia', 'safety'),
  command('resetEmergency', 'Rearmar emergencia', 'KeyY', 'Shift+Y', 'Botón Rearmar de la cabina', 'safety', true),
  command('pickup', 'Tomar carga', 'KeyG', 'G', 'Botón Tomar carga del panel', 'cargo', false, 'cargo'),
  command('release', 'Depositar carga', 'KeyK', 'K', 'Botón Depositar del panel', 'cargo', false, 'cargo'),
  command('depositIntent', 'Preparar depósito', 'KeyK', 'Shift+K', 'Botón táctil Preparar depósito', 'cargo', true, 'cargo'),
  command('couple', 'Enganchar remolque', 'KeyI', 'I', 'Botón Enganchar del panel', 'cargo', false, 'hitch'),
  command('uncouple', 'Desenganchar remolque', 'KeyI', 'Shift+I', 'Botón Desenganchar del panel', 'cargo', true, 'hitch'),
  command('horn', 'Bocina', 'KeyH', 'H', 'Pulsador de bocina'),
  command('lights', 'Luces', 'KeyN', 'N', 'Interruptor de luces'),
  command('forkCamera', 'Cámara frontal y retrovisor', 'KeyC', 'C', 'Botón Cámara del monitor de alineación', 'view', false, 'forks'),
  command('forkCameraMode', 'Vista frontal / puntas', 'KeyC', 'Shift+C', 'Botón Frontal / Puntas del monitor', 'view', true, 'forks'),
  command('forkCameraSide', 'Lado de la cámara auxiliar', 'KeyN', 'Shift+N', 'Botón Lado del monitor de alineación', 'view', true, 'forks'),
  command('view', 'Vista cabina / seguimiento', 'KeyM', 'M', 'Vista del puesto de conducción', 'view'),
  command('mode', 'Modo hidráulico', 'KeyM', 'Shift+M', 'Botón Modo hidráulico para los sticks alternativos', 'movement', true, 'hydraulics'),
  command('dockingHelp', 'Guía de alineación', 'KeyH', 'Shift+H', 'Botón Guía del monitor de alineación', 'view', true, 'cargo'),
  command('cursor', 'Alternar cursor / mirada', 'Tab', 'Tab', 'Apuntar con el mando y pulsar el gatillo', 'view'),
  command('exit', 'Bajar del vehículo', 'KeyF', 'F', 'Botón B del mando derecho, con el vehículo detenido', 'operation'),
  hold('driveForward', 'Avanzar', 'KeyW', 'W', 'Acelerador o timón; stick izquierdo como alternativa'),
  hold('driveReverse', 'Retroceder', 'KeyS', 'S', 'Inversor y acelerador; stick izquierdo hacia atrás como alternativa'),
  hold('steerLeft', 'Girar a la izquierda', 'KeyA', 'A', 'Acercar el mando al volante, mantener agarre y girar a la izquierda'),
  hold('steerRight', 'Girar a la derecha', 'KeyD', 'D', 'Acercar el mando al volante, mantener agarre y girar a la derecha'),
  hold('brake', 'Frenar', 'Space', 'Espacio', 'Freno del puesto de conducción'),
  hold('liftUp', 'Elevar carga', 'KeyQ', 'Q', 'Mantener agarre en la palanca de elevación y elevar', 'lift'),
  hold('liftDown', 'Bajar carga', 'KeyE', 'E', 'Mantener agarre en la palanca de elevación y bajar', 'lift'),
  hold('tiltBack', 'Inclinar atrás', 'KeyR', 'R', 'Palanca de inclinación hacia el operador con agarre', 'tilt'),
  hold('tiltForward', 'Inclinar adelante', 'KeyT', 'T', 'Palanca de inclinación hacia delante con agarre', 'tilt'),
  hold('retract', 'Retraer', 'KeyZ', 'Z', 'Palanca de alcance con agarre', 'reach'),
  hold('extend', 'Extender', 'KeyX', 'X', 'Palanca de alcance con agarre', 'reach'),
  hold('sideLeft', 'Desplazar carga a la izquierda', 'KeyJ', 'J', 'Palanca de desplazamiento lateral con agarre', 'sideShift'),
  hold('sideRight', 'Desplazar carga a la derecha', 'KeyL', 'L', 'Palanca de desplazamiento lateral con agarre', 'sideShift'),
  hold('turretLeft', 'Girar torreta −', 'KeyU', 'U', 'Palanca de torreta con agarre', 'turret'),
  hold('turretRight', 'Girar torreta +', 'KeyO', 'O', 'Palanca de torreta con agarre', 'turret')
]);
const BY_ACTION = new Map(ACTIONS.map(value => [value.action, value]));
const finite = value => typeof value === 'number' && Number.isFinite(value);
const HYDRAULICS = {lift: 'maxLift', tilt: 'tiltLimit', reach: 'maxReach', sideShift: 'maxSideShift', turret: 'turretLimit'};
function axisEnabled(key, features, config) { return features[key] === true && (!HYDRAULICS[key] || config[HYDRAULICS[key]] === undefined || config[HYDRAULICS[key]] > 0); }
function supported(definition, features, config) {
  const key = definition.capability;
  if (!key) return true;
  if (key === 'cargo') return !!(features.forks || features.platform);
  if (key === 'hitch') return !!(features.hitch || config.maxTowKg > 0);
  if (key === 'hydraulics') return Object.keys(HYDRAULICS).some(key => axisEnabled(key, features, config));
  return axisEnabled(key, features, config);
}
function controls(action, xr, features) {
  const pairs = {alignYaw: ['A / D', 'Mantener agarre en el volante y corregir el rumbo'], alignLateral: features.sideShift ? ['J / L', 'Palanca de desplazamiento lateral con agarre'] : ['A / D', 'Volante o timón con agarre'],
    alignHeight: ['Q / E', 'Palanca de elevación con agarre'], alignTilt: ['R / T', 'Palanca de inclinación con agarre']};
  const definition = BY_ACTION.get(action);
  return definition ? xr ? definition.vr : definition.key : pairs[action] ? pairs[action][xr ? 1 : 0] : '';
}

export default class VehicleControlGuide {
  static get actions() { return ACTIONS; }
  static definitions(features = {}, config = {}) { return ACTIONS.filter(value => value.action !== 'forkCameraSide' && supported(value, features, config)); }
  static shortcut(event = {}) {
    const target = event.target || {};
    if (event.ctrlKey || event.altKey || event.metaKey || event.repeat || event.isComposing || target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName || '')) return null;
    const definition = ACTIONS.find(value => !value.continuous && value.code === event.code && value.shift === !!event.shiftKey);
    return definition ? definition.action : null;
  }
  static actionLabel(action, xr = false) {
    const definition = BY_ACTION.get(action);
    return definition ? definition.label + ' · ' + (xr ? definition.vr : definition.key) : String(action || '');
  }

  /** Caller supplies the actual component and its already-cached docking
   * snapshot at the HUD cadence (5 Hz). No world queries or commands here. */
  evaluate({vehicle, features = {}, docking = null, blocked = false, blockedReason = '', xr = false, intent = 'auto'} = {}) {
    const config = vehicle && vehicle.config || {}, definition = action => BY_ACTION.get(action);
    features = Object.assign({}, features);
    Object.keys(HYDRAULICS).forEach(key => { features[key] = axisEnabled(key, features, config); });
    const model = (stage, title, instruction, action = null, reason = '', canAct = false) => {
      if (action && definition(action) && !supported(definition(action), features, config)) {action = null; canAct = false;}
      return {stage, title, instruction, action, control: controls(action, xr, features), reason: String(reason || ''), canAct: !!canAct};
    };
    if (!vehicle || vehicle.enabled === false || config.enabled === false) return model('unavailable', 'Sin vehículo disponible', 'Selecciona un vehículo operativo para mostrar sus controles.');
    if (blocked) return model('blocked', 'Controles bloqueados', 'Cierra el menú o reanuda la simulación para continuar.', null, blockedReason || 'La sesión no permite conducir en este momento.');
    const speed = finite(vehicle.actualSpeed) ? Math.abs(vehicle.actualSpeed) : null, stopped = speed !== null && speed <= .06;
    if (vehicle.emergency) return model('emergency', 'Emergencia activa', stopped ? 'Comprueba el entorno y rearma; después habilita la marcha.' : 'Frena y espera a que el vehículo se detenga antes de rearmar.', 'resetEmergency', vehicle.warning, stopped);
    if (finite(vehicle.batteryPercent) && vehicle.batteryPercent <= 0) return model('energy', 'Energía agotada', 'Repón la energía del equipo antes de iniciar la marcha.', null, 'La batería no permite operar.');
    if (!vehicle.powered) return model('power', features.manual ? 'Habilitar equipo manual' : 'Encender el vehículo', features.manual ? 'Habilita los mandos de simulación; este equipo no tiene motor de tracción.' : 'Enciende el equipo; la marcha y el freno se comprueban después.', 'powerOn', '', true);
    if (!vehicle.running) return model('start', 'Habilitar la marcha', 'Pulsa Marcha y conserva el freno hasta comprobar el pasillo.', 'start', '', true);
    if (vehicle.paused) return model('paused', 'Vehículo en pausa', 'Reanuda los mandos cuando el área esté libre.', 'pause', '', true);
    if (vehicle.parkingBrake) return model('parking', 'Freno de estacionamiento activo', 'Comprueba que el pasillo esté libre y libera el freno para desplazarte.', 'parkingBrake', '', true);
    if (speed === null) return model('waiting', 'Esperando estado de movimiento', 'Espera una lectura válida antes de tomar o depositar cargas.');
    if (vehicle.towedBy) return model('towed', 'Equipo remolcado', 'Opera el tractor que lleva este equipo; no conduzcas ambos a la vez.');
    if (vehicle.blocked || vehicle.missionObstacle) return model('obstacle', 'Paso bloqueado', 'Frena y revisa el obstáculo o la carga antes de continuar.', 'brake', vehicle.warning || vehicle.missionStatus, true);
    const attached = !!vehicle.entry, stability = docking && docking.stability || {}, reason = docking && docking.reason || vehicle.warning || '';
    const capacity = stability.capacityKg, load = stability.loadKg, overloaded = finite(capacity) && finite(load) && load > capacity + 1e-6;
    const pose = vehicle.pose || {};
    const lift = config.family === 'telehandler' && finite(pose.boomAngle) && finite(config.boomLength) ? Math.max(0, (config.boomLength + (finite(pose.reach) ? pose.reach : 0)) * Math.sin(pose.boomAngle)) :
      finite(pose.lift) ? pose.lift : finite(vehicle.liftHeight) ? vehicle.liftHeight : finite(vehicle.lift) ? vehicle.lift : 0;
    const carry = Math.min(finite(config.maxLift) ? config.maxLift : Infinity, finite(config.carryLift) ? config.carryLift : .25);
    if (attached && speed > .6 && (stability.raised || lift > .6 || stability.turnSpeedLimited)) return model('slow', 'Reduce la velocidad', 'Mantén una marcha lenta con carga elevada o durante el giro.', 'brake', 'La carga elevada reduce la estabilidad.', true);
    if (!stopped && docking && (!attached && docking.targetId || attached && (docking.destination || intent === 'deposit'))) return model('stop-to-dock', 'Detener para manipular la carga', 'Frena suavemente hasta detenerte antes de tomar o depositar.', 'brake', reason, true);
    if (attached && intent === 'transport') {
      if (overloaded) return model('capacity', 'Capacidad insuficiente', 'Mantén el vehículo detenido y busca un apoyo seguro para descargar.', null, reason);
      if (features.lift && lift < carry - .025) return model('lift-to-travel', 'Carga tomada: elevar para transporte', stopped ? 'Eleva sólo hasta la altura de transporte configurada y comprueba el apoyo.' : 'Frena antes de ajustar la elevación de transporte.', stopped ? 'liftUp' : 'brake', reason, true);
      if (features.lift && lift > carry + .20) return model('lower-to-travel', 'Bajar a altura de transporte', stopped ? 'Baja la carga antes de circular por el pasillo.' : 'Frena antes de bajar la carga a la altura de transporte.', stopped ? 'liftDown' : 'brake', reason, true);
      return model('transport', 'Carga lista para transportar', 'Conduce suavemente hacia el receptor; al llegar selecciona Preparar depósito para revisar el apoyo.', 'depositIntent', reason, true);
    }
    if (attached && docking && docking.phase === 'drop' && docking.ready === true && stopped) return model('release-ready', 'Apoyo confirmado para depositar', 'Deposita sobre el apoyo confirmado; después retira las horquillas lentamente.', 'release', reason, true);
    if (overloaded) return model('capacity', 'Capacidad insuficiente', attached ? 'Mantén el vehículo detenido y busca un apoyo seguro para descargar.' : 'Selecciona una carga compatible con la capacidad disponible.', null, reason || 'La masa supera la capacidad para esta altura y alcance.');
    if (attached && intent !== 'deposit' && features.lift && lift < carry - .025) return model('lift-to-travel', 'Carga tomada: elevar para transporte', 'Eleva sólo hasta la altura de transporte configurada y comprueba el apoyo.', 'liftUp', reason, true);
    if (attached && intent !== 'deposit' && features.lift && lift > carry + .20 && !(docking && docking.destination)) return model('lower-to-travel', 'Bajar a altura de transporte', 'Baja la carga antes de circular por el pasillo.', 'liftDown', reason, true);
    if (features.hitch && !features.forks && !features.platform) {
      if (vehicle.trailerId) return model('towing', 'Remolque enganchado', 'Revisa el espacio de giro y conduce suavemente por el pasillo.', 'driveForward', vehicle.warning, true);
      return model('hitch', 'Alinear enganche de remolque', 'Acerca y alinea el enganche; el equipo comprobará distancia y compatibilidad al solicitarlo.', 'couple', vehicle.warning, stopped);
    }
    if (!(features.forks || features.platform)) return model('travel', 'Listo para conducir', 'Comprueba el pasillo y utiliza el volante o timón para desplazarte.', 'driveForward', vehicle.warning, true);
    if (!docking) return model('inspect', 'Esperando guía de carga', 'Localiza una carga compatible y espera la comprobación de alineación.');
    if (!attached && docking.phase === 'pickup' && docking.ready === true && stopped) return model('pickup-ready', 'Ambas horquillas apoyadas', 'Confirma la toma de la carga; después elévala para transportarla.', 'pickup', reason, true);
    if (!docking.targetId && !attached) return model('approach', 'Buscar una carga compatible', features.manual ? 'Acerca el timón lentamente hasta alinear las horquillas con el pallet.' : 'Aproxímate lentamente al frente de un pallet; utiliza la cámara auxiliar para centrar las entradas.', 'driveForward', reason, true);
    if (attached && intent === 'deposit' && features.lift && !docking.destination && /baja|nivela|apoyo|superficie|piso/i.test(reason)) return model('lower-to-support', 'Preparar el apoyo de depósito', 'Baja y nivela lentamente sobre una superficie libre; espera la confirmación antes de depositar.', 'liftDown', reason, stopped);
    if (docking.severity === 'blocked') return model('docking-blocked', 'Revisar antes de manipular', (attached ? 'Conserva la carga' : 'Mantén el vehículo detenido') + ' y corrige la condición indicada.', null, reason);
    const errors = docking.errors || {}, clearance = docking.clearances || {}, insertion = docking.insertion || {};
    if (finite(clearance.forkGapM) && clearance.forkGapM < 0 || finite(clearance.verticalM) && clearance.verticalM < 0) return model('fork-clearance', 'Horquillas fuera de los huecos', 'Revisa separación, altura e inclinación; ambas horquillas deben caber completamente.', null, reason);
    if (finite(errors.yawRad) && Math.abs(errors.yawRad) > .08) return model('align-yaw', 'Alinear el rumbo', 'Alinea las dos horquillas con las entradas antes de avanzar.', 'alignYaw', reason, true);
    if (finite(errors.lateralM) && Math.abs(errors.lateralM) > .04) return model('align-lateral', 'Centrar las dos horquillas', features.sideShift ? 'Corrige el desplazamiento lateral hasta centrar ambos huecos.' : 'Corrige la posición del vehículo sin forzar la entrada al pallet.', 'alignLateral', reason, true);
    if (features.lift && finite(errors.verticalM) && Math.abs(errors.verticalM) > .015) return model('align-height', 'Ajustar la altura de entrada', 'Ajusta la elevación hasta que ambas horquillas entren libres; confirma visualmente el apoyo.', 'alignHeight', reason, true);
    if (!attached && finite(insertion.requiredM) && insertion.requiredM > 0 && finite(insertion.actualM) && insertion.actualM < insertion.requiredM) return model('insert', 'Completar la inserción', 'Avanza muy lentamente hasta alcanzar el apoyo requerido; todavía no tomes la carga.', 'driveForward', reason, true);
    if (attached) return model('transport', 'Carga sujeta', 'Transporta a baja altura y aproxima la carga a un destino libre; deposita sólo cuando el apoyo esté confirmado.', null, reason);
    return model('confirm', 'Esperar confirmación de apoyo', 'Comprueba la guía y la cámara; toma la carga sólo cuando ambas horquillas estén apoyadas.', null, reason);
  }
}
