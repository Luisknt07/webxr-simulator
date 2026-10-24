// Load the production resolver into the same Three.js realm as headless tests.
const fs = require('node:fs');
const path = require('node:path');
module.exports = function loadObjectPlacement(THREE) {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/ObjectPlacement.js'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace('export default class ObjectPlacement', 'return class ObjectPlacement');
  return new Function('THREE', source)(THREE);
};
