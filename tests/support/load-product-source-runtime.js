const __layout = require("../../tooling/layout.cjs");
const fs = require('node:fs');
const path = require('node:path');
module.exports = function loadProductSourceRuntime(THREE, behaviorSchema) {
  const read = name => fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/load-product-source-runtime.js"), '../src/editor/', name)), 'utf8').replace(/^import .*;\r?\n/gm, '');
  const factory = read('IndustrialPrefabs.js').replace(/^export /gm, '');
  const prefabs = require('./load-robot-prefabs.js')(THREE);
  const {createSourceProductVisual,createIndustrialPrefab} = new Function('THREE', 'behaviorSchema', 'require', factory + '\nreturn {createSourceProductVisual,createIndustrialPrefab};')(THREE, behaviorSchema,prefabs.resolve);
  const source = read('ProductSourceRuntime.js').replace('export default class ProductSourceRuntime', 'return class ProductSourceRuntime');
  const resolve=id=>{if(id==='../../equipamiento/schema/equipmentCatalog.cjs')return require('../../modules/logistica-industrial/functions/equipamiento/schema/equipmentCatalog.cjs');throw new Error('Unexpected source runtime dependency: '+id);};
  return new Function('THREE', 'behaviorSchema', 'createSourceProductVisual', 'createIndustrialPrefab', 'require', source)(THREE, behaviorSchema, createSourceProductVisual,createIndustrialPrefab,resolve);
};
