'use strict';
const assert=require('node:assert/strict');
// Input may be larger than the output profile so Blender can resize it, but
// parsing/image decoding must already have a finite offline resource budget.
const LIMITS={bytes:64*1024*1024,nodes:12000,meshes:4000,accessors:16000,views:20000,images:256,accessorCount:2000000,accessorComponents:32*1024*1024,triangles:1000000,draws:12000,textureEdge:4096,texturePixels:64*1024*1024};
const integer=(n,min=0)=>Number.isSafeInteger(n)&&n>=min;
const vector=(v,size)=>Array.isArray(v)&&v.length===size&&v.every(Number.isFinite);
function imageSize(bytes,mime){
 if(mime==='image/png'){
  assert(bytes.length>=33&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'Invalid embedded PNG signature.');
  assert(bytes.readUInt32BE(8)===13&&bytes.toString('ascii',12,16)==='IHDR','Invalid embedded PNG header.');
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);assert(width>0&&height>0,'Invalid embedded PNG dimensions.');return {width,height};
 }
 assert(mime==='image/jpeg','Only embedded PNG/JPEG images are supported.');assert(bytes.length>=4&&bytes[0]===255&&bytes[1]===216,'Invalid embedded JPEG signature.');
 let at=2;while(at<bytes.length){
  assert(bytes[at++]===255,'Invalid embedded JPEG marker.');while(at<bytes.length&&bytes[at]===255)at++;assert(at<bytes.length,'Truncated embedded JPEG.');const marker=bytes[at++];
  if(marker===217||marker===218)break;if(marker===1||(marker>=208&&marker<=215))continue;
  assert(at+2<=bytes.length,'Truncated embedded JPEG segment.');const length=bytes.readUInt16BE(at);assert(length>=2&&at+length<=bytes.length,'Invalid embedded JPEG segment.');
  if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){assert(length>=8,'Invalid embedded JPEG frame.');const width=bytes.readUInt16BE(at+5),height=bytes.readUInt16BE(at+3);assert(width>0&&height>0,'Invalid embedded JPEG dimensions.');return {width,height};}at+=length;
 }throw Error('Embedded JPEG has no supported size header.');
}
function resources(document,binary,profile){
 const nodes=document.nodes||[],meshes=document.meshes||[],accessors=document.accessors||[],views=document.bufferViews||[],images=document.images||[],buffers=document.buffers||[];
 for(const rows of [nodes,meshes,accessors,views,images,buffers])assert(Array.isArray(rows),'Invalid glTF collection.');
 assert(nodes.length<=LIMITS.nodes&&meshes.length<=LIMITS.meshes&&accessors.length<=LIMITS.accessors&&views.length<=LIMITS.views&&images.length<=LIMITS.images,'Equipment resource count exceeds the offline budget.');
 assert(buffers.every(b=>!b.uri),'Use embedded buffers.');assert(images.every(i=>!i.uri),'Use embedded textures, without external URLs.');
 assert(binary&&buffers.length===1&&integer(buffers[0].byteLength,1)&&buffers[0].byteLength<=binary.length&&binary.length-buffers[0].byteLength<=3,'Invalid embedded buffer length.');
 for(const view of views){assert(view&&view.buffer===0&&integer(view.byteLength,1)&&integer(view.byteOffset===undefined?0:view.byteOffset),'Invalid bufferView range or buffer reference.');assert((view.byteOffset||0)+view.byteLength<=buffers[0].byteLength,'BufferView exceeds the embedded buffer.');if(view.byteStride!==undefined)assert(integer(view.byteStride,4)&&view.byteStride<=252&&view.byteStride%4===0,'Invalid bufferView stride.');}
 let texturePixels=0;const textureDimensions=[];
 for(const image of images){
  assert(image&&integer(image.bufferView)&&views[image.bufferView],'An embedded texture needs a valid bufferView.');const view=views[image.bufferView],start=view.byteOffset||0,size=imageSize(binary.subarray(start,start+view.byteLength),image.mimeType),edge=profile&&profile.textureEdge||LIMITS.textureEdge;
  assert(size.width<=edge&&size.height<=edge,'Texture edge budget exceeded: '+size.width+'x'+size.height+'/'+edge+'.');texturePixels+=size.width*size.height;assert(texturePixels<=LIMITS.texturePixels,'Total decoded texture pixel budget exceeded.');textureDimensions.push(size);
 }
 const textures=document.textures||[];assert(Array.isArray(textures));for(const texture of textures)assert(texture&&integer(texture.source)&&images[texture.source],'Invalid embedded texture source.');
 for(const node of nodes){
  assert(node&&typeof node==='object','Invalid component node.');for(const [key,length]of [['matrix',16],['translation',3],['rotation',4],['scale',3]])if(node[key]!==undefined)assert(vector(node[key],length),'Invalid or nonfinite part transform: '+key);
  if(node.matrix){assert(node.translation===undefined&&node.rotation===undefined&&node.scale===undefined,'Use either matrix or TRS transforms.');assert(Math.abs(node.matrix[3])+Math.abs(node.matrix[7])+Math.abs(node.matrix[11])+Math.abs(node.matrix[15]-1)<1e-6,'Part matrices must be affine.');}
  if(node.rotation)assert(Math.abs(Math.hypot(...node.rotation)-1)<1e-4,'A part rotation quaternion must be normalized.');
 }
 const scenes=document.scenes||[];assert(Array.isArray(scenes)&&scenes.length>0,'Equipment needs a valid scene.');assert(integer(document.scene===undefined?0:document.scene)&&scenes[document.scene===undefined?0:document.scene],'Invalid active scene.');
 for(const scene of scenes){assert(Array.isArray(scene.nodes),'Invalid scene roots.');const roots=new Set();for(const root of scene.nodes){assert(integer(root)&&nodes[root]&&!roots.has(root),'Invalid scene root component.');roots.add(root);}}
 return {texturePixels,textureDimensions};
}
module.exports={resources,imageSize,LIMITS,integer};
