import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {TransformControls} from 'three/examples/jsm/controls/TransformControls.js';
import AssetLibrary from './AssetLibrary.js';
import AssetThumbnails from './AssetThumbnails.js';
import SceneDocument from './SceneDocument.js';
import InteractionRuntime from './InteractionRuntime.js';
import BehaviorRuntime from './BehaviorRuntime.js';
import InfoPanelPreview from './InfoPanelPreview.js';
import DecalSystem from './DecalSystem.js';
import SurfaceMaterialSystem from './SurfaceMaterialSystem.js';
import WearPaintSystem from './WearPaintSystem.js';
import WearBrush from './WearBrush.js';
import MaterialInspector from './MaterialInspector.js';
import ScenePerformance from './ScenePerformance.js';
import IndustrialVisuals from './IndustrialVisuals.js';
import SimulationRuntime from './SimulationRuntime.js';
import SimulationPanel from './SimulationPanel.js';
import CollisionWorld from '../lib/CollisionWorld.js';
import ConveyorAssembly from './ConveyorAssembly.js';
import ObjectAssembly from './ObjectAssembly.js';
import EquipmentPlacement from './EquipmentPlacement.js';
import {industrialPrefabs} from './IndustrialPrefabs.js';
import behaviorSchema from '../../shared/behaviors.js';
import {installNativeBehaviorAdapters} from './NativeBehaviorAdapters.js';
import ProjectClient from './ProjectClient.js';
import ProjectLibrary from './ProjectLibrary.js';
import ProjectSync from './ProjectSync.js';
import resolveProject from './ProjectResolver.js';
import {describeNative, prepareNativeEdit, syncNativeTransforms} from './NativeBindings.js';

const STORAGE_KEY = 'hello-webxr-editor-v1';
const ACTIVE_PROJECT_KEY = 'hello-webxr-active-project';
const ROOM_LABELS = ['Sala principal', 'Sala de sonido', 'Fotogrametría', 'Vértigo', 'Panorama estéreo', 'Panorama 1', 'Panorama 2', 'Panorama 3', 'Panorama 4', 'Panorama 5'];
const ROOM_IDS = ['hall', 'sound', 'photogrammetry', 'vertigo', 'panoramastereo', 'panorama1', 'panorama2', 'panorama3', 'panorama4', 'panorama5'];
const PLACEABLE_KINDS = ['model', 'image'];
const NAVIGATION_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'];
const TOOL_MODES = ['translate', 'rotate', 'scale'];
const FUNCTION_SOURCE = {
  surfaceMaterial: ['src/editor/SurfaceMaterialSystem.js', 'Material editable con texturas PBR, acabado y desgaste general. Se conserva al copiar y guardar.'],
  surfaceWear: ['src/editor/WearPaintSystem.js', 'Capas de desgaste pintadas con la brocha y vinculadas a esta pieza.'],
  decal: ['src/editor/DecalSystem.js', 'Proyecta una imagen sobre superficies. Ajusta tamaño, profundidad y opacidad; PNG con transparencia permite pegatinas y señalización.'],
  collision: ['src/lib/CollisionWorld.js', 'Impide atravesar superficies sólidas. Los disparadores detectan presencia sin bloquear el paso.'],
  portal: ['src/rooms/Hall.js', 'Apuntar al objeto y pulsar o soltar el botón del mouse / gatillo VR.'],
  float: ['src/stations/PanoBalls.js', 'Actualiza la altura alrededor de la posición que guardaste.'],
  painting: ['src/stations/Paintings.js', 'Apuntar y mantener pulsado para acercar la imagen del cuadro.'],
  graffiti: ['src/stations/Graffiti.js', 'Mantener pulsado sobre una superficie con coordenadas UV para pintar.'],
  note: ['src/stations/Xylophone.js', 'Reproduce la nota al golpearla con una baqueta; cada copia conserva su propio audio.'],
  grab: ['src/stations/Xylophone.js', 'Gatillo al tocar el objeto en VR; clic derecho para agarrar o soltar en escritorio.'],
  info: ['src/stations/InfoPanels.js', 'Muestra un panel con su propio texto, color y tamaño.'],
  billboard: ['src/systems/BillboardSystem.js', 'Orienta el objeto hacia el visitante durante el recorrido.'],
  sound: ['src/rooms/Sound.js', 'Audio del objeto al pulsarlo o por reproducción automática.'],
  animation: ['src/editor/BehaviorRuntime.js', 'Reproduce un clip de animación perteneciente al modelo visual.'],
  news: ['src/stations/NewsTicker.js', 'Actualiza una pantalla a partir de un archivo de noticias JSON.'],
  teleport: ['src/lib/Teleport.js', 'En VR: apuntar, mantener el gatillo y soltar para desplazarse.'],
  motion: ['src/editor/SimulationRuntime.js', 'Movimiento continuo u oscilación sobre el eje local. La posición de edición se recupera al terminar la prueba.'],
  conveyor: ['src/editor/SimulationRuntime.js', 'Transporta paquetes simulados. La velocidad y la marcha se controlan desde el monitor o la lógica del PLC.'],
  source: ['src/editor/ProductSourceRuntime.js', 'Genera y recibe cargas en una cola FIFO limitada. Configura productos, pallets y entrega manual o por flujo.'],
  processor: ['src/editor/ProcessorRuntime.js', 'Recibe cargas, realiza preparación y proceso y conserva su salida hasta entregarla. Configura puestos simultáneos, operario y recetas de combinación o separación.'],
  palletQueue: ['src/editor/PalletQueueRuntime.js', 'Almacena productos sobre una estiba independiente. Controla capacidad, ocupación, recepción y retiro seguro por niveles.'],
  product: ['src/editor/SimulationRuntime.js', 'Caja manipulable: conserva su orientación al tomarla. Usa la rueda del mouse para acercarla o alejarla y pulsa de nuevo para soltarla sobre una banda. También funciona con el gatillo VR.'],
  sensor: ['src/editor/SimulationRuntime.js', 'Detecta paquetes de la banda vinculada al atravesar su volumen y cuenta los flancos de detección.'],
  automation: ['shared/automation.js', 'PLC simulado: evalúa condiciones y escribe variables. Añade reglas con el formulario o edita su JSON.'],
  control: ['src/editor/SimulationRuntime.js', 'Mando 3D: al pulsarlo con mouse o gatillo VR modifica una variable del equipo vinculado.'],
  analytics: ['src/editor/TelemetryRecorder.js', 'Define el intervalo de muestreo. Usa Variables y datos para grabar, guardar en SQLite o descargar CSV / JSON.']
};
const ROOM_SOURCE = {
  hall: 'src/rooms/Hall.js', sound: 'src/rooms/Sound.js',
  photogrammetry: 'src/rooms/PhotogrammetryObject.js', vertigo: 'src/rooms/Vertigo.js',
  panoramastereo: 'src/rooms/PanoramaStereo.js'
};

