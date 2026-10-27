'use strict';
const fs = require('node:fs'), path = require('node:path');
module.exports = function loadProductPrefabs(THREE) {
  const code = fs.readFileSync(path.join(__dirname, '../src/editor/ProductPrefabs.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  return new Function('THREE', 'productEquipment', 'productSources', code + '\nreturn {createProduct,createCargoVisual};')(THREE, require('../shared/product-equipment.js'), require('../shared/productSources.js'));
};
