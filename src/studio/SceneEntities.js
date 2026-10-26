import * as THREE from 'three';
import SceneEnvironment from './SceneEnvironment.js';

const WIDTH = 320, HEIGHT = 180;
function visible(object) { for (let node = object; node; node = node.parent) if (!node.visible) return false; return true; }

/** Additional authored lights/cameras use real Three objects, with their records
 * separate from the visible marker so scaling a marker never scales a camera. */
export default class SceneEntities {
  constructor(editor) {
    this.editor = editor; this.live = new Map(); this.preview = null; this.elapsed = 0; this.environment = new SceneEnvironment(editor);
    this.qualityLights = new Set(); this.lightBudgetKey = null; this.lightBudgetPosition = new THREE.Vector3(); this.lightBudgetEye = new THREE.Vector3();
    this.stats = {pointLights: 0, pointLightBudget: null};
  }

  remove(id) {
    const entry = this.live.get(id); if (!entry) return;
    if (entry.object.parent) entry.object.parent.remove(entry.object);
    entry.markers.forEach((original, material) => { material.visible = original; });
    this.live.delete(id);
  }

  sync() {
    this.environment.sync();
    const editor = this.editor, source = (editor.document.studio && editor.document.studio.entities || []).filter(item => item.roomId === editor.roomId);
    const active = new Set();
    source.forEach(config => {
      const owner = editor.document.getObject(config.objectId); if (!owner || owner.userData.editorRoom !== editor.roomId) return;
      active.add(config.id);
      let entry = this.live.get(config.id);
      if (entry && (entry.owner !== owner || entry.config.type !== config.type)) { this.remove(config.id); entry = null; }
      if (!entry) {
        const object = config.type === 'pointLight' ? new THREE.PointLight(config.color, config.intensity, config.range) : new THREE.PerspectiveCamera(config.fov, WIDTH / HEIGHT, 0.05, 2000);
        object.name = 'Studio ' + config.type + ' ' + config.id; object.userData.editorRuntimeHelper = true;
        const markers = new Map(); owner.traverse(child => {
          if (!child.material || child.userData.editorRuntimeHelper) return;
          (Array.isArray(child.material) ? child.material : [child.material]).forEach(material => { if (material && !markers.has(material)) markers.set(material, material.visible); });
        });
        entry = {config, owner, object, markers}; this.live.set(config.id, entry); editor.hooks.renderScene.add(object);
      }
      entry.config = config; owner.updateWorldMatrix(true, false);
      owner.getWorldPosition(entry.object.position); owner.getWorldQuaternion(entry.object.quaternion);
      entry.object.visible = visible(owner); entry.object.scale.set(1, 1, 1); entry.object.updateMatrixWorld(true);
      const currentMaterials = new Set(); owner.traverse(child => {
        if (child.material && !child.userData.editorRuntimeHelper) (Array.isArray(child.material) ? child.material : [child.material]).forEach(material => { if (material) currentMaterials.add(material); });
      });
      const originalVisible = Array.from(entry.markers.values()).some(Boolean);
      entry.markers.forEach((original, material) => { if (!currentMaterials.has(material)) { material.visible = original; entry.markers.delete(material); } });
      currentMaterials.forEach(material => { if (!entry.markers.has(material)) entry.markers.set(material, material.visible || originalVisible); });
      // Using an authored camera places the editor inside its small marker.
      // Hide only that marker's materials while the viewpoints coincide;
      // changing the actor's visibility would also disable the saved camera.
      const ownView = config.type === 'camera' && editor.active && editor.camera &&
        editor.camera.getWorldPosition(new THREE.Vector3()).distanceTo(entry.object.position) < .5;
      entry.markers.forEach((original, material) => { material.visible = editor.active && original && !ownView; });
      if (config.type === 'pointLight') {
        entry.object.color.set(config.color); entry.object.intensity = config.intensity; entry.object.distance = config.range;
        entry.object.castShadow = false;
      } else if (entry.object.fov !== config.fov) { entry.object.fov = config.fov; entry.object.updateProjectionMatrix(); }
    });
    Array.from(this.live.keys()).forEach(id => { if (!active.has(id)) this.remove(id); });
    this.applyLightBudget();
  }

