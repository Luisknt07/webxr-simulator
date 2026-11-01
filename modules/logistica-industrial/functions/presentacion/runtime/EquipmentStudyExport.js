import * as THREE from 'three';
import {GLTFExporter} from 'three/examples/jsm/exporters/GLTFExporter.js';

const LIMITS={triangles:180000,meshes:2000,instances:1024};
function excluded(node,root){if(node!==root&&(node.userData.vehicleOwnerId||node.userData.robotOwnerId||node.userData.industrialProduct||node.industrialHeld))return true;const label=node.userData.industrialFinishOverlay&&node.userData.editorDecal;return !node.visible||node.userData.editorHelper||node.userData.editorRuntimeHelper&&!label||node.userData.editorGeometryReplaced||node.userData.industrialSensorVolume;}
function safeName(value,fallback){return String(value||fallback||'Componente').slice(0,180);}
function jointId(node){for(let current=node;current;current=current.parent){const data=current.userData||{},id=data.robotJointId||data.robotJoint;if(typeof id==='string'&&id)return id.slice(0,100);}return '';}
function componentId(node){for(let current=node;current;current=current.parent){const data=current.userData||{},id=data.equipmentComponentId||data.industrialComponentId||data.industrialMaterialPart;if(id)return String(id);}return String(node.uuid);}

/** A separate render/export snapshot of this exact hierarchy and current pose.
 * Source geometry/textures stay shared and read-only; cloned materials can be
 * highlighted safely. Never JSON-clone rig userData (it contains live objects). */
export function snapshotEquipment(object,options={}){
 if(!object||!object.isObject3D)throw Error('Selecciona un equipo existente.');
 object.updateWorldMatrix(true,true);const materials=new Map(),sourceByClone=new Map();let triangles=0,meshes=0;
 const materialOf=(source,node)=>{const actual=options.materialsByMesh&&options.materialsByMesh.get(node)||source;const clone=value=>{if(!value)return new THREE.MeshStandardMaterial({color:0x8998a2});if(!materials.has(value)){const copy=value.clone();copy.onBeforeCompile=value.onBeforeCompile;if(value.defines)copy.defines=Object.assign({},value.defines);if(value.surfaceWearMap)copy.surfaceWearMap=value.surfaceWearMap;copy.userData={};materials.set(value,copy);}return materials.get(value);};return Array.isArray(actual)?actual.map(clone):clone(actual);};
 const addMesh=(node,parent,matrix)=>{const geometry=node.geometry;if(!geometry||!geometry.attributes||!geometry.attributes.position)return;const count=geometry.index?geometry.index.count:geometry.attributes.position.count;triangles+=Math.floor(Math.min(count,(geometry.drawRange||{}).count===undefined?count:geometry.drawRange.count)/3);if(++meshes>LIMITS.meshes||triangles>LIMITS.triangles)throw Error('El modelo supera el presupuesto de estudio/exportación. Selecciona un equipo individual.');const mesh=new THREE.Mesh(geometry,materialOf(node.material,node));mesh.name=safeName(node.name,'Superficie');mesh.matrixAutoUpdate=false;mesh.matrix.copy(matrix);mesh.userData={componentId:componentId(node),equipmentComponentId:componentId(node),robotJointId:jointId(node),role:String(node.userData.industrialMaterialRole||'surface'),studyAccessoryLabel:!!(node.userData.industrialFinishOverlay&&node.userData.editorDecal)};parent.add(mesh);sourceByClone.set(mesh,node);};
 const walk=(node,parent,isRoot)=>{if(excluded(node,object))return;const group=new THREE.Group();group.name=safeName(node.name,isRoot?'Equipo':'Mecanismo');group.matrixAutoUpdate=false;group.matrix.copy(isRoot?new THREE.Matrix4().makeScale(object.scale.x,object.scale.y,object.scale.z):node.matrix);group.userData={componentId:componentId(node),equipmentComponentId:componentId(node),robotJointId:jointId(node)};parent.add(group);sourceByClone.set(group,node);
  if(node.isInstancedMesh){if(!Number.isSafeInteger(node.count)||node.count>LIMITS.instances)throw Error('Demasiadas instancias para exportar este equipo.');for(let i=0;i<node.count;i++){const matrix=new THREE.Matrix4();node.getMatrixAt(i,matrix);addMesh(node,group,matrix);}}
  else if(node.isMesh)addMesh(node,group,new THREE.Matrix4());
  node.children.forEach(child=>walk(child,group,false));
 };
 const root=new THREE.Group();root.name=safeName(object.name,'Equipo');try{walk(object,root,true);}catch(error){materials.forEach(material=>material.dispose());throw error;}root.updateMatrixWorld(true);
 return {root,triangles,meshes,sourceByClone,dispose(){materials.forEach(material=>material.dispose());materials.clear();sourceByClone.clear();root.clear?root.clear():root.children.slice().forEach(child=>root.remove(child));}};
}
/** Three r112's exporter accepts image/canvas sources, not DataTexture buffers.
 * Convert only the disposable snapshot maps, preserving the source textures and
 * their sampling transforms. Normal/roughness maps remain image data, not color. */
