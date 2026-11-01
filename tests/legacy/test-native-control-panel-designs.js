'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),THREE=require('three');
const behaviors=require('../../modules/logistica-industrial/contracts/behaviors.js');
const validate=require('../../apps/api/server/validation.js').validateDocument;
const robots=require('../support/load-robot-prefabs.js')(THREE);
const source=name=>fs.readFileSync(name,'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const factory=new Function('THREE','behaviorSchema','require',source('modules/logistica-industrial/functions/presentacion/runtime/IndustrialPrefabs.js')+'\nreturn createIndustrialPrefab;')(THREE,behaviors,robots.resolve);
const SceneDocument=new Function('THREE','behaviorSchema','createIndustrialPrefab',source('packages/project-model/src/SceneDocument.js').replace('default class SceneDocument','return class SceneDocument'))(THREE,behaviors,factory);
const panels=behaviors.controlPanels,ids=panels.DESIGNS.filter(item=>item.id!=='auto').map(item=>item.id);
function measure(root){let triangles=0,meshes=0;root.traverse(node=>{if(node.geometry){triangles+=(node.geometry.index?node.geometry.index.count:node.geometry.attributes.position.count)/3;meshes++;for(const attribute of Object.values(node.geometry.attributes))for(const n of attribute.array)assert(Number.isFinite(n));}});return{triangles,meshes};}
function visible(node){for(let p=node;p;p=p.parent)if(!p.visible)return false;return true;}
const near=(a,b)=>assert(Math.abs(a-b)<1e-5,`${a} != ${b}`);
function geometry(panel){
 panel.updateWorldMatrix(true,true);const inverse=new THREE.Matrix4().getInverse(panel.matrixWorld),bounds=new THREE.Box3();
 panel.traverse(node=>{if(!node.geometry||!visible(node))return;node.geometry.computeBoundingBox();bounds.union(node.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,node.matrixWorld)));});near(bounds.min.y,-1.28);
 const controls=panel.children.filter(node=>node.userData.industrialAction),eye=panel.localToWorld(new THREE.Vector3(0,.32,.9));assert.equal(controls.length,9);
 const seen=[];
 for(const control of controls){
  const cap=control.children[1],caption=control.children.find(node=>node.name==='Rótulo del control');assert.equal(cap.userData.industrialButton,true);seen.push(control.userData.industrialAction);
  const height=control.getWorldPosition(new THREE.Vector3()).y;assert(height>=1.10&&height<=1.50+1e-6,`${panel.userData.industrialPanelDesign} ${control.userData.industrialAction}: retain standing reach without lifting a hand above1.50m.`);
  for(const item of [cap,caption]){const target=item===caption?item.localToWorld(new THREE.Vector3(.001,.001,0)):item.getWorldPosition(new THREE.Vector3()),hits=new THREE.Raycaster(eye,target.clone().sub(eye).normalize()).intersectObject(panel,true).filter(hit=>visible(hit.object));assert(hits.length&&hits[0].object===item,`${panel.userData.industrialPanelDesign} ${control.userData.industrialAction} ${item.name} occluded by ${hits[0]&&hits[0].object.name}`);}
 }
 assert.equal(new Set(seen).size,9);const screen=panel.children[1];assert(screen.userData.industrialDisplay);assert(screen.userData.industrialDisplayAspect>1.5);const target=screen.getWorldPosition(new THREE.Vector3());assert.equal(new THREE.Raycaster(eye,target.clone().sub(eye).normalize()).intersectObject(panel,true).filter(hit=>visible(hit.object))[0].object,screen);
}
function document(){const d=new SceneDocument({});d.registerRoom('hall',new THREE.Group());return d;}
function config(d,object){return d.getBehaviors(object).find(row=>row.type===object.userData.editorPrefabKey);}
function panel(d,object){return object.children[0].children[object.userData.editorPrefabKey==='robot'?1:6];}
async function run(){
 assert.equal(panels.resolve({},'robot'),'pendant');assert.equal(panels.resolve({surface:'rollers'},'conveyor'),'compact');assert.equal(panels.resolve({surface:'belt'},'conveyor'),'console');assert.equal(panels.resolve({mechanism:'elevator'},'conveyor'),'cabinet');
 assert.equal(behaviors.normalizeBehaviors([{type:'robot'}])[0].panelDesign,'auto');assert.equal(behaviors.normalizeBehaviors([{type:'conveyor'}])[0].panelDesign,'auto');
 for(const type of ['robot','conveyor'])assert.throws(()=>behaviors.normalizeBehaviors([{type,panelDesign:'https://example.invalid'}]));
 const baseline=measure(factory('plc')),signatures=new Set();
 for(const id of ids){
  const root=factory('conveyor',undefined,{panelDesign:id}),p=root.children[6];root.position.y=1;assert.equal(p.userData.industrialPanelDesign,id);assert.deepEqual(measure(p),baseline,'All panel designs must reuse the original polygon and mesh budget.');geometry(p);signatures.add(JSON.stringify(p.children.slice(0,2).map(node=>({position:node.position.toArray(),rotation:node.rotation.toArray(),scale:node.scale.toArray()}))));
 }
 assert.equal(signatures.size,4,'The choices must be physically distinct panels.');
 const d=document(),objects=[d.addPrefab('hall','conveyor','roller-start'),d.addPrefab('hall','robot','articulated-general')];
 for(const object of objects){
  const p=panel(d,object),original=p.children.slice(),entry=d.additions.get(object.userData.editorId),controls=Array.from(entry.nodes.values()).filter(node=>d.getBehaviors(node).some(row=>row.type==='control')),controlIds=controls.map(node=>node.userData.editorId),bounds=measure(p);
  for(const id of ids){
   const old=config(d,object),before=d.undoStack.length;d.setBehaviors(object,d.getBehaviors(object).map(row=>row.type===old.type?Object.assign({},row,{panelDesign:id}):row));
   assert.equal(d.undoStack.length,before+1);assert.equal(panel(d,object),p,'Panel actor remains identical.');assert.deepEqual(p.children,original,'Persisted descendants remain identical.');assert.deepEqual(measure(p),bounds);assert.equal(p.userData.industrialPanelDesign,id);
   assert.deepEqual(controls.map(node=>node.userData.editorId),controlIds);for(const control of controls)assert.equal(d.getBehaviors(control).find(row=>row.type==='control').targetId,object.userData.editorId);
   assert.deepEqual(Object.assign({},config(d,object),{panelDesign:old.panelDesign}),old,'A visual choice cannot alter machine operation.');
   const changed=await d.serialize();assert(d.undo());assert.equal(config(d,object).panelDesign,old.panelDesign);assert.equal(panel(d,object).userData.industrialPanelDesign,panels.resolve(old,old.type));assert(d.redo());assert.deepEqual(await d.serialize(),changed,'Undo and redo retain panel design and all actor state.');
  }
  d.setTransform(controls[0],{position:[-.55,.18,.26]});d.setBehaviors(object,d.getBehaviors(object).map(row=>row.type===object.userData.editorPrefabKey?Object.assign({},row,{panelDesign:'pendant',withPanel:false}):row));assert.equal(p.visible,false);assert.deepEqual(controls[0].position.toArray(),[-.55,.18,.26],'An authored control transform survives a design change.');
 }
 const saved=await d.serialize();assert.doesNotThrow(()=>validate(saved,value=>value));const reopened=document();await reopened.load(saved);assert.deepEqual(await reopened.serialize(),saved,'Designs and descendant authoring roundtrip without mutation.');
 for(const object of objects){const restored=reopened.getObject(object.userData.editorId);assert.equal(panel(reopened,restored).userData.industrialPanelDesign,'pendant');assert.equal(config(reopened,restored).withPanel,false);reopened.setBehaviors(restored,reopened.getBehaviors(restored).map(row=>row.type===restored.userData.editorPrefabKey?Object.assign({},row,{panelDesign:'console',withPanel:true}):row));assert.equal(panel(reopened,restored).userData.industrialPanelDesign,'console');assert.equal(panel(reopened,restored).children[0].scale.x,panels.spec({panelDesign:'console'}).width/1.02,'A reopened automatic body follows subsequent visual changes.');}
 console.log('Native control panel designs: four real forms at identical polygon/mesh budget, visible controls and HMI, floor anchoring, stable IDs/commands, custom placement, validated save/reopen and subsequent editing passed.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
