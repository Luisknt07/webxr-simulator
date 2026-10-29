import * as THREE from 'three';
import {createHost, createLocalCatalog} from '../../packages/core/index.js';
import {createBrowserHost} from '../../packages/render-three/BrowserHost.js';
import SelectedSceneDocument from './SelectedSceneDocument.js';
import {demoModule, DEMO_MODULE_ID, DEMO_FUNCTION_ID} from './DemoRuntime.js';

const byId = id => document.getElementById(id);
const configuration = window.SMARTTWIN_PUBLIC_VIEWER_CONFIG || {};
const SCENE_URL = configuration.sceneURL || 'projects/smarttwin/scenes/vr-robot-dispatch.json';
const VIEWER_WORLD_ID = 'public-vr-robot-dispatch';

function accountURL() {
  const configured = configuration.workspaceURL || (configuration.apiOrigin ? new URL('login?next=%2Fworkspace', configuration.apiOrigin.replace(/\/?$/, '/')).href : '');
  if (!configured) return null;
  const url = new URL(configured, document.baseURI);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:') || url.username || url.password) throw new Error('La dirección de acceso debe ser HTTPS y no incluir credenciales.');
  return url.href;
}

function notice(message) {
  const element = byId('viewer-notice'); element.textContent = message || ''; element.classList.toggle('visible', !!message);
  clearTimeout(notice.timer); if (message) notice.timer = setTimeout(() => element.classList.remove('visible'), 6500);
}

function environment(scene, documentModel) {
  const config = (documentModel.studio.environments || []).find(value => value.roomId === 'hall') || {};
  scene.background = new THREE.Color(config.skyColor || '#30444c'); scene.fog = new THREE.Fog(scene.background, 32, 65);
  const hemisphere = new THREE.HemisphereLight(0xe4f1ff, 0x66705d, .85), ambient = new THREE.AmbientLight(0xffffff, .28);
  const sun = new THREE.DirectionalLight(config.sunColor || '#fff4df', 1.15); sun.position.set(7, 9, 5); sun.target.position.set(2, 0, 0);
  sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = -13; sun.shadow.camera.right = 13;
  sun.shadow.camera.top = 13; sun.shadow.camera.bottom = -13; sun.shadow.camera.near = .5; sun.shadow.camera.far = 32; sun.shadow.bias = -.0003;
  scene.add(hemisphere, ambient, sun, sun.target);
  documentModel.additions.forEach(entry => entry.object.traverse(node => {
    if (!node.isMesh) return; node.receiveShadow = true; node.castShadow = !!entry.descriptor.prefab && !node.userData.editorRuntimeHelper;
  }));
  return {sun, dispose() {scene.remove(hemisphere, ambient, sun, sun.target); if (sun.shadow.map) sun.shadow.map.dispose();}};
}

function pose(ctx, mode) {
  if (!ctx.demo || ctx.demo.driving.id && !ctx.demo.driving.unmount()) return false;
  ctx.input.reset(); ctx.cameraRig.position.set(0, 0, 0); ctx.cameraRig.quaternion.set(0, 0, 0, 1);
  if (ctx.vrMode) {
    // Only the rig changes in XR. The native headset pose remains untouched.
    ctx.cameraRig.position.set(4, ctx.xrReferenceSpaceType === 'local' ? 1.65 : 0, 8);
  } else if (mode === 'overview') {
    ctx.camera.position.set(10, 4.5, 9); ctx.camera.lookAt(2, 1, .5);
  } else {ctx.camera.position.set(4, 1.65, 8); ctx.camera.lookAt(2, 1.2, 0);}
  ctx.cameraRig.updateWorldMatrix(true, true); return true;
}

