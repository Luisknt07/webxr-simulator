'use strict';
const fs = require('node:fs'), path = require('node:path');
module.exports = function loadIndustrialMonitorLayout(THREE, schema) {
  const {deriveIndustrialFloorPresentation} = require('./load-industrial-floor')(THREE, schema);
  const source = fs.readFileSync(path.join(__dirname, '../src/editor/IndustrialMonitorLayout.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  return new Function('THREE', 'schema', 'deriveIndustrialFloorPresentation', source + '\nreturn {deriveIndustrialMonitorLayout,applyIndustrialMonitorLayout};')(THREE, schema, deriveIndustrialFloorPresentation);
};
