import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),native=require('../support/load-practice-scenes.cjs')(),book=require('../../modules/logistica-industrial/practices/configurable/CediOperatingData.cjs');
const IDS=Array.from({length:5},(_,i)=>'CEDI-0'+(i+1)),activeTypes=new Set(['product','source','processor','palletQueue','vehicle','robot','conveyor','plc','sensor']);
const copy=value=>JSON.parse(JSON.stringify(value));
function visibleMeshes(root){const result=[];root.updateWorldMatrix(true,true);root.traverse(node=>{if(!node.isMesh||!node.geometry)return;for(let p=node;p;p=p.parent)if(!p.visible||p.userData.editorGeometryReplaced)return;result.push(node);});return result;}
function architecturalFingerprint(f,m){return m.facility.objects.map(row=>{const object=f.document.getObject(row.id||row.objectId);assert(object,'Persisted facility ID resolves to an actual object.');const b=new native.THREE.Box3().setFromObject(object),meshes=visibleMeshes(object);return{role:row.role,finish:row.finish,min:b.min.toArray(),max:b.max.toArray(),triangles:meshes.reduce((sum,m)=>sum+(m.geometry.index?m.geometry.index.count:m.geometry.attributes.position.count)/3,0)};}).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));}
function finish(f,w){if(w)w.dispose();if(f.runtime.active)f.runtime.stop();native.releaseGeometry(f);}
function start(f,id,cediData){const built=native.buildConfigurablePracticeScene(f.document,'hall',id,{scene:f.scene,...(cediData?{cediData}:{})});f.runtime.start('hall');native.advance(f,.1);const workflow=new native.ConfigurablePracticeRuntime({simulation:f.runtime,document:f.document},built.manifest);return{built,workflow};}
function stageBoxes(m){return m.practiceId==='CEDI-03'?m.operatingData.inventoryLocations.flatMap(row=>row.boxes):m.practiceId==='CEDI-04'||m.practiceId==='CEDI-05'?m.operatingData.outboundBoxes:m.operatingData.inboundBoxes;}
function actualSemanticBoxes(f,b){return b.productIds.flatMap(id=>{const stock=b.materialRecipe&&b.materialRecipe.stock.find(row=>row.objectId===id),object=f.document.getObject(id),data=stock&&stock.cediLoad||object.userData.cediLoad;return data&&data.boxes||[];});}
function handTransfer(operator,product,record){const from=product.object.getWorldPosition(new native.THREE.Vector3()),target=operator.target(record,product),height=Math.max(1.1,from.y);operator.pickup(product);operator.move([from.x,from.y,from.z+1.3]);operator.move([from.x,height,from.z+1.3]);operator.move([target.x,height,from.z+1.3]);operator.move([target.x,height,target.z]);operator.move(target.toArray());operator.release();assert.equal(product.sourceEntry.ownerId,record.id);}

