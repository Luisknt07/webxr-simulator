import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),fixture=require('../support/public-demo-fixture.cjs');

test('the actual open workbench container fits twelve original bottles, refuses overfill and keeps exact mass and identities',()=>{
 const f=fixture({manual:true}),s=f.runtime,T=f.THREE;try{
  const container=s.products.get(f.built.packingBox),bottles=f.built.packingUnits.slice(0,12).map(o=>s.products.get(o)),extra=s.products.get(f.built.packingUnits[12]),population=s.products.size,originals=bottles.map(p=>p.object);
  assert.equal(s.manualProducts.capacity(container,bottles[0]),12);assert.equal(s.productMetadata(container).mass,.7);
  for(const product of [...bottles,extra]){const point=container.object.getWorldPosition(new T.Vector3());point.y+=.26;s.setProductMatrix(product,product.object.matrixWorld.clone().setPosition(point));const plan=s.manualProducts.packPlan(product);if(product===extra){assert.equal(plan,null,'A full box cannot accept an extra body.');break;}assert(plan);assert(s.manualProducts.pack(product,plan));}
  assert.equal(container.packing.items.size,12);assert.equal(s.productMetadata(container).units,12);assert(Math.abs(s.productMetadata(container).mass-4.9)<1e-8);assert.equal(s.products.size,population);assert.deepEqual([...container.packing.items.keys()].map(p=>p.object),originals);assert(bottles.every(p=>p.object.parent===container.object));
  const taken=bottles[0],position=taken.object.getWorldPosition(new T.Vector3());s.manualProducts.unpack(taken);assert.equal(taken.object.parent,f.document.getRoot('hall'));assert(taken.object.getWorldPosition(new T.Vector3()).distanceTo(position)<1e-8);assert.equal(s.productMetadata(container).units,11);assert(Math.abs(s.productMetadata(container).mass-4.55)<1e-8);assert.equal(s.productMetadata(taken).mass,.35);
  const before=bottles[1].object.getWorldPosition(new T.Vector3());const translated=container.object.matrixWorld.clone();translated.elements[12]+=.3;s.setProductMatrix(container,translated);assert(Math.abs(bottles[1].object.getWorldPosition(new T.Vector3()).x-before.x-.3)<1e-8);
  const q=new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),Math.PI/2),scale=container.object.getWorldScale(new T.Vector3());s.setProductMatrix(container,new T.Matrix4().compose(container.object.getWorldPosition(new T.Vector3()),q,scale));s.manualProducts.step(1/60);assert.equal(container.packing.items.size,0);assert(bottles.slice(1).every(p=>!p.packedInto&&p.freeMotion));
 }finally{f.close();}
});

test('an unpacked stock pallet keeps its actual native cargo bodies, mass balance and authored geometry through restart',()=>{
 const f=fixture({manual:true}),s=f.runtime,T=f.THREE;try{
  const pallet=[...s.products.values()].find(p=>p.item&&p.item.palletOwnerId&&!p.packing),before=s.productMetadata(pallet).mass,body=pallet.object,authored=new Set();body.traverse(n=>{let helper=false;for(let p=n;p;p=p.parent)if(p.userData.editorRuntimeHelper)helper=true;if(n.geometry&&!helper)authored.add(n.geometry);});let disposed=0;authored.forEach(g=>g.addEventListener('dispose',()=>disposed++));
  assert.equal(s.manualProducts.policy(pallet).allowed,false);s.manualProducts.expose(pallet);const members=pallet.sourceEntry.members.slice();assert.equal(members.length,4);assert.equal(s.productMetadata(pallet).mass,before);
  const member=members.find(m=>s.manualProducts.accessible(pallet,m.product)),object=member.product.object,world=object.getWorldPosition(new T.Vector3()),picked=s.manualProducts.detach(pallet,member);assert(picked);assert.equal(picked.object,object);assert(object.getWorldPosition(new T.Vector3()).distanceTo(world)<1e-8);assert.equal(pallet.sourceEntry.units,3);assert.equal(s.productMetadata(pallet).mass+s.productMetadata(picked).mass,before);assert.equal(s.productMetadata(picked).mass,2);
  s.stop();assert.equal(disposed,0,'Removing a carton cannot dispose authored pallet resources.');assert(object.parent);assert(body.getObjectById(object.id),'Original carton belongs to the original model again on stop.');s.start('hall');require('../../projects/smarttwin/PublicDemoStock.cjs')(T,s);const restored=s.products.get(body);assert.equal(s.productMetadata(restored).mass,before);assert.equal(s.productMetadata(restored).units,4);
 }finally{f.close();}
});

