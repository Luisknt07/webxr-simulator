import * as THREE from 'three';
import behaviorSchema from '../../../modules/logistica-industrial/contracts/behaviors.js';
import {createIndustrialPrefab} from '../../../modules/logistica-industrial/functions/presentacion/runtime/IndustrialPrefabs.js';

const {normalizeBehaviors} = behaviorSchema;

const FORMAT = 'hello-webxr-editor';
const VERSION = 1;
const MAX_OBJECTS = 10000;
const MAX_VALUE = 1000000;
const TRANSFORM_FIELDS = ['position', 'quaternion', 'scale'];
const STATE_FIELDS = TRANSFORM_FIELDS.concat(['visible', 'color', 'behaviors']);
const PRIMITIVES = ['box', 'sphere', 'plane', 'cylinder'];
const PREFABS = ['conveyor', 'sensor', 'plc', 'control', 'product', 'source', 'processor', 'palletQueue', 'robot', 'vehicle'];

function preparationBudget(options = {}) {
  const now = options.now || (() => typeof performance === 'undefined' ? Date.now() : performance.now());
  const milliseconds = Math.max(1, Math.min(12, Number(options.budgetMs) || 8));
  let slice = now();
  return async isCurrent => {
    if (options.signal && options.signal.aborted) throw Object.assign(new Error('Carga de escenario cancelada.'), {name: 'AbortError', code: 'load_aborted'});
    if (!isCurrent()) return false;
    if (options.yieldControl && now() - slice >= milliseconds) {
      await options.yieldControl(); slice = now();
      if (options.signal && options.signal.aborted) throw Object.assign(new Error('Carga de escenario cancelada.'), {name: 'AbortError', code: 'load_aborted'});
    }
    return isCurrent();
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cloneMaterial(material) {
  const copy = material.clone();
  const prepareTexture = (value, original) => {
    if (value && value.isTexture) {
      // ShaderMaterial.clone creates texture copies with version 0 in Three r112.
      // WebGL only uploads them after needsUpdate, otherwise samplers stay black.
      if (value === original) value = value.clone();
      value.needsUpdate = true;
    } else if (Array.isArray(value)) {
      value = value.map((item, index) => prepareTexture(item, original && original[index]));
    }
    return value;
  };
  Object.keys(copy.uniforms || {}).forEach(key => {
    copy.uniforms[key].value = prepareTexture(copy.uniforms[key].value, material.uniforms[key].value);
  });
  return copy;
}

function remapBehaviorReferences(behaviors, references, clearExternal = false) {
  return clone(behaviors).map(behavior => {
    ['sourceId', 'targetId', 'outputId', 'branchId'].forEach(key => {
      if (references.has(behavior[key])) behavior[key] = references.get(behavior[key]);
      else if (clearExternal && behavior[key]) behavior[key] = '';
    });
    if (behavior.type === 'robot' && behavior.destinationRulesJson) {
      const rules = JSON.parse(behavior.destinationRulesJson).filter(rule => !clearExternal || references.has(rule.outputId));
      rules.forEach(rule => { if (references.has(rule.outputId)) rule.outputId = references.get(rule.outputId); });
      behavior.destinationRulesJson = JSON.stringify(rules);
    }
    if (behavior.type === 'vehicle' && behavior.trainingTasksJson) {
      const tasks = JSON.parse(behavior.trainingTasksJson).filter(task => !clearExternal || ['productId','sourceId','destinationId'].every(key => references.has(task[key])));
      tasks.forEach(task => ['productId','sourceId','destinationId'].forEach(key => { if (references.has(task[key])) task[key] = references.get(task[key]); }));
      behavior.trainingTasksJson = JSON.stringify(tasks);
    }
    if (behavior.type === 'automation') {
      // A copied machine retains its own controls. Rules involving a machine
      // outside the copied subtree need a new local binding in another level.
      const rules = JSON.parse(behavior.rules).filter(rule => !clearExternal || references.has(rule.sourceId) && references.has(rule.targetId));
      rules.forEach(rule => ['sourceId', 'targetId'].forEach(key => {
        if (references.has(rule[key])) rule[key] = references.get(rule[key]);
      }));
      behavior.rules = JSON.stringify(rules);
    }
    return behavior;
  });
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  Object.keys(value).sort().forEach(key => { result[key] = ordered(value[key]); });
  return result;
}

function sameImports(a, b) {
  if (a.length !== b.length) return false;
  return a.every((record, index) => {
    const keys = Object.keys(record);
    const other = b[index];
    return keys.length === Object.keys(other).length && keys.every(key => record[key] === other[key]);
  });
}

function isPlain(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function vector(value, length, label, positive) {
  if (!Array.isArray(value) || value.length !== length || value.some(n =>
    typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > MAX_VALUE || (positive && n <= 0))) {
    throw new Error('Valor inválido en ' + label + '.');
  }
  return value.slice();
}

function colorValue(value) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error('El color debe tener formato #RRGGBB.');
  }
  return value.toLowerCase();
}

function nameValue(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 160) {
    throw new Error('Escribe un nombre de entre 1 y 160 caracteres.');
  }
  return value.trim();
}

function interactionValue(value) {
  if (value == null) return {type: 'none'};
  if (!isPlain(value) || !['none', 'room', 'toggle', 'sound', 'message', 'teleport'].includes(value.type)) {
    throw new Error('Tipo de interacción no compatible.');
  }
  const result = {type: value.type};
  if (value.type === 'room') {
    if (!Number.isInteger(value.room) || value.room < 0 || value.room > 9) throw new Error('Sala inválida.');
    result.room = value.room;
  } else if (value.type === 'toggle') {
    if (typeof value.targetId !== 'string' || value.targetId.length > 400) throw new Error('Objeto de destino inválido.');
    result.targetId = value.targetId;
  } else if (value.type === 'sound') {
    if (typeof value.asset !== 'string' || value.asset.length > 1000) throw new Error('Archivo de sonido inválido.');
    result.asset = value.asset;
  } else if (value.type === 'message') {
    if (typeof value.text !== 'string' || value.text.length > 650) throw new Error('El mensaje debe tener hasta 650 caracteres.');
    result.text = value.text;
  }
  return result;
}

function descriptorValue(value) {
  if (!isPlain(value)) throw new Error('Descripción de recurso inválida.');
  if (value.type === 'cad') return require('../../tools/cad/schema/cad').normalizeDescriptor(value);
  if (value.prefab !== undefined) {
    if (!PREFABS.includes(value.prefab)) throw new Error('Plantilla industrial no compatible.');
    const descriptor = {prefab: value.prefab};
    if (value.variant !== undefined) {
const variants = value.prefab === 'vehicle' ? behaviorSchema.vehicles.variants : value.prefab === 'product' ? behaviorSchema.productEquipment.variants : value.prefab === 'robot' ? behaviorSchema.robots.variants : value.prefab === 'conveyor' ? behaviorSchema.conveyorLayout.presetVariants : value.prefab === 'palletQueue' ? behaviorSchema.warehouseRacks.SYSTEMS.map(system => system.id) : value.prefab === 'source' ? ['queue'] : value.prefab === 'processor' ? ['combiner', 'separator'] : value.prefab === 'control' ? ['start', 'stop', 'emergency', 'pause', 'powerOn', 'powerOff', 'speedUp', 'speedDown', 'insertBox', 'resetEmergency', 'generate', 'dispatch', 'clearQueue', 'operator'] : [];
      if (!variants.includes(value.variant)) throw new Error('Variante de equipo no compatible.');
      descriptor.variant = value.variant;
    }
    return descriptor;
  }
  if (typeof value.nativeId === 'string' && /^native:[a-zA-Z0-9_-]+:root(?:\.\d+)*$/.test(value.nativeId) && value.nativeId.length <= 400) return {nativeId: value.nativeId};
  if (value.type === 'decal' || value.type === 'audioZone') return {type: value.type};
  if (value.type === 'industrialFloor') return behaviorSchema.industrialFloor.normalize(value);
  if (PRIMITIVES.includes(value.type)) {
    return {type: value.type, color: colorValue(value.color || '#60a5fa')};
  }
  const result = {};
  if (typeof value.importId === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/.test(value.importId)) result.importId = value.importId;
  else if (typeof value.path === 'string' && value.path.length <= 1000 && value.path &&
    !/^[a-z]+:/i.test(value.path) && !value.path.startsWith('/') && !value.path.startsWith('\\') &&
    !value.path.split(/[\\/]/).includes('..')) result.path = value.path;
  else throw new Error('Referencia de recurso inválida.');
  return result;
}

function validateState(value, partial) {
  if (!isPlain(value)) throw new Error('Transformación inválida.');
  const result = {};
  TRANSFORM_FIELDS.forEach(field => {
    if (value[field] !== undefined) result[field] = vector(value[field], field === 'quaternion' ? 4 : 3, field, field === 'scale');
    else if (!partial) throw new Error('Falta la transformación ' + field + '.');
  });
  if (result.quaternion) {
    const length = Math.hypot(...result.quaternion);
    if (length < 0.000001 || Math.abs(length - 1) > 0.01) throw new Error('Rotación inválida.');
    // Preserve the exact saved pose when it is already unit length to floating
    // point precision; otherwise load/save cycles drift untouched rotations.
    if (Math.abs(length - 1) > 16 * Number.EPSILON) result.quaternion = result.quaternion.map(n => n / length);
  }
  if (value.visible !== undefined) {
    if (typeof value.visible !== 'boolean') throw new Error('Visibilidad inválida.');
    result.visible = value.visible;
  } else if (!partial) result.visible = true;
  if (value.color !== undefined) result.color = value.color === null ? null : colorValue(value.color);
  if (value.behaviors !== undefined) result.behaviors = normalizeBehaviors(value.behaviors);
  if (value.visual !== undefined) result.visual = value.visual === null ? null : descriptorValue(value.visual);
  return result;
}

