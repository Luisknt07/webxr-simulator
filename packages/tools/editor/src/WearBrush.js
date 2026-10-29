import * as THREE from 'three';
import wearSchema from '../../../render-three/schema/wear.js';

const MAX_STROKE_STAMPS = 128;
const NO_RAYCAST = () => {};
let sequence = 0;
function within(object, owner) { for (let node = object; node; node = node.parent) if (node === owner) return true; return false; }
function rounded(values) { return values.map(value => Math.round(value * 1e8) / 1e8); }
function protectedSurface(object) {
  for (let node = object; node; node = node.parent) {
    const data = node.userData || {};
    if (data.industrialDisplay || data.industrialButton || data.industrialSensorLamp || data.industrialTower || data.industrialSensorVolume) return true;
  }
  return /r[oó]tulo|etiqueta|leyenda|pantalla|baliza|piloto|c[oó]digo/i.test(object.name);
}

/** Pointer authoring only. Preview is disposable; pointer-up commits one undo. */
export default class WearBrush {
  constructor(editor) { this.editor = editor; this.stroke = null; this.ring = null; this.owner = null; }

  start(owner) {
    const editor = this.editor;
    if (!editor.active || editor.loadingProject || !owner || editor.document.getObject(owner.userData.editorId) !== owner) return;
    try {
      const settings = editor.wearBrushSettings;
      wearSchema.normalizeLayers([Object.assign({}, settings, {width: settings.size, height: settings.size, stamps: []})]);
    } catch (error) { editor.toast(error.message); return; }
    editor.cancelDecalPlacement(); editor.clearNavigation();
    this.owner = owner; editor.wearBrush = this;
    editor.transform.enabled = false; editor.transform.detach(); editor.transform.visible = false;
    editor.viewport.classList.add('ed-placing-decal');
    editor.decalPlacementLabel.textContent = 'BROCHA · Arrastra sobre ' + (owner.name || 'esta pieza') + ' · Suelta para aplicar · Esc para terminar';
    editor.decalPlacementBar.hidden = false;
    const points = [];
    for (let index = 0; index < 48; index++) { const angle = index / 48 * Math.PI * 2; points.push(new THREE.Vector3(Math.cos(angle) * 0.5, Math.sin(angle) * 0.5, 0)); }
    this.ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({color: '#86e7cf', transparent: true, opacity: 0.95, depthTest: true, depthWrite: false}));
    this.ring.name = 'Cursor de brocha'; this.ring.matrixAutoUpdate = false; this.ring.visible = false; this.ring.renderOrder = 20;
    Object.assign(this.ring.userData, {editorHelper: true, editorRuntimeHelper: true, editorDecal: true}); this.ring.raycast = NO_RAYCAST;
    editor.ctx.scene.add(this.ring);
  }

  stop() {
    this.cancelStroke();
    const editor = this.editor;
    if (this.ring) {
      if (this.ring.parent) this.ring.parent.remove(this.ring);
      this.ring.geometry.dispose(); this.ring.material.dispose(); this.ring = null;
    }
    this.owner = null; editor.wearBrush = null;
    if (!editor.decalPlacement) { editor.decalPlacementBar.hidden = true; editor.viewport.classList.remove('ed-placing-decal'); }
    editor.transform.enabled = editor.active && !editor.loadingProject; editor.transform.visible = true;
    if (editor.selected && editor.active) editor.transform.attach(editor.selected);
  }

  pick(event) {
    const editor = this.editor, canvas = editor.ctx.renderer.domElement, rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height || !this.owner || !within(this.owner, editor.root)) return null;
    if (event.clientX < rect.left || event.clientY < rect.top || event.clientX > rect.left + rect.width || event.clientY > rect.top + rect.height) return null;
    const pointer = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    editor.camera.updateMatrixWorld(true); editor.root.updateWorldMatrix(true, true);
    const ray = new THREE.Raycaster(); ray.setFromCamera(pointer, editor.camera);
    const hit = ray.intersectObject(editor.root, true).find(item => editor.decals.isSurface(item.object));
    // Respect the nearest real surface; never paint through a different actor
    // or through a functional screen onto the cabinet behind it.
    if (!hit || !within(hit.object, this.owner) || protectedSurface(hit.object)) return null;
    const normal = hit.face ? hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize() : ray.ray.direction.clone().negate();
    if (normal.dot(ray.ray.direction) > 0) normal.negate();
    return {point: hit.point.clone(), normal};
  }

  cursor(hit) {
    if (!this.ring) return;
    this.ring.visible = !!hit;
    if (!hit) return;
    const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), hit.normal);
    const world = new THREE.Matrix4().compose(hit.point.clone().addScaledVector(hit.normal, 0.003), rotation, new THREE.Vector3().setScalar(this.editor.wearBrushSettings.size));
    this.ring.parent.updateWorldMatrix(true, false);
    this.ring.matrix.getInverse(this.ring.parent.matrixWorld).multiply(world); this.ring.matrixWorldNeedsUpdate = true;
  }

  down(event) {
    if (!this.owner || event.button !== 0) return false;
    if (this.stroke) return true;
    const hit = this.pick(event); this.cursor(hit);
    if (!hit) { this.editor.toast('Pinta sobre una superficie visible de la pieza seleccionada.'); return true; }
    const editor = this.editor, settings = editor.wearBrushSettings;
    editor.clearNavigation();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), hit.normal);
    const base = new THREE.Matrix4().compose(hit.point.clone().addScaledVector(hit.normal, 0.001), quaternion, new THREE.Vector3(1, 1, 1));
    this.owner.updateWorldMatrix(true, false);
    const local = new THREE.Matrix4().getInverse(this.owner.matrixWorld).multiply(base);
    const layer = Object.assign({}, settings, {id: 'stroke-' + Date.now().toString(36) + '-' + (++sequence), width: settings.size, height: settings.size,
      seed: sequence % 2147483647, matrix: rounded(local.toArray()), stamps: []});
    delete layer.size;
    this.stroke = {owner: this.owner, layer, inverse: new THREE.Matrix4().getInverse(base), last: null, previewAt: 0,
      pointerId: event.pointerId, orbitEnabled: editor.orbit.enabled};
    editor.orbit.enabled = false;
    const canvas = editor.ctx.renderer.domElement;
    if (canvas.setPointerCapture && event.pointerId !== undefined) canvas.setPointerCapture(event.pointerId);
    this.append(hit, true);
    if (event.preventDefault) event.preventDefault();
    return true;
  }

  append(hit, force = false) {
    const stroke = this.stroke;
    if (!stroke) return;
    const spacing = Math.max(0.002, stroke.layer.width * 0.22);
    const distance = stroke.last ? hit.point.distanceTo(stroke.last.point) : spacing;
    if (!force && distance < spacing) return;
    const count = !stroke.last || distance > stroke.layer.width * 8 ? 1 : Math.max(1, Math.min(16, Math.floor(distance / spacing)));
    for (let index = 1; index <= count && stroke.layer.stamps.length < MAX_STROKE_STAMPS; index++) {
      const point = stroke.last && count > 1 ? stroke.last.point.clone().lerp(hit.point, index / count) : hit.point.clone();
      const normal = stroke.last && count > 1 ? stroke.last.normal.clone().lerp(hit.normal, index / count).normalize() : hit.normal;
      const orientation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      const world = new THREE.Matrix4().compose(point.addScaledVector(normal, 0.001), orientation, new THREE.Vector3(1, 1, 1));
      const matrix = new THREE.Matrix4().multiplyMatrices(stroke.inverse, world);
      const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3(); matrix.decompose(position, quaternion, scale);
      stroke.layer.stamps.push({position: rounded(position.toArray()), quaternion: rounded(quaternion.normalize().toArray()), scale: [1, 1, 1]});
    }
    stroke.last = {point: hit.point.clone(), normal: hit.normal.clone()};
    const now = Date.now();
    if (force || now - stroke.previewAt >= 50) {
      this.editor.wearPaint.setPreview(stroke.owner, stroke.layer); stroke.previewAt = now;
    }
    if (stroke.layer.stamps.length >= MAX_STROKE_STAMPS) {
      this.finish(); this.editor.toast('Trazo aplicado. Suelta el mouse y continúa con otro trazo.');
    }
  }

  move(event) {
    if (!this.owner) return false;
    if (this.stroke && this.stroke.pointerId !== undefined && this.stroke.pointerId !== event.pointerId) return true;
    const hit = this.pick(event); this.cursor(hit);
    if (this.stroke && (this.stroke.pointerId === undefined || this.stroke.pointerId === event.pointerId) && hit) this.append(hit);
    else if (this.stroke && !hit) this.stroke.last = null;
    return true;
  }

  up(event) {
    if (!this.owner || event.button !== 0) return false;
    if (this.stroke && (this.stroke.pointerId === undefined || this.stroke.pointerId === event.pointerId)) this.finish();
    return true;
  }

  releaseCapture(stroke) {
    this.editor.orbit.enabled = stroke.orbitEnabled;
    const canvas = this.editor.ctx.renderer.domElement;
    if (canvas.releasePointerCapture && stroke.pointerId !== undefined && (!canvas.hasPointerCapture || canvas.hasPointerCapture(stroke.pointerId))) canvas.releasePointerCapture(stroke.pointerId);
  }

  finish() {
    const stroke = this.stroke;
    if (!stroke) return;
    this.stroke = null; this.releaseCapture(stroke); this.editor.wearPaint.clearPreview();
    return this.editor.perform(() => {
      const editor = this.editor;
      if (!editor.active || editor.document.getObject(stroke.owner.userData.editorId) !== stroke.owner) return;
      const list = editor.document.getBehaviors(stroke.owner);
      const current = list.find(item => item.type === 'surfaceWear');
      const layers = current ? wearSchema.normalizeLayers(current.layers) : [];
      layers.push(stroke.layer);
      const config = {type: 'surfaceWear', enabled: true, layers: wearSchema.normalizeLayerJSON(layers)};
      editor.document.setBehaviors(stroke.owner, list.filter(item => item.type !== 'surfaceWear').concat(config));
    });
  }

  cancelStroke(event) {
    if (event && this.stroke && this.stroke.pointerId !== undefined && this.stroke.pointerId !== event.pointerId) return;
    if (this.stroke) { const stroke = this.stroke; this.stroke = null; this.releaseCapture(stroke); }
    this.editor.wearPaint.clearPreview();
  }
}
