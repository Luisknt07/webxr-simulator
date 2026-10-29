import {canvasCard} from './NativeBehaviorAdapters.js';

function visibleInTree(object) {
  for (let current = object; current; current = current.parent) if (!current.visible) return false;
  return true;
}

/** Text-only editor previews; native ECS, animations and inputs remain paused. */
export default class InfoPanelPreview {
  constructor(ctx, document) {
    this.ctx = ctx;
    this.document = document;
    this.panels = new Map();
    this.textMaterials = new Map();
  }

  hideGeneratedText(object, record) {
    object.traverse(child => {
      if (child.name !== 'textMesh' || !child.material) return;
      (Array.isArray(child.material) ? child.material : [child.material]).forEach(material => {
        let hidden = this.textMaterials.get(material);
        if (!hidden) {
          hidden = {visible: material.visible, owners: new Set()};
          this.textMaterials.set(material, hidden);
        }
        hidden.owners.add(record);
        record.materials.add(material);
        material.visible = false;
      });
    });
  }

  sync(roomId, camera) {
    const retained = new Set();
    this.document.getObjects(roomId).forEach(object => {
      const data = object.userData || {};
      if (data.editorHelper || data.editorRuntimeHelper || data.editorVisualOwnerId || !visibleInTree(object)) return;
      // These settings already passed the document/schema boundary. Reading them
      // directly avoids re-normalizing every native object on each editor frame.
      const behaviors = data.editorBehaviors || data.editorDefaultBehaviors || [];
      const info = behaviors.find(config => config.type === 'info' && config.enabled !== false);
      const nativeInfo = (data.editorNativeBehaviorTypes || []).includes('info');
      if (!info && !nativeInfo) return;
      retained.add(object);
      let record = this.panels.get(object);
      if (!record) {
        record = {materials: new Set(), component: null, signature: null};
        this.panels.set(object, record);
      }
      // An explicitly disabled/removed native info component must not reveal
      // its stale SDF text while the ECS system is paused in the editor.
      this.hideGeneratedText(object, record);
      const visual = this.document.visuals && this.document.visuals.get(data.editorId);
      const signature = info ? JSON.stringify([info.title, info.text, info.fontSize, info.color,
        visual && visual.content && visual.content.uuid]) : null;
      if (record.signature === signature && Boolean(record.component) === Boolean(info)) return;
      if (record.component) { record.component.dispose(); record.component = null; }
      record.signature = signature;
      if (!info) return;
      // Keep the preview aligned with the authored support. Its DoubleSide
      // material lets users select and edit it from either side without rotating
      // the logical object or recording a camera-dependent transform.
      record.component = canvasCard(object, info);
      const helper = record.component.card;
      helper.userData.editorInfoPreview = true;
      helper.userData.editorVisualOwnerId = data.editorId;
    });
    this.panels.forEach((record, object) => {
      if (!retained.has(object)) { this.release(object, record); this.panels.delete(object); }
    });
  }

  release(object, record) {
    if (record.component) record.component.dispose();
    record.materials.forEach(material => {
      const hidden = this.textMaterials.get(material);
      if (!hidden) return;
      hidden.owners.delete(record);
      material.visible = hidden.owners.size ? false : hidden.visible;
      if (!hidden.owners.size) this.textMaterials.delete(material);
    });
  }

  dispose() {
    this.panels.forEach((record, object) => this.release(object, record));
    this.panels.clear();
  }
}
