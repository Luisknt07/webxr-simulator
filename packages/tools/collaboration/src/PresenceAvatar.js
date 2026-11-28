import * as THREE from 'three';
import {createAvatarRig} from './AvatarRig.js';

export function validPose(value){
  if(!value||!Array.isArray(value.position)||value.position.length!==3||value.position.some(n=>!Number.isFinite(n)||Math.abs(n)>10000)||!Array.isArray(value.quaternion)||value.quaternion.length!==4||value.quaternion.some(n=>!Number.isFinite(n)))return false;
  const length=Math.hypot(...value.quaternion);return length>.99&&length<1.01;
}

/** Lightweight remote presence; never a physics collider or a tracked joint. */
export default class PresenceAvatar {
 constructor(person,dom=document){
  this.person=person;this.object=new THREE.Group();this.object.name='Participante · '+person.displayName;Object.assign(this.object.userData,{editorRuntimeHelper:true,editorNonCollidable:true});
  this.lastPose=0;this.target=null;this.euler=new THREE.Euler(0,0,0,'YXZ');this.cameraQuaternion=new THREE.Quaternion();this.walkPhase=0;this.previousPosition=new THREE.Vector3();
  this.rig=createAvatarRig(person.avatar||{});this.object.add(this.rig.root);this.head=this.rig.head;this.torso=this.rig.torso;this.hands=this.rig.hands;
  this.canvas=dom.createElement('canvas');this.canvas.width=768;this.canvas.height=160;this.texture=new THREE.CanvasTexture(this.canvas);this.texture.encoding=THREE.sRGBEncoding;this.texture.generateMipmaps=false;this.texture.minFilter=THREE.LinearFilter;
  this.labelMaterial=new THREE.MeshBasicMaterial({map:this.texture,transparent:true,depthWrite:false,toneMapped:false});this.labelGeometry=new THREE.PlaneBufferGeometry(.88,.1833);this.label=new THREE.Mesh(this.labelGeometry,this.labelMaterial);this.label.position.y=.38;this.label.raycast=()=>{};this.object.add(this.label);this.muted=true;this.paint();
 }
 paint(){
  const c=this.canvas.getContext('2d');if(!c)return;c.clearRect(0,0,768,160);c.fillStyle='#102b36';c.beginPath();c.moveTo(20,0);c.arcTo(768,0,768,160,20);c.arcTo(768,160,0,160,20);c.arcTo(0,160,0,0,20);c.arcTo(0,0,768,0,20);c.fill();c.fillStyle=this.speaking?'#50e2ac':this.raised?'#ffd678':'#8ab5bd';c.fillRect(0,25,5,110);
  c.beginPath();c.arc(58,80,29,0,Math.PI*2);c.fill();c.strokeStyle='#102b36';c.lineWidth=5;c.lineCap='round';c.beginPath();c.moveTo(58,57);c.lineTo(58,84);c.moveTo(44,77);c.lineTo(44,83);c.arc(58,83,14,Math.PI,0,true);c.moveTo(58,98);c.lineTo(58,105);if(this.muted){c.moveTo(39,57);c.lineTo(78,102);}c.stroke();
  let size=40;const name=String(this.person.displayName||'Participante').slice(0,80);c.font='600 '+size+'px Arial';while(size>22&&c.measureText(name).width>645)c.font='600 '+(--size)+'px Arial';c.fillStyle='#f2fffc';c.textBaseline='middle';c.fillText(name,108,60,640);
  c.font='24px Arial';c.fillStyle='#aacbd0';c.fillText((this.person.role==='host'?'INSTRUCTOR':'PARTICIPANTE')+'  ·  '+(this.speaking?'HABLANDO':this.raised?'SOLICITA LA PALABRA':this.muted?'MICRÓFONO APAGADO':'TURNO DE VOZ'),108,110,640);this.texture.needsUpdate=true;
 }
 updatePerson(person){const changed=this.person.displayName!==person.displayName;this.person=person;if(changed){this.object.name='Participante · '+person.displayName;this.paint();}}
 voice(muted,speaking,raised=false){if(this.muted!==muted||this.speaking!==speaking||this.raised!==raised){this.muted=muted;this.speaking=speaking;this.raised=raised;this.paint();}}
 receive(pose,at=performance.now()){
  if(!validPose(pose))return false;this.target={position:new THREE.Vector3().fromArray(pose.position),quaternion:new THREE.Quaternion().fromArray(pose.quaternion),hands:{},seated:pose.seated===true};
  for(const side of ['left','right'])if(validPose(pose[side]))this.target.hands[side]={position:new THREE.Vector3().fromArray(pose[side].position),quaternion:new THREE.Quaternion().fromArray(pose[side].quaternion)};
  if(!this.lastPose||this.object.position.distanceToSquared(this.target.position)>9)this.object.position.copy(this.target.position);this.lastPose=at;return true;
 }
 tick(camera,delta=1/60){
  if(!this.target)return;const alpha=1-Math.exp(-14*Math.min(.1,Math.max(0,delta))),target=this.target;this.previousPosition.copy(this.object.position);this.object.position.lerp(target.position,alpha);this.head.quaternion.slerp(target.quaternion,alpha);this.euler.setFromQuaternion(target.quaternion,'YXZ');this.torso.rotation.y=this.euler.y;
  const travel=this.previousPosition.distanceTo(this.object.position);this.walkPhase+=Math.min(.3,travel)*10;const stride=Math.min(1,travel/Math.max(.001,delta));
  for(const side of ['left','right']){const sign=side==='left'?-1:1,hand=this.hands[side],goal=target.hands[side],shoulder=new THREE.Vector3(sign*.235,-.405,0).applyQuaternion(this.torso.quaternion),local=goal?goal.position.clone().sub(this.object.position):new THREE.Vector3(sign*.255,-.96,-.025).applyQuaternion(this.torso.quaternion);
   if(!this.lastTick||hand.position.distanceToSquared(local)>4)hand.position.copy(local);else hand.position.lerp(local,alpha);if(goal)hand.quaternion.slerp(goal.quaternion,alpha);else hand.quaternion.copy(this.torso.quaternion);
   const direction=hand.position.clone().sub(shoulder),distance=Math.max(.025,Math.min(.579,direction.length()));direction.normalize();const bend=new THREE.Vector3(sign*.6,-.8,.35).applyQuaternion(this.torso.quaternion);bend.addScaledVector(direction,-bend.dot(direction)).normalize();const a=(.3*.3-.28*.28+distance*distance)/(2*distance),height=Math.sqrt(Math.max(0,.3*.3-a*a)),elbow=shoulder.clone().addScaledVector(direction,a).addScaledVector(bend,height),arm=this.rig.arms[side];
   for(const [node,from,to,length]of [[arm.upper,shoulder,elbow,.3],[arm.lower,elbow,hand.position,.28]]){const d=to.clone().sub(from);node.position.copy(from);node.quaternion.setFromUnitVectors(new THREE.Vector3(0,-1,0),d.clone().normalize());node.scale.y=d.length()/length;}
   const leg=this.rig.legs[side],swing=Math.sin(this.walkPhase+(sign<0?0:Math.PI))*stride;leg.hip.rotation.x=target.seated?-1.25:swing*.3;leg.knee.rotation.x=target.seated?1.3:Math.max(0,-swing)*.45;
  }this.lastTick=true;
  if(camera){camera.getWorldQuaternion(this.cameraQuaternion);this.label.quaternion.copy(this.cameraQuaternion);const distance=camera.getWorldPosition(new THREE.Vector3()).distanceTo(this.object.position);this.rig.root.visible=distance>.45;this.label.visible=distance>.45;}
 }
 dispose(){if(this.object.parent)this.object.parent.remove(this.object);this.rig.dispose();this.labelGeometry.dispose();this.labelMaterial.dispose();this.texture.dispose();}
}
