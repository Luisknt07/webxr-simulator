'use strict';
const fs = require('node:fs');
const path = require('node:path');
module.exports = function loadPalletQueueRuntime(THREE, behaviorSchema) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/editor/PalletQueueRuntime.js'), 'utf8')
    .replace(/^\uFEFF/, '').replace(/^import .*;\r?\n/gm, '').replace('export default class PalletQueueRuntime', 'return class PalletQueueRuntime');
  return new Function('THREE', 'behaviorSchema', source)(THREE, behaviorSchema);
};
