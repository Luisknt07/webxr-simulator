import * as THREE from 'three';
import {createHost, createLocalCatalog} from '../../packages/core/index.js';
import {createBrowserHost} from '../../packages/render-three/BrowserHost.js';
import {getSceneCameraMode, setDroneFlight} from '../../packages/render-three/SceneCameraMode.js';
import {SceneCaptureController, SceneCaptureToolbar} from '../../packages/scene-capture/index.js';
import SelectedSceneDocument from './SelectedSceneDocument.js';
import {demoModule, DEMO_MODULE_ID, DEMO_FUNCTION_ID} from './DemoRuntime.js';
import {mountGallery} from './Gallery.js';
import {createWelcomeNavigation} from './WelcomeNavigation.mjs';
import createIndustrialEnvironment from './IndustrialEnvironment.js';
import {createVoiceModule} from '../../packages/voice-assistant/index.js';
import {voicePort} from '../../modules/logistica-industrial/integrations/VoiceAssistantBridge.js';
import {DemoRecovery} from './SceneResilience.js';
import XRAccessDialog from './XRAccessDialog.js';
import {connectExperienceHeader} from '../../packages/navigation-ui/ExperienceHeader.js';
import {decorateMenuAction,setMenuActionLabel,mountTourShortcuts} from '../../packages/navigation-ui/ExperienceMenu.js';
import PracticeGuideAvatar from '../../packages/assistant-ui/PracticeGuideAvatar.js';

const byId = id => document.getElementById(id);
const experienceHeader=connectExperienceHeader(document.querySelector('.viewer-header'),{
  brand:document.querySelector('.viewer-brand'),actions:document.querySelector('.header-actions'),
  controls:{home:'#home-link',scenes:'#back-scenes',overview:'#overview',xr:'#xr-action button',menu:'#viewer-menu-toggle',account:'#workspace-link'},
  onInteract(){const c=window.smartTwinViewer&&window.smartTwinViewer.context;if(c){c.input.reset();if(c.desktopLook)c.desktopLook.unlock();}}
});
const configuration = window.SMARTTWIN_PUBLIC_VIEWER_CONFIG || {};
const SCENE_URL = configuration.sceneURL || 'projects/smarttwin/scenes/vr-robot-dispatch.json';
const VIEWER_WORLD_ID = 'public-vr-robot-dispatch';
let activeBrowser = null, gallery = null, accessDialog = null, navigation = null, practiceURL = null;

function accountURL() {
  const configured = configuration.workspaceURL || (configuration.apiOrigin ? new URL('login?next=%2Fplay', configuration.apiOrigin.replace(/\/?$/, '/')).href : configuration.backendAvailable === true ? new URL('/login?next=%2Fplay', document.baseURI).href : '');
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
  ctx.desktopFlight = false; ctx.desktopFlightAnchor = null;
  if (!ctx.vrMode && ctx.desktopLook) {ctx.desktopLook.unlock(); ctx.desktopLook.reset();}
  if (ctx.vrMode) {
    // Only the rig changes in XR. The native headset pose remains untouched.
    ctx.cameraRig.position.set(4, ctx.xrReferenceSpaceType === 'local' ? 1.65 : 0, 8);
  } else if (mode === 'overview') {
    ctx.camera.position.set(-7.4, 4.6, 7.8); ctx.camera.lookAt(3, 1, -2.8);
  } else {ctx.camera.position.set(4, 1.65, 8); ctx.camera.lookAt(2, 1.2, 0);}
  ctx.cameraRig.updateWorldMatrix(true, true); return true;
}

