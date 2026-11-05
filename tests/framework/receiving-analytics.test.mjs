import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),THREE=require('three');
const source=fs.readFileSync(new URL('../../modules/logistica-industrial/practices/configurable/runtime/ReceivingAnalyticsBoard.js',import.meta.url),'utf8').replace(/^import .*$/gm,'').replace('export default class ReceivingAnalyticsBoard','class ReceivingAnalyticsBoard').replace(/^export /gm,'');
const {createReceivingAnalyticsBoard,receivingAnalyticsModel,drawReceivingAnalytics,ReceivingAnalyticsBoard}=new Function('THREE',source+'\nreturn {createReceivingAnalyticsBoard,receivingAnalyticsModel,drawReceivingAnalytics,ReceivingAnalyticsBoard};')(THREE);
const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);Object.values(value).forEach(freeze);}return value;};
function snapshot(){return{prepared:false,materialBalance:{expectedUnits:48,expectedPallets:6,actualUnits:48},criticalReasons:[],ledger:{inspections:{},registrations:{},closed:false},pallets:Array.from({length:6},(_,index)=>({id:'p'+index,sku:'SKU-'+index,productSku:'ABC-'+index,units:8,massKg:60,inSource:true,inReleased:false,inQuarantine:false,inInspection:false,held:false}))};}
const manifest={practiceId:'CEDI-01',expectedUnits:48,palletIds:['p0','p1','p2','p3','p4','p5'],receiving:{orderId:'ORD-048',dockAlias:'E02'}};
function drawing(){const labels=[];return{labels,fillRect(){},fillText(value){labels.push(value);}};}
function fixture(){
 const scene=new THREE.Scene(),objects=new Map();let id=0,clock=0,reads=0;
 const document={addPrimitive(){const object=new THREE.Mesh(new THREE.BoxBufferGeometry(1,1,1),new THREE.MeshStandardMaterial());object.userData.editorId='custom-board-'+(++id);scene.add(object);objects.set(object.userData.editorId,object);return object;},setProperty(object,key,value){object[key]=value;},setTransform(object,value){if(value.position)object.position.fromArray(value.position);if(value.rotation)object.rotation.fromArray(value.rotation);if(value.scale)object.scale.fromArray(value.scale);},getObject(key){return objects.get(key);}};
 const contexts=[],dom={createElement(){const context=drawing();contexts.push(context);return{width:0,height:0,getContext:()=>context};}};
 const built=createReceivingAnalyticsBoard(document,'hall'),editor={document,ctx:{document:dom}},runtime=new ReceivingAnalyticsBoard(editor,Object.assign({},manifest,{receivingAnalytics:built}),{now:()=>clock});
 return{scene,objects,document,built,editor,runtime,contexts,setClock(value){clock=value;},read(){reads++;return snapshot();},get reads(){return reads;},dispose(){runtime.dispose();objects.forEach(object=>{object.geometry.dispose();object.material.dispose();});}};
}
test('receiving analytics begins with 6 physical pallets / 48 boxes and no invented inspection or delivery',()=>{
 const input=freeze(snapshot()),before=JSON.stringify(input),model=receivingAnalyticsModel(manifest,input);
 assert(model.available);assert.equal(model.physicalUnits,48);assert.equal(model.prepared,false);assert.deepEqual(model.metrics.map(row=>row.value),[0,0,0,0]);assert.equal(model.positions.find(row=>row.label==='En camión').units,48);assert(model.rows.every(row=>row.place==='En camión'&&!row.inspected&&!row.registered));assert.equal(JSON.stringify(input),before);
});
test('documentary registration never fabricates physical destination; ledger foreign ids ignored',()=>{
 const world=snapshot();world.prepared=true;world.pallets[0].inSource=false;world.pallets[0].held=true;world.ledger.inspections.p0={};world.ledger.registrations.p0={};world.ledger.inspections.foreign={};world.ledger.registrations.foreign={};
 let model=receivingAnalyticsModel(manifest,freeze(world));assert.equal(model.metrics.find(row=>row.label==='Registrados').value,1);assert.equal(model.metrics.find(row=>row.label==='En destino físico').value,0);assert.equal(model.positions.find(row=>row.label==='En traslado').units,8);assert(model.prepared);
 const deposited=JSON.parse(JSON.stringify(world));deposited.pallets[0].held=false;deposited.pallets[0].inReleased=true;model=receivingAnalyticsModel(manifest,freeze(deposited));assert.equal(model.metrics.find(row=>row.label==='En destino físico').value,1);assert.equal(model.positions.find(row=>row.label==='Entregado').units,8);assert.equal(model.positions.reduce((sum,row)=>sum+row.units,0),48);
});
test('inactive or unavailable receiving area reports reference/waiting state without fake zero measurements',()=>{
 const inactive=receivingAnalyticsModel({practiceId:'CEDI-02'},snapshot());assert(!inactive.available);assert.match(inactive.message,/no está activa/);assert.deepEqual(inactive.metrics,[]);
 const missing=receivingAnalyticsModel(manifest,null);assert(!missing.available);assert.match(missing.message,/Esperando/);assert.deepEqual(missing.positions,[]);
 const context=drawing();drawReceivingAnalytics(context,inactive);assert(context.labels.includes('RECEPCIÓN · ÁREA DE REFERENCIA'));assert(!context.labels.some(value=>/0 \/ 48/.test(value)));
});
test('board has two attached supports and native editable geometry without duplicate machine behaviors',()=>{
 const f=fixture();try{assert.equal(f.built.version,1);assert.equal(f.built.boardIds.length,1);assert.equal(f.built.objects.length,5);const owner=f.document.getObject(f.built.boardIds[0]);assert.deepEqual(owner.position.toArray(),[-26,3.15,-4.5]);assert.deepEqual(owner.scale.toArray(),[3.1,1.75,.14]);assert(f.built.objects.every(object=>!object.userData.editorBehaviors));assert.equal(f.runtime.entries.length,1);assert.equal(f.runtime.entries[0].plane.parent,owner);assert.equal(f.runtime.entries[0].canvas.width,1024);assert.equal(f.runtime.entries[0].canvas.height,576);}finally{f.dispose();}
});
test('screen refreshes at most 2 Hz, reads data lazily, and skips unchanged or invisible content',()=>{
 const f=fixture();try{assert(f.runtime.update(()=>f.read()));assert.equal(f.reads,1);assert.equal(f.runtime.draws,1);for(const time of [16,100,250,499]){f.setClock(time);assert.equal(f.runtime.update(()=>f.read()),false);}assert.equal(f.reads,1);f.setClock(500);assert.equal(f.runtime.update(()=>f.read()),false);assert.equal(f.reads,2);assert.equal(f.runtime.draws,1);const owner=f.document.getObject(f.built.boardIds[0]);owner.visible=false;f.setClock(1000);assert.equal(f.runtime.update(()=>f.read()),false);assert.equal(f.reads,2);owner.visible=true;f.setClock(1500);const changed=snapshot();changed.prepared=true;assert(f.runtime.update(changed));assert.equal(f.runtime.draws,2);assert(f.contexts[0].labels.includes('MUELLE VERIFICADO'));}finally{f.dispose();}
});
test('resource cleanup removes the transient plane and releases canvas/material/texture once',()=>{
 const f=fixture(),entry=f.runtime.entries[0],owner=entry.owner,events={geometry:0,material:0,texture:0};entry.plane.geometry.addEventListener('dispose',()=>events.geometry++);entry.plane.material.addEventListener('dispose',()=>events.material++);entry.texture.addEventListener('dispose',()=>events.texture++);f.runtime.dispose();f.runtime.dispose();assert.equal(entry.plane.parent,null);assert(!owner.children.includes(entry.plane));assert.equal(entry.canvas.width,0);assert.equal(entry.canvas.height,0);assert.deepEqual(events,{geometry:1,material:1,texture:1});assert.equal(f.runtime.update(snapshot()),false);f.dispose();
});
test('editor standby legend uses persisted native text geometry behind the live opaque display',()=>{
 const f=fixture(),schema=require('../../modules/logistica-industrial/contracts/behaviors'),legends=[];let id=0;
 try{
  const actualTransform=f.document.setTransform;f.document.setTransform=(object,value)=>{actualTransform(object,value);if(value.quaternion)object.quaternion.fromArray(value.quaternion);};
  f.document.setBehaviors=(object,value)=>{object.userData.editorBehaviors=value;};
  f.document.addIndustrialFloorPresentation=(roomId,descriptor)=>{schema.industrialFloor.normalize(descriptor);const object=schema.industrialFloor.createVisual(THREE,descriptor);object.userData.editorId='custom-legend-'+(++id);object.userData.editorDescriptor=descriptor;f.scene.add(object);legends.push(object);return object;};
  const created=createReceivingAnalyticsBoard(f.document,'hall');assert.equal(created.objects.length,6);assert.equal(legends.length,1);const legend=legends[0];assert.equal(legend.userData.editorDescriptor.texts.length,4);assert.equal(legend.userData.editorDescriptor.labels.length,4);assert.equal(legend.userData.editorBehaviors[0].enabled,false);
  const normal=new THREE.Vector3(0,1,0).applyQuaternion(legend.quaternion);assert(normal.distanceTo(new THREE.Vector3(0,0,1))<1e-6);legend.updateWorldMatrix(true,true);const bounds=new THREE.Box3().setFromObject(legend);assert(bounds.min.z>-4.5+.07);assert(bounds.max.z<-4.5+.14*.52,'Static title remains behind the runtime opaque screen; no overprinted legends.');
 }finally{for(const legend of legends)legend.traverse(node=>{if(node.geometry)node.geometry.dispose();if(node.material)node.material.dispose();});f.dispose();}
});