test('all five CEDI worlds share actual 64×44 architecture and four open dock apertures while context never registers simulation stock',()=>{
 let reference;
 for(const id of IDS){const f=native.fixture();let w;try{
  const {built,workflow}=start(f,id);w=workflow;const m=built.manifest,s=w.snapshot(),fingerprint=architecturalFingerprint(f,m);
  assert.deepEqual(m.facility.bounds,{minX:-32,maxX:32,minZ:-22,maxZ:22,height:9.2,floorY:0});if(reference)assert.deepEqual(fingerprint,reference,id+' shares geometry, rather than a differently labelled warehouse.');else reference=fingerprint;
  const docks=m.facility.openings.filter(row=>/^(REC|DES)-/.test(row.id));assert.deepEqual(docks.map(row=>row.id),['REC-01','REC-02','DES-01','DES-02']);
  const meshes=m.facility.objects.flatMap(row=>visibleMeshes(f.document.getObject(row.id||row.objectId)));
  for(const dock of docks)for(const y of [1.5,3.5])assert.equal(new native.THREE.Raycaster(new native.THREE.Vector3(dock.center,y,21.5),new native.THREE.Vector3(0,0,1),0,1).intersectObjects(meshes,false).length,0,id+' dock '+dock.id+' has a physical opening.');
  assert(new native.THREE.Raycaster(new native.THREE.Vector3(-10,1.5,21.5),new native.THREE.Vector3(0,0,1),0,1).intersectObjects(meshes,false).length>0,'The same query detects the real wall between apertures.');
  for(const objectId of new Set(m.cediContext.entries.flatMap(row=>row.objectIds))){const object=f.document.getObject(objectId);assert(object);assert(!f.document.getBehaviors(object).some(row=>activeTypes.has(row.type)));const record=f.runtime.records.get(objectId);assert(!record||!Object.keys(record.components).some(key=>activeTypes.has(key)));}
  assert.equal(m.cediContext.simulationActors,0);assert.deepEqual(s.criticalReasons,[],id);if(s.materialBalance.foreignIds)assert.deepEqual(s.materialBalance.foreignIds,[]);
  if(id==='CEDI-04'||id==='CEDI-05'){const vehicle=f.document.getObject(built.vehicleIds[0]),target=id==='CEDI-04'?f.document.getObject(m.aliases.find(row=>row.alias==='E04').objectId):f.document.getObject(built.productIds[0]),forward=new native.THREE.Vector3(0,0,1).applyQuaternion(vehicle.quaternion).setY(0).normalize(),towards=target.getWorldPosition(new native.THREE.Vector3()).sub(vehicle.getWorldPosition(new native.THREE.Vector3())).setY(0).normalize();assert(forward.dot(towards)>.99,id+' the actual vehicle heading faces its first native pickup, not a 2π-composed pose.');}
  assert.equal(s.totalUnits,m.expectedUnits);assert.equal(s.stageEvidence.length,0);assert.equal(s.finalizedUnits||s.receiverUnits,0);const count=f.runtime.products.size;native.advance(f,.25);assert.equal(f.runtime.products.size,count,'Context cannot generate additional loads.');assert.deepEqual(w.snapshot().criticalReasons,[]);
 }finally{finish(f,w);}}
});

test('default and edited SKU data become the actual finite products of every CEDI stage, including custom native mass',()=>{
 for(const custom of [false,true])for(const id of IDS){const f=native.fixture();let w;try{
  const data=book.defaults();if(custom){data.products[0].unitMassKg=2;data.products[1].unitMassKg=3;data.products[2].unitMassKg=2;data.products[1].color='#2255aa';data.products[1].width=.28;data.inboundOrders[0].lotId='LOT-CUSTOM';}
  const {built,workflow}=start(f,id,data);w=workflow;const m=built.manifest,actual=actualSemanticBoxes(f,built),expected=stageBoxes(m);
  assert.deepEqual(m.settings.cediData,book.normalize(data));assert.equal(actual.length,expected.length,id+' every finished carton has semantic identity.');assert.equal(new Set(actual.map(row=>row.boxId)).size,actual.length);assert.deepEqual(actual.map(row=>row.boxId).sort(),expected.map(row=>row.boxId).sort());
  for(const source of actual){const declared=expected.find(row=>row.boxId===source.boxId);assert.deepEqual(source,declared,id+' actual content must preserve lot, SKU, profile and order data.');}
  for(const objectId of built.productIds){const product=Array.from(f.runtime.products.values()).find(row=>row.record&&row.record.id===objectId),stock=m.materialRecipe&&m.materialRecipe.stock.find(row=>row.objectId===objectId),semantic=stock&&stock.cediLoad||product.object.userData.cediLoad;if(!semantic)continue;const contents=semantic.boxes,total=contents.reduce((sum,row)=>sum+row.unitMassKg,0),metadata=f.runtime.productMetadata(product),pallet=metadata.loadMode==='pallet';assert(Math.abs(metadata.mass-(total+(pallet?20:0)))<1e-7,id+' native mass agrees with its real contents.');}
  assert.deepEqual(w.snapshot().criticalReasons,[],id+(custom?' edited':' default'));assert.equal(w.snapshot().totalUnits,m.expectedUnits);
 }finally{finish(f,w);}}
});

