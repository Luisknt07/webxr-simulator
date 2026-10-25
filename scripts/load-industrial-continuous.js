'use strict';
module.exports = () => require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/editor/IndustrialContinuousExamples.js'), 'utf8').replace(/^export /gm, '') + '\n';
