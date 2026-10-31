const __layout = require("../../tooling/layout.cjs");
'use strict';
const fs = require('node:fs'), path = require('node:path');
module.exports = THREE => {
  const read = file => fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/load-vehicle-driving.js"), '../src/editor', file)), 'utf8').replace(/^import .*;\r?\n/gm, '');
  const Labels = require('./load-vehicle-cab-labels')(THREE);
  const Interaction = new Function('THREE', 'vehicles', 'VehicleCabLabels', read('VehicleCabInteraction.js').replace('export default class VehicleCabInteraction', 'return class VehicleCabInteraction'))(THREE, require('../../modules/logistica-industrial/functions/montacargas/schema/vehicles'), Labels);
  const ForkCamera = new Function('THREE', read('VehicleForkCamera.js').replace('export default class VehicleForkCamera', 'return class VehicleForkCamera'))(THREE);
  const MissionPanel = require('../../modules/logistica-industrial/functions/montacargas/runtime/VehicleMissionPanel.js').default;
  const FacilityLayout = require('../../modules/logistica-industrial/functions/montacargas/runtime/VehicleFacilityLayout.js').default;
  const InspectionMode = require('../../modules/logistica-industrial/functions/montacargas/runtime/VehicleInspectionMode.js').default;
  const Monitor = new Function('THREE', 'VehicleForkCamera', 'VehicleMissionPanel', 'VehicleFacilityLayout', 'VehicleInspectionMode', read('VehicleDockingMonitor.js').replace('export default class VehicleDockingMonitor', 'return class VehicleDockingMonitor'))(THREE, ForkCamera, MissionPanel, FacilityLayout, InspectionMode);
  const Guide = new Function(read('VehicleControlGuide.js').replace('export default class VehicleControlGuide', 'return class VehicleControlGuide'))();
  // Node 24 loads the actual portable ESM helper; no second guidance model is
  // substituted by the legacy DOM/keyboard fixtures.
  const HolographicGuide = require('../../modules/logistica-industrial/functions/montacargas/runtime/VehicleHolographicGuide.js').default;
  const FrontVisibility = require('../../modules/logistica-industrial/functions/montacargas/runtime/VehicleFrontVisibility.js').default;
  const Driving = new Function('THREE', 'VehicleCabInteraction', 'VehicleDockingMonitor', 'VehicleControlGuide', 'VehicleHolographicGuide', 'VehicleFrontVisibility', 'vehicles', read('VehicleDriving.js').replace('export default class VehicleDriving', 'return class VehicleDriving'))(THREE, Interaction, Monitor, Guide, HolographicGuide, FrontVisibility, require('../../modules/logistica-industrial/functions/montacargas/schema/vehicles'));
  return {Driving, Interaction, Monitor, ForkCamera, Labels, FrontVisibility};
};