test('native source loads rest on real truck beds, floors or shelf surfaces instead of floating at documentary coordinates',()=>{
 for(const id of IDS){const f=native.fixture();let w;try{
  const {built,workflow}=start(f,id);w=workflow;const floorMeshes=built.manifest.facility.objects.filter(row=>row.role==='ground'||row.role==='floor').flatMap(row=>visibleMeshes(f.document.getObject(row.id||row.objectId)));
  for(const objectId of built.productIds){const product=Array.from(f.runtime.products.values()).find(row=>row.record&&row.record.id===objectId);assert(product);const entry=product.sourceEntry,owner=entry&&f.runtime.records.get(entry.ownerId);assert(owner&&owner.components.palletQueue,id+' every initial body has native custody.');const body=product.bounds.clone().applyMatrix4(product.object.matrixWorld),center=body.getCenter(new native.THREE.Vector3()),support=id==='CEDI-01'?f.document.getObject(built.manifest.receiving.truckId):owner.object,meshes=visibleMeshes(support).concat(floorMeshes),hits=new native.THREE.Raycaster(new native.THREE.Vector3(center.x,body.min.y+.03,center.z),new native.THREE.Vector3(0,-1,0),0,.08).intersectObjects(meshes,false),hit=hits.find(row=>row.point.y<=body.min.y+.012);assert(hit,id+' '+product.object.name+' has a real support surface.');assert(body.min.y-hit.point.y<=.016&&body.min.y-hit.point.y>=-.012,id+' physical assembly has only a millimetric contact gap.');}
 }finally{finish(f,w);}}
});

test('the six-row configurable reserve snapshot rests on both real rack beams at every occupied level',()=>{
 const f=native.fixture();try{
  const data=book.defaults();data.inventory=data.inventory.flatMap((row,index)=>[{...row,quantity:4,locationCode:book.LOCATION_CODES[index*2]},{...row,quantity:4,locationCode:book.LOCATION_CODES[index*2+1]}]);data.capacities.palletPositions=12;
  const built=native.buildConfigurablePracticeScene(f.document,'hall','CEDI-02',{scene:f.scene,cediData:data}),context=built.manifest.cediContext;f.scene.updateMatrixWorld(true);const meshes=Array.from(new Set(context.entries.flatMap(row=>row.objectIds))).flatMap(id=>visibleMeshes(f.document.getObject(id)));
  assert.equal(context.inventory.length,6);for(const stock of context.inventory){const entry=context.entries.find(row=>row.key===stock.contextKey),bottom=entry.bounds.min[1];for(const side of [-1,1]){const origin=new native.THREE.Vector3(stock.position[0],bottom+.001,stock.position[2]+side*.32),hits=new native.THREE.Raycaster(origin,new native.THREE.Vector3(0,-1,0),0,.03).intersectObjects(meshes,false),hit=hits.find(row=>row.point.y<bottom-.001);assert(hit,stock.locationCode+' has support beneath both actual pallet runners.');assert(Math.abs(bottom-hit.point.y-.005)<.002,'Context stock uses the actual shelf height, including the next level.');}}
 }finally{finish(f);}
});

test('edited CEDI data and semantic source identities survive actual validation/save/reload without adding active context',async()=>{
 const f=native.fixture(),next=native.fixture();let w;try{
  const data=book.defaults();data.products[0].unitMassKg=2;data.products[1].unitMassKg=3;const b=native.buildConfigurablePracticeScene(f.document,'hall','CEDI-03',{scene:f.scene,cediData:data}),saved=native.validateDocument(await f.document.serialize(),value=>value);await next.document.load(saved);const m=next.document.studio.moduleData['sector.logistics-industrial'].levels[0];
  assert.deepEqual(m.settings.cediData,book.normalize(data));assert.deepEqual(m.operatingData,b.manifest.operatingData);assert.deepEqual(m.materialRecipe.stock,b.manifest.materialRecipe.stock);next.runtime.start('hall');native.advance(next,.1);w=new native.ConfigurablePracticeRuntime({simulation:next.runtime,document:next.document},m);assert.deepEqual(w.snapshot().criticalReasons,[]);assert.equal(w.observe().entries.length,24);assert.equal(next.runtime.products.size,24);
 }finally{finish(f);finish(next,w);}
});

