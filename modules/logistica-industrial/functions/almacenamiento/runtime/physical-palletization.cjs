'use strict';

// Opt-in custody assembly. Cartons are the actual products deposited by the
// robot; only the declared finite stock of empty pallets is materialized.
function attach(api, record) {
 const c=record.components.palletQueue;if(!c.config.palletize)return;
 c.assembly={created:0,completed:0,retryAt:0,hidden:[]};
 record.object.traverse(object=>{if(object.userData.industrialPalletWoodSize){c.assembly.hidden.push({object,visible:object.visible});object.visible=false;}});
}
function ensure(THREE,api,record) {
 const runtime=api.runtime,c=record.components.palletQueue,pallet=c.pallets[0];
 if(!c.assembly||pallet.assemblyProduct||pallet.items.length||c.assembly.created>=c.config.palletizeLimit||runtime.time<c.assembly.retryAt)return;
 const downstream=runtime.records.get(c.config.outputId);
 if(downstream&&downstream.components.conveyor&&(downstream.components.conveyor.packages.length||api.runtime.singleLoadMechanism(downstream.components.conveyor)&&downstream.components.conveyor.mechanismPhase!=='ready'))return;
 const config=c.config,base=api.runtime.sourceRuntime,dimensions=api.dimensions(config),spec={id:'empty-pallet',name:'Pallet vacío de paletizado',type:'pallet',variant:config.palletMaterial==='plastic'?'pallet-plastic':'pallet-euro',width:config.width,depth:config.depth,height:config.palletHeight,mass:.01,base:'runners',units:1},
 load={loadMode:'individual',physicalAssembly:true,palletType:config.palletType,palletMaterial:config.palletMaterial,palletTare:dimensions.tare},object=base.createVisual(spec,load);
 object.name='Pallet físico '+(c.assembly.created+1)+' de '+config.palletizeLimit;
 Object.assign(object.userData,{editorRuntimeHelper:true,editorCollisionBody:true});c.helper.add(object);
 const item={mesh:object,beltId:null,box:new THREE.Box3(),previous:new THREE.Box3(),swept:new THREE.Box3()},product=runtime.registerProduct(object,null,item);
 item.product=product;item.bounds=product.bounds;item.scale=product.scale;
 pallet.object.updateWorldMatrix(true,false);const matrix=new THREE.Matrix4().compose(pallet.object.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0,.005,0)),pallet.object.getWorldQuaternion(new THREE.Quaternion()),pallet.object.getWorldScale(new THREE.Vector3()));
 runtime.setProductMatrix(product,matrix);
 if(!base.canPlace(record,product.bounds,matrix,product)){runtime.disposePackage(item);c.assembly.retryAt=runtime.time+.5;return;}
 const entry={id:record.id+':'+runtime.runSequence+':pallet'+(++c.assembly.created),originId:record.id,ownerId:record.id,spec,load,units:0,lineage:[record.id],product};
 product.sourceEntry=entry;product.palletAssemblyIncomplete=true;product.scale.copy(object.getWorldScale(new THREE.Vector3()));
 Object.assign(object.userData,{sourceProductId:entry.id,sourceOriginId:record.id,sourceUnits:0,sourceLineage:entry.lineage.slice()});
 if(object.userData.sourceProduct)object.userData.sourceProduct.units=0;
 item.sourceEntry=entry;item.box.copy(product.bounds).applyMatrix4(matrix);item.previous.copy(item.box);item.swept.copy(item.box);
 pallet.assemblyProduct=product;pallet.sealed=false;base.entries.add(entry);runtime.invalidateCollision(object);
 const target=runtime.records.get(config.outputId);if(target&&target.components.conveyor)runtime.setVariable(target.id,'running',false);
}
function seal(THREE,api,record) {
 const runtime=api.runtime,c=record.components.palletQueue,pallet=c.pallets[0];
 if(!c.assembly||pallet.sealed||!pallet.assemblyProduct||!api.bayFull(c,0))return;
 const aggregate=pallet.assemblyProduct,entry=aggregate.sourceEntry,members=c.queue.filter(value=>value.product&&value.product.item.palletIndex===0);
 if(members.length!==c.config.capacity||members.some(value=>value.product.heldBy||value.product.vehicleOwnerId||value.product.robotOwnerId||value.product.robotReservedBy||value.product.vehicleReservedBy))return;
 aggregate.object.updateWorldMatrix(true,true);const inverse=new THREE.Matrix4().getInverse(aggregate.object.matrixWorld),bounds=aggregate.bounds.clone();
 for(const member of members){
  const product=member.product;product.object.updateWorldMatrix(true,true);const matrix=product.object.matrixWorld.clone();
  runtime.processorRuntime.remember(product);runtime.processorRuntime.unregister(product);api.removeItem(c,product);
  c.queue.splice(c.queue.indexOf(member),1);runtime.sourceRuntime.entries.delete(member);member.ownerId=entry.id;
  runtime.processorRuntime.archive.set(member.id,product);product.palletAssemblyOwner=entry.id;
  aggregate.object.add(product.object);runtime.setProductMatrix(product,matrix);product.object.visible=true;
  product.object.userData.sourcePalletAssemblyMember=entry.id;
  bounds.union(product.bounds.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,matrix)));
 }
 entry.members=members;entry.units=members.reduce((sum,member)=>sum+member.units,0);
 aggregate.bounds.copy(bounds);aggregate.item.bounds=aggregate.bounds;aggregate.palletAssemblyIncomplete=false;
 Object.assign(aggregate.object.userData,{sourceUnits:entry.units,sourceMemberIds:members.map(member=>member.id),productUnits:entry.units});
 if(aggregate.object.userData.sourceProduct)aggregate.object.userData.sourceProduct.units=entry.units;
 const item=aggregate.item;Object.assign(item,{palletOwnerId:record.id,palletSide:'queue',palletIndex:0,palletSlot:0,sourceEntry:entry,stackHeight:bounds.max.y-bounds.min.y});
 item.box.copy(bounds).applyMatrix4(aggregate.object.matrixWorld);item.previous.copy(item.box);item.swept.copy(item.box);
 c.queue.push(entry);c.items.push(item);pallet.items.push(item);pallet.full=true;pallet.sealed=true;c.assembly.completed++;
 runtime.invalidateCollision(record.object);runtime.invalidateCollision(aggregate.object);
 runtime.event(record.id,'pallet-built','Pallet completo: '+entry.units+' unidades; mismas cajas y tara incluida.');
}
function dispatch(THREE,api,record) {
 const runtime=api.runtime,c=record.components.palletQueue,pallet=c.pallets[0],product=pallet.assemblyProduct,entry=product&&product.sourceEntry,target=runtime.records.get(c.config.outputId),belt=target&&target.components.conveyor;
 if(!pallet.sealed||!product||!entry||!belt)return false;
 if(!belt.enabled||!belt.powered||belt.paused||belt.emergency)return false;
 const offset=-runtime.pathLength(belt.config)/2,item=Object.assign({},product.item,{bounds:product.bounds,scale:product.scale,route:'main',lateral:0}),matrix=runtime.packageMatrix(target,belt,offset,item);
 product.object.updateWorldMatrix(true,true);const actual=product.object.getWorldPosition(new THREE.Vector3()),desired=new THREE.Vector3().setFromMatrixPosition(matrix),a=product.object.getWorldQuaternion(new THREE.Quaternion()),b=new THREE.Quaternion();matrix.decompose(new THREE.Vector3(),b,new THREE.Vector3());
 // A physical handoff is only valid at the adjoining conveyor inlet. Do not
 // transport a completed pallet across a room merely because IDs are linked.
 if(actual.distanceTo(desired)>.035||1-Math.abs(a.dot(b))>.001){c.blocked=true;return false;}
 if(!runtime.captureProduct(product,{record:target,belt,offset,lateral:0,route:'main'})){c.blocked=true;return false;}
 runtime.sourceRuntime.remove(record,entry,'pallet físico completo',c.inventory);api.removeItem(c,product);pallet.assemblyProduct=null;pallet.sealed=false;c.dispatchedPallets++;runtime.setVariable(target.id,'running',true);return true;
}
function dispose(runtime,product) {
 const entry=product&&product.sourceEntry;if(!entry||!entry.load||!entry.load.physicalAssembly)return;
 for(const member of entry.members||[]){const child=member.product||member.archivedProduct;if(!child)continue;
  if(child.record&&!runtime.stopping){child.object.updateWorldMatrix(true,true);const matrix=child.object.matrixWorld.clone(),root=runtime.document.getRoot(runtime.roomId);root.add(child.object);runtime.setProductMatrix(child,matrix);runtime.processorRuntime.consume(member);}
  else {runtime.processorRuntime.archive.delete(member.id);member.ownerId='';member.product=null;}
 }
}
function stop(api,record){const c=record.components.palletQueue;if(c.assembly)c.assembly.hidden.forEach(row=>row.object.visible=row.visible);}
module.exports={attach,ensure,seal,dispatch,dispose,stop};