function implementationSource(object, type) {
  if (type === 'decal') return FUNCTION_SOURCE.decal[0];
  if (type === 'collision') return FUNCTION_SOURCE.collision[0];
  if ((behaviorSchema.simulationTypes || []).includes(type)) return FUNCTION_SOURCE[type][0];
  const native = (object.userData.editorNativeBehaviorTypes || []).includes(type);
  if (!native) return ['portal', 'float', 'sound', 'animation', 'teleport'].includes(type) ? 'src/editor/BehaviorRuntime.js' : 'src/editor/NativeBehaviorAdapters.js';
  if (type === 'animation' || type === 'sound') return 'src/rooms/Sound.js';
  if (type === 'portal' || type === 'teleport') {
    if (type === 'portal' && Number.isFinite(object.userData.panoId)) return 'src/stations/PanoBalls.js';
    const room = object.userData.editorRoom || '';
    return ROOM_SOURCE[room] || (/^panorama[1-5]$/.test(room) ? 'src/rooms/Panorama.js' : FUNCTION_SOURCE[type][0]);
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
    this.industrialVisuals = new IndustrialVisuals(ctx, this.document, this.simulation);
    this.projectClient = new ProjectClient();
    this.projectLibrary = new ProjectLibrary(this.projectClient, {
      onOpen: project => this.openServerProject(project),
      onNew: name => this.createServerProject(name),
      onSaveAs: name => this.saveProject(name, true),
      notify: message => this.toast(message)
    });
    if (!this.editorEnabled && this.projectLibrary.overlay) this.projectLibrary.overlay.remove();
    this.buildUI();
    this.assetThumbnails = new AssetThumbnails(this.library, this.assetGrid);
    this.simulationPanel = new SimulationPanel(this);
    this.orbit = new OrbitControls(this.camera, ctx.renderer.domElement);
    this.orbit.target.set(0, 1, -1);
    this.orbit.mouseButtons = {LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE};
    this.orbit.enableKeys = false;
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
      this.orbit.enabled = this.active && !event.value;
      if (event.value) {
        this.industrialVisuals.dispose(); this.materials.dispose(); this.document.begin();
        this.dragAssembly = this.toolMode === 'translate' ? this.assemblyFor(this.transform.object || this.selected) : null;
        this.clearAssembly();
        if (this.dragAssembly) this.dragAssembly.begin(this.transform.object || this.selected);
      } else if (!this.cancellingTransform) {
        this.perform(() => {
          try {
            if (this.dragAssembly) this.dragAssembly.end();
            this.dragAssembly = null;
            this.assembly.detachSeparated(this.transform.object || this.selected);
            this.document.commit(); this.syncNative();
          } catch (error) { this.clearAssembly(); this.document.cancel(); throw error; }
        });
      }
    });
    this.transform.addEventListener('objectChange', () => {
      if (this.transform.dragging && this.toolMode === 'translate') {
        try { if (this.dragAssembly) this.dragAssembly.update(this.transform.object || this.selected); }
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
      if (!this.dirty && !this.importingFiles) return;
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
    window.addEventListener('pageshow', () => { if (this.editorEnabled && !this.initializing) this.projectSync.start(); });
    this.ready = this.initialize();
  }

  async initialize() {
    // Public visits use the last saved server scene, without authoring URLs or
    // browser-local drafts. The runtime remains available for desktop and VR.
    if (!this.editorEnabled) this.rememberProject(null);
    try {
      this.entries = await this.library.getCatalog();
      this.renderAssets();
    } catch (error) { this.toast('Biblioteca: ' + error.message); }
    try { await this.checkStorageHealth(); }
    catch (error) { /* Static copies retain local/JSON loading without a server. */ }
    const parameters = new URL(window.location).searchParams;
    this.explicitProject = this.editorEnabled && parameters.has('project');
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
        if (resolved.project) { await this.applyServerProject(resolved.project); restored = true; }
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
    const toolbar = el('div', 'ed-toolbar');
    const brand = el('div', 'ed-brand');
    brand.appendChild(el('span', 'ed-logo', '◇'));
    const brandText = el('div');
    brandText.appendChild(el('strong', '', 'HELLO / STUDIO'));
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
    toolbar.appendChild(button('▶ Probar', 'Recorrer el escenario con sus interacciones y entrar a VR', () => this.leave(), 'primary'));
    this.ui.appendChild(toolbar);

    this.hierarchy = el('aside', 'ed-hierarchy');
    const treeHeader = el('div', 'ed-panel-title', 'JERARQUÍA');
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
    sceneActions.appendChild(button('Base vacía', 'Crear una base con suelo y teletransporte VR. Puedes deshacerlo.', () => this.emptyRoom()));
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
    this.viewport.appendChild(this.performancePanel);
    this.viewport.appendChild(viewTools);
    this.assemblyHint = el('div', 'ed-assembly-hint'); this.assemblyHint.hidden = true;
    this.viewport.appendChild(this.assemblyHint);
    this.viewport.appendChild(el('div', 'ed-viewport-help', 'WASD: navegar · Q: subir · E: bajar · Espacio: mover / rotar / escalar · Clic: seleccionar · Botón derecho: orbitar · Rueda: zoom · Botón central: desplazar'));
    this.ui.appendChild(this.viewport);
    this.inspector = el('aside', 'ed-inspector');
    this.ui.appendChild(this.inspector);

    const assets = el('section', 'ed-assets');
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
      const id = event.dataTransfer.getData('application/x-webxr-asset');
      if (id) {
        const entry = this.entries.find(item => (item.importId || item.path) === id);
        if (entry && PLACEABLE_KINDS.includes(entry.kind)) this.addAsset(entry);
      } else if (event.dataTransfer.files.length) {
        this.perform(async () => {
          const imported = await this.importFiles(Array.from(event.dataTransfer.files));
          this.entries = await this.library.getCatalog();
          this.folder = '@imports'; this.renderAssets(); this.dirty = true;
          const model = imported.find(item => PLACEABLE_KINDS.includes(item.kind));
          if (model) await this.addAsset(model);
        });
      }
    });
  }

  enter() {
    if (!this.editorEnabled || this.active || this.ctx.vrMode) return;
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
    this.assetThumbnails.dispose();
    this.ui.hidden = true;
    document.body.classList.remove('editor-mode');
    document.body.appendChild(this.ctx.renderer.domElement);
    this.ctx.cameraRig.visible = true;
    this.ctx.raycontrol.enable();
    this.hooks.clearKeyboard();
    this.launcher.hidden = true;
    this.returnButton.hidden = !this.editorEnabled || this.ctx.vrMode;
    this.resize();
    this.startRuntime();
    this.simulationPanel.modeChanged();
    this.toast('Prueba del escenario · WASD para moverte · Esc libera el mouse · ENTER VR para el visor');
  }

  onVRChange(inVR) {
    this.clearNavigation();
    this.simulation.onInputModeChange(inVR);
    if (this.ctx.resetCollisionPose) this.ctx.resetCollisionPose();
    if (this.ctx.editorXylophone && this.ctx.editorXylophone.releaseHeld) this.ctx.editorXylophone.releaseHeld();
    if (inVR) this.projectLibrary.close();
    if (inVR && this.active) this.leave();
    this.launcher.hidden = !this.editorEnabled || inVR || this.active;
    this.returnButton.hidden = !this.editorEnabled || inVR || this.active;
    this.resize();
    this.simulationPanel.modeChanged();
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
    this.updateStatus();
  }

  render(delta = 0) {
    this.collisionWorld.refresh();
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
    if (this.selected) this.box.update();
    this.hooks.renderScene.updateMatrixWorld(true);
    this.ctx.renderer.render(this.hooks.renderScene, this.camera);
    this.updatePerformancePanel(delta);
  }

  stopRuntime() {
    if (this.simulationPanel) this.simulationPanel.endSession();
    this.industrialVisuals.dispose();
    this.materials.dispose(); this.wearPaint.dispose();
    this.simulation.stop(); this.behaviors.stop(); this.interactions.stop();
  }

  syncSurfaceMaterials() {
    if (this.pendingEdits || this.loadingProject || this.document.loading || this.transform && this.transform.dragging) return;
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
    this.interactions.start(this.roomId); this.behaviors.start(this.roomId); this.simulation.start(this.roomId);
    this.syncSurfaceVisuals();
    this.decals.sync(this.roomId);
    this.industrialVisuals.invalidate();
    if (!this.pendingEdits && !this.loadingProject && !this.document.loading) this.industrialVisuals.sync(this.roomId, 0, false);
    if (this.simulationPanel) this.simulationPanel.modeChanged();
  }
  execute(delta, time) {
    this.root.updateMatrixWorld(true);
    this.syncSurfaceMaterials();
    this.performance.update(this.ctx.camera, delta);
    this.behaviors.execute(delta, time); this.simulation.execute(delta, time);
    if (!this.pendingEdits && !this.loadingProject && !this.document.loading) this.industrialVisuals.sync(this.roomId, delta, false);
    this.decals.sync(this.roomId);
    this.wearPaint.sync(this.roomId);
    this.simulationPanel.tick(this.simulation.getSnapshot());
  }

  resize() {
    const width = this.active ? Math.max(1, this.viewport.clientWidth) : window.innerWidth;
    const height = this.active ? Math.max(1, this.viewport.clientHeight) : window.innerHeight;
    this.ctx.renderer.setSize(width, height);
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
    this.ctx.camera.aspect = window.innerWidth / window.innerHeight; this.ctx.camera.updateProjectionMatrix();
  }

  home() {
    this.camera.position.set(3.2, 2.8, 4.5); this.orbit.target.set(0, 1, -1); this.orbit.update();
    this.constrainEditorCamera(false);
  }
  focus() {
    if (!this.selected) return;
    const box = new THREE.Box3().setFromObject(this.selected);
    if (box.isEmpty()) return;
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
    if (!TOOL_MODES.includes(mode) || this.transform.dragging) return;
    this.toolMode = mode;
    this.transform.setMode(mode);
    Object.keys(this.toolButtons).forEach(key => this.toolButtons[key].classList.toggle('active', key === mode));
  }

  clearNavigation() { this.navigationKeys.clear(); }

  keyboardOverlayOpen() {
    return Boolean(this.projectLibrary.opened || this.projectLibrary.overlay && !this.projectLibrary.overlay.hidden ||
      this.simulationPanel && this.simulationPanel.opened || this.sharePanel && !this.sharePanel.hidden);
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
    if (object && this.active && !this.decalPlacement && !this.wearBrush) {
      this.transform.attach(object); this.box.setFromObject(object); this.box.visible = visibleInTree(object);
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
      this.clearAssembly(); this.dragAssembly = null;
      this.transform.dragging = false;
      this.transform.axis = null;
      this.document.cancel();
    } finally { this.cancellingTransform = false; }
    this.orbit.enabled = this.active;
    this.syncNative(); this.refreshAssembly();
    if (this.selected) this.box.update();
    this.updateTransformInputs();
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

  async prepareRoom(roomId = this.roomId) {
    if (this.document.activateRoom) await this.document.activateRoom(roomId);
    if (this.document.hasPendingRoom && this.document.hasPendingRoom(roomId)) {
      throw new Error('La sala cambió mientras se cargaba. Vuelve a seleccionarla.');
    }
    if (this.ctx.roomAssets) await this.ctx.roomAssets.prepareRoom(roomId, this.document.getRoot(roomId));
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
    if (this.performancePanel) this.performancePanel.textContent = '';
  }

  updatePerformancePanel(delta) {
    if (!this.performancePanel || this.performancePanel.hidden) return;
    // Ignore the interval spent opening the panel or returning from a hidden
    // tab. Sample rendered frames over a short window rather than averaging 1/dt.
    if (this.skipPerformanceFrame) this.skipPerformanceFrame = false;
    else if (Number.isFinite(delta) && delta > 0) {
      this.performanceElapsed = (this.performanceElapsed || 0) + delta;
      this.performanceFrames = (this.performanceFrames || 0) + 1;
    }
    const elapsed = this.performanceElapsed || 0;
    if (elapsed < 0.4 && this.performancePanel.textContent) return;
    const timing = elapsed >= 0.4 ? Math.round(this.performanceFrames / elapsed) +
      ' · ' + (1000 * elapsed / this.performanceFrames).toFixed(1) + ' ms/fotograma' : 'calculando…';
    if (elapsed >= 0.4) { this.performanceElapsed = 0; this.performanceFrames = 0; }
    const stats = this.performance.getStats();
    this.performancePanel.textContent = 'Sala activa · ' + ROOM_LABELS[this.ctx.room] + '\nFPS: ' + timing + '\nDibujos: ' + stats.drawCalls +
      ' · Triángulos: ' + Number(stats.triangles || 0).toLocaleString() + '\nGPU: ' + stats.gpuGeometries +
      ' geometrías · ' + stats.gpuTextures + ' texturas\nSalas inactivas: ' + stats.inactiveRooms;
  }

  changed() {
    this.dirty = true;
    this.changeVersion++;
    if (!this.tree) return;
    this.syncNative();
    if (this.selected && !this.document.getObject(this.selected.userData.editorId)) this.selected = null;
    if (this.transform && this.active) {
      if (this.selected) this.transform.attach(this.selected); else this.transform.detach();
    }
    this.renderTree(); this.renderInspector(); this.updateStatus();
    this.library.getCatalog().then(entries => { this.entries = entries; this.renderAssets(); }).catch(() => {});
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
      this.document.resetRoom(this.roomId);
      this.root.children.forEach(object => { if (object.userData.editorNative) object.visible = false; });
      const floor = this.document.addPrimitive(this.roomId, 'plane', '#626c78');
      this.document.setProperty(floor, 'name', 'Suelo personalizado');
      this.document.setTransform(floor, {position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0], scale: [6, 6, 6]});
      this.document.setInteraction(floor, {type: 'teleport'});
      this.document.commit();
      this.home();
      this.toast('Base lista: añade modelos e imágenes. El suelo permite teletransporte en VR.');
      return floor;
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
      const row = button('', name + ' · clic para seleccionar, doble clic para enfocar', () => this.select(object), 'ed-tree-row');
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-selected', String(this.selected === object));
      row.style.setProperty('--depth', Math.min(depth, 6));
      row.classList.toggle('selected', this.selected === object);
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
    const section = el('section', 'ed-section'); section.appendChild(el('h3', '', title)); this.inspector.appendChild(section); return section;
  }
  field(parent, label, input) {
    const row = el('label', 'ed-field'); row.appendChild(el('span', '', label)); row.appendChild(input); parent.appendChild(row); return input;
  }

  renderInspector() {
    const scrollTop = this.inspectedObject === this.selected ? this.inspector.scrollTop : 0;
    this.inspectedObject = this.selected;
    this.inspector.textContent = '';
    this.inspector.appendChild(el('div', 'ed-panel-title', 'INSPECTOR'));
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
      this.inspector.appendChild(empty); return;
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
    const info = this.document.getBehaviors(object).find(component => component.type === 'info');
    if (info) {
      const text = this.section('TEXTO DEL PANEL');
      text.appendChild(el('p', 'ed-hint', 'Edita el título y el contenido. Al salir del campo verás el cambio en la escena. Ctrl C / Ctrl V copia el panel completo cuando no estás escribiendo.'));
      const update = (key, value) => this.perform(() => this.document.setBehaviors(object, this.document.getBehaviors(object).map(component => component.type === 'info' ? Object.assign({}, component, {[key]: value}) : component)));
      this.renderBehaviorFields(text, info, update);
    }
    const decal = this.document.getBehaviors(object).find(component => component.type === 'decal');
    const decalAnchor = object.userData.editorDescriptor && object.userData.editorDescriptor.type === 'decal';
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
          this.perform(() => this.document.setTransform(object, {[property]: values}));
        });
        wrapper.appendChild(input); row.appendChild(wrapper); this.transformInputs[property].push(input);
      });
      transform.appendChild(row);
    });
    this.updateTransformInputs();
    if (!decalAnchor) this.renderAssetInspector(object);
    if (!decalAnchor) this.materialInspector.render(object);
    if (!native && !decalAnchor) {
      const appearance = this.section('APARIENCIA');
      const descriptor = this.document.getVisualDescriptor ? this.document.getVisualDescriptor(object) : object.userData.editorDescriptor;
      let colorMesh = object;
      if (!colorMesh.material) object.traverse(child => { if (!colorMesh.material && child.material && child.material.color) colorMesh = child; });
      const primitive = descriptor && ['box', 'sphere', 'plane', 'cylinder'].includes(descriptor.type);
      if (primitive && colorMesh.material && colorMesh.material.color && !this.document.getBehaviors(object).some(config => config.type === 'surfaceMaterial' && config.enabled)) {
        const color = el('input'); color.type = 'color'; color.value = '#' + colorMesh.material.color.getHexString();
        this.field(appearance, 'Color', color).addEventListener('change', () => this.perform(() => this.document.setProperty(object, 'color', color.value)));
      } else if (!primitive) appearance.appendChild(el('p', 'ed-hint', 'Personaliza cada parte en MATERIAL · SUPERFICIE para conservar los acabados de las demás piezas.'));
      this.renderInteractionInspector(object);
    }
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
    this.inspector.scrollTop = scrollTop;
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

  renderAssetInspector(object) {
    const section = this.section('MODELO VISUAL');
    const descriptor = this.document.getVisualDescriptor ? this.document.getVisualDescriptor(object) : object.userData.editorDescriptor;
    const source = descriptor && descriptor.nativeId && this.document.getObject(descriptor.nativeId);
    const label = descriptor ? descriptor.path || (descriptor.importId && (this.library.getEntry(descriptor.importId) || {}).name) || descriptor.type || (source && source.name) || 'Modelo original' : 'Modelo original';
    section.appendChild(el('div', 'ed-asset-current', label));
    section.appendChild(el('p', 'ed-hint', 'Cambiar el modelo conserva el objeto, sus funciones, referencias y transformación.'));
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
    controls.appendChild(button('Restaurar modelo', 'Recuperar el modelo original conservando las funciones editadas', () => this.perform(() => this.document.resetAsset(object))));
    section.appendChild(controls);
    if (this.selectedAsset && PLACEABLE_KINDS.includes(this.selectedAsset.kind)) {
      section.appendChild(button('Usar ' + this.selectedAsset.name, 'Usar el archivo seleccionado en la biblioteca', () => this.replaceVisual(object, this.selectedAsset.importId ? {importId: this.selectedAsset.importId} : {path: this.selectedAsset.path})));
    }
  }

  async replaceVisual(object, descriptor) {
    return this.perform(async () => {
      this.toast('Cargando el modelo visual…');
      await this.document.replaceAsset(object, descriptor);
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
    this.document.setBehaviors(object, this.document.getBehaviors(object).map(config => machine && config.type === machine.type ? Object.assign({}, config, patch) : config));
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
      section.appendChild(el('p', 'ed-hint', 'Estiba independiente: ' + config.capacity + ' cargas en ' + config.columns + ' columnas × ' + config.rows + ' filas × ' + config.layers + ' niveles. Ajusta las posiciones al tamaño de los productos.'));
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
    section.appendChild(el('p', 'ed-hint', 'Conecta el último tramo a otro equipo o a un Pallet Queue para almacenar productos. Una salida sin conexión conserva las cargas en espera. Cambiar dimensiones puede requerir volver a alinear los tramos.'));
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
      this.document.setBehaviors(object, this.document.getBehaviors(object).filter(component => !types.has(component.type)).concat(JSON.parse(JSON.stringify(this.behaviorClipboard))));
    }));
    paste.disabled = !this.behaviorClipboard || !this.behaviorClipboard.length;
    actions.appendChild(paste); section.appendChild(actions);
    if (!behaviors.length) section.appendChild(el('p', 'ed-hint', 'Este objeto no tiene funciones asignadas. Añade una función o pega las de otro objeto.'));
    behaviors.forEach(config => {
      const definition = behaviorSchema.definitionFor(config.type);
      if (!definition) return;
      const card = el('details', 'ed-component');
      const componentKey = object.userData.editorId + ':' + config.type;
      card.open = this.expandedComponents.get(componentKey) !== false;
      card.addEventListener('toggle', () => this.expandedComponents.set(componentKey, card.open));
      const summary = el('summary', 'ed-component-title', definition.label);
      summary.appendChild(el('span', 'ed-tag', config.enabled ? 'ACTIVA' : 'DESACTIVADA'));
      card.appendChild(summary);
      const body = el('div', 'ed-component-body');
      const update = (key, value) => this.perform(() => this.document.setBehaviors(object, this.document.getBehaviors(object).map(component => {
        if (component.type !== config.type) return component;
        const next = Object.assign({}, component, {[key]: value});
        if (next.type === 'palletQueue' && ['columns', 'rows', 'layers'].includes(key)) next.capacity = Math.min(next.capacity, next.columns * next.rows * next.layers);
        if (next.type === 'product' && key === 'quality') next.defect = value === 'good' ? 'none' : next.defect === 'none' ? 'damaged' : next.defect;
        if (next.type === 'product' && key === 'defect') next.quality = value === 'none' ? 'good' : 'defective';
        return next;
      })));
      const enabled = el('input'); enabled.type = 'checkbox'; enabled.checked = config.enabled;
      this.field(body, 'Habilitada', enabled).addEventListener('change', () => update('enabled', enabled.checked));
      if (config.type === 'info') body.appendChild(el('p', 'ed-hint', 'Cambia el contenido en TEXTO DEL PANEL, al inicio del inspector.'));
      else if (config.type === 'surfaceMaterial' || config.type === 'surfaceWear') body.appendChild(el('p', 'ed-hint', 'Edita el acabado y las capas en MATERIAL / DESGASTE, al inicio del inspector.'));
      else if (config.type === 'decal') body.appendChild(el('p', 'ed-hint', 'Ajusta la imagen en DECAL · IMAGEN PROYECTADA, al inicio del inspector.'));
      else this.renderBehaviorFields(body, config, update);
      if (config.type === 'automation') this.renderRuleBuilder(body, object, config, update);
      if (config.type === 'conveyor' && config.layout === 'tee' && config.junctionMode === 'split') this.renderConveyorRouting(body, config, update);
      if (config.type === 'product') body.appendChild(el('p', 'ed-hint', 'SKU, tipo, color y calidad son atributos de clasificación de la simulación. El color de clasificación no cambia la textura del modelo. No se inspeccionan automáticamente imágenes ni mallas 3D.'));
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
    if (object.userData.editorDefaultBehaviors && object.userData.editorDefaultBehaviors.length) section.appendChild(button('Restaurar funciones originales', 'Recuperar las funciones y parámetros originales del objeto', () => this.perform(() => this.document.setBehaviors(object, JSON.parse(JSON.stringify(object.userData.editorDefaultBehaviors))))));
  }

  renderBehaviorFields(parent, config, update) {
    const definition = behaviorSchema.definitionFor(config.type);
    definition.fields.forEach(field => {
      if (config.type === 'source') {
        if (['catalog', 'outputId', 'outputPort'].includes(field.key)) return;
        if (['palletColumns', 'palletRows', 'palletLayers'].includes(field.key) && config.loadMode !== 'pallet') return;
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
      if (config.type === 'decal') {
        if (field.key === 'stamps') return;
        if (config.pattern === 'image' && ['seed', 'wearDensity', 'roughness', 'metalness'].includes(field.key)) return;
        if (config.pattern !== 'image' && field.key === 'asset') return;
      }
      if (config.type === 'conveyor') {
        if (['outputId', 'outputPort', 'branchId', 'branchPort', 'withPallet', 'routingRules', 'routingDefault', 'branchPercentage'].includes(field.key)) return;
        if (['radius', 'curveAngle'].includes(field.key) && !['curveLeft', 'curveRight'].includes(config.layout)) return;
        if (field.key === 'length' && ['curveLeft', 'curveRight'].includes(config.layout)) return;
        if (['junctionMode', 'branchSide'].includes(field.key) && config.layout !== 'tee') return;
        if (field.key === 'routing' && (config.layout !== 'tee' || config.junctionMode !== 'split')) return;
      }
      if (config.type === 'control') {
        if (config.mode === 'command' && field.key === 'variable') return;
        if (config.mode !== 'command' && field.key === 'command') return;
        if (config.mode === 'command' && field.key === 'value' && !['speedUp', 'speedDown'].includes(config.command)) return;
      }
      let input;
      if (['select', 'room', 'audio', 'image', 'object'].includes(field.input)) {
        input = el('select');
        const media = ['audio', 'image'].includes(field.input);
        const options = field.input === 'object' ? [{label: config.type === 'decal' ? 'Superficies próximas' : 'Selecciona un objeto…', value: ''}, {label: 'Este objeto', value: 'self'}].concat(this.document.getObjects(this.roomId).map(item => ({label: item.name || item.type, value: item.userData.editorId}))) : field.input === 'room' ? ROOM_LABELS.map((label, value) => ({label, value})) : media ? [{label: field.input === 'image' ? 'Selecciona una imagen…' : 'Selecciona un audio…', value: ''}].concat(this.entries.filter(entry => entry.kind === field.input).map(entry => ({label: entry.name, value: entry.importId || entry.path}))) : field.options;
        options.forEach(option => { const node = el('option', '', option.label); node.value = option.value; input.appendChild(node); });
        if (media && config[field.key] && !options.some(option => String(option.value) === String(config[field.key]))) {
          const option = el('option', '', config[field.key]); option.value = config[field.key]; input.appendChild(option);
        }
        input.value = config[field.key];
      } else if (field.input === 'textarea' || field.input === 'rules') {
        input = el('textarea'); input.rows = 4; input.value = config[field.key]; input.maxLength = field.maxLength || 2000;
      } else {
        input = el('input'); input.type = field.input === 'checkbox' ? 'checkbox' : field.input === 'number' ? 'number' : field.input === 'color' ? 'color' : 'text';
        if (field.input === 'checkbox') input.checked = config[field.key]; else input.value = config[field.key];
        if (field.min !== undefined) input.min = field.min;
        if (field.max !== undefined) input.max = field.max;
        if (field.step !== undefined) input.step = field.step;
        if (field.maxLength) input.maxLength = field.maxLength;
      }
      const label = config.type === 'control' && config.mode === 'command' && field.key === 'value' ? 'Paso de velocidad (m/s)' : field.label;
      input.setAttribute('aria-label', definition.label + ' · ' + label);
      this.field(parent, label, input).addEventListener('change', () => update(field.key, field.input === 'checkbox' ? input.checked : ['number', 'room'].includes(field.input) ? Number(input.value) : input.value));
    });
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
    const add = (keys, writable) => keys.forEach(key => fields.set(key, {key, writable, boolean: ['running', 'powered', 'paused', 'autoSpawn', 'emergency', 'palletFull', 'transferBlocked', 'externalSupply', 'internalSupplyActive', 'enabled', 'active', 'occupied', 'autoGenerate', 'blocked', 'full', 'empty', 'operatorAvailable', 'busy', 'settingUp', 'waitingOperator'].includes(key)}));
    this.document.getBehaviors(object).forEach(config => {
      if (config.type === 'conveyor') { add(['running', 'powered', 'paused', 'autoSpawn', 'speed', 'emergency', 'enabled'], true); add(['actualSpeed', 'inFlight', 'entryCount', 'exitCount', 'runSeconds', 'transferBlocked', 'externalSupply', 'internalSupplyActive', 'moduleCount', 'routedMain', 'routedBranch', 'routingUnmatched'], false); }
      if (config.type === 'palletQueue') {
        add(['enabled', 'running', 'paused', 'outputInterval'], true);
        add(['queued', 'queuedUnits', 'capacity', 'occupancy', 'full', 'empty', 'blocked', 'received', 'receivedUnits', 'delivered', 'deliveredUnits'], false);
      }
      if (config.type === 'source') { add(['running', 'paused', 'autoGenerate', 'interval', 'outputInterval', 'enabled'], true); add(['queued', 'queuedUnits', 'capacity', 'generated', 'generatedUnits', 'delivered', 'deliveredUnits', 'received', 'receivedUnits', 'blocked', 'full', 'empty', 'remaining'], false); }
      if (config.type === 'processor') {
        add(['powered', 'running', 'paused', 'emergency', 'enabled', 'processTime', 'setupTime', 'operatorAvailable', 'outputInterval'], true);
        add(['busy', 'settingUp', 'waitingOperator', 'blocked', 'full', 'empty', 'queued', 'queuedUnits', 'outputQueued', 'capacity', 'parallelism', 'outputCapacity', 'activeJobs', 'progress', 'setupProgress', 'setupRemaining', 'entryCount', 'exitCount', 'receivedUnits', 'deliveredUnits', 'completed', 'completedUnits', 'utilization', 'setupSeconds', 'processSeconds', 'idleSeconds', 'blockedSeconds', 'operatorWaitSeconds', 'downSeconds', 'nominalCapacity'], false);
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
      fields.forEach(field => { const option = el('option', '', field.key); option.value = field.key; input.appendChild(option); });
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

  clearAssetPreview() {
    this.previewToken = (this.previewToken || 0) + 1;
    if (this.previewContent && this.library.cancelPreview) this.library.cancelPreview(this.previewContent);
    if (this.previewCleanup) this.previewCleanup();
    this.previewCleanup = null; this.previewContent = null;
  }

  startDecalPlacement(entry = this.selectedAsset, object = null) {
    if (!this.active || this.loadingProject) return;
    if (!entry || entry.kind !== 'image') {
      this.assetKind = 'image'; this.kindSelect.value = 'image'; this.renderAssets();
      this.toast('Selecciona una imagen en Archivos del proyecto y pulsa «Colocar decal». PNG conserva su transparencia.');
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
    if (this.selected && this.active) this.transform.attach(this.selected);
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
        if (project) localStorage.setItem(ACTIVE_PROJECT_KEY, project.id);
        else localStorage.removeItem(ACTIVE_PROJECT_KEY);
      }
    } catch (error) { /* SQLite saving does not depend on browser storage. */ }
    if (window.history && window.history.replaceState) {
      const url = new URL(window.location);
      if (this.editorEnabled && project) url.searchParams.set('project', project.id);
      else url.searchParams.delete('project');
      url.searchParams.delete('editor');
      window.history.replaceState(null, '', url.href);
    }
  }

  projectSyncState() {
    return {project: this.currentProject, dirty: this.dirty, busy: this.busy || this.ctx.roomTransition || this.importingFiles || this.pendingEdits > 0 || Boolean(this.projectLibrary.busy),
      loading: this.loadingProject || this.initializing,
      transaction: this.document.transaction || this.transform && this.transform.dragging || isTyping({target: document.activeElement || {}}),
      pinned: Boolean(this.historicalRevision), active: this.active, vrMode: this.ctx.vrMode,
      allowDiscover: !this.currentProject && !this.explicitProject && !this.dirty};
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

  async applyServerProject(project) {
    if (!project || !project.document) throw new Error('El proyecto recibido no contiene un escenario.');
    this.cancelTransformDrag(); this.clearAssembly(true);
    this.projectGeneration++;
    this.clearNavigation();
    this.clearAssetPreview();
    this.assetThumbnails.dispose();
    this.cancelDecalPlacement(); this.decals.dispose();
    this.infoPreview.dispose();
    this.stopRuntime();
    this.loadingProject = true;
    const transformEnabled = this.transform.enabled;
    this.transform.enabled = false;
    try {
      await this.document.load(project.document, {activeRoomId: this.roomId});
      await this.prepareRoom(this.roomId);
      this.currentProject = {id: project.id, name: project.name, revision: project.revision};
      this.clearObjectClipboard();
      this.projectName = project.name;
      this.historicalRevision = project.historicalRevision || null;
      // A project owns its edit history; previous projects stay in the database.
      this.document.undoStack.length = 0;
      this.document.redoStack.length = 0;
      this.entries = await this.library.getCatalog();
      this.select(null);
      this.renderAssets();
      this.syncNative();
      this.dirty = Boolean(project.historicalRevision);
      this.storageAvailable = true;
      this.rememberProject(project);
      this.markRemoteProject(null);
      this.updateStatus();
    } finally {
      this.loadingProject = false;
      this.transform.enabled = transformEnabled && this.active;
      if (!this.active) this.startRuntime();
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

  async openServerProject(project) {
    if (this.busy || this.loadingProject || this.pastingObject || this.importingFiles) throw new Error('Espera a que termine la operación actual.');
    const saved = await this.keepCurrentProject();
    if (saved && this.currentProject && this.currentProject.id === project.id) {
      project = await this.projectClient.getProject(project.id, project.historicalRevision);
    }
    await this.applyServerProject(project);
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
    if (this.importingFiles) { this.toast('Espera a que termine la importación antes de guardar.'); return false; }
    if (this.busy || this.loadingProject) return false;
    this.busy = true;
    this.updateStatus();
    try {
      const document = await this.document.serialize();
      const version = this.changeVersion;
      const projectName = name || this.projectName;
      const saved = asCopy || !this.currentProject ?
        await this.projectClient.createProject(projectName, document) :
        await this.projectClient.updateProject(this.currentProject.id, projectName, document, this.currentProject.revision);
      // Imported file identities are immutable. Keep imports added during the
      // request while replacing saved base64 data with lightweight server URLs.
      const references = new Map(saved.document.imports.map(record => [record.id, record]));
      this.library.restoreImports(this.library.exportImports().map(record => references.get(record.id) || record));
      this.currentProject = {id: saved.id, name: saved.name, revision: saved.revision};
      this.projectName = saved.name;
      this.historicalRevision = null;
      this.storageAvailable = true;
      this.dirty = this.changeVersion !== version;
      this.rememberProject(saved);
      this.markRemoteProject(null);
      this.projectSync.publish(saved);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved.document)); } catch (error) { /* Server save already succeeded. */ }
      this.entries = await this.library.getCatalog(); this.renderAssets();
      this.toast('«' + saved.name + '» guardado · versión ' + saved.revision + (this.dirty ? '. Hay cambios posteriores pendientes.' : '.'));
      return saved;
    } catch (error) {
      if (error.status === 409) throw new Error('Este proyecto cambió en otra ventana. Usa Proyectos → Guardar copia para conservar tus cambios o abre la versión actual.');
      if (!error.status || error.status >= 500) this.storageAvailable = false;
      throw error;
    } finally { this.busy = false; this.updateStatus(); }
  }

  async saveLocal() {
    if (this.busy) return;
    this.busy = true;
    try {
      const project = await this.document.serialize();
      const version = this.changeVersion;
      const wasDirty = this.dirty;
      project.imports = await this.library.exportPortableImports();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
      this.dirty = this.changeVersion !== version || Boolean(this.currentProject && wasDirty);
      this.toast('Copia guardada en este navegador.' + (this.dirty ? ' El proyecto del servidor aún tiene cambios pendientes.' : ''));
    } catch (error) { this.toast('No se pudo guardar aquí. Descarga el JSON para conservarlo. ' + error.message); }
    finally { this.busy = false; this.updateStatus(); }
  }

  async exportProject() {
    try {
      const project = await this.document.serialize();
      project.imports = await this.library.exportPortableImports();
      const url = URL.createObjectURL(new Blob([JSON.stringify(project, null, 2)], {type: 'application/json'}));
      const link = el('a'); link.href = url; link.download = this.projectName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-') + '.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.toast('Escenario descargado. Incluye los archivos que importaste.');
    } catch (error) { this.toast(error.message); }
  }

  updateStatus() {
    if (!this.status) return;
    const persistence = this.currentProject ? this.projectName + ' · v' + this.currentProject.revision : this.projectName + ' · proyecto nuevo';
    this.status.textContent = (this.importingFiles ? 'Importando archivos…' : this.busy ? 'Guardando…' : this.dirty ? '● Cambios sin guardar' : this.currentProject ? '○ Guardado' : '○ Escenario listo') + '   /   ' + persistence + '   /   ' + (this.storageAvailable ? 'SQLite' : 'Servidor sin conectar') + '   /   ' + ROOM_LABELS[this.ctx.room] + (this.remoteProject ? '   /   Versión ' + this.remoteProject.revision + ' disponible en SQLite' : '') + '   /   WebXR disponible en Probar';
    if (this.saveButton) this.saveButton.disabled = this.busy || this.loadingProject || this.importingFiles;
    if (this.projectButton) {
      this.projectButton.textContent = this.currentProject ? 'Proyectos · ' + this.projectName + ' · v' + this.currentProject.revision : 'Proyectos · escenario nuevo';
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
  }
  formatSize(size) { return size >= 1048576 ? (size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(size / 1024)) + ' KB'; }
  toast(message) {
    this.toastNode.textContent = message;
    this.toastNode.hidden = false;
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => { this.toastNode.hidden = true; }, 4800);
  }
  onKey(event) {
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
    else if ((event.code === 'Delete' || event.code === 'Backspace') && this.selected) { event.preventDefault(); this.perform(() => this.document.remove(this.selected)); }
    else if (event.code === 'Escape') { if (this.decalPlacement || this.wearBrush) { this.cancelDecalPlacement(); this.renderInspector(); } else this.select(null); }
  }
}