  applyLightBudget() {
    const editor = this.editor, graphics = editor.ctx && editor.ctx.graphics, limits = graphics && graphics.getLimits && graphics.getLimits();
    const candidates = Array.from(this.live.values()).filter(entry => {
      if (entry.config.type !== 'pointLight' || !entry.object.visible) return false;
      if (limits && entry.config.intensity <= 0) { entry.object.visible = false; return false; }
      return true;
    });
    const budget = limits && Number.isFinite(limits.pointLights) ? Math.max(0, Math.floor(limits.pointLights)) : candidates.length;
    this.stats.pointLightBudget = budget;
    if (candidates.length > budget) {
      let camera = editor.active && editor.camera || editor.ctx && editor.ctx.camera;
      if (camera && editor.ctx.vrMode && editor.ctx.renderer && editor.ctx.renderer.xr && editor.ctx.renderer.xr.getCamera) {
        camera = editor.ctx.renderer.xr.getCamera(camera) || camera; this.lightBudgetEye.setFromMatrixPosition(camera.matrixWorld);
      } else if (camera) camera.getWorldPosition(this.lightBudgetEye);
      else this.lightBudgetEye.set(0, 0, 0);
      const key = editor.roomId + ':' + budget + ':' + candidates.map(entry => entry.config.id + ':' + entry.config.intensity + ':' + entry.object.position.toArray().join(',')).join('|');
      // Keep nearby lighting stable while walking; rerank only after meaningful
      // camera movement or a real inventory/quality/configuration change.
      if (key !== this.lightBudgetKey || this.lightBudgetEye.distanceToSquared(this.lightBudgetPosition) > 2.25) {
        this.lightBudgetKey = key; this.lightBudgetPosition.copy(this.lightBudgetEye);
        candidates.sort((a, b) => {
          const score = entry => entry.object.position.distanceToSquared(this.lightBudgetEye) / Math.max(.05, entry.config.intensity) * (this.qualityLights.has(entry.config.id) ? .85 : 1);
          return score(a) - score(b);
        });
        this.qualityLights = new Set(candidates.slice(0, budget).map(entry => entry.config.id));
      }
      candidates.forEach(entry => { entry.object.visible = this.qualityLights.has(entry.config.id); });
    } else { this.lightBudgetKey = null; this.qualityLights = new Set(candidates.map(entry => entry.config.id)); }
    this.stats.pointLights = candidates.filter(entry => entry.object.visible).length;
    this.environment.stats.pointLights = this.stats.pointLights; this.environment.stats.pointLightBudget = budget;
  }

  useCamera(id) {
    this.sync(); const entry = this.live.get(id);
    if (!entry || entry.config.type !== 'camera') throw new Error('Selecciona una cámara disponible.');
    if (!this.editor.active) throw new Error('Esta vista de cámara se utiliza desde el editor.');
    const camera = this.editor.camera;
    camera.position.copy(entry.object.position); camera.quaternion.copy(entry.object.quaternion);
    camera.fov = entry.config.fov; camera.updateProjectionMatrix();
    this.editor.orbit.target.copy(camera.position).addScaledVector(camera.getWorldDirection(new THREE.Vector3()), 3);
    this.editor.orbit.update();
    if (this.editor.constrainEditorCamera) this.editor.constrainEditorCamera(false);
    this.sync();
  }

  showPreview(id, container) {
    this.stopPreview(); this.sync();
    const entry = this.live.get(id); if (!entry || entry.config.type !== 'camera') throw new Error('La cámara no está disponible en esta sala.');
    const canvas = document.createElement('canvas'); canvas.width = WIDTH; canvas.height = HEIGHT;
    canvas.className = 'studio-camera-preview'; canvas.setAttribute('aria-label', 'Vista previa de cámara, actualizada hasta ocho veces por segundo'); container.appendChild(canvas);
    const status = document.createElement('p'); status.className = 'ed-hint'; status.textContent = 'Vista 3D · 320 × 180 · hasta 8 FPS'; container.appendChild(status);
    this.preview = {id, canvas, status, pixels: new Uint8Array(WIDTH * HEIGHT * 4), image: null}; this.elapsed = 1;
    container.addEventListener('studio-workspace-close', () => this.stopPreview(), {once: true});
  }

