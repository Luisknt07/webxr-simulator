const fs = require('node:fs');
const path = require('node:path');
module.exports = function loadProductSourceRuntime(THREE, behaviorSchema) {
  const read = name => fs.readFileSync(path.join(__dirname, '../src/editor/', name), 'utf8').replace(/^import .*;\r?\n/gm, '');
  const factory = read('IndustrialPrefabs.js').replace(/^export /gm, '');
  const cargo = require('./load-product-prefabs.js')(THREE);
  const createSourceProductVisual = new Function('THREE', 'behaviorSchema', 'require', factory + '\nreturn createSourceProductVisual;')(THREE, behaviorSchema,
    id => { if (id !== './ProductPrefabs.js') throw new Error('Unexpected source visual dependency: ' + id); return cargo; });
  const source = read('ProductSourceRuntime.js').replace('export default class ProductSourceRuntime', 'return class ProductSourceRuntime');
  return new Function('THREE', 'behaviorSchema', 'createSourceProductVisual', source)(THREE, behaviorSchema, createSourceProductVisual);
};
