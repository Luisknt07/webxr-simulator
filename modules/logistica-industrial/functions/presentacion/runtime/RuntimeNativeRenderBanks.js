import * as THREE from 'three';

const KINDS=new Set(['robot','vehicle','conveyor','plc','processor','source','palletQueue','product']);
const MAX_SOURCES=2048,MAX_VERTICES=32768,MAX_BYTES=8*1024*1024;
const visible=object=>{for(let node=object;node;node=node.parent)if(node.visible===false||node.userData.editorGeometryReplaced)return false;return true;};
const within=(object,owner)=>{for(let node=object;node;node=node.parent)if(node===owner)return true;return false;};
const safeMaterial=material=>material&&!Array.isArray(material)&&material.visible!==false&&!material.transparent&&material.opacity===1&&!material.skinning&&!material.morphTargets&&!material.isShaderMaterial&&!material.isRawShaderMaterial&&!(material.clippingPlanes&&material.clippingPlanes.length)&&
 (material.onBeforeCompile===THREE.Material.prototype.onBeforeCompile||material.staticInstanceBatchShader===material.onBeforeCompile)&&
 Object.values(material).every(value=>!value||!value.isTexture||!value.isCanvasTexture&&!value.isVideoTexture&&!value.isRenderTargetTexture)&&!material.displacementMap;
