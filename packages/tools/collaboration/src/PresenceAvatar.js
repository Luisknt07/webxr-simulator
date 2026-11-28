import * as THREE from 'three';

export function validPose(value){
  if(!value||!Array.isArray(value.position)||value.position.length!==3||value.position.some(n=>!Number.isFinite(n)||Math.abs(n)>10000)||!Array.isArray(value.quaternion)||value.quaternion.length!==4||value.quaternion.some(n=>!Number.isFinite(n)))return false;
  const length=Math.hypot(...value.quaternion);return length>.99&&length<1.01;
}

/** Lightweight remote presence; never a physics collider or a tracked joint. */
export default class PresenceAvatar {
 constructor(person,dom=document){
  this.person=person;this.object=new THREE.Group();this.object.name='Participante · '+person.displayName;Object.assign(this.object.userData,{editorRuntimeHelper:true,editorNonCollidable:true});
  this.materials=[];this.geometry=[];this.lastPose=0;this.target=null;this.euler=new THREE.Euler(0,0,0,'YXZ');this.cameraQuaternion=new THREE.Quaternion();
  const config=person.avatar||{},material=color=>{const m=new THREE.MeshStandardMaterial({color,roughness:.8});this.materials.push(m);return m;},body=material(config.bodyColor||'#5cead5'),skin=material(config.skinColor||'#d4a77e'),accent=material(config.accentColor||'#26364b');
  const sphere=new THREE.SphereBufferGeometry(1,12,8),box=new THREE.BoxBufferGeometry(1,1,1),cylinder=new THREE.CylinderBufferGeometry(1,1,1,10);this.geometry.push(sphere,box,cylinder);
  const mesh=(parent,g,m,position,scale)=>{const node=new THREE.Mesh(g,m);node.position.fromArray(position);node.scale.fromArray(scale);node.raycast=()=>{};parent.add(node);return node;};
  this.head=new THREE.Group();this.object.add(this.head);mesh(this.head,sphere,skin,[0,-.10,0],[.14,.16,.14]);mesh(this.head,box,accent,[0,-.10,-.135],[.22,.065,.035]);
  this.torso=new THREE.Group();this.object.add(this.torso);mesh(this.torso,cylinder,body,[0,-.48,.02],[.18,.43,.13]);mesh(this.torso,sphere,body,[0,-.69,.02],[.18,.12,.13]);
  this.hands={};for(const side of ['left','right']){const hand=new THREE.Group();this.object.add(hand);mesh(hand,sphere,skin,[0,0,0],[.038,.065,.024]);mesh(hand,sphere,skin,[side==='left'?.033:-.033,-.012,-.01],[.019,.035,.018]);hand.visible=false;this.hands[side]=hand;}
  this.canvas=dom.createElement('canvas');this.canvas.width=512;this.canvas.height=96;this.texture=new THREE.CanvasTexture(this.canvas);this.texture.encoding=THREE.sRGBEncoding;this.texture.generateMipmaps=false;this.texture.minFilter=THREE.LinearFilter;
  const labelMaterial=new THREE.MeshBasicMaterial({map:this.texture,transparent:true,depthWrite:false,toneMapped:false});this.materials.push(labelMaterial);const plane=new THREE.PlaneBufferGeometry(1,.1875);this.geometry.push(plane);this.label=new THREE.Mesh(plane,labelMaterial);this.label.position.y=.27;this.label.raycast=()=>{};this.object.add(this.label);this.paint();
 }
 paint(){
  const c=this.canvas.getContext('2d');if(!c)return;c.clearRect(0,0,512,96);c.fillStyle='#122631';c.fillRect(0,0,512,96);c.fillStyle=this.speaking?'#53e6a3':this.muted?'#e29b93':'#97c6ce';c.beginPath();c.arc(42,48,13,0,Math.PI*2);c.fill();
  let size=37;c.font='bold '+size+'px Arial';const name=String(this.person.displayName||'Participante').slice(0,80);while(size>17&&c.measureText(name).width>420){c.font='bold '+(--size)+'px Arial';}c.fillStyle='#f1fbff';c.textBaseline='middle';c.fillText(name,72,48,425);this.texture.needsUpdate=true;
 }
 updatePerson(person){const changed=this.person.displayName!==person.displayName;this.person=person;if(changed){this.object.name='Participante · '+person.displayName;this.paint();}}
 voice(muted,speaking){if(this.muted!==muted||this.speaking!==speaking){this.muted=muted;this.speaking=speaking;this.paint();}}
 receive(pose,at=performance.now()){
  if(!validPose(pose))return false;this.target={position:new THREE.Vector3().fromArray(pose.position),quaternion:new THREE.Quaternion().fromArray(pose.quaternion),hands:{}};
  for(const side of ['left','right'])if(validPose(pose[side]))this.target.hands[side]={position:new THREE.Vector3().fromArray(pose[side].position),quaternion:new THREE.Quaternion().fromArray(pose[side].quaternion)};
  if(!this.lastPose||this.object.position.distanceToSquared(this.target.position)>9)this.object.position.copy(this.target.position);this.lastPose=at;return true;
 }
 tick(camera,delta=1/60){
  if(!this.target)return;const alpha=1-Math.exp(-14*Math.min(.1,Math.max(0,delta))),target=this.target;this.object.position.lerp(target.position,alpha);this.head.quaternion.slerp(target.quaternion,alpha);this.euler.setFromQuaternion(target.quaternion,'YXZ');this.torso.rotation.y=this.euler.y;
  for(const side of ['left','right']){const hand=this.hands[side],goal=target.hands[side];if(goal){const local=goal.position.clone().sub(this.object.position);if(!hand.visible||hand.position.distanceToSquared(local)>4)hand.position.copy(local);else hand.position.lerp(local,alpha);hand.quaternion.slerp(goal.quaternion,alpha);}hand.visible=!!goal;}
  if(camera){camera.getWorldQuaternion(this.cameraQuaternion);this.label.quaternion.copy(this.cameraQuaternion);}
 }
 dispose(){if(this.object.parent)this.object.parent.remove(this.object);this.geometry.forEach(g=>g.dispose());this.materials.forEach(m=>m.dispose());this.texture.dispose();}
}
