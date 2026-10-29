import * as THREE from 'three';
import conveyorLayout from '../schema/conveyors.js';

const UP = new THREE.Vector3(0, 1, 0);
const NO_RAYCAST = () => {};
const FREE_COLOR = 0xffd54a;
const CONNECTED_COLOR = 0x86e7cf;
const EPSILON = 1e-7;

function visible(object) {
  for (let node = object; node; node = node.parent) if (node.visible === false) return false;
  return true;
}

function id(object) { return object && object.userData && object.userData.editorId; }
function linkKeys(port) { return port === 'branch' ? ['branchId', 'branchPort'] : ['outputId', 'outputPort']; }
function samePair(a, b) { return a && b && a.source === b.source && a.sourcePort === b.sourcePort && a.target === b.target && a.targetPort === b.targetPort; }
function changedTransform(a, b) {
  return a.position.distanceToSquared(b.position) > EPSILON * EPSILON ||
    1 - Math.abs(a.quaternion.dot(b.quaternion)) > EPSILON || a.scale.distanceToSquared(b.scale) > EPSILON * EPSILON;
}
function reflowPose(object) {
  return {position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone()};
}
function reflowMatrix(pose, parent) {
  return new THREE.Matrix4().compose(pose.position, pose.quaternion, pose.scale).premultiply(parent);
}
function reflowMatrixEqual(a, b, tolerance = 1e-6) {
  return a.elements.every((value, index) => Number.isFinite(value) && Math.abs(value - b.elements[index]) <= tolerance);
}
function reflowTopology(edges) {
  return edges.map(edge => [id(edge.source), edge.sourcePort, edge.targetId || id(edge.target), edge.targetPort].join('|')).sort().join('\n');
}
function reflowAdjacency(edges) {
  const adjacency = new Map();
  edges.forEach(edge => [edge.source, edge.target].forEach(object => {
    if (!object) return;
    if (!adjacency.has(object)) adjacency.set(object, []);
    adjacency.get(object).push(edge);
  }));
  return adjacency;
}

/** Authoring helpers and magnetic port connections. The editor owns the undo transaction. */
export default class ConveyorAssembly {
  constructor(editor) {
    this.editor = editor;
    this.enabled = true;
    this.previewDistance = 1.5;
    this.snapDistance = 0.26;
    this.releaseDistance = 0.52;
    this.drag = null;
    this.candidate = null;
    this.helperGroup = null;
    this.markers = new Map();
    this.suppressedPairs = new Map();
  }

  config(object) {
    if (!object) return undefined;
    if (this.configCache && this.configCache.has(object)) return this.configCache.get(object);
    const config = this.editor.document.getBehaviors(object).find(value => ['conveyor', 'source', 'processor', 'palletQueue'].includes(value.type));
    if (this.configCache) this.configCache.set(object, config);
    return config;
  }

  supported(object) { return !!this.config(object); }

  /** Transport modules, product queues and processing stations share physical flow ports. */
  ports(value) {
    const config = value && value.isObject3D ? this.config(value) : value;
    if (!config) return {};
    if (config.type === 'conveyor') return conveyorLayout.ports(config);
    const layout = config.type === 'palletQueue' ? conveyorLayout.palletQueueLayout(config) :
      config.type === 'processor' ? conveyorLayout.processorLayout(config) : conveyorLayout.sourceLayout(config);
    return {
      input: Object.assign({y: 0, z: 0, tx: 1, tz: 0}, layout.input || layout.inlet, {incoming: true, route: 'main'}),
      output: Object.assign({y: 0, z: 0, tx: 1, tz: 0}, layout.output || layout.outlet, {incoming: false, route: 'main'})
    };
  }

  connections(value) {
    const config = value && value.isObject3D ? this.config(value) : value;
    if (!config) return [];
    // Sources, FIFO buffers and processors have one outgoing connection.
    // Conveyor T modules retain their independent branch connection.
    return conveyorLayout.connections(config);
  }

  withSnapshot(callback) {
    if (this.configCache) return callback();
    this.configCache = new Map(); this.recordCache = null;
    try { return callback(); } finally { this.configCache = null; this.recordCache = null; }
  }

  records() {
    if (this.recordCache) return this.recordCache;
    const objects = this.editor.document.getObjects(this.editor.roomId).filter(object => this.config(object));
    const set = new Set(objects);
    // A prefab's content is not another machine, even if a custom importer
    // also registered its descendants as editable objects.
    const result = objects.filter(object => {
      for (let node = object.parent; node; node = node.parent) if (set.has(node)) return false;
      return true;
    });
    // Explicit-detach hysteresis is temporary UI state; never keep removed or
    // unloaded machines alive when a project/room changes.
    const live = this.editor.document;
    this.suppressedPairs.forEach((pair, key) => {
      if (live.getObject && (live.getObject(id(pair.source)) !== pair.source || live.getObject(id(pair.target)) !== pair.target)) this.suppressedPairs.delete(key);
    });
    if (this.configCache) this.recordCache = result;
    return result;
  }

  usable(object) {
    const config = this.config(object);
    if (!config || config.enabled === false || !visible(object)) return false;
    object.updateWorldMatrix(true, false);
    return Number.isFinite(object.matrixWorld.determinant()) && object.matrixWorld.determinant() > EPSILON;
  }

  worldPort(object, name) {
    const config = this.config(object), port = config && this.ports(config)[name];
    if (!port) return null;
    object.updateWorldMatrix(true, false);
    const matrix = new THREE.Matrix3().setFromMatrix4(object.matrixWorld);
    const tangent = new THREE.Vector3(port.tx, Number.isFinite(port.ty) ? port.ty : 0, port.tz).applyMatrix3(matrix);
    const normal = new THREE.Vector3(0, 1, 0).applyMatrix3(matrix);
    const cross = new THREE.Vector3(-port.tz, 0, port.tx).applyMatrix3(matrix);
    const localWidth = Number.isFinite(port.width) ? port.width : config.type === 'palletQueue' ? conveyorLayout.palletQueueLayout(config).width :
      config.type === 'source' ? conveyorLayout.sourceLayout(config).width :
      config.type === 'processor' ? conveyorLayout.processorLayout(config).width : config.width;
    const width = localWidth * cross.length();
    if (!Number.isFinite(width) || width <= EPSILON || tangent.lengthSq() < EPSILON || normal.lengthSq() < EPSILON) return null;
    return {
      object, name, incoming: port.incoming, surface: port.surface, loadClass: port.loadClass,
      direction: port.direction, coordination: port.coordination || [],
      position: new THREE.Vector3(port.x, Number.isFinite(port.y) ? port.y : object.userData.editorConveyorTop || 0, port.z).applyMatrix4(object.matrixWorld),
      tangent: tangent.normalize(), up: normal.normalize(), width
    };
  }

  edges(objects = this.records()) {
    const result = [], byId = new Map(objects.map(object => [id(object), object]));
    objects.forEach(source => this.connections(source).forEach(link => {
      result.push({source, sourcePort: link.port, target: byId.get(link.targetId) || null,
        targetId: link.targetId, targetPort: link.targetPort});
    }));
    return result;
  }