const tintable=object=>{const m=object.material;return !object.geometry.attributes.color&&(m.isMeshStandardMaterial||m.isMeshBasicMaterial)&&!m.vertexColors&&!m.alphaTest&&m.onBeforeCompile===THREE.Material.prototype.onBeforeCompile&&(!m.emissive||m.emissive.getHex()===0)&&Object.values(m).every(value=>!value||!value.isTexture);};
const attrs=geometry=>Object.keys(geometry.attributes).sort();
const signature=geometry=>attrs(geometry).map(name=>{const a=geometry.attributes[name];return name+':'+a.itemSize+':'+a.normalized+':'+a.array.constructor.name;}).join('|');
const protectedSubtree=data=>data.editorHelper||data.editorRuntimeHelper||data.industrialAction||data.industrialButton||data.industrialDisplay||/vehicle\.(?:steering|controls)/.test(data.equipmentComponentId||'');
const rigidBoundary=(object,anchors)=>{const data=object.userData||{};return anchors.has(object)||data.robotJoint||/^vehicle\./.test(data.equipmentComponentId||'')||data.robotRig||data.vehicleRig||data.warehouseRackRig;};
function rigidPlacement(object,owner,excluded,anchors){
 let anchor=object.parent;const path=[];
 // Controls may animate their own parent, not just the visible button cap.
 // Such a subtree must remain independent even before its first animation.
 for(let node=object;node&&node!==owner;node=node.parent){const data=node.userData||{};if(excluded.has(node))return null;if(data.industrialAction){
   // Only the fixed, exact-material siblings immediately inside this single
   // button may share a draw. Its cap, labels and input owner remain separate.
   if(object.parent!==node)return null;return{anchor:node,path:[],matrix:object.matrix.clone(),control:true};
  }if(protectedSubtree(data))return null;}
 while(anchor!==owner&&anchor.parent&&!rigidBoundary(anchor,anchors)){path.unshift(anchor);anchor=anchor.parent;}
 const matrix=new THREE.Matrix4();for(const node of path){if(node.matrixAutoUpdate)node.updateMatrix();if(node.matrix.determinant()<=1e-12)return null;matrix.multiply(node.matrix);}matrix.multiply(object.matrix);
 return{anchor,path,matrix};
}
function collectRigAnchors(roots){
 const anchors=new Set(),seen=new Set();let count=0;
 const visit=(value,depth)=>{if(!value||typeof value!=='object'||seen.has(value)||depth>4||count++>4096)return;seen.add(value);if(value.isObject3D){anchors.add(value);return;}if(Array.isArray(value))value.forEach(item=>visit(item,depth+1));else if(Object.getPrototypeOf(value)===Object.prototype)Object.values(value).forEach(item=>visit(item,depth+1));};
 for(const root of roots)root.traverse(object=>{for(const key of['robotRig','vehicleRig','warehouseRackRig'])visit(object.userData[key],0);});return anchors;
}
function eligible(object){
 const data=object.userData||{},g=object.geometry;
 if(!object.isMesh||object.isInstancedMesh||object.isSkinnedMesh||!object.parent||!visible(object)||!object.layers.mask||object.morphTargetInfluences||object.customDepthMaterial||object.customDistanceMaterial||object.frustumCulled===false||
  object.onBeforeRender!==THREE.Object3D.prototype.onBeforeRender||object.onAfterRender!==THREE.Object3D.prototype.onAfterRender||
  data.editorHelper||data.editorRuntimeHelper||data.editorVisualOwnerId||data.industrialSensorVolume||data.industrialAction||data.industrialButton||data.industrialDisplay||data.vehiclePreserve&&/vehicle\.(?:steering|controls)/.test(data.equipmentComponentId||'')||data.vehicleDecal||data.vehicleForkTine||data.vehicleForkBlade||data.industrialSteerBank||data.robotContactSurface||data.robotCableEndpoints||data.industrialTower||data.industrialSensorLamp||
  (data.editorBehaviors||data.editorDefaultBehaviors||[]).length||!safeMaterial(object.material))return false;
 if(!g||!g.isBufferGeometry||g.isInstancedBufferGeometry||Object.keys(g.morphAttributes||{}).length||g.userData.industrialDynamicGeometry||g.userData.industrialSteerRest||g.drawRange.start!==0||!g.attributes.position||!g.attributes.normal||g.attributes.position.count>MAX_VERTICES)return false;
 const names=attrs(g);if(names.some(name=>!['position','normal','uv','uv2','color','tangent'].includes(name)||g.attributes[name].isInterleavedBufferAttribute||g.attributes[name].isInstancedBufferAttribute||g.attributes[name].usage===THREE.DynamicDrawUsage))return false;
 const total=g.index?g.index.count:g.attributes.position.count;if(g.drawRange.count!==Infinity&&g.drawRange.count!==total)return false;
 if(object.matrixAutoUpdate)object.updateMatrix();return object.matrix.determinant()>1e-12;
}
function geometryView(sources){
 const parts=sources.map(source=>{const geometry=source.object.geometry.clone();geometry.applyMatrix(source.placed);if(source.tint){const count=geometry.attributes.position.count,colors=new Float32Array(count*3),color=source.material.color;for(let n=0;n<count;n++){colors[n*3]=color.r;colors[n*3+1]=color.g;colors[n*3+2]=color.b;}geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));}return geometry;}),out=new THREE.BufferGeometry(),names=attrs(parts[0]);
 try{
  for(const name of names){const first=parts[0].attributes[name],count=parts.reduce((sum,g)=>sum+g.attributes[name].array.length,0),array=new first.array.constructor(count);let offset=0;for(const part of parts){array.set(part.attributes[name].array,offset);offset+=part.attributes[name].array.length;}out.setAttribute(name,new THREE.BufferAttribute(array,first.itemSize,first.normalized));}
  const count=parts.reduce((sum,g)=>sum+(g.index?g.index.count:g.attributes.position.count),0),indices=new Uint16Array(count);let vertex=0,index=0;
  for(const part of parts){const n=part.index?part.index.count:part.attributes.position.count;for(let i=0;i<n;i++)indices[index++]=vertex+(part.index?part.index.getX(i):i);vertex+=part.attributes.position.count;}
  out.setIndex(new THREE.BufferAttribute(indices,1));out.computeBoundingBox();out.computeBoundingSphere();return out;
 }catch(error){out.dispose();throw error;}finally{parts.forEach(g=>g.dispose());}
}

/** Reversible draw-only banks for static descendants under a rigid anchor.
 * Original meshes/materials/IDs remain the exact ray, collision, export and
 * study targets. Three r112 Raycaster ignores layers; mask zero suppresses
 * only rendering. Banks append after original children, never across joints.
 * Any individually animated source retires from banks until the next run.
 */
