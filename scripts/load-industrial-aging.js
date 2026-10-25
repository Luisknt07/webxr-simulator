'use strict';
const fs = require('node:fs'), path = require('node:path'), materialSchema = require('../shared/materials'), wearSchema = require('../shared/wear');
module.exports = function loadIndustrialAging(THREE) {
  const read = file => fs.readFileSync(path.join(__dirname, '../src/editor', file), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  const applyIndustrialFinishes = new Function('THREE', 'materialSchema', 'wearSchema', read('IndustrialFinishes.js') + '\nreturn applyIndustrialFinishes;')(THREE, materialSchema, wearSchema);
  return new Function('THREE', 'materialSchema', 'wearSchema', 'applyIndustrialFinishes', read('IndustrialAgingPresentation.js') + '\nreturn {applyIndustrialAging,ageIndustrialRecord,ageIndustrialFloorRecord};')(THREE, materialSchema, wearSchema, applyIndustrialFinishes);
};