  pair(moving, movingPort, fixed, fixedPort, knownPorts) {
    if (moving === fixed || !knownPorts && (!this.usable(moving) || !this.usable(fixed))) return null;
    const a = knownPorts ? knownPorts.moving : this.worldPort(moving, movingPort), b = knownPorts ? knownPorts.fixed : this.worldPort(fixed, fixedPort);
    if (!a || !b || a.incoming === b.incoming) return null;
    // Only yaw is changed by the magnet. A declared incline may have a pitched
    // tangent, while its supports remain upright. It needs a matching tangent
    // at the other end; proximity alone cannot invent a transition or lift.
    const bothConveyors = this.config(moving).type === 'conveyor' && this.config(fixed).type === 'conveyor';
    if (a.up.dot(UP) < 0.98 || b.up.dot(UP) < 0.98 || a.up.dot(b.up) < 0.995 ||
      Math.abs(a.tangent.y - b.tangent.y) > 0.025 ||
      bothConveyors && Math.abs(a.width - b.width) > Math.max(0.08, Math.min(a.width, b.width) * 0.12)) return null;
    const yaw = new THREE.Quaternion().setFromAxisAngle(UP, Math.atan2(a.tangent.z, a.tangent.x) - Math.atan2(b.tangent.z, b.tangent.x));
    if (a.tangent.clone().applyQuaternion(yaw).dot(b.tangent) < 0.9999 || a.up.clone().applyQuaternion(yaw).dot(b.up) < 0.9999) return null;
    const incoming = a.incoming ? a : b, outgoing = a.incoming ? b : a;
    if (this.portCompatibility(outgoing, incoming).ok === false) return null;
    return {moving, movingPort, fixed, fixedPort, source: outgoing.object, sourcePort: outgoing.name,
      target: incoming.object, targetPort: incoming.name, distance: a.position.distanceTo(b.position), movingWorld: a, fixedWorld: b};
  }

  portCompatibility(outgoing, incoming) {
    const reasons = [];
    if (!outgoing || !incoming || outgoing.incoming || !incoming.incoming) reasons.push({code: 'direction', message: 'Conecta una salida con una entrada.'});
    if (outgoing && incoming) {
      if (outgoing.object === incoming.object) reasons.push({code: 'self', message: 'Un módulo no se conecta consigo mismo. Construye el retorno con otros módulos y curvas.'});
      const source = this.config(outgoing.object), target = this.config(incoming.object);
      if (source && target && source.equipmentId && target.equipmentId && outgoing.loadClass && incoming.loadClass && outgoing.loadClass !== incoming.loadClass) {
        reasons.push({code: 'load-class', message: 'Las interfaces de unidades y pallets son distintas. Usa una estación de carga o descarga compatible.'});
      }
      if (source && target && source.equipmentId && target.equipmentId && outgoing.width > incoming.width + Math.max(0.08, incoming.width * 0.12)) reasons.push({code: 'width', message: 'La salida es más ancha que la entrada. Configura anchos compatibles o una transferencia adecuada.'});
      if (Math.abs(outgoing.tangent.y - incoming.tangent.y) > 0.025) reasons.push({code: 'transition', message: 'La pendiente cambia en la unión. Hace falta una transición física; el imán no la crea.'});
    }
    return {ok: reasons.length === 0, reasons};
  }

  /** Read-only diagnostic used by the viewer and connection inspector. A
   * geometrically compatible pair can still wait for a free receiver at run time.
   */
  assessConnection(source, sourcePort, target, targetPort = 'input') {
    const out = this.worldPort(source, sourcePort), input = this.worldPort(target, targetPort);
    const functional = this.portCompatibility(out, input);
    if (!out || !input) return {proximity: false, geometric: false, functional: false, reasons: functional.reasons.concat({code: 'port', message: 'El puerto no existe en esta variante.'})};
    const gap = out.position.distanceTo(input.position), heading = out.tangent.dot(input.tangent);
    const reasons = functional.reasons.slice();
    if (gap > 0.08) reasons.push({code: 'gap', message: 'Los extremos no coinciden. Alinea los puertos o añade el módulo intermedio que cubra el espacio.'});
    if (heading < 0.995) reasons.push({code: 'orientation', message: 'Las direcciones de transporte no coinciden. Para cambiar de dirección usa una curva, transferencia o desvío.'});
    return {proximity: gap <= this.previewDistance, geometric: gap <= 0.08 && heading >= 0.995, functional: functional.ok,
      ready: functional.ok && gap <= 0.08 && heading >= 0.995, gap, heading, reasons};
  }

  available(pair, edges = this.edges()) {
    if (!pair) return false;
    const [idKey, portKey] = linkKeys(pair.sourcePort), source = this.config(pair.source);
    if (source[idKey] && (source[idKey] !== id(pair.target) || (source[portKey] || 'input') !== pair.targetPort)) return false;
    return !edges.some(edge => edge.targetId === id(pair.target) && edge.targetPort === pair.targetPort &&
      (edge.source !== pair.source || edge.sourcePort !== pair.sourcePort));
  }

  patch(object, values) {
    const document = this.editor.document, before = this.config(object);
    if (!before || Object.keys(values).every(key => before[key] === values[key])) return false;
    document.setBehaviors(object, document.getBehaviors(object).map(config => config.type === before.type ? Object.assign({}, config, values) : config));
    if (this.configCache) this.configCache.delete(object);
    return true;
  }

  connect(pair) {
    if (!this.available(pair)) return false;
    const [idKey, portKey] = linkKeys(pair.sourcePort);
    return this.patch(pair.source, {[idKey]: id(pair.target), [portKey]: pair.targetPort});
  }

  removeEdge(edge) {
    const config = this.config(edge.source), [idKey, portKey] = linkKeys(edge.sourcePort);
    if (!config || config[idKey] !== (edge.targetId || id(edge.target)) || (config[portKey] || 'input') !== edge.targetPort) return false;
    return this.patch(edge.source, {[idKey]: '', [portKey]: 'input'});
  }

  hasConnections(object) {
    return !!object && this.edges().some(edge => edge.source === object || edge.targetId === id(object));
  }

  disconnect(object) {
    let changed = false;
    this.edges().filter(edge => edge.source === object || edge.targetId === id(object)).forEach(edge => {
      if (edge.target) this.suppressedPairs.set(this.pairKey(edge), edge);
      changed = this.removeEdge(edge) || changed;
    });
    if (this.drag && this.drag.object === object) this.drag.latch = null;
    this.refresh(object);
    return changed;
  }

