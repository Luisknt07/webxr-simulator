'use strict';
// Explicit, pinned, first-party input set. No SDK, hosted avatar account or CDN.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const SHA='0943055db6ec570bcef9f2c8b41c9e5467c808f9';
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'data/avatar-research/source');
const MODELS=['Female_Adult_07','Male_Adult_04','Female_Adult_04','Male_Adult_06'];
async function run(){
 const tree=await fetch('https://api.github.com/repos/microsoft/Microsoft-Rocketbox/git/trees/'+SHA+'?recursive=1').then(r=>{if(!r.ok)throw Error('Source tree: '+r.status);return r.json();});
 const paths=['LICENSE.md',...tree.tree.filter(row=>MODELS.some(name=>row.path.startsWith('Assets/Avatars/Adults/'+name+'/'))&&(/\/Export\/[^/]+\.fbx$/.test(row.path)&&!row.path.includes('_facial')||/\/Textures\/.*_(?:body_color|head_color|opacity_color)\.tga$/.test(row.path))).map(row=>row.path)];
 const receipts=[];
 await Promise.all(paths.map(async source=>{
  const file=path.join(OUT,source);fs.mkdirSync(path.dirname(file),{recursive:true});
  let bytes;if(fs.existsSync(file))bytes=fs.readFileSync(file);else{const r=await fetch('https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/'+SHA+'/'+source);if(!r.ok)throw Error(source+': '+r.status);bytes=Buffer.from(await r.arrayBuffer());fs.writeFileSync(file,bytes);}
  receipts.push({path:source,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});console.log(source+' '+bytes.length);
 }));
 receipts.sort((a,b)=>a.path.localeCompare(b.path));fs.writeFileSync(path.join(OUT,'sources.json'),JSON.stringify({repository:'https://github.com/microsoft/Microsoft-Rocketbox',commit:SHA,license:'MIT',files:receipts},null,2)+'\n');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
