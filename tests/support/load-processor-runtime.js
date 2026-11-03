const __layout = require("../../tooling/layout.cjs");
'use strict';
const fs = require('node:fs');
const path = require('node:path');
module.exports = function loadProcessorRuntime(THREE, behaviorSchema) {
  const source = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/load-processor-runtime.js"), '..', "modules/logistica-industrial/functions/procesamiento/runtime/ProcessorRuntime.js")), 'utf8')
    .replace(/^\uFEFF/, '').replace(/^import .*;\r?\n/gm, '').replace('export default class ProcessorRuntime', 'return class ProcessorRuntime');
  const resolve = id => {
    if (id === '../../equipamiento/schema/operationSpec.cjs') return require('../../modules/logistica-industrial/functions/equipamiento/schema/operationSpec.cjs');
    if (id === '../schema/materialConversion.cjs') return require('../../modules/logistica-industrial/functions/procesamiento/schema/materialConversion.cjs');
    throw new Error('Processor fixture does not support module: ' + id);
  };
  return new Function('THREE', 'behaviorSchema', 'require', source)(THREE, behaviorSchema, resolve);
};
