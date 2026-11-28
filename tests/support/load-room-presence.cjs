'use strict';
const fs=require('node:fs'),path=require('node:path'),T=require('three');
const read=name=>fs.readFileSync(path.join(__dirname,'../../packages/tools/collaboration/src',name+'.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export \{.*\} from .*;\r?\n/gm,'').replace(/^export /gm,'').replace('default class','class');
const dom={createElement:()=>({width:0,height:0,getContext:()=>null})};
const tracking=new Function('THREE',read('AvatarTracking')+'\nreturn{validPose,validPresence,HAND_JOINTS,BODY_JOINTS,capturePresence,captureXRBody};')(T);
const {validPose,validPresence,HAND_JOINTS,BODY_JOINTS}=tracking;
const {HUMAN_AVATARS,humanChoice}=new Function('THREE',read('HumanAvatarAssets')+'\nreturn{HUMAN_AVATARS,humanChoice};')(T);
const renderSource=name=>fs.readFileSync(path.join(__dirname,'../../packages/render-three/src',name+'.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'').replace('default class','class');
const XRHandPose=new Function('THREE',renderSource('XRHandPose')+'\nreturn XRHandPose;')(T);
const XRHandMesh=new Function('THREE','handMeshes','XRHandPose',renderSource('XRHandMesh')+'\nreturn XRHandMesh;')(T,require('../../packages/render-three/src/hand-meshes.json'),XRHandPose);
// Texture appearance is verified in Chrome. The Node adapter parses the real
// GLB hierarchy, mesh, skin and inverse-bind accessors without a GPU.
const exampleSource=name=>fs.readFileSync(require.resolve('three/examples/jsm/'+name+'.js'),'utf8').replace(/import\s*\{([\s\S]*?)\}\s*from\s*[^;]+;/g,(_,names)=>'const {'+names.replace(/Math as _Math/,'Math:_Math')+'}=THREE;').replace(/export \{ \w+ \};/,'');
const GLTFLoader=new Function('THREE','window',exampleSource('loaders/GLTFLoader')+'\nreturn GLTFLoader;')(T,{URL});
const SkeletonUtils=new Function('THREE',exampleSource('utils/SkeletonUtils')+'\nreturn SkeletonUtils;')(T);
async function acquireHuman(id){
 const bytes=fs.readFileSync(path.join(__dirname,'../../packages/tools/collaboration/assets/humans',id+'.glb')),size=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+size)),bin=bytes.subarray(28+size);delete json.images;delete json.textures;for(const m of json.materials||[]){delete m.pbrMetallicRoughness.baseColorTexture;delete m.normalTexture;delete m.emissiveTexture;delete m.occlusionTexture;}
 const data=Buffer.from(JSON.stringify(json)),pad=Buffer.concat([data,Buffer.alloc((4-data.length%4)%4,32)]),glb=Buffer.alloc(28+pad.length+bin.length);glb.writeUInt32LE(0x46546c67,0);glb.writeUInt32LE(2,4);glb.writeUInt32LE(glb.length,8);glb.writeUInt32LE(pad.length,12);glb.writeUInt32LE(0x4e4f534a,16);pad.copy(glb,20);glb.writeUInt32LE(bin.length,20+pad.length);glb.writeUInt32LE(0x004e4942,24+pad.length);bin.copy(glb,28+pad.length);
 const asset=await new Promise((resolve,reject)=>new GLTFLoader().parse(glb.buffer.slice(glb.byteOffset,glb.byteOffset+glb.length),'',resolve,reject)),model=SkeletonUtils.clone(asset.scene);return{model,release(){if(model.parent)model.parent.remove(model);model.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.skeleton&&o.skeleton.boneTexture)o.skeleton.boneTexture.dispose();});}};
}
const {createAvatarRig}=new Function('THREE','acquireHuman','humanChoice','XRHandMesh','HAND_JOINTS','BODY_JOINTS',read('AvatarRig')+'\nreturn{createAvatarRig};')(T,acquireHuman,humanChoice,XRHandMesh,HAND_JOINTS,BODY_JOINTS);
const {PresenceAvatar}=new Function('THREE','document','createAvatarRig','validPose','validPresence',read('PresenceAvatar')+'\nreturn{PresenceAvatar};')(T,dom,createAvatarRig,validPose,validPresence);
const RoomMedia=new Function('validPose','validPresence',read('RoomMedia')+'\nreturn RoomMedia;')(validPose,validPresence);
const RoomVisuals=new Function('THREE','validPose','productIdentity',read('RoomVisuals')+'\nreturn RoomVisuals;')(T,validPose,p=>p.sourceEntry&&p.sourceEntry.id||p.object.uuid);
module.exports={PresenceAvatar,validPose,RoomMedia,RoomVisuals,createAvatarRig,XRHandMesh,...tracking};
