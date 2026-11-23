import test from 'node:test';
import assert from 'node:assert/strict';
import {PresentationGuard, DemoRecovery} from '../../apps/public-viewer/SceneResilience.js';

test('a broken optional display leaves logistics running and stops retrying after three spaced failures', () => {
 let now = 0, physicsSteps = 0, displayCalls = 0;
 const errors = [], guard = new PresentationGuard({now: () => now, onError: row => errors.push(row)});
 const frame = () => {
  guard.run('monitor', () => {displayCalls++; throw Error('Disconnected monitor');});
  physicsSteps++;
 };
 for (let index = 0; index < 240; index++) {frame(); now += 1000 / 60;}
 assert.equal(physicsSteps, 240);
 assert.equal(displayCalls, 3);
 assert.equal(errors.length, 3);
 assert.equal(guard.stats()[0].disabled, true);
 assert.equal(guard.stats()[0].message, 'Disconnected monitor');
 assert.equal(guard.run('other camera', () => {}), true);
 guard.reset();
 assert.equal(guard.run('monitor', () => {displayCalls++;}), true);
 assert.deepEqual(guard.stats(), []);
});

test('a recovered display can continue and a faulty observer cannot interrupt the frame', () => {
 let now = 0;
 const guard = new PresentationGuard({now: () => now, onError() {throw Error('Observer unavailable');}});
 assert.equal(guard.run('monitor', () => {throw Error('Temporary');}), false);
 assert.equal(guard.run('monitor', () => assert.fail('Retry must wait')), false);
 now = 1000;
 assert.equal(guard.run('monitor', () => {}), true);
 assert.equal(guard.stats()[0].consecutive, 0);
 assert.equal(guard.run('monitor', () => {throw Error('Later incident');}), false);
 assert.equal(guard.stats()[0].consecutive, 1);
 assert.equal(guard.stats()[0].total, 2);
});

function recoveryFixture(options = {}) {
 let now = 0, next = 0;
 const timers = new Map(), events = [];
 const recovery = new DemoRecovery({
  now: () => now,
  schedule(fn, delay) {const id = ++next; timers.set(id, {fn, delay}); return id;},
  cancel: id => timers.delete(id),
  restart: () => events.push('full restart'),
  onRecovered: () => events.push('recovered'),
  onFailure: error => events.push(error.message),
  ...options
 });
 return {recovery, events, timers, time: value => {now = value;}, fire() {const [id, timer] = timers.entries().next().value; timers.delete(id); timer.fn();}};
}

test('a critical failure schedules one full restart outside the failed frame and bounds repeated restarts', () => {
 const f = recoveryFixture();
 assert.equal(f.recovery.request(), true);
 assert.equal(f.recovery.request(), true);
 assert.equal(f.timers.size, 1);
 assert.deepEqual(f.events, [], 'The partly applied step cannot be retried inside the failing frame.');
 f.fire();
 assert.deepEqual(f.events, ['full restart', 'recovered']);
 assert.deepEqual(f.recovery.stats(), {attempts: 1, pending: false});
 assert.equal(f.recovery.request(), false, 'A persistent fault must not cause an automatic restart loop.');
 f.time(30000);
 assert.equal(f.recovery.request(), true);
 f.recovery.dispose();
 assert.equal(f.timers.size, 0);
 assert.equal(f.recovery.request(), false);
});

test('an unsuccessful full restart reports its error and manual reset permits a fresh attempt', () => {
 const f = recoveryFixture({restart() {throw Error('Authored state unavailable');}});
 f.recovery.request(); f.fire();
 assert.deepEqual(f.events, ['Authored state unavailable']);
 assert.equal(f.recovery.request(), false);
 f.recovery.reset();
 assert.equal(f.recovery.request(), true);
 f.recovery.reset();
 assert.equal(f.timers.size, 0);
});
