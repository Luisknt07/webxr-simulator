import * as THREE from 'three';
import {createHost, createLocalCatalog} from '../../packages/core/index.js';
import {createBrowserHost} from '../../packages/render-three/BrowserHost.js';
import SelectedSceneDocument from './SelectedSceneDocument.js';
import {demoModule, DEMO_MODULE_ID, DEMO_FUNCTION_ID} from './DemoRuntime.js';
import {mountGallery} from './Gallery.js';
import {createWelcomeNavigation} from './WelcomeNavigation.mjs';
import createIndustrialEnvironment from './IndustrialEnvironment.js';
import {createVoiceModule} from '../../packages/voice-assistant/index.js';
import {voicePort} from '../../modules/logistica-industrial/integrations/VoiceAssistantBridge.js';

const byId = id => document.getElementById(id);
const configuration = window.SMARTTWIN_PUBLIC_VIEWER_CONFIG || {};
const SCENE_URL = configuration.sceneURL || 'projects/smarttwin/scenes/vr-robot-dispatch.json';
const VIEWER_WORLD_ID = 'public-vr-robot-dispatch';
let activeBrowser = null, gallery = null, accessDialog = null, navigation = null;

function accountURL() {
  const configured = configuration.workspaceURL || (configuration.apiOrigin ? new URL('login?next=%2Fworkspace', configuration.apiOrigin.replace(/\/?$/, '/')).href : configuration.backendAvailable === true ? new URL('/login?next=%2Fworkspace', document.baseURI).href : '');
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

function openAccess() {
  const ctx = activeBrowser && activeBrowser.context;
  if (ctx) {ctx.publicDialogOpen = true; ctx.input.reset();}
  if (!accessDialog) {
    accessDialog = document.createElement('dialog'); accessDialog.className = 'viewer-access-dialog'; accessDialog.id = 'workspace-access'; accessDialog.setAttribute('aria-labelledby', 'workspace-access-title');
    const title = document.createElement('h2'); title.id = 'workspace-access-title'; title.textContent = 'Tu espacio de trabajo privado';
    const text = document.createElement('p'); text.textContent = 'La demostración está abierta a todos. Para explorar más escenarios, crear y guardar proyectos, abre el servidor privado de tu organización. Solicita la dirección a su administrador.';
    const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Volver';
    accessDialog.append(title, text, close); document.body.appendChild(accessDialog);
    const release = () => {const current = activeBrowser && activeBrowser.context; if (current) {current.publicDialogOpen = false; current.input.reset();}};
    accessDialog.addEventListener('close', release); accessDialog.addEventListener('cancel', release);
    close.addEventListener('click', () => {if (accessDialog.close) accessDialog.close(); else accessDialog.removeAttribute('open'); release();});
  }
  if (accessDialog.showModal) accessDialog.showModal(); else accessDialog.setAttribute('open', '');
}

function pose(ctx, mode) {
  if (!ctx.demo || ctx.demo.driving.id && !ctx.demo.driving.unmount()) return false;
  ctx.input.reset(); ctx.cameraRig.position.set(0, 0, 0); ctx.cameraRig.quaternion.set(0, 0, 0, 1);
  if (!ctx.vrMode && ctx.desktopLook) {ctx.desktopLook.unlock(); ctx.desktopLook.reset();}
  if (ctx.vrMode) {
    // Only the rig changes in XR. The native headset pose remains untouched.
    ctx.cameraRig.position.set(4, ctx.xrReferenceSpaceType === 'local' ? 1.65 : 0, 8);
  } else if (mode === 'overview') {
    ctx.camera.position.set(11.5, 4.4, 8.6); ctx.camera.lookAt(4.4, 1, 1.2);
  } else {ctx.camera.position.set(4, 1.65, 8); ctx.camera.lookAt(2, 1.2, 0);}
  ctx.cameraRig.updateWorldMatrix(true, true); return true;
}

async function start() {
  let ctx;
  const browser = createBrowserHost({container: byId('viewer'), shadows: true, notify: notice,
    inputBlocked: () => !!ctx.publicDialogOpen,
    input: {desktopPointerLock: true, canWalk: () => !ctx.drivingVehicle && !ctx.publicDialogOpen, canInteract: () => !!ctx.demo && !ctx.demo.paused && !ctx.publicDialogOpen,
      onReset: () => {if (ctx && ctx.demo) ctx.demo.driving.resetInput();}, time: () => ctx.demo ? ctx.demo.simulation.time : 0},
    onContextLost: () => notice('Se ha interrumpido la imagen. Esperando la recuperación del navegador…'), onContextRestored: () => notice('Imagen recuperada.')});
  ctx = browser.context; ctx.room = 0; ctx.roomId = 'hall';
  activeBrowser = browser;
  const {renderer, scene, camera, cameraRig, graphics, input} = ctx;
  let host, documentModel, lighting, stopped = false, uiElapsed = 0, overview = false;
  const abort = new AbortController(), listeners = [];
  const listen = (target, name, handler, options) => {target.addEventListener(name, handler, options); listeners.push(() => target.removeEventListener(name, handler, options));};
  browser.onDispose(async () => {stopped = true; abort.abort(); listeners.splice(0).forEach(off => off()); clearTimeout(notice.timer);
    if (host) await host.dispose({force: true}); if (lighting) lighting.dispose(); if (documentModel) documentModel.dispose(); if (activeBrowser === browser) activeBrowser = null;
    if (window.smartTwinViewer && window.smartTwinViewer.context === ctx) window.smartTwinViewer = null;});
  const dispose = () => browser.dispose();
  const menu = byId('viewer-menu'), menuToggle = byId('viewer-menu-toggle');
  const closeMenu = () => {if (menu.open) menu.close();};
  listen(menuToggle, 'click', () => {
    if (ctx.vrMode) return;
    ctx.publicDialogOpen = true; input.reset(); ctx.desktopLook.unlock();
    menuToggle.setAttribute('aria-expanded', 'true'); menu.showModal();
  });
  listen(byId('viewer-menu-close'), 'click', closeMenu);
  listen(menu, 'close', () => {ctx.publicDialogOpen = false; input.reset(); menuToggle.setAttribute('aria-expanded', 'false');});
  browser.onDispose(closeMenu);
  try {
    const response = await fetch(new URL(SCENE_URL, document.baseURI).href, {signal: abort.signal, credentials: 'omit'});
    if (!response.ok) throw new Error('No se pudo cargar la demostración (' + response.status + ').');
    const snapshot = await response.json(); if (stopped) return;
    // The public app is deliberately a single curated example, not an arbitrary
    // project loader or a URL-selectable project gallery.
    if (!snapshot.project || snapshot.project.id !== VIEWER_WORLD_ID) throw new Error('Este archivo no es la demostración pública autorizada.');
    documentModel = new SelectedSceneDocument(snapshot, scene); lighting = createIndustrialEnvironment(scene, documentModel, ctx);
    ctx.beforeVoicePanelOpen = () => {closeMenu(); ctx.publicDialogOpen = false; input.reset(); ctx.desktopLook.unlock(); if (ctx.demo) ctx.demo.driving.resetInput();};
    host = createHost({catalog: createLocalCatalog([demoModule,createVoiceModule()]), worldId: VIEWER_WORLD_ID,
      grants: ['platform.scene', 'platform.document','platform.voice'], ports: {'platform.scene': ctx, 'platform.document': documentModel,'platform.voice':voicePort(ctx,{backendAvailable:configuration.backendAvailable===true,getDocument:()=>documentModel,getProject:()=>snapshot.project})}});
    await host.activate(DEMO_MODULE_ID, {functions: [DEMO_FUNCTION_ID]});
    await host.activate('shared.assistance', {functions:['assistant.voice']});
    if (stopped) {await host.dispose({force: true}); return;}
    pose(ctx, 'walk');
    browser.mountXR(byId('xr-action'), {className: 'viewer-xr-button', spawn: [4, 0, 8],
      beforeChange: () => ctx.demo.driving.unmount(true),
      afterChange: active => {if (active) pose(ctx, 'walk'); document.body.classList.toggle('immersive', active);}});
    listen(byId('overview'), 'click', () => {const next = !overview; if (pose(ctx, next ? 'overview' : 'walk')) {overview = next; byId('overview').textContent = overview ? 'Volver a caminar' : 'Vista general';}});
    byId('overview').textContent = 'Vista general';
    listen(byId('drive'), 'click', () => {
      if (ctx.demo.paused) ctx.demo.setPaused(false);
      const driving = ctx.demo.driving, vehicle = driving.nearest();
      if (driving.id) driving.unmount(); else if (vehicle) {driving.mount(vehicle.id); closeMenu();}
      else notice('Acércate al montacargas y pulsa F para subir.');
      input.reset();
    });
    listen(byId('pause'), 'click', () => {ctx.demo.setPaused(!ctx.demo.paused); input.reset();});
    listen(byId('restart'), 'click', () => {input.reset(); ctx.demo.restart(); pose(ctx, overview ? 'overview' : 'walk'); closeMenu(); notice('Escenario reiniciado.');});
    function updateUI() {
      const stats = ctx.demo.stats(), driving = !!ctx.demo.driving.id;
      document.body.classList.toggle('driving', driving); byId('drive').textContent = driving ? 'Bajar del vehículo · F' : 'Subir al montacargas · F';
      const locked = ctx.desktopLook.isLocked;
      document.body.classList.toggle('look-locked', locked);
      const nearby = !driving && ctx.demo.driving.nearest();
      byId('navigation-hint').textContent = driving ? '' : locked ? nearby ? 'F · Subir al montacargas    Esc · Liberar mouse' : 'W A S D · Caminar    Esc · Liberar mouse' : input.pointerLockUnavailable ? 'Mantén clic y arrastra · Mirar con el puntero    W A S D · Caminar' : 'Clic en la escena · Mirar con el puntero    W A S D · Caminar';
      byId('pause').textContent = stats.paused ? 'Continuar' : 'Pausar'; byId('pause').setAttribute('aria-pressed', String(stats.paused));
      byId('demo-progress').textContent = stats.paused ? 'Simulación en pausa · puedes seguir explorando.' : stats.vehicle && stats.vehicle.delivered >= 2 ? 'Práctica completada · 2 pallets entregados.' : stats.belt && stats.belt.packages ? 'Pallet listo en la banda · alinea las horquillas y recoge la carga.' : stats.robot && stats.robot.completed ? 'Primer ciclo robótico completado · continúa con el montacargas.' : 'El robot prepara la primera carga · observa el proceso.';
      byId('reticle').classList.toggle('hovering', !!ctx.desktopControllerData.currentIntersection);
    }
    browser.setFrameHandler({
      before({delta}) {if (lighting.sync) lighting.sync(); if (!ctx.publicDialogOpen) host.step(delta); ctx.demo.driving.docking.renderBefore(scene, delta);},
      after({delta}) {ctx.demo.driving.docking.postRender(); uiElapsed += delta; if (uiElapsed > .2) {uiElapsed = 0; updateUI();}}
    });
    browser.start(); updateUI(); byId('loading').hidden = true; document.body.classList.add('ready');
    window.smartTwinViewer = Object.freeze({
      getStats: () => ({app: 'public-viewer', sceneId: 'vr-robot-dispatch', frameCount: browser.stats().frames, primaryRenders: browser.stats().primaryRenders, contextLost: browser.stats().contextLost,
        render: {...renderer.info.render}, memory: {...renderer.info.memory}, graphics: graphics.getStats(), simulation: ctx.demo.stats(),
        activeFunctions: [DEMO_FUNCTION_ID,'assistant.voice'], requestsAPI: configuration.backendAvailable === true, immersive: ctx.vrMode}),
      dispose,
      // Explicit QA facade: no editor or networking object is constructed.
      context: ctx, host, document: documentModel, THREE
    });
    return window.smartTwinViewer;
  } catch (error) {await dispose(); throw error;}
}

function fail(error) {
  byId('loading').hidden = true;
  notice(error && error.message || 'No se pudo completar la acción. Vuelve a intentarlo.');
  console.error('Public viewer:', error);
}
byId('retry').addEventListener('click', () => window.location.reload());
try {
  const workspaceURL = accountURL();
  const accessLinks = [byId('workspace-link'), byId('welcome-access')];
  accessLinks.forEach(link => {link.href = workspaceURL || '#workspace-access'; if (!workspaceURL) link.addEventListener('click', event => {event.preventDefault(); openAccess();});});
  gallery = mountGallery({document, configuration, baseURI: document.baseURI, fetcher: (url, options) => fetch(url, options), workspaceURL, onAccess: openAccess,
    onStateChange(state) {
      const target = state.user && state.backend ? new URL('/editor', document.baseURI).href : workspaceURL || '#workspace-access';
      accessLinks.forEach(link => {link.href = target;});
      byId('welcome-access').textContent = state.user ? 'Continuar en mi espacio' : workspaceURL ? 'Iniciar sesión' : 'Acceder a mi espacio';
      byId('workspace-link').textContent = state.user ? 'Mi espacio ↗' : workspaceURL ? 'Iniciar sesión ↗' : 'Acceder al espacio ↗';
    },
    async onStart() {return navigation.openDemo();}});
  navigation = createWelcomeNavigation({
    showScreen(screen, {loading}) {
      gallery.hide(); byId('welcome').hidden = screen !== 'welcome';
      document.body.classList.remove('welcome-open', 'gallery-open', 'scene-active', 'ready', 'driving', 'immersive');
      byId('loading').hidden = !loading; byId('loading').classList.remove('failed'); byId('retry').hidden = true;
      if (screen === 'welcome') document.body.classList.add('welcome-open');
      else if (screen === 'gallery') gallery.show({focus: false});
      else {document.body.classList.add('scene-active'); if (!loading) document.body.classList.add('ready');}
    },
    startDemo: start,
    async stopDemo() {const browser = activeBrowser; if (browser) await browser.dispose(); window.smartTwinViewer = null;},
    writeHistory(hash, mode) {if (window.location.hash !== hash) window.history[mode === 'replace' ? 'replaceState' : 'pushState']({screen: hash}, '', hash);},
    focusScreen(screen) {byId(screen === 'welcome' ? 'welcome-title' : screen === 'gallery' ? 'gallery-title' : 'overview').focus({preventScroll: true});},
    onFailure(error) {gallery.setStatus(error && error.message || 'No se pudo abrir la demostración. Vuelve a intentarlo.');}
  });
  window.smartTwinGallery = Object.freeze({getStats: () => ({...gallery.getStats(), screen: navigation.getStats().screen}), ready: gallery.ready});
  const follow = action => Promise.resolve(action()).catch(fail);
  byId('explore-scenes').addEventListener('click', () => follow(() => navigation.gallery()));
  byId('back-scenes').addEventListener('click', () => follow(() => navigation.gallery()));
  byId('home-link').addEventListener('click', () => follow(() => navigation.home()));
  const brand = document.querySelector('.viewer-brand');
  if (brand) brand.addEventListener('click', event => {event.preventDefault(); follow(() => navigation.home());});
  const restore = () => follow(() => navigation.restore(window.location.hash));
  window.addEventListener('popstate', restore); window.addEventListener('hashchange', restore);
  restore();
  window.addEventListener('pagehide', event => {if (!event.persisted) {navigation.dispose().catch(() => {}); gallery.dispose(); if (accessDialog) accessDialog.remove();}}, {once: true});
} catch (error) {fail(error);}
