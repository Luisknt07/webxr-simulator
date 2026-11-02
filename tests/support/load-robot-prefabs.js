const __layout = require("../../tooling/layout.cjs");
// Load the real browser module into the same Three.js realm as headless tests.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
module.exports = function loadRobotPrefabs(THREE) {
  const source = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/load-robot-prefabs.js"), '../src/editor/RobotPrefabs.js')), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  const robotRequire = id => {
    if(id==='../../equipamiento/schema/equipmentCatalog.cjs')return require('../../modules/logistica-industrial/functions/equipamiento/schema/equipmentCatalog.cjs');
    if(id==='../../equipamiento/runtime/EquipmentGeometry.cjs')return require('../../modules/logistica-industrial/functions/equipamiento/runtime/EquipmentGeometry.cjs');
    throw new Error('Unsupported robot attachment fixture module: '+id);
  };
  const result = new Function('THREE', 'robotSchema', 'kinematics', 'require', source + '\nreturn {createRobot, refreshRobotGeometry, updateRobotPose, getRobotToolTransform};')
    (THREE, require('../../modules/logistica-industrial/functions/robots/schema/robots.js'), require('../../modules/logistica-industrial/functions/robots/schema/robot-kinematics.js'), robotRequire);
  Object.assign(result, require('./load-product-prefabs.js')(THREE));
  Object.assign(result, require('./load-vehicle-prefabs.js')(THREE));
  let catalogueFactory;
  // Source-level fixture loaders execute the moved production factory in one
  // Three realm. Resolve only these exact known filenames to the already
  // loaded implementation; never pass an arbitrary source path to require().
  result.resolve = id => {
    const name = typeof id === 'string' ? path.posix.basename(id.replace(/\\/g, '/')) : '';
    if (name === 'RobotPanelCable.js') return require('../../modules/logistica-industrial/functions/presentacion/runtime/RobotPanelCable.js');
    if (name === 'RobotTeachPendant.js') return require('../../modules/logistica-industrial/functions/presentacion/runtime/RobotTeachPendant.js');
    if (name === 'EquipmentGeometry.js' || name === 'EquipmentGeometry.cjs') return require('../../modules/logistica-industrial/functions/equipamiento/runtime/EquipmentGeometry.cjs');
    if (name === 'CatalogueEquipmentFactory.js') {
      if (!catalogueFactory) {
        const file = path.join(__dirname, '../../modules/logistica-industrial/functions/equipamiento/runtime/CatalogueEquipmentFactory.js');
        const code = fs.readFileSync(file, 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export default .*;\r?$/gm, '').replace(/^export /gm, '');
        catalogueFactory = new Function('catalog', code + '\nreturn {createCatalogueEquipment,refreshCatalogueEquipment,toolConfiguration,performCatalogueAction};')
          (require('../../modules/logistica-industrial/functions/equipamiento/schema/equipmentCatalog.cjs'));
      }
      return catalogueFactory;
    }
    if (!['RobotPrefabs.js', 'ProductPrefabs.js', 'VehiclePrefabs.js'].includes(name)) throw new Error('Módulo de prefab no compatible: ' + id);
    return result;
  };
  return result;
};
