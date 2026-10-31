import * as THREE from 'three';
import {buildGuidanceTargets, guidanceTargetReady, guidanceForkBox, guidanceApproach, guidanceVisible, guidanceTraining, guidanceRoute, GUIDANCE_LIMIT, GUIDANCE_ROUTE_ARROWS} from './VehicleGuidancePlanner.js';

const UP = new THREE.Vector3(0, 1, 0);
const COLORS = {ready: 0x70e3b1, near: 0xefc563, blocked: 0xf17f87, target: 0x6bdbe8};
const ROUTE_COLORS = {pickup: 0x39d9ed, drop: 0xffc34d};
const ROUTE_SEGMENTS = 64, ROUTE_VERTICES = ROUTE_SEGMENTS * 6 + GUIDANCE_ROUTE_ARROWS * 3;
const EMPTY_PATH = Object.freeze({points: Object.freeze([]), blocked: false, stop: null});
const targetColor = model => model.severity === 'ready' ? COLORS.ready : model.severity === 'blocked' ? COLORS.blocked : model.phase === 'pickup' ? ROUTE_COLORS.pickup : ROUTE_COLORS.drop;
const now = () => typeof performance === 'undefined' ? Date.now() : performance.now();
const helper = object => {object.userData.editorRuntimeHelper = true; object.userData.editorHelper = true; object.raycast = () => {}; return object;};
const empty = () => ({phase: 'inactive', title: 'Guía holográfica', instruction: 'Sube a un montacargas para ver los puntos de carga y descarga.',
  targetId: '', targetName: '', targets: [], distanceM: null, bearingDeg: null, bearingText: '', severity: 'near', ready: false, routeVerified: false,
  routeNote: 'Referencia local de alineación; revisa el pasillo. No es una ruta automática.', routePath: EMPTY_PATH});
const point = object => object.getWorldPosition(new THREE.Vector3());
// Signed horizontal bearing from the vehicle's actual world +Z. This is an
// orientation hint, never a navigable path or an instruction to turn blindly.
const bearing = (record, matrix, bounds) => {
  if (!matrix || !bounds) return {bearingDeg: null, bearingText: ''};
  record.object.updateWorldMatrix(true, false);
  const offset = bounds.getCenter(new THREE.Vector3()).applyMatrix4(matrix).sub(point(record.object));
  if (Math.hypot(offset.x, offset.z) < .05) return {bearingDeg: 0, bearingText: 'Al frente'};
  const forward = new THREE.Vector3(0, 0, 1).transformDirection(record.object.matrixWorld);
  const angle = Math.atan2(offset.x, offset.z) - Math.atan2(forward.x, forward.z);
  const degrees = Math.atan2(Math.sin(angle), Math.cos(angle)) * 180 / Math.PI, magnitude = Math.abs(degrees);
  return {bearingDeg: degrees, bearingText: magnitude <= 45 ? 'Al frente' : magnitude >= 135 ? 'Detrás del vehículo' : degrees > 0 ? 'A tu derecha' : 'A tu izquierda'};
};

/** Read-only world guidance: authored manual routes, checked physical
 * corridors and exact support ghosts. No motion, custody or headset edits. */
