const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const {ProjectStore} = require('../../apps/api/server/storage'), {createApiHandler} = require('../../apps/api/server/api');
const empty = () => ({format: 'hello-webxr-editor', version: 1, imports: [], rooms: {hall: {overrides: [], additions: []}}});
async function run() {
  const temporary = fs.mkdtempSync(__layout.map(path.join(os.tmpdir(), 'hello-project-access-'))); let now = Date.now();
  const store = new ProjectStore({dataDir: temporary}); const legacy = store.saveProject(null, {name: 'Legacy preserved', document: empty()});
  const errors = [], api = createApiHandler({allowBootstrapRegistration:true, publicSceneId:null, requireSecureCookies:false, store, now: () => now, maintenanceIntervalMs: 0, onError: error => errors.push(error)}), server = http.createServer(api);
  // This suite retains coverage of normal restricted publication; the separate
  // public-examples-policy suite covers the temporary default preview mode.
  store.db.prepare("INSERT OR REPLACE INTO studio_settings(key,value) VALUES('public-examples-preview','0')").run();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = 'http://127.0.0.1:' + server.address().port;
  async function request(url, method = 'GET', data, cookie, headers = {}) {
    const binary = Buffer.isBuffer(data), response = await fetch(base + url, {method, headers: Object.assign({}, data === undefined ? {} : {'Content-Type': binary ? 'application/octet-stream' : 'application/json'}, cookie ? {Cookie: cookie} : {}, headers), body: data === undefined ? undefined : binary ? data : JSON.stringify(data)});
    const body = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.arrayBuffer(); return {status: response.status, data: body, cookie: response.headers.get('set-cookie')?.split(';')[0], headers: response.headers};
  }
  async function register(username) { const result = await request('/api/studio/register', 'POST', {username, displayName: username, password: 'Local-fixture-password-123'}); assert.equal(result.status, 201, JSON.stringify(result.data)); return {cookie: result.cookie, user: result.data.user}; }
  try {
    assert.equal((await request('/api/projects')).status, 401); assert.equal((await request('/api/projects', 'POST', {name: 'Blocked', document: empty()})).status, 401);
    const publicList = await request('/api/public/scenes'); assert.equal(publicList.status, 200); assert.equal(publicList.data.scenes.length, 2);
    for (const scene of publicList.data.scenes) { const response = await request('/api/public/scenes/' + scene.id); assert.equal(response.status, 200); assert.deepEqual(Object.keys(response.data.project.document.rooms), [scene.roomId]); assert.deepEqual(response.data.project.allowedRoomIds, [scene.roomId]); assert.equal(response.data.project.access.canEdit, false); }
    assert.equal((await request('/api/library/scenes')).status, 401);
    const admin = await register('admin_fixture'), alpha = await register('alpha_fixture'), beta = await register('beta_fixture'), gamma = await register('gamma_fixture');
    assert(admin.user.superadmin); assert.equal(alpha.user.permissions.createProject, true); assert.equal(alpha.user.quota.maxProjects, 2); assert.equal(alpha.user.quota.storageBytes, 20 * 1024 * 1024);
    assert.equal((await request('/api/projects/' + legacy.id, 'GET', undefined, alpha.cookie)).status, 403); assert.equal((await request('/api/projects/' + legacy.id, 'GET', undefined, admin.cookie)).status, 200);
    const library = await request('/api/library/scenes', 'GET', undefined, alpha.cookie); assert.equal(library.data.scenes.length, 16); assert.equal((await request('/api/library/scenes/fundamentals-hall', 'GET', undefined, alpha.cookie)).data.project.allowedRoomIds[0], 'hall');
    const one = await request('/api/projects', 'POST', {name: 'Alpha one', document: empty()}, alpha.cookie), two = await request('/api/projects', 'POST', {name: 'Alpha two', document: empty()}, alpha.cookie); assert.equal(one.status, 201); assert.equal(two.status, 201);
    assert.equal((await request('/api/projects', 'POST', {name: 'Alpha excess', document: empty()}, alpha.cookie)).data.code, 'project_quota_exceeded');
    assert.equal((await request('/api/projects/' + one.data.project.id, 'GET', undefined, beta.cookie)).status, 403);
    assert.deepEqual((await request('/api/projects', 'GET', undefined, beta.cookie)).data.projects, []);
    assert.equal((await request('/api/projects', 'GET', undefined, alpha.cookie, {'x-studio-user': beta.user.id})).status, 409);
    const bytes = Buffer.from('Private fixture asset.'), upload = await request('/api/assets', 'POST', bytes, alpha.cookie, {'x-asset-mime': 'text/plain'}); assert.equal(upload.status, 201);
    const asset = upload.data.asset; assert.equal((await request(asset.url)).status, 401); assert.equal((await request(asset.url, 'GET', undefined, beta.cookie)).status, 403);
    const imported = empty(); imported.imports.push(Object.assign({id: 'import-fixture', path: 'notes.txt'}, asset));
    const saved = await request('/api/projects/' + one.data.project.id, 'PUT', {name: 'Alpha one', expectedRevision: 1, document: imported}, alpha.cookie); assert.equal(saved.status, 200);
    const projectId = one.data.project.id;
    assert.equal((await request('/api/projects/' + projectId + '/shares', 'PUT', {username: '  BETA_FIXTURE ', permission: 'viewer'}, alpha.cookie)).status, 200);
    assert.equal((await request('/api/projects/' + projectId + '/shares', 'PUT', {username: 'missing_fixture', permission: 'viewer'}, alpha.cookie)).status, 404);
    assert.equal((await request('/api/projects/' + projectId, 'GET', undefined, beta.cookie)).data.project.access.role, 'viewer');
    const viewed = await request(asset.url, 'GET', undefined, beta.cookie); assert.equal(viewed.status, 200); assert.equal(viewed.headers.get('cache-control'), 'private, no-store');
    assert.equal((await request('/api/projects/' + projectId, 'PUT', {name: 'Forbidden', expectedRevision: 2, document: imported}, beta.cookie)).status, 403);
    assert.equal((await request('/api/projects/' + projectId + '/shares', 'PUT', {userId: gamma.user.id, permission: 'editor'}, beta.cookie)).status, 403);
    await request('/api/projects/' + projectId + '/shares', 'PUT', {userId: beta.user.id, permission: 'editor'}, alpha.cookie);
    const edited = await request('/api/projects/' + projectId, 'PUT', {name: 'Shared edit', expectedRevision: 2, document: imported}, beta.cookie); assert.equal(edited.status, 200); assert.equal(edited.data.project.access.ownerId, alpha.user.id);
    const privateDocument = empty(); privateDocument.rooms.sound = {overrides: [], additions: []};
    privateDocument.studio = {version: 1, scenes: [{id: 'hall', name: 'Published fixture'}, {id: 'sound', name: 'Private fixture'}],
      templates: [{id: 'private-template', name: 'Synthetic private template', objects: [{format: 'hello-webxr-object', version: 1, record: {name: 'Synthetic confidential process'}, sources: []}]}],
      organization: {folders: [{id: 'private-folder', name: 'Synthetic private folder', parentId: null}], resources: [], favorites: []},
      widgets: ['hall', 'sound'].map(roomId => ({id: 'widget-' + roomId, name: 'Fixture ' + roomId, roomId, kind: 'text', text: 'Fixture ' + roomId}))};
    const historical = await request('/api/projects/' + projectId, 'PUT', {name: 'Without latest import', expectedRevision: 3, document: privateDocument}, alpha.cookie); assert.equal(historical.status, 200);
    assert.equal((await request(asset.url, 'GET', undefined, beta.cookie)).status, 200, "historical revisions retain authorized assets");
    const hosted = await request('/api/studio/rooms', 'POST', {projectId: two.data.project.id, projectRevision: 1, roomId: 'hall', state: {}, name: 'Temporary access'}, alpha.cookie); assert.equal(hosted.status, 201);
    assert.equal((await request('/api/studio/rooms/join', 'POST', {code: hosted.data.room.code}, gamma.cookie)).status, 200);
    assert.equal((await request('/api/projects/' + two.data.project.id, 'GET', undefined, gamma.cookie)).data.project.access.role, 'viewer');
    assert.equal((await request('/api/studio/rooms/' + hosted.data.room.id + '/leave', 'POST', {}, gamma.cookie)).status, 200);
    assert.equal((await request('/api/projects/' + two.data.project.id, 'GET', undefined, gamma.cookie)).status, 403, 'room membership does not grant permanent project access');
    assert(api.studio.access.usage(alpha.user.id).roomEventBytes > 0);
    const published = await request('/api/publication/scenes', 'PUT', {scenes: [{id: 'limited-fixture', projectId, roomId: 'hall', name: 'Selected scene'}]}, admin.cookie); assert.equal(published.status, 200);
    const publicDocument = (await request('/api/public/scenes/limited-fixture')).data.project.document;
    assert.equal(publicDocument.imports.length, 0);
    assert.deepEqual(Object.keys(publicDocument.rooms), ['hall']); assert.deepEqual(publicDocument.studio.scenes.map(scene => scene.id), ['hall']);
    assert.deepEqual(publicDocument.studio.widgets.map(widget => widget.id), ['widget-hall'], 'Published scene widgets remain functional while other rooms stay private.');
    assert.equal(publicDocument.studio.templates, undefined, 'Global templates have no scene ownership and must never leak through a public projection.');
    assert.equal(publicDocument.studio.organization, undefined, 'Private folder/resource names must not appear in a public scene.');
    const futureInput = structuredClone(historical.data.project.document); futureInput.studio.futurePrivateExtension = {synthetic: true};
    assert.equal(api.studio.access.projectProjection(futureInput, 'hall').studio.futurePrivateExtension, undefined, 'New global Studio fields are private unless explicitly projected.');
    const retained = (await request('/api/projects/' + projectId, 'GET', undefined, alpha.cookie)).data.project.document;
    assert.deepEqual(retained, historical.data.project.document, 'Public projection never mutates the complete private source, including its templates and organization.');
    assert.equal((await request(asset.url)).status, 401, 'a public room never publishes historical private asset imports');
    assert.equal((await request('/api/projects/' + projectId, 'DELETE', {}, alpha.cookie)).data.code, 'project_published');
    assert.equal((await request('/api/publication/scenes', 'PUT', {scenes: [{id: 'l-transfer', roomId: 'hall', name: 'L'}, {id: 'inspection-sorting', roomId: 'sound', name: 'Inspection'}]}, admin.cookie)).status, 200);
    assert(fs.existsSync(__layout.map(path.join(temporary, 'users', alpha.user.id, 'projects', projectId, 'project.json')))); assert(fs.existsSync(__layout.map(path.join(temporary, 'users', alpha.user.id, "assets", asset.sha256 + '.blob'))));
    const stolen = empty(); stolen.imports.push(Object.assign({id: 'stolen', path: 'notes.txt'}, asset)); assert.equal((await request('/api/projects', 'POST', {name: 'Stolen asset', document: stolen}, gamma.cookie)).status, 403);
    api.studio.access.setQuota(alpha.user.id, {storageBytes: 1024});
    const oldRevision = store.getProject(projectId).revision, beforeUsage = api.studio.access.usage(alpha.user.id), large = empty(); for (let i = 0; i < 20; i++) large.rooms.hall.additions.push({id: 'custom-fixture-' + i, name: 'A deliberately long object name for quota validation ' + i, descriptor: {type: 'box'}, position: [0,0,0], quaternion: [0,0,0,1], scale: [1,1,1]});
    assert.equal((await request('/api/projects/' + projectId, 'PUT', {name: 'Too large', expectedRevision: oldRevision, document: large}, alpha.cookie)).data.code, 'storage_quota_exceeded'); assert.equal(store.getProject(projectId).revision, oldRevision); assert.deepEqual(api.studio.access.usage(alpha.user.id), beforeUsage);
    assert.equal((await request('/api/assets', 'POST', Buffer.alloc(2048), alpha.cookie)).data.code, 'storage_quota_exceeded');
    api.studio.access.setQuota(alpha.user.id, {maxProjects: 3, storageBytes: 40 * 1024 * 1024}); assert.equal((await request('/api/projects', 'POST', {name: 'Expanded quota', document: empty()}, alpha.cookie)).status, 201);
    const tooPublic = await request('/api/publication/scenes', 'PUT', {scenes: [0,1,2].map(i => ({id: 'scene-' + i, projectId, roomId: 'hall', name: 'Public ' + i}))}, admin.cookie); assert.equal(tooPublic.data.code, 'public_scene_limit');
    assert.equal((await request('/api/publication/scenes', 'PUT', {scenes: []}, beta.cookie)).status, 403);
    const gp = await request('/api/projects', 'POST', {name: 'Inactive gamma', document: empty()}, gamma.cookie); assert.equal(gp.status, 201);
    now += 31 * 86400000; api.studio.db.prepare('UPDATE studio_user_resources SET last_seen_at=? WHERE user_id=?').run(now, beta.user.id);
    const dry = api.studio.access.maintenance({dryRun: true}); assert(dry.eligible.some(value => value.userId === gamma.user.id)); assert(dry.skipped.some(value => value.userId === alpha.user.id)); assert.equal(store.getProject(gp.data.project.id).revision, 1);
    const clean = api.studio.access.maintenance({dryRun: false}); assert(clean.deleted.includes(gamma.user.id)); assert.throws(() => store.getProject(gp.data.project.id)); assert.equal(store.getProject(projectId).revision, oldRevision); assert.equal(store.getProject(legacy.id).revision, 1); assert(api.studio.db.prepare('SELECT 1 FROM studio_users WHERE id=?').get(gamma.user.id)); assert.throws(() => api.studio.access.userFolder('../outside'));
    assert.deepEqual(errors, []);
    console.log('Project access: private ownership and legacy protection, authenticated library/two public projections, 2-project/20MiB quotas and atomic rollback, private assets, viewer/editor sharing, user folders and future 30-day cleanup protections passed.');
  } finally { await new Promise(resolve => server.close(resolve)); api.close(); const checked = __layout.map(path.resolve(temporary)); assert(checked.startsWith(__layout.map(path.resolve(os.tmpdir())) + path.sep) && path.basename(checked).startsWith('hello-project-access-')); fs.rmSync(checked, {recursive: true, force: true}); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
