import * as THREE from 'three';

const shown=object=>{for(let n=object;n;n=n.parent)if(!n.visible)return false;return true;};
/** Read-only top view of the original native geometry. Geometry and textures
 * stay owned by the world; only bounded display meshes/materials are owned here. */
export default class VehicleFacilityView {
 constructor(ctx){
  this.ctx=ctx;this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#aebbb9');this.rows=new Map();this.materials=new Map();this.scanned=-Infinity;
  this.scene.add(new THREE.HemisphereLight(0xffffff,0x71817d,1.05));const sun=new THREE.DirectionalLight(0xffffff,.7);sun.position.set(-15,40,20);this.scene.add(sun);
  this.stats={meshes:0,candidates:0,scans:0,truncated:false};
 }
 material(source,floor){
  if(floor)return source;
  let material=this.materials.get(source);if(!material){material=new THREE.MeshLambertMaterial({color:source.color||0xffffff,map:source.map||null,alphaMap:source.alphaMap||null,transparent:source.transparent,opacity:source.opacity,alphaTest:source.alphaTest||0,side:source.side,vertexColors:source.vertexColors,depthWrite:source.depthWrite});this.materials.set(source,material);}
  if(source.color)material.color.copy(source.color);return material;
 }
 sync(world,force=false){
  const now=typeof performance==='undefined'?Date.now():performance.now();
  if(force||now-this.scanned>1000){
   this.scanned=now;this.stats.scans++;const candidates=[],box=new THREE.Box3(),size=new THREE.Vector3();
   world.traverse(source=>{
    if(!source.isMesh||!source.geometry||source.isSkinnedMesh||!source.layers.mask||!shown(source)||source.userData.editorRuntimeHelper&&!source.userData.nativeRenderBank)return;
    for(let n=source;n;n=n.parent){if(n===this.ctx.cameraRig)return;if(n.userData.editorId&&/(?:cubierta|techo|ceiling|roof|luminaria)/i.test(n.name))return;}
    source.updateWorldMatrix(true,false);const g=source.geometry;if(!g.boundingBox)g.computeBoundingBox();if(!g.boundingBox||g.boundingBox.isEmpty())return;
    box.copy(g.boundingBox).applyMatrix4(source.matrixWorld);box.getSize(size);const area=size.x*size.z;if(area<.003&&Math.max(size.x,size.z)<.12)return;
    candidates.push({source,area,floor:size.x>6&&size.z>6&&size.y<.55});
   });
   const cap=this.ctx.graphics&&this.ctx.graphics.hints&&this.ctx.graphics.hints.standaloneXR?160:320;
   candidates.sort((a,b)=>b.area-a.area);const selected=candidates.slice(0,cap),keep=new Set(selected.map(row=>row.source));
   for(const [source,row]of this.rows)if(!keep.has(source)){this.scene.remove(row.mesh);this.rows.delete(source);}
   for(const row of selected){const source=row.source,materials=(Array.isArray(source.material)?source.material:[source.material]).map(m=>this.material(m,row.floor));let saved=this.rows.get(source);
    if(saved&&saved.mesh.geometry!==source.geometry){this.scene.remove(saved.mesh);this.rows.delete(source);saved=null;}
    if(!saved){const material=Array.isArray(source.material)?materials:materials[0],mesh=source.isInstancedMesh?new THREE.InstancedMesh(source.geometry,material,source.count):new THREE.Mesh(source.geometry,material);mesh.name='Vista del plano · '+source.name;mesh.matrixAutoUpdate=false;mesh.renderOrder=source.renderOrder;mesh.raycast=()=>{};if(source.isInstancedMesh)mesh.instanceMatrix=source.instanceMatrix;this.scene.add(mesh);this.rows.set(source,{mesh});}
   }
   Object.assign(this.stats,{meshes:this.rows.size,candidates:candidates.length,maxMeshes:cap,truncated:candidates.length>cap});
  }
  for(const [source,row]of this.rows){source.updateWorldMatrix(true,false);row.mesh.visible=!!(source.parent&&source.layers.mask&&shown(source));row.mesh.matrix.copy(source.matrixWorld);row.mesh.matrixWorldNeedsUpdate=true;if(source.isInstancedMesh)row.mesh.count=source.count;}
  return this.scene;
 }
 getStats(){return {...this.stats};}
 dispose(){for(const row of this.rows.values())this.scene.remove(row.mesh);this.rows.clear();for(const material of this.materials.values())material.dispose();this.materials.clear();}
}
