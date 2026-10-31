'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const SCENE='vr-robot-dispatch',FILES=['index.html','viewer.js','viewer.css','config.js','cover.jpg',`projects/smarttwin/previews/${SCENE}.png`,`projects/smarttwin/scenes/${SCENE}.json`,'projects/smarttwin/scenes/catalog.json'];
FILES.push('packages/voice-assistant/voice-assistant.css',...['welcome','pickup','route','deposit','completed','safety'].map(id=>'packages/voice-assistant/assets/'+id+'.wav'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function verifyPublic(options={}){
 const root=fs.realpathSync(options.root||path.resolve(__dirname,'../..')),directory=path.join(root,'artifacts/public-viewer');
 if(fs.lstatSync(directory).isSymbolicLink())throw Error('Public artifact must be a real directory.');
 const manifest=JSON.parse(fs.readFileSync(path.join(directory,'publication.json'),'utf8'));
 if(manifest.format!=='smarttwin.publication'||manifest.application!=='public-viewer'||JSON.stringify(manifest.scenes)!==JSON.stringify([SCENE]))throw Error('Only the selected public scene may be published.');
 if(!Array.isArray(manifest.files)||JSON.stringify(manifest.files.map(row=>row.path).sort())!==JSON.stringify(FILES.slice().sort()))throw Error('Unexpected public file allowlist.');
 const actual=[];function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isSymbolicLink())throw Error('No links in public artifact.');if(e.isDirectory())walk(f);else if(e.isFile())actual.push(path.relative(directory,f).split(path.sep).join('/'));else throw Error('Unsupported public resource.');}}walk(directory);
 if(JSON.stringify(actual.sort())!==JSON.stringify(FILES.concat('publication.json').sort()))throw Error('Unlisted files cannot enter the public site.');
 let bytes=0;for(const row of manifest.files){const content=fs.readFileSync(path.join(directory,row.path));bytes+=content.length;if(hash(content)!==row.sha256)throw Error('Public resource hash mismatch: '+row.path);}
 if(hash(fs.readFileSync(path.join(directory,'viewer.js')))!==manifest.bundleSha256)throw Error('Public bundle hash mismatch.');
 const catalog=JSON.parse(fs.readFileSync(path.join(directory,'projects/smarttwin/scenes/catalog.json'),'utf8'));
 if(!Array.isArray(catalog.scenes)||JSON.stringify(catalog.scenes.map(s=>s.id))!==JSON.stringify([SCENE]))throw Error('The public catalog exposes additional scenes.');
 const snapshot=JSON.parse(fs.readFileSync(path.join(directory,`projects/smarttwin/scenes/${SCENE}.json`),'utf8')),project=snapshot.project;
 const keys=(object,allowed)=>object&&typeof object==='object'&&!Array.isArray(object)&&Object.keys(object).every(key=>allowed.includes(key));
 const document=project&&project.document,studio=document&&document.studio,access=project&&project.access;
 if(!keys(snapshot,['project'])||!keys(project,['id','name','revision','document','access','allowedRoomIds','publicSceneId'])||project.publicSceneId!==SCENE||!keys(access,['role','canEdit','canShare'])||access.role!=='public'||access.canEdit!==false||access.canShare!==false||!keys(document,['format','version','rooms','imports','studio'])||!Array.isArray(document.imports)||document.imports.length||!document.rooms||Object.keys(document.rooms).length!==1||!keys(studio,['version','environments','entities','spawns','missions','groups','startRoomId'])||JSON.stringify(project.allowedRoomIds)!==JSON.stringify(Object.keys(document.rooms)))throw Error('The public snapshot has private or editable content.');
 return {root,directory,manifest,files:actual.length,bytes};
}
module.exports={verifyPublic,SCENE,FILES};
if(require.main===module){const result=verifyPublic();console.log('Verified public viewer: '+result.files+' files, one scene, '+result.manifest.bundleSha256);}
