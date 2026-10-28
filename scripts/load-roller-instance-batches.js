'use strict';
const fs = require('node:fs'), path = require('node:path');
module.exports = function loadRollerInstanceBatches(THREE) {
  const source = fs.readFileSync(path.join(__dirname, '../src/editor/RollerInstanceBatches.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class RollerInstanceBatches', 'return class RollerInstanceBatches');
  return new Function('THREE', source)(THREE);
};
