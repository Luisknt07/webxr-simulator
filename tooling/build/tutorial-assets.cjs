'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const FOLDER='modules/logistica-industrial/practices/assets/tutorials';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function tutorialAssets(root){
 const manifest=FOLDER+'/cedi-01-guide.json',filename=path.join(root,manifest);
 if(!fs.existsSync(filename))return[];
 function read(name,limit){let current=root;for(const part of name.split('/')){current=path.join(current,part);if(fs.lstatSync(current).isSymbolicLink())throw Error('Linked tutorial asset.');}const stat=fs.statSync(current);if(!stat.isFile()||stat.size>limit)throw Error('Tutorial asset budget exceeded.');return fs.readFileSync(current);}
 const metadata=JSON.parse(read(manifest,128*1024));
 if(metadata.format!=='smarttwin.receiving-video-guide'||metadata.version!==1||metadata.practiceId!=='CEDI-01'||metadata.video?.src!==FOLDER+'/cedi-01-guide.mp4'||metadata.poster?.src!==FOLDER+'/cedi-01-guide-poster.jpg'||metadata.captions?.src!==FOLDER+'/cedi-01-guide.vtt'||metadata.captions?.language!=='es'||!Number.isFinite(metadata.video.duration)||metadata.video.duration<=0||metadata.video.duration>900)throw Error('Invalid receiving video guide.');
 const ids=['configuration',...Array.from({length:6},(_,i)=>'step-'+(i+1))];
 if(!Array.isArray(metadata.chapters)||metadata.chapters.length!==7)throw Error('The video guide needs configuration and six chapters.');
 let end=0;
 metadata.chapters.forEach((chapter,i)=>{if(chapter.id!==ids[i]||!Number.isFinite(chapter.start)||!Number.isFinite(chapter.end)||chapter.start!==end||chapter.end<=chapter.start||chapter.end>metadata.video.duration||typeof chapter.title!=='string'||!Array.isArray(chapter.transcript)||!chapter.transcript.length||chapter.transcript.some(p=>typeof p!=='string'||p.length>4000))throw Error('Invalid video chapter.');end=chapter.end;});
 if(Math.abs(end-metadata.video.duration)>.1)throw Error('Incomplete video chapters.');
 const expected=[['cedi-01-guide.mp4',32*1024*1024],['cedi-01-guide.vtt',128*1024],['cedi-01-guide-poster.jpg',1024*1024]];
 if(!Array.isArray(metadata.files)||metadata.files.length!==expected.length)throw Error('Missing video media receipt.');
 const names=expected.map(([name,limit],i)=>{const row=metadata.files[i],local=FOLDER+'/'+name;if(!row||row.path!==name||!Number.isSafeInteger(row.bytes)||row.bytes<8||row.bytes>limit||!/^[a-f0-9]{64}$/.test(row.sha256||''))throw Error('Invalid tutorial file receipt.');const bytes=read(local,limit);if(row.bytes!==bytes.length||row.sha256!==digest(bytes))throw Error('Tutorial asset differs from its receipt.');if(name.endsWith('.mp4')&&bytes.toString('ascii',4,8)!=='ftyp'||name.endsWith('.vtt')&&!bytes.toString('utf8').startsWith('WEBVTT')||name.endsWith('.jpg')&&!(bytes[0]===255&&bytes[1]===216&&bytes[2]===255))throw Error('Invalid tutorial media format.');return local;});
 return[manifest,...names];
}
module.exports={tutorialAssets,FOLDER};