  /** Move only `moving`; preserve its scale and reject unrepresentable parent shear. */
  align(fixed, fixedPort, moving, movingPort) {
    if (!fixed || !moving || fixed === moving) throw new Error('Selecciona dos módulos distintos.');
    const pair = this.pair(moving, movingPort, fixed, fixedPort);
    if (!pair) throw new Error('Los puertos necesitan ancho, altura y orientación vertical compatibles.');
    const from = pair.fixedWorld, to = pair.movingWorld;
    const before = {position: moving.position.clone(), quaternion: moving.quaternion.clone(), scale: moving.scale.clone()};
    const angle = Math.atan2(to.tangent.z, to.tangent.x) - Math.atan2(from.tangent.z, from.tangent.x);
    const rotation = moving.getWorldQuaternion(new THREE.Quaternion()).premultiply(new THREE.Quaternion().setFromAxisAngle(UP, angle));
    const scale = moving.getWorldScale(new THREE.Vector3());
    const localPort = new THREE.Vector3().copy(to.position).applyMatrix4(new THREE.Matrix4().getInverse(moving.matrixWorld));
    const position = from.position.clone().sub(localPort.multiply(scale).applyQuaternion(rotation));
    const matrix = new THREE.Matrix4().compose(position, rotation, scale);
    if (moving.parent) {
      moving.parent.updateWorldMatrix(true, false);
      if (Math.abs(moving.parent.matrixWorld.determinant()) < EPSILON) throw new Error('El grupo del equipo tiene una escala no válida.');
      matrix.premultiply(new THREE.Matrix4().getInverse(moving.parent.matrixWorld));
    }
    const local = {position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: new THREE.Vector3()};
    matrix.decompose(local.position, local.quaternion, local.scale);
    const reconstructed = new THREE.Matrix4().compose(local.position, local.quaternion, local.scale);
    if (matrix.elements.some((value, index) => !Number.isFinite(value) || Math.abs(value - reconstructed.elements[index]) > 1e-5)) {
      throw new Error('La escala del grupo no permite girar este módulo sin deformarlo.');
    }
    if (!changedTransform(before, local)) return moving;
    const write = value => this.editor.document.setTransform(moving, {position: value.position.toArray(), quaternion: value.quaternion.toArray(), scale: value.scale.toArray()});
    try {
      write(local);
      moving.updateWorldMatrix(true, true);
      const actual = this.worldPort(moving, movingPort);
      if (!actual || actual.position.distanceTo(from.position) > 0.002 || actual.tangent.dot(from.tangent) < 0.999) throw new Error('No se pudieron hacer coincidir los puertos.');
    } catch (error) { write(before); moving.updateWorldMatrix(true, true); throw error; }
    return moving;
  }

  /** Keep a width edit within the same physical family, before schema validation.
   * This never resizes products, sources, chambers or pallet positions.
   */
  adaptReflowConfig(previous, next) {
    const result = Object.assign({}, next);
    if (!previous || previous.type !== 'conveyor' || result.type !== 'conveyor' ||
        !Number.isFinite(result.width) || Math.abs(result.width - previous.width) <= EPSILON) return result;
    if (result.layout === 'tee') {
      if (result.mechanism === 'liftTransfer') {
        const square = Math.abs(previous.length - previous.width) <= EPSILON;
        if (square && Math.abs(result.length - previous.length) <= EPSILON) result.length = result.width;
        result.length = Math.max(result.length, result.width);
      } else result.length = Math.max(result.length, result.width * 2);
    }
    if (result.layout === 'curveLeft' || result.layout === 'curveRight') result.radius = Math.max(result.radius, result.width / 2 + 0.1);
    return result;
  }

  /** Capture BEFORE the edit. Poses/configurations belong to this snapshot;
   * logical object identities and ports are retained for stale-plan checks.
   */
  captureReflow(object) {
    return this.withSnapshot(() => {
      if (!this.supported(object)) return null;
      const records = this.records(), allEdges = this.edges(records), adjacency = reflowAdjacency(allEdges), connected = new Set([object]), pending = [object];
      if (!records.includes(object)) return null;
      for (let index = 0; index < pending.length; index++) (adjacency.get(pending[index]) || []).forEach(edge => {
        const other = edge.source === pending[index] ? edge.target : edge.target === pending[index] ? edge.source : null;
        if (other && !connected.has(other)) { connected.add(other); pending.push(other); }
      });
      const entries = records.filter(record => connected.has(record)).map(record => {
        record.updateWorldMatrix(true, false);
        return {object: record, id: id(record), config: JSON.parse(JSON.stringify(this.config(record))), pose: reflowPose(record),
          matrix: record.matrixWorld.clone(), parent: record.parent,
          parentMatrix: record.parent ? record.parent.matrixWorld.clone() : new THREE.Matrix4()};
      });
      const edges = allEdges.filter(edge => connected.has(edge.source) || connected.has(edge.target));
      return {document: this.editor.document, roomId: this.editor.roomId, object, entries, edges, topology: reflowTopology(edges)};
    });
  }

  _reflowPort(entry, name, matrix) {
    const config = entry.config, port = this.ports(config)[name];
    if (!port) return null;
    const linear = new THREE.Matrix3().setFromMatrix4(matrix), tangent = new THREE.Vector3(port.tx, port.ty || 0, port.tz).applyMatrix3(linear);
    const up = UP.clone().applyMatrix3(linear), across = new THREE.Vector3(-port.tz, 0, port.tx).applyMatrix3(linear);
    const width = config.type === 'conveyor' ? config.width : config.type === 'source' ? conveyorLayout.sourceLayout(config).width :
      config.type === 'processor' ? conveyorLayout.processorLayout(config).width : conveyorLayout.palletQueueLayout(config).width;
    if (!Number.isFinite(matrix.determinant()) || matrix.determinant() <= EPSILON || tangent.lengthSq() < EPSILON || up.lengthSq() < EPSILON || !Number.isFinite(width * across.length())) return null;
    return {object: entry.object, name, incoming: port.incoming, loadClass: port.loadClass, surface: port.surface,
      position: new THREE.Vector3(port.x, Number.isFinite(port.y) ? port.y : entry.object.userData.editorConveyorTop || 0, port.z).applyMatrix4(matrix),
      tangent: tangent.normalize(), up: up.normalize(), width: width * across.length()};
  }