  stopPreview() {
    if (this.preview) {
      [this.preview.canvas, this.preview.status].forEach(node => { if (node.parentNode) node.parentNode.removeChild(node); });
    }
    this.preview = null;
    if (this.target) { this.target.dispose(); this.target = null; }
  }

  tick(delta = 0) {
    this.sync();
    const editor = this.editor;
    if (!this.preview) return;
    if (!editor.active || editor.ctx.vrMode || !editor.shell || editor.shell.workspace !== 'cameras' || editor.shell.workarea && editor.shell.workarea.hidden) { this.stopPreview(); return; }
    this.elapsed += Number.isFinite(delta) && delta > 0 ? delta : 0;
    if (this.elapsed < 0.125) return; this.elapsed = 0;
    const renderer = editor.ctx.renderer, entry = this.live.get(this.preview.id);
    if (!entry || !renderer.readRenderTargetPixels) { this.preview.status.textContent = 'La vista previa requiere el renderizador WebGL activo.'; return; }
    if (!this.target) this.target = new THREE.WebGLRenderTarget(WIDTH, HEIGHT, {minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true});
    const previous = {
      target: renderer.getRenderTarget(), viewport: renderer.getViewport(new THREE.Vector4()),
      scissor: renderer.getScissor(new THREE.Vector4()), scissorTest: renderer.getScissorTest(),
      xr: renderer.xr && renderer.xr.enabled, autoReset: renderer.info && renderer.info.autoReset
    };
    const helpers = [editor.transform, editor.grid, editor.box, editor.assembly && editor.assembly.helperGroup, editor.objectAssembly && editor.objectAssembly.helperGroup]
      .filter(object => object && object.isObject3D).map(object => [object, object.visible]);
    const markerVisibility = new Map(); this.live.forEach(value => value.markers.forEach((_, material) => markerVisibility.set(material, material.visible)));
    try {
      helpers.forEach(([object]) => { object.visible = false; }); markerVisibility.forEach((_, material) => { material.visible = false; });
      if (renderer.xr) renderer.xr.enabled = false;
      if (renderer.info) renderer.info.autoReset = false;
      renderer.setRenderTarget(this.target); renderer.setViewport(0, 0, WIDTH, HEIGHT); renderer.setScissorTest(false);
      renderer.render(editor.hooks.renderScene, entry.object);
      renderer.readRenderTargetPixels(this.target, 0, 0, WIDTH, HEIGHT, this.preview.pixels);
      const context = this.preview.canvas.getContext('2d');
      if (!this.preview.image) this.preview.image = context.createImageData(WIDTH, HEIGHT);
      for (let row = 0; row < HEIGHT; row++) this.preview.image.data.set(this.preview.pixels.subarray(row * WIDTH * 4, (row + 1) * WIDTH * 4), (HEIGHT - row - 1) * WIDTH * 4);
      context.putImageData(this.preview.image, 0, 0);
    } catch (error) { this.preview.status.textContent = 'No se pudo actualizar la cámara: ' + error.message; }
    finally {
      renderer.setRenderTarget(previous.target); renderer.setViewport(previous.viewport); renderer.setScissor(previous.scissor); renderer.setScissorTest(previous.scissorTest);
      if (renderer.xr) renderer.xr.enabled = previous.xr;
      if (renderer.info) renderer.info.autoReset = previous.autoReset;
      helpers.forEach(([object, wasVisible]) => { object.visible = wasVisible; }); markerVisibility.forEach((wasVisible, material) => { material.visible = wasVisible; });
    }
  }

  dispose() { this.stopPreview(); Array.from(this.live.keys()).forEach(id => this.remove(id)); this.environment.dispose(); }
}
