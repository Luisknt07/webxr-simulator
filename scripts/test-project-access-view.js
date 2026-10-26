'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../src/editor/ProjectAccessView.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class ProjectAccessView', 'return class ProjectAccessView');
const View = new Function('compileBlankProject', source)(async () => ({name: 'Nuevo proyecto', document: {rooms: {}, studio: {scenes: [{id: 'hall'}]}}}));
const user = {id: 'user-a', permissions: {editor: true}};
const room = id => ({rooms: {[id]: {overrides: [], additions: []}}, studio: {startRoomId: id, scenes: [{id}]}});
const privateProject = {id: 'private-a', name: 'Private A', revision: 1, document: room('hall'), access: {role: 'owner', canEdit: true}};
const publicScenes = [{id: 'l-transfer', roomId: 'hall', name: 'L'}, {id: 'inspection-sorting', roomId: 'sound', name: 'Inspection'}];
const publicProject = id => { const scene = publicScenes.find(value => value.id === id); return {id: 'public-' + id, name: scene.name, document: room(scene.roomId), access: {role: 'public', canEdit: false}, allowedRoomIds: [scene.roomId], publicSceneId: id}; };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; };
const editorSource = fs.readFileSync(path.join(__dirname, '../src/editor/SceneEditor.js'), 'utf8');
const applyMethods = editorSource.slice(editorSource.indexOf('  async applyServerProject('), editorSource.indexOf('  async keepCurrentProject('));
const ProjectApplication = new Function('ROOM_IDS', 'return class ProjectApplication {\n' + applyMethods + '\n}')( ['hall', 'sound']);

function harness(identity = null, editing = false, requestOverride) {
  const calls = [], applied = [], notices = [], roots = new Map([['hall', {root: {visible: true}}], ['sound', {root: {visible: true}}]]);
  const editor = {serverCapabilities: {privateProjects: true}, editorEnabled: editing, ctx: {renderer: {domElement: {style: {}}}},
    roomId: 'hall', currentProject: null, document: {rooms: roots, studio: {scenes: [{id: 'hall'}, {id: 'sound'}]}},
    projectSync: {stop() {}}, clearObjectClipboard() { this.clipboardCleared = true; }, toast(message) { notices.push(message); },
    scopedStorageKey: key => key + ':user-a', leave() { this.active = false; },
    async applyServerProject(project) { applied.push(project); this.currentProject = project; this.roomId = project.allowedRoomIds && project.allowedRoomIds[0] || project.document.studio.startRoomId; },
    projectClient: {async request(method, pathname) {
      calls.push(pathname); if (requestOverride) { const result = requestOverride(method, pathname); if (result !== undefined) return result; }
      if (pathname === '/studio/me') return {user: identity};
      if (pathname === '/public/scenes') return {scenes: publicScenes};
      if (pathname.startsWith('/public/scenes/')) return {project: publicProject(pathname.slice('/public/scenes/'.length))};
      if (pathname.startsWith('/library/scenes/')) return {project: {id: 'library-fundamentals-sound', name: 'Included', document: room('sound'), librarySceneId: 'fundamentals-sound', allowedRoomIds: ['sound'], access: {role: 'library', canEdit: false}}};
      throw new Error('Unexpected request: ' + pathname);
    }, async listProjects() { calls.push('listProjects'); return [privateProject]; }, async getProject(id) { calls.push('getProject:' + id); if (editor.privatePending) return editor.privatePending; return privateProject; }}
  };
  const view = new View(editor); editor.accessView = view; return {editor, view, calls, applied, notices};
}