  _reflowAligned(entry, movingPort, fixed) {
    const current = this._reflowPort(entry, movingPort, entry.matrix);
    if (!current || !fixed) throw new Error('La variante ya no tiene el puerto conectado.');
    if (current.up.dot(UP) < .98 || fixed.up.dot(UP) < .98 || current.up.dot(fixed.up) < .995 ||
        Math.abs(current.tangent.y - fixed.tangent.y) > .025) throw new Error('La conexión necesita una transición de altura o pendiente compatible.');
    const angle = Math.atan2(current.tangent.z, current.tangent.x) - Math.atan2(fixed.tangent.z, fixed.tangent.x);
    const matrix = entry.matrix.clone().premultiply(new THREE.Matrix4().makeRotationY(angle));
    const rotated = this._reflowPort(entry, movingPort, matrix), displacement = fixed.position.clone().sub(rotated.position);
    matrix.elements[12] += displacement.x; matrix.elements[13] += displacement.y; matrix.elements[14] += displacement.z;
    const local = matrix.clone().premultiply(new THREE.Matrix4().getInverse(entry.parentMatrix));
    const pose = {position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: new THREE.Vector3()};
    local.decompose(pose.position, pose.quaternion, pose.scale);
    if (!reflowMatrixEqual(local, new THREE.Matrix4().compose(pose.position, pose.quaternion, pose.scale), 1e-5) ||
        pose.scale.distanceTo(entry.pose.scale) > 1e-6 * Math.max(1, entry.pose.scale.length())) {
      throw new Error('La escala del grupo no permite reacomodar este equipo sin deformarlo.');
    }
    // Solving a connection changes position/yaw only. Retain exact authored scale.
    pose.scale.copy(entry.pose.scale);
    const actual = this._reflowPort(entry, movingPort, reflowMatrix(pose, entry.parentMatrix));
    if (!actual || actual.position.distanceTo(fixed.position) > .0001 || actual.tangent.dot(fixed.tangent) < .9999 || actual.up.dot(fixed.up) < .9999) {
      throw new Error('No se pudieron hacer coincidir los puertos sin deformar el equipo.');
    }
    return pose;
  }

  /** Pure constraint plan, called AFTER the edit inside its undo transaction.
   * Pass normalizeBehaviors when automatic conveyor-width propagation is needed.
   * The editor cancels that transaction on {ok:false}; this never detaches links.
   */
  planReflow(snapshot, options = {}) {
    const failed = (code, message, edge) => ({ok: false, changes: [], behaviorChanges: [], conflicts: [{code, message,
      sourceId: edge && id(edge.source), targetId: edge && (edge.targetId || id(edge.target))}], message});
    const document = this.editor.document, mode = options.mode === 'transform' ? 'transform' : 'geometry';
    if (!snapshot || snapshot.document !== document || snapshot.roomId !== this.editor.roomId) return failed('stale', 'El nivel cambió; vuelve a editar el equipo.');
    const byObject = new Map(), members = new Set(snapshot.entries.map(entry => entry.object));
    const currentRecords = this.records(), currentEdges = this.edges(currentRecords).filter(edge => members.has(edge.source) || members.has(edge.target));
    if (reflowTopology(currentEdges) !== snapshot.topology) return failed('topology', 'Las conexiones cambiaron durante la edición; vuelve a intentarlo.');
    for (const previous of snapshot.entries) {
      const object = previous.object;
      if (!currentRecords.includes(object) || object.parent !== previous.parent) return failed('stale', 'Cambió un equipo o su grupo durante la edición.');
      object.updateWorldMatrix(true, false);
      const parentMatrix = object.parent ? object.parent.matrixWorld.clone() : new THREE.Matrix4();
      if (!reflowMatrixEqual(parentMatrix, previous.parentMatrix) || Math.abs(parentMatrix.determinant()) <= EPSILON) return failed('parent', 'El grupo de los equipos cambió o tiene una escala no válida.');
      const behaviors = document.getBehaviors(object), config = behaviors.find(value => ['conveyor', 'source', 'processor', 'palletQueue'].includes(value.type));
      if (!config || config.type !== previous.config.type) return failed('variant', 'El equipo conectado cambió de tipo; revisa sus puertos.');
      // A gizmo may ask for many previews using the same pointer-down capture.
      // Solve neighbors from that baseline, not from the previous preview's
      // generated widths/poses. Only the explicitly edited machine is live.
      const baseline = object === snapshot.object ? reflowPose(object) : previous.pose;
      byObject.set(object, {object, id: id(object), config: Object.assign({}, object === snapshot.object ? config : previous.config), behaviors, pose: baseline,
        matrix: reflowMatrix(baseline, parentMatrix), parentMatrix, previous,
        expectedConfig: JSON.stringify(behaviors), expectedPose: reflowPose(object)});
    }
    const edited = byObject.get(snapshot.object);
    if (!edited) return failed('stale', 'No se encontró el equipo editado.');
    const behaviorChanges = [], adjacency = reflowAdjacency(snapshot.edges);
    if (options.widthPolicy !== 'reject' && edited.config.type === 'conveyor') {
      const changedWidth = Object.keys(this.ports(edited.config)).some(name => {
        const before = this._reflowPort(edited.previous, name, edited.previous.matrix), after = this._reflowPort(edited, name, edited.matrix);
        return before && after && Math.abs(before.width - after.width) > 1e-6;
      });
      if (changedWidth || options.forceWidthFit === true) {
        // Width is an interface constraint. An anisotropically scaled corner
        // can have a 1 m inlet and a 2 m lateral outlet; one global line width
        // would either deform it or adapt the wrong neighboring branch.
        const widths = new Map([[edited.object, edited.config.width]]), pendingWidths = [edited.object];
        for (let index = 0; index < pendingWidths.length; index++) {
          const fixed = byObject.get(pendingWidths[index]);
          for (const edge of adjacency.get(fixed.object) || []) {
            const outgoing = edge.source === fixed.object;
            if (!outgoing && edge.target !== fixed.object) continue;
            const other = byObject.get(outgoing ? edge.target : edge.source);
            if (!other || other.config.type !== 'conveyor') continue;
            const fixedPort = this._reflowPort(fixed, outgoing ? edge.sourcePort : edge.targetPort, fixed.matrix);
            const otherPort = this._reflowPort(other, outgoing ? edge.targetPort : edge.sourcePort, other.matrix);
            if (!fixedPort || !otherPort || otherPort.width <= EPSILON) return failed('port', 'El equipo tiene un puerto o una escala no válida.', edge);
            const width = fixedPort.width * other.config.width / otherPort.width;
            if (widths.has(other.object)) {
              if (Math.abs(width - widths.get(other.object)) > 1e-5 * Math.max(1, width)) return failed('width-cycle',
                'El circuito exige anchos distintos en la misma banda. Usa una transición o desconecta una de las ramas.', edge);
              continue;
            }
            other.config = this.adaptReflowConfig(other.config, Object.assign({}, other.config, {width}));
            widths.set(other.object, width); pendingWidths.push(other.object);
          }
        }
      }
    }
    // Include reversions of a previous drag preview, even when the pointer has
    // returned exactly to its baseline width and there is no new width change.
    for (const entry of byObject.values()) {
      const behaviors = entry.behaviors.map(value => value.type === entry.config.type ? entry.config : value);
      if (JSON.stringify(behaviors) === entry.expectedConfig) continue;
      if (typeof options.normalizeBehaviors !== 'function') return failed('validation', 'La adaptación de dimensiones necesita el validador de equipos.');
      try {
        entry.behaviors = options.normalizeBehaviors(behaviors);
        entry.config = entry.behaviors.find(value => value.type === entry.config.type);
        behaviorChanges.push({object: entry.object, id: entry.id, behaviors: entry.behaviors});
      } catch (error) { return failed('width', 'No se pueden adaptar las dimensiones de ' + (entry.object.name || entry.id) + ': ' + error.message); }
    }
    const occupied = new Set();
    for (const edge of snapshot.edges) {
      if (!edge.target || !byObject.has(edge.source) || !byObject.has(edge.target)) return failed('missing', 'Una conexión apunta a un equipo que no está disponible en este nivel.', edge);
      const key = id(edge.target) + ':' + edge.targetPort;
      if (occupied.has(key)) return failed('occupied', 'Dos salidas usan la misma entrada; separa esas conexiones antes de editar.', edge);
      occupied.add(key);
      const out = this._reflowPort(byObject.get(edge.source), edge.sourcePort, byObject.get(edge.source).matrix);
      const input = this._reflowPort(byObject.get(edge.target), edge.targetPort, byObject.get(edge.target).matrix);
      if (!out || !input || out.incoming || !input.incoming) return failed('port', 'La variante ya no tiene los puertos de la conexión.', edge);
      const compatibility = this.portCompatibility(out, input);
      const bothConveyors = byObject.get(edge.source).config.type === 'conveyor' && byObject.get(edge.target).config.type === 'conveyor';
      if (!compatibility.ok || bothConveyors && Math.abs(out.width - input.width) > Math.max(.08, Math.min(out.width, input.width) * .12)) {
        return failed('compatibility', compatibility.reasons[0] && compatibility.reasons[0].message || 'Los transportadores necesitan anchos compatibles o una transición física.', edge);
      }
    }
    const predecessors = snapshot.edges.filter(edge => edge.target === snapshot.object).sort((a, b) =>
      (a.targetPort === 'input' ? 0 : 1) - (b.targetPort === 'input' ? 0 : 1) || id(a.source).localeCompare(id(b.source)));
    const anchor = mode === 'geometry' && predecessors.length ? byObject.get(predecessors[0].source) : edited;
    const poses = new Map([[anchor.object, anchor.pose]]), pending = [anchor.object];
    if (mode === 'geometry' && !predecessors.length) {
      const oldInput = this._reflowPort(edited.previous, 'input', edited.previous.matrix);
      try { poses.set(edited.object, this._reflowAligned(edited, 'input', oldInput)); }
      catch (error) { return failed('anchor', error.message); }
    }
    for (let index = 0; index < pending.length; index++) {
      const fixedObject = pending[index], fixedEntry = byObject.get(fixedObject), fixedMatrix = reflowMatrix(poses.get(fixedObject), fixedEntry.parentMatrix);
      for (const edge of adjacency.get(fixedObject) || []) {
        const outgoing = edge.source === fixedObject;
        if (!outgoing && edge.target !== fixedObject) continue;
        const moving = outgoing ? edge.target : edge.source, movingEntry = byObject.get(moving);
        const fixedPort = this._reflowPort(fixedEntry, outgoing ? edge.sourcePort : edge.targetPort, fixedMatrix);
        const movingPort = outgoing ? edge.targetPort : edge.sourcePort;
        if (poses.has(moving)) {
          const actual = this._reflowPort(movingEntry, movingPort, reflowMatrix(poses.get(moving), movingEntry.parentMatrix));
          if (!actual || actual.position.distanceTo(fixedPort.position) > .001 || actual.tangent.dot(fixedPort.tangent) < .9999 || actual.up.dot(fixedPort.up) < .9999) {
            return failed('cycle', 'El circuito cerrado no puede conservar todas sus uniones con esas dimensiones. Ajusta otro tramo o desconecta el retorno.', edge);
          }
          continue;
        }
        try { poses.set(moving, this._reflowAligned(movingEntry, movingPort, fixedPort)); pending.push(moving); }
        catch (error) { return failed('pose', error.message, edge); }
      }
    }
    const changes = [];
    const changedSupport = edited.config.type === 'conveyor' && Math.abs(edited.config.supportHeight - edited.previous.config.supportHeight) > EPSILON;
    if (changedSupport) for (const entry of byObject.values()) {
      if (entry.config.type !== 'conveyor') continue;
      const beforeFoot = new THREE.Vector3(0, -(entry.previous.config.supportHeight || 1), 0).applyMatrix4(entry.previous.matrix);
      const afterFoot = new THREE.Vector3(0, -(entry.config.supportHeight || 1), 0)
        .applyMatrix4(reflowMatrix(poses.get(entry.object), entry.parentMatrix));
      if (Math.abs(afterFoot.y - beforeFoot.y) > .01) return failed('support-height',
        'La nueva altura deja apoyos bajo el piso o suspendidos. Ajusta la altura del conjunto o incorpora una plataforma antes de cambiar los apoyos.');
    }
    byObject.forEach(entry => {
      const pose = poses.get(entry.object);
      if (pose && changedTransform(entry.expectedPose, pose)) changes.push({object: entry.object, id: entry.id,
        position: pose.position.toArray(), quaternion: pose.quaternion.toArray(), scale: pose.scale.toArray()});
    });
    return {ok: true, document, roomId: snapshot.roomId, anchorId: anchor.id, mode, changes, behaviorChanges, conflicts: [], message: '',
      entries: Array.from(byObject.values()), topology: snapshot.topology, edges: snapshot.edges};
  }

