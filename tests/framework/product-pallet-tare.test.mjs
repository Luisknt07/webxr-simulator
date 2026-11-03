import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),native=require('../support/load-practice-scenes.cjs')(),products=require('../../modules/logistica-industrial/functions/flujo-materiales/schema/product-equipment.js');
function authored(tare){
 const f=native.fixture(),object=f.document.addPrefab('hall','product','pallet-loaded');
 f.document.setBehaviors(object,f.document.getBehaviors(object).map(c=>c.type==='product'?Object.assign({},c,{mass:60,units:8},tare===undefined?{}:{palletTareKg:tare}):c));f.runtime.start('hall');native.advance(f,.1);
 const product=f.runtime.products.get(object),entry=f.runtime.sourceRuntime.entryForProduct(f.runtime.records.get(object.userData.editorId),product);return{f,object,product,entry};
}
test('legacy Euro tare stays25kg; an explicit20kg tare allocates eight5kg boxes without changing total mass or pallet geometry',()=>{
 const legacy=authored(),declared=authored(20);try{
  assert.equal(legacy.entry.load.palletTare,25);assert.equal(legacy.entry.spec.mass,35/8);
  assert.equal(declared.entry.load.palletTare,20);assert.equal(declared.entry.units,8);assert.equal(declared.entry.spec.mass,5);assert.equal(declared.f.runtime.productMetadata(declared.product).mass,60);
  const geometry=o=>{const values=[];o.traverse(mesh=>{if(mesh.geometry&&mesh.geometry.attributes.position)values.push(Array.from(mesh.geometry.attributes.position.array));});return values;};assert.deepEqual(geometry(declared.object),geometry(legacy.object));
 }finally{native.releaseGeometry(legacy.f);native.releaseGeometry(declared.f);}
});
test('tare is finite, typed, bounded by total load mass and survives the real document/API roundtrip',async()=>{
 for(const value of [-2,-.5,61,Infinity,'20'])assert.throws(()=>products.normalize({variant:'pallet-loaded',mass:60,palletTareKg:value}));
 for(const value of [-2,-.5,61,Infinity,'20'])assert.throws(()=>native.schema.normalizeBehaviors([{type:'product',variant:'pallet-loaded',mass:60,palletTareKg:value}]));
 const a=authored(20),next=native.fixture();try{
  const saved=native.validateDocument(await a.f.document.serialize(),value=>value);await next.document.load(saved);next.runtime.start('hall');native.advance(next,.1);const object=next.document.getObject(a.object.userData.editorId),product=next.runtime.products.get(object),entry=next.runtime.sourceRuntime.entryForProduct(next.runtime.records.get(object.userData.editorId),product);assert.equal(entry.load.palletTare,20);assert.equal(entry.spec.mass,5);assert.equal(next.runtime.productMetadata(product).mass,60);
 }finally{native.releaseGeometry(a.f);native.releaseGeometry(next);}
});
test('prepared receiving and raw-material fixtures retain their declared content masses',()=>{
 for(const id of ['CEDI-01','SF-01']){const f=native.fixture();try{const built=native.buildConfigurablePracticeScene(f.document,'hall',id,{scene:f.scene});f.runtime.start('hall');native.advance(f,.1);const w=new native.ConfigurablePracticeRuntime({simulation:f.runtime,document:f.document},built.manifest);for(const objectId of built.palletIds){const product=Array.from(f.runtime.products.values()).find(p=>p.record&&p.record.id===objectId),entry=product.sourceEntry;assert.equal(entry.load.palletTare,20);const contents=entry.spec.mass*entry.units;assert(Math.abs(contents-(id==='CEDI-01'?40:13.92))<1e-8);assert(Math.abs(f.runtime.productMetadata(product).mass-(contents+20))<1e-8);}w.dispose();}finally{native.releaseGeometry(f);}}
});
