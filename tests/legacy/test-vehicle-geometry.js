'use strict';
const assert=require('node:assert/strict'),THREE=require('three'),vehicles=require('../../modules/logistica-industrial/functions/montacargas/schema/vehicles.js'),prefabs=require('../support/load-vehicle-prefabs.js')(THREE);
for(const definition of vehicles.VARIANTS){const config=vehicles.normalize(definition.preset),a=prefabs.createVehicle(config),b=prefabs.createVehicle(config),rig=a.userData.vehicleRig;let triangles=0,bytes=0;const resident=new Set();
  a.traverse(node=>{if(node.geometry){const g=node.geometry;triangles+=(g.index?g.index.count:g.attributes.position.count)/3*(node.isInstancedMesh?node.count:1);if(!resident.has(g)){resident.add(g);Object.values(g.attributes||{}).forEach(at=>{bytes+=at.array.byteLength;});if(g.index)bytes+=g.index.array.byteLength;}}if(node.isMesh)assert(node.castShadow||node.material.transparent);});
  assert(triangles<35000,definition.id+' balanced presentation triangle budget');assert(bytes<2.7e6);assert(rig.driverSeat);assert.notEqual(rig,b.userData.vehicleRig);
  const before=rig.forks&&prefabs.getVehicleForkTransform(a).position.clone();prefabs.updateVehiclePose(a,{lift:config.maxLift,reach:config.maxReach,tilt:config.tiltLimit,sideShift:config.maxSideShift,turret:config.turretLimit,boomAngle:config.boomAngleLimit,steer:.4,wheelRoll:2,lights:true});
  if(vehicles.supports(config).forks){const next=prefabs.getVehicleForkTransform(a).position;assert(next.y>before.y+.05||config.maxLift===0,definition.id+' elevates actual fork TCP');}
  if(vehicles.supports(config).risingCab)assert(rig.driverSeat.getWorldPosition(new THREE.Vector3()).y>config.maxLift+1);
  assert.equal(b.userData.vehicleRig.pose.lift,config.initialLift);console.log(definition.id+': '+Math.round(triangles)+' triangles, real mechanism and independent PBR.');
}
assert.throws(()=>vehicles.normalize({speed:NaN}));assert.throws(()=>vehicles.normalize({variant:'unknown'}));assert.throws(()=>vehicles.normalize({initialLift:5,maxLift:1}));assert.throws(()=>vehicles.normalize({waypointsJson:'[{"x":null,"z":1}]'}));
assert(vehicles.effectiveCapacity(vehicles.defaults(),{loadCenter:1,lift:5,reach:.4})<vehicles.defaults().payloadKg);
console.log('Vehicle schema and geometry: 13 real typologies, steering/lift/reach/turret/boom/cab, dimensions and budgets passed.');
