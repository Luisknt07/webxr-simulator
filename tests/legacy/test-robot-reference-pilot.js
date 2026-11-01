'use strict';
// The pilot is the operational native articulated robot, not a static teaching
// replacement. Validate geometry provenance, frames, tool contacts and resources.
const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto'),THREE=require('three');
const schema=require('../../modules/logistica-industrial/functions/robots/schema/robots.js');
const kin=require('../../modules/logistica-industrial/functions/robots/schema/robot-kinematics.js');
const prefabs=require('../support/load-robot-prefabs.js')(THREE);
const Runtime=require('../support/load-robot-runtime.js')(THREE,prefabs);
const data=schema.referencePilotGeometry(),api=new Runtime({ctx:{}}),budgets={low:13500,balanced:26000,high:37000},originalAsset=JSON.stringify(data);
assert.equal(data.revision,'5ddbc41ce8726fd680bcc19562d78bcabfbdf96d');assert.equal(data.license,'Apache-2.0');
assert.equal(data.normalModel.method,'corner-angle-weighted');assert.equal(data.normalModel.creaseDegrees,35);
const geometryHashes={low:'1e4adfc1d6f75dea96586133ed27d5fd21ea42a641fd4cda0cec5f57e04eb338',balanced:'64e0f8de5becb1679ccaca579fe46f2dc4cb90b21f6a52e1f774ad1af6b52a6d',high:'28db16c66090aa8afe9f10896cc061892f25b3f63d34c30dd9c25d3403638492'};
for(const [lod,rows] of Object.entries(data.lods)){
 const hash=crypto.createHash('sha256'),tuple=Buffer.alloc(6);
 for(const row of rows){const q=Buffer.from(row.position,'base64'),index=Buffer.from(row.index,'base64'),stride=row.indexType==='H'?2:4;for(let offset=0;offset<index.length;offset+=stride){const vertex=stride===2?index.readUInt16LE(offset):index.readUInt32LE(offset);q.copy(tuple,0,vertex*6,vertex*6+6);hash.update(tuple);}}
 assert.equal(hash.digest('hex'),geometryHashes[lod],'Shading corrections must preserve every ordered quantized triangle.');
 assert.equal(data.normalModel.geometryAudit[lod].orderedQuantizedTriangleSHA256,geometryHashes[lod]);
}
assert.equal(Object.keys(data.sourceHashes).length,7);for(const hash of Object.values(data.sourceHashes))assert.match(hash,/^[a-f0-9]{64}$/);
assert(fs.readFileSync('modules/logistica-industrial/functions/robots/assets/reference-pilot/LICENSE','utf8').includes('Copyright 2025 KUKA Hungaria Kft.'));
for(const id of schema.variants){const c=schema.normalize(schema.defaults(id));assert.equal(schema.visualModel(c),id==='articulated-general'?'reference-pilot':'legacy');}
assert.throws(()=>schema.normalize({...schema.defaults('scara'),visualModel:'reference-pilot'}),/piloto industrial/);
const expectedIDs=['robot.base','robot.shoulder','robot.upper-arm','robot.elbow','robot.forearm','robot.wrist','robot.tool'];
let samples=0;const measured=[];
for(const detail of ['low','balanced','high']){
 const c=schema.normalize({...schema.defaults('articulated-general'),detail}),pilot=prefabs.createRobot(c),legacy=prefabs.createRobot({...c,visualModel:'legacy'}),r=pilot.userData.robotRig,old=legacy.userData.robotRig;
 assert.equal(pilot.userData.robotGeometryVersion,4);assert.equal(legacy.userData.robotGeometryVersion,3);assert.equal(r.design.manufacturerReplica,false);
 const ids=new Set(r.components.map(part=>part.id));for(const id of expectedIDs)assert(ids.has(id),id);
 const links=new Set(),textures=new Set(),geometries=new Set();let triangles=0,draws=0;
 pilot.traverse(mesh=>{
  if(!mesh.geometry)return;draws++;geometries.add(mesh.geometry);triangles+=(mesh.geometry.index?mesh.geometry.index.count:mesh.geometry.attributes.position.count)/3*(mesh.isInstancedMesh?mesh.count:1);
  for(const a of Object.values(mesh.geometry.attributes))for(const value of a.array)assert(Number.isFinite(value));
  const normal=mesh.geometry.attributes.normal;for(let i=0;i<normal.count;i++)assert(Math.abs(Math.hypot(normal.getX(i),normal.getY(i),normal.getZ(i))-1)<1e-5);
  if(mesh.userData.robotReferenceCAD){links.add(mesh.geometry.userData.sourceLink);assert.equal(mesh.geometry.userData.sourceLOD,detail);assert.equal(mesh.userData.industrialSourceLicense,'Apache-2.0');assert(mesh.geometry.index);}
  for(const material of [mesh.material].flat())for(const key of ['map','bumpMap','normalMap','roughnessMap','metalnessMap'])if(material[key])textures.add(material[key]);
 });
 assert.equal(links.size,7,'All seven actual CAD link skins participate, including the asymmetric native base and shoulder.');
 assert(triangles<budgets[detail]);assert(draws<50);measured.push({detail,triangles,draws});
 for(let i=0;i<6;i++){
  assert.equal(r.joints[i].userData.robotJoint,old.joints[i].userData.robotJoint);
  assert.deepEqual(r.joints[i].position.toArray(),old.joints[i].position.toArray(),'Native bearing frame translations cannot move to fit imported CAD.');
 }
 assert.equal(r.toolContactSurfaces.length,old.toolContactSurfaces.length);
 r.toolContactSurfaces.forEach((mesh,index)=>{assert.deepEqual(Array.from(mesh.geometry.attributes.position.array),Array.from(old.toolContactSurfaces[index].geometry.attributes.position.array));assert.equal(mesh.userData.robotContactSurface,old.toolContactSurfaces[index].userData.robotContactSurface);});
 // The CAD upper arm is cantilevered to one side of its bearing axis. Its
 // structural capsule must follow that actual casting rather than empty Z=0.
 const section=new THREE.Group(),double=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
 pilot.traverse(mesh=>{if(mesh.geometry&&mesh.geometry.userData.sourceLink==='link_2')section.add(new THREE.Mesh(mesh.geometry,double));});section.updateMatrixWorld(true);
 const core=r.selfCollisionCores.upper;assert(core.start[2]>core.radius);assert(core.end[2]>core.radius);
 for(const fraction of [0,.25,.5,.75,1]){
  const center=new THREE.Vector3().fromArray(core.start).lerp(new THREE.Vector3().fromArray(core.end),fraction);
  for(const axis of ['y','z'])for(const sign of [-1,1]){
   const direction=new THREE.Vector3();direction[axis]=sign;
   const hit=new THREE.Raycaster(center,direction).intersectObject(section,true).find(hit=>hit.distance>1e-6);
   assert(hit,'A structural core centre lies inside the measured native casting envelope.');
   assert(hit.distance>core.radius*.90,detail+'/'+fraction+'/'+axis+'/'+sign+': structural radius '+core.radius+' exceeds surface distance '+hit.distance);
  }
 }
 for(let step=0;step<=120;step++){
  const f=step/120,values=[Math.sin(f*Math.PI*2),.6+.6*Math.sin(f*Math.PI),-1.3-.7*Math.sin(f*Math.PI),.7*Math.sin(f*Math.PI*2),-.5+.9*Math.sin(f*Math.PI*2),1.2*Math.cos(f*Math.PI*2)];
  const pose=kin.forward(c,values);prefabs.updateRobotPose(pilot,pose);prefabs.updateRobotPose(legacy,pose);
  const actual=prefabs.getRobotToolTransform(pilot),before=prefabs.getRobotToolTransform(legacy);
  assert(actual.position.distanceTo(before.position)<1e-10);assert(actual.position.distanceTo(new THREE.Vector3().fromArray(pose.toolPosition))<1e-8);assert(Math.abs(actual.quaternion.dot(before.quaternion))>1-1e-10);
  for(let joint=0;joint<6;joint++)assert(r.joints[joint].getWorldPosition(new THREE.Vector3()).distanceTo(old.joints[joint].getWorldPosition(new THREE.Vector3()))<1e-10);
  samples++;
 }
 const record={object:pilot,components:{robot:{visualRoot:pilot,config:c}}};
 prefabs.updateRobotPose(pilot,kin.forward(c,[0,1.4,-2.4,0,-.57,0]));assert(api.selfClear(record));
 prefabs.updateRobotPose(pilot,kin.forward(c,[0,-1.4,0,0,0,0]));assert.equal(api.selfClear(record),false,'A visual change never disables native structural guards.');
 const body=r.collisionBodies.find(row=>row.object.userData.robotReferenceCAD);assert(body,'New structural CAD meshes remain in actual runtime collision inventories.');
 const disposed=new Map([...textures].map(t=>[t,0]));for(const texture of textures)texture.addEventListener('dispose',()=>disposed.set(texture,disposed.get(texture)+1));
 prefabs.refreshRobotGeometry(pilot,{...c,visualModel:'legacy'});for(const count of disposed.values())assert.equal(count,1);assert.equal(pilot.userData.robotVisualModel,'legacy');
 assert.doesNotThrow(()=>JSON.stringify(pilot.toJSON()));
}
console.log('Reference robot pilot: licensed seven-link CAD skins, selective variant activation, '+samples+' identical native joint/TCP samples, original tool contacts, live structural guards, deterministic LOD and resource disposal passed.');
assert.equal(JSON.stringify(data),originalAsset,'Building, moving and changing native models must never mutate the shared licensed source buffers.');
console.log(JSON.stringify(measured));
