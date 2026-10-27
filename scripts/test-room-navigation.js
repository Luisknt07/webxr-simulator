// Room transitions use deferred boundary adapters; the frame-loop checks run
// the production animate function with explicit ECS/render/collision adapters.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const navigationSource = fs.readFileSync(path.join(__dirname, '../src/lib/RoomNavigation.js'), 'utf8')
  .replace('export default class RoomNavigation', 'return class RoomNavigation');
const RoomNavigation = new Function(navigationSource)();

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

function navigationHarness() {
  const ctx = {room: 0, roomTransition: false};
  const calls = {prepare: [], commit: [], loading: [], errors: [], settled: 0};
  const preparations = new Map();
  let version = 1;
  const navigation = new RoomNavigation(ctx, {
    count: 4,
    getVersion: () => version,
    prepare: async room => {
      calls.prepare.push(room);
      if (preparations.has(room)) await preparations.get(room).promise;
    },
    commit: room => { calls.commit.push(room); ctx.room = room; },
    onLoading: room => calls.loading.push(room),
    onError: error => calls.errors.push(error),
    onSettled: () => calls.settled++
  });
  return {ctx, calls, preparations, navigation, nextProject: () => version++};
}

async function testNavigation() {
  {
    const {ctx, calls, preparations, navigation} = navigationHarness();
    const load = deferred(); preparations.set(1, load);
    const opening = navigation.go(1);
    assert.strictEqual(navigation.go(1), opening, 'Requests for the same pending room share the same Promise.');
    await Promise.resolve();
    assert.deepEqual(calls.prepare, [1]);
    assert.equal(ctx.room, 0, 'The current room remains usable while destination resources prepare.');
    assert.equal(ctx.roomTransition, true);
    assert.deepEqual(calls.commit, []);
    load.resolve();
    assert.equal(await opening, true);
    assert.equal(ctx.room, 1);
    assert.equal(ctx.roomTransition, false);
    assert.equal(navigation.pending, null);
    assert.deepEqual(calls.commit, [1]);
    assert.deepEqual(calls.loading, [1]);
    assert.equal(calls.settled, 1);
  }
  {
    const {ctx, calls, preparations, navigation} = navigationHarness();
    const first = deferred(), last = deferred();
    preparations.set(1, first); preparations.set(2, last);
    const oldRequest = navigation.go(1); await Promise.resolve();
    const newestRequest = navigation.go(2); await Promise.resolve();
    first.resolve();
    assert.equal(await oldRequest, false, 'An older completed request cannot win a later navigation.');
    assert.equal(ctx.room, 0);
    assert.equal(ctx.roomTransition, true, 'Finishing an obsolete request cannot clear a newer transition.');
    assert.equal(navigation.pending.room, 2);
    assert.equal(calls.settled, 0);
    last.resolve();
    assert.equal(await newestRequest, true);
    assert.equal(ctx.room, 2);
    assert.deepEqual(calls.commit, [2]);
    assert.equal(calls.settled, 1);
    assert.equal(ctx.roomTransition, false);
  }
  {
    const {ctx, calls, preparations, navigation} = navigationHarness();
    const load = deferred(); preparations.set(1, load);
    const opening = navigation.go(1); await Promise.resolve();
    navigation.cancel();
    assert.equal(navigation.pending, null);
    assert.equal(ctx.roomTransition, false);
    load.resolve();
    assert.equal(await opening, false);
    assert.equal(ctx.room, 0);
    assert.deepEqual(calls.commit, []);
  }
  {
    const {ctx, calls, preparations, navigation, nextProject} = navigationHarness();
    const load = deferred(); preparations.set(1, load);
    const opening = navigation.go(1); await Promise.resolve();
    nextProject(); load.resolve();
    assert.equal(await opening, false, 'A destination prepared for an old project cannot enter the new project.');
    assert.equal(ctx.room, 0);
    assert.equal(ctx.roomTransition, false);
    assert.equal(navigation.pending, null);
    assert.deepEqual(calls.commit, []);
    assert.equal(calls.settled, 1);
  }
  {
    const {ctx, calls, preparations, navigation} = navigationHarness();
    const broken = deferred(); preparations.set(1, broken);
    const opening = navigation.go(1); await Promise.resolve();
    const failure = new Error('Model unavailable'); broken.reject(failure);
    assert.equal(await opening, false);
    assert.strictEqual(calls.errors[0], failure);
    assert.equal(ctx.room, 0, 'Preparation failure retains the current room.');
    assert.equal(ctx.roomTransition, false);
    assert.equal(navigation.pending, null);
    assert.equal(calls.settled, 1);
    preparations.delete(1);
    assert.equal(await navigation.go(1), true, 'A failed destination remains retryable.');
    assert.equal(ctx.room, 1);
    assert.deepEqual(calls.commit, [1]);
    assert.equal(calls.settled, 2);
  }
  {
    const {ctx, calls, preparations, navigation} = navigationHarness();
    const load = deferred(); preparations.set(1, load);
    const pending = navigation.go(1); await Promise.resolve();
    for (const invalid of [-1, 4, 0.5, NaN, Infinity, '1', null, undefined]) {
      assert.equal(await navigation.go(invalid), false);
      assert.equal(ctx.room, 0);
      assert.equal(navigation.pending.room, 1, 'Invalid input does not replace a valid transition.');
    }
    assert.equal(await navigation.go(0), true, 'Requesting the current room cancels a pending departure.');
    assert.equal(navigation.pending, null);
    assert.equal(ctx.roomTransition, false);
    assert.equal(calls.settled, 1);
    load.resolve();
    assert.equal(await pending, false);
    assert.deepEqual(calls.commit, []);
    assert.equal(calls.settled, 1);
  }
}

