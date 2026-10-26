'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {ProjectStore} = require('../server/storage');
const {StudioService, COOKIE, LOCK_MS} = require('../server/studio-service');
const {ApiError} = require('../server/validation');
const {createApiHandler} = require('../server/api');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hello-studio-test-'));
const dataDir = path.resolve(temporary);
let now = Date.now();
const store = new ProjectStore({dataDir});
const project = store.saveProject(null, {name: 'Studio test', document: {format: 'hello-webxr-editor', version: 1, rooms: {}, imports: []}});
const json = (res, status, data) => {
  res.writeHead(status, {'Content-Type': 'application/json'});
  res.end(JSON.stringify(data));
};
const readBody = async (req, maximum) => {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maximum) throw new ApiError(413, 'Too large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch (_) { throw new ApiError(400, 'JSON inválido'); }
};
const verifyWrite = req => {
  if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw new ApiError(403, 'Origin inválido');
  if (req.headers['sec-fetch-site'] === 'cross-site') throw new ApiError(403, 'Origin inválido');
  if (req.headers['content-type'] !== 'application/json') throw new ApiError(415, 'JSON requerido');
};
const studio = new StudioService({store, json, readBody, verifyWrite, now: () => now});
const legacy = createApiHandler({store});
const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/editor-permission') { studio.requireEditor(req); json(res, 200, {ok: true}); return; }
    if (!await studio.handle(req, res)) await legacy(req, res);
  } catch (error) {
    json(res, error.status || 500, {error: error.message, code: error.code});
  }
});

