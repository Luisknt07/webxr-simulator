import * as THREE from 'three';
import RollerInstanceBatches from './RollerInstanceBatches';

const DISPLAY_INTERVAL = 0.2;
const WHITE = '#e8f3f8';
const DIM = '#8aa3b6';
const GREEN = '#42e4a4';
const AMBER = '#ffc356';
const RED = '#ff6575';
const CYAN = '#50d9ff';
const MACHINE_TYPES = ['conveyor', 'source', 'processor', 'palletQueue', 'robot', 'vehicle'];
function machineConfiguration(record) { return record && MACHINE_TYPES.map(type => record.configurations[type]).find(Boolean); }
function machineTargets(config) {
  const ids = [config.outputId, config.branchId];
  if (['robot', 'vehicle'].includes(config.type)) ids.push(config.sourceId);
  if (config.type === 'robot' && config.destinationRulesJson) {
    try { const rules = JSON.parse(config.destinationRulesJson); if (Array.isArray(rules)) rules.slice(0, 16).forEach(rule => { if (rule && typeof rule.outputId === 'string') ids.push(rule.outputId); }); } catch (_) { /* Validated configurations normally arrive here. */ }
  }
  return ids.filter(Boolean);
}

function number(value, fallback = 0) { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }
function visible(object) { for (let node = object; node; node = node.parent) if (!node.visible) return false; return true; }
function materials(material) { return Array.isArray(material) ? material : [material]; }
function cloneSurfaceMaterial(original) {
  const material = original.clone();
  // Three r112 drops custom shader hooks/defines during Material.copy. Keep
  // authored PBR wear when adding private machine indicators or rolling UVs.
  material.onBeforeCompile = original.onBeforeCompile;
  if (original.staticInstanceBatchShader === original.onBeforeCompile) material.staticInstanceBatchShader = material.onBeforeCompile;
  if (original.surfaceWearMap) material.surfaceWearMap = original.surfaceWearMap;
  if (original.defines) material.defines = Object.assign({}, original.defines);
  return material;
}
function cloneSurfaceTexture(original) {
  const texture = original.clone();
  texture.userData = Object.assign({}, original.userData || {});
  ['isDataTexture', 'isCompressedTexture', 'isCubeTexture', 'isCanvasTexture', 'isVideoTexture'].forEach(key => { if (original[key]) texture[key] = true; });
  texture.image = original.image;
  texture.mipmaps = original.mipmaps ? original.mipmaps.slice() : [];
  if (original.isVideoTexture && !texture.update) texture.update = original.update;
  return texture;
}
function nearest(object, records, type) {
  for (let node = object; node; node = node.parent) {
    const record = records.get(node);
    if (record && (!type || record.configurations[type])) return record;
  }
  return null;
}
function stateOf(variables, editing) {
  if (variables.powered === false) return {label: 'APAGADA', color: DIM};
  if (variables.emergency) return {label: 'EMERGENCIA', color: RED};
  if (editing) return {label: 'LISTA', color: CYAN};
  if (variables.enabled === false) return {label: 'DESHABILITADA', color: AMBER};
  if (variables.paused) return {label: 'EN PAUSA', color: AMBER};
  if (variables.palletFull) return {label: number(variables.palletCapacity) > 0 && number(variables.palletCount) >= number(variables.palletCapacity) ? 'PALLET LLENO' : 'PALLET BLOQUEADO', color: AMBER};
  if (variables.transferBlocked) return {label: 'ESPERANDO SALIDA', color: AMBER};
  if (variables.running && Math.abs(number(variables.actualSpeed)) > 0.00001) return {label: 'EN MARCHA', color: GREEN};
  if (variables.running) return {label: 'LISTA / 0 m/s', color: CYAN};
  return {label: 'DETENIDA', color: AMBER};
}
function clock(seconds) {
  const value = Math.max(0, Math.floor(number(seconds)));
  return Math.floor(value / 3600).toString().padStart(2, '0') + ':' + Math.floor(value / 60 % 60).toString().padStart(2, '0') + ':' + (value % 60).toString().padStart(2, '0');
}
function count(value) { return Math.max(0, Math.floor(number(value))).toLocaleString('es'); }
function scopeOf(value) { return value === 'line' || value === 'segment' ? value : 'module'; }
function steerAngle(state, config) {
  // The kinematic sequencer exposes steer progress through actuatorPosition;
  // older saves/runtimes leave actuatorAngle at zero for this mechanism.
  const angle = number(state && state.actuatorAngle);
  return Math.abs(angle) > 1e-8 ? angle : (config && config.branchSide === 'right' ? -1 : 1) * Math.PI / 2 * Math.max(0, Math.min(1, number(state && state.actuatorPosition)));
}
function setColor(entry, color, intensity, opacity) {
  const signature = (color && color.isColor ? color.toArray().join(',') : color) + ':' + intensity + ':' + opacity;
  if (entry.signature === signature) return;
  entry.signature = signature;
  entry.privateMaterials.forEach(material => {
    if (material.color) material.color.set(color);
    if (material.emissive) { material.emissive.set(color); material.emissiveIntensity = intensity; }
    if (opacity !== undefined) {
      material.transparent = true; material.opacity = opacity; material.depthWrite = false;
    }
  });
}

/** Cosmetic industrial feedback; all machine logic remains in SimulationRuntime. */
export default class IndustrialVisuals {
  constructor(ctx, document, simulation) {
    this.ctx = ctx;
    this.document = document;
    this.simulation = simulation;
    this.displays = new Map();
    this.colors = new Map();
    this.buttons = new Map();
    this.rollers = new Map();
    this.rollerBatches = new RollerInstanceBatches();
    this.rollerInstancing = RollerInstanceBatches.supported(ctx.renderer);
    this.belts = new Map();
    this.processorHeads = new Map();
    this.mechanisms = new Map();
    this.steerBanks = new Map();
    this.rollerTextures = new Map();
    this.rollerMaterials = new Map();
    this.records = new Map();
    this.byId = new Map();
    this.sensors = [];
    this.bindings = [];
    this.panelSnapshots = new Map();
    this.previewScopes = new Map();
    this.dirty = true;
    this.roomId = null;
    this.root = null;
    this.objectCount = -1;
    this.elapsed = DISPLAY_INTERVAL;
    this.snapshot = null;
    this.scale = new THREE.Vector3();
    this.contactHands = new Map(); this.contactButtons = [];
    this.contactProbe = new THREE.Vector3(); this.contactCenter = new THREE.Vector3(); this.contactPoint = new THREE.Vector3(); this.contactOrigin = new THREE.Vector3();
    this.contactInverse = new THREE.Matrix4(); this.contactMatrix = new THREE.Matrix4(); this.contactLocal = new THREE.Matrix4();
    this.contactStates = new Map(); this.contactInput = null;
  }

  invalidate() { this.dirty = true; this.rollerBatches.invalidate(); }

  getStats() { return this.rollerBatches.getStats(); }

  resolveConveyor(record) {
    if (!record) return null;
    record.panelScope = 'module';
    if (machineConfiguration(record)) return record;
    const source = record.configurations.sensor || record.configurations.control || record.configurations.product;
    if (source) {
      if (record.configurations.control) record.panelScope = scopeOf(source.scope);
      const reference = source.sourceId || source.targetId;
      const target = reference && this.byId.get(reference);
      // Match the configured source/target. Blank, self, dangling references or
      // a PLC targeting itself must never borrow another machine's telemetry.
      return machineConfiguration(target) ? target : null;
    }
    // A panel reports one machine only when every enabled child control has a
    // valid, consistent target. Traversal order must not select the first one.
    const targets = new Set(), scopes = new Set();
    let controls = 0, unbound = 0;
    this.records.forEach(child => {
      if (!child.configurations.control) return;
      for (let node = child.object.parent; node; node = node.parent) if (node === record.object) {
        const controlTarget = this.byId.get(child.configurations.control.targetId);
        controls++;
        scopes.add(scopeOf(child.configurations.control.scope));
        if (machineConfiguration(controlTarget)) targets.add(controlTarget);
        else unbound++;
        break;
      }
    });
    record.bindingConflict = targets.size > 1 || scopes.size > 1 || targets.size > 0 && unbound > 0;
    if (scopes.size === 1) record.panelScope = scopes.values().next().value;
    if (controls) return !unbound && targets.size === 1 && scopes.size === 1 ? targets.values().next().value : null;
    if (record.object.userData.editorPrefabKey === 'plc') return null;
    return nearest(record.object.parent, this.records, 'conveyor');
  }

