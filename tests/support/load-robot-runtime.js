const __layout = require("../../tooling/layout.cjs");
'use strict';
const fs = require('node:fs');
const path = require('node:path');
module.exports = function loadRobotRuntime(THREE, prefabs) {
  prefabs = prefabs || require('./load-robot-prefabs.js')(THREE);
  const source = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/load-robot-runtime.js"), '../src/editor/RobotRuntime.js')), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace('export default class RobotRuntime', 'return class RobotRuntime');
  return new Function('THREE', 'robotSchema', 'robotKinematics', 'updateRobotPose', source)
    (THREE, require('../../modules/logistica-industrial/functions/robots/schema/robots.js'), require('../../modules/logistica-industrial/functions/robots/schema/robot-kinematics.js'), prefabs.updateRobotPose);
};
