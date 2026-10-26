// Integration checks with real Three.js scene graphs and a minimal DOM/control
// adapter. This verifies editor/runtime contracts, not a physical WebXR session.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const THREE = require('three');
const behaviorSchema = require('../shared/behaviors.js');
const automationSchema = require('../shared/automation.js');
const materialSchema = require('../shared/materials.js');
const wearSchema = require('../shared/wear.js');

function sourceFor(file) {
  return fs.readFileSync(path.join(__dirname, '../src/editor', file), 'utf8').replace(/^import .*;\r?\n/gm, '');
}
function loadClass(file, dependencies) {
  const source = sourceFor(file).replace(/export default class (\w+)/, 'return class $1');
  return new Function(...Object.keys(dependencies), source)(...Object.values(dependencies));
}

class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null;
    this.listeners = {}; this.attributes = {}; this.value = ''; this.files = [];
    this.hidden = false; this.clientWidth = 960; this.clientHeight = 600;
    this.style = {setProperty: (key, value) => { this.style[key] = value; }};
    const classes = new Set();
    this.classList = {
      add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value),
      toggle: (value, enabled) => {
        const include = enabled === undefined ? !classes.has(value) : enabled;
        if (include) classes.add(value); else classes.delete(value);
        return include;
      }
    };
  }
  set textContent(value) {
    this._textContent = String(value);
    this.children.forEach(child => { child.parentNode = null; }); this.children = [];
  }
  get textContent() { return this._textContent || ''; }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    this.children.push(child); child.parentNode = this; return child;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null; return child;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key]; }
  addEventListener(type, callback) { (this.listeners[type] || (this.listeners[type] = [])).push(callback); }
  removeEventListener(type, callback) { this.listeners[type] = (this.listeners[type] || []).filter(value => value !== callback); }
  async fire(type, event = {}) {
    event.target = event.target || this;
    for (const callback of this.listeners[type] || []) await callback(event);
  }
  click() { return this.fire('click'); }
  getBoundingClientRect() { return {left: 0, top: 0, width: this.clientWidth, height: this.clientHeight}; }
  getContext() {
    this.drawnText = [];
    return {fillRect: () => { this.drawnText = []; }, fillText: text => this.drawnText.push(text), measureText: text => ({width: text.length * 18})};
  }
}

const dom = new Element('document');
dom.body = new Element('body'); dom.activeElement = dom.body;
dom.createElement = tag => new Element(tag);
const browserWindow = new Element('window');
Object.assign(browserWindow, {location: 'https://editor.test/editor', innerWidth: 1280, innerHeight: 720});
const storage = new Map();
const localStorage = {
  getItem: key => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key)
};

const clone = value => JSON.parse(JSON.stringify(value));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
const remote = {projects: new Map(), assets: new Map(), online: true, nextId: 0, pausedWrite: null, writes: []};
function pauseNextWrite() {
  const pause = {started: deferred(), finish: deferred()};
  remote.pausedWrite = pause;
  return pause;
}
function normalizeImports(document) {
  const stored = clone(document);
  stored.imports = stored.imports.map(record => {
    if (record.dataUrl) {
      const hash = require('crypto').createHash('sha256').update(record.dataUrl).digest('hex');
      remote.assets.set(hash, record.dataUrl);
      record.sha256 = hash; record.url = '/api/assets/' + hash;
      delete record.dataUrl;
    }
    return record;
  });
  return stored;
}

// A shared persistence boundary lets separate editor instances behave like
// browser reloads/tabs. HTTP, SQLite and asset-file behavior have separate tests.
class ProjectClient {
  checkConnection() { if (!remote.online) throw new Error('Servidor desconectado'); }
  async health() { this.checkConnection(); return {storage: 'sqlite', capabilities: {assetUpload: true}, limits: {maxAssetBytes: 256 * 1024 * 1024}}; }
  async uploadAsset(file, mime) {
    this.checkConnection();
    const contents = Buffer.from(file.contents || 'file');
    const hash = require('crypto').createHash('sha256').update(contents).digest('hex');
    remote.assets.set(hash, 'data:' + (mime || 'application/octet-stream') + ';base64,' + contents.toString('base64'));
    return {url: '/api/assets/' + hash, sha256: hash, mime: mime || 'application/octet-stream', size: file.size};
  }
  async listProjects() {
    this.checkConnection();
    return Array.from(remote.projects.values()).map(project => {
      const metadata = clone(project); delete metadata.revisions; return metadata;
    });
  }
  async listRevisions(id) {
    this.checkConnection();
    return remote.projects.get(id).revisions.map((snapshot, index) => ({revision: index + 1, name: snapshot.name, createdAt: snapshot.createdAt})).reverse();
  }
  async getProject(id, revision) {
    this.checkConnection();
    const project = remote.projects.get(id);
    if (!project) { const error = new Error('Proyecto no encontrado'); error.status = 404; throw error; }
    const snapshot = project.revisions[(revision || project.revision) - 1];
    if (!snapshot) throw new Error('Versión no encontrada');
    const result = clone({id, name: project.name, revision: project.revision, createdAt: project.createdAt,
      updatedAt: project.updatedAt, document: snapshot.document});
    if (revision !== undefined) { result.name = snapshot.name; result.historicalRevision = revision; }
    return result;
  }
  async beforeWrite() {
    this.checkConnection();
    const pause = remote.pausedWrite;
    if (pause) {
      remote.pausedWrite = null;
      pause.started.resolve(); await pause.finish.promise;
      this.checkConnection();
    }
  }
  async createProject(name, document) {
    const snapshot = clone(document);
    await this.beforeWrite();
    const id = 'project-' + (++remote.nextId);
    const now = new Date().toISOString();
    const record = {id, name, revision: 1, createdAt: now, updatedAt: now,
      revisions: [{name, createdAt: now, document: normalizeImports(snapshot)}]};
    remote.projects.set(id, record); remote.writes.push({id, revision: 1, create: true});
    return this.getProject(id);
  }
  async updateProject(id, name, document, expectedRevision) {
    const snapshot = clone(document);
    await this.beforeWrite();
    const project = remote.projects.get(id);
    if (!project || project.revision !== expectedRevision) {
      const error = new Error('Conflicto de versión'); error.status = 409; throw error;
    }
    project.name = name; project.revision++; project.updatedAt = new Date().toISOString();
    project.revisions.push({name, createdAt: project.updatedAt, document: normalizeImports(snapshot)});
    remote.writes.push({id, revision: project.revision, create: false});
    return this.getProject(id);
  }
}

class ProjectLibrary {
  constructor(client, callbacks) { this.client = client; this.callbacks = callbacks; }
  async open(mode) { this.mode = mode; this.opened = true; }
  close() { this.opened = false; }
}

const telemetryRemote = {runs: new Map(), nextId: 0, writes: [], pausedWrite: null, pausedList: null};
class TelemetryClient {
  async save(projectId, payload) {
    const snapshot = clone(payload);
    const pause = telemetryRemote.pausedWrite;
    if (pause) { telemetryRemote.pausedWrite = null; pause.started.resolve(); await pause.finish.promise; }
    if (!remote.online) throw new Error('Servidor desconectado');
    assert(remote.projects.get(projectId).revisions[snapshot.projectRevision - 1], 'Telemetry references a persisted scene revision.');
    const run = Object.assign({}, snapshot, {id: 'run-' + (++telemetryRemote.nextId), projectId,
      sampleCount: snapshot.samples.length, eventCount: snapshot.events.length});
    telemetryRemote.runs.set(run.id, run); telemetryRemote.writes.push(clone(run)); return clone(run);
  }
  async list(projectId) {
    const pause = telemetryRemote.pausedList;
    if (pause) { telemetryRemote.pausedList = null; pause.started.resolve(); await pause.finish.promise; }
    if (!remote.online) throw new Error('Servidor desconectado');
    return Array.from(telemetryRemote.runs.values()).filter(run => run.projectId === projectId).map(clone);
  }
  async get(projectId, runId) {
    if (!remote.online) throw new Error('Servidor desconectado');
    const run = telemetryRemote.runs.get(runId); assert.equal(run.projectId, projectId); return clone(run);
  }
}

const exportsCreated = [];
class BrowserURL extends URL {
  static createObjectURL(blob) { exportsCreated.push(blob); return 'blob:editor-' + exportsCreated.length; }
  static revokeObjectURL() {}
}

class OrbitControls {
  constructor(camera, canvas) { this.camera = camera; this.canvas = canvas; this.target = new THREE.Vector3(); }
  update() { this.updates = (this.updates || 0) + 1; }
}
class TransformControls extends THREE.Object3D {
  setSize(value) { this.size = value; }
  setMode(value) { this.mode = value; }
  setTranslationSnap(value) { this.translationSnap = value; }
  setRotationSnap(value) { this.rotationSnap = value; }
  setScaleSnap(value) { this.scaleSnap = value; }
  attach(object) { this.object = object; }
  detach() { this.object = undefined; }
}

// Geometry and broadphase have separate tests with the production GLBs. This
// adapter makes rejected movements explicit at the editor/input boundary.
class CollisionWorld {
  constructor(ctx, document) {
    this.ctx = ctx; this.document = document; this.moves = []; this.entries = [];
    this.floor = new THREE.Mesh(new THREE.PlaneBufferGeometry(200, 200), new THREE.MeshBasicMaterial()); this.floor.name = 'floor';
    this.floorBounds = new THREE.Box3(new THREE.Vector3(-100, 0, -100), new THREE.Vector3(100, 0, 100));
    this.floorTriangles = [new THREE.Triangle(new THREE.Vector3(-100, 0, -100), new THREE.Vector3(-100, 0, 100), new THREE.Vector3(100, 0, 100)),
      new THREE.Triangle(new THREE.Vector3(-100, 0, -100), new THREE.Vector3(100, 0, 100), new THREE.Vector3(100, 0, -100))];
  }
  setRoom(roomId) {
    this.roomId = roomId; this.root = this.document.getRoot(roomId);
    // The adapted support collider belongs to this room, without becoming an
    // authored object in its child list or serialized project records.
    this.floor.parent = this.root;
  }
  invalidate() { this.invalidations = (this.invalidations || 0) + 1; }
  refresh() { this.entries = [{object: this.floor, box: this.floorBounds}]; }
  triangles(box, options, callback) {
    if (!this.floorBounds.intersectsBox(box)) return false;
    return this.floorTriangles.some(triangle => callback(triangle, this.floor));
  }
  moveSphere(start, desired, radius) {
    this.moves.push({start: start.clone(), desired: desired.clone(), radius});
    return this.sphereResolver ? this.sphereResolver(start, desired, radius) : desired.clone();
  }
  moveCapsule(start, desired) { return desired.clone(); }
  canOccupyCapsule() { return true; }
  isSolid() { return true; }
  canPlaceObject() { return true; }
  testBox() { return false; }
  sweepBox(box, movement) { return {movement: movement.clone(), fraction: 1, blocked: false}; }
  moveObject(object, position) { return {position: position.clone(), fraction: 1, blocked: false}; }
}

class AssetLibrary {
  constructor() { this.imports = []; }
  async getCatalog() {
    this.entries = [
      {path: 'hall.glb', name: 'hall.glb', extension: 'glb', kind: 'model', size: 1024},
      {path: 'images/picture.png', name: 'picture.png', extension: 'png', kind: 'image', size: 256},
      {path: 'ogg/note.ogg', name: 'note.ogg', extension: 'ogg', kind: 'audio', size: 128},
      {path: 'blender/hall.blend', name: 'hall.blend', extension: 'blend', kind: 'source', size: 512}
    ].concat(this.imports);
    return this.entries;
  }
  getEntry(reference) { return (this.entries || []).find(entry => (entry.id || entry.path) === reference) || null; }
  async instantiate(descriptor) {
    if (descriptor.importId && !this.imports.some(record => record.id === descriptor.importId)) throw new Error('Missing resource');
    return new THREE.Mesh(new THREE.BoxBufferGeometry(), new THREE.MeshBasicMaterial({color: '#ffffff'}));
  }
  async loadFiles(files, options = {}) {
    this.loadOptions = options;
    const records = [];
    for (const [index, file] of Array.from(files).entries()) {
      const id = 'batch-import-file-' + index;
      const payload = options.uploadFile ? await options.uploadFile(file) : {dataUrl: 'data:' + file.type + ';base64,' + Buffer.from(file.contents || 'file').toString('base64'), mime: file.type, size: file.size};
      records.push(Object.assign({id, importId: id, batchId: 'batch-import', path: file.name, name: file.name, kind: 'model', extension: 'glb'}, payload));
    }
    if (!options.deferCommit) this.imports = this.imports.concat(records);
    return records;
  }
  exportImports() { return this.imports.map(record => Object.assign({}, record)); }
  async exportPortableImports() {
    return this.exportImports().map(record => {
      if (!record.dataUrl) record.dataUrl = remote.assets.get(record.sha256);
      if (!record.dataUrl) throw new Error('Archivo no disponible');
      delete record.url; delete record.sha256;
      return record;
    });
  }
  restoreImports(records) { this.imports = records.map(record => Object.assign({}, record)); }
  getURL(asset) { return 'assets/' + asset; }
  async preview() { return () => {}; }
}

// Thumbnail rendering/decoding is exercised by test-asset-thumbnails.js. This
// adapter verifies subscriptions stay within authoring mode and visible lists.
class AssetThumbnails {
  constructor(library, root) { this.library = library; this.root = root; this.targets = []; this.attachments = 0; this.disposals = 0; }
  attach(entry, container) { this.targets.push({entry, container}); this.attachments++; }
  reset() { this.targets = []; }
  dispose() { this.disposals++; this.reset(); }
}

// Real projection and texture lifecycle use test-decals.js. This adapter checks
// authoring input and persistence through the full editor UI.
class DecalSystem {
  constructor(ctx, document, library) { this.document = document; this.library = library; this.disposals = 0; this.syncs = []; }
  sync(roomId) { this.syncs.push(roomId); }
  dispose() { this.disposals++; }
  isSurface(object) { return object && object.isMesh && !object.userData.editorRuntimeHelper && !object.userData.editorDecal && object.name !== 'textMesh'; }
}

const prefabSource = sourceFor('IndustrialPrefabs.js').replace(/export const /g, 'const ').replace(/export function /g, 'function ') +
  '\nreturn {industrialPrefabs, createIndustrialPrefab, createProductVisual};';
const {industrialPrefabs, createIndustrialPrefab, createProductVisual} = new Function('THREE', 'behaviorSchema', prefabSource)(THREE, behaviorSchema);
const browserGlobals = {THREE, behaviorSchema, automationSchema, materialSchema, wearSchema, createIndustrialPrefab, createProductVisual, document: dom, window: browserWindow, localStorage, URL: BrowserURL, Blob,
  setTimeout: () => 1, clearTimeout: () => {}};
const SceneDocument = loadClass('SceneDocument.js', browserGlobals);
browserGlobals.RuntimeResourceMemory = loadClass('RuntimeResourceMemory.js', browserGlobals);
browserGlobals.CosmeticVisualLod = loadClass('CosmeticVisualLod.js', browserGlobals);
browserGlobals.GraphicsSettings = loadClass('GraphicsSettings.js', browserGlobals);
const ScenePerformance = loadClass('ScenePerformance.js', browserGlobals);
const InteractionRuntime = loadClass('InteractionRuntime.js', browserGlobals);
const BehaviorRuntime = loadClass('BehaviorRuntime.js', browserGlobals);
browserGlobals.ProductFeedback = loadClass('ProductFeedback.js', browserGlobals);
browserGlobals.ObjectPlacement = require('./load-object-placement')(THREE);
browserGlobals.PalletQueueRuntime = require('./load-pallet-queue-runtime.js')(THREE, behaviorSchema);
browserGlobals.ProcessorRuntime = require('./load-processor-runtime.js')(THREE, behaviorSchema);
browserGlobals.ProductSourceRuntime = require('./load-product-source-runtime')(THREE, behaviorSchema);
const SimulationRuntime = loadClass('SimulationRuntime.js', browserGlobals);
const IndustrialVisuals = loadClass('IndustrialVisuals.js', browserGlobals);
const LineMonitorSystem = loadClass('LineMonitorSystem.js', browserGlobals);
const IndustrialAudioSystem = loadClass('IndustrialAudioSystem.js', browserGlobals);
const SurfaceMaterialSystem = loadClass('SurfaceMaterialSystem.js', browserGlobals);
const WearPaintSystem = loadClass('WearPaintSystem.js', Object.assign({}, browserGlobals, {DecalSystem}));
const WearBrush = loadClass('WearBrush.js', browserGlobals);
const MaterialInspector = loadClass('MaterialInspector.js', browserGlobals);
const ConveyorAssembly = loadClass('ConveyorAssembly.js', {THREE, conveyorLayout: behaviorSchema.conveyorLayout});
const ObjectAssembly = loadClass('ObjectAssembly.js', browserGlobals);
const EquipmentPlacement = loadClass('EquipmentPlacement.js', browserGlobals);
const EditorShell = loadClass('EditorShell.js', browserGlobals);
// The resource browser has independent DOM/thumbnail tests. Keep these legacy
// editor scenarios on its original adapters to verify action compatibility.
class ResourceBrowser {
  setEntries() {} setProject() {} setActive() {} openTab() {} dropEvent() { return false; }
  render() { return false; }
}
// These legacy editor scenarios run without the optional server privacy feature.
// Access enforcement and public projections use their own server-backed tests.
class ProjectAccessView {
  constructor(editor) { this.editor = editor; this.user = null; }
  get enabled() { return false; }
  canEdit() { return true; }
  canVisit() { return true; }
}
const ProjectSharing = loadClass('ProjectSharing.js', browserGlobals);
const ProjectSync = loadClass('ProjectSync.js', browserGlobals);
const resolveProject = new Function(sourceFor('ProjectResolver.js').replace('export default async function resolveProject', 'return async function resolveProject'))();
const recorderSource = sourceFor('TelemetryRecorder.js').replace(/export default class /g, 'class ').replace(/export function /g, 'function ') +
  '\nreturn {TelemetryRecorder, csv};';
const {TelemetryRecorder, csv} = new Function(recorderSource)();
const SimulationPanel = loadClass('SimulationPanel.js', Object.assign({}, browserGlobals, {TelemetryClient, TelemetryRecorder, csv}));
const adapterSource = sourceFor('NativeBehaviorAdapters.js').replace(/export function /g, 'function ') +
  '\nreturn {installNativeBehaviorAdapters, canvasCard};';
const {installNativeBehaviorAdapters, canvasCard} = new Function(...Object.keys(browserGlobals), adapterSource)(...Object.values(browserGlobals));
const InfoPanelPreview = loadClass('InfoPanelPreview.js', {canvasCard});
const nativeSource = sourceFor('NativeBindings.js').replace(/export function /g, 'function ') +
  '\nreturn {describeNative, prepareNativeEdit, syncNativeTransforms};';
const nativeBindings = new Function(nativeSource)();
const SceneEditor = loadClass('SceneEditor.js', Object.assign({}, browserGlobals, nativeBindings,
  {OrbitControls, TransformControls, AssetLibrary, AssetThumbnails, DecalSystem, SurfaceMaterialSystem, WearPaintSystem, WearBrush, MaterialInspector, ConveyorAssembly, ObjectAssembly, EquipmentPlacement, SceneDocument, InteractionRuntime, BehaviorRuntime, InfoPanelPreview,
    SimulationRuntime, SimulationPanel, IndustrialVisuals, IndustrialAudioSystem, LineMonitorSystem, CollisionWorld, ScenePerformance, industrialPrefabs, installNativeBehaviorAdapters, ProjectClient, ProjectLibrary, ProjectSync, resolveProject, ProjectAccessView, ProjectSharing, EditorShell, ResourceBrowser,
    resourceUsage: () => [], removeResource: () => { throw new Error('Resource operations use their independent tests.'); }}));

