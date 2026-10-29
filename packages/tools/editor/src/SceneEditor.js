import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {TransformControls} from 'three/examples/jsm/controls/TransformControls.js';
import AssetLibrary from './AssetLibrary.js';
import AssetThumbnails from './AssetThumbnails.js';
import EditorShell from './EditorShell.js';
import ResourceBrowser from './ResourceBrowser.js';
import {usage as resourceUsage, remove as removeResource} from '../../../../apps/workspace/studio/ResourceOperations.js';
import SceneDocument from '../../../project-model/src/SceneDocument.js';
import InteractionRuntime from './InteractionRuntime.js';
import BehaviorRuntime from './BehaviorRuntime.js';
import InfoPanelPreview from './InfoPanelPreview.js';
import DecalSystem from './DecalSystem.js';
import SurfaceMaterialSystem from './SurfaceMaterialSystem.js';
import WearPaintSystem from './WearPaintSystem.js';
import WearBrush from './WearBrush.js';
import MaterialInspector from './MaterialInspector.js';
import ScenePerformance from '../../../render-three/src/ScenePerformance.js';
import GraphicsSettings from '../../../render-three/src/GraphicsSettings.js';
import IndustrialVisuals from '../../../../modules/logistica-industrial/functions/presentacion/runtime/IndustrialVisuals.js';
import IndustrialFinishSystem from '../../../../modules/logistica-industrial/functions/presentacion/runtime/IndustrialFinishSystem.js';
import IndustrialAudioSystem from '../../../../modules/logistica-industrial/functions/presentacion/runtime/IndustrialAudioSystem.js';
import LineMonitorSystem from '../../../../modules/logistica-industrial/functions/almacenamiento/runtime/LineMonitorSystem.js';
import SimulationRuntime from '../../../../modules/logistica-industrial/functions/flujo-materiales/runtime/SimulationRuntime.js';
import VehicleDriving from '../../../../modules/logistica-industrial/functions/montacargas/runtime/VehicleDriving.js';
import CADWorkbench from '../../cad/src/CADWorkbench.js';
import VehicleRouteEditor from '../../../../modules/logistica-industrial/functions/montacargas/runtime/VehicleRouteEditor.js';
import SimulationPanel from './SimulationPanel.js';
import CollisionWorld from '../../../render-three/src/CollisionWorld.js';
import ConveyorAssembly from '../../../../modules/logistica-industrial/functions/bandas/runtime/ConveyorAssembly.js';
import ObjectAssembly from './ObjectAssembly.js';
import EquipmentPlacement from './EquipmentPlacement.js';
import {industrialPrefabs} from '../../../../modules/logistica-industrial/functions/presentacion/runtime/IndustrialPrefabs.js';
import behaviorSchema from '../../../../modules/logistica-industrial/contracts/behaviors.js';
import {installNativeBehaviorAdapters} from './NativeBehaviorAdapters.js';
import ProjectClient from './ProjectClient.js';
import ProjectLibrary from './ProjectLibrary.js';
import ProjectSync from './ProjectSync.js';
import resolveProject from './ProjectResolver.js';
import ProjectAccessView from './ProjectAccessView.js';
import ProjectSharing from './ProjectSharing.js';
import {describeNative, prepareNativeEdit, syncNativeTransforms} from './NativeBindings.js';

const STORAGE_KEY = 'hello-webxr-editor-v1';
const ACTIVE_PROJECT_KEY = 'hello-webxr-active-project';
const ROOM_LABELS = ['Sala principal', 'Sala de sonido', 'Fotogrametría', 'Vértigo', 'Panorama estéreo', 'Panorama 1', 'Panorama 2', 'Panorama 3', 'Panorama 4', 'Panorama 5'];
const ROOM_IDS = ['hall', 'sound', 'photogrammetry', 'vertigo', 'panoramastereo', 'panorama1', 'panorama2', 'panorama3', 'panorama4', 'panorama5'];
const PLACEABLE_KINDS = ['model', 'image'];
const NAVIGATION_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'];
const TOOL_MODES = ['translate', 'rotate', 'scale'];
const FUNCTION_SOURCE = {
  lineMonitor: ["modules/logistica-industrial/functions/almacenamiento/runtime/LineMonitorSystem.js", 'Monitor 2D de la línea: trayectorias, productos, variables y mandos por ratón o ambos controles VR.'],
  surfaceMaterial: ["packages/tools/editor/src/SurfaceMaterialSystem.js", 'Material editable con texturas PBR, acabado y desgaste general. Se conserva al copiar y guardar.'],
  surfaceWear: ["packages/tools/editor/src/WearPaintSystem.js", 'Capas de desgaste pintadas con la brocha y vinculadas a esta pieza.'],
  decal: ["packages/tools/editor/src/DecalSystem.js", 'Proyecta una imagen sobre superficies. Ajusta tamaño, profundidad y opacidad; PNG con transparencia permite pegatinas y señalización.'],
  collision: ["packages/render-three/src/CollisionWorld.js", 'Impide atravesar superficies sólidas. Los disparadores detectan presencia sin bloquear el paso.'],
  portal: ["modules/turismo/functions/museo/rooms/Hall.js", 'Apuntar al objeto y pulsar o soltar el botón del mouse / gatillo VR.'],
  float: ["modules/turismo/functions/museo/stations/PanoBalls.js", 'Actualiza la altura alrededor de la posición que guardaste.'],
  painting: ["modules/turismo/functions/museo/stations/Paintings.js", 'Apuntar y mantener pulsado para acercar la imagen del cuadro.'],
  graffiti: ["modules/turismo/functions/museo/stations/Graffiti.js", 'Mantener pulsado sobre una superficie con coordenadas UV para pintar.'],
  note: ["modules/turismo/functions/museo/stations/Xylophone.js", 'Reproduce la nota al golpearla con una baqueta; cada copia conserva su propio audio.'],
  grab: ["modules/turismo/functions/museo/stations/Xylophone.js", 'Gatillo al tocar el objeto en VR; clic derecho para agarrar o soltar en escritorio.'],
  info: ["modules/turismo/functions/museo/stations/InfoPanels.js", 'Muestra un panel con su propio texto, color y tamaño.'],
  billboard: ["packages/render-three/ecs/systems/BillboardSystem.js", 'Orienta el objeto hacia el visitante durante el recorrido.'],
  sound: ["modules/turismo/functions/museo/rooms/Sound.js", 'Audio del objeto al pulsarlo o por reproducción automática.'],
  machineAudio: ["modules/logistica-industrial/functions/presentacion/runtime/IndustrialAudioSystem.js", 'Audio espacial sincronizado con el movimiento, los ciclos y las pulsaciones reales; admite un clip propio.'],
  audioZone: ["modules/logistica-industrial/functions/presentacion/runtime/IndustrialAudioSystem.js", 'Zona espacial de ambiente con entrada y salida suaves, sin malla ni colisión.'],
  animation: ["packages/tools/editor/src/BehaviorRuntime.js", 'Reproduce un clip de animación perteneciente al modelo visual.'],
  news: ["modules/turismo/functions/museo/stations/NewsTicker.js", 'Actualiza una pantalla a partir de un archivo de noticias JSON.'],
  teleport: ["packages/render-three/src/Teleport.js", 'En VR: apuntar, mantener el gatillo y soltar para desplazarse.'],
  motion: ["modules/logistica-industrial/functions/flujo-materiales/runtime/SimulationRuntime.js", 'Movimiento continuo u oscilación sobre el eje local. La posición de edición se recupera al terminar la prueba.'],
  conveyor: ["modules/logistica-industrial/functions/flujo-materiales/runtime/SimulationRuntime.js", 'Transporta paquetes simulados. La velocidad y la marcha se controlan desde el monitor o la lógica del PLC.'],
  source: ["modules/logistica-industrial/functions/flujo-materiales/runtime/ProductSourceRuntime.js", 'Genera y recibe cargas en una cola FIFO limitada. Configura productos, pallets y entrega manual o por flujo.'],
  processor: ["modules/logistica-industrial/functions/procesamiento/runtime/ProcessorRuntime.js", 'Recibe cargas, realiza preparación y proceso y conserva su salida hasta entregarla. Configura puestos simultáneos, operario y recetas de combinación o separación.'],
  robot: ["modules/logistica-industrial/functions/robots/runtime/RobotRuntime.js", 'Ejes cinemáticos, herramienta y secuencia de recogida, traslado y entrega. Configura alcance, carga, equipos vinculados y tiempos por instancia.'],
  vehicle: ["modules/logistica-industrial/functions/montacargas/runtime/VehicleRuntime.js", 'Conducción, mecanismos hidráulicos, carga real, colisiones, capacidad y telemetría por vehículo. Las funciones disponibles corresponden a la tipología seleccionada.'],
  palletQueue: ["modules/logistica-industrial/functions/almacenamiento/runtime/PalletQueueRuntime.js", 'Almacena productos sobre una estiba independiente. Controla capacidad, ocupación, recepción y retiro seguro por niveles.'],
  product: ["modules/logistica-industrial/functions/flujo-materiales/runtime/SimulationRuntime.js", 'Caja manipulable: conserva su orientación al tomarla. Usa la rueda del mouse para acercarla o alejarla y pulsa de nuevo para soltarla sobre una banda. También funciona con el gatillo VR.'],
  sensor: ["modules/logistica-industrial/functions/flujo-materiales/runtime/SimulationRuntime.js", 'Detecta paquetes de la banda vinculada al atravesar su volumen y cuenta los flancos de detección.'],
  automation: ["modules/logistica-industrial/functions/flujo-materiales/schema/automation.js", 'PLC simulado: evalúa condiciones y escribe variables. Añade reglas con el formulario o edita su JSON.'],
  control: ["modules/logistica-industrial/functions/flujo-materiales/runtime/SimulationRuntime.js", 'Mando 3D: al pulsarlo con mouse o gatillo VR modifica una variable del equipo vinculado.'],
  analytics: ["packages/tools/editor/src/TelemetryRecorder.js", 'Define el intervalo de muestreo. Usa Variables y datos para grabar, guardar en SQLite o descargar CSV / JSON.']
};
const ROOM_SOURCE = {
  hall: "modules/turismo/functions/museo/rooms/Hall.js", sound: "modules/turismo/functions/museo/rooms/Sound.js",
  photogrammetry: "modules/turismo/functions/museo/rooms/PhotogrammetryObject.js", vertigo: "modules/turismo/functions/museo/rooms/Vertigo.js",
  panoramastereo: "modules/turismo/functions/museo/rooms/PanoramaStereo.js"
};

function implementationSource(object, type) {
  if (type === 'machineAudio' || type === 'audioZone') return FUNCTION_SOURCE[type][0];
  if (type === 'decal') return FUNCTION_SOURCE.decal[0];
  if (type === 'collision') return FUNCTION_SOURCE.collision[0];
  if ((behaviorSchema.simulationTypes || []).includes(type)) return FUNCTION_SOURCE[type][0];
  const native = (object.userData.editorNativeBehaviorTypes || []).includes(type);
  if (!native) return ['portal', 'float', 'sound', 'animation', 'teleport'].includes(type) ? "packages/tools/editor/src/BehaviorRuntime.js" : "packages/tools/editor/src/NativeBehaviorAdapters.js";
  if (type === 'animation' || type === 'sound') return "modules/turismo/functions/museo/rooms/Sound.js";
  if (type === 'portal' || type === 'teleport') {
    if (type === 'portal' && Number.isFinite(object.userData.panoId)) return "modules/turismo/functions/museo/stations/PanoBalls.js";
    const room = object.userData.editorRoom || '';
    return ROOM_SOURCE[room] || (/^panorama[1-5]$/.test(room) ? "modules/turismo/functions/museo/rooms/Panorama.js" : FUNCTION_SOURCE[type][0]);
  }
  return FUNCTION_SOURCE[type][0];
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(text, title, action, className = '') {
  const node = el('button', 'ed-button ' + className, text);
  node.type = 'button';
  node.title = title;
  node.addEventListener('click', action);
  return node;
}
function isTyping(event) {
  return event.target.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName);
}
function visibleInTree(object) {
  for (let node = object; node; node = node.parent) if (!node.visible) return false;
  return true;
}

