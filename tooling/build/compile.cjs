'use strict';
const fs=require('node:fs'),path=require('node:path'),webpack=require('webpack');
const ROOT=path.resolve(__dirname,'../..'),all=require('./webpack.config.cjs'),requested=process.argv.slice(2),selected=requested.length?all.filter(config=>requested.includes(config.name)):all;
if(!selected.length||requested.some(name=>!all.some(config=>config.name===name)))throw Error('Choose public-viewer, workspace, core-empty or geometry-workers.');
webpack(selected).run((error,stats)=>{
 const directory=path.join(ROOT,'data/build');fs.mkdirSync(directory,{recursive:true});
 if(error){console.error(error.stack);process.exitCode=1;return;}
 const json=stats.toJson({all:false,hash:true,name:true,assets:true,modules:true,nestedModules:true,errors:true,errorDetails:true,warnings:true,children:true,timings:true});
 const children=json.children||[json];
 if(stats.hasErrors()){fs.writeFileSync(path.join(directory,'failed-compilation.json'),JSON.stringify(json));for(const child of children)for(const problem of child.errors||[])console.error((child.name||'build')+': '+String(problem).split('\n').slice(0,9).join('\n'));process.exitCode=1;return;}
 const file=path.join(directory,'webpack-stats.json');let previous={children:[]};try{previous=JSON.parse(fs.readFileSync(file,'utf8'));}catch(_){}
 const names=new Set(children.map(child=>child.name));const merged={errors:[],children:[...(previous.children||[]).filter(child=>!names.has(child.name)),...children]};fs.writeFileSync(file,JSON.stringify(merged));
 for(const child of children)console.log(child.name+': '+child.assets.filter(asset=>asset.name.endsWith('.js')).map(asset=>asset.name+' '+asset.size+' bytes').join(', '));
});
