import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),THREE=require('three'),prefabs=require('../support/load-vehicle-prefabs.js')(THREE);
const vehicles=require('../../modules/logistica-industrial/functions/montacargas/schema/vehicles');

test('the real forklift hydraulic bank sits right of the wheel, with parallel rearward handles and separate readable control markers',()=>{
 const root=prefabs.createVehicle({variant:'forklift-electric-4w'}),rig=root.userData.vehicleRig,wheel=rig.controls.wheel.object,levers=rig.controls.levers;
 assert.equal(rig.hydraulicBank.layout,'front-right');assert.equal(rig.hydraulicBank.rows,1);assert(levers.length>=3);
 const z=levers[0].object.position.z;
 for(let index=0;index<levers.length;index++){
  const lever=levers[index];assert.equal(lever.object.position.z,z,'Primary pivots form a bank across the console.');
  assert(lever.object.position.z>=wheel.position.z+.14,'The pivots stay on the side console while the grips reach inward.');
  assert(lever.grip.position.z<-.12,'The real handles extend rearward toward the seated operator.');
  root.updateWorldMatrix(true,true);const local=rig.cabin.worldToLocal(lever.grip.getWorldPosition(new THREE.Vector3()));
  assert(local.x<-.24&&local.x>-.39&&Math.abs(local.z-wheel.position.z)<.04,'Handles are next to the wheel in the operator reach zone.');
  assert(Math.abs(local.y-wheel.position.y)<.15);assert(lever.labelCompact);
  const shoulder=new THREE.Vector3(-.18,1.25,-.18);assert(local.distanceTo(shoulder)<.43,'All standard hydraulic grips remain within a short seated reach.');
  if(index){assert(lever.object.position.x<levers[index-1].object.position.x);assert(lever.labelWidth<Math.abs(lever.object.position.x-levers[index-1].object.position.x));}
 }
 // Sweep actual articulated handles; neither the steering rim nor the seat
 // may intrude into their grip region. No contact envelopes are modified.
 const wheelBounds=new THREE.Box3().setFromObject(wheel),seatBounds=new THREE.Box3().setFromObject(rig.seatCushion);
 for(const lever of levers)for(const amount of [-1,-.5,0,.5,1]){
  lever.object.quaternion.copy(lever.restQuaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),amount*lever.maxAngle));root.updateWorldMatrix(true,true);
  const point=lever.grip.getWorldPosition(new THREE.Vector3());assert(wheelBounds.distanceToPoint(point)>.05);assert(seatBounds.distanceToPoint(point)>.12);
 }
});

test('the native bank remains finite for feature variations and a vehicle with no enabled hydraulic travel',()=>{
 for(const config of [{variant:'reach-truck'},{variant:'vna-turret'},{variant:'telehandler'},{variant:'forklift-electric-3w'},{variant:'forklift-electric-4w',maxLift:0,maxSideShift:0,tiltLimit:0}]){
  const root=prefabs.createVehicle(config);root.updateWorldMatrix(true,true);root.traverse(node=>assert(node.matrixWorld.elements.every(Number.isFinite)));
  for(const lever of root.userData.vehicleRig.controls.levers){assert(lever.travel>0);assert(lever.object.position.x<0);assert(lever.grip.position.z<0);}
 }
});

test('all seated wheel-and-lever banks retain hand clearance throughout their actual sweep',()=>{
 for(const definition of vehicles.VARIANTS){
  const root=prefabs.createVehicle(definition.preset),rig=root.userData.vehicleRig,controls=rig.controls;
  if(!rig.hydraulicBank||!controls.wheel||controls.wheel.gripOnly)continue;
  root.updateWorldMatrix(true,true);const wheel=new THREE.Box3().setFromObject(controls.wheel.object),seat=rig.seatCushion&&new THREE.Box3().setFromObject(rig.seatCushion);
  for(const lever of controls.levers)for(const amount of [-1,-.5,0,.5,1]){
   lever.object.quaternion.copy(lever.restQuaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),amount*lever.maxAngle));root.updateWorldMatrix(true,true);
   const grip=lever.grip.getWorldPosition(new THREE.Vector3());assert(wheel.distanceToPoint(grip)>.05,definition.id+' preserves wheel clearance');if(seat)assert(seat.distanceToPoint(grip)>.12);
  }
 }
});
