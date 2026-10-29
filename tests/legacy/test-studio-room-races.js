const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const source = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-studio-room-races.js"), '../src/studio/StudioClient.js')), 'utf8')
  .replace('export default class StudioClient', 'class StudioClient').replace('export class StudioRoomConnection', 'class StudioRoomConnection');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const room = (id, revision = 1, sequence = 10) => ({id, revision, sequence, stateSequence: sequence - 1, events: [], state: {id}, needsSnapshot: true});
function setup(options = {}, client = {}) {
  let next = 0; const timers = new Map();
  const Connection = new Function('setTimeout', 'clearTimeout', source + '\nreturn StudioRoomConnection;')(
    callback => { const id = ++next; timers.set(id, callback); return id; }, id => timers.delete(id));
  const connection = new Connection(client, options);
  return {connection, timers, async tick() { const [id, callback] = timers.entries().next().value; timers.delete(id); await callback(); }};
}
async function run() {
  // A delayed initial snapshot/events must not acknowledge an obsolete room.
  for (const waitOn of ['snapshot', 'events']) {
    const wait = deferred(), seen = [], a = room('A'), b = room('B', 2, 20); a.events = [{sequence: 10}];
    const f = setup({onRoom: update => update.id === 'A' && waitOn === 'snapshot' ? wait.promise : undefined,
      onEvents: (events, update) => { seen.push(update.id); if (waitOn === 'events') return wait.promise; }});
    f.connection.connect(a); await flush(); f.connection.connect(b); await flush(); wait.resolve(); await flush();
    assert.equal(f.connection.room.id, 'B'); assert.equal(f.connection.sequence, 20);
    assert.deepEqual(seen, waitOn === 'snapshot' ? [] : ['A']); assert.equal(f.timers.size, 1); f.connection.stop();
  }
  // Cover every asynchronous poll boundary, including stale authentication errors.
  for (const waitOn of ['fetch', 'snapshot', 'events', 'pose', 'error']) {
    const wait = deferred(), seen = [], a = room('A'), b = room('B', 2, 20), update = room('A', 1, 11);
    update.events = [{sequence: 11}]; let polls = 0;
    const f = setup({onRoom: value => value.sequence === 11 && waitOn === 'snapshot' ? wait.promise : undefined,
      onEvents: () => { seen.push('events'); if (waitOn === 'events') return wait.promise; },
      onError: error => seen.push(error.code), getPose: () => ({x: 1})}, {
      getRoom: () => { polls++; return ['fetch', 'error'].includes(waitOn) ? wait.promise : Promise.resolve(update); },
      roomPose: () => waitOn === 'pose' ? wait.promise : Promise.resolve()
    });
    f.connection.connect(a); await flush(); const oldTick = f.tick(); await flush(); assert.equal(polls, 1);
    f.connection.connect(b); await flush();
    if (waitOn === 'error') wait.reject(Object.assign(new Error('Expired old room'), {status: 403, code: 'old_denied'})); else wait.resolve(update);
    await oldTick; await flush();
    assert.equal(f.connection.room.id, 'B'); assert.equal(f.connection.sequence, 20); assert.equal(f.connection.active, true);
    assert(!seen.includes('old_denied')); assert.equal(f.timers.size, 1); f.connection.stop();
  }
  // Reentrant callbacks cannot replace the new room's timer or stop it.
  const reentrant = setup({onRoom: value => { if (value.id === 'A') reentrant.connection.connect(room('B', 2, 20)); }});
  reentrant.connection.connect(room('A')); await flush(); assert.equal(reentrant.timers.size, 1); assert.equal(reentrant.connection.sequence, 20); reentrant.connection.stop();
  const auth = setup({onError: () => auth.connection.connect(room('B', 2, 20))}, {getRoom: async () => { throw Object.assign(new Error('Denied'), {status: 403}); }});
  auth.connection.connect(room('A')); await flush(); await auth.tick(); await flush(); assert(auth.connection.active); assert.equal(auth.connection.room.id, 'B'); assert.equal(auth.timers.size, 1); auth.connection.stop();
  const poseCalls = [], pose = setup({getPose: () => { pose.connection.connect(room('B', 2, 20)); return {x: 1}; }}, {
    getRoom: async () => ({...room('A'), needsSnapshot: false}), roomPose: async id => poseCalls.push(id)
  });
  pose.connection.connect(room('A')); await flush(); await pose.tick(); await flush(); assert.deepEqual(poseCalls, []); assert.equal(pose.connection.room.id, 'B'); pose.connection.stop();
  // Already dispatched HTTP writes may finish, but cannot contaminate another room.
  const saveWait = deferred(), save = setup({}, {saveRoom: () => saveWait.promise});
  save.connection.connect(room('A')); await flush(); const oldSave = save.connection.save({time: 1});
  save.connection.connect(room('B', 99, 50)); await flush(); saveWait.resolve({revision: 6});
  await assert.rejects(oldSave, {code: 'room_connection_changed'}); assert.equal(save.connection.room.revision, 99); save.connection.stop();
  const actionWait = deferred(), actions = [], action = setup({}, {roomAction: (id, value) => { actions.push([id, value]); return id === 'A' ? actionWait.promise : Promise.resolve({accepted: true}); }});
  action.connection.connect(room('A')); await flush(); const oldAction = action.connection.action('first'); await flush();
  const queued = action.connection.action('must-not-send'); action.connection.connect(room('B', 2, 20)); await flush();
  assert.deepEqual(await action.connection.action('new-room'), {accepted: true}); actionWait.resolve({accepted: true});
  await assert.rejects(oldAction, {code: 'room_connection_changed'}); await assert.rejects(queued, {code: 'room_connection_changed'});
  assert.deepEqual(actions, [['A', 'first'], ['B', 'new-room']]); action.connection.stop();
  // A poll started before a successful save must recover the newer checkpoint.
  const pollWait = deferred(), snapshots = [], fresh = room('A', 2, 12); let fetches = 0;
  const same = setup({onRoom: value => snapshots.push(value.revision)}, {
    getRoom: () => ++fetches === 1 ? pollWait.promise : Promise.resolve(fresh), saveRoom: async () => ({revision: 2})
  });
  same.connection.connect(room('A')); await flush(); const oldPoll = same.tick(); await flush(); await same.connection.save({time: 2});
  pollWait.resolve(room('A', 1, 11)); await oldPoll;
  assert.equal(same.connection.room.revision, 2); assert.equal(same.connection.sequence, 12); assert.deepEqual(snapshots, [1, 2]); same.connection.stop();
  const retryWait = deferred(), retries = [], recoverySnapshots = []; let staleFetches = 0;
  const retry = setup({onRoom: value => recoverySnapshots.push(value.revision), onError: error => retries.push(error.code)}, {
    getRoom: () => ++staleFetches === 1 ? retryWait.promise : Promise.resolve(room('A', staleFetches === 2 ? 1 : 2, 12)), saveRoom: async () => ({revision: 2})
  });
  retry.connection.connect(room('A')); await flush(); const stalePoll = retry.tick(); await flush(); await retry.connection.save({time: 2});
  retryWait.resolve(room('A', 1, 11)); await stalePoll;
  assert.equal(retry.connection.room.revision, 2); assert.equal(retry.connection.sequence, 10); assert.deepEqual(recoverySnapshots, [1]);
  assert.deepEqual(retries, ['room_stale_response']); assert(retry.connection.active); await retry.tick();
  assert.equal(retry.connection.sequence, 12); assert.deepEqual(recoverySnapshots, [1, 2]); retry.connection.stop();
  for (const waitOn of ['snapshot', 'events']) {
    const wait = deferred(), errors = [], oldUpdate = room('A', 1, 11); oldUpdate.events = [{sequence: 11}];
    const f = setup({onRoom: update => update.sequence === 11 && waitOn === 'snapshot' ? wait.promise : undefined,
      onEvents: () => waitOn === 'events' ? wait.promise : undefined, onError: error => errors.push(error.code)}, {
      getRoom: async () => oldUpdate, saveRoom: async () => ({revision: 2})
    });
    f.connection.connect(room('A')); await flush(); const oldTick = f.tick(); await flush(); await f.connection.save({time: 2});
    wait.resolve(); await oldTick;
    assert.equal(f.connection.room.revision, 2); assert.equal(f.connection.sequence, 10); assert.deepEqual(errors, ['room_stale_response']); f.connection.stop();
  }
  // Test the actual event consumer across its SharedGrabs await, including reconnecting to the same room.
  const experienceFile = __layout.map(path.join(__layout.oldDir("scripts/test-studio-room-races.js"), 'test-studio-experience.js')), experienceCode = fs.readFileSync(experienceFile, 'utf8');
  const {fixture, calls} = new Function('require', '__dirname', experienceCode.slice(0, experienceCode.indexOf('\nasync function run()')) + '\nreturn {fixture: setup, calls};')(require('node:module').createRequire(experienceFile), __dirname);
  for (const nextId of ['B', 'A']) {
    const e = fixture(), eventWait = deferred(), oldSet = e.appliedEvents; e.room = {id: 'A', role: 'host'};
    e.sharedGrabs = {applyEvent: () => eventWait.promise}; let commands = 0; e.rawCommand = () => commands++;
    const applying = e.applyEvents([{sequence: 9, type: 'action', payload: {type: 'control', objectId: 'belt', action: 'start'}}], {id: 'A'});
    e.room = {id: nextId, role: 'host'}; e.appliedEvents = new Set(); eventWait.resolve(); await applying;
    assert.equal(commands, 0); assert.equal(e.appliedEvents.size, 0); assert.equal(oldSet.size, 0);
    const currentRoom = e.room; await e.receiveRoom({id: 'obsolete', revision: 9}); assert.strictEqual(e.room, currentRoom);
  }
  assert.equal(calls.length, 0);
  console.log('Studio room races: stale snapshots, events, poses, saves, actions, authentication, reentrant callbacks and same-room reconnects isolated; saved revision never rolls back.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
