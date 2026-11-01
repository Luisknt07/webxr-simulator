import * as THREE from 'three';
import {createRobot,updateRobotPose} from '../../robots/runtime/RobotPrefabs.js';

const keyOf=(object,root)=>{const names=[];for(let p=object;p&&p!==root;p=p.parent)names.push(p.name||'');return names.reverse().join('/');};
const materialCopy=original=>{const copy=original.clone();copy.onBeforeCompile=original.onBeforeCompile;if(original.defines)copy.defines=Object.assign({},original.defines);if(original.surfaceWearMap)copy.surfaceWearMap=original.surfaceWearMap;return copy;};
const point=value=>Array.isArray(value)?new THREE.Vector3().fromArray(value):new THREE.Vector3(value.x,value.y,value.z);

/** A private, operational rig for rehearsal. It owns every geometry it creates,
 * and shares only read-only source image textures. It never owns a live product
 * or writes a project, machine command, collision world or inventory. */
export default class RobotStudyTaskPreview{
 constructor(config,source){
  this.object=createRobot(config);this.object.name='Ensayo privado del robot';this.object.scale.copy(source.scale);this.geometries=new Set();this.materials=new Set();this.textures=new Set();
  const sources=new Map();source.traverse(node=>sources.set(keyOf(node,source),node));
  this.object.traverse(node=>{
   if(node.geometry)this.geometries.add(node.geometry);for(const material of (node.material?Array.isArray(node.material)?node.material:[node.material]:[])){this.materials.add(material);for(const k of ['map','normalMap','roughnessMap','metalnessMap','aoMap'])if(material[k]&&!(material[k].userData&&material[k].userData.sharedIndustrialTexture))this.textures.add(material[k]);}
   if(node===this.object)return;const from=sources.get(keyOf(node,this.object));if(!from)return;node.position.copy(from.position);node.quaternion.copy(from.quaternion);node.scale.copy(from.scale);node.updateMatrix();
   if(node.isMesh&&from.material){const copy=value=>{const m=materialCopy(value);this.materials.add(m);return m;};node.material=Array.isArray(from.material)?from.material.map(copy):copy(from.material);}
  });
  const geometry=new THREE.BoxBufferGeometry(1,1,1),material=new THREE.MeshStandardMaterial({color:0xc99b59,roughness:.9});this.geometries.add(geometry);this.materials.add(material);this.payload=new THREE.Mesh(geometry,material);this.payload.name='Carga de ensayo · sin inventario';this.payload.visible=false;this.object.add(this.payload);
  this.object.updateMatrixWorld(true);this.wasHolding=false;
 }
 update(state){
  const solved=updateRobotPose(this.object,{joints:state.joints,open:state.carrying?0:1});
  const size=state.payloadSize||[.26,.20,.22],values=Array.isArray(size)?size:[size.width||.26,size.height||.20,size.depth||.22];this.payload.scale.set(...values.map(v=>Math.max(.02,Math.min(2,Number(v)||.2))));
  if(state.carrying){const tcp=state.tcp?point(state.tcp):new THREE.Vector3(solved.tcp.x,solved.tcp.y,solved.tcp.z);this.payload.position.copy(tcp);this.payload.position.y-=this.payload.scale.y/2;this.payload.visible=true;this.wasHolding=true;}
  else if(!this.wasHolding&&state.pickup){this.payload.position.copy(point(state.pickup));this.payload.position.y-=this.payload.scale.y/2;this.payload.visible=true;}
  if(state.path&&!this.route){const points=state.path.map(point).filter(p=>p.toArray().every(Number.isFinite));if(points.length>1&&points.length<=80){const geometry=new THREE.BufferGeometry().setFromPoints(points),material=new THREE.LineBasicMaterial({color:0x6fdcca,transparent:true,opacity:.8});this.geometries.add(geometry);this.materials.add(material);this.route=new THREE.Line(geometry,material);this.route.name='Trayectoria TCP del ensayo';this.object.add(this.route);}}
  this.object.updateMatrixWorld(true);return solved;
 }
 dispose(){if(this.object.parent)this.object.parent.remove(this.object);this.geometries.forEach(g=>g.dispose());this.materials.forEach(m=>m.dispose());this.textures.forEach(t=>t.dispose());this.geometries.clear();this.materials.clear();this.textures.clear();}
}
