'use strict';
const path=require('node:path'),fs=require('node:fs'),{spawnSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'../..');
function run(file,args=[]){const value=spawnSync(process.execPath,[file,...args],{cwd:ROOT,stdio:'inherit',windowsHide:true});if(value.error)throw value.error;if(value.status!==0)process.exit(value.status||1);}
run(path.join(ROOT,'tooling/assets/generate-public-scenes.js'));
run(path.join(ROOT,'tooling/assets/generate-asset-catalog.js'));
const flags=Number(process.versions.node.split('.')[0])>=17?['--openssl-legacy-provider']:[];
const result=spawnSync(process.execPath,[...flags,path.join(__dirname,'compile.cjs')],{cwd:ROOT,stdio:'inherit',windowsHide:true});if(result.error)throw result.error;
if(result.status!==0)process.exit(result.status||1);
run(path.join(__dirname,'package-apps.cjs'));
