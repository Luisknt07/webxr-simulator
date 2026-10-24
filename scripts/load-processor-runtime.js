'use strict';
const fs = require('node:fs');
const path = require('node:path');
module.exports = function loadProcessorRuntime(THREE, behaviorSchema) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/editor/ProcessorRuntime.js'), 'utf8')
    .replace(/^\uFEFF/, '').replace(/^import .*;\r?\n/gm, '').replace('export default class ProcessorRuntime', 'return class ProcessorRuntime');
  return new Function('THREE', 'behaviorSchema', source)(THREE, behaviorSchema);
};