const ROOM_IDS = ['hall', 'sound', 'photogrammetry', 'vertigo', 'panoramastereo', 'panorama1', 'panorama2', 'panorama3', 'panorama4', 'panorama5'];
function harness(withPanel = false) {
  const canvas = new Element('canvas'); dom.body.appendChild(canvas);
  const renderScene = new THREE.Scene();
  const roots = {};
  ROOM_IDS.forEach((id, index) => {
    const root = new THREE.Group(); root.name = id;
    const native = new THREE.Mesh(new THREE.BoxBufferGeometry(), new THREE.MeshBasicMaterial({color: '#999999'}));
    native.name = index === 0 ? 'doorA' : 'native-' + id; root.add(native);
    if (index === 0) {
      native.userData.editorDefaultBehaviors = [behaviorSchema.defaultBehavior('portal')];
      native.userData.editorNativeBehaviorTypes = ['portal'];
      const badge = new THREE.Mesh(new THREE.BoxBufferGeometry(0.2, 0.2, 0.2), new THREE.MeshBasicMaterial({color: '#aabbcc'}));
      badge.name = 'door-badge'; badge.position.y = 0.5;
      badge.userData.editorDefaultBehaviors = [Object.assign(behaviorSchema.defaultBehavior('float'), {amplitude: 0.05})];
      badge.userData.editorNativeBehaviorTypes = ['float'];
      native.add(badge);
      if (withPanel) {
        const panel = new THREE.Mesh(new THREE.PlaneBufferGeometry(1.2, 0.9), new THREE.MeshBasicMaterial({color: '#040404', transparent: true, opacity: 0}));
        panel.name = 'infopanel015'; panel.position.set(3, 1.5, -2);
        panel.userData.editorDefaultBehaviors = [Object.assign(behaviorSchema.defaultBehavior('info'), {title: 'WELCOME!', text: 'Original instructions'}), behaviorSchema.defaultBehavior('billboard')];
        panel.userData.editorNativeBehaviorTypes = ['info', 'billboard'];
        const glyph = new THREE.Mesh(new THREE.PlaneBufferGeometry(1, 0.7), new THREE.MeshBasicMaterial());
        glyph.name = 'textMesh'; glyph.position.z = 0.01; panel.add(glyph); root.add(panel);
      }
    }
    root.visible = index === 0; roots[id] = root; renderScene.add(root);
  });
  const camera = new THREE.PerspectiveCamera(70, 1280 / 720, 0.1, 1000);
  camera.position.set(0.5, 1.6, 2); camera.rotation.set(0.1, 0.2, 0);
  const cameraRig = new THREE.Group(); cameraRig.add(camera); renderScene.add(cameraRig);
  const calls = {renders: [], sizes: [], teleport: [], unlocks: 0, keyboardClears: 0};
  const raycontrol = {
    states: {'native-door': {colliderMesh: roots.hall.children[0]}}, active: new Set(['native-door']), enabled: true,
    addState(name, state) { this.states[name] = state; },
    activateState(name) { this.active.add(name); }, deactivateState(name) { this.active.delete(name); },
    enable() { this.enabled = true; }, disable() { this.enabled = false; }
  };
  const controllers = [new THREE.Group(), new THREE.Group()];
  const ctx = {
    room: 0, goto: null, vrMode: false, editorRoots: roots, scene: renderScene, camera, cameraRig, controllers,
    desktopController: new THREE.Group(), assets: {hall_model: {scene: roots.hall}}, raycontrol,
    renderer: {domElement: canvas, xr: {enabled: true, getCamera: camera => camera},
      render: (scene, usedCamera) => calls.renders.push({scene, camera: usedCamera}),
      setSize: (width, height) => calls.sizes.push([width, height])},
    teleport: {
      onHover: (point, active) => calls.teleport.push(['hover', point, active]),
      onHoverLeave: () => calls.teleport.push(['leave']),
      onSelectStart: controller => calls.teleport.push(['start', controller]),
      onSelectEnd: point => calls.teleport.push(['end', point])
    }
  };
  let editor;
  const hooks = {renderScene, unlock: () => calls.unlocks++, clearKeyboard: () => calls.keyboardClears++,
    gotoRoom: async room => {
      await editor.prepareRoom(ROOM_IDS[room]);
      editor.beforeRoomChange(); roots[ROOM_IDS[ctx.room]].visible = false;
      ctx.room = room; roots[ROOM_IDS[room]].visible = true; editor.afterRoomChange();
    }};
  editor = new SceneEditor(ctx, hooks); ctx.editor = editor;
  return {ctx, editor, calls, roots, hooks};
}

async function run() {
  const {ctx, editor, calls, roots, hooks} = harness();
  const nativeCamera = ctx.camera;
  const nativeCameraPosition = ctx.camera.position.clone();
  const nativeCameraQuaternion = ctx.camera.quaternion.clone();
  const nativeControllers = ctx.controllers.slice();
  const nativeDoor = roots.hall.children[0];
  const nativeRayState = ctx.raycontrol.states['native-door'];
  await editor.ready;
  assert.strictEqual(editor.document.rooms.size, 10);
  assert.strictEqual(editor.entries.length, 4);
  assert.strictEqual(editor.storageAvailable, true);
  assert.strictEqual(editor.dirty, false);
  assert.strictEqual(editor.active, true, 'The /editor route opens authoring automatically.');
  assert.strictEqual(ctx.performanceVisibility, editor.performance, 'Editor/runtime share the real visibility manager.');
  assert.equal(editor.performance.getStats().inactiveRooms, 9);
  editor.enter();
  assert.strictEqual(editor.active, true);
  assert.strictEqual(ctx.raycontrol.enabled, false);
  assert.strictEqual(ctx.cameraRig.visible, false);
  assert.strictEqual(ctx.renderer.domElement.parentNode, editor.viewport);
  assert.strictEqual(editor.orbit.enabled, true);
  assert(calls.unlocks > 0 && calls.keyboardClears > 0);
  editor.camera.position.set(4, 5, 6); editor.render();
  assert.strictEqual(calls.renders.at(-1).camera, editor.camera);
  assert.strictEqual(calls.renders.at(-1).scene, hooks.renderScene);
  assert.strictEqual(ctx.camera, nativeCamera);
  assert(ctx.camera.position.equals(nativeCameraPosition));
  assert(ctx.camera.quaternion.equals(nativeCameraQuaternion));
  assert.strictEqual(ctx.renderer.xr.enabled, true);
  assert.deepStrictEqual(ctx.controllers, nativeControllers);

  const portal = editor.document.addPrimitive('hall', 'box');
  editor.document.setInteraction(portal, {type: 'room', room: 2});
  const toggle = editor.document.addPrimitive('hall', 'sphere');
  editor.document.setInteraction(toggle, {type: 'toggle', targetId: nativeDoor.userData.editorId});
  const floor = editor.document.addPrimitive('hall', 'plane');
  editor.document.setInteraction(floor, {type: 'teleport'});
  const info = editor.document.addPrimitive('hall', 'box');
  editor.document.setInteraction(info, {type: 'message', text: 'Información del escenario'});
  editor.select(portal);
  assert.strictEqual(editor.transform.object, portal);
  editor.transform.dispatchEvent({type: 'dragging-changed', value: true});
  portal.position.x = 3;
  editor.transform.dispatchEvent({type: 'dragging-changed', value: false});
  await Promise.resolve();
  assert.strictEqual(portal.position.x, 3);
  editor.document.undo(); assert.strictEqual(portal.position.x, 0);
  editor.document.redo(); assert.strictEqual(portal.position.x, 3);

  editor.leave();
  assert.strictEqual(editor.active, false);
  assert.strictEqual(ctx.raycontrol.enabled, true);
  assert.strictEqual(ctx.cameraRig.visible, true);
  assert.strictEqual(ctx.renderer.domElement.parentNode, dom.body);
  assert.strictEqual(ctx.raycontrol.states['native-door'], nativeRayState);
  const stateFor = object => ctx.raycontrol.states['editor-action-' + object.userData.editorId];
  const hit = {point: new THREE.Vector3(1, 0, -2), object: portal};
  stateFor(portal).onSelectStart(hit);
  assert.strictEqual(ctx.goto, 2);
  stateFor(toggle).onSelectStart(hit);
  assert.strictEqual(nativeDoor.visible, false);
  const teleport = stateFor(floor);
  assert.strictEqual(teleport.vrOnly, true); assert.strictEqual(teleport.controller, 'primary');
  teleport.onHover(hit, true); teleport.onSelectStart(hit, ctx.controllers[1]); teleport.onSelectEnd(hit); teleport.onHoverLeave();
  assert.deepStrictEqual(calls.teleport.slice(-4), [['hover', hit.point, true], ['start', ctx.controllers[1]], ['end', hit.point], ['leave']]);
  stateFor(info).onSelectStart(hit);
  const card = editor.interactions.cards[0]; assert(card && card.parent === ctx.scene);
  const stalePortalAction = stateFor(portal);
  editor.enter();
  assert.strictEqual(nativeDoor.visible, true);
  assert.strictEqual(card.parent, null);
  assert.strictEqual(stateFor(portal), undefined);
  ctx.goto = null; stalePortalAction.onSelectStart(hit); assert.strictEqual(ctx.goto, null);

  const beforeEmpty = await editor.document.serialize();
  const StudioTools = loadClass('../studio/StudioTools.js', {THREE, schema: behaviorSchema, document: dom, window: browserWindow});
  new StudioTools(editor);
  editor.emptyRoom(); await Promise.resolve(); await Promise.resolve();
  assert.strictEqual(nativeDoor.parent, roots.hall);
  assert.strictEqual(nativeDoor.visible, false);
  const base = editor.document.getObjects('hall').filter(object => !editor.document.isNative(object));
  assert.strictEqual(base.length, 3);
  const baseFloor = base.find(object => object.name === 'Suelo del nivel');
  assert.deepStrictEqual(editor.document.getBehaviors(baseFloor).map(item => item.type).sort(), ['collision', 'teleport']);
  assert.strictEqual(editor.document.studio.environments.find(item => item.roomId === 'hall').sky, 'day');
  assert(editor.document.studio.spawns.some(item => item.roomId === 'hall'));
  assert(editor.document.studio.entities.some(item => item.roomId === 'hall' && item.type === 'camera'));
  editor.document.undo(); assert.deepStrictEqual(await editor.document.serialize(), beforeEmpty);
  editor.document.redo(); assert.strictEqual(nativeDoor.visible, false);
  editor.document.undo();

  // Panorama scenarios get separate persistent custom objects.
  await hooks.gotoRoom(5); editor.document.addPrimitive(editor.roomId, 'sphere');
  await hooks.gotoRoom(6); editor.document.addPrimitive(editor.roomId, 'box');
  assert.notStrictEqual(editor.document.getRoot('panorama1'), editor.document.getRoot('panorama2'));
  assert.strictEqual(editor.document.getObjects('panorama1').filter(object => !editor.document.isNative(object)).length, 1);
  assert.strictEqual(editor.document.getObjects('panorama2').filter(object => !editor.document.isNative(object)).length, 1);
  await hooks.gotoRoom(0);
  await editor.saveLocal();
  assert.strictEqual(editor.dirty, false);
  const saved = JSON.parse(localStorage.getItem('hello-webxr-editor-v1'));
  assert.strictEqual(saved.rooms.hall.additions.length, 4);
  const restored = harness(); await restored.editor.ready;
  assert.deepStrictEqual(await restored.editor.document.serialize(), saved);
  assert.strictEqual(restored.editor.dirty, true, 'A legacy browser save still needs its first SQLite save');
  restored.editor.enter(); restored.ctx.vrMode = true; restored.editor.onVRChange(true);
  assert.strictEqual(restored.editor.active, false);
  restored.editor.enter(); assert.strictEqual(restored.editor.active, false);
  assert.strictEqual(restored.ctx.renderer.xr.enabled, true);
  assert.strictEqual(ctx.camera, nativeCamera);
  assert(ctx.camera.position.equals(nativeCameraPosition));
  assert(ctx.camera.quaternion.equals(nativeCameraQuaternion));
  assert.deepStrictEqual(ctx.controllers, nativeControllers);
  assert.strictEqual(ctx.renderer.xr.enabled, true);

  // SQLite saving replaces imported bytes with server references, while a JSON
  // download stays portable. Existing built-in asset paths are left as paths.
  const imageImport = {id: 'import-picture', importId: 'import-picture', path: 'custom/picture.png', name: 'picture.png',
    kind: 'image', extension: 'png', size: 4, mime: 'image/png', batchId: 'test-batch', dataUrl: 'data:image/png;base64,dGVzdA=='};
  editor.library.restoreImports([imageImport]);
  await editor.document.addAsset('hall', {importId: imageImport.id});
  await editor.document.addAsset('hall', {path: 'hall.glb'});
  const firstProject = await editor.saveProject();
  assert.equal(firstProject.name, 'Mi escenario');
  assert.equal(firstProject.revision, 1);
  assert.equal(editor.currentProject.id, firstProject.id);
  assert.equal(editor.dirty, false);
  assert.equal(localStorage.getItem('hello-webxr-active-project'), firstProject.id);
  assert.equal(firstProject.document.imports.length, 1);
  assert(!firstProject.document.imports[0].dataUrl);
  assert(firstProject.document.imports[0].url.startsWith('/api/assets/'));
  assert(!editor.library.exportImports()[0].dataUrl, 'The live import library uses lightweight saved references');
  assert.deepStrictEqual(await editor.document.serialize(), firstProject.document);
  const pictureObject = editor.document.getObjects('hall').find(object => object.userData.editorDescriptor && object.userData.editorDescriptor.importId === imageImport.id);
  assert(pictureObject, 'The imported object remains in the scene');
  editor.document.setTransform(pictureObject, {position: [7, 1, -3]});
  const secondProject = await editor.saveProject();
  assert.equal(secondProject.id, firstProject.id);
  assert.equal(secondProject.revision, 2);
  assert.equal(editor.dirty, false);
  assert.equal(remote.projects.size, 1);
  await editor.exportProject();
  const portable = JSON.parse(await exportsCreated[exportsCreated.length - 1].text());
  assert.equal(portable.imports[0].dataUrl, imageImport.dataUrl);
  assert(!portable.imports[0].url && !portable.imports[0].sha256);

  const reloaded = harness(); await reloaded.editor.ready;
  assert.deepStrictEqual(await reloaded.editor.document.serialize(), secondProject.document);
  assert.equal(reloaded.editor.currentProject.id, secondProject.id);
  assert.equal(reloaded.editor.currentProject.revision, 2);
  assert.equal(reloaded.editor.dirty, false, 'A reload resolves the active project from the server');
  const history = await reloaded.editor.projectClient.listRevisions(secondProject.id);
  assert.deepStrictEqual(history.map(item => item.revision), [2, 1]);
  const historical = await reloaded.editor.projectClient.getProject(secondProject.id, 1);
  assert.equal(historical.revision, 2, 'An old snapshot retains the current head for optimistic saving');
  assert.equal(historical.historicalRevision, 1);
  await reloaded.editor.openServerProject(historical);
  assert.equal(reloaded.editor.dirty, true, 'Opening an old version marks it for a new save');
  assert.deepStrictEqual(await reloaded.editor.document.serialize(), firstProject.document);
  assert.equal(reloaded.editor.document.undoStack.length, 0, 'Project switching does not retain another project history');
  const recoveredVersion = await reloaded.editor.saveProject();
  assert.equal(recoveredVersion.revision, 3);
  assert.deepStrictEqual(recoveredVersion.document, firstProject.document);
  assert.equal((await reloaded.editor.projectClient.listRevisions(firstProject.id)).length, 3);

  const copy = await reloaded.editor.saveProject('Copia para exposición', true);
  assert.notEqual(copy.id, firstProject.id);
  assert.equal(copy.name, 'Copia para exposición');
  assert.equal(copy.revision, 1);
  assert.equal(reloaded.editor.currentProject.id, copy.id);
  assert.equal((await reloaded.editor.projectClient.getProject(firstProject.id)).revision, 3, 'Saving a copy does not mutate its source');
  const unsavedCopyObject = reloaded.editor.document.addPrimitive('hall', 'cylinder');
  const unsavedCopyId = unsavedCopyObject.userData.editorId;
  reloaded.editor.document.addPrimitive('panorama5', 'sphere');
  assert.equal(reloaded.editor.dirty, true);
  await reloaded.editor.createServerProject('Nueva colección');
  const newProjectId = reloaded.editor.currentProject.id;
  assert.notEqual(newProjectId, copy.id);
  assert.equal(reloaded.editor.projectName, 'Nueva colección');
  assert.equal(reloaded.editor.currentProject.revision, 1);
  assert.equal(reloaded.editor.dirty, false);
  const keptCopy = await reloaded.editor.projectClient.getProject(copy.id);
  assert.equal(keptCopy.revision, 2, 'Creating a project saves the dirty previous project before switching');
  assert(keptCopy.document.rooms.hall.additions.some(item => item.id === unsavedCopyId));
  const freshDocument = await reloaded.editor.document.serialize();
  assert.deepStrictEqual(Object.keys(freshDocument.rooms).sort(), ROOM_IDS.slice().sort());
  ROOM_IDS.forEach(id => {
    assert.deepStrictEqual(freshDocument.rooms[id], {overrides: [], additions: []});
    assert.strictEqual(reloaded.editor.document.getRoot(id), reloaded.roots[id]);
    assert.strictEqual(reloaded.roots[id].children[0].visible, true, 'New projects restore native objects in ' + id);
  });
  assert.deepStrictEqual(freshDocument.imports, []);
  assert.strictEqual(reloaded.ctx.raycontrol.states['native-door'].colliderMesh, reloaded.roots.hall.children[0]);
  assert.equal(reloaded.ctx.renderer.xr.enabled, true);

  remote.online = false;
  reloaded.editor.document.addPrimitive('hall', 'sphere');
  await assert.rejects(() => reloaded.editor.saveProject(), /desconectado/);
  assert.equal(reloaded.editor.dirty, true);
  assert.equal(reloaded.editor.currentProject.id, newProjectId);
  assert.equal(remote.projects.get(newProjectId).revision, 1);
  await reloaded.editor.exportProject();
  const offlineDocument = JSON.parse(await exportsCreated[exportsCreated.length - 1].text());
  assert.equal(offlineDocument.rooms.hall.additions.length, 1, 'JSON export remains available without the server');
  await reloaded.editor.saveLocal();
  assert.deepStrictEqual(JSON.parse(localStorage.getItem('hello-webxr-editor-v1')), offlineDocument);
  assert.equal(reloaded.editor.dirty, true, 'A browser backup must not mark pending SQLite edits as saved');
  // Browser backups and JSON imports remain useful in a static/offline copy.
  // Start with a clean draft so importing does not replace unsaved work.
  storage.clear();
  const offline = harness(); await offline.editor.ready;
  assert.equal(offline.editor.storageAvailable, false);
  offline.editor.projectInput.files = [{name: 'Colección sin conexión.json', text: async () => JSON.stringify(offlineDocument)}];
  await offline.editor.projectInput.fire('change');
  assert.deepStrictEqual(await offline.editor.document.serialize(), offlineDocument);
  assert.equal(offline.editor.dirty, true);
  assert.equal(offline.editor.currentProject, null);
  assert.equal(offline.editor.projectName, 'Colección sin conexión');
  remote.online = true;

  // Saving captures a snapshot. Edits and imports made while the request is in
  // flight must stay in the live scene and continue to be marked unsaved.
  const primary = reloaded.editor;
  primary.document.addPrimitive('sound', 'box');
  const pause = pauseNextWrite();
  const inFlightSave = primary.saveProject();
  await pause.started.promise;
  const laterImport = Object.assign({}, imageImport, {id: 'import-later', importId: 'import-later', path: 'custom/later.png', name: 'later.png'});
  primary.library.restoreImports(primary.library.exportImports().concat([laterImport]));
  const laterObject = await primary.document.addAsset('sound', {importId: laterImport.id});
  pause.finish.resolve();
  const staleSave = await inFlightSave;
  assert.equal(primary.dirty, true, 'A successful old snapshot never clears later edits');
  assert(!staleSave.document.imports.some(record => record.id === laterImport.id));
  assert(primary.document.getObject(laterObject.userData.editorId));
  assert.equal(primary.library.exportImports().find(record => record.id === laterImport.id).dataUrl, laterImport.dataUrl,
    'Saving preserves files imported during the request');
  const catchUp = await primary.saveProject();
  assert.equal(primary.dirty, false);
  assert(catchUp.document.imports.some(record => record.id === laterImport.id && record.url));

  // Opening an already-fetched project after saving its dirty current scene
  // must refetch the new head, otherwise the user's newest work disappears.
  const staleOpen = await primary.projectClient.getProject(newProjectId);
  const latestObject = primary.document.addPrimitive('vertigo', 'box');
  await primary.openServerProject(staleOpen);
  assert((await primary.document.serialize()).rooms.vertigo.additions.some(record => record.id === latestObject.userData.editorId),
    'Opening refetches the head after saving current changes, retaining inactive room records.');
  assert.equal(primary.document.getObject(latestObject.userData.editorId), null, 'Reopening does not instantiate inactive room assets.');
  assert.equal(primary.dirty, false);
  const versionBeforeVisit = primary.changeVersion, historyBeforeVisit = primary.document.undoStack.length;
  await reloaded.hooks.gotoRoom(3);
  assert(primary.document.getObject(latestObject.userData.editorId), 'Room navigation awaits deferred model preparation before committing the switch.');
  assert.equal(primary.performance.roomId, 'vertigo');
  assert.equal(primary.dirty, false, 'Visiting a deferred room does not dirty the saved project.');
  assert.equal(primary.changeVersion, versionBeforeVisit);
  assert.equal(primary.document.undoStack.length, historyBeforeVisit);
  await reloaded.hooks.gotoRoom(0);
  const latestBeforeRace = await primary.projectClient.getProject(newProjectId);
  primary.document.addPrimitive('panorama3', 'sphere');
  const openingPause = pauseNextWrite();
  const opening = primary.openServerProject(latestBeforeRace);
  await openingPause.started.promise;
  const changedWhileOpening = primary.document.addPrimitive('panorama4', 'cylinder');
  openingPause.finish.resolve();
  await assert.rejects(() => opening, /cambi[oó].*mientras/);
  assert.equal(primary.dirty, true);
  assert(primary.document.getObject(changedWhileOpening.userData.editorId), 'A refused switch retains edits made during its save');
  await primary.saveProject();

  // Another tab may move the head. A conflict leaves local work intact and a
  // named copy remains available instead of overwriting that remote head.
  const otherTab = harness(); await otherTab.editor.ready;
  assert.equal(otherTab.editor.currentProject.id, newProjectId);
  const oldHead = otherTab.editor.currentProject.revision;
  primary.document.addPrimitive('panorama2', 'box');
  await primary.saveProject();
  const conflictingObject = otherTab.editor.document.addPrimitive('hall', 'plane');
  await assert.rejects(() => otherTab.editor.saveProject(), /otra ventana/);
  assert.equal(otherTab.editor.dirty, true);
  assert.equal(otherTab.editor.currentProject.revision, oldHead);
  assert(otherTab.editor.document.getObject(conflictingObject.userData.editorId));
  assert.equal(remote.projects.get(newProjectId).revision, oldHead + 1);
  const conflictCopy = await otherTab.editor.saveProject('Copia de cambios locales', true);
  assert.notEqual(conflictCopy.id, newProjectId);
  assert.equal(otherTab.editor.dirty, false);
  assert(conflictCopy.document.rooms.hall.additions.some(record => record.id === conflictingObject.userData.editorId));

  assert.strictEqual(ctx.camera, nativeCamera);
  assert(ctx.camera.position.equals(nativeCameraPosition));
  assert(ctx.camera.quaternion.equals(nativeCameraQuaternion));
  assert.deepStrictEqual(ctx.controllers, nativeControllers);
  assert.strictEqual(ctx.renderer.xr.enabled, true);
  assert.strictEqual(ctx.raycontrol.states['native-door'], nativeRayState);
  await testInspectorComponents();
  await testIndustrialMaterialsDuringProjectLoading();
  await testSurfaceMaterialInspector();
  await testMaterialPartsInspector();
  await testInformationPanelEditing();
  await testAssetBrowserThumbnails();
  await testLargeImportIntegration();
  await testDecalPlacement();
  await testSimulationPanel();
  await testIndustrialPanelBindings();
  await testModularConveyorAuthoring();
  await testTypedConveyorInspector();
  await testMagneticEquipmentAuthoring();
  await testMagneticBoxAuthoring();
  await testProductSourceAuthoring();
  await testProcessorAuthoring();
  await testPalletQueueAuthoring();
  await testConveyorSortingAuthoring();
  await testSharedProjects();
  await testPublicRoutes();
  await testEditorNavigation();
  await testCameraCollisionIntegration();
  testVisitorCollisionIntegration();
  testTeleportCollisionIntegration();
  await testObjectClipboard();
  console.log('Editor/runtime: native components, WASD/Space tools, collision-constrained camera/visitor/VR, validated teleport, object copy/paste, industrial simulation, recording, project opening/sync, public/editor routes and draft/race protection passed (DOM/control adapters; mocked persistence/geometry).');
}