function migratePanelControls(record) {
  const prefab = record.descriptor.prefab, nodes = record.nodes;
  if (!nodes || !['conveyor', 'plc', 'source', 'processor', 'palletQueue'].includes(prefab)) return;
  // Old projects save complete local poses for every control actor. Rebuilding
  // the cabinet alone cannot raise those buttons: their saved poses win over
  // the factory. Recognize a previous automatic layout as a group, then only
  // replace untouched local poses. User placement, rotation, scale, behaviors,
  // visual replacements and material/wear descriptions stay intact.
  const prefix = prefab === 'conveyor' ? '6.' : prefab === 'plc' ? '' : prefab === 'palletQueue' ? '1.' : '2.';
  const rows = prefab === 'source' ? [
    [[-0.23, 0, 0.23], 0.06, 0.44], [[-0.23, 0, 0.23], -0.12, 0.27]
  ] : prefab === 'palletQueue' ? [
    [[-0.15, 0.15], 0.055, 0.33], [[-0.15, 0.15], -0.11, 0.16]
  ] : prefab === 'processor' ? [
    [[-0.29, 0, 0.29], -0.08, 0.44], [[-0.29, 0, 0.29], -0.30, 0.27], [[-0.29, 0, 0.29], -0.52, 0.10]
  ] : [
    [[-0.24, 0, 0.24], -0.17, 0.21], [[-0.30, 0, 0.30], -0.39, 0.04], [[0.30, -0.30, 0], -0.61, -0.13]
  ];
  const scale = prefab === 'source' || prefab === 'palletQueue' ? 0.82 : 1;
  const z = prefab === 'source' || prefab === 'palletQueue' ? 0.08 : prefab === 'processor' ? 0.15 : 0.17;
  const close = (value, expected) => value && expected.every((n, i) => Math.abs(value[i] - n) < 0.000001);
  const changes = [];
  let index = 2;
  rows.forEach(([xs, oldY, newY]) => xs.forEach(x => {
    const state = nodes[prefix + index++];
    if (!state || !close(state.position, [x, oldY, z]) || !close(state.scale, [scale, scale, scale]) ||
        !(close(state.quaternion, [0, 0, 0, 1]) || close(state.quaternion, [0, 0, 0, -1]))) return;
    changes.push({state, position: [prefab === 'conveyor' || prefab === 'plc' ? Math.sign(x) * 0.29 : x, newY, z]});
  }));
  // A single intentionally moved button in a current project is insufficient
  // evidence for migration. Normal saved panels contain all their controls.
  if (changes.length < 2) return;
  changes.forEach(({state, position}) => { state.position = position; });
}

/** A reversible overlay over native objects. Native graph identities and names stay intact. */
export default class SceneDocument {
  constructor(ctx, options = {}) {
    this.ctx = ctx;
    this.assetLibrary = options.assetLibrary;
    this.onChange = options.onChange || (() => {});
    this.rooms = new Map();
    this.objects = new Map();
    this.native = new Map();
    this.additions = new Map();
    this.overrides = new Map();
    this.undoStack = [];
    this.redoStack = [];
    this.transaction = null;
    this.nextId = 1;
    this.loading = false;
    this.visuals = new Map();
    this.visualMasks = new Map();
    // Inactive rooms retain their complete authoring records, without fetching
    // and parsing their external models. Native scene identities stay intact.
    this.pendingRooms = new Map();
    this.roomActivations = new Map();
    this.loadGeneration = 0;
    this.studio = null;
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  setStudio(patch) {
    const value = behaviorSchema.studio.normalize(Object.assign({version: 1}, this.studio || {}, patch));
    return this._action(() => { this.studio = value; });
  }

  registerRoom(roomId, root) {
    roomId = String(roomId);
    if (!root || !root.isObject3D) throw new Error('La sala necesita un objeto Three.js.');
    if (this.rooms.has(roomId)) {
      if (this.rooms.get(roomId).root !== root) throw new Error('Esta sala ya está registrada.');
      return root;
    }
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(roomId) || ['__proto__', 'constructor', 'prototype'].includes(roomId)) throw new Error('Identificador de sala inválido.');
    const room = {root, nativeIds: []};
    this.rooms.set(roomId, room);
    const visit = (object, path) => {
      if (object.userData.editorHelper || object.userData.editorRuntimeHelper) return;
      const id = 'native:' + roomId + ':' + path;
      object.userData.editorId = id;
      object.userData.editorNative = true;
      object.userData.editorRoom = roomId;
      this.objects.set(id, object);
      this.native.set(id, {
        object, roomId, name: object.name, state: this._state(object),
        material: object.material, children: object.children.slice(),
        behaviors: normalizeBehaviors(object.userData.editorDefaultBehaviors || [])
      });
      room.nativeIds.push(id);
      object.children.forEach((child, i) => visit(child, path + '.' + i));
    };
    visit(root, 'root');
    return root;
  }

  getRoot(roomId) {
    const room = this.rooms.get(String(roomId));
    return room && room.root;
  }

  getObjects(roomId) {
    const room = this.rooms.get(String(roomId));
    if (!room) return [];
    return room.nativeIds.map(id => this.objects.get(id)).filter(object => object !== room.root && object.name !== 'textMesh')
      .concat(Array.from(this.additions.values()).filter(entry => entry.roomId === String(roomId)).reduce((objects, entry) => objects.concat(entry.object, Array.from((entry.nodes || new Map()).values())), []));
  }

  getObject(id) { return this.objects.get(id) || null; }

  getEditableObject(object) {
    while (object) {
      if (object.userData && object.userData.editorVisualOwnerId) return this.objects.get(object.userData.editorVisualOwnerId) || null;
      // SDF text is generated by its owner's component. Keep its native ID for
      // existing projects, but select/copy the logical panel rather than glyphs.
      if (object.name !== 'textMesh' && object.userData && this.objects.get(object.userData.editorId) === object) return object;
      object = object.parent;
    }
    return null;
  }

  getRoomForObject(object) {
    const editable = this.getEditableObject(object);
    return editable ? editable.userData.editorRoom : null;
  }

  isNative(object) {
    return !!(object && this.native.has(object.userData.editorId));
  }

  getBehaviors(object) {
    return normalizeBehaviors(object && (object.userData.editorBehaviors || object.userData.editorDefaultBehaviors) || []);
  }

  setBehaviors(object, value) {
    this._requireObject(object);
    const oldRack=this.getBehaviors(object).find(config=>config.type==='palletQueue'&&behaviorSchema.warehouseRacks.isRack(config));
    const behaviors = this._withRackAddress(normalizeBehaviors(value), object.userData.editorRoom, object.userData.editorId, !oldRack);
    return this._action(() => { object.userData.editorBehaviors = behaviors; this._syncConveyor(object); });
  }

  _withRackAddress(behaviors, roomId, excludeId, allocate = false) {
    const schema=behaviorSchema.warehouseRacks, config=behaviors.find(value=>value.type==='palletQueue'&&schema.isRack(value));
    if(!config)return behaviors;
    const others=Array.from(this.additions.values()).filter(entry=>entry.id!==excludeId&&entry.roomId===String(roomId)).map(entry=>this.getBehaviors(entry.object).find(value=>value.type==='palletQueue'&&schema.isRack(value))).filter(Boolean);
    const used=new Set(others.map(value=>schema.addressPrefix(value))), next=Object.assign({},config);
    if(allocate&&used.has(schema.addressPrefix(next))){let index=1;do{next.rackRowCode='R'+String(index++).padStart(2,'0');}while(used.has(schema.addressPrefix(next))&&index<10001);}
    if(used.has(schema.addressPrefix(next)))throw Error('El pasillo y la fila ya existen. Asigna otro código de fila para evitar ubicaciones duplicadas.');
    const assigned=new Set(others.flatMap(value=>schema.assignments(value).map(row=>row.palletId)));
    if(schema.assignments(next).some(row=>assigned.has(row.palletId)))throw Error('Ese pallet ya tiene una ubicación reservada en otra estantería. Libera la reserva anterior.');
    return behaviors.map(value=>value===config?schema.normalize(next):value);
  }

  _syncConveyor(object) {
    if (!['conveyor', 'source', 'processor', 'palletQueue', 'robot', 'vehicle', 'product'].includes(object.userData.editorPrefabKey) || !createIndustrialPrefab.refresh) return;
    const content = object.children[0];
    if (!content || content.userData.editorPrefabKey !== object.userData.editorPrefabKey) return;
    const config = this.getBehaviors(object).find(component => component.type === object.userData.editorPrefabKey);
    if (!config || config.type === 'product' && !config.variant) return;
    const entry = this.additions.get(object.userData.editorId);
    if (entry && config.type === 'palletQueue') {
      if (behaviorSchema.warehouseRacks.isRack(config)) {entry.descriptor.variant = config.rackSystem; object.userData.editorPrefabVariant = content.userData.editorPrefabVariant = config.rackSystem;}
      else {delete entry.descriptor.variant; delete object.userData.editorPrefabVariant; delete content.userData.editorPrefabVariant;}
      object.userData.editorDescriptor = clone(entry.descriptor);
    }
    if (entry && ['robot', 'vehicle', 'product'].includes(config.type)) {
      entry.descriptor.variant = config.variant;
      object.userData.editorDescriptor = clone(entry.descriptor);
      object.userData.editorPrefabVariant = content.userData.editorPrefabVariant = config.variant;
    }
    if (entry && config.type === 'conveyor' && config.equipmentId) {
      const definition = behaviorSchema.conveyorLayout.equipment.getDefinition(config.equipmentId);
      if (definition && definition.id === config.equipmentId) {
        // Explicitly adopting a catalogue variant changes the persisted factory
        // recipe as well as its configuration. Otherwise re-opening a legacy
        // descriptor would discard the newly authored lateral sensor at 10.
        entry.descriptor.variant = definition.variant;
        object.userData.editorDescriptor = clone(entry.descriptor);
        object.userData.editorPrefabVariant = content.userData.editorPrefabVariant = definition.variant;
      }
    }
    if (!this.conveyorSignatures) this.conveyorSignatures = new WeakMap();
    const keys = ['robot', 'vehicle', 'product'].includes(config.type) ? behaviorSchema.definitionFor(config.type).fields.map(field => field.key) : config.type === 'palletQueue' ? ['width', 'depth', 'columns', 'rows', 'layers', 'capacity', 'palletCapacity', 'acceptsPallets', 'palletType', 'palletMaterial', 'layoutMode', 'withPanel'] :
      config.type === 'processor' ? ['mode', 'length', 'width', 'withPanel'] :
      config.type === 'source' ? ['generationMode', 'productType', 'width', 'height', 'depth', 'color', 'catalog', 'loadMode', 'palletColumns', 'palletRows', 'palletLayers', 'palletType', 'palletMaterial', 'palletPacking', 'palletWidth', 'palletDepth', 'withPanel'] :
      ['layout', 'surface', 'length', 'width', 'radius', 'curveAngle', 'axis', 'junctionMode', 'branchSide', 'role', 'withSensors', 'withPanel', 'withPallet', 'outputId', 'branchId', 'equipmentId', 'equipmentVersion', 'drive', 'mechanism', 'rise', 'rollerPitch', 'zoneLength', 'cleats', 'mergeAngle'];
    if (config.type === 'conveyor') keys.push('supportHeight');
    if (config.type === 'palletQueue') keys.push(...behaviorSchema.warehouseRacks.FIELDS.map(field => field.key));
    const signature = JSON.stringify(keys.map(key => config[key]));
    if (this.conveyorSignatures.get(content) === signature) { if (entry) {this._syncConveyorActors(entry, config); this._syncStorageActors(entry,config);} return; }
    const replacement = this.visuals.get(object.userData.editorId);
    if (replacement) this._setVisual(object, null);
    createIndustrialPrefab.refresh(content, config);
    if (entry) this._syncConveyorActors(entry, config);
    if (entry) this._syncStorageActors(entry, config);
    this.conveyorSignatures.set(content, signature);
    if (object.userData.editorColor) this._applyColor(object, object.userData.editorColor);
    if (replacement) this._setVisual(object, replacement);
  }