async function start() {
  const workspaceURL = accountURL();
  byId('workspace-link').href = workspaceURL || '#workspace-access';
  let ctx;
  const browser = createBrowserHost({container: byId('viewer'), shadows: true, notify: notice,
    inputBlocked: () => !!ctx.publicDialogOpen,
    input: {canWalk: () => !ctx.drivingVehicle && !ctx.publicDialogOpen, canInteract: () => !!ctx.demo && !ctx.demo.paused && !ctx.publicDialogOpen,
      onReset: () => {if (ctx && ctx.demo) ctx.demo.driving.resetInput();}, time: () => ctx.demo ? ctx.demo.simulation.time : 0},
    onContextLost: () => notice('Se ha interrumpido la imagen. Esperando la recuperación del navegador…'), onContextRestored: () => notice('Imagen recuperada.')});
  ctx = browser.context; ctx.room = 0; ctx.roomId = 'hall';
  const {renderer, scene, camera, cameraRig, graphics, input} = ctx;
  let host, documentModel, lighting, stopped = false, uiElapsed = 0, overview = true;
  const abort = new AbortController(), listeners = [];
  const listen = (target, name, handler, options) => {target.addEventListener(name, handler, options); listeners.push(() => target.removeEventListener(name, handler, options));};
  let accessDialog;
  if (!workspaceURL) {
    accessDialog = document.createElement('dialog'); accessDialog.className = 'viewer-access-dialog'; accessDialog.id = 'workspace-access'; accessDialog.setAttribute('aria-labelledby', 'workspace-access-title');
    const title = document.createElement('h2'); title.id = 'workspace-access-title'; title.textContent = 'Tu espacio de trabajo privado';
    const text = document.createElement('p'); text.textContent = 'La demostración está abierta a todos. Para crear y guardar tus propios proyectos, abre el espacio privado desde el servidor de tu organización. Solicita la dirección de acceso a su administrador.';
    const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Seguir explorando';
    accessDialog.append(title, text, close); document.body.appendChild(accessDialog);
    listen(byId('workspace-link'), 'click', event => {event.preventDefault(); input.reset(); ctx.publicDialogOpen = true; if (accessDialog.showModal) accessDialog.showModal(); else accessDialog.setAttribute('open', '');});
    const releaseDialog = () => {ctx.publicDialogOpen = false; input.reset();};
    listen(accessDialog, 'close', releaseDialog); listen(accessDialog, 'cancel', releaseDialog);
    listen(close, 'click', () => {if (accessDialog.close) accessDialog.close(); else accessDialog.removeAttribute('open'); releaseDialog();});
  }
  browser.onDispose(async () => {stopped = true; abort.abort(); listeners.splice(0).forEach(off => off()); clearTimeout(notice.timer);
    if (host) await host.dispose(); if (lighting) lighting.dispose(); if (documentModel) documentModel.dispose(); if (accessDialog) accessDialog.remove();});
  const dispose = () => browser.dispose();
  try {
    const response = await fetch(new URL(SCENE_URL, document.baseURI).href, {signal: abort.signal, credentials: 'omit'});
    if (!response.ok) throw new Error('No se pudo cargar la demostración (' + response.status + ').');
    const snapshot = await response.json(); if (stopped) return;
    // The public app is deliberately a single curated example, not an arbitrary
    // project loader or a URL-selectable project gallery.
    if (!snapshot.project || snapshot.project.id !== VIEWER_WORLD_ID) throw new Error('Este archivo no es la demostración pública autorizada.');
    documentModel = new SelectedSceneDocument(snapshot, scene); lighting = environment(scene, documentModel);
    host = createHost({catalog: createLocalCatalog([demoModule]), worldId: VIEWER_WORLD_ID,
      grants: ['platform.scene', 'platform.document'], ports: {'platform.scene': ctx, 'platform.document': documentModel}});
    await host.activate(DEMO_MODULE_ID, {functions: [DEMO_FUNCTION_ID]});
    if (stopped) return;
    pose(ctx, 'overview');
    browser.mountXR(byId('xr-action'), {className: 'viewer-xr-button', spawn: [4, 0, 8],
      beforeChange: () => ctx.demo.driving.unmount(true),
      afterChange: active => {if (active) pose(ctx, 'walk'); document.body.classList.toggle('immersive', active);}});
    listen(byId('overview'), 'click', () => {overview = !overview; if (pose(ctx, overview ? 'overview' : 'walk')) byId('overview').textContent = overview ? 'Caminar' : 'Vista general';});
    byId('overview').textContent = 'Caminar';
    listen(byId('drive'), 'click', () => {
      if (ctx.demo.paused) ctx.demo.setPaused(false);
      const driving = ctx.demo.driving, vehicle = ctx.demo.stats().vehicle;
      if (driving.id) driving.unmount(); else if (vehicle) driving.mount(vehicle.id);
      input.reset();
    });
    listen(byId('pause'), 'click', () => {ctx.demo.setPaused(!ctx.demo.paused); input.reset();});
    listen(byId('restart'), 'click', () => {input.reset(); ctx.demo.restart(); pose(ctx, overview ? 'overview' : 'walk'); notice('Demostración reiniciada.');});
    function updateUI() {
      const stats = ctx.demo.stats(), driving = !!ctx.demo.driving.id;
      document.body.classList.toggle('driving', driving); byId('drive').textContent = driving ? 'Bajar del vehículo' : 'Conducir';
      byId('pause').textContent = stats.paused ? 'Continuar' : 'Pausar'; byId('pause').setAttribute('aria-pressed', String(stats.paused));
      const stage = stats.vehicle && (stats.vehicle.carrying || stats.vehicle.delivered) ? 'vehicle' : stats.belt && stats.belt.packages ? 'belt' : 'robot';
      document.querySelectorAll('[data-stage]').forEach(element => element.classList.toggle('active', element.dataset.stage === stage));
      byId('demo-progress').textContent = stats.paused ? 'Simulación en pausa · puedes seguir explorando.' : stats.vehicle && stats.vehicle.delivered >= 2 ? 'Práctica completada · 2 pallets entregados.' : stats.belt && stats.belt.packages ? 'Pallet listo en la banda · alinea las horquillas y recoge la carga.' : stats.robot && stats.robot.completed ? 'Primer ciclo robótico completado · continúa con el montacargas.' : 'El robot prepara la primera carga · observa el proceso.';
      byId('reticle').classList.toggle('hovering', !!ctx.desktopControllerData.currentIntersection);
    }
    browser.setFrameHandler({
      before({delta}) {if (!ctx.publicDialogOpen) host.step(delta); ctx.demo.driving.docking.renderBefore(scene, delta);},
      after({delta}) {ctx.demo.driving.docking.postRender(); uiElapsed += delta; if (uiElapsed > .2) {uiElapsed = 0; updateUI();}}
    });
    browser.start(); updateUI(); byId('loading').hidden = true; document.body.classList.add('ready');
    window.smartTwinViewer = Object.freeze({
      getStats: () => ({app: 'public-viewer', sceneId: 'vr-robot-dispatch', frameCount: browser.stats().frames, primaryRenders: browser.stats().primaryRenders, contextLost: browser.stats().contextLost,
        render: {...renderer.info.render}, memory: {...renderer.info.memory}, graphics: graphics.getStats(), simulation: ctx.demo.stats(),
        activeFunctions: [DEMO_FUNCTION_ID], requestsAPI: false, immersive: ctx.vrMode}),
      dispose,
      // Explicit QA facade: no editor or networking object is constructed.
      context: ctx, host, document: documentModel, THREE
    });
  } catch (error) {await dispose(); throw error;}
}

function fail(error) {
  byId('loading').hidden = false; byId('loading').classList.add('failed'); byId('loading-title').textContent = 'No se pudo iniciar la demostración';
  byId('loading-detail').textContent = error && error.message || 'Comprueba la conexión y vuelve a intentar.'; byId('retry').hidden = false;
  console.error('Public viewer:', error);
}
byId('retry').addEventListener('click', () => window.location.reload());
start().catch(fail);
