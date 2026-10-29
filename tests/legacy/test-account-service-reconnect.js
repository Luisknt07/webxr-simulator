const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const read = file => fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-account-service-reconnect.js"), '..', file)), 'utf8').replace(/^import .*;\r?\n/gm, '');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture() {
  const calls = [], state = {identity: {user: null, configured: true, capabilities: {}}, status: 200};
  const Client = new Function('fetch', read("apps/workspace/studio/StudioClient.js").replace('export default class StudioClient', 'class StudioClient').replace('export class StudioRoomConnection', 'class StudioRoomConnection') + '\nreturn StudioClient;')(async (url, options) => {
    calls.push({url, options}); assert.equal(options.method, 'GET'); assert.equal(url, '/api/studio/me');
    const body = await (state.pending ? state.pending.promise : state.identity);
    return {ok: state.status === 200, status: state.status, async json() { return body; }};
  });
  const Experience = new Function('StudioClient', 'window', read("apps/workspace/studio/StudioExperience.js").replace('export default class StudioExperience', 'return class StudioExperience'))(Client, {location: new URL('https://localhost:8080/')});
  const client = new Client(), beforeCaps = {}, beforeLimits = {}, pose = {x: 3, y: 2, z: 5};
  const editor = {staticPublic: true, serverCapabilities: beforeCaps, serverLimits: beforeLimits, storageAvailable: false,
    currentProject: {id: 'public-l', access: {canEdit: false}}, projectClient: {base: '/api', assetUploadAvailable: false, maxAssetBytes: 20,
      async request(method, route) { assert.equal(method, 'GET'); assert.equal(route, '/health'); calls.push({health: true}); if (state.healthError) throw state.healthError; if (state.healthPending) await state.healthPending.promise;
        return state.health || {storage: 'sqlite', capabilities: {privateProjects: true, assetUpload: true}, limits: {maxAssetBytes: 100}}; }},
    accessView: {identityGeneration: 0, enabled: true, async accountChanged(value) { this.user = value; this.identityGeneration++; }},
    document: {rooms: new Map([['hall', {root: {visible: true}}]])}, projectSync: {stop() {}}, clearObjectClipboard() {}};
  const experience = Object.assign(Object.create(Experience.prototype), {editor, client, ctx: {vrMode: true, pose}, online: false, connectionError: 'Static', accountButton: {textContent: 'Vista pública'}, avatars: new Map(), education: {accountChanged() {}}, identity() {},
    authenticatedCalls: [], async authenticated(options) { this.authenticatedCalls.push(options); }, close() {}});
  return {experience, editor, client, state, calls, pose, beforeCaps, beforeLimits};
}
async function run() {
  const valid = fixture(), originalWorld = valid.editor.currentProject, originalPose = valid.pose;
  const result = await valid.experience.reconnectAccountService();
  assert.equal(result.online, true); assert.equal(result.user, null); assert.equal(valid.editor.staticPublic, false); assert.equal(valid.experience.online, true);
  assert.equal(valid.experience.connectionError, ''); assert.equal(valid.experience.accountButton.textContent, 'Iniciar sesión');
  assert.strictEqual(valid.editor.currentProject, originalWorld); assert.strictEqual(valid.experience.ctx.pose, originalPose); assert.equal(valid.editor.currentProject.access.canEdit, false);
  assert.equal(valid.calls.filter(value => value.url).length, 1); assert.equal(valid.experience.authenticatedCalls.length, 0);
  for (const failure of ['health', 'storage', 'capabilities', 'identity401', 'malformed']) {
    const f = fixture();
    if (failure === 'health') f.state.healthError = new Error('404 sin servidor');
    if (failure === 'storage') f.state.health = {storage: 'unexpected', capabilities: {privateProjects: true}, limits: {}};
    if (failure === 'capabilities') f.state.health = {storage: 'sqlite', capabilities: {}, limits: {}};
    if (failure === 'identity401') { f.state.status = 401; f.state.identity = {error: 'No disponible'}; }
    if (failure === 'malformed') f.state.identity = {user: {id: 'incorrecto'}, configured: true};
    await assert.rejects(() => f.experience.reconnectAccountService());
    assert.equal(f.editor.staticPublic, true, failure); assert.equal(f.experience.online, false, failure); assert.equal(f.client.user, null, failure);
    assert.strictEqual(f.editor.serverCapabilities, f.beforeCaps); assert.strictEqual(f.editor.serverLimits, f.beforeLimits); assert.equal(f.editor.storageAvailable, false); assert.equal(f.editor.projectClient.assetUploadAvailable, false);
    assert.equal(f.experience.accountServicePending, null);
  }
  const cookie = fixture(); cookie.state.identity = {configured: true, user: {id: 'verified', permissions: {editor: true}}, capabilities: {}};
  await cookie.experience.reconnectAccountService(); assert.equal(cookie.client.user.id, 'verified'); assert.deepEqual(cookie.experience.authenticatedCalls, [{immersive: true}]);
  const delayed = fixture(); delayed.state.pending = deferred();
  const pending = delayed.experience.reconnectAccountService(); await flush();
  assert.equal(delayed.editor.staticPublic, true); assert.strictEqual(delayed.editor.serverCapabilities, delayed.beforeCaps);
  await delayed.experience.clearAccountContext();
  delayed.state.pending.resolve({configured: true, user: {id: 'old-cookie', permissions: {editor: true}}, capabilities: {}});
  await assert.rejects(pending, error => error.code === 'session_changed'); assert.equal(delayed.client.user, null); assert.equal(delayed.editor.staticPublic, true); assert.equal(delayed.experience.online, false);
  const concurrent = fixture(); concurrent.state.pending = deferred(); const first = concurrent.experience.reconnectAccountService(), second = concurrent.experience.reconnectAccountService(); await flush();
  assert.equal(concurrent.calls.filter(value => value.url).length, 1); concurrent.state.pending.resolve(concurrent.state.identity); await Promise.all([first, second]);
  const foreign = fixture(); foreign.client.base = 'https://other.invalid/api/studio'; await assert.rejects(() => foreign.experience.reconnectAccountService(), /mismo servidor/); assert.equal(foreign.calls.length, 0);
  const authenticating = fixture(); authenticating.client.authenticationPending = Promise.resolve(); await assert.rejects(() => authenticating.experience.reconnectAccountService(), error => error.code === 'session_changed'); assert.equal(authenticating.calls.length, 0);
  console.log('Account reconnect: verified same-origin health/identity, atomic guest recovery, read-only world/pose preservation, real StudioClient GET-only probe, failures, duplicate retry and logout isolation passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
