const __layout = require("../../tooling/layout.cjs");
'use strict';
const fs = require('node:fs'), path = require('node:path'), materialSchema = require('../../packages/render-three/schema/materials'), wearSchema = require('../../packages/render-three/schema/wear');
module.exports = function loadIndustrialAging(THREE) {
  const read = file => fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/load-industrial-aging.js"), '../src/editor', file)), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  const applyIndustrialFinishes = new Function('THREE', 'materialSchema', 'wearSchema', read('IndustrialFinishes.js') + '\nreturn applyIndustrialFinishes;')(THREE, materialSchema, wearSchema);
  return new Function('THREE', 'materialSchema', 'wearSchema', 'applyIndustrialFinishes', read('IndustrialAgingPresentation.js') + '\nreturn {applyIndustrialAging,ageIndustrialRecord,ageIndustrialFloorRecord};')(THREE, materialSchema, wearSchema, applyIndustrialFinishes);
};
