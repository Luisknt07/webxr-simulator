import * as THREE from 'three';
import {DecalGeometry} from 'three/examples/jsm/geometries/DecalGeometry.js';
import pbr from '../schema/industrial-pbr.js';
import IndustrialPBRTextures from './IndustrialPBRTextures.js';
import {makeStickerAtlas,stickerTile} from './IndustrialStickerAtlas.js';
const values=material=>Array.isArray(material)?material:[material];
function visible(object){for(let n=object;n;n=n.parent)if(!n.visible)return false;return true;}
function industrial(object){for(let n=object;n;n=n.parent)if(n.userData.editorPrefabKey||n.userData.vehicleRig||n.userData.robotRig||n.userData.industrialSource||n.userData.editorDescriptor&&n.userData.editorDescriptor.type==='cad')return true;return false;}
function excluded(object){for(let n=object;n;n=n.parent)if(n.userData.industrialFinishOverlay||n.userData.editorVisualOwnerId||n.userData.editorGeometryReplaced)return true;return false;}
function inside(child,parent){for(let n=child;n;n=n.parent)if(n===parent)return true;return false;}
const photographic=texture=>texture&&texture.userData&&texture.userData.industrialPhotographicSource;
function retainMaps(material,wanted){for(const field of ['map','normalMap','roughnessMap','bumpMap']){const texture=material[field];if(photographic(texture)&&texture.userData.industrialPhotographicKey)wanted.add(texture.userData.industrialPhotographicKey);}}
/** Derived defaults only: authored surface-material bindings always take priority. */
export default class IndustrialFinishSystem {
 constructor(ctx,document,options={}){this.ctx=ctx;this.document=document;this.bindings=new Map();this.stickers=new Map();this.elapsed=1;this.dirty=true;this.roomId=null;this.store=new IndustrialPBRTextures(ctx,()=>{this.dirty=true;},options);this.stats={rejectedStickers:0,projectedStickers:0};}
 restore(material,binding){for(const key of ['map','normalMap','roughnessMap','roughness','metalness','bumpMap','normalScale'])if(material[key]===binding.installed[key])material[key]=binding.original[key];material.needsUpdate=true;delete material.userData.industrialPhotographicDefault;delete material.userData.industrialPhotographicBase;}
 bind(material,mesh,id,active,wanted){active.add(material);const profile=pbr.PROFILES.find(p=>p.id===id),entry=this.store.acquire(id);wanted.add(entry.key);const old=this.bindings.get(material);
  // Keep the previous GPU owner while the replacement image batch is pending
  // or failed. Rendering a disposed-but-still-bound Texture would re-upload it
  // after the pool had forgotten the owner, leaking that allocation.
  if(!entry.textures){if(old)wanted.add(old.key);retainMaps(material,wanted);return;}if(old&&old.key===entry.key){retainMaps(material,wanted);return;}if(old)this.restore(material,old);
  const original={};['map','normalMap','roughnessMap','roughness','metalness','bumpMap','normalScale'].forEach(key=>original[key]=material[key]);
  // IndustrialVisuals can clone a material after defaults were installed.
  // Those inherited default maps are not authored originals: retaining them as
  // a restore target could resurrect an abandoned tier after its GPU release.
  const base=material.userData.industrialPhotographicBase;
  if(base&&['map','normalMap','roughnessMap','bumpMap'].some(key=>photographic(original[key]))){
    if(Number.isFinite(base.roughness))original.roughness=base.roughness;if(Number.isFinite(base.metalness))original.metalness=base.metalness;
    if(Array.isArray(base.normalScale)&&base.normalScale.length===2&&base.normalScale.every(Number.isFinite))original.normalScale=new THREE.Vector2().fromArray(base.normalScale);
  }
  ['map','normalMap','roughnessMap','bumpMap'].forEach(key=>{if(photographic(original[key]))original[key]=null;});
  // A rolling texture retains its authored/moving UVs. Photographic normals and
  // roughness add detail independently, without changing belt/roller animation.
  const managed=texture=>texture&&texture.userData&&texture.userData.industrialPhotographicSource;
  if(!material.normalMap||managed(material.normalMap)){material.normalMap=entry.textures.normal;material.normalScale=new THREE.Vector2(profile.normalStrength,profile.normalStrength);material.bumpMap=null;}
  if(!material.roughnessMap){material.roughnessMap=entry.textures.roughness;material.roughness=Math.min(1,Math.max(.15,material.roughness)/Math.max(.28,profile.roughnessMean));}
  else if(managed(material.roughnessMap))material.roughnessMap=entry.textures.roughness;
  const moving=mesh.userData.industrialRoller||mesh.userData.industrialBelt;
  if(!moving&&(!material.map||material.map.isDataTexture||managed(material.map))&&!material.userData.surfaceMaterialBinding)material.map=entry.textures.neutral;
  if(id==='paint')material.metalness=Math.min(.18,material.metalness);
  material.userData.industrialPhotographicDefault=id;material.userData.industrialPhotographicBase={roughness:original.roughness,metalness:original.metalness,normalScale:original.normalScale&&original.normalScale.toArray()};material.needsUpdate=true;const installed={};Object.keys(original).forEach(key=>installed[key]=material[key]);this.bindings.set(material,{key:entry.key,original,installed});retainMaps(material,wanted);
 }
 sync(roomId,delta=0){const current=this.ctx.editor&&this.ctx.editor.document;if(current&&current!==this.document){this.dispose();this.document=current;this.roomId=null;}this.elapsed+=delta||0;if(this.roomId!==String(roomId)){this.dispose();this.roomId=String(roomId);this.dirty=true;}const edge=this.store.edge();if(edge!==this.edge){this.edge=edge;this.dirty=true;}if(!this.dirty&&this.elapsed<.4)return;this.elapsed=0;this.dirty=false;
  const root=this.document.getRoot(roomId);if(!root)return;const active=new Set(),wanted=new Set(),anchors=new Set();root.updateWorldMatrix(true,true);
  const visit=object=>{if(!object.visible||excluded(object))return;if(object.userData.industrialStickerAnchors){anchors.add(object);this.syncStickers(object);}if(object.isMesh&&object.geometry&&object.geometry.attributes.uv&&industrial(object)&&!object.userData.industrialFinishOverlay){values(object.material).forEach(material=>{if(!material||!material.isMeshStandardMaterial)return;if(material.userData.surfaceMaterialBinding){['map','normalMap','roughnessMap'].forEach(key=>{const texture=material[key];if(texture&&texture.userData&&texture.userData.industrialPhotographicKey)wanted.add(texture.userData.industrialPhotographicKey);});return;}const id=pbr.classify(material,object);if(id)this.bind(material,object,id,active,wanted);});}object.children.slice().forEach(visit);};visit(root);
  this.bindings.forEach((binding,material)=>{if(!active.has(material)){this.restore(material,binding);this.bindings.delete(material);}});this.stickers.forEach((entry,object)=>{if(!anchors.has(object)||!visible(object)){this.removeStickers(entry);this.stickers.delete(object);}});this.store.prune(wanted);
 }
 syncStickers(object){const anchors=object.userData.industrialStickerAnchors;if(!Array.isArray(anchors))return;const signature=JSON.stringify(anchors),targets=[];object.traverse(mesh=>{if(mesh.isMesh&&!mesh.isInstancedMesh&&mesh.geometry&&!excluded(mesh)&&visible(mesh)&&!values(mesh.material).some(m=>m&&(/text|label|screen|display|hmi/i.test(m.name)||m.isMeshBasicMaterial)))targets.push(mesh);});
  const targetSignature=targets.map(mesh=>mesh.uuid+':'+mesh.geometry.uuid).join('|'),previous=this.stickers.get(object);if(previous&&previous.signature===signature&&previous.targetSignature===targetSignature&&previous.meshes.every(mesh=>mesh.parent&&inside(mesh,object)))return;if(previous)this.removeStickers(previous);
  const entry={signature,targetSignature,meshes:[]};this.stickers.set(object,entry);
  anchors.slice(0,6).forEach(anchor=>{if(!anchor||!Array.isArray(anchor.position)||!Array.isArray(anchor.normal)||!Array.isArray(anchor.size))return;const position=new THREE.Vector3().fromArray(anchor.position).applyMatrix4(object.matrixWorld),normal=new THREE.Vector3().fromArray(anchor.normal).applyMatrix3(new THREE.Matrix3().getNormalMatrix(object.matrixWorld)).normalize(),scale=object.getWorldScale(new THREE.Vector3()),w=anchor.size[0]*Math.max(Math.abs(scale.x),Math.abs(scale.z)),h=anchor.size[1]*Math.abs(scale.y);if(!Number.isFinite(w+h)||w<=0||h<=0)return;
    const ray=new THREE.Raycaster(position.clone().addScaledVector(normal,.09),normal.clone().negate(),0,.2);const hit=ray.intersectObjects(targets,false).find(result=>result.face&&result.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(result.object.matrixWorld)).dot(normal)>.5);if(!hit){this.stats.rejectedStickers++;return;}
    const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),normal),orientation=new THREE.Euler().setFromQuaternion(q),geometry=new DecalGeometry(hit.object,hit.point,orientation,new THREE.Vector3(w,h,.009));if(!geometry.attributes.position.count){geometry.dispose();this.stats.rejectedStickers++;return;}geometry.applyMatrix(new THREE.Matrix4().getInverse(hit.object.matrixWorld));const uv=geometry.attributes.uv,tile=stickerTile(anchor.id);for(let i=0;i<uv.count;i++)uv.setXY(i,tile.u+uv.getX(i)*tile.w,tile.v+uv.getY(i)*tile.h);uv.needsUpdate=true;
    if(!this.atlas)this.atlas=makeStickerAtlas();if(!this.stickerMaterial)this.stickerMaterial=new THREE.MeshStandardMaterial({map:this.atlas,color:0xffffff,metalness:0,roughness:.88,transparent:true,alphaTest:.35,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-3,polygonOffsetUnits:-3});const decal=new THREE.Mesh(geometry,this.stickerMaterial);decal.name='Calcomanía · '+anchor.id;decal.userData.industrialFinishOverlay=true;decal.userData.editorRuntimeHelper=true;decal.userData.editorDecal=true;decal.raycast=()=>{};decal.castShadow=false;decal.receiveShadow=true;hit.object.add(decal);entry.meshes.push(decal);this.stats.projectedStickers++;
  });
 }
 removeStickers(entry){entry.meshes.forEach(mesh=>{if(mesh.parent)mesh.parent.remove(mesh);mesh.geometry.dispose();});}
 dispose(){this.bindings.forEach((binding,material)=>this.restore(material,binding));this.bindings.clear();this.stickers.forEach(entry=>this.removeStickers(entry));this.stickers.clear();this.store.dispose();if(this.atlas)this.atlas.dispose();if(this.stickerMaterial)this.stickerMaterial.dispose();this.atlas=this.stickerMaterial=null;this.elapsed=1;this.dirty=true;}
 getStats(){return Object.assign({},this.stats,this.store.stats(),{materials:this.bindings.size,stickerGroups:this.stickers.size});}
}
