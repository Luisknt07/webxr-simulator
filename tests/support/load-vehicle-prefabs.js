const __layout = require("../../tooling/layout.cjs");
'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=THREE=>{
  const clean=file=>fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/load-vehicle-prefabs.js"),'../src/editor',file)),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
  const createVehicleDetailBuilder=new Function('THREE',clean('VehicleDetailGeometry.js')+'\nreturn createVehicleDetailBuilder;')(THREE);
  return new Function('THREE','vehicles','createVehicleDetailBuilder',clean('VehiclePrefabs.js')+'\nreturn {createVehicle,refreshVehicleGeometry,updateVehiclePose,getVehicleForkTransform};')(THREE,require('../../modules/logistica-industrial/functions/montacargas/schema/vehicles.js'),createVehicleDetailBuilder);
};
