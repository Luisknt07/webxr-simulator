import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),native=require('../support/load-practice-scenes.cjs')();
function checkTruck(root){
 let nativeRoot;root.traverse(node=>{if(node.userData.robotRig)nativeRoot=node;});const rig=nativeRoot&&nativeRoot.userData.robotRig,body=nativeRoot&&nativeRoot.children.find(child=>child.userData.catalogueGeometryBody);assert(rig&&body);assert(rig.joints.length);assert(rig.tool);
 let oldMeshes=0;nativeRoot.children.filter(child=>child.userData.robotVisual).forEach(child=>child.traverse(node=>{if(node.isMesh)oldMeshes++;}));assert.equal(oldMeshes,0,'A freight truck cannot contain the original cartesian gantry mesh.');assert.equal(rig.collisionBodies.length,0);assert.equal(rig.collisionGroups.length,0);
 const names=[];body.traverse(node=>names.push(...node.userData.equipmentSourceParts||[],node.name));for(const part of ['Caja de carga','Cabina','Neumático','Llanta'])assert(names.some(name=>name.includes(part)),part+' remains real truck geometry.');
 const height=new native.THREE.Box3().setFromObject(body).getSize(new native.THREE.Vector3()).y;assert(height<3.2,'The retired gantry must not inflate the truck height.');root.updateWorldMatrix(true,true);assert(rig.tool.matrixWorld.elements.every(Number.isFinite));
 return body;
}
test('parked freight trucks retain native identity and anchors but no superposed gantry after refresh and save/reload',async()=>{
 const f=native.fixture(),next=native.fixture();try{
  const b=native.buildConfigurablePracticeScene(f.document,'hall','CEDI-05',{mode:'manual',scene:f.scene}),row=b.manifest.aliases.find(row=>row.alias==='E06'),truck=f.document.getObject(row.objectId);checkTruck(truck);
  const pose=truck.position.toArray(),configuration=f.document.getBehaviors(truck).find(c=>c.type==='robot');assert.equal(configuration.catalogueEquipmentId,'equipment.vehicle.freight-truck');
  f.document.setBehaviors(truck,f.document.getBehaviors(truck));checkTruck(truck);assert.deepEqual(truck.position.toArray(),pose);
  f.runtime.start('hall');native.advance(f,.2);const record=f.runtime.records.get(row.objectId);assert(record.components.robot);assert.equal(record.components.robot.config.running,false);assert.deepEqual(truck.position.toArray(),pose);
  const saved=native.validateDocument(await f.document.serialize(),v=>v);await next.document.load(saved);checkTruck(next.document.getObject(row.objectId));assert.deepEqual(next.document.getObject(row.objectId).position.toArray(),pose);
 }finally{if(f.runtime.active)f.runtime.stop();native.releaseGeometry(f);native.releaseGeometry(next);}
});
