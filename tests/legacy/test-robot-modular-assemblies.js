'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),THREE=require('three');
const robots=require('../../modules/logistica-industrial/functions/robots/schema/robots'),kin=require('../../modules/logistica-industrial/functions/robots/schema/robot-kinematics');
const prefabs=require('../support/load-robot-prefabs')(THREE);
const Runtime=require('../support/load-robot-runtime')(THREE,prefabs),runtime=new Runtime({ctx:{}});
const hashes=new Set(),reports=[];let poses=0,cableSamples=0,minimumCableDistance=Infinity;
function localBox(mesh,parent){if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();return mesh.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().getInverse(parent.matrixWorld).multiply(mesh.matrixWorld));}
for(const profile of robots.assemblies.profiles){
 const config=robots.normalize({...robots.defaults(),assemblyProfile:profile.id}),object=prefabs.createRobot(config),rig=object.userData.robotRig,hash=crypto.createHash('sha256');let triangles=0;
 object.traverse(mesh=>{if(!mesh.geometry)return;hash.update(Buffer.from(mesh.geometry.attributes.position.array.buffer));triangles+=(mesh.geometry.index?mesh.geometry.index.count:mesh.geometry.attributes.position.count)/3*(mesh.count||1);});
 hashes.add(hash.digest('hex'));assert(triangles<35000);assert.equal(rig.design.assembly.id,profile.id);assert.equal(rig.joints.length,6);assert.equal(rig.serviceCables.length,2);assert(rig.panelServiceSocket,'All curated bases provide an actual console service endpoint.');
 const shoulder=rig.joints[0],box=new THREE.Box3();for(const row of rig.collisionBodies){let p=row.object,under=false;for(;p;p=p.parent){if(p===shoulder)under=true;if(p===rig.joints[1]){under=false;break;}}if(under)box.union(localBox(row.object,shoulder));}
 assert(box.min.x>=-rig.assemblyBase.width/2-.001&&box.max.x<=rig.assemblyBase.width/2+.001,'Base flange contains its shoulder footprint on X.');assert(box.min.z>=-rig.assemblyBase.depth/2-.001&&box.max.z<=rig.assemblyBase.depth/2+.001,'Base flange contains its shoulder footprint on Z.');
 for(const key of robots.assemblies.keys)for(const choice of robots.assemblies.partChoices(key,config)){
  const value={...config,[key]:choice.id};if(choice.compatible)assert.doesNotThrow(()=>prefabs.createRobot(robots.normalize(value)));else assert.throws(()=>robots.normalize(value),/incompatible/);
 }
 for(let step=0;step<=12;step++){
  const f=step/12;prefabs.updateRobotPose(object,kin.forward(config,[.4*Math.sin(f*6.28),1.1+.45*Math.sin(f*3.14),-1.8-.55*Math.sin(f*3.14),0,-.57,0]));
  const surfaces=rig.collisionBodies.map(body=>{const mesh=body.object,p=mesh.geometry.attributes.position,index=mesh.geometry.index,triangles=[];for(let i=0;i<(index?index.count:p.count);i+=3){const triangle=new THREE.Triangle(...[0,1,2].map(k=>new THREE.Vector3().fromBufferAttribute(p,index?index.getX(i+k):i+k).applyMatrix4(mesh.matrixWorld)));if(triangle.getArea()>1e-12)triangles.push(triangle);}return{mesh,triangles,bounds:localBox(mesh,rig.visual)};});
  for(const cable of rig.serviceCables)for(const point of cable.points.slice(1,-1)){
   let distance=Infinity;const closest=new THREE.Vector3();for(const row of surfaces){if(row.bounds.distanceToPoint(point)>distance)continue;for(const triangle of row.triangles){triangle.closestPointToPoint(point,closest);distance=Math.min(distance,point.distanceTo(closest));}}
   assert(distance>=cable.radius*.95,profile.id+'/'+cable.mesh.name+' enters structural geometry: '+distance+' m.');minimumCableDistance=Math.min(minimumCableDistance,distance);cableSamples++;
  }
 }
 for(const tool of ['gripper','vacuum','fork','platform','process']){
  const c=robots.normalize({...config,tool,operation:tool==='process'?'process':'pick-place'}),actor=prefabs.createRobot(c),r=actor.userData.robotRig,d=kin.getDimensions(c),legacy={...c,visualModel:'legacy'};
  for(let step=0;step<=16;step++){
   const f=step/16,j=[.4*Math.sin(f*6.28),.6+.5*Math.sin(f*3.14),-1.4-.4*Math.sin(f*3.14),.3*Math.sin(f*6.28),-.77+.25*Math.sin(f*6.28),.5*Math.cos(f*6.28)],pose=kin.forward(c,j);
   prefabs.updateRobotPose(actor,pose);const transform=prefabs.getRobotToolTransform(actor);assert(transform.position.distanceTo(new THREE.Vector3().fromArray(pose.toolPosition))<1e-8);
   const ik=kin.inverse(c,{position:pose.toolPosition,quaternion:pose.quaternion},j);assert(ik.error<1e-6,'Tool-specific FK/IK must agree.');
   const old=kin.forward(legacy,j);assert.deepEqual(pose.frames,old.frames,'Assembly/tool changes never relocate the six mechanical joint frames.');if(!['fork','platform'].includes(tool))assert.deepEqual(pose.toolPosition,old.toolPosition);poses++;
  }
  if(['fork','platform'].includes(tool)){
   assert(d.toolOffset[1]>d.toolSupport.depth/2);assert.deepEqual(r.toolAssembly.position.toArray(),d.toolOffset);
   const adapter=r.toolAssembly.children.find(mesh=>/Adaptador (estructural|posterior)/.test(mesh.name));assert(adapter,'Support tooling has a real attached structural adapter.');
   const bounds=localBox(adapter,r.joints[5]);assert(Math.abs(bounds.min.x-r.pilotFlangeEnd)<.001,'Chamfered adapter mates the actual CAD flange within 1 mm.');assert(bounds.min.y<0&&bounds.max.y>0,'Adapter connects at the flange centreline.');
   const pose=kin.forward(c,[0,.7,-1.3,0,-Math.PI/2+.6,0]);prefabs.updateRobotPose(actor,pose);
   const cargo=new THREE.Box3(new THREE.Vector3(-.35,-d.toolSupport.depth/2,-d.toolSupport.width/2),new THREE.Vector3(-.005,d.toolSupport.depth/2,d.toolSupport.width/2)),inverse=new THREE.Matrix4().getInverse(r.toolAssembly.matrixWorld),triangle=new THREE.Triangle();
   for(const body of r.collisionBodies){if(body.role==='contact')continue;const mesh=body.object,geometry=mesh.geometry,p=geometry.attributes.position,index=geometry.index,matrix=new THREE.Matrix4().multiplyMatrices(inverse,mesh.matrixWorld);if(!localBox(mesh,r.toolAssembly).intersectsBox(cargo))continue;
    for(let i=0;i<(index?index.count:p.count);i+=3){[triangle.a,triangle.b,triangle.c].forEach((v,k)=>v.fromBufferAttribute(p,index?index.getX(i+k):i+k).applyMatrix4(matrix));assert(!cargo.intersectsTriangle(triangle),'Nominal supported cargo intersects structural '+mesh.name+' in '+profile.id+'/'+tool);}
   }
  }
 }
 reports.push({profile:profile.id,triangles,parts:rig.design.assembly.parts});
}
assert.equal(hashes.size,4,'The four assemblies must contain different actual geometry, not alternate colours or labels.');
let combinations=0;for(const profile of robots.assemblies.profiles){const rows=[{}];for(const key of robots.assemblies.keys){const previous=rows.splice(0);for(const row of previous)for(const id of profile.allowed[key])rows.push({...row,[key]:id});}for(const row of rows){const config=robots.normalize({...robots.defaults(),assemblyProfile:profile.id,...row}),object=prefabs.createRobot(config),rig=object.userData.robotRig;assert.equal(rig.serviceCables.length,2);assert(rig.panelServiceSocket);prefabs.updateRobotPose(object,kin.forward(config,[0,.7,-1.3,0,-Math.PI/2+.6,0]));assert(runtime.selfClear({object,components:{robot:{config,visualRoot:object}}}),'Curated compatible combination must clear its structural guard in the carry pose.');combinations++;}}
console.log('Modular robot assemblies: four distinct geometries, compatible part replacement, anchored bases, attached support tools and '+poses+' unchanged bearing-frame/FK/IK samples passed.');console.log(JSON.stringify(reports));
console.log('Curated harness sweep: '+cableSamples+' hose-to-structural-surface samples; minimum '+(minimumCableDistance*1000).toFixed(2)+' mm.');
console.log('Compatible complete native assemblies: '+combinations+' constructed with connected service endpoints and clear nominal carrying pose.');