  /** Apply synchronously inside the caller's one undo transaction. Validation
   * precedes every write; a caller catching an error must cancel that transaction.
   */
  applyReflow(plan) {
    const document = this.editor.document;
    if (!document.transaction) throw new Error('El reacomodo necesita una transacción de edición abierta.');
    if (!plan || !plan.ok) throw new Error(plan && plan.message || 'No hay un reacomodo válido.');
    if (plan.document !== document || plan.roomId !== this.editor.roomId) throw new Error('El nivel cambió antes de aplicar el reacomodo.');
    const members = new Set(plan.entries.map(entry => entry.object)), records = this.records();
    if (reflowTopology(this.edges(records).filter(edge => members.has(edge.source) || members.has(edge.target))) !== plan.topology) throw new Error('Las conexiones cambiaron antes de aplicar el reacomodo.');
    plan.entries.forEach(entry => {
      entry.object.updateWorldMatrix(true, false);
      const parent = entry.object.parent ? entry.object.parent.matrixWorld : new THREE.Matrix4();
      if (!records.includes(entry.object) || entry.object.parent !== entry.previous.parent || !reflowMatrixEqual(parent, entry.parentMatrix) ||
          changedTransform(reflowPose(entry.object), entry.expectedPose) || JSON.stringify(document.getBehaviors(entry.object)) !== entry.expectedConfig) {
        throw new Error('Un equipo cambió antes de aplicar el reacomodo; vuelve a intentarlo.');
      }
    });
    plan.behaviorChanges.forEach(change => document.setBehaviors(change.object, change.behaviors));
    plan.changes.forEach(change => document.setTransform(change.object, {position: change.position, quaternion: change.quaternion}));
    // Clear transient read caches; no generic alignment or magnet is triggered.
    if (this.configCache) this.configCache.clear(); this.recordCache = null;
    plan.edges.forEach(edge => {
      const out = this.worldPort(edge.source, edge.sourcePort), input = this.worldPort(edge.target, edge.targetPort);
      if (!out || !input || out.position.distanceTo(input.position) > .001 || out.tangent.dot(input.tangent) < .9999) throw new Error('No se pudo conservar una conexión al aplicar el reacomodo.');
    });
    return plan.changes.length + plan.behaviorChanges.length;
  }

