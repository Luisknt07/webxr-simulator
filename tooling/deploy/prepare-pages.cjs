'use strict';
const fs=require('node:fs'),path=require('node:path');
const {verifyPublic}=require('./verify-public.cjs');
function preparePages(options={}){
 const result=verifyPublic(options),target=path.join(result.root,'data/pages-site');
 for(const p of [path.dirname(target),target])if(fs.existsSync(p)&&(fs.lstatSync(p).isSymbolicLink()||!fs.statSync(p).isDirectory()))throw Error('Unsafe Pages staging path.');
 if(!path.resolve(target).startsWith(result.root+path.sep)||target!==path.join(result.root,'data/pages-site'))throw Error('Pages staging must stay inside this workspace.');
 if(fs.existsSync(target))fs.rmSync(target,{recursive:true});fs.mkdirSync(target,{recursive:true});
 for(const row of result.manifest.files){const output=path.join(target,row.path);fs.mkdirSync(path.dirname(output),{recursive:true});fs.copyFileSync(path.join(result.directory,row.path),output);}
 const revision=options.revision||process.env.GITHUB_SHA||result.manifest.revision;
 if(!/^[a-f0-9]{40}$/i.test(revision||''))throw Error('A verified commit revision is required.');
 const publication={...result.manifest,sourceRevision:result.manifest.revision,revision};
 fs.writeFileSync(path.join(target,'publication.json'),JSON.stringify(publication,null,2)+'\n');fs.writeFileSync(path.join(target,'.nojekyll'),'');
 return {...result,target,publication};
}
module.exports={preparePages};if(require.main===module){const r=preparePages();console.log('Pages: one public scene, '+r.files+' verified input files, '+r.publication.bundleSha256);}
