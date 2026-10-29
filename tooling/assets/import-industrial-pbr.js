const __layout = require("../layout.cjs");
'use strict';
// Offline preparation only. The application never contacts these asset APIs.
const fs=require('node:fs'),path=require('node:path'),https=require('node:https'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const ROOT=__layout.map(path.resolve(__layout.oldDir("scripts/import-industrial-pbr.js"),'..')),CACHE=__layout.map(path.join(ROOT,'data/qa-studio/pbr-downloads')),OUT=__layout.map(path.join(ROOT,"modules/logistica-industrial/assets/materials/pbr"));
const UA='HelloStudio-PBR-Importer/1.0 (offline CC0 material preparation)';
const assets=[
 {key:'steel',provider:'ambientCG',id:'Metal032',label:'Acero cepillado y rayado'},
 {key:'paint',provider:'ambientCG',id:'PaintedMetal012',label:'Pintura industrial con microdesgaste'},
 {key:'cardboard',provider:'ambientCG',id:'Cardboard004',label:'Cartón kraft'},
 {key:'wood',provider:'Poly Haven',id:'wood_planks',label:'Madera industrial envejecida'},
 {key:'rubber',provider:'Poly Haven',id:'rubberized_track',label:'Caucho granulado'},
 {key:'vinyl',provider:'Poly Haven',id:'fabric_leather_01',label:'Tapicería y vinilo con grano'},
 {key:'concrete',provider:'Poly Haven',id:'concrete_floor',label:'Hormigón con poros y desgaste'}
];
function get(url,depth=0){return new Promise((resolve,reject)=>{if(depth>5)return reject(Error('Too many redirects.'));const parsed=new URL(url);if(parsed.protocol!=='https:'||!['ambientcg.com','api.polyhaven.com','dl.polyhaven.org','cdn.polyhaven.com','acg-download.struffelproductions.com'].some(host=>parsed.hostname===host))return reject(Error('Unexpected asset host: '+parsed.hostname));const req=https.get(url,{headers:{'User-Agent':UA}},r=>{if(r.statusCode>=300&&r.statusCode<400){r.resume();return get(new URL(r.headers.location,url).href,depth+1).then(resolve,reject);}if(r.statusCode!==200){r.resume();return reject(Error('Asset HTTP '+r.statusCode+': '+url));}const chunks=[];let size=0;r.on('data',c=>{size+=c.length;if(size>25*1024*1024){req.destroy(Error('Asset exceeds offline preparation budget.'));return;}chunks.push(c);});r.on('end',()=>resolve(Buffer.concat(chunks)));r.on('error',reject);});req.setTimeout(60000,()=>req.destroy(Error('Asset download timeout.')));req.on('error',reject);});}
async function cached(url,file){if(fs.existsSync(file))return fs.readFileSync(file);const bytes=await get(url);fs.writeFileSync(file,bytes);return bytes;}
async function run(){fs.mkdirSync(CACHE,{recursive:true});fs.mkdirSync(OUT,{recursive:true});const jobs=[];
 for(const asset of assets){const source=asset.provider==='ambientCG'?'https://ambientcg.com/a/'+asset.id:'https://polyhaven.com/a/'+asset.id;asset.source=source;asset.license='CC0-1.0';asset.maps={};
  if(asset.provider==='ambientCG'){
   const metadata=JSON.parse((await cached('https://ambientcg.com/api/v2/full_json?id='+asset.id+'&include=downloadData,dimensionsData',__layout.map(path.join(CACHE,asset.id+'.json')))).toString()).foundAssets[0];if(!metadata||metadata.assetId!==asset.id)throw Error('Unknown ambientCG asset.');
   const download=metadata.downloadFolders.default.downloadFiletypeCategories.zip.downloads.find(f=>f.attribute==='1K-JPG');if(!download)throw Error('Missing 1K JPEG package.');const archive=__layout.map(path.join(CACHE,download.fileName));await cached(download.downloadLink,archive);asset.author='ambientCG / Lennart Demes';asset.archive={url:download.downloadLink,sha256:crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex')};
   jobs.push({key:asset.key,archive,assetId:asset.id});
  }else{
   const meta=JSON.parse((await cached('https://api.polyhaven.com/info/'+asset.id,__layout.map(path.join(CACHE,asset.id+'-info.json')))).toString());const files=JSON.parse((await cached('https://api.polyhaven.com/files/'+asset.id,__layout.map(path.join(CACHE,asset.id+'-files.json')))).toString());asset.author=Object.keys(meta.authors||{}).join(', ')||'Poly Haven';
   for(const [key,channel]of Object.entries({color:'Diffuse',normal:'nor_gl',roughness:'Rough'})){const item=files[channel]&&files[channel]['1k']&&files[channel]['1k'].jpg;if(!item)throw Error('Missing PBR channel '+channel);const input=__layout.map(path.join(CACHE,asset.key+'-'+key+'.jpg'));const bytes=await cached(item.url,input);asset.maps[key]={source:item.url,sourceSha256:crypto.createHash('sha256').update(bytes).digest('hex')};jobs.push({key:asset.key,channel:key,input});}
  }
  console.log('Prepared source:',asset.key,asset.provider,asset.id);
 }
 const jobfile=__layout.map(path.join(CACHE,'jobs.json'));fs.writeFileSync(jobfile,JSON.stringify(jobs));const child=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',__layout.map(path.join(__layout.oldDir("scripts/import-industrial-pbr.js"),'prepare-pbr-images.ps1')),'-JobFile',jobfile],{cwd:ROOT,windowsHide:true,stdio:'inherit'});if(child.status!==0)throw Error('Image preparation failed.');
 const stats=JSON.parse(fs.readFileSync(__layout.map(path.join(CACHE,'statistics.json')),'utf8').replace(/^\uFEFF/,''));assets.forEach(asset=>{asset.variants={};for(const edge of [256,512,1024]){asset.variants[edge]={};for(const channel of ['color','normal','roughness','neutral']){const name=asset.key+'-'+channel+'-'+edge+'.jpg',absolute=__layout.map(path.join(OUT,name)),bytes=fs.readFileSync(absolute);asset.variants[edge][channel]={path:"modules/logistica-industrial/assets/materials/pbr/"+name,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};}}asset.roughnessMean=stats[asset.key];});
 const manifest={version:1,license:'CC0-1.0',downloadedAt:new Date().toISOString(),sourcePolicy:'Offline copies; no runtime third-party requests.',assets};fs.writeFileSync(__layout.map(path.join(OUT,'manifest.json')),JSON.stringify(manifest,null,2)+'\n');fs.writeFileSync(__layout.map(path.join(OUT,'LICENSE.txt')),'CC0 1.0 Universal: https://creativecommons.org/publicdomain/zero/1.0/\n\nOffline materials from ambientCG and Poly Haven. Source URLs, authors and hashes are recorded in manifest.json.\nhttps://docs.ambientcg.com/license/\nhttps://polyhaven.com/license\n\n'+assets.map(a=>a.label+' — '+a.author+' — '+a.source).join('\n')+'\n');console.log('PBR library:',assets.length,'materials, 3 device sizes,',assets.reduce((sum,a)=>sum+Object.values(a.variants).reduce((s,v)=>s+Object.values(v).reduce((n,f)=>n+f.bytes,0),0),0),'bytes.');
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});module.exports={assets,get};