  begin(object, options = {}) {
    this.drag = this.enabled && this.usable(object) ? {object, latch: null, controlOffset: new THREE.Vector3(), detach: options.detach === true, initialPosition: object.position.clone()} : null;
    if (this.drag && options.component) {
      const snapshot = this.captureReflow(object), members = new Set(snapshot.entries.map(entry => entry.object)), ids = new Set(snapshot.entries.map(entry => entry.id)), followers = new Set();
      const objects = this.editor.document.getObjects(this.editor.roomId);
      const machineIds = new Set(this.records().map(id)), panelOwners = new Map(), roomRoot = this.editor.document.getRoot(this.editor.roomId);
      objects.forEach(candidate => {
        if (members.has(candidate) || candidate.userData.editorRuntimeHelper) return;
        if (!this.editor.document.getBehaviors(candidate).some(config => ['control', 'lineMonitor', 'sensor'].includes(config.type) && ids.has(config.targetId))) return;
        const editablePanel = node => node.userData.editorPrefabKey === 'plc' && id(node) && this.editor.document.getObject(id(node)) === node;
        let panel = editablePanel(candidate) ? candidate : null;
        for (let parent = candidate.parent; parent && parent !== roomRoot; parent = parent.parent) {
          if (this.supported(parent) && !members.has(parent)) return;
          if (editablePanel(parent)) panel = parent;
        }
        if (!panel) { followers.add(candidate); return; }
        if (!panelOwners.has(panel)) {
          let shared = false;
          panel.traverse(node => this.editor.document.getBehaviors(node).forEach(config => {
            if (config.type === 'control' && machineIds.has(config.targetId) && !ids.has(config.targetId)) shared = true;
          }));
          panelOwners.set(panel, !shared);
        }
        // A freestanding PLC follows as one cabinet, never as detached buttons.
        // A cabinet shared with another network has no single moving owner.
        if (panelOwners.get(panel)) followers.add(panel);
      });
      // Explicit line groups also own their plinths, platforms and signs. A
      // group containing another network must never pull that network along.
      (this.editor.document.studio && this.editor.document.studio.groups || []).forEach(group => {
        if (group.roomId !== this.editor.roomId) return;
        const grouped = (group.members || []).map(value => this.editor.document.getObject(value)).filter(Boolean), machines = grouped.filter(candidate => this.supported(candidate));
        if (machines.length !== members.size || !machines.every(candidate => members.has(candidate))) return;
        grouped.forEach(candidate => { if (!candidate.userData.editorRuntimeHelper) followers.add(candidate); });
      });
      followers.forEach(candidate => { for (const member of members) for (let parent = member.parent; parent; parent = parent.parent) if (parent === candidate) { followers.delete(candidate); break; } });
      const all = new Set([...members, ...followers]);
      const roots = [...all].filter(candidate => { for (let parent = candidate.parent; parent; parent = parent.parent) if (all.has(parent)) return false; return true; });
      const entries = roots.map(candidate => { candidate.updateWorldMatrix(true, false); return {object: candidate, matrix: candidate.matrixWorld.clone(), scale: candidate.scale.clone(), parent: candidate.parent, parentMatrix: candidate.parent ? candidate.parent.matrixWorld.clone() : new THREE.Matrix4()}; });
      Object.assign(this.drag, {component: true, members, entries, primary: entries.find(entry => entry.object === object), startQuaternion: object.quaternion.clone()});
    }
    this.refresh(object);
  }

  applyComponentDelta(drag, delta) {
    const changes = drag.entries.map(entry => {
      if (entry.object.parent !== entry.parent) throw new Error('El grupo del equipo cambió durante el arrastre.');
      const parent = entry.parent ? entry.parent.matrixWorld : new THREE.Matrix4();
      if (!reflowMatrixEqual(parent, entry.parentMatrix)) throw new Error('El grupo del equipo cambió durante el arrastre.');
      const matrix = entry.matrix.clone().premultiply(delta).premultiply(new THREE.Matrix4().getInverse(parent));
      const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3(); matrix.decompose(position, quaternion, scale);
      const represented = new THREE.Matrix4().compose(position, quaternion, entry.scale);
      if (!reflowMatrixEqual(matrix, represented, 1e-5)) throw new Error('La escala del grupo no permite mover la línea sin deformarla.');
      return {entry, position, quaternion};
    });
    changes.forEach(({entry, position, quaternion}) => this.editor.document.setTransform(entry.object, {position: position.toArray(), quaternion: quaternion.toArray()}));
    changes.forEach(({entry}) => entry.object.updateWorldMatrix(true, true));
  }

  closestComponent(drag) {
    let closest = null; const edges = this.edges(), nearby = [];
    const ports = object => Object.keys(this.ports(object)).map(name => this.worldPort(object, name)).filter(Boolean);
    const fixed = this.records().filter(object => !drag.members.has(object) && this.usable(object)).flatMap(ports);
    // World poses are immutable throughout this query. Compute each opening
    // once and reject distant pairs before their compatibility checks.
    [...drag.members].filter(object => this.usable(object)).flatMap(ports).forEach(a => fixed.forEach(b => {
      if (a.incoming === b.incoming || a.position.distanceToSquared(b.position) > this.previewDistance * this.previewDistance) return;
      const pair = this.pair(a.object, a.name, b.object, b.name, {moving: a, fixed: b});
      if (!pair || !this.available(pair, edges) || this.suppressed(pair)) return;
      nearby.push(pair); if (!closest || pair.distance < closest.distance) closest = pair;
    })); drag.nearbyPairs = nearby; return closest;
  }

  updateComponent(drag) {
    const object = drag.object; object.updateWorldMatrix(true, false);
    // TransformControls supplies a fresh translation from pointer-down. Always
    // derive the entire component from that same baseline, avoiding drag drift.
    const raw = new THREE.Matrix4().compose(object.position, drag.startQuaternion, drag.primary.scale).premultiply(drag.primary.parentMatrix);
    let delta = raw.multiply(new THREE.Matrix4().getInverse(drag.primary.matrix));
    this.applyComponentDelta(drag, delta);
    this.edges().forEach(edge => {
      if (!edge.target || drag.members.has(edge.source) === drag.members.has(edge.target)) return;
      const moving = drag.members.has(edge.source) ? edge.source : edge.target, pair = this.incidentPair(edge, moving);
      if (!pair || pair.distance > this.releaseDistance || pair.movingWorld.tangent.dot(pair.fixedWorld.tangent) < .85) this.removeEdge(edge);
    });
    let latch = drag.latch && this.pair(drag.latch.moving, drag.latch.movingPort, drag.latch.fixed, drag.latch.fixedPort);
    if (latch && (!this.available(latch) || latch.distance > this.releaseDistance)) latch = null;
    const candidate = latch || this.closestComponent(drag);
    if (candidate && (latch || candidate.distance <= this.snapDistance)) {
      const before = candidate.moving.matrixWorld.clone();
      this.align(candidate.fixed, candidate.fixedPort, candidate.moving, candidate.movingPort);
      const correction = candidate.moving.matrixWorld.clone().multiply(new THREE.Matrix4().getInverse(before));
      delta = correction.multiply(delta); this.applyComponentDelta(drag, delta); this.connect(candidate); drag.latch = candidate;
    } else drag.latch = null;
    this.refresh(object); return true;
  }

