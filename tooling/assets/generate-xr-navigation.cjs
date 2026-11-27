'use strict';
// Extract the repository's original navigation GLB without resampling its
// vertices/UVs. The tiny packet is bundled, so public XR needs no model fetch.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),root=path.resolve(__dirname,'../..');
const glb=fs.readFileSync(path.join(root,'modules/turismo/assets/teleport.glb')),length=glb.readUInt32LE(12),document=JSON.parse(glb.subarray(20,20+length).toString()),binary=glb.subarray(28+length),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function values(index){const a=document.accessors[index],v=document.bufferViews[a.bufferView],components={SCALAR:1,VEC2:2,VEC3:3}[a.type],width=a.componentType===5126?4:2,result=[];for(let i=0;i<a.count;i++)for(let j=0;j<components;j++){const offset=(v.byteOffset||0)+(a.byteOffset||0)+i*(v.byteStride||components*width)+j*width;result.push(a.componentType===5126?binary.readFloatLE(offset):binary.readUInt16LE(offset));}return result;}
const meshes={};for(const node of document.nodes){const p=document.meshes[node.mesh].primitives[0];meshes[node.name]={position:values(p.attributes.POSITION),uv:values(p.attributes.TEXCOORD_0),index:values(p.indices)};}
const texture=fs.readFileSync(path.join(root,'modules/turismo/assets/beamfx.png')),packet={format:'smarttwin.original-xr-navigation',version:1,source:'modules/turismo/assets/teleport.glb',sourceSha256:sha(glb),textureSource:'modules/turismo/assets/beamfx.png',textureSha256:sha(texture),texturePng:texture.toString('base64'),meshes};
fs.writeFileSync(path.join(root,'packages/render-three/src/original-navigation.json'),JSON.stringify(packet)+'\n');console.log('Original teleport: '+meshes.goal.index.length/3+' triangles; beam: '+meshes.beam.index.length/3+' triangles.');
