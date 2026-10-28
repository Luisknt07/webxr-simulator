'use strict';
const fs = require('node:fs'), path = require('node:path');
module.exports = THREE => new Function('THREE', fs.readFileSync(path.join(__dirname, '../src/editor/VehicleCabLabels.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class VehicleCabLabels', 'return class VehicleCabLabels'))(THREE);
