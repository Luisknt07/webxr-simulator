import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {SkeletonUtils} from 'three/examples/jsm/utils/SkeletonUtils.js';

export const HUMAN_AVATARS=[
 {id:'human-f07',label:'Persona 1 · cabello recogido',presentation:'Femenina',skin:'#d7b19b'},
 {id:'human-m04',label:'Persona 2 · cabello rizado y barba',presentation:'Masculina',skin:'#a67e60'},
 {id:'human-f04',label:'Persona 3 · cabello corto',presentation:'Femenina',skin:'#ddbda4'},
 {id:'human-m06',label:'Persona 4 · cabello corto',presentation:'Masculina',skin:'#d2ae94'}
];
export function humanChoice(config){return HUMAN_AVATARS.find(row=>row.id===config.base)||null;}
const cache=new Map();
function disposeModel(scene){const geometries=new Set(),materials=new Set(),textures=new Set(),skeletons=new Set();scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.skeleton)skeletons.add(o.skeleton);for(const m of o.material?Array.isArray(o.material)?o.material:[o.material]:[]){materials.add(m);for(const k of Object.keys(m))if(m[k]&&m[k].isTexture)textures.add(m[k]);}});skeletons.forEach(s=>{if(s.boneTexture)s.boneTexture.dispose();});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());}
/** Bounded local resources, shared geometry/textures, independent bones.
 * Async/disposed instances cannot attach. Unused resources retire after 30 s. */
export async function acquireHuman(id){
 if(!HUMAN_AVATARS.some(row=>row.id===id))throw Error('Selecciona un avatar humano.');
 let entry=cache.get(id);
 if(!entry){entry={refs:0,timer:null};entry.promise=new Promise((resolve,reject)=>new GLTFLoader().load(new URL('packages/tools/collaboration/assets/humans/'+id+'.glb',document.baseURI).href,gltf=>resolve(gltf.scene),undefined,reject));cache.set(id,entry);entry.promise.catch(()=>{if(cache.get(id)===entry)cache.delete(id);});}
 clearTimeout(entry.timer);entry.refs++;
 let model;
 const release=()=>{if(!entry.refs)return;if(--entry.refs===0)entry.timer=setTimeout(()=>{if(entry.refs||cache.get(id)!==entry)return;cache.delete(id);entry.promise.then(disposeModel,()=>{});},30000);};
 try{
  const source=await entry.promise;model=SkeletonUtils.clone(source);const ownedMaterials=new Set(),skeletons=new Set();
  model.traverse(o=>{if(!o.isMesh)return;o.frustumCulled=false;o.raycast=()=>{};if(o.skeleton)skeletons.add(o.skeleton);const copy=m=>{const c=m.clone();c.roughness=.82;c.metalness=0;if(/opacity/i.test(c.name)){c.transparent=false;c.alphaTest=.45;c.side=THREE.DoubleSide;c.depthWrite=true;}ownedMaterials.add(c);return c;};o.material=Array.isArray(o.material)?o.material.map(copy):copy(o.material);});
  return{model,release(){if(!model)return;if(model.parent)model.parent.remove(model);ownedMaterials.forEach(m=>m.dispose());skeletons.forEach(s=>{if(s.boneTexture)s.boneTexture.dispose();});model=null;release();}};
 }catch(error){release();throw error;}
}