async function testSurfaceMaterialInspector() {
  storage.clear(); remote.projects.clear(); remote.online = true;
  browserWindow.location = 'https://editor.test/editor';
  const {editor, ctx} = harness(); await editor.ready;
  const object = await editor.perform(() => editor.document.addPrefab('hall', 'conveyor'));
  const descendants = root => [root].concat(root.children.flatMap(descendants));
  const input = label => descendants(editor.inspector).find(node => node.getAttribute('aria-label') === label);
  const button = text => descendants(editor.inspector).find(node => node.tagName === 'BUTTON' && node.textContent === text);
  const settle = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
  editor.select(object);
  let choice = input('Acabado del material'); assert(choice);
  choice.value = 'wood'; await choice.fire('change'); await settle();
  const current = () => editor.document.getBehaviors(object).find(config => config.type === 'surfaceMaterial');
  assert.equal(current().preset, 'wood'); assert.equal(current().metalness, 0);
  assert.equal(current().roughness, materialSchema.getPreset('wood').roughness);
  let roughness = input('Rugosidad'); roughness.value = '0.39'; await roughness.fire('change'); await settle();
  assert.equal(current().roughness, 0.39);
  const wear = input('Desgaste general'); wear.value = '0.6'; await wear.fire('change'); await settle();
  assert.equal(current().wear, 0.6);
  await button('Copiar material').click(); await settle();
  const copied = JSON.parse(JSON.stringify(current()));
  const other = await editor.perform(() => editor.document.addPrimitive('hall', 'box'));
  editor.select(other); await button('Pegar material').click(); await settle();
  const pasted = editor.document.getBehaviors(other).find(config => config.type === 'surfaceMaterial');
  assert.deepStrictEqual(Object.assign({}, pasted, {slot: copied.slot}), copied, 'Pasting copies the finish, using the currently selected destination.');
  assert.equal(pasted.slot, editor.materialInspector.target(other));
  roughness = input('Rugosidad'); roughness.value = '0.8'; await roughness.fire('change'); await settle();
  assert.equal(current().roughness, 0.39, 'Pasting material parameters creates an independently editable finish.');
  editor.select(object);
  await button('Pintar sobre este objeto').click();
  assert(editor.wearBrush && editor.wearBrush.owner === object); assert.equal(editor.transform.enabled, false);
  assert.equal(editor.decalPlacementBar.hidden, false); assert(editor.wearBrushTool.ring.parent === ctx.scene);
  editor.onKey({code: 'Escape', target: dom.body, preventDefault() {}});
  assert.equal(editor.wearBrush, null); assert.equal(editor.wearBrushTool.ring, null); assert.equal(editor.transform.enabled, true);
  const before = await editor.document.serialize();
  await editor.saveProject('Acabados personalizados');
  assert.deepStrictEqual(await editor.document.serialize(), before, 'Saving while private PBR/industrial wrappers are installed preserves authored behavior only.');
  choice = input('Acabado del material'); choice.value = '__original'; await choice.fire('change'); await settle();
  assert.equal(current(), undefined);
  await editor.perform(() => editor.historyStep('undo'));
  assert.deepStrictEqual(current(), copied, 'Undo restores the customized finish, including its wear parameters.');
  editor.industrialVisuals.dispose(); editor.materials.dispose(); editor.wearPaint.dispose();
}

async function testMaterialPartsInspector() {
  storage.clear(); remote.projects.clear(); remote.online = true;
  browserWindow.location = 'https://editor.test/editor';
  const {editor, ctx} = harness(); await editor.ready;
  const actor = await editor.perform(() => editor.document.addPrefab('hall', 'conveyor'));
  const descendants = root => [root].concat(root.children.flatMap(descendants));
  const input = label => descendants(editor.inspector).find(node => node.getAttribute('aria-label') === label);
  const button = text => descendants(editor.inspector).find(node => node.tagName === 'BUTTON' && node.textContent === text);
  const settle = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); await editor.materials.sync(editor.roomId); };
  const assignments = object => materialSchema.assignments(editor.document.getBehaviors(object).find(config => config.type === 'surfaceMaterial'));
  const change = async (label, value) => { const control = input(label); assert(control, label); control.value = value; await control.fire('change'); await settle(); };
  editor.select(actor);
  assert.equal(input('Color'), undefined, 'A compound machine never offers the legacy whole-object tint.');
  const slots = editor.materials.getSlots(actor).filter(slot => slot.value.startsWith('mesh:'));
  assert(slots.length > 2, 'The author can select individual mesh/material surfaces.');
  assert.notEqual(input('Parte o material a editar').value, 'all', 'The first material edit starts on one part, not the whole machine.');
  await change('Parte o material a editar', slots[0].value);
  assert.equal(editor.document.getBehaviors(actor).some(config => config.type === 'surfaceMaterial'), false, 'Selecting a surface alone never changes the asset.');
  await change('Color base', '#cb421e');
  assert.equal(assignments(actor)[0].slot, slots[0].value); assert.equal(assignments(actor)[0].color, '#cb421e');
  await change('Parte o material a editar', slots[1].value);
  await change('Color base', '#2d86b8');
  assert.equal(assignments(actor).length, 2); assert.equal(assignments(actor)[0].color, '#cb421e');
  const mapMode = materialSchema.fields.find(field => field.key === 'colorMapMode'); assert(mapMode);
  await change(mapMode.label, 'none');
  assert.equal(assignments(actor).find(value => value.slot === slots[1].value).colorMapMode, 'none');
  const beforeRoughness = clone(assignments(actor));
  await change('Rugosidad', '0.93');
  assert.equal(assignments(actor).find(value => value.slot === slots[1].value).roughness, 0.93);
  await editor.perform(() => editor.historyStep('undo')); await settle();
  assert.deepStrictEqual(assignments(actor), beforeRoughness, 'Undo changes only the selected part and keeps its other assignments.');
  await change('Parte o material a editar', slots[0].value);
  await button('Copiar material').click();
  const destination = await editor.perform(() => editor.document.addPrefab('hall', 'conveyor'));
  editor.select(destination);
  const destinationSlot = editor.materials.getSlots(destination).filter(slot => slot.value.startsWith('mesh:'))[2].value;
  await change('Parte o material a editar', destinationSlot);
  await button('Pegar material').click(); await settle();
  assert.equal(assignments(destination).length, 1); assert.equal(assignments(destination)[0].slot, destinationSlot);
  assert.equal(assignments(destination)[0].color, '#cb421e');
  assert.notEqual(assignments(destination)[0].slot, slots[0].value, 'The copied material never transfers the source selector.');
  await change('Rugosidad', '0.81');
  assert.equal(assignments(actor)[0].color, '#cb421e'); assert.notEqual(assignments(actor)[0].roughness, 0.81);
  editor.select(actor); await change('Parte o material a editar', slots[1].value);
  await editor.previewAsset(editor.entries.find(entry => entry.kind === 'image'));
  const textureButton = descendants(editor.preview).find(node => node.tagName === 'BUTTON' && node.textContent === 'Usar como textura');
  assert(textureButton); await textureButton.click(); await settle();
  assert.equal(assignments(actor)[0].texture, '', 'Using a file as texture leaves other part assignments intact.');
  assert.equal(assignments(actor)[1].texture, 'images/picture.png'); assert.equal(assignments(actor)[1].colorMapMode, 'preserve');
  await editor.perform(() => editor.document.setProperty(actor, 'color', '#667788')); await settle();
  const assignedBeforeReset = clone(assignments(actor));
  assert(button('Restaurar colores originales')); await button('Restaurar colores originales').click(); await settle();
  assert.equal(actor.userData.editorColor, undefined); assert.deepStrictEqual(assignments(actor), assignedBeforeReset, 'Legacy tint restoration preserves the authored finishes.');
  const snapshot = await editor.document.serialize(); const saved = await editor.saveProject('Materiales por partes');
  assert.deepStrictEqual(saved.document, snapshot);
  const reopened = harness(); await reopened.editor.ready;
  assert.deepStrictEqual(await reopened.editor.document.serialize(), snapshot, 'Multiple surface assignments survive saving and reopening.');
  assert.equal(ctx.renderer.xr.enabled, true);
  editor.select(actor); await change('Parte o material a editar', slots[0].value);
  await button('Restaurar esta parte').click(); await settle();
  assert.equal(assignments(actor).length, 1); assert.equal(assignments(actor)[0].slot, slots[1].value, 'Removing the root assignment promotes the remaining finish without losing it.');
  await button('Restaurar todos los materiales').click(); await settle();
  assert.equal(editor.document.getBehaviors(actor).some(config => config.type === 'surfaceMaterial'), false);
  editor.projectSync.stop(); reopened.editor.projectSync.stop();
  editor.industrialVisuals.dispose(); editor.materials.dispose(); editor.wearPaint.dispose();
  reopened.editor.industrialVisuals.dispose(); reopened.editor.materials.dispose(); reopened.editor.wearPaint.dispose();
}

async function testIndustrialMaterialsDuringProjectLoading() {
  storage.clear(); remote.projects.clear(); remote.online = true;
  browserWindow.location = 'https://editor.test/editor';
  const {editor} = harness(); await editor.ready;
  const belt = await editor.perform(() => {
    const object = editor.document.addPrefab('hall', 'conveyor');
    editor.document.setProperty(object, 'color', '#486a85');
    return object;
  });
  // Build an incoming project with a model whose loading can be held at the
  // asset boundary. SceneDocument.load, rollback and material handling are real.
  const imported = await editor.perform(() => editor.document.addAsset('hall', {path: 'hall.glb'}));
  const incoming = await editor.document.serialize();
  await editor.perform(() => editor.document.remove(imported));
  const authored = await editor.document.serialize();
  editor.render(1 / 60);
  const hmi = Array.from(editor.industrialVisuals.displays.values())[0];
  assert(hmi, 'Authoring preview installs the physical HMI before switching projects.');
  assert.notStrictEqual(hmi.object.material, hmi.original);
  const authoredScreenMaterial = hmi.original;
  const disposedTextures = new Set();
  hmi.texture.addEventListener('dispose', () => disposedTextures.add(hmi.texture));
  editor.industrialVisuals.rollerTextures.forEach(surface => surface.texture.addEventListener('dispose', () => disposedTextures.add(surface.texture)));
  const pause = {started: deferred(), finish: deferred()};
  const instantiate = editor.library.instantiate.bind(editor.library);
  editor.library.instantiate = async descriptor => {
    if (descriptor.path !== 'hall.glb') return instantiate(descriptor);
    pause.started.resolve(); await pause.finish.promise;
    throw new Error('Modelo no disponible durante la carga.');
  };
  // Opening/remote refresh calls applyServerProject directly, outside perform.
  const opening = editor.applyServerProject({id: 'industrial-material-race', name: 'Carga fallida', revision: 1, document: incoming});
  const rejected = assert.rejects(opening, /Modelo no disponible/);
  await pause.started.promise;
  assert.equal(editor.pendingEdits, 0);
  assert.equal(editor.loadingProject, true);
  assert.equal(editor.document.loading, true);
  assert(disposedTextures.has(hmi.texture), 'Project switching releases the previous dashboard texture immediately.');
  for (let frame = 0; frame < 4; frame++) {
    editor.render(1 / 60); editor.execute(1 / 60, frame / 60);
    assert.equal(editor.industrialVisuals.displays.size, 0, 'Loading frames must not reinstall a temporary HMI over the authored screen.');
    assert.equal(editor.industrialVisuals.colors.size, 0, 'Loading frames must retain authored sensor/button materials for rollback.');
    assert.equal(editor.industrialVisuals.rollers.size, 0, 'Loading frames must not attach transient roller surface maps.');
    assert.strictEqual(hmi.object.material, authoredScreenMaterial);
  }
  pause.finish.resolve(); await rejected;
  editor.library.instantiate = instantiate;
  assert.equal(editor.loadingProject, false); assert.equal(editor.document.loading, false);
  assert.strictEqual(editor.document.getObject(belt.userData.editorId), belt, 'A failed load restores the same editable machine.');
  assert.deepStrictEqual(await editor.document.serialize(), authored, 'A failed project load preserves authored colors, properties and references.');
  assert.strictEqual(hmi.object.material, authoredScreenMaterial);
  assert.equal(authoredScreenMaterial.color.getHexString(), '486a85');
  belt.traverse(object => {
    const current = object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : [];
    const originals = object.userData.editorOriginalMaterials || [];
    current.concat(originals).forEach(material => {
      if (material && material.map) assert(!disposedTextures.has(material.map), 'A disposed dashboard/roller map must never become an authored original after rollback.');
    });
  });
  editor.render(1 / 60);
  const restored = Array.from(editor.industrialVisuals.displays.values())[0];
  assert(restored && restored.texture !== hmi.texture, 'Preview resumes with a fresh live texture after loading fails.');
  assert.strictEqual(restored.original, authoredScreenMaterial);
  editor.industrialVisuals.dispose(); editor.projectSync.stop();
}

async function testSharedProjects() {
  storage.clear(); remote.projects.clear(); remote.online = true;
  browserWindow.location = 'https://editor.test/editor';
  const first = harness(); await first.editor.ready; await first.editor.projectSync.check();
  const band = first.editor.document.addPrefab('hall', 'conveyor');
  first.editor.document.setTransform(band, {position: [2, 1, -2]});
  const saved = await first.editor.saveProject('Línea compartida');
  const bandId = band.userData.editorId;

  // A different browser has no localStorage pointer or browser backup at all.
  storage.clear();
  const second = harness(); await second.editor.ready; await second.editor.projectSync.check();
  assert.equal(second.editor.currentProject.id, saved.id);
  assert.deepStrictEqual(await second.editor.document.serialize(), saved.document);
  assert(second.editor.projectButton.textContent.includes('Línea compartida'));
  const cameraPosition = second.editor.camera.position.clone();
  second.editor.select(second.editor.document.getObject(bandId));
  first.editor.document.setTransform(band, {position: [4, 1, -2]});
  await first.editor.saveProject();
  await second.editor.projectSync.check();
  assert.equal(second.editor.currentProject.revision, 2);
  assert.equal(second.editor.document.getObject(bandId).position.x, 4);
  assert.equal(second.editor.selected.userData.editorId, bandId);
  assert(second.editor.camera.position.equals(cameraPosition), 'A clean tab refresh keeps its authoring camera and selection.');

  first.editor.document.setTransform(band, {position: [5, 1, -2]});
  await first.editor.saveProject();
  const pause = {started: deferred(), finish: deferred()};
  const getProject = second.editor.projectClient.getProject.bind(second.editor.projectClient);
  second.editor.projectClient.getProject = async (...args) => {
    const project = await getProject(...args); pause.started.resolve(); await pause.finish.promise; return project;
  };
  const updating = second.editor.projectSync.check(); await pause.started.promise;
  const local = second.editor.document.addPrimitive('hall', 'sphere');
  pause.finish.resolve(); await updating;
  second.editor.projectClient.getProject = getProject;
  assert(second.editor.document.getObject(local.userData.editorId), 'An edit made while fetching another tab survives.');
  assert.equal(second.editor.currentProject.revision, 2);
  assert.equal(second.editor.dirty, true);
  assert.equal(second.editor.projectUpdateButton.hidden, false);
  await assert.rejects(() => second.editor.refreshRemoteProject(), /sin guardar/);
  assert.equal(second.editor.document.getObject(bandId).position.x, 4);
  const copy = await second.editor.saveProject('Borrador conservado', true);
  assert.notEqual(copy.id, saved.id);
  assert(copy.document.rooms.hall.additions.some(object => object.id === local.userData.editorId));

  const link = await first.editor.shareProject();
  assert.equal(new URL(link).pathname, '/editor');
  assert.equal(new URL(link).searchParams.has('editor'), false);
  assert.equal(new URL(link).searchParams.get('project'), saved.id);
  assert.equal(new URL(link).searchParams.get('room'), 'hall');
  assert.equal(first.editor.shareLinkInput.value, link);
  assert.equal(first.editor.sharePanel.hidden, false);
  browserWindow.location = link;
  const explicit = harness(); await explicit.editor.ready;
  assert.equal(explicit.editor.currentProject.id, saved.id, 'A shared URL beats a different browser-local project.');
  assert.equal(explicit.editor.document.getObject(bandId).position.x, 5);

  // Tabs opened before the first save discover it later, while an unsaved
  // independent scene remains a draft rather than adopting another project.
  storage.clear(); remote.projects.clear(); browserWindow.location = 'https://editor.test/editor';
  const waiting = harness(); await waiting.editor.ready; await waiting.editor.projectSync.check();
  const draft = harness(); await draft.editor.ready; await draft.editor.projectSync.check();
  const ownObject = draft.editor.document.addPrimitive('hall', 'box');
  const producer = harness(); await producer.editor.ready; await producer.editor.projectSync.check();
  producer.editor.document.addPrefab('hall', 'conveyor');
  const shared = await producer.editor.saveProject('Primer proyecto del servidor');
  await waiting.editor.projectSync.check(); await draft.editor.projectSync.check();
  assert.equal(waiting.editor.currentProject.id, shared.id);
  assert.equal(draft.editor.currentProject, null);
  assert(draft.editor.document.getObject(ownObject.userData.editorId));
  assert.equal(draft.editor.dirty, true);
  [first, second, explicit, waiting, draft, producer].forEach(instance => instance.editor.projectSync.stop());
  browserWindow.location = 'https://editor.test/editor';
}