export default class RuntimeNativeRenderBanks {
 constructor(){this.sources=[];this.ancestors=[];this.materialStates=[];this.banks=[];this.roots=[];this.excluded=new WeakSet();this.ids=new WeakMap();this.nextId=1;this.version=null;this.stats={sources:0,banks:0,drawCallsAvoided:0,bufferBytes:0,rebuilds:0,checks:0};}
 id(value){if(!this.ids.has(value))this.ids.set(value,this.nextId++);return this.ids.get(value);}
 materialKey(material,tint=false){
  const seen=new Set(),value=(item,depth=0)=>{if(item===null||typeof item!=='object'&&typeof item!=='function')return item;if(typeof item==='function'||item.isTexture||depth>5||seen.has(item))return '@'+this.id(item);seen.add(item);const result=Array.isArray(item)?item.map(v=>value(v,depth+1)):Object.keys(item).sort().reduce((row,key)=>{row[key]=value(item[key],depth+1);return row;},{});seen.delete(item);return result;};
  // UUID/name are editor identity; all render fields, defines, user data and
  // exact texture/shader references still participate. Native originals keep
  // their own materials, so study/overrides never acquire shared ownership.
  return JSON.stringify(Object.keys(material).sort().filter(key=>!['uuid','name','version','_listeners'].includes(key)&&!(key==='userData'&&material.onBeforeCompile===THREE.Material.prototype.onBeforeCompile)&&(!tint||key!=='color')).map(key=>[key,value(material[key])]));
 }
 reset(){this.clear();this.roots=[];this.excluded=new WeakSet();this.version=null;}
 getStats(){return{...this.stats};}
 clear(){
  for(const row of this.sources)if(row.object.layers.mask===0)row.object.layers.mask=row.mask;
  for(const bank of this.banks){if(bank.parent)bank.parent.remove(bank);bank.geometry.dispose();if(bank.userData.nativePrivateMaterial)bank.material.dispose();}
  this.sources=[];this.ancestors=[];this.materialStates=[];this.banks=[];Object.assign(this.stats,{sources:0,banks:0,drawCallsAvoided:0,bufferBytes:0});
 }
 unchanged(roots,version){
  if(this.version!==version||roots.length!==this.roots.length||roots.some((root,i)=>root!==this.roots[i].object||root.children.length!==this.roots[i].children.length||root.children.some((child,n)=>child!==this.roots[i].children[n])))return false;
  this.stats.checks+=this.sources.length;
  for(const row of this.materialStates)if(this.materialKey(row.material)!==row.key)return false;
  for(const row of this.ancestors){const o=row.object;if(o.matrixAutoUpdate)o.updateMatrix();if(!o.matrix.equals(row.matrix)){this.excluded.add(o);return false;}if(o.parent!==row.parent||o.visible===false||protectedSubtree(o.userData||{}))return false;}
  for(const row of this.sources){const o=row.object,g=o.geometry;
   if(o.matrixAutoUpdate)o.updateMatrix();
   if(!o.matrix.equals(row.matrix)){this.excluded.add(o);return false;}
   // A hose/deforming buffer that was not tagged dynamic must retire too;
   // rebaking its entire rigid bank every animation frame would defeat this
   // optimization and allocate repeatedly on a standalone headset.
   if(g===row.geometry&&(g.index===row.index&&g.index&&g.index.version!==row.indexVersion||row.names.some((name,i)=>g.attributes[name]===row.attributes[i]&&g.attributes[name].version!==row.versions[i]))){this.excluded.add(o);return false;}
   if(o.parent!==row.parent||!within(o,row.owner)||!visible(o)||o.layers.mask!==0||o.geometry!==row.geometry||o.material!==row.material||!safeMaterial(o.material)||o.material.onBeforeCompile!==row.shader||o.castShadow!==row.castShadow||o.receiveShadow!==row.receiveShadow||o.renderOrder!==row.order||o.frustumCulled===false||
    o.onBeforeRender!==THREE.Object3D.prototype.onBeforeRender||o.onAfterRender!==THREE.Object3D.prototype.onAfterRender||o.customDepthMaterial||o.customDistanceMaterial||g.drawRange.start!==0||g.drawRange.count!==row.drawCount||g.index!==row.index||g.index&&g.index.version!==row.indexVersion||attrs(g).length!==row.names.length||row.names.some((name,i)=>g.attributes[name]!==row.attributes[i]||g.attributes[name].version!==row.versions[i]))return false;
  }return true;
 }
 sync(objects,{editing=false,enabled=true,version=0,staticObjects=[]}={}){
  if(editing||!enabled){if(this.sources.length)this.reset();return;}
  const native=objects.filter(object=>object&&KINDS.has(object.userData.editorPrefabKey)),staticRoots=staticObjects.slice(0,128).filter(object=>object&&object.parent&&object.userData.editorDescriptor&&object.userData.editorDescriptor.type==='cad'&&native.some(owner=>within(owner,object.parent))),roots=[...new Set(native.concat(staticRoots))],staticSet=new Set(staticRoots);
  if(this.unchanged(roots,version))return;
  this.clear();const groups=new Map(),seen=new Set(),owners=new Map(),placements=new Map(),tints=new Map(),materialKeys=new Map(),anchors=collectRigAnchors(roots);let count=0;
  for(const root of roots)root.traverse(object=>{
   if(count>=MAX_SOURCES||seen.has(object)||this.excluded.has(object)||!eligible(object))return;const owner=staticSet.has(root)?root.parent:root,placement=rigidPlacement(object,owner,this.excluded,anchors);if(!placement)return;seen.add(object);owners.set(object,owner);placements.set(object,placement);count++;
   if(!materialKeys.has(object.material))materialKeys.set(object.material,this.materialKey(object.material));const tint=!placement.control&&tintable(object);tints.set(object,tint);
   const key=[this.id(placement.anchor),tint?'tint:'+this.materialKey(object.material,true):'exact:'+materialKeys.get(object.material),object.layers.mask,object.castShadow,object.receiveShadow,object.renderOrder,signature(object.geometry)].join(':');
   if(!groups.has(key))groups.set(key,[]);groups.get(key).push(object);
  });
  for(const group of groups.values()){
   let chunk=[],vertices=0;
   const flush=()=>{
    if(chunk.length<2){chunk=[];vertices=0;return;}
    const rows=chunk.map(object=>({object,tint:tints.get(object),owner:owners.get(object),parent:object.parent,anchor:placements.get(object).anchor,path:placements.get(object).path,placed:placements.get(object).matrix,mask:object.layers.mask,matrix:object.matrix.clone(),geometry:object.geometry,material:object.material,shader:object.material.onBeforeCompile,castShadow:object.castShadow,receiveShadow:object.receiveShadow,order:object.renderOrder,drawCount:object.geometry.drawRange.count,index:object.geometry.index,indexVersion:object.geometry.index&&object.geometry.index.version,names:attrs(object.geometry),attributes:attrs(object.geometry).map(name=>object.geometry.attributes[name]),versions:attrs(object.geometry).map(name=>object.geometry.attributes[name].version)}));
    const geometry=geometryView(rows),bytes=Object.values(geometry.attributes).reduce((n,a)=>n+a.array.byteLength,geometry.index.array.byteLength);
    if(this.stats.bufferBytes+bytes>MAX_BYTES){geometry.dispose();chunk=[];vertices=0;return;}
    const first=rows[0],material=first.tint?first.material.clone():first.material;if(first.tint){material.color.setRGB(1,1,1);material.vertexColors=THREE.VertexColors;}
    const bank=new THREE.Mesh(geometry,material);bank.name='Presentación nativa · '+rows.length+' superficies';bank.userData={editorRuntimeHelper:true,nativeRenderBank:true,nativePrivateMaterial:first.tint};bank.castShadow=first.castShadow;bank.receiveShadow=first.receiveShadow;bank.renderOrder=first.order;bank.layers.mask=first.mask;bank.raycast=()=>{};
    first.anchor.add(bank);this.banks.push(bank);for(const row of rows){row.object.layers.mask=0;this.sources.push(row);}if(first.tint||rows.some(row=>row.material!==first.material))for(const sourceMaterial of new Set(rows.map(row=>row.material)))if(!this.materialStates.some(row=>row.material===sourceMaterial))this.materialStates.push({material:sourceMaterial,key:materialKeys.get(sourceMaterial)});this.stats.bufferBytes+=bytes;chunk=[];vertices=0;
   };
   for(const object of group){if(vertices+object.geometry.attributes.position.count>MAX_VERTICES)flush();chunk.push(object);vertices+=object.geometry.attributes.position.count;}flush();
  }
  const ancestors=new Map();for(const row of this.sources)for(const object of row.path)if(!ancestors.has(object))ancestors.set(object,{object,parent:object.parent,matrix:object.matrix.clone()});this.ancestors=Array.from(ancestors.values());
  this.version=version;this.roots=roots.map(object=>({object,children:object.children.slice()}));this.stats.sources=this.sources.length;this.stats.banks=this.banks.length;this.stats.drawCallsAvoided=this.sources.length-this.banks.length;this.stats.rebuilds++;
 }
 dispose(){this.reset();}
}
