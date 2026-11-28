import * as THREE from 'three';
import {createAvatarRig} from './AvatarRig.js';
import {validPose,validPresence} from './AvatarTracking.js';
export {validPose} from './AvatarTracking.js';

/** Lightweight remote presence; never a physics collider or a tracked joint. */
export default class PresenceAvatar {
 constructor(person,dom=document){
  this.person=person;this.object=new THREE.Group();this.object.name='Participante · '+person.displayName;Object.assign(this.object.userData,{editorRuntimeHelper:true,editorNonCollidable:true});
  this.lastPose=0;this.target=null;this.cameraQuaternion=new THREE.Quaternion();
  this.rig=createAvatarRig(person.avatar||{});this.object.add(this.rig.root);this.head=this.rig.head;this.torso=this.rig.torso;this.hands=this.rig.hands;
  this.canvas=dom.createElement('canvas');this.canvas.width=768;this.canvas.height=160;this.texture=new THREE.CanvasTexture(this.canvas);this.texture.encoding=THREE.sRGBEncoding;this.texture.generateMipmaps=false;this.texture.minFilter=THREE.LinearFilter;
  this.labelMaterial=new THREE.MeshBasicMaterial({map:this.texture,transparent:true,depthWrite:false,toneMapped:false});this.labelGeometry=new THREE.PlaneBufferGeometry(.88,.1833);this.label=new THREE.Mesh(this.labelGeometry,this.labelMaterial);this.label.position.y=.38;this.label.raycast=()=>{};this.object.add(this.label);this.muted=true;this.paint();
 }
 paint(){
  const c=this.canvas.getContext('2d');if(!c)return;c.clearRect(0,0,768,160);c.fillStyle='#102b36';c.beginPath();c.moveTo(20,0);c.arcTo(768,0,768,160,20);c.arcTo(768,160,0,160,20);c.arcTo(0,160,0,0,20);c.arcTo(0,0,768,0,20);c.fill();c.fillStyle=this.speaking?'#50e2ac':this.raised?'#ffd678':'#8ab5bd';c.fillRect(0,25,5,110);
  c.fillStyle=this.person.avatar&&this.person.avatar.bodyColor||'#8ab5bd';c.beginPath();c.arc(58,80,29,0,Math.PI*2);c.fill();c.strokeStyle='#102b36';c.lineWidth=5;c.lineCap='round';c.beginPath();c.moveTo(58,57);c.lineTo(58,84);c.moveTo(44,77);c.lineTo(44,83);c.arc(58,83,14,Math.PI,0,true);c.moveTo(58,98);c.lineTo(58,105);if(this.muted){c.moveTo(39,57);c.lineTo(78,102);}c.stroke();
  let size=40;const name=String(this.person.displayName||'Participante').slice(0,80);c.font='600 '+size+'px Arial';while(size>22&&c.measureText(name).width>645)c.font='600 '+(--size)+'px Arial';c.fillStyle='#f2fffc';c.textBaseline='middle';c.fillText(name,108,60,640);
  c.font='21px Arial';c.fillStyle='#aacbd0';c.fillText((this.person.role==='host'?'INSTRUCTOR':'PARTICIPANTE')+' · '+(this.speaking?'HABLANDO':this.raised?'PIDE LA PALABRA':this.muted?'MIC APAGADO':'TURNO DE VOZ'),108,105,640);c.font='19px Arial';c.fillText(this.trackingText||'Elige tu apariencia en Mi avatar',108,136,640);this.texture.needsUpdate=true;
 }
 updatePerson(person){const changed=this.person.displayName!==person.displayName;this.person=person;if(changed){this.object.name='Participante · '+person.displayName;this.paint();}}
 voice(muted,speaking,raised=false){if(this.muted!==muted||this.speaking!==speaking||this.raised!==raised){this.muted=muted;this.speaking=speaking;this.raised=raised;this.paint();}}
 receive(pose,at=performance.now()){
  if(!validPresence(pose))return false;this.target={position:new THREE.Vector3().fromArray(pose.position),quaternion:new THREE.Quaternion().fromArray(pose.quaternion),hands:{},seated:pose.seated===true,active:pose.active!==false,mode:pose.mode||'desktop',body:pose.body||null};
  for(const side of ['left','right'])if(validPose(pose[side]))this.target.hands[side]={position:new THREE.Vector3().fromArray(pose[side].position),quaternion:new THREE.Quaternion().fromArray(pose[side].quaternion),joints:pose[side].joints,source:pose[side].source};
  const trackingText=!this.target.active?'Participante inactivo':this.target.mode==='vr'?(pose.body?'RV · cuerpo del visor, puede incluir estimación':Object.values(this.target.hands).some(h=>h.source==='tracked')?'RV · manos medidas · cuerpo estimado':'RV · manos de mando · cuerpo estimado'):'Escritorio · postura representada';if(trackingText!==this.trackingText){this.trackingText=trackingText;this.paint();}
  if(!this.lastPose||this.object.position.distanceToSquared(this.target.position)>9)this.object.position.copy(this.target.position);this.lastPose=at;return true;
 }
 tick(camera,delta=1/60){
  if(!this.target)return;const alpha=1-Math.exp(-18*Math.min(.1,Math.max(0,delta))),target=this.target;this.object.position.lerp(target.position,alpha);this.head.quaternion.slerp(target.quaternion,alpha);
  const stale=performance.now()-this.lastPose>2500||!target.active;
  let distance=0;if(camera){camera.getWorldQuaternion(this.cameraQuaternion);this.label.quaternion.copy(this.cameraQuaternion);distance=camera.getWorldPosition(new THREE.Vector3()).distanceTo(this.object.position);this.rig.root.visible=distance>.45&&distance<20&&!stale;this.label.visible=distance>.45;}
  if(stale){const text=target.active?'Seguimiento interrumpido':'Participante inactivo';if(this.trackingText!==text){this.trackingText=text;this.paint();}return;}
  this.poseElapsed=(this.poseElapsed||0)+delta;const interval=distance>12?.1:distance>5?1/30:1/60;if(this.rig.root.visible&&this.poseElapsed>=interval){this.poseElapsed=0;this.rig.update({...target,quaternion:this.head.quaternion});}
 }
 dispose(){if(this.object.parent)this.object.parent.remove(this.object);this.rig.dispose();this.labelGeometry.dispose();this.labelMaterial.dispose();this.texture.dispose();}
}
