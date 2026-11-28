import * as THREE from 'three';
import {productIdentity} from '../../../../modules/logistica-industrial/runtime/SimulationCheckpoint.js';
import {validPose} from './PresenceAvatar.js';

// Ephemeral visuals only. Durable queues, mass, custody, collisions and machine
// state still come from the host's authenticated Studio checkpoints/actions.
export default class RoomVisuals {
 constructor(studio){this.studio=studio;this.targets=new Map();this.sequence=0;this.lastSend=0;this.matrix=new THREE.Matrix4();this.scale=new THREE.Vector3();}
 clear(){this.targets.clear();this.lastSend=0;}
 receive(value){
  if(!value||!Number.isSafeInteger(value.sequence)||!Array.isArray(value.items)||value.items.length>8)return;
  for(const item of value.items){if(!item||!['p','v'].includes(item.kind)||typeof item.id!=='string'||item.id.length>200||!validPose(item))continue;
   const key=item.kind+':'+item.id,old=this.targets.get(key);if(old&&old.sequence>=value.sequence)continue;
   const pose={};if(item.kind==='v'&&item.pose&&typeof item.pose==='object')for(const name of ['lift','tilt','sideShift','reach','turret','steer'])if(Number.isFinite(item.pose[name])&&Math.abs(item.pose[name])<1000)pose[name]=item.pose[name];
   this.targets.set(key,{...item,pose,sequence:value.sequence,at:performance.now(),position:new THREE.Vector3().fromArray(item.position),quaternion:new THREE.Quaternion().fromArray(item.quaternion)});
  }
 }
 tick(delta=1/60){
  const studio=this.studio,room=studio.room,media=studio.roomMedia,runtime=studio.editor.simulation;if(!room||!runtime||!media||media.status!=='connected')return;
  const now=performance.now(),sample=(kind,id,object,pose)=>{object.updateWorldMatrix(true,false);const p=object.getWorldPosition(new THREE.Vector3()),q=object.getWorldQuaternion(new THREE.Quaternion()),round=n=>Math.round(n*10000)/10000;return{kind,id,position:p.toArray().map(round),quaternion:q.toArray().map(round),...(pose?{pose}: {})};};
  if(room.role==='host'){
   if(now-this.lastSend<100)return;this.lastSend=now;const items=[];for(const product of runtime.products.values()){if(items.length>=96)break;items.push(sample('p',productIdentity(product),product.object));}
   for(const record of runtime.records.values())if(record.components.vehicle)items.push(sample('v',record.id,record.object,{...record.components.vehicle.pose}));
   const sequence=++this.sequence;for(let i=0;i<items.length;i+=6){const sent=media.publish({sequence,items:items.slice(i,i+6)},'st.visual.v1');if(sent)sent.catch(()=>{});}return;
  }
  const products=new Map();runtime.products.forEach(p=>products.set(productIdentity(p),p));const alpha=1-Math.exp(-18*Math.min(.1,Math.max(0,delta)));
  for(const [key,target]of this.targets){
   if(now-target.at>2000){this.targets.delete(key);continue;}const product=target.kind==='p'?products.get(target.id):null,record=target.kind==='v'?runtime.records.get(target.id):null,object=product&&product.object||record&&record.object;
   if(!object||product&&product.heldBy)continue;object.updateWorldMatrix(true,false);const position=object.getWorldPosition(new THREE.Vector3()),quaternion=object.getWorldQuaternion(new THREE.Quaternion());if(position.distanceToSquared(target.position)>9)position.copy(target.position);else position.lerp(target.position,alpha);quaternion.slerp(target.quaternion,alpha);
   if(product){object.matrixWorld.decompose(new THREE.Vector3(),new THREE.Quaternion(),this.scale);runtime.setProductMatrix(product,this.matrix.compose(position,quaternion,this.scale));}
   else{object.position.copy(object.parent?object.parent.worldToLocal(position):position);if(object.parent)quaternion.premultiply(object.parent.getWorldQuaternion(new THREE.Quaternion()).inverse());object.quaternion.copy(quaternion);object.updateMatrix();if(runtime.vehicleRuntime)runtime.vehicleRuntime.applyPose(record,{...record.components.vehicle.pose,...target.pose},false);}
  }
 }
}