async function run() {
  const previousWindow = global.window, previousStorage = global.localStorage;
  global.window = {location: 'http://localhost/editor'};
  global.localStorage = {getItem() { return null; }};
  try {
    const guest = harness(); await guest.view.initialize(new URLSearchParams('project=private-a'));
    assert.equal(guest.editor.currentProject.publicSceneId, 'l-transfer'); assert(!guest.calls.includes('getProject:private-a'));
    assert.equal(guest.view.canEdit(), false); assert.equal(guest.view.canVisit('hall'), true); assert.equal(guest.view.canVisit('sound'), false);
    guest.editor.loadingAllowedRoomIds = ['sound']; assert.equal(guest.view.canVisit('sound'), true); delete guest.editor.loadingAllowedRoomIds;
    guest.editor.accessLoadFailed = true; assert.equal(guest.view.canVisit('hall'), false);

    const landing = harness(); await landing.view.initialize(new URLSearchParams('scene=inspection-sorting')); assert.equal(landing.editor.currentProject.allowedRoomIds[0], 'sound');
    const compatibilityLink = harness(); await compatibilityLink.view.initialize(new URLSearchParams('project=public-inspection-sorting')); assert.equal(compatibilityLink.editor.currentProject.publicSceneId, 'inspection-sorting');
    const included = harness(user, false); await included.view.initialize(new URLSearchParams('libraryScene=fundamentals-sound')); assert.equal(included.editor.currentProject.librarySceneId, 'fundamentals-sound'); assert.equal(included.view.canEdit(), false);
    const includedEditor = harness(user, true); await includedEditor.view.initialize(new URLSearchParams('project=library-fundamentals-sound')); assert.equal(includedEditor.editor.currentProject.librarySceneId, 'fundamentals-sound', 'an included scene link wins over the remembered editable project');
    const publicEditor = harness(user, true); await publicEditor.view.initialize(new URLSearchParams('project=public-inspection-sorting')); assert.equal(publicEditor.editor.currentProject.publicSceneId, 'inspection-sorting');
    const denied = harness(null); await denied.view.initialize(new URLSearchParams('libraryScene=fundamentals-sound')); assert(!denied.calls.some(value => value.startsWith('/library/')));

    const editing = harness(user, true); await editing.view.initialize(new URLSearchParams()); assert.equal(editing.editor.currentProject.id, 'private-a'); assert.equal(editing.view.canEdit(), true);
    editing.editor.currentProject.access = {role: 'viewer', canEdit: false}; assert.equal(editing.view.canEdit(), false);
    editing.editor.active = true; editing.editor.creatingScene = true; editing.editor.authoringRoomId = 'photogrammetry';
    assert.equal(editing.view.canVisit('photogrammetry'), false, 'read-only projections cannot use the authoring destination');
    editing.editor.currentProject.access = {role: 'owner', canEdit: true};
    assert.equal(editing.view.canVisit('photogrammetry'), true, 'one authorized creation destination can be prepared before metadata is committed');
    editing.editor.creatingScene = false; assert.equal(editing.view.canVisit('photogrammetry'), false, 'the temporary authoring permission ends with the creation operation');
    delete editing.editor.authoringRoomId;
    editing.editor.currentProject.access = {role: 'owner', canEdit: true}; editing.editor.ctx.studio = {client: {user: null}}; assert.equal(editing.view.canEdit(), false, 'an old cached identity cannot override an explicitly logged-out client');
    global.localStorage = {getItem() { throw new Error('Storage denied'); }};
    const noStorage = harness(user, true); await noStorage.view.initialize(new URLSearchParams()); assert.equal(noStorage.editor.currentProject.id, 'private-a');

    const pendingPrivate = deferred(), changing = harness(user, true); changing.editor.privatePending = pendingPrivate.promise;
    const initializing = changing.view.initialize(new URLSearchParams('project=private-a'));
    await Promise.resolve(); await Promise.resolve(); await changing.view.accountChanged(null);
    pendingPrivate.resolve(privateProject); await initializing;
    assert(!changing.applied.some(value => value.id === 'private-a'), 'an old authorized request cannot reapply a private world after logout');
    assert.equal(changing.view.user, null);

    const pendingIdentity = deferred(), stale = harness(user, false, (_method, pathname) => pathname === '/studio/me' ? pendingIdentity.promise : undefined);
    stale.view.user = user; const opening = stale.view.initialize(new URLSearchParams()); await stale.view.accountChanged(null);
    pendingIdentity.resolve({user}); await opening; assert.equal(stale.view.user, null, 'a stale identity response is discarded before assigning user');
    assert.equal(stale.editor.currentProject.access.role, 'public');

    const pendingPublic = deferred(), hidden = harness(null, false, (_method, pathname) => pathname === '/public/scenes' ? pendingPublic.promise : undefined);
    hidden.view.user = user; hidden.editor.active = true;
    const loggingOut = hidden.view.accountChanged(null);
    assert.equal(hidden.editor.ctx.renderer.domElement.style.visibility, 'hidden', 'logout hides the canvas synchronously before fetching');
    assert([...hidden.editor.document.rooms.values()].every(entry => !entry.root.visible)); assert(hidden.editor.clipboardCleared);
    pendingPublic.resolve({scenes: publicScenes}); await loggingOut; assert.equal(hidden.editor.ctx.renderer.domElement.style.visibility, '');

    // Exercise the real SceneEditor application queue and post-await scope guard
    // without instantiating a renderer or substituting its implementation.
    const application = new ProjectApplication(), loading = deferred(), loaded = [], shown = [];
    Object.assign(application, {accessView: {enabled: true, identityGeneration: 0}, roomId: 'hall', projectGeneration: 0, active: false,
      transform: {enabled: false}, document: {rooms: new Map([['hall', {root: {visible: true}}]]), undoStack: [], redoStack: [], async load(value) { loaded.push(value); if (value === privateProject.document) await loading.promise; }},
      library: {async getCatalog() { return []; }}, hooks: {async gotoRoom(index) { application.roomId = ['hall', 'sound'][index]; }},
      assetThumbnails: {dispose() {}}, decals: {dispose() {}}, infoPreview: {dispose() {}}, simulationPanel: {modeChanged() {}},
      async prepareRoom() {}, startRuntime() { shown.push(this.currentProject.id); }});
    for (const method of ['cancelTransformDrag', 'clearAssembly', 'clearNavigation', 'clearAssetPreview', 'cancelDecalPlacement', 'stopRuntime', 'clearObjectClipboard', 'select', 'renderAssets', 'syncNative', 'rememberProject', 'markRemoteProject', 'updateStatus']) application[method] = () => {};
    const oldApplication = application.applyServerProject(privateProject); await Promise.resolve(); await Promise.resolve();
    application.accessView.identityGeneration++;
    const nextApplication = application.applyServerProject(publicProject('l-transfer'));
    assert.equal(loaded.length, 1, 'document applications serialize while an old private load is pending');
    const rejected = assert.rejects(oldApplication, /cuenta cambi/); loading.resolve(); await rejected; await nextApplication;
    assert.equal(application.currentProject.access.role, 'public'); assert.deepEqual(shown, ['public-l-transfer']);
    assert.equal(application.document.rooms.get('hall').root.visible, false, 'invalidated load hides the old roots before the public replacement');
    console.log('Project access view: public/library links, guest restrictions, global/project edit permissions, optional local storage and delayed response isolation after logout passed.');
  } finally { global.window = previousWindow; global.localStorage = previousStorage; }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