  pairKey(pair) { return [id(pair.source), pair.sourcePort, id(pair.target), pair.targetPort].join('|'); }

  suppressed(pair) {
    const key = this.pairKey(pair), previous = this.suppressedPairs.get(key);
    if (!previous) return false;
    if (previous.source !== pair.source || previous.target !== pair.target || pair.distance > this.releaseDistance) {
      this.suppressedPairs.delete(key); return false;
    }
    return true;
  }

  incidentPair(edge, moving) {
    if (!edge.target) return null;
    if (edge.source === moving) return this.pair(moving, edge.sourcePort, edge.target, edge.targetPort);
    if (edge.target === moving) return this.pair(moving, edge.targetPort, edge.source, edge.sourcePort);
    return null;
  }

  update(object) {
    return this.withSnapshot(() => this.updateInSnapshot(object));
  }

  /** Reconcile any transform mode after its drag, without attracting new ports. */
  detachSeparated(object, maxDistance = 0.18) {
    return this.withSnapshot(() => {
      let changed = false;
      this.edges().forEach(edge => {
        if (!edge.target || edge.source !== object && edge.target !== object) return;
        const pair = this.incidentPair(edge, object);
        if (!pair || pair.distance > maxDistance || pair.movingWorld.tangent.dot(pair.fixedWorld.tangent) < 0.85) {
          changed = this.removeEdge(edge) || changed;
          if (this.drag && samePair(pair, this.drag.latch)) this.drag.latch = null;
        }
      });
      return changed;
    });
  }

