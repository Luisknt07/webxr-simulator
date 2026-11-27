import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),file=path.resolve('tests/legacy/test-conveyor-mechanisms.js'),source=fs.readFileSync(file,'utf8'),{setup}=new Function('require','__dirname',source.slice(0,source.indexOf('async function run()'))+'\nreturn{setup};')(createRequire(file),path.dirname(file));
const T=require('three');
function fixture(spec={}){
 const f=setup(),object=f.document.addPrefab('hall','product',spec.variant||'box-small'),config=f.document.getBehaviors(object).find(c=>c.type==='product');f.document.setBehaviors(object,[{...config,mass:2,width:.3,depth:.3,height:.22,...spec}]);f.document.setTransform(object,{position:[0,1,0]});f.ctx.vrMode=true;f.ctx.camera=new T.PerspectiveCamera();f.ctx.camera.position.set(0,1.6,1);f.scene.add(f.ctx.camera);f.ctx.raycontrol.controllers=[];f.ctx.raycontrol.enabled=true;f.ctx.raycontrol.selectionEntries=()=>[];
 const hand=(side,x)=>{const controller=new T.Group(),grip=new T.Group();f.scene.add(controller,grip);controller.userData.gripObject=grip;const data={controller,inputSource:{handedness:side},enabled:true,desktop:false,active:false};f.ctx.raycontrol.controllers.push(data);const pose=(position,rotation=new T.Quaternion())=>{controller.position.fromArray(position);controller.quaternion.copy(rotation);grip.position.fromArray(position);grip.quaternion.copy(rotation);f.scene.updateMatrixWorld(true);};pose([x,1.1,0]);return{controller,grip,data,pose,down:()=>controller.dispatchEvent({type:'squeezestart'}),up:()=>controller.dispatchEvent({type:'squeezeend'})};};
 const left=hand('left',-.16),right=hand('right',.16);f.runtime.start('hall');f.runtime.bindProductGrip(left.data);f.runtime.bindProductGrip(right.data);const product=f.runtime.products.get(object),tick=(seconds=1/60)=>{for(let i=0;i<seconds*60;i++){f.scene.updateMatrixWorld(true);f.runtime.execute(1/60);}};return{...f,object,product,left,right,tick,close:()=>f.runtime.stop()};
}

