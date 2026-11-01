import {normalizeModel,createPart,MODEL_FORMAT} from './shared/model.mjs';
import {compileModel} from './shared/geometry.mjs';
import {createTemplate} from './shared/templates.mjs';
import {renderSVG} from './shared/render.mjs';

export const id='anatomy',version=1;
export {normalizeModel,compileModel};
const copy=value=>JSON.parse(JSON.stringify(value));
const label=(value,fallback)=>String(value||fallback).replace(/[<>\x00-\x1f\x7f]/g,'').trim().slice(0,160)||fallback;

/** Reopen a complete assembly from per-part portable source. Only data is
 * combined; source metadata is never a code/module/URL registration. */
export function createModel({selection=null,sources=[]}={}){
 const parts=[],groups=new Map();let base=null;
 for(const source of sources){
  if(!source||source.tool!==id||source.version!==version||!source.document)continue;
  const model=normalizeModel(source.document);if(!base)base=model;
  for(const part of model.parts){if(parts.some(other=>other.id===part.id))throw Error('El diseño contiene identificadores de piezas repetidos.');parts.push(part);}
  for(const group of model.groups){if(groups.has(group.id)&&JSON.stringify(groups.get(group.id))!==JSON.stringify(group))throw Error('Los grupos del diseño no coinciden.');groups.set(group.id,group);}
 }
 if(base)return normalizeModel({...base,parts,groups:[...groups.values()]});
 if(selection&&Array.isArray(selection.parts)&&selection.parts.length){
  const model={format:MODEL_FORMAT,version:1,units:'m',name:label(selection.name,'Variante de objeto'),groups:[],view:{theme:'dark',mode:'solid',projection:'isometric',explode:0},parts:selection.parts.map((part,index)=>createPart('mesh',{id:'part-'+(index+1),name:label(part.name,'Componente '+(index+1)),parameters:{positions:part.positions},position:[0,0,0],rotation:[0,0,0],material:normalizeMaterial(part.material||{}),visible:part.visible!==false,explode:[(index%3-1)*.2,.08+index*.04,0]}))};
  compileModel(model);return normalizeModel(model);
 }
 return createTemplate('robot');
}

export function normalizeMaterial(value){return createPart('box',{material:value}).material;}

/** Real, reconstructible CAD input. Poses are returned separately and applied
 * by the host once. Each piece carries only its own source to avoid Nx copies
 * of a complete assembly; groups can be reconstructed without the tool. */
export function descriptors(value,{assemblyId='design-anatomy'}={}){
 if(typeof assemblyId!=='string'||!/^[a-zA-Z][a-zA-Z0-9_-]{0,119}$/.test(assemblyId))throw Error('Identificador de conjunto inválido.');
 const compiled=compileModel(value),model=compiled.model,sourceById=new Map(model.parts.map(part=>[part.id,part])),groupsById=new Map(model.groups.map(group=>[group.id,group]));
 return {model,stats:compiled.stats,parts:compiled.parts.map(part=>{
  const original=sourceById.get(part.id),needed=new Set();let groupId=original.groupId;
  // Each independently portable part needs its own motion chain, not every
  // unrelated group in the assembly. Retain declaration order within that
  // chain so parent/child motion and later assembly merging stay deterministic.
  while(groupId){needed.add(groupId);groupId=groupsById.get(groupId).parentId;}
  const positions=part.positions.slice(),source={format:model.format,version:model.version,units:model.units,name:model.name,parts:[copy(original)],groups:copy(model.groups.filter(group=>needed.has(group.id))),view:copy(model.view)};
  return {id:part.id,name:part.name,position:part.position.slice(),rotation:part.rotation.slice(),material:copy(part.material),visible:part.visible,
   descriptor:{type:'cad',recipe:{version:1,steps:[{id:'s1',op:'primitive.mesh',params:{positions:positions.slice()},inputs:[]}],output:'s1'},mesh:{positions},color:part.material.color,smoothingAngle:45,sourceData:{tool:id,version,assemblyId,partId:part.id,document:source}}};
 })};
}

/** Parent-owned export: projects and the child frame cannot send executable
 * SVG/HTML to the asset library through this bridge. */
export function exportFiles(value){
 const model=normalizeModel(value);compileModel(model);
 const stem=label(model.name,'diseno').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80)||'diseno';
 const json=JSON.stringify(model,null,2),svg=renderSVG(model,{width:1400,height:1000,mode:'2d',explode:model.view.explode,theme:model.view.theme});
 if(json.length>16*1024*1024||svg.length>24*1024*1024)throw Error('El diseño exportado excede el tamaño de archivo permitido.');
 return [{name:stem+'.anatomy.json',mime:'application/json',text:json},{name:stem+'.svg',mime:'image/svg+xml',text:svg}];
}

export default {id,version,normalizeModel,compileModel,createModel,descriptors,exportFiles,normalizeMaterial};