test('native imported board preserves text depth and clears the QC rack and forklift corridor',async()=>{
 const native=require('../support/load-practice-scenes.cjs')(),f=native.fixture(),reopened=native.fixture();
 try{
  const built=createReceivingAnalyticsBoard(f.document,'hall'),owner=f.document.getObject(built.boardIds[0]),legend=f.document.getObject(built.standby[0].objectId);
  assert.equal(legend.userData.editorDescriptor.floorY,0);
  f.scene.updateMatrixWorld(true);const panelBounds=new THREE.Box3().setFromObject(owner),legendBounds=new THREE.Box3().setFromObject(legend);
  assert(legendBounds.min.z>owner.position.z+.07);assert(legendBounds.max.z<owner.position.z+.14*.52);
  const rackRow=require('../../modules/logistica-industrial/practices/configurable/CediReceivingLayout.cjs').fixtures().find(row=>row[0]==='receiving-qc-rack-0'),rack=native.createIndustrialPrefab(rackRow[2],'catalogue:'+rackRow[3],rackRow[6]);
  rack.position.fromArray(rackRow[4]);rack.updateMatrixWorld(true);const rackBounds=new THREE.Box3().setFromObject(rack);assert(panelBounds.min.y>rackBounds.max.y+.09,'All live rows clear the QC shelf, not only its header.');
  const guard=require('../../modules/logistica-industrial/practices/configurable/CediReceivingLayout.cjs').workcells()[0].guardLine;
  const supports=built.objects.filter(object=>object.name.includes('Apoyo'));for(const support of supports){const bounds=new THREE.Box3().setFromObject(support);assert(rackBounds.min.z-bounds.max.z>.04,'Stand feet retain at least 4 cm clearance behind the QC rack.');assert(bounds.min.z>guard.coordinate+.14,'Stand feet stay inside the front guard rather than intersecting it.');assert(bounds.max.z<1.725-1,'The prior reversing corridor remains free of the monitor stand.');}
  rack.traverse(node=>{if(node.geometry)node.geometry.dispose();if(node.material)node.material.dispose();});
  const authored=await f.document.serialize();await reopened.document.load(authored);reopened.scene.updateMatrixWorld(true);const restoredLegend=reopened.document.getObject(built.standby[0].objectId),restoredBounds=new THREE.Box3().setFromObject(restoredLegend);assert(Math.abs(restoredBounds.max.z-legendBounds.max.z)<1e-7,'Save/reopen retains the exact native legend offset.');
 }finally{native.releaseGeometry(f);native.releaseGeometry(reopened);}
});

