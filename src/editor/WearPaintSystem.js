import * as THREE from 'three';
import DecalSystem from './DecalSystem.js';
import wearSchema from '../../shared/wear.js';

/** Persist brush layers on their actor; keep clipped meshes private and derived. */
export default class WearPaintSystem {
  constructor(ctx, document, library, notify) {
    this.ctx = ctx;
    this.document = document;
    this.entries = new Map();
    this.configurations = new WeakMap();
    this.preview = null;
    this.roomId = null;
    const proxy = {
      getRoot: roomId => document.getRoot(roomId),
      getObject: id => document.getObject(id),
      getObjects: () => Array.from(this.entries.values(), entry => entry.object),
      getBehaviors: object => object.userData.editorBehaviors || []
    };
    this.engine = new DecalSystem(ctx, proxy, library, notify);
  }

  layers(owner) {
    const raw = (owner.userData.editorBehaviors || owner.userData.editorDefaultBehaviors || []).find(item => item.type === 'surfaceWear' && item.enabled !== false);
    if (!raw) return [];
    let cached = this.configurations.get(owner);
    if (!cached || cached.source !== raw.layers) {
      cached = {source: raw.layers, layers: wearSchema.normalizeLayers(raw.layers)};
      this.configurations.set(owner, cached);
    }
    return cached.layers;
  }

  _install(key, owner, layer) {
    let entry = this.entries.get(key);
    if (entry && entry.owner !== owner) { this._remove(key); entry = null; }
    // Normalized layers are private immutable snapshots of the serialized
    // layer JSON. A brush preview/new edit creates a new normalized object.
    const signature = entry && entry.layer === layer ? entry.signature : JSON.stringify(layer);
    if (!entry) {
      const object = new THREE.Group(); object.name = 'Desgaste · ' + layer.pattern;
      object.matrixAutoUpdate = false;
      Object.assign(object.userData, {editorHelper: true, editorRuntimeHelper: true, editorId: key, editorDecal: true});
      owner.add(object);
      entry = {object, owner, signature: null}; this.entries.set(key, entry);
    }
    if (entry.signature !== signature) {
      entry.signature = signature;
      entry.object.matrix.fromArray(layer.matrix); entry.object.matrixWorldNeedsUpdate = true;
      const config = Object.assign({type: 'decal', enabled: true, asset: '', targetId: owner.userData.editorId}, layer);
      delete config.matrix; delete config.id;
      config.wearDensity = layer.density; delete config.density;
      config.stamps = JSON.stringify(layer.stamps);
      entry.object.userData.editorBehaviors = [config];
    }
    entry.layer = layer;
    return entry;
  }

  _remove(key) {
    const entry = this.entries.get(key);
    if (!entry) return;
    if (entry.object.parent) entry.object.parent.remove(entry.object);
    this.entries.delete(key);
  }

  setPreview(owner, layer) {
    const normalized = wearSchema.normalizeLayers([layer])[0];
    this.preview = {owner, layer: normalized};
    this._install('__wear-preview', owner, normalized);
  }

  clearPreview() { this.preview = null; this._remove('__wear-preview'); }

  sync(roomId) {
    if (this.roomId !== null && this.roomId !== String(roomId)) this.dispose();
    this.roomId = String(roomId);
    const found = new Set();
    this.document.getObjects(roomId).forEach(owner => {
      this.layers(owner).forEach(layer => {
        const key = owner.userData.editorId + '/wear/' + layer.id;
        found.add(key); this._install(key, owner, layer);
      });
    });
    if (this.preview && this.document.getObject(this.preview.owner.userData.editorId) === this.preview.owner) {
      found.add('__wear-preview'); this._install('__wear-preview', this.preview.owner, this.preview.layer);
    } else this.preview = null;
    Array.from(this.entries.keys()).forEach(key => { if (!found.has(key)) this._remove(key); });
    this.engine.sync(roomId);
  }

  invalidate() { this.configurations = new WeakMap(); }

  dispose() {
    this.engine.dispose();
    Array.from(this.entries.keys()).forEach(key => this._remove(key));
    this.configurations = new WeakMap(); this.preview = null; this.roomId = null;
  }
}
