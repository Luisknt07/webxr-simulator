'use strict';
const fs = require('node:fs'), path = require('node:path');
module.exports = function loadIndustrialFloor(THREE, schema) {
  const source = fs.readFileSync(path.join(__dirname, '../src/editor/IndustrialFloorPresentation.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  return new Function('THREE', 'schema', source + '\nreturn {applyIndustrialFloorPresentation,deriveIndustrialFloorPresentation,planIndustrialFloor,planIndustrialFloorFromRecords};')(THREE, schema);
};
