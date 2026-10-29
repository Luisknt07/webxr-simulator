const __layout = require("../../tooling/layout.cjs");
'use strict';
const fs = require('node:fs');
const path = require('node:path');
module.exports = function loadProcessorRuntime(THREE, behaviorSchema) {
  const source = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/load-processor-runtime.js"), '..', "modules/logistica-industrial/functions/procesamiento/runtime/ProcessorRuntime.js")), 'utf8')
    .replace(/^\uFEFF/, '').replace(/^import .*;\r?\n/gm, '').replace('export default class ProcessorRuntime', 'return class ProcessorRuntime');
  return new Function('THREE', 'behaviorSchema', source)(THREE, behaviorSchema);
};
