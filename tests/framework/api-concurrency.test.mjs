import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import apiModule from '../../apps/api/server/api.js';

const {createApiHandler} = apiModule;
const empty = () => ({format:'hello-webxr-editor', version:1, rooms:{hall:{overrides:[], additions:[]}}, imports:[]});
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; };

async function fixture(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'smarttwin-api-concurrency-'));
  const errors = [], barriers = new Map(), clients = new Set();
  const api = createApiHandler({dataDir:directory, requireSecureCookies:false, maintenanceIntervalMs:0, onError:error => errors.push(error)});
  // Observe the real body reader without replacing authentication or storage.
  // A barrier fires only after the route has reached its asynchronous read.
  const server = http.createServer((req, res) => {
    const barrier = barriers.get(req.headers['x-test-body-barrier']);
    if (barrier) {
      const on = req.on;
      req.on = function(event, ...args) {
        const result = on.call(this, event, ...args);
        if (event === 'data' || event === 'readable') barrier.resolve();
        return result;
      };
    }
    void api(req, res);
  });
  try {
    await api.studio.bootstrapOwner({username:'concurrency_owner', password:'Synthetic-owner-password-123', invitationOnly:false});
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const request = async (url, method='GET', body, cookie) => {
      const response = await fetch(origin + url, {method, headers:{...(body === undefined ? {} : {'Content-Type':'application/json'}), ...(cookie ? {Cookie:cookie} : {})}, body:body === undefined ? undefined : JSON.stringify(body)});
      return {status:response.status, data:await response.json(), cookie:response.headers.get('set-cookie')?.split(';')[0]};
    };
    const hold = (url, method, body, cookie) => {
      const bytes = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
      const key = String(barriers.size), barrier = deferred(); barriers.set(key, barrier);
      let client;
      const done = new Promise((resolve, reject) => {
        client = http.request(origin + url, {method, headers:{'Content-Type':Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json', 'Content-Length':bytes.length, Cookie:cookie, 'x-test-body-barrier':key}}, response => {
          let text = ''; response.setEncoding('utf8'); response.on('data', chunk => { text += chunk; });
          response.on('end', () => { clients.delete(client); try { resolve({status:response.statusCode, data:JSON.parse(text)}); } catch (error) { reject(error); } });
        });
        clients.add(client); client.on('error', reject); client.write(bytes.subarray(0, 1));
      });
      return {reading:barrier.promise, done, finish:() => client.end(bytes.subarray(1))};
    };
    const owner = await request('/api/studio/login', 'POST', {username:'concurrency_owner', password:'Synthetic-owner-password-123'});
    const member = await request('/api/studio/register', 'POST', {username:'concurrency_member', password:'Synthetic-member-password-123'});
    assert.equal(owner.status, 200); assert.equal(member.status, 201);
    await run({api, request, hold, owner, member, directory, errors});
    assert.deepEqual(errors, []);
  } finally {
    for (const client of clients) client.destroy();
    if (server.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    api.close();
    assert(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(directory).startsWith('smarttwin-api-concurrency-'));
    fs.rmSync(directory, {recursive:true, force:true});
  }
}

test('held project writes and streamed assets recheck role and session before committing', {timeout:30000}, async () => fixture(async ({api, request, hold, owner, member, directory}) => {
  for (const change of ['demote', 'logout']) {
    if (change === 'logout') assert.equal((await request('/api/studio/users/' + member.data.user.id + '/role', 'PUT', {role:'creator'}, owner.cookie)).status, 200);
    const project = hold('/api/projects', 'POST', {name:'Delayed synthetic project', document:empty()}, member.cookie);
    const asset = hold('/api/assets', 'POST', Buffer.from('Delayed synthetic private asset'), member.cookie);
    await Promise.all([project.reading, asset.reading]);
    if (change === 'demote') assert.equal((await request('/api/studio/users/' + member.data.user.id + '/role', 'PUT', {role:'viewer'}, owner.cookie)).status, 200);
    else assert.equal((await request('/api/studio/logout', 'POST', {}, member.cookie)).status, 200);
    project.finish(); asset.finish();
    for (const result of await Promise.all([project.done, asset.done])) {
      assert.equal(result.status, change === 'demote' ? 403 : 401);
      assert.equal(result.data.code, change === 'demote' ? 'editor_forbidden' : 'authentication_required');
    }
    assert.equal(api.studio.access.usage(member.data.user.id).projects, 0);
    assert.equal(api.studio.db.prepare('SELECT COUNT(*) AS n FROM studio_asset_owners WHERE user_id=?').get(member.data.user.id).n, 0);
    assert.deepEqual(fs.readdirSync(path.join(directory, 'uploads')), [], 'Denied uploads leave neither permanent files nor temporary spools.');
  }
}));

test('overlapping room snapshots conflict and a participant cannot finish an action after leaving', {timeout:30000}, async () => fixture(async ({api, request, hold, owner, member}) => {
  const project = await request('/api/projects', 'POST', {name:'Synthetic room project', document:empty()}, owner.cookie);
  const created = await request('/api/studio/rooms', 'POST', {projectId:project.data.project.id, projectRevision:1, roomId:'hall', state:{marker:'initial'}}, owner.cookie);
  assert.equal(created.status, 201); const room = created.data.room, url = '/api/studio/rooms/' + room.id;
  const first = hold(url + '/state', 'PUT', {expectedRevision:0, appliedSequence:0, state:{marker:'first'}}, owner.cookie);
  const second = hold(url + '/state', 'PUT', {expectedRevision:0, appliedSequence:0, state:{marker:'second'}}, owner.cookie);
  await Promise.all([first.reading, second.reading]);
  first.finish(); assert.equal((await first.done).status, 200);
  second.finish(); const conflict = await second.done; assert.equal(conflict.status, 409); assert.equal(conflict.data.code, 'room_revision_conflict');
  const stored = api.studio.db.prepare('SELECT state,revision,next_sequence FROM studio_rooms WHERE id=?').get(room.id);
  assert.deepEqual(JSON.parse(stored.state), {marker:'first'}); assert.equal(stored.revision, 1); assert.equal(stored.next_sequence, 2);
  assert.equal(api.studio.db.prepare("SELECT COUNT(*) AS n FROM studio_room_events WHERE room_id=? AND type='state'").get(room.id).n, 1, 'Rejected snapshots emit no success event.');
  const saved = await request(url + '/state', 'PUT', {expectedRevision:1, appliedSequence:1, state:{marker:'current'}}, owner.cookie);
  assert.equal(saved.status, 200); assert.equal(saved.data.revision, 2);
  assert.equal((await request('/api/studio/rooms/join', 'POST', {code:room.code}, member.cookie)).status, 200);
  const action = hold(url + '/action', 'POST', {type:'grab', objectId:'synthetic-object'}, member.cookie);
  await action.reading;
  assert.equal((await request(url + '/leave', 'POST', {}, member.cookie)).status, 200);
  action.finish(); const denied = await action.done; assert.equal(denied.status, 403);
  assert.equal(api.studio.db.prepare('SELECT COUNT(*) AS n FROM studio_locks WHERE room_id=?').get(room.id).n, 0);
  assert.equal(api.studio.db.prepare("SELECT COUNT(*) AS n FROM studio_room_events WHERE room_id=? AND type='action'").get(room.id).n, 0);
}));

test('legacy project metadata reflects global viewer permissions for owned and shared projects', {timeout:30000}, async () => fixture(async ({request, owner, member}) => {
  const owned = await request('/api/projects', 'POST', {name:'Synthetic owned project', document:empty()}, member.cookie);
  const shared = await request('/api/projects', 'POST', {name:'Synthetic shared project', document:empty()}, owner.cookie);
  assert.equal(owned.status, 201); assert.equal(shared.status, 201);
  const shareURL = '/api/projects/' + shared.data.project.id + '/shares';
  assert.equal((await request(shareURL, 'PUT', {userId:member.data.user.id, permission:'editor'}, owner.cookie)).status, 200);
  assert.equal(owned.data.project.access.canEdit, true); assert.equal(owned.data.project.access.canShare, true);
  assert.equal((await request('/api/projects/' + shared.data.project.id, 'GET', undefined, member.cookie)).data.project.access.canEdit, true);
  assert.equal((await request('/api/studio/users/' + member.data.user.id + '/role', 'PUT', {role:'viewer'}, owner.cookie)).status, 200);
  for (const id of [owned.data.project.id, shared.data.project.id]) {
    const response = await request('/api/projects/' + id, 'GET', undefined, member.cookie);
    assert.equal(response.status, 200); assert.equal(response.data.project.access.canEdit, false); assert.equal(response.data.project.access.canShare, false);
    assert.equal((await request('/api/projects/' + id, 'PUT', {name:'Denied', expectedRevision:1, document:empty()}, member.cookie)).status, 403);
  }
  const listed = await request('/api/projects', 'GET', undefined, member.cookie);
  assert.equal(listed.data.projects.length, 2); assert(listed.data.projects.every(project => !project.access.canEdit && !project.access.canShare));
  assert.equal((await request('/api/projects/' + owned.data.project.id + '/shares', 'PUT', {userId:owner.data.user.id, permission:'viewer'}, member.cookie)).status, 403);
}));