for(const custom of [false,true])test('CEDI-03 '+(custom?'edited-mass':'default')+' mixed orders are completed through twelve real native hand transfers; twelve cartons remain in rack',{timeout:120000},()=>{
 const f=native.fixture();let w,operator;try{
  const data=book.defaults();if(custom){data.products[0].unitMassKg=2;data.products[1].unitMassKg=3;}
  const {built,workflow}=start(f,'CEDI-03',data);w=workflow;operator=require('../support/practice-hand-operator.cjs')(native,f,w);assert.equal(w.observe().entries.length,24);w.command('material-order',{orderId:built.materialRecipe.orderId,quantity:12});w.command('material-prepare',{method:'picking-por-sku'});
  let transferred=0;for(const order of built.manifest.operatingData.orders){const destination=built.materialRecipe.destinations.find(row=>row.orderId===order.id),record=f.runtime.records.get(destination.objectId);for(const box of order.boxes){const stock=built.materialRecipe.stock.find(row=>row.cediLoad.boxIds.includes(box.boxId)),product=w.product(stock.objectId);handTransfer(operator,product,record);transferred++;assert.equal(w.snapshot().stockSourceUnits,24-transferred);assert.deepEqual(w.observe().criticalReasons,[]);}assert.equal(w.pickingOrders(w.observe()).find(row=>row.orderId===order.id).correct,true);}
  w.command('material-inspect',{quantity:12,quality:'conforme'});w.command('material-close',{quantity:12});const result=w.snapshot();assert.equal(result.stockSourceUnits,12);assert.equal(result.receiverUnits,12);assert.equal(result.finalizedUnits,12);assert.equal(result.totalUnits,12);assert.deepEqual(result.materialBalance.actual,{box:24});assert.deepEqual(result.stageEvidence.map(row=>row.guard),['identify','prepare','operate','inspect','deliver','close']);assert.equal(f.runtime.products.size,24);assert(operator.stats().ticks>5000);
  const Session=require('../../modules/logistica-industrial/practices/schema/PracticeSession.cjs').PracticeSession,session=new Session({...built.manifest,evidenceAdapter:{kind:'workflow',requirements:built.manifest.stageBindings}},{snapshot:()=>w.snapshot()});for(const guard of ['identify','prepare','operate','inspect','deliver','close'])assert.equal(session.act(guard).accepted,true);assert.equal(session.state().passed,true);
 }finally{if(operator)operator.dispose();finish(f,w);}
});

test('CEDI-03 cannot inspect or complete twelve physically delivered cartons when their SKUs do not match the three orders',{timeout:120000},()=>{
 const f=native.fixture();let w,operator;try{
  const {built,workflow}=start(f,'CEDI-03');w=workflow;operator=require('../support/practice-hand-operator.cjs')(native,f,w);w.command('material-order',{orderId:built.materialRecipe.orderId,quantity:12});w.command('material-prepare',{method:'picking-por-sku'});
  // Correct total and genuine native custody, deliberately wrong mix: eight A
  // cartons and four B instead of each order's actual A/B/C lines.
  for(let i=0;i<12;i++){const product=w.product(built.materialRecipe.stock[i].objectId),record=f.runtime.records.get(built.receiverIds[Math.floor(i/4)]);handTransfer(operator,product,record);}
  assert.equal(w.processed(w.observe()),12);assert.equal(w.finalized(w.observe()),0);assert(w.pickingOrders(w.observe()).every(row=>!row.correct));assert.deepEqual(w.observe().criticalReasons,[],'A learner can recover a wrong allocation; it is not a missing-world condition.');
  assert.throws(()=>w.command('material-inspect',{quantity:12,quality:'conforme'}),/referencias|SKU/i);assert.throws(()=>w.command('material-close',{quantity:12}),/entrega|concilia/i);assert.equal(w.snapshot().stageEvidence.length,3);assert.equal(w.snapshot().stockSourceUnits,12);assert.equal(f.runtime.products.size,24);
 }finally{if(operator)operator.dispose();finish(f,w);}
});