test('controller grip picks by actual hand contact with no ray hit and follows wrist rotation without scaling',()=>{
 const f=fixture();try{f.left.controller.lookAt(0,1,5);f.left.down();assert.equal(f.product.heldBy,f.left.controller);const start=f.object.matrixWorld.clone(),scale=f.object.getWorldScale(new T.Vector3());f.left.pose([-.16,1.35,0],new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),Math.PI/2));for(let i=0;i<4;i++)f.tick();assert(f.object.getWorldQuaternion(new T.Quaternion()).angleTo(new T.Quaternion())>1);assert(f.object.getWorldPosition(new T.Vector3()).y>1.2);assert(f.object.getWorldScale(new T.Vector3()).distanceTo(scale)<1e-6);assert(!f.object.matrixWorld.equals(start));}finally{f.close();}
});
test('VR rays cannot retrieve remote cargo and loaded pallets or oversized masses are never hand-lifted',()=>{
 for(const spec of [{mass:35},{variant:'pallet-loaded',productType:'pallet',loadMode:'pallet',units:4,mass:33,width:1.2,depth:.8,height:.72}]){const f=fixture(spec);try{assert.equal(f.runtime.pickupProduct(f.product,f.left.controller,'squeeze'),false);assert.equal(f.product.heldBy,null);}finally{f.close();}}
 const f=fixture();try{f.left.pose([0,1.1,2]);assert.equal(f.product.stateEntry.state.isSelectable({distance:2},f.left.controller),false);f.left.down();assert.equal(f.product.heldBy,null);}finally{f.close();}
});
test('a heavy box stays on its support until both hands close; a two-hand rotation never stretches it',()=>{
 const f=fixture({mass:12,width:.5});try{f.left.pose([-.26,1.1,0]);f.right.pose([.26,1.1,0]);const initial=f.object.matrixWorld.clone();f.left.down();assert.equal(f.product.heldBy,null);assert(f.object.matrixWorld.equals(initial));f.right.down();assert.equal(f.product.directGrips.size,2);const scale=f.object.getWorldScale(new T.Vector3());f.left.pose([0,1.35,.26]);f.right.pose([0,1.35,-.26]);for(let i=0;i<5;i++)f.tick();assert(f.object.getWorldQuaternion(new T.Quaternion()).angleTo(new T.Quaternion())>1);assert(f.object.getWorldScale(new T.Vector3()).distanceTo(scale)<1e-6);f.left.up();assert.equal(f.product.heldBy,null);assert(!f.runtime.held.size);assert(f.product.freeMotion);}finally{f.close();}
});
test('a light box transfers to its remaining hand without jumping, then falls progressively and rests on the real floor',()=>{
 const f=fixture();try{f.left.down();f.right.down();assert.equal(f.product.directGrips.size,2);const before=f.object.matrixWorld.clone();f.left.up();assert.equal(f.product.heldBy,f.right.controller);f.tick();assert(new T.Vector3().setFromMatrixPosition(before).distanceTo(f.object.getWorldPosition(new T.Vector3()))<.003);f.right.up();const y=f.object.position.y;assert(y>.8);f.tick();assert(f.object.position.y<y&&f.object.position.y>y-.02);f.tick(2);const box=f.product.bounds.clone().applyMatrix4(f.object.matrixWorld);assert(Math.abs(box.min.y)<.01,box.min.y);assert.equal(f.product.freeMotion,null);}finally{f.close();}
});
test('swept contact prevents a rotated hand-held box from crossing a solid obstacle',()=>{
 const f=fixture();try{const wall=new T.Mesh(new T.BoxBufferGeometry(.08,3,3),new T.MeshBasicMaterial());wall.position.set(.6,1,0);f.root.add(wall);f.ctx.collisionWorld.invalidate(wall);f.left.down();f.left.pose([1.2,1.1,0],new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),.8));for(let i=0;i<30;i++)f.tick();const box=f.product.bounds.clone().applyMatrix4(f.object.matrixWorld);assert(box.max.x<=.565,box.max.x);assert(!f.ctx.collisionWorld.testBox(box,{ignore:[f.object,f.left.controller]}));}finally{f.close();}
});
test('cancelling the first hand or losing tracked pose cannot leave a latent two-hand pickup',()=>{
 const f=fixture({mass:12,width:.5});try{f.left.pose([-.26,1.1,0]);f.right.pose([.26,1.1,0]);f.left.down();f.left.up();assert.equal(f.runtime.manualProducts.pending.size,0);f.right.down();assert.equal(f.product.heldBy,null);}finally{f.close();}
});

test('a tracked whole-hand grasp is contact based, cancels tracking loss and requires fresh open fingers after a menu',()=>{
 const f=fixture();try{f.left.data.inputSource.hand=new Map();f.left.controller.userData.xrHandContact={valid:true,grasping:false};f.tick();f.left.controller.userData.xrHandContact.grasping=true;f.tick();assert.equal(f.product.heldBy,f.left.controller);assert.equal(f.product.holdInput,'grasp');f.ctx.publicDialogOpen=true;f.tick();assert.equal(f.product.heldBy,null);f.ctx.publicDialogOpen=false;f.tick();assert.equal(f.product.heldBy,null);f.left.controller.userData.xrHandContact.grasping=false;f.tick();const pos=f.product.bounds.getCenter(new T.Vector3()).applyMatrix4(f.object.matrixWorld);f.left.pose(pos.toArray());f.left.controller.userData.xrHandContact.grasping=true;f.tick();assert.equal(f.product.heldBy,f.left.controller);f.left.controller.userData.xrHandContact.valid=false;f.tick();assert.equal(f.product.heldBy,null);}finally{f.close();}
});
