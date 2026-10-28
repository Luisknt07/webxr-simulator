'use strict';
const fs = require('node:fs'), path = require('node:path');
module.exports = THREE => {
  const read = file => fs.readFileSync(path.join(__dirname, '../src/editor', file), 'utf8').replace(/^import .*;\r?\n/gm, '');
  const Interaction = new Function('THREE', read('VehicleCabInteraction.js').replace('export default class VehicleCabInteraction', 'return class VehicleCabInteraction'))(THREE);
  const ForkCamera = new Function('THREE', read('VehicleForkCamera.js').replace('export default class VehicleForkCamera', 'return class VehicleForkCamera'))(THREE);
  const Monitor = new Function('THREE', 'VehicleForkCamera', read('VehicleDockingMonitor.js').replace('export default class VehicleDockingMonitor', 'return class VehicleDockingMonitor'))(THREE, ForkCamera);
  const Driving = new Function('THREE', 'VehicleCabInteraction', 'VehicleDockingMonitor', read('VehicleDriving.js').replace('export default class VehicleDriving', 'return class VehicleDriving'))(THREE, Interaction, Monitor);
  return {Driving, Interaction, Monitor, ForkCamera};
};
