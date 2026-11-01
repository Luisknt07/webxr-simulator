'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), h = require('./test-robot-runtime.js'), tasks = h.robotSchema.taskProgram;
const clean = v => JSON.parse(JSON.stringify(v, (k, n) => typeof n === 'number' ? Math.round(n * 1e9) / 1e9 : n));
const state = f => clean({taskViaIndex: f.r.taskViaIndex, phase: f.r.phase, elapsed: f.r.phaseElapsed, pose: f.r.pose, entry: f.r.entry.id});
const refresh = f => {f.r = f.runtime.records.get(f.robot.userData.editorId).components.robot; f.input = f.runtime.records.get(f.source.userData.editorId).components.source; f.result = f.runtime.records.get(f.output.userData.editorId).components.source;};
function fixture(options = {}) {
  const f = h.fixture('articulated', {mode: 'manual', visualModel: 'legacy'}); f.runtime.stop();
  const p = {...tasks.defaults(), sourceId: f.source.userData.editorId, outputId: f.output.userData.editorId, speed: 2, gripWait: .08, releaseWait: .08, via: [{x: .8, y: 1.1, z: .08}], ...options};
  Object.assign(f.configs.get(f.robot)[0], {taskEnabled: true, taskProgramJson: JSON.stringify(p)}); f.scene.updateMatrixWorld(true); f.runtime.start('hall'); refresh(f); return f;
}
const f = fixture(), ids = f.input.queue.map(e => e.id), phases = new Set();
h.advance(f, .2); assert.equal(f.r.phase, 'idle'); f.runtime.command(f.robot.userData.editorId, 'dispatch');
for (let t = 0; t < 30 && !(f.r.completed === 1 && f.r.phase === 'idle'); t += 1 / 60) { phases.add(f.r.phase); h.advance(f, 1 / 60); }
assert.equal(f.r.completed, 1); for (const phase of ['approach', 'pick', 'task-grip-wait', 'lift', 'task-via', 'carry', 'place', 'task-release-wait', 'release', 'return']) assert(phases.has(phase), phase);
assert.equal(f.result.queue[0].id, ids[0]); assert.equal(h.sum(f), 3); assert.equal(f.r.taskCycleCompleted, true);
const home = h.robotKinematics.homePose(f.r.config); assert(Math.hypot(f.r.pose.tcp.x - home.tcp.x, f.r.pose.tcp.y - home.tcp.y, f.r.pose.tcp.z - home.tcp.z) < f.r.config.positionTolerance);
h.advance(f, 1); assert.equal(f.r.completed, 1, 'A non-repeating authored task waits for the next explicit cycle.');
f.runtime.command(f.robot.userData.editorId, 'dispatch'); h.until(f, () => f.r.completed === 2 && f.r.phase === 'idle'); assert.equal(f.result.queue[1].id, ids[1]); assert.equal(h.sum(f), 3); f.runtime.stop();

const bad = fixture({via: [{x: 19, y: 19, z: 19}]}); bad.runtime.command(bad.robot.userData.editorId, 'dispatch'); h.advance(bad, .2); assert(bad.r.fault.includes('tarea programada')); assert.equal(bad.input.queue.length, 3); assert.equal(bad.r.entry, null); assert.equal(bad.r.candidate, null); bad.runtime.stop();

const repeated = fixture({repeat: true, via: []}); h.advance(repeated, .2); assert.equal(repeated.r.phase, 'idle', 'Manual repetition still needs the first explicit cycle.'); repeated.runtime.command(repeated.robot.userData.editorId, 'dispatch'); h.until(repeated, () => repeated.r.completed === 3, 60); assert.equal(h.sum(repeated), 3); assert.equal(repeated.result.queue.length, 3); repeated.runtime.stop();

const guarded = fixture(); guarded.runtime.command(guarded.robot.userData.editorId, 'dispatch'); h.until(guarded, () => guarded.r.phase === 'task-via' && guarded.r.phaseElapsed > .05);
const held = guarded.r.entry, pose = JSON.stringify(guarded.r.pose), elapsed = guarded.r.phaseElapsed, matrix = held.product.object.matrixWorld.toArray(), originalGuard = guarded.runtime.robotRuntime.armClear;
let checks = 0; guarded.runtime.robotRuntime.armClear = function(record, heldMatrix) {if (record.components.robot.phase === 'task-via') {checks++; return false;} return originalGuard.call(this, record, heldMatrix);};
h.advance(guarded, .15); assert(checks > 0); assert.equal(JSON.stringify(guarded.r.pose), pose); assert.equal(guarded.r.phaseElapsed, elapsed); assert.deepEqual(held.product.object.matrixWorld.toArray(), matrix); assert.equal(guarded.r.entry, held, 'A blocked programmed waypoint rolls back pose and held cargo through the native guard.'); guarded.runtime.robotRuntime.armClear = originalGuard;
guarded.runtime.command(guarded.robot.userData.editorId, 'emergency'); h.advance(guarded, .1); assert.equal(guarded.r.phaseElapsed, elapsed); assert.equal(guarded.r.entry, held); guarded.runtime.command(guarded.robot.userData.editorId, 'resetEmergency'); guarded.runtime.command(guarded.robot.userData.editorId, 'start'); h.until(guarded, () => guarded.r.completed === 1 && guarded.r.phase === 'idle'); assert.equal(guarded.result.queue[0], held); guarded.runtime.stop();

const helperCode = fs.readFileSync(require.resolve('./test-conveyor-mechanisms.js'), 'utf8'), checkpoint = new Function('require', '__dirname', helperCode.slice(0, helperCode.indexOf('async function run()')) + '\nreturn checkpoint;')(require, __dirname);
const resumed = fixture(); resumed.runtime.command(resumed.robot.userData.editorId, 'dispatch'); h.until(resumed, () => resumed.r.phase === 'task-via' && resumed.r.phaseElapsed > .05);
const saved = JSON.parse(JSON.stringify(checkpoint.captureSimulation(resumed.runtime))), before = state(resumed);
h.advance(resumed, .2); const expected = state(resumed);
checkpoint.restoreSimulation(resumed.runtime, saved, {reuse: true}); refresh(resumed); assert.deepEqual(state(resumed), before); h.advance(resumed, .2); assert.deepEqual(state(resumed), expected); h.until(resumed, () => resumed.r.completed === 1 && resumed.r.phase === 'idle'); assert.equal(h.sum(resumed), 3); resumed.runtime.stop();
console.log('Robot tasks: complete native cycle, actual custody/station delivery, manual/repeat behavior, pre-reservation reach rejection, waypoint rollback, emergency and exact checkpoint continuation passed.');
