'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),THREE=require('three');
const catalog=require('../../modules/logistica-industrial/functions/equipamiento/schema/equipmentCatalog.cjs'),robots=require('../../modules/logistica-industrial/functions/robots/schema/robots.js'),kin=require('../../modules/logistica-industrial/functions/robots/schema/robot-kinematics.js'),geometry=require('../../modules/logistica-industrial/functions/equipamiento/runtime/EquipmentGeometry.cjs'),prefabs=require('../support/load-robot-prefabs.js')(THREE);
const meshList=root=>{const rows=[];root.traverse(n=>{if(n.isMesh)rows.push(n);});return rows;};
const tools=catalog.DEFINITIONS.filter(d=>d.role==='tool'&&d.operationLevel==='attachment'),signatures=new Set();let poses=0,maximumTriangles=0;
const Runtime=require('../support/load-robot-runtime.js')(THREE,prefabs),runtime=new Runtime({ctx:{}});
assert.equal(tools.length,32,'The tool stand is a real passive station, not a wrist attachment.');
for(const definition of tools){
 const config=robots.normalize({...robots.defaults(),withPanel:false,catalogueToolId:definition.id,tool:definition.toolType,operation:definition.toolType==='process'?'process':'pick-place'}),baseline={...config};delete baseline.catalogueToolId;
 const object=prefabs.createRobot(config),rig=object.userData.robotRig,attachment=rig.catalogueTool;
 assert.equal(attachment.id,definition.id);assert.equal(rig.config.catalogueToolId,definition.id);
 if(config.tool==='fork'){
  assert(!attachment.geometry,'Actual support forks retain their dimensioned native rig and adapter.');assert(rig.toolContactSurfaces.length===2);assert(kin.getDimensions(config).toolSupport);
 }else{
  assert(attachment.geometry&&attachment.geometry.parent===rig.toolAssembly);assert(rig.toolAssembly.children.every(n=>n===rig.tool||n===attachment.geometry),'No duplicate old gripper/nozzle can remain behind the selected EOAT.');
  const tool=attachment.geometry,frame=tool.userData.robotCatalogueToolFrame,contact=new THREE.Vector3().fromArray(frame.contact).multiply(tool.scale).applyQuaternion(tool.quaternion).add(tool.position);
  assert(contact.length()<1e-8,'The actual contact frame maps exactly onto the existing TCP.');
  const flange=new THREE.Vector3().fromArray(frame.flange).multiply(tool.scale).applyQuaternion(tool.quaternion).add(tool.position);assert(Math.abs(flange.x-(rig.pilotFlangeEnd||.015)+kin.getDimensions(config).toolLength)<1e-8,'The real mounting flange meets the wrist adapter.');
  const hash=crypto.createHash('sha256');let triangles=0;for(const mesh of meshList(tool)){const g=mesh.geometry;assert(g.attributes.position.array.every(Number.isFinite));assert(mesh.userData.equipmentComponentId==='robot.tool');assert(mesh.userData.catalogueToolComponentId.startsWith(definition.id+'.'));hash.update(Buffer.from(g.attributes.position.array.buffer));triangles+=(g.index?g.index.count:g.attributes.position.count)/3;assert(mesh.material.userData.studioColorSpace==='linear');}
  signatures.add(hash.digest('hex'));maximumTriangles=Math.max(maximumTriangles,triangles);assert(triangles<7000,'An EOAT remains a bounded native model.');
  assert(tool.userData.robotCatalogueAttachment);
  if(definition.toolType!=='process')assert(rig.toolContactSurfaces.length,'Handling requires an actual named contact surface, not metadata alone.');
 }
 for(const joints of [[0,.7,-1.3,0,-.97,0],[.3,1.1,-1.7,.2,-1.2,.3],[-.3,.9,-1.6,-.2,-.7,-.4]]){
  const pose=kin.forward(config,joints),old=kin.forward(baseline,joints);assert.deepEqual(pose.frames,old.frames);assert.deepEqual(pose.tcp,old.tcp);
  prefabs.updateRobotPose(object,Object.assign({},pose,{gripSpan:.15,open:1}));assert(prefabs.getRobotToolTransform(object).position.distanceTo(new THREE.Vector3().fromArray(pose.toolPosition))<1e-8);const inverse=kin.inverse(config,{position:pose.toolPosition,quaternion:pose.quaternion},joints);assert(inverse.error<1e-6);poses++;
  assert(runtime.selfClear({object,components:{robot:{config,visualRoot:object}}}),definition.id+': the actual native self-collision guard must permit this sampled carrying pose.');
 }
 if(rig.catalogueToolSync&&rig.fingers.length){
  const p=kin.homePose(config);prefabs.updateRobotPose(object,{...p,open:1,gripSpan:.15});const positions=rig.fingers.map(f=>f.position.clone());prefabs.updateRobotPose(object,{...p,open:0,gripSpan:.15});assert(rig.fingers.some((f,i)=>f.position.distanceTo(positions[i])>.03),'Opening and closing moves the selected real jaws, not the old hidden gripper.');
  for(const finger of rig.fingers)assert(meshList(finger).some(m=>m.userData.robotContactSurface==='jaw'),'Every moving jaw has its own real pad.');
 }
 geometry.disposeGeometry(object);
}
assert(signatures.size>=16,'The catalogue must contain substantially different actual EOAT assemblies, not 32 labels on one mesh.');
const config={...robots.defaults(),tool:'gripper',catalogueToolId:'equipment.tool.magnet'};assert.equal(kin.getToolContactDepth(config,.2),0);config.catalogueToolId='equipment.tool.needle';assert.equal(kin.getToolContactDepth(config,.2),.008);delete config.catalogueToolId;assert.equal(kin.getToolContactDepth(config,.2),.04,'Legacy parallel-jaw insertion remains unchanged and cache invalidation follows an edited EOAT ID.');
const stand=catalog.definition('equipment.tool.stand'),cfg=catalog.normalize(stand.id),layout=catalog.layout(stand.id,cfg),root=geometry.createEquipmentGeometry(stand,cfg,{THREE,layout});assert.equal(stand.nativeKind,'product');assert.equal(stand.operationLevel,'physical-support');root.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(root);assert(box.min.y>=-1e-7,'The separate EOAT station rests on the real floor, never hangs below its origin.');geometry.disposeGeometry(root);
console.log('Catalogue robot EOAT: 32 real attachments, '+signatures.size+' distinct assemblies, '+poses+' unchanged frame/TCP/FK/IK samples, moving actual jaws, real contact pads, top-contact magnet/needle and separate passive stand passed. Maximum EOAT '+maximumTriangles+' triangles.');
