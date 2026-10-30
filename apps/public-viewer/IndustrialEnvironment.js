import * as THREE from 'three';
import industrialLighting from '../../packages/render-three/schema/industrial-lighting.js';
import industrialSurfaces from '../../packages/render-three/schema/industrial-surfaces.js';

const bound = (value, fallback, low, high) => Number.isFinite(value) ? Math.max(low, Math.min(high, value)) : fallback;
const SHELL = /\b(?:CEDI|RV)\b.*(?:cubierta|muro|pared|piso|suelo|ventana|franja|cerramiento|luminaria|techo)/i;
const shell = object => {for (let node = object; node; node = node.parent) if ((node.userData || {}).editorIndustrialShell || SHELL.test(node.name || '')) return true; return false;};

/** Interior illumination for the bounded public lesson. The authoring adapter
 * is intentionally absent: use only the validated surface/light data already
 * in the selected snapshot, and restore all derived state during cleanup. */
export default function createIndustrialEnvironment(scene, documentModel, ctx = {}) {
  const authoredConfig = (documentModel.studio.environments || []).find(value => value.roomId === documentModel.roomId) || {};
  const config = industrialLighting.profile(authoredConfig, industrialLighting.isIndustrialInterior(documentModel, documentModel.roomId));
  const renderer = ctx.renderer, previous = {background: scene.background, fog: scene.fog,
    environment: scene.environment, exposure: renderer && renderer.toneMappingExposure, shadows: renderer && renderer.shadowMap && renderer.shadowMap.enabled};
  const background = new THREE.Color(config.skyColor || '#26363d');
  scene.background = background; scene.fog = new THREE.Fog(background, 40, 80);
  if (renderer) {
    renderer.toneMappingExposure = bound(config.exposure, .87, .4, 2);
    if (renderer.shadowMap) renderer.shadowMap.enabled = config.shadows !== false;
  }
  const fill = new THREE.HemisphereLight(config.horizonColor || '#c5ced2', config.groundColor || '#525c59', bound(config.ambientIntensity, .25, 0, 2));
  const sun = new THREE.DirectionalLight(config.sunColor || '#fff1df', bound(config.sunIntensity, .6, 0, 2));
  sun.position.set(7, 8, 5); sun.target.position.set(2, 0, 0); sun.castShadow = config.shadows !== false;
  sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = sun.shadow.camera.bottom = -13; sun.shadow.camera.right = sun.shadow.camera.top = 13;
  sun.shadow.camera.near = .5; sun.shadow.camera.far = 32; sun.shadow.bias = -.0002; sun.shadow.radius = 2;
  const lights = [fill, sun, sun.target], surfaces = [], shadows = [], markerMaterials = new Map(), points = [];
  const stats = {pointLights: 0, primaryLights: 2, shadowMaps: sun.castShadow ? 1 : 0, shadowMapSize: 1024,
    profile: config.indoorLightingProfile || 'authored', exposure: renderer && renderer.toneMappingExposure, ambientIntensity: fill.intensity,
    reflectionBuilds: 0, reflectionReady: !!previous.environment};
  let disposed = false, reflections = null, lost = false, reflectionAttempted = false;
  const surfaceDetail = new industrialSurfaces.Detail(THREE); stats.surfaceDetail = surfaceDetail.stats;
  const releaseReflections = () => {
    if (!reflections) return;
    if (ctx.performanceRenderTargets) ctx.performanceRenderTargets.delete(reflections.texture);
    if (scene.environment === reflections.texture) scene.environment = previous.environment;
    reflections.dispose(); reflections = null; stats.reflectionReady = !!previous.environment;
  };
  const syncReflections = () => {
    if (lost || previous.environment || reflections || reflectionAttempted || !renderer || !renderer.capabilities || !renderer.getContext || !THREE.PMREMGenerator) return;
    reflectionAttempted = true;
    const proxy = industrialLighting.reflectionRoom(THREE, !!config.industrialInterior), generator = new THREE.PMREMGenerator(renderer);
    const saved = {target: renderer.getRenderTarget(), xr: renderer.xr && renderer.xr.enabled,
      viewport: renderer.getViewport(new THREE.Vector4()), scissor: renderer.getScissor(new THREE.Vector4()), scissorTest: renderer.getScissorTest()};
    try {
      if (renderer.xr) renderer.xr.enabled = false;
      reflections = generator.fromScene(proxy.scene, .035, .1, 60); scene.environment = reflections.texture;
      if (ctx.performanceRenderTargets) ctx.performanceRenderTargets.add(reflections.texture);
      stats.reflectionBuilds++; stats.reflectionReady = true;
    } finally {
      renderer.setRenderTarget(saved.target); renderer.setViewport(saved.viewport); renderer.setScissor(saved.scissor); renderer.setScissorTest(saved.scissorTest);
      if (renderer.xr) renderer.xr.enabled = saved.xr;
      generator.dispose(); proxy.dispose();
    }
  };
  lights.forEach(object => {object.userData.editorRuntimeHelper = true; scene.add(object);});
  documentModel.additions.forEach(entry => {
    const descriptor = entry.descriptor || {}, primitive = ['box', 'plane', 'cylinder', 'sphere'].includes(descriptor.type) && !descriptor.prefab;
    const settings = primitive && documentModel.getBehaviors(entry.object).find(value => value.type === 'surfaceMaterial' && value.enabled !== false);
    entry.object.traverse(node => {
      if (!node.isMesh) return;
      shadows.push({node, cast: node.castShadow, receive: node.receiveShadow}); node.receiveShadow = true;
      // Roof/wall self-shadows made the previous compact room appear to have
      // overlapping triangular textures. The key represents light inside the
      // building; its shell receives shadows but must not block that key.
      node.castShadow = !!descriptor.prefab && !shell(node) && !node.userData.editorRuntimeHelper;
      if (!primitive) return;
      (Array.isArray(node.material) ? node.material : [node.material]).filter(Boolean).forEach(material => {
        if (!material.color || material.userData.studioColorSpace === 'linear') return;
        const saved = {material, color: material.color.clone(), roughness: material.roughness, metalness: material.metalness,
          emissive: material.emissive && material.emissive.clone(), emissiveIntensity: material.emissiveIntensity, map: material.map, colorSpace: material.userData.studioColorSpace};
        surfaces.push(saved);
        if (settings && settings.color) material.color.set(settings.color);
        material.color.convertSRGBToLinear(); material.userData.studioColorSpace = 'linear';
        material.roughness = settings ? settings.roughness : .94; material.metalness = settings ? settings.metalness : 0;
        if (settings && settings.emissiveMode === 'custom' && material.emissive) {material.emissive.set(settings.emissive).convertSRGBToLinear(); material.emissiveIntensity = settings.emissiveIntensity;}
        material.needsUpdate = true;
      });
    });
  });
  const limits = ctx.graphics && ctx.graphics.getLimits ? ctx.graphics.getLimits() : null;
  const pointBudget = Math.min(4, limits && Number.isFinite(limits.pointLights) ? Math.max(0, limits.pointLights) : 4); let pointLights = 0;
  (documentModel.studio.entities || []).forEach(entity => {
    if (entity.roomId !== documentModel.roomId || entity.type !== 'pointLight' || pointLights >= pointBudget || !(entity.intensity > 0)) return;
    const owner = documentModel.getObject(entity.objectId); if (!owner) return;
    for (let node = owner; node; node = node.parent) if (!node.visible) return;
    const light = new THREE.PointLight(entity.color, bound(entity.intensity, 0, 0, 2), bound(entity.range, 12, .1, 70)); owner.updateWorldMatrix(true, false); owner.getWorldPosition(light.position);
    light.castShadow = false; light.userData.editorRuntimeHelper = true; lights.push(light); points.push(light); scene.add(light); pointLights++;
    owner.traverse(node => (Array.isArray(node.material) ? node.material : [node.material]).filter(Boolean).forEach(material => {if (!markerMaterials.has(material)) markerMaterials.set(material, material.visible); material.visible = false;}));
  });
  const releaseShadow = () => {if (sun.shadow.map) {sun.shadow.map.dispose(); sun.shadow.map = null;}};
  const sync = () => {
    if (disposed || lost) return;
    syncReflections();
    surfaceDetail.sync(documentModel, documentModel.roomId, !!config.industrialInterior, 0);
    const current = ctx.graphics && ctx.graphics.getLimits ? ctx.graphics.getLimits() : null, xr = !!(ctx.vrMode || renderer && renderer.xr && renderer.xr.isPresenting);
    const limit = current && current[xr ? 'xrShadowMapSize' : 'shadowMapSize'], size = Math.min(1024, Number.isFinite(limit) && limit > 0 ? limit : 1024);
    if (sun.shadow.mapSize.x !== size) {releaseShadow(); sun.shadow.mapSize.set(size, size);}
    const lightLimit = current && Number.isFinite(current.pointLights) ? Math.max(0, current.pointLights) : 4;
    points.forEach((light, index) => {light.visible = index < lightLimit;}); stats.pointLights = points.filter(light => light.visible).length; stats.shadowMapSize = sun.castShadow ? size : 0;
  };
  const canvas = renderer && renderer.domElement, loseContext = () => {lost = true; releaseShadow(); releaseReflections();},
    restoreContext = () => {lost = false; reflectionAttempted = false; if (renderer && renderer.shadowMap) renderer.shadowMap.needsUpdate = true;};
  if (canvas && canvas.addEventListener) {canvas.addEventListener('webglcontextlost', loseContext); canvas.addEventListener('webglcontextrestored', restoreContext);}
  sync();
  return {sun, stats, sync, dispose() {
    if (disposed) return; disposed = true;
    surfaceDetail.dispose();
    if (canvas && canvas.removeEventListener) {canvas.removeEventListener('webglcontextlost', loseContext); canvas.removeEventListener('webglcontextrestored', restoreContext);}
    lights.forEach(light => scene.remove(light)); releaseShadow(); releaseReflections();
    shadows.forEach(saved => {saved.node.castShadow = saved.cast; saved.node.receiveShadow = saved.receive;});
    markerMaterials.forEach((visible, material) => {material.visible = visible;});
    surfaces.forEach(saved => {const material = saved.material; material.color.copy(saved.color); material.roughness = saved.roughness; material.metalness = saved.metalness;
      if (material.emissive && saved.emissive) material.emissive.copy(saved.emissive); material.emissiveIntensity = saved.emissiveIntensity; material.map = saved.map;
      if (saved.colorSpace === undefined) delete material.userData.studioColorSpace; else material.userData.studioColorSpace = saved.colorSpace; material.needsUpdate = true;});
    scene.background = previous.background; scene.fog = previous.fog; scene.environment = previous.environment;
    if (renderer) {renderer.toneMappingExposure = previous.exposure; if (renderer.shadowMap) renderer.shadowMap.enabled = previous.shadows;}
  }};
}
