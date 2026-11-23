import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),THREE=require('three');
const {createCargoVisual}=require('../support/load-product-prefabs.js')(THREE);
const schema=require('../../modules/logistica-industrial/contracts/behaviors.js');
const study=require('../../modules/logistica-industrial/functions/presentacion/schema/equipment-study.js');

test('native source pallets and cartons retain a valid product behavior without confusing cargo type with behavior type',()=>{
 for(const [type,variant] of [['pallet','pallet-euro'],['box','box-medium'],['crate','crate'],['drum','drum']]){
  const spec={id:'regression-'+type,type,variant,width:1.2,height:type==='pallet'?.144:.4,depth:.8,mass:25};
  const cargo=createCargoVisual(spec,{loadMode:'individual'}),behavior=cargo.userData.editorDefaultBehaviors[0];
  assert.equal(behavior.type,'product');
  assert.equal(behavior.productType,type);
  assert.doesNotThrow(()=>schema.normalizeBehaviors([behavior]),'This metadata used to throw: Función de objeto no compatible: pallet');
  assert.equal(cargo.userData.sourceProduct.type,type);
  assert.equal(cargo.userData.sourceProduct.mass,25);
  assert.equal(cargo.userData.sourceProduct.sku,spec.id);
 }
});

test('study ancestry skips runtime loads while reaching the real authored machine and still validates authored data',()=>{
 const machine=new THREE.Group(),runtimePallet=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxBufferGeometry(),new THREE.MeshBasicMaterial());
 machine.userData.editorId='machine';machine.userData.editorBehaviors=[schema.defaultBehavior('conveyor')];
 // A stale runtime pallet from a previous session demonstrates the reported
 // exception, even though newly created products now carry valid metadata.
 runtimePallet.userData.editorDefaultBehaviors=[{type:'pallet'}];
 machine.add(runtimePallet);runtimePallet.add(mesh);
 let reads=0;
 const document={getObject:id=>id==='machine'?machine:null,getBehaviors(object){reads++;return schema.normalizeBehaviors(object.userData.editorBehaviors||object.userData.editorDefaultBehaviors||[]);}};
 assert.throws(()=>document.getBehaviors(runtimePallet),/no compatible: pallet/);
 reads=0;
 assert.equal(study.describe(mesh,document),null);
 assert.equal(study.describe(runtimePallet,document),null);
 assert.equal(reads,0,'Runtime meshes must not enter authored behavior validation.');
 assert.equal(study.describe(machine,document).type,'conveyor');
 assert.equal(reads,1);
 machine.userData.editorBehaviors=[{type:'invalid-authored-behavior'}];
 assert.throws(()=>study.describe(machine,document),/invalid-authored-behavior/,'The fix must preserve authored document validation.');
});
