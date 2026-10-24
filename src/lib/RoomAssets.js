import * as THREE from 'three';
import {loadAssets} from './assetManager.js';

// Keep small hall portal previews ready. Full panorama/secondary-room textures
// are fetched only when their room (or a copied native visual) needs them.
const ROOM_TEXTURES = {
  panoramastereo: ['stereopanoL', 'stereopanoR'],
  panorama1: ['pano2'], panorama2: ['pano3'], panorama3: ['pano4'], panorama4: ['pano5'], panorama5: ['pano6'],
  photogrammetry: ['pg_floor_tex', 'pg_floor_lm_tex', 'pg_door_lm_tex', 'pg_object_tex', 'pg_bg_tex', 'pg_flare_tex', 'pg_panel_tex'],
  vertigo: ['vertigo_lm_tex', 'checkboard_tex']
};

function texturesIn(root, visit) {
  if (!root) return;
  const seen = new Set();
  const scan = value => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    if (value.isTexture) { visit(value); return; }
    seen.add(value);
    if (Array.isArray(value)) value.forEach(scan);
    else Object.keys(value).forEach(key => scan(value[key]));
  };
  root.traverse(object => {
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.filter(Boolean).forEach(material => {
      Object.keys(material).forEach(key => scan(material[key]));
    });
  });
}

function deferredTexture(texture, id) {
  // Three r112 textures have no userData and Texture.copy/clone drops custom
  // metadata and compressed/data flags. Scope this compatibility bridge to
  // deferred textures so native visual copies keep their loading dependency.
  texture.userData = Object.assign({}, texture.userData, {roomAssetId: id});
  texture.clone = function() {
    const copy = THREE.Texture.prototype.clone.call(this);
    copy.isDataTexture = !!this.isDataTexture;
    copy.isCompressedTexture = !!this.isCompressedTexture;
    deferredTexture(copy, id);
    copy.needsUpdate = true;
    return copy;
  };
  return texture;
}

export default class RoomAssets {
  constructor(renderer, assets) {
    this.renderer = renderer;
    this.assets = assets;
    this.records = new Map();
    Object.keys(ROOM_TEXTURES).forEach(room => ROOM_TEXTURES[room].forEach(id => {
      if (this.records.has(id) || !assets[id]) return;
      const descriptor = assets[id];
      const texture = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, THREE.RGBAFormat);
      deferredTexture(texture, id);
      texture.needsUpdate = true;
      this.records.set(id, {descriptor, texture, loaded: null, promise: null});
      assets[id] = texture;
    }));
  }

  initialAssets() {
    const result = {};
    Object.keys(this.assets).forEach(id => { if (!this.records.has(id)) result[id] = this.assets[id]; });
    return result;
  }

  apply(texture, source, id) {
    const userData = texture.userData;
    texture.copy(source);
    texture.isDataTexture = !!source.isDataTexture;
    texture.isCompressedTexture = !!source.isCompressedTexture;
    texture.userData = Object.assign({}, userData, {roomAssetId: id});
    texture.needsUpdate = true;
  }

  load(id) {
    const record = this.records.get(id);
    if (!record) return Promise.resolve();
    if (!record.promise) record.promise = new Promise((resolve, reject) => {
      const batch = {[id]: record.descriptor};
      loadAssets(this.renderer, 'assets/', batch, () => {
        record.loaded = batch[id];
        this.apply(record.texture, record.loaded, id);
        resolve();
      }, null, false, reject);
    }).catch(error => { record.promise = null; throw error; });
    return record.promise;
  }

  async prepareDependencies(root) {
    const targets = new Map();
    texturesIn(root, texture => {
      const id = texture.userData && texture.userData.roomAssetId;
      if (!this.records.has(id)) return;
      if (!targets.has(id)) targets.set(id, new Set());
      targets.get(id).add(texture);
    });
    await Promise.all(Array.from(targets.keys()).map(id => this.load(id)));
    targets.forEach((textures, id) => textures.forEach(texture => {
      const record = this.records.get(id);
      // New clones may have inherited a placeholder before the source was loaded.
      if (texture.image !== record.loaded.image) this.apply(texture, record.loaded, id);
    }));
  }

  async prepareRoom(roomId, root) {
    await Promise.all((ROOM_TEXTURES[roomId] || []).map(id => this.load(id)));
    await this.prepareDependencies(root);
  }
}