test('live screen hides only its native standby content and restores visibility without authoring changes',async()=>{
 const native=require('../support/load-practice-scenes.cjs')(),f=native.fixture();let runtime;
 try{
  const built=createReceivingAnalyticsBoard(f.document,'hall'),legend=f.document.getObject(built.standby[0].objectId),content=legend.children[0],authored=await f.document.serialize(),history=f.document.undoStack.length;
  const editor={document:f.document,ctx:{document:{createElement(){return{width:0,height:0,getContext:()=>drawing()};}}}};
  runtime=new ReceivingAnalyticsBoard(editor,Object.assign({},manifest,{receivingAnalytics:built}));assert.equal(legend.visible,true);assert.equal(content.visible,false);assert.equal(runtime.entries[0].legends.length,1);runtime.update(snapshot());
  assert.deepEqual(await f.document.serialize(),authored,'Even saving during a live display preserves native visibility, descriptors and contents.');assert.equal(f.document.undoStack.length,history);
  runtime.dispose();runtime.dispose();assert.equal(content.visible,true);assert.deepEqual(await f.document.serialize(),authored);
  legend.visible=false;content.visible=false;runtime=new ReceivingAnalyticsBoard(editor,Object.assign({},manifest,{receivingAnalytics:built}));runtime.dispose();assert.equal(legend.visible,false);assert.equal(content.visible,false,'A deliberately hidden authored legend is not forced visible.');
  legend.visible=true;content.visible=true;const noCanvas={document:f.document,ctx:{document:{createElement(){return{getContext:()=>null};}}}};runtime=new ReceivingAnalyticsBoard(noCanvas,Object.assign({},manifest,{receivingAnalytics:built}));assert.equal(runtime.entries.length,0);assert.equal(content.visible,true,'An unavailable display never hides its editor fallback.');
 }finally{if(runtime)runtime.dispose();native.releaseGeometry(f);}
});