export function prepareExportTextures(snapshot,documentModel=typeof document!=='undefined'?document:null){
 const converted=new Map(),keys=['map','normalMap','metalnessMap','roughnessMap','aoMap','emissiveMap'];
 const dispose=()=>{converted.forEach(texture=>texture.dispose());converted.clear();};
 try{snapshot.root.traverse(mesh=>{if(!mesh.isMesh)return;for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])for(const key of keys){const texture=material&&material[key],image=texture&&texture.image;if(!texture||!image||!ArrayBuffer.isView(image.data))continue;if(!converted.has(texture)){
   if(!documentModel||!documentModel.createElement)throw Error('La exportación de texturas necesita un navegador con Canvas.');
   const width=image.width,height=image.height;if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0||width>2048||height>2048)throw Error('La textura supera el límite de exportación de 2048 px.');
   const channels=texture.format===THREE.RGBFormat?3:texture.format===THREE.AlphaFormat||texture.format===THREE.LuminanceFormat?1:texture.format===THREE.LuminanceAlphaFormat?2:texture.format===THREE.RGBAFormat?4:0;if(!channels||image.data.length<width*height*channels)throw Error('Formato de textura de datos no compatible con GLB.');
   if(![THREE.UnsignedByteType,THREE.FloatType,THREE.HalfFloatType].includes(texture.type))throw Error('El tipo de datos de esta textura necesita un bake de imagen antes de exportar.');
   const canvas=documentModel.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d');if(!context)throw Error('No se pudo convertir la textura de datos.');const pixels=context.createImageData(width,height),half=value=>{const sign=value&32768?-1:1,exponent=(value>>10)&31,fraction=value&1023;return exponent===0?sign*Math.pow(2,-14)*(fraction/1024):exponent===31?fraction?NaN:sign*Infinity:sign*Math.pow(2,exponent-15)*(1+fraction/1024);},byte=value=>{const number=texture.type===THREE.HalfFloatType?half(value):value;if(!Number.isFinite(number))throw Error('La textura contiene valores no finitos.');return Math.max(0,Math.min(255,Math.round(number*(texture.type===THREE.UnsignedByteType?1:255))));};
   for(let pixel=0;pixel<width*height;pixel++){const source=pixel*channels,target=pixel*4;if(texture.format===THREE.AlphaFormat){pixels.data[target]=pixels.data[target+1]=pixels.data[target+2]=255;pixels.data[target+3]=byte(image.data[source]);}else if(channels<3){pixels.data[target]=pixels.data[target+1]=pixels.data[target+2]=byte(image.data[source]);pixels.data[target+3]=channels===2?byte(image.data[source+1]):255;}else{pixels.data[target]=byte(image.data[source]);pixels.data[target+1]=byte(image.data[source+1]);pixels.data[target+2]=byte(image.data[source+2]);pixels.data[target+3]=channels===4?byte(image.data[source+3]):255;}}
   context.putImageData(pixels,0,0);const copy=texture.clone();copy.image=canvas;copy.format=THREE.RGBAFormat;copy.type=THREE.UnsignedByteType;converted.set(texture,copy);
  }material[key]=converted.get(texture);}});return dispose;}catch(error){dispose();throw error;}
}
export function exportEquipmentGLB(object,options={}){
 const snapshot=snapshotEquipment(object,options);let releaseTextures;
 const close=()=>{if(releaseTextures)releaseTextures();snapshot.dispose();};
 return new Promise((resolve,reject)=>{try{releaseTextures=prepareExportTextures(snapshot,options.document);new GLTFExporter().parse(snapshot.root,result=>{close();if(!(result instanceof ArrayBuffer)){reject(Error('No se pudo crear el archivo GLB.'));return;}resolve(result);},{binary:true,onlyVisible:true,trs:false,maxTextureSize:2048});}catch(error){close();reject(error);}});
}

/** Offline Blender bridge: metres, Y-up, local column-major matrices; no code.
 * Geometry buffers/material factors correspond to the exact native snapshot. */
export function equipmentPacket(object,options={}){
 const snapshot=snapshotEquipment(object,options),geometries=[],materials=[],nodes=[],geometryIds=new Map(),materialIds=new Map();
 const materialId=material=>{if(!materialIds.has(material)){const id='material-'+materials.length;materialIds.set(material,id);materials.push({id,name:safeName(material.name,'Material'),color:material.color?material.color.toArray():[.5,.5,.5],metalness:Number.isFinite(material.metalness)?material.metalness:0,roughness:Number.isFinite(material.roughness)?material.roughness:.6,opacity:material.opacity===undefined?1:material.opacity,side:material.side});}return materialIds.get(material);};
 try{const walk=(object,parent)=>{const id='node-'+nodes.length,node={id,parent,name:object.name,matrix:object.matrix.toArray(),componentId:object.userData.componentId||'',robotJointId:object.userData.robotJointId||'',role:object.userData.role||''};nodes.push(node);if(object.isMesh){const geometry=object.geometry;if(!geometryIds.has(geometry)){const id='geometry-'+geometries.length;geometryIds.set(geometry,id);const attributes={};for(const key of ['position','normal','uv'])if(geometry.attributes[key])attributes[key]={itemSize:geometry.attributes[key].itemSize,array:Array.from(geometry.attributes[key].array)};geometries.push({id,attributes,index:geometry.index?Array.from(geometry.index.array):null,groups:geometry.groups.map(group=>({...group})),drawRange:{start:geometry.drawRange.start||0,count:Number.isFinite(geometry.drawRange.count)?geometry.drawRange.count:null}});}node.geometry=geometryIds.get(geometry);node.materials=(Array.isArray(object.material)?object.material:[object.material]).map(materialId);}object.children.forEach(child=>walk(child,id));};walk(snapshot.root,null);return {format:'smarttwin.native-equipment',version:1,units:'m',upAxis:'Y',colorSpace:'linear-sRGB',name:safeName(object.name,'Equipo'),sourceId:String(object.userData.editorId||object.uuid),currentPose:true,counts:{triangles:snapshot.triangles,meshes:snapshot.meshes},nodes,geometries,materials};}finally{snapshot.dispose();}
}
export {LIMITS};