  _syncConveyorActors(entry, config) {
    if (!entry || entry.descriptor.prefab !== 'conveyor') return;
    config = config || this.getBehaviors(entry.object).find(behavior => behavior.type === 'conveyor');
    const content = entry.object.children[0], sensor = content && content.children.find(node => node.userData.industrialBranchSensor);
    if (!sensor) return;
    const path = String(content.children.indexOf(sensor));
    if (!config || !config.equipmentId) {
      if (entry.nodes.get(path) === sensor) { entry.nodes.delete(path); this.objects.delete(sensor.userData.editorId); }
      sensor.visible = false;
      return;
    }
    sensor.userData.editorId = entry.id + '/' + path;
    sensor.userData.editorRoom = entry.roomId; sensor.userData.editorNative = false;
    sensor.userData.editorDefaultBehaviors = normalizeBehaviors(remapBehaviorReferences(sensor.userData.editorDefaultBehaviors || [], new Map([['@root', entry.id]])));
    entry.nodes.set(path, sensor); this.objects.set(sensor.userData.editorId, sensor);
  }

  _syncStorageActors(entry, config) {
    if(!entry||entry.descriptor.prefab!=='palletQueue')return;
    const content=entry.object.children[0], panel=content&&content.children[1];
    const current=new Map();
    if(panel&&!behaviorSchema.warehouseRacks.isRack(config)){
      const visit=(node,path)=>{if(node.userData.editorPrefabNode){node.userData.editorId=entry.id+'/'+path;node.userData.editorRoom=entry.roomId;node.userData.editorNative=false;node.userData.editorDefaultBehaviors=normalizeBehaviors(remapBehaviorReferences(node.userData.editorDefaultBehaviors||[],new Map([['@root',entry.id]])));current.set(path,node);}node.children.forEach((child,index)=>visit(child,path+'.'+index));};
      visit(panel,'1');
    }
    for(const [path,node]of entry.nodes)if(/^1(?:\.|$)/.test(path)&&current.get(path)!==node){entry.nodes.delete(path);this.objects.delete(node.userData.editorId);}
    current.forEach((node,path)=>{entry.nodes.set(path,node);this.objects.set(node.userData.editorId,node);});
  }

  _enforceConveyorOptions(object) {
    if (object.userData.editorPrefabKey !== 'conveyor' || !createIndustrialPrefab.enforceOptions) return;
    const config = this.getBehaviors(object).find(component => component.type === 'conveyor');
    if (config && object.children[0]) createIndustrialPrefab.enforceOptions(object.children[0], config);
  }

  copyBehaviors(object) { this._requireObject(object); return clone(this.getBehaviors(object)); }
  pasteBehaviors(object, behaviors) { return this.setBehaviors(object, behaviors); }

  getVisualDescriptor(object) {
    const visual = this.visuals.get(object.userData.editorId);
    if (visual) return clone(visual.descriptor);
    const override = this.overrides.get(object.userData.editorId);
    if (override && override.visual) return clone(override.visual);
    const entry = this.additions.get(object.userData.editorId);
    if (entry) return clone(entry.descriptor);
    if (object.userData.editorPrefabKey) return Object.assign({prefab: object.userData.editorPrefabKey}, object.userData.editorPrefabVariant ? {variant: object.userData.editorPrefabVariant} : {});
    return {nativeId: object.userData.editorCloneSourceId || object.userData.editorId};
  }

  _cloneNative(id, current = false, instance) {
    const entry = this.native.get(id);
    if (!entry) throw new Error('No se encontró la plantilla nativa del objeto.');
    const instances = new Map();
    if (instance) instance.traverse(node => {
      const sourceId = node.userData.editorCloneSourceId || (this.isNative(node) && node.userData.editorId);
      if (sourceId) instances.set(sourceId, node);
    });
    const copyNode = source => {
      if (source.isAudio || source.name === 'textMesh' || source.userData.editorHelper || source.userData.editorRuntimeHelper || source.userData.editorVisualOwnerId) return null;
      const original = this.native.get(source.userData.editorId);
      const actual = current && instances.get(source.userData.editorId) || source;
      // Object3D.copy stringifies userData. A facade excludes controllers, audio,
      // ECS entities and circular runtime references without mutating the source.
      const facade = Object.create(actual);
      facade.userData = {};
      // Three r112 Mesh.clone/copy ignore the recursive argument. Hide children
      // on the facade as well, then rebuild only the logical template graph.
      facade.children = [];
      const copy = actual.clone.call(facade, false);
      copy.userData.editorCloneSourceId = source.userData.editorId;
      copy.userData.editorCloneInstanceId = actual.userData.editorId;
      copy.userData.editorDefaultBehaviors = clone(current ? this.getBehaviors(actual) : original ? original.behaviors : []);
      if (original && !current) this._applyState(copy, original.state);
      delete copy.userData.editorBehaviors;
      let materials = original && !current ? original.material : actual.material;
      if (current && this.visualMasks.has(actual)) materials = this.visualMasks.get(actual).material;
      if (materials) copy.material = Array.isArray(materials) ? materials.map(cloneMaterial) : cloneMaterial(materials);
      const children = original ? original.children : source.children;
      children.forEach(child => { const cloned = copyNode(child); if (cloned) copy.add(cloned); });
      return copy;
    };
    const content = copyNode(entry.object);
    if (!content) throw new Error('Selecciona el objeto que contiene este elemento para copiarlo.');
    content.position.set(0, 0, 0); content.quaternion.set(0, 0, 0, 1); content.scale.set(1, 1, 1);
    return content;
  }

  async _instantiate(descriptor) {
    if (descriptor.type === 'cad') return this._cadVisual(descriptor);
    if (descriptor.prefab) return createIndustrialPrefab(descriptor.prefab, descriptor.variant);
    if (descriptor.nativeId) return this._cloneNative(descriptor.nativeId);
    if (descriptor.type === 'decal' || descriptor.type === 'audioZone') return new THREE.Group();
    if (descriptor.type === 'industrialFloor') return behaviorSchema.industrialFloor.createVisual(THREE, descriptor);
    if (PRIMITIVES.includes(descriptor.type)) return this._primitive(descriptor);
    if (!this.assetLibrary) throw new Error('La biblioteca de recursos no está disponible.');
    const content = await this.assetLibrary.instantiate(descriptor);
    if (!content || !content.isObject3D) throw new Error('El recurso no contiene un modelo 3D.');
    return content;
  }

  _fitVisual(object, content) {
    object.updateWorldMatrix(true, true);
    const target = new THREE.Box3().setFromObject(object);
    target.applyMatrix4(new THREE.Matrix4().getInverse(object.matrixWorld));
    content.updateMatrixWorld(true);
    const source = new THREE.Box3().setFromObject(content);
    if (target.isEmpty() || source.isEmpty()) return content;
    const targetSize = target.getSize(new THREE.Vector3()), sourceSize = source.getSize(new THREE.Vector3());
    const factors = ['x', 'y', 'z'].filter(axis => targetSize[axis] > 0.000001 && sourceSize[axis] > 0.000001).map(axis => targetSize[axis] / sourceSize[axis]);
    const scale = factors.length ? Math.min(...factors) : 1;
    const wrapper = new THREE.Group();
    content.position.sub(source.getCenter(new THREE.Vector3()));
    wrapper.add(content); wrapper.scale.setScalar(scale); wrapper.position.copy(target.getCenter(new THREE.Vector3()));
    return wrapper;
  }

  _setVisual(object, visual) {
    const id = object.userData.editorId, previous = this.visuals.get(id);
    if (previous) {
      if (previous.content.parent) previous.content.parent.remove(previous.content);
      previous.hidden.forEach((material, mesh) => {
        const mask = this.visualMasks.get(mesh);
        if (!mask) return;
        mask.owners.delete(id);
        if (!mask.owners.size) {
          mesh.material = mask.material;
          delete mesh.userData.editorGeometryReplaced;
          this.visualMasks.delete(mesh);
        }
      });
      this.visuals.delete(id);
    }
    if (!visual) return;
    visual.hidden = new Map();
    object.traverse(child => {
      if (!child.material || child.name === 'textMesh' || child.userData.editorVisualOwnerId || child.userData.editorRuntimeHelper || child.userData.editorHelper) return;
      // A prefab's sensors and physical controls are independent components.
      // Replacing its mechanical model must leave their visible handles usable.
      if (object.userData.editorPrefabKey) {
        for (let node = child; node && node !== object; node = node.parent) {
          if (node.userData.editorPrefabNode && this.objects.get(node.userData.editorId) === node) return;
        }
      }
      // Do not hide descendants of another replacement visual.
      for (let parent = child.parent; parent && parent !== object; parent = parent.parent) if (parent.name === 'textMesh' || parent.userData.editorVisualOwnerId || parent.userData.editorRuntimeHelper || parent.userData.editorHelper) return;
      let mask = this.visualMasks.get(child);
      if (!mask) {
        mask = {material: child.material, hidden: this._hiddenMaterials(child.material), owners: new Set()};
        this.visualMasks.set(child, mask);
      }
      mask.owners.add(id);
      visual.hidden.set(child, mask.material);
      child.userData.editorGeometryReplaced = true;
      child.material = mask.hidden;
    });
    visual.content.userData.editorVisualOwnerId = id;
    object.add(visual.content); this.visuals.set(id, visual);
    if (object.userData.editorColor) this._applyColor(visual.content, object.userData.editorColor);
  }

  _hiddenMaterials(material) {
    const materials = Array.isArray(material) ? material : [material];
    const hidden = materials.map(item => { const copy = cloneMaterial(item); copy.visible = false; return copy; });
    return Array.isArray(material) ? hidden : hidden[0];
  }

  _refreshMasks(masks) {
    masks.forEach(([object, mask]) => {
      mask.material = object.material;
      mask.hidden = this._hiddenMaterials(mask.material);
      object.material = mask.hidden;
    });
  }