export default class VehicleHolographicGuide {
  constructor(driving) {
    this.driving = driving; this.ctx = driving.ctx; this.simulation = driving.simulation; this.enabled = true;
    this.lastUpdate = -Infinity; this.selectedId = ''; this.state = empty(); this.targets = [];
    this.stats = {updates: 0, allocations: 0, geometries: 0, materials: 0, targets: 0, visible: false, maxTargets: GUIDANCE_LIMIT};
  }
  mount(record) {
    this.unmount(); record = record || this.driving.record(); if (!record) return;
    this.recordId = record.id; this.previousEntry = record.components.vehicle.entry;
    this.lastProduct = this.previousEntry && this.previousEntry.product; this.lastUpdate = -Infinity; this.update(true);
  }
  create() {
    if (this.root) return;
    const parent = this.ctx.editor && this.ctx.editor.hooks && this.ctx.editor.hooks.renderScene || this.ctx.renderScene || this.ctx.scene;
    if (!parent || !parent.add) return;
    this.root = helper(new THREE.Group()); this.root.name = 'Guía holográfica de carga y descarga'; this.root.matrixAutoUpdate = false; parent.add(this.root);
    this.geometries = new Set(); this.materials = new Set();
    const box = new THREE.BoxBufferGeometry(1, 1, 1), edges = new THREE.EdgesGeometry(box), plane = new THREE.PlaneBufferGeometry(1, 1);
    [box, edges, plane].forEach(value => this.geometries.add(value));
    this.palette = {};
    Object.keys(COLORS).forEach(key => {
      const line = new THREE.LineBasicMaterial({color: COLORS[key], transparent: true, opacity: key === 'target' ? .65 : .98, depthTest: true, depthWrite: false, toneMapped: false});
      const fill = new THREE.MeshBasicMaterial({color: COLORS[key], transparent: true, opacity: key === 'target' ? .025 : .045, depthTest: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1});
      line.color.convertSRGBToLinear(); fill.color.convertSRGBToLinear();
      this.palette[key] = {line, fill}; this.materials.add(line); this.materials.add(fill);
    });
    this.markers = [];
    for (let index = 0; index < GUIDANCE_LIMIT; index++) {
      const node = helper(new THREE.LineSegments(edges, this.palette.target.line)); node.visible = false; this.root.add(node); this.markers.push(node);
    }
    this.selected = helper(new THREE.Group()); this.root.add(this.selected);
    this.outline = helper(new THREE.LineSegments(edges, this.palette.near.line)); this.selected.add(this.outline);
    this.fill = helper(new THREE.Mesh(plane, this.palette.near.fill)); this.fill.rotation.x = -Math.PI / 2; this.selected.add(this.fill);
    // Expected fork positions are wire outlines, leaving the actual opaque
    // steel/amber entry tines readable instead of tinting them with solid boxes.
    this.forks = [-1, 1].map(() => {const mesh = helper(new THREE.LineSegments(edges, this.palette.near.line)); this.root.add(mesh); return mesh;});
    // Two bounded layers draw a continuous, outlined corridor and directional
    // chevrons. Buffers are allocated once; updates only replace numeric data.
    this.routeMaterial = new THREE.MeshBasicMaterial({color: 0xffffff, vertexColors: THREE.VertexColors, transparent: true, opacity: .98, depthTest: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide});
    this.routeBorderMaterial = new THREE.MeshBasicMaterial({color: 0x10252e, transparent: true, opacity: .94, depthTest: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide});
    this.routeBorderMaterial.color.convertSRGBToLinear();
    this.materials.add(this.routeMaterial); this.materials.add(this.routeBorderMaterial);
    const routeGeometry = colored => {const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(ROUTE_VERTICES * 3), 3)); if (colored) geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(ROUTE_VERTICES * 3), 3)); geometry.setDrawRange(0, 0); this.geometries.add(geometry); return geometry;};
    this.routeBorder = helper(new THREE.Mesh(routeGeometry(false), this.routeBorderMaterial)); this.root.add(this.routeBorder);
    this.arrows = helper(new THREE.Mesh(routeGeometry(true), this.routeMaterial)); this.routeArrows = this.arrows; this.root.add(this.arrows);
    const stopGeometry = new THREE.BufferGeometry(), stopVertices = [], stopColors = [], stopColor = new THREE.Color(COLORS.blocked).convertSRGBToLinear();
    for (const angle of [-Math.PI / 4, Math.PI / 4]) {
      const x = Math.cos(angle) * .42, z = Math.sin(angle) * .42, nx = -Math.sin(angle) * .065, nz = Math.cos(angle) * .065;
      for (const value of [[-x + nx, -z + nz], [x + nx, z + nz], [x - nx, z - nz], [-x + nx, -z + nz], [x - nx, z - nz], [-x - nx, -z - nz]]) {stopVertices.push(value[0], 0, value[1]); stopColors.push(stopColor.r, stopColor.g, stopColor.b);}
    }
    stopGeometry.setAttribute('position', new THREE.Float32BufferAttribute(stopVertices, 3)); stopGeometry.setAttribute('color', new THREE.Float32BufferAttribute(stopColors, 3)); this.geometries.add(stopGeometry);
    this.stopMarker = helper(new THREE.Mesh(stopGeometry, this.routeMaterial)); this.stopMarker.visible = false; this.root.add(this.stopMarker);
    this.routeColors = {pickup: new THREE.Color(ROUTE_COLORS.pickup).convertSRGBToLinear(), drop: new THREE.Color(ROUTE_COLORS.drop).convertSRGBToLinear()};
    const dom = this.driving.document;
    if (dom && dom.createElement) {
      const canvas = dom.createElement('canvas'); canvas.width = 512; canvas.height = 160;
      const context = canvas.getContext && canvas.getContext('2d');
      if (context && context.fillText && context.fillRect && context.clearRect) {
        this.labelCanvas = canvas; this.labelContext = context; this.labelTexture = new THREE.CanvasTexture(canvas); this.labelTexture.encoding = THREE.sRGBEncoding;
        this.labelTexture.minFilter = THREE.LinearFilter; this.labelTexture.generateMipmaps = false;
        const material = new THREE.MeshBasicMaterial({map: this.labelTexture, transparent: true, depthTest: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide}); this.materials.add(material);
        this.label = helper(new THREE.Mesh(plane, material)); this.label.scale.set(1.45, .45, 1); this.root.add(this.label);
      }
    }
    this.stats.allocations++; this.stats.geometries = this.geometries.size; this.stats.materials = this.materials.size;
  }
  setEnabled(value) {this.enabled = !!value; if (!this.enabled && this.root) this.root.visible = false; this.update(true); return this.enabled;}
  setTarget(id) {
    if (typeof id !== 'string' || id && !this.targets.some(target => target.id === id)) return false;
    this.selectedId = id; this.update(true); return true;
  }
  selectTarget(id) {return this.setTarget(id);}
  nextTarget() {const targets = this.targets.filter(target => target.allowed); if (!targets.length) return false; const index = targets.findIndex(target => target.id === this.selectedId); return this.setTarget(targets[(index + 1) % targets.length].id);}
  getTargets() {return this.state.targets;}
  getState() {return this.state;}
  transition(record) {
    const v = record.components.vehicle, entry = v.entry, api = this.simulation.vehicleRuntime;
    if (this.previousEntry && !entry && this.lastProduct && this.lastProduct.object.parent) {
      this.withdraw = {product: this.lastProduct, name: this.lastTargetName || 'Pallet depositado'}; this.depart = null; this.selectedId = '';
    } else if (!this.previousEntry && entry) {
      const current = this.currentTarget;
      const source = current && this.simulation.records.get(current.targetId), component = source && source.components;
      const structure = component && (component.conveyor || component.source || component.processor || component.palletQueue || component.vehicle && component.vehicle.config.family === 'cart');
      // A free pallet already rests in open floor space: lifting it does not
      // require a forced reverse manoeuvre. A station/cart does need withdrawal
      // before lowering to transport height, otherwise it may trap the forks.
      this.depart = structure ? {origin: point(record.object), yaw: current && current.dock ? current.dock.yaw : Math.atan2(new THREE.Vector3(0, 0, 1).transformDirection(record.object.matrixWorld).x, new THREE.Vector3(0, 0, 1).transformDirection(record.object.matrixWorld).z), name: current && current.name || 'Origen', matrix: current && current.matrix && current.matrix.clone(), bounds: current && current.bounds && current.bounds.clone()} : null;
      this.selectedId = ''; this.withdraw = null;
    }
    if (entry) this.lastProduct = entry.product;
    if (this.withdraw) {
      const product = this.withdraw.product; product.object.updateWorldMatrix(true, false);
      const box = product.bounds.clone().applyMatrix4(product.object.matrixWorld).expandByScalar(.025), fork = guidanceForkBox(api, record);
      if (!guidanceVisible(product.object) || !fork || !box.intersectsBox(fork)) this.withdraw = null;
    }
    if (this.depart) {
      const reverse = new THREE.Vector3(-Math.sin(this.depart.yaw), 0, -Math.cos(this.depart.yaw));
      if (point(record.object).sub(this.depart.origin).dot(reverse) >= Math.min(.85, v.config.forkLength * .8)) this.depart = null;
    }
    this.previousEntry = entry;
  }
  update(force = false, snapshot = null) {
    const record = this.driving.record && this.driving.record(), blocked = this.driving.blocked && this.driving.blocked();
    if (!record || record.id !== this.recordId || blocked || this.ctx.editor && this.ctx.editor.active) {
      if (this.root) this.root.visible = false; this.stats.visible = false; return this.state;
    }
    const runtimeAPI = this.simulation && this.simulation.vehicleRuntime;
    if (!runtimeAPI || !['rig','capacity','getDockingState','operational','pickupDock','missionDestination','dropDock'].every(name => typeof runtimeAPI[name] === 'function') || !runtimeAPI.rig(record) || !runtimeAPI.rig(record).forks || record.components.vehicle.config.family === 'cart') {
      if (this.root) this.root.visible = false; this.stats.visible = false;
      this.state = Object.assign(empty(), {phase: 'unavailable', title: 'Guía de horquillas no disponible', instruction: 'Este equipo no dispone de un sistema de horquillas compatible.'}); return this.state;
    }
    // Hologram visibility is independent from the live navigation model used
    // by the installation map. Keep targets/custody/routes fresh when hidden.
    if (this.enabled && !this.root) this.create();
    if (this.root) this.root.visible = this.enabled; this.stats.visible = !!(this.enabled && this.root);
    const time = now(), api = this.simulation.vehicleRuntime, v = record.components.vehicle, entryChanged = v.entry !== this.previousEntry;
    if (!force && !entryChanged && time - this.lastUpdate < 200) {
      if (this.state.ready && Math.abs(record.components.vehicle.actualSpeed) > .06) {this.state = Object.assign({}, this.state, {ready: false, severity: 'near', instruction: 'Detén el vehículo antes de manipular la carga.'}); this.color('near');}
      return this.state;
    }
    this.lastUpdate = time; this.stats.updates++;
    const wantedPhase = v.entry ? 'drop' : 'pickup';
    // A monitor snapshot can be stale even within the same phase after moving
    // or changing fork height. Each 5Hz planning tick reads current geometry,
    // unless its caller explicitly supplies a compatible fresh snapshot.
    if (!snapshot || snapshot.phase !== wantedPhase) snapshot = api.getDockingState(record);
    this.transition(record); this.targets = buildGuidanceTargets(this.driving, record);
    const chosen = this.targets.find(target => target.id === this.selectedId) || this.targets.find(target => target.preferred && target.allowed) || this.targets.find(target => target.allowed) || this.targets[0];
    this.currentTarget = chosen || null; const ready = !!(chosen && guidanceTargetReady(snapshot, chosen) && api.operational(v) && Math.abs(v.actualSpeed) <= .06);
    const phase = v.entry ? 'drop' : 'pickup', mission = guidanceTraining(this.driving, record);
    const targets = this.targets.map(target => Object.freeze({id: target.id, name: target.name, kind: target.kind, allowed: target.allowed, reason: target.reason, distanceM: target.distanceM}));
    const selection = this.targets[0], candidateCount = selection && selection.candidateCount || 0, selectionLimit = selection && selection.selectionLimit || GUIDANCE_LIMIT;
    let model = Object.assign(empty(), {phase, targets: Object.freeze(targets), candidateCount, selectionLimit, selectionLimited: candidateCount > selectionLimit, targetId: chosen && chosen.id || '', physicalTargetId: chosen && chosen.targetId || '', explicitTarget: !!this.selectedId, targetMatchesSnapshot: ready, targetName: chosen && chosen.name || '', distanceM: chosen ? chosen.distanceM : null,
      title: chosen ? (phase === 'drop' ? 'Descargar en ' : 'Recoger en ') + chosen.name : phase === 'drop' ? 'Sin destino compatible disponible' : 'Esperando un pallet accesible',
      instruction: chosen ? chosen.allowed ? ready ? phase === 'drop' ? 'Apoyo confirmado. Deposita la carga y retira las horquillas lentamente.' : 'Ambas horquillas apoyadas. Confirma la toma; después retira la carga del origen.' : phase === 'drop' ? 'Conduce a baja altura hacia el destino marcado. Alinea y baja hasta confirmar el apoyo.' : 'Aproxímate al frente del pallet marcado. Alinea ambas entradas con la cámara y avanza lentamente.' : chosen.reason : phase === 'drop' ? 'Conserva la carga. Espera un receptor libre compatible; el suelo no se presenta como destino autorizado.' : 'Espera al robot o a que se detenga la banda. Sólo se indican pallets compatibles.',
      severity: chosen && !chosen.allowed ? 'blocked' : ready ? 'ready' : 'near', ready});
    if (chosen && chosen.allowed && snapshot && ((phase === 'drop' && snapshot.destination && snapshot.destination.id === chosen.targetId) || phase === 'pickup' && snapshot.targetId === chosen.targetId) && !ready) model.instruction = snapshot.reason || model.instruction;
    if (this.withdraw) model = Object.assign(model, {phase: 'withdraw', title: 'Pallet depositado: retira las horquillas', instruction: 'Retrocede lentamente hasta sacar ambas horquillas; comprueba el pasillo antes de buscar otra carga.', targetName: this.withdraw.name, distanceM: null, targets: [], ready: false, severity: 'near'});
    else if (this.depart) model = Object.assign(model, {phase: 'withdraw-source', title: 'Pallet sujeto: retira del origen', instruction: 'Retrocede lentamente manteniendo la carga por encima del apoyo. Cuando esté libre, bájala a altura de transporte.', targetName: this.depart.name, distanceM: Math.max(0, Math.min(.85, v.config.forkLength * .8) - point(record.object).sub(this.depart.origin).dot(new THREE.Vector3(-Math.sin(this.depart.yaw),0,-Math.cos(this.depart.yaw)))), ready: false, severity: 'near'});
    const marked = this.withdraw ? {matrix: this.withdraw.product.object.matrixWorld, bounds: this.withdraw.product.bounds} : this.depart || chosen;
    Object.assign(model, bearing(record, marked && marked.matrix, marked && marked.bounds));
    // Missed approach arrows are guidance, not a reason to reverse out of a
    // physically correct pickup. Delivery routes remain mission requirements.
    const dockedAdvisoryPickup = !!(mission && mission.pickupRouteAdvisory && mission.phase === 'pickup' && ready && !mission.routeFault);
    this.route = chosen && chosen.allowed && !this.withdraw && !this.depart && !dockedAdvisoryPickup ? guidanceRoute(this.driving, record, mission, chosen) : null;
    if (mission && mission.routeFault) this.route = Object.assign({distanceM: 0, index: mission.waypointIndex || 0, total: Array.isArray(mission.route) ? mission.route.length : 0}, this.route || {}, {
      arrows: [], points: [], blockedAt: point(record.object).setY(v.originWorld.y + .035), blocked: true, clear: false, note: mission.status || 'Vuelve al último punto válido y recorre las flechas conduciendo.'});
    model.routePath = this.route ? Object.freeze({points: Object.freeze((this.route.points || []).map(value => Object.freeze(value.toArray()))), blocked: !!this.route.blocked, stop: this.route.blockedAt ? Object.freeze(this.route.blockedAt.toArray()) : null}) : EMPTY_PATH;
    if (!mission && this.route) Object.assign(model, {routeVerified: !!(this.route.clear && !this.route.blocked), routeNote: this.route.note, routeBlocked: !!this.route.blocked});
    if (mission) {
      const feedback = mission.feedback;
      if (feedback && feedback.id !== this.feedbackId) { this.feedbackId = feedback.id; this.feedbackUntil = time + 5000; }
      Object.assign(model, {taskId: mission.taskId, missionTitle: mission.title || '', completed: mission.completed, total: mission.total,
        stage: mission.stage, stageTitle: mission.stageTitle, score: mission.score, scoreMax: mission.scoreMax, feedback: mission.feedback,
        feedbackVisible: !!(feedback && this.feedbackUntil > time),
        locationCode: chosen && chosen.locationCode || mission.phase === 'pickup' && mission.sourceLocationCode || mission.locationCode || '',
        explicitTarget: true, routeProgress: Object.freeze({index: mission.waypointIndex || 0, total: Array.isArray(mission.route) ? mission.route.length : 0}),
        routeComplete: !!mission.routeComplete, routeDistanceM: this.route ? this.route.distanceM : 0, routeClear: !!(this.route && this.route.clear), routeBlocked: !!(this.route && this.route.blocked),
        routeNote: this.route ? this.route.note : 'Ruta guiada manual · sigue la misión y comprueba el entorno.'});
      if (mission.phase === 'complete') Object.assign(model, {phase: 'complete', title: 'Misiones completadas', instruction: mission.status || 'Todas las entregas y retiradas han sido comprobadas.', ready: false, severity: 'ready', targets: []});
      else if (mission.phase === 'error') Object.assign(model, {phase: 'error', title: 'Revisar la misión', instruction: mission.status || 'La misión no tiene una configuración válida.', ready: false, severity: 'blocked', targets: []});
      else if (this.route && this.route.blocked) Object.assign(model, {ready: false, severity: 'blocked', instruction: this.route.note});
    }
    if (model.selectionLimited) model.routeNote = 'Selección local: hasta ' + selectionLimit + ' candidatos cercanos; acércate al equipo deseado. ' + model.routeNote;
    if ((!api.operational(v) || v.parkingBrake || v.emergency) && !['complete', 'error'].includes(model.phase) && !(mission && mission.routeFault)) {model.ready = false; model.severity = 'blocked'; model.instruction = v.emergency ? 'Rearma la emergencia y comprueba el entorno.' : !v.powered ? 'Enciende el vehículo para empezar.' : !v.running ? 'Habilita la marcha y revisa el pasillo.' : 'Libera el freno de estacionamiento cuando el pasillo esté libre.';}
    this.state = Object.freeze(model); this.lastTargetName = chosen && chosen.name || this.lastTargetName;
    if (this.enabled && this.root) this.paint(record, chosen, model); return this.state;
  }
  color(severity, phase) {if (!this.palette) return; const accent = ROUTE_COLORS[phase || this.state.phase] || ROUTE_COLORS.drop; this.palette.near.line.color.setHex(accent).convertSRGBToLinear(); this.palette.near.fill.color.setHex(accent).convertSRGBToLinear(); this.palette.target.line.color.setHex(accent).convertSRGBToLinear(); const palette = this.palette[severity] || this.palette.near; this.outline.material = palette.line; this.fill.material = palette.fill; this.forks.forEach(fork => {fork.material = palette.line;});}
  paintArrows(values, points = [], phase = 'pickup') {
    const arrows = values.slice(0, GUIDANCE_ROUTE_ARROWS), path = points.slice(0, ROUTE_SEGMENTS + 1), color = this.routeColors[phase] || this.routeColors.pickup;
    const paint = (mesh, halfWidth, headWidth, headLength, offset) => {
      const geometry = mesh.geometry, attribute = geometry.attributes.position, colors = geometry.attributes.color; let count = 0;
      const vertex = (x, y, z) => {const at = count++ * 3; attribute.array[at] = x; attribute.array[at + 1] = y + offset; attribute.array[at + 2] = z; if (colors) {colors.array[at] = color.r; colors.array[at + 1] = color.g; colors.array[at + 2] = color.b;}};
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i], dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz); if (length < .01) continue;
        const nx = -dz / length * halfWidth, nz = dx / length * halfWidth;
        vertex(a.x + nx, a.y, a.z + nz); vertex(b.x + nx, b.y, b.z + nz); vertex(b.x - nx, b.y, b.z - nz);
        vertex(a.x + nx, a.y, a.z + nz); vertex(b.x - nx, b.y, b.z - nz); vertex(a.x - nx, a.y, a.z - nz);
      }
      arrows.forEach(value => {const x = value.position.x, y = value.position.y, z = value.position.z, lx = Math.cos(value.yaw) * headWidth, lz = -Math.sin(value.yaw) * headWidth, fx = Math.sin(value.yaw), fz = Math.cos(value.yaw); vertex(x - lx - fx * .13, y, z - lz - fz * .13); vertex(x + fx * headLength, y, z + fz * headLength); vertex(x + lx - fx * .13, y, z + lz - fz * .13);});
      attribute.needsUpdate = true; if (colors) colors.needsUpdate = true; geometry.setDrawRange(0, count); if (count) geometry.computeBoundingSphere(); mesh.visible = count > 0;
    };
    paint(this.routeBorder, .15, .31, .46, 0); paint(this.arrows, .085, .23, .38, .004);
    this.stats.routeArrows = arrows.length; this.stats.routeSegments = Math.max(0, path.length - 1); this.stats.routeDrawCalls = this.arrows.visible ? 2 : 0;
  }
  paintStatusLabel(record, model) {
    if (!this.label || !this.ctx.vrMode || !['complete', 'error'].includes(model.phase) || !Number.isFinite(model.total)) return;
    // Reuse the existing information label, not an invented cargo target.
    // Its anchor follows the physical chassis; tracked headset pose stays read-only.
    const forward = new THREE.Vector3(0, 0, 1).transformDirection(record.object.matrixWorld), right = new THREE.Vector3(1, 0, 0).transformDirection(record.object.matrixWorld);
    this.label.visible = true; this.label.position.copy(point(record.object)).addScaledVector(forward, 2.5).addScaledVector(right, 1);
    this.label.position.y = record.components.vehicle.originWorld.y + 1.7;
    if (this.ctx.camera) this.label.lookAt(point(this.ctx.camera));
    const signature = ['status', model.phase, model.completed, model.total, model.instruction, model.score].join('|');
    if (signature === this.labelText) return;
    this.labelText = signature; const c = this.labelContext;
    c.clearRect(0, 0, 512, 160); c.fillStyle = '#0c202bdd'; c.fillRect(0, 0, 512, 160);
    c.fillStyle = '#' + targetColor(model).toString(16).padStart(6, '0'); c.font = 'bold 25px sans-serif'; c.fillText(model.title.slice(0, 35), 18, 40);
    c.fillStyle = '#e7f3f3'; c.font = '23px sans-serif'; c.fillText(model.completed + ' / ' + model.total + ' misiones' + (model.scoreMax > 0 ? ' · ' + model.score + '/' + model.scoreMax + ' pt' : ' verificadas'), 18, 85);
    c.font = '18px sans-serif'; c.fillText((model.instruction || '').slice(0, 49), 18, 130); this.labelTexture.needsUpdate = true;
  }
  paint(record, target, model) {
    const parent = this.root.parent; parent.updateWorldMatrix(true, false); this.root.matrix.getInverse(parent.matrixWorld); this.root.matrixWorldNeedsUpdate = true;
    this.markers.forEach((marker, index) => {
      const candidate = this.targets[index]; marker.visible = !!(candidate && candidate.allowed && candidate.matrix && candidate !== target && !this.withdraw && !this.depart);
      if (!marker.visible) return;
      const size = candidate.bounds.getSize(new THREE.Vector3()), center = candidate.bounds.getCenter(new THREE.Vector3());
      marker.matrixAutoUpdate = false; marker.matrix.copy(candidate.matrix).multiply(new THREE.Matrix4().compose(center, new THREE.Quaternion(), size)); marker.matrixWorldNeedsUpdate = true;
    });
    const released = this.withdraw && this.withdraw.product;
    const matrix = released ? released.object.matrixWorld : this.depart ? this.depart.matrix : target && target.matrix, bounds = released ? released.bounds : this.depart ? this.depart.bounds : target && target.bounds;
    this.selected.visible = !!(matrix && bounds); this.forks.forEach(fork => {fork.visible = !!(target && target.allowed && target.dock && !this.withdraw && !this.depart);});
    // Desktop objectives live in their own panel; keep the work area clear.
    // An immersive headset still needs the spatial label because DOM is hidden.
    this.arrows.visible = this.routeBorder.visible = this.stopMarker.visible = false; this.arrows.geometry.setDrawRange(0, 0); this.routeBorder.geometry.setDrawRange(0, 0); this.stats.routeArrows = this.stats.routeSegments = this.stats.routeDrawCalls = 0; if (this.label) this.label.visible = this.selected.visible && !!this.ctx.vrMode;
    if (!matrix || !bounds) {this.paintStatusLabel(record, model); this.stats.targets = this.targets.length; this.root.updateWorldMatrix(true, true); return;}
    const center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
    this.selected.matrixAutoUpdate = false; this.selected.matrix.copy(matrix); this.selected.matrixWorldNeedsUpdate = true;
    this.outline.position.copy(center); this.outline.scale.copy(size).addScalar(.035); this.fill.visible = !this.depart; this.fill.position.set(center.x, bounds.min.y + .018, center.z); this.fill.scale.set(size.x + .05, size.z + .05, 1); this.color(model.severity, model.phase);
    if (target && target.allowed && target.dock && !this.withdraw && !this.depart) {
      const c = record.components.vehicle.config, rig = this.simulation.vehicleRuntime.rig(record), tool = record.object.worldToLocal(point(rig.forks)), scale = record.object.getWorldScale(new THREE.Vector3()), yaw = target.dock.yaw;
      const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), lateral = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const heel = target.dock.position.clone().addScaledVector(forward, tool.z * Math.abs(scale.z)).addScaledVector(lateral, tool.x * Math.abs(scale.x)); heel.y = target.dock.toolY;
      this.forks.forEach((fork, index) => {fork.position.copy(heel).addScaledVector(lateral, (index ? 1 : -1) * c.forkSpread * Math.abs(scale.x) / 2).addScaledVector(forward, c.forkLength * Math.abs(scale.z) / 2); fork.position.y -= c.forkThickness / 2; fork.rotation.y = yaw; fork.scale.set(c.forkWidth * Math.abs(scale.x), Math.max(.018, c.forkThickness), c.forkLength * Math.abs(scale.z));});
      if (this.route && (this.route.arrows.length || this.route.points && this.route.points.length > 1)) {
        this.paintArrows(this.route.arrows, this.route.points || [], model.phase);
      } else if (!this.route || model.routeComplete && !this.route.blocked) {
        const approach = guidanceApproach(this.driving, record, target);
        if (approach) this.paintArrows([-1.75, -1.10, -.45].map(z => ({position: target.dock.position.clone().addScaledVector(forward, z).setY(approach.y), yaw: approach.yaw})), [approach.start.clone().setY(approach.y), approach.end.clone().setY(approach.y)], model.phase);
      }
      if (this.route && this.route.blocked && this.route.blockedAt) {this.stopMarker.visible = true; this.stopMarker.position.copy(this.route.blockedAt); this.stopMarker.position.y += .008; this.stats.routeDrawCalls++;}
    }
    if (this.label) {
      const labelPosition = center.clone(); labelPosition.y = bounds.max.y + .45; labelPosition.applyMatrix4(matrix); this.label.position.copy(labelPosition);
      if (this.ctx.camera) this.label.lookAt(point(this.ctx.camera));
      const text = [model.title, Number.isFinite(model.distanceM) ? model.distanceM.toFixed(1) : '', model.severity, model.taskId, model.phase, model.completed, model.locationCode, model.routeProgress && model.routeProgress.index, model.routeBlocked, model.score, model.stage, model.feedbackVisible && model.feedback.id].join('|');
      if (text !== this.labelText) {
        this.labelText = text; const c = this.labelContext; c.clearRect(0, 0, 512, 160); c.fillStyle = '#0c202bdd'; c.fillRect(0, 0, 512, 160); c.fillStyle = '#' + targetColor(model).toString(16).padStart(6, '0');
        c.font = 'bold 23px sans-serif'; c.fillText((model.taskId ? (model.completed + 1) + '/' + model.total + ' · ' + model.missionTitle : model.title).slice(0, 38), 18, 35);
        c.font = '20px sans-serif'; c.fillStyle = '#e7f3f3'; c.fillText(model.locationCode || (model.phase === 'drop' ? 'Depósito en la zona marcada' : 'Recogida del pallet indicado'), 18, 70);
        c.font = '19px sans-serif'; c.fillText(model.scoreMax > 0 ? model.stageTitle + ' · ' + model.score + '/' + model.scoreMax + ' pt' : model.taskId ? 'Ruta ' + model.routeProgress.index + '/' + model.routeProgress.total + ' · ' + model.routeDistanceM.toFixed(1) + ' m restantes' : Number.isFinite(model.distanceM) ? model.distanceM.toFixed(1) + ' m · orientación local' : 'Orientación local', 18, 105);
        const feedback = model.feedbackVisible && model.feedback;
        c.font = '18px sans-serif'; c.fillText((feedback ? (feedback.points > 0 ? '+' : '') + feedback.points + ' pt · ' + feedback.message : model.routeBlocked ? 'Ruta bloqueada: frena y revisa el pasillo' : model.ready ? 'Posición confirmada · usa los controles' : /^withdraw/.test(model.phase) ? 'Retrocede hasta liberar ambas horquillas' : 'Conducción manual · comprueba el entorno').slice(0, 49), 18, 141); this.labelTexture.needsUpdate = true;
      }
    }
    this.stats.targets = this.targets.length; this.root.updateWorldMatrix(true, true);
  }
  unmount() {
    if (this.root && this.root.parent) this.root.parent.remove(this.root); if (this.geometries) this.geometries.forEach(value => value.dispose()); if (this.materials) this.materials.forEach(value => value.dispose()); if (this.labelTexture) this.labelTexture.dispose();
    this.root = null; this.label = null; this.labelTexture = null; this.labelText = ''; this.geometries = null; this.materials = null; this.markers = []; this.targets = []; this.state = empty();
    this.recordId = ''; this.previousEntry = null; this.lastProduct = null; this.currentTarget = null; this.withdraw = null; this.depart = null; this.route = null; this.routeArrows = this.routeBorder = this.stopMarker = null; this.routeMaterial = this.routeBorderMaterial = this.routeColors = null; this.lastUpdate = -Infinity; this.selectedId = ''; this.stats.visible = false; this.stats.targets = this.stats.geometries = this.stats.materials = this.stats.routeArrows = this.stats.routeSegments = this.stats.routeDrawCalls = 0;
    this.feedbackId = null; this.feedbackUntil = 0;
  }
  dispose() {this.unmount();}
}