  scan(roomId, root, objectCount) {
    this.rollerBatches.clear();
    this.resetContactHands();
    this.roomId = String(roomId);
    this.root = root;
    this.objectCount = objectCount;
    this.records.clear(); this.byId.clear(); this.sensors = []; this.bindings = [];
    this.panelSnapshots.clear(); this.previewScopes.clear();
    const objects = this.document.getObjects ? this.document.getObjects(roomId) : [];
    objects.forEach(object => {
      const configurations = {};
      const behaviors = this.document.getBehaviors ? this.document.getBehaviors(object) : object.userData.editorBehaviors || object.userData.editorDefaultBehaviors || [];
      behaviors.forEach(config => {
        if (config && config.enabled !== false && MACHINE_TYPES.concat(['sensor', 'automation', 'control', 'product']).includes(config.type)) configurations[config.type] = config;
      });
      // The physical panel remains an ownership boundary even when its PLC
      // logic and every button are disabled or its automation was removed.
      if (!Object.keys(configurations).length && object.userData.editorPrefabKey !== 'plc') return;
      const record = {object, id: object.userData.editorId, configurations};
      this.records.set(object, record);
      if (record.id) this.byId.set(record.id, record);
    });
    const identities = new Map();
    this.records.forEach(record => {
      if (!machineConfiguration(record)) return;
      const id = String(record.id || record.object.uuid).replace(/^custom-/, '');
      const short = id.length > 18 ? '…' + id.slice(-15) : id;
      if (!identities.has(short)) identities.set(short, []);
      identities.get(short).push(record);
    });
    identities.forEach((records, short) => records.sort((a, b) => String(a.id).localeCompare(String(b.id))).forEach((record, index) => {
      record.shortId = short + (records.length > 1 ? ' #' + (index + 1) : '');
    }));
    this.records.forEach(record => {
      if (record.configurations.sensor) this.sensors.push({record, conveyor: this.resolveConveyor(record)});
    });
    const foundDisplays = new Set(), foundColors = new Set(), foundRollers = new Set(), foundBelts = new Set(), foundButtons = new Set(), foundHeads = new Set(), foundMechanisms = new Set(), foundSteerBanks = new Set();
    if (root) root.traverse(object => {
      if (!visible(object)) return;
      const data = object.userData || {};
      const owner = nearest(object, this.records);
      if (!owner) return;
      const conveyor = this.resolveConveyor(owner);
      if (data.industrialConveyorMechanism && conveyor && conveyor.configurations.conveyor) {
        foundMechanisms.add(object);
        if (!this.mechanisms.has(object)) this.mechanisms.set(object, {object, rest: object.position.clone(), rotation: object.quaternion.clone(), distance: 0});
        Object.assign(this.mechanisms.get(object), {conveyor, motion: data.industrialConveyorMechanism});
      }
      if (object.geometry && object.geometry.userData.industrialSteerRest && conveyor) {
        foundSteerBanks.add(object);
        if (!this.steerBanks.has(object)) {
          const entry = {object, angle: 0};
          // Native template copies may share immutable geometry. Their yaw
          // buffers need independent ownership; ordinary prefab banks already
          // have private buffers and avoid this extra allocation entirely.
          if (data.editorNative || data.editorCloneSourceId) {
            entry.original = object.geometry; entry.installed = object.geometry.clone();
            object.geometry = entry.installed;
          }
          this.steerBanks.set(object, entry);
        }
        this.steerBanks.get(object).conveyor = conveyor;
      }
      if (data.industrialProcessorHead && conveyor && conveyor.configurations.processor) {
        foundHeads.add(object);
        if (!this.processorHeads.has(object)) this.processorHeads.set(object, {object, rest: object.position.clone(), processor: conveyor});
        this.processorHeads.get(object).processor = conveyor;
      }
      const isDisplay = data.industrialDisplay || object.name === 'Pantalla' && owner.object.userData.editorPrefabKey === 'plc';
      if (object.isMesh && isDisplay) {
        foundDisplays.add(object);
        if (!this.displays.has(object)) this.createDisplay(object);
        const entry = this.displays.get(object);
        if (entry) { entry.conveyor = conveyor; entry.scope = owner.panelScope || 'module'; entry.bindingConflict = !!owner.bindingConflict; entry.signature = null; }
      }
      const roller = data.industrialRoller || object.geometry && object.geometry.userData.industrialSteerRest && object.geometry.userData.industrialSteerRest.roller || (/^Rodillo \d+$/i.test(object.name) && owner.configurations.conveyor && {axis: 'y', radius: 0.065});
      if (roller && conveyor) {
        foundRollers.add(object);
        if (!this.rollers.has(object)) this.createRoller(object, conveyor);
        Object.assign(this.rollers.get(object), {conveyor, zone: roller.zone, axis: ['x', 'y', 'z'].includes(roller.axis) ? roller.axis : 'y', radius: Math.max(0.001, number(roller.radius, 0.065)), direction: number(roller.direction, -1)});
      }
      if (data.industrialBelt && conveyor) {
        const belt = data.industrialBelt;
        foundBelts.add(object);
        if (!this.belts.has(object)) this.createRoller(object, conveyor, this.belts);
        Object.assign(this.belts.get(object), {conveyor, zone: belt.zone, textureAxis: belt.textureAxis === 'y' ? 'y' : 'x',
          metersPerRepeat: Math.max(0.001, number(belt.metersPerRepeat, 1)), scaleAxis: ['x', 'y', 'z'].includes(belt.scaleAxis) ? belt.scaleAxis : 'x', direction: number(belt.direction, -1)});
      }
      if (!object.isMesh || !object.material) return;
      const isLamp = data.industrialSensorLamp || object.name === 'Piloto del sensor';
      const isVolume = data.industrialSensorVolume || /^Haz de detecci/.test(object.name);
      const isZone = Number.isInteger(data.industrialZoneLamp);
      const isButton = data.industrialButton || owner.configurations.control && object === owner.object.children[1];
      if (isButton) {
        foundButtons.add(object);
        if (!this.buttons.has(object)) this.buttons.set(object, {object, rest: object.position.clone(), amount: 0, pulseRemaining: 0, sequence: undefined});
      }
      if (isLamp || isVolume || isButton || isZone || data.industrialTower) {
        foundColors.add(object);
        if (!this.colors.has(object)) this.createColor(object);
        const entry = this.colors.get(object);
        this.bindings.push({entry, owner, conveyor, scope: owner.panelScope || 'module', sensor: isLamp || isVolume ? nearest(object, this.records, 'sensor') : null,
          kind: isZone ? 'zone' : isVolume ? 'volume' : isLamp ? 'sensor' : isButton ? 'button' : 'tower', tower: data.industrialTower, zone: data.industrialZoneLamp,
          action: owner.object.userData.industrialAction || owner.object.userData.editorPrefabVariant || owner.configurations.control && owner.configurations.control.command});
      }
    });
    this.contactButtons = this.bindings.filter(binding => binding.kind === 'button' && binding.owner.configurations.control && binding.entry.object.userData.industrialButton).map(binding => {
      const cap = binding.entry.object, owner = binding.owner.object, entry = this.buttons.get(cap);
      if (!cap.geometry.boundingBox) cap.geometry.computeBoundingBox();
      owner.updateWorldMatrix(true, false); cap.parent.updateWorldMatrix(true, false);
      this.contactInverse.getInverse(owner.matrixWorld);
      this.contactMatrix.multiplyMatrices(this.contactInverse, cap.parent.matrixWorld);
      this.contactLocal.compose(entry.rest, cap.quaternion, cap.scale); this.contactMatrix.multiply(this.contactLocal);
      const bounds = cap.geometry.boundingBox.clone().applyMatrix4(this.contactMatrix), sphere = bounds.getBoundingSphere(new THREE.Sphere());
      return {cap, owner, bounds, center: sphere.center, radius: sphere.radius, round: /Cylinder|Sphere/.test(cap.geometry.type)};
    });
    this.displays.forEach((entry, object) => { if (!foundDisplays.has(object)) { this.restoreDisplay(entry); this.displays.delete(object); } });
    this.colors.forEach((entry, object) => { if (!foundColors.has(object)) { this.restoreColor(entry); this.colors.delete(object); } });
    this.buttons.forEach((entry, object) => { if (!foundButtons.has(object)) { this.restoreButton(entry); this.buttons.delete(object); } });
    this.rollers.forEach((entry, object) => { if (!foundRollers.has(object)) { this.restoreRoller(entry); this.rollers.delete(object); } });
    this.belts.forEach((entry, object) => { if (!foundBelts.has(object)) { this.restoreRoller(entry); this.belts.delete(object); } });
    this.processorHeads.forEach((entry, object) => { if (!foundHeads.has(object)) { entry.object.position.copy(entry.rest); this.processorHeads.delete(object); } });
    this.mechanisms.forEach((entry, object) => { if (!foundMechanisms.has(object)) { this.restoreMechanism(entry); this.mechanisms.delete(object); } });
    this.steerBanks.forEach((entry, object) => { if (!foundSteerBanks.has(object)) { this.restoreSteerBank(entry); this.steerBanks.delete(object); } });
    const liveTextures = new Set();
    const liveMaterials = new Set();
    this.rollers.forEach(entry => entry.surfaces.forEach(surface => liveTextures.add(surface)));
    this.rollers.forEach(entry => entry.privateMaterials.forEach(material => liveMaterials.add(material)));
    this.belts.forEach(entry => entry.surfaces.forEach(surface => liveTextures.add(surface)));
    this.belts.forEach(entry => entry.privateMaterials.forEach(material => liveMaterials.add(material)));
    this.rollerTextures.forEach((surface, key) => { if (!liveTextures.has(surface)) { surface.texture.dispose(); this.rollerTextures.delete(key); } });
    this.rollerMaterials.forEach((entry, key) => { if (!liveMaterials.has(entry.material)) { entry.material.dispose(); this.rollerMaterials.delete(key); } });
    this.elapsed = DISPLAY_INTERVAL;
    this.dirty = false;
  }

  createDisplay(object) {
    const dom = this.ctx.document || (typeof document !== 'undefined' ? document : null);
    if (!dom || !dom.createElement) return;
    const canvas = dom.createElement('canvas');
    canvas.width = 1024; canvas.height = 512;
    let context;
    try { context = canvas.getContext && canvas.getContext('2d'); } catch (error) { return; }
    if (!context || !context.fillRect || !context.fillText) return;
    const texture = new THREE.CanvasTexture(canvas);
    texture.encoding = THREE.sRGBEncoding;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    const capabilities = this.ctx.renderer && this.ctx.renderer.capabilities;
    if (capabilities && capabilities.getMaxAnisotropy) texture.anisotropy = Math.min(4, capabilities.getMaxAnisotropy());
    const material = new THREE.MeshBasicMaterial({map: texture, color: '#ffffff', toneMapped: false});
    const original = object.material;
    const source = materials(original)[0];
    if (source) material.visible = source.visible;
    let installed = material;
    // A screen made from a shallow box only shows the HMI on its +Z face.
    if (object.geometry && /Box/.test(object.geometry.type) && object.geometry.groups.some(group => group.materialIndex === 4)) {
      installed = Array.from({length: 6}, (_, index) => index === 4 ? material : Array.isArray(original) ? original[index] || original[0] : original);
    }
    object.material = installed;
    this.displays.set(object, {object, original, installed, material, canvas, context, texture, signature: null});
  }

  createColor(object) {
    const original = object.material;
    const privateMaterials = materials(original).map(cloneSurfaceMaterial);
    const installed = Array.isArray(original) ? privateMaterials : privateMaterials[0];
    object.material = installed;
    this.colors.set(object, {object, original, installed, privateMaterials, signature: null});
  }

