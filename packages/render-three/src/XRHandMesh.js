import * as THREE from 'three';
import handMeshes from './hand-meshes.json';
import XRHandPose from './XRHandPose.js';

const X=new THREE.Vector3(1,0,0);
const decode=(value,Type)=>{const text=atob(value),bytes=new Uint8Array(text.length);for(let i=0;i<text.length;i++)bytes[i]=text.charCodeAt(i);return new Type(bytes.buffer);};
const parentName=name=>{
 if(name==='wrist')return null;
 const parts=name.startsWith('thumb-')?['metacarpal','phalanx-proximal','phalanx-distal','tip']:['metacarpal','phalanx-proximal','phalanx-intermediate','phalanx-distal','tip'];
 const prefix=name.startsWith('thumb-')?'thumb':name.slice(0,name.indexOf('-finger')+7),part=name.slice(prefix.length+1),index=parts.indexOf(part);return index<=0?'wrist':prefix+'-'+parts[index-1];
};

/** Locally embedded MIT WebXR Input Profiles skin: 25 joints, one draw and
 * 2,314 triangles per hand. The same mesh supports measured and button poses. */
export default class XRHandMesh {
 constructor(side='right'){
  this.side=side;const data=handMeshes[side];this.root=new THREE.Group();this.root.name='Articulated WebXR hand · '+side;this.root.userData={editorRuntimeHelper:true,editorNonCollidable:true,xrInputVisual:true,handMeshSource:handMeshes.source,handMeshLicense:handMeshes.license};
  this.geometry=new THREE.BufferGeometry();for(const [name,size,Type]of [['position',3,Float32Array],['normal',3,Float32Array],['skinIndex',4,Uint8Array],['skinWeight',4,Float32Array]])this.geometry.setAttribute(name,new THREE.BufferAttribute(decode(data.attributes[name],Type),size));this.geometry.setIndex(new THREE.BufferAttribute(decode(data.indices,Uint16Array),1));
  this.material=new THREE.MeshStandardMaterial({color:0xc5e4ff,roughness:.58,metalness:0,skinning:true});this.material.color.convertSRGBToLinear();
  this.bones=new Map();this.bind=new Map();this.rest=new Map();
  data.bones.forEach(row=>{const bone=new THREE.Bone();bone.name=row.name;this.bones.set(row.name,bone);this.bind.set(row.name,new THREE.Matrix4().fromArray(row.matrix));});
  this.bones.forEach((bone,name)=>{const parent=parentName(name),matrix=this.bind.get(name).clone();if(parent)matrix.premultiply(new THREE.Matrix4().getInverse(this.bind.get(parent)));matrix.decompose(bone.position,bone.quaternion,bone.scale);this.rest.set(name,{position:bone.position.clone(),quaternion:bone.quaternion.clone(),scale:bone.scale.clone()});(parent?this.bones.get(parent):this.root).add(bone);});
  this.mesh=new THREE.SkinnedMesh(this.geometry,this.material);this.mesh.name='Continuous hand skin';this.mesh.frustumCulled=false;this.mesh.raycast=()=>{};Object.assign(this.mesh.userData,this.root.userData);this.root.add(this.mesh);this.root.updateMatrixWorld(true);
  this.skeleton=new THREE.Skeleton(data.bones.map(row=>this.bones.get(row.name)),data.bones.map(row=>new THREE.Matrix4().getInverse(this.bind.get(row.name))));this.mesh.bind(this.skeleton,new THREE.Matrix4());this.temp=new THREE.Matrix4();this.rotation=new THREE.Quaternion();
  this.pose=new XRHandPose(this);this.parentInverse=new THREE.Matrix4();
 }
 controller(trigger,grip,input={},delta){
  this.root.position.set(0,.075,.075);this.root.quaternion.setFromAxisAngle(X,-.3);this.root.scale.setScalar(1);this.root.visible=true;
  if(this.mode!=='controller'){this.pose.reset();this.bones.forEach((bone,name)=>{const rest=this.rest.get(name);bone.position.copy(rest.position);bone.quaternion.copy(rest.quaternion);bone.scale.copy(rest.scale);});}
  this.mode='controller';this.pose.update(trigger,grip,input,input.interaction,delta);
 }
 tracked(matrices){
  this.mode='tracked';
  this.root.position.set(0,0,0);this.root.quaternion.set(0,0,0,1);this.root.scale.setScalar(1);this.root.visible=[...this.bones.keys()].every(name=>matrices.get(name));if(!this.root.visible)return false;
  this.bones.forEach((bone,name)=>{const parent=parentName(name);this.temp.copy(matrices.get(name));if(parent)this.temp.premultiply(this.parentInverse.getInverse(matrices.get(parent)));this.temp.decompose(bone.position,bone.quaternion,bone.scale);});return true;
 }
 dispose(){this.pose.reset();if(this.root.parent)this.root.parent.remove(this.root);this.geometry.dispose();this.material.dispose();if(this.skeleton.boneTexture)this.skeleton.boneTexture.dispose();}
}
