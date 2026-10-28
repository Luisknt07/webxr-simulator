'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const schema = require('../shared/behaviors.js');
const fixture = fs.readFileSync(path.join(__dirname, 'test-conveyor-mechanisms.js'), 'utf8');
const {setup} = new Function('require', '__dirname', fixture.slice(0, fixture.indexOf('async function run()')) + '\nreturn {setup};')(require, __dirname);
const builders = require('./load-industrial-cedi.js')(THREE, schema);
const robotConfig = (document, object) => document.getBehaviors(object).find(value => value.type === 'robot');
function compact(document, result, sourceLinks = true) {
  assert.deepEqual(result.cells.map(cell => cell.role), ['loading', 'transfer', 'unloading']);
  assert.equal(result.warnings.length, 0);
  for (const cell of result.cells) {
    const config = robotConfig(document, cell.robot), home = schema.robotKinematics.homePose(config);
    assert(config.reach <= 3.2, 'Four-pallet cells use a real bounded industrial arm rather than stretching one to 5.5 m.');
    assert(config.payloadKg <= 25, 'A separate pallet logistics Source cannot inflate the carton cell payload.');
    assert(home.tcp.y <= 1.300001 && home.tcp.y >= .9, 'Ready tooling is folded at a usable metric height.');
    assert.deepEqual(cell.robot.scale.toArray(), [1, 1, 1], 'The whole mechanism must never be cosmetically rescaled to fake its reach.');
    assert.equal(config.sourceId, cell.source.userData.editorId); assert.equal(config.outputId, cell.target.userData.editorId);
    if (sourceLinks) assert(document.getBehaviors(cell.source).some(value => value.outputId === cell.robot.userData.editorId));
  }
}
for (const kind of ['sorting', 'packing', 'lab']) {
  const f = setup(), built = kind === 'lab' ? builders.buildIndustrialLab(f.document, 'hall', {scene: f.scene, continuous: true}) : builders.buildIndustrialCediLevel(f.document, 'hall', {kind, scene: f.scene, continuous: true});
  const lines = built.lines || built.cells, previous = new Map(f.document.getObjects('hall').map(object => [object, object.matrix.toArray()]));
  const capacities = new Map(f.document.getObjects('hall').flatMap(object => f.document.getBehaviors(object).filter(value => value.type === 'palletQueue').map(value => [object, [value.capacity, value.palletCapacity, value.layers]])));
  let ikCalls = 0; const inverse = schema.robotKinematics.inverse;
  schema.robotKinematics.inverse = (...args) => {ikCalls++; return inverse(...args);};
  const started = performance.now(); let result;
  try {result = builders.retrofitCediRobotics(f.document, 'hall', {lines, vehicles: false});} finally {schema.robotKinematics.inverse = inverse;}
  compact(f.document, result);
  assert(ikCalls < 500, 'Broad geometric rejection and shared mechanical configurations bound the placement search.');
  for (const [object, matrix] of previous) assert.deepEqual(object.matrix.toArray(), matrix, 'Interposing a compact cell preserves existing equipment poses.');
  for (const [object, capacity] of capacities) {const config = f.document.getBehaviors(object).find(value => value.type === 'palletQueue'); assert.deepEqual([config.capacity, config.palletCapacity, config.layers], capacity, 'The fix retains every pallet bay and stack capacity.');}
  console.log(kind + ': compact continuous cells; ' + ikCalls + ' IK calls; ' + (performance.now() - started).toFixed(1) + ' ms generation on this test machine.');
  if (kind !== 'lab') continue;
  const logistics = f.document.addPrefab('hall', 'source');
  f.document.setTransform(logistics, {position: [100, 1, 100]});
  f.document.setBehaviors(logistics, f.document.getBehaviors(logistics).map(value => value.type === 'source' ? {...value, loadMode: 'pallet', autoGenerate: true, initialCount: 1, width: 2, depth: 2, height: 2, mass: 73, catalog: JSON.stringify([{id: 'unrelated-pallet', name: 'Expedición independiente', type: 'box', width: 2, depth: 2, height: 2, mass: 73, color: '#ab895e'}])} : value));
  const ids = result.cells.map(cell => cell.robot.userData.editorId), preserved = [];
  result.cells.forEach(cell => {
    const config = robotConfig(f.document, cell.robot), enlarged = {...config, reach: 5.5, baseHeight: .85, frameColor: '#325762', accentColor: '#574231', speed: .45, tool: 'vacuum', jointLimitsJson: '[]'};
    const high = schema.robotKinematics.inverse(enlarged, {x: 5.5 * .25, y: .85 + 5.5 * .65, z: 0});
    enlarged.jointLimitsJson = JSON.stringify(schema.robots.getJointDefinitions(enlarged).map((joint, index) => ({id: joint.id, min: joint.min, max: joint.max, home: high.joints[index]})));
    f.document.setBehaviors(cell.robot, f.document.getBehaviors(cell.robot).map(value => value.type === 'robot' ? enlarged : value));
    preserved.push({sourceId: config.sourceId, outputId: config.outputId, limits: schema.robots.getJointDefinitions(enlarged).map(joint => [joint.min, joint.max])});
  });
  const count = f.document.getObjects('hall').length;
  // An explicitly configured pull-source remains valid even when its visible
  // output was later disconnected by the author. Refit is not a graph reset.
  const editedSource = result.cells[0].source;
  f.document.setBehaviors(editedSource, f.document.getBehaviors(editedSource).map(value => value.type === 'source' ? {...value, outputId: ''} : value));
  assert.equal(builders.retrofitCediRobotics(f.document, 'hall', {vehicles: false}).changed, false, 'Saved custom cells are untouched without the explicit refit option.');
  const refit = builders.retrofitCediRobotics(f.document, 'hall', {vehicles: false, refitRobotCells: true});
  compact(f.document, refit, false); assert.equal(f.document.getObjects('hall').length, count); assert.deepEqual(refit.cells.map(cell => cell.robot.userData.editorId), ids);
  assert.equal(f.document.getBehaviors(editedSource).find(value => value.type === 'source').outputId, '', 'Explicit refit preserves an independently edited Source output.');
  refit.cells.forEach((cell, index) => {const config = robotConfig(f.document, cell.robot); for (const [key, expected] of Object.entries({frameColor: '#325762', accentColor: '#574231', speed: .45, tool: 'vacuum', sourceId: preserved[index].sourceId, outputId: preserved[index].outputId})) assert.equal(config[key], expected, 'Explicit refit preserves authored ' + key); assert.deepEqual(schema.robots.getJointDefinitions(config).map(joint => [joint.min, joint.max]), preserved[index].limits);});
  console.log('Explicit legacy refit preserves IDs, links, colors, tool, speed and joint limits; unrelated 73 kg pallet Source is excluded.');
}
