'use strict';
const fs = require('node:fs');
const path = require('node:path');
module.exports = function loadRobotRuntime(THREE, prefabs) {
  prefabs = prefabs || require('./load-robot-prefabs.js')(THREE);
  const source = fs.readFileSync(path.join(__dirname, '../src/editor/RobotRuntime.js'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace('export default class RobotRuntime', 'return class RobotRuntime');
  return new Function('THREE', 'robotSchema', 'robotKinematics', 'updateRobotPose', source)
    (THREE, require('../shared/robots.js'), require('../shared/robot-kinematics.js'), prefabs.updateRobotPose);
};
