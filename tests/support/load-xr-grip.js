const __layout = require("../../tooling/layout.cjs");
'use strict';
const fs = require('node:fs'), path = require('node:path');
module.exports = THREE => new Function('THREE', fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/load-xr-grip.js"), '../src/lib/XRGripTracking.js')), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '') + '\nreturn {createXRGrip,updateXRGrip};')(THREE);
