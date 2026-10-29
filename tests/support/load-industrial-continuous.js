const __layout = require("../../tooling/layout.cjs");
'use strict';
module.exports = () => require('node:fs').readFileSync(__layout.map(require('node:path').join(__layout.oldDir("scripts/load-industrial-continuous.js"), '../src/editor/IndustrialContinuousExamples.js')), 'utf8').replace(/^export /gm, '') + '\n';