async function testPublicRoutes() {
  storage.clear(); remote.projects.clear(); remote.online = true;
  browserWindow.location = 'https://editor.test/editor';
  const author = harness(); await author.editor.ready;
  const band = author.editor.document.addPrefab('hall', 'conveyor');
  author.editor.document.setBehaviors(band, author.editor.document.getBehaviors(band).map(config =>
    config.type === 'conveyor' ? Object.assign({}, config, {powered: true, running: true, autoSpawn: true}) : config));
  const saved = await author.editor.saveProject('Escenario público');
  const bandId = band.userData.editorId;
  author.editor.document.setTransform(band, {position: [99, 99, 99]});
  const draft = JSON.stringify(await author.editor.document.serialize());
  storage.set('hello-webxr-editor-v1', draft);
  storage.set('hello-webxr-active-project', 'another-browser-local-project');
  const writesBefore = remote.writes.length;
  browserWindow.history = {replaceState(state, title, url) { browserWindow.location = url; }};

  // Legacy query flags cannot expose the editor on a public URL.
  for (const path of ['/', '/?editor&room=hall', '/other?editor']) {
    browserWindow.location = 'https://editor.test' + path;
    const {editor, ctx} = harness(); await editor.ready;
    assert.equal(editor.editorEnabled, false);
    assert.equal(editor.active, false);
    assert.equal(editor.assetThumbnails.attachments, 0, 'Public visitors never request browser thumbnails or extra WebGL contexts.');
    assert.equal(editor.currentProject.id, saved.id, 'Public visitors see the saved server scene, independent of local drafts.');
    assert.equal(editor.document.getObject(bandId).position.x, 0);
    assert.equal(editor.ui.parentNode, null);
    assert.equal(editor.launcher.parentNode, null);
    assert.equal(editor.sharePanel.parentNode, null);
    assert.equal(editor.simulationPanel.launcher.parentNode, null);
    assert.equal(editor.simulationPanel.panel.parentNode, null);
    assert.equal(new URL(browserWindow.location).searchParams.has('project'), false);
    assert.equal(new URL(browserWindow.location).searchParams.has('editor'), false);
    assert.equal(ctx.renderer.domElement.parentNode, dom.body);
    assert.equal(ctx.renderer.xr.enabled, true);
    assert.equal(ctx.raycontrol.enabled, true);
    assert.equal(editor.projectSync.running, false);
    editor.enter(); editor.simulationPanel.toggle(true);
    assert.equal(editor.active, false);
    assert.equal(editor.simulationPanel.opened, false);
    for (let index = 0; index < 10; index++) editor.execute(0.1, index / 10);
    const snapshot = editor.simulation.getSnapshot();
    assert(snapshot.objects.find(object => object.id === bandId).variables.actualSpeed > 0,
      'The public experience runs saved conveyor components.');
    const stop = editor.document.getObjects('hall').find(object => editor.document.getBehaviors(object).some(config =>
      config.type === 'control' && config.variable === 'running' && config.value === 0));
    assert(stop, 'The saved conveyor includes a physical stop control.');
    const controlState = Object.values(ctx.raycontrol.states).find(state => state.colliderMesh === stop);
    assert(controlState, 'Public visitors retain the 3D simulation control.');
    controlState.onSelectStart({object: stop, point: stop.position});
    assert.equal(editor.simulation.getSnapshot().objects.find(object => object.id === bandId).variables.running, false);
    ctx.vrMode = true; editor.onVRChange(true);
    ctx.vrMode = false; editor.onVRChange(false);
    assert.equal(editor.active, false);
    assert.equal(editor.launcher.hidden, true);
    assert.equal(editor.returnButton.hidden, true);
    assert.equal(editor.simulationPanel.launcher.hidden, true);
  }
  assert.equal(remote.writes.length, writesBefore, 'Public visits never save or modify server projects.');
  assert.equal(storage.get('hello-webxr-active-project'), 'another-browser-local-project');
  assert.equal(storage.get('hello-webxr-editor-v1'), draft, 'Public visits leave authoring backups intact.');

  // A bad explicit link must not silently display an unrelated latest project.
  browserWindow.location = 'https://editor.test/?editor&project=unknown&room=hall';
  const missing = harness(); await missing.editor.ready;
  assert.equal(missing.editor.currentProject, null);
  assert.equal(missing.editor.document.getObject(bandId), undefined);
  assert.equal(missing.editor.active, false);
  assert.equal(new URL(browserWindow.location).searchParams.get('project'), 'unknown');
  assert.equal(remote.writes.length, writesBefore);

  // Offline public visits also stay clean and do not expose a private draft.
  remote.online = false;
  browserWindow.location = 'https://editor.test/?editor&project=unknown';
  const offline = harness(); await offline.editor.ready;
  assert.equal(offline.editor.currentProject, null);
  assert.equal(offline.editor.document.getObject(bandId), undefined);
  assert.equal(offline.editor.active, false);
  assert.equal(new URL(browserWindow.location).searchParams.get('project'), 'unknown');
  assert.equal(offline.ctx.renderer.xr.enabled, true);
  author.editor.projectSync.stop(); remote.online = true;
  delete browserWindow.history;
  browserWindow.location = 'https://editor.test/editor';
}

async function testEditorNavigation() {
  storage.clear(); remote.projects.clear(); remote.online = true;
  const {editor, ctx, roots} = harness(); await editor.ready;
  const key = (code, options = {}) => {
    const event = Object.assign({code, target: dom.body, prevented: false,
      preventDefault() { this.prevented = true; }}, options);
    editor.onKey(event); return event;
  };
  const release = code => dom.fire('keyup', {code});
  const sameVector = (actual, expected, message) => assert(actual.distanceTo(expected) < 1e-10, message);
  const position = () => editor.camera.position.clone();
  const nativePosition = ctx.camera.position.clone();
  editor.camera.position.set(0, 2, 5); editor.orbit.target.set(0, 2, 0);
  editor.camera.lookAt(editor.orbit.target);
  editor.select(roots.hall.children[0]);
  const documentBefore = await editor.document.serialize();

  editor.setTool('rotate');
  const before = position(), target = editor.orbit.target.clone();
  assert(key('KeyW').prevented);
  editor.render(0.1);
  sameVector(position().sub(before), new THREE.Vector3(0, 0, -0.3), 'W flies forward using the editor frame delta.');
  sameVector(editor.orbit.target.clone().sub(target), new THREE.Vector3(0, 0, -0.3), 'The orbit center moves with the camera.');
  assert.equal(editor.toolMode, 'rotate', 'W is navigation, even when another gizmo is selected.');
  await release('KeyW');
  const stopped = position(); editor.render(0.1); sameVector(position(), stopped, 'Keyup stops navigation.');
  key('KeyS'); editor.render(0.1); await release('KeyS'); sameVector(position(), before, 'S reverses W.');
  key('KeyA'); editor.render(0.1); await release('KeyA');
  sameVector(position(), before.clone().add(new THREE.Vector3(-0.3, 0, 0)), 'A strafes left.');
  key('KeyD'); editor.render(0.1); await release('KeyD'); sameVector(position(), before, 'D strafes right.');
  key('KeyW'); key('KeyD'); editor.render(0.1); editor.clearNavigation();
  assert(Math.abs(position().distanceTo(before) - 0.3) < 1e-10, 'Diagonal flight has the same speed.');
  key('KeyW'); key('KeyS'); const opposed = position(); editor.render(0.1);
  sameVector(position(), opposed, 'Opposite directions cancel.'); editor.clearNavigation();

  editor.orbit.target.copy(position()).add(new THREE.Vector3(1, 1, 0)); editor.camera.lookAt(editor.orbit.target);
  const tilted = position(); key('KeyW'); editor.render(0.1); await release('KeyW');
  sameVector(position().sub(tilted), new THREE.Vector3(1, 1, 0).normalize().multiplyScalar(0.3), 'Flight follows yaw and pitch to navigate in 3D.');
  const verticalStart = position(), verticalTarget = editor.orbit.target.clone();
  assert(key('KeyQ').prevented); editor.render(0.1); await release('KeyQ');
  sameVector(position(), verticalStart.clone().add(new THREE.Vector3(0, 0.3, 0)), 'Q rises along world Y even when the camera is tilted.');
  sameVector(editor.orbit.target, verticalTarget.clone().add(new THREE.Vector3(0, 0.3, 0)), 'Vertical movement preserves the camera orientation.');
  assert(key('KeyE').prevented); editor.render(0.1); await release('KeyE');
  sameVector(position(), verticalStart, 'E lowers the editor camera.');
  assert.equal(editor.toolMode, 'rotate', 'Q/E navigate without changing the active gizmo.');
  key('KeyQ'); key('KeyE'); editor.render(0.1); editor.clearNavigation();
  sameVector(position(), verticalStart, 'Simultaneous Q/E cancel each other.');
  key('KeyW'); key('KeyQ'); editor.render(0.1); editor.clearNavigation();
  assert(Math.abs(position().distanceTo(verticalStart) - 0.3) < 1e-10, 'Combining vertical and forward navigation keeps the configured speed.');
  const pause = position(); key('KeyW'); editor.render(9); await release('KeyW');
  assert(Math.abs(position().distanceTo(pause) - 0.3) < 1e-10, 'A paused frame cannot cause a large jump.');
  sameVector(ctx.camera.position, nativePosition, 'Editor navigation never moves the native visitor/VR camera.');
  assert.equal(ctx.renderer.xr.enabled, true);
  assert.equal(editor.dirty, false);
  assert.deepStrictEqual(await editor.document.serialize(), documentBefore, 'Navigating does not change authored objects.');

  editor.setTool('translate');
  for (const mode of ['rotate', 'scale', 'translate']) {
    assert(key('Space').prevented); assert.equal(editor.toolMode, mode);
    assert.equal(editor.transform.mode, mode);
    assert.equal(editor.toolButtons[mode].classList.contains('active'), true);
    key('Space', {repeat: true}); assert.equal(editor.toolMode, mode, 'Holding Space advances only once per press.');
  }
  await editor.toolButtons.scale.click(); key('Space', {target: editor.toolButtons.scale});
  assert.equal(editor.toolMode, 'translate', 'Space cycles from the tool selected with the mouse.');
  key('KeyE'); key('KeyR'); assert.equal(editor.toolMode, 'translate', 'Old E/R tool shortcuts are removed.'); await release('KeyE');

  const assertPaused = (message) => {
    const start = position(); editor.render(0.1);
    sameVector(position(), start, message); assert.equal(editor.navigationKeys.size, 0);
  };
  key('KeyW'); dom.activeElement = editor.treeSearch; await dom.fire('focusin', {target: editor.treeSearch});
  assertPaused('Focusing a text field stops flight.');
  assert.equal(key('Space', {target: editor.treeSearch}).prevented, false);
  assert.equal(key('KeyW', {target: editor.treeSearch}).prevented, false);
  assert.equal(key('KeyQ', {target: editor.treeSearch}).prevented, false);
  assert.equal(key('KeyE', {target: editor.treeSearch}).prevented, false);
  assert.equal(editor.toolMode, 'translate'); dom.activeElement = dom.body;
  const editable = new Element('div'); editable.isContentEditable = true;
  key('KeyW', {target: editable}); assertPaused('Contenteditable text does not navigate.');
  key('KeyW'); await editor.projectLibrary.open(); assertPaused('Opening a project dialog stops flight.');
  key('Space'); assert.equal(editor.toolMode, 'translate'); editor.projectLibrary.close();
  key('KeyW'); editor.simulationPanel.toggle(true); assertPaused('The operator panel owns its keyboard.'); editor.simulationPanel.toggle(false);
  key('KeyW'); editor.sharePanel.hidden = false; assertPaused('The sharing dialog pauses navigation.'); editor.sharePanel.hidden = true;
  key('KeyW'); editor.loadingProject = true; assertPaused('Project loading stops flight.'); editor.loadingProject = false;
  key('KeyW'); editor.transform.dragging = true; key('Space'); assertPaused('Dragging a gizmo stops flight.');
  assert.equal(editor.toolMode, 'translate'); editor.transform.dragging = false;
  key('KeyW'); await browserWindow.fire('blur'); assertPaused('Changing windows releases held keys.');
  key('KeyW'); dom.visibilityState = 'hidden'; await dom.fire('visibilitychange');
  dom.visibilityState = 'visible'; assertPaused('Changing tabs releases held keys.');

  let saves = 0; const save = editor.saveProject;
  editor.saveProject = async () => { saves++; };
  key('KeyW'); assert(key('KeyS', {ctrlKey: true}).prevented);
  for (let index = 0; index < 8; index++) await Promise.resolve();
  assert.equal(saves, 1); assertPaused('Ctrl+S saves without moving backward.'); editor.saveProject = save;
  key('KeyD', {altKey: true}); assertPaused('Browser modifier shortcuts do not start movement.');
  key('KeyW'); editor.leave(); assertPaused('Preview mode releases editor keys.');
  key('KeyW'); key('Space'); assert.equal(editor.navigationKeys.size, 0); assert.equal(editor.toolMode, 'translate');
  editor.enter(); key('KeyW'); ctx.vrMode = true; editor.onVRChange(true);
  assertPaused('VR mode releases editor keys.'); assert.equal(ctx.renderer.xr.enabled, true);
  ctx.vrMode = false; editor.onVRChange(false); editor.enter(); assertPaused('Returning to edit never resumes held keys.');
  editor.projectSync.stop();
}

async function testCameraCollisionIntegration() {
  storage.clear(); remote.projects.clear(); remote.online = true;
  const {editor, ctx, hooks} = harness(); await editor.ready;
  assert.strictEqual(ctx.collisionWorld, editor.collisionWorld);
  assert.equal(editor.collisionWorld.roomId, 'hall');
  editor.camera.position.set(0, 1, 2); editor.orbit.target.set(1, 1, 2);
  editor.render();
  editor.collisionWorld.sphereResolver = (start, desired) => new THREE.Vector3(Math.min(0.1, desired.x), Math.max(0.18, desired.y), desired.z);
  const target = editor.orbit.target.clone();
  editor.navigationKeys.add('KeyW'); editor.render(0.1); editor.clearNavigation();
  assert(Math.abs(editor.camera.position.x - 0.1) < 1e-10, 'WASD accepts only the collision solver movement.');
  assert(editor.orbit.target.distanceTo(target.clone().add(new THREE.Vector3(0.1, 0, 0))) < 1e-10,
    'The orbit center follows the permitted movement rather than the requested movement.');
  const accepted = editor.camera.position.clone(), acceptedTarget = editor.orbit.target.clone();
  // OrbitControls mutates the camera immediately during wheel/pointer events.
  editor.camera.position.x = 4;
  editor.render();
  const wheelMove = editor.collisionWorld.moves.at(-1);
  assert(wheelMove.start.equals(accepted), 'Wheel/orbit sweeps begin at the last accepted frame, before the input event.');
  assert(editor.camera.position.equals(accepted), 'Zoom cannot skip through a wall between animation frames.');
  assert(editor.orbit.target.equals(acceptedTarget));
  editor.camera.position.x += 3; editor.orbit.target.x += 3;
  editor.render();
  assert(editor.camera.position.equals(accepted));
  assert(editor.orbit.target.distanceTo(acceptedTarget) < 1e-10, 'A rejected pan also corrects its orbit target.');
  editor.camera.position.y = -4; editor.render();
  assert.equal(editor.camera.position.y, 0.18, 'Orbit/pan also respect the floor clearance.');
  editor.navigationKeys.add('KeyE'); editor.render(0.1); editor.clearNavigation();
  assert.equal(editor.camera.position.y, 0.18, 'E cannot lower the camera through the floor.');
  editor.collisionWorld.sphereResolver = (start, desired) => new THREE.Vector3(desired.x, Math.min(0.3, desired.y), desired.z);
  editor.navigationKeys.add('KeyQ'); editor.render(0.1); editor.clearNavigation();
  assert.equal(editor.camera.position.y, 0.3, 'Q accepts only the upward movement allowed by collisions.');
  await hooks.gotoRoom(2);
  assert.equal(editor.collisionWorld.roomId, 'photogrammetry', 'Changing rooms switches the collision geometry.');
  editor.projectSync.stop();
}

function testVisitorCollisionIntegration() {
  const source = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');
  const extract = name => {
    const match = source.match(new RegExp('function ' + name + '\\([^]*?\\n\\}'));
    assert(match, 'Production movement function is available: ' + name); return match[0];
  };
  const scene = new THREE.Scene(), rig = new THREE.Group(), camera = new THREE.PerspectiveCamera();
  rig.position.set(3, 0, 2); camera.position.set(0, 1.6, 0); rig.add(camera); scene.add(rig);
  let resolver = (start, desired) => desired.clone();
  const movements = [], xrPose = {matrixWorld: new THREE.Matrix4()};
  const ctx = {vrMode: false, cameraRig: rig, collisionWorld: {
    moveCapsule(start, desired, options) {
      movements.push({start: start.clone(), desired: desired.clone(), options}); return resolver(start, desired);
    }
  }};
  const controls = {moveForward: distance => { camera.position.z -= distance; }, moveRight: distance => { camera.position.x += distance; }};
  const renderer = {xr: {getCamera: () => xrPose}};
  const factory = new Function('THREE', 'context', 'camera', 'controls', 'renderer',
    'const keyboardMoveSpeed = 3; const keyboardState = {}; let lastVRCollisionPosition = null;\n' +
    ['resetCollisionPose', 'updateKeyboardMovement', 'constrainVRCamera'].map(extract).join('\n') +
    '\nreturn {keyboardState, updateKeyboardMovement, constrainVRCamera, resetCollisionPose};');
  const input = factory(THREE, ctx, camera, controls, renderer);
  const initialCamera = camera.position.clone(), initialRotation = camera.quaternion.clone();
  scene.updateMatrixWorld(true);
  const initialEye = camera.getWorldPosition(new THREE.Vector3());
  resolver = start => start.clone().add(new THREE.Vector3(0.05, 0, 0));
  input.keyboardState.KeyW = true; input.updateKeyboardMovement(0.1);
  const walking = movements.at(-1);
  assert(walking.start.equals(initialEye));
  assert(walking.desired.distanceTo(initialEye.clone().add(new THREE.Vector3(0, 0, -0.3))) < 1e-10);
  assert(camera.getWorldPosition(new THREE.Vector3()).distanceTo(initialEye.clone().add(new THREE.Vector3(0.05, 0, 0))) < 1e-10,
    'The public visitor uses capsule collision coordinates, including the rig offset.');
  assert.deepStrictEqual(walking.options, {radius: 0.25, height: 1.6, eyeHeight: 1.6});
  delete input.keyboardState.KeyW;
  const stationaryCount = movements.length; input.updateKeyboardMovement(0);
  assert.equal(movements.length, stationaryCount + 1, 'A moving obstacle can resolve a stationary visitor too.');

  ctx.vrMode = true;
  const localPose = camera.position.clone(), rigBefore = rig.position.clone();
  xrPose.matrixWorld.makeTranslation(3, 1.6, 2);
  resolver = start => start.clone();
  input.constrainVRCamera();
  xrPose.matrixWorld.makeTranslation(3.6, 1.6, 2);
  input.constrainVRCamera();
  assert(Math.abs(rig.position.x - (rigBefore.x - 0.6)) < 1e-10, 'Room-scale collisions adjust only the rig by the rejected head displacement.');
  assert(camera.position.equals(localPose), 'Room-scale collision never writes the headset local position.');
  assert(camera.quaternion.equals(initialRotation), 'Room-scale collision never writes the headset orientation.');
  input.resetCollisionPose(); xrPose.matrixWorld.makeTranslation(10, 0.8, 2); input.constrainVRCamera();
  const resetMove = movements.at(-1);
  assert(resetMove.start.equals(resetMove.desired), 'A teleport/room transition starts a fresh VR collision pose.');
  assert.equal(resetMove.options.height, 0.8, 'Crouching uses the tracked eye height instead of forcing a standing pose.');
  assert(initialCamera.y === 1.6);
}