  createRoller(object, conveyor, collection = this.rollers) {
    const entry = {object, angle: 0, distance: 0, original: object.material, installed: null, privateMaterials: [], surfaces: []};
    const motion = object.userData.industrialRoller || object.userData.industrialBelt || object.geometry && object.geometry.userData.industrialSteerRest && object.geometry.userData.industrialSteerRest.roller || {};
    const zoneKey = Number.isInteger(motion.zone) ? ':zone-' + motion.zone : '';
    if (object.isMesh && object.material) {
      entry.privateMaterials = materials(object.material).map(original => {
        const materialKey = conveyor.object.uuid + zoneKey + ':' + original.uuid;
        const cachedMaterial = this.rollerMaterials.get(materialKey);
        if (cachedMaterial) { entry.surfaces.push(cachedMaterial.surface); return cachedMaterial.material; }
        const material = cloneSurfaceMaterial(original);
        const key = conveyor.object.uuid + zoneKey + ':' + (original.map ? original.map.uuid : 'roller-metal');
        let surface = this.rollerTextures.get(key);
        if (!surface) {
          let texture;
          if (original.map) texture = cloneSurfaceTexture(original.map);
          else {
            // Older saved prefabs have plain cylinders. A subtle metal grain
            // supplies a visible rotation cue without adding moving geometry.
            const data = new Uint8Array(128 * 8 * 3);
            for (let y = 0; y < 8; y++) for (let x = 0; x < 128; x++) {
              const shade = Math.round(229 + 9 * Math.sin(x * Math.PI / 64) + 3 * Math.sin(x * 0.71 + y * 2.7));
              const index = (y * 128 + x) * 3;
              data[index] = shade; data[index + 1] = shade; data[index + 2] = Math.min(255, shade + 2);
            }
            texture = new THREE.DataTexture(data, 128, 8, THREE.RGBFormat);
            texture.encoding = THREE.sRGBEncoding;
            texture.wrapS = THREE.RepeatWrapping;
          }
          texture.needsUpdate = true;
          surface = {texture, source: original.map, sourceVersion: original.map && original.map.version, offset: texture.offset.x, offsets: texture.offset.clone(), lastFrame: -1};
          this.rollerTextures.set(key, surface);
        }
        material.map = surface.texture;
        entry.surfaces.push(surface);
        this.rollerMaterials.set(materialKey, {material, surface});
        return material;
      });
      entry.installed = Array.isArray(object.material) ? entry.privateMaterials : entry.privateMaterials[0];
      object.material = entry.installed;
    }
    collection.set(object, entry);
  }

  variables(record, editing) {
    if (!record) return null;
    const config = machineConfiguration(record) || record.configurations.sensor || {};
    if (!editing && this.simulation && this.simulation.running) {
      const runtime = this.simulation.records && this.simulation.records.get(record.id);
      if (runtime) return runtime.variables;
      const snapshotRecord = this.snapshot && this.snapshot.objects && this.snapshot.objects.find(item => item.id === record.id);
      if (snapshotRecord) return snapshotRecord.variables;
    }
    return Object.assign({enabled: true, powered: true, paused: false, running: false, emergency: false, speed: 0, actualSpeed: 0,
      entryCount: 0, exitCount: 0, inFlight: 0, runSeconds: 0, occupied: false, count: 0,
      queued: 0, generatedCount: 0, dispatchedCount: 0, receivedCount: 0, queuedUnits: 0}, config, {actualSpeed: 0, occupied: false, count: 0});
  }

  previewMembers(record, scope) {
    const key = record.id + ':' + scope;
    if (this.previewScopes.has(key)) return this.previewScopes.get(key);
    const links = new Map();
    this.byId.forEach(candidate => {
      const config = candidate.configurations.conveyor || scope === 'line' && machineConfiguration(candidate);
      if (!config) return;
      links.set(candidate.id, machineTargets(config).filter(id => {
        const target = this.byId.get(id); return target && (target.configurations.conveyor || scope === 'line' && machineConfiguration(target));
      }));
    });
    if (scope === 'line') links.forEach((targets, id) => targets.slice().forEach(target => {
      if (!links.get(target).includes(id)) links.get(target).push(id);
    }));
    const members = new Set([record.id]), queue = [record.id];
    for (let index = 0; index < queue.length; index++) (links.get(queue[index]) || []).forEach(id => {
      const target = this.byId.get(id);
      if (members.has(id) || scope === 'segment' && target.configurations.conveyor.withPanel !== false) return;
      members.add(id); queue.push(id);
    });
    const result = Array.from(members);
    this.previewScopes.set(key, result);
    return result;
  }

  panelSnapshot(record, scope, editing, values) {
    if (!record) return {variables: null, memberIds: [], scope};
    if (scope === 'module' || scope !== 'line' && (record.configurations.source || record.configurations.processor || record.configurations.palletQueue || record.configurations.robot || record.configurations.vehicle)) return {variables: values(record), memberIds: [record.id], anchorId: record.id, scope: 'module'};
    const key = record.id + ':' + scope + ':' + editing;
    if (this.panelSnapshots.has(key)) return this.panelSnapshots.get(key);
    let snapshot;
    if (editing) {
      const memberIds = this.previewMembers(record, scope);
      snapshot = {variables: Object.assign({}, values(record), {moduleCount: memberIds.length}), memberIds, anchorId: record.id, scope};
    } else if (this.simulation && this.simulation.running && this.simulation.getPanelSnapshot) {
      const result = this.simulation.getPanelSnapshot(record.id, scope);
      if (result && result.variables && Array.isArray(result.memberIds) && result.memberIds.includes(record.id)) snapshot = result;
    }
    if (!snapshot) snapshot = {variables: null, memberIds: this.previewMembers(record, scope), anchorId: record.id, scope, unavailable: true};
    this.panelSnapshots.set(key, snapshot);
    return snapshot;
  }

  updateButton(binding, elapsed, editing) {
    const entry = this.buttons.get(binding.entry.object);
    if (!entry) return {hovered: false, amount: 0};
    const live = !editing && this.simulation && this.simulation.running && binding.owner.configurations.control;
    if (!live) { this.restoreButton(entry); entry.sequence = undefined; return {hovered: false, amount: 0}; }
    const feedback = this.simulation.getControlFeedback ? this.simulation.getControlFeedback(binding.owner.id) : null;
    const sequence = number(feedback && feedback.sequence);
    const held = !!(feedback && feedback.pressed);
    // A quick down/up between rendered frames still produces one brief motion.
    // Initial discovery only observes the current held state; it never replays
    // an old sequence when a hidden panel becomes visible again.
    if (entry.sequence !== undefined && sequence > entry.sequence && !held) entry.pulseRemaining = 0.08;
    entry.sequence = sequence;
    const pressed = held || entry.pulseRemaining > 0;
    entry.pulseRemaining = Math.max(0, entry.pulseRemaining - elapsed);
    const target = pressed ? 1 : 0;
    entry.amount += (target - entry.amount) * (1 - Math.exp(-(pressed ? 45 : 26) * elapsed));
    if (Math.abs(target - entry.amount) < 0.0001) entry.amount = target;
    // The cap slides along the control group's front axis. A 12 mm stroke
    // remains in front of the door for both normal and mushroom pushbuttons.
    entry.object.position.set(entry.rest.x, entry.rest.y, entry.rest.z - entry.amount * 0.012);
    return {hovered: !!(feedback && feedback.hovered), amount: entry.amount};
  }

  restoreMechanism(entry) {
    entry.object.position.copy(entry.rest); entry.object.quaternion.copy(entry.rotation); entry.distance = 0;
  }

