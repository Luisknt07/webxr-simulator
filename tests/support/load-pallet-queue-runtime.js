const __layout = require("../../tooling/layout.cjs");
'use strict';
const fs = require('node:fs');
const path = require('node:path');
module.exports = function loadPalletQueueRuntime(THREE, behaviorSchema) {
  const source = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/load-pallet-queue-runtime.js"), '..', "modules/logistica-industrial/functions/almacenamiento/runtime/PalletQueueRuntime.js")), 'utf8')
    .replace(/^\uFEFF/, '').replace(/^import .*;\r?\n/gm, '').replace('export default class PalletQueueRuntime', 'return class PalletQueueRuntime');
  return new Function('THREE', 'behaviorSchema', source)(THREE, behaviorSchema);
};