test('the real controller grip can insert a bottle, take the same bottle back out and drop another bottle into the open box under gravity',()=>{
 const f=fixture({manual:true}),s=f.runtime,T=f.THREE;try{
  f.ctx.vrMode=true;f.ctx.raycontrol.enabled=true;const controller=new T.Group(),grip=new T.Group();f.scene.add(controller,grip);controller.userData.gripObject=grip;const data={controller,inputSource:{handedness:'right'},enabled:true};f.ctx.raycontrol.controllers=[data];s.bindProductGrip(data);const box=s.products.get(f.built.packingBox),bottle=s.products.get(f.built.packingUnits[0]),pose=point=>{controller.position.copy(point);grip.position.copy(point);f.scene.updateMatrixWorld(true);};
  pose(bottle.object.getWorldPosition(new T.Vector3()).add(new T.Vector3(0,.10,0)));controller.dispatchEvent({type:'squeezestart'});assert.equal(bottle.heldBy,controller);
  pose(controller.position.clone().add(new T.Vector3(0,.4,0)));f.tick(.25);pose(box.object.getWorldPosition(new T.Vector3()).add(new T.Vector3(0,.36,0)));f.tick(.3);controller.dispatchEvent({type:'squeezeend'});assert.equal(bottle.packedInto,box);assert.equal(s.productMetadata(box).units,1);
  pose(bottle.bounds.getCenter(new T.Vector3()).applyMatrix4(bottle.object.matrixWorld));controller.dispatchEvent({type:'squeezestart'});assert.equal(s.held.get(controller),bottle,'The bottle inside is selected instead of the surrounding empty volume.');assert.equal(bottle.packedInto,null);assert.equal(s.productMetadata(box).units,0);controller.dispatchEvent({type:'squeezeend'});
  const other=s.products.get(f.built.packingUnits[1]),point=box.object.getWorldPosition(new T.Vector3()).add(new T.Vector3(.10,.65,.06));s.setProductMatrix(other,other.object.matrixWorld.clone().setPosition(point));s.manualProducts.fall(other);const y=other.object.position.y;f.tick(1/60);assert(other.object.position.y>y-.02);f.tick(1);assert.equal(other.packedInto,box);assert.equal(s.productMetadata(box).units,2);
 }finally{f.close();}
});

test('a produced pallet returns the original archived carton to manual custody without changing total mass or leaking selection states',()=>{
 const f=fixture(),s=f.runtime;try{
  for(let i=0;i<80&&!([...s.products.values()].some(p=>p.sourceEntry?.load?.physicalAssembly&&p.sourceEntry.units===4));i++)f.tick(2);
  const pallet=[...s.products.values()].find(p=>p.sourceEntry?.load?.physicalAssembly&&p.sourceEntry.units===4);assert(pallet,'Native robot must actually finish the pallet.');const mass=s.productMetadata(pallet).mass;s.manualProducts.expose(pallet);const member=pallet.sourceEntry.members.find(m=>s.manualProducts.accessible(pallet,m.product||m.archivedProduct)),original=member.product||member.archivedProduct,live=s.manualProducts.detach(pallet,member);assert.equal(live,original);assert.equal(live.object,original.object);assert(s.products.has(live.object));assert.equal(s.productMetadata(pallet).mass+s.productMetadata(live).mass,mass);assert.equal(pallet.sourceEntry.units,3);assert.equal(s.processorRuntime.archive.has(member.id),false);
  const proxies=[...s.manualProducts.proxies.values()].filter(row=>row.parent===pallet);assert.equal(proxies.length,3);s.products.delete(pallet.object);s.manualProducts.assemblyScanAt=0;s.manualProducts.poll();assert(proxies.every(row=>!s.manualProducts.proxies.has(row.product.object)&&!f.ctx.raycontrol.states[row.name]));s.products.set(pallet.object,pallet);
 }finally{f.close();}
});
