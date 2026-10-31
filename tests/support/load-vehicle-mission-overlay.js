'use strict';
const fs = require('node:fs'), path = require('node:path');
module.exports = () => {
  const Panel = require('../../modules/logistica-industrial/functions/montacargas/runtime/VehicleMissionPanel.js').default;
  const source = fs.readFileSync(path.resolve(__dirname, '../../packages/tools/editor/src/VehicleMissionOverlay.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class VehicleMissionOverlay', 'return class VehicleMissionOverlay');
  return new Function('VehicleMissionPanel', source)(Panel);
};
