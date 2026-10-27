'use strict';
const fs = require('node:fs'), path = require('node:path');
module.exports = THREE => new Function('THREE', fs.readFileSync(path.join(__dirname, '../src/lib/XRGripTracking.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '') + '\nreturn {createXRGrip,updateXRGrip};')(THREE);
