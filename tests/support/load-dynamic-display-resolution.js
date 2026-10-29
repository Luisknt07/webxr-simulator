const __layout = require("../../tooling/layout.cjs");
'use strict';
const fs = require('node:fs'), path = require('node:path');
module.exports = THREE => new Function('THREE', fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/load-dynamic-display-resolution.js"), '../src/editor/DynamicDisplayResolution.js')), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class DynamicDisplayResolution', 'return class DynamicDisplayResolution'))(THREE);
