const __layout = require("../../tooling/layout.cjs");
'use strict';
const fs = require('node:fs'), path = require('node:path');
module.exports = THREE => new Function('THREE', fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/load-vehicle-cab-labels.js"), '../src/editor/VehicleCabLabels.js')), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class VehicleCabLabels', 'return class VehicleCabLabels'))(THREE);
