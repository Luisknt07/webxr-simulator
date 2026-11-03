import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),native=require('../support/load-practice-scenes.cjs')();

function setup({practice=true,roomId='hall',mass=60,units=8,loadMode='pallet',productType='pallet'}={}){
 const f=native.fixture(),object=f.document.addPrefab('hall','product'),config=f.document.getBehaviors(object).find(row=>row.type==='product');
 f.document.setBehaviors(object,[Object.assign({},config,{mass,units,loadMode,productType})]);
 f.document.setTransform(object,{position:[0,1.5,0]});
 if(practice)f.document.setStudio({moduleData:{'sector.logistics-industrial':{version:1,levels:[{roomId,plan:{kind:'configurable'}}]}}});
 f.runtime.start('hall');f.scene.updateMatrixWorld(true);const product=f.runtime.products.get(object),hand=new native.THREE.Group();f.scene.add(hand);hand.position.set(0,1.5,2);
 assert(product);return{...f,object,product,hand};
}

test('the same desktop/XR hand command cannot lift a loaded practice pallet or bypass its physical custody',()=>{
 const f=setup();try{
  const matrix=f.object.matrixWorld.toArray(),before={held:f.runtime.held.size,products:f.runtime.products.size,owner:f.product.vehicleOwnerId};
  assert.equal(f.runtime.productMetadata(f.product).mass,60);
  for(const input of ['select','squeeze'])assert.equal(f.runtime.pickupProduct(f.product,f.hand,input),false);
  assert.equal(f.product.heldBy,null);assert.equal(f.runtime.held.size,before.held);assert.equal(f.runtime.products.size,before.products);assert.equal(f.product.vehicleOwnerId,before.owner);assert.deepEqual(f.object.matrixWorld.toArray(),matrix);assert(f.notices.some(value=>/manutención/.test(value)));
 }finally{f.runtime.stop();native.releaseGeometry(f);}
});

test('practice picking still supports a light individual box and an empty pallet; heavy individual loads need equipment',()=>{
 for(const spec of [{mass:5,units:1,loadMode:'individual',productType:'box',allowed:true},{mass:20,units:1,loadMode:'pallet',productType:'pallet',allowed:true},{mass:35,units:1,loadMode:'individual',productType:'box',allowed:false}]){
  const f=setup(spec);try{assert.equal(f.runtime.pickupProduct(f.product,f.hand,'squeeze'),spec.allowed);assert.equal(f.runtime.held.size,spec.allowed?1:0);}finally{f.runtime.stop();native.releaseGeometry(f);}
 }
});

test('the practice-specific handling rule does not silently change saved legacy levels or another room',()=>{
 for(const spec of [{practice:false},{roomId:'another-room'}]){
  const f=setup(spec);try{assert.equal(f.runtime.pickupProduct(f.product,f.hand),true);}finally{f.runtime.stop();native.releaseGeometry(f);}
 }
});
