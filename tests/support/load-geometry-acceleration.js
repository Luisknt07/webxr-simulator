const __layout = require("../../tooling/layout.cjs");
const fs = require('node:fs');
const path = require('node:path');

// Exercise the production modules with real Three geometry while replacing
// only browser boundaries, such as Worker/document, in Node-based fixtures.
module.exports = function loadGeometryAcceleration(THREE, overrides = {}) {
  const directory = __layout.map(path.join(__layout.oldDir("scripts/load-geometry-acceleration.js"), '..', 'src', 'lib'));
  const read = name => fs.readFileSync(__layout.map(path.join(directory, name)), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/^export default /gm, '').replace(/^export /gm, '');
  const bindings = Object.assign({Worker: global.Worker, document: global.document, console}, overrides);
  return new Function('THREE', 'Worker', 'document', 'console',
    read('CompactTriangleTree.js') + '\n' + read('AcceleratedMeshRaycast.js') + '\n' + read('GeometryAcceleration.js') +
    '\nreturn {CompactTriangleTree, getGeometryTree, prepareModelAcceleration, installMeshRaycast};'
  )(THREE, bindings.Worker, bindings.document, bindings.console);
};
