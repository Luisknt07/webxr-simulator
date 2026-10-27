'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=(THREE,prefabs)=>new Function('THREE','vehicles','updateVehiclePose','getGeometryTree',fs.readFileSync(path.join(__dirname,'../src/editor/VehicleRuntime.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default class VehicleRuntime','return class VehicleRuntime'))(THREE,require('../shared/vehicles.js'),(prefabs||require('./load-vehicle-prefabs.js')(THREE)).updateVehiclePose,require('./load-geometry-acceleration.js')(THREE).getGeometryTree);