  updateInSnapshot(object) {
    if (!this.enabled || !this.usable(object)) { this.clear(); return false; }
    if (!this.drag || this.drag.object !== object) this.begin(object);
    let changed = false;
    const drag = this.drag;
    if (drag.component) return this.updateComponent(drag);
    if (drag.detach && !drag.detached && object.position.distanceToSquared(drag.initialPosition) > EPSILON * EPSILON) { this.disconnect(object); drag.detached = true; }
    // The gizmo's positionStart is private in Three r112. Keep its original
    // pointer translation, compensating only for rotations around a port that
    // moved the machine's pivot during a previous magnetic alignment.
    if (drag.controlOffset.lengthSq() > EPSILON * EPSILON) {
      object.position.add(drag.controlOffset); object.updateWorldMatrix(true, true);
    }
    const edges = this.edges();
    // TransformControls recomputes the raw translation from pointer-down on
    // every mouse move. Inspect that pose before applying the magnetic offset;
    // the wider release radius lets the user pull a joined module free.
    edges.forEach(edge => {
      const pair = this.incidentPair(edge, object);
      const incident = edge.target && (edge.source === object || edge.target === object);
      if (incident && (!pair || pair.distance > this.releaseDistance || pair.movingWorld.tangent.dot(pair.fixedWorld.tangent) < 0.85)) {
        changed = this.removeEdge(edge) || changed;
        if (samePair(pair, drag.latch)) drag.latch = null;
      }
    });
    let latch = drag.latch && this.pair(object, drag.latch.movingPort, drag.latch.fixed, drag.latch.fixedPort);
    if (latch && (!this.available(latch) || latch.distance > this.releaseDistance)) latch = null;
    if (!latch) {
      const connected = this.edges().map(edge => this.incidentPair(edge, object)).filter(pair => pair && pair.distance <= this.releaseDistance && this.available(pair));
      connected.sort((a, b) => a.distance - b.distance);
      latch = connected[0] || null;
    }
    const candidate = latch || this.closest(object);
    if (candidate && (latch || candidate.distance <= this.snapDistance)) {
      const before = {position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone()};
      try {
        const gap = candidate.fixedWorld.position.clone().sub(candidate.movingWorld.position);
        if (object.parent) {
          object.parent.updateWorldMatrix(true, false);
          gap.applyMatrix3(new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().getInverse(object.parent.matrixWorld)));
        }
        this.align(candidate.fixed, candidate.fixedPort, object, candidate.movingPort);
        drag.controlOffset.add(object.position.clone().sub(before.position).sub(gap));
        changed = this.connect(candidate) || changedTransform(before, object) || changed;
        drag.latch = candidate;
      } catch (error) { drag.latch = null; this.message(error.message); }
    } else drag.latch = null;
    // Snapping one end can move another end. Remove only incident connections
    // whose openings actually separated; never rewrite a neighbour's other links.
    this.edges().forEach(edge => {
      const pair = this.incidentPair(edge, object);
      const incident = edge.target && (edge.source === object || edge.target === object);
      if (incident && (!pair || pair.distance > this.releaseDistance || pair.movingWorld.tangent.dot(pair.fixedWorld.tangent) < 0.85)) changed = this.removeEdge(edge) || changed;
    });
    this.refresh(object);
    return changed;
  }

  closest(object) {
    if (this.drag && this.drag.component) return this.closestComponent(this.drag);
    if (!this.usable(object)) return null;
    const ports = this.ports(object), edges = this.edges();
    let closest = null;
    this.records().forEach(fixed => {
      if (fixed === object || !this.usable(fixed)) return;
      Object.keys(ports).forEach(movingPort => Object.keys(this.ports(fixed)).forEach(fixedPort => {
        const pair = this.pair(object, movingPort, fixed, fixedPort);
        if (!pair || pair.distance > this.previewDistance || !this.available(pair, edges) || this.suppressed(pair)) return;
        if (!closest || pair.distance < closest.distance) closest = pair;
      }));
    });
    return closest;
  }

  end() {
    const object = this.drag && this.drag.object;
    this.drag = null;
    this.refresh(object || this.editor.selected);
  }

  message(text) { if (this.editor.assemblyMessage) this.editor.assemblyMessage(text || ''); }

  ensureHelpers() {
    if (this.helperGroup) return true;
    const scene = this.editor.hooks && this.editor.hooks.renderScene || this.editor.ctx && this.editor.ctx.scene;
    if (!scene) return false;
    this.helperGroup = new THREE.Group(); this.helperGroup.name = 'Puertos de ensamble';
    this.helperGroup.matrixAutoUpdate = false;
    Object.assign(this.helperGroup.userData, {editorHelper: true, editorRuntimeHelper: true});
    scene.add(this.helperGroup);
    this.ringGeometry = new THREE.TorusBufferGeometry(1, 0.08, 5, 24);
    this.arrowGeometry = new THREE.ConeBufferGeometry(0.045, 0.12, 8);
    this.freeMaterial = new THREE.MeshBasicMaterial({color: FREE_COLOR, depthTest: false, depthWrite: false, transparent: true, opacity: 0.92});
    this.connectedMaterial = new THREE.MeshBasicMaterial({color: CONNECTED_COLOR, depthTest: false, depthWrite: false, transparent: true, opacity: 0.92});
    this.lineMaterial = new THREE.LineBasicMaterial({color: FREE_COLOR, depthTest: false, depthWrite: false, transparent: true, opacity: 0.8});
    this.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), this.lineMaterial);
    this.line.visible = false; this.helperGroup.add(this.line);
    return true;
  }

  marker(port, connected) {
    const key = id(port.object) + ':' + port.name;
    let marker = this.markers.get(key);
    if (!marker) {
      const group = new THREE.Group(), ring = new THREE.Mesh(this.ringGeometry, this.freeMaterial), arrow = new THREE.Mesh(this.arrowGeometry, this.freeMaterial);
      group.add(ring, arrow); this.helperGroup.add(group);
      marker = {group, ring, arrow}; this.markers.set(key, marker);
    }
    const material = connected ? this.connectedMaterial : this.freeMaterial;
    marker.ring.material = marker.arrow.material = material;
    marker.group.visible = true;
    marker.group.position.copy(port.position).addScaledVector(port.up, 0.16);
    const direction = port.tangent.clone().multiplyScalar(port.incoming ? -1 : 1);
    marker.ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
    marker.ring.scale.setScalar(Math.min(0.22, Math.max(0.1, port.width * 0.2)));
    marker.arrow.position.copy(direction).multiplyScalar(0.25);
    marker.arrow.quaternion.setFromUnitVectors(UP, direction);
  }

  refresh(object) { return this.withSnapshot(() => this.refreshInSnapshot(object)); }

  refreshInSnapshot(object) {
    if (!this.enabled || !this.usable(object)) { this.clear(); return; }
    if (!this.ensureHelpers()) return;
    const parent = this.helperGroup.parent;
    parent.updateWorldMatrix(true, false);
    this.helperGroup.matrix.copy(new THREE.Matrix4().getInverse(parent.matrixWorld));
    this.markers.forEach(marker => { marker.group.visible = false; });
    this.line.visible = false;
    const edges = this.edges(), ports = this.ports(object), moving = this.drag && this.drag.component ? [...this.drag.members] : [object], movingSet = new Set(moving);
    const occupied = (machine, name) => edges.some(edge => edge.source === machine && edge.sourcePort === name || edge.targetId === id(machine) && edge.targetPort === name);
    moving.forEach(machine => Object.keys(this.ports(machine)).forEach(name => { const port = this.worldPort(machine, name); if (port) this.marker(port, occupied(machine, name)); }));
    const candidate = this.closest(object);
    this.candidate = candidate;
    // Show every nearby compatible opening, not only the single closest pair.
    if (this.drag && this.drag.component) (this.drag.nearbyPairs || []).forEach(pair => this.marker(pair.fixedWorld, occupied(pair.fixed, pair.fixedPort)));
    else this.records().forEach(fixed => {
      if (movingSet.has(fixed) || !this.usable(fixed)) return;
      Object.keys(this.ports(fixed)).forEach(fixedPort => {
        const nearby = moving.some(machine => Object.keys(this.ports(machine)).some(movingPort => {
          const pair = this.pair(machine, movingPort, fixed, fixedPort);
          return pair && pair.distance <= this.previewDistance && this.available(pair, edges) && !this.suppressed(pair);
        }));
        if (nearby) this.marker(this.worldPort(fixed, fixedPort), occupied(fixed, fixedPort));
      });
    });
    if (candidate) {
      const points = [candidate.movingWorld.position.clone().addScaledVector(candidate.movingWorld.up, 0.16), candidate.fixedWorld.position.clone().addScaledVector(candidate.fixedWorld.up, 0.16)];
      const attribute = this.line.geometry.attributes.position;
      points.forEach((point, index) => attribute.setXYZ(index, point.x, point.y, point.z));
      attribute.needsUpdate = true; this.line.geometry.computeBoundingSphere(); this.line.visible = candidate.distance > 0.015;
    }
    this.helperGroup.traverse(node => { Object.assign(node.userData, {editorHelper: true, editorRuntimeHelper: true}); node.raycast = NO_RAYCAST; node.renderOrder = 50; });
    this.helperGroup.updateMatrixWorld(true);
    if (this.drag && this.drag.component) this.message('Mover línea · ' + moving.length + ' equipos vinculados · Ctrl + arrastrar separa solo el módulo.' + (this.drag.latch ? ' Conexión ensamblada.' : candidate ? ' Puerto compatible en amarillo.' : ''));
    else if (this.drag && this.drag.detach) this.message('Separar módulo · los demás equipos permanecen en su lugar.');
    else if (this.drag && this.drag.latch || candidate && candidate.distance < 0.015 && occupied(object, candidate.movingPort)) this.message('Ensamblado · Ctrl + arrastrar permite separar solo este módulo.');
    else if (candidate) this.message('Puerto compatible en amarillo · Acerca el equipo para ensamblar.');
    else {
      let rejection = null;
      this.records().forEach(fixed => {
        if (fixed === object || !this.usable(fixed)) return;
        Object.keys(this.ports(fixed)).forEach(fixedName => Object.keys(ports).forEach(movingName => {
          const a = this.worldPort(object, movingName), b = this.worldPort(fixed, fixedName);
          if (!a || !b || a.incoming === b.incoming) return;
          const distance = a.position.distanceTo(b.position);
          if (distance > this.previewDistance || rejection && rejection.distance <= distance) return;
          const result = this.portCompatibility(a.incoming ? b : a, a.incoming ? a : b);
          if (!result.ok) rejection = {distance, reason: result.reasons[0].message};
        }));
      });
      this.message(rejection ? rejection.reason : 'Puertos amarillos: entrada y salida · Arrastra cerca de otro equipo.');
    }
  }

  clear() {
    this.drag = null; this.candidate = null;
    if (this.helperGroup && this.helperGroup.parent) this.helperGroup.parent.remove(this.helperGroup);
    if (this.ringGeometry) this.ringGeometry.dispose();
    if (this.arrowGeometry) this.arrowGeometry.dispose();
    if (this.freeMaterial) this.freeMaterial.dispose();
    if (this.connectedMaterial) this.connectedMaterial.dispose();
    if (this.line) this.line.geometry.dispose();
    if (this.lineMaterial) this.lineMaterial.dispose();
    this.helperGroup = null; this.markers.clear();
    this.ringGeometry = this.arrowGeometry = this.freeMaterial = this.connectedMaterial = this.lineMaterial = this.line = null;
    this.message('');
  }

  reset() { this.clear(); this.suppressedPairs.clear(); }
}
