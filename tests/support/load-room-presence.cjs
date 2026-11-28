'use strict';
const fs=require('node:fs'),path=require('node:path'),T=require('three');
const read=name=>fs.readFileSync(path.join(__dirname,'../../packages/tools/collaboration/src',name+'.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'').replace('default class','class');
const dom={createElement:()=>({width:0,height:0,getContext:()=>null})};
const {createAvatarRig}=new Function('THREE',read('AvatarRig')+'\nreturn{createAvatarRig};')(T);
const {PresenceAvatar,validPose}=new Function('THREE','document','createAvatarRig',read('PresenceAvatar')+'\nreturn{PresenceAvatar,validPose};')(T,dom,createAvatarRig);
const RoomMedia=new Function('validPose',read('RoomMedia')+'\nreturn RoomMedia;')(validPose);
const RoomVisuals=new Function('THREE','validPose','productIdentity',read('RoomVisuals')+'\nreturn RoomVisuals;')(T,validPose,p=>p.sourceEntry&&p.sourceEntry.id||p.object.uuid);
module.exports={PresenceAvatar,validPose,RoomMedia,RoomVisuals};
