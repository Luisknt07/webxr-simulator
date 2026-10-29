'use strict';
// Catalog logical names remain stable; physical ownership follows each module.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {readBlendThumbnail,thumbnailPng}=require('../maintenance/blend-thumbnail');
const ROOT=path.resolve(__dirname,'../..'),PREVIEWS='editor-previews';
const extensions={model:['glb','gltf','obj','fbx'],image:['basis','png','jpg','jpeg','gif','webp','svg','bmp','avif'],audio:['ogg','mp3','wav','m4a','aac','flac'],video:['mp4','webm','mov'],text:['json','js','txt','md','csv','xml','mtl','font'],source:['blend','blend1','blend2']};
function generateCatalog(root){
 const custom=root!==undefined;
 const sources=custom?[{directory:path.resolve(root),prefix:''}]:[
  {directory:path.join(ROOT,'modules/turismo/assets'),prefix:''},
  {directory:path.join(ROOT,'modules/logistica-industrial/assets/blender'),prefix:'blender/'},
  {directory:path.join(ROOT,'modules/logistica-industrial/assets/materials'),prefix:'materials/'}];
 const outputPath=custom?path.join(path.resolve(root),'editor-catalog.json'):path.join(ROOT,'packages/tools/editor/assets/catalog.json');
 const previews=custom?path.join(path.resolve(root),PREVIEWS):path.join(ROOT,'packages/tools/editor/assets/previews');
 const entries=[],physical=new Map();
 function visit(directory,prefix,atRoot){
  for(const item of fs.readdirSync(directory,{withFileTypes:true})){
   const absolute=path.join(directory,item.name);
   if(item.isSymbolicLink()||absolute===outputPath||atRoot&&['editor-catalog.json',PREVIEWS,'scene-thumbnails','ai','public-scenes'].includes(item.name))continue;
   const logical=prefix+item.name;
   if(item.isDirectory()){visit(absolute,logical+'/',false);continue;}if(!item.isFile())continue;
   if(physical.has(logical))throw Error('Dos m?dulos declaran el mismo recurso l?gico: '+logical);
   const extension=path.extname(item.name).slice(1).toLowerCase(),kind=Object.keys(extensions).find(key=>extensions[key].includes(extension))||'other';
   physical.set(logical,absolute);entries.push({path:logical,name:item.name,extension,size:fs.statSync(absolute).size,kind});
  }
 }
 for(const source of sources){const stat=fs.lstatSync(source.directory);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('La ra?z de recursos debe ser un directorio real.');visit(source.directory,source.prefix,true);}
 entries.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 const models=entries.filter(entry=>['glb','gltf'].includes(entry.extension));
 for(const entry of entries){
  if(entry.kind!=='source')continue;
  const basename=entry.name.slice(0,-entry.extension.length-1).toLowerCase();
  const matches=models.filter(model=>{const name=model.name.slice(0,-model.extension.length-1).toLowerCase();return name===basename||name===basename+'.min';});
  if(matches.length===1)entry.previewPath=matches[0].path;
  const thumbnail=readBlendThumbnail(physical.get(entry.path));if(!thumbnail)continue;
  const name='blend_'+crypto.createHash('sha1').update(entry.path).digest('hex').slice(0,16)+'.png',png=thumbnailPng(thumbnail),destination=path.join(previews,name);
  fs.mkdirSync(previews,{recursive:true});if(!fs.existsSync(destination)||!fs.readFileSync(destination).equals(png))fs.writeFileSync(destination,png);
  entry.thumbnailPath=PREVIEWS+'/'+name;
 }
 fs.mkdirSync(path.dirname(outputPath),{recursive:true});fs.writeFileSync(outputPath,JSON.stringify(entries,null,2)+'\n');return entries;
}
if(require.main===module){const entries=generateCatalog();console.log('Cat?logo modular del editor: '+entries.length+' recursos incluidos.');}
module.exports={generateCatalog};
