import * as THREE from 'three';
import {acquireHuman,humanChoice} from './HumanAvatarAssets.js';
import XRHandMesh from '../../../render-three/src/XRHandMesh.js';
import {HAND_JOINTS,BODY_JOINTS} from './AvatarTracking.js';

const UP=new THREE.Vector3(0,1,0),vector=row=>new THREE.Vector3().fromArray(row);
// Only this remote skin is retargeted. Device input and collisions are untouched.
export function createAvatarRig(config={}){
 const root=new THREE.Group(),head=new THREE.Group(),torso=new THREE.Group(),hands={left:new THREE.Group(),right:new THREE.Group()};root.add(head,torso,hands.left,hands.right);
 const rig={root,head,torso,hands,status:'unselected',model:null,disposed:false,remoteHands:{},parts:new Map(),bones:new Map(),rest:new Map(),last:null};
 const choice=humanChoice(config),mode=['tracked','upper','complete'].includes(config.bodyMode)?config.bodyMode:'upper';
 const origin=new THREE.Vector3(),modified=new Set(),jointPosition=new THREE.Vector3(),jointRotation=new THREE.Quaternion(),one=new THREE.Vector3(1,1,1);
 const bone=name=>rig.bones.get('Bip01 '+name),relative=p=>p.clone().sub(origin);
 function setWorld(b,p,q){
  if(!b)return;b.parent.updateWorldMatrix(true,false);const parentInverse=new THREE.Matrix4().getInverse(b.parent.matrixWorld);
  if(p)b.position.copy(p.clone().applyMatrix4(root.matrixWorld).applyMatrix4(parentInverse));
  if(q){const world=root.getWorldQuaternion(new THREE.Quaternion()).multiply(q);b.quaternion.copy(b.parent.getWorldQuaternion(new THREE.Quaternion()).inverse().multiply(world));}modified.add(b);b.updateWorldMatrix(false,false);
 }
 function restPoint(b,yaw){return rig.rest.get(b).position.clone().applyQuaternion(yaw);}
 function aim(b,child,from,to,yaw){if(!b||!child)return;const axis=rig.rest.get(child).position.clone().sub(rig.rest.get(b).position).applyQuaternion(yaw).normalize(),direction=to.clone().sub(from).normalize();const q=new THREE.Quaternion().setFromUnitVectors(axis,direction).multiply(yaw.clone().multiply(rig.rest.get(b).quaternion));setWorld(b,from,q);}
 function show(part,visible){for(const mesh of rig.parts.get(part)||[])mesh.visible=visible;}
 function reset(){for(const b of modified){const r=rig.rest.get(b);b.position.copy(r.localPosition);b.quaternion.copy(r.localQuaternion);b.scale.copy(r.localScale);}modified.clear();rig.model.position.set(0,0,0);rig.model.quaternion.set(0,0,0,1);root.updateWorldMatrix(true,true);root.getWorldPosition(origin);}
 rig.ready=choice?acquireHuman(choice.id).then(resource=>{
  if(rig.disposed){resource.release();return;}rig.resource=resource;rig.model=resource.model;root.add(rig.model);root.updateWorldMatrix(true,true);
  rig.model.traverse(o=>{
   if(o.isBone){rig.bones.set(o.userData.name||o.name,o);rig.rest.set(o,{position:o.getWorldPosition(new THREE.Vector3()).sub(root.getWorldPosition(new THREE.Vector3())),quaternion:root.getWorldQuaternion(new THREE.Quaternion()).inverse().multiply(o.getWorldQuaternion(new THREE.Quaternion())),localPosition:o.position.clone(),localQuaternion:o.quaternion.clone(),localScale:o.scale.clone()});}
   if(o.isMesh){let parent=o;while(parent&&!parent.userData.avatarPart)parent=parent.parent;const part=parent&&parent.userData.avatarPart||o.name;if(!rig.parts.has(part))rig.parts.set(part,[]);rig.parts.get(part).push(o);}
  });
  if(!bone('Head')||!bone('L UpperArm')||!bone('R UpperArm'))throw Error('El modelo humano no tiene el esqueleto esperado.');
  rig.status='ready';if(rig.last)rig.update(rig.last);return rig;
 }).catch(error=>{if(rig.resource){rig.resource.release();rig.resource=null;}if(!rig.disposed){rig.status='error';rig.error='No se pudo cargar el avatar. Vuelve a elegirlo en Mi avatar.';}return rig;}):Promise.resolve(rig);
 if(choice)rig.status='loading';
 rig.update=state=>{
  rig.last=state;if(!rig.model||rig.status!=='ready')return;reset();
  const q=state.quaternion||new THREE.Quaternion(),euler=new THREE.Euler().setFromQuaternion(q,'YXZ'),yaw=new THREE.Quaternion().setFromAxisAngle(UP,euler.y),body=state.body&&state.body.joints;
  const joint=name=>{const row=body&&body[BODY_JOINTS.indexOf(name)];return row?relative(vector(row)):null;};
  const hips=joint('hips'),chest=joint('chest');let bodyRotation=yaw;
  const lShoulder=joint('left-arm-upper'),rShoulder=joint('right-arm-upper');
  if(lShoulder&&rShoulder){const across=rShoulder.clone().sub(lShoulder);if(across.length()>.12&&across.length()<.9)bodyRotation=new THREE.Quaternion().setFromAxisAngle(UP,Math.atan2(-across.z,across.x));}
  rig.model.quaternion.copy(bodyRotation);root.updateWorldMatrix(true,true);
  if(hips&&chest&&hips.distanceTo(chest)>.15&&hips.distanceTo(chest)<.9){
   bodyRotation=new THREE.Quaternion().setFromUnitVectors(UP,chest.clone().sub(hips).normalize()).multiply(bodyRotation);
   for(const name of ['Pelvis','Spine','Spine1','Spine2']){const b=bone(name),rest=rig.rest.get(b),a=(rest.position.y-rig.rest.get(bone('Pelvis')).position.y)/Math.max(.01,rig.rest.get(bone('Spine2')).position.y-rig.rest.get(bone('Pelvis')).position.y),p=hips.clone().lerp(chest,Math.max(0,Math.min(1,a)));setWorld(b,p,bodyRotation.clone().multiply(rest.quaternion));}
  }
  const h=bone('Head'),headRest=rig.rest.get(h);setWorld(h,headRest.position.clone().applyQuaternion(q),q.clone().multiply(headRest.quaternion));head.quaternion.copy(q);torso.quaternion.copy(bodyRotation);
  const vr=state.mode==='vr';show('head',true);show('torso',mode!=='tracked');let legs=!vr;
  if(vr&&mode==='complete'&&hips){legs=true;for(const s of ['left','right'])if(!joint(s+'-upper-leg')||!joint(s+'-lower-leg')||!joint(s+'-foot-ankle'))legs=false;}
  show('legs',mode==='complete'&&legs);
  if(legs&&body)for(const s of ['left','right']){const prefix=s==='left'?'L ':'R ',a=joint(s+'-upper-leg'),b=joint(s+'-lower-leg'),c=joint(s+'-foot-ankle');if(a&&b&&c){aim(bone(prefix+'Thigh'),bone(prefix+'Calf'),a,b,bodyRotation);aim(bone(prefix+'Calf'),bone(prefix+'Foot'),b,c,bodyRotation);}}
  for(const s of ['left','right']){
   const prefix=s==='left'?'L ':'R ',sign=s==='left'?-1:1,upper=bone(prefix+'UpperArm'),lower=bone(prefix+'Forearm'),wrist=bone(prefix+'Hand'),goal=state.hands&&state.hands[s];
   const shoulder=joint(s+'-arm-upper')||restPoint(upper,bodyRotation);let elbow=joint(s+'-arm-lower'),hand=goal?relative(goal.position):joint(s+'-hand-wrist');
   const a=rig.rest.get(upper).position.distanceTo(rig.rest.get(lower).position),b=rig.rest.get(lower).position.distanceTo(rig.rest.get(wrist).position);
   if(!hand)hand=shoulder.clone().add(new THREE.Vector3(sign*.035,-(a+b)*.93,-.025).applyQuaternion(bodyRotation));
   const d=hand.clone().sub(shoulder),distance=d.length(),reachable=distance<1.25*(a+b);
   if(!elbow){const unit=d.clone().normalize(),bend=new THREE.Vector3(sign*.75,-.3,.65).applyQuaternion(bodyRotation);bend.addScaledVector(unit,-bend.dot(unit)).normalize();const c=Math.max(.03,Math.min(a+b-.001,distance)),along=(a*a-b*b+c*c)/(2*c);elbow=shoulder.clone().addScaledVector(unit,along).addScaledVector(bend,Math.sqrt(Math.max(0,a*a-along*along)));}
   show(s+'Arm',mode!=='tracked'&&reachable&&(!vr||!!goal||!!body));aim(upper,lower,shoulder,elbow,bodyRotation);aim(lower,wrist,elbow,hand,bodyRotation);
   const handNode=hands[s];handNode.position.copy(hand);if(goal)handNode.quaternion.copy(goal.quaternion);show(s+'Hand',!vr&&!goal&&mode!=='tracked');
   let remote=rig.remoteHands[s];
   if(goal&&goal.joints){
    if(!remote){remote=rig.remoteHands[s]=new XRHandMesh(s);remote.material.color.set(choice.skin).convertSRGBToLinear();remote.networkMatrices=new Map(HAND_JOINTS.map(name=>[name,new THREE.Matrix4()]));root.add(remote.root);}
    HAND_JOINTS.forEach((name,i)=>{const row=goal.joints[i];jointPosition.fromArray(row).sub(origin);jointRotation.fromArray(row,3);remote.networkMatrices.get(name).compose(jointPosition,jointRotation,one);});remote.tracked(remote.networkMatrices);handNode.visible=true;
   }else{if(remote)remote.root.visible=false;handNode.visible=!!goal;}
   // Legacy peers have a wrist target, but no invented finger gestures.
   if(goal&&!goal.joints){show(s+'Hand',true);setWorld(wrist,hand,bodyRotation.clone().multiply(rig.rest.get(wrist).quaternion));}
  }
  root.updateWorldMatrix(true,true);
 };
 rig.dispose=()=>{if(rig.disposed)return;rig.disposed=true;for(const s of Object.keys(rig.remoteHands))rig.remoteHands[s].dispose();if(rig.resource)rig.resource.release();if(root.parent)root.parent.remove(root);};
 return rig;
}
