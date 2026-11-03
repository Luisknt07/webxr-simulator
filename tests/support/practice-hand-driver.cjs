'use strict';
const assert=require('node:assert/strict');
module.exports=function handDriver(native,f){
 const {THREE}=native,hand=new THREE.Group();f.scene.add(hand);let frames=0;
 const advance=seconds=>{native.advance(f,seconds);frames++;};
 function pose(product,position){hand.rotation.set(0,0,0);hand.position.set(position.x,position.y+.025,position.z+product.holdDistance);advance(.1);}
 function pathAtHeight(product,start,end){
  const world=f.ctx.collisionWorld,opts=f.runtime.productCollisionOptions(product,hand),basis=product.holdMatrix.clone(),box=p=>product.bounds.clone().applyMatrix4(basis.clone().setPosition(p)),free=(a,b)=>{const result=world.sweepBox(box(a),b.clone().sub(a),opts);return result.fraction>.99999&&!world.testBox(box(b),opts);};
  if(free(start,end))return[end];
  const step=.5,key=(x,z)=>x+','+z,open=[{x:0,z:0,p:start.clone(),cost:0,score:start.distanceTo(end),previous:null}],best=new Map([[key(0,0),0]]),visited=new Set();let count=0;
  while(open.length&&count++<6000){
   open.sort((a,b)=>b.score-a.score);const current=open.pop(),k=key(current.x,current.z);if(visited.has(k))continue;visited.add(k);
   if(current.p.distanceTo(end)<2.2&&free(current.p,end)){const result=[end];for(let p=current;p.previous;p=p.previous)result.unshift(p.p);return result;}
   for(const [dx,dz]of[[1,0],[-1,0],[0,1],[0,-1]]){const x=current.x+dx,z=current.z+dz,k=key(x,z),p=new THREE.Vector3(start.x+x*step,start.y,start.z+z*step),cost=current.cost+step;if(Math.abs(x)>60||Math.abs(z)>60||visited.has(k)||(best.has(k)&&best.get(k)<=cost)||!free(current.p,p))continue;best.set(k,cost);open.push({x,z,p,cost,score:cost+p.distanceTo(end),previous:current});}
  }
  throw Error('No collision-free controller route at '+start.y+'m, '+count+' nodes: '+start.toArray()+' -> '+end.toArray());
 }
 function move(product,matrix,exit,approach){
  const target=new THREE.Vector3().setFromMatrixPosition(matrix),start=product.object.getWorldPosition(new THREE.Vector3());
  // Controller input moves the existing held body. The native sweep remains
  // authoritative; this driver never writes a product pose or custody queue.
  const lift=Math.max(1.55,start.y,target.y)+.22,waypoints=[];
  if(exit){waypoints.push(start.clone().add(exit));start.add(exit);}
  const travel=target.clone().add(approach||new THREE.Vector3()),highStart=new THREE.Vector3(start.x,lift,start.z),highEnd=new THREE.Vector3(travel.x,lift,travel.z);
  waypoints.push(highStart,...pathAtHeight(product,highStart,highEnd),travel,target);
  for(const waypoint of waypoints){
   const current=product.object.getWorldPosition(new THREE.Vector3()),steps=Math.max(1,Math.ceil(current.distanceTo(waypoint)/.12));
   for(let n=1;n<=steps;n++)pose(product,current.clone().lerp(waypoint,n/steps));
  }
  const actual=product.object.getWorldPosition(new THREE.Vector3());assert(actual.distanceTo(target)<.55,'Held body obstructed before native receiver tolerance: '+actual.toArray()+' vs '+target.toArray());
 }
 function grab(product){product.object.updateWorldMatrix(true,true);const p=product.object.getWorldPosition(new THREE.Vector3());hand.position.set(p.x,p.y+.025,p.z+.3);hand.updateWorldMatrix(true,true);assert(f.runtime.pickupProduct(product,hand),'Native pickup rejected '+product.id);}
 function carry(product,matrix,approach){const owner=product.sourceEntry&&f.runtime.records.get(product.sourceEntry.ownerId),rack=owner&&owner.components.palletQueue&&owner.components.palletQueue.rack,exit=rack?new THREE.Vector3(0,0,1.3).applyQuaternion(owner.object.getWorldQuaternion(new THREE.Quaternion())):null;grab(product);move(product,matrix,exit,approach);const candidate=f.runtime.findProductPlacement(product,hand),debug=candidate&&{accepted:candidate.accepted,distance:candidate.distance,owner:candidate.record&&candidate.record.object.name,reason:candidate.reason};assert(f.runtime.releaseProduct(product),'Native release rejected '+product.sourceEntry.id+' '+JSON.stringify(debug)+' '+f.notices.slice(-2).join('; '));advance(.1);}
 function toProcessor(product,record){const matrix=f.runtime.sourceRuntime.frontMatrix(record,product.bounds,product.scale,record.components.processor.input.position),approach=new THREE.Vector3(-.6,0,0).applyQuaternion(record.object.getWorldQuaternion(new THREE.Quaternion()));carry(product,matrix,approach);assert.equal(product.sourceEntry.ownerId,record.id);assert(record.components.processor.input.queue.includes(product.sourceEntry)||record.components.processor.jobs.some(job=>job.inputs.includes(product.sourceEntry))||record.components.processor.output.queue.includes(product.sourceEntry));}
 function toQueue(product,record){const placement=f.runtime.palletQueueRuntime.placement(record,product,[],product.object.getWorldPosition(new THREE.Vector3()));assert(placement,'Queue has no physical placement');carry(product,placement.matrix,new THREE.Vector3(0,0,.7).applyQuaternion(record.object.getWorldQuaternion(new THREE.Quaternion())));const queue=record.components.palletQueue.queue,entry=product.sourceEntry,aggregate=queue.find(value=>value.members&&value.members.includes(entry));assert(queue.includes(entry)||aggregate,'The native receiver must own this same entry directly or inside its sealed pallet.');assert.equal(entry.ownerId,aggregate?aggregate.id:record.id);}
 return{hand,grab,move,carry,toProcessor,toQueue,advance,get frames(){return frames;},dispose(){hand.removeFromParent?hand.removeFromParent():hand.parent.remove(hand);}};
};
