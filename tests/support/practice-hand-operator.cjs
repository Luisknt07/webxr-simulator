'use strict';
// Simulated hand input only: cargo placement, transforms and ownership are
// written exclusively by the native grab/sweep/release implementations.
module.exports=function handOperator(native,fixture,workflow){
 const runtime=fixture.runtime,THREE=native.THREE,hand=new THREE.Object3D();fixture.scene.add(hand);let ticks=0;
 const tick=()=>{native.advance(fixture,1/60);if(workflow&&workflow.update)workflow.update();ticks++;};
 const placed=()=>{const product=runtime.held.get(hand);return product&&product.object.getWorldPosition(new THREE.Vector3());};
 const move=position=>{
  const product=runtime.held.get(hand);if(!product)throw Error('Test hand does not own a load.');
  const wanted=new THREE.Vector3(...position),distance=product.holdDistance||.85,target=wanted.clone().add(new THREE.Vector3(0,.025,distance));
  for(let i=0;i<24000;i++){
   const delta=target.clone().sub(hand.position),length=delta.length();if(length<.0001){hand.position.copy(target);tick();break;}hand.position.add(delta.multiplyScalar(Math.min(1,.025/length)));tick();
  }
  const actual=placed();if(!actual||actual.distanceTo(wanted)>.08)throw Error('Physical hand path was blocked: '+(actual&&actual.toArray())+' -> '+wanted.toArray());
 };
 const pickup=product=>{
  product.object.updateWorldMatrix(true,true);const point=product.object.getWorldPosition(new THREE.Vector3());hand.position.copy(point).add(new THREE.Vector3(0,.025,.85));hand.quaternion.set(0,0,0,1);hand.updateWorldMatrix(true,true);
  if(!runtime.pickupProduct(product,hand,'squeeze'))throw Error('Native hand refused '+product.object.name);tick();return product;
 };
 const target=(record,product)=>{
  if(record.components.palletQueue){const desired=runtime.palletQueueRuntime.placement(record,product,[],record.object.getWorldPosition(new THREE.Vector3()));if(!desired)throw Error('Native receiving queue has no physical placement.');return new THREE.Vector3().setFromMatrixPosition(desired.matrix);}
  if(record.components.processor)return new THREE.Vector3().setFromMatrixPosition(runtime.sourceRuntime.frontMatrix(record,product.bounds,product.scale,record.components.processor.input.position));
  throw Error('Test target is not a native material receiver.');
 };
 const release=()=>{const product=runtime.held.get(hand);if(!product||!runtime.releaseProduct(product))throw Error('Native release refused material placement.');tick();return product;};
 const dispose=()=>{runtime.releaseHeldProducts(hand);if(hand.parent)hand.parent.remove(hand);};
 return{hand,pickup,move,target,release,dispose,stats:()=>({ticks,held:runtime.held.has(hand)})};
};
