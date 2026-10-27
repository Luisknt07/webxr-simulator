'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const {ProjectStore} = require('../server/storage'), {createApiHandler} = require('../server/api'), {validateDocument} = require('../server/validation');
const publicExamples = require('../shared/public-scenes');
async function run() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'webxr-public-examples-')), store = new ProjectStore({dataDir: temporary});
  const privateDocument = {format: 'hello-webxr-editor', version: 1, imports: [], rooms: {hall: {additions: [], overrides: [{id: 'native:hall:root.0', name: 'PRIVATE_SENTINEL'}]}, sound: {additions: [], overrides: []}}};
  const privateProject = store.saveProject(null, {name: 'PRIVATE_PROJECT', document: privateDocument}), errors = [];
  const api = createApiHandler({store, maintenanceIntervalMs: 0, onError: error => errors.push(error)}), server = http.createServer(api);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = 'http://127.0.0.1:' + server.address().port;
  async function request(url, method = 'GET', body, cookie) {const response = await fetch(base + '/api' + url, {method, headers: Object.assign({}, body === undefined ? {} : {'Content-Type': 'application/json'}, cookie ? {cookie} : {}), body: body === undefined ? undefined : JSON.stringify(body)}); return {status: response.status, body: await response.json(), cookie: (response.headers.get('set-cookie') || '').split(';')[0]};}
  try {
    const beforeSelection = api.studio.access.publicationSettings().scenes, beforePrivate = JSON.stringify(store.getProject(privateProject.id));
    const getProject = store.getProject.bind(store), requireProject = store._requireProject.bind(store);
    store.getProject = () => {throw new Error('Example preview must never read a saved user project');}; store._requireProject = store.getProject;
    const catalog = await request('/public/scenes'); assert.equal(catalog.status, 200); assert.equal(catalog.body.previewAllExamples, true); assert.equal(catalog.body.scenes.length, 30);
    assert.equal(catalog.body.scenes.filter(scene => scene.original).length, 10); assert.equal(catalog.body.scenes.filter(scene => scene.templateId).length, 19); assert.equal(new Set(catalog.body.scenes.map(scene => scene.id)).size, 30);
    for (const scene of catalog.body.scenes) {
      const response = await request('/public/scenes/' + scene.id); assert.equal(response.status, 200, scene.id + ':' + JSON.stringify(response.body)); const project = response.body.project;
      validateDocument(project.document, () => {throw new Error('An included example cannot resolve server imports');});
      assert.deepEqual(Object.keys(project.document.rooms), [scene.roomId]); assert.deepEqual(project.allowedRoomIds, [scene.roomId]); assert.equal(project.access.canEdit, false); assert.equal(project.access.canShare, false); assert.equal(project.document.imports.length, 0);
      assert(!JSON.stringify(project).includes('PRIVATE_SENTINEL')); assert(!JSON.stringify(project).includes('/api/assets/'));
      assert(project.document.rooms[scene.roomId].overrides.every(row => Object.keys(row).every(key => ['id', 'visible'].includes(key)) && row.visible === false));
      if (['cedi-sorting', 'cedi-packing', 'industrial-lab-complete'].includes(scene.id)) {const rows = project.document.rooms[scene.roomId].additions; assert.equal(rows.filter(row => (row.behaviors || []).some(c => c.type === 'robot')).length, 3); assert(rows.some(row => (row.behaviors || []).some(c => c.type === 'vehicle' && c.sourceId && c.outputId)));}
      assert(api.studio.access.exampleProjects.size <= 2, 'Serving a gallery does not retain thirty scene documents.');
    }
    store.getProject = getProject; store._requireProject = requireProject;
    assert.equal((await request('/projects/' + privateProject.id)).status, 401); assert.equal((await request('/public/scenes/' + privateProject.id)).status, 404);
    const admin = await request('/studio/register', 'POST', {username: 'preview_admin', displayName: 'Preview admin', password: 'Fixture-preview-password123'}); assert.equal(admin.status, 201);
    const ordinary = await request('/studio/register', 'POST', {username: 'preview_user', displayName: 'Preview user', password: 'Fixture-preview-password123'}); assert.equal(ordinary.status, 201);
    assert.equal((await request('/publication/scenes', 'PUT', {previewAllExamples: false}, ordinary.cookie)).status, 403);
    const disabled = await request('/publication/scenes', 'PUT', {previewAllExamples: false}, admin.cookie); assert.equal(disabled.status, 200); assert.equal(disabled.body.scenes.length, 2); assert.equal(disabled.body.previewAllExamples, false);
    assert.equal((await request('/public/scenes/cedi-sorting')).status, 404); assert.equal((await request('/library/scenes')).status, 401);
    assert.equal(api.studio.access.canDownloadPublicExample({headers: {}}, 'cedi-sorting.json'), false, 'A restricted server also denies direct static example JSON.');
    assert.equal(api.studio.access.canDownloadPublicExample({headers: {}}, 'l-transfer.json'), true); assert.equal(api.studio.access.canDownloadPublicExample({headers: {}}, '../private.json'), false);
    assert.equal(api.studio.access.canDownloadPublicExample({headers: {cookie: ordinary.cookie}}, 'cedi-sorting.json'), true, 'Signed-in example access remains available in restricted mode.');
    assert.match(fs.readFileSync(path.join(__dirname, '../webpack.config.js'), 'utf8'), /assets\\\/public-scenes[\s\S]*canDownloadPublicExample/, 'The actual static middleware uses the same reversible policy.');
    assert.deepEqual(api.studio.access.publicationSettings().scenes, beforeSelection, 'Reverting preview restores the untouched publication selection.');
    const restored = await request('/publication/scenes', 'PUT', {previewAllExamples: true}, admin.cookie); assert.equal(restored.body.scenes.length, 30); assert.equal(JSON.stringify(store.getProject(privateProject.id)), beforePrivate);
    assert.equal((await request('/publication/scenes', 'PUT', {previewAllExamples: 'yes'}, admin.cookie)).status, 400); assert.equal(errors.length, 0);
    const contaminated = {format: 'hello-webxr-editor', version: 1, owner: 'PRIVATE_OWNER', rooms: privateDocument.rooms, imports: [{id: 'private-import', url: '/api/assets/private'}], studio: {version: 1, resources: [{secret: 'PRIVATE_RESOURCE'}], scenes: [{id: 'hall', name: 'Example'}, {id: 'sound', name: 'PRIVATE_ROOM'}]}};
    const safe = publicExamples.project(contaminated, {id: 'fixture', name: 'Fixture', roomId: 'hall'}); assert(!JSON.stringify(safe).includes('PRIVATE_')); assert.deepEqual(safe.document.rooms.hall.overrides, []); assert.deepEqual(safe.document.imports, []);
    const staticRoot = path.join(temporary, 'static-fixture'); fs.mkdirSync(path.join(staticRoot, 'assets/public-scenes'), {recursive: true});
    for (const name of ['angel.min.glb', 'vertigo.glb']) fs.copyFileSync(path.join(__dirname, '../assets', name), path.join(staticRoot, 'assets', name));
    fs.writeFileSync(path.join(staticRoot, 'assets/public-scenes/stale-example.json'), '{}');
    const generated = await require('./generate-public-scenes')(staticRoot, {previewAllExamples: false}); assert.deepEqual(generated.map(scene => scene.id), ['l-transfer', 'inspection-sorting']);
    const restricted = JSON.parse(fs.readFileSync(path.join(staticRoot, 'assets/public-scenes/catalog.json'), 'utf8')); assert.equal(restricted.previewAllExamples, false); assert.equal(restricted.scenes.length, 2); assert(!fs.existsSync(path.join(staticRoot, 'assets/public-scenes/stale-example.json')), 'Restricted Pages regeneration removes formerly public example projections.');
    assert.equal(JSON.stringify(store.getProject(privateProject.id)), beforePrivate, 'Static generation never modifies the server fixture or its private data.');
    console.log('Public examples policy:30 visitor examples (19 templates +10 originals +Lab), current robotic cells, demand-only bounded cache, no saved-project reads/imports/private overrides, read-only projections, admin-only reversible policy and unchanged private data passed.');
  } finally {await new Promise(resolve => server.close(resolve)); api.close(); const target = path.resolve(temporary); if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith('webxr-public-examples-')) throw new Error('Unexpected fixture directory'); fs.rmSync(target, {recursive: true, force: true});}
}
run().catch(error => {console.error(error); process.exitCode = 1;});
