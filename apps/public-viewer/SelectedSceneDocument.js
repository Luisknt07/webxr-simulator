import * as THREE from 'three';
import behaviorSchema from '../../modules/logistica-industrial/contracts/behaviors.js';
import {createIndustrialPrefab} from '../../modules/logistica-industrial/functions/presentacion/runtime/IndustrialPrefabs.js';

const copy = value => JSON.parse(JSON.stringify(value));
const PREFABS = new Set(['source', 'robot', 'conveyor', 'palletQueue', 'vehicle']);
const PRIMITIVES = new Set(['box', 'cylinder', 'sphere', 'plane']);

function state(object, record) {
  if (record.name !== undefined) object.name = record.name;
  if (record.position) object.position.fromArray(record.position);
  if (record.quaternion) object.quaternion.fromArray(record.quaternion);
  if (record.scale) object.scale.fromArray(record.scale);
  if (record.visible !== undefined) object.visible = record.visible;
  if (record.behaviors) object.userData.editorBehaviors = behaviorSchema.normalizeBehaviors(record.behaviors);
}

function defaults(object, ownerId) {
  const values = copy(object.userData.editorDefaultBehaviors || []);
  values.forEach(value => ['targetId', 'outputId', 'sourceId', 'branchId'].forEach(key => {
    if (value[key] === '@root') value[key] = ownerId;
  }));
  object.userData.editorDefaultBehaviors = behaviorSchema.normalizeBehaviors(values);
}

/** Read-only format-1 adapter for this app's one approved snapshot. It has no
 * authoring, undo stack, asset importer, CAD loader, networking or persistence. */
export default class SelectedSceneDocument {
  constructor(snapshot, scene) {
    const source = snapshot && snapshot.project && snapshot.project.document;
    if (!source || source.format !== 'hello-webxr-editor' || source.version !== 1 || !source.rooms || !source.rooms.hall) {
      throw new Error('La demostración no tiene un documento compatible.');
    }
    this.roomId = 'hall'; this.objects = new Map(); this.additions = new Map();
    this.studio = copy(source.studio || {}); this.root = new THREE.Group();
    this.root.name = 'Demostración pública · robot, banda y montacargas'; scene.add(this.root);
    try {
      source.rooms.hall.additions.forEach(record => this.attach(record));
      // Camera/spawn markers are authoring helpers, not objects in the lesson.
      [...(this.studio.entities || []), ...(this.studio.spawns || [])].forEach(value => {
        const object = this.getObject(value.objectId);
        if (object && (value.type === 'camera' || !value.type)) object.visible = false;
      });
      this.root.updateWorldMatrix(true, true);
    } catch (error) { this.dispose(); throw error; }
  }
  instantiate(descriptor, behaviors) {
    if (PREFABS.has(descriptor.prefab)) {
      const config = behaviors.find(value => value.type === descriptor.prefab);
      if (!config) throw new Error('Falta la configuración de ' + descriptor.prefab + '.');
      return createIndustrialPrefab(descriptor.prefab, descriptor.variant, config);
    }
    if (descriptor.type === 'industrialFloor') return behaviorSchema.industrialFloor.createVisual(THREE, descriptor);
    if (!PRIMITIVES.has(descriptor.type)) throw new Error('Recurso no incluido en la demostración: ' + (descriptor.prefab || descriptor.type));
    const geometry = descriptor.type === 'box' ? new THREE.BoxBufferGeometry(1, 1, 1) :
      descriptor.type === 'cylinder' ? new THREE.CylinderBufferGeometry(.5, .5, 1, 24) :
      descriptor.type === 'sphere' ? new THREE.SphereBufferGeometry(.5, 24, 16) : new THREE.PlaneBufferGeometry(2, 2);
    return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({color: descriptor.color || '#83908b', roughness: .8, side: THREE.DoubleSide}));
  }
  attach(record) {
    if (!record || !record.id || this.objects.has(record.id)) throw new Error('Identidad de objeto duplicada o ausente.');
    const descriptor = copy(record.descriptor), behaviors = behaviorSchema.normalizeBehaviors(record.behaviors || []);
    const content = this.instantiate(descriptor, behaviors), object = new THREE.Group();
    object.userData.editorId = record.id; object.userData.editorRoom = this.roomId;
    object.userData.editorNative = false; object.userData.editorDescriptor = descriptor;
    object.userData.editorInteraction = copy(record.interaction || {type: 'none'});
    if (descriptor.prefab) object.userData.editorPrefabKey = descriptor.prefab;
    if (content.userData.editorPrefabVariant) object.userData.editorPrefabVariant = content.userData.editorPrefabVariant;
    if (content.userData.editorConveyorTop !== undefined) object.userData.editorConveyorTop = content.userData.editorConveyorTop;
    defaults(content, record.id); object.userData.editorDefaultBehaviors = content.userData.editorDefaultBehaviors;
    object.add(content); state(object, record); this.root.add(object);
    const nodes = new Map();
    const visit = (node, path) => {
      if (node.userData.editorPrefabNode) {
        node.userData.editorId = record.id + '/' + path; node.userData.editorRoom = this.roomId;
        defaults(node, record.id);
        if (record.nodes && record.nodes[path]) state(node, record.nodes[path]);
        nodes.set(path, node); this.objects.set(node.userData.editorId, node);
      }
      node.children.forEach((child, index) => visit(child, path + '.' + index));
    };
    content.children.forEach((child, index) => visit(child, String(index)));
    if (descriptor.prefab === 'conveyor' && createIndustrialPrefab.enforceOptions) createIndustrialPrefab.enforceOptions(content, behaviors.find(value => value.type === 'conveyor'));
    this.objects.set(record.id, object); this.additions.set(record.id, {id: record.id, roomId: this.roomId, descriptor, object, nodes});
    return object;
  }
  getRoot(roomId) { return roomId === this.roomId ? this.root : null; }
  getObject(id) { return this.objects.get(id) || null; }
  getObjects(roomId) { return roomId === this.roomId ? Array.from(this.objects.values()) : []; }
  getBehaviors(object) { return behaviorSchema.normalizeBehaviors(object && (object.userData.editorBehaviors || object.userData.editorDefaultBehaviors) || []); }
  dispose() {
    const geometries = new Set(), materials = new Set(), textures = new Set();
    this.root.traverse(node => {
      if (node.geometry) geometries.add(node.geometry);
      (Array.isArray(node.material) ? node.material : [node.material]).filter(Boolean).forEach(material => {
        materials.add(material); Object.keys(material).forEach(key => {if (material[key] && material[key].isTexture) textures.add(material[key]);});
      });
    });
    textures.forEach(value => value.dispose()); materials.forEach(value => value.dispose()); geometries.forEach(value => value.dispose());
    if (this.root.parent) this.root.parent.remove(this.root);
    this.objects.clear(); this.additions.clear();
  }
}
