import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),THREE=require('three');
const catalog=require('../../modules/logistica-industrial/functions/equipamiento/schema/equipmentCatalog.cjs');
const schema=require('../../modules/logistica-industrial/contracts/behaviors.js');
const fixture=require('../legacy/test-vehicle-storage.js');

function release(root){const geometry=new Set(),materials=new Set(),textures=new Set();root.traverse(n=>{if(n.geometry)geometry.add(n.geometry);for(const m of Array.isArray(n.material)?n.material:n.material?[n.material]:[]){materials.add(m);Object.values(m).forEach(t=>{if(t&&t.isTexture)textures.add(t);});}});geometry.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());}

test('all 195 standalone catalogue actors use actual native factory, finite geometry, valid named components and normalizable behaviors',()=>{
 const failures=[],counts={native:0,workspace:0,attachment:0};
 for(const d of catalog.DEFINITIONS){
  if(d.operationLevel==='workspace'){counts.workspace++;continue;}
  if(d.operationLevel==='attachment'){counts.attachment++;continue;}
  let root;
  try{
   root=fixture.factory(d.nativeKind,'catalogue:'+d.id);
   assert.equal(root.userData.catalogueEquipmentId,d.id);assert.equal(root.userData.editorPrefabKey,d.nativeKind);
   assert.ok(root.children.length>0);
   const box=new THREE.Box3().setFromObject(root);assert.ok(!box.isEmpty()&&[...box.min.toArray(),...box.max.toArray()].every(Number.isFinite));
   // Native templates use @root until SceneDocument attaches persistent IDs.
   const authored=(root.userData.editorDefaultBehaviors||[]).map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value==='@root'?'custom-catalogue-fixture':value])));
   const behaviors=schema.normalizeBehaviors(authored),b=behaviors.find(x=>x.type===d.behaviorType);
   assert.ok(b,d.id+' native behavior '+d.behaviorType);assert.equal(b.catalogueEquipmentId,d.id);
   let meshes=0;root.traverse(n=>{if(!n.isMesh||!n.geometry)return;meshes++;const p=n.geometry.attributes.position;assert.ok(p&&p.count>0);for(const key of ['normal','uv'])if(n.geometry.attributes[key])assert.equal(n.geometry.attributes[key].count,p.count,d.id+' '+n.name+' '+key);});
   assert.ok(meshes>0);counts.native++;
  }catch(error){failures.push({id:d.id,message:error.message});}finally{if(root)release(root);}
 }
 assert.equal(failures.length,0,JSON.stringify(failures));assert.deepEqual(counts,{native:195,workspace:10,attachment:32});
});

test('representative catalogue machines preserve semantic identity, configured recipes and native control paths through document save/reopen',async()=>{
 const doc=new fixture.Document({});doc.registerRoom('sound',new THREE.Group());
 const ids=['equipment.machine.cnc-lathe','equipment.packaging.carton-sealer','equipment.transport.spiral','equipment.product.ibc','equipment.storage.pallet-asrs','equipment.robot.articulated','equipment.sensor.photoelectric'];
 const refs=[];
 for(const id of ids){const d=catalog.definition(id),actor=doc.addPrefab('sound',d.nativeKind,'catalogue:'+id);assert.ok(actor);const b=doc.getBehaviors(actor).find(x=>x.type===d.behaviorType);assert.equal(b.catalogueEquipmentId,id);refs.push({id,actorId:actor.userData.editorId,paths:[]});actor.traverse(n=>{if(n.userData.editorId)refs.at(-1).paths.push(n.userData.editorId);});}
 const saved=await doc.serialize();const next=new fixture.Document({});next.registerRoom('sound',new THREE.Group());await next.load(saved);
 require('../../apps/api/server/validation.js').validateDocument(saved,value=>value);
 assert.deepEqual(await next.serialize(),saved);
 for(const ref of refs){const actor=next.getObject(ref.actorId);assert.ok(actor);assert.equal(actor.children[0].userData.catalogueEquipmentId,ref.id);const paths=[];actor.traverse(n=>{if(n.userData.editorId)paths.push(n.userData.editorId);});assert.deepEqual(paths,ref.paths);}
 for(const state of [doc,next])for(const row of state.additions.values())release(row.object);
});
