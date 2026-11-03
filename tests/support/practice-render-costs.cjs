'use strict';

// Renderer-independent upper bound for the supplied authored roots. Follow
// WebGLRenderer's material-array/group rule, and do not bill hidden replaced
// factory bodies as draws. Resident allocations remain a separate measurement.
module.exports=function renderCosts(roots,options={}){
 const validate=options.validate||(()=>{}),seen=new Set(),checked=new Set();
 const visibleMaterials=new Set(),visibleTextures=new Set(),visibleGeometries=new Set();
 const residentMaterials=new Set(),residentTextures=new Set(),residentGeometries=new Set();
 let meshes=0,triangles=0,drawCalls=0,residentMeshes=0,lights=0,physicalMeshes=0;
 const visible=node=>{for(let p=node;p;p=p.parent)if(p.visible===false||p.userData&&p.userData.editorGeometryReplaced)return false;return true;};
 const textureSet=(material,set)=>{for(const value of Object.values(material))if(value&&value.isTexture)set.add(value);};
 for(const root of roots){root.updateWorldMatrix(true,true);root.traverse(node=>{
  if(seen.has(node))return;seen.add(node);
  if(node.isLight&&visible(node))lights++;
  if(!node.isMesh||!node.geometry)return;
  residentMeshes++;residentGeometries.add(node.geometry);
  const list=Array.isArray(node.material)?node.material:[node.material];
  for(const material of list)if(material){residentMaterials.add(material);textureSet(material,residentTextures);}
  if(!visible(node)||node.layers&&node.layers.mask===0)return;
  validate(node.matrixWorld.elements.every(Number.isFinite),'Visible native world transform is finite.');
  const geometry=node.geometry,position=geometry.attributes&&geometry.attributes.position;
  validate(!!position&&position.count>0,'A visible native mesh needs finite vertices.');
  if(!checked.has(geometry)){
   checked.add(geometry);
   for(const name of ['position','normal','uv'])if(geometry.attributes[name])for(const value of geometry.attributes[name].array)validate(Number.isFinite(value),'Finite native '+name+'.');
   if(geometry.index)for(const index of geometry.index.array)validate(Number.isInteger(index)&&index>=0&&index<position.count,'Native index bounds.');
  }
  const total=geometry.index?geometry.index.count:position.count,start=Math.max(0,geometry.drawRange.start||0),end=Math.min(total,start+geometry.drawRange.count),instances=node.isInstancedMesh?node.count:1;
  let nodeDraws=0,nodeTriangles=0;
  const draw=(material,groupStart,groupCount)=>{
   if(!material||material.visible===false)return;
   const count=Math.max(0,Math.min(end,groupStart+groupCount)-Math.max(start,groupStart));if(count<=0)return;
   // A transparent DoubleSide material can require two passes unless explicitly
   // forceSinglePass. None of the budget assumptions suppresses those passes.
   const passes=material.transparent&&material.side===2&&material.forceSinglePass!==true?2:1;
   nodeDraws+=passes;nodeTriangles+=count/3*instances*passes;
   visibleMaterials.add(material);textureSet(material,visibleTextures);
  };
  if(Array.isArray(node.material))for(const group of geometry.groups||[])draw(list[group.materialIndex],group.start,group.count);
  else draw(list[0],0,total);
  if(!nodeDraws)return;
  meshes++;drawCalls+=nodeDraws;triangles+=nodeTriangles;visibleGeometries.add(geometry);
  if(options.physicalMesh&&options.physicalMesh(node))physicalMeshes++;
 });}
 return{triangles,drawCalls,meshes,materials:visibleMaterials.size,textures:visibleTextures.size,geometries:visibleGeometries.size,physicalMeshes,lights,resident:{meshes:residentMeshes,hiddenOrUndrawnMeshes:residentMeshes-meshes,materials:residentMaterials.size,textures:residentTextures.size,geometries:residentGeometries.size}};
};