test('CEDI-04 forms its first six-carton physical pallet through native hand paths and processor cycles without prematurely completing delivery',{timeout:120000},()=>{
 const f=native.fixture();let result;try{
  result=require('../support/prepare-packed-practice.cjs')(native,f,'CEDI-04');const {workflow,assembly,palletizer,built}=result,entry=assembly.sourceEntry,snapshot=workflow.snapshot(),metadata=f.runtime.productMetadata(assembly),leaves=f.runtime.processorRuntime.leaves([entry]);
  assert.equal(entry.units,6);assert.equal(entry.members.length,6);assert.equal(entry.ownerId,palletizer.id);assert(palletizer.components.palletQueue.queue.includes(entry));assert.equal(assembly.palletAssemblyIncomplete,false);assert.equal(new Set(entry.members.map(row=>row.id)).size,6);
  assert.equal(result.identities.length,6);assert.equal(new Set(result.identities).size,6);assert.deepEqual(snapshot.criticalReasons,[]);assert.deepEqual(snapshot.materialBalance.actual,{finished:12,carton:12,label:12});assert.equal(snapshot.materialBalance.conserved,true);
  assert(Math.abs(metadata.mass-(20+entry.members.reduce((sum,row)=>sum+row.spec.mass*row.units,0)))<1e-7);assert(metadata.mass>50&&metadata.mass<51,'The physical pallet includes the original 30 kg of contents, packaging and its 20 kg tare.');
  const originalIds=new Set(built.materialRecipe.stock.flatMap(row=>row.unitIds)),consumedIds=leaves.flatMap(row=>row.materialUnitIds||[]);assert.equal(consumedIds.length,18);assert.equal(new Set(consumedIds).size,18);assert(consumedIds.every(id=>originalIds.has(id)),'All six cartons retain their original finished item, carton and label identities.');
  assert.equal(snapshot.sourceUnits,4);assert.equal(snapshot.processedUnits,8);assert.equal(snapshot.receiverUnits,0);assert.equal(snapshot.finalizedUnits,0);assert.equal(snapshot.stageEvidence.length,1);assert.throws(()=>workflow.command('bom-close',{quantity:12}),/entrega|concili/i);assert(result.driver.frames>500);assert.equal(f.runtime.held.size,0);
 }finally{if(result){result.driver.dispose();result.workflow.dispose();}finish(f);}
});

test('CEDI-04 native mixed packing retains the individual 2/3/5 kg carton identities and colours inside the formed pallet',{timeout:120000},()=>{
 const f=native.fixture();let result;try{
  const data=book.defaults();data.products[0].unitMassKg=2;data.products[1].unitMassKg=3;data.products[1].color='#2255aa';data.products[1].width=.28;
  result=require('../support/prepare-packed-practice.cjs')(native,f,'CEDI-04',undefined,{cediData:data});const {assembly,built,workflow}=result,contents=built.manifest.operatingData.outboundBoxes,members=assembly.sourceEntry.members;
  assert.equal(members.length,6);assert.equal(new Set(members.map(row=>row.spec.operationState.boxId)).size,6);assert(new Set(members.map(row=>row.spec.mass)).size>1);
  for(const member of members){const state=member.spec.operationState,box=contents.find(row=>row.boxId===state.boxId);assert(box,'A produced carton retains a real operating-book identity.');assert.equal(state.productSku,box.sku);assert.equal(state.lotId,box.lotId);assert.equal(member.spec.color,box.color);const leaves=f.runtime.processorRuntime.leaves([member]),finished=leaves.find(leaf=>built.materialRecipe.stock.find(row=>row.sku===leaf.spec.id).material==='finished');assert.equal(finished.spec.mass,box.unitMassKg);assert(Math.abs(member.spec.mass-leaves.reduce((sum,row)=>sum+row.spec.mass*row.units,0))<1e-8);assert(member.spec.width>=box.width+.02-1e-8);assert(member.spec.depth>=box.depth+.02-1e-8);}
  assert(Math.abs(f.runtime.productMetadata(assembly).mass-20-members.reduce((sum,row)=>sum+row.spec.mass,0))<1e-8);assert.deepEqual(workflow.snapshot().criticalReasons,[]);assert.equal(workflow.snapshot().materialBalance.conserved,true);assert.equal(workflow.snapshot().receiverUnits,0);
 }finally{if(result){result.driver.dispose();result.workflow.dispose();}finish(f);}
});