export default class SceneEditor {
  constructor(ctx, hooks) {
    this.ctx = ctx;
    this.hooks = hooks;
    this.editorEnabled = new URL(window.location).pathname === '/editor';
    this.active = false;
    this.navigationKeys = new Set();
    this.toolMode = 'translate';
    this.selected = null;
    this.entries = [];
    this.folder = '';
    this.assetQuery = '';
    this.assetKind = 'all';
    this.dirty = false;
    this.busy = false;
    this.changeVersion = 0;
    this.currentProject = null;
    this.projectName = 'Mi escenario';
    this.storageAvailable = false;
    this.serverCapabilities = {};
    this.serverLimits = {};
    this.importingFiles = false;
    this.projectGeneration = 0;
    this.initializing = true;
    this.pendingEdits = 0;
    this.remoteProject = null;
    this.historicalRevision = null;
    this.behaviorClipboard = null;
    this.objectClipboard = null;
    this.objectPasteCount = 0;
    this.pastingObject = false;
    this.expandedComponents = new Map();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.01, 5000);
    this.camera.position.set(3.2, 2.8, 4.5);
    this.camera.layers.enable(1);
    this.library = new AssetLibrary(ctx);
    this.library.onPreparingModel = name => {
      this.toast('Preparando modelo ' + name + '…');
      if (this.initializing && window.webxrStartup) window.webxrStartup.phase('Preparando modelo ' + name + '…');
    };
    installNativeBehaviorAdapters(ctx);
    this.document = new SceneDocument(ctx, {assetLibrary: this.library, onChange: () => this.changed()});
    Object.keys(ctx.editorRoots).forEach(id => this.document.registerRoom(id, ctx.editorRoots[id]));
    this.infoPreview = new InfoPanelPreview(ctx, this.document);
    this.decals = new DecalSystem(ctx, this.document, this.library, message => this.toast(message));
    this.materials = new SurfaceMaterialSystem(ctx, this.document, this.library, message => this.toast(message));
    this.wearPaint = new WearPaintSystem(ctx, this.document, this.library, message => this.toast(message));
    this.wearBrushSettings = {pattern: 'rust', size: 0.2, opacity: 0.8, density: 0.65, depth: 0.08, color: '#ffffff', roughness: 0.92, metalness: 0.03};
    this.wearBrushTool = new WearBrush(this);
    this.materialInspector = new MaterialInspector(this);
    this.performance = new ScenePerformance(ctx, this.document);
    ctx.performanceVisibility = this.performance;
    this.performance.setRoom(this.roomId);
    this.collisionWorld = new CollisionWorld(ctx, this.document);
    ctx.collisionWorld = this.collisionWorld;
    this.collisionWorld.setRoom(this.roomId);
    this.assembly = new ConveyorAssembly(this);
    this.objectAssembly = new ObjectAssembly(this);
    this.equipmentPlacement = new EquipmentPlacement(this);
    this.interactions = new InteractionRuntime(ctx, this.document, this.library, text => this.toast(text));
    this.behaviors = new BehaviorRuntime(ctx, this.document, this.library, text => this.toast(text));
    this.simulation = new SimulationRuntime(ctx, this.document, text => this.toast(text));
    this.vehicleDriving = typeof VehicleDriving === 'function' ? new VehicleDriving(ctx, this.simulation, {notify: text => this.toast(text)}) : null;
    this.cadWorkbench = typeof CADWorkbench === 'function' ? new CADWorkbench(this) : null;
    this.vehicleRoutes = typeof VehicleRouteEditor === 'function' ? new VehicleRouteEditor(this) : null;
    this.industrialVisuals = new IndustrialVisuals(ctx, this.document, this.simulation);
    this.finishes = typeof IndustrialFinishSystem === 'function' ? new IndustrialFinishSystem(ctx, this.document) : null;
    this.industrialAudio = new IndustrialAudioSystem(ctx, this.document, this.simulation, this.library, text => this.toast(text));
    this.audioControls = []; this.industrialAudio.onChange = () => this.refreshAudioControls();
    this.lineMonitors = new LineMonitorSystem(ctx, this.document, this.simulation);
    this.projectClient = new ProjectClient();
    this.accessView = new ProjectAccessView(this);
    this.sharing = new ProjectSharing(this);
    this.projectLibrary = new ProjectLibrary(this.projectClient, {
      onOpen: (project, roomId) => this.openServerProject(project, roomId),
      getCurrentProject: () => this.currentProject,
      listLevels: project => behaviorSchema.studio.sceneEntries(project.document).filter(scene => !this.accessView.enabled || !(project.document.studio && project.document.studio.scenes || []).length || scene.custom).sort((a, b) => Number(b.initial) - Number(a.initial) || Number(b.custom) - Number(a.custom) || a.index - b.index),
      onNew: name => this.studioTools ? this.studioTools.newProject(name) : this.createServerProject(name),
      onSaveAs: name => this.saveProject(name, true),
      notify: message => this.toast(message)
    });
    if (!this.editorEnabled && this.projectLibrary.overlay) this.projectLibrary.overlay.remove();
    this.buildUI();
    this.assetThumbnails = new AssetThumbnails(this.library, this.assetGrid);
    if (this.editorEnabled) {
      this.resourceBrowser = new ResourceBrowser({
        host: this.assets, library: this.library, thumbnails: this.assetThumbnails,
        grid: this.assetGrid, folderList: this.folderList, preview: this.preview,
        onPlace: resource => this.placeResource(resource),
        onExploreEquipment: resource => this.conveyorViewer && this.conveyorViewer.open(resource),
        onImport: () => this.assetInput.click(),
        onSceneContext: () => ({document: this.document, roomId: this.roomId}),
        onChange: organization => this.document.setStudio({organization}),
        onCaptureTemplate: () => this.studioTools && this.studioTools.saveTemplate(),
        onSelect: resource => { this.selectedAsset = resource.asset || null; this.showInspectorTab('resource'); this.inspector.scrollTop = 0; this.inspectorScroll.resource = 0; },
        onImageAction: (entry, action) => action === 'decal' ? this.startDecalPlacement(entry) : this.materialInspector.applyTexture(this.selected, entry.importId || entry.path),
        canApplyTexture: () => Boolean(this.selected),
        onUsage: resource => resourceUsage(this, resource),
        onDeleteResource: resource => removeResource(this, resource),
        onMessage: message => this.toast(message)
      });
      if (this.resourceBrowser.search) this.assetSearch = this.resourceBrowser.search;
      if (this.resourceBrowser.kindFilter) this.kindSelect = this.resourceBrowser.kindFilter;
    }
    this.simulationPanel = new SimulationPanel(this);
    if (this.editorEnabled) this.shell = new EditorShell(this);
    this.orbit = new OrbitControls(this.camera, ctx.renderer.domElement);
    this.orbit.target.set(0, 1, -1);
    this.orbit.mouseButtons = {LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE};
    this.orbit.enableKeys = false;
    this.orbit.enableDamping = true; this.orbit.dampingFactor = .12;
    this.orbit.rotateSpeed = .55; this.orbit.panSpeed = .65; this.orbit.zoomSpeed = .65;
    this.orbit.enabled = false;
    this.orbit.update();
    this.safeCameraPosition = this.camera.position.clone();
    this.safeOrbitTarget = this.orbit.target.clone();
    this.transform = new TransformControls(this.camera, ctx.renderer.domElement);
    this.transform.enabled = false;
    this.transform.setSize(0.85);
    this.setTool('translate');
    this.transform.userData.editorHelper = true;
    this.grid = new THREE.GridHelper(40, 80, 0x56727a, 0x2b3e45);
    this.grid.position.y = 0.006;
    this.grid.userData.editorHelper = true;
    this.grid.visible = false;
    this.box = new THREE.BoxHelper(new THREE.Object3D(), 0x60e5c0);
    this.box.userData.editorHelper = true;
    this.box.visible = false;
    this.box.material.depthTest = false;
    this.box.renderOrder = 1000;
    hooks.renderScene.add(this.transform, this.grid, this.box);
    this.transform.addEventListener('dragging-changed', event => {
      this.clearNavigation();
      if (event.value) this.stopOrbitMotion();
      this.orbit.enabled = this.active && !event.value;
      if (event.value) {
        if (this.performance.clearPresentation) this.performance.clearPresentation();
        this.industrialVisuals.dispose(); this.materials.dispose(); this.document.begin();
        const resizeTarget = this.transform.object || this.selected;
        const explicitGroup = this.studioTools && this.studioTools.selection.size > 1;
        this.resizeReflow = this.toolMode === 'scale' && !explicitGroup && this.assembly.supported(resizeTarget) ?
          this.assembly.captureReflow(resizeTarget) : null;
        if (this.resizeReflow && !this.resizeReflow.edges.length) this.resizeReflow = null;
        this.dragAssembly = this.toolMode === 'translate' ? this.assemblyFor(this.transform.object || this.selected) : null;
        this.clearAssembly();
        if (this.dragAssembly) this.dragAssembly.begin(this.transform.object || this.selected, {component: !explicitGroup && !this.detachDragModifier, detach: this.detachDragModifier});
      } else if (!this.cancellingTransform) {
        this.perform(() => {
          try {
            if (this.dragAssembly) this.dragAssembly.end();
            this.dragAssembly = null;
            if (this.resizeReflow) this.applyEquipmentReflow(this.resizeReflow);
            else this.assembly.detachSeparated(this.transform.object || this.selected);
            this.resizeReflow = null;
            this.detachDragModifier = false;
            this.document.commit(); this.syncNative();
          } catch (error) { this.resizeReflow = null; this.clearAssembly(); this.document.cancel(); throw error; }
        });
      }
    });
    this.transform.addEventListener('objectChange', () => {
      if (this.transform.dragging && this.toolMode === 'translate') {
        try { if (this.dragAssembly) this.dragAssembly.update(this.transform.object || this.selected); }
        catch (error) { this.cancelTransformDrag(); this.toast(error.message); }
      }
      if (this.transform.dragging && this.resizeReflow) {
        try { this.applyEquipmentReflow(this.resizeReflow); }
        catch (error) { this.cancelTransformDrag(); this.toast(error.message); }
      }
      this.box.update();
      this.updateTransformInputs();
    });
    this.bindViewport();
    document.addEventListener('keydown', event => this.onKey(event));
    document.addEventListener('keyup', event => this.navigationKeys.delete(event.code), true);
    document.addEventListener('focusin', event => {
      if (event.target !== ctx.renderer.domElement) this.clearNavigation();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { this.clearNavigation(); this.wearBrushTool.cancelStroke(); }
      this.resetPerformancePanel();
    });
    window.addEventListener('blur', () => { this.clearNavigation(); this.wearBrushTool.cancelStroke(); });
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('beforeunload', event => {
      if (!this.dirty && !this.importingFiles && !(this.projectTabs && this.projectTabs.hasUnsaved())) return;
      event.preventDefault();
      event.returnValue = '';
    });
    this.projectSync = new ProjectSync({
      client: this.projectClient, window, document,
      getState: () => this.projectSyncState(),
      onRefresh: (project, expected) => this.receiveRemoteProject(project, expected),
      onRemoteChange: project => this.markRemoteProject(project),
      onError: () => { this.storageAvailable = false; this.updateStatus(); }
    });
    window.addEventListener('pagehide', () => this.projectSync.stop());
    window.addEventListener('pageshow', () => { if (this.editorEnabled && !this.initializing && this.canEditDocument()) this.projectSync.start(); });
    this.ready = this.initialize();
  }

  async initialize() {
    const parameters = new URL(window.location).searchParams;
    this.explicitProject = parameters.has('project');
    // The public landing page uses the latest saved scene; a direct project
    // link must resolve that exact project in both desktop and VR runtime.
    // Public visits never restore browser-local authoring drafts.
    if (!this.editorEnabled && !this.explicitProject) this.rememberProject(null);
    try {
      this.entries = await this.library.getCatalog();
      this.renderAssets();
    } catch (error) { this.toast('Biblioteca: ' + error.message); }
    try { await this.checkStorageHealth(); }
    catch (error) {
      // A static host has no SQLite/account API. Keep its viewer useful without
      // opening local authoring drafts or treating API failure as edit access.
      this.staticPublic = true;
      this.storageAvailable = false;
    }
    if (this.accessView.enabled) {
      try { await this.accessView.initialize(parameters); }
      catch (error) { this.toast('Escenarios: ' + error.message); this.accessLoadFailed = true; }
      if (this.accessLoadFailed) { this.document.rooms.forEach(entry => { entry.root.visible = false; }); }
      await this.prepareRoom(this.roomId);
      if (!this.accessLoadFailed) this.startRuntime();
      this.initializing = false;
      if (this.editorEnabled && this.canEditDocument()) { this.enter(); this.projectSync.start(); }
      this.updateStatus(); return;
    }
    let lastProject, localBackup;
    try {
      if (this.editorEnabled) {
        lastProject = localStorage.getItem(ACTIVE_PROJECT_KEY);
        localBackup = localStorage.getItem(STORAGE_KEY);
      }
    }
    catch (error) { /* Browser storage may be unavailable. */ }
    let restored = false;
    if (this.storageAvailable) {
      try {
        const resolved = await resolveProject(this.projectClient, {
          explicitId: this.explicitProject ? parameters.get('project') : undefined,
          rememberedId: lastProject, hasLocalBackup: Boolean(localBackup)
        });
        if (resolved.project) {
          const requestedRoom = parameters.get('room'), initialRoom = resolved.project.document.studio && resolved.project.document.studio.startRoomId;
          await this.applyServerProject(resolved.project, {roomId: ROOM_IDS.includes(requestedRoom) ? requestedRoom : ROOM_IDS.includes(initialRoom) ? initialRoom : this.roomId});
          restored = true;
        }
      } catch (error) { this.toast('No se pudo abrir el proyecto guardado: ' + error.message); }
    }
    if (!restored && !this.explicitProject) {
      try {
        if (localBackup) {
          await this.document.load(JSON.parse(localBackup), {activeRoomId: this.roomId});
          this.entries = await this.library.getCatalog();
          // Legacy browser saves become a new server project on the first Save.
          this.dirty = true;
          this.toast('Copia del navegador recuperada. Pulsa Guardar para conservarla como proyecto.');
        }
      } catch (error) { this.toast('No se pudo recuperar la copia del navegador: ' + error.message); }
    }
    await this.prepareRoom(this.roomId);
    this.startRuntime();
    if (this.editorEnabled) this.enter();
    this.initializing = false;
    if (this.editorEnabled) this.projectSync.start();
    this.updateStatus();
  }

  get roomId() { return ROOM_IDS[this.ctx.room]; }
  get root() { return this.document.getRoot(this.roomId); }
  getSceneEntries() { return behaviorSchema.studio.sceneEntries(this.document).filter(entry => !this.accessView || this.accessView.canVisit(entry.id || entry.roomId || ROOM_IDS[entry.index])); }
  canEditDocument() { return !this.accessView || this.accessView.canEdit(); }
  scopedStorageKey(key) { const user = this.ctx.studio && this.ctx.studio.client.user || this.accessView && this.accessView.user; return this.accessView && this.accessView.enabled ? key + ':' + (user ? user.id : 'guest') : key; }

  buildUI() {
    this.launcher = button('◇ Abrir editor', 'Editar el escenario', () => this.enter());
    this.launcher.id = 'editor-launcher';
    this.launcher.hidden = !this.editorEnabled;
    this.returnButton = button('← Volver al editor', 'Terminar la prueba del escenario', () => this.enter());
    this.returnButton.id = 'editor-return';
    this.returnButton.hidden = true;
    this.ui = el('div', 'xr-editor');
    this.ui.id = 'scene-editor';
    this.ui.hidden = true;
    this.ui.setAttribute('aria-label', 'Editor de escenarios WebXR');
    const toolbar = this.toolbar = el('div', 'ed-toolbar');
    const brand = this.brand = el('div', 'ed-brand');
    brand.appendChild(el('span', 'ed-logo', '◇'));
    const brandText = el('div');
    brandText.appendChild(el('strong', '', 'SMART-TWIN Simulator'));
    brandText.appendChild(el('small', '', 'Editor de escenarios WebXR'));
    brand.appendChild(brandText);
    toolbar.appendChild(brand);
    this.roomSelect = el('select', 'ed-room-select');
    this.roomSelect.setAttribute('aria-label', 'Escenario a editar');
    ROOM_LABELS.forEach((name, i) => {
      const option = el('option', '', name);
      option.value = i;
      this.roomSelect.appendChild(option);
    });
    this.roomSelect.value = this.ctx.room;
    this.roomSelect.addEventListener('change', () => {
      if (this.loadingProject) { this.roomSelect.value = this.ctx.room; return this.toast('Espera a que termine de cargar el proyecto.'); }
      this.hooks.gotoRoom(Number(this.roomSelect.value));
    });
    toolbar.appendChild(this.roomSelect);
    const tools = el('div', 'ed-toolbar-group');
    this.toolButtons = {};
    [['translate', '↔ Mover'], ['rotate', '⟳ Rotar'], ['scale', '⤢ Escalar']].forEach(([mode, label]) => {
      const tool = button(label, label + ' · Espacio alterna mover, rotar y escalar', () => this.setTool(mode), mode === 'translate' ? 'active' : '');
      this.toolButtons[mode] = tool;
      tools.appendChild(tool);
    });
    toolbar.appendChild(tools);
    this.snapButton = button('Cuadrícula: no', 'Ajustar movimiento a 0,25 m y giro a 15°', () => {
      this.snap = !this.snap;
      this.transform.setTranslationSnap(this.snap ? 0.25 : null);
      this.transform.setRotationSnap(this.snap ? Math.PI / 12 : null);
      this.transform.setScaleSnap(this.snap ? 0.1 : null);
      this.snapButton.textContent = 'Cuadrícula: ' + (this.snap ? 'sí' : 'no');
      this.snapButton.classList.toggle('active', this.snap);
    });
    toolbar.appendChild(this.snapButton);
    this.undoButton = button('↶', 'Deshacer · Ctrl Z', () => this.perform(() => this.historyStep('undo')));
    this.redoButton = button('↷', 'Rehacer · Ctrl Shift Z', () => this.perform(() => this.historyStep('redo')));
    toolbar.appendChild(this.undoButton);
    toolbar.appendChild(this.redoButton);
    this.appendAudioControls(toolbar);
    toolbar.appendChild(button('Zona de sonido', 'Añadir un emisor de ambiente invisible y sin colisiones', () => this.createAudioZone()));
    this.projectButton = button('Proyectos', 'Abrir, crear y recuperar versiones de proyectos guardados', () => this.projectLibrary.open(), 'ed-project-current');
    toolbar.appendChild(this.projectButton);
    toolbar.appendChild(button('Compartir enlace', 'Copiar el enlace del proyecto guardado para otra pestaña o navegador', () => this.perform(() => this.shareProject())));
    this.projectUpdateButton = button('Actualizar proyecto', 'Cargar la versión guardada en otra pestaña', () => this.refreshRemoteProject().catch(error => this.toast(error.message)), 'primary');
    this.projectUpdateButton.hidden = true; toolbar.appendChild(this.projectUpdateButton);
    this.saveButton = button('Guardar', 'Guardar proyecto en el servidor · Ctrl S', () => this.perform(() => this.saveProject()));
    toolbar.appendChild(this.saveButton);
    toolbar.appendChild(button('↓ JSON', 'Descargar escenario e importaciones', () => this.exportProject()));
    toolbar.appendChild(button('Importar JSON', 'Abrir una copia de escenario JSON', () => this.projectInput.click()));
    toolbar.appendChild(button('Variables y datos', 'Monitor, mandos de simulación, registros y analítica', () => this.simulationPanel.toggle()));
    this.playButton = button('▶ Probar', 'Recorrer el escenario con sus interacciones y entrar a VR', () => this.leave(), 'primary');
    toolbar.appendChild(this.playButton);
    this.ui.appendChild(toolbar);

    this.hierarchy = el('aside', 'ed-hierarchy');
    const treeHeader = this.treeHeader = el('div', 'ed-panel-title', 'JERARQUÍA DE ESCENA');
    this.treeCount = el('span', 'ed-count');
    treeHeader.appendChild(this.treeCount);
    this.hierarchy.appendChild(treeHeader);
    this.treeSearch = el('input');
    this.treeSearch.type = 'search';
    this.treeSearch.placeholder = 'Buscar objetos…';
    this.treeSearch.setAttribute('aria-label', 'Buscar en la jerarquía');
    this.treeSearch.addEventListener('input', () => this.renderTree());
    this.hierarchy.appendChild(this.treeSearch);
    const createRow = el('div', 'ed-actions');
    const primitiveSelect = el('select');
    primitiveSelect.setAttribute('aria-label', 'Tipo de objeto nuevo');
    [['box', 'Cubo'], ['sphere', 'Esfera'], ['plane', 'Plano'], ['cylinder', 'Cilindro']].forEach(([id, label]) => {
      const option = el('option', '', label); option.value = id; primitiveSelect.appendChild(option);
    });
    createRow.appendChild(primitiveSelect);
    createRow.appendChild(button('+ Añadir', 'Crear una figura en la escena', () => this.perform(() => {
      return this.createPlacedObject(() => this.document.addPrimitive(this.roomId, primitiveSelect.value));
    })));
    this.hierarchy.appendChild(createRow);
    const prefabRow = el('div', 'ed-actions');
    const prefabSelect = el('select'); prefabSelect.setAttribute('aria-label', 'Equipo preestablecido');
    industrialPrefabs.forEach(prefab => { const option = el('option', '', prefab.label); option.value = prefab.id; option.title = prefab.description; prefabSelect.appendChild(option); });
    prefabRow.appendChild(prefabSelect);
    prefabRow.appendChild(button('+ Equipo', 'Añadir equipo con componentes, sensores y mandos preconfigurados', () => this.perform(() => {
      const preset = industrialPrefabs.find(item => item.id === prefabSelect.value);
      const object = this.createPlacedObject(() => this.document.addPrefab(this.roomId, preset && preset.prefab || prefabSelect.value, preset && preset.variant));
      this.focus();
      this.toast('Equipo añadido. Selecciona sus sensores y PLC en la jerarquía; usa Probar y Variables y datos para operarlo.');
      return object;
    })));
    this.hierarchy.appendChild(prefabRow);
    this.hierarchy.appendChild(button('+ Caja', 'Crear una caja manipulable para cargarla manualmente sobre la banda', () => this.perform(() => {
      const object = this.createPlacedObject(() => this.document.addPrefab(this.roomId, 'product'));
      this.toast('En Probar: pulsa la caja para tomarla; usa la rueda para acercarla o alejarla y vuelve a pulsar para soltarla sobre la banda.');
      return object;
    })));
    this.hierarchy.appendChild(button('+ Decal', 'Elegir una imagen y proyectarla sobre una superficie', () => this.startDecalPlacement(), 'ed-add-decal'));
    const sceneActions = el('div', 'ed-actions');
    sceneActions.appendChild(button('Base vacía', 'Crear una base con cielo, iluminación, suelo, cámara y punto de inicio. Puedes deshacerlo.', () => this.emptyRoom()));
    sceneActions.appendChild(button('Restaurar', 'Recuperar la sala original. Puedes deshacerlo.', () => this.perform(() => { this.document.resetRoom(this.roomId); this.select(null); })));
    this.hierarchy.appendChild(sceneActions);
    this.tree = el('div', 'ed-tree');
    this.tree.setAttribute('role', 'tree');
    this.hierarchy.appendChild(this.tree);
    this.ui.appendChild(this.hierarchy);

    this.viewport = el('main', 'ed-viewport');
    this.viewport.setAttribute('aria-label', 'Vista 3D del escenario');
    const viewportLabel = el('div', 'ed-viewport-label');
    viewportLabel.appendChild(el('span', 'ed-tag', 'ESCENA 3D'));
    this.roomLabel = el('span', '', ROOM_LABELS[this.ctx.room]);
    viewportLabel.appendChild(this.roomLabel);
    this.viewport.appendChild(viewportLabel);
    this.decalPlacementBar = el('div', 'ed-decal-placement'); this.decalPlacementBar.hidden = true;
    this.decalPlacementLabel = el('span'); this.decalPlacementBar.appendChild(this.decalPlacementLabel);
    this.decalPlacementBar.appendChild(button('Cancelar · Esc', 'Cancelar la colocación del decal', () => this.cancelDecalPlacement()));
    this.viewport.appendChild(this.decalPlacementBar);
    const viewTools = el('div', 'ed-view-tools');
    this.assemblyButton = button('Ensamble: sí', 'Unir bandas por sus puertos y ajustar cajas u objetos a superficies y caras cercanas', () => {
      if (this.transform.dragging) return;
      this.assembly.enabled = !this.assembly.enabled;
      this.objectAssembly.enabled = this.assembly.enabled;
      this.assemblyButton.textContent = 'Ensamble: ' + (this.assembly.enabled ? 'sí' : 'no');
      this.assemblyButton.classList.toggle('active', this.assembly.enabled);
      this.refreshAssembly();
    }, 'active');
    viewTools.appendChild(this.assemblyButton);
    viewTools.appendChild(button('F Enfocar', 'Centrar la vista en el objeto seleccionado', () => this.focus()));
    viewTools.appendChild(button('Inicio', 'Volver a la vista inicial', () => this.home()));
    this.gridButton = button('Cuadrícula', 'Mostrar u ocultar cuadrícula', () => {
      this.showGrid = !this.showGrid; this.grid.visible = this.showGrid; this.gridButton.classList.toggle('active', this.showGrid);
    });
    viewTools.appendChild(this.gridButton);
    viewTools.appendChild(button('Rendimiento', 'Ver FPS, dibujos, triángulos y recursos gráficos de la sala activa', () => {
      this.performancePanel.hidden = !this.performancePanel.hidden;
      this.resetPerformancePanel();
    }));
    this.performancePanel = el('div', 'ed-performance'); this.performancePanel.hidden = true;
    this.performanceMetrics = el('output', 'ed-performance-metrics'); this.performancePanel.appendChild(this.performanceMetrics);
    this.viewport.appendChild(this.performancePanel);
    this.viewport.appendChild(viewTools);
    this.assemblyHint = el('div', 'ed-assembly-hint'); this.assemblyHint.hidden = true;
    this.viewport.appendChild(this.assemblyHint);
    this.viewportHelp = el('div', 'ed-viewport-help', 'WASD: navegar · Q: subir · E: bajar · Arrastrar: mover línea · Ctrl + arrastrar: separar módulo · Espacio: mover / rotar / escalar · Botón derecho: orbitar · Rueda: zoom · Botón central: desplazar');
    this.viewport.appendChild(this.viewportHelp);
    this.ui.appendChild(this.viewport);
    this.inspector = el('aside', 'ed-inspector');
    this.ui.appendChild(this.inspector);

    const assets = this.assets = el('section', 'ed-assets');
    const assetsHead = el('div', 'ed-assets-head');
    assetsHead.appendChild(el('strong', '', 'ARCHIVOS DEL PROYECTO'));
    this.assetSearch = el('input');
    this.assetSearch.type = 'search';
    this.assetSearch.placeholder = 'Buscar archivos…';
    this.assetSearch.setAttribute('aria-label', 'Buscar archivos');
    this.assetSearch.addEventListener('input', () => { this.assetQuery = this.assetSearch.value; this.renderAssets(); });
    assetsHead.appendChild(this.assetSearch);
    this.kindSelect = el('select');
    this.kindSelect.setAttribute('aria-label', 'Filtrar archivos por tipo');
    [['all', 'Todos'], ['model', 'Modelos 3D'], ['image', 'Imágenes'], ['audio', 'Audio'], ['video', 'Vídeo'], ['source', 'Blender'], ['text', 'Datos y código'], ['other', 'Otros']].forEach(([id, label]) => {
      const option = el('option', '', label); option.value = id; this.kindSelect.appendChild(option);
    });
    this.kindSelect.addEventListener('change', () => { this.assetKind = this.kindSelect.value; this.renderAssets(); });
    assetsHead.appendChild(this.kindSelect);
    assetsHead.appendChild(button('↑ Importar archivos', 'Importar modelos, imágenes y audios. Selecciona juntos el GLTF y sus dependencias.', () => this.assetInput.click()));
    assets.appendChild(assetsHead);
    const assetsBody = el('div', 'ed-assets-body');
    this.folderList = el('nav', 'ed-folder-list');
    this.folderList.setAttribute('aria-label', 'Carpetas de archivos');
    this.assetGrid = el('div', 'ed-asset-grid');
    this.preview = el('div', 'ed-preview');
    this.preview.appendChild(el('p', 'ed-hint', 'Selecciona un archivo para previsualizarlo. Arrastra un modelo a la vista 3D para añadirlo.'));
    assetsBody.appendChild(this.folderList);
    assetsBody.appendChild(this.assetGrid);
    assetsBody.appendChild(this.preview);
    assets.appendChild(assetsBody);
    this.ui.appendChild(assets);
    this.status = el('footer', 'ed-status');
    this.ui.appendChild(this.status);
    this.toastNode = el('div', 'ed-toast');
    this.toastNode.hidden = true;
    this.toastNode.setAttribute('role', 'status');
    this.projectInput = el('input');
    this.projectInput.type = 'file'; this.projectInput.accept = '.json'; this.projectInput.hidden = true;
    this.projectInput.addEventListener('change', async () => {
      const file = this.projectInput.files[0];
      if (file) await this.perform(async () => {
        if (this.busy || this.loadingProject || this.pastingObject) throw new Error('Espera a que termine la operación actual.');
        const data = JSON.parse(await file.text());
        if (this.currentProject) await this.keepCurrentProject();
        this.projectGeneration++;
        this.clearAssetPreview();
        this.assetThumbnails.dispose();
        this.cancelDecalPlacement(); this.decals.dispose();
        this.infoPreview.dispose();
        await this.document.load(data, {activeRoomId: this.roomId});
        await this.prepareRoom(this.roomId);
        this.clearObjectClipboard();
        this.currentProject = null;
        this.projectName = file.name.replace(/\.json$/i, '') || 'Escenario importado';
        this.rememberProject(null);
        this.entries = await this.library.getCatalog();
        this.renderAssets();
        this.select(null);
        this.toast('Escenario importado. Pulsa Guardar para crear su proyecto en el servidor.');
      });
      this.projectInput.value = '';
    });
    this.assetInput = el('input');
    this.assetInput.type = 'file'; this.assetInput.multiple = true; this.assetInput.hidden = true;
    this.assetInput.addEventListener('change', async () => {
      if (this.assetInput.files.length) await this.perform(async () => {
        const imported = await this.importFiles(Array.from(this.assetInput.files));
        this.entries = await this.library.getCatalog();
        this.folder = '@imports';
        if (this.resourceBrowser) this.resourceBrowser.showProjectFiles();
        this.renderAssets();
        this.dirty = true;
        if (imported[0]) this.previewAsset(imported[0]);
        this.toast(imported.length + ' archivo(s) importado(s). Doble clic en un modelo para añadirlo.');
      });
      this.assetInput.value = '';
    });
    document.body.appendChild(this.toastNode);
    if (this.editorEnabled) {
      document.body.appendChild(this.ui);
      document.body.appendChild(this.launcher);
      document.body.appendChild(this.returnButton);
      document.body.appendChild(this.projectInput);
      document.body.appendChild(this.assetInput);
    }
    this.sharePanel = el('section', 'ed-share-project'); this.sharePanel.hidden = true;
    this.sharePanel.setAttribute('aria-label', 'Enlace del proyecto guardado');
    this.sharePanel.appendChild(el('strong', '', 'Enlace de edición para otra pestaña o navegador'));
    this.shareLinkInput = el('input'); this.shareLinkInput.readOnly = true; this.shareLinkInput.setAttribute('aria-label', 'Enlace del proyecto');
    this.sharePanel.appendChild(this.shareLinkInput);
    this.shareOpenLink = el('a', 'ed-button', 'Abrir proyecto'); this.shareOpenLink.target = '_blank'; this.shareOpenLink.rel = 'noopener noreferrer'; this.sharePanel.appendChild(this.shareOpenLink);
    this.sharePanel.appendChild(button('Cerrar', 'Cerrar el enlace del proyecto', () => { this.sharePanel.hidden = true; }));
    if (this.editorEnabled) document.body.appendChild(this.sharePanel);
    this.renderInspector();
  }

  bindViewport() {
    const canvas = this.ctx.renderer.domElement;
    if (this.editorEnabled) {
      canvas.tabIndex = 0;
      canvas.setAttribute('aria-label', 'Vista 3D del escenario · WASD para navegar · Q subir · E bajar');
    }
    let down;
    // Capture runs before TransformControls' pointer-down listener, so the
    // detach choice belongs to this gesture and cannot change half-way through.
    const captureDragModifier = event => { this.detachDragModifier = Boolean(event.ctrlKey || event.metaKey); };
    canvas.addEventListener('pointerdown', captureDragModifier, true);
    canvas.addEventListener('mousedown', captureDragModifier, true);
    canvas.addEventListener('wheel', event => {
      if (!this.active || this.ctx.vrMode || this.transform.dragging || this.wearBrush || this.decalPlacement) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.viewport.clientHeight || 600 : 1);
      this.pendingZoom = THREE.Math.clamp((this.pendingZoom || 0) + THREE.Math.clamp(pixels, -160, 160) * .0012, -.65, .65);
    }, {capture: true, passive: false});
    canvas.addEventListener('pointerdown', event => {
      if (!this.active) return;
      if (canvas.focus) canvas.focus({preventScroll: true});
      if (this.wearBrush && this.wearBrushTool.down(event)) { down = null; return; }
      if (event.button === 0) down = [event.clientX, event.clientY];
    });
    canvas.addEventListener('pointermove', event => { if (this.active && this.wearBrush) this.wearBrushTool.move(event); });
    canvas.addEventListener('pointercancel', event => this.wearBrushTool.cancelStroke(event));
    canvas.addEventListener('lostpointercapture', event => this.wearBrushTool.cancelStroke(event));
    canvas.addEventListener('pointerup', event => {
      if (this.active && this.wearBrush && this.wearBrushTool.up(event)) { down = null; return; }
      if (!this.active || event.button !== 0 || !down) return;
      const moved = Math.hypot(event.clientX - down[0], event.clientY - down[1]); down = null;
      if (moved > 4 || (!this.decalPlacement && this.transform.axis) || this.transform.dragging) return;
      const rect = canvas.getBoundingClientRect();
      const pointer = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      this.camera.updateMatrixWorld(true);
      const ray = new THREE.Raycaster(); ray.setFromCamera(pointer, this.camera);
      this.root.updateMatrixWorld(true);
      const hits = ray.intersectObject(this.root, true).filter(hit => {
        const object = hit.object;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        return visibleInTree(object) && !object.userData.editorHelper && (!object.userData.editorRuntimeHelper || object.userData.editorInfoPreview || object.userData.editorDecal) &&
          !object.userData.editorGeometryReplaced && !materials.every(material => material && material.visible === false);
      });
      if (this.decalPlacement) {
        const surface = hits.find(hit => this.decals.isSurface(hit.object));
        if (surface) this.perform(() => this.placeDecalAtHit(surface, ray.ray.direction));
        else this.toast('Apunta a una pared, suelo o superficie visible para colocar el decal.');
        return;
      }
      this.select(hits.length ? this.document.getEditableObject(hits[0].object) : null);
    });
    this.viewport.addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; });
    this.viewport.addEventListener('drop', event => {
      event.preventDefault();
      if (this.resourceBrowser && this.resourceBrowser.dropEvent(event)) return;
      const id = event.dataTransfer.getData('application/x-webxr-asset');
      if (id) {
        const entry = this.entries.find(item => (item.importId || item.path) === id);
        if (entry && PLACEABLE_KINDS.includes(entry.kind)) this.addAsset(entry);
      } else if (event.dataTransfer.files.length) {
        this.perform(async () => {
          const imported = await this.importFiles(Array.from(event.dataTransfer.files));
          this.entries = await this.library.getCatalog();
          this.folder = '@imports';
          if (this.resourceBrowser) this.resourceBrowser.showProjectFiles();
          this.renderAssets(); this.dirty = true;
          const model = imported.find(item => PLACEABLE_KINDS.includes(item.kind));
          if (model) await this.addAsset(model);
        });
      }
    });
  }

  enter() {
    if (!this.editorEnabled || this.active || this.ctx.vrMode) return;
    if (!this.canEditDocument()) { if (this.ctx.studio) this.ctx.studio.open('account'); return; }
    this.resetPerformancePanel();
    this.clearNavigation();
    this.stopRuntime();
    this.hooks.unlock();
    this.hooks.clearKeyboard();
    this.ctx.goto = null;
    this.active = true;
    this.ctx.raycontrol.disable();
    prepareNativeEdit(this.ctx, this.root);
    this.infoPreview.sync(this.roomId, this.camera);
    this.ui.hidden = false;
    this.launcher.hidden = true;
    this.returnButton.hidden = true;
    document.body.classList.add('editor-mode');
    this.viewport.appendChild(this.ctx.renderer.domElement);
    this.ctx.cameraRig.visible = false;
    this.orbit.enabled = true;
    this.collisionWorld.refresh();
    this.constrainEditorCamera();
    this.transform.enabled = true;
    this.grid.visible = Boolean(this.showGrid);
    this.roomSelect.value = this.ctx.room;
    this.roomLabel.textContent = ROOM_LABELS[this.ctx.room];
    this.renderAssets();
    this.select(this.selected); this.resize(); this.updateStatus();
    this.simulationPanel.modeChanged();
    if (this.shell) this.shell.modeChanged();
    if (this.projectSync) this.projectSync.check();
  }

  leave() {
    if (!this.active) return;
    if (this.loadingProject) return this.toast('Espera a que termine de cargar el proyecto.');
    if (this.transform.dragging) this.transform.dragging = false;
    this.cancelDecalPlacement();
    this.clearAssembly();
    this.syncNative();
    this.infoPreview.dispose();
    this.clearNavigation();
    this.active = false;
    this.clearAssembly();
    this.orbit.enabled = false;
    this.transform.enabled = false;
    this.transform.detach();
    this.box.visible = false; this.grid.visible = false;
    this.clearAssetPreview();
    if (this.resourceBrowser) this.resourceBrowser.setActive(false);
    this.assetThumbnails.dispose();
    this.ui.hidden = true;
    document.body.classList.remove('editor-mode');
    document.body.appendChild(this.ctx.renderer.domElement);
    this.ctx.cameraRig.visible = true;
    this.ctx.raycontrol.enable();
    this.hooks.clearKeyboard();
    this.launcher.hidden = true;
    this.returnButton.hidden = !this.editorEnabled || this.ctx.vrMode || !this.canEditDocument();
    this.resize();
    this.startRuntime();
    this.simulationPanel.modeChanged();
    if (this.shell) this.shell.modeChanged();
    this.toast('Prueba del escenario · WASD para moverte · Esc libera el mouse · ENTER VR para el visor');
  }

  onVRChange(inVR) {
    if (this.cadWorkbench) this.cadWorkbench.close();
    if (this.vehicleRoutes) this.vehicleRoutes.close();
    this.clearNavigation();
    if (this.vehicleDriving) this.vehicleDriving.unmount(true);
    this.simulation.onInputModeChange(inVR);
    if (this.ctx.resetCollisionPose) this.ctx.resetCollisionPose();
    if (this.ctx.editorXylophone && this.ctx.editorXylophone.releaseHeld) this.ctx.editorXylophone.releaseHeld();
    if (inVR) this.projectLibrary.close();
    if (inVR && this.active) this.leave();
    this.launcher.hidden = !this.editorEnabled || inVR || this.active || !this.canEditDocument();
    this.returnButton.hidden = !this.editorEnabled || inVR || this.active || !this.canEditDocument();
    this.resize();
    this.simulationPanel.modeChanged();
    if (this.shell) this.shell.modeChanged();
  }

  beforeRoomChange() { this.cancelTransformDrag(); this.clearAssembly(true); this.clearNavigation(); this.cancelDecalPlacement(); this.decals.dispose(); this.infoPreview.dispose(); this.stopRuntime(); this.select(null); }
  afterRoomChange() {
    this.resetPerformancePanel();
    this.collisionWorld.setRoom(this.roomId);
    this.performance.setRoom(this.roomId);
    this.safeCameraPosition = null;
    this.safeOrbitTarget = null;
    if (this.ctx.resetCollisionPose) this.ctx.resetCollisionPose();
    this.roomSelect.value = this.ctx.room;
    this.roomLabel.textContent = ROOM_LABELS[this.ctx.room];
    this.decals.sync(this.roomId);
    this.industrialVisuals.invalidate();
    if (this.active) { prepareNativeEdit(this.ctx, this.root); this.infoPreview.sync(this.roomId, this.camera); this.home(); this.renderTree(); }
    else this.startRuntime();
    this.simulationPanel.modeChanged();
    if (this.entities) this.entities.sync();
    this.renderAssets();
    this.updateStatus();
    if (!this.loadingProject && this.currentProject) this.rememberProject(this.currentProject);
  }

  render(delta = 0) {
    if (this.document.syncCADAttachments) this.document.syncCADAttachments();
    this.collisionWorld.refresh();
    this.updateSmoothZoom(delta);
    this.orbit.update();
    this.constrainEditorCamera();
    this.updateNavigation(delta);
    this.root.updateMatrixWorld(true);
    this.syncSurfaceMaterials();
    this.performance.update(this.camera, delta);
    this.infoPreview.sync(this.roomId, this.camera);
    this.decals.sync(this.roomId);
    this.wearPaint.sync(this.roomId);
    if (!this.pendingEdits && !this.loadingProject && !this.document.loading && !this.transform.dragging) this.industrialVisuals.sync(this.roomId, delta, true);
    if (this.finishes && !this.pendingEdits && !this.loadingProject && !this.document.loading) this.finishes.sync(this.roomId, delta);
    if (this.document.syncCADAttachments) this.document.syncCADAttachments();
    if (!this.pendingEdits && !this.loadingProject && !this.document.loading && !this.transform.dragging) this.lineMonitors.sync(this.roomId, delta, true);
    // Asset replacement and document hydration temporarily detach/rebuild the
    // selected actor. r112 BoxHelper turns those intermediate bounds into NaNs.
    if (this.selected && !this.pendingEdits && !this.loadingProject && !this.document.loading) this.box.update();
    this.hooks.renderScene.updateMatrixWorld(true);
    this.ctx.renderer.render(this.hooks.renderScene, this.camera);
    this.updatePerformancePanel(delta);
  }

  stopRuntime() {
    if (this.performance && this.performance.clearPresentation) this.performance.clearPresentation();
    if (this.simulationPanel) this.simulationPanel.endSession();
    if (this.finishes) this.finishes.dispose();
    this.industrialVisuals.dispose();
    this.industrialAudio.stop();
    this.lineMonitors.dispose();
    this.materials.dispose(); this.wearPaint.dispose();
    this.simulation.stop(); this.behaviors.stop(); this.interactions.stop();
  }

  syncSurfaceMaterials() {
    if (this.pendingEdits || this.loadingProject || this.document.loading || this.transform && this.transform.dragging) return;
    if ((this.materials.dirty || this.materials.roomId !== this.roomId) && this.performance.clearPresentation) this.performance.clearPresentation();
    const ready = this.materials.sync(this.roomId);
    // Animated rollers own private texture copies. Rebind those wrappers when
    // an asynchronous PBR image finishes loading, keeping its native motion.
    if (ready && ready.then && ready !== this.materialReady) {
      this.materialReady = ready;
      ready.then(() => {
        if (this.materialReady !== ready) return;
        this.industrialVisuals.dispose(); this.industrialVisuals.invalidate(); this.performance.invalidate();
      }).catch(error => this.toast(error.message));
    }
  }

  syncSurfaceVisuals() {
    this.syncSurfaceMaterials();
    if (!this.pendingEdits && !this.loadingProject && !this.document.loading) this.wearPaint.sync(this.roomId);
  }

  startWearBrush(object = this.selected) { this.clearAssembly(); this.wearBrushTool.start(object); }
  stopWearBrush() { this.wearBrushTool.stop(); this.refreshAssembly(); }
  startRuntime() {
    this.simulationPaused = false;
    this.interactions.start(this.roomId); this.behaviors.start(this.roomId); this.simulation.start(this.roomId);
    this.industrialAudio.start(this.roomId);
    this.syncSurfaceVisuals();
    this.decals.sync(this.roomId);
    this.industrialVisuals.invalidate();
    if (!this.pendingEdits && !this.loadingProject && !this.document.loading) this.industrialVisuals.sync(this.roomId, 0, false);
    if (!this.pendingEdits && !this.loadingProject && !this.document.loading) this.lineMonitors.sync(this.roomId, 0, false);
    if (this.simulationPanel) this.simulationPanel.modeChanged();
  }
  execute(delta, time) {
    if (this.document.syncCADAttachments) this.document.syncCADAttachments();
    this.root.updateMatrixWorld(true);
    this.syncSurfaceMaterials();
    this.performance.update(this.ctx.camera, delta);
    if (this.vehicleDriving) this.vehicleDriving.beforeStep();
    if (!this.simulationPaused) { this.behaviors.execute(delta, time); this.simulation.execute(delta, time); }
    if (this.vehicleDriving) this.vehicleDriving.follow();
    if (this.document.syncCADAttachments) this.document.syncCADAttachments();
    this.industrialAudio.sync(this.roomId, delta, this.simulationPaused);
    if (!this.pendingEdits && !this.loadingProject && !this.document.loading) this.industrialVisuals.sync(this.roomId, this.simulationPaused ? 0 : delta, false);
    if (this.finishes && !this.pendingEdits && !this.loadingProject && !this.document.loading) this.finishes.sync(this.roomId, delta);
    if (!this.pendingEdits && !this.loadingProject && !this.document.loading) this.lineMonitors.sync(this.roomId, this.simulationPaused ? 0 : delta, false);
    this.decals.sync(this.roomId);
    this.wearPaint.sync(this.roomId);
    this.simulationPanel.tick();
    if (this.performance.syncPresentation) this.performance.syncPresentation(false);
  }

  resize() {
    const width = this.active ? Math.max(1, this.viewport.clientWidth) : window.innerWidth;
    const height = this.active ? Math.max(1, this.viewport.clientHeight) : window.innerHeight;
    if (this.ctx.graphics && this.ctx.graphics.setViewport) this.ctx.graphics.setViewport(width, height, window.devicePixelRatio || 1);
    this.ctx.renderer.setSize(width, height);
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
    this.ctx.camera.aspect = window.innerWidth / window.innerHeight; this.ctx.camera.updateProjectionMatrix();
  }

  home() {
    this.stopOrbitMotion(); this.pendingZoom = 0;
    const config = (this.document.studio && this.document.studio.entities || []).find(item => item.roomId === this.roomId && item.type === 'camera');
    const owner = config && this.document.getObject(config.objectId);
    if (owner && visibleInTree(owner)) {
      owner.updateWorldMatrix(true, false);
      owner.getWorldPosition(this.camera.position); owner.getWorldQuaternion(this.camera.quaternion);
      this.camera.fov = Number.isFinite(config.fov) ? config.fov : 55; this.camera.updateProjectionMatrix();
      this.orbit.target.copy(this.camera.position).addScaledVector(this.camera.getWorldDirection(new THREE.Vector3()), 12);
      // An authored camera is a deliberate destination, not a movement from
      // the previous level through its walls or roof.
      this.safeCameraPosition = null; this.safeOrbitTarget = null;
      this.orbit.update(); this.constrainEditorCamera(false); return;
    }
    this.camera.position.set(3.2, 2.8, 4.5); this.orbit.target.set(0, 1, -1); this.orbit.update();
    this.constrainEditorCamera(false);
  }
  focus() {
    if (!this.selected) return;
    this.stopOrbitMotion(); this.pendingZoom = 0;
    const box = new THREE.Box3().setFromObject(this.selected);
    if (box.isEmpty()) box.setFromCenterAndSize(this.selected.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(.5, .5, .5));
    const center = box.getCenter(new THREE.Vector3());
    const distance = THREE.Math.clamp(box.getSize(new THREE.Vector3()).length() * 1.4, 0.6, 40);
    const direction = this.camera.position.clone().sub(this.orbit.target).normalize();
    this.orbit.target.copy(center); this.camera.position.copy(center).addScaledVector(direction, distance); this.orbit.update();
    this.constrainEditorCamera(false);
  }

  constrainEditorCamera(adjustTarget = true) {
    const desired = this.camera.position.clone();
    const previous = this.safeCameraPosition || desired;
    const resolved = this.collisionWorld.moveSphere(previous, desired, 0.18);
    // OrbitControls handles wheel, pan and orbit events between animation frames.
    // Retain the previous accepted pose so a large input cannot skip a wall.
    if (adjustTarget && this.safeOrbitTarget && this.orbit.target.distanceToSquared(this.safeOrbitTarget) > 1e-12) {
      this.orbit.target.add(resolved.clone().sub(desired));
    }
    this.camera.position.copy(resolved);
    this.camera.lookAt(this.orbit.target);
    this.safeCameraPosition = resolved.clone();
    this.safeOrbitTarget = this.orbit.target.clone();
  }
  setTool(mode) {
    if ((!TOOL_MODES.includes(mode) && mode !== 'select') || this.transform.dragging) return;
    this.toolMode = mode;
    if (mode === 'select') this.transform.detach();
    else { this.transform.setMode(mode); if (this.selected && this.active) this.transform.attach(this.selected); }
    Object.keys(this.toolButtons).forEach(key => this.toolButtons[key].classList.toggle('active', key === mode));
  }

  clearNavigation() { this.navigationKeys.clear(); this.pendingZoom = 0; }

  stopOrbitMotion() {
    if (!this.orbit || !this.camera) return;
    const position = this.camera.position.clone(), quaternion = this.camera.quaternion.clone(), target = this.orbit.target.clone(), damping = this.orbit.enableDamping;
    this.orbit.enableDamping = false; this.orbit.update(); this.camera.position.copy(position); this.camera.quaternion.copy(quaternion); this.orbit.target.copy(target); this.orbit.enableDamping = damping;
    this.orbit.update();
  }

  updateSmoothZoom(delta) {
    if (!this.active || this.transform.dragging || !this.pendingZoom || !Number.isFinite(delta) || delta <= 0) return;
    const amount = this.pendingZoom * (1 - Math.exp(-Math.min(delta, .1) / .075)); this.pendingZoom -= amount;
    if (Math.abs(this.pendingZoom) < 1e-5) this.pendingZoom = 0;
    const offset = this.camera.position.clone().sub(this.orbit.target), distance = offset.length(); if (distance < 1e-5) return;
    const desired = THREE.Math.clamp(distance * Math.exp(amount), Math.max(.1, this.orbit.minDistance || 0), this.orbit.maxDistance || Infinity);
    this.camera.position.copy(this.orbit.target).add(offset.multiplyScalar(desired / distance));
  }

  keyboardOverlayOpen() {
    return Boolean(this.projectLibrary.opened || this.projectLibrary.overlay && !this.projectLibrary.overlay.hidden ||
      this.simulationPanel && this.simulationPanel.opened || this.sharePanel && !this.sharePanel.hidden || this.shell && (this.shell.menuIndex >= 0 || this.shell.workspace));
  }

  updateNavigation(delta) {
    if (!this.active || this.ctx.vrMode || this.loadingProject || this.transform.dragging || this.keyboardOverlayOpen() ||
      isTyping({target: document.activeElement || {}})) {
      this.clearNavigation();
      return;
    }
    if (!Number.isFinite(delta) || delta <= 0) return;
    const forward = Number(this.navigationKeys.has('KeyW')) - Number(this.navigationKeys.has('KeyS'));
    const right = Number(this.navigationKeys.has('KeyD')) - Number(this.navigationKeys.has('KeyA'));
    const vertical = Number(this.navigationKeys.has('KeyQ')) - Number(this.navigationKeys.has('KeyE'));
    if (!forward && !right && !vertical) return;
    const direction = this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(forward);
    const lateral = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    direction.addScaledVector(lateral, right);
    direction.y += vertical;
    direction.normalize().multiplyScalar(3 * Math.min(delta, 0.1));
    const previous = this.camera.position.clone();
    const resolved = this.collisionWorld.moveSphere(previous, previous.clone().add(direction), 0.18);
    // Keep looking in the same direction while sliding along solid surfaces.
    this.camera.position.copy(resolved);
    this.orbit.target.add(resolved.clone().sub(previous));
    this.safeCameraPosition = resolved.clone();
    this.safeOrbitTarget = this.orbit.target.clone();
  }
  select(object) {
    object = this.document.getEditableObject(object);
    if (this.wearBrush && object !== this.wearBrush.owner) this.stopWearBrush();
    this.selected = object;
    if (object || this.loadingProject) this.inspectorTab = 'object';
    if (object && this.active && !this.decalPlacement && !this.wearBrush) {
      if (this.toolMode !== 'select') this.transform.attach(object); else this.transform.detach();
      this.box.setFromObject(object); this.box.visible = visibleInTree(object) && !(object.userData.editorDescriptor && object.userData.editorDescriptor.type === 'audioZone');
    } else { if (this.transform) this.transform.detach(); if (this.box) this.box.visible = false; }
    this.refreshAssembly();
    this.renderTree(); this.renderInspector();
  }

  assemblyMessage(message = '') {
    if (!this.assemblyHint) return;
    this.assemblyHint.textContent = message;
    this.assemblyHint.hidden = !message || !this.active;
  }

  assemblyFor(object) {
    if (object && this.assembly.supported(object)) return this.assembly;
    return this.objectAssembly && this.objectAssembly.supported(object) ? this.objectAssembly : null;
  }

  clearAssembly(reset = false) {
    if (this.assembly) this.assembly[reset ? 'reset' : 'clear']();
    if (this.objectAssembly) this.objectAssembly[reset ? 'reset' : 'clear']();
    this.assemblyMessage('');
  }

  refreshAssembly() {
    if (!this.assembly) return;
    const tool = this.assemblyFor(this.selected);
    if (!this.active || this.loadingProject || this.document.loading || this.decalPlacement || this.wearBrush || !this.selected || this.document.getObject(this.selected.userData.editorId) !== this.selected || !tool) {
      this.clearAssembly(); return;
    }
    (tool === this.assembly ? this.objectAssembly : this.assembly).clear();
    tool.refresh(this.selected);
    if (!this.assembly.enabled) this.assemblyMessage('Ensamble desactivado · puedes mover el equipo libremente.');
  }

  cancelTransformDrag() {
    if (!this.transform || !this.transform.dragging) return false;
    this.cancellingTransform = true;
    try {
      this.clearAssembly(); this.dragAssembly = null; this.resizeReflow = null; this.detachDragModifier = false;
      this.transform.dragging = false;
      this.transform.axis = null;
      this.document.cancel();
    } finally { this.cancellingTransform = false; }
    this.orbit.enabled = this.active;
    this.syncNative(); this.refreshAssembly();
    if (this.selected) this.box.update();
    this.updateTransformInputs();
    if (this.cadWorkbench && object.userData.editorDescriptor && object.userData.editorDescriptor.type === 'cad') {
      const cadSection = this.section('DISEÑO PARAMÉTRICO');
      cadSection.appendChild(button('Editar pieza e historial', 'Abrir el modelador paramétrico', () => this.cadWorkbench.open(object)));
      if (object.userData.editorDescriptor.attachment) cadSection.appendChild(el('p', 'ed-hint', 'La transformación es relativa al anclaje del vehículo.'));
    }
    return true;
  }
  syncNative() {
    Object.keys(this.ctx.editorRoots).forEach(id => syncNativeTransforms(this.ctx, this.ctx.editorRoots[id]));
    if (this.ctx.syncEditorNativeBehaviors) this.ctx.syncEditorNativeBehaviors();
    if (this.active) this.infoPreview.sync(this.roomId, this.camera);
    this.decals.sync(this.roomId);
    this.collisionWorld.invalidate();
    this.performance.invalidate();
    this.industrialVisuals.invalidate();
    this.materials.invalidate(); this.wearPaint.invalidate();
    this.syncSurfaceVisuals();
    if (!this.transform || !this.transform.dragging) this.refreshAssembly();
  }

  async prepareRoom(roomId = this.roomId, options = {}) {
    const current = () => {
      if (options.signal && options.signal.aborted) throw Object.assign(new Error('Carga de escenario cancelada.'), {name: 'AbortError', code: 'load_aborted'});
      if (options.assertCurrent) options.assertCurrent();
    };
    current();
    if (this.document.activateRoom) await this.document.activateRoom(roomId, options);
    current();
    if (this.document.hasPendingRoom && this.document.hasPendingRoom(roomId)) {
      throw new Error('La sala cambió mientras se cargaba. Vuelve a seleccionarla.');
    }
    if (this.ctx.roomAssets) await this.ctx.roomAssets.prepareRoom(roomId, this.document.getRoot(roomId), options);
    current();
    this.performance.invalidate();
  }

  async historyStep(direction) {
    const changed = this.document[direction]();
    await this.prepareRoom(this.roomId);
    this.syncNative();
    return changed;
  }

  resetPerformancePanel() {
    this.performanceElapsed = 0;
    this.performanceFrames = 0;
    this.skipPerformanceFrame = true;
    if (this.performancePanel) (this.performanceMetrics || this.performancePanel).textContent = '';
    if (!this.performanceGraphics && this.ctx.graphics) this.performanceGraphics = this.appendGraphicsSettings(this.performancePanel, {compact: true});
    if (this.performanceGraphics) this.performanceGraphics.update();
  }

  appendGraphicsSettings(parent, options = {}) {
    if (!parent || !this.ctx.graphics) return null;
    return new GraphicsSettings(this.ctx.graphics, Object.assign({ctx: this.ctx}, options)).mount(parent);
  }

  updatePerformancePanel(delta) {
    if (!this.performancePanel || this.performancePanel.hidden) return;
    const metrics = this.performanceMetrics || this.performancePanel;
    // Ignore the interval spent opening the panel or returning from a hidden
    // tab. Sample rendered frames over a short window rather than averaging 1/dt.
    if (this.skipPerformanceFrame) this.skipPerformanceFrame = false;
    else if (Number.isFinite(delta) && delta > 0) {
      this.performanceElapsed = (this.performanceElapsed || 0) + delta;
      this.performanceFrames = (this.performanceFrames || 0) + 1;
    }
    const elapsed = this.performanceElapsed || 0;
    if (elapsed < 0.4 && metrics.textContent) return;
    const timing = elapsed >= 0.4 ? Math.round(this.performanceFrames / elapsed) +
      ' · ' + (1000 * elapsed / this.performanceFrames).toFixed(1) + ' ms/fotograma' : 'calculando…';
    if (elapsed >= 0.4) { this.performanceElapsed = 0; this.performanceFrames = 0; }
    const stats = this.performance.getStats();
    metrics.textContent = 'Sala activa · ' + ROOM_LABELS[this.ctx.room] + '\nFPS: ' + timing + '\nDibujos: ' + stats.drawCalls +
      ' · Triángulos: ' + Number(stats.triangles || 0).toLocaleString() + '\nGPU: ' + stats.gpuGeometries +
      ' geometrías · ' + stats.gpuTextures + ' texturas\nSalas inactivas: ' + stats.inactiveRooms;
  }

  changed() {
    this.dirty = true;
    this.changeVersion++;
    if (this.lineMonitors) this.lineMonitors.invalidate();
    if (!this.tree) return;
    this.syncNative();
    if (this.selected && !this.document.getObject(this.selected.userData.editorId)) this.selected = null;
    if (this.transform && this.active) {
      if (this.selected && this.toolMode !== 'select') this.transform.attach(this.selected); else this.transform.detach();
    }
    this.renderTree(); this.renderInspector(); this.updateStatus();
    const generation = this.projectGeneration;
    this.library.getCatalog().then(entries => { if (generation === this.projectGeneration) { this.entries = entries; this.renderAssets(); } }).catch(() => {});
  }

  async checkStorageHealth() {
    const health = await this.projectClient.health();
    this.serverCapabilities = health.capabilities || {};
    this.serverLimits = health.limits || {};
    this.storageAvailable = true;
    return health;
  }

  async importFiles(files) {
    if (this.importingFiles || this.loadingProject) throw new Error('Espera a que termine la importación actual.');
    this.importingFiles = true;
    const generation = this.projectGeneration;
    this.updateStatus();
    try {
      if (!this.storageAvailable) {
        try { await this.checkStorageHealth(); } catch (_) { /* Offline imports retain the JSON workflow. */ }
      }
      const options = {deferCommit: true, maxAssetBytes: this.serverLimits.maxAssetBytes};
      if (this.storageAvailable && this.serverCapabilities.assetUpload) options.uploadFile = async file => {
        this.toast('Subiendo ' + file.name + ' · ' + this.formatSize(file.size) + '…');
        return this.projectClient.uploadAsset(file, file.type);
      };
      // Upload before opening an edit transaction: camera navigation and other
      // edits remain responsive while a large file is sent to the server.
      const entries = await this.library.loadFiles(files, options);
      if (generation !== this.projectGeneration) throw new Error('El proyecto cambió durante la importación. Vuelve a seleccionar los archivos en el proyecto actual.');
      this.document.begin();
      try {
        this.library.restoreImports(this.library.exportImports().concat(entries));
        this.document.commit();
      } catch (error) { this.document.cancel(); throw error; }
      return entries;
    } finally { this.importingFiles = false; this.updateStatus(); }
  }

  async perform(action) {
    if (this.loadingProject) { this.toast('Espera a que termine de cargar el proyecto.'); return; }
    this.pendingEdits++;
    try {
      this.industrialVisuals.dispose();
      if (this.performance.clearPresentation) this.performance.clearPresentation();
      this.materials.dispose();
      const result = await action();
      if (this.ctx.roomAssets && result && result.isObject3D) await this.ctx.roomAssets.prepareDependencies(this.root);
      if (result && result.isObject3D) this.select(result);
      this.renderTree(); this.renderInspector(); this.updateStatus();
      return result;
    } catch (error) { this.toast(error.message || String(error)); }
    finally { this.pendingEdits--; this.syncSurfaceVisuals(); }
  }

  placeObject(object) {
    if (!object || !object.isObject3D) return;
    const own = !this.document.transaction;
    if (own) this.document.begin();
    try {
      this.equipmentPlacement.place(object, this.orbit.target);
      if (own) this.document.commit();
      this.select(object);
    } catch (error) { if (own) this.document.cancel(); throw error; }
  }

  createPlacedObject(create) {
    if (this.transform.dragging || this.document.transaction) throw new Error('Termina de mover el equipo antes de añadir otro.');
    this.document.begin();
    try {
      const object = create();
      this.placeObject(object);
      this.document.commit();
      return object;
    } catch (error) { this.document.cancel(); throw error; }
  }

  emptyRoom() {
    this.perform(() => {
      this.document.begin();
      try {
      this.document.resetRoom(this.roomId);
      this.document.getObjects(this.roomId).filter(object => this.document.isNative(object)).forEach(object => this.document.setProperty(object, 'visible', false));
      const floor = this.studioTools.createSceneBase(this.roomId);
      this.document.commit();
      if (this.entities) this.entities.sync();
      this.home();
      this.toast('Base lista con cielo, iluminación, cámara y punto de inicio. El suelo permite teletransporte en VR.');
      return floor;
      } catch (error) { this.document.cancel(); throw error; }
    });
  }

  renderTree() {
    if (!this.tree) return;
    this.tree.textContent = '';
    const objects = this.document.getObjects(this.roomId);
    const query = this.treeSearch.value.toLowerCase();
    this.treeCount.textContent = objects.length;
    objects.forEach(object => {
      const name = object.name || object.type;
      if (query && !name.toLowerCase().includes(query)) return;
      let depth = 0;
      for (let parent = object.parent; parent && parent !== this.root; parent = parent.parent) depth++;
      const row = button('', name + ' · clic para seleccionar, Mayús para selección múltiple, doble clic para enfocar', event => {
        if (this.studioTools && event.shiftKey) this.studioTools.selectObject(object, event);
        else this.select(object);
      }, 'ed-tree-row');
      const chosen = this.selected === object || Boolean(this.studioTools && this.studioTools.selection.has(object));
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-selected', String(chosen));
      row.style.setProperty('--depth', Math.min(depth, 6));
      row.classList.toggle('selected', chosen);
      row.classList.toggle('muted', !visibleInTree(object));
      row.appendChild(el('span', 'ed-tree-icon', this.document.isNative(object) ? (object.isMesh ? '◇' : '▸') : '◆'));
      row.appendChild(el('span', 'ed-tree-name', name));
      const behaviors = this.document.getBehaviors(object);
      if (behaviors.length) {
        const badge = el('span', 'ed-tag', behaviors.length + ' fn');
        badge.title = behaviors.map(config => behaviorSchema.definitionFor(config.type).label).join(', ');
        row.appendChild(badge);
      }
      if (!visibleInTree(object)) row.appendChild(el('span', 'ed-tag', 'oculto'));
      row.addEventListener('dblclick', () => this.focus());
      this.tree.appendChild(row);
    });
  }

  section(title) {
    const section = el('section', 'ed-section'); section.appendChild(el('h3', '', title)); (this.inspectorContent || this.inspector).appendChild(section); return section;
  }
  field(parent, label, input) {
    const row = el('label', 'ed-field'); row.appendChild(el('span', '', label)); row.appendChild(input); parent.appendChild(row); return input;
  }

  renderInspector() {
    const sameObject = this.inspectedObject === this.selected, previousTab = this.renderedInspectorTab;
    const scrollTop = sameObject ? this.inspector.scrollTop : 0;
    this.inspectedObject = this.selected;
    this.inspectorScroll = this.inspectorScroll || {};
    if (this.renderedInspectorTab) this.inspectorScroll[this.renderedInspectorTab] = this.inspector.scrollTop || 0;
    this.inspectorTab = this.inspectorTab || 'object'; this.renderedInspectorTab = this.inspectorTab;
    this.inspector.textContent = '';
    const inspectorHeader = el('div', 'ed-panel-title', 'INSPECTOR');
    if (this.shell) inspectorHeader.appendChild(button('›', 'Plegar inspector · Ventana permite abrirlo de nuevo', () => this.shell.setPanel('inspector', false), 'ed-panel-collapse'));
    this.inspector.appendChild(inspectorHeader);
    this.renderInspectorTabs();
    const object = this.selected;
    if (!object) {
      const empty = el('div', 'ed-empty');
      empty.appendChild(el('div', 'ed-empty-icon', '◇'));
      empty.appendChild(el('strong', '', 'Tu escenario, a tu manera'));
      empty.appendChild(el('p', '', 'Selecciona un objeto para editar sus propiedades. Añade figuras o arrastra modelos desde la biblioteca.'));
      empty.appendChild(el('p', 'ed-hint', 'Las puertas, panoramas, pintura y sonido originales conservan sus comportamientos.'));
      if (this.objectClipboard) {
        const paste = button('Pegar objeto', 'Pegar modelo, propiedades y funciones · Ctrl V', () => this.perform(() => this.pasteObject()));
        paste.disabled = this.pastingObject; empty.appendChild(paste);
      }
      this.inspectorContent.appendChild(empty); this.inspector.scrollTop = this.inspectorScroll[this.inspectorTab] || 0; return;
    }
    const native = this.document.isNative(object);
    const header = this.section('OBJETO');
    const name = el('input', 'ed-object-name'); name.value = object.name || object.type; name.disabled = native;
    name.setAttribute('aria-label', 'Nombre del objeto');
    name.addEventListener('change', () => this.perform(() => this.document.setProperty(object, 'name', name.value)));
    header.appendChild(name);
    header.appendChild(el('span', 'ed-tag', native ? 'ORIGINAL · nombre protegido' : 'PERSONALIZADO'));
    const visible = el('input'); visible.type = 'checkbox'; visible.checked = object.visible;
    this.field(header, 'Visible', visible).addEventListener('change', () => this.perform(() => this.document.setProperty(object, 'visible', visible.checked)));
    if (native) header.appendChild(el('p', 'ed-native-info', describeNative(object) || 'Objeto original. Su nombre y sus conexiones nativas se mantienen. Quitar lo oculta sin romper referencias.'));
    if (object.userData.editorDescriptor && object.userData.editorDescriptor.type === 'industrialFloor') {
      const floor = this.section('PISO · PASILLOS Y TEXTOS');
      floor.appendChild(button('Editar pasillos y textos', 'Cambiar posiciones, tamaños y nombres de piso y carteles', () => this.shell && this.shell.openFloorPlan(object)));
    }
    const info = this.document.getBehaviors(object).find(component => component.type === 'info');
    if (info) {
      const text = this.section('TEXTO DEL PANEL');
      text.appendChild(el('p', 'ed-hint', 'Edita el título y el contenido. Al salir del campo verás el cambio en la escena. Ctrl C / Ctrl V copia el panel completo cuando no estás escribiendo.'));
      const update = (key, value) => this.perform(() => this.document.setBehaviors(object, this.document.getBehaviors(object).map(component => component.type === 'info' ? Object.assign({}, component, {[key]: value}) : component)));
      this.renderBehaviorFields(text, info, update);
    }
    const decal = this.document.getBehaviors(object).find(component => component.type === 'decal');
    const decalAnchor = object.userData.editorDescriptor && object.userData.editorDescriptor.type === 'decal';
    const audioAnchor = object.userData.editorDescriptor && object.userData.editorDescriptor.type === 'audioZone';
    if (decal) {
      const section = this.section(decal.pattern === 'image' ? 'DECAL · IMAGEN PROYECTADA' : 'DECAL · DESGASTE');
      section.appendChild(el('p', 'ed-hint', 'Mueve, rota o escala el proyector para ajustar la imagen. La profundidad delimita las superficies que alcanza.'));
      const update = (key, value) => this.perform(() => this.document.setBehaviors(object, this.document.getBehaviors(object).map(component => component.type === 'decal' ? Object.assign({}, component, {[key]: value}) : component)));
      this.renderBehaviorFields(section, decal, update);
      if (decalAnchor) section.appendChild(button('Volver a colocar sobre superficie', 'Hacer clic en otra superficie para recolocar este decal', () => this.startDecalPlacement(decal.pattern === 'image' ? this.library.getEntry(decal.asset) : {kind: 'image', name: 'Desgaste', path: ''}, object)));
    }
    const transform = this.section('TRANSFORMACIÓN');
    this.transformInputs = {};
    [['position', 'Posición · m'], ['rotation', 'Rotación · °'], ['scale', 'Escala']].forEach(([property, label]) => {
      transform.appendChild(el('div', 'ed-hint', label));
      const row = el('div', 'ed-xyz');
      this.transformInputs[property] = [];
      ['x', 'y', 'z'].forEach((axis, i) => {
        const wrapper = el('label', 'ed-axis'); wrapper.appendChild(el('span', 'ed-axis-' + axis, axis.toUpperCase()));
        const input = el('input'); input.type = 'number'; input.step = property === 'rotation' ? 1 : 0.1;
        input.setAttribute('aria-label', label + ' ' + axis.toUpperCase());
        if (property === 'scale') input.min = 0.001;
        input.addEventListener('change', () => {
          const values = ['x', 'y', 'z'].map(key => object[property][key]);
          values[i] = Number(input.value) * (property === 'rotation' ? Math.PI / 180 : 1);
          this.perform(() => this.setEquipmentTransform(object, {[property]: values}));
        });
        wrapper.appendChild(input); row.appendChild(wrapper); this.transformInputs[property].push(input);
      });
      transform.appendChild(row);
    });
    this.updateTransformInputs();
    if (!decalAnchor && !audioAnchor) this.renderAppearanceInspector(object);
    this.renderSoundInspector(object);
    if (!native && !decalAnchor && !audioAnchor) this.renderInteractionInspector(object);
    this.renderConveyorConnections(object);
    this.renderSourceCatalog(object);
    this.renderIndustrialPanelBinding(object);
    this.renderBehaviorInspector(object);
    const actions = this.section('ACCIONES');
    actions.appendChild(button('Copiar objeto', 'Copiar modelo, propiedades, funciones e hijos · Ctrl C', () => this.perform(() => this.copyObject(object))));
    const paste = button('Pegar objeto', 'Pegar una copia con todas sus propiedades · Ctrl V', () => this.perform(() => this.pasteObject()));
    paste.disabled = !this.objectClipboard || this.pastingObject; actions.appendChild(paste);
    actions.appendChild(button('Duplicar con funciones', 'Duplicar objeto, modelo y funciones · Ctrl D', () => this.perform(() => this.duplicateObject(object))));
    actions.appendChild(button(native ? 'Ocultar objeto' : 'Eliminar objeto', native ? 'Ocultar conservando referencias nativas' : 'Eliminar · Supr', () => this.perform(() => this.document.remove(object)), 'danger'));
    this.organizeInspector(object);
    this.inspector.scrollTop = this.inspectorTab === 'object' ? previousTab === 'object' ? scrollTop : sameObject ? this.inspectorScroll.object || 0 : 0 : this.inspectorScroll.resource || 0;
  }

  showInspectorTab(tab) {
    if (!['object', 'resource'].includes(tab)) return;
    this.inspectorTab = tab;
    if (this.shell && this.shell.layout && !this.shell.layout.inspector) this.shell.setPanel('inspector', true);
    this.renderInspector();
  }

  renderInspectorTabs() {
    this.inspector.classList.toggle('ed-inspector-resource-active', this.inspectorTab === 'resource');
    const tabs = el('div', 'ed-inspector-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Contenido del inspector');
    this.inspectorTabButtons = new Map();
    [['object', 'Objeto'], ['resource', 'Recurso']].forEach(([id, title]) => {
      const control = button(title, title === 'Objeto' ? 'Propiedades del objeto de la escena' : 'Ficha y vista previa del recurso de la biblioteca', () => this.showInspectorTab(id));
      control.setAttribute('role', 'tab'); control.id = 'ed-inspector-tab-' + id; control.setAttribute('aria-controls', 'ed-inspector-' + id);
      control.setAttribute('aria-selected', String(this.inspectorTab === id)); control.tabIndex = this.inspectorTab === id ? 0 : -1;
      control.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); const next = event.key === 'Home' ? 'object' : event.key === 'End' ? 'resource' : id === 'object' ? 'resource' : 'object';
        this.showInspectorTab(next); this.inspectorTabButtons.get(next).focus();
      });
      tabs.appendChild(control); this.inspectorTabButtons.set(id, control);
    });
    this.inspector.appendChild(tabs);
    this.inspectorContent = el('div', 'ed-inspector-object'); this.inspectorContent.id = 'ed-inspector-object'; this.inspectorContent.setAttribute('role', 'tabpanel'); this.inspectorContent.setAttribute('aria-labelledby', 'ed-inspector-tab-object'); this.inspectorContent.hidden = this.inspectorTab !== 'object'; this.inspector.appendChild(this.inspectorContent);
    const resource = el('div', 'ed-inspector-resource'); resource.id = 'ed-inspector-resource'; resource.setAttribute('role', 'tabpanel'); resource.setAttribute('aria-labelledby', 'ed-inspector-tab-resource'); resource.hidden = this.inspectorTab !== 'resource'; this.inspector.appendChild(resource);
    if (this.resourceBrowser && this.resourceBrowser.setPreviewHost) {
      this.resourceBrowser.setPreviewHost(resource);
      this.resourceBrowser.setPreviewVisible(this.inspectorTab === 'resource' && !this.inspector.hidden);
    }
  }

  organizeInspector(object) {
    const content = this.inspectorContent, sections = Array.from(content.children).filter(child => child.tagName === 'SECTION');
    const title = section => { const heading = Array.from(section.children).find(child => child.tagName === 'H3'); return heading && heading.textContent || ''; };
    const machine = this.machineConfig(object) || this.document.getBehaviors(object).find(config => ['robot', 'vehicle', 'product'].includes(config.type)), functions = sections.find(section => title(section) === 'FUNCIONES / COMPONENTES');
    if (machine && functions) {
      const card = Array.from(functions.children).find(child => child.getAttribute && child.getAttribute('data-component-type') === machine.type);
      if (card) {
        const configuration = this.section('CONFIGURACIÓN DEL EQUIPO'); configuration.classList.add('ed-machine-configuration'); configuration.appendChild(card);
        sections.splice(1, 0, configuration);
      }
    }
    this.inspectorSections = this.inspectorSections || new Map();
    const priorities = ['OBJETO', 'TRANSFORMACIÓN', 'CONFIGURACIÓN DEL EQUIPO', 'TEXTO DEL PANEL', 'DECAL', 'PRODUCTOS / CATÁLOGO SOURCE', 'MÓDULO / CONEXIONES', 'FLUJO /', 'BANDA DEL PANEL', 'APARIENCIA', 'SONIDO', 'MATERIAL', 'DESGASTE', 'MODELO VISUAL', 'AL PULSAR', 'FUNCIONES / COMPONENTES', 'EQUIPO / VARIANTE', 'ACCIONES'];
    const rank = section => { const value = title(section), index = priorities.findIndex(prefix => value.startsWith(prefix)); return index < 0 ? priorities.length - 1 : index; };
    sections.sort((a, b) => rank(a) - rank(b));
    const folded = machine ? ['MATERIAL', 'DESGASTE', 'MODELO VISUAL', 'APARIENCIA', 'SONIDO', 'AL PULSAR', 'FUNCIONES / COMPONENTES', 'EQUIPO / VARIANTE', 'ACCIONES'] : ['MODELO VISUAL', 'FUNCIONES / COMPONENTES'];
    sections.forEach(section => {
      const name = title(section);
      if (name === 'OBJETO') section.classList.add('ed-object-summary');
      if (!folded.some(prefix => name.startsWith(prefix))) { content.appendChild(section); return; }
      const wrapper = el('details', 'ed-inspector-fold'), key = object.userData.editorId + ':' + name;
      wrapper.open = this.inspectorSections.get(key) === true;
      wrapper.appendChild(el('summary', '', name)); wrapper.appendChild(section); wrapper.addEventListener('toggle', () => this.inspectorSections.set(key, wrapper.open)); content.appendChild(wrapper);
    });
  }

  updateTransformInputs() {
    if (!this.selected || !this.transformInputs) return;
    Object.keys(this.transformInputs).forEach(property => {
      this.transformInputs[property].forEach((input, i) => {
        if (document.activeElement === input) return;
        const value = this.selected[property][['x', 'y', 'z'][i]] * (property === 'rotation' ? 180 / Math.PI : 1);
        input.value = Math.round(value * 1000) / 1000;
      });
    });
  }

  renderAppearanceInspector(object) {
    const section = this.section('APARIENCIA');
    section.setAttribute('data-appearance-inspector', 'true');
    this.materialInspector.render(object, section);
    this.renderConveyorEquipment(object, section);
    this.renderAssetInspector(object, section);
  }

  appendAudioControls(parent) {
    if (!this.industrialAudio) return;
    const group = el('div', 'ed-toolbar-group'); group.style.display = 'flex'; group.style.alignItems = 'center'; group.style.gap = '6px';
    const toggle = button('Sonido automático', 'Activar o silenciar sonidos de equipos y ambientes en este dispositivo', async () => {
      if (this.industrialAudio.muted) await this.industrialAudio.activate();
      else this.industrialAudio.setMuted(true);
      this.refreshAudioControls();
    });
    toggle.setAttribute('data-industrial-audio-toggle', 'true');
    toggle.setAttribute('aria-label', 'Activar o silenciar sonido industrial'); group.appendChild(toggle);
    const volume = el('input'); volume.type = 'range'; volume.min = 0; volume.max = 1; volume.step = .05; volume.value = this.industrialAudio.volume;
    volume.style.width = '72px'; volume.title = 'Volumen general de equipos y ambientes'; volume.setAttribute('aria-label', 'Volumen general del sonido industrial');
    volume.addEventListener('input', () => this.industrialAudio.setVolume(Number(volume.value))); group.appendChild(volume); parent.appendChild(group);
    this.audioControls.push({toggle, volume}); this.refreshAudioControls(); return group;
  }

  refreshAudioControls() {
    if (!this.audioControls || !this.industrialAudio) return;
    this.audioControls = this.audioControls.filter(value => { if (value.toggle.isConnected === true) value.mounted = true; return !value.mounted || value.toggle.isConnected !== false; }).slice(-12);
    this.audioControls.forEach(({toggle, volume}) => {
      const enabled = !this.industrialAudio.muted;
      toggle.textContent = !enabled ? 'Activar sonido' : this.industrialAudio.activated ? 'Silenciar sonido' : 'Sonido automático';
      toggle.title = enabled && !this.industrialAudio.activated ? 'Sonido habilitado: se iniciará con la primera interacción si el navegador lo requiere. Pulsa para silenciar.' : 'Activar o silenciar sonidos de equipos y ambientes en este dispositivo';
      toggle.setAttribute('aria-pressed', String(enabled)); volume.value = this.industrialAudio.volume;
    });
  }

  createAudioZone(object = this.selected) {
    return this.perform(() => {
      const camera = this.active ? this.camera : this.ctx.camera;
      const point = object ? object.getWorldPosition(new THREE.Vector3()) : camera.getWorldPosition(new THREE.Vector3()).addScaledVector(camera.getWorldDirection(new THREE.Vector3()), 3);
      this.root.updateWorldMatrix(true, false); this.root.worldToLocal(point);
      return this.document.addAudioZone(this.roomId, {}, {position: point.toArray()});
    });
  }

  renderSoundInspector(object) {
    const behaviors = this.document.getBehaviors(object), current = behaviors.find(value => value.type === 'machineAudio'), zone = behaviors.find(value => value.type === 'audioZone');
    const functional = behaviors.some(value => ['conveyor', 'source', 'processor', 'palletQueue', 'robot', 'vehicle', 'product', 'control', 'motion'].includes(value.type));
    const section = this.section('SONIDO'); section.setAttribute('data-sound-inspector', 'true');
    section.appendChild(el('p', 'ed-hint', 'Pulsa Activar sonido en la barra para escucharlo al probar el escenario. El volumen general se conserva en este dispositivo. Los perfiles automáticos se habilitan en Sonidos del equipo del nivel.'));
    const render = value => {
      const group = el('fieldset', 'ed-machine-fields'); group.appendChild(el('legend', '', value.type === 'audioZone' ? 'Zona de ambiente espacial' : 'Sonido según función')); section.appendChild(group);
      const update = (key, entry) => this.perform(() => {
        const next = Object.assign({}, value, {[key]: entry}), list = this.document.getBehaviors(object).filter(item => item.type !== value.type);
        this.document.setBehaviors(object, list.concat([next]));
      });
      const enabled = el('input'); enabled.type = 'checkbox'; enabled.checked = value.enabled; enabled.setAttribute('aria-label', value.type === 'audioZone' ? 'Zona de sonido habilitada' : 'Sonido del equipo habilitado');
      this.field(group, 'Habilitado', enabled).addEventListener('change', () => update('enabled', enabled.checked));
      this.renderBehaviorFields(group, value, update);
    };
    if (current || functional) render(current || behaviorSchema.defaultBehavior('machineAudio'));
    if (zone) { render(zone); section.appendChild(el('p', 'ed-hint', 'La zona no crea geometría ni bloquea el paso. Selecciónala en la jerarquía y usa Transformación para moverla; las dimensiones definen el área audible y su salida gradual.')); }
    if (!current && !functional && !zone) section.appendChild(button('Añadir sonido a este objeto', 'Crear un emisor personalizable sobre el objeto', () => this.perform(() => this.document.setBehaviors(object, behaviors.concat([Object.assign(behaviorSchema.defaultBehavior('machineAudio'), {preset: 'ventilation', trigger: 'always'})])))));
    if (current) section.appendChild(button('Volver al sonido automático del nivel', 'Quitar la personalización sin cambiar las funciones del equipo', () => this.perform(() => this.document.setBehaviors(object, this.document.getBehaviors(object).filter(value => value.type !== 'machineAudio')))));
    section.appendChild(button('Importar audio propio', 'Importar un audio y elegirlo en el campo Audio propio', () => this.assetInput.click()));
    if (!zone) section.appendChild(button('Crear zona de sonido aquí', 'Crear un ambiente espacial independiente en esta ubicación', () => this.createAudioZone(object)));
  }

  renderAssetInspector(object, parent) {
    const section = parent ? this.materialInspector.details(parent, 'Modelo visual y archivo 3D propio', false, object) : this.section('MODELO VISUAL');
    const descriptor = this.document.getVisualDescriptor ? this.document.getVisualDescriptor(object) : object.userData.editorDescriptor;
    const source = descriptor && descriptor.nativeId && this.document.getObject(descriptor.nativeId);
    const label = descriptor ? descriptor.path || (descriptor.importId && (this.library.getEntry(descriptor.importId) || {}).name) || descriptor.type || (source && source.name) || 'Modelo original' : 'Modelo original';
    section.appendChild(el('div', 'ed-asset-current', label));
    section.appendChild(el('p', 'ed-hint', 'Cambiar el modelo conserva el objeto, sus funciones, referencias y transformación.'));
    const machine = this.machineConfig(object);
    if (machine) section.appendChild(el('p', 'ed-native-info', 'El archivo sustituye la carcasa visual. Los puertos y la ruta de productos siguen las dimensiones y la tipología de Configuración del equipo; los sensores, pantallas y pulsadores originales siguen visibles y operativos. Las mallas nuevas no heredan la animación de rodillos o mecanismos ni las piezas del modelo anterior.'));
    const replacement = this.document.visuals && this.document.visuals.get(object.userData.editorId);
    if (replacement) {
      let surfaces = 0;
      replacement.content.traverse(mesh => { if (mesh.isMesh && mesh.material) surfaces += (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).filter(material => !material.isShaderMaterial && !material.isRawShaderMaterial).length; });
      if (surfaces === 1) section.appendChild(el('p', 'ed-native-info', 'El modelo de reemplazo contiene una sola superficie. Para colorear piezas por separado, importa un modelo con mallas o materiales separados.'));
      section.appendChild(el('p', 'ed-hint', 'Revisa el selector de partes tras cada reemplazo: los nombres y superficies del archivo nuevo pueden ser distintos. Los acabados anteriores permanecen guardados para restaurar el modelo original.'));
    }
    const select = el('select'); select.setAttribute('aria-label', 'Nuevo modelo visual');
    const placeholder = el('option', '', 'Elegir modelo o imagen…'); placeholder.value = ''; select.appendChild(placeholder);
    [['box', 'Cubo'], ['sphere', 'Esfera'], ['plane', 'Plano'], ['cylinder', 'Cilindro']].forEach(([type, name]) => {
      const option = el('option', '', 'Figura · ' + name); option.value = 'primitive:' + type; select.appendChild(option);
    });
    this.entries.filter(entry => PLACEABLE_KINDS.includes(entry.kind)).forEach(entry => {
      const option = el('option', '', entry.name); option.value = entry.importId || entry.path; select.appendChild(option);
    });
    section.appendChild(select);
    const controls = el('div', 'ed-actions');
    controls.appendChild(button('Reemplazar', 'Cambiar solamente el modelo visual', () => {
      if (!select.value) return this.toast('Elige primero un modelo o una imagen.');
      const entry = this.entries.find(entry => (entry.importId || entry.path) === select.value);
      const descriptor = select.value.startsWith('primitive:') ? {type: select.value.slice(10), color: '#60a5fa'} : entry && (entry.importId ? {importId: entry.importId} : {path: entry.path});
      if (descriptor) this.replaceVisual(object, descriptor);
    }));
    controls.appendChild(button('Restaurar modelo', 'Recuperar el modelo original conservando las funciones editadas', () => this.perform(() => {
      this.document.resetAsset(object); this.materialInspector.resetTarget(object);
    })));
    section.appendChild(controls);
    const upload = el('input'); upload.type = 'file'; upload.multiple = true; upload.hidden = true;
    upload.accept = '.glb,.gltf,.obj,.fbx,.mtl,.bin,.png,.jpg,.jpeg,.webp,.bmp,.gif,.avif,.basis';
    upload.setAttribute('aria-label', 'Archivo de modelo visual propio');
    upload.addEventListener('change', () => {
      const files = Array.from(upload.files || []); upload.value = '';
      if (files.length) return this.importVisualModel(object, files);
    });
    section.appendChild(upload);
    section.appendChild(button('Importar modelo 3D propio', 'Selecciona el modelo y sus texturas o archivos dependientes juntos', () => upload.click()));
    section.appendChild(el('p', 'ed-hint', 'GLB, GLTF, OBJ o FBX. Desde Blender exporta a GLB/GLTF. Para GLTF/OBJ selecciona también sus texturas y dependencias. Si importas varios modelos, elige uno en Nuevo modelo visual y pulsa Reemplazar.'));
    if (this.selectedAsset && PLACEABLE_KINDS.includes(this.selectedAsset.kind)) {
      section.appendChild(button('Usar ' + this.selectedAsset.name, 'Usar el archivo seleccionado en la biblioteca', () => this.replaceVisual(object, this.selectedAsset.importId ? {importId: this.selectedAsset.importId} : {path: this.selectedAsset.path})));
    }
  }

  async importVisualModel(object, files) {
    return this.perform(async () => {
      const generation = this.projectGeneration;
      const imported = await this.importFiles(files);
      if (generation !== this.projectGeneration || this.document.getObject(object.userData.editorId) !== object) throw new Error('El objeto cambió durante la importación. Elige el modelo en Archivos del proyecto.');
      this.entries = await this.library.getCatalog(); this.renderAssets();
      const models = imported.filter(entry => entry.kind === 'model');
      if (models.length === 1) {
        const entry = models[0];
        await this.document.replaceAsset(object, entry.importId ? {importId: entry.importId} : {path: entry.path});
        this.materialInspector.resetTarget(object, true);
        this.toast('Modelo propio aplicado. Se conservaron las funciones, puertos y controles; revisa las superficies del archivo nuevo.');
      } else this.toast(models.length ? 'Modelos importados. Elige uno en Nuevo modelo visual y pulsa Reemplazar.' : 'No se importó un modelo 3D compatible. Usa GLB, GLTF, OBJ o FBX; desde Blender exporta a GLB/GLTF.');
      return object;
    });
  }

  async replaceVisual(object, descriptor) {
    return this.perform(async () => {
      this.toast('Cargando el modelo visual…');
      await this.document.replaceAsset(object, descriptor);
      this.materialInspector.resetTarget(object, true);
      this.select(object);
      this.toast('Modelo reemplazado. Las funciones y referencias del objeto se conservaron.');
    });
  }

  copyFunctions(object, only) {
    const behaviors = this.document.getBehaviors(object);
    this.behaviorClipboard = JSON.parse(JSON.stringify(only ? behaviors.filter(component => component.type === only) : behaviors));
    this.renderInspector();
    this.toast(this.behaviorClipboard.length + ' función(es) copiada(s). Selecciona otro objeto y pulsa Pegar funciones.');
  }

  clearObjectClipboard() {
    this.objectClipboard = null;
    this.objectPasteCount = 0;
  }

  copyObject(object = this.selected) {
    if (!this.active || this.ctx.vrMode || !object) return;
    if (this.loadingProject || this.transform.dragging) throw new Error('Termina la edición actual antes de copiar el objeto.');
    this.objectClipboard = this.document.captureObject(object);
    this.objectPasteCount = 0;
    this.renderInspector();
    this.toast('Objeto copiado con su modelo, propiedades y funciones. Usa Ctrl+V para pegarlo.');
  }

  async pasteObject() {
    if (!this.active || this.ctx.vrMode || !this.objectClipboard) return;
    if (this.pastingObject) return;
    if (this.loadingProject || this.transform.dragging || this.document.transaction) throw new Error('Termina la edición actual antes de pegar el objeto.');
    const clipboard = this.objectClipboard, roomId = this.roomId;
    const offset = (this.objectPasteCount + 1) * 0.5;
    this.pastingObject = true;
    const transformEnabled = this.transform.enabled;
    this.transform.enabled = false;
    try {
      const generation = this.projectGeneration;
      const copy = await this.document.pasteObject(clipboard, roomId, offset, copy => {
        if (!this.active || generation !== this.projectGeneration || this.roomId !== roomId) throw new Error('La sala cambió mientras se copiaba el objeto.');
        this.placeEquipmentCopy(copy);
      });
      if (this.objectClipboard === clipboard) this.objectPasteCount++;
      this.toast('Objeto pegado con su modelo, propiedades y funciones.');
      if (!this.active) this.startRuntime();
      return this.active && this.roomId === roomId ? copy : undefined;
    } finally {
      this.pastingObject = false;
      this.transform.enabled = transformEnabled && this.active && !this.loadingProject;
      this.renderInspector();
    }
  }

  conveyorConfig(object) {
    return object && this.document.getBehaviors(object).find(config => config.type === 'conveyor');
  }

  renderConveyorEquipment(object, parent) {
    const config = this.conveyorConfig(object), registry = behaviorSchema.conveyorLayout.equipment;
    if (!config || !registry) return;
    const definition = registry.resolveVariant(config);
    const section = parent ? this.materialInspector.details(parent, 'Forma, tecnología y variante', false, object) : this.section('EQUIPO / VARIANTE');
    const ready = registry.listEquipment({readyOnly: true});
    const fitsLayout = (item, layout) => item.family === 'curved' ? ['curveLeft', 'curveRight'].includes(layout) : item.preset.layout === layout;
    const closest = candidates => candidates.slice().sort((a, b) => {
      const score = item => (item.preset.mechanism === config.mechanism ? 20 : 0) + (item.preset.drive === config.drive ? 10 : 0) + (item.preset.surface === config.surface ? 5 : 0) + (definition && item.id === definition.id ? 1 : 0);
      return score(b) - score(a);
    })[0];
    const apply = (next, layout) => this.perform(() => {
      if (!next || next.status !== 'ready') return;
      this.updateConveyor(object, Object.assign({}, next.preset, {layout: layout || next.preset.layout, equipmentId: next.id, equipmentVersion: next.version}));
      this.materialInspector.resetTarget(object, true);
      this.toast(next.name + ': variante aplicada y equipos conectados sincronizados.');
    });
    if (parent) {
      const shapeField = behaviorSchema.definitionFor('conveyor').fields.find(field => field.key === 'layout');
      const shape = el('select'); shape.setAttribute('aria-label', 'Forma / tipología del equipo');
      shapeField.options.forEach(item => {
        const next = closest(ready.filter(entry => fitsLayout(entry, item.value)));
        if (next) { const option = el('option', '', item.label + (next.preset.mechanism !== config.mechanism || next.preset.drive !== config.drive ? ' · ' + next.name : '')); option.value = item.value; shape.appendChild(option); }
      });
      shape.value = config.layout;
      this.field(section, 'Forma / tipología', shape).addEventListener('change', () => apply(closest(ready.filter(item => fitsLayout(item, shape.value))), shape.value));
      const surfaceField = behaviorSchema.definitionFor('conveyor').fields.find(field => field.key === 'surface');
      const technology = el('select'); technology.setAttribute('aria-label', 'Tecnología de transporte');
      surfaceField.options.forEach(item => {
        const next = closest(ready.filter(entry => fitsLayout(entry, config.layout) && entry.preset.surface === item.value));
        if (next) { const option = el('option', '', item.label + (definition && next.family !== definition.family || next.preset.mechanism !== config.mechanism || next.preset.drive !== config.drive ? ' · ' + next.name : '')); option.value = item.value; technology.appendChild(option); }
      });
      technology.value = config.surface;
      this.field(section, 'Tecnología de transporte', technology).addEventListener('change', () => apply(closest(ready.filter(item => fitsLayout(item, config.layout) && item.preset.surface === technology.value)), config.layout));
      section.appendChild(el('p', 'ed-hint', 'Forma y tecnología eligen una variante funcional del catálogo. La variante completa se indica debajo. Los cambios de dimensiones y conexiones se guardan juntos y se pueden deshacer.'));
    }
    if (definition) {
      section.appendChild(el('strong', '', definition.name));
      const family = registry.FAMILIES.find(item => item.id === definition.family);
      section.appendChild(el('p', 'ed-hint', (family ? family.name + ' · ' : '') + definition.id + ' · v' + definition.version));
      section.appendChild(el('p', 'ed-hint', definition.description));
    } else section.appendChild(el('p', 'ed-hint', 'Transportador personalizado de un escenario existente. Sus parámetros y referencias se conservan.'));
    const variants = el('select'); variants.setAttribute('aria-label', 'Equipo · Variante del catálogo');
    const empty = el('option', '', 'Conservar configuración actual'); empty.value = ''; variants.appendChild(empty);
    ready.forEach(item => {
      const family = registry.FAMILIES.find(group => group.id === item.family);
      const option = el('option', '', (family ? family.name + ' / ' : '') + item.name); option.value = item.id; variants.appendChild(option);
    });
    variants.value = config.equipmentId && definition ? definition.id : '';
    this.field(section, 'Variante', variants).addEventListener('change', () => apply(registry.getDefinition(variants.value)));
    section.appendChild(el('p', 'ed-hint', 'Cambiar la variante aplica su mecanismo y componentes. Las dimensiones se editan en sus propiedades, sin escalar motores, sensores o paneles.'));
    if (definition) {
      const profiles = definition.productProfiles || definition.products || [];
      if (profiles.length) section.appendChild(el('p', 'ed-hint', 'Productos previstos: ' + profiles.map(profile => typeof profile === 'string' ? profile : profile.name || profile.id).join(' · ') + '. La admisión comprueba las dimensiones y la base de cada carga.'));
      if (registry.PRODUCT_PROFILES && behaviorSchema.conveyorLayout.productCompatibility) {
        const products = el('select'); products.setAttribute('aria-label', 'Equipo · Producto para comprobar compatibilidad');
        registry.PRODUCT_PROFILES.forEach(profile => { const option = el('option', '', profile.name); option.value = profile.id; products.appendChild(option); });
        this.field(section, 'Comprobar carga', products);
        const result = el('p', 'ed-hint'); result.setAttribute('aria-live', 'polite');
        const check = () => {
          const profile = registry.PRODUCT_PROFILES.find(item => item.id === products.value);
          if (!profile) return;
          const compatibility = behaviorSchema.conveyorLayout.productCompatibility(config, profile);
          result.textContent = compatibility.ok ? 'Compatible con los límites didácticos configurados: ' + profile.name + '.' : 'No compatible: ' + compatibility.reasons.map(reason => reason.message).join(' ');
          result.classList.toggle('ed-error', !compatibility.ok);
        };
        products.addEventListener('change', check); section.appendChild(result); check();
      }
      section.appendChild(el('p', 'ed-hint', 'Simulación por eventos y movimiento cinemático. Los límites configurados son didácticos; no representan certificación de física de contacto o capacidad comercial.'));
      const parts = el('ul', 'ed-equipment-specs');
      (definition.parts || []).filter(part => {
        if (!config.withSensors && /sensor/i.test(part.id)) return false;
        if (!config.withPanel && /panel/i.test(part.id)) return false;
        return true;
      }).forEach(part => { const item = el('li', '', part.name); item.title = part.function || ''; parts.appendChild(item); });
      if (parts.children.length) section.appendChild(parts);
      const explore = button('Explorar equipo', 'Partes, funcionamiento, controles, conexiones y aplicaciones del modelo real', () => this.conveyorViewer && this.conveyorViewer.open({equipmentId: definition.id, definition, objectId: object.userData.editorId}));
      explore.disabled = !this.conveyorViewer; section.appendChild(explore);
    }
  }

  machineConfig(object) { return object && this.assembly.config(object); }

  placeEquipmentCopy(copy) {
    if (!this.machineConfig(copy) && !(this.objectAssembly && this.objectAssembly.supported(copy))) return;
    const desired = copy.getWorldPosition(new THREE.Vector3());
    // A copied machine gets free floor space and its own physical connections.
    // Its internal sensors, controls and material properties remain remapped.
    if (this.machineConfig(copy)) this.assembly.disconnect(copy);
    this.equipmentPlacement.place(copy, desired);
  }

  async duplicateObject(object = this.selected) {
    if (this.transform.dragging || this.document.transaction) throw new Error('Termina la edición actual antes de duplicar el equipo.');
    const roomId = this.roomId, generation = this.projectGeneration;
    return this.document.duplicate(object, copy => {
      if (!this.active || generation !== this.projectGeneration || this.roomId !== roomId) throw new Error('La sala cambió mientras se duplicaba el objeto.');
      this.placeEquipmentCopy(copy);
    });
  }

  updateConveyor(object, patch) {
    const machine = this.machineConfig(object);
    return this.setEquipmentBehaviors(object, this.document.getBehaviors(object).map(config => machine && config.type === machine.type ? Object.assign({}, config, patch) : config));
  }

  equipmentGeometryKey(config) {
    if (!config) return '';
    const fields = config.type === 'conveyor' ? ['equipmentId', 'layout', 'mechanism', 'surface', 'length', 'width', 'radius', 'curveAngle', 'axis', 'junctionMode', 'branchSide', 'rise', 'supportHeight', 'gradeProfile', 'mergeAngle'] :
      config.type === 'source' ? ['width', 'height', 'depth', 'catalog', 'generationMode', 'productType', 'loadMode', 'palletColumns', 'palletRows', 'palletLayers'] :
      config.type === 'processor' ? ['mode', 'length', 'width'] : ['width', 'depth', 'columns', 'rows', 'layers', 'palletCapacity', 'acceptsPallets'];
    if (config.type === 'palletQueue') fields.push(...behaviorSchema.warehouseRacks.FIELDS.map(field => field.key));
    return JSON.stringify([config.type, ...fields.map(key => config[key])]);
  }

  applyEquipmentReflow(snapshot, mode = 'geometry', repair = false) {
    const plan = this.assembly.planReflow(snapshot, {mode, forceWidthFit: repair, normalizeBehaviors: behaviorSchema.normalizeBehaviors});
    if (!plan.ok) throw new Error(plan.message || 'No se pudieron conservar las conexiones del equipo.');
    this.assembly.applyReflow(plan);
    this.lastEquipmentReflow = plan;
    this.collisionWorld.invalidate(); this.performance.invalidate();
    this.industrialVisuals.invalidate(); this.materials.invalidate();
    if (this.lineMonitors) this.lineMonitors.invalidate();
    return plan;
  }

  /** The edited machine and every moved neighbour share a single undo entry.
   * Explicit UI edits use this path; project hydration, builders and alignment
   * keep their own transactions and never rewrite an opened document.
   */
  editConnectedEquipment(object, action, options = {}) {
    if (!this.active || this.loadingProject || !this.assembly.supported(object)) return action();
    const snapshot = options.snapshot || this.assembly.captureReflow(object);
    if (!snapshot || !snapshot.edges.length) return action();
    const own = !this.document.transaction;
    if (own) this.document.begin();
    try {
      const result = action();
      this.applyEquipmentReflow(snapshot, options.mode || 'geometry', !!options.repair);
      if (own) this.document.commit();
      return result;
    } catch (error) { this.document.cancel(); throw error; }
  }

  setEquipmentBehaviors(object, behaviors) {
    const previous = this.machineConfig(object), next = previous && behaviors.find(config => config.type === previous.type);
    if (!previous || !next || this.equipmentGeometryKey(previous) === this.equipmentGeometryKey(next)) return this.document.setBehaviors(object, behaviors);
    const adapted = this.assembly.adaptReflowConfig(previous, next);
    const prepared = behaviors.map(config => config === next ? adapted : config);
    return this.editConnectedEquipment(object, () => this.document.setBehaviors(object, prepared));
  }

  setEquipmentTransform(object, values) {
    return this.editConnectedEquipment(object, () => this.document.setTransform(object, values), {mode: values.scale ? 'geometry' : 'transform'});
  }

  alignConveyorPorts(fixed, fixedPort, moving, movingPort) {
    return this.assembly.align(fixed, fixedPort, moving, movingPort);
  }

  renderConveyorConnections(object) {
    const config = this.machineConfig(object);
    if (!config) return;
    const paths = this.assembly, section = this.section(config.type === 'palletQueue' ? 'FLUJO / ALMACÉN CON ESTIBAS' : config.type === 'processor' ? 'FLUJO / MÁQUINA DE PROCESO' : config.type === 'source' ? 'FLUJO / SOURCE Y QUEUE' : 'MÓDULO / CONEXIONES');
    if (config.type === 'source') section.appendChild(el('p', 'ed-hint', 'Cola FIFO: ' + config.capacity + ' cargas. Entrega ' + (config.delivery === 'automatic' ? 'automática al equipo conectado.' : 'manual: toma la primera carga o pulsa Despachar. Cambia Entrega de la cola para automatizarla.')));
    else if (config.type === 'processor') {
      section.appendChild(el('p', 'ed-hint', 'Entrada: ' + config.capacity + ' cargas · ' + config.parallelism + ' puestos de proceso · Salida: ' + config.outputCapacity + ' cargas. Entrega ' + (config.delivery === 'automatic' ? 'automática al equipo conectado.' : 'manual desde la mesa de salida.')));
      section.appendChild(el('p', 'ed-hint', config.mode === 'combiner' ? 'Combiner: consume ' + config.combineCount + ' cargas de entrada y forma un lote que conserva sus unidades y procedencia.' : config.mode === 'separator' ? 'Separator: divide las unidades de un lote o pallet en hasta ' + config.splitCount + ' grupos. Una carga de una unidad sigue siendo una unidad.' : 'Procesa cada carga conservando su identidad. El destino lleno retiene la salida y detiene los ciclos que no tienen espacio.'));
      section.appendChild(el('p', 'ed-hint', 'En Probar: Encender y después Marcha. El modo con operario espera su disponibilidad en el panel. Utilización = tiempo de proceso de los puestos / tiempo observado de todos los puestos; el setup se registra por separado. La capacidad nominal excluye setup y esperas.'));
    } else if (config.type === 'palletQueue') {
      section.appendChild(el('p', 'ed-hint', config.palletCapacity + ' posiciones de estiba · ' + config.capacity + ' cargas. ' + (config.acceptsPallets ? 'Recibe pallets completos y conserva su contenido.' : config.columns + ' columnas × ' + config.rows + ' filas × ' + config.layers + ' niveles por estiba. Ajusta las posiciones al tamaño de los productos.')));
      section.appendChild(el('p', 'ed-hint', 'Conecta la salida de una banda a la entrada de este almacén. Si está lleno o bloqueado, la banda conserva sus productos. Retira primero las cajas superiores; el despacho automático también respeta sus apoyos.'));
    } else section.appendChild(el('p', 'ed-hint', 'Recorrido: ' + behaviorSchema.conveyorLayout.pathLength(config).toFixed(2) + ' m · ' + (config.surface === 'belt' ? 'Cinta continua' : 'Rodillos') + '. Configura largo, ancho, curvas, sensores y panel en sus funciones.'));
    if (config.type === 'conveyor') {
      const suppliers = this.assembly.records().filter(node => node !== object && this.assembly.connections(node).some(link => link.targetId === object.userData.editorId));
      section.appendChild(el('p', 'ed-hint', suppliers.length ? 'Alimentación externa: ' + suppliers.map(node => node.name || 'Equipo').join(', ') + '. El generador de respaldo y el botón Insertar caja esperan mientras exista esta conexión, incluso si el equipo anterior está detenido o vacío.' : 'Entrada libre, sin mesa ni caja incorporadas. Puedes conectar un Source u otro equipo, activar Generador de respaldo o usar Insertar caja para probar la banda. + Caja añade un producto independiente para manipularlo.'));
    }
    section.appendChild(el('p', 'ed-hint', 'Arrastra el equipo con Mover: los puertos compatibles se iluminan en amarillo y se ensamblan al acercarlos. Verde indica una unión. Para separar, aleja el equipo o pulsa Desensamblar.'));
    const disconnect = button('Desensamblar equipo', 'Quitar las conexiones de entrada y salida de este módulo; conserva sus datos y componentes', () => this.perform(() => {
      if (this.transform.dragging) throw new Error('Suelta el equipo antes de desensamblarlo.');
      this.document.begin();
      try { this.assembly.disconnect(object); this.document.commit(); this.syncNative(); }
      catch (error) { this.document.cancel(); throw error; }
      this.toast('Equipo desensamblado. Puedes moverlo y conectarlo en otra posición.');
    }));
    disconnect.disabled = !this.assembly.hasConnections(object);
    section.appendChild(disconnect);
    const conveyors = this.document.getObjects(this.roomId).filter(node => node !== object && this.machineConfig(node));
    const setOptions = (select, options) => options.forEach(([value, label]) => { const option = el('option', '', label); option.value = value; select.appendChild(option); });
    Object.entries(paths.ports(config)).filter(([, port]) => !port.incoming).forEach(([portName]) => {
      const branch = portName === 'branch', idKey = branch ? 'branchId' : 'outputId', portKey = branch ? 'branchPort' : 'outputPort';
      const caption = branch ? 'Salida lateral' : 'Salida principal';
      const destination = el('select'); destination.setAttribute('aria-label', caption + ' · módulo');
      setOptions(destination, [['', 'Sin conexión / salida final']].concat(conveyors.map(node => [node.userData.editorId, (node.name || 'Módulo') + ' · ' + node.userData.editorId])));
      if (config[idKey] && !conveyors.some(node => node.userData.editorId === config[idKey])) setOptions(destination, [[config[idKey], 'Destino no disponible · ' + config[idKey]]]);
      destination.value = config[idKey];
      const inlet = el('select'); inlet.setAttribute('aria-label', caption + ' · entrada de destino');
      const target = conveyors.find(node => node.userData.editorId === destination.value);
      const inlets = target ? Object.entries(paths.ports(this.machineConfig(target))).filter(([, port]) => port.incoming).map(([key]) => [key, key === 'branch' ? 'Entrada lateral de la T' : 'Entrada principal']) : [['input', 'Entrada principal']];
      setOptions(inlet, inlets); inlet.value = inlets.some(([key]) => key === config[portKey]) ? config[portKey] : 'input';
      this.field(section, caption, destination).addEventListener('change', () => this.perform(() => {
        const next = conveyors.find(node => node.userData.editorId === destination.value);
        const nextPorts = next && paths.ports(this.machineConfig(next));
        this.updateConveyor(object, {[idKey]: destination.value, [portKey]: nextPorts && nextPorts[config[portKey]] && nextPorts[config[portKey]].incoming ? config[portKey] : 'input'});
      }));
      this.field(section, 'Conectar a', inlet).addEventListener('change', () => this.perform(() => this.updateConveyor(object, {[portKey]: inlet.value})));
      const actions = el('div', 'ed-actions');
      const align = (moveSource = false) => this.perform(() => {
        const next = this.document.getObject(destination.value);
        if (!next || !this.machineConfig(next)) throw new Error('Selecciona el siguiente equipo.');
        this.document.begin();
        try {
          this.updateConveyor(object, {[idKey]: next.userData.editorId, [portKey]: inlet.value});
          if (moveSource) this.alignConveyorPorts(next, inlet.value, object, portName);
          else this.alignConveyorPorts(object, portName, next, inlet.value);
          this.document.commit(); this.syncNative();
        } catch (error) { this.document.cancel(); throw error; }
      });
      const alignNext = button('Alinear siguiente', 'Mover y orientar el destino para unir físicamente los puertos', () => align());
      const alignThis = button('Alinear este tramo', 'Mover este módulo hasta la entrada del destino; útil para unir dos líneas en T', () => align(true));
      alignNext.disabled = alignThis.disabled = !target;
      actions.appendChild(alignNext); actions.appendChild(alignThis); section.appendChild(actions);
      const catalog = el('select'); catalog.setAttribute('aria-label', caption + ' · nuevo tramo');
      const presets = industrialPrefabs.filter(item => item.prefab === 'conveyor' && item.variant);
      setOptions(catalog, presets.map(preset => [preset.variant, preset.label])); catalog.value = config.surface === 'belt' ? 'belt-middle' : 'roller-middle';
      section.appendChild(catalog);
      section.appendChild(button('Añadir tramo conectado', 'Crear un módulo, conectar esta salida y alinear sus puertos', () => this.perform(() => {
        this.document.begin();
        try {
          const next = this.document.addPrefab(this.roomId, 'conveyor', catalog.value);
          this.updateConveyor(object, {[idKey]: next.userData.editorId, [portKey]: 'input'});
          this.alignConveyorPorts(object, portName, next, 'input');
          this.document.commit(); this.syncNative(); return next;
        } catch (error) { this.document.cancel(); throw error; }
      })));
      if (target) {
        const end = paths.ports(config)[portName], start = paths.ports(this.machineConfig(target))[config[portKey]];
        object.updateWorldMatrix(true, false); target.updateWorldMatrix(true, false);
        const gap = start && object.localToWorld(new THREE.Vector3(end.x, object.userData.editorConveyorTop || 0, end.z)).distanceTo(target.localToWorld(new THREE.Vector3(start.x, target.userData.editorConveyorTop || 0, start.z)));
        section.appendChild(el('p', 'ed-hint', start && start.incoming ? 'Separación entre puertos: ' + gap.toFixed(3) + ' m. Los puertos deben coincidir y seguir la misma dirección.' : 'La entrada elegida no es compatible con el destino.'));
      }
    });
    const synchronize = button('Sincronizar línea', 'Reacomodar los equipos enlazados y conservar sus conexiones; todo el ajuste se puede deshacer.', () => this.perform(() => {
      this.editConnectedEquipment(object, () => {}, {repair: true});
      this.toast('Equipos conectados sincronizados. Puedes deshacer el ajuste completo.');
    }));
    synchronize.disabled = !this.assembly.hasConnections(object); section.appendChild(synchronize);
    section.appendChild(el('p', 'ed-hint', 'Al cambiar largo, ancho, radio o escala, los equipos enlazados se reacomodan automáticamente. El ancho se adapta entre transportadores y los productos conservan su tamaño. Desensambla el equipo para editarlo por separado. Un circuito que no pueda cerrar conserva su configuración anterior.'));
  }

  renderConveyorRouting(parent, config, update) {
    const schema = behaviorSchema.conveyorRouting;
    const builder = el('details', 'ed-rule-builder'); builder.open = true;
    builder.appendChild(el('summary', '', 'CLASIFICACIÓN / DECISIONES DE SALIDA'));
    builder.appendChild(el('p', 'ed-hint', 'Principal = salida recta; lateral = rama de la T. La decisión se fija por carga al entrar. Si su destino está lleno, detenido o sin conexión, espera en esa salida sin cambiar de clasificación.'));
    const options = (input, list) => list.forEach(option => { const node = el('option', '', option.label); node.value = option.value; input.appendChild(node); });
    const routes = [{value: 'main', label: 'Salida principal / recta'}, {value: 'branch', label: 'Salida lateral'}];
    if (config.routing === 'percentage') {
      const input = el('input'); input.type = 'number'; input.min = 0; input.max = 100; input.step = 0.1; input.value = config.branchPercentage;
      input.setAttribute('aria-label', 'Clasificación · Porcentaje a la salida lateral');
      this.field(builder, 'Porcentaje a la salida lateral (%)', input).addEventListener('change', () => update('branchPercentage', Number(input.value)));
      builder.appendChild(el('p', 'ed-hint', 'El resto va a la salida principal. Reparto acumulado y equilibrado por número de cargas, no por unidades de cada pallet. Un 30 % envía 3 de cada 10 cargas a la rama lateral; no modifica su color, tipo ni calidad.'));
    } else if (config.routing === 'rules') {
      builder.appendChild(el('p', 'ed-hint', 'Se evalúan de arriba hacia abajo; la primera condición que se cumple decide la salida. Atributos desconocidos o mezclados no cumplen ninguna comparación, incluida «diferente». La calidad defectuosa de un lote indica que contiene algún producto defectuoso.'));
      const rules = schema.normalizeRules(config.routingRules);
      // Component normalization runs inside update/perform so invalid edits
      // produce the editor's toast and leave the previous valid rule intact.
      const save = rows => update('routingRules', JSON.stringify(rows));
      const defaultValue = field => field.type === 'number' ? field.value === 'units' ? 1 : 0.3 : field.options ? field.options[0].value : field.value === 'color' ? '#b78b53' : 'product';
      rules.forEach((rule, index) => {
        const card = el('div', 'ed-rule'); card.appendChild(el('p', 'ed-hint', 'Prioridad ' + (index + 1)));
        const set = (key, value) => {
          const next = rules.map(row => Object.assign({}, row)); next[index][key] = value;
          if (key === 'field') { const field = schema.fields.find(entry => entry.value === value); next[index].operator = 'eq'; next[index].value = defaultValue(field); }
          return save(next);
        };
        const field = schema.fields.find(entry => entry.value === rule.field), fieldInput = el('select'); options(fieldInput, schema.fields); fieldInput.value = rule.field;
        fieldInput.setAttribute('aria-label', 'Clasificación · Atributo regla ' + (index + 1)); this.field(card, 'Atributo', fieldInput).addEventListener('change', () => set('field', fieldInput.value));
        const operator = el('select'); options(operator, schema.operatorsByType[field.type]); operator.value = rule.operator;
        operator.setAttribute('aria-label', 'Clasificación · Comparación regla ' + (index + 1)); this.field(card, 'Comparación', operator).addEventListener('change', () => set('operator', operator.value));
        const value = el(field.options ? 'select' : 'input');
        if (field.options) options(value, field.options);
        else { value.type = field.type === 'number' ? 'number' : rule.field === 'color' ? 'color' : 'text'; value.maxLength = rule.field === 'sku' ? 64 : 160; if (field.type === 'number') { value.min = 0; value.max = 1000000; value.step = rule.field === 'units' ? 1 : 0.01; } }
        value.value = rule.value; value.setAttribute('aria-label', 'Clasificación · Valor regla ' + (index + 1));
        this.field(card, 'Valor', value).addEventListener('change', () => set('value', field.type === 'number' ? Number(value.value) : value.value));
        const route = el('select'); options(route, routes); route.value = rule.route;
        route.setAttribute('aria-label', 'Clasificación · Destino regla ' + (index + 1)); this.field(card, 'Enviar a', route).addEventListener('change', () => set('route', route.value));
        const actions = el('div', 'ed-actions');
        [['Subir regla', -1], ['Bajar regla', 1]].forEach(([label, direction]) => {
          const action = button(label, label + ' ' + (index + 1) + ' en el orden de prioridad', () => { const next = rules.slice(); [next[index], next[index + direction]] = [next[index + direction], next[index]]; return save(next); });
          action.setAttribute('aria-label', label + ' ' + (index + 1)); action.disabled = index + direction < 0 || index + direction >= rules.length; actions.appendChild(action);
        });
        const remove = button('Quitar regla', 'Quitar condición de clasificación ' + (index + 1), () => save(rules.filter((_, row) => row !== index)), 'danger');
        remove.setAttribute('aria-label', 'Quitar regla de clasificación ' + (index + 1)); actions.appendChild(remove);
        card.appendChild(actions); builder.appendChild(card);
      });
      const add = button('+ Regla de clasificación', 'Añadir una condición priorizada para elegir la salida de cada carga', () => save(rules.concat([{field: 'quality', operator: 'eq', value: 'defective', route: 'branch'}])));
      add.disabled = rules.length >= schema.MAX_RULES; builder.appendChild(add);
      const fallback = el('select'); options(fallback, routes); fallback.value = config.routingDefault;
      fallback.setAttribute('aria-label', 'Clasificación · Salida sin coincidencia'); this.field(builder, 'Si ninguna regla coincide', fallback).addEventListener('change', () => update('routingDefault', fallback.value));
    } else builder.appendChild(el('p', 'ed-hint', config.routing === 'alternate' ? 'Alterna una carga a la salida principal y otra a la lateral. Cada pallet cuenta como una carga.' : config.routing === 'branch' ? 'Todas las cargas se envían a la rama lateral.' : 'Todas las cargas siguen por la salida principal.'));
    builder.appendChild(el('p', 'ed-hint', 'Configura los atributos del producto y del catálogo Source: SKU, color, tipo, calidad y defecto. Son datos de simulación; no se reconoce automáticamente el color ni los defectos de una imagen o modelo 3D. Encadena varias T para crear más destinos.'));
    parent.appendChild(builder);
  }

  renderSourceCatalog(object) {
    const config = this.document.getBehaviors(object).find(component => component.type === 'source');
    if (!config) return;
    const schema = behaviorSchema.productSources, section = this.section('PRODUCTOS / CATÁLOGO SOURCE');
    section.appendChild(el('p', 'ed-hint', 'Un solo tipo usa las dimensiones de la función Source. Secuencia y Aleatorio usan este catálogo. La capacidad cuenta cargas: un producto o un pallet completo. Se muestra la primera carga; el resto espera como inventario temporal.'));
    const rows = schema.normalizeCatalog(config.catalog);
    const save = next => this.perform(() => this.updateConveyor(object, {catalog: schema.normalizeCatalogJSON(next)}));
    const labels = {box: 'Caja de cartón', crate: 'Caja plástica', drum: 'Bidón', bottle: 'Botella'};
    rows.forEach((spec, index) => {
      const card = el('details', 'ed-component'); card.open = true;
      card.appendChild(el('summary', '', spec.name + ' · ' + spec.id));
      const body = el('div', 'ed-component-body');
      const update = (key, value) => {
        const next = rows.map(row => Object.assign({}, row)); next[index][key] = value;
        if (key === 'quality') next[index].defect = value === 'good' ? 'none' : next[index].defect === 'none' ? 'damaged' : next[index].defect;
        if (key === 'defect') next[index].quality = value === 'none' ? 'good' : 'defective';
        return save(next);
      };
      [['id', 'Código SKU'], ['name', 'Nombre del producto']].forEach(([key, label]) => {
        const input = el('input'); input.value = spec[key]; input.maxLength = key === 'id' ? 64 : 160;
        input.setAttribute('aria-label', label + ' ' + (index + 1)); this.field(body, label, input).addEventListener('change', () => update(key, input.value));
      });
      const type = el('select'); schema.types.forEach(value => { const option = el('option', '', labels[value]); option.value = value; type.appendChild(option); }); type.value = spec.type;
      type.setAttribute('aria-label', 'Tipo de producto ' + (index + 1)); this.field(body, 'Tipo', type).addEventListener('change', () => update('type', type.value));
      [['width', 'Ancho (m)'], ['height', 'Alto (m)'], ['depth', 'Fondo (m)']].forEach(([key, label]) => {
        const input = el('input'); input.type = 'number'; input.min = 0.05; input.max = 2; input.step = 0.05; input.value = spec[key];
        input.setAttribute('aria-label', label + ' producto ' + (index + 1)); this.field(body, label, input).addEventListener('change', () => update(key, Number(input.value)));
      });
      const color = el('input'); color.type = 'color'; color.value = spec.color;
      color.setAttribute('aria-label', 'Color producto ' + (index + 1)); this.field(body, 'Color', color).addEventListener('change', () => update('color', color.value));
      [['quality', 'Calidad', [['good', 'Conforme'], ['defective', 'Defectuoso']]], ['defect', 'Defecto', [['none', 'Sin defecto'], ['damaged', 'Daño'], ['surface', 'Acabado superficial'], ['dimension', 'Dimensiones'], ['incomplete', 'Incompleto']]]].forEach(([key, label, options]) => {
        const input = el('select'); options.forEach(([value, text]) => { const option = el('option', '', text); option.value = value; input.appendChild(option); }); input.value = spec[key];
        input.setAttribute('aria-label', label + ' producto ' + (index + 1)); this.field(body, label, input).addEventListener('change', () => update(key, input.value));
      });
      body.appendChild(button('Quitar producto', 'Quitar este tipo del catálogo', () => save(rows.filter((_, row) => row !== index))));
      card.appendChild(body); section.appendChild(card);
    });
    const add = button('+ Tipo de producto', 'Agregar un SKU con su tipo, tamaño y color', () => {
      let next = 1; while (rows.some(row => row.id === 'sku-' + next)) next++;
      return save(rows.concat([Object.assign(schema.singleSpec(config), {id: 'sku-' + next, name: 'Producto ' + next})]));
    });
    add.disabled = rows.length >= schema.MAX_CATALOG; section.appendChild(add);
    section.appendChild(el('p', 'ed-hint', 'La cola se reinicia al comenzar Probar. Guardar conserva la configuración; Variables y datos permite grabar los contadores y eventos en SQLite.'));
  }

  renderIndustrialPanelBinding(object) {
    if (object.userData.editorPrefabKey !== 'plc') return;
    const controls = [];
    object.traverse(node => {
      if (this.document.objects.get(node.userData.editorId) === node && this.document.getBehaviors(node).some(config => config.type === 'control')) controls.push(node);
    });
    const conveyors = this.document.getObjects(this.roomId).filter(node => this.document.getBehaviors(node).some(config => config.type === 'conveyor'));
    const ids = new Set(conveyors.map(node => node.userData.editorId));
    const targets = new Set(), scopes = new Set();
    controls.forEach(node => this.document.getBehaviors(node).filter(config => config.type === 'control').forEach(config => { targets.add(ids.has(config.targetId) ? config.targetId : ''); scopes.add(config.scope || 'module'); }));
    const section = this.section('BANDA DEL PANEL');
    const select = el('select');
    const addOption = (value, label) => { const option = el('option', '', label); option.value = value; select.appendChild(option); return option; };
    addOption('', 'Sin vincular');
    conveyors.forEach(node => addOption(node.userData.editorId, (node.name || 'Banda') + ' · ' + node.userData.editorId));
    if (targets.size > 1) { const mixed = addOption('mixed', 'Mandos con vínculos diferentes'); mixed.disabled = true; select.value = 'mixed'; }
    else select.value = targets.size ? Array.from(targets)[0] : '';
    select.setAttribute('aria-label', 'Banda de este panel');
    const scope = el('select'); scope.setAttribute('aria-label', 'Alcance de este panel');
    [['module', 'Solo el módulo elegido'], ['segment', 'Hasta el siguiente panel'], ['line', 'Toda la línea conectada']].forEach(([value, label]) => { const option = el('option', '', label); option.value = value; scope.appendChild(option); });
    if (scopes.size > 1) { const mixed = el('option', '', 'Mandos con alcances distintos'); mixed.value = 'mixed'; mixed.disabled = true; scope.appendChild(mixed); scope.value = 'mixed'; }
    else scope.value = scopes.size ? Array.from(scopes)[0] : 'module';
    const updateBinding = () => this.perform(() => {
      if (select.value && !ids.has(select.value)) throw new Error('Selecciona una banda válida.');
      if (!['module', 'segment', 'line'].includes(scope.value)) throw new Error('Selecciona un alcance válido.');
      this.document.begin();
      try {
        controls.forEach(node => this.document.setBehaviors(node, this.document.getBehaviors(node).map(config => config.type === 'control' ? Object.assign({}, config, {targetId: select.value || object.userData.editorId, scope: scope.value}) : config)));
        this.document.commit();
      } catch (error) { this.document.cancel(); throw error; }
      this.industrialVisuals.invalidate();
      this.toast(select.value ? 'Los mandos y la pantalla están vinculados a la banda seleccionada.' : 'Panel sin vincular: no muestra datos ni controla otra banda.');
    });
    this.field(section, 'Control y dashboard', select).addEventListener('change', updateBinding);
    this.field(section, 'Alcance', scope).addEventListener('change', updateBinding);
    section.appendChild(el('p', 'ed-hint', 'Módulo: datos propios. Hasta el siguiente panel: incluye los tramos siguientes sin panel y termina antes del próximo. Línea: todos los módulos conectados. Las transferencias internas no se cuentan como productos nuevos. Las reglas del PLC se configuran por separado.'));
  }

  renderBehaviorInspector(object) {
    const section = this.section('FUNCIONES / COMPONENTES');
    const behaviors = this.document.getBehaviors(object);
    const actions = el('div', 'ed-actions');
    actions.appendChild(button('Copiar funciones', 'Copiar las funciones y sus parámetros', () => this.copyFunctions(object)));
    const paste = button('Pegar funciones', 'Añadir funciones copiadas; los parámetros del mismo tipo se reemplazan', () => this.perform(() => {
      const types = new Set(this.behaviorClipboard.map(component => component.type));
      this.setEquipmentBehaviors(object, this.document.getBehaviors(object).filter(component => !types.has(component.type)).concat(JSON.parse(JSON.stringify(this.behaviorClipboard))));
    }));
    paste.disabled = !this.behaviorClipboard || !this.behaviorClipboard.length;
    actions.appendChild(paste); section.appendChild(actions);
    if (!behaviors.length) section.appendChild(el('p', 'ed-hint', 'Este objeto no tiene funciones asignadas. Añade una función o pega las de otro objeto.'));
    behaviors.forEach(config => {
      const definition = behaviorSchema.definitionFor(config.type);
      if (!definition) return;
      const card = el('details', 'ed-component');
      card.setAttribute('data-component-type', config.type);
      const componentKey = object.userData.editorId + ':' + config.type;
      card.open = this.expandedComponents.get(componentKey) !== false;
      card.addEventListener('toggle', () => this.expandedComponents.set(componentKey, card.open));
      const summary = el('summary', 'ed-component-title', definition.label);
      summary.appendChild(el('span', 'ed-tag', config.enabled ? 'ACTIVA' : 'DESACTIVADA'));
      card.appendChild(summary);
      const body = el('div', 'ed-component-body');
      if (config.type === 'palletQueue' && behaviorSchema.warehouseRacks.isRack(config)) {
        const definition = behaviorSchema.warehouseRacks.definition(config), cell = behaviorSchema.warehouseRacks.layout(config).cells[0], loads = {pallet: 'pallets completos', individual: 'cajas, piezas y bandejas', long: 'cargas largas con apoyo sobre los brazos'};
        body.appendChild(el('p', 'ed-hint', definition.label + ' · ' + config.capacity + ' posiciones. Carga compatible: ' + loads[definition.acceptedLoad] + '. Hueco útil (ancho × fondo × alto): ' + [cell.width, cell.depth, cell.clearHeight].map(v => v.toFixed(2)).join(' × ') + ' m. Las posiciones superiores y profundas de estructuras estáticas se sirven con manipulación física.'));
      }
      const update = (key, value) => this.perform(() => this.setEquipmentBehaviors(object, this.document.getBehaviors(object).map(component => {
        if (component.type !== config.type) return component;
        const next = Object.assign({}, component, {[key]: value});
        if (next.type === 'palletQueue' && key === 'rackSystem') {
          const common = {}; ['enabled', 'running', 'paused', 'withPanel', 'outputId', 'outputPort', 'outputInterval', 'delivery'].forEach(name => {common[name] = component[name];});
          return Object.assign({}, behaviorSchema.defaultBehavior('palletQueue'), value === 'floor' ? {} : behaviorSchema.warehouseRacks.defaults(value), common);
        }
        if (next.type === 'vehicle' && ['family', 'variant'].includes(key)) return Object.assign({}, behaviorSchema.vehicles.defaults(value), {enabled: next.enabled, sourceId: next.sourceId, outputId: next.outputId});
        if (next.type === 'product' && key === 'variant' && value) return Object.assign({}, next, behaviorSchema.productEquipment.defaults(value));
        if (next.type === 'product' && next.variant && key === 'palletType' && value !== 'custom') {
          const dimensions = behaviorSchema.productSources.pallets.dimensions(next);
          next.width = dimensions.width; next.depth = dimensions.depth;
        }
        if (next.type === 'product' && next.loadMode === 'pallet' && ['width', 'depth'].includes(key)) next.palletType = 'custom';
        if (next.type === 'source' && key === 'productVariant' && value) {
          const preset = behaviorSchema.productEquipment.defaults(value);
          return Object.assign(next, {productType: preset.productType, width: preset.width, height: preset.height, depth: preset.depth, mass: preset.mass / preset.units, units: preset.units, base: preset.base, color: preset.color, loadMode: 'individual'});
        }
        if (next.type === 'source' && key === 'productType' && next.productVariant && behaviorSchema.productEquipment.defaults(next.productVariant).productType !== value) next.productVariant = '';
        if (next.type === 'robot' && (key === 'family' || key === 'variant')) {
          const definition = behaviorSchema.robots.getDefinition(value);
          return Object.assign({}, definition.preset, {type: 'robot', enabled: next.enabled, sourceId: next.sourceId, outputId: next.outputId, targetId: next.targetId, withPanel: next.withPanel});
        }
        if (next.type === 'robot' && key === 'tool') next.operation = value === 'process' ? 'process' : next.operation === 'process' ? 'pick-place' : next.operation;
        if (next.type === 'robot' && key === 'operation') next.tool = value === 'process' ? 'process' : next.tool === 'process' ? 'gripper' : next.tool;
        if (next.type === 'palletQueue' && ['columns', 'rows', 'layers', 'palletCapacity', 'acceptsPallets'].includes(key)) next.capacity = Math.min(next.capacity, next.acceptsPallets ? next.palletCapacity : next.columns * next.rows * next.layers * next.palletCapacity);
        if (next.type === 'product' && key === 'quality') next.defect = value === 'good' ? 'none' : next.defect === 'none' ? 'damaged' : next.defect;
        if (next.type === 'product' && key === 'defect') next.quality = value === 'none' ? 'good' : 'defective';
        return next;
      })));
      const enabled = el('input'); enabled.type = 'checkbox'; enabled.checked = config.enabled;
      enabled.setAttribute('data-behavior-field', 'enabled');
      this.field(body, 'Habilitada', enabled).addEventListener('change', () => update('enabled', enabled.checked));
      if (config.type === 'info') body.appendChild(el('p', 'ed-hint', 'Cambia el contenido en TEXTO DEL PANEL, al inicio del inspector.'));
      else if (config.type === 'surfaceMaterial' || config.type === 'surfaceWear') body.appendChild(el('p', 'ed-hint', 'Edita los colores y texturas en APARIENCIA y las capas en DESGASTE · BROCHA.'));
      else if (config.type === 'machineAudio' || config.type === 'audioZone') body.appendChild(el('p', 'ed-hint', 'Edita el perfil, audio propio, alcance y volumen en SONIDO.'));
      else if (config.type === 'decal') body.appendChild(el('p', 'ed-hint', 'Ajusta la imagen en DECAL · IMAGEN PROYECTADA, al inicio del inspector.'));
      else this.renderBehaviorFields(body, config, update);
      if (config.type === 'automation') this.renderRuleBuilder(body, object, config, update);
      if (config.type === 'conveyor' && config.layout === 'tee' && config.junctionMode === 'split') this.renderConveyorRouting(body, config, update);
      if (['conveyor', 'source', 'processor', 'palletQueue', 'robot', 'vehicle', 'product'].includes(config.type)) this.organizeMachineFields(body, config);
      if (config.type === 'vehicle') {
        const vehicleActions = el('div', 'ed-actions');
        if (this.vehicleRoutes) vehicleActions.appendChild(button('Ruta y misiones en plano', 'Configurar pasillos, recogidas, entregas y esperas', () => this.vehicleRoutes.open(object)));
        if (this.cadWorkbench) vehicleActions.appendChild(button('Diseñar pieza personalizada', 'Abrir herramientas de modelado paramétrico; vincula la pieza al vehículo', () => this.cadWorkbench.open()));
        vehicleActions.appendChild(button('Probar y conducir', 'Entrar en el puesto de conducción de este vehículo', () => this.perform(async () => { await this.leave(); this.vehicleDriving.mount(object.userData.editorId); })));
        body.insertBefore(vehicleActions, body.firstChild);
        body.appendChild(el('p', 'ed-hint', 'Probar → apunta al vehículo y pulsa, o acércate y pulsa F. WASD conduce; Q/E eleva; R/T inclina; Z/X retrae/extiende; J/L desplaza; U/O gira horquillas; P freno; G toma; K deposita; H bocina; F baja. Sólo las funciones de esta tipología están activas.'));
      }
      if (config.type === 'robot') this.renderRobotJoints(body, object, config, update);
      if (config.type === 'conveyor') body.appendChild(el('p', 'ed-hint', 'Los sensores detectan presencia y flancos de entrada/salida; el color y la calidad provienen de los atributos simulados del producto o del proceso de inspección. En rectas y curvas continuas puedes omitir sensores externos; las transferencias requieren detección y los acumuladores conservan sus sensores internos por zona.'));
      if (config.type === 'product') body.appendChild(el('p', 'ed-hint', config.variant ? 'El modelo conserva su tamaño real en metros. Masa es el total de esta carga; unidades es su contenido. Color modifica el cuerpo y sirve para clasificar; etiqueta y tapa se editan por separado.' : 'SKU, tipo, color y calidad son atributos de clasificación de la simulación. El color de clasificación no cambia la textura del modelo. No se inspeccionan automáticamente imágenes ni mallas 3D.'));
      if (config.type === 'source') body.appendChild(el('p', 'ed-hint', 'La calidad del producto o del catálogo se conserva en todo el flujo. El porcentaje de defectos añade fallos simulados reproducibles con la semilla; el tipo de defecto define el fallo inyectado. Estas decisiones usan atributos de simulación, sin inspección automática de imágenes o modelos.'));
      const source = FUNCTION_SOURCE[config.type];
      if (source) body.appendChild(el('p', 'ed-hint', source[1]));
      const inspect = el('details', 'ed-component-source');
      inspect.appendChild(el('summary', '', 'Ver configuración y código'));
      inspect.appendChild(el('pre', '', JSON.stringify(config, null, 2)));
      if (source) {
        const implementation = implementationSource(object, config.type);
        inspect.appendChild(el('p', 'ed-hint', implementation));
        let code;
        inspect.appendChild(button('Ver implementación', 'Mostrar el código que implementa esta función', async () => {
          if (code) { code.hidden = !code.hidden; return; }
          code = el('pre', 'ed-source-code', 'Cargando…'); inspect.appendChild(code);
          try {
            const response = await fetch(implementation);
            if (!response.ok) throw new Error('No se pudo leer el código fuente.');
            code.textContent = (await response.text()).slice(0, 100000);
          } catch (error) { code.textContent = error.message; }
        }));
      }
      body.appendChild(inspect);
      const controls = el('div', 'ed-actions');
      controls.appendChild(button('Copiar función', 'Copiar solamente esta función', () => this.copyFunctions(object, config.type)));
      controls.appendChild(button('Quitar', 'Quitar esta función del objeto', () => this.perform(() => this.document.setBehaviors(object, this.document.getBehaviors(object).filter(component => component.type !== config.type))), 'danger'));
      body.appendChild(controls); card.appendChild(body); section.appendChild(card);
    });
    const addRow = el('div', 'ed-actions');
    const add = el('select'); add.setAttribute('aria-label', 'Función para añadir');
    const available = behaviorSchema.definitions.filter(definition => !behaviors.some(component => component.type === definition.type));
    available.forEach(definition => { const option = el('option', '', definition.label); option.value = definition.type; add.appendChild(option); });
    addRow.appendChild(add);
    const addButton = button('+ Función', 'Añadir una función reutilizable a este objeto', () => this.perform(() => {
      if (add.value) this.document.setBehaviors(object, this.document.getBehaviors(object).concat([behaviorSchema.defaultBehavior(add.value)]));
    }));
    addButton.disabled = !available.length; addRow.appendChild(addButton); section.appendChild(addRow);
    if (object.userData.editorDefaultBehaviors && object.userData.editorDefaultBehaviors.length) section.appendChild(button('Restaurar funciones originales', 'Recuperar las funciones y parámetros originales del objeto', () => this.perform(() => this.setEquipmentBehaviors(object, JSON.parse(JSON.stringify(object.userData.editorDefaultBehaviors))))));
  }

  renderBehaviorFields(parent, config, update) {
    const definition = behaviorSchema.definitionFor(config.type);
    const equipmentRegistry = behaviorSchema.conveyorLayout.equipment;
    const equipmentDefinition = config.type === 'conveyor' && equipmentRegistry && equipmentRegistry.resolveVariant(config);
    definition.fields.forEach(schemaField => {
      let field = schemaField;
      if (config.type === 'robot') {
        if (field.key === 'jointLimitsJson') return;
        if (field.key === 'variant') field = Object.assign({}, field, {options: field.options.filter(option => behaviorSchema.robots.getDefinition(option.value).family === config.family)});
        if (!['amr', 'agv', 'mobileManipulator', 'mobileSorter'].includes(config.family) && ['waypointsJson', 'batteryPercent', 'batteryDrainPerMeter'].includes(field.key)) return;
        if (field.key === 'processTime' && config.operation !== 'process') return;
        if (field.key === 'targetId' && config.operation !== 'process') return;
      }
      if (config.type === 'vehicle') {
        if (field.key === 'variant') field = Object.assign({}, field, {options: field.options.filter(option => behaviorSchema.vehicles.getDefinition(option.value).family === config.family)});
        const support = behaviorSchema.vehicles.supports(config), belongs = {tiltLimit: 'tilt', maxReach: 'reach', reachSpeed: 'reach', maxSideShift: 'sideShift', turretLimit: 'turret', boomLength: 'boom', maxBoomExtension: 'boom', boomAngleLimit: 'boom', boomPivotHeight: 'boom', maxTowKg: 'hitch'};
        if (belongs[field.key] && !support[belongs[field.key]]) return;
        if (config.mode !== 'automatic' && ['waypointsJson', 'routeLoop', 'sourceId', 'outputId'].includes(field.key)) return;
      }
      if (config.type === 'product' && !config.variant && ['width', 'height', 'depth', 'units', 'loadMode', 'palletType', 'palletMaterial', 'contents', 'labelColor', 'capColor'].includes(field.key)) return;
      if (config.type === 'audioZone' && (config.shape === 'sphere' ? ['width', 'height', 'depth'].includes(field.key) : field.key === 'radius')) return;
      if (config.equipmentId && equipmentDefinition) {
        const parameter = (equipmentDefinition.parameters || []).find(item => item.key === field.key);
        if (parameter) {
          field = Object.assign({}, schemaField, {label: parameter.label + (parameter.unit ? ' (' + parameter.unit + ')' : '')});
          ['min', 'max', 'step'].forEach(key => { if (parameter[key] !== undefined) field[key] = parameter[key]; });
          if (Array.isArray(parameter.options)) field.options = schemaField.options.filter(option => parameter.options.includes(option.value));
        }
      }
      if (config.type === 'source') {
        if (['catalog', 'outputId', 'outputPort'].includes(field.key)) return;
        if (['palletType', 'palletMaterial', 'palletPacking', 'palletWidth', 'palletDepth', 'palletColumns', 'palletRows', 'palletLayers'].includes(field.key) && config.loadMode !== 'pallet') return;
        if (['palletWidth', 'palletDepth'].includes(field.key) && config.palletType !== 'custom') return;
        if (['palletColumns', 'palletRows'].includes(field.key) && config.palletPacking === 'fit') return;
        if (['productType', 'width', 'height', 'depth', 'color', 'quality'].includes(field.key) && config.generationMode !== 'single') return;
        if (field.key === 'seed' && config.generationMode !== 'random' && !config.defectRate) return;
      }
      if (config.type === 'processor') {
        if (['outputId', 'outputPort'].includes(field.key)) return;
        if (field.key === 'combineCount' && config.mode !== 'combiner') return;
        if (field.key === 'splitCount' && config.mode !== 'separator') return;
        if (field.key === 'operatorAvailable' && !config.requiresOperator) return;
      }
      if (config.type === 'palletQueue' && ['outputId', 'outputPort'].includes(field.key)) return;
      if (config.type === 'palletQueue' && ['columns', 'rows'].includes(field.key) && (config.layoutMode === 'fit' || config.acceptsPallets)) return;
      if (config.type === 'palletQueue' && field.key === 'layers' && config.acceptsPallets) return;
      if (config.type === 'palletQueue' && field.key === 'layers' && config.layoutMode === 'fit') field = Object.assign({}, field, {max: 5});
      if (config.type === 'palletQueue') {
        const rack = behaviorSchema.warehouseRacks.isRack(config), definition = rack && behaviorSchema.warehouseRacks.definition(config);
        if (!rack && field.key !== 'rackSystem' && behaviorSchema.warehouseRacks.FIELDS.some(item => item.key === field.key)) return;
        if (!rack && field.key === 'palletCapacity') field = Object.assign({}, field, {max: 4});
        if (rack && ['columns', 'rows', 'layers', 'palletCapacity', 'layoutMode', 'maxStackHeight', 'autoRelease', 'releasePolicy', 'releaseInterval', 'autoReleasePressure', 'acceptsPallets'].includes(field.key)) return;
        if (rack && ['palletType', 'palletMaterial', 'width', 'depth'].includes(field.key)) return;
        if (rack && ['rackBanks', 'rackOpenAisle', 'rackAisleWidth'].includes(field.key) && definition.mechanism !== 'mobile') return;
        if (rack && field.key === 'rackSlope' && !['gravity', 'push-back'].includes(definition.mechanism)) return;
      }
      if (config.type === 'decal') {
        if (field.key === 'stamps') return;
        if (config.pattern === 'image' && ['seed', 'wearDensity', 'roughness', 'metalness'].includes(field.key)) return;
        if (config.pattern !== 'image' && field.key === 'asset') return;
      }
      if (config.type === 'conveyor') {
        if (['outputId', 'outputPort', 'branchId', 'branchPort', 'withPallet', 'routingRules', 'routingDefault', 'branchPercentage', 'equipmentId', 'equipmentVersion'].includes(field.key)) return;
        const equipment = behaviorSchema.conveyorLayout.equipment, typed = equipment && equipment.resolveVariant(config);
        if (config.equipmentId && typed && ['surface', 'drive', 'mechanism', 'cleats', 'junctionMode'].includes(field.key)) return;
        if (config.equipmentId && typed && field.key === 'layout' && typed.family !== 'curved') return;
        if (config.drive === 'gravity' && ['speed', 'powered', 'running', 'paused', 'withPanel', 'autoSpawn', 'spawnInterval'].includes(field.key)) return;
        if (field.key === 'rollerPitch' && config.surface !== 'rollers') return;
        if (['zoneCount', 'zones', 'zoneLength'].includes(field.key) && config.mechanism !== 'zones') return;
        if (['rise', 'inclineAngle'].includes(field.key) && config.drive !== 'gravity' && (!typed || typed.family !== 'inclined') && config.mechanism !== 'elevator') return;
        if (field.key === 'rollingResistance' && config.drive !== 'gravity') return;
        if (field.key === 'actuatorTime' && !['liftTransfer', 'pusher', 'steer', 'merge', 'distributor'].includes(config.mechanism)) return;
        if (field.key === 'turnTime' && config.mechanism !== 'turntable') return;
        if (field.key === 'verticalSpeed' && config.mechanism !== 'elevator') return;
        if (['loadingMode', 'requiresOperator', 'operationTime'].includes(field.key) && config.mechanism !== 'loading') return;
        if (field.key === 'operatorAvailable' && (config.mechanism !== 'loading' || !config.requiresOperator)) return;
        if (config.drive === 'manual' && ['speed', 'powered', 'running', 'paused', 'withPanel', 'autoSpawn', 'spawnInterval'].includes(field.key)) return;
        if (['radius', 'curveAngle'].includes(field.key) && !['curveLeft', 'curveRight'].includes(config.layout)) return;
        if (field.key === 'length' && ['curveLeft', 'curveRight'].includes(config.layout)) return;
        if (['junctionMode', 'branchSide'].includes(field.key) && config.layout !== 'tee') return;
        if (field.key === 'routing' && (config.layout !== 'tee' || config.junctionMode !== 'split')) return;
      }
      if (config.type === 'control') {
        if (config.mode === 'command' && field.key === 'variable') return;
        if (config.mode !== 'command' && field.key === 'command') return;
        if (config.mode === 'command' && field.key === 'value' && !['speedUp', 'speedDown', 'requestRetrieval', 'openAisle', 'prepareRackInput'].includes(config.command)) return;
      }
      const fieldValue = ['info', 'billboard', 'product', 'source', 'palletQueue'].includes(config.type) && config[field.key] === undefined ? field.default : config[field.key];
      let input;
      if (config.type === 'palletQueue' && behaviorSchema.warehouseRacks.isRack(config) && field.key === 'rackSelectedSlot') {
        input = el('select');
        behaviorSchema.warehouseRacks.layout(config).cells.forEach(cell => {const option = el('option', '', cell.index + ' · B' + (cell.bay + 1) + '/N' + (cell.level + 1) + '/P' + (cell.column + 1) + '/F' + (cell.depthIndex + 1) + (config.rackSystem === 'mobile' ? '/Fila' + (cell.bank + 1) : '')); option.value = cell.index; input.appendChild(option);}); input.value = fieldValue;
      } else if (['select', 'room', 'audio', 'image', 'object'].includes(field.input)) {
        input = el('select');
        const media = ['audio', 'image'].includes(field.input);
        const options = field.input === 'object' && config.type === 'robot' ? [{label: field.key === 'sourceId' ? 'Detectar equipo conectado' : field.key === 'targetId' ? 'Usar estación de recogida' : 'Selecciona un receptor…', value: ''}].concat(this.document.getObjects(this.roomId).filter(item => item !== this.selected && this.document.getBehaviors(item).some(value => ['conveyor', 'source', 'processor', 'palletQueue'].includes(value.type))).map(item => ({label: item.name || item.type, value: item.userData.editorId}))) : field.input === 'object' ? [{label: config.type === 'decal' ? 'Superficies próximas' : 'Selecciona un objeto…', value: ''}, {label: 'Este objeto', value: 'self'}].concat(this.document.getObjects(this.roomId).map(item => ({label: item.name || item.type, value: item.userData.editorId}))) : field.input === 'room' ? ROOM_LABELS.map((label, value) => ({label, value})) : media ? [{label: field.input === 'image' ? 'Selecciona una imagen…' : ['machineAudio', 'audioZone'].includes(config.type) ? 'Usar el perfil de sonido' : 'Selecciona un audio…', value: ''}].concat(this.entries.filter(entry => entry.kind === field.input).map(entry => ({label: entry.name, value: entry.importId || entry.path}))) : field.options;
        options.forEach(option => { const node = el('option', '', option.label); node.value = option.value; input.appendChild(node); });
        if (media && config[field.key] && !options.some(option => String(option.value) === String(config[field.key]))) {
          const option = el('option', '', config[field.key]); option.value = config[field.key]; input.appendChild(option);
        }
        input.value = fieldValue;
      } else if (field.input === 'textarea' || field.input === 'rules') {
        input = el('textarea'); input.rows = 4; input.value = fieldValue; input.maxLength = field.maxLength || 2000;
      } else {
        input = el('input'); input.type = field.input === 'checkbox' ? 'checkbox' : field.input === 'number' ? 'number' : field.input === 'color' ? 'color' : 'text';
        if (field.input === 'checkbox') input.checked = fieldValue; else input.value = fieldValue;
        if (field.min !== undefined) input.min = field.min;
        if (field.max !== undefined) input.max = field.max;
        if (field.step !== undefined) input.step = field.step;
        if (field.maxLength) input.maxLength = field.maxLength;
      }
      if (config.type === 'palletQueue' && ['width', 'depth'].includes(field.key) && config.palletType !== 'custom') { input.disabled = true; input.title = 'Dimensiones definidas por el formato de estiba elegido.'; }
      if (config.type === 'palletQueue' && behaviorSchema.warehouseRacks.isRack(config)) {
        if (field.key === 'capacity') {input.disabled = true; input.title = 'Se calcula con los módulos, niveles y posiciones de la estantería.';}
        if (field.key === 'rackSelectedSlot') input.max = Math.max(0, config.capacity - 1);
        if (field.key === 'rackDepthSlots' && !['drive-in', 'drive-through', 'pallet-flow', 'push-back', 'carton-flow'].includes(config.rackSystem)) input.disabled = true;
      }
      const label = config.type === 'control' && config.mode === 'command' && field.key === 'value' ? ['requestRetrieval', 'prepareRackInput'].includes(config.command) ? 'Posición (-1 = seleccionada)' : config.command === 'openAisle' ? 'Pasillo (-1 = seleccionado)' : 'Paso de velocidad (m/s)' : field.label;
      input.setAttribute('aria-label', definition.label + ' · ' + label);
      input.setAttribute('data-behavior-field', field.key);
      this.field(parent, label, input).addEventListener('change', () => update(field.key, field.input === 'checkbox' ? input.checked : ['number', 'room'].includes(field.input) ? Number(input.value) : input.value));
    });
  }

  organizeMachineFields(body, config) {
    const rows = new Map();
    Array.from(body.children).filter(child => child.tagName === 'LABEL').forEach(row => {
      const input = Array.from(row.children).find(child => child.getAttribute && child.getAttribute('data-behavior-field'));
      if (input) rows.set(input.getAttribute('data-behavior-field'), row);
    });
    const dimensions = config.type === 'source' ? ['width', 'height', 'depth'] : ['length', 'width', 'depth', 'supportHeight', 'rise', 'radius', 'curveAngle', 'axis', 'gradeProfile', 'rollerPitch', 'mergeAngle', 'branchSide'];
    const groups = config.type === 'palletQueue' && behaviorSchema.warehouseRacks.isRack(config) ? [
      ['Sistema y estructura', ['rackSystem', 'rackBays', 'rackLevels', 'rackColumns', 'rackDepthSlots', 'rackBayWidth', 'rackSlotDepth', 'rackLevelHeight', 'rackBaseHeight']],
      ['Carga y compatibilidad', ['rackClearance', 'rackMaxLoadKg', 'rackLevelLoadKg', 'rackSkuPolicy', 'palletType', 'palletMaterial', 'width', 'depth', 'capacity']],
      ['Mecanismo y acceso', ['rackSlope', 'rackMechanismSpeed', 'rackBanks', 'rackAisleWidth', 'rackOpenAisle', 'rackTransferHeight', 'rackSelectedSlot']],
      ['Operación y conexiones', ['enabled', 'running', 'paused', 'withPanel', 'delivery', 'outputId', 'outputPort', 'outputInterval']]
    ] : config.type === 'robot' ? [
      ['Arquitectura y herramienta', ['family', 'variant', 'operation', 'tool', 'withPanel']],
      ['Dimensiones y volumen de trabajo', ['reach', 'length', 'width', 'height', 'baseHeight', 'approachHeight', 'positionTolerance']],
      ['Operación y tiempos', ['mode', 'enabled', 'powered', 'running', 'paused', 'emergency', 'speed', 'cycleTime', 'processTime', 'setupTime']],
      ['Recogida y entrega', ['sourceId', 'targetId', 'outputId']],
      ['Compatibilidad de la carga', ['payloadKg', 'acceptedTypes', 'requireKnownMass', 'maxProductWidth', 'maxProductHeight', 'maxProductDepth']],
      ['Ruta y energía', ['waypointsJson', 'batteryPercent', 'batteryDrainPerMeter']],
      ['Apariencia por pieza', ['frameColor', 'accentColor', 'toolColor', 'finish', 'wear']],
      ['Diseño paramétrico de piezas', ['detail', 'filletRadius', 'chamferSize', 'mountingHoles']]
    ] : config.type === 'vehicle' ? [
      ['Tipología y operación', ['family', 'variant', 'mode', 'powered', 'running', 'paused', 'parkingBrake', 'emergency', 'lights']],
      ['Chasis y dirección', ['length', 'width', 'height', 'wheelbase', 'track', 'wheelRadius', 'speed', 'reverseSpeed', 'acceleration', 'brakeDeceleration', 'steerLimit']],
      ['Mástil y herramienta', ['mastHeight', 'maxLift', 'liftSpeed', 'initialLift', 'forkBaseHeight', 'forkLength', 'forkWidth', 'forkThickness', 'forkSpread', 'tiltLimit', 'maxReach', 'reachSpeed', 'maxSideShift', 'turretLimit', 'boomLength', 'maxBoomExtension', 'boomAngleLimit', 'boomPivotHeight']],
      ['Capacidad de carga', ['payloadKg', 'loadCenter', 'capacityHeightLimit', 'maxTowKg']],
      ['Ruta y estaciones', ['waypointsJson', 'routeLoop', 'sourceId', 'outputId', 'carryLift', 'dockTolerance', 'batteryPercent', 'batteryDrainPerMeter']],
      ['Cabina y acabado por piezas', ['cabinStyle', 'cabInterior', 'decals', 'serial', 'filletRadius', 'frameColor', 'accentColor', 'forkColor', 'finish', 'wear', 'detail']]
    ] : config.type === 'product' ? [
      ['Modelo y dimensiones', ['variant', 'productType', 'width', 'height', 'depth', 'mass', 'units', 'loadMode']],
      ['Pallet y contenido', ['palletType', 'palletMaterial', 'contents', 'base']],
      ['Aspecto y clasificación', ['color', 'labelColor', 'capColor', 'sku', 'quality', 'defect']],
      ['Alimentación', ['sourceId', 'initialVelocity']]
    ] : [
      [config.type === 'source' ? 'Dimensiones del producto' : 'Dimensiones y recorrido', dimensions],
      ['Operación', ['mode', 'enabled', 'withPanel', 'withSensors', 'speed', 'powered', 'running', 'paused', 'processTime', 'setupTime', 'parallelism', 'combineCount', 'splitCount', 'requiresOperator', 'operatorAvailable', 'operationTime', 'actuatorTime', 'turnTime', 'verticalSpeed', 'maxLoad', 'clearance', 'loadingMode', 'drive', 'surface', 'mechanism', 'rollingResistance', 'cleats', 'zoneLength']],
      ['Alimentación y capacidad', ['generationMode', 'productType', 'loadMode', 'capacity', 'outputCapacity', 'palletCapacity', 'delivery', 'interval', 'outputInterval', 'initialCount', 'totalLimit', 'autoGenerate', 'autoSpawn', 'spawnInterval', 'maxPackages', 'role', 'routing']],
      ['Estiba y apilado', ['acceptsPallets', 'palletType', 'palletMaterial', 'palletPacking', 'layoutMode', 'palletWidth', 'palletDepth', 'palletColumns', 'palletRows', 'palletLayers', 'columns', 'rows', 'layers', 'maxStackHeight']],
      ['Despacho de estibas', ['autoRelease', 'releasePolicy', 'releaseInterval', 'autoReleasePressure']],
      ['Atributos y calidad', ['sku', 'color', 'quality', 'defect', 'defectRate', 'mass', 'base', 'seed']]
    ];
    const rest = Array.from(body.children).filter(child => !Array.from(rows.values()).includes(child));
    const append = (title, keys) => {
      const chosen = keys.filter(key => rows.has(key)); if (!chosen.length) return;
      const group = el('fieldset', 'ed-machine-fields'); group.appendChild(el('legend', '', title));
      chosen.forEach(key => { group.appendChild(rows.get(key)); rows.delete(key); }); body.appendChild(group);
    };
    groups.forEach(([title, keys]) => append(title, keys)); append('Más parámetros', Array.from(rows.keys()));
    rest.forEach(child => body.appendChild(child));
  }

  renderRobotJoints(parent, object, config, update) {
    const schema = behaviorSchema.robots, joints = schema.getJointDefinitions(config);
    parent.appendChild(el('p', 'ed-hint', 'Vincula el equipo de recogida y el receptor; usa Probar para operar. En Manual, Marcha habilita y Despachar solicita un ciclo. El receptor ocupado retiene la carga.'));
    const group = el('details', 'ed-component-source'); group.appendChild(el('summary', '', 'Ejes · postura inicial y límites'));
    if (!joints.length) group.appendChild(el('p', 'ed-hint', 'La plataforma móvil utiliza la ruta local; sus puntos se expresan en metros respecto a la posición inicial.'));
    joints.forEach(joint => {
      const rotational = joint.unit === 'rad', factor = rotational ? 180 / Math.PI : 1;
      const slider = el('input'); slider.type = 'range'; slider.min = joint.min * factor; slider.max = joint.max * factor; slider.step = rotational ? 1 : .01; slider.value = joint.home * factor;
      slider.setAttribute('aria-label', 'Postura inicial ' + joint.id); slider.setAttribute('data-robot-joint', joint.id);
      const row = this.field(group, joint.id + ' · ' + (rotational ? 'giro °' : 'carrera m'), slider), output = el('output', '', (joint.home * factor).toFixed(rotational ? 0 : 2)); row.appendChild(output);
      slider.addEventListener('input', () => { output.textContent = Number(slider.value).toFixed(rotational ? 0 : 2); });
      slider.addEventListener('change', () => {
        const limits = JSON.parse(config.jointLimitsJson), entry = {id: joint.id, min: joint.min, max: joint.max, home: Number(slider.value) / factor};
        update('jointLimitsJson', JSON.stringify(limits.filter(item => item.id !== joint.id).concat([entry])));
      });
    });
    const limits = el('textarea'); limits.rows = 4; limits.value = config.jointLimitsJson; limits.maxLength = schema.MAX_JOINT_JSON;
    limits.setAttribute('aria-label', 'Límites articulares del robot'); this.field(group, 'Límites personalizados · radianes / metros', limits).addEventListener('change', () => update('jointLimitsJson', limits.value));
    group.appendChild(el('p', 'ed-hint', 'Los límites personalizados reducen el recorrido del modelo. El diseño paramétrico cambia las piezas y la cinemática conjuntamente; Detalle ligero reduce la geometría de acabado.'));
    parent.appendChild(group);
  }

  renderInteractionInspector(object) {
    const section = this.section('AL PULSAR · MOUSE / VR');
    const current = object.userData.editorInteraction || {type: 'none'};
    const type = el('select');
    [['none', 'Sin acción'], ['room', 'Ir a una sala'], ['toggle', 'Mostrar / ocultar objeto'], ['sound', 'Reproducir sonido'], ['message', 'Mostrar información'], ['teleport', 'Superficie de teletransporte VR']].forEach(([id, label]) => {
      const option = el('option', '', label); option.value = id; type.appendChild(option);
    });
    type.value = current.type;
    type.setAttribute('aria-label', 'Acción al pulsar el objeto');
    type.addEventListener('change', () => this.perform(() => this.document.setInteraction(object, {type: type.value})));
    section.appendChild(type);
    const set = fields => this.perform(() => this.document.setInteraction(object, Object.assign({}, current, fields)));
    if (current.type === 'room') {
      const select = el('select');
      ROOM_LABELS.forEach((name, i) => { const option = el('option', '', name); option.value = i; select.appendChild(option); });
      select.value = current.room === undefined ? 0 : current.room;
      this.field(section, 'Destino', select).addEventListener('change', () => set({room: Number(select.value)}));
    } else if (current.type === 'toggle') {
      const select = el('select');
      const placeholder = el('option', '', 'Selecciona el objeto…'); placeholder.value = ''; select.appendChild(placeholder);
      this.document.getObjects(this.roomId).filter(item => item !== object).forEach(item => {
        const option = el('option', '', item.name || item.type); option.value = item.userData.editorId; select.appendChild(option);
      });
      select.value = current.targetId || '';
      this.field(section, 'Objeto', select).addEventListener('change', () => set({targetId: select.value}));
    } else if (current.type === 'sound') {
      const select = el('select');
      const placeholder = el('option', '', 'Selecciona un audio…'); placeholder.value = ''; select.appendChild(placeholder);
      this.entries.filter(entry => entry.kind === 'audio').forEach(entry => {
        const option = el('option', '', entry.name); option.value = entry.importId || entry.path; select.appendChild(option);
      });
      select.value = current.asset || '';
      this.field(section, 'Audio', select).addEventListener('change', () => set({asset: select.value}));
    } else if (current.type === 'message') {
      const text = el('textarea'); text.rows = 4; text.maxLength = 650; text.placeholder = 'Información que verá el visitante…'; text.value = current.text || '';
      this.field(section, 'Mensaje', text).addEventListener('change', () => set({text: text.value}));
    } else if (current.type === 'teleport') section.appendChild(el('p', 'ed-hint', 'Usa un plano horizontal. El teletransporte conserva el sistema VR nativo.'));
  }

  simulationVariables(object) {
    const fields = new Map();
    const labels = {actuatorPosition: 'Posición del actuador (0–1)', actuatorAngle: 'Ángulo del actuador (rad)', elevatorPosition: 'Nivel del elevador (m)', zonesOccupied: 'Zonas ocupadas',
      mechanismReady: 'Mecanismo listo para recibir', mechanismBusy: 'Mecanismo ocupado', atLowerLevel: 'Sensor de nivel inferior', atUpperLevel: 'Sensor de nivel superior',
      actuatorExtended: 'Actuador extendido', actuatorRetracted: 'Actuador retraído', operatorAvailable: 'Operario disponible'};
    const add = (keys, writable) => keys.forEach(key => fields.set(key, {key, writable,
      label: labels[key] || (/^zone\d+Occupied$/.test(key) ? 'Zona ' + key.match(/\d+/)[0] + ' · sensor de ocupación' : /^zone\d+Speed$/.test(key) ? 'Zona ' + key.match(/\d+/)[0] + ' · velocidad real (m/s)' : key),
      boolean: ['running', 'powered', 'paused', 'autoSpawn', 'emergency', 'palletFull', 'transferBlocked', 'externalSupply', 'internalSupplyActive', 'enabled', 'active', 'occupied', 'autoGenerate', 'blocked', 'full', 'empty', 'operatorAvailable', 'busy', 'settingUp', 'waitingOperator',
        'mechanismReady', 'mechanismBusy', 'atLowerLevel', 'atUpperLevel', 'actuatorExtended', 'actuatorRetracted', 'parkingBrake', 'lights', 'loaded'].includes(key) || /^zone(?:[1-9]|[12][0-9]|3[0-2])Occupied$/.test(key)}));
    this.document.getBehaviors(object).forEach(config => {
      if (config.type === 'conveyor') {
        add(config.drive === 'gravity' || config.drive === 'manual' ? ['enabled'] : ['running', 'powered', 'paused', 'autoSpawn', 'speed', 'emergency', 'enabled'], true);
        add(['actualSpeed', 'inFlight', 'entryCount', 'exitCount', 'runSeconds', 'transferBlocked', 'externalSupply', 'internalSupplyActive', 'moduleCount', 'routedMain', 'routedBranch', 'routingUnmatched', 'mechanismReady', 'mechanismBusy'], false);
        if (!['transport', 'zones'].includes(config.mechanism || 'transport')) add(['actuatorPosition', 'actuatorAngle', 'actuatorExtended', 'actuatorRetracted'], false);
        if (config.mechanism === 'elevator') add(['elevatorPosition', 'atLowerLevel', 'atUpperLevel'], false);
        if (config.mechanism === 'loading') add(['operatorAvailable'], true);
        if (config.mechanism === 'zones') {
          add(['zonesOccupied'], false);
          for (let index = 1; index <= Math.min(32, Math.ceil(config.length / config.zoneLength)); index++) add(['zone' + index + 'Occupied', 'zone' + index + 'Speed'], false);
        }
      }
      if (config.type === 'palletQueue') {
        add(['enabled', 'running', 'paused', 'outputInterval'], true);
        add(['queued', 'queuedUnits', 'capacity', 'occupancy', 'full', 'empty', 'blocked', 'received', 'receivedUnits', 'delivered', 'deliveredUnits'], false);
        if (behaviorSchema.warehouseRacks.isRack(config)) {
          add(['rackSelectedSlot', 'rackOpenAisle', 'rackMechanismSpeed'], true);
          add(['rackSystem', 'rackBusy', 'rackStatus', 'rackBlocked', 'rackPresentedSlot', 'rackLoadKg'], false);
        }
      }
      if (config.type === 'source') { add(['running', 'paused', 'autoGenerate', 'interval', 'outputInterval', 'enabled'], true); add(['queued', 'queuedUnits', 'capacity', 'generated', 'generatedUnits', 'delivered', 'deliveredUnits', 'received', 'receivedUnits', 'blocked', 'full', 'empty', 'remaining'], false); }
      if (config.type === 'robot') {
        add(['powered', 'running', 'paused', 'emergency', 'speed', 'enabled'], true);
        add(['inFlight', 'entryCount', 'exitCount', 'receivedUnits', 'deliveredUnits', 'completed', 'loadKg', 'payloadKg', 'utilization', 'setupSeconds', 'processSeconds', 'idleSeconds', 'blockedSeconds', 'downSeconds', 'tcpX', 'tcpY', 'tcpZ', 'distance'], false);
      }
      if (config.type === 'processor') {
        add(['powered', 'running', 'paused', 'emergency', 'enabled', 'processTime', 'setupTime', 'operatorAvailable', 'outputInterval'], true);
        add(['busy', 'settingUp', 'waitingOperator', 'blocked', 'full', 'empty', 'queued', 'queuedUnits', 'outputQueued', 'capacity', 'parallelism', 'outputCapacity', 'activeJobs', 'progress', 'setupProgress', 'setupRemaining', 'entryCount', 'exitCount', 'receivedUnits', 'deliveredUnits', 'completed', 'completedUnits', 'utilization', 'setupSeconds', 'processSeconds', 'idleSeconds', 'blockedSeconds', 'operatorWaitSeconds', 'downSeconds', 'nominalCapacity'], false);
      }
      if (config.type === 'vehicle') {
        add(['enabled', 'powered', 'running', 'paused', 'emergency', 'parkingBrake', 'lights', 'speed'], true);
        add(['actualSpeed', 'lift', 'forkHeight', 'tilt', 'reach', 'sideShift', 'turret', 'steer', 'boomAngle', 'loadKg', 'capacityKg', 'payloadKg', 'loaded', 'receivedUnits', 'deliveredUnits', 'distance', 'batteryPercent', 'runSeconds', 'idleSeconds', 'blockedSeconds', 'blocked'], false);
      }
      if (config.type === 'motion') { add(['enabled', 'speed'], true); add(['position'], false); }
      if (config.type === 'sensor') { add(['enabled'], true); add(['active', 'occupied', 'count'], false); }
      if (config.type === 'automation') add(['enabled'], true);
    });
    return Array.from(fields.values());
  }

  renderRuleBuilder(parent, object, config, update) {
    const builder = el('details', 'ed-rule-builder'); builder.open = true;
    builder.appendChild(el('summary', '', 'Programar una regla · SI → ENTONCES'));
    const sourceObjects = this.document.getObjects(this.roomId).filter(item => this.simulationVariables(item).length);
    const targets = sourceObjects.filter(item => this.simulationVariables(item).some(field => field.writable));
    const rules = JSON.parse(config.rules);
    rules.forEach((rule, index) => {
      const source = this.document.getObject(rule.sourceId === 'self' ? object.userData.editorId : rule.sourceId);
      const target = this.document.getObject(rule.targetId === 'self' ? object.userData.editorId : rule.targetId);
      const row = el('div', 'ed-rule');
      row.appendChild(el('p', 'ed-hint', 'SI ' + (source && source.name || rule.sourceId) + '.' + rule.variable + ' ' + rule.operator + ' ' + rule.value + ' → ' + (target && target.name || rule.targetId) + '.' + rule.targetVariable + ' = ' + rule.set));
      row.appendChild(button('Quitar regla', 'Quitar esta condición y su acción', () => update('rules', JSON.stringify(rules.filter((item, i) => i !== index))), 'danger'));
      builder.appendChild(row);
    });
    if (!sourceObjects.length || !targets.length) {
      builder.appendChild(el('p', 'ed-hint', 'Añade sensores, una banda o movimiento a los objetos para conectar sus variables.')); parent.appendChild(builder); return;
    }
    const form = el('div', 'ed-rule-form');
    const source = el('select'), variable = el('select'), target = el('select'), targetVariable = el('select');
    const fillObjects = (input, list) => list.forEach(item => { const option = el('option', '', (item.name || item.type) + ' · ' + item.userData.editorId); option.value = item.userData.editorId; input.appendChild(option); });
    fillObjects(source, sourceObjects); fillObjects(target, targets);
    source.value = (sourceObjects.find(item => this.document.getBehaviors(item).some(config => config.type === 'sensor')) || sourceObjects[0]).userData.editorId;
    target.value = (targets.find(item => this.document.getBehaviors(item).some(config => config.type === 'conveyor')) || targets[0]).userData.editorId;
    const fillVariables = (objects, input, writableOnly) => {
      input.textContent = '';
      const selected = this.document.getObject(objects.value);
      const fields = this.simulationVariables(selected).filter(field => !writableOnly || field.writable);
      fields.forEach(field => { const option = el('option', '', field.label && field.label !== field.key ? field.label + ' · ' + field.key : field.key); option.value = field.key; input.appendChild(option); });
      input.value = fields.length ? fields[0].key : '';
    };
    fillVariables(source, variable, false); fillVariables(target, targetVariable, true);
    if (this.simulationVariables(this.document.getObject(source.value)).some(field => field.key === 'active')) variable.value = 'active';
    source.addEventListener('change', () => fillVariables(source, variable, false));
    target.addEventListener('change', () => fillVariables(target, targetVariable, true));
    const operator = el('select');
    [['eq', '='], ['ne', '≠'], ['gt', '>'], ['gte', '≥'], ['lt', '<'], ['lte', '≤']].forEach(([value, label]) => { const option = el('option', '', label); option.value = value; operator.appendChild(option); }); operator.value = 'eq';
    const edge = el('select');
    [['rising', 'Al cumplirse'], ['falling', 'Al dejar de cumplirse'], ['level', 'Mientras se cumpla']].forEach(([value, label]) => { const option = el('option', '', label); option.value = value; edge.appendChild(option); }); edge.value = 'rising';
    const value = el('input'); value.value = 'true';
    const set = el('input'); set.value = 'false';
    [['SI · objeto', source], ['Variable de entrada', variable], ['Comparación', operator], ['Valor (true / false o número)', value], ['Cuándo evaluar', edge], ['ENTONCES · objeto', target], ['Variable de salida', targetVariable], ['Asignar valor', set]].forEach(([label, input]) => {
      input.setAttribute('aria-label', label); this.field(form, label, input);
    });
    form.appendChild(button('+ Añadir regla', 'Conectar la condición con la variable de salida', () => {
      const scalar = (text, field) => {
        if (field.boolean) {
          if (['true', '1', 'sí', 'si'].includes(text.trim().toLowerCase())) return true;
          if (['false', '0', 'no'].includes(text.trim().toLowerCase())) return false;
          throw new Error('La variable ' + field.key + ' requiere true o false.');
        }
        if (!text.trim() || !Number.isFinite(Number(text))) throw new Error('La variable ' + field.key + ' requiere un número.');
        return Number(text);
      };
      try {
        const sourceField = this.simulationVariables(this.document.getObject(source.value)).find(field => field.key === variable.value);
        const targetField = this.simulationVariables(this.document.getObject(target.value)).find(field => field.key === targetVariable.value);
        const rule = {sourceId: source.value, variable: variable.value, operator: operator.value, value: scalar(value.value, sourceField),
          targetId: target.value, targetVariable: targetVariable.value, set: scalar(set.value, targetField), edge: edge.value};
        update('rules', JSON.stringify(rules.concat(rule)));
      } catch (error) { this.toast(error.message); }
    }, 'primary'));
    builder.appendChild(form); parent.appendChild(builder);
  }

  renderAssets() {
    if (!this.editorEnabled) return;
    if (this.resourceBrowser) {
      const studio = this.document.studio || {};
      this.resourceBrowser.setEntries(this.entries);
      this.resourceBrowser.setProject({id: this.currentProject && this.currentProject.id, organization: studio.organization,
        templates: studio.templates || [], resources: studio.resources || [], widgets: studio.widgets || [], missions: studio.missions || [], scenes: this.getSceneEntries()});
      this.resourceBrowser.setActive(this.active);
      if (this.resourceBrowser.setListingVisible) this.resourceBrowser.setListingVisible(!this.assets.hidden);
      if (this.resourceBrowser.render() !== false) return;
    }
    if (!this.assetGrid) return;
    if (this.assetThumbnails) this.assetThumbnails.reset();
    this.folderList.textContent = ''; this.assetGrid.textContent = '';
    this.assetCards = new Map();
    const folders = new Set(['']);
    this.entries.forEach(entry => { if (!entry.importId && entry.path.includes('/')) folders.add(entry.path.slice(0, entry.path.lastIndexOf('/'))); });
    if (this.entries.some(entry => entry.importId)) folders.add('@imports');
    Array.from(folders).sort().forEach(folder => {
      const row = button('▱ ' + (folder === '' ? 'Todos los archivos' : folder === '@imports' ? 'Importados' : folder), 'Ver carpeta', () => { this.folder = folder; this.renderAssets(); }, this.folder === folder ? 'active' : '');
      this.folderList.appendChild(row);
    });
    const query = this.assetQuery.toLowerCase();
    const filtered = this.entries.filter(entry => {
      const folderMatch = this.folder === '' || (this.folder === '@imports' ? Boolean(entry.importId) : !entry.importId && entry.path.startsWith(this.folder + '/'));
      return folderMatch && (this.assetKind === 'all' || entry.kind === this.assetKind) && (!query || entry.path.toLowerCase().includes(query));
    });
    const icons = {model: '◇', image: '▧', audio: '♫', video: '▶', source: '◉', text: '{ }', other: '▤'};
    filtered.forEach(entry => {
      const card = button('', entry.path + (entry.kind === 'model' ? ' · Doble clic o arrastrar para añadir' : ''), () => this.previewAsset(entry), 'ed-asset-card');
      card.setAttribute('aria-label', 'Previsualizar ' + entry.name);
      const selected = Boolean(this.selectedAsset && (entry.importId || entry.path) === (this.selectedAsset.importId || this.selectedAsset.path));
      card.classList.toggle('selected', selected); card.setAttribute('aria-pressed', selected);
      this.assetCards.set(entry.importId || entry.path, card);
      const thumbnail = el('span', 'ed-file-thumbnail ed-kind-' + entry.kind);
      thumbnail.appendChild(el('span', 'ed-file-icon', icons[entry.kind] || '▤'));
      card.appendChild(thumbnail);
      card.appendChild(el('span', 'ed-file-name', entry.name));
      card.appendChild(el('span', 'ed-file-ext', entry.extension.toUpperCase() + ' · ' + this.formatSize(entry.size)));
      if (PLACEABLE_KINDS.includes(entry.kind)) {
        card.draggable = true;
        card.addEventListener('dragstart', event => event.dataTransfer.setData('application/x-webxr-asset', entry.importId || entry.path));
        card.addEventListener('dblclick', () => this.addAsset(entry));
      }
      this.assetGrid.appendChild(card);
      if (this.active && this.assetThumbnails) this.assetThumbnails.attach(entry, thumbnail);
    });
    if (!filtered.length) this.assetGrid.appendChild(el('p', 'ed-hint', 'No hay archivos para este filtro.'));
  }

  async placeResource(resource) {
    const action = resource && resource.action;
    if (!action) return;
    if (resource.status === 'development' || resource.status === 'En desarrollo') return this.toast(resource.reason || 'Este recurso está en desarrollo.');
    if (action.type === 'asset') return this.addAsset(action.entry || resource.asset);
    if (action.type === 'decal') return this.startDecalPlacement();
    if (action.type === 'scene') {
      const index = ROOM_IDS.indexOf(action.roomId); if (index >= 0) this.hooks.gotoRoom(index);
      return;
    }
    if (action.type === 'template') return this.studioTools && this.studioTools.placeTemplate(action.template);
    if (action.type === 'widget') return this.studioTools && this.studioTools.addWidget(action.kind);
    if (action.type === 'workspace') return this.shell && this.shell.openWorkspace(action.workspace);
    if (action.type === 'studio') return this.studioTools && typeof this.studioTools[action.method] === 'function' && this.studioTools[action.method]();
    return this.perform(() => {
      if (action.type === 'primitive') return this.createPlacedObject(() => this.document.addPrimitive(this.roomId, action.kind));
      if (action.type === 'prefab') {
        const object = this.createPlacedObject(() => this.document.addPrefab(this.roomId, action.kind, action.variant));
        this.focus(); return object;
      }
    });
  }

  clearAssetPreview() {
    if (this.resourceBrowser && this.resourceBrowser.clearPreview) this.resourceBrowser.clearPreview();
    this.previewToken = (this.previewToken || 0) + 1;
    if (this.previewContent && this.library.cancelPreview) this.library.cancelPreview(this.previewContent);
    if (this.previewCleanup) this.previewCleanup();
    this.previewCleanup = null; this.previewContent = null;
  }

  startDecalPlacement(entry = this.selectedAsset, object = null) {
    if (!this.active || this.loadingProject) return;
    if (!entry || entry.kind !== 'image') {
      this.assetKind = 'image'; this.kindSelect.value = 'image'; this.renderAssets();
      if (this.resourceBrowser && this.resourceBrowser.state) {
        this.resourceBrowser.state.kind = 'image'; this.resourceBrowser.state.folder = ''; this.resourceBrowser.state.query = ''; this.resourceBrowser.refresh();
      }
      if (this.shell) this.shell.setPanel('resources', true);
      this.toast('Selecciona una imagen en Biblioteca o Proyecto y pulsa «Colocar decal». PNG conserva su transparencia.');
      return;
    }
    this.cancelDecalPlacement();
    this.clearAssembly();
    this.clearNavigation();
    this.decalPlacement = {entry, object};
    this.transform.enabled = false; this.transform.detach(); this.transform.visible = false;
    this.viewport.classList.add('ed-placing-decal');
    this.decalPlacementLabel.textContent = 'Decal · ' + entry.name + ' · Haz clic en una superficie';
    this.decalPlacementBar.hidden = false;
  }

  cancelDecalPlacement() {
    if (this.wearBrush) this.stopWearBrush();
    if (!this.decalPlacement) return;
    this.decalPlacement = null;
    this.decalPlacementBar.hidden = true;
    this.viewport.classList.remove('ed-placing-decal');
    this.transform.enabled = this.active && !this.loadingProject;
    this.transform.visible = true;
    if (this.selected && this.active && this.toolMode !== 'select') this.transform.attach(this.selected);
    this.refreshAssembly();
  }

  placeDecalAtHit(hit, direction) {
    const placement = this.decalPlacement;
    if (!placement || !this.decals.isSurface(hit.object)) return;
    const target = this.document.getEditableObject(hit.object);
    if (!target) throw new Error('Selecciona una superficie del escenario.');
    hit.object.updateWorldMatrix(true, false);
    const normal = hit.face ? hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize() : new THREE.Vector3(0, 0, 1);
    if (direction && normal.dot(direction) > 0) normal.negate();
    const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    this.root.updateWorldMatrix(true, false);
    const world = new THREE.Matrix4().compose(hit.point, rotation, new THREE.Vector3(1, 1, 1));
    const local = new THREE.Matrix4().getInverse(this.root.matrixWorld).multiply(world);
    const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
    local.decompose(position, quaternion, scale);
    const transform = {position: position.toArray(), quaternion: quaternion.toArray(), scale: scale.toArray()};
    const config = Object.assign({}, placement.object && this.document.getBehaviors(placement.object).find(component => component.type === 'decal'), {
      type: 'decal', asset: placement.entry.importId || placement.entry.path, targetId: target.userData.editorId
    });
    this.cancelDecalPlacement();
    this.document.begin();
    try {
      const object = placement.object || this.document.addDecal(this.roomId, config, transform);
      if (placement.object) {
        this.document.setBehaviors(object, this.document.getBehaviors(object).filter(component => component.type !== 'decal').concat([config]));
        this.document.setTransform(object, transform);
      } else this.document.rename(object, 'Decal · ' + placement.entry.name.slice(0, 140));
      this.document.commit();
      this.toast('Decal colocado. Ajusta tamaño, profundidad, opacidad y rotación en el inspector.');
      return object;
    } catch (error) { this.document.cancel(); throw error; }
  }

  async previewAsset(entry) {
    this.selectedAsset = entry;
    if (this.assetCards) this.assetCards.forEach((card, key) => {
      const selected = key === (entry.importId || entry.path);
      card.classList.toggle('selected', selected); card.setAttribute('aria-pressed', selected);
    });
    if (this.selected) this.renderInspector();
    this.clearAssetPreview();
    const token = this.previewToken;
    this.preview.textContent = '';
    this.preview.appendChild(el('strong', 'ed-preview-title', entry.name));
    this.preview.appendChild(el('span', 'ed-file-ext', entry.extension.toUpperCase() + ' · ' + this.formatSize(entry.size)));
    if (PLACEABLE_KINDS.includes(entry.kind)) this.preview.appendChild(button(entry.kind === 'image' ? '+ Añadir como imagen' : '+ Añadir a la escena', 'Añadir este archivo al escenario', () => this.addAsset(entry), 'primary'));
    if (entry.kind === 'image') {
      this.preview.appendChild(button('+ Colocar decal', 'Proyectar esta imagen sobre una pared, suelo u objeto', () => this.startDecalPlacement(entry)));
      if (this.selected) this.preview.appendChild(button('Usar como textura', 'Aplicar esta imagen a la parte elegida en MATERIAL · SUPERFICIE', () =>
        this.materialInspector.applyTexture(this.selected, entry.importId || entry.path)));
    }
    const content = el('div', 'ed-preview-content'); this.preview.appendChild(content); this.previewContent = content;
    try {
      const cleanup = await this.library.preview(entry, content);
      if (token !== this.previewToken) { if (cleanup) cleanup(); return; }
      this.previewCleanup = cleanup;
    } catch (error) { if (token === this.previewToken) content.appendChild(el('p', 'ed-error', error.message)); }
  }

  async addAsset(entry) {
    const descriptor = entry.importId ? {importId: entry.importId} : {path: entry.path};
    const roomId = this.roomId, generation = this.projectGeneration;
    return this.perform(async () => {
      this.toast('Cargando ' + entry.name + '…');
      const object = await this.document.addAsset(roomId, descriptor, object => {
        if (!this.active || roomId !== this.roomId || generation !== this.projectGeneration) throw new Error('La sala cambió durante la carga. Vuelve a añadir el modelo en el editor.');
        this.equipmentPlacement.place(object, this.orbit.target);
      });
      this.toast('Modelo colocado sobre el suelo en un espacio libre. Ajusta su posición y tamaño en el inspector.');
      return object;
    });
  }

  rememberProject(project) {
    try {
      if (this.editorEnabled) {
        if (project && project.id && !/^public-|^library-/.test(project.id)) localStorage.setItem(this.scopedStorageKey(ACTIVE_PROJECT_KEY), project.id);
        else localStorage.removeItem(this.scopedStorageKey(ACTIVE_PROJECT_KEY));
      }
    } catch (error) { /* SQLite saving does not depend on browser storage. */ }
    if (window.history && window.history.replaceState) {
      const url = new URL(window.location);
      if (project && project.publicSceneId) { url.searchParams.set('scene', project.publicSceneId); url.searchParams.delete('project'); if (ROOM_IDS.includes(url.searchParams.get('room'))) url.searchParams.delete('room'); }
      else if (project && project.librarySceneId) { url.searchParams.set('libraryScene', project.librarySceneId); url.searchParams.delete('project'); url.searchParams.delete('scene'); url.searchParams.delete('room'); }
      else if (project && (this.editorEnabled || this.explicitProject)) { url.searchParams.set('project', project.id); url.searchParams.set('room', this.roomId); url.searchParams.delete('scene'); }
      else url.searchParams.delete('project');
      url.searchParams.delete('editor');
      window.history.replaceState(null, '', url.href);
    }
  }

  projectSyncState() {
    return {project: this.canEditDocument() ? this.currentProject : null, dirty: this.dirty, busy: !this.canEditDocument() || this.busy || this.ctx.roomTransition || this.importingFiles || this.pendingEdits > 0 || Boolean(this.projectLibrary.busy),
      loading: this.loadingProject || this.initializing,
      transaction: this.document.transaction || this.transform && this.transform.dragging || isTyping({target: document.activeElement || {}}),
      pinned: Boolean(this.historicalRevision), active: this.active, vrMode: this.ctx.vrMode,
      allowDiscover: this.canEditDocument() && !this.currentProject && !this.explicitProject && !this.dirty};
  }

  markRemoteProject(project) {
    this.remoteProject = project;
    this.updateStatus();
  }

  async receiveRemoteProject(project, expected) {
    const state = this.projectSyncState();
    if (!this.active || this.ctx.vrMode || state.dirty || state.busy || state.loading || state.transaction || state.pinned ||
      (this.currentProject ? this.currentProject.id : null) !== expected.id ||
      (this.currentProject ? this.currentProject.revision : null) !== expected.revision) return false;
    const selectedId = this.selected && this.selected.userData.editorId;
    await this.applyServerProject(project);
    if (selectedId) this.select(this.document.getObject(selectedId));
    this.toast('«' + project.name + '» actualizado desde SQLite · versión ' + project.revision + '.');
    return true;
  }

  async refreshRemoteProject() {
    if (this.dirty) throw new Error('Hay cambios sin guardar en esta pestaña. Usa Proyectos → Guardar copia para conservarlos antes de actualizar.');
    if (this.busy || this.loadingProject || this.pendingEdits || this.document.transaction || this.transform.dragging) throw new Error('Espera a que termine la edición actual antes de actualizar.');
    const id = this.currentProject && this.currentProject.id || this.remoteProject && this.remoteProject.id;
    if (!id) return;
    const expected = {id: this.currentProject ? this.currentProject.id : null, revision: this.currentProject ? this.currentProject.revision : null};
    const project = await this.projectClient.getProject(id);
    if (!await this.receiveRemoteProject(project, expected)) throw new Error('El escenario cambió mientras se actualizaba. Tus cambios locales se conservaron.');
  }

  async shareProject() {
    if (!this.editorEnabled) return;
    if (!this.currentProject || this.dirty) {
      const saved = await this.saveProject();
      if (!saved || this.dirty) throw new Error('Espera a que termine de guardarse el proyecto antes de compartirlo.');
    }
    const url = new URL(window.location);
    url.pathname = '/editor';
    url.searchParams.set('project', this.currentProject.id);
    url.searchParams.set('room', this.roomId);
    url.searchParams.delete('editor');
    this.shareLinkInput.value = url.href; this.shareOpenLink.href = url.href; this.sharePanel.hidden = false;
    if (this.sharing) await this.sharing.open();
    if (this.shareLinkInput.focus) this.shareLinkInput.focus();
    if (this.shareLinkInput.select) this.shareLinkInput.select();
    try {
      if (window.navigator && window.navigator.clipboard) {
        await window.navigator.clipboard.writeText(url.href);
        this.toast('Enlace copiado. Abre el mismo proyecto en otra pestaña o navegador.');
      }
    } catch (error) { this.toast('Copia el enlace del campo para abrir este proyecto en otro navegador.'); }
    return url.href;
  }

  async applyServerProject(project, options = {}) {
    if (!this.accessView || !this.accessView.enabled) return this.applyServerProjectNow(project, options);
    const generation = options.accessGeneration === undefined ? this.accessView.identityGeneration : options.accessGeneration;
    const execute = async () => {
      if (generation !== this.accessView.identityGeneration) throw new Error('La cuenta cambió durante la apertura del proyecto.');
      return this.applyServerProjectNow(project, Object.assign({}, options, {accessGeneration: generation}));
    };
    const task = (this.projectApplicationTail || Promise.resolve()).catch(() => {}).then(execute);
    this.projectApplicationTail = task; return task;
  }

  async applyServerProjectNow(project, options = {}) {
    if (!options.transitionApplication) {
      let previous = null, restored = false;
      // The transition's final preparation/GPU warmup runs after execute()
      // returns. Keep its rollback alive through that outer phase as well.
      const recover = async error => {
        if (!previous || restored) return;
        this.stopRuntime();
        const scopeValid = !this.accessView || !this.accessView.enabled || previous.identity === this.accessView.identityGeneration;
        if (!scopeValid) {this.document.rooms.forEach(entry => {entry.root.visible = false;}); error.keepRoomCover = true; throw error;}
        try {
          this.loadingProject = true;
          this.document._restore(previous.snapshot);
          this.document.undoStack.splice(0, this.document.undoStack.length, ...previous.undo);
          this.document.redoStack.splice(0, this.document.redoStack.length, ...previous.redo);
          Object.assign(this, previous.metadata);
          this.loadingAllowedRoomIds = this.currentProject && this.currentProject.allowedRoomIds || null;
          // Recovery must not inherit an aborted destination's signal.
          await this.prepareRoom(previous.roomId);
          if (this.roomId !== previous.roomId) await this.hooks.gotoRoom(ROOM_IDS.indexOf(previous.roomId));
          previous.visible.forEach(([root, visible]) => {root.visible = visible;});
          if (previous.rig && this.ctx.cameraRig) {this.ctx.cameraRig.position.copy(previous.rig.position); this.ctx.cameraRig.quaternion.copy(previous.rig.quaternion);}
          if (previous.camera && this.ctx.camera && !this.ctx.vrMode) {this.ctx.camera.position.copy(previous.camera.position); this.ctx.camera.quaternion.copy(previous.camera.quaternion);}
          this.syncNative();
          if (this.ctx.roomAssets && this.ctx.roomAssets.setActiveRoom) this.ctx.roomAssets.setActiveRoom(previous.roomId, this.document.getRoot(previous.roomId));
          this.entries = await this.library.getCatalog(); this.renderAssets();
          this.select(null); this.updateStatus();
          if (!this.active && !this.ctx.roomTransition) this.startRuntime();
          restored = true;
        } catch (recoveryError) {
          this.document.rooms.forEach(entry => {entry.root.visible = false;});
          error.keepRoomCover = true; error.recoveryError = recoveryError; throw error;
        } finally {this.loadingProject = false; this.loadingAllowedRoomIds = null;}
      };
      const execute = async request => {
        if (request) request.assertCurrent();
        // Capture authored poses after detaching live products/vehicle input.
        // No partially loaded document or failed runtime is ever uncovered.
        this.stopRuntime();
        restored = false;
        previous = {snapshot: this.document.capture(), roomId: this.roomId,
          identity: this.accessView && this.accessView.identityGeneration,
          undo: this.document.undoStack.slice(), redo: this.document.redoStack.slice(),
          visible: Array.from(this.document.rooms.values()).map(entry => [entry.root, entry.root.visible]),
          metadata: {currentProject: this.currentProject, publicView: this.publicView, projectName: this.projectName,
            historicalRevision: this.historicalRevision, dirty: this.dirty, storageAvailable: this.storageAvailable, remoteProject: this.remoteProject},
          camera: this.ctx.camera && {position: this.ctx.camera.position.clone(), quaternion: this.ctx.camera.quaternion.clone()},
          rig: this.ctx.cameraRig && {position: this.ctx.cameraRig.position.clone(), quaternion: this.ctx.cameraRig.quaternion.clone()}};
        try {
          return await this.applyServerProjectNow(project, Object.assign({}, options, {transitionApplication: true, transitionRequest: request}));
        } catch (error) {
          await recover(error);
          throw error;
        }
      };
      return this.ctx.withRoomTransition ? this.ctx.withRoomTransition(execute, {label: 'Cargando ' + (project && project.name || 'escenario') + '…', recover}) : execute(null);
    }
    if (!project || !project.document) throw new Error('El proyecto recibido no contiene un escenario.');
    const request = options.transitionRequest;
    const assertCurrent = () => { if (request) request.assertCurrent(); };
    const preparation = request ? {signal: request.signal, assertCurrent, yieldControl: request.yieldControl} : {};
    assertCurrent();
    const declared = project.allowedRoomIds || (this.accessView && this.accessView.enabled ? (project.document.studio && project.document.studio.scenes || []).map(scene => scene.id || scene.roomId) : []);
    const initial = project.document.studio && project.document.studio.startRoomId;
    const requested = ROOM_IDS.includes(options.roomId) ? options.roomId : initial || this.roomId;
    const targetRoomId = declared.length && !declared.includes(requested) ? declared[0] : requested;
    this.cancelTransformDrag(); this.clearAssembly(true);
    this.projectGeneration++;
    this.clearNavigation();
    this.clearAssetPreview();
    this.assetThumbnails.dispose();
    this.cancelDecalPlacement(); this.decals.dispose();
    this.infoPreview.dispose();
    this.stopRuntime();
    this.loadingProject = true;
    this.loadingAllowedRoomIds = declared.length ? declared : null;
    const transformEnabled = this.transform.enabled;
    this.transform.enabled = false;
    let projectReady = false;
    try {
      if (options.workspaceSnapshot) this.document._restore(options.workspaceSnapshot);
      else await this.document.load(project.document, Object.assign({activeRoomId: targetRoomId}, preparation));
      assertCurrent();
      if (this.accessView && this.accessView.enabled && options.accessGeneration !== this.accessView.identityGeneration) throw new Error('La cuenta cambió durante la carga.');
      await this.prepareRoom(targetRoomId, preparation);
      assertCurrent();
      if (this.accessView && this.accessView.enabled && options.accessGeneration !== this.accessView.identityGeneration) throw new Error('La cuenta cambió durante la preparación.');
      this.currentProject = {id: project.id, name: project.name, revision: project.revision, access: project.access, allowedRoomIds: project.allowedRoomIds, publicSceneId: project.publicSceneId, librarySceneId: project.librarySceneId};
      this.publicView = Boolean(project.access && project.access.canEdit === false);
      this.clearObjectClipboard();
      this.projectName = project.name;
      if (targetRoomId !== this.roomId) await this.hooks.gotoRoom(ROOM_IDS.indexOf(targetRoomId));
      assertCurrent();
      this.historicalRevision = project.historicalRevision || null;
      // A project owns its edit history; previous projects stay in the database.
      this.document.undoStack.length = 0;
      this.document.redoStack.length = 0;
      this.entries = await this.library.getCatalog();
      assertCurrent();
      this.select(null);
      this.renderAssets();
      this.syncNative();
      if (this.ctx.roomAssets && this.ctx.roomAssets.setActiveRoom) this.ctx.roomAssets.setActiveRoom(targetRoomId, this.document.getRoot(targetRoomId));
      this.dirty = Boolean(project.historicalRevision);
      this.storageAvailable = true;
      this.rememberProject(project);
      this.markRemoteProject(null);
      this.updateStatus();
      projectReady = true;
    } finally {
      this.loadingProject = false;
      this.loadingAllowedRoomIds = null;
      this.transform.enabled = transformEnabled && this.active;
      const scopeValid = !this.accessView || !this.accessView.enabled || options.accessGeneration === this.accessView.identityGeneration;
      if (!scopeValid) this.document.rooms.forEach(entry => { entry.root.visible = false; });
      if (!this.active && scopeValid && projectReady && !this.ctx.roomTransition) this.startRuntime();
      this.simulationPanel.modeChanged();
      this.updateStatus();
    }
  }

  async keepCurrentProject() {
    if (!this.dirty) return false;
    const result = await this.saveProject();
    if (!result) throw new Error('Espera a que termine de guardarse el proyecto actual.');
    if (this.dirty) throw new Error('El escenario cambió mientras se guardaba. Guarda de nuevo antes de abrir otro proyecto.');
    return true;
  }

  async openServerProject(project, roomId) {
    if (this.busy || this.loadingProject || this.pastingObject || this.importingFiles) throw new Error('Espera a que termine la operación actual.');
    const saved = await this.keepCurrentProject();
    if (saved && this.currentProject && this.currentProject.id === project.id) {
      project = await this.projectClient.getProject(project.id, project.historicalRevision);
    }
    const initialRoom = project.document && project.document.studio && project.document.studio.startRoomId;
    const targetRoomId = ROOM_IDS.includes(roomId) ? roomId : (!this.currentProject || this.currentProject.id !== project.id) && ROOM_IDS.includes(initialRoom) ? initialRoom : this.roomId;
    await this.applyServerProject(project, {roomId: targetRoomId});
    this.toast(project.historicalRevision ? 'Versión ' + project.historicalRevision + ' abierta. Guardar creará una nueva versión.' : 'Proyecto «' + project.name + '» abierto.');
    return true;
  }

  async createServerProject(name) {
    if (this.busy || this.loadingProject || this.pastingObject || this.importingFiles) throw new Error('Espera a que termine la operación actual.');
    await this.keepCurrentProject();
    const rooms = {};
    Object.keys(this.ctx.editorRoots).forEach(id => { rooms[id] = {overrides: [], additions: []}; });
    const project = await this.projectClient.createProject(name, {format: 'hello-webxr-editor', version: 1, rooms, imports: []});
    await this.applyServerProject(project);
    this.toast('Proyecto «' + project.name + '» creado y guardado.');
    return true;
  }

  async saveProject(name, asCopy = false) {
    if (!this.canEditDocument()) throw new Error('Este escenario es de consulta. Crea una variante propia desde las plantillas para editarlo.');
    if (this.importingFiles) { this.toast('Espera a que termine la importación antes de guardar.'); return false; }
    if (this.busy || this.loadingProject) return false;
    this.busy = true;
    const identityGeneration = this.accessView && this.accessView.identityGeneration, projectGeneration = this.projectGeneration;
    const assertScope = () => { if (identityGeneration !== (this.accessView && this.accessView.identityGeneration) || projectGeneration !== this.projectGeneration) throw Object.assign(new Error('La cuenta o el proyecto cambió durante el guardado. El resultado anterior no se aplicó.'), {status: 409, code: 'session_changed'}); };
    this.updateStatus();
    try {
      const document = await this.document.serialize();
      assertScope();
      const version = this.changeVersion;
      const projectName = name || this.projectName;
      const saved = asCopy || !this.currentProject ?
        await this.projectClient.createProject(projectName, document) :
        await this.projectClient.updateProject(this.currentProject.id, projectName, document, this.currentProject.revision);
      assertScope();
      // Imported file identities are immutable. Keep imports added during the
      // request while replacing saved base64 data with lightweight server URLs.
      const references = new Map(saved.document.imports.map(record => [record.id, record]));
      this.library.restoreImports(this.library.exportImports().map(record => references.get(record.id) || record));
      this.currentProject = {id: saved.id, name: saved.name, revision: saved.revision, access: saved.access};
      this.projectName = saved.name;
      this.historicalRevision = null;
      this.storageAvailable = true;
      this.dirty = this.changeVersion !== version;
      this.rememberProject(saved);
      this.markRemoteProject(null);
      this.projectSync.publish(saved);
      try { localStorage.setItem(this.scopedStorageKey(STORAGE_KEY), JSON.stringify(saved.document)); } catch (error) { /* Server save already succeeded. */ }
      const catalog = await this.library.getCatalog(); assertScope(); this.entries = catalog; this.renderAssets();
      this.toast('«' + saved.name + '» guardado · versión ' + saved.revision + (this.dirty ? '. Hay cambios posteriores pendientes.' : '.'));
      return saved;
    } catch (error) {
      if (error.status === 409 && error.code !== 'session_changed') throw new Error('Este proyecto cambió en otra ventana. Usa Proyectos → Guardar copia para conservar tus cambios o abre la versión actual.');
      if (!error.status || error.status >= 500) this.storageAvailable = false;
      throw error;
    } finally { this.busy = false; this.updateStatus(); }
  }

  async saveLocal() {
    if (!this.canEditDocument()) return;
    if (this.busy) return;
    this.busy = true;
    const identityGeneration = this.accessView && this.accessView.identityGeneration, projectGeneration = this.projectGeneration, key = this.scopedStorageKey(STORAGE_KEY);
    try {
      const project = await this.document.serialize();
      const version = this.changeVersion;
      const wasDirty = this.dirty;
      project.imports = await this.library.exportPortableImports();
      if (identityGeneration !== (this.accessView && this.accessView.identityGeneration) || projectGeneration !== this.projectGeneration) throw new Error('La cuenta o el proyecto cambió. La copia anterior no se guardó en otra cuenta.');
      localStorage.setItem(key, JSON.stringify(project));
      this.dirty = this.changeVersion !== version || Boolean(this.currentProject && wasDirty);
      this.toast('Copia guardada en este navegador.' + (this.dirty ? ' El proyecto del servidor aún tiene cambios pendientes.' : ''));
    } catch (error) { this.toast('No se pudo guardar aquí. Descarga el JSON para conservarlo. ' + error.message); }
    finally { this.busy = false; this.updateStatus(); }
  }

  async exportProject() {
    const scope = this.accessView && this.accessView.identityGeneration, generation = this.projectGeneration;
    try {
      const project = await this.document.serialize();
      project.imports = await this.library.exportPortableImports();
      if (scope !== (this.accessView && this.accessView.identityGeneration) || generation !== this.projectGeneration) throw new Error('La cuenta o el proyecto cambió. Vuelve a solicitar la exportación.');
      const url = URL.createObjectURL(new Blob([JSON.stringify(project, null, 2)], {type: 'application/json'}));
      const link = el('a'); link.href = url; link.download = this.projectName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-') + '.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.toast('Escenario descargado. Incluye los archivos que importaste.');
    } catch (error) { this.toast(error.message); }
  }

  updateStatus() {
    if (!this.status) return;
    const persistence = this.currentProject ? this.projectName + ' · v' + this.currentProject.revision : this.projectName + ' · proyecto nuevo';
    const level = behaviorSchema.studio.sceneEntries(this.document).find(entry => entry.index === this.ctx.room);
    this.status.textContent = (this.importingFiles ? 'Importando archivos…' : this.busy ? 'Guardando…' : this.dirty ? '● Cambios sin guardar' : this.currentProject ? '○ Guardado' : '○ Escenario listo') + '   /   ' + persistence + '   /   ' + (this.storageAvailable ? 'SQLite' : 'Servidor sin conectar') + '   /   ' + (level ? level.name : ROOM_LABELS[this.ctx.room]) + (this.remoteProject ? '   /   Versión ' + this.remoteProject.revision + ' disponible en SQLite' : '') + '   /   Probar: escritorio y dispositivos XR compatibles';
    if (this.saveButton) this.saveButton.disabled = !this.canEditDocument() || this.busy || this.loadingProject || this.importingFiles;
    if (this.projectButton) {
      this.projectButton.textContent = 'Proyecto: ' + (this.currentProject ? this.projectName : 'Sin guardar') + ' ▾';
      this.projectButton.setAttribute('aria-label', 'Proyecto actual: ' + (this.currentProject ? this.projectName : 'Sin guardar') + '. Abrir proyectos y niveles');
      this.projectButton.title = this.currentProject ? 'Proyecto: ' + this.projectName + ' · ID ' + this.currentProject.id + ' · Abrir biblioteca' : 'Abrir, crear y recuperar proyectos de SQLite';
    }
    if (this.projectUpdateButton) {
      this.projectUpdateButton.hidden = !this.remoteProject;
      this.projectUpdateButton.textContent = this.remoteProject ? 'Actualizar · v' + this.remoteProject.revision : 'Actualizar proyecto';
      this.projectUpdateButton.disabled = this.busy || this.loadingProject;
      this.projectUpdateButton.title = this.dirty ? 'Hay otra versión guardada. Conserva tus cambios con Guardar copia antes de actualizar.' : 'Cargar ' + (this.remoteProject && this.remoteProject.name || '') + ' desde SQLite';
    }
    this.undoButton.disabled = !this.document.canUndo;
    this.redoButton.disabled = !this.document.canRedo;
    if (this.shell) this.shell.refresh();
  }
  formatSize(size) { return size >= 1048576 ? (size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(size / 1024)) + ' KB'; }
  toast(message) {
    this.toastNode.textContent = message;
    this.toastNode.hidden = false;
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => { this.toastNode.hidden = true; }, 4800);
  }
  onKey(event) {
    if (this.pastingObject) { if (event.ctrlKey || event.metaKey || NAVIGATION_KEYS.includes(event.code) || ['Space', 'Delete', 'Backspace'].includes(event.code)) event.preventDefault(); this.clearNavigation(); return; }
    if (!this.active || this.ctx.vrMode || isTyping(event) || this.keyboardOverlayOpen()) {
      this.clearNavigation();
      return;
    }
    if (this.transform.dragging) {
      if (event.ctrlKey || event.metaKey || NAVIGATION_KEYS.includes(event.code) || ['Space', 'Delete', 'Backspace', 'Escape'].includes(event.code)) event.preventDefault();
      if (event.code === 'Escape' || (event.ctrlKey || event.metaKey) && event.code === 'KeyZ' && !event.shiftKey) {
        event.preventDefault(); this.cancelTransformDrag();
      }
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      this.clearNavigation();
      if (this.wearBrushTool.stroke) {
        if (event.code === 'KeyZ' && !event.shiftKey) { event.preventDefault(); this.wearBrushTool.cancelStroke(); return; }
        this.wearBrushTool.finish();
      }
      if (event.code === 'KeyS') { event.preventDefault(); this.perform(() => this.saveProject()); }
      else if (event.code === 'KeyZ') { event.preventDefault(); this.perform(() => this.historyStep(event.shiftKey ? 'redo' : 'undo')); }
      else if (event.code === 'KeyY') { event.preventDefault(); this.perform(() => this.historyStep('redo')); }
      else if (event.code === 'KeyD' && this.selected) { event.preventDefault(); this.perform(() => this.duplicateObject()); }
      else if (event.code === 'KeyC' && this.selected && !event.shiftKey && !event.altKey) { event.preventDefault(); if (!event.repeat) this.perform(() => this.copyObject()); }
      else if (event.code === 'KeyV' && this.objectClipboard && !event.shiftKey && !event.altKey) { event.preventDefault(); if (!event.repeat) this.perform(() => this.pasteObject()); }
      else if (event.code === 'KeyA' && this.studioTools) { event.preventDefault(); this.studioTools.selectAll(); }
      else if (event.code === 'KeyG' && this.studioTools) { event.preventDefault(); this.studioTools[event.shiftKey ? 'ungroupSelection' : 'groupSelection'](); }
      return;
    }
    if (event.altKey) { this.clearNavigation(); return; }
    if (NAVIGATION_KEYS.includes(event.code)) {
      event.preventDefault();
      if (this.wearBrushTool.stroke) return;
      if (!this.loadingProject && !this.transform.dragging) this.navigationKeys.add(event.code);
      return;
    }
    if (event.code === 'Space') {
      event.preventDefault();
      if (!event.repeat && !this.loadingProject) this.setTool(TOOL_MODES[(TOOL_MODES.indexOf(this.toolMode) + 1) % TOOL_MODES.length]);
    }
    else if (event.code === 'KeyF') this.focus();
    else if ((event.code === 'Delete' || event.code === 'Backspace') && this.selected) { event.preventDefault(); this.perform(() => this.shell ? this.shell.removeSelection() : this.document.remove(this.selected)); }
    else if (event.code === 'Escape') { if (this.decalPlacement || this.wearBrush) { this.cancelDecalPlacement(); this.renderInspector(); } else this.select(null); }
  }
}