function testTeleportCollisionIntegration() {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/Teleport.js'), 'utf8').replace(/^import .*;\r?\n/gm, '')
    .replace(/export default class Teleport/, 'return class Teleport');
  class Audio extends THREE.Group {
    setBuffer() {} setLoop() {} pause() { this.pauses = (this.pauses || 0) + 1; }
    play() { this.plays = (this.plays || 0) + 1; }
  }
  const Teleport = new Function('THREE', 'rayMaterial', source)(Object.assign({}, THREE, {Audio}), new THREE.MeshBasicMaterial());
  const scene = new THREE.Scene(), cameraRig = new THREE.Group(), camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1.6, 0); cameraRig.add(camera); scene.add(cameraRig);
  const model = new THREE.Group();
  for (const name of ['goal', 'glow']) { const mesh = new THREE.Mesh(new THREE.BoxBufferGeometry(), new THREE.MeshBasicMaterial()); mesh.name = name; model.add(mesh); }
  let resets = 0; const checks = [];
  const ctx = {scene, cameraRig, camera, assets: {teleport_model: {scene: model}, glow_tex: new THREE.Texture()},
    resetCollisionPose: () => resets++, collisionWorld: {
      canOccupyCapsule(eye, options) { checks.push({eye: eye.clone(), options}); return eye.x !== 3; },
      moveCapsule() { throw new Error('Teleport checks destination occupancy rather than sweeping across its route.'); }
    }};
  const teleport = new Teleport(ctx);
  teleport.onSelectStart(); teleport.onHover(new THREE.Vector3(3, 0, 0), true);
  assert.equal(teleport.teleportHitGeometry.visible, false, 'An occupied destination never shows a valid teleport marker.');
  assert.equal(teleport.ballColliding.material.color.getHex(), 0xb52222);
  const initialRig = cameraRig.position.clone(), initialCamera = camera.position.clone();
  assert.equal(teleport.onSelectEnd(new THREE.Vector3(3, 0, 0)), false);
  assert(cameraRig.position.equals(initialRig)); assert.equal(resets, 0); assert(!teleport.endSound.plays);
  teleport.onHover(new THREE.Vector3(5, 0, 0), true);
  assert.equal(teleport.teleportHitGeometry.visible, true);
  assert.equal(teleport.onSelectEnd(new THREE.Vector3(5, 0, 0)), true);
  assert.equal(cameraRig.position.x, 5); assert(camera.position.equals(initialCamera)); assert.equal(resets, 1);
  ctx.vrMode = true;
  ctx.renderer = {xr: {getCamera: () => ({matrixWorld: new THREE.Matrix4().makeTranslation(5, 0.8, 0)})}};
  teleport.onSelectEnd(new THREE.Vector3(7, 0, 0));
  assert.equal(cameraRig.position.x, 7, 'VR teleport uses the current tracked head rather than a stale desktop pose.');
  assert(camera.position.equals(initialCamera)); assert.equal(checks.at(-1).options.eyeHeight, 0.8);
}

async function testObjectClipboard() {
  storage.clear(); remote.projects.clear(); remote.online = true;
  const {editor, ctx, hooks} = harness(); await editor.ready;
  const key = (code, options = {}) => {
    const event = Object.assign({code, ctrlKey: true, target: dom.body, prevented: false,
      preventDefault() { this.prevented = true; }}, options);
    editor.onKey(event); return event;
  };
  const settle = async () => { for (let index = 0; index < 40; index++) await Promise.resolve(); };
  const importRecord = {id: 'clipboard-model', importId: 'clipboard-model', path: 'clipboard.glb', name: 'clipboard.glb',
    kind: 'model', extension: 'glb', size: 4, mime: 'model/gltf-binary', batchId: 'clipboard-batch', dataUrl: 'data:model/gltf-binary;base64,dGVzdA=='};
  editor.library.restoreImports([importRecord]);
  const source = await editor.document.addAsset('hall', {importId: importRecord.id});
  const sourceId = source.userData.editorId;
  editor.document.rename(source, 'Modelo personalizado');
  editor.document.setTransform(source, {position: [2, 3, 4], rotation: [0.2, 0.4, 0.6], scale: [2, 3, 4]});
  editor.document.setProperty(source, 'color', '#12ab34');
  editor.document.setInteraction(source, {type: 'toggle', targetId: sourceId});
  editor.document.setBehaviors(source, [{type: 'float', enabled: true, amplitude: 0.7, speed: 1.3},
    Object.assign(behaviorSchema.defaultBehavior('control'), {targetId: sourceId})]);
  await editor.document.replaceAsset(source, {path: 'hall.glb'});
  editor.select(source);
  const authored = editor.document._state(source);
  const historyLength = editor.document.undoStack.length, version = editor.changeVersion;
  assert(key('KeyC').prevented); await settle();
  assert(editor.objectClipboard);
  assert.equal(editor.document.undoStack.length, historyLength, 'Copying does not create an edit.');
  assert.equal(editor.changeVersion, version);
  assert.equal(key('KeyC', {target: editor.treeSearch}).prevented, false, 'Copying text retains the browser shortcut.');
  assert.equal(key('KeyV', {target: editor.treeSearch}).prevented, false, 'Pasting text retains the browser shortcut.');

  // Clipboard data belongs to copy time, independent of the source or selection.
  editor.document.setTransform(source, {position: [90, 90, 90]});
  editor.document.setBehaviors(source, []);
  editor.document.remove(source); editor.select(null);
  assert(key('KeyV').prevented); await settle();
  const first = editor.selected;
  assert(first && first.userData.editorId !== sourceId);
  assert.equal(first.name, 'Modelo personalizado copia');
  assert.deepStrictEqual(first.position.toArray(), [2.5, 3, 4]);
  assert.deepStrictEqual(first.scale.toArray(), authored.scale);
  assert(first.quaternion.angleTo(new THREE.Quaternion().fromArray(authored.quaternion)) < 1e-7);
  assert.equal(first.userData.editorColor, '#12ab34');
  assert.deepStrictEqual(editor.document.getVisualDescriptor(first), {path: 'hall.glb'});
  assert.deepStrictEqual(editor.document.getBehaviors(first).find(component => component.type === 'float'), authored.behaviors[0]);
  assert.equal(editor.document.getBehaviors(first).find(component => component.type === 'control').targetId, first.userData.editorId);
  assert.equal(first.userData.editorInteraction.targetId, first.userData.editorId);
  assert.equal(editor.document.additions.get(first.userData.editorId).descriptor.importId, importRecord.id);
  assert.equal(editor.library.exportImports().length, 1, 'Instances share their asset reference without duplicating imported bytes.');
  const firstId = first.userData.editorId;
  editor.document.undo(); assert.equal(editor.document.getObject(firstId), undefined);
  editor.document.redo(); assert(editor.document.getObject(firstId), 'A paste is one reversible edit.');
  assert(key('KeyV').prevented); await settle();
  const second = editor.selected;
  assert.notEqual(second.userData.editorId, firstId);
  assert.deepStrictEqual(second.position.toArray(), [3, 3, 4]);
  assert.equal(editor.document.getBehaviors(second).find(component => component.type === 'control').targetId, second.userData.editorId);
  assert(key('KeyV', {repeat: true}).prevented); await settle();
  assert.strictEqual(editor.selected, second, 'Holding paste does not flood the scene with objects.');
  await hooks.gotoRoom(1); key('KeyV'); await settle();
  assert.equal(editor.selected.userData.editorRoom, 'sound', 'Paste targets the active room.');
  assert.deepStrictEqual(editor.selected.scale.toArray(), authored.scale);
  const saved = await editor.saveProject('Copias completas');
  const reopened = harness(); await reopened.editor.ready;
  assert.deepStrictEqual(await reopened.editor.document.serialize(), saved.document, 'Copied imports, visuals and properties survive saving/reopening.');
  assert.equal(reopened.ctx.renderer.xr.enabled, true);

  // Async model loading cannot switch projects underneath a paste.
  let finish; const instantiate = editor.library.instantiate.bind(editor.library);
  editor.library.instantiate = async descriptor => {
    await new Promise(resolve => { finish = resolve; }); return instantiate(descriptor);
  };
  const pending = editor.perform(() => editor.pasteObject());
  await settle(); assert.equal(editor.pastingObject, true);
  await assert.rejects(() => editor.createServerProject('Durante pegado'), /Espera/);
  await assert.rejects(() => editor.openServerProject(saved), /Espera/);
  // Restore the loader before releasing its first request (the replacement is a second asset).
  editor.library.instantiate = instantiate; finish(); await pending;
  assert.equal(editor.pastingObject, false);
  assert.equal(editor.transform.enabled, true);
  const beforeFailure = editor.document.additions.size, pasteCount = editor.objectPasteCount;
  editor.library.instantiate = async () => { throw new Error('Modelo no disponible'); };
  await editor.perform(() => editor.pasteObject());
  assert.equal(editor.document.additions.size, beforeFailure, 'A failed model load never creates a partial copy.');
  assert.equal(editor.objectPasteCount, pasteCount);
  assert.equal(editor.pastingObject, false);
  assert.equal(editor.transform.enabled, true);
  editor.library.instantiate = instantiate;
  editor.leave(); key('KeyV'); await settle();
  assert.equal(editor.document.additions.size, beforeFailure, 'Preview mode keeps the native keyboard behavior.');
  editor.enter(); await editor.applyServerProject(saved);
  assert.equal(editor.objectClipboard, null, 'Opening a project clears the project-local object clipboard.');
  assert.equal(key('KeyV').prevented, false);
  assert.equal(ctx.renderer.xr.enabled, true);
  editor.projectSync.stop(); reopened.editor.projectSync.stop();
}

async function testModularConveyorAuthoring() {
  storage.clear(); remote.projects.clear(); remote.online = true;
  const {editor} = harness(); await editor.ready; editor.enter();
  const all = root => [root].concat(root.children.flatMap(child => all(child)));
  const labelled = (root, label) => all(root).find(node => node.getAttribute('aria-label') === label);
  const press = (root, label) => all(root).find(node => node.tagName === 'BUTTON' && node.textContent === label).click();
  const layout = behaviorSchema.conveyorLayout;
  const cfg = object => editor.conveyorConfig(object);
  const point = (object, port) => { object.updateWorldMatrix(true, true); const value = layout.ports(cfg(object))[port]; return object.localToWorld(new THREE.Vector3(value.x, 0, value.z)); };
  const assertJoined = (from, to, output = 'output', input = 'input') => {
    assert(point(from, output).distanceTo(point(to, input)) < 1e-6, 'The authoring tool physically aligns the selected ports.');
    const a = layout.ports(cfg(from))[output], b = layout.ports(cfg(to))[input];
    const direction = (object, port) => new THREE.Vector3(port.tx, 0, port.tz).transformDirection(object.matrixWorld);
    assert(direction(from, a).dot(direction(to, b)) > 0.99999);
  };
  const catalog = labelled(editor.hierarchy, 'Equipo preestablecido');
  assert(behaviorSchema.conveyorLayout.presetVariants.every(value => catalog.children.some(option => option.value === value)));
  catalog.value = 'belt-start'; await press(editor.hierarchy, '+ Equipo');
  const first = editor.selected;
  assert.equal(cfg(first).surface, 'belt'); assert.equal(cfg(first).role, 'start');
  const firstEntry = editor.document.additions.get(first.userData.editorId);
  assert(Array.from(firstEntry.nodes.values()).filter(node => editor.document.getBehaviors(node).some(component => component.type === 'control')).every(node => editor.document.getBehaviors(node).find(component => component.type === 'control').scope === 'segment'));
  labelled(editor.inspector, 'Salida principal · nuevo tramo').value = 'roller-curve-left';
  await press(editor.inspector, 'Añadir tramo conectado');
  const curve = editor.selected;
  assert.equal(cfg(first).outputId, curve.userData.editorId); assertJoined(first, curve);
  assert.equal(cfg(curve).layout, 'curveLeft'); assert.equal(cfg(curve).withPanel, false);
  labelled(editor.inspector, 'Salida principal · nuevo tramo').value = 'belt-end';
  await press(editor.inspector, 'Añadir tramo conectado');
  const end = editor.selected; assertJoined(curve, end);
  assert(!cfg(end).withPallet && !cfg(end).withPanel && cfg(end).powered);
  editor.select(curve);
  const original = await editor.document.serialize();
  const previousPosition = first.position.clone(), endPosition = end.position.clone();
  const radius = labelled(editor.inspector, 'Banda transportadora simulada · Radio de curva (m)');
  radius.value = '2.2'; await radius.fire('change');
  assert.equal(cfg(curve).radius, 2.2);
  assertJoined(first, curve); assertJoined(curve, end);
  assert(first.position.equals(previousPosition), 'The preceding machine remains fixed while the edited curve is refitted.');
  assert(end.position.distanceTo(endPosition) > .1, 'The following machine follows the new real curve outlet automatically.');
  await editor.perform(() => editor.historyStep('undo'));
  assert.deepEqual(await editor.document.serialize(), original, 'Undo restores the full configuration, anchors and ports.');
  assertJoined(first, curve); assertJoined(curve, end);
  editor.select(curve);
  let sensors = labelled(editor.inspector, 'Banda transportadora simulada · Incluir sensores');
  sensors.checked = true; await sensors.fire('change');
  const sensor = editor.document.additions.get(curve.userData.editorId).nodes.get('4');
  assert(sensor.visible); const identity = sensor.userData.editorId;
  sensors = labelled(editor.inspector, 'Banda transportadora simulada · Incluir sensores'); sensors.checked = false; await sensors.fire('change');
  assert.equal(sensor.visible, false); assert.equal(sensor.userData.editorId, identity);
  // Connect a second feed to a T merge without moving the already placed junction.
  const merge = editor.document.addPrefab('hall', 'conveyor', 'roller-tee-merge');
  editor.document.setTransform(merge, {position: [20, 1, 0], rotation: [0, 0.7, 0]});
  const feed = editor.document.addPrefab('hall', 'conveyor', 'belt-start');
  editor.updateConveyor(feed, {outputId: merge.userData.editorId, outputPort: 'branch'});
  const junctionPosition = merge.position.clone();
  editor.alignConveyorPorts(merge, 'branch', feed, 'output'); assertJoined(feed, merge, 'output', 'branch');
  assert(merge.position.equals(junctionPosition));
  const saved = await editor.saveProject('Línea modular');
  const reloaded = harness(); await reloaded.editor.ready;
  assert.equal(reloaded.editor.currentProject.id, saved.id);
  const loaded = reloaded.editor.document;
  assert.equal(loaded.getBehaviors(loaded.getObject(first.userData.editorId)).find(component => component.type === 'conveyor').outputId, curve.userData.editorId);
  assert.equal(loaded.getBehaviors(loaded.getObject(feed.userData.editorId)).find(component => component.type === 'conveyor').outputPort, 'branch');
  assert.equal(loaded.additions.get(curve.userData.editorId).nodes.get('4').visible, false);
  const rounded = value => JSON.parse(JSON.stringify(value, (key, item) => typeof item === 'number' ? Number(item.toFixed(10)) : item));
  assert.deepEqual(rounded(await loaded.serialize()), rounded(await editor.document.serialize()), 'Catalog variants, paths, links and optional components survive saving and a fresh editor, within quaternion normalization precision.');
  editor.projectSync.stop(); reloaded.editor.projectSync.stop();
}

async function testTypedConveyorInspector() {
  storage.clear(); remote.projects.clear(); remote.online = true;
  const {editor} = harness(); await editor.ready; editor.enter();
  const all = root => [root].concat(root.children.flatMap(child => all(child)));
  const labelled = label => all(editor.inspector).find(node => node.getAttribute('aria-label') === label);
  const object = editor.document.addPrefab('hall', 'conveyor', 'roller-start'); editor.select(object);
  const original = JSON.stringify(editor.document.getBehaviors(object));
  assert.equal(labelled('Equipo · Variante del catálogo').value, '', 'Inspecting a legacy conveyor does not silently adopt a new equipment definition.');
  assert.equal(JSON.stringify(editor.document.getBehaviors(object)), original);
  let variant = labelled('Equipo · Variante del catálogo'); variant.value = 'conveyor.roller-curve'; await variant.fire('change');
  assert.equal(editor.conveyorConfig(object).equipmentId, 'conveyor.roller-curve');
  assert.equal(editor.conveyorConfig(object).equipmentVersion, 1);
  assert.equal(labelled('Banda transportadora simulada · Radio del eje (m)').min, .4, 'Editable bounds use the same definition as the catalogue.');
  const direction = labelled('Banda transportadora simulada · Sentido');
  assert.deepEqual(direction.children.map(option => option.value), ['curveLeft', 'curveRight'], 'A curved variant changes direction without becoming an unrelated mechanism.');
  assert.equal(labelled('Banda transportadora simulada · Superficie'), undefined);
  variant = labelled('Equipo · Variante del catálogo'); variant.value = 'conveyor.roller-gravity'; await variant.fire('change');
  assert.equal(editor.conveyorConfig(object).withPanel, false);
  assert.equal(editor.conveyorConfig(object).drive, 'gravity');
  assert.equal(labelled('Banda transportadora simulada · Consigna (m/s)'), undefined, 'Gravity has no hidden motor-speed control.');
  variant = labelled('Equipo · Variante del catálogo'); variant.value = 'conveyor.pallet-chain'; await variant.fire('change');
  const product = labelled('Equipo · Producto para comprobar compatibilidad'); product.value = 'box-small'; await product.fire('change');
  assert(all(editor.inspector).some(node => node.textContent.startsWith('No compatible:') && node.textContent.includes('pallet')));
  const design = await editor.document.serialize();
  await editor.saveProject('Variantes verificadas');
  const reopened = harness(); await reopened.editor.ready;
  assert.deepEqual(await reopened.editor.document.serialize(), design, 'The inspector saves identity, version and configured mechanism through the existing document.');
  editor.projectSync.stop(); reopened.editor.projectSync.stop();
}