async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const request = async (route, method = 'GET', body, cookie, headers = {}) => {
    const response = await fetch(base + route, {method,
      headers: Object.assign(body === undefined ? {} : {'Content-Type': 'application/json'}, cookie ? {Cookie: cookie} : {}, headers),
      body: body === undefined ? undefined : JSON.stringify(body)});
    const value = await response.json();
    return {status: response.status, value, cookie: response.headers.get('set-cookie')};
  };
  const call = (route, method, body, cookie, headers) => request('/api/studio' + route, method, body, cookie, headers);
  assert.equal((await request('/editor-permission')).status, 401, 'editor requires an account even before bootstrap');
  let result = await call('/me');
  assert.equal(result.value.configured, false);
  assert.equal(result.value.user, null);
  assert.equal((await call('/profile', 'PUT', {})).status, 401);
  assert.equal((await call('/register', 'POST', {username: 'bad', password: 'tiny'})).status, 400);
  const credentials = {username: 'creator_one', displayName: 'Creadora', password: 'A realistic local password!'};
  result = await call('/register', 'POST', credentials, null, {Origin: 'https://evil.example'});
  assert.equal(result.status, 403, 'cross-origin account creation rejected');
  result = await call('/register', 'POST', credentials);
  assert.equal(result.status, 201, JSON.stringify(result.value));
  const creator = result.value.user;
  const creatorCookie = result.cookie.split(';')[0];
  assert.equal(creator.permissions.editor, true);
  assert.equal(creator.permissions.manageUsers, true);
  assert.match(result.cookie, /HttpOnly/);
  assert.match(result.cookie, /SameSite=Strict/);
  assert.equal(result.value.user.password, undefined);
  const stored = store.db.prepare('SELECT * FROM studio_users WHERE id=?').get(creator.id);
  assert.notEqual(stored.password_hash, credentials.password);
  assert.equal(stored.password_hash.length, 128);
  assert.equal(stored.salt.length, 64);
  const rawCookie = creatorCookie.slice(COOKIE.length + 1);
  assert.equal(store.db.prepare('SELECT token_hash FROM studio_sessions').get().token_hash.includes(rawCookie), false, 'session token stored only as hash');
  assert.equal((await request('/editor-permission')).status, 401, 'configured editor writes require real account');
  assert.equal((await request('/editor-permission', 'GET', undefined, creatorCookie)).status, 200);
  assert.equal((await call('/register', 'POST', credentials)).status, 409);
  assert.equal((await call('/login', 'POST', {username: credentials.username, password: 'wrong password'})).status, 401);
  assert.equal((await call('/me', 'GET', undefined, creatorCookie)).value.user.id, creator.id);
  assert.equal((await call('/profile', 'PUT', {profileImage: 'https://example.com/me.png'}, creatorCookie)).status, 400);
  const avatar = {version: 1, base: 'robot', bodyColor: '#335577', accentColor: '#77ffaa', skinColor: '#aa7755'};
  result = await call('/profile', 'PUT', {displayName: 'Robot creador', avatar, preferences: {handedness: 'left', locomotion: 'smooth'}}, creatorCookie);
  assert.equal(result.status, 200);
  assert.deepEqual(result.value.user.avatar, avatar);
  assert.equal(result.value.user.profileImage, null, 'avatar is distinct from image');

  const state = {format: 'hello-studio-execution', version: 1, time: 8, boxes: [{id: 'box-1', position: [0, 0.8, 1]}]};
  result = await call('/checkpoints', 'POST', {version: 1, projectId: project.id, projectRevision: 1, name: 'Prueba', roomId: 'hall', state}, creatorCookie);
  assert.equal(result.status, 201, JSON.stringify(result.value));
  const checkpoint = result.value.checkpoint;
  assert.deepEqual((await call('/checkpoints/' + checkpoint.id, 'GET', undefined, creatorCookie)).value.checkpoint.state, state);
  assert.equal((await call('/checkpoints', 'GET', undefined, creatorCookie)).value.checkpoints.length, 1);
  result = await call('/progress', 'PUT', {projectId: project.id, missionId: 'classify20', missionVersion: 1, value: {count: 17, complete: false}}, creatorCookie);
  assert.equal(result.status, 200);
  result = await call('/progress?projectId=' + project.id, 'GET', undefined, creatorCookie);
  assert.equal(result.value.progress[0].value.count, 17);
  assert.equal((await call('/progress', 'PUT', {projectId: project.id, missionId: 'classify20', missionVersion: 2, value: {}}, creatorCookie)).status, 409);

  result = await call('/register', 'POST', {username: 'participant', password: 'Another strong password'});
  const participantCookie = result.cookie.split(';')[0], participant = result.value.user;
  assert.equal(participant.role, 'creator', 'normal registrations create private projects within their own quota');
  assert.equal(participant.permissions.editor, true);
  assert.equal((await call('/progress', 'PUT', {projectId: project.id, missionId: 'classify20', missionVersion: 1, value: {count: 999}}, participantCookie, {'X-Studio-User': creator.id})).value.code, 'session_changed', 'a cookie account switch cannot write stale tab progress into another account');
  assert.equal((await call('/profile', 'PUT', {displayName: 'Wrong account'}, participantCookie, {'X-Studio-User': creator.id})).value.code, 'session_changed');
  assert.equal((await call('/logout', 'POST', {}, participantCookie, {'X-Studio-User': creator.id})).value.code, 'session_changed');
  const unchanged = store.getProject(project.id);
  const staleLegacy = await request('/api/projects/' + project.id, 'PUT', {name: 'Wrong writer', expectedRevision: 1, document: project.document}, participantCookie, {'X-Studio-User': creator.id});
  assert.equal(staleLegacy.status, 409);
  assert.equal(staleLegacy.value.code, 'session_changed', 'legacy project mutation checks account expectation before creator permission');
  assert.deepEqual(store.getProject(project.id), unchanged);
  const staleUpload = await fetch(base + '/api/assets', {method: 'POST', headers: {'Content-Type': 'application/octet-stream', 'X-Asset-Mime': 'text/plain', Cookie: creatorCookie, 'X-Studio-User': participant.id}, body: Buffer.from('Stale account upload')});
  assert.equal(staleUpload.status, 409);
  assert.equal((await staleUpload.json()).code, 'session_changed');
  assert.equal((await call('/users', 'GET', undefined, participantCookie)).status, 403);
  assert.equal((await call('/users', 'GET', undefined, creatorCookie)).value.users.length, 2);
  assert.equal((await call('/users/' + creator.id + '/role', 'PUT', {role: 'viewer'}, creatorCookie)).value.code, 'owner_protected');
  assert.equal((await call('/users/' + participant.id + '/role', 'PUT', {role: 'creator'}, participantCookie)).status, 403);
  assert.equal((await call('/users/' + participant.id + '/role', 'PUT', {role: 'creator'}, creatorCookie)).status, 200);
  assert.equal((await request('/editor-permission', 'GET', undefined, participantCookie)).status, 200, 'owner authorizes another real creator');
  assert.equal((await call('/users/' + participant.id + '/role', 'PUT', {role: 'viewer'}, creatorCookie)).status, 200);
  assert.equal((await call('/checkpoints/' + checkpoint.id, 'GET', undefined, participantCookie)).status, 404, 'checkpoints private per account');
  assert.equal((await call('/progress?projectId=' + project.id, 'GET', undefined, participantCookie)).status, 403, 'private project progress requires project access');
  result = await call('/rooms', 'POST', {projectId: project.id, projectRevision: 1, roomId: 'hall', state, name: 'Línea 1'}, creatorCookie);
  assert.equal(result.status, 201, JSON.stringify(result.value));
  const room = result.value.room;
  assert.equal(room.role, 'host');
  assert.equal(room.permissions.reset, true);
  assert.equal((await call('/rooms/' + room.id, 'GET', undefined, participantCookie)).status, 403);
  result = await call('/rooms/join', 'POST', {code: room.code}, participantCookie);
  assert.equal(result.status, 200);
  assert.equal(result.value.room.role, 'participant');
  assert.deepEqual(result.value.room.state, state);
  const action = (body, cookie = participantCookie) => call('/rooms/' + room.id + '/action', 'POST', body, cookie);
  assert.equal((await action({type: 'simulation', action: 'reset'})).status, 403);
  assert.equal((await action({type: 'grab', objectId: 'box-1'})).status, 200);
  assert.equal((await action({type: 'grab', objectId: 'box-1'}, creatorCookie)).value.code, 'object_locked');
  assert.equal((await action({type: 'pose-object', objectId: 'box-1', pose: {position: [1, 1, 1], quaternion: [0, 0, 0, 1]}})).status, 200);
  assert.equal((await action({type: 'release', objectId: 'box-1', reason: 'Fuera de alcance'}, creatorCookie)).status, 200, 'host may reject an invalid remote grab and release its lease');
  assert.equal((await action({type: 'grab', objectId: 'box-1'})).status, 200);
  const afterActions = (await call('/rooms/' + room.id + '?after=0', 'GET', undefined, creatorCookie)).value.room;
  assert.ok(afterActions.events.some(event => event.type === 'action' && event.payload.type === 'pose-object'));
  assert.ok(afterActions.events.some(event => event.payload.ownerId === participant.id && event.payload.reason === 'Fuera de alcance'));
  assert.equal((await call('/rooms/' + room.id + '/state', 'PUT', {state, expectedRevision: 0, appliedSequence: afterActions.sequence}, participantCookie)).status, 403);
  const newerState = Object.assign({}, state, {time: 10});
  result = await call('/rooms/' + room.id + '/state', 'PUT', {state: newerState, expectedRevision: 0, appliedSequence: afterActions.sequence}, creatorCookie);
  assert.equal(result.status, 200, JSON.stringify(result.value));
  assert.equal((await call('/rooms/' + room.id + '/state', 'PUT', {state, expectedRevision: 0, appliedSequence: 0}, creatorCookie)).status, 409);
  assert.equal((await action({type: 'release', objectId: 'box-1'})).status, 200);
  assert.equal((await action({type: 'control', objectId: 'panel-1', action: 'start', scope: 'segment'})).status, 200);
  assert.equal((await action({type: 'control', objectId: 'panel-1', action: 'start', scope: 'everything'})).status, 400);
  // Rejoining must restore the checkpoint, then replay the actions since it.
  result = await call('/rooms/join', 'POST', {code: room.code}, participantCookie);
  assert.deepEqual(result.value.room.state, newerState);
  assert.equal(result.value.room.stateSequence, afterActions.sequence);
  assert.ok(result.value.room.events.some(event => event.payload.action === 'start'));
  assert.ok(result.value.room.events.some(event => event.payload.scope === 'segment'));
  assert.ok(result.value.room.events.every(event => event.sequence > afterActions.sequence));
  assert.equal((await call('/rooms/' + room.id + '/pose', 'POST', {position: [1, 2, 3], quaternion: [0, 0, 0, 1]}, participantCookie)).status, 200);
  assert.equal((await call('/rooms/' + room.id, 'GET', undefined, creatorCookie)).value.room.participants.find(row => row.id === participant.id).pose.position[1], 2);
  await call('/rooms/join', 'POST', {code: room.code, role: 'observer'}, participantCookie);
  assert.equal((await action({type: 'grab', objectId: 'box-1'})).status, 403);
  await call('/rooms/join', 'POST', {code: room.code}, participantCookie);
  assert.equal((await action({type: 'grab', objectId: 'box-1'})).status, 200);
  now += LOCK_MS + 1;
  assert.equal((await action({type: 'grab', objectId: 'box-1'}, creatorCookie)).status, 200, 'abandoned lock expires');
  assert.equal((await action({type: 'simulation', action: 'reset'}, creatorCookie)).status, 200);
  assert.equal((await call('/rooms/' + room.id, 'GET', undefined, creatorCookie)).value.room.locks.length, 0, 'host reset immediately clears every grab lease');
  assert.equal((await action({type: 'grab', objectId: 'box-1'})).status, 200, 'reset load can immediately be grabbed again');
  await call('/rooms/' + room.id + '/leave', 'POST', {}, participantCookie);
  assert.equal((await call('/rooms/' + room.id, 'GET', undefined, participantCookie)).status, 403);
  assert.equal((await call('/rooms/join', 'POST', {code: room.code}, participantCookie)).status, 200, 'reconnect restores durable membership');

  // Existing project revisions remain intact; old execution checkpoints are
  // explicitly incompatible after a configuration change.
  store.saveProject(project.id, {name: project.name, document: project.document, expectedRevision: 1});
  assert.equal((await call('/checkpoints/' + checkpoint.id, 'GET', undefined, creatorCookie)).value.code, 'checkpoint_incompatible');
  assert.equal((await call('/checkpoints', 'GET', undefined, creatorCookie)).value.checkpoints[0].compatible, false);
  store.db.prepare("UPDATE studio_users SET role='viewer' WHERE id=?").run(participant.id);
  assert.equal((await request('/editor-permission', 'GET', undefined, participantCookie)).status, 403, 'viewer cannot edit');
  result = await call('/login', 'POST', credentials, creatorCookie);
  assert.equal(result.status, 200);
  assert.equal((await call('/me', 'GET', undefined, creatorCookie)).value.user, null, 'login rotates previous browser token');
  const freshCookie = result.cookie.split(';')[0];
  await call('/logout', 'POST', {}, freshCookie);
  assert.equal((await call('/me', 'GET', undefined, freshCookie)).value.user, null);
  assert.equal(store.listProjects().length, 1);
  assert.equal(store.getProject(project.id).revision, 2);

  // A fresh service on the same database reads durable profiles/progress/rooms.
  const reopened = new StudioService({store, json, readBody, verifyWrite, now: () => now});
  assert.equal(reopened.db.prepare('SELECT COUNT(*) AS n FROM studio_progress').get().n, 1);
  assert.equal(reopened.db.prepare('SELECT COUNT(*) AS n FROM studio_rooms').get().n, 1);
  assert.equal(reopened.db.prepare('SELECT COUNT(*) AS n FROM studio_checkpoints').get().n, 1);
  console.log('Studio: cuentas reales, cookies, permisos, avatar, progreso, sesiones, salas, recuperación tardía y bloqueos OK.');
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await new Promise(resolve => server.close(resolve));
  store.close();
  const expectedParent = fs.realpathSync(os.tmpdir());
  if (path.dirname(dataDir).toLowerCase() !== expectedParent.toLowerCase() || !path.basename(dataDir).startsWith('hello-studio-test-')) throw new Error('Unsafe test cleanup');
  fs.rmSync(dataDir, {recursive: true, force: true});
});
