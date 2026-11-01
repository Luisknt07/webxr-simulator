'use strict';
const assert=require('node:assert/strict');
const {LIMITS,integer}=require('./glb-resources.cjs');
const identity=value=>typeof value==='string'&&value.length>0&&value.length<=180;
const finiteArray=(value,length)=>Array.isArray(value)&&value.length===length&&value.every(Number.isFinite);

/** Validate only the versioned packet emitted by EquipmentStudyExport. Resource
 * cost is computed per mesh node because Blender constructs a distinct mesh for
 * every instance, even when many nodes reference one small geometry record. */
function inspectPacket(packet){
 assert(packet&&packet.format==='smarttwin.native-equipment'&&packet.version===1&&packet.units==='m'&&packet.upAxis==='Y','Only a version 1 native equipment packet in metres/Y-up is supported.');
 const nodes=packet.nodes,geometries=packet.geometries,materials=packet.materials;
 assert(Array.isArray(nodes)&&nodes.length>0&&nodes.length<=4000&&Array.isArray(geometries)&&geometries.length<=2000&&Array.isArray(materials)&&materials.length<=2000,'Native packet exceeds the bounded component budget.');
 const nodeById=new Map(),geometryById=new Map(),materialById=new Map();
 const add=(map,row,label)=>{assert(row&&identity(row.id)&&!map.has(row.id),'Invalid or duplicate native '+label+' ID.');map.set(row.id,row);};
 for(const row of materials){add(materialById,row,'material');assert(typeof row.name==='string'&&finiteArray(row.color,3)&&row.color.every(value=>value>=0&&value<=1),'Invalid native material color.');for(const key of ['metalness','roughness','opacity'])assert(Number.isFinite(row[key])&&row[key]>=0&&row[key]<=1,'Invalid native material factor.');}
 let uniqueComponents=0;
 for(const row of geometries){
  add(geometryById,row,'geometry');const attributes=row.attributes,position=attributes&&attributes.position;
  assert(position&&position.itemSize===3&&Array.isArray(position.array)&&position.array.length>0&&position.array.length<=1800000&&position.array.length%3===0,'Invalid native position buffer.');const vertices=position.array.length/3;
  let components=0;for(const [key,size]of [['position',3],['normal',3],['uv',2]])if(attributes[key]){const attribute=attributes[key];assert(attribute.itemSize===size&&Array.isArray(attribute.array)&&attribute.array.length===vertices*size&&attribute.array.every(Number.isFinite),'Invalid native '+key+' buffer.');components+=attribute.array.length;}
  uniqueComponents+=components;assert(uniqueComponents<=LIMITS.accessorComponents,'Native packet decoding work exceeds the offline budget.');
  const indices=row.index;assert(indices===null||Array.isArray(indices),'Invalid native index buffer.');if(indices)assert(indices.length<=LIMITS.triangles*3&&indices.every(index=>integer(index)&&index<vertices),'Invalid native triangle indices.');
  const length=indices===null?vertices:indices.length,range=row.drawRange;assert(range&&integer(range.start)&&range.start<=length&&(range.count===null||integer(range.count)),'Invalid native draw range.');
  const count=range.count===null?length-range.start:Math.min(range.count,length-range.start);assert(range.start%3===0&&count>0&&count%3===0,'Invalid native triangle draw range.');
  assert(Array.isArray(row.groups)&&row.groups.length<=LIMITS.draws,'Invalid native material groups.');for(const group of row.groups)assert(group&&integer(group.start)&&integer(group.count)&&group.start%3===0&&group.count%3===0&&group.start+group.count<=length&&integer(group.materialIndex),'Invalid native material group.');
  geometryById.set(row.id,{row,vertices,components,triangles:count/3});
 }
 let triangles=0,draws=0,instancedComponents=0,meshNodes=0;
 for(const row of nodes){
  add(nodeById,row,'node');assert(typeof row.name==='string'&&finiteArray(row.matrix,16),'Invalid native local matrix.');assert(Math.abs(row.matrix[3])+Math.abs(row.matrix[7])+Math.abs(row.matrix[11])+Math.abs(row.matrix[15]-1)<1e-6,'Native local matrices must be affine.');
  assert(row.parent===null||identity(row.parent),'Invalid native parent ID.');for(const key of ['componentId','robotJointId','jointId'])if(row[key]!==undefined)assert(typeof row[key]==='string'&&row[key].length<=180,'Invalid native component identity.');
  if(row.geometry!==undefined){
   assert(identity(row.geometry)&&geometryById.has(row.geometry),'Missing native geometry reference.');const geometry=geometryById.get(row.geometry);assert(Array.isArray(row.materials)&&row.materials.length<=2000&&row.materials.every(id=>materialById.has(id)),'Missing native material reference.');
   // Three's single-material meshes ignore geometry group material indices
   // (CylinderGeometry still declares cap groups 1/2). They remain one draw.
   if(row.materials.length>1)for(const group of geometry.row.groups)assert(group.materialIndex<row.materials.length,'Native group references a missing material slot.');
   triangles+=geometry.triangles;draws+=row.materials.length<=1?1:Math.max(1,new Set(geometry.row.groups.map(group=>group.materialIndex)).size);instancedComponents+=geometry.components;meshNodes++;
   assert(triangles<=LIMITS.triangles&&draws<=LIMITS.draws&&instancedComponents<=LIMITS.accessorComponents&&meshNodes<=LIMITS.meshes,'Native instantiation work exceeds the offline budget.');
  }
 }
 assert(meshNodes>0,'A native equipment packet needs geometry.');for(const row of nodes)assert(row.parent===null||nodeById.has(row.parent),'Missing native parent reference.');
 const depths=new Map();for(const row of nodes){let current=row.id;const chain=[],path=new Set();while(current!==null&&!depths.has(current)){assert(!path.has(current),'Cyclic native component hierarchy.');path.add(current);chain.push(current);assert(chain.length<=256,'Native component hierarchy is too deep.');current=nodeById.get(current).parent;}let depth=current===null?0:depths.get(current);for(let i=chain.length-1;i>=0;i--){assert(++depth<=256,'Native component hierarchy is too deep.');depths.set(chain[i],depth);}}
 return {format:packet.format,triangles,draws,meshNodes,instancedComponents,components:nodes.map(row=>({name:row.name,id:row.componentId||'',joint:row.robotJointId||row.jointId||''})),staticValidationOnly:true};
}
module.exports={inspectPacket};
