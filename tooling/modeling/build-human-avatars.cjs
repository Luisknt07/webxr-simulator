'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),resources=path.join(root,'data/avatar-research/blender-user');fs.mkdirSync(resources,{recursive:true});
const result=spawnSync(process.env.STUDIO_BLENDER||'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe',['--background','--factory-startup','--disable-autoexec','--python-exit-code','1','--python',path.join(__dirname,'build-human-avatars.py')],{cwd:root,windowsHide:true,encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024,env:{...process.env,BLENDER_USER_RESOURCES:resources,PYTHONWARNINGS:'ignore::DeprecationWarning'}});
fs.writeFileSync(path.join(root,'data/avatar-research/build.log'),(result.stdout||'')+'\n'+(result.stderr||''));
if(result.error||result.status!==0)throw Error('Human avatar build failed: '+(result.error||result.stderr));
for(const line of result.stdout.split('\n'))if(line.startsWith('BUILT_AVATAR '))console.log(line.slice(13));