async function testIndustrialPanelBindings() {
  storage.clear(); remote.projects.clear(); remote.online = true;
  const {editor, ctx} = harness(); await editor.ready; editor.enter();
  const all = root => [root].concat(root.children.flatMap(child => all(child)));
  const labelled = label => all(editor.inspector).find(element => element.getAttribute('aria-label') === label);
  const first = editor.document.addPrefab('hall', 'conveyor');
  const second = editor.document.addPrefab('hall', 'conveyor');
  editor.document.setTransform(second, {position: [10, 1, -2]});
  const panel = editor.document.addPrefab('hall', 'plc');
  const controls = [];
  panel.traverse(node => { if (editor.document.getBehaviors(node).some(config => config.type === 'control')) controls.push(node); });
  const targetOf = node => editor.document.getBehaviors(node).find(config => config.type === 'control').targetId;
  const firstId = first.userData.editorId, secondId = second.userData.editorId;
  assert.notEqual(firstId, secondId);
  const belongsTo = (object, parent) => { for (let node = object; node; node = node.parent) if (node === parent) return true; return false; };
  const displayOf = owner => Array.from(editor.industrialVisuals.displays.values()).find(entry => belongsTo(entry.object, owner));
  let embeddedPanel;
  first.traverse(node => { if (node.userData.editorPrefabKey === 'plc') embeddedPanel = node; });
  editor.select(embeddedPanel);
  let embeddedSelector = labelled('Banda de este panel'); embeddedSelector.value = secondId; await embeddedSelector.fire('change');
  editor.render(0.25);
  assert.equal(displayOf(embeddedPanel).conveyor.id, secondId, 'An explicitly rebound embedded dashboard follows the same machine as its controls.');
  embeddedSelector = labelled('Banda de este panel'); embeddedSelector.value = ''; await embeddedSelector.fire('change');
  editor.render(0.25);
  assert(!displayOf(embeddedPanel).conveyor, 'Disconnecting an embedded panel must not silently fall back to its parent conveyor.');
  embeddedSelector = labelled('Banda de este panel'); embeddedSelector.value = firstId; await embeddedSelector.fire('change');
  editor.select(panel); assert.equal(labelled('Banda de este panel').value, '');
  const history = editor.document.undoStack.length;
  let selector = labelled('Banda de este panel'); selector.value = secondId; await selector.fire('change');
  assert(controls.every(node => targetOf(node) === secondId));
  assert.equal(editor.document.undoStack.length, history + 1, 'Binding all controls is one undoable edit.');
  await editor.perform(() => editor.historyStep('undo'));
  assert(controls.every(node => targetOf(node) === panel.userData.editorId));
  await editor.perform(() => editor.historyStep('redo'));
  assert(controls.every(node => targetOf(node) === secondId));
  editor.select(panel); selector = labelled('Banda de este panel'); assert.equal(selector.value, secondId);
  const authored = await editor.document.serialize();
  const savedPanel = authored.rooms.hall.additions.find(record => record.id === panel.userData.editorId);
  assert(Object.values(savedPanel.nodes).every(record => record.behaviors.find(config => config.type === 'control').targetId === secondId));
  editor.leave();
  editor.simulation.command(firstId, 'powerOn'); editor.simulation.command(firstId, 'start');
  editor.simulation.command(secondId, 'powerOn'); editor.simulation.command(secondId, 'start');
  editor.simulation.setVariable(secondId, 'speed', 0.8); editor.simulation.insertProduct(secondId);
  editor.execute(0.2, 0.2);
  const vars = id => editor.simulation.getSnapshot().objects.find(record => record.id === id).variables;
  assert.equal(vars(firstId).entryCount, 0); assert.equal(vars(secondId).entryCount, 1);
  assert.equal(vars(firstId).speed, 0.4); assert.equal(vars(secondId).speed, 0.8);
  const stop = controls.find(node => node.userData.editorPrefabVariant === 'stop');
  const state = Object.values(ctx.raycontrol.states).find(entry => entry.colliderMesh === stop);
  state.onSelectStart({object: stop});
  assert.equal(vars(secondId).running, false); assert.equal(vars(firstId).running, true, 'A separately bound panel stops only its selected machine.');
  editor.simulation.setVariable(firstId, 'speed', 0.65);
  editor.simulationPanel.render(true); editor.simulationPanel.objectSelect.value = firstId; editor.simulationPanel.render(true);
  const firstEvents = editor.simulationPanel.events.children.map(element => element.textContent).join('\n');
  assert(firstEvents.includes('speed = 0.65'));
  assert(!firstEvents.includes('speed = 0.8'), 'The selected machine monitor must not mix another conveyor\'s events.');
  assert(editor.simulationPanel.objectSelect.children.some(option => option.value === secondId && option.textContent.includes(secondId)), 'Identically named machines remain distinguishable in the monitor.');
  editor.enter(); assert.deepStrictEqual(await editor.document.serialize(), authored);
  editor.select(panel); selector = labelled('Banda de este panel'); selector.value = ''; await selector.fire('change');
  editor.render(0.25);
  const display = displayOf(panel);
  assert(display && !display.conveyor, 'Disconnecting a panel leaves its dashboard unlinked instead of borrowing another machine.');
  editor.projectSync.stop();
}

async function testSimulationPanel() {
  storage.clear(); remote.projects.clear(); remote.online = true;
  const {editor, ctx} = harness(); await editor.ready; editor.enter();
  const all = root => [root].concat(root.children.flatMap(child => all(child)));
  const control = (root, text) => all(root).find(element => element.tagName === 'BUTTON' && element.textContent === text);
  const labelled = (root, label) => all(root).find(element => element.getAttribute('aria-label') === label);
  const prefab = labelled(editor.hierarchy, 'Equipo preestablecido');
  prefab.value = 'conveyor'; await control(editor.hierarchy, '+ Equipo').click();
  const belt = editor.selected, beltId = belt.userData.editorId;
  assert(editor.document.getBehaviors(belt).some(component => component.type === 'conveyor'), 'The equipment button creates a configured prefab.');
  const equipment = editor.document.getObjects('hall');
  const plc = equipment.find(object => editor.document.getBehaviors(object).some(config => config.type === 'automation'));
  const entrySensor = equipment.find(object => object.name === 'Sensor de entrada');
  editor.select(plc);
  const inputObject = labelled(editor.inspector, 'SI · objeto'); inputObject.value = entrySensor.userData.editorId; await inputObject.fire('change');
  labelled(editor.inspector, 'Variable de entrada').value = 'count';
  labelled(editor.inspector, 'Comparación').value = 'gte';
  labelled(editor.inspector, 'Valor (true / false o número)').value = '1';
  const outputObject = labelled(editor.inspector, 'ENTONCES · objeto'); outputObject.value = beltId; await outputObject.fire('change');
  labelled(editor.inspector, 'Variable de salida').value = 'running';
  labelled(editor.inspector, 'Asignar valor').value = 'false';
  await control(editor.inspector, '+ Añadir regla').click();
  const configuredRules = JSON.parse(editor.document.getBehaviors(plc).find(config => config.type === 'automation').rules);
  assert.equal(configuredRules[0].sourceId, entrySensor.userData.editorId);
  assert.equal(configuredRules[0].targetId, beltId);
  editor.leave();
  editor.simulation.command(beltId, 'powerOn');
  editor.simulation.command(beltId, 'start');
  editor.simulation.command(beltId, 'insertBox');
  for (let index = 0; index < 20; index++) editor.execute(0.1, index / 10);
  assert(editor.simulation.getSnapshot().objects.find(object => object.id === entrySensor.userData.editorId).variables.count > 0,
    'The physical load command feeds a real product through the entry sensor.');
  assert.equal(editor.simulation.getSnapshot().objects.find(object => object.id === beltId).variables.running, false,
    'The SI/ENTONCES inspector form connects a real sensor counter to the conveyor stop variable.');
  editor.enter(); editor.select(plc);
  await control(editor.inspector, 'Quitar regla').click();
  assert.deepStrictEqual(JSON.parse(editor.document.getBehaviors(plc).find(config => config.type === 'automation').rules), []);
  const moving = editor.document.addPrimitive('hall', 'box');
  editor.document.setBehaviors(moving, [behaviorSchema.defaultBehavior('motion'), behaviorSchema.defaultBehavior('analytics')]);
  const authoredPosition = moving.position.toArray();
  const panel = editor.simulationPanel;
  panel.toggle(true);
  await control(panel.panel, 'Probar / reiniciar').click();
  assert.equal(editor.active, false);
  assert.equal(editor.simulation.getSnapshot().objects.find(object => object.id === beltId).variables.powered, false,
    'New equipment starts safely powered off.');
  editor.simulation.command(beltId, 'powerOn');
  editor.simulation.command(beltId, 'start');
  for (let index = 0; index < 6; index++) editor.execute(0.1, index / 10);
  let snapshot = editor.simulation.getSnapshot();
  assert(snapshot.objects.find(object => object.id === beltId).variables.actualSpeed > 0);
  assert.notDeepStrictEqual(moving.position.toArray(), authoredPosition, 'The simulation has moved the actor before recording is requested.');
  panel.objectSelect.value = beltId; panel.render(true);
  const speed = labelled(panel.variables, belt.name + ' · speed');
  speed.value = '1.25'; await speed.fire('change');
  assert.equal(editor.simulation.getSnapshot().objects.find(object => object.id === beltId).variables.speed, 1.25);
  const running = labelled(panel.variables, belt.name + ' · running');
  running.checked = false; await running.fire('change');
  assert.equal(editor.simulation.getSnapshot().objects.find(object => object.id === beltId).variables.actualSpeed, 0);
  panel.render(true);
  assert(panel.kpis.textContent.includes('paquetes/min') && panel.kpis.textContent.includes('Tiempo en marcha'));
  editor.execute(1, 1); panel.render(true);
  assert(panel.clock.textContent.includes('descartados'), 'The panel distinguishes simulated time from dropped wall clock time.');

  await panel.record();
  assert.equal(panel.recorder.active, true);
  assert(editor.currentProject && !editor.dirty, 'Recording persists the authored scene before starting.');
  const savedScene = remote.projects.get(editor.currentProject.id).revisions[0].document;
  assert.deepStrictEqual(savedScene.rooms.hall.additions.find(object => object.id === moving.userData.editorId).position, authoredPosition,
    'Persisted motion starts from the authored pose, not the transient play pose.');
  assert.equal(panel.recorder.payload.samples[0].time, 0);
  for (let index = 0; index < 12; index++) editor.execute(0.1, index / 10);
  ctx.vrMode = true; editor.onVRChange(true);
  assert.equal(panel.panel.hidden, true);
  assert.equal(panel.launcher.hidden, true);
  assert.equal(panel.recorder.active, true, 'Entering VR retains the same recording and simulation.');
  editor.execute(0.1, 2);
  ctx.vrMode = false; editor.onVRChange(false);
  editor.enter();
  assert.equal(panel.recorder.active, false);
  assert(panel.payload.samples.length > 4 && panel.payload.duration > 1);
  assert.deepStrictEqual(moving.position.toArray(), authoredPosition, 'Returning to edit mode restores authored motion.');
  const pending = panel.payload;
  remote.online = false;
  await assert.rejects(() => panel.save(), /desconectado/);
  assert.strictEqual(panel.payload, pending);
  assert.equal(panel.saved, false, 'A failed SQLite request retains the pending exportable recording.');
  const exportsBefore = exportsCreated.length;
  panel.download(false);
  assert.equal(exportsCreated.length, exportsBefore + 1);
  const exportText = await exportsCreated.at(-1).text();
  assert(exportText.includes('"sample"') && exportText.includes('"actualSpeed"'));
  panel.download(true);
  assert.deepStrictEqual(JSON.parse(await exportsCreated.at(-1).text()), pending);
  remote.online = true;
  await panel.save();
  assert.equal(panel.saved, true);
  const writeCount = telemetryRemote.writes.length;
  assert.equal(telemetryRemote.writes.at(-1).projectRevision, editor.currentProject.revision);
  await panel.save();
  assert.equal(telemetryRemote.writes.length, writeCount, 'Repeated Save does not create a duplicate analytics run.');

  // History follows the current project, while a pending recording keeps its own owner.
  const firstProject = Object.assign({}, editor.currentProject);
  await editor.saveProject('Otro equipo', true);
  await panel.history();
  assert(panel.historyList.children[0].textContent.includes('Otro equipo'));
  assert.equal(panel.recordProject.id, firstProject.id);
  const historyPause = {started: deferred(), finish: deferred()}; telemetryRemote.pausedList = historyPause;
  const priorHistory = panel.historyList.children.slice();
  const staleHistory = panel.history(); await historyPause.started.promise;
  await editor.saveProject('Tercer equipo', true);
  historyPause.finish.resolve(); await staleHistory;
  assert.deepStrictEqual(panel.historyList.children, priorHistory, 'A late history response cannot replace a newly selected project context.');

  await panel.record(); editor.execute(0.2, 3); panel.endSession();
  const previousPayload = panel.payload;
  const telemetryPause = {started: deferred(), finish: deferred()}; telemetryRemote.pausedWrite = telemetryPause;
  const lateSave = panel.save(); await telemetryPause.started.promise;
  // A downloaded previous recording permits a new one while the old request completes.
  panel.download(true); await panel.record(); editor.execute(0.2, 4); panel.endSession();
  assert.notStrictEqual(panel.payload, previousPayload);
  telemetryPause.finish.resolve(); await lateSave;
  assert.equal(panel.saved, false, 'A late save of an older payload never marks the new recording saved.');
  assert(panel.payload.samples.length > 0);
}

async function testLargeImportIntegration() {
  storage.clear(); remote.projects.clear(); remote.online = true;
  const {editor} = harness(); await editor.ready;
  const file = {name: 'modelo-pesado.glb', type: 'model/gltf-binary', size: 64 * 1024 * 1024, contents: 'model fixture'};
  const history = editor.document.undoStack.length;
  const entries = await editor.importFiles([file]);
  assert.equal(editor.library.loadOptions.maxAssetBytes, 256 * 1024 * 1024);
  assert.equal(editor.library.loadOptions.deferCommit, true);
  assert.equal(typeof editor.library.loadOptions.uploadFile, 'function');
  assert(!entries[0].dataUrl && entries[0].url.startsWith('/api/assets/'));
  assert.equal(editor.library.exportImports()[0].size, file.size);
  assert.equal(editor.document.undoStack.length, history + 1, 'Committing an uploaded batch creates one undo action.');
  editor.document.undo(); assert.equal(editor.library.exportImports().length, 0);
  editor.document.redo(); assert.equal(editor.library.exportImports().length, 1);
  await editor.document.addAsset('hall', {importId: entries[0].id});
  const saved = await editor.saveProject('Modelo grande');
  const reloaded = harness(); await reloaded.editor.ready;
  assert.deepStrictEqual(await reloaded.editor.document.serialize(), saved.document);

  const pause = deferred();
  editor.library.loadFiles = async (files, options) => {
    assert.equal(editor.document.transaction, null, 'A network upload must not hold an edit transaction.');
    assert.equal(options.deferCommit, true);
    await pause.promise;
    return [Object.assign({}, entries[0], {id: 'batch-second', importId: 'batch-second', path: 'other.glb'})];
  };
  const pending = editor.importFiles([file]);
  assert(editor.importingFiles && editor.projectSyncState().busy);
  assert.equal(await editor.saveProject(), false, 'Saving waits for pending import references.');
  await assert.rejects(() => editor.importFiles([file]), /importación/);
  const before = editor.library.exportImports();
  editor.document.addPrimitive('hall', 'box');
  editor.projectGeneration++; // Simulate a project load while upload is in flight.
  pause.resolve();
  await assert.rejects(() => pending, /proyecto cambió/);
  assert.deepStrictEqual(editor.library.exportImports(), before, 'Late uploads cannot attach to another project.');
  assert.equal(editor.document.transaction, null);
  assert.equal(editor.importingFiles, false);

  // A disconnected static copy still permits portable/offline imports.
  remote.online = false; storage.clear();
  const offline = harness(); await offline.editor.ready;
  const imported = await offline.editor.importFiles([{name: 'offline.glb', type: 'model/gltf-binary', size: 4, contents: 'file'}]);
  assert.equal(offline.editor.library.loadOptions.uploadFile, undefined);
  assert(imported[0].dataUrl);
  remote.online = true;
}

async function testDecalPlacement() {
  storage.clear(); remote.projects.clear(); remote.online = true;
  const {editor, ctx, roots, hooks} = harness(); await editor.ready;
  const all = root => [root].concat(root.children.flatMap(child => all(child)));
  const field = label => all(editor.inspector).find(node => node.getAttribute('aria-label') === 'Decal / imagen sobre superficie · ' + label);
  const settle = async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); };
  const clickCenter = async () => {
    const event = {button: 0, clientX: 480, clientY: 300};
    await ctx.renderer.domElement.fire('pointerdown', event); await ctx.renderer.domElement.fire('pointerup', event); await settle();
  };
  editor.startDecalPlacement();
  assert.equal(editor.assetKind, 'image'); assert.equal(editor.decalPlacement, undefined, 'Without an image, Add Decal directs users to image assets.');
  const image = editor.entries.find(entry => entry.kind === 'image');
  await editor.previewAsset(image);
  const add = all(editor.preview).find(node => node.tagName === 'BUTTON' && node.textContent === '+ Colocar decal');
  assert(add); await add.click();
  assert(editor.decalPlacement); assert.equal(editor.transform.enabled, false); assert.equal(editor.decalPlacementBar.hidden, false);
  assert.equal(editor.transform.object, undefined, 'Placing a decal detaches the gizmo so its handles cannot cover the placement surface.');
  editor.camera.position.set(0, 0, 4); editor.camera.lookAt(new THREE.Vector3());
  const before = editor.document.undoStack.length;
  await clickCenter();
  const decal = editor.selected;
  assert(decal && decal.userData.editorDescriptor.type === 'decal', 'Clicking a visible surface creates a decal projector.');
  assert.equal(editor.document.undoStack.length, before + 1, 'Creating, aligning and naming a decal is a single undo action.');
  assert.equal(editor.decalPlacement, null); assert.equal(editor.transform.enabled, true);
  assert(decal.position.distanceTo(new THREE.Vector3(0, 0, 0.5)) < 1e-6);
  let config = editor.document.getBehaviors(decal)[0];
  assert.equal(config.asset, image.path); assert.equal(config.targetId, roots.hall.children[0].userData.editorId);
  assert(field('Imagen') && field('Imagen').tagName === 'SELECT');
  for (const [label, value] of [['Ancho (m)', '1.5'], ['Alto (m)', '0.7'], ['Profundidad de proyección (m)', '0.1'], ['Opacidad', '0.4'], ['Color', '#f5aa22']]) {
    const input = field(label); input.value = value; await input.fire('change');
  }
  config = editor.document.getBehaviors(decal)[0];
  assert.equal(config.width, 1.5); assert.equal(config.height, 0.7); assert.equal(config.depth, 0.1); assert.equal(config.opacity, 0.4); assert.equal(config.color, '#f5aa22');
  const key = code => editor.onKey({code, ctrlKey: true, target: dom.body, preventDefault() {}});
  key('KeyC'); await settle(); key('KeyV'); await settle();
  const copy = editor.selected;
  assert(copy && copy !== decal); assert.deepStrictEqual(editor.document.getBehaviors(copy), [config]);
  assert(Math.abs(copy.position.x - decal.position.x - 0.5) < 1e-6);
  editor.startDecalPlacement(image, copy);
  editor.onKey({code: 'Escape', target: dom.body});
  assert.equal(editor.decalPlacement, null); assert.strictEqual(editor.selected, copy, 'Esc cancels placement without deleting the selected decal.');
  const beforeMove = editor.document.undoStack.length;
  editor.startDecalPlacement(image, copy);
  editor.camera.position.set(0, 4, 0); editor.camera.lookAt(new THREE.Vector3());
  await clickCenter();
  assert.strictEqual(editor.selected, copy); assert.equal(editor.document.undoStack.length, beforeMove + 1);
  assert(new THREE.Vector3(0, 0, 1).applyQuaternion(copy.quaternion).distanceTo(new THREE.Vector3(0, 1, 0)) < 1e-6, 'Repositioning aligns the projector to the surface normal.');
  const saved = await editor.saveProject('Decals');
  const reopened = harness(); await reopened.editor.ready;
  assert.deepStrictEqual(await reopened.editor.document.serialize(), saved.document);
  assert.equal(reopened.editor.document.getBehaviors(reopened.editor.document.getObject(copy.userData.editorId))[0].opacity, 0.4);
  const disposalCount = editor.decals.disposals;
  editor.startDecalPlacement(image); editor.leave();
  assert.equal(editor.decalPlacement, null); assert.equal(editor.decals.disposals, disposalCount, 'Decal resources remain active in Probar/VR.');
  editor.execute(0.1, 1); assert.equal(editor.decals.syncs.at(-1), 'hall');
  await hooks.gotoRoom(1); assert(editor.decals.disposals > disposalCount);
  assert.equal(editor.decals.syncs.at(-1), 'sound');
}

