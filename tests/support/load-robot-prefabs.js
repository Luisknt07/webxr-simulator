const __layout = require("../../tooling/layout.cjs");
// Load the real browser module into the same Three.js realm as headless tests.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
module.exports = function loadRobotPrefabs(THREE) {
  const source = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/load-robot-prefabs.js"), '../src/editor/RobotPrefabs.js')), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  const result = new Function('THREE', 'robotSchema', 'kinematics', source + '\nreturn {createRobot, refreshRobotGeometry, updateRobotPose, getRobotToolTransform};')
    (THREE, require('../../modules/logistica-industrial/functions/robots/schema/robots.js'), require('../../modules/logistica-industrial/functions/robots/schema/robot-kinematics.js'));
  Object.assign(result, require('./load-product-prefabs.js')(THREE));
  Object.assign(result, require('./load-vehicle-prefabs.js')(THREE));
  // Source-level fixture loaders execute the moved production factory in one
  // Three realm. Resolve only these exact known filenames to the already
  // loaded implementation; never pass an arbitrary source path to require().
  result.resolve = id => {
    const name = typeof id === 'string' ? path.posix.basename(id.replace(/\\/g, '/')) : '';
    if (!['RobotPrefabs.js', 'ProductPrefabs.js', 'VehiclePrefabs.js'].includes(name)) throw new Error('Módulo de prefab no compatible: ' + id);
    return result;
  };
  return result;
};
