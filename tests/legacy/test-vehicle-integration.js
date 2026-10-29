const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),THREE=require('three');
const h=require('./test-vehicle-storage.js'),schema=require('../../modules/logistica-industrial/contracts/behaviors.js'),products=require('../../modules/logistica-industrial/functions/flujo-materiales/schema/product-equipment.js'),{Runtime}=require('./test-robot-runtime.js');
const VehicleRuntime=require('../support/load-vehicle-runtime.js')(THREE),SourceRuntime=require('../support/load-product-source-runtime.js')(THREE,schema),{ProjectStore}=require('../../apps/api/server/storage.js'),{validateDocument}=require('../../apps/api/server/validation.js'),{authoredHex}=require('../support/material-test-colors.js');
async function run(){await h.run();const doc=h.setup(),objects=[];
  const legacy=doc.addPrefab('hall','product'),legacyBefore=doc.captureObject(legacy);
  for(const definition of products.VARIANTS){const object=doc.addPrefab('hall','product',definition.id);doc.setTransform(object,{position:[objects.length*4,0,5]});objects.push(object);assert.equal(doc.getBehaviors(object).find(value=>value.type==='product').variant,definition.id);}
  const pick=objects.find(object=>doc.getBehaviors(object).some(config=>config.type==='product'&&config.variant==='pallet-loaded'));
  const changed=objects[0],old=doc.getBehaviors(changed).find(value=>value.type==='product');doc.setBehaviors(changed,[Object.assign({},old,{width:.45,height:.4,depth:.55,color:'#185b89'})]);assert.equal(doc.getBehaviors(changed)[0].color,'#185b89');
  const drum=Object.assign(products.defaults('drum'),{type:'product',enabled:true,mass:65});doc.setBehaviors(changed,[drum]);assert.equal(doc.additions.get(changed.userData.editorId).descriptor.variant,'drum');
  assert.deepEqual(doc.captureObject(legacy),legacyBefore,'New cargo recipes do not replace or resize the existing legacy carton.');
  const actor=doc.addPrefab('hall','vehicle','forklift-electric-4w'),config=doc.getBehaviors(actor).find(value=>value.type==='vehicle');let paint;actor.traverse(node=>{if(!paint&&node.isMesh&&node.userData.industrialMaterialRole==='frame')paint=node.material;});assert(paint);assert.equal(authoredHex(paint.color),config.frameColor.slice(1));assert.equal(paint.userData.studioColorSpace,'linear');
  doc.setTransform(pick,{position:[0,0,1.68]});doc.setTransform(actor,{position:[0,0,0]});
  const source=doc.addPrefab('hall','source');doc.setBehaviors(source,doc.getBehaviors(source).map(value=>value.type==='source'?Object.assign({},value,{initialCount:1,autoGenerate:false,loadMode:'individual',productType:'reel',width:.7,height:.7,depth:.5,mass:65}):value));doc.setTransform(source,{position:[-5,1,0]});
  const root=doc.getRoot('hall'),scene=new THREE.Scene();scene.add(root);const ctx={scene,editor:{active:false},raycontrol:{states:{},addState(name,state){this.states[name]=state;},activateState(){},deactivateState(){}}};
  const runtime=new Runtime(ctx,doc);runtime.sourceRuntime=new SourceRuntime(runtime);runtime.vehicleRuntime=new VehicleRuntime(runtime);scene.updateMatrixWorld(true);runtime.start('hall');
  const product=runtime.products.get(pick);assert(product);assert.equal(runtime.productMetadata(product).mass,145);assert.equal(runtime.productMetadata(product).units,24);
  assert(runtime.vehicleRuntime.pickup(runtime.records.get(actor.userData.editorId)));assert.equal(runtime.productMetadata(product).mass,145);assert.equal(runtime.productMetadata(product).units,24);
  assert(product.vehicleOwnerId===actor.userData.editorId);assert(runtime.vehicleRuntime.productPockets(product),'Actual SceneDocument wrapper exposes pockets without copying metadata in test code.');
  const pallet=objects.find(object=>doc.getBehaviors(object).some(config=>config.variant==='pallet-euro'));assert.equal(runtime.productMetadata(runtime.products.get(pallet)).mass,25,'Empty pallet tare is not added twice.');
  const generated=runtime.records.get(source.userData.editorId).components.source.queue[0];assert.equal(generated.spec.type,'reel');assert.equal(runtime.productMetadata(generated.product).mass,65);assert(generated.product.object.userData.sourceProduct,'Source generates the real named cargo model.');
  runtime.stop();const saved=await doc.serialize();assert.doesNotThrow(()=>validateDocument(saved,value=>value));
  const copied=await doc.pasteObject(doc.captureObject(pick),'sound',1);assert.notEqual(copied.userData.editorId,pick.userData.editorId);assert.equal(doc.getBehaviors(copied)[0].units,24);
  const snapshot=await doc.serialize(),directory=fs.mkdtempSync(__layout.map(path.join(os.tmpdir(),'vehicle-integration-')));let store;
  try{store=new ProjectStore({dataDir:directory});const project=store.saveProject(null,{name:'Vehículos y productos',document:snapshot});assert.deepEqual(store.getProject(project.id).document,snapshot);}finally{if(store)store.close();assert.equal(path.dirname(__layout.map(path.resolve(directory))),__layout.map(path.resolve(os.tmpdir())));assert(path.basename(directory).startsWith('vehicle-integration-'));fs.rmSync(directory,{recursive:true,force:true});}
  assert.throws(()=>doc.addPrefab('hall','vehicle','unsupported-forklift'));assert.throws(()=>doc.addPrefab('hall','product','unsupported-cargo'));
  console.log('Vehicle/cargo integration: actual13 vehicle +17 product recipes, independent copy/model/size/paint edits, exact145kg24unit pickup and25kg tare, real Source cargo, legacy preservation and SQLite roundtrip passed.');}
run().catch(error=>{console.error(error);process.exitCode=1;});
