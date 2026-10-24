import * as THREE from 'three';
import conveyorLayout from '../../shared/conveyors.js';

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
    const tangent = new THREE.Vector3(port.tx, 0, port.tz).applyMatrix3(matrix);
    const normal = new THREE.Vector3(0, 1, 0).applyMatrix3(matrix);
    const cross = new THREE.Vector3(-port.tz, 0, port.tx).applyMatrix3(matrix);
    const localWidth = config.type === 'palletQueue' ? conveyorLayout.palletQueueLayout(config).width :
      config.type === 'source' ? conveyorLayout.sourceLayout(config).width :
      config.type === 'processor' ? conveyorLayout.processorLayout(config).width : config.width;
    const width = localWidth * cross.length();
    if (!Number.isFinite(width) || width <= EPSILON || tangent.lengthSq() < EPSILON || normal.lengthSq() < EPSILON) return null;
    return {
      object, name, incoming: port.incoming,
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

  pair(moving, movingPort, fixed, fixedPort) {
    if (moving === fixed || !this.usable(moving) || !this.usable(fixed)) return null;
    const a = this.worldPort(moving, movingPort), b = this.worldPort(fixed, fixedPort);
    if (!a || !b || a.incoming === b.incoming) return null;
    // Only yaw is changed by the magnet. Reject tilted/mirrored machines and
    // mismatched conveyor openings. Queues and processors may have wider decks;
    // simulation checks the size of each outgoing product against the receiver.
    const bothConveyors = this.config(moving).type === 'conveyor' && this.config(fixed).type === 'conveyor';
    if (a.up.dot(UP) < 0.98 || b.up.dot(UP) < 0.98 || a.up.dot(b.up) < 0.995 ||
      Math.abs(a.tangent.y) > 0.1 || Math.abs(b.tangent.y) > 0.1 ||
      bothConveyors && Math.abs(a.width - b.width) > Math.max(0.08, Math.min(a.width, b.width) * 0.12)) return null;
    const yaw = new THREE.Quaternion().setFromAxisAngle(UP, Math.atan2(a.tangent.z, a.tangent.x) - Math.atan2(b.tangent.z, b.tangent.x));
    if (a.tangent.clone().applyQuaternion(yaw).dot(b.tangent) < 0.9999 || a.up.clone().applyQuaternion(yaw).dot(b.up) < 0.9999) return null;
    const incoming = a.incoming ? a : b, outgoing = a.incoming ? b : a;
    return {moving, movingPort, fixed, fixedPort, source: outgoing.object, sourcePort: outgoing.name,
      target: incoming.object, targetPort: incoming.name, distance: a.position.distanceTo(b.position), movingWorld: a, fixedWorld: b};
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

  begin(object) {
    this.drag = this.enabled && this.usable(object) ? {object, latch: null, controlOffset: new THREE.Vector3()} : null;
    this.refresh(object);
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
    const edges = this.edges(), ports = this.ports(object);
    const occupied = (machine, name) => edges.some(edge => edge.source === machine && edge.sourcePort === name || edge.targetId === id(machine) && edge.targetPort === name);
    Object.keys(ports).forEach(name => { const port = this.worldPort(object, name); if (port) this.marker(port, occupied(object, name)); });
    const candidate = this.closest(object);
    this.candidate = candidate;
    // Show every nearby compatible opening, not only the single closest pair.
    this.records().forEach(fixed => {
      if (fixed === object || !this.usable(fixed)) return;
      Object.keys(this.ports(fixed)).forEach(fixedPort => {
        const nearby = Object.keys(ports).some(movingPort => {
          const pair = this.pair(object, movingPort, fixed, fixedPort);
          return pair && pair.distance <= this.previewDistance && this.available(pair, edges) && !this.suppressed(pair);
        });
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
    if (this.drag && this.drag.latch || candidate && candidate.distance < 0.015 && occupied(object, candidate.movingPort)) this.message('Ensamblado · Aleja el equipo para separarlo.');
    else if (candidate) this.message('Puerto compatible en amarillo · Acerca el equipo para ensamblar.');
    else this.message('Puertos amarillos: entrada y salida · Arrastra cerca de otro equipo.');
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
