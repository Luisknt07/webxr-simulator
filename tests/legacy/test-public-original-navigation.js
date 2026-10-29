const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const source = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-public-original-navigation.js"), '../src/editor/ProjectAccessView.js')), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class ProjectAccessView', 'return class ProjectAccessView');
const View = new Function('compileBlankProject', 'publicScenes', source)(null, require('../../projects/smarttwin/public-scenes'));
const catalog = require('../../projects/smarttwin/scenes/catalog.json'), payload = id => JSON.parse(fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-public-original-navigation.js"), '../assets/public-scenes', id + '.json')), 'utf8'));
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};};
async function run() {
  const previousDocument = global.document, previousFetch = global.fetch;
  global.document = {baseURI: 'https://example.github.io/simulator/'};
  try {
    for (const staticPublic of [true, false]) {
      const calls = [], applications = [], editor = {staticPublic, serverCapabilities: {privateProjects: true}, ctx: {}, projectSync: {stop() {}}, document: {studio: {}},
        projectClient: {async request(method, route) {calls.push(route); return route === '/public/scenes' ? catalog : route === '/studio/me' ? {user: null} : payload(decodeURIComponent(route.slice('/public/scenes/'.length)));}},
        async applyServerProject(project, options) {applications.push({project, options}); this.currentProject = project; this.roomId = project.allowedRoomIds[0];}};
      global.fetch = async url => {const id = path.basename(new URL(url).pathname, '.json'); calls.push(id); return {ok: true, json: async () => id === 'catalog' ? catalog : payload(id)};};
      const view = new View(editor);
      await view.initialize(new URLSearchParams('room=photogrammetry'));
      assert.equal(editor.currentProject.publicSceneId, 'original-photogrammetry', 'An explicit native-room URL resolves its public original, not an unrelated template.'); assert.deepEqual(editor.currentProject.allowedRoomIds, ['photogrammetry']);
      assert.equal(view.canVisit('sound'), false); const before = calls.length;
      assert.equal(await view.visitPublicRoom('sound'), true); assert.equal(editor.currentProject.publicSceneId, 'original-sound'); assert.deepEqual(editor.currentProject.allowedRoomIds, ['sound']); assert.equal(view.canVisit('photogrammetry'), false); assert.equal(view.canEdit(), false);
      assert.equal(applications[1].options.roomId, 'sound'); assert.equal(applications[1].options.accessGeneration, view.identityGeneration); assert.equal(calls.slice(before).filter(call => /original-sound$/.test(call)).length, 1);
      editor.currentProject = payload('l-transfer').project; assert.equal(await view.visitPublicRoom('vertigo'), false, 'Template links cannot hop into unrelated public rooms.');
      editor.currentProject = {id: 'private-project', allowedRoomIds: ['hall']}; const privateBefore = calls.length; assert.equal(await view.visitPublicRoom('sound'), false); assert.equal(calls.length, privateBefore, 'Private projects never invoke the original-scene escape path.');
      editor.currentProject = payload('original-hall').project; view.publicCatalog = async () => Object.assign({}, catalog, {previewAllExamples: false}); assert.equal(await view.visitPublicRoom('sound'), false, 'Reverting preview revokes native-portal hopping.');
      view.publicCatalog = async () => catalog; const pending = deferred(); view.publicProject = () => pending.promise; const staleCount = applications.length;
      const pendingVisit = view.visitPublicRoom('panorama1'); await Promise.resolve(); view.identityGeneration++; pending.resolve(payload('original-panorama1')); assert.equal(await pendingVisit, false); assert.equal(applications.length, staleCount, 'A late portal response cannot replace a newly authorized identity/world.');
      assert.equal(await view.visitPublicRoom('../private'), false);
    }
    console.log('Public original navigation: server and Pages explicit native URLs, lazy single-room portal projections, read-only scope, template/private restrictions, policy reversal and stale-identity cancellation passed.');
  } finally {global.document = previousDocument; global.fetch = previousFetch;}
}
run().catch(error => {console.error(error); process.exitCode = 1;});