async function start() {
  let ctx, recovery=null;
  function frameFailure(event) {
    if (!ctx || ctx.publicFrameFailure) return;
    if(event.recoverable){ctx.publicPresentationFailure={phase:event.phase,message:event.message};ctx.input.reset();notice('Recuperando la imagen y los controles…');console.error('Public viewer presentation ('+event.phase+'):',event.error||event.message);return;}
    ctx.publicFrameFailure = {phase: event.phase, stage:event.error&&event.error.smartTwinStage||event.phase, message: event.message};
    ctx.lastPublicFrameFailure={...ctx.publicFrameFailure};
    if (ctx.demo) {
      // A partially executed material-flow step must never be retried silently.
      // Keep navigation/rendering alive; restart restores the authored custody.
      ctx.demo.paused = true;
      ctx.demo.driving.resetInput();
    }
    ctx.input.reset();
    byId('drive').disabled = true; byId('pause').disabled = true;
    const recovering=recovery&&recovery.request();
    notice(recovering?'Recuperando la demostración tras un error…':'No se pudo recuperar '+ctx.publicFrameFailure.stage+'. Abre Menú → Reiniciar.');
    clearTimeout(notice.timer);
    byId('viewer-notice').setAttribute('role', 'alert');
    console.error('Public viewer frame (' + event.phase + '):', event.error || event.message);
  }
  const browser = createBrowserHost({container: byId('viewer'), shadows: true, notify: notice,
    inputBlocked: () => !!ctx.publicDialogOpen,
    input: {desktopPointerLock: true, canWalk: () => !ctx.drivingVehicle && !ctx.publicDialogOpen, canInteract: () => !!ctx.demo && !ctx.demo.paused && !ctx.publicDialogOpen,
      onReset: () => {if (ctx && ctx.demo) ctx.demo.driving.resetInput();}, time: () => ctx.demo ? ctx.demo.simulation.time : 0},
    recoverPresentationErrors: true,
    onFrameError: frameFailure,
    onFrameRecovered: () => {if(ctx){ctx.publicPresentationFailure=null;notice('Imagen recuperada. Puedes continuar.');}},
    onContextLost: () => notice('Se ha interrumpido la imagen. Esperando la recuperación del navegador…'), onContextRestored: () => notice('Imagen recuperada.')});
  ctx = browser.context; ctx.room = 0; ctx.roomId = 'hall';
  activeBrowser = browser;
  const {renderer, scene, camera, cameraRig, graphics, input} = ctx;
  let host, documentModel, lighting, stopped = false, uiElapsed = 0, overview = false;
  const abort = new AbortController(), listeners = [];
  const listen = (target, name, handler, options) => {target.addEventListener(name, handler, options); listeners.push(() => target.removeEventListener(name, handler, options));};
  browser.onDispose(async () => {stopped = true;if(recovery)recovery.dispose(); abort.abort(); listeners.splice(0).forEach(off => off()); clearTimeout(notice.timer);
    if (host) await host.dispose({force: true}); if (lighting) lighting.dispose(); if (documentModel) documentModel.dispose(); if (activeBrowser === browser) activeBrowser = null;
    if (window.smartTwinViewer && window.smartTwinViewer.context === ctx) window.smartTwinViewer = null;});
  const dispose = () => browser.dispose();
  const menu = byId('viewer-menu'), menuToggle = byId('viewer-menu-toggle');
  for(const [id,icon]of [['menu-home','home'],['menu-scenes','scenes'],['menu-guide','guide'],['menu-camera','camera'],['menu-overview','overview'],['menu-xr','xr'],['drive','drive'],['pause','pause'],['restart','restart'],['menu-controls','controls'],['menu-voice','sound'],['menu-account','account']])decorateMenuAction(byId(id),icon);
  let menuPage='home';
  const showMenuPage=page=>{
    menuPage=page;
    for(const name of ['home','guide','controls','camera'])byId('viewer-menu-'+name).hidden=name!==page;
    const title=byId('viewer-menu-title');title.textContent=({home:'Menú del recorrido',guide:'Guía del escenario',controls:'Controles y ayuda',camera:'Cámara y navegación'})[page];title.tabIndex=-1;
    menu.scrollTop=0;if(menu.open)title.focus({preventScroll:true});
  };
  const closeMenu = () => {
    if (menu.open) menu.close();
    // The dialog's close event is queued. Release its input gate before a
    // menu action tries to mount the forklift in the same click handler.
    ctx.publicDialogOpen = false; input.reset(); menuToggle.setAttribute('aria-expanded', 'false');
  };
  const openMenu=(page='home')=>{
    if (ctx.vrMode) return;
    ctx.publicDialogOpen = true; input.reset(); ctx.desktopLook.unlock();
    showMenuPage(page);menuToggle.setAttribute('aria-expanded', 'true');if(!menu.open)menu.showModal();
  };
  listen(menuToggle, 'click', () => openMenu());
  for(const page of ['guide','controls','camera'])listen(byId('menu-'+page),'click',()=>showMenuPage(page));
  for(const back of menu.querySelectorAll('.st-menu-back'))listen(back,'click',()=>{const page=menuPage;showMenuPage('home');byId('menu-'+page).focus();});
  listen(byId('viewer-menu-close'), 'click', closeMenu);
  listen(byId('menu-home'),'click',()=>{closeMenu();byId('home-link').click();});
  listen(byId('menu-scenes'),'click',()=>{closeMenu();byId('back-scenes').click();});
  listen(byId('menu-voice'),'click',()=>{closeMenu();const launcher=document.querySelector('[data-voice-assistant-toggle]');if(launcher)launcher.click();});
  listen(byId('menu-overview'),'click',()=>{closeMenu();byId('overview').click();});
  listen(byId('menu-xr'),'click',()=>{closeMenu();const xr=byId('xr-action').querySelector('button');if(xr)xr.click();});
  listen(byId('menu-account'),'click',()=>{closeMenu();byId('workspace-link').click();});
  listen(menu,'click',event=>{if(event.target!==menu)return;const r=menu.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeMenu();});
  listen(menu, 'close', () => {if(menu.open)return;ctx.publicDialogOpen = !!document.querySelector('dialog[open]'); input.reset(); menuToggle.setAttribute('aria-expanded', 'false');});
  browser.onDispose(closeMenu);
  const releaseTourInput=()=>{input.reset();ctx.desktopLook.unlock();if(ctx.demo)ctx.demo.driving.resetInput();};
  const shortcuts=mountTourShortcuts({document,actions:[
    {id:'scenes',label:'Escenarios',icon:'scenes',action:()=>byId('back-scenes').click()},
    {id:'overview',label:'Vista',icon:'overview',action:()=>byId('overview').click(),getState:()=>({pressed:overview})},
    {id:'flight',label:'Dron',icon:'move',action:()=>byId('viewer-menu-camera').querySelector('[data-camera-mode='+(ctx.desktopFlight?'walk':'drone')+']').click(),getState:()=>{const state=getSceneCameraMode(ctx);return{pressed:state.mode==='drone',disabled:state.blocked,title:state.reason||'Alternar caminar / vuelo dron'};}},
    {id:'controls',label:'Controles',icon:'controls',action:()=>openMenu('controls')},
    {id:'guide',label:'Ayuda',icon:'guide',action:()=>openMenu('guide')},
    {id:'camera',label:'Cámara',icon:'camera',action:()=>openMenu('camera')}
  ],onInteract:releaseTourInput});
  browser.onDispose(()=>shortcuts.dispose());
  const tourGuide=new PracticeGuideAvatar({context:ctx,document,window,onInteract:releaseTourInput,getTourState:()=>ctx.demo&&!stopped?{title:'Demostración industrial',lastMessage:ctx.drivingVehicle?'Usa el volante, las palancas y los pedales. El menú conserva la guía completa del montacargas.':ctx.desktopFlight?'Explora en dron con WASD. Q sube y E baja; vuelve a Caminar desde el botón Dron o Cámara.':'Recorre la instalación, apunta a un equipo y selecciónalo. Abre Ayuda para conocer el proceso o Chat para consultar.'}:null});
  browser.onDispose(()=>tourGuide.dispose());
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
    tourGuide.mount();
    const tools = document.createElement('div'); tools.className = 'st-menu-camera-tools'; tools.setAttribute('aria-label', 'Cámara y captura del escenario');
    const modes = document.createElement('div'); modes.className = 'public-camera-modes'; modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', 'Modo de navegación'); tools.appendChild(modes);
    const releaseInput = () => {input.reset(); ctx.desktopLook.unlock(); ctx.demo.driving.resetInput();};
    const modeButtons = ['walk', 'drone'].map(mode => {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.cameraMode = mode; button.textContent = mode === 'drone' ? 'Dron / vuelo' : 'Caminar';
      listen(button, 'click', () => {
        if (getSceneCameraMode(ctx).blocked) {notice(getSceneCameraMode(ctx).reason); return;}
        releaseInput();
        if (overview) {pose(ctx, 'walk'); overview = false; byId('overview').textContent = 'Vista general';}
        if (setDroneFlight(ctx, mode === 'drone', {clearInput: releaseInput, message: notice})) notice(mode === 'drone' ? 'Dron: WASD para desplazarte · Q subir · E bajar · Ctrl acelerar. En móvil usa Subir y Bajar.' : 'Caminar: recorre los pasillos con WASD o el mando táctil.');
        updateUI();
      }); modes.appendChild(button); return button;
    });
    for (const name of ['pointerdown', 'keydown', 'keyup']) listen(modes, name, event => {event.stopPropagation(); if (name === 'pointerdown') releaseInput();});
    const mediaHost = document.createElement('div'); mediaHost.className = 'public-scene-media'; tools.appendChild(mediaHost); byId('viewer-menu-camera').appendChild(tools);
    const capture = ctx.sceneCapture = new SceneCaptureController({getCanvas: () => renderer.domElement, document, window,
      getContext: () => ({active: !stopped && !ctx.publicFrameFailure, xr: !!ctx.vrMode, identity: VIEWER_WORLD_ID}), label: () => 'SmartTwin-demostracion-industrial'});
    const captureToolbar = new SceneCaptureToolbar({controller: capture, document, window, onInteract: releaseInput}); captureToolbar.mount(mediaHost);
    browser.onDispose(() => {captureToolbar.dispose(); capture.dispose(); tools.remove(); if (ctx.sceneCapture === capture) ctx.sceneCapture = null;});
    const xrHelp=new XRAccessDialog(ctx);browser.onDispose(()=>xrHelp.dispose());
    browser.mountXR(byId('xr-action'), {className: 'viewer-xr-button', spawn: [4, 0, 8],
      buttonOptions:{enterLabel:'Realidad virtual',exitLabel:'Salir de RV',retryLabel:'Reintentar RV',unavailableLabel:'Realidad virtual'},
      onUnavailable:(details,entry)=>xrHelp.open(details,entry),
      beforeChange: () => ctx.demo.driving.unmount(true),
      afterChange: active => {if (active) pose(ctx, 'walk'); document.body.classList.toggle('immersive', active);}});
    listen(byId('overview'), 'click', () => {const next = !overview; if (pose(ctx, next ? 'overview' : 'walk')) {overview = next; byId('overview').textContent = overview ? 'Volver a caminar' : 'Vista general';}});
    byId('overview').textContent = 'Vista general';
    listen(byId('drive'), 'click', () => {
      if (ctx.demo.paused) ctx.demo.setPaused(false);
      const driving = ctx.demo.driving, vehicle = driving.nearest();
      if (driving.id) driving.unmount(); else if (vehicle) {closeMenu(); driving.mount(vehicle.id);}
      else notice('Acércate al montacargas y pulsa F para subir.');
      input.reset();
    });
    listen(byId('pause'), 'click', () => {ctx.demo.setPaused(!ctx.demo.paused); input.reset();});
    function restoreDemonstration(automatic=false){
      const vehicleId=automatic&&ctx.demo.driving.id;
      input.reset();ctx.demo.restart();closeMenu();
      if(vehicleId&&ctx.demo.simulation.records.has(vehicleId))ctx.demo.driving.mount(vehicleId);else pose(ctx,overview?'overview':'walk');
      ctx.publicFrameFailure=null;browser.clearFrameError();
      byId('drive').disabled=false;byId('pause').disabled=false;byId('viewer-notice').removeAttribute('role');
    }
    recovery=new DemoRecovery({restart:()=>restoreDemonstration(true),onRecovered:()=>notice('Demostración recuperada. Se restablecieron las cargas y los mandos; el freno queda activado.'),onFailure:error=>{ctx.lastPublicFrameFailure={phase:'recovery',stage:'recuperación',message:error.message};notice('No se pudo recuperar el escenario. Abre Menú → Reiniciar.');console.error('Public demo recovery:',error);}});
    listen(byId('restart'), 'click', () => {
      recovery.reset();input.reset();
      try {
        restoreDemonstration();notice('Escenario reiniciado.');
      } catch (error) {frameFailure({phase:'restart',message:error.message,error});}
    });
    function updateUI() {
      shortcuts.update();tourGuide.update();
      const stats = ctx.demo.stats(), driving = !!ctx.demo.driving.id;
      const cameraMode = getSceneCameraMode(ctx); tools.dataset.mode = cameraMode.mode;
      modeButtons.forEach(button => {button.disabled = cameraMode.blocked; button.setAttribute('aria-pressed', String(button.dataset.cameraMode === cameraMode.mode)); button.title = cameraMode.reason || (button.dataset.cameraMode === 'drone' ? 'Vuela por la instalación · Q subir · E bajar' : 'Volver a un apoyo peatonal libre');});
      document.body.classList.toggle('driving', driving); setMenuActionLabel(byId('drive'),driving ? 'Bajar del vehículo · F' : 'Subir al montacargas · F');
      setMenuActionLabel(byId('menu-overview'),overview?'Volver a caminar':'Vista general');byId('menu-overview').setAttribute('aria-pressed',String(overview));
      const locked = ctx.desktopLook.isLocked;
      document.body.classList.toggle('look-locked', locked);
      const nearby = !driving && ctx.demo.driving.nearest();
      byId('navigation-hint').textContent = driving ? '' : locked ? nearby ? 'F · Subir al montacargas    Esc · Liberar mouse' : 'W A S D · Caminar    Esc · Liberar mouse' : input.pointerLockUnavailable ? 'Mantén clic y arrastra · Mirar con el puntero    W A S D · Caminar' : 'Clic en la escena · Mirar con el puntero    W A S D · Caminar';
      setMenuActionLabel(byId('pause'),stats.paused ? 'Continuar' : 'Pausar'); byId('pause').setAttribute('aria-pressed', String(stats.paused));
      const robotProgress = (stats.robots || []).map((robot, index) => 'Robot '+(index+1)+': '+robot.completed+' cajas').join(' · ');
      byId('demo-progress').textContent = ctx.publicFrameFailure ? 'Simulación interrumpida · Menú → Reiniciar.' : stats.paused ? 'Simulación en pausa · puedes seguir explorando.' : stats.vehicle && stats.vehicle.delivered >= 2 ? 'Dos pallets entregados · explora la estantería y consulta el monitor.' : stats.vehicle && stats.vehicle.carrying ? 'Pallet recogido · baja la carga y sigue la ruta hasta su destino.' : stats.belt && stats.belt.packages ? 'Pallet listo en la banda · alinea las horquillas y recoge la carga. '+robotProgress : robotProgress+' · Observa las dos líneas y consulta sus datos en el monitor.';
      byId('reticle').classList.toggle('hovering', !!ctx.desktopControllerData.currentIntersection);
    }
    browser.setFrameHandler({
      before({delta}) {
        const presentation=ctx.demo.presentation;
        if(lighting.sync)presentation.run('la iluminación',()=>lighting.sync());
        if(!ctx.publicDialogOpen&&!ctx.publicFrameFailure)host.step(delta);
        presentation.run('la cámara de inspección',()=>ctx.demo.driving.docking.renderBefore(scene,delta));
      },
      after({delta}) {capture.afterRender(); ctx.demo.driving.docking.postRender(); uiElapsed += delta; if (uiElapsed > .2) {uiElapsed = 0; updateUI();}}
    });
    browser.start(); updateUI(); byId('loading').hidden = true; document.body.classList.add('ready');
    window.smartTwinViewer = Object.freeze({
      getStats: () => ({app: 'public-viewer', sceneId: 'vr-robot-dispatch', frameCount: browser.stats().frames, primaryRenders: browser.stats().primaryRenders, contextLost: browser.stats().contextLost,
        render: {...renderer.info.render}, memory: {...renderer.info.memory}, graphics: graphics.getStats(), simulation: ctx.demo.stats(),
        activeFunctions: [DEMO_FUNCTION_ID,'assistant.voice'], requestsAPI: configuration.backendAvailable === true, immersive: ctx.vrMode,
        frameError: browser.stats().frameError, frameErrors: browser.stats().frameErrors, lastFrameError:browser.stats().lastFrameError,
        lastFailure:ctx.lastPublicFrameFailure||null,recovery:recovery.stats(),displayErrors:ctx.demo.presentation.stats()}),
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
  practiceURL=workspaceURL;
  const accessLinks = [byId('workspace-link')];
  accessLinks.forEach(link => {link.href = workspaceURL || '#workspace-access'; if (!workspaceURL) link.addEventListener('click', event => {event.preventDefault(); openAccess();});});
  const editorLink = byId('editor-access');
  if(workspaceURL){const target=new URL(workspaceURL);target.pathname='/login';target.search='?next=%2Feditor';target.hash='';editorLink.href=target.href;}
  else editorLink.addEventListener('click',event=>{event.preventDefault();openAccess();});
  gallery = mountGallery({document, configuration, baseURI: document.baseURI, fetcher: (url, options) => fetch(url, options), workspaceURL, onAccess: openAccess,
    onStateChange(state) {
      const target = state.user && state.backend ? new URL('/play', document.baseURI).href : workspaceURL || '#workspace-access';
      practiceURL=state.backend?target:workspaceURL;
      accessLinks.forEach(link => {link.href = target;});
      if(state.user&&state.backend)editorLink.href=new URL('/editor',document.baseURI).href;
      byId('workspace-link').textContent = state.user ? 'Mi espacio ↗' : workspaceURL ? 'Iniciar sesión ↗' : 'Acceder al espacio ↗';
      setMenuActionLabel(byId('menu-account'),state.user?'Mi espacio':workspaceURL?'Iniciar sesión':'Mi espacio');
    },
    async onStart() {return navigation.openDemo();}});
  navigation = createWelcomeNavigation({
    showScreen(screen, {loading}) {
      document.querySelector('.viewer-header').dataset.screen=screen;
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
  byId('explore-demo').addEventListener('click', () => follow(() => navigation.openDemo()));
  byId('explore-scenes').addEventListener('click', () => practiceURL?window.location.assign(practiceURL):follow(() => navigation.gallery()));
  byId('back-scenes').addEventListener('click', () => follow(() => navigation.gallery()));
  byId('home-link').addEventListener('click', () => follow(() => navigation.home()));
  const brand = document.querySelector('.viewer-brand');
  if (brand) brand.addEventListener('click', event => {event.preventDefault(); follow(() => navigation.home());});
  const restore = () => follow(() => navigation.restore(window.location.hash));
  window.addEventListener('popstate', restore); window.addEventListener('hashchange', restore);
  restore();
  window.addEventListener('pagehide', event => {if (!event.persisted) {experienceHeader.dispose();navigation.dispose().catch(() => {}); gallery.dispose(); if (accessDialog) accessDialog.remove();}}, {once: true});
} catch (error) {fail(error);}
