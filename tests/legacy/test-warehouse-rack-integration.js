const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const file=__layout.map(path.join(__layout.oldDir("scripts/test-warehouse-rack-integration.js"),'test-conveyor-mechanisms.js')),code=fs.readFileSync(file,'utf8');
const {setup,THREE,behaviorSchema:schema}=new Function('require','__dirname',code.slice(0,code.indexOf('async function run()'))+'\nreturn {setup,THREE,behaviorSchema};')(createRequire(file),__dirname);
const racks=schema.warehouseRacks,{validateDocument}=require('../../apps/api/server/validation');
const ConveyorAssembly=new Function('THREE','conveyorLayout',fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-warehouse-rack-integration.js"),'../src/editor/ConveyorAssembly.js')),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default class ConveyorAssembly','return class ConveyorAssembly'))(THREE,schema.conveyorLayout);
const id=o=>o.userData.editorId,config=(f,o,type)=>f.document.getBehaviors(o).find(c=>c.type===(type||o.userData.editorPrefabKey));
function patch(f,o,values,type){const kind=type||o.userData.editorPrefabKey;f.document.setBehaviors(o,f.document.getBehaviors(o).map(c=>c.type===kind?Object.assign({},c,values):c));return o;}
function add(f,kind,values={},at=[0,1,0],variant){const o=f.document.addPrefab('hall',kind,variant);patch(f,o,values);f.document.setTransform(o,{position:at});return o;}
function advance(f,seconds){for(let t=0;t<seconds-1e-9;t+=1/60){f.scene.updateMatrixWorld(true);f.ctx.collisionWorld.beginFrame();f.runtime.execute(Math.min(1/60,seconds-t));f.ctx.collisionWorld.endFrame();}}
function until(f,check,seconds,label){for(let t=0;t<seconds;t+=1/60){if(check())return;advance(f,1/60);}throw new Error(label+' timeout: '+JSON.stringify(f.runtime.getSnapshot().objects.map(o=>({name:o.name,variables:o.variables}))));}
function controls(f,o){return Array.from(f.document.additions.get(id(o)).nodes.values()).filter(n=>f.document.getBehaviors(n).some(c=>c.type==='control'));}
function bounds(o){o.updateWorldMatrix(true,true);return new THREE.Box3().setFromObject(o);}
function assembly(f){return new ConveyorAssembly({document:f.document,roomId:'hall',root:f.root,ctx:f.ctx,hooks:{renderScene:f.scene},assemblyMessage(){}});}
function join(a,from,to){assert(a.align(from,'output',to,'input'),'Actual port geometry must align.');assert(a.connect(a.pair(to,'input',from,'output')),'Existing connection machinery must accept these port types.');const out=a.worldPort(from,'output'),input=a.worldPort(to,'input');assert(out.position.distanceTo(input.position)<1e-6);assert(out.tangent.dot(input.tangent)>.99999);}

async function authoring(){
 const f=setup(),actors=[];f.document.registerRoom('sound',new THREE.Group());
 const producer=add(f,'source',{autoGenerate:false,initialCount:0},[-50,1,0]),receiver=add(f,'source',{autoGenerate:false,initialCount:0},[50,1,0]);
 for(const system of racks.SYSTEMS){
  const actor=add(f,'palletQueue',{},[actors.length*12,1,16],system.id),initial=config(f,actor),content=actor.children[0],holder=content.children[0],panel=content.children[1],hardware=controls(f,actor),before=bounds(holder).getSize(new THREE.Vector3());
  assert.equal(initial.rackSystem,system.id);assert.equal(actor.userData.editorDescriptor.variant,system.id);assert(content.userData.warehouseRackRig);assert(hardware.length>=4);
  patch(f,actor,{rackBayWidth:initial.rackBayWidth+.3,outputId:id(receiver),outputPort:'input',withPanel:false});
  const revised=config(f,actor);assert.equal(content.children[0],holder);assert.equal(content.children[1],panel);assert.equal(panel.visible,false);assert.deepEqual(controls(f,actor),hardware);
  assert(bounds(holder).getSize(new THREE.Vector3()).x>before.x+.1,'Changing module width changes real '+system.id+' geometry.');
  actors.push(actor);hardware.forEach(node=>assert.equal(config(f,node,'control').targetId,id(actor)));
  const copy=await f.document.pasteObject(f.document.captureObject(actor),'hall',3);assert.notEqual(id(copy),id(actor));assert.deepEqual(config(f,copy),revised);assert.equal(copy.userData.editorDescriptor.variant,system.id);controls(f,copy).forEach(node=>assert.equal(config(f,node,'control').targetId,id(copy)));
  assert.equal(config(f,copy).outputId,id(receiver),'Same-room copies preserve deliberate external output references.');
  const across=await f.document.pasteObject(f.document.captureObject(actor),'sound',0);assert.equal(config(f,across).outputId,'','Cross-level copies clear out-of-level references.');assert.equal(config(f,across).rackSystem,system.id);
 }
 patch(f,producer,{outputId:id(actors[0]),delivery:'automatic'});const saved=await f.document.serialize();validateDocument(saved,()=>{throw Error('No imports');});const reopened=setup();reopened.document.registerRoom('sound',new THREE.Group());await reopened.document.load(saved);
 for(const actor of actors){const copy=reopened.document.getObject(id(actor));assert.deepEqual(config(reopened,copy),config(f,actor));assert.equal(copy.userData.editorDescriptor.variant,config(f,actor).rackSystem);assert(copy.children[0].userData.warehouseRackRig);}
 assert.equal(config(reopened,reopened.document.getObject(id(producer))).outputId,id(actors[0]));
 const legacy=add(f,'palletQueue'),holder=legacy.children[0].children[0],panel=legacy.children[0].children[1],hardware=controls(f,legacy);
 patch(f,legacy,Object.assign({},racks.defaults('selective'),{rackBays:1,rackColumns:1,rackLevels:2,outputId:id(receiver)}));assert(legacy.children[0].userData.warehouseRackRig);assert.equal(legacy.children[0].children[0],holder);
 f.document.setBehaviors(legacy,[Object.assign(schema.defaultBehavior('palletQueue'),{rackSystem:'floor',outputId:id(receiver)})]);assert(!legacy.children[0].userData.warehouseRackRig);assert.equal(legacy.userData.editorDescriptor.variant,undefined);assert.equal(legacy.children[0].children[1],panel);assert.deepEqual(controls(f,legacy),hardware);assert.equal(config(f,legacy).outputId,id(receiver));assert(holder.children[0].userData.industrialPalletWoodSize);
 assert(f.document.undo());assert(legacy.children[0].userData.warehouseRackRig);assert.equal(config(f,legacy).rackSystem,'selective');assert(f.document.redo());assert(!legacy.children[0].userData.warehouseRackRig);
 console.log('Rack authoring: all14 real factory variants resize, retain HMI/control IDs, copy/load references correctly and switch floor↔rack↔floor with real visual undo.');
}

async function flow(system){
 const f=setup(),pallet=system==='pallet-flow',rack=add(f,'palletQueue',{withPanel:false,delivery:'automatic',outputInterval:.1,rackBays:1,rackLevels:1,rackColumns:1,rackDepthSlots:3,rackMechanismSpeed:.8},[0,1,0],system);
 const source=add(f,'source',{initialCount:2,capacity:2,autoGenerate:false,totalLimit:2,delivery:'automatic',outputInterval:.2,withPanel:false,generationMode:'sequence',loadMode:pallet?'pallet':'individual',palletType:'euro-1200x800',palletColumns:2,palletRows:2,palletLayers:1,
  catalog:JSON.stringify([{id:'rack-flow-load',name:'Carga de flujo',type:'box',variant:'box-small',width:.3,depth:.3,height:.22,mass:2,base:'flat',quality:'good',defect:'none',color:'#b98d53'}])},[-10,1,0]);
 const belt=add(f,'conveyor',{withPanel:false,withSensors:false,autoSpawn:false,running:true,powered:true,length:4,speed:.25,maxPackages:2,width:pallet?1.4:.7,maxLoad:200},[10,1,0],pallet?'pallet-chain':'belt-middle');
 const paths=assembly(f);assert(paths.align(rack,'input',source,'output'));assert(paths.connect(paths.pair(source,'output',rack,'input')));join(paths,rack,belt);paths.clear();
 const before=await f.document.serialize();f.scene.updateMatrixWorld(true);f.runtime.start('hall');const input=f.runtime.records.get(id(source)).components.source,stock=f.runtime.records.get(id(rack)).components.palletQueue,target=f.runtime.records.get(id(belt)).components.conveyor,entries=input.queue.slice(),objects=entries.map(e=>e.product&&e.product.object);
 until(f,()=>{entries.forEach((entry,i)=>{if(entry.product){if(objects[i])assert.equal(entry.product.object,objects[i]);else objects[i]=entry.product.object;}});return target.packages.length===2;},35,system+' Source→rack→conveyor');
 assert.equal(input.queue.length,0);assert.equal(stock.queue.length,0);assert.equal(stock.received,2);assert.equal(stock.receivedUnits,pallet?8:2);assert.deepEqual(target.packages.map(p=>p.product.sourceEntry),entries,'FIFO preserves the two original source entries in discharge order.');
 target.packages.forEach((p,i)=>{assert.equal(p.product.object,objects[i]);assert.equal(f.runtime.productMetadata(p.product).units,pallet?4:1);assert.equal(f.runtime.productMetadata(p.product).mass,pallet?33:2);});assert.equal(f.runtime.products.size,2,'The route neither clones nor destroys source loads.');
 f.runtime.stop();assert.deepEqual(await f.document.serialize(),before);console.log(system+': real Source→aligned rack input→gravity motion→aligned conveyor, same two entries/meshes, exact units/mass and restored document.');
}

async function robots(){
 const f=setup(),src=add(f,'source',{initialCount:1,capacity:1,totalLimit:1,autoGenerate:false,delivery:'manual',withPanel:false,width:.3,height:.22,depth:.3,mass:2},[-1.3,1,1.8]);
 const rack=add(f,'palletQueue',{withPanel:false,delivery:'manual',rackBays:1,rackColumns:1,rackLevels:1,rackBaseHeight:1},[1.5,1,0],'light-duty');
 const dst=add(f,'source',{initialCount:0,capacity:2,autoGenerate:false,delivery:'manual',withPanel:false,width:.3,height:.22,depth:.3},[4.5,1,1.8]);
 const common={withPanel:false,reach:3.6,payloadKg:30,tool:'vacuum',acceptedTypes:'all',requireKnownMass:true,maxProductWidth:1,maxProductDepth:1,maxProductHeight:1,mode:'automatic',cycleTime:3,speed:1.2,setupTime:.2,approachHeight:.35};
 const first=add(f,'robot',Object.assign({},common,{running:true,sourceId:id(src),outputId:id(rack)}),[0,0,2.2],'articulated-general');
 const second=add(f,'robot',Object.assign({},common,{running:false,sourceId:id(rack),outputId:id(dst)}),[3.3,0,2.2],'articulated-general');patch(f,src,{outputId:id(first)});
 const before=await f.document.serialize();f.scene.updateMatrixWorld(true);f.runtime.start('hall');const input=f.runtime.records.get(id(src)).components.source,stock=f.runtime.records.get(id(rack)).components.palletQueue,output=f.runtime.records.get(id(dst)).components.source,one=f.runtime.records.get(id(first)).components.robot,two=f.runtime.records.get(id(second)).components.robot,entry=input.queue[0],object=entry.product.object;
 until(f,()=>stock.queue.length===1&&one.completed===1&&one.phase!=='return',35,'Robot deposit on rack');assert.equal(stock.queue[0],entry);assert.equal(one.fault,'');f.runtime.setVariable(id(first),'running',false);f.runtime.setVariable(id(second),'running',true);
 until(f,()=>output.queue.length===1&&two.completed===1,35,'Robot pickup from rack');assert.equal(output.queue[0],entry);assert.equal(entry.product.object,object);assert.equal(stock.queue.length,0);assert.equal(two.fault,'');assert.equal(f.runtime.productMetadata(entry.product).mass,2);assert.equal(f.runtime.products.size,1);
 f.runtime.stop();assert.deepEqual(await f.document.serialize(),before);console.log('Robot custody: real Source→robot→shelf→second robot→receiver, same entry/object, no duplicated cargo and exact stop restoration.');
}
async function reflow(){
 const sourceFile=__layout.map(path.join(__layout.oldDir("scripts/test-warehouse-rack-integration.js"),'test-editor-connection-reflow.js')),text=fs.readFileSync(sourceFile,'utf8'),{fixture}=new Function('require','__dirname',text.slice(0,text.lastIndexOf('async function run()'))+'\nreturn {fixture};')(createRequire(sourceFile),__dirname),f=await fixture();
 try{
  const source=f.add('source'),rack=f.document.addPrefab('hall','palletQueue','selective'),belt=f.add('conveyor','pallet-chain',{width:1.4});
  f.document.setBehaviors(rack,f.document.getBehaviors(rack).map(c=>c.type==='palletQueue'?Object.assign({},c,{withPanel:false}):c));f.connect(source,rack);f.connect(rack,belt);f.joined();
  const original=await f.document.serialize(),depth=f.document.undoStack.length,sourcePose=source.position.clone(),beltPose=belt.position.clone(),rackPose=rack.position.clone(),initial=f.config(rack);
  await f.change(rack,'rackBayWidth',initial.rackBayWidth+.4);f.joined();assert.equal(f.document.undoStack.length,depth+1,'A connected dimension edit remains one undo operation.');
  assert(source.position.distanceTo(sourcePose)>.01||belt.position.distanceTo(beltPose)>.01||rack.position.distanceTo(rackPose)>.01,'Changing actual rack width repositions the connected graph instead of leaving dangling links.');
  const widened=await f.document.serialize(),firstY=source.position.y,lastY=belt.position.y,rackY=rack.position.y;
  await f.change(rack,'rackBaseHeight',initial.rackBaseHeight+.2);f.joined();assert(Math.abs(source.position.y-firstY)>.1||Math.abs(belt.position.y-lastY)>.1||Math.abs(rack.position.y-rackY)>.1,'Support height edits reflow physical transfer elevations.');
  if(process.env.RACK_DIAGNOSTICS)console.log(JSON.stringify({rootPosesBefore:{source:sourcePose.toArray(),rack:rackPose.toArray(),belt:beltPose.toArray()},rootPosesAfterHeight:{source:source.position.toArray(),rack:rack.position.toArray(),belt:belt.position.toArray()},rackFloorAfterHeight:rack.position.y-1,rackRootYBeforeHeight:rackY}));
  await f.editor.perform(()=>f.editor.historyStep('undo'));f.joined();assert.deepEqual(await f.document.serialize(),widened,'Undo restores height, neighbor poses and connections together.');
  await f.editor.perform(()=>f.editor.historyStep('undo'));f.joined();assert.deepEqual(await f.document.serialize(),original,'Undo restores rack geometry and both neighboring interfaces.');
  console.log('Connected rack inspector: actual width and support-height edits reflow Source/rack/conveyor port poses and undo geometry/links together.');
 }finally{f.close();}
}
async function run(){await authoring();await flow('pallet-flow');await flow('carton-flow');await robots();await reflow();}
module.exports={authoring,flow,robots,reflow};if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