  async replaceAsset(object, descriptor) {
    this._requireObject(object);
    descriptor = descriptorValue(descriptor);
    const content = this._fitVisual(object, await this._instantiate(descriptor));
    this._requireObject(object);
    return this._action(() => {
      this._forgetPendingVisual(object.userData.editorId);
      this._setVisual(object, {descriptor, content, hidden: new Map()});
      if (this.isNative(object)) {
        const override = clone(this.overrides.get(object.userData.editorId) || {});
        override.visual = descriptor; this.overrides.set(object.userData.editorId, override);
      }
      return object;
    });
  }

  async _prepareVisuals(record) {
    const prepared = new Map();
    if (record.visual) prepared.set('', {descriptor: record.visual, content: await this._instantiate(record.visual)});
    for (const path of Object.keys(record.nodes || {})) {
      if (record.nodes[path].visual) prepared.set(path, {descriptor: record.nodes[path].visual, content: await this._instantiate(record.nodes[path].visual)});
    }
    return prepared;
  }

  _checkNodes(content, record) {
    for (const path of Object.keys(record.nodes || {})) {
      let node = content;
      path.split('.').forEach(index => { node = node && node.children[Number(index)]; });
      if (!node || !(node.userData.editorCloneSourceId || node.userData.editorPrefabNode)) throw new Error('El escenario contiene un componente descendiente desconocido.');
    }
  }

  _installPreparedVisuals(entry, prepared) {
    prepared.forEach((visual, path) => {
      const object = path ? entry.nodes.get(path) : entry.object;
      if (!object) throw new Error('El recurso contiene una referencia de componente desconocida.');
      this._setVisual(object, {descriptor: clone(visual.descriptor), content: this._fitVisual(object, visual.content), hidden: new Map()});
    });
  }

  resetAsset(object) {
    this._requireObject(object);
    return this._action(() => {
      this._forgetPendingVisual(object.userData.editorId);
      this._setVisual(object, null);
      const override = this.overrides.get(object.userData.editorId);
      if (override) { delete override.visual; if (!Object.keys(override).length) this.overrides.delete(object.userData.editorId); }
    });
  }

  _requireObject(object) {
    if (!object || this.objects.get(object.userData.editorId) !== object) throw new Error('Objeto no editable.');
    return object;
  }

  _forgetPendingVisual(id) {
    const object = this.objects.get(id);
    const roomId = object && object.userData.editorRoom;
    const pending = this.pendingRooms.get(roomId);
    if (!pending || !pending.nativeVisuals.some(record => record.id === id)) return;
    const records = {additions: pending.additions, nativeVisuals: pending.nativeVisuals.filter(record => record.id !== id)};
    if (records.additions.length || records.nativeVisuals.length) this.pendingRooms.set(roomId, records);
    else this.pendingRooms.delete(roomId);
    this.roomActivations.delete(roomId);
  }

  _state(object) {
    return {
      position: object.position.toArray(), quaternion: object.quaternion.toArray(), scale: object.scale.toArray(),
      visible: object.visible, color: object.userData.editorColor || null,
      behaviors: this.getBehaviors(object)
    };
  }

  _nodeRecord(object) {
    const record = Object.assign({name: object.name}, this._state(object));
    if (object.userData.editorInteraction !== undefined) record.interaction = clone(object.userData.editorInteraction);
    return record;
  }

  _additionRecord(entry) {
    const record = Object.assign({id: entry.id, name: entry.object.name, descriptor: clone(entry.descriptor)}, this._state(entry.object), {
      interaction: clone(entry.object.userData.editorInteraction || {type: 'none'})
    });
    const visual = this.visuals.get(entry.id);
    if (visual) record.visual = clone(visual.descriptor);
    if (entry.nodes && entry.nodes.size) {
      record.nodes = {};
      entry.nodes.forEach((object, path) => {
        record.nodes[path] = this._nodeRecord(object);
        const nodeVisual = this.visuals.get(object.userData.editorId);
        if (nodeVisual) record.nodes[path].visual = clone(nodeVisual.descriptor);
      });
    }
    return record;
  }

  capture() {
    return {
      studio: clone(this.studio),
      native: Array.from(this.native.entries()).map(([id, entry]) => ({id, state: this._state(entry.object), visual: this.visuals.get(id)})),
      overrides: Array.from(this.overrides.entries()).map(([id, value]) => [id, clone(value)]),
      additions: Array.from(this.additions.values()).map(entry => ({entry, record: this._additionRecord(entry), visuals: new Map([entry.object].concat(Array.from((entry.nodes || new Map()).values())).map(object => [object.userData.editorId, this.visuals.get(object.userData.editorId)]))})),
      pendingRooms: Array.from(this.pendingRooms.entries()).map(([roomId, records]) => [roomId, clone(records)]),
      // Import records contain immutable data URL strings. Shallow copies retain
      // those strings without allocating another encoded model for every edit.
      imports: this.assetLibrary && this.assetLibrary.exportImports ?
        this.assetLibrary.exportImports().map(record => Object.assign({}, record)) : []
    };
  }

  _fingerprint(snapshot) {
    const additions = snapshot.additions.map(value => value.record);
    (snapshot.pendingRooms || []).forEach(([, records]) => additions.push(...records.additions));
    // Hydrating records changes their representation, never the project itself.
    return JSON.stringify(ordered({studio: snapshot.studio || null, overrides: snapshot.overrides, additions: additions.sort((a, b) => a.id.localeCompare(b.id))}));
  }

  begin() {
    if (this.loading) throw new Error('Espera a que termine de cargar el proyecto.');
    if (!this.transaction) this.transaction = this.capture();
    return this.transaction;
  }

  commit(before) {
    before = before || this.transaction;
    if (!before) return false;
    // TransformControls writes directly to Three.js objects. Validate those writes
    // too, so a mirrored/zero scale or non-finite drag cannot poison saved JSON.
    try {
      before.native.forEach(previous => {
        const entry = this.native.get(previous.id);
        if (!entry) return;
        const current = this._state(entry.object);
        const changed = {};
        STATE_FIELDS.forEach(field => {
          if (!same(current[field], previous.state[field])) changed[field] = current[field];
        });
        validateState(changed, true);
      });
      this.additions.forEach(entry => {
        validateState(this._state(entry.object), false);
        (entry.nodes || new Map()).forEach(object => validateState(this._state(object), false));
      });
    } catch (error) {
      this.transaction = null;
      this._restore(before);
      this._notify('cancel');
      throw error;
    }
    before.native.forEach(previous => {
      const entry = this.native.get(previous.id);
      if (!entry) return;
      const current = this._state(entry.object);
      const override = clone(this.overrides.get(previous.id) || {});
      STATE_FIELDS.forEach(field => {
        if (!same(current[field], previous.state[field])) {
          if (same(current[field], entry.state[field])) delete override[field];
          else override[field] = current[field];
        }
      });
      if (Object.keys(override).length) this.overrides.set(previous.id, override);
      else this.overrides.delete(previous.id);
    });
    this.transaction = null;
    const after = this.capture();
    const changed = this._fingerprint(before) !== this._fingerprint(after) || !sameImports(before.imports, after.imports);
    if (changed) {
      this.undoStack.push(before);
      if (this.undoStack.length > 60) this.undoStack.shift();
      this.redoStack.length = 0;
      this._notify('change');
    }
    return changed;
  }

  cancel() {
    if (!this.transaction) return;
    const snapshot = this.transaction;
    this.transaction = null;
    this._restore(snapshot);
    this._notify('cancel');
  }

  _action(callback) {
    const own = !this.transaction;
    if (own) this.begin();
    try {
      const result = callback();
      if (own) this.commit();
      return result;
    } catch (error) {
      if (own) this.cancel();
      throw error;
    }
  }

  _restore(snapshot) {
    this.studio = clone(snapshot.studio || null);
    this.loadGeneration++;
    this.roomActivations.clear();
    if (this.assetLibrary && this.assetLibrary.restoreImports) this.assetLibrary.restoreImports(snapshot.imports);
    Array.from(this.visuals.keys()).forEach(id => { const object = this.objects.get(id); if (object) this._setVisual(object, null); });
    snapshot.native.forEach(({id, state}) => {
      const entry = this.native.get(id);
      if (entry) this._applyState(entry.object, state);
    });
    this.additions.forEach(entry => { if (entry.object.parent) entry.object.parent.remove(entry.object); });
    this.additions.forEach(entry => this._unregisterAddition(entry));
    this.additions.clear();
    snapshot.additions.forEach(({entry, record}) => {
      if (record.descriptor.type === 'cad' && !same(entry.descriptor, record.descriptor)) {
        this._replaceCADVisual(entry.object, record.descriptor);
      }
      if (record.descriptor.type === 'industrialFloor' && !same(entry.descriptor, record.descriptor)) this._replaceIndustrialFloorVisual(entry.object, record.descriptor);
      entry.descriptor = clone(record.descriptor);
      entry.object.userData.editorDescriptor = clone(record.descriptor);
      if (record.descriptor.variant) entry.object.userData.editorPrefabVariant = record.descriptor.variant;
      else delete entry.object.userData.editorPrefabVariant;
      const content = entry.object.children[0];
      if (content && content.userData.editorPrefabKey === 'conveyor') {
        if (record.descriptor.variant) content.userData.editorPrefabVariant = record.descriptor.variant;
        else delete content.userData.editorPrefabVariant;
      }
      entry.object.name = record.name;
      entry.object.userData.editorInteraction = clone(record.interaction);
      this._applyState(entry.object, record);
      this.rooms.get(entry.roomId).root.add(entry.object);
      this.additions.set(entry.id, entry);
      this.objects.set(entry.id, entry.object);
      this._syncConveyorActors(entry);
      (entry.nodes || new Map()).forEach((object, path) => {
        const node = record.nodes && record.nodes[path];
        if (node) {
          object.name = node.name;
          if (node.interaction === undefined) delete object.userData.editorInteraction;
          this._applyState(object, node);
        }
        this.objects.set(object.userData.editorId, object);
      });
      this._enforceConveyorOptions(entry.object);
    });
    snapshot.native.forEach(({id, visual}) => { const object = this.objects.get(id); if (object && visual) this._setVisual(object, visual); });
    snapshot.additions.forEach(({visuals}) => { if (visuals) visuals.forEach((visual, id) => { if (visual && this.objects.has(id)) this._setVisual(this.objects.get(id), visual); }); });
    this.overrides = new Map(snapshot.overrides.map(([id, value]) => [id, clone(value)]));
    this.pendingRooms = new Map((snapshot.pendingRooms || []).map(([roomId, records]) => [roomId, clone(records)]));
    this.syncCADAttachments();
  }

  _unregisterAddition(entry) {
    this.objects.delete(entry.id);
    (entry.nodes || new Map()).forEach(object => this.objects.delete(object.userData.editorId));
  }

