import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),native=require('../support/load-practice-scenes.cjs')(),vehicles=require('../../modules/logistica-industrial/functions/montacargas/schema/vehicles.js');
function fixture(offset,width){
 const f=native.fixture(),built=native.buildConfigurablePracticeScene(f.document,'hall','CEDI-02',{scene:f.scene}),object=f.document.getObject(built.vehicleIds[0]),pallet=f.document.getObject(built.productIds[0]);
 const rows=f.document.getBehaviors(object);f.document.setBehaviors(object,rows.map(row=>row.type==='vehicle'?{...row,initialLift:.02232244,...(width?{width}:{})}:row));f.document.setTransform(object,{position:[pallet.position.x+offset,0,pallet.position.z+2],rotation:[0,Math.PI,0]});
 f.runtime.start('hall');native.advance(f,.1);return{f,built,record:f.runtime.records.get(built.vehicleIds[0]),product:f.runtime.products.get(pallet)};
}
test('the native reach truck physically clears a 1.20 m pallet at ±3–5 cm while both real fork pockets remain engaged',()=>{
 const report=[];
 for(const offset of [-.05,-.03,0,.03,.05]){
  const {f,record,product}=fixture(offset);try{
   const api=f.runtime.vehicleRuntime,rig=api.rig(record),c=record.components.vehicle.config,box=product.bounds.clone().applyMatrix4(product.object.matrixWorld),pockets=[-1,1].map(side=>api.pocketClearance(record,product,side));
   assert.equal(c.width,1.65);assert.equal(c.wheelbase,1.35);assert.equal(c.forkSpread,.48);assert(Math.abs(box.getSize(new native.THREE.Vector3()).x-1.2)<1e-6);assert(pockets.every(Boolean),'The tested displacement still fits both actual fork pockets.');
   assert.equal(api.carrierIntersects(record,product,product.object.matrixWorld),false,'No straddle steel or front roller may overlap the pallet at '+offset+' m.');
   const gap=c.width-2*.08-.13;assert(Math.abs(gap-1.36)<1e-8);assert(gap/2-1.2/2-Math.abs(offset)>.025);
   report.push({offset,width:c.width,palletWidth:box.getSize(new native.THREE.Vector3()).x,straddleInnerWidth:gap,minimumSideClearance:gap/2-.6-Math.abs(offset),pocketWidths:pockets.map(p=>p.widthM),forkHeel:rig.forks.getWorldPosition(new native.THREE.Vector3()).toArray(),wheelbase:c.wheelbase,carrierIntersects:false});
  }finally{f.runtime.stop();native.releaseGeometry(f);}
 }
 const narrow=fixture(.02,1.5);try{assert.equal(narrow.f.runtime.vehicleRuntime.carrierIntersects(narrow.record,narrow.product,narrow.product.object.matrixWorld),true,'An explicitly narrow existing 1.50 m truck retains its real 5 mm clearance and still rejects steel contact.');}finally{narrow.f.runtime.stop();native.releaseGeometry(narrow.f);}
 assert.equal(vehicles.defaults('reach-truck').width,1.65);
 const library=native.fixture();try{const object=library.document.addPrefab('hall','vehicle','catalogue:equipment.vehicle.reach-truck'),config=library.document.getBehaviors(object).find(row=>row.type==='vehicle');assert.equal(config.width,1.65);assert.equal(config.length,1.9);assert.equal(config.wheelbase,1.35,'Library insertion retains the same physical native reach chassis.');}finally{native.releaseGeometry(library);}
 fs.mkdirSync(new URL('../../data/qa-studio/practice-facilities/',import.meta.url),{recursive:true});fs.writeFileSync(new URL('../../data/qa-studio/practice-facilities/reach-straddle-native.json',import.meta.url),JSON.stringify({passed:true,source:'native CEDI-02 pallet and reach geometry; no altered collision tolerances',rows:report},null,2));
});