async function testAssetBrowserThumbnails() {
  storage.clear(); remote.projects.clear(); remote.online = true;
  const {editor} = harness(); await editor.ready;
  assert.equal(editor.assetThumbnails.root, editor.assetGrid);
  assert.equal(editor.assetThumbnails.targets.length, 4, 'Authoring subscribes the displayed asset cards for lazy thumbnails.');
  editor.assetKind = 'image'; editor.renderAssets();
  assert.equal(editor.assetThumbnails.targets.length, 1, 'Filtering disconnects old card subscriptions.');
  const image = editor.entries.find(entry => entry.kind === 'image');
  await editor.previewAsset(image);
  const card = editor.assetCards.get(image.path);
  assert.equal(card.getAttribute('aria-pressed'), 'true');
  assert(card.classList.contains('selected'));
  editor.assetKind = 'all'; editor.renderAssets();
  assert(editor.assetCards.get(image.path).classList.contains('selected'), 'Selected previews remain highlighted after changing a filter.');
  const pending = deferred(), cancelled = [];
  let lateCleanups = 0;
  editor.library.preview = () => pending.promise;
  editor.library.cancelPreview = container => cancelled.push(container);
  const opening = editor.previewAsset(editor.entries[0]);
  const content = editor.previewContent;
  const before = editor.assetThumbnails.disposals;
  editor.leave();
  assert(cancelled.includes(content), 'Leaving the editor immediately cancels a preview that is still loading.');
  assert(editor.assetThumbnails.disposals > before);
  assert.equal(editor.assetThumbnails.targets.length, 0);
  pending.resolve(() => lateCleanups++); await opening;
  assert.equal(lateCleanups, 1, 'A pending preview cannot become the active cleanup after leaving.');
  assert.equal(editor.previewCleanup, null);
  editor.enter(); assert.equal(editor.assetThumbnails.targets.length, 4, 'Thumbnail subscriptions restart when returning to authoring.');
}

async function testInformationPanelEditing() {
  storage.clear(); remote.projects.clear(); remote.online = true;
  const {editor, roots, ctx, hooks} = harness(true); await editor.ready;
  const panel = roots.hall.getObjectByName('infopanel015'), glyph = panel.getObjectByName('textMesh');
  const all = root => [root].concat(root.children.flatMap(child => all(child)));
  const field = key => all(editor.inspector).find(node => node.getAttribute('aria-label') === 'Panel de información · ' + key);
  const preview = object => object.children.find(child => child.userData.editorInfoPreview);
  const textOn = object => preview(object).material.map.image.drawnText.join('\n');
  const info = object => editor.document.getBehaviors(object).find(component => component.type === 'info');
  const change = async (key, value) => { const input = field(key); assert(input); input.value = value; await input.fire('change'); };
  const shortcut = async code => {
    editor.onKey({code, ctrlKey: true, target: dom.body, preventDefault() {}});
    for (let index = 0; index < 30; index++) await Promise.resolve();
  };
  assert(preview(panel), 'Native info panels must have a visible preview even if their native billboard faded out.');
  assert(textOn(panel).includes('WELCOME!'));
  assert.equal(glyph.material.visible, false, 'The preview hides the generated glyph material without changing persisted object visibility.');
  assert.equal(glyph.visible, true);
  editor.select(glyph);
  assert.strictEqual(editor.selected, panel, 'Selecting letters selects their complete logical panel.');
  assert(all(editor.inspector).some(node => node.textContent === 'TEXTO DEL PANEL'));
  await change('Título', 'Bienvenidos'); await change('Texto', 'Escenario de prueba\nSegunda línea');
  await change('Tamaño de letra', '0.06'); await change('Color de texto', '#aabbcc');
  assert(textOn(panel).includes('Bienvenidos') && textOn(panel).includes('Segunda línea'), 'Editing the inspector paints the new text without entering play mode.');
  assert.equal(info(panel).fontSize, 0.06); assert.equal(info(panel).color, '#aabbcc');

  // Pick the preview from behind: native material is FrontSide and faded out.
  editor.camera.position.set(3, 1.5, -5); editor.camera.lookAt(new THREE.Vector3(3, 1.5, -2)); editor.camera.updateMatrixWorld(true);
  editor.select(null);
  const pointer = {button: 0, clientX: 480, clientY: 300};
  await ctx.renderer.domElement.fire('pointerdown', pointer); await ctx.renderer.domElement.fire('pointerup', pointer);
  assert.strictEqual(editor.selected, panel, 'Both faces of the panel preview are selectable in the viewport.');
  await shortcut('KeyC'); await shortcut('KeyV');
  const copied = editor.selected;
  assert(copied && copied !== panel && !editor.document.isNative(copied));
  assert.deepStrictEqual(editor.document.getBehaviors(copied), editor.document.getBehaviors(panel));
  assert(textOn(copied).includes('Bienvenidos'), 'A pasted panel displays its copied text while editing.');
  await change('Título', 'Copia independiente');
  assert.equal(info(panel).title, 'Bienvenidos'); assert(textOn(copied).includes('Copia independiente'));
  editor.document.undo(); assert.equal(info(copied).title, 'Bienvenidos');
  editor.document.redo(); assert.equal(info(copied).title, 'Copia independiente');
  const authored = await editor.document.serialize();
  assert(!authored.rooms.hall.overrides.some(override => override.id === glyph.userData.editorId), 'Preview visibility must never become a saved glyph override.');
  const copyId = copied.userData.editorId;
  await editor.saveProject('Paneles editables');
  const reopened = harness(true); await reopened.editor.ready;
  assert.deepStrictEqual(await reopened.editor.document.serialize(), authored);
  assert(textOn(reopened.editor.document.getObject(copyId)).includes('Copia independiente'), 'Opening a saved project immediately previews copied text.');
  await hooks.gotoRoom(1);
  assert.equal(preview(panel), undefined); assert.equal(glyph.material.visible, true, 'Changing rooms restores native SDF material visibility.');
  await hooks.gotoRoom(0); assert(preview(panel));
  editor.leave();
  assert.equal(preview(panel), undefined); assert.equal(preview(copied), undefined);
  assert.equal(glyph.material.visible, true);
  assert.deepStrictEqual(await editor.document.serialize(), authored, 'Entering runtime retains only the authored panel configuration.');
  editor.enter(); assert(textOn(copied).includes('Copia independiente'));
}

async function testMagneticEquipmentAuthoring() {
  storage.clear(); remote.projects.clear(); remote.online = true;
  const {editor} = harness(); await editor.ready;
  const all = root => [root].concat(root.children.flatMap(child => all(child)));
  const settle = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
  const config = object => editor.conveyorConfig(object);
  const equipment = all(editor.hierarchy).find(node => node.getAttribute('aria-label') === 'Equipo preestablecido');
  const add = all(editor.hierarchy).find(node => node.tagName === 'BUTTON' && node.textContent === '+ Equipo');
  equipment.value = 'conveyor'; editor.orbit.target.set(0, 1, -10);
  let depth = editor.document.undoStack.length;
  await add.click(); await settle(); const first = editor.selected;
  assert(first && config(first), 'The actual equipment button creates a conveyor on the floor.');
  assert.equal(editor.document.undoStack.length, depth + 1, 'Creation and safe placement form one undo action.');
  const bounds = object => {
    const box = new THREE.Box3(); object.updateWorldMatrix(true, true);
    object.traverse(mesh => {
      if (!mesh.isMesh || !mesh.geometry) return;
      for (let node = mesh; node; node = node.parent) if (!node.visible || node.userData.editorHelper || node.userData.editorRuntimeHelper || node.userData.industrialSensorVolume) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      box.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
    });
    return box;
  };
  assert(Math.abs(bounds(first).min.y) < 0.005, 'The visible feet rest on the support floor.');
  await add.click(); await settle(); const second = editor.selected;
  assert(second && second !== first);
  assert.equal(bounds(first).intersectsBox(bounds(second)), false, 'Another equipment button click finds free space instead of overlapping the first machine.');
  assert(Math.abs(bounds(second).min.y) < 0.005);

  [first, second].forEach(object => editor.updateConveyor(object, {role: 'middle', withSensors: false, withPanel: false, withPallet: false}));
  editor.document.setTransform(first, {position: [0, 1, -10]});
  editor.document.setTransform(second, {position: [4.16, 1, -10]});
  editor.select(second); editor.setTool('translate');
  const drag = value => { editor.transform.dragging = value; editor.transform.dispatchEvent({type: 'dragging-changed', value}); };
  depth = editor.document.undoStack.length;
  drag(true); editor.transform.dispatchEvent({type: 'objectChange'});
  assert.equal(config(first).outputId, second.userData.editorId, 'Dragging near the matching port writes the real transfer connection.');
  assert(Math.abs(second.position.x - 4) < 0.001);
  assert(editor.assembly.helperGroup && editor.assemblyHint.hidden === false);
  drag(false); await settle();
  assert.equal(editor.document.undoStack.length, depth + 1, 'Dragging, alignment and linking form one undo action.');
  editor.document.undo(); assert.equal(config(first).outputId, ''); assert(Math.abs(second.position.x - 4.16) < 0.001);
  editor.document.redo(); assert.equal(config(first).outputId, second.userData.editorId);

  const joined = second.position.clone(); depth = editor.document.undoStack.length;
  editor.detachDragModifier = true;
  drag(true); second.position.x += 1.1; editor.transform.dispatchEvent({type: 'objectChange'});
  assert.equal(config(first).outputId, '', 'Ctrl plus dragging detaches only the selected module.');
  let prevented = false;
  editor.onKey({code: 'Escape', target: dom.body, preventDefault() { prevented = true; }});
  assert(prevented && second.position.equals(joined), 'Esc restores the pose before the complete drag.');
  assert.equal(config(first).outputId, second.userData.editorId, 'Esc restores the previous assembly as well as its transform.');
  assert.equal(editor.document.undoStack.length, depth); assert.equal(editor.document.transaction, null);
  editor.select(second);
  const detach = all(editor.inspector).find(node => node.tagName === 'BUTTON' && node.textContent === 'Desensamblar equipo');
  assert(detach && !detach.disabled); await detach.click(); await settle();
  assert.equal(config(first).outputId, ''); assert(second.position.equals(joined));
  editor.document.undo(); assert.equal(config(first).outputId, second.userData.editorId);

  editor.select(first); const copied = await editor.duplicateObject(); await settle();
  assert(config(copied) && config(copied).outputId === '', 'A new equipment copy starts detached from the original line.');
  assert(!bounds(first).intersectsBox(bounds(copied)) && !bounds(second).intersectsBox(bounds(copied)), 'Copied equipment also receives free floor space.');
  assert(Math.abs(bounds(copied).min.y) < 0.005);

  const saved = await editor.document.serialize(), previousPlacement = editor.equipmentPlacement.place;
  depth = editor.document.undoStack.length;
  editor.equipmentPlacement.place = () => { throw new Error('No placement space'); };
  await editor.addAsset({path: 'hall.glb', name: 'hall.glb'});
  assert.deepStrictEqual(await editor.document.serialize(), saved, 'A failed imported-model placement leaves no extra object at the origin.');
  assert.equal(editor.document.undoStack.length, depth);
  assert.throws(() => editor.createPlacedObject(() => editor.document.addPrefab(editor.roomId, 'conveyor')), /placement space/);
  assert.deepStrictEqual(await editor.document.serialize(), saved, 'A failed equipment placement cancels its creation in the same action.');
  editor.equipmentPlacement.place = previousPlacement;
  editor.select(second); assert(editor.assembly.helperGroup);
  editor.leave(); assert.equal(editor.assembly.helperGroup, null); assert(editor.assemblyHint.hidden);
  assert.deepStrictEqual(await editor.document.serialize(), saved, 'Assembly aids never appear in saved scenes or runtime.');
}

async function testMagneticBoxAuthoring() {
  storage.clear(); remote.projects.clear(); remote.online = true;
  const {editor, roots, ctx} = harness(); await editor.ready;
  const settle = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
  const carton = editor.document.addPrefab('hall', 'product');
  editor.document.setTransform(carton, {position: [-3, 0.28, -5], rotation: [0, 0.45, 0]});
  const orientation = carton.quaternion.clone(), components = editor.document.getBehaviors(carton);
  editor.select(carton);
  assert.strictEqual(editor.assemblyFor(carton), editor.objectAssembly, 'Boxes use the surface magnet rather than conveyor connection ports.');
  assert(editor.objectAssembly.candidate && editor.objectAssembly.helperGroup && !editor.assemblyHint.hidden);
  assert.equal(editor.assembly.helperGroup, null);
  const before = carton.position.clone(), depth = editor.document.undoStack.length;
  const drag = value => { editor.transform.dragging = value; editor.transform.dispatchEvent({type: 'dragging-changed', value}); };
  drag(true); editor.transform.dispatchEvent({type: 'objectChange'});
  assert(editor.objectAssembly.drag.latch, 'A nearby support surface attracts the dragged box.');
  assert(carton.position.y < before.y && carton.position.y > 0.12);
  assert(carton.quaternion.equals(orientation), 'Surface snapping preserves the complete authored orientation.');
  drag(false); await settle();
  assert.equal(editor.document.undoStack.length, depth + 1);
  const placed = carton.position.clone();
  editor.document.undo(); assert(carton.position.equals(before));
  editor.document.redo(); assert(carton.position.equals(placed));
  assert.deepStrictEqual(editor.document.getBehaviors(carton), components);
  drag(true); editor.transform.dispatchEvent({type: 'objectChange'});
  carton.position.y = 0.8; editor.transform.dispatchEvent({type: 'objectChange'});
  assert.equal(editor.objectAssembly.drag.latch, null, 'Pulling the box clear releases its magnetic contact.');
  editor.onKey({code: 'Escape', target: dom.body, preventDefault() {}});
  assert(carton.position.equals(placed)); assert.equal(editor.document.transaction, null);
  assert.equal(editor.objectAssembly.drag, null);
  await editor.assemblyButton.click(); assert.equal(editor.objectAssembly.enabled, false); assert.equal(editor.assembly.enabled, false);
  assert.equal(editor.objectAssembly.helperGroup, null);
  await editor.assemblyButton.click(); assert.equal(editor.objectAssembly.enabled, true);
  assert(editor.objectAssembly.helperGroup);
  const copy = await editor.duplicateObject(carton); await settle();
  copy.updateWorldMatrix(true, true); carton.updateWorldMatrix(true, true);
  assert(!new THREE.Box3().setFromObject(copy).intersectsBox(new THREE.Box3().setFromObject(carton)), 'Copied cartons also search for free floor space.');
  assert.deepStrictEqual(editor.document.getBehaviors(copy), components);
  editor.select(copy);
  const saved = await editor.document.serialize();
  editor.leave(); assert.equal(editor.objectAssembly.helperGroup, null);
  assert.deepStrictEqual(await editor.document.serialize(), saved);
  assert.equal(ctx.renderer.xr.enabled, true); assert.strictEqual(roots.hall.children[0].name, 'doorA');
}

async function testProductSourceAuthoring() {
  storage.clear(); remote.projects.clear(); remote.online = true;
  const {editor, ctx} = harness(); await editor.ready;
  const all = root => [root].concat(root.children.flatMap(child => all(child)));
  const press = async (root, label) => { const control = all(root).find(node => node.tagName === 'BUTTON' && node.textContent === label); assert(control, label); await control.click(); };
  const labelled = (root, label) => all(root).find(node => (node.getAttribute('aria-label') || '').includes(label));
  const change = async (label, value) => { const field = labelled(editor.inspector, label); assert(field, label); if (field.type === 'checkbox') field.checked = value; else field.value = value; await field.fire('change'); };
  const cfg = object => editor.document.getBehaviors(object).find(value => value.type === 'source');
  const catalog = labelled(editor.hierarchy, 'Equipo preestablecido');
  assert(catalog.children.some(option => option.value === 'source') && catalog.children.some(option => option.value === 'queue'));
  catalog.value = 'source'; editor.orbit.target.set(-5, 1, -8); await press(editor.hierarchy, '+ Equipo');
  const source = editor.selected, sourceId = source.userData.editorId;
  assert(cfg(source) && editor.assemblyFor(source) === editor.assembly);
  assert(all(editor.inspector).some(node => node.textContent === 'PRODUCTOS / CATÁLOGO SOURCE'));
  await press(editor.inspector, '+ Tipo de producto');
  await change('Nombre del producto 1', 'Bidón azul'); await change('Tipo de producto 1', 'drum');
  await change('Ancho (m) producto 1', 0.2); await change('Alto (m) producto 1', 0.4); await change('Fondo (m) producto 1', 0.2);
  await press(editor.inspector, '+ Tipo de producto'); await change('Nombre del producto 2', 'Caja mediana');
  await change('Selección de productos', 'sequence'); await change('Capacidad de cola', 3);
  await change('Generar cada', 0.1); await change('Límite total', 5); await change('Despachar cada', 0.1);
  await change('Entrega de la cola', 'automatic');
  const rows = JSON.parse(cfg(source).catalog); assert.equal(rows.length, 2); assert.equal(rows[0].type, 'drum');
  assert.equal(rows[0].height, 0.4); assert.equal(cfg(source).generationMode, 'sequence');
  catalog.value = 'queue'; await press(editor.hierarchy, '+ Equipo'); const queue = editor.selected;
  assert.equal(cfg(queue).autoGenerate, false, 'A Queue receives products without generating its own supply.');
  await change('Entrega de la cola', 'automatic'); await change('Despachar cada', 0.1);
  catalog.value = 'roller-middle'; await press(editor.hierarchy, '+ Equipo'); const belt = editor.selected;
  editor.document.setTransform(source, {position: [-5, 1, -8]});
  editor.select(source); await change('Salida principal · módulo', queue.userData.editorId); await press(editor.inspector, 'Alinear siguiente');
  editor.select(queue); await change('Salida principal · módulo', belt.userData.editorId); await press(editor.inspector, 'Alinear siguiente');
  assert.equal(cfg(source).outputId, queue.userData.editorId); assert.equal(cfg(queue).outputId, belt.userData.editorId);
  assert(editor.simulationVariables(source).some(field => field.key === 'queued' && !field.writable));
  assert(editor.simulationVariables(source).some(field => field.key === 'autoGenerate' && field.writable && field.boolean));
  const authored = await editor.document.serialize();
  editor.leave(); for (let index = 0; index < 50; index++) editor.simulation.execute(0.1);
  const snapshot = editor.simulation.getSnapshot(), supply = snapshot.objects.find(value => value.id === sourceId);
  const buffer = snapshot.objects.find(value => value.id === queue.userData.editorId);
  assert.equal(supply.variables.generated, 5); assert.equal(supply.variables.delivered, 5);
  assert.equal(buffer.variables.generated, 0); assert.equal(buffer.variables.received, 5); assert.equal(buffer.variables.delivered, 5);
  assert.equal(editor.simulation.records.get(belt.userData.editorId).components.conveyor.entryCount, 5);
  assert.equal(editor.simulation.sourceRuntime.entries.size, 5, 'Logical product identities survive the complete production flow.');
  editor.simulationPanel.objectSelect.value = sourceId; editor.simulationPanel.render(true);
  assert(all(editor.simulationPanel.variables).some(node => node.textContent === 'Generar carga'));
  assert(editor.simulationPanel.kpis.textContent.includes('Cola:'));
  editor.enter(); assert.deepStrictEqual(await editor.document.serialize(), authored, 'Source play queues and generated objects never leak into the saved authoring document.');
  editor.select(source); const copy = await editor.duplicateObject(source);
  assert.equal(cfg(copy).outputId, ''); assert.equal(cfg(copy).catalog, cfg(source).catalog);
  const copied = editor.document.additions.get(copy.userData.editorId);
  Array.from(copied.nodes.values()).filter(node => editor.document.getBehaviors(node).some(value => value.type === 'control')).forEach(node => {
    assert.equal(editor.document.getBehaviors(node).find(value => value.type === 'control').targetId, copy.userData.editorId);
  });
  const saved = await editor.saveProject('Source y cola FIFO');
  const reopened = harness(); await reopened.editor.ready;
  assert.deepStrictEqual(await reopened.editor.document.serialize(), saved.document);
  assert.equal(ctx.renderer.xr.enabled, true); editor.projectSync.stop(); reopened.editor.projectSync.stop();
}