  undo() {
    if (this.transaction) this.commit();
    if (!this.canUndo) return false;
    this.redoStack.push(this.capture());
    this._restore(this.undoStack.pop());
    this._notify('undo');
    return true;
  }

  redo() {
    if (this.transaction) this.commit();
    if (!this.canRedo) return false;
    this.undoStack.push(this.capture());
    this._restore(this.redoStack.pop());
    this._notify('redo');
    return true;
  }

  _newId() {
    let id;
    const pendingIds = new Set();
    this.pendingRooms.forEach(records => records.additions.forEach(record => pendingIds.add(record.id)));
    do { id = 'custom-' + Date.now().toString(36) + '-' + this.nextId++; } while (this.objects.has(id) || pendingIds.has(id));
    return id;
  }

  _primitive(descriptor) {
    let geometry;
    if (descriptor.type === 'box') geometry = new THREE.BoxBufferGeometry(1, 1, 1);
    else if (descriptor.type === 'sphere') geometry = new THREE.SphereBufferGeometry(0.5, 24, 16);
    else if (descriptor.type === 'plane') geometry = new THREE.PlaneBufferGeometry(2, 2);
    else geometry = new THREE.CylinderBufferGeometry(0.5, 0.5, 1, 24);
    return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({color: descriptor.color, roughness: 0.75, side: THREE.DoubleSide}));
  }

  _attach(roomId, descriptor, content, record) {
    roomId = String(roomId);
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Sala desconocida.');
    const object = new THREE.Group();
    const id = record ? record.id : this._newId();
    object.name = record ? record.name : descriptor.prefab ? content.name : descriptor.type || descriptor.path || descriptor.importId;
    object.userData.editorId = id;
    object.userData.editorNative = false;
    object.userData.editorRoom = roomId;
    object.userData.editorDescriptor = clone(descriptor);
    object.userData.editorInteraction = record ? clone(record.interaction) : {type: 'none'};
    const defaults = normalizeBehaviors(remapBehaviorReferences(content.userData.editorDefaultBehaviors || [], new Map([['@root', id]])));
    object.userData.editorDefaultBehaviors = defaults;
    object.userData.editorBehaviors = record?normalizeBehaviors(record.behaviors||defaults):this._withRackAddress(defaults,roomId,id,true);
    if(!record)object.userData.editorDefaultBehaviors=clone(object.userData.editorBehaviors);
    if (descriptor.prefab) object.userData.editorPrefabKey = content.userData.editorPrefabKey;
    if (content.userData.editorPrefabVariant) object.userData.editorPrefabVariant = content.userData.editorPrefabVariant;
    if (content.userData.editorConveyorTop !== undefined) object.userData.editorConveyorTop = content.userData.editorConveyorTop;
    // Imported userData can hold app metadata; editor identity belongs only to this wrapper.
    object.add(content);
    this._syncConveyor(object);
    if (record) this._applyState(object, record);
    else object.position.set(0, 1, -2);
    const nodes = new Map();
    if (descriptor.nativeId || descriptor.prefab) {
      const visit = (node, path) => {
        if (node.userData.editorCloneSourceId || node.userData.editorPrefabNode) {
          node.userData.editorId = id + '/' + path;
          node.userData.editorRoom = roomId;
          node.userData.editorNative = false;
          if (node.userData.editorPrefabNode) node.userData.editorDefaultBehaviors = normalizeBehaviors(remapBehaviorReferences(node.userData.editorDefaultBehaviors || [], new Map([['@root', id]])));
          const saved = record && record.nodes && record.nodes[path];
          if (saved) { node.name = saved.name; this._applyState(node, saved); }
          nodes.set(path, node); this.objects.set(node.userData.editorId, node);
        }
        node.children.forEach((child, index) => visit(child, path + '.' + index));
      };
      content.children.forEach((child, index) => visit(child, String(index)));
    }
    this._enforceConveyorOptions(object);
    const entry = {id, roomId, descriptor: clone(descriptor), object, nodes};
    this.additions.set(id, entry);
    this.objects.set(id, object);
    room.root.add(object);
    // A saved legacy descriptor can already carry an explicitly adopted
    // equipmentId. Reconcile its recipe now that its entry and actors exist.
    this._syncConveyor(object);
    return object;
  }

  addPrimitive(roomId, type, color = '#60a5fa') {
    if (!PRIMITIVES.includes(type)) throw new Error('Tipo de figura no compatible.');
    const descriptor = descriptorValue({type, color});
    return this._action(() => this._attach(roomId, descriptor, this._primitive(descriptor)));
  }

  _cadVisual(descriptor) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(descriptor.mesh.positions, 3));
    const positions=descriptor.mesh.positions,normals=require('../../tools/cad/schema/cad').vertexNormals(positions,descriptor.smoothingAngle===undefined?45:descriptor.smoothingAngle),uv=new Float32Array(positions.length/3*2);
    geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));
    for(let i=0;i<positions.length;i+=9){const nx=Math.abs(normals[i]),ny=Math.abs(normals[i+1]),nz=Math.abs(normals[i+2]);for(let k=0;k<3;k++){const p=i+k*3,j=p/3*2;uv[j]=(ny>=nx&&ny>=nz?positions[p]:nz>=nx?positions[p]:positions[p+2])*2;uv[j+1]=(ny>=nx&&ny>=nz?positions[p+2]:positions[p+1])*2;}}
    geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const material = new THREE.MeshStandardMaterial({color: descriptor.color, roughness: 0.48, metalness: 0.35});
    if (material.color.convertSRGBToLinear) material.color.convertSRGBToLinear();
    const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.name = 'Pieza paramétrica'; mesh.userData.cadVisual = true; return mesh;
  }

  _replaceCADVisual(object, descriptor) {
    const geometries = new Set(), materials = new Set();
    object.children.slice().forEach(child => {
      if (!child.userData.cadVisual) return;
      child.traverse(node => {if (node.geometry) geometries.add(node.geometry);(Array.isArray(node.material)?node.material:[node.material]).filter(Boolean).forEach(material=>materials.add(material));});
      object.remove(child);
    });
    geometries.forEach(geometry=>geometry.dispose()); materials.forEach(material=>material.dispose());
    object.add(this._cadVisual(descriptor));
  }

  addCAD(roomId, value) {
    const descriptor = descriptorValue(value);
    if (descriptor.type !== 'cad') throw new Error('Selecciona una pieza CAD.');
    this._validateCADAttachment(roomId, descriptor);
    return this._action(() => {
      const object = this._attach(roomId, descriptor, this._cadVisual(descriptor));
      object.name = 'Pieza CAD';
      if (descriptor.attachment) object.position.fromArray(descriptor.attachment.position);
      this.syncCADAttachments(); return object;
    });
  }

  updateCAD(object, value) {
    this._requireObject(object);
    const entry = this.additions.get(object.userData.editorId), descriptor = descriptorValue(value);
    if (!entry || entry.descriptor.type !== 'cad' || descriptor.type !== 'cad') throw new Error('Selecciona una pieza CAD editable.');
    this._validateCADAttachment(entry.roomId, descriptor);
    return this._action(() => {
      this._replaceCADVisual(object, descriptor); entry.descriptor = clone(descriptor); object.userData.editorDescriptor = clone(descriptor);
      this.syncCADAttachments(); return object;
    });
  }

  _validateCADAttachment(roomId, descriptor) {
    if (!descriptor.attachment) return;
    const target = this.getObject(descriptor.attachment.targetId);
    if (!target || target.userData.editorRoom !== roomId || target.userData.editorPrefabKey !== 'vehicle') throw new Error('Vincula la pieza a un vehículo de este nivel.');
  }

  syncCADAttachments() {
    this.additions.forEach(entry => {
      if (entry.descriptor.type !== 'cad') return;
      const object = entry.object, attachment = entry.descriptor.attachment;
      const target = attachment && this.getObject(attachment.targetId);
      if (!target || target.userData.editorRoom !== entry.roomId || target.userData.editorPrefabKey !== 'vehicle') {
        if (attachment && !object.matrixAutoUpdate) object.matrix.decompose(object.position,object.quaternion,object.scale);
        object.matrixAutoUpdate = true; object.updateMatrix(); return;
      }
      let rig; target.traverse(child => { if (child.userData.vehicleRig) rig = child.userData.vehicleRig; });
      const anchor = rig && (attachment.part === 'forks' ? rig.forks : attachment.part === 'cabin' ? rig.cabin || rig.driverSeat : null) || target;
      anchor.updateWorldMatrix(true, false); object.parent.updateWorldMatrix(true, false);
      object.matrixAutoUpdate = false;
      object.matrix.compose(object.position, object.quaternion, object.scale);
      object.matrix.premultiply(anchor.matrixWorld).premultiply(new THREE.Matrix4().getInverse(object.parent.matrixWorld));
      object.matrixWorldNeedsUpdate = true; object.updateMatrixWorld(true);
    });
  }

  addPrefab(roomId, kind, variant) {
    const descriptor = descriptorValue(Object.assign({prefab: kind}, variant ? {variant} : {}));
    return this._action(() => this._attach(roomId, descriptor, createIndustrialPrefab(kind, variant)));
  }

  // Persist only the projector anchor and configuration. DecalSystem owns the
  // derived surface geometry and textures in both editing and WebXR playback.
  addDecal(roomId, config = {}, transform = {}) {
    if (!isPlain(config) || !isPlain(transform)) throw new Error('Configuración de decal inválida.');
    const behaviors = normalizeBehaviors([Object.assign({}, config, {type: 'decal'})]);
    const state = validateState({
      position: transform.position === undefined ? [0, 1, -2] : transform.position,
      quaternion: transform.quaternion === undefined ? [0, 0, 0, 1] : transform.quaternion,
      scale: transform.scale === undefined ? [1, 1, 1] : transform.scale
    }, false);
    const content = new THREE.Group();
    content.userData.editorDefaultBehaviors = behaviors;
    return this._action(() => {
      const object = this._attach(roomId, {type: 'decal'}, content);
      object.name = 'Decal';
      this._applyState(object, state);
      return object;
    });
  }

  // A logical, noncolliding audio anchor has no mesh or runtime GPU resource.
  addAudioZone(roomId, config = {}, transform = {}) {
    if (!isPlain(config) || !isPlain(transform)) throw new Error('Configuración de zona de sonido inválida.');
    const behaviors = normalizeBehaviors([Object.assign({}, config, {type: 'audioZone'})]);
    const state = validateState({position: transform.position || [0, 1, -2], quaternion: transform.quaternion || [0, 0, 0, 1], scale: transform.scale || [1, 1, 1]}, false);
    const content = new THREE.Group(); content.userData.editorDefaultBehaviors = behaviors;
    return this._action(() => {
      const object = this._attach(roomId, {type: 'audioZone'}, content);
      object.name = 'Zona de sonido'; this._applyState(object, state); return object;
    });
  }

  addIndustrialFloorPresentation(roomId, descriptor) {
    const value = behaviorSchema.industrialFloor.normalize(descriptor);
    return this._action(() => {
      const object = this._attach(roomId, value, behaviorSchema.industrialFloor.createVisual(THREE, value));
      // The plan already contains room-local coordinates, including floorY.
      // The ordinary insertion offset [0,1,-2] must never shift this layer.
      object.position.set(0, 0, 0); return object;
    });
  }

  _replaceIndustrialFloorVisual(object, descriptor) {
    const content = behaviorSchema.industrialFloor.createVisual(THREE, descriptor), geometries = new Set(), materials = new Set(), textures = new Set();
    const previous = object.children[0];
    if (previous) {
      previous.traverse(node => {if (node.geometry) geometries.add(node.geometry); (Array.isArray(node.material) ? node.material : [node.material]).filter(Boolean).forEach(material => {materials.add(material); if (material.map && material.map.userData && material.map.userData.industrialFloorAtlas) textures.add(material.map);});});
      object.remove(previous);
    }
    object.add(content);
    geometries.forEach(value => value.dispose()); materials.forEach(value => value.dispose()); textures.forEach(value => value.dispose());
  }

  updateIndustrialFloorPresentation(object, value) {
    this._requireObject(object);
    const entry = this.additions.get(object.userData.editorId), descriptor = behaviorSchema.industrialFloor.normalize(value);
    if (!entry || entry.descriptor.type !== 'industrialFloor') throw new Error('Selecciona una capa de señalización editable.');
    if (this.visuals.has(entry.id)) throw new Error('Restaura la apariencia de esta capa antes de editar su señalización.');
    return this._action(() => {
      this._replaceIndustrialFloorVisual(object, descriptor); entry.descriptor = clone(descriptor); object.userData.editorDescriptor = clone(descriptor);
      if (object.userData.editorColor) this._applyColor(object, object.userData.editorColor);
      return object;
    });
  }

  async addAsset(roomId, descriptor, prepare) {
    descriptor = descriptorValue(descriptor);
    if (!this.rooms.has(String(roomId))) throw new Error('Sala desconocida.');
    const content = await this._instantiate(descriptor);
    if (!content || !content.isObject3D) throw new Error('El recurso no contiene un modelo 3D.');
    if (prepare && this.transaction) throw new Error('Termina la edición actual antes de añadir el modelo.');
    return this._action(() => {
      const object = this._attach(roomId, descriptor, content);
      // Loading is asynchronous; placement joins the synchronous add action so
      // a failed placement cannot leave a model behind at the default origin.
      if (prepare) prepare(object);
      return object;
    });
  }

  captureObject(object) {
    object = this.getEditableObject(object);
    this._requireObject(object);
    if (this.loading) throw new Error('Espera a que termine de cargar el proyecto.');
    const originalId = object.userData.editorId;
    const entry = this.additions.get(originalId);
    const nativeId = this.isNative(object) ? originalId : object.userData.editorCloneSourceId;
    const prefab = object.userData.editorPrefabKey;
    if (!entry && !nativeId && !prefab) throw new Error('No se encontró la plantilla de este objeto.');
    const prefabDescriptor = Object.assign({prefab}, object.userData.editorPrefabVariant ? {variant: object.userData.editorPrefabVariant} : {});
    const record = entry ? this._additionRecord(entry) : Object.assign({name: object.name || 'Objeto', descriptor: prefab ? prefabDescriptor : {nativeId}, interaction: clone(object.userData.editorInteraction || {type: 'none'})}, this._state(object));
    const roomId = object.userData.editorRoom;
    const sources = [['', originalId]];
    if (entry) entry.nodes.forEach((node, path) => sources.push([path, node.userData.editorId]));
    if (!entry) {
      object.updateWorldMatrix(true, false);
      const matrix = new THREE.Matrix4().getInverse(this.rooms.get(roomId).root.matrixWorld).multiply(object.matrixWorld);
      const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
      matrix.decompose(position, quaternion, scale);
      record.position = position.toArray(); record.quaternion = quaternion.toArray(); record.scale = scale.toArray();
    }
    // Capture every editable property now. Pasting only needs immutable records,
    // so deleting or changing the original after Ctrl+C cannot affect the copy.
    const content = entry ? null : prefab ? createIndustrialPrefab(prefab, prefabDescriptor.variant) : this._cloneNative(nativeId, true, object);
    if (!entry && nativeId) {
      record.nodes = {};
      const visit = (node, path) => {
        if (node.userData.editorCloneSourceId) {
          const source = this.objects.get(node.userData.editorCloneInstanceId || node.userData.editorCloneSourceId);
          record.nodes[path] = this._nodeRecord(source || node);
          sources.push([path, source ? source.userData.editorId : node.userData.editorCloneSourceId]);
          const visual = source && this.visuals.get(source.userData.editorId);
          if (visual) record.nodes[path].visual = clone(visual.descriptor);
          else if (source && this.overrides.get(source.userData.editorId) && this.overrides.get(source.userData.editorId).visual) record.nodes[path].visual = clone(this.overrides.get(source.userData.editorId).visual);
        }
        node.children.forEach((child, index) => visit(child, path + '.' + index));
      };
      content.children.forEach((child, index) => visit(child, String(index)));
      if (!Object.keys(record.nodes).length) delete record.nodes;
    }
    if (!entry && prefab) {
      record.nodes = {};
      const visit = (node, source, path) => {
        if (node.userData.editorPrefabNode && source && this.objects.get(source.userData.editorId) === source) {
          record.nodes[path] = this._nodeRecord(source);
          sources.push([path, source.userData.editorId]);
          const visual = this.visuals.get(source.userData.editorId);
          if (visual) record.nodes[path].visual = clone(visual.descriptor);
        }
        node.children.forEach((child, index) => visit(child, source && source.children[index], path + '.' + index));
      };
      content.children.forEach((child, index) => visit(child, object.children[index], String(index)));
      if (!Object.keys(record.nodes).length) delete record.nodes;
    }
    if (!entry && this.visuals.has(originalId)) record.visual = clone(this.visuals.get(originalId).descriptor);
    else if (!entry && this.overrides.get(originalId) && this.overrides.get(originalId).visual) record.visual = clone(this.overrides.get(originalId).visual);
    const snapshot = {format: 'hello-webxr-object', version: 1, roomId, record, sources};
    if (entry && entry.descriptor.type === 'cad' && entry.descriptor.attachment) {
      this.syncCADAttachments(); object.updateWorldMatrix(true, false);
      const room = this.rooms.get(roomId), matrix = new THREE.Matrix4().multiplyMatrices(new THREE.Matrix4().getInverse(room.root.matrixWorld),object.matrixWorld);
      const position=new THREE.Vector3(),quaternion=new THREE.Quaternion(),scale=new THREE.Vector3();matrix.decompose(position,quaternion,scale);
      snapshot.cadTransform={position:position.toArray(),quaternion:quaternion.toArray(),scale:scale.toArray()};
    }
    const entity = this.studio && (this.studio.entities || []).find(item => item.objectId === originalId);
    if (entity) snapshot.studioEntity = entity;
    return clone(snapshot);
  }

  async pasteObject(snapshot, roomId, offset = 0.5, prepare, options = {}) {
    if (this.loading) throw new Error('Espera a que termine de cargar el proyecto.');
    if (!isPlain(snapshot) || snapshot.format !== 'hello-webxr-object' || snapshot.version !== 1 ||
        !isPlain(snapshot.record) || !Array.isArray(snapshot.sources) ||
        snapshot.sources.some(pair => !Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || typeof pair[1] !== 'string')) {
      throw new Error('No hay un objeto compatible para pegar.');
    }
    roomId = String(roomId === undefined ? snapshot.roomId : roomId);
    if (!this.rooms.has(roomId)) throw new Error('Sala desconocida.');
    if (typeof offset !== 'number' || !Number.isFinite(offset)) throw new Error('Desplazamiento de copia inv\u00e1lido.');
    const prepared = clone(snapshot);
    const sourceRoomId = String(snapshot.roomId);
    let entity;
    if (prepared.studioEntity !== undefined) {
      entity = behaviorSchema.studio.normalize({version: 1, entities: [prepared.studioEntity]}).entities[0];
      const source = prepared.sources.find(pair => pair[0] === '');
      if (!source || entity.objectId !== source[1] || entity.roomId !== prepared.roomId) throw new Error('La entidad copiada no corresponde a su marcador.');
    }
    prepared.record.id = this._newId();
    prepared.record.name = (prepared.record.name || 'Objeto').slice(0, 154) + ' copia';
    if(prepared.record.behaviors){
      const rack=prepared.record.behaviors.find(value=>value.type==='palletQueue'&&behaviorSchema.warehouseRacks.isRack(value));
      if(rack){rack.rackAssignments='[]';prepared.record.behaviors=this._withRackAddress(normalizeBehaviors(prepared.record.behaviors),roomId,null,true);}
    }
    const cadAttachment=prepared.record.descriptor&&prepared.record.descriptor.type==='cad'&&prepared.record.descriptor.attachment;
    if(cadAttachment&&!options.deferExternalReferences){
      const target=this.getObject(cadAttachment.targetId);
      if(sourceRoomId!==roomId||!target||target.userData.editorRoom!==roomId){
        delete prepared.record.descriptor.attachment;
        if(prepared.cadTransform)Object.assign(prepared.record,validateState(prepared.cadTransform,true));
      }
    }
    if (!Array.isArray(prepared.record.position)) throw new Error('Falta la posici\u00f3n del objeto copiado.');
    prepared.record.position[0] += offset;
    // Use the document validator before any asynchronous resource preparation or
    // scene mutation. Each paste gets fresh models, materials and object IDs.
    const record = this._validate({format: FORMAT, version: VERSION, imports: [], rooms: {
      [roomId]: {overrides: [], additions: [prepared.record]}
    }}).rooms[roomId].additions[0];
    const content = await this._instantiate(record.descriptor);
    const preparedVisuals = await this._prepareVisuals(record);
    this._checkNodes(content, record);
    if (this.loading) throw new Error('Espera a que termine de cargar el proyecto.');
    if (prepare && this.transaction) throw new Error('Termina la edición actual antes de pegar el equipo.');
    return this._action(() => {
      const copy = this._attach(roomId, record.descriptor, content, record);
      const copied = this.additions.get(copy.userData.editorId);
      const remap = new Map();
      prepared.sources.forEach(([path, sourceId]) => {
        const node = path ? copied.nodes.get(path) : copy;
        if (node) remap.set(sourceId, node.userData.editorId);
      });
      [copy].concat(Array.from(copied.nodes.values())).forEach(node => {
        // Group/template insertion resolves its complete graph after every member
        // exists. It owns the final cross-level cleanup in the same transaction.
        const clearExternal = sourceRoomId !== roomId && !options.deferExternalReferences;
        node.userData.editorBehaviors = normalizeBehaviors(remapBehaviorReferences(this.getBehaviors(node), remap, clearExternal));
        const interaction = node.userData.editorInteraction;
        if (interaction && remap.has(interaction.targetId)) interaction.targetId = remap.get(interaction.targetId);
        else if (clearExternal && interaction && interaction.targetId) node.userData.editorInteraction = {type: 'none'};
      });
      this._installPreparedVisuals(copied, preparedVisuals);
      if (entity) this.setStudio({entities: (this.studio && this.studio.entities || []).concat(Object.assign({}, entity, {
        id: 'entity:' + copy.userData.editorId, objectId: copy.userData.editorId, roomId
      }))});
      if (prepare) prepare(copy);
      if(record.descriptor.type==='cad')this.syncCADAttachments();
      return copy;
    });
  }

  async duplicate(object, prepare) {
    return this.pasteObject(this.captureObject(object), undefined, 0.5, prepare);
  }

  remove(object) {
    this._requireObject(object);
    return this._action(() => {
      if (this.isNative(object) || !this.additions.has(object.userData.editorId)) object.visible = false;
      else {
        const entry = this.additions.get(object.userData.editorId);
        [object].concat(Array.from(entry.nodes.values())).forEach(node => { if (this.visuals.has(node.userData.editorId)) this._setVisual(node, null); });
        object.parent.remove(object);
        this.additions.delete(object.userData.editorId);
        this._unregisterAddition(entry);
        if (this.studio) {
          const removed = new Set([object.userData.editorId].concat(Array.from(entry.nodes.values()).map(node => node.userData.editorId)));
          const patch = {};
          ['entities', 'spawns'].forEach(key => { if (this.studio[key]) patch[key] = this.studio[key].filter(item => !removed.has(item.objectId)); });
          if (this.studio.groups) patch.groups = this.studio.groups.map(group => Object.assign({}, group, {members: group.members.filter(id => !removed.has(id))})).filter(group => group.members.length);
          if (Object.keys(patch).length) this.setStudio(patch);
        }
      }
    });
  }

  setTransform(object, values) {
    this._requireObject(object);
    if (!isPlain(values)) throw new Error('Transformación inválida.');
    const state = validateState(values, true);
    if (values.rotation !== undefined) {
      const rotation = vector(values.rotation, 3, 'rotation');
      state.quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2], object.rotation.order)).toArray();
    }
    return this._action(() => this._applyState(object, state));
  }

  setProperty(object, property, value) {
    this._requireObject(object);
    if (property === 'name') {
      if (this.isNative(object)) throw new Error('El nombre nativo conserva las interacciones originales.');
      value = nameValue(value);
      return this._action(() => { object.name = value; });
    }
    if (property === 'visible') {
      if (typeof value !== 'boolean') throw new Error('Visibilidad inválida.');
      return this._action(() => { object.visible = value; });
    }
    if (property === 'color') {
      if (value !== null) value = colorValue(value);
      return this._action(() => this._applyColor(object, value));
    }
    if (property === 'interaction') return this.setInteraction(object, value);
    throw new Error('Propiedad no editable.');
  }

  rename(object, name) { return this.setProperty(object, 'name', name); }

  setInteraction(object, value) {
    this._requireObject(object);
    if (this.isNative(object)) throw new Error('Este objeto conserva su interacción nativa.');
    // Choosing an action in the inspector first creates an empty, editable action.
    // Loading JSON uses interactionValue directly and still validates its fields.
    if (isPlain(value)) {
      const defaults = {room: {room: 0}, toggle: {targetId: ''}, sound: {asset: ''}, message: {text: ''}};
      value = Object.assign({}, defaults[value.type] || {}, value);
    }
    const interaction = interactionValue(value);
    return this._action(() => { object.userData.editorInteraction = interaction; });
  }

  _applyColor(object, color) {
    const replacement = this.visuals.get(object.userData.editorId);
    if (replacement) this._setVisual(object, null);
    const masks = [];
    object.traverse(child => {
      const mask = this.visualMasks.get(child);
      if (mask) { masks.push([child, mask]); child.material = mask.material; }
    });
    const native = this.native.get(object.userData.editorId);
    if (native) {
      if (!color) {
        if (object.userData.editorMaterial && object.material) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach(material => material.dispose());
        }
        object.material = native.material;
        delete object.userData.editorMaterial;
        delete object.userData.editorColor;
        this._refreshMasks(masks);
        if (replacement) this._setVisual(object, replacement);
        return;
      }
      const source = Array.isArray(native.material) ? native.material : [native.material];
      if (!source.length || source.some(material => !material || !material.color || material.isShaderMaterial)) {
        throw new Error('Este material nativo conserva su efecto original y no admite color.');
      }
      if (!object.userData.editorMaterial) {
        object.material = Array.isArray(native.material) ? source.map(cloneMaterial) : cloneMaterial(native.material);
        object.userData.editorMaterial = true;
      }
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(material => material.color.set(color));
    } else {
      // Clone once before tinting imported resources so other instances stay independent.
      object.traverse(child => {
        if (!child.material) return;
        if (!child.userData.editorMaterial) {
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          child.userData.editorOriginalMaterials = materials;
          child.material = Array.isArray(child.material) ? materials.map(cloneMaterial) : cloneMaterial(child.material);
          child.userData.editorMaterial = true;
        }
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material, index) => {
          if (material.color) {
            if (color) material.color.set(color);
            else material.color.copy(child.userData.editorOriginalMaterials[index].color);
          }
        });
      });
    }
    if (color) object.userData.editorColor = color;
    else delete object.userData.editorColor;
    this._refreshMasks(masks);
    if (replacement) this._setVisual(object, replacement);
  }

  _applyState(object, state) {
    if (state.position) object.position.fromArray(state.position);
    if (state.quaternion) object.quaternion.fromArray(state.quaternion);
    if (state.scale) object.scale.fromArray(state.scale);
    if (state.visible !== undefined) object.visible = state.visible;
    if (state.behaviors !== undefined) { object.userData.editorBehaviors = normalizeBehaviors(state.behaviors); this._syncConveyor(object); }
    if (state.interaction !== undefined) object.userData.editorInteraction = interactionValue(state.interaction);
    if (state.color !== undefined && (state.color || object.userData.editorColor)) this._applyColor(object, state.color);
    object.updateMatrixWorld(true);
  }

  resetRoom(roomId) {
    roomId = String(roomId);
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Sala desconocida.');
    return this._action(() => {
      this.pendingRooms.delete(roomId);
      Array.from(this.visuals.keys()).forEach(id => {
        const object = this.objects.get(id);
        if (object && object.userData.editorRoom === roomId) this._setVisual(object, null);
      });
      room.nativeIds.forEach(id => this._applyState(this.native.get(id).object, this.native.get(id).state));
      room.nativeIds.forEach(id => { const override = this.overrides.get(id); if (override) delete override.visual; });
      Array.from(this.additions.values()).filter(entry => entry.roomId === roomId).forEach(entry => {
        entry.object.parent.remove(entry.object);
        this.additions.delete(entry.id);
        this._unregisterAddition(entry);
      });
      if (this.studio) {
        const patch = {};
        ['entities', 'spawns', 'groups', 'widgets', 'missions', 'environments'].forEach(key => { if (this.studio[key]) patch[key] = this.studio[key].filter(item => item.roomId !== roomId); });
        if (Object.keys(patch).length) this.setStudio(patch);
      }
    });
  }

  async serialize() {
    if (this.transaction) this.commit();
    const rooms = {};
    this.rooms.forEach((room, roomId) => {
      rooms[roomId] = {
        overrides: room.nativeIds.filter(id => this.overrides.has(id)).map(id => Object.assign({id}, clone(this.overrides.get(id)))),
        additions: Array.from(this.additions.values()).filter(entry => entry.roomId === roomId).map(entry => this._additionRecord(entry))
          .concat(clone(this.pendingRooms.get(roomId) && this.pendingRooms.get(roomId).additions || []))
      };
    });
    const result = {format: FORMAT, version: VERSION, rooms, imports: this.assetLibrary && this.assetLibrary.exportImports ? await this.assetLibrary.exportImports() : []};
    if (this.studio) result.studio = clone(this.studio);
    return result;
  }

  _validate(data) {
    if (!isPlain(data) || data.format !== FORMAT || data.version !== VERSION || !isPlain(data.rooms)) {
      throw new Error('Este archivo no es un escenario compatible del editor.');
    }
    const result = {rooms: {}, imports: data.imports || [], studio: behaviorSchema.studio.normalize(data.studio)};
    const ids = new Set();
    let count = 0;
    Object.keys(data.rooms).forEach(roomId => {
      const room = this.rooms.get(roomId);
      const value = data.rooms[roomId];
      if (!room) throw new Error('El archivo contiene una sala desconocida: ' + roomId + '.');
      if (!isPlain(value) || !Array.isArray(value.overrides) || !Array.isArray(value.additions)) throw new Error('Datos de sala inválidos.');
      const overrides = value.overrides.map(item => {
        if (!isPlain(item) || !room.nativeIds.includes(item.id) || ids.has(item.id)) throw new Error('Referencia nativa inválida o duplicada.');
        ids.add(item.id);
        return Object.assign({id: item.id}, validateState(item, true));
      });
      const rackPrefixes=new Set(), plannedPallets=new Set();
      const additions = value.additions.map(item => {
        if (!isPlain(item) || typeof item.id !== 'string' || !/^custom-[a-zA-Z0-9_-]{1,150}$/.test(item.id) || ids.has(item.id)) {
          throw new Error('Identificador de objeto inválido o duplicado.');
        }
        ids.add(item.id);
        const record = Object.assign({id: item.id, name: nameValue(item.name), descriptor: descriptorValue(item.descriptor), interaction: interactionValue(item.interaction)}, validateState(item, false));
        const rack=record.behaviors&&record.behaviors.find(value=>value.type==='palletQueue'&&behaviorSchema.warehouseRacks.isRack(value));
        if(rack){
          const schema=behaviorSchema.warehouseRacks, saved=(item.behaviors||[]).find(value=>value.type==='palletQueue')||{};
          if(!saved.rackAisleCode||!saved.rackRowCode){let index=1;while(rackPrefixes.has(schema.addressPrefix(rack))&&index<10001)rack.rackRowCode='R'+String(index++).padStart(2,'0');}
          const prefix=schema.addressPrefix(rack);if(rackPrefixes.has(prefix))throw Error('El escenario contiene filas de almacén con códigos duplicados: '+prefix+'.');rackPrefixes.add(prefix);
          for(const row of schema.assignments(rack)){if(plannedPallets.has(row.palletId))throw Error('Un pallet tiene más de un destino reservado en el escenario.');plannedPallets.add(row.palletId);}
        }
        if (item.nodes !== undefined) {
          if (!(record.descriptor.nativeId || record.descriptor.prefab) || !isPlain(item.nodes)) throw new Error('Componentes descendientes inválidos.');
          record.nodes = {};
          Object.keys(item.nodes).forEach(path => {
            if (!/^\d+(?:\.\d+)*$/.test(path) || path.length > 200 || !isPlain(item.nodes[path])) throw new Error('Ruta de componente descendiente inválida.');
            count++;
            if(rack&&record.descriptor.prefab==='palletQueue'&&/^1(?:\.|$)/.test(path))return;
            // Retired built-in loading box/table and outlet pallets: preserve the remaining actor
            // paths without restoring their old bodies or replacement assets.
            if (record.descriptor.prefab === 'conveyor') {
              // Slots 7–9 remain retired supply placeholders. In the versioned
              // catalogue, slot 10 is the real lateral presence sensor. The
              // historical slot 10 pallet must still be removed in old scenes.
              const equipment = behaviorSchema.conveyorLayout.equipment.getDefinition(record.descriptor.variant);
              const catalogueVariant = equipment && equipment.variant === record.descriptor.variant;
              if (/^[789](?:\.|$)/.test(path) || !catalogueVariant && /^10(?:\.|$)/.test(path)) return;
            }
            record.nodes[path] = Object.assign({name: item.nodes[path].name === '' ? '' : nameValue(item.nodes[path].name)}, validateState(item.nodes[path], false));
            if (item.nodes[path].interaction !== undefined) record.nodes[path].interaction = interactionValue(item.nodes[path].interaction);
          });
        }
        migratePanelControls(record);
        return record;
      });
      count += overrides.length + additions.length;
      if (count > MAX_OBJECTS) throw new Error('El escenario contiene demasiados objetos.');
      result.rooms[roomId] = {overrides, additions};
    });
    if (!Array.isArray(result.imports)) throw new Error('Biblioteca importada inválida.');
    return result;
  }

  hasPendingRoom(roomId) { return this.pendingRooms.has(String(roomId)); }

  async _prepareRoom(roomId, records, isCurrent = () => true, options = {}) {
    const additions = [], nativeVisuals = [];
    const checkpoint = preparationBudget(options);
    for (const record of records.additions) {
      if (!await checkpoint(isCurrent)) return null;
      const content = await this._instantiate(record.descriptor);
      if (!await checkpoint(isCurrent)) return null;
      if (!content || !content.isObject3D) throw new Error('No se pudo abrir un modelo del escenario.');
      this._checkNodes(content, record);
      const visuals = await this._prepareVisuals(record);
      if (!await checkpoint(isCurrent)) return null;
      additions.push({roomId, record, content, visuals});
    }
    for (const record of records.nativeVisuals) {
      if (!await checkpoint(isCurrent)) return null;
      const content = await this._instantiate(record.descriptor);
      if (!await checkpoint(isCurrent)) return null;
      nativeVisuals.push({id: record.id, descriptor: record.descriptor, content});
    }
    return {additions, nativeVisuals};
  }

  _installRoom(prepared) {
    prepared.additions.forEach(({roomId, record, content, visuals}) => {
      const object = this._attach(roomId, record.descriptor, content, record);
      this._installPreparedVisuals(this.additions.get(object.userData.editorId), visuals);
    });
    prepared.nativeVisuals.forEach(visual => {
      const object = this.objects.get(visual.id);
      this._setVisual(object, {descriptor: visual.descriptor, content: this._fitVisual(object, visual.content), hidden: new Map()});
    });
    this.syncCADAttachments();
  }

  _hydrateHistory(roomId, records) {
    const additions = records.additions.map(record => {
      const entry = this.additions.get(record.id);
      return {entry, record: clone(record), visuals: new Map([entry.object].concat(Array.from(entry.nodes.values())).map(object =>
        [object.userData.editorId, this.visuals.get(object.userData.editorId)]))};
    });
    // Preserve synchronous undo/redo of existing edits after room activation.
    this.undoStack.concat(this.redoStack, this.transaction ? [this.transaction] : []).forEach(snapshot => {
      const pending = (snapshot.pendingRooms || []).find(([id]) => id === roomId);
      if (!pending || !same(pending[1], records)) return;
      snapshot.pendingRooms = snapshot.pendingRooms.filter(([id]) => id !== roomId);
      snapshot.additions.push(...additions);
      records.nativeVisuals.forEach(record => {
        const native = snapshot.native.find(entry => entry.id === record.id);
        if (native) native.visual = this.visuals.get(record.id);
      });
    });
  }

  activateRoom(roomId, options = {}) {
    roomId = String(roomId);
    if (!this.rooms.has(roomId)) return Promise.reject(new Error('Sala desconocida.'));
    if (this.loading) return Promise.reject(new Error('Espera a que termine de cargar el proyecto.'));
    const existing = this.roomActivations.get(roomId);
    if (existing) {
      if (!existing.activationSignal || !existing.activationSignal.aborted) return existing;
      // A→B→A can request this room again while its cancelled factory is still
      // resolving. Reuse only live preparations: the old detached job cannot
      // install after its abort check and cannot delete this new promise.
      this.roomActivations.delete(roomId);
    }
    const records = this.pendingRooms.get(roomId);
    if (!records) return Promise.resolve(false);
    const generation = this.loadGeneration;
    const promise = (async () => {
      const isCurrent = () => generation === this.loadGeneration && this.pendingRooms.get(roomId) === records;
      let prepared;
      try { prepared = await this._prepareRoom(roomId, records, isCurrent, options); }
      catch (error) { if (!isCurrent()) return false; throw error; }
      // A new load, reset or undo invalidates an in-flight room preparation.
      if (!isCurrent()) return false;
      if (options.signal && options.signal.aborted) throw Object.assign(new Error('Carga de escenario cancelada.'), {name: 'AbortError', code: 'load_aborted'});
      if (options.assertCurrent) options.assertCurrent();
      const previous = this.capture();
      try {
        this._installRoom(prepared);
        this.pendingRooms.delete(roomId);
        this._hydrateHistory(roomId, records);
      } catch (error) {
        this._restore(previous);
        throw error;
      }
      return true;
    })();
    Object.defineProperty(promise, 'activationSignal', {value: options.signal});
    this.roomActivations.set(roomId, promise);
    promise.then(() => {
      if (this.roomActivations.get(roomId) === promise) this.roomActivations.delete(roomId);
    }, () => {
      if (this.roomActivations.get(roomId) === promise) this.roomActivations.delete(roomId);
    });
    return promise;
  }

  async load(data, options = {}) {
    if (this.loading) throw new Error('Ya se está cargando un escenario.');
    if (this.transaction) this.commit();
    const validated = this._validate(data);
    const activeRoomId = options.activeRoomId === undefined ? null : String(options.activeRoomId);
    if (activeRoomId !== null && !this.rooms.has(activeRoomId)) throw new Error('Sala desconocida.');
    const previous = this.capture();
    const prepared = [];
    const pending = new Map();
    this.loadGeneration++;
    this.roomActivations.clear();
    this.loading = true;
    try {
      const current = () => { if (options.assertCurrent) options.assertCurrent(); return true; };
      const checkpoint = preparationBudget(options); await checkpoint(current);
      if (this.assetLibrary && this.assetLibrary.restoreImports) this.assetLibrary.restoreImports(validated.imports);
      else if (validated.imports.length) throw new Error('No se pueden restaurar los recursos importados.');
      // Legacy callers load eagerly; the application supplies its active room.
      for (const roomId of Object.keys(validated.rooms)) {
        const records = {additions: validated.rooms[roomId].additions, nativeVisuals: []};
        for (const record of validated.rooms[roomId].overrides) {
          if (record.visual) records.nativeVisuals.push({id: record.id, descriptor: record.visual});
          if (!record.color) continue;
          const material = this.native.get(record.id).material;
          const materials = Array.isArray(material) ? material : [material];
          if (materials.some(item => !item || !item.color || item.isShaderMaterial)) throw new Error('El escenario intenta cambiar un material nativo protegido.');
        }
        if (activeRoomId === null || activeRoomId === roomId) prepared.push(await this._prepareRoom(roomId, records, current, options));
        else if (records.additions.length || records.nativeVisuals.length) pending.set(roomId, records);
      }
      await checkpoint(current);
      Array.from(this.visuals.keys()).forEach(id => { const object = this.objects.get(id); if (object) this._setVisual(object, null); });
      this.native.forEach(entry => this._applyState(entry.object, entry.state));
      this.additions.forEach(entry => { if (entry.object.parent) entry.object.parent.remove(entry.object); this._unregisterAddition(entry); });
      this.additions.clear();
      this.overrides.clear();
      this.pendingRooms = pending;
      Object.keys(validated.rooms).forEach(roomId => validated.rooms[roomId].overrides.forEach(record => {
        this._applyState(this.objects.get(record.id), record);
        const override = Object.assign({}, record);
        delete override.id;
        this.overrides.set(record.id, override);
      }));
      prepared.forEach(room => this._installRoom(room));
      this.studio = validated.studio;
      this.undoStack.push(previous);
      if (this.undoStack.length > 60) this.undoStack.shift();
      this.redoStack.length = 0;
      this._notify('load');
      return true;
    } catch (error) {
      this._restore(previous);
      throw error;
    } finally {
      this.loading = false;
    }
  }

  async saveLocal(key = 'hello-webxr-editor-project') {
    const data = await this.serialize();
    try { localStorage.setItem(key, JSON.stringify(data)); }
    catch (error) { throw new Error('No hay espacio en el navegador. Exporta el escenario como archivo JSON.'); }
    this._notify('save');
    return data;
  }

  async loadLocal(key = 'hello-webxr-editor-project') {
    const value = localStorage.getItem(key);
    if (!value) return false;
    let data;
    try { data = JSON.parse(value); } catch (error) { throw new Error('El proyecto guardado no contiene JSON válido.'); }
    return this.load(data);
  }

  _notify(type) { this.onChange({type, document: this}); }
}
