const __layout = require("../../tooling/layout.cjs");
'use strict';
const fs = require('node:fs'), path = require('node:path');
module.exports = function loadIndustrialFloor(THREE, schema) {
  const source = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/load-industrial-floor.js"), '../src/editor/IndustrialFloorPresentation.js')), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  return new Function('THREE', 'schema', source + '\nreturn {applyIndustrialFloorPresentation,deriveIndustrialFloorPresentation,planIndustrialFloor,planIndustrialFloorFromRecords};')(THREE, schema);
};
