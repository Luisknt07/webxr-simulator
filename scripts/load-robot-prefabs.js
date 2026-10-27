// Load the real browser module into the same Three.js realm as headless tests.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
module.exports = function loadRobotPrefabs(THREE) {
  const source = fs.readFileSync(path.join(__dirname, '../src/editor/RobotPrefabs.js'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  const result = new Function('THREE', 'robotSchema', 'kinematics', source + '\nreturn {createRobot, refreshRobotGeometry, updateRobotPose, getRobotToolTransform};')
    (THREE, require('../shared/robots.js'), require('../shared/robot-kinematics.js'));
  Object.assign(result, require('./load-product-prefabs.js')(THREE));
  Object.assign(result, require('./load-vehicle-prefabs.js')(THREE));
  result.resolve = id => { if (!['./RobotPrefabs.js', './ProductPrefabs.js', './VehiclePrefabs.js'].includes(id)) throw new Error('Módulo de prefab no compatible: ' + id); return result; };
  return result;
};
