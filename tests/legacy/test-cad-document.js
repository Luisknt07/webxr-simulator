const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),THREE=require('three'),schema=require('../../modules/logistica-industrial/contracts/behaviors'),cad=require('../../packages/tools/cad/schema/cad'),engine=require('../../packages/tools/cad/schema/cad-engine');
const dependencies=require('../support/load-robot-prefabs')(THREE),read=file=>fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-cad-document.js"),'..',file)),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const factory=new Function('THREE','behaviorSchema','require',read("modules/logistica-industrial/functions/presentacion/runtime/IndustrialPrefabs.js")+'\nreturn createIndustrialPrefab;')(THREE,schema,dependencies.resolve);
const Document=new Function('THREE','behaviorSchema','createIndustrialPrefab','require',read("packages/project-model/src/SceneDocument.js").replace('default class SceneDocument','return class SceneDocument'))(THREE,schema,factory,id=>{assert.equal(id,'../../tools/cad/schema/cad');return cad;});
const Tools=new Function('THREE','schema','window','document',read("modules/logistica-industrial/integrations/StudioTools.js").replace('default class StudioTools','return class StudioTools'))(THREE,schema,{},{});
const {validateDocument}=require('../../apps/api/server/validation');
const model=engine.compile({steps:[{id:'s1',op:'solid.box',params:{width:.15,height:.08,depth:.20},inputs:[]}]}),descriptor={type:'cad',recipe:model.recipe,mesh:model.mesh,color:'#567a93'};
const closeMatrix=(a,b)=>a.elements.forEach((value,index)=>assert(Math.abs(value-b.elements[index])<1e-8));
const localMatrix=object=>new THREE.Matrix4().compose(object.position,object.quaternion,object.scale);
function setup(){const doc=new Document({}),hall=new THREE.Group(),sound=new THREE.Group();hall.position.set(3,0,-2);hall.rotation.y=.25;sound.position.set(-9,0,5);doc.registerRoom('hall',hall);doc.registerRoom('sound',sound);return doc;}
function rig(actor){return actor.children[0].userData.vehicleRig;}
function expected(doc,piece,anchor){anchor.updateWorldMatrix(true,false);piece.parent.updateWorldMatrix(true,false);return new THREE.Matrix4().multiplyMatrices(new THREE.Matrix4().getInverse(piece.parent.matrixWorld),anchor.matrixWorld).multiply(localMatrix(piece));}
function toolsFor(doc,roomId='sound',target=new THREE.Vector3(10,0,0)){
  const editor={document:doc,roomId,root:doc.getRoot(roomId),active:true,projectGeneration:1,ctx:{renderer:{domElement:{addEventListener(){}}}},transform:{enabled:true,addEventListener(){}},orbit:{target},ui:{inert:false},select(){},perform:async callback=>callback()};return new Tools(editor);
}
async function run(){
  const doc=setup(),actor=doc.addPrefab('hall','vehicle','forklift-electric-4w');doc.setTransform(actor,{position:[1,0,2],quaternion:new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),.6).toArray(),scale:[1.2,1.2,1.2]});
  const config=doc.getBehaviors(actor).find(value=>value.type==='vehicle');doc.setBehaviors(actor,[Object.assign({},config,{initialLift:.6})]);
  const attached=Object.assign({},descriptor,{attachment:{targetId:actor.userData.editorId,part:'forks',position:[.05,.10,.12]}}),piece=doc.addCAD('hall',attached);
  doc.setTransform(piece,{quaternion:new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),.2).toArray(),scale:[.7,.8,.9]});doc.syncCADAttachments();closeMatrix(piece.matrix,expected(doc,piece,rig(actor).forks));
  const offsets=doc._state(piece);
  for(let frame=0;frame<120;frame++){
    dependencies.updateVehiclePose(actor.children[0],{lift:.6+Math.sin(frame*.1)*.4,tilt:.06,sideShift:.08,steer:0,wheelRoll:0,lights:false});doc.syncCADAttachments();closeMatrix(piece.matrix,expected(doc,piece,rig(actor).forks));
  }
  assert.deepEqual(doc._state(piece),offsets,'Following moving forks never accumulates movement in authored local offsets.');
  dependencies.updateVehiclePose(actor.children[0],schema.vehicles.initialPose(doc.getBehaviors(actor)[0]));doc.syncCADAttachments();
  const original=JSON.parse(JSON.stringify(doc.additions.get(piece.userData.editorId).descriptor)),oldGeometry=piece.children[0].geometry;let disposed=0;oldGeometry.addEventListener('dispose',()=>disposed++);
  const changed=engine.compile({steps:[{id:'s1',op:'solid.tube',params:{radius:.1,height:.08,radius2:.05},inputs:[]}]});
  doc.updateCAD(piece,Object.assign({},attached,{recipe:changed.recipe,mesh:changed.mesh,color:'#a77832',attachment:Object.assign({},attached.attachment,{position:[.8,.9,.3]})}));
  assert.equal(disposed,1);assert.deepEqual(piece.position.toArray(),offsets.position,'attachment.position is only initial placement; editing geometry preserves subsequent local offsets.');
  assert.notEqual(piece.children[0].geometry,oldGeometry);doc.undo();assert.deepEqual(doc.additions.get(piece.userData.editorId).descriptor,original);closeMatrix(piece.matrix,expected(doc,piece,rig(actor).forks));doc.redo();assert.equal(doc.additions.get(piece.userData.editorId).descriptor.color,'#a77832');
  const clip=doc.captureObject(piece),same=await doc.pasteObject(clip,'hall',0);assert.equal(doc.additions.get(same.userData.editorId).descriptor.attachment.targetId,actor.userData.editorId);closeMatrix(same.matrix,piece.matrix);assert.notEqual(same.children[0].geometry,piece.children[0].geometry);
  const cross=await doc.pasteObject(clip,'sound',.5);assert.equal(doc.additions.get(cross.userData.editorId).descriptor.attachment,undefined);const copied=localMatrix(cross),worldInRoom=piece.matrix.clone();worldInRoom.elements[12]+=.5;closeMatrix(copied,worldInRoom);
  const cabin=doc.addCAD('hall',Object.assign({},descriptor,{attachment:{targetId:actor.userData.editorId,part:'cabin',position:[.1,.2,.3]}}));closeMatrix(cabin.matrix,expected(doc,cabin,rig(actor).cabin));
  const saved=await doc.serialize();assert.doesNotThrow(()=>validateDocument(saved,value=>value));const restored=setup();await restored.load(saved);assert.deepEqual(await restored.serialize(),saved);
  const reopened=restored.getObject(piece.userData.editorId),reopenedActor=restored.getObject(actor.userData.editorId);closeMatrix(reopened.matrix,expected(restored,reopened,rig(reopenedActor).forks));
  const before=(await doc.serialize()).rooms.hall.additions.length,history=doc.undoStack.length;
  assert.throws(()=>doc.addCAD('hall',Object.assign({},attached,{attachment:{targetId:'missing',part:'forks',position:[0,0,0]}})),/vehículo/);assert.equal(doc.undoStack.length,history);assert.equal((await doc.serialize()).rooms.hall.additions.length,before);
  const bad=JSON.parse(JSON.stringify(saved));bad.rooms.hall.additions.find(value=>value.descriptor.type==='cad').descriptor.mesh.positions=[NaN,0,0];assert.throws(()=>validateDocument(bad,value=>value),error=>error.status===400);
  // Template copies rebind the complete CAD/vehicle graph and move only the
  // vehicle's transform, preserving the child CAD offset exactly once.
  const template={objects:[doc.captureObject(actor),doc.captureObject(piece)]},tools=toolsFor(doc),copies=await tools.placeTemplate(template);
  const newActor=copies[0],newPiece=copies[1];assert.equal(doc.additions.get(newPiece.userData.editorId).descriptor.attachment.targetId,newActor.userData.editorId);assert.deepEqual(newPiece.position.toArray(),piece.position.toArray());closeMatrix(newPiece.matrix,expected(doc,newPiece,rig(newActor).forks));
  const independent=await tools.placeTemplate({objects:[clip]},{preservePosition:true});assert.equal(doc.additions.get(independent[0].userData.editorId).descriptor.attachment,undefined);closeMatrix(localMatrix(independent[0]),piece.matrix);
  const end=await doc.serialize();doc.undo();doc.redo();assert.deepEqual(await doc.serialize(),end,'Whole-template undo/redo retains recipe, linkage and transform.');
  const orphanDoc=setup(),removedVehicle=orphanDoc.addPrefab('hall','vehicle','forklift-electric-4w');orphanDoc.setTransform(removedVehicle,{position:[4,0,1]});
  const remaining=orphanDoc.addCAD('hall',Object.assign({},descriptor,{attachment:{targetId:removedVehicle.userData.editorId,part:'forks',position:[.1,.2,.3]}})),lastPose=remaining.matrix.clone();
  orphanDoc.remove(removedVehicle);orphanDoc.syncCADAttachments();closeMatrix(remaining.matrix,lastPose);orphanDoc.undo();closeMatrix(remaining.matrix,expected(orphanDoc,remaining,rig(removedVehicle).forks));orphanDoc.redo();orphanDoc.syncCADAttachments();closeMatrix(remaining.matrix,lastPose);
  console.log('CAD document: real geometry add/update/disposal, save/reopen/server400, copy isolation, local fork/cabin attachment through120 moving poses, cross-room unlink and template graph remap without double translation passed.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
