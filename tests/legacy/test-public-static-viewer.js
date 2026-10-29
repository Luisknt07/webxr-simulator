const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const publicScenes = require('../../projects/smarttwin/public-scenes');
const {validateDocument} = require('../../apps/api/server/validation');
const root = __layout.map(path.resolve(__layout.oldDir("scripts/test-public-static-viewer.js"), '..'));
const read = file => fs.readFileSync(__layout.map(path.join(root, file)), 'utf8');
const source = read("packages/tools/editor/src/ProjectAccessView.js").replace(/^import .*;\r?\n/gm, '').replace('export default class ProjectAccessView', 'return class ProjectAccessView');
const View = new Function('compileBlankProject', 'publicScenes', source)(() => { throw new Error('Static visits never build editable projects.'); }, publicScenes);
const payload = id => JSON.parse(read("projects/smarttwin/scenes/" + id + '.json'));
const generatedCatalog = JSON.parse(read("projects/smarttwin/scenes/catalog.json"));
const expectedInventory = require('../../tooling/assets/validate-public-scenes').inventory();
const calls = [], applications = [];
const editor = {staticPublic: true, editorEnabled: true, roomId: 'hall', serverCapabilities: {},
  ctx: {renderer: {domElement: {style: {}}}}, document: {rooms: new Map(), studio: {}},
  projectSync: {stop() { editor.stopped = true; }}, toast() {}, leave() { this.active = false; },
  projectClient: {request() { throw new Error('A static viewer must not request the account/project API.'); }},
  async applyServerProject(project) { applications.push(project); this.currentProject = project; this.roomId = project.allowedRoomIds[0]; }};
const view = new View(editor); editor.accessView = view;

async function run() {
  const previousFetch = global.fetch, previousDocument = global.document, previousWindow = global.window;
  global.document = {baseURI: 'https://example.github.io/simulator/'};
  global.window = {location: 'https://example.github.io/simulator/editor?project=private-project'};
  global.fetch = async (url, options) => {
    calls.push({url, options});
    const parsed = new URL(url); assert.equal(parsed.origin, 'https://example.github.io');
    assert(parsed.pathname.startsWith('/simulator/projects/smarttwin/scenes/'), 'Static resources retain the GitHub Pages subdirectory.');
    const id = path.basename(parsed.pathname, '.json'); return {ok: true, json: async () => id === 'catalog' ? generatedCatalog : payload(id)};
  };
  try {
    assert.equal(view.enabled, true); assert.equal(view.canEdit(), false, 'Even a direct editor URL stays read-only without its server.');
    const catalog = await view.publicCatalog(); assert.equal(catalog.scenes.length, expectedInventory.includedCount); assert.equal(calls.length, 1, 'Only catalog metadata is fetched; no unselected scene document is requested.');
    for (const scene of catalog.scenes) {
      const result = payload(scene.id); assert.deepEqual(result.project, publicScenes.project(result.project.document, scene), 'Public artifacts are bounded safe projections of included recipes.');
      assert.deepEqual(Object.keys(result.project.document.rooms), [scene.roomId]);
      assert.equal(result.project.document.imports.length, 0); assert(!JSON.stringify(result).includes('/api/assets/'));
      validateDocument(result.project.document, value => value);
      assert.equal(result.project.access.canEdit, false); assert.equal(result.project.access.canShare, false);
    }
    await view.initialize(new URLSearchParams('project=private-project&libraryScene=advanced-hall'));
    assert.equal(applications.length, 1); assert.equal(editor.currentProject.publicSceneId, 'l-transfer');
    assert.equal(editor.initialIdentity.user, null); assert.equal(editor.initialIdentity.staticPublic, true); assert.equal(editor.projectClient.identityProvider(), null);
    assert.equal(view.canVisit('sound'), false); assert.equal(view.canVisit('hall'), true);
    await view.initialize(new URLSearchParams('room=sound'));
    assert.equal(editor.currentProject.publicSceneId, 'original-sound'); assert.equal(view.canVisit('sound'), true); assert.equal(view.canVisit('hall'), false);
    await assert.rejects(() => view.publicProject('../private'), /no está incluida/); assert.equal(calls.length, 3);
    assert(calls.every(call => call.options.credentials === 'omit'), 'Static resources never send account credentials.');

    const editorSource = read("packages/tools/editor/src/SceneEditor.js");
    const initialize = editorSource.slice(editorSource.indexOf('  async initialize()'), editorSource.indexOf('  get roomId()'));
    const Initializer = new Function('return class Initializer {\n' + initialize + '\n}')();
    const boot = new Initializer(); let runtimeStarts = 0, editorStarts = 0;
    Object.assign(boot, {editorEnabled: true, serverCapabilities: {}, roomId: 'hall', ctx: {}, library: {async getCatalog() { return []; }},
      projectClient: editor.projectClient, document: {rooms: new Map(), studio: {}}, projectSync: {stop() {}, start() { throw new Error('Static authoring sync must not start.'); }},
      async checkStorageHealth() { throw new Error('HTML 404 from a static host'); }, async applyServerProject(project) { this.currentProject = project; },
      async prepareRoom() {}, startRuntime() { runtimeStarts++; }, enter() { editorStarts++; }, canEditDocument() { return this.accessView.canEdit(); },
      renderAssets() {}, toast() {}, updateStatus() {}, rememberProject() {}});
    boot.accessView = new View(boot); await boot.initialize();
    assert.equal(boot.staticPublic, true); assert.equal(boot.storageAvailable, false); assert.equal(boot.initializing, false);
    assert.equal(runtimeStarts, 1); assert.equal(editorStarts, 0); assert.equal(boot.currentProject.publicSceneId, 'l-transfer');

    // Use the existing real Three.js / RayControl fixture for immersive gallery
    // routing. Only network/Canvas/headset boundaries are adapted there.
    const menuSource = read("tests/legacy/test-immersive-studio-menu.js");
    const fixture = new Function('require', '__dirname', menuSource.slice(0, menuSource.indexOf('\nasync function run()')) + '\nreturn {harness};')(require, __dirname).harness();
    fixture.editor.staticPublic = true; fixture.editor.accessView = new View(fixture.editor);
    fixture.editor.projectClient.request = () => { throw new Error('XR static gallery must not call the API.'); };
    fixture.menu.setVR(true); fixture.menu.tick(.016); fixture.menu.navigate('scenes');
    await fixture.menu.loadList('scenes'); assert.equal(fixture.menu.items.length, expectedInventory.includedCount);
    await fixture.menu.chooseItem(fixture.menu.items[1]); assert.equal(fixture.applications[0].project.publicSceneId, 'inspection-sorting');
    fixture.menu.open('account'); fixture.menu.tick(.016);
    assert(!fixture.menu.regions.some(region => region.key.startsWith('field:')), 'Static XR never invites password input for an unavailable account service.');
    fixture.menu.fields.password = 'temporary-test-value'; await fixture.menu.authenticate();
    assert.equal(fixture.menu.fields.password, ''); assert.equal(fixture.writes.length, 0); assert.match(fixture.menu.error, /requieren el servidor/);
    fixture.menu.dispose();
    console.log('Static public viewer:' + expectedInventory.includedCount + ' bounded included projections, metadata-only lazy catalog, Pages subdirectory URLs, no account/private API or imports, read-only access, desktop selection and immersive gallery/account state passed.');
  } finally { global.fetch = previousFetch; global.document = previousDocument; global.window = previousWindow; }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
