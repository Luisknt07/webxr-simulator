'use strict';
// Inspect the actual native actor, not an illustrative replacement model.
const assert=require('node:assert/strict'),THREE=require('three');
const schema=require('../../modules/logistica-industrial/functions/robots/schema/robots.js'),kin=require('../../modules/logistica-industrial/functions/robots/schema/robot-kinematics.js');
const prefabs=require('../support/load-robot-prefabs.js')(THREE);
const config=schema.normalize({...schema.defaults(),reach:3.2,payloadKg:80}),actor=prefabs.createRobot(config),rig=actor.userData.robotRig;
assert.equal(rig.design.sectionScale,1.5);assert.equal(rig.design.capacityAffectsAppearance,false);
const light=prefabs.createRobot({...config,payloadKg:1}),lightRig=light.userData.robotRig;
const cad=root=>{const list=[];root.traverse(mesh=>{if(mesh.userData.robotReferenceCAD)list.push(mesh);});return list;};
cad(actor).forEach((mesh,i)=>assert.deepEqual(Array.from(mesh.geometry.attributes.position.array),Array.from(cad(light)[i].geometry.attributes.position.array),'Capacity changes cannot inflate a visual casting.'));
const upper=cad(actor).find(mesh=>mesh.geometry.userData.sourceLink==='link_2'&&mesh.geometry.attributes.position.count>20);upper.geometry.computeBoundingBox();
assert(upper.geometry.boundingBox.max.y-upper.geometry.boundingBox.min.y<.28,'Dispatch upper housing was formerly over 0.54 m thick.');
assert(rig.components.some(c=>c.id==='robot.harness'));assert(rig.components.some(c=>c.id==='robot.bearings'));assert(rig.components.some(c=>c.id==='robot.tool-services'));
assert(rig.panelServiceSocket&&rig.panelServiceSocket.object.parent.name==='Base anclada al piso');
let labels=0;actor.traverse(mesh=>{for(const anchor of mesh.userData.industrialStickerAnchors||[]){
 labels++;const normal=new THREE.Vector3().fromArray(anchor.normal).applyMatrix3(new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld)).normalize(),point=new THREE.Vector3().fromArray(anchor.position).applyMatrix4(mesh.matrixWorld);
 const hits=new THREE.Raycaster(point.clone().addScaledVector(normal,.09),normal.clone().negate(),0,.2).intersectObject(mesh,false);
 assert(hits.some(hit=>hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld)).dot(normal)>.5),'Sticker anchor must project onto its own real surface, not another screw in the same base.');
}});assert(labels>=3,'Native pilot must retain real projected identification and warning anchors.');
actor.traverse(mesh=>{if(mesh.name.includes('conexión al efector')){const p=mesh.geometry.attributes.position;for(let i=0;i<p.count;i++)assert(p.getX(i)<kin.getDimensions(config).toolLength-.08,'Tool hose must end at the actuator/manifold behind the insertion and load contact region.');}});
const minimal=prefabs.createRobot({...config,serviceHarness:false,jointCovers:false,servicePackage:'none',identificationLabels:false}),minimalRig=minimal.userData.robotRig;
assert.equal(minimalRig.serviceCables.length,0);let n=0;minimal.traverse(mesh=>{n+=(mesh.userData.industrialStickerAnchors||[]).length;});assert.equal(n,0);
const originals=new Map(rig.serviceCables.map(line=>[line.mesh,line.mesh.geometry]));
let minDistance=Infinity,samples=0;
// The measured supported folded sweep spans 41 poses and all six native axes.
// Arbitrary joint-limit combinations are not certified by these samples.
for(let step=0;step<=40;step++){
 const f=step/40,values=[Math.sin(f*Math.PI*2),1.1+.45*Math.sin(f*Math.PI),-1.8-.55*Math.sin(f*Math.PI),.5*Math.sin(f*2*Math.PI),-.57+.3*Math.sin(f*2*Math.PI),Math.sin(f*2*Math.PI)];
 const pose=kin.forward(config,values);prefabs.updateRobotPose(actor,pose);prefabs.updateRobotPose(light,pose);
 assert(prefabs.getRobotToolTransform(actor).position.distanceTo(prefabs.getRobotToolTransform(light).position)<1e-10);
 const triangles=cad(actor).map(mesh=>{
  const p=mesh.geometry.attributes.position,index=mesh.geometry.index,matrix=mesh.matrixWorld,vertices=[];
  for(let i=0;i<index.count;i+=3){const triangle=new THREE.Triangle(...[0,1,2].map(k=>new THREE.Vector3().fromBufferAttribute(p,index.getX(i+k)).applyMatrix4(matrix)));if(triangle.getArea()>1e-12)vertices.push(triangle);}
  return {mesh,triangles:vertices,box:new THREE.Box3().setFromObject(mesh)};
 });
 for(const line of rig.serviceCables){
  assert.equal(line.mesh.geometry,originals.get(line.mesh),'Articulation updates GPU buffers instead of allocating new geometry each frame.');
  const start=line.a.point.clone().applyMatrix4(line.a.object.matrixWorld),end=line.z.point.clone().applyMatrix4(line.z.object.matrixWorld);
  assert(start.distanceTo(line.points[0])<1e-9);assert(end.distanceTo(line.points.at(-1))<1e-9);
  for(const point of line.points.slice(1,-1)){
   let distance=Infinity;const closest=new THREE.Vector3();
   for(const row of triangles){if(row.box.distanceToPoint(point)>distance)continue;for(const triangle of row.triangles){triangle.closestPointToPoint(point,closest);distance=Math.min(distance,closest.distanceTo(point));}}
   minDistance=Math.min(minDistance,distance);samples++;assert(distance>=line.radius*.95,line.mesh.name+' clearance '+distance+' is less than hose radius '+line.radius+' at sample '+step);
  }
 }
}
actor.position.set(3,.2,-4);actor.rotation.y=.7;actor.updateMatrixWorld(true);prefabs.updateRobotPose(actor,rig.pose);
for(const line of rig.serviceCables){const start=line.a.point.clone().applyMatrix4(line.a.object.matrixWorld),end=line.z.point.clone().applyMatrix4(line.z.object.matrixWorld);assert(start.distanceTo(line.points[0].clone().applyMatrix4(rig.visual.matrixWorld))<1e-8);assert(end.distanceTo(line.points.at(-1).clone().applyMatrix4(rig.visual.matrixWorld))<1e-8);}
console.log('Pilot accessories: capacity-independent slender housings, native labels, configurable real ports/clamps and '+samples+' moving hose-to-CAD distance samples passed. Minimum clearance '+(minDistance*1000).toFixed(2)+' mm.');