const indexSource = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');
const animateMatch = indexSource.match(/function animate\(time, frame\) \{[^]*?\n\}/);
assert(animateMatch, 'Production animate function is available for frame-boundary checks.');

function frameHarness(options = {}) {
  const calls = [];
  const clock = {elapsedTime: 15, getDelta: () => { calls.push(['clock']); return 0.75; }};
  const invoke = name => (...args) => {
    calls.push([name, ...args]);
    if (options.fail === name) throw new Error(name + ' fixture failure');
  };
  const document = {hidden: Boolean(options.hidden), getElementById: id => {
    calls.push(['query', id]); return {classList: {toggle: invoke('reticle')}};
  }};
  const context = {
    room: 0, goto: options.goto === undefined ? null : options.goto, vrMode: Boolean(options.xr),
    collisionWorld: {beginFrame: invoke('begin'), endFrame: invoke('end'), invalidate: invoke('invalidate')},
    editor: {active: Boolean(options.editor), render: invoke('editorRender'), execute: invoke('editorExecute')},
    raycontrol: {execute: invoke('ray')}
  };
  const scene = {updateMatrixWorld: invoke('matrices')};
  const camera = {};
  const dependencies = {
    clock, document, context,
    updateKeyboardMovement: invoke('walk'),
    syncXRControllers: invoke('syncControllers'),
    ecsyWorld: {execute: invoke('ecs')},
    scene, camera,
    controllers: [{getObjectByName: () => ({}), boundingBox: {setFromObject: invoke('controllerBounds')}}],
    desktopController: {boundingBox: {setFromObject: invoke('desktopBounds')}},
    desktopControllerData: {currentIntersection: null},
    rooms: [{execute: invoke('room')}],
    constrainVRCamera: invoke('vrCollision'),
    renderer: {render: invoke('render')},
    gotoRoom: invoke('goto')
  };
  const animate = new Function(...Object.keys(dependencies), animateMatch[0] + '\nreturn animate;')(...Object.values(dependencies));
  return {animate, calls, context};
}

function testFrameBoundaries() {
  const names = harness => harness.calls.map(call => call[0]);
  const hidden = frameHarness({hidden: true}); hidden.animate();
  assert.deepEqual(names(hidden), ['clock'], 'A hidden desktop tab does not execute systems, query DOM, render or begin collision work.');

  const xr = frameHarness({hidden: true, xr: true, editor: true}), xrFrame = {nativeFrame: true}; xr.animate(1234, xrFrame);
  assert(names(xr).includes('ecs'), 'A hidden companion tab keeps the headset simulation running.');
  assert(names(xr).includes('render'));
  assert(!names(xr).includes('editorRender'), 'XR always uses the immersive runtime even if authoring was active.');
  assert.equal(xr.calls.find(call => call[0] === 'syncControllers')[1], xrFrame, 'The native XRFrame reaches grip tracking inside the same protected frame boundary.');
  assert.equal(xr.calls.find(call => call[0] === 'walk')[1], 0.75, 'Movement applies its own input delta limit.');
  assert.equal(xr.calls.find(call => call[0] === 'editorExecute')[1], 0.75,
    'The simulation receives the original delta so its substep limit and dropped-time analytics remain accurate.');
  assert(names(xr).indexOf('begin') < names(xr).indexOf('ecs'));
  assert.equal(names(xr).at(-1), 'end');

  const editor = frameHarness({editor: true}); editor.animate();
  assert.deepEqual(names(editor), ['clock', 'begin', 'editorRender', 'end'], 'The authoring early return always closes its collision frame.');
  assert.equal(editor.calls.find(call => call[0] === 'editorRender')[1], 0.75);

  for (const fail of ['editorRender', 'walk', 'ecs', 'ray', 'room', 'editorExecute', 'render']) {
    const harness = frameHarness({fail, editor: fail === 'editorRender'});
    assert.throws(harness.animate, new RegExp(fail + ' fixture failure'));
    assert.equal(names(harness).filter(name => name === 'begin').length, 1);
    assert.equal(names(harness).filter(name => name === 'end').length, 1, fail + ' errors must release collision frame state.');
    assert.equal(names(harness).at(-1), 'end');
  }

  const navigation = frameHarness({goto: 2}); navigation.animate();
  assert.deepEqual(navigation.calls.find(call => call[0] === 'goto'), ['goto', 2]);
  assert.equal(navigation.context.goto, null, 'A queued room request is consumed once.');
  assert.equal(names(navigation).at(-1), 'end');

  const noCollision = frameHarness(); noCollision.context.collisionWorld = null;
  assert.doesNotThrow(noCollision.animate, 'The frame boundary supports startup before a collision world exists.');
  assert(!names(noCollision).includes('begin'));
  assert(!names(noCollision).includes('end'));
}

(async () => {
  await testNavigation();
  testFrameBoundaries();
  console.log('Room navigation: awaited atomic transitions, deduplication, latest request/project wins, cancellation/retry; production frame loop: hidden desktop pause, XR continuity and collision cleanup passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
