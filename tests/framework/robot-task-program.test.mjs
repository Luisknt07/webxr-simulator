import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url), tasks = require('../../modules/logistica-industrial/functions/robots/schema/robot-task-program.js'), robots = require('../../modules/logistica-industrial/functions/robots/schema/robots.js'), kinematics = require('../../modules/logistica-industrial/functions/robots/schema/robot-kinematics.js');

test('robot tasks retain bounded declarative parameters and require explicit activation with matching equipment links', () => {
  const config = robots.normalize({}), program = tasks.defaults(config); assert.equal(config.taskEnabled, false); assert.equal(config.taskProgramJson, '');
  program.sourceId = 'source-a'; program.outputId = 'source-b'; program.via = [{x: .7, y: 1, z: .1}];
  const next = robots.normalize({...config, sourceId: program.sourceId, outputId: program.outputId, taskEnabled: true, taskProgramJson: JSON.stringify(program)});
  assert.deepEqual(tasks.forConfig(next), program); assert.equal(tasks.forConfig(config), null);
  assert.throws(() => robots.normalize({...next, outputId: 'source-other'}), /conexiones/i);
  assert.throws(() => robots.normalize({...next, family: 'amr', variant: 'amr', tool: 'platform', operation: 'transport'}), /robot fijo/i);
  assert.throws(() => robots.normalize({...config, taskEnabled: true}), /crea y valida/i);
});

test('robot task JSON rejects executable extras, prototype keys, malformed points, sparse arrays and nonfinite parameters', () => {
  const p = tasks.defaults();
  for (const value of ['alert(document.cookie)', '{"__proto__":{}}', {...p, script: 'run()'}, {...p, via: Array(2)}, {...p, via: Array(9).fill({x: 0, y: 1, z: 0})}, {...p, speed: NaN}, {...p, clearance: -1}, {...p, returnPoint: {x: 0, y: Infinity, z: 0}}, {...p, via: [{x: 1, y: 1, z: 0, constructor: 1}]}, {...p, repeat: 'true'}]) assert.throws(() => tasks.normalize(value));
  assert.throws(() => tasks.normalize(' '.repeat(16001)), /16.000/);
});

test('a complete shadow cycle uses the same IK with explicit grip/carry/release/return phases while preserving every source input', () => {
  const config = robots.normalize({visualModel: 'legacy'}), p = {...tasks.defaults(config), sourceId: 'a', outputId: 'b', via: [{x: .8, y: 1.05, z: 0}]}, e = {pickup: {x: .85, y: .86, z: .3}, place: {x: .85, y: .86, z: -.5}, payloadSize: [.25, .25, .25]}, before = JSON.stringify({config, p, e});
  const result = tasks.preview(config, p, e, kinematics);
  assert(result.frames.length <= 300 && result.duration > 0); assert.equal(JSON.stringify({config, p, e}), before);
  assert(result.frames.every(f => f.pose.reached !== false && f.pose.error <= config.positionTolerance));
  assert(result.frames.some(f => f.phase === 'grip' && f.carrying)); assert(result.frames.some(f => f.phase === 'via-0' && f.carrying)); assert(result.frames.some(f => f.phase === 'release' && !f.carrying));
  const last = result.frames.at(-1), home = kinematics.homePose(config); assert.equal(last.phase, 'return'); assert(Math.hypot(last.pose.tcp.x - home.tcp.x, last.pose.tcp.y - home.tcp.y, last.pose.tcp.z - home.tcp.z) < config.positionTolerance);
});

test('unreachable paths and missing endpoints cannot be advertised as a validated preview', () => {
  const config = robots.normalize({}), p = tasks.defaults(config), e = {pickup: {x: .8, y: .8, z: .2}, place: {x: .8, y: .8, z: -.2}};
  assert.throws(() => tasks.preview(config, p, {}, kinematics), /origen/i);
  assert.throws(() => tasks.preview(config, {...p, via: [{x: 19, y: 19, z: 19}]}, e, kinematics), /alcance/i);
});
