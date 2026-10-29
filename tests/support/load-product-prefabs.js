const __layout = require("../../tooling/layout.cjs");
'use strict';
const fs = require('node:fs'), path = require('node:path');
module.exports = function loadProductPrefabs(THREE) {
  const code = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/load-product-prefabs.js"), '../src/editor/ProductPrefabs.js')), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  return new Function('THREE', 'productEquipment', 'productSources', code + '\nreturn {createProduct,createCargoVisual};')(THREE, require('../../modules/logistica-industrial/functions/flujo-materiales/schema/product-equipment.js'), require('../../modules/logistica-industrial/functions/flujo-materiales/schema/productSources.js'));
};
