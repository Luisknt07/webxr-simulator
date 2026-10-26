'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../src/studio/StudioClient.js'), 'utf8')
  .replace('export default class StudioClient', 'class StudioClient').replace('export class StudioRoomConnection', 'class StudioRoomConnection');

async function run() {
  const requests = [];
  const fetch = async (url, options) => {
    requests.push({url, options});
    if (url.endsWith('/me')) return {ok: true, json: async () => ({user: null, configured: false, capabilities: {accounts: true}})};
    if (url.endsWith('/login')) return {ok: false, status: 401, json: async () => ({error: 'Credenciales incorrectas', code: 'invalid_credentials'})};
    if (url.endsWith('/register')) return {ok: true, json: async () => ({user: {id: 'u1', displayName: 'Ana'}})};
    return {ok: true, json: async () => ({ok: true})};
  };
  const {StudioClient, StudioRoomConnection} = new Function('fetch', code + '\nreturn {StudioClient,StudioRoomConnection};')(fetch);
  const client = new StudioClient();
  await client.me();
  assert.equal(client.user, null);
  assert.equal(client.configured, false);
  await assert.rejects(client.login('ana', 'password'), error => error.status === 401 && error.code === 'invalid_credentials');
  assert.equal((await client.register('ana', 'long passphrase', 'Ana')).id, 'u1');
  assert.equal(client.user.displayName, 'Ana');
  await client.register('ana', 'long passphrase', 'Ana', ' CODE-123 ');
  assert.equal(JSON.parse(requests[requests.length - 1].options.body).code, 'CODE-123');
  const current = client.user;
  await client.saveRoom('room/1', {time: 3}, 2, 7);
  const request = requests[requests.length - 1];
  assert.equal(request.url, '/api/studio/rooms/room%2F1/state');
  assert.deepEqual(JSON.parse(request.options.body), {state: {time: 3}, expectedRevision: 2, appliedSequence: 7});
  assert.equal(request.options.headers['X-Studio-User'], 'u1', 'private requests identify their expected current account without supplying authority');
  requests.forEach(value => { assert.equal(value.options.credentials, 'same-origin'); assert.equal(value.options.cache, 'no-store'); });
  await client.logout(); assert.equal(client.user, null);
  const adminResponses = new Function('fetch', code + '\nreturn new StudioClient();')(async () => ({ok: true, json: async () => ({user: {id: 'managed-user'}})}));
  adminResponses.user = current; await adminResponses.request('POST', '/admin/users', {username: 'student'});
  assert.strictEqual(adminResponses.user, current, 'A managed account response never replaces the signed-in administrator.');
  let completeProfile;
  const delayed = new Function('fetch', code + '\nreturn new StudioClient();')(() => new Promise(resolve => { completeProfile = resolve; }));
  delayed.user = {id: 'previous'}; const profile = delayed.updateProfile({displayName: 'Old profile'}); delayed.user = {id: 'next'};
  completeProfile({ok: true, json: async () => ({user: {id: 'previous'}})});
  await assert.rejects(profile, error => error.code === 'stale_account_response'); assert.equal(delayed.user.id, 'next', 'An older profile request cannot restore the previous identity.');
  let completePrivate, invalidations = 0;
  const stale = new Function('fetch', code + '\nreturn new StudioClient();')(() => new Promise(resolve => { completePrivate = resolve; }));
  stale.user = {id: 'previous'}; stale.onSessionChange = () => invalidations++; const oldPrivate = stale.classroom(); stale.user = {id: 'next'};
  completePrivate({ok: false, status: 401, json: async () => ({error: 'Sesión cambió', code: 'session_changed'})});
  await assert.rejects(oldPrivate); assert.equal(invalidations, 0, 'A stale request cannot invalidate the next signed-in account.');

  // Desktop and immersive forms share one client. Authentication must remain
  // exclusive across both UIs and logout must follow the pending Set-Cookie.
  const authenticationRequests = []; let finishAuthentication, finishLogout;
  const exclusive = new Function('fetch', code + '\nreturn new StudioClient();')((url, options) => {
    authenticationRequests.push({url, options});
    return new Promise(resolve => { if (url.endsWith('/logout')) finishLogout = resolve; else finishAuthentication = resolve; });
  });
  const firstLogin = exclusive.login('vr-user', 'Disposable-password');
  assert(exclusive.authenticationPending, 'A client-wide authentication gate begins before the network response.');
  await assert.rejects(exclusive.login('desktop-user', 'Another-password'), error => error.code === 'authentication_busy');
  await assert.rejects(exclusive.register('second-user', 'Another-password', 'Second'), error => error.code === 'authentication_busy');
  assert.equal(authenticationRequests.length, 1, 'Concurrent desktop/VR login and registration never dispatch another Set-Cookie request.');
  const logoutAfterAuthentication = exclusive.logout(); await Promise.resolve();
  assert.equal(authenticationRequests.length, 1, 'Logout waits until the preceding authentication response finishes.');
  finishAuthentication({ok: true, json: async () => ({user: {id: 'vr-user'}})}); await firstLogin;
  for (let index = 0; index < 8 && !finishLogout; index++) await Promise.resolve();
  assert(finishLogout); assert.equal(authenticationRequests[1].url, '/api/studio/logout'); assert.equal(authenticationRequests[1].options.headers['X-Studio-User'], 'vr-user');
  await assert.rejects(exclusive.login('next-user', 'Another-password'), error => error.code === 'authentication_busy');
  await assert.rejects(exclusive.register('next-user', 'Another-password', 'Next'), error => error.code === 'authentication_busy');
  assert.equal(authenticationRequests.length, 2, 'A pending logout blocks new desktop/VR authentication requests until its cookie is cleared.');
  finishLogout({ok: true, json: async () => ({ok: true})}); await logoutAfterAuthentication;
  assert.equal(exclusive.user, null); assert(!exclusive.authenticationPending, 'A delayed login cannot restore an account after logout.');

  const failedRequests = []; let finishFailure;
  const failed = new Function('fetch', code + '\nreturn new StudioClient();')((url, options) => {
    failedRequests.push(url); return url.endsWith('/logout') ? Promise.resolve({ok: true, json: async () => ({ok: true})}) : new Promise(resolve => { finishFailure = resolve; });
  });
  const failedLogin = failed.login('invalid', 'Disposable-password'); const cleanup = failed.logout();
  finishFailure({ok: false, status: 401, json: async () => ({error: 'Invalid fixture', code: 'invalid_credentials'})});
  await assert.rejects(failedLogin, error => error.code === 'invalid_credentials'); await cleanup;
  assert.deepEqual(failedRequests, ['/api/studio/login', '/api/studio/logout']); assert.equal(failed.user, null); assert(!failed.authenticationPending);

  const log = [], cursors = [], actionRequests = [];
  let polled = 0, poseCount = 0, resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const room = {id: 'r1', revision: 1, stateSequence: 3, sequence: 4, state: {time: 3}, needsSnapshot: true,
    events: [{sequence: 4, type: 'action', payload: {action: 'start'}}]};
  const fakeClient = {
    async getRoom(id, after) {
      cursors.push(after);
      if (after === 0) return {id, revision: 2, stateSequence: 6, sequence: 7, needsSnapshot: true, state: {time: 6}, events: [{sequence: 7, type: 'action', payload: {action: 'pause'}}]};
      if (++polled === 1) return {id, revision: 1, stateSequence: 3, sequence: 5, needsSnapshot: false, events: [{sequence: 5, type: 'action', payload: {action: 'stop'}}]};
      return {id, revision: 2, stateSequence: 6, sequence: 7, needsSnapshot: false, events: [{sequence: 7, type: 'action', payload: {action: 'pause'}}]};
    },
    async roomPose() { poseCount++; },
    async roomAction(id, action) { actionRequests.push(action); if (action.action === 'bad') throw new Error('Denied'); return {accepted: true}; },
    async saveRoom(id, state, expectedRevision, appliedSequence) { assert.equal(appliedSequence, 7); return {revision: expectedRevision + 1}; },
    async leaveRoom() { log.push('leave'); }
  };
  const connection = new StudioRoomConnection(fakeClient, {interval: 2,
    onRoom(update) { if (update.state) log.push('state:' + update.state.time); },
    async onEvents(events) { events.forEach(event => log.push('action:' + event.sequence)); if (events.some(event => event.sequence === 7)) resolveDone(); },
    onError(error) { throw error; }, getPose: () => ({position: [0, 1.6, 0], quaternion: [0, 0, 0, 1]})});
  connection.connect(room);
  await done;
  await new Promise(resolve => setTimeout(resolve, 1));
  assert.deepEqual(log.slice(0, 5), ['state:3', 'action:4', 'action:5', 'state:6', 'action:7'], 'late join restores snapshot before subsequent actions');
  assert.deepEqual(cursors.slice(0, 3), [4, 5, 0], 'snapshot revision changes recover exact host snapshot');
  assert.ok(poseCount > 0);
  await assert.rejects(connection.action({type: 'control', action: 'bad'}));
  assert.equal((await connection.action({type: 'control', action: 'start'})).accepted, true, 'one rejected command does not poison queue');
  await connection.save({time: 7});
  await connection.leave();
  assert.equal(connection.active, false);
  assert.equal(connection.room, null);
  assert.equal(log[log.length - 1], 'leave');
  assert.deepEqual(actionRequests.map(value => value.action), ['bad', 'start']);
  const projectCode = fs.readFileSync(path.join(__dirname, '../src/editor/ProjectClient.js'), 'utf8').replace(/^import[^\n]+\n/gm, '').replace('export default class ProjectClient', 'class ProjectClient');
  const projectRequests = [];
  const ProjectClient = new Function('fetch', 'MAX_ASSET_BYTES', projectCode + '\nreturn ProjectClient;')(async (url, options) => {
    projectRequests.push(options);
    return {ok: true, json: async () => url.endsWith('/assets') ? {asset: {sha256: 'a'.repeat(64), url: '/api/assets/' + 'a'.repeat(64), mime: 'image/png', size: options.body.size}} : {projects: []}};
  }, 256 * 1024 * 1024);
  const projectClient = new ProjectClient(); let currentIdentity = 'u1'; projectClient.identityProvider = () => currentIdentity;
  await projectClient.listProjects(); assert.equal(projectRequests[0].headers['X-Studio-User'], 'u1');
  currentIdentity = 'u2'; await projectClient.uploadAsset(new Blob(['png']), 'image/png', 'test.png');
  assert.equal(projectRequests[1].headers['X-Studio-User'], 'u2', 'binary uploads obtain current identity at dispatch');
  projectClient.identityProvider = null; await projectClient.listProjects();
  assert.equal(projectRequests[2].headers['X-Studio-User'], undefined, 'unconfigured legacy clients retain their original requests');
  console.log('Studio client: cookies de origen, errores reales, cursores, entrada tardía, poses y comandos ordenados OK.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