  updateMechanism(entry, state, elapsed, editing) {
    if (!state || editing) { this.restoreMechanism(entry); return; }
    const motion = entry.motion, object = entry.object;
    const position = Math.max(0, Math.min(1, number(state.actuatorPosition)));
    object.position.copy(entry.rest); object.quaternion.copy(entry.rotation);
    if (motion.kind === 'lift') object.position.y += position * number(motion.travel, 0.15);
    else if (motion.kind === 'elevator') object.position.y += number(state.elevatorPosition);
    else if (motion.kind === 'pusher') object.position.z += number(motion.side, 1) * position * number(state.actuatorStroke, number(motion.travel, 1));
    else if (motion.kind === 'turntable' || motion.kind === 'steer') {
      const angle = motion.kind === 'steer' ? steerAngle(state, entry.conveyor.configurations.conveyor) : number(state.actuatorAngle);
      object.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle));
    } else if (motion.kind === 'cleat') {
      const config = entry.conveyor.configurations.conveyor, length = Math.max(0.1, number(motion.length, config.length));
      const active = state.enabled !== false && state.powered !== false && state.running && !state.paused && !state.emergency;
      if (active) entry.distance += number(state.actualSpeed) * elapsed;
      const radius = 0.065, loop = 2 * length + 2 * Math.PI * radius;
      const s = ((number(motion.distance) + entry.distance) % loop + loop) % loop;
      let along, vertical, flip = 0;
      if (s <= length) { along = s; vertical = 0.0325; }
      else if (s <= length + Math.PI * radius) {
        const angle = (s - length) / radius;
        along = length + radius * Math.sin(angle); vertical = -radius + (radius + 0.0325) * Math.cos(angle); flip = angle;
      } else if (s <= 2 * length + Math.PI * radius) { along = 2 * length + Math.PI * radius - s; vertical = -2 * radius - 0.0325; flip = Math.PI; }
      else {
        const angle = (s - 2 * length - Math.PI * radius) / radius;
        along = -radius * Math.sin(angle); vertical = -radius - (radius + 0.0325) * Math.cos(angle); flip = Math.PI + angle;
      }
      const fraction = along / length;
      object.position.set(-config.length / 2 + fraction * config.length, fraction * number(config.rise) + vertical, 0);
      object.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -flip));
    }
    // Collision queries and selection bounds read the same live pose as the
    // visible mechanism. No movement is written back to authored transforms.
    object.updateMatrixWorld(true);
  }

  updateSteerBank(entry, angle) {
    if (Math.abs(entry.angle - angle) < 1e-8) return;
    const geometry = entry.object.geometry, rest = geometry.userData.industrialSteerRest;
    if (!rest) return;
    const position = geometry.attributes.position, normal = geometry.attributes.normal, cosine = Math.cos(angle), sine = Math.sin(angle);
    if (!angle) { position.array.set(rest.positions); normal.array.set(rest.normals); }
    else rest.ranges.forEach(range => {
      const px = range.pivot[0], pz = range.pivot[2];
      for (let vertex = range.start; vertex < range.start + range.count; vertex++) {
        const index = vertex * 3, x = rest.positions[index] - px, z = rest.positions[index + 2] - pz;
        position.array[index] = px + x * cosine + z * sine; position.array[index + 2] = pz - x * sine + z * cosine;
        normal.array[index] = rest.normals[index] * cosine + rest.normals[index + 2] * sine;
        normal.array[index + 2] = -rest.normals[index] * sine + rest.normals[index + 2] * cosine;
      }
    });
    position.needsUpdate = true; normal.needsUpdate = true;
    geometry.computeBoundingBox(); geometry.computeBoundingSphere(); entry.angle = angle;
  }

  restoreSteerBank(entry) {
    this.updateSteerBank(entry, 0);
    if (entry.installed) {
      if (entry.object.geometry === entry.installed) entry.object.geometry = entry.original;
      entry.installed.dispose();
    }
  }

  sync(roomId, delta = 0, editing = false) {
    const root = this.document.getRoot(roomId);
    const objectCount = this.document.objects && this.document.objects.size;
    // Authoring tools may replace a material independently. Rebuild only the
    // affected visual, and never restore an old material over the new choice.
    this.displays.forEach((entry, object) => {
      if (object.material !== entry.installed) { this.restoreDisplay(entry); this.displays.delete(object); this.dirty = true; }
    });
    this.colors.forEach((entry, object) => {
      if (object.material !== entry.installed) { this.restoreColor(entry); this.colors.delete(object); this.dirty = true; }
    });
    this.rollers.forEach((entry, object) => {
      if (object.material !== entry.installed) { this.restoreRoller(entry); this.rollers.delete(object); this.dirty = true; }
    });
    this.belts.forEach((entry, object) => {
      if (object.material !== entry.installed) { this.restoreRoller(entry); this.belts.delete(object); this.dirty = true; }
    });
    if (this.dirty || this.roomId !== String(roomId) || this.root !== root || this.objectCount !== objectCount) this.scan(roomId, root, objectCount);
    this.syncContactButtons(editing);
    const elapsed = Math.max(0, Math.min(number(delta), 0.25));
    this.elapsed += elapsed;
    const paint = this.elapsed >= DISPLAY_INTERVAL;
    if (paint) {
      this.elapsed = 0;
      this.panelSnapshots.clear();
      if (this.simulation && this.simulation.getSnapshot && !this.simulation.records) this.snapshot = this.simulation.getSnapshot();
    }
    const cache = new Map();
    const values = record => {
      if (!record) return null;
      if (!cache.has(record)) cache.set(record, this.variables(record, editing));
      return cache.get(record);
    };
    this.frame = (this.frame || 0) + 1;
    this.mechanisms.forEach(entry => {
      if (!visible(entry.object)) return;
      this.updateMechanism(entry, values(entry.conveyor), elapsed, editing);
    });
    this.steerBanks.forEach(entry => this.updateSteerBank(entry, editing ? 0 : steerAngle(values(entry.conveyor), entry.conveyor.configurations.conveyor)));
    this.processorHeads.forEach(entry => {
      if (!visible(entry.object) || this.ctx.performanceVisibility && !this.ctx.performanceVisibility.isVisible(entry.processor.object)) return;
      const state = values(entry.processor);
      const active = state && !editing && state.enabled !== false && state.powered !== false && state.running && !state.paused && !state.emergency && state.busy && !state.settingUp && !state.waitingOperator;
      const progress = Math.max(0, Math.min(100, number(state && state.progress)));
      entry.object.position.copy(entry.rest);
      if (active) entry.object.position.y -= (1 - Math.cos(progress / 100 * Math.PI * 2)) * 0.055;
    });
    this.rollerTextures.forEach(surface => {
      if (surface.source && surface.source.version !== surface.sourceVersion) {
        surface.sourceVersion = surface.source.version; surface.texture.needsUpdate = true;
      }
    });
    this.rollers.forEach(entry => {
      const state = values(entry.conveyor);
      const gravity = entry.conveyor.configurations.conveyor && entry.conveyor.configurations.conveyor.drive === 'gravity';
      if (!state || editing || !gravity && (state.powered === false || !state.running) || state.paused || state.emergency || state.enabled === false || !visible(entry.object)) return;
      const speed = number(Number.isInteger(entry.zone) ? state['zone' + (entry.zone + 1) + 'Speed'] : undefined, number(state.actualSpeed));
      if (!speed || !elapsed) return;
      this.scale.setFromMatrixScale(entry.object.matrixWorld);
      // Cylinders rotate about their local axis. Account for uniform model scaling
      // so roller surface speed matches the simulated speed in world metres.
      const radial = entry.axis === 'x' ? Math.max(this.scale.y, this.scale.z) : entry.axis === 'z' ? Math.max(this.scale.x, this.scale.y) : Math.max(this.scale.x, this.scale.z);
      entry.angle = (entry.angle + entry.direction * speed * elapsed / (entry.radius * Math.max(0.0001, radial))) % (Math.PI * 2);
      if (this.ctx.performanceVisibility && !this.ctx.performanceVisibility.isVisible(entry.conveyor.object)) return;
      // Rotate the cylinder's surface pattern instead of its collision mesh.
      // Cylinders are rotationally symmetric; UV motion gives the same visible
      // cue while retaining static BVHs, bounds, document transforms and poses.
      entry.surfaces.forEach(surface => {
        if (surface.lastFrame === this.frame) return;
        surface.lastFrame = this.frame;
        surface.texture.offset.x = surface.offset - entry.angle / (Math.PI * 2);
      });
    });
    this.belts.forEach(entry => {
      const state = values(entry.conveyor);
      if (!state || editing || state.powered === false || state.paused || state.emergency || state.enabled === false || !state.running || !visible(entry.object)) return;
      const speed = number(Number.isInteger(entry.zone) ? state['zone' + (entry.zone + 1) + 'Speed'] : undefined, number(state.actualSpeed));
      if (!speed || !elapsed) return;
      this.scale.setFromMatrixScale(entry.object.matrixWorld);
      entry.distance = (entry.distance + entry.direction * speed * elapsed / (entry.metersPerRepeat * Math.max(0.0001, this.scale[entry.scaleAxis]))) % 1;
      if (this.ctx.performanceVisibility && !this.ctx.performanceVisibility.isVisible(entry.conveyor.object)) return;
      entry.surfaces.forEach(surface => {
        if (surface.lastFrame === this.frame) return;
        surface.lastFrame = this.frame;
        surface.texture.offset[entry.textureAxis] = surface.offsets[entry.textureAxis] + entry.distance;
      });
    });
    this.bindings.forEach(binding => {
      const feedback = binding.kind === 'button' ? this.updateButton(binding, elapsed, editing) : null;
      const feedbackLight = feedback ? (feedback.hovered ? 0.12 : 0) + feedback.amount * 0.18 : 0;
      if (!binding.conveyor) {
        setColor(binding.entry, '#35434c', feedbackLight, binding.kind === 'volume' ? 0.015 : undefined);
        return;
      }
      const scope = binding.kind === 'sensor' || binding.kind === 'volume' ? 'module' : binding.scope;
      const state = this.panelSnapshot(binding.conveyor, scope, editing, values).variables;
      if (!state) { setColor(binding.entry, '#35434c', feedbackLight); return; }
      if (binding.kind === 'zone') {
        const zones = state.zoneOccupied || state.zones || [];
        const zone = typeof state['zone' + (binding.zone + 1) + 'Occupied'] === 'boolean' ? state['zone' + (binding.zone + 1) + 'Occupied'] : zones[binding.zone];
        const occupied = typeof zone === 'object' ? !!(zone && (zone.occupied || zone.count)) : !!zone;
        setColor(binding.entry, occupied ? AMBER : GREEN, occupied ? 0.85 : 0.18);
      } else if (binding.kind === 'sensor' || binding.kind === 'volume') {
        const sensor = values(binding.sensor) || {};
        const occupied = !!sensor.occupied;
        const unpoweredTransport = binding.conveyor.configurations.conveyor && binding.conveyor.configurations.conveyor.drive !== 'motor';
        const enabled = sensor.enabled !== false && (state.powered !== false || unpoweredTransport);
        setColor(binding.entry, !enabled ? '#35434c' : occupied ? GREEN : RED, !enabled ? 0 : occupied ? 0.85 : 0.22,
          binding.kind === 'volume' ? enabled && occupied ? 0.18 : 0.025 : undefined);
      } else if (binding.kind === 'tower') {
        const processor = !!binding.conveyor.configurations.processor;
        const robot = !!binding.conveyor.configurations.robot;
        const active = binding.tower === 'fault' ? !!state.emergency || !!state.fault : binding.tower === 'paused' ? state.powered !== false && !state.emergency && (!!state.paused || !!state.palletFull || !!state.waitingOperator || !!state.settingUp || !!state.blocked || !state.running) :
          binding.tower === 'powered' ? state.powered !== false : state.powered !== false && !!state.running && !state.paused && !state.emergency && (robot ? !!state.phase && state.phase !== 'idle' && !state.blocked && !state.fault : processor ? !!state.busy && !state.settingUp && !state.waitingOperator : number(state.actualSpeed) !== 0);
        const color = binding.tower === 'fault' ? RED : binding.tower === 'paused' ? AMBER : binding.tower === 'powered' ? CYAN : GREEN;
        setColor(binding.entry, active ? color : '#263d46', active ? 0.9 : 0.02);
      } else {
        const action = binding.action;
        const active = action === 'start' ? !!state.running && !state.paused && !state.emergency && state.powered !== false : action === 'stop' ? !state.running && state.powered !== false :
          action === 'pause' ? !!state.paused : action === 'powerOn' ? state.powered !== false : action === 'powerOff' ? state.powered === false : action === 'emergency' || action === 'resetEmergency' ? !!state.emergency : action === 'operator' ? !!state.operatorAvailable : false;
        const base = binding.entry.original && materials(binding.entry.original)[0];
        // Managed PBR colours are linear floats. Preserve those values through
        // live button feedback rather than quantizing them into a linear hex.
        const color = action === 'insertBox' && state.externalSupply ? '#53616b' : base && base.color ? base.color : CYAN;
        setColor(binding.entry, color, (active ? 0.7 : 0.08) + feedbackLight);
      }
    });
    if (paint) this.displays.forEach(entry => {
      if (!visible(entry.object) || this.ctx.performanceVisibility && !this.ctx.performanceVisibility.isVisible(entry.object)) return;
      const snapshot = this.panelSnapshot(entry.conveyor, entry.scope, editing, values);
      const sensors = entry.conveyor && entry.scope === 'module' ? this.sensors.filter(sensor => sensor.conveyor === entry.conveyor).map(sensor => ({name: sensor.record.object.name, variables: values(sensor.record)})) : [];
      this.paintDisplay(entry, snapshot.variables, sensors, editing, snapshot);
    });
    this.rollerBatches.sync(root, this.rollers, {editing, supported: this.rollerInstancing});
  }

  paintDisplay(entry, state, sensors, editing, snapshot) {
    if (entry.scope !== 'line' && entry.conveyor && entry.conveyor.configurations.vehicle) {
      this.paintVehicleDisplay(entry, state, editing); return;
    }
    if (entry.scope !== 'line' && (entry.conveyor && entry.conveyor.configurations.robot || entry.object.userData.industrialRobotDisplay)) {
      this.paintRobotDisplay(entry, state, editing); return;
    }
    if (entry.scope !== 'line' && (entry.conveyor && entry.conveyor.configurations.palletQueue || entry.object.userData.industrialPalletQueueDisplay)) {
      this.paintPalletQueueDisplay(entry, state, editing); return;
    }
    if (entry.scope !== 'line' && (entry.conveyor && entry.conveyor.configurations.processor || entry.object.userData.industrialProcessorDisplay)) {
      this.paintProcessorDisplay(entry, state, editing); return;
    }
    if (entry.scope !== 'line' && (entry.conveyor && entry.conveyor.configurations.source || entry.object.userData.industrialSourceDisplay)) {
      this.paintSourceDisplay(entry, state, editing); return;
    }
    const variables = state || {};
    const scope = entry.scope || 'module';
    const scopeName = scope === 'line' ? 'LÍNEA' : scope === 'segment' ? 'TRAMO' : 'MÓDULO';
    const moduleCount = snapshot ? snapshot.memberIds.length : entry.conveyor ? 1 : 0;
    const scopeLabel = scopeName + (scope === 'module' ? '' : ' · ' + moduleCount + ' MÓDULOS');
    const status = state ? stateOf(variables, editing) : {label: entry.bindingConflict ? 'VÍNCULOS DISTINTOS' : snapshot && snapshot.unavailable ? scopeName + ' SIN DATOS' : 'SIN VINCULAR', color: AMBER};
    const machineName = entry.conveyor && String(entry.conveyor.object.name || 'Banda transportadora');
    const machineIdentity = entry.conveyor ? (machineName.length > 22 ? machineName.slice(0, 21) + '…' : machineName) + ' · ' + entry.conveyor.shortId : 'PANEL SIN MÁQUINA';
    const entrySensor = sensors.find(sensor => /entrada|entry/i.test(sensor.name)) || sensors[0];
    const exitSensor = sensors.find(sensor => /salida|exit/i.test(sensor.name)) || (sensors.length > 1 ? sensors[sensors.length - 1] : null);
    const speed = number(variables.actualSpeed), target = number(variables.speed);
    const runningSeconds = number(variables.runSeconds), output = number(variables.exitCount);
    const productionLine = scope === 'line' && variables.storedUnits !== undefined;
    const config = entry.conveyor && entry.conveyor.configurations.conveyor || {};
    const classifying = config.layout === 'tee' && config.junctionMode === 'split';
    const routingLabel = config.routing === 'rules' ? 'POR REGLAS' : config.routing === 'percentage' ? number(config.branchPercentage, 50).toFixed(1) + '% LAT.' : config.routing === 'alternate' ? 'ALTERNAR' : config.routing === 'branch' ? 'LATERAL' : 'PRINCIPAL';
    const inputOccupied = !!(entrySensor && entrySensor.variables.occupied), outputOccupied = !!(exitSensor && exitSensor.variables.occupied);
    const signature = [status.label, machineIdentity, scopeLabel, editing, target.toFixed(2), speed.toFixed(2), count(variables.entryCount), count(output), count(variables.inFlight),
      clock(runningSeconds), (runningSeconds > 0 ? output * 60 / runningSeconds : 0).toFixed(1), inputOccupied, outputOccupied,
      entrySensor && count(entrySensor.variables.count), exitSensor && count(exitSensor.variables.count), variables.autoSpawn, variables.externalSupply, variables.internalSupplyActive,
      count(variables.palletCount), count(variables.palletCapacity), !!variables.palletFull, count(variables.storedUnits), number(variables.utilization).toFixed(1), count(variables.queued),
      classifying, routingLabel, config.routingDefault, config.routingRules, count(variables.routedMain), count(variables.routedBranch), count(variables.routingUnmatched)].join('|');
    if (entry.signature === signature) return;
    entry.signature = signature;
    const c = entry.context;
    const text = (value, x, y, size = 24, color = WHITE, weight = 500) => {
      c.fillStyle = color; c.font = weight + ' ' + size + 'px Arial, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillText(String(value), x, y);
    };
    c.fillStyle = '#081721'; c.fillRect(0, 0, 1024, 512);
    c.fillStyle = '#102937'; c.fillRect(0, 0, 1024, 76);
    c.fillStyle = CYAN; c.fillRect(0, 0, 7, 76);
    text(machineIdentity, 28, 31, 22, DIM, 700);
    text(scopeLabel + (editing ? ' / VISTA PREVIA' : ' / SIMULACIÓN'), 28, 59, 20, CYAN);
    text(status.label, 548, 51, 34, status.color, 700);
    c.fillStyle = '#10232f'; c.fillRect(20, 92, 984, 126);
    text('VELOCIDAD REAL', 38, 122, 21, DIM, 700);
    text(state ? speed.toFixed(2) : '—', 38, 185, 58, state && !editing && Math.abs(speed) > 0 ? GREEN : WHITE, 700);
    text('m/s', 204, 181, 27, DIM);
    text(state ? (speed * 60).toFixed(1) + ' m/min' : '— m/min', 312, 180, 31, WHITE, 700);
    text('CONSIGNA', 679, 123, 21, DIM, 700);
    text(state ? target.toFixed(2) + ' m/s' : '— m/s', 679, 173, 35, CYAN, 700);
    const supply = variables.externalSupply ? 'EXTERNA' : variables.internalSupplyActive ? 'RESPALDO' : 'MANUAL';
    [['ENTRADAS' + (scope === 'module' ? '' : ' ' + scopeName), variables.entryCount], ['SALIDAS' + (scope === 'module' ? '' : ' ' + scopeName), variables.exitCount], [productionLine ? 'EN LÍNEA / COLAS' : 'EN BANDA', productionLine ? number(variables.inFlight) + number(variables.queued) : variables.inFlight], [productionLine ? 'ESTIBAS OCUPADAS' : classifying ? 'CLASIFICACIÓN' : 'ALIMENTACIÓN', productionLine ? count(variables.palletCount) + ' / ' + count(variables.palletCapacity) : classifying ? routingLabel : supply]].forEach((field, index) => {
      const x = 20 + index * 249;
      c.fillStyle = '#10232f'; c.fillRect(x, 232, 237, 104);
      text(field[0], x + 18, 262, 22, DIM, 700);
      text(state ? index === 3 ? field[1] : count(field[1]) : '—', x + 18, 315, index === 3 ? classifying ? 27 : 35 : 42, index === 3 ? CYAN : WHITE, 700);
    });
    const sensor = (label, item, occupied, x) => {
      c.fillStyle = item ? occupied ? GREEN : RED : '#40525f'; c.fillRect(x, 362, 18, 18);
      text(label + ': ' + (!item ? '—' : occupied ? 'DETECTANDO' : 'LIBRE'), x + 29, 379, 23, item && occupied ? GREEN : WHITE, 700);
      text('Pulsos: ' + (item ? count(item.variables.count) : '—'), x + 29, 410, 22, DIM);
    };
    if (scope === 'module') {
      sensor('ENTRADA', entrySensor, inputOccupied, 38);
      sensor('SALIDA', exitSensor, outputOccupied, 528);
    } else {
      text('ALCANCE: ' + moduleCount + ' MÓDULOS', 38, 379, 23, CYAN, 700);
      text('ANCLA ' + (entry.conveyor ? entry.conveyor.shortId : '—'), 528, 379, 23, DIM);
      text(productionLine ? 'Almacenadas ' + count(variables.storedUnits) + ' uds · Utilización ' + number(variables.utilization).toFixed(1) + '%' : 'Entradas y salidas externas · sin contar transferencias internas', 38, 410, 23, DIM);
    }
    c.fillStyle = '#173442'; c.fillRect(20, 432, 984, 2);
    if (classifying) {
      text('PRINCIPAL ' + count(variables.routedMain) + ' · LATERAL ' + count(variables.routedBranch), 38, 466, 22, CYAN, 700);
      text(config.routing === 'rules' ? 'Sin coincidencia → ' + (config.routingDefault === 'branch' ? 'LATERAL' : 'PRINCIPAL') : config.routing === 'percentage' ? 'Reparto acumulado por cargas' : 'Decisiones al entrar en el módulo', 528, 466, 21, DIM);
    } else {
      text('Tiempo activo ' + (state ? clock(runningSeconds) : '—'), 38, 466, 22, DIM);
      text('Producción ' + (state ? (runningSeconds > 0 ? output * 60 / runningSeconds : 0).toFixed(1) : '—') + ' uds/min', 528, 466, 22, DIM);
    }
    const hint = !state ? entry.bindingConflict ? 'Los mandos tienen destinos o alcances distintos · revísalos' : snapshot && snapshot.unavailable ? 'La telemetría de este alcance no está disponible' : 'Vincula este panel a una banda desde el inspector' : editing ? 'Pulsa Probar para operar · controles físicos en el panel' :
      variables.palletFull ? status.label === 'PALLET LLENO' ? 'PALLET LLENO · retira cajas superiores para continuar' : 'PALLET BLOQUEADO · libera espacio u obstáculos en la salida' : variables.transferBlocked ? classifying ? 'Salida elegida bloqueada · conserva el destino de la carga' : 'Salida ocupada, detenida o sin conexión · revisa el siguiente tramo' : classifying ? 'Atributos simulados · clasificación por carga, incluidos pallets' : variables.externalSupply ? 'ALIMENTACIÓN EXTERNA · generador de respaldo suspendido' : variables.autoSpawn === false ? 'Carga MANUAL · + Caja añade un producto independiente' : 'GENERADOR DE RESPALDO · activo sin alimentación externa';
    text(hint, 38, 498, 20, variables.palletFull ? AMBER : CYAN);
    entry.texture.needsUpdate = true;
  }

  paintRobotDisplay(entry, state, editing) {
    const v = state || {}, record = entry.conveyor, config = record && record.configurations.robot || {};
    const phaseNames = {idle: 'ESPERANDO', setup: 'PREPARACIÓN', approach: 'APROXIMACIÓN', pick: 'RECOGIENDO', lift: 'ELEVANDO', carry: 'TRASLADANDO', place: 'DEPOSITANDO', release: 'ENTREGANDO', return: 'RETORNO', process: 'PROCESANDO', blocked: 'RECEPTOR OCUPADO', 'wait-output': 'ESPERANDO SALIDA', 'drive-input': 'A RECOGIDA', 'drive-output': 'A ENTREGA', 'process-contact': 'HERRAMIENTA A PIEZA', 'process-dwell': 'PROCESANDO', 'process-retract': 'RETIRANDO HERRAMIENTA'};
    const label = editing ? 'VISTA PREVIA' : !state ? 'SIN VINCULAR' : v.emergency ? 'EMERGENCIA' : v.fault ? 'FALLO' : !v.powered ? 'APAGADO' : v.paused ? 'PAUSADO' : !v.running ? 'DETENIDO' : v.blocked ? 'ESPERANDO SALIDA' : phaseNames[v.phase] || v.phaseText || 'LISTO';
    const statusColor = v.emergency || v.fault ? RED : !v.powered || v.paused || !v.running || v.blocked ? AMBER : GREEN;
    const name = record ? record.object.name : 'Robot sin vínculo';
    const signature = [name, label, config.variant, config.mode, config.tool, v.entryCount, v.exitCount, v.inFlight, v.loadKg, v.payloadKg,
      number(v.utilization).toFixed(1), clock(number(v.busySeconds)), clock(number(v.idleSeconds)), clock(number(v.blockedSeconds)), number(v.tcpX).toFixed(2), number(v.tcpY).toFixed(2), number(v.tcpZ).toFixed(2), v.fault].join('|');
    if (entry.signature === signature) return; entry.signature = signature;
    const c = entry.context, text = (value, x, y, size = 24, color = WHITE, width = 970) => {
      c.fillStyle = color; c.font = '600 ' + size + 'px Arial, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillText(String(value), x, y, width);
    };
    c.fillStyle = '#081721'; c.fillRect(0, 0, 1024, 512);
    c.fillStyle = '#102937'; c.fillRect(0, 0, 1024, 76); c.fillStyle = CYAN; c.fillRect(0, 0, 7, 76);
    text(name, 26, 30, 23, DIM, 600); text('ROBOT · ' + (config.family || '') + ' / ' + (config.mode === 'manual' ? 'MANUAL' : 'AUTO'), 26, 61, 20, CYAN, 550);
    text(label, 590, 50, 27, statusColor, 405);
    [['RECIBIDAS', count(v.entryCount)], ['ENTREGADAS', count(v.exitCount)], ['CARGA RETENIDA', count(v.inFlight)], ['UTILIZACIÓN', number(v.utilization).toFixed(1) + '%']].forEach(([caption, value], index) => {
      const x = 20 + index * 249; c.fillStyle = '#10232f'; c.fillRect(x, 92, 237, 105); text(caption, x + 15, 122, 20, DIM, 210); text(value, x + 15, 178, 42, index === 3 ? CYAN : WHITE, 210);
    });
    text('HERRAMIENTA  ' + (config.tool || '—'), 38, 237, 22, CYAN, 460);
    text('CARGA  ' + number(v.loadKg).toFixed(1) + ' / ' + number(config.payloadKg).toFixed(1) + ' kg', 535, 237, 23, WHITE, 450);
    text('TCP LOCAL · m', 38, 278, 20, DIM); text('X ' + number(v.tcpX).toFixed(2) + '   Y ' + number(v.tcpY).toFixed(2) + '   Z ' + number(v.tcpZ).toFixed(2), 38, 319, 31, WHITE);
    c.fillStyle = '#173442'; c.fillRect(20, 344, 984, 2);
    [['TRABAJO', v.busySeconds], ['OCIO', v.idleSeconds], ['BLOQUEO', v.blockedSeconds]].forEach(([caption, seconds], index) => {
      const x = 38 + index * 325; text(caption, x, 382, 20, DIM, 300); text(clock(number(seconds)), x, 423, 32, WHITE, 300);
    });
    text(v.faultLabel || v.fault || (editing ? 'Configura origen, receptor y ejes en el inspector' : config.mode === 'manual' ? 'Marcha habilita · Despachar solicita un ciclo' : 'Secuencia automática · el receptor lleno conserva la carga'), 38, 469, 22, v.fault ? RED : CYAN, 950);
    text('Setup ' + number(config.setupTime).toFixed(1) + ' s · Ciclo mínimo ' + number(config.cycleTime).toFixed(1) + ' s · Alcance ' + number(config.reach).toFixed(2) + ' m', 38, 501, 20, DIM, 950);
    entry.texture.needsUpdate = true;
  }

  paintVehicleDisplay(entry, state, editing) {
    const v = state || {}, record = entry.conveyor, config = record && record.configurations.vehicle || {};
    const label = editing ? 'VISTA PREVIA' : v.emergency ? 'EMERGENCIA' : !v.powered ? 'APAGADO' : v.warning ? 'ATENCIÓN' : v.parkingBrake ? 'FRENO P' : v.running ? 'HABILITADO' : 'DETENIDO';
    const signature = [label, v.actualSpeed, v.forkHeight, v.loadKg, v.capacityKg, v.batteryPercent, v.distance, v.warning, v.receivedUnits, v.deliveredUnits].join('|');
    if (entry.signature === signature) return; entry.signature = signature;
    const c = entry.context, text = (value, x, y, size = 25, color = WHITE) => { c.fillStyle = color; c.font = '600 ' + size + 'px Arial, sans-serif'; c.textAlign = 'left'; c.fillText(String(value), x, y, 960 - x); };
    c.fillStyle = '#081721'; c.fillRect(0, 0, 1024, 512); c.fillStyle = '#102937'; c.fillRect(0, 0, 1024, 86);
    text(record ? record.object.name : 'Vehículo', 28, 37, 28, CYAN); text(label, 28, 72, 24, v.emergency ? RED : v.parkingBrake || v.warning ? AMBER : GREEN);
    text('VELOCIDAD', 32, 134, 21, DIM); text(number(v.actualSpeed).toFixed(2) + ' m/s', 32, 181, 42);
    text('HORQUILLAS', 528, 134, 21, DIM); text(number(v.forkHeight).toFixed(2) + ' m', 528, 181, 42);
    text('CARGA / CAPACIDAD EFECTIVA', 32, 243, 22, DIM); text(number(v.loadKg).toFixed(0) + ' / ' + number(v.capacityKg, number(config.payloadKg)).toFixed(0) + ' kg', 32, 285, 36);
    text('BATERÍA ' + number(v.batteryPercent, 100).toFixed(1) + '%', 32, 349, 26, CYAN); text('RECORRIDO ' + number(v.distance).toFixed(1) + ' m', 528, 349, 26);
    text('RECIBIDAS ' + number(v.receivedUnits) + ' u · ENTREGADAS ' + number(v.deliveredUnits) + ' u', 32, 410, 26);
    text(v.warning || 'Entrada física de horquillas · frena antes de tomar o depositar', 32, 475, 22, v.warning ? AMBER : DIM);
    entry.texture.needsUpdate = true;
  }

  paintPalletQueueDisplay(entry, state, editing) {
    const variables = state || {}, record = entry.conveyor, config = record && record.configurations.palletQueue || {};
    const queued = number(variables.queued), capacity = number(variables.capacity, number(config.capacity));
    const full = !!variables.full || capacity > 0 && queued >= capacity, blocked = !!variables.blocked;
    const occupancy = Math.max(0, Math.min(100, number(variables.occupancy, capacity > 0 ? queued / capacity * 100 : 0)));
    const automatic = (variables.delivery || config.delivery) === 'automatic';
    const status = !state ? ['SIN VINCULAR', AMBER] : editing ? ['LISTA / VISTA PREVIA', CYAN] : variables.enabled === false ? ['DESHABILITADA', AMBER] :
      variables.paused ? ['EN PAUSA', AMBER] : !variables.running ? ['DETENIDA', DIM] : full ? ['ESTIBA LLENA', AMBER] : blocked ? ['SALIDA BLOQUEADA', AMBER] : ['DISPONIBLE', GREEN];
    const identity = record ? String(record.object.name || 'Pallet Queue').slice(0, 23) + ' · ' + record.shortId : 'ALMACÉN SIN VINCULAR';
    const signature = [identity, status[0], queued, capacity, variables.queuedUnits, occupancy.toFixed(1), variables.received, variables.receivedUnits,
      variables.delivered, variables.deliveredUnits, automatic, config.columns, config.rows, config.layers].join('|');
    if (entry.signature === signature) return;
    entry.signature = signature;
    const c = entry.context;
    const text = (value, x, y, size = 24, color = WHITE, weight = 500) => {
      c.fillStyle = color; c.font = weight + ' ' + size + 'px Arial, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillText(String(value), x, y);
    };
    c.fillStyle = '#081721'; c.fillRect(0, 0, 1024, 512);
    c.fillStyle = '#102937'; c.fillRect(0, 0, 1024, 76); c.fillStyle = CYAN; c.fillRect(0, 0, 7, 76);
    text(identity, 26, 31, 22, DIM, 700); text('PALLET QUEUE / ESTIBA', 26, 59, 20, CYAN);
    text(status[0], 575, 49, 28, status[1], 700);
    c.fillStyle = '#10232f'; c.fillRect(20, 92, 984, 124);
    text('CARGAS ALMACENADAS', 38, 122, 23, DIM, 700); text(count(queued) + ' / ' + count(capacity), 38, 186, 60, full ? AMBER : WHITE, 700);
    text('UNIDADES', 700, 122, 23, DIM, 700); text(count(variables.queuedUnits), 700, 184, 53, CYAN, 700);
    text('OCUPACIÓN ' + occupancy.toFixed(1) + '%', 30, 252, 25, full ? AMBER : CYAN, 700);
    text(count(config.columns) + ' × ' + count(config.rows) + ' × ' + count(config.layers) + ' POSICIONES', 560, 252, 23, DIM);
    c.fillStyle = '#203b49'; c.fillRect(24, 269, 976, 18); c.fillStyle = full ? AMBER : GREEN; c.fillRect(24, 269, Math.round(976 * occupancy / 100), 18);
    [['RECIBIDAS', variables.received, variables.receivedUnits], ['DESPACHADAS', variables.delivered, variables.deliveredUnits]].forEach(([caption, loads, units], index) => {
      const x = 20 + index * 498; c.fillStyle = '#10232f'; c.fillRect(x, 307, 486, 107);
      text(caption, x + 18, 335, 23, DIM, 700); text(count(loads), x + 18, 390, 47, WHITE, 700); text(count(units) + ' uds', x + 238, 389, 29, CYAN);
    });
    text(automatic ? 'SALIDA AUTOMÁTICA / FLUJO' : 'SALIDA MANUAL / RECOGER CAJAS', 30, 454, 26, CYAN, 700);
    const hint = editing ? 'Probar para almacenar · conecta este equipo desde el editor' : blocked ? 'Libera la salida o revisa la conexión con el siguiente proceso' : full ? 'Estiba llena · retira las cajas superiores para liberar posiciones' : 'Apilado real · retira primero las cajas superiores de cada columna';
    text(hint, 30, 496, 20, full || blocked ? AMBER : DIM);
    entry.texture.needsUpdate = true;
  }

  paintProcessorDisplay(entry, state, editing) {
    const variables = state || {}, record = entry.conveyor, config = record && record.configurations.processor || {};
    const labels = {OFF: ['APAGADA', DIM], STOPPED: ['DETENIDA', AMBER], PAUSED: ['EN PAUSA', AMBER], EMERGENCY: ['EMERGENCIA', RED],
      WAITING_OPERATOR: ['ESPERA OPERARIO', AMBER], SETUP: ['PREPARACIÓN', CYAN], PROCESSING: ['PROCESANDO', GREEN], BLOCKED: ['SALIDA BLOQUEADA', AMBER], IDLE: ['ESPERANDO CARGA', CYAN]};
    const fallback = variables.powered === false ? 'OFF' : variables.emergency ? 'EMERGENCY' : variables.paused ? 'PAUSED' : !variables.running ? 'STOPPED' : variables.waitingOperator ? 'WAITING_OPERATOR' : variables.settingUp ? 'SETUP' : variables.blocked ? 'BLOCKED' : variables.busy ? 'PROCESSING' : 'IDLE';
    const status = !state ? ['SIN VINCULAR', AMBER] : editing ? ['LISTA / VISTA PREVIA', CYAN] : labels[variables.state] || labels[fallback];
    const identity = record ? String(record.object.name || 'Processor').slice(0, 23) + ' · ' + record.shortId : 'PROCESSOR SIN VINCULAR';
    const mode = config.mode === 'combiner' ? 'COMBINER' : config.mode === 'separator' ? 'SEPARATOR' : 'PROCESSOR';
    const progress = Math.max(0, Math.min(100, number(variables.settingUp ? variables.setupProgress : variables.progress))), utilization = Math.max(0, Math.min(100, number(variables.utilization)));
    const processTime = number(variables.processTime, number(config.processTime, 5)), setupTime = number(variables.setupTime, number(config.setupTime, 2));
    const times = ['setupSeconds', 'processSeconds', 'idleSeconds', 'blockedSeconds', 'operatorWaitSeconds', 'downSeconds'];
    const signature = [identity, mode, status[0], progress.toFixed(1), utilization.toFixed(1), variables.queued, variables.capacity, variables.activeJobs,
      variables.parallelism, variables.outputQueued, variables.outputCapacity, variables.entryCount, variables.exitCount, variables.completed,
      variables.receivedUnits, variables.deliveredUnits, variables.completedUnits, variables.operatorAvailable, variables.nominalCapacity,
      processTime, setupTime, variables.settingUp, number(variables.setupRemaining).toFixed(1), ...times.map(key => Math.floor(number(variables[key])))].join('|');
    if (entry.signature === signature) return;
    entry.signature = signature;
    const c = entry.context;
    const text = (value, x, y, size = 24, color = WHITE, weight = 500) => {
      c.fillStyle = color; c.font = weight + ' ' + size + 'px Arial, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillText(String(value), x, y);
    };
    c.fillStyle = '#081721'; c.fillRect(0, 0, 1024, 512);
    c.fillStyle = '#102937'; c.fillRect(0, 0, 1024, 76); c.fillStyle = CYAN; c.fillRect(0, 0, 7, 76);
    text(identity, 26, 31, 22, DIM, 700); text(mode + ' / ' + (editing ? 'VISTA PREVIA' : 'SIMULACIÓN'), 26, 59, 20, CYAN);
    text(status[0], 560, 49, 27, status[1], 700);
    text('CICLO ' + processTime.toFixed(1) + ' s   ·   PREPARACIÓN ' + setupTime.toFixed(1) + ' s', 28, 111, 22, DIM);
    text(progress.toFixed(0) + '%', 910, 111, 24, status[1], 700);
    c.fillStyle = '#1b3444'; c.fillRect(24, 123, 976, 13); c.fillStyle = status[1]; c.fillRect(24, 123, Math.round(976 * progress / 100), 13);
    const cards = [['ENTRADA / FIFO', count(variables.queued) + '/' + count(number(variables.capacity, number(config.capacity)))],
      ['PUESTOS ACTIVOS', count(variables.activeJobs) + '/' + count(number(variables.parallelism, number(config.parallelism)))],
      ['SALIDA / FIFO', count(variables.outputQueued) + '/' + count(number(variables.outputCapacity, number(config.outputCapacity)))],
      ['UTILIZACIÓN', utilization.toFixed(1) + '%']];
    cards.forEach(([caption, value], index) => {
      const x = 20 + index * 249; c.fillStyle = '#10232f'; c.fillRect(x, 151, 237, 82);
      text(caption, x + 14, 177, 19, DIM, 700); text(value, x + 14, 217, 37, index === 3 ? CYAN : WHITE, 700);
    });
    [['RECIBIDAS', variables.entryCount, variables.receivedUnits], ['COMPLETADAS', variables.completed, variables.completedUnits], ['DESPACHADAS', variables.exitCount, variables.deliveredUnits]].forEach(([caption, loads, units], index) => {
      const x = 20 + index * 332; c.fillStyle = '#10232f'; c.fillRect(x, 246, 320, 96);
      text(caption, x + 15, 270, 20, DIM, 700); text(count(loads), x + 15, 310, 37, WHITE, 700); text(count(units) + ' uds', x + 135, 309, 25, CYAN);
    });
    const captions = ['PREPARACIÓN', 'PROCESO', 'INACTIVA', 'BLOQUEADA', 'OPERARIO', 'APAGADA'];
    times.forEach((key, index) => {
      const x = 28 + index % 3 * 332, y = index < 3 ? 374 : 410;
      text(captions[index] + '  ' + clock(variables[key]), x, y, 20, index === 3 && variables.blocked || index === 4 && variables.waitingOperator ? AMBER : DIM);
    });
    c.fillStyle = '#173442'; c.fillRect(20, 428, 984, 2);
    text('CAP. NOMINAL ' + number(variables.nominalCapacity, 60 * number(config.parallelism, 1) / Math.max(0.1, number(config.processTime, 5))).toFixed(1) + ' ciclos/min', 28, 460, 22, DIM);
    text('OPERARIO ' + (variables.operatorAvailable ? 'DISPONIBLE' : 'NO DISPONIBLE'), 565, 460, 22, variables.operatorAvailable ? GREEN : AMBER, 700);
    const hint = editing ? 'Probar → encender y pulsar MARCHA · conecta el flujo desde el inspector' : variables.emergency ? 'Emergencia activa · libera la condición y pulsa REARMAR' : variables.waitingOperator ? 'Pulsa OPERARIO para habilitar al operario de esta máquina' :
      variables.blocked ? 'Salida llena u ocupada · libera cargas o habilita el siguiente equipo' : variables.settingUp ? 'Preparando herramienta · ' + number(variables.setupRemaining).toFixed(1) + ' s restantes de setup' : variables.busy ? 'Ciclo en curso · los contadores pertenecen únicamente a esta máquina' : 'Entrada y salida FIFO · las cargas se pueden recoger manualmente';
    text(hint, 28, 496, 20, variables.emergency ? RED : variables.blocked || variables.waitingOperator ? AMBER : CYAN);
    entry.texture.needsUpdate = true;
  }

  paintSourceDisplay(entry, state, editing) {
    const variables = state || {}, record = entry.conveyor;
    const config = record && record.configurations.source || {};
    const queued = number(variables.queued, number(variables.queueCount));
    const capacity = number(variables.capacity, number(config.capacity));
    const next = variables.nextProduct || variables.nextName || variables.nextType || '—';
    const label = typeof next === 'object' ? next.name || next.label || next.type || 'Producto' : String(next);
    const full = !!variables.full || capacity > 0 && queued >= capacity;
    const blocked = !!variables.blocked || !!variables.transferBlocked;
    const status = !state ? ['SIN VINCULAR', AMBER] : editing ? ['LISTA', CYAN] : variables.enabled === false ? ['DESHABILITADA', AMBER] :
      variables.paused ? ['EN PAUSA', AMBER] : full ? ['COLA LLENA', AMBER] : blocked ? ['SALIDA OCUPADA', AMBER] : variables.running ? [config.autoGenerate === false ? 'RECIBIENDO' : 'GENERANDO', GREEN] : ['DETENIDA', DIM];
    const identity = record ? String(record.object.name || 'Source').slice(0, 24) + ' · ' + record.shortId : 'SOURCE SIN VINCULAR';
    const generated = number(variables.generatedCount, number(variables.generated));
    const dispatched = number(variables.dispatchedCount, number(variables.delivered, number(variables.dispatched)));
    const received = number(variables.receivedCount, number(variables.received));
    const units = number(variables.queuedUnits, queued);
    const automatic = (variables.delivery || config.delivery) === 'automatic';
    const signature = [identity, status[0], queued, capacity, label, generated, dispatched, received, units, automatic, variables.interval, config.interval, variables.totalLimit, config.totalLimit, editing].join('|');
    if (entry.signature === signature) return;
    entry.signature = signature;
    const c = entry.context;
    const text = (value, x, y, size = 24, color = WHITE, weight = 500) => {
      c.fillStyle = color; c.font = weight + ' ' + size + 'px Arial, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillText(String(value), x, y);
    };
    c.fillStyle = '#081721'; c.fillRect(0, 0, 1024, 512);
    c.fillStyle = '#102937'; c.fillRect(0, 0, 1024, 76);
    c.fillStyle = CYAN; c.fillRect(0, 0, 7, 76);
    text(identity, 26, 31, 22, DIM, 700);
    text('SOURCE / FIFO' + (editing ? ' / VISTA PREVIA' : ' / SIMULACIÓN'), 26, 59, 20, CYAN);
    text(status[0], 650, 51, 29, status[1], 700);
    c.fillStyle = '#10232f'; c.fillRect(20, 92, 984, 120);
    text('CARGAS EN COLA', 40, 123, 22, DIM, 700);
    text(count(queued) + ' / ' + count(capacity), 40, 187, 58, full ? AMBER : WHITE, 700);
    text('UNIDADES', 690, 123, 22, DIM, 700);
    text(count(units), 690, 184, 48, CYAN, 700);
    [['GENERADAS', generated], ['RECIBIDAS', received], ['DESPACHADAS', dispatched]].forEach(([caption, value], index) => {
      const x = 20 + index * 332;
      c.fillStyle = '#10232f'; c.fillRect(x, 229, 320, 100);
      text(caption, x + 18, 260, 22, DIM, 700); text(count(value), x + 18, 309, 42, WHITE, 700);
    });
    text('PRÓXIMA: ' + label.slice(0, 54), 38, 373, 27, queued ? WHITE : DIM, 700);
    text(automatic ? 'SALIDA AUTOMÁTICA / FLUJO' : 'SALIDA MANUAL / RECOGER CARGA', 38, 413, 24, CYAN, 700);
    c.fillStyle = '#173442'; c.fillRect(20, 432, 984, 2);
    const interval = number(variables.interval, number(config.interval, 3));
    text('Intervalo ' + interval.toFixed(1) + ' s', 38, 466, 23, DIM);
    const limit = number(variables.totalLimit, number(config.totalLimit));
    text('Límite total ' + (limit ? count(limit) : 'sin límite'), 528, 466, 23, DIM);
    const hint = editing ? 'Pulsa Probar · configura el catálogo y la conexión en el inspector' : full ? 'Cola llena · libera la próxima carga para continuar' :
      blocked ? 'Esperando espacio y compatibilidad en el siguiente proceso' : automatic ? 'Flujo activo · cada equipo conserva sus propios datos' : 'Recoge la próxima carga de la mesa con el ratón o el mando VR';
    text(hint, 38, 498, 20, full || blocked ? AMBER : CYAN);
    entry.texture.needsUpdate = true;
  }

  restoreDisplay(entry) {
    if (entry.object.material === entry.installed) entry.object.material = entry.original;
    entry.material.dispose(); entry.texture.dispose();
  }

  restoreColor(entry) {
    if (entry.object.material === entry.installed) entry.object.material = entry.original;
    entry.privateMaterials.forEach(material => material.dispose());
  }

  restoreButton(entry) {
    entry.object.position.copy(entry.rest);
    entry.amount = 0; entry.pulseRemaining = 0;
  }

  releaseContact(hand, cancel = false) {
    if (hand.contact) {
      const {state, hit} = hand.contact;
      const callback = cancel ? state.onSelectCancel || state.onSelectEnd : state.onSelectEnd;
      if (callback) callback(hit, hand.token);
      if (state.onHoverLeave) state.onHoverLeave(hit, false, hand.token);
      hand.contact = null;
    }
    hand.armed = false;
  }

  resetContactHands() {
    this.contactHands.forEach(hand => this.releaseContact(hand, true)); this.contactHands.clear();
  }

  syncContactButtons(editing) {
    const ctx = this.ctx, simulation = this.simulation, input = ctx.raycontrol;
    if (this.contactInput !== input) {
      if (this.contactInput && this.contactInput.removeEventListener) {
        this.contactInput.removeEventListener('controllerDisconnected', this.contactCancelled);
        this.contactInput.removeEventListener('controllerInputCancelled', this.contactCancelled);
      }
      this.resetContactHands(); this.contactInput = input;
      this.contactCancelled = data => {
        const hand = this.contactHands.get(data && data.controller);
        if (hand) { this.releaseContact(hand, true); this.contactHands.delete(data.controller); }
      };
      if (input && input.addEventListener) {
        input.addEventListener('controllerDisconnected', this.contactCancelled);
        input.addEventListener('controllerInputCancelled', this.contactCancelled);
      }
    }
    const dom = ctx.document || (typeof document !== 'undefined' ? document : null), editor = ctx.editor;
    const xr = ctx.renderer && ctx.renderer.xr, session = xr && xr.getSession && xr.getSession();
    const blocked = editing || !ctx.vrMode || ctx.studioMenuOpen || ctx.xrEntryPending || ctx.xrExitPending || ctx.roomTransition ||
      editor && (editor.active || editor.initializing || editor.loadingProject || editor.busy || editor.importingFiles) || dom && dom.hidden ||
      !simulation || !simulation.running || !input || !input.states || !Array.isArray(input.currentStates) || input.enabled === false || xr && xr.getSession && !session || session && session.visibilityState && session.visibilityState !== 'visible';
    if (blocked) { this.resetContactHands(); return; }
    this.contactStates.clear();
    (simulation.states || []).forEach(entry => { if (input.states[entry.name] === entry.state && input.currentStates.includes(entry.state)) this.contactStates.set(entry.state.colliderMesh, entry.state); });
    const connected = new Set();
    (input.controllers || []).forEach(data => {
      const controller = data.controller, source = data.inputSource;
      if (!controller || data.desktop || !source || source.targetRayMode !== 'tracked-pointer' || source.hand || !['left', 'right'].includes(source.handedness)) return;
      connected.add(controller);
      let hand = this.contactHands.get(controller);
      if (!hand || hand.source !== source) {
        if (hand) this.releaseContact(hand, true);
        // A separate physical contact identity shares the existing control's
        // mechanical latch with trigger presses without releasing that trigger.
        const token = {getWorldPosition: target => controller.getWorldPosition(target), getObjectByName: name => controller.getObjectByName(name)};
        hand = {source, token, armed: false, contact: null}; this.contactHands.set(controller, hand);
      }
      const grip = simulation.productGripInputs && simulation.productGripInputs.get(controller);
      if (data.enabled === false || !visible(controller) || controller.userData && (controller.userData.grabbing || controller.userData.studioMenuTrigger) ||
        simulation.held && simulation.held.has(controller) || grip && grip.product) { this.releaseContact(hand, true); return; }
      controller.updateWorldMatrix(true, false);
      // A small probe at the visible controller's front, never its long ray.
      this.contactProbe.set(0, 0, -.045).applyMatrix4(controller.matrixWorld);
      let near = null;
      for (const button of this.contactButtons) {
        const state = this.contactStates.get(button.owner);
        if (!state || input.allowedState && !input.allowedState(state) || !visible(button.cap)) continue;
        const elements = button.owner.matrixWorld.elements;
        this.contactCenter.copy(button.center).applyMatrix4(button.owner.matrixWorld);
        // Frobenius norm is conservative even under scaled/rotated ancestors.
        const scale = Math.hypot(elements[0], elements[1], elements[2], elements[4], elements[5], elements[6], elements[8], elements[9], elements[10]);
        if (this.contactProbe.distanceToSquared(this.contactCenter) > Math.pow(button.radius * scale + .055, 2)) continue;
        this.contactInverse.getInverse(button.owner.matrixWorld);
        this.contactPoint.copy(this.contactProbe).applyMatrix4(this.contactInverse);
        const inverse = this.contactInverse.elements, point = this.contactPoint, bounds = button.bounds;
        const radius = !hand.armed || hand.contact ? .05 : .018;
        const rx = radius * Math.hypot(inverse[0], inverse[4], inverse[8]), ry = radius * Math.hypot(inverse[1], inverse[5], inverse[9]), rz = radius * Math.hypot(inverse[2], inverse[6], inverse[10]);
        if (point.z < bounds.max.z - rz || point.z > bounds.max.z + rz || point.x < bounds.min.x - rx || point.x > bounds.max.x + rx || point.y < bounds.min.y - ry || point.y > bounds.max.y + ry) continue;
        this.contactOrigin.setFromMatrixPosition(controller.matrixWorld).applyMatrix4(this.contactInverse);
        if (this.contactOrigin.z <= bounds.max.z) continue;
        if (button.round && Math.pow((point.x - button.center.x) / ((bounds.max.x - bounds.min.x) / 2 + rx), 2) + Math.pow((point.y - button.center.y) / ((bounds.max.y - bounds.min.y) / 2 + ry), 2) > 1) continue;
        const surface = new THREE.Vector3(Math.max(bounds.min.x, Math.min(bounds.max.x, point.x)), Math.max(bounds.min.y, Math.min(bounds.max.y, point.y)), bounds.max.z).applyMatrix4(button.owner.matrixWorld);
        const hit = {object: button.cap, point: surface, distance: controller.getWorldPosition(this.contactCenter).distanceTo(surface)};
        if (simulation.validInteraction && !simulation.validInteraction(button.owner, hit, hand.token, true)) continue;
        const distance = this.contactProbe.distanceToSquared(surface);
        if (!near || hand.contact && hand.contact.button === button || distance < near.distance) near = {button, state, hit, distance};
        if (hand.contact && hand.contact.button === button) break;
      }
      if (hand.contact) {
        if (!near || near.button !== hand.contact.button || near.state !== hand.contact.state) this.releaseContact(hand);
        return;
      }
      // Re-entry after session/menu changes or reconnect must first see the
      // hand outside a cap. A hand left resting on a button cannot actuate it.
      if (!near) { hand.armed = true; return; }
      if (!hand.armed || data.active && !(data.selectionCapture || []).some(entry => entry.state === near.state)) return;
      hand.armed = false; hand.contact = near;
      if (near.state.onHover) near.state.onHover(near.hit, false, hand.token);
      const before = simulation.getControlFeedback && simulation.getControlFeedback(near.button.owner.userData.editorId).sequence;
      if (near.state.onSelectStart) near.state.onSelectStart(near.hit, hand.token);
      const after = simulation.getControlFeedback && simulation.getControlFeedback(near.button.owner.userData.editorId).sequence;
      if (after !== before && simulation.pulse) simulation.pulse(controller, .2, 30);
    });
    this.contactHands.forEach((hand, controller) => { if (!connected.has(controller)) { this.releaseContact(hand, true); this.contactHands.delete(controller); } });
  }

  restoreRoller(entry) {
    if (entry.object.material === entry.installed) entry.object.material = entry.original;
  }

  dispose() {
    this.rollerBatches.dispose();
    this.resetContactHands();
    if (this.contactInput && this.contactInput.removeEventListener) {
      this.contactInput.removeEventListener('controllerDisconnected', this.contactCancelled);
      this.contactInput.removeEventListener('controllerInputCancelled', this.contactCancelled);
    }
    this.contactInput = null; this.contactButtons = [];
    this.displays.forEach(entry => this.restoreDisplay(entry));
    this.colors.forEach(entry => this.restoreColor(entry));
    this.buttons.forEach(entry => this.restoreButton(entry));
    this.rollers.forEach(entry => this.restoreRoller(entry));
    this.belts.forEach(entry => this.restoreRoller(entry));
    this.processorHeads.forEach(entry => entry.object.position.copy(entry.rest));
    this.mechanisms.forEach(entry => this.restoreMechanism(entry));
    this.steerBanks.forEach(entry => this.restoreSteerBank(entry));
    this.rollerTextures.forEach(surface => surface.texture.dispose());
    this.rollerMaterials.forEach(entry => entry.material.dispose());
    this.displays.clear(); this.colors.clear(); this.buttons.clear(); this.rollers.clear(); this.belts.clear(); this.processorHeads.clear(); this.mechanisms.clear(); this.steerBanks.clear(); this.rollerTextures.clear(); this.rollerMaterials.clear(); this.records.clear(); this.byId.clear();
    this.sensors = []; this.bindings = []; this.snapshot = null;
    this.panelSnapshots.clear(); this.previewScopes.clear();
    this.root = null; this.roomId = null; this.objectCount = -1; this.dirty = true;
  }
}