async function testProcessorAuthoring() {
  storage.clear(); remote.projects.clear(); remote.online = true;
  const {editor, ctx} = harness(); await editor.ready;
  const all = root => [root].concat(root.children.flatMap(child => all(child)));
  const press = async (root, label) => { const control = all(root).find(node => node.tagName === 'BUTTON' && node.textContent === label); assert(control, label); await control.click(); };
  const labelled = (root, label) => all(root).find(node => (node.getAttribute('aria-label') || '').includes(label));
  const change = async (label, value) => { const field = labelled(editor.inspector, label); assert(field, label); if (field.type === 'checkbox') field.checked = value; else field.value = value; await field.fire('change'); };
  const cfg = (object, type) => editor.document.getBehaviors(object).find(value => value.type === type);
  const catalog = labelled(editor.hierarchy, 'Equipo preestablecido');
  ['processor', 'combiner', 'separator'].forEach(id => assert(catalog.children.some(option => option.value === id), id));
  catalog.value = 'processor'; editor.orbit.target.set(-5, 1, -8); await press(editor.hierarchy, '+ Equipo');
  const machine = editor.selected, machineId = machine.userData.editorId;
  assert.equal(cfg(machine, 'processor').mode, 'process'); assert.equal(cfg(machine, 'processor').powered, false);
  assert(editor.assemblyFor(machine) === editor.assembly);
  assert(all(editor.inspector).some(node => node.textContent === 'FLUJO / MÁQUINA DE PROCESO'));
  await change('Tiempo de proceso por ciclo', 0.2); await change('Tiempo de preparación', 0.1);
  await change('Puestos de proceso simultáneos', 2); await change('Capacidad de entrada', 4);
  await change('Largo de la máquina', 3.4); await change('Requiere operario', true);
  await change('Alimentación inicial', true); await change('Arranque inicial', true);
  await change('Tipo de procesamiento', 'combiner'); assert(labelled(editor.inspector, 'Cargas por combinación'));
  await change('Tipo de procesamiento', 'separator'); assert(labelled(editor.inspector, 'Máximo de grupos de salida'));
  await change('Tipo de procesamiento', 'process');
  assert(!labelled(editor.inspector, 'Cargas por combinación'));
  assert(editor.simulationVariables(machine).some(field => field.key === 'operatorAvailable' && field.writable && field.boolean));
  assert(editor.simulationVariables(machine).some(field => field.key === 'utilization' && !field.writable));
  catalog.value = 'source'; await press(editor.hierarchy, '+ Equipo'); const source = editor.selected;
  editor.document.setBehaviors(source, [Object.assign(cfg(source, 'source'), {autoGenerate: false, initialCount: 4, delivery: 'automatic', outputInterval: 0.1})]);
  catalog.value = 'queue'; await press(editor.hierarchy, '+ Equipo'); const queue = editor.selected;
  editor.document.setTransform(source, {position: [-5, 1, -8]});
  editor.select(source); await change('Salida principal · módulo', machineId); await press(editor.inspector, 'Alinear siguiente');
  editor.select(machine); await change('Salida principal · módulo', queue.userData.editorId); await press(editor.inspector, 'Alinear siguiente');
  const authored = await editor.document.serialize();
  editor.leave(); for (let index = 0; index < 10; index++) editor.simulation.execute(0.1);
  const state = () => editor.simulation.getSnapshot().objects.find(value => value.id === machineId).variables;
  assert.equal(state().completed, 0); assert(state().waitingOperator);
  editor.simulationPanel.objectSelect.value = machineId; editor.simulationPanel.render(true);
  await press(editor.simulationPanel.variables, 'Operario disponible / ausente');
  for (let index = 0; index < 35; index++) editor.simulation.execute(0.1);
  assert.equal(state().completed, 4); assert.equal(state().entryCount, 4); assert.equal(state().exitCount, 4);
  assert.equal(editor.simulation.records.get(queue.userData.editorId).variables.received, 4);
  assert(state().utilization > 0 && state().utilization <= 100);
  editor.simulationPanel.render(true); assert(editor.simulationPanel.kpis.textContent.includes('Utilización:'));
  await press(editor.simulationPanel.variables, 'Apagar'); assert.equal(state().powered, false); assert.equal(state().running, false);
  await press(editor.simulationPanel.variables, 'Encender'); assert.equal(state().powered, true); assert.equal(state().running, false);
  editor.enter(); assert.deepStrictEqual(await editor.document.serialize(), authored);
  editor.select(machine); const copy = await editor.duplicateObject(machine);
  assert.equal(cfg(copy, 'processor').outputId, ''); assert.equal(cfg(copy, 'processor').processTime, 0.2);
  const copied = editor.document.additions.get(copy.userData.editorId);
  const controls = Array.from(copied.nodes.values()).filter(node => cfg(node, 'control'));
  assert(controls.length >= 8); controls.forEach(node => assert.equal(cfg(node, 'control').targetId, copy.userData.editorId));
  const saved = await editor.saveProject('Máquinas de proceso'); const reopened = harness(); await reopened.editor.ready;
  assert.deepStrictEqual(await reopened.editor.document.serialize(), saved.document);
  assert.equal(ctx.renderer.xr.enabled, true); editor.projectSync.stop(); reopened.editor.projectSync.stop();
}

async function testPalletQueueAuthoring() {
  storage.clear(); remote.projects.clear(); remote.online = true;
  const {editor, ctx} = harness(); await editor.ready;
  const all = root => [root].concat(root.children.flatMap(child => all(child)));
  const press = async (root, text) => { const button = all(root).find(node => node.tagName === 'BUTTON' && node.textContent === text); assert(button, text); await button.click(); };
  const change = async (label, value) => { const field = all(editor.inspector).find(node => (node.getAttribute('aria-label') || '').includes(label)); assert(field, label); field.value = value; await field.fire('change'); };
  const cfg = (object, type) => editor.document.getBehaviors(object).find(value => value.type === type);
  const catalog = all(editor.hierarchy).find(node => node.getAttribute('aria-label') === 'Equipo preestablecido');
  assert(catalog.children.some(node => node.value === 'palletQueue'));
  catalog.value = 'palletQueue'; editor.orbit.target.set(-5, 1, -8); await press(editor.hierarchy, '+ Equipo');
  const store = editor.selected, id = store.userData.editorId;
  assert.equal(cfg(store, 'palletQueue').capacity, 48); assert(editor.assemblyFor(store) === editor.assembly);
  assert(all(editor.inspector).some(node => node.textContent === 'FLUJO / ALMACÉN CON ESTIBAS'));
  await change('Columnas de productos', 2); await change('Filas de productos', 2); await change('Niveles de apilado', 1);
  assert.equal(cfg(store, 'palletQueue').capacity, 4, 'Reducing the grid also reduces its capacity in the same edit.');
  assert(editor.simulationVariables(store).some(field => field.key === 'occupancy' && !field.writable));
  catalog.value = 'source'; await press(editor.hierarchy, '+ Equipo'); const source = editor.selected;
  editor.document.setBehaviors(source, [Object.assign(cfg(source, 'source'), {initialCount: 2, autoGenerate: false, delivery: 'automatic', outputInterval: 0.1})]);
  catalog.value = 'roller-middle'; await press(editor.hierarchy, '+ Equipo'); const conveyor = editor.selected;
  editor.document.setBehaviors(conveyor, [Object.assign(cfg(conveyor, 'conveyor'), {speed: 2, length: 2})]);
  editor.document.setTransform(source, {position: [-5, 1, -8]});
  editor.select(source); await change('Salida principal · módulo', conveyor.userData.editorId); await press(editor.inspector, 'Alinear siguiente');
  editor.select(conveyor); await change('Salida principal · módulo', id); await press(editor.inspector, 'Alinear siguiente');
  assert(!all(editor.inspector).some(node => (node.getAttribute('aria-label') || '').includes('Pallet incorporado')));
  const authored = await editor.document.serialize();
  editor.leave(); for (let index = 0; index < 45; index++) editor.simulation.execute(0.1);
  const state = editor.simulation.records.get(id).variables;
  assert.equal(state.queued, 2); assert.equal(state.received, 2); assert.equal(state.occupancy, 50);
  assert.equal(editor.simulation.records.get(conveyor.userData.editorId).variables.palletCount, 0);
  editor.simulationPanel.objectSelect.value = id; editor.simulationPanel.render(true);
  assert(editor.simulationPanel.kpis.textContent.includes('Ocupación: 50'));
  assert(all(editor.simulationPanel.variables).some(node => node.textContent === 'Despachar caja superior'));
  editor.enter(); assert.deepStrictEqual(await editor.document.serialize(), authored);
  editor.select(store); await press(editor.inspector, 'Desensamblar equipo');
  assert.equal(cfg(conveyor, 'conveyor').outputId, '');
  const copy = await editor.duplicateObject(store); assert.equal(cfg(copy, 'palletQueue').capacity, 4);
  const saved = await editor.saveProject('Almacenes con estibas'); const reopened = harness(); await reopened.editor.ready;
  assert.deepStrictEqual(await reopened.editor.document.serialize(), saved.document);
  assert.equal(ctx.renderer.xr.enabled, true); editor.projectSync.stop(); reopened.editor.projectSync.stop();
}

async function testConveyorSortingAuthoring() {
  storage.clear(); remote.projects.clear(); remote.online = true;
  const {editor, ctx} = harness(); await editor.ready; editor.enter();
  const all = root => [root].concat(root.children.flatMap(child => all(child)));
  const labelled = (root, label) => all(root).find(node => node.getAttribute('aria-label') === label);
  const change = async (label, value) => { const input = labelled(editor.inspector, label); assert(input, label); input.value = value; await input.fire('change'); };
  const press = async label => { const control = all(editor.inspector).find(node => node.tagName === 'BUTTON' && node.textContent === label); assert(control, label); await control.click(); };
  const cfg = (object, type) => editor.document.getBehaviors(object).find(value => value.type === type);
  const tee = editor.document.addPrefab('hall', 'conveyor', 'roller-tee-split'); editor.select(tee);
  const modeLabel = 'Banda transportadora simulada · Distribuir productos';
  await change(modeLabel, 'rules');
  assert(all(editor.inspector).some(node => node.textContent === 'CLASIFICACIÓN / DECISIONES DE SALIDA'));
  assert(!all(editor.inspector).some(node => node.tagName === 'TEXTAREA' && (node.getAttribute('aria-label') || '').includes('Reglas de clasificación')), 'Classification has an editable typed form rather than requiring JSON.');
  await press('+ Regla de clasificación'); await change('Clasificación · Atributo regla 1', 'color');
  assert.equal(labelled(editor.inspector, 'Clasificación · Valor regla 1').type, 'color');
  await change('Clasificación · Valor regla 1', '#334455');
  await press('+ Regla de clasificación'); await change('Clasificación · Atributo regla 2', 'width');
  assert.equal(labelled(editor.inspector, 'Clasificación · Valor regla 2').type, 'number');
  assert(labelled(editor.inspector, 'Clasificación · Comparación regla 2').children.some(option => option.value === 'gt'));
  await change('Clasificación · Comparación regla 2', 'gt'); await change('Clasificación · Valor regla 2', 0.4);
  await labelled(editor.inspector, 'Subir regla 2').click();
  assert.deepStrictEqual(JSON.parse(cfg(tee, 'conveyor').routingRules).map(rule => rule.field), ['width', 'color']);
  await change('Clasificación · Atributo regla 1', 'defect');
  assert.deepStrictEqual(labelled(editor.inspector, 'Clasificación · Comparación regla 1').children.map(option => option.value), ['eq', 'neq'], 'Enum attributes cannot expose numeric comparisons.');
  await change('Clasificación · Valor regla 1', 'surface'); await change('Clasificación · Destino regla 1', 'main');
  const rules = cfg(tee, 'conveyor').routingRules;
  await change('Clasificación · Salida sin coincidencia', 'branch'); assert.equal(cfg(tee, 'conveyor').routingDefault, 'branch');
  await editor.perform(() => editor.historyStep('undo')); assert.equal(cfg(tee, 'conveyor').routingDefault, 'main');
  await editor.perform(() => editor.historyStep('redo')); assert.equal(cfg(tee, 'conveyor').routingDefault, 'branch');
  await change(modeLabel, 'percentage'); await change('Clasificación · Porcentaje a la salida lateral', 25.5);
  assert.equal(cfg(tee, 'conveyor').branchPercentage, 25.5);
  assert(all(editor.inspector).some(node => node.textContent.includes('acumulado y equilibrado')));
  assert(!labelled(editor.inspector, 'Clasificación · Salida sin coincidencia'));
  await change(modeLabel, 'rules'); assert.equal(cfg(tee, 'conveyor').routingRules, rules, 'Changing distribution mode preserves the authored rules.');
  await labelled(editor.inspector, 'Quitar regla de clasificación 2').click(); assert.equal(JSON.parse(cfg(tee, 'conveyor').routingRules).length, 1);
  await editor.perform(() => editor.historyStep('undo')); assert.equal(cfg(tee, 'conveyor').routingRules, rules);
  await change('Banda transportadora simulada · Tipología', 'straight');
  assert(!labelled(editor.inspector, modeLabel)); assert(!all(editor.inspector).some(node => node.textContent === 'CLASIFICACIÓN / DECISIONES DE SALIDA'));
  await change('Banda transportadora simulada · Tipología', 'tee');
  assert(editor.simulationVariables(tee).some(field => field.key === 'routedBranch' && !field.writable));
  const source = editor.document.addPrefab('hall', 'source'); editor.select(source);
  await press('+ Tipo de producto'); await change('Defecto producto 1', 'surface');
  let row = JSON.parse(cfg(source, 'source').catalog)[0]; assert.equal(row.quality, 'defective'); assert.equal(row.defect, 'surface');
  const previousUndo = editor.document.undoStack.length; await change('Calidad producto 1', 'good');
  row = JSON.parse(cfg(source, 'source').catalog)[0]; assert.equal(row.quality, 'good'); assert.equal(row.defect, 'none');
  assert.equal(editor.document.undoStack.length, previousUndo + 1, 'Changing catalog quality and its defect is a single atomic edit.');
  await editor.perform(() => editor.historyStep('undo')); assert.equal(JSON.parse(cfg(source, 'source').catalog)[0].defect, 'surface');
  await change('Source / generador y cola FIFO · Porcentaje de defectos simulados', 17.5);
  assert(labelled(editor.inspector, 'Source / generador y cola FIFO · Semilla de mezcla'), 'Failure simulation exposes its seed even without random product selection.');
  await change('Source / generador y cola FIFO · Tipo de defecto simulado', 'dimension');
  editor.document.setBehaviors(source, editor.document.getBehaviors(source).map(component => component.type === 'source' ? Object.assign({}, component, {autoGenerate: false}) : component));
  const product = editor.document.addPrefab('hall', 'product'); editor.select(product);
  const materials = []; product.traverse(node => { if (node.material) materials.push([node, node.material]); });
  await change('Producto manipulable / caja · Defecto', 'damaged'); assert.equal(cfg(product, 'product').quality, 'defective');
  await change('Producto manipulable / caja · Calidad', 'good'); assert.equal(cfg(product, 'product').defect, 'none');
  await change('Producto manipulable / caja · Color de clasificación', '#1144ff');
  materials.forEach(([node, material]) => assert.strictEqual(node.material, material, 'Classification metadata must not replace the authored material.'));
  const authored = await editor.document.serialize(); editor.leave();
  const variables = editor.simulation.records.get(tee.userData.editorId).variables;
  variables.routedMain = 7; variables.routedBranch = 3; variables.routingUnmatched = 2;
  editor.simulationPanel.objectSelect.value = tee.userData.editorId; editor.simulationPanel.render(true);
  assert(editor.simulationPanel.kpis.textContent.includes('principal 7 / lateral 3')); assert(editor.simulationPanel.kpis.textContent.includes('decisiones al entrar'));
  editor.enter(); assert.deepStrictEqual(await editor.document.serialize(), authored);
  const saved = await editor.saveProject('Clasificación configurable'); const reopened = harness(); await reopened.editor.ready;
  assert.deepStrictEqual(await reopened.editor.document.serialize(), saved.document, 'Rules, defaults, percentages and product/quality metadata survive saving.');
  assert.equal(ctx.renderer.xr.enabled, true); editor.projectSync.stop(); reopened.editor.projectSync.stop();
}

async function testInspectorComponents() {
  storage.clear(); remote.projects.clear(); remote.online = true;
  const {editor, roots, ctx} = harness();
  await editor.ready; editor.enter();
  const door = roots.hall.children[0], nativeState = ctx.raycontrol.states['native-door'];
  const originalGeometry = door.geometry;
  const all = root => [root].concat(root.children.flatMap(child => all(child)));
  const byLabel = label => all(editor.inspector).find(node => (node.getAttribute('aria-label') || '').includes(label));
  const byText = text => all(editor.inspector).find(node => node.tagName === 'BUTTON' && node.textContent === text);
  const settle = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };

  editor.select(door);
  assert(all(editor.inspector).some(node => node.textContent === 'FUNCIONES / COMPONENTES'));
  assert(all(editor.inspector).some(node => node.textContent === 'Portal / cambiar de sala'));
  const room = byLabel('Sala de destino');
  assert(room && room.tagName === 'SELECT', 'Selecting a native portal must expose its destination in the inspector.');
  room.value = '3'; await room.fire('change');
  assert.equal(editor.document.getBehaviors(door)[0].room, 3);
  const event = byLabel('Activar al');
  event.value = 'release'; await event.fire('change');
  assert.equal(editor.document.getBehaviors(door)[0].event, 'release');
  assert(all(editor.inspector).some(node => node.tagName === 'PRE' && node.textContent.includes('"room": 3')),
    'The configuration viewer must show the edited native parameters.');
  await byText('Copiar funciones').click();
  const copiedConfig = clone(editor.document.getBehaviors(door)[0]);
  const custom = editor.document.addPrimitive('hall', 'sphere');
  editor.document.setBehaviors(custom, [behaviorSchema.defaultBehavior('float')]);
  editor.select(custom);
  assert.equal(byText('Pegar funciones').disabled, false);
  await byText('Pegar funciones').click();
  assert.deepStrictEqual(editor.document.getBehaviors(custom).find(component => component.type === 'portal'), copiedConfig);
  assert(editor.document.getBehaviors(custom).some(component => component.type === 'float'), 'Pasting preserves other component types.');
  editor.document.setBehaviors(custom, editor.document.getBehaviors(custom).map(component => component.type === 'portal' ? Object.assign({}, component, {room: 6}) : component));
  assert.equal(editor.document.getBehaviors(door)[0].room, 3, 'Pasted component parameters are independently editable.');

  editor.select(door);
  let prevented = false;
  editor.onKey({code: 'KeyD', ctrlKey: true, metaKey: false, shiftKey: false, target: dom.body, preventDefault() { prevented = true; }});
  await settle();
  assert(prevented, 'Ctrl+D should be handled for a native selection.');
  const duplicate = editor.selected;
  assert(duplicate && duplicate !== door && !editor.document.isNative(duplicate));
  assert.deepStrictEqual(editor.document.getBehaviors(duplicate), [copiedConfig]);
  const duplicateEntry = editor.document.additions.get(duplicate.userData.editorId);
  const badgeCopy = duplicateEntry.nodes.get('0');
  assert(badgeCopy && badgeCopy.name === 'door-badge');
  assert.equal(editor.document.getBehaviors(badgeCopy)[0].amplitude, 0.05);
  assert(!badgeCopy.userData.editorNativeBehaviorTypes, 'Copies use their own runtime adapters.');

  editor.select(door);
  const visual = byLabel('Nuevo modelo visual'); visual.value = 'hall.glb';
  await byText('Reemplazar').click(); await settle();
  assert.strictEqual(editor.selected, door);
  assert.strictEqual(ctx.raycontrol.states['native-door'], nativeState);
  assert.strictEqual(nativeState.colliderMesh, door);
  assert.strictEqual(door.geometry, originalGeometry);
  assert.equal(door.material.visible, false, 'The original native mesh is hidden while its functional identity remains.');
  assert.equal(editor.document.getVisualDescriptor(door).path, 'hall.glb');
  assert.deepStrictEqual(editor.document.getBehaviors(door), [copiedConfig]);
  const serialized = await editor.document.serialize();
  const saved = await editor.saveProject('Componentes y modelos');
  assert.deepStrictEqual(saved.document, serialized);
  assert.equal(saved.document.rooms.hall.overrides[0].behaviors[0].room, 3);
  assert.equal(saved.document.rooms.hall.additions.find(record => record.id === duplicate.userData.editorId).nodes['0'].behaviors[0].amplitude, 0.05);
  const reloaded = harness(); await reloaded.editor.ready;
  assert.deepStrictEqual(await reloaded.editor.document.serialize(), serialized);
  const reloadedDoor = reloaded.roots.hall.children[0];
  assert.equal(reloaded.editor.document.getBehaviors(reloadedDoor)[0].event, 'release');
  assert.equal(reloaded.editor.document.getVisualDescriptor(reloadedDoor).path, 'hall.glb');
  assert.strictEqual(reloaded.ctx.raycontrol.states['native-door'].colliderMesh, reloadedDoor);
  assert.equal(reloaded.ctx.renderer.xr.enabled, true);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
