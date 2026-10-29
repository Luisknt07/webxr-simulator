const __layout = require("../../tooling/layout.cjs");
'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=(THREE,prefabs)=>new Function('THREE','vehicles','updateVehiclePose','getGeometryTree',fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/load-vehicle-runtime.js"),'../src/editor/VehicleRuntime.js')),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default class VehicleRuntime','return class VehicleRuntime'))(THREE,require('../../modules/logistica-industrial/functions/montacargas/schema/vehicles.js'),(prefabs||require('./load-vehicle-prefabs.js')(THREE)).updateVehiclePose,require('./load-geometry-acceleration.js')(THREE).getGeometryTree);
