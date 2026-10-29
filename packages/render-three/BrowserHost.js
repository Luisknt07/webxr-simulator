import * as THREE from 'three';
import AdaptiveGraphics from './src/AdaptiveGraphics.js';
import {VRButton} from './src/VRButton.js';
import BrowserInput from './BrowserInput.js';

/** Browser/Three adapter, independent of sectors and authoring. The application
 * supplies one before/after pair. This object owns the only animation loop,
 * primary render, XR session transition, viewport and input lifecycle. */
export function createBrowserHost(options = {}) {
  const container = options.container;
  if (!container || !container.appendChild) throw new Error('A browser host needs a canvas container.');
  const renderer = new THREE.WebGLRenderer({antialias: true, alpha: false});
  renderer.domElement.tabIndex = 0; renderer.domElement.setAttribute('aria-label', options.label || 'Escena 3D interactiva');
  renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = options.shadows === true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.xr.enabled = true;
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(options.fov || 55, 1, .08, options.far || 100), cameraRig = new THREE.Group();
  cameraRig.name = 'XR visitor rig'; cameraRig.add(camera); scene.add(cameraRig);
  const ctx = {scene, camera, cameraRig, renderer, vrMode: false, goto: null, performanceRenderTargets: new Set(), notify: options.notify || (() => {})};
  const graphics = new AdaptiveGraphics(renderer, {storage: null}); ctx.graphics = graphics;
  const input = new BrowserInput(ctx, renderer.domElement, options.input || {}); ctx.input = input;
  const listeners = [], cleanup = []; let disposed = false, started = false, lost = false, lastTime = null, frames = 0, primaryRenders = 0, workMs = 0, callbacks = {}, desktop = null, xrButton = null;
  const listen = (target, name, handler, settings) => {target.addEventListener(name, handler, settings); listeners.push(() => target.removeEventListener(name, handler, settings));};
  const resize = () => {const width = container.clientWidth || window.innerWidth, height = container.clientHeight || window.innerHeight; camera.aspect = width / height; camera.updateProjectionMatrix(); graphics.setViewport(width, height, window.devicePixelRatio || 1); renderer.setSize(width, height, false);};
  listen(window, 'resize', resize); resize();
  listen(renderer.domElement, 'webglcontextlost', event => {event.preventDefault(); lost = true; input.reset(); if (options.onContextLost) options.onContextLost();});
  listen(renderer.domElement, 'webglcontextrestored', () => {lost = false; lastTime = null; if (options.onContextRestored) options.onContextRestored();});
  function frame(time, xrFrame) {
    if (disposed) return;
    const now = Number.isFinite(time) ? time : performance.now(), delta = lastTime === null ? 0 : Math.max(0, Math.min(.1, (now - lastTime) / 1000)); lastTime = now;
    graphics.tick(delta, {hidden: document.hidden, xr: ctx.vrMode, camera, renderWorkMs: workMs});
    if (lost || document.hidden && !ctx.vrMode) return;
    const start = performance.now(), collision = ctx.collisionWorld;
    if (collision && collision.beginFrame) collision.beginFrame();
    try {
      if (!options.inputBlocked || !options.inputBlocked()) input.step(delta, xrFrame);
      if (callbacks.before) callbacks.before({delta, frame: xrFrame, ctx});
      scene.updateMatrixWorld(true); renderer.render(scene, camera); primaryRenders++; frames++;
      if (callbacks.after) callbacks.after({delta, frame: xrFrame, ctx});
    } finally {if (collision && collision.endFrame) collision.endFrame(); workMs = performance.now() - start;}
  }
  const api = {
    context: ctx,
    setFrameHandler(value = {}) {if (disposed) throw new Error('Browser host is disposed.'); callbacks = value;},
    start() {if (disposed) throw new Error('Browser host is disposed.'); if (!started) {started = true; lastTime = null; renderer.setAnimationLoop(frame);} return api;},
    onDispose(callback) {if (disposed) throw new Error('Browser host is disposed.'); cleanup.push(callback);},
    stats() {return {frames, primaryRenders, contextLost: lost, started, disposed, renderWorkMs: workMs};},
    mountXR(target, settings = {}) {
      if (disposed) throw new Error('Browser host is disposed.');
      if (xrButton || !target) return xrButton;
      xrButton = VRButton.createButton(renderer, (event, details) => {
        const active = event === 'sessionStarted';
        if (disposed) {
          // An outstanding permission request can settle after navigation.
          // Retire its session; never resurrect disposed input or app hooks.
          const session = renderer.xr.getSession();
          if (active && session) try {const end = session.end(); if (end && end.catch) end.catch(() => {});} catch (_) { /* Session already ended. */ }
          return;
        }
        if (settings.beforeChange) settings.beforeChange(active, details);
        if (active) {
          desktop = {position: camera.position.clone(), quaternion: camera.quaternion.clone(), rig: cameraRig.position.clone(), rotation: cameraRig.quaternion.clone()};
          ctx.vrMode = true; ctx.xrReferenceSpaceType = details && details.referenceSpaceType || 'local-floor';
          const spawn = settings.spawn || [0, 0, 0]; cameraRig.position.fromArray(spawn); if (ctx.xrReferenceSpaceType === 'local') cameraRig.position.y += 1.65;
          cameraRig.quaternion.set(0, 0, 0, 1); cameraRig.updateWorldMatrix(true, true);
        } else {
          ctx.vrMode = false;
          if (desktop) {camera.position.copy(desktop.position); camera.quaternion.copy(desktop.quaternion); cameraRig.position.copy(desktop.rig); cameraRig.quaternion.copy(desktop.rotation); desktop = null;}
        }
        input.xrChanged(active); lastTime = null; if (settings.afterChange) settings.afterChange(active, details);
      }, () => !disposed && !lost && (!settings.canStart || settings.canStart()) || 'Espera a que termine la carga.', {preferredFrameRate: settings.preferredFrameRate || 72});
      xrButton.removeAttribute('style'); xrButton.className = settings.className || 'xr-browser-button'; target.appendChild(xrButton); return xrButton;
    },
    async dispose() {
      if (disposed) return; disposed = true; renderer.setAnimationLoop(null); listeners.splice(0).forEach(off => off());
      const errors = [];
      const session = renderer.xr.getSession(); if (session) try {await session.end();} catch (_) { /* The device may already have ended it. */ }
      for (let index = cleanup.length - 1; index >= 0; index--) try {await cleanup[index]();} catch (error) {errors.push(error);}
      cleanup.length = 0;
      try {input.dispose();} catch (error) {errors.push(error);}
      graphics.dispose(); renderer.dispose(); renderer.domElement.remove(); if (xrButton) xrButton.remove();
      if (errors.length) throw new AggregateError(errors, 'Browser host cleanup failed.');
    }
  };
  listen(window, 'pagehide', event => {if (!event.persisted) api.dispose().catch(error => {if (options.onError) options.onError(error);});});
  return Object.freeze(api);
}
