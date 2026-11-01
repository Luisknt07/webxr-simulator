import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const require=createRequire(import.meta.url),{inspect}=require('../../tooling/modeling/validate-glb.cjs');
const {imageSize}=require('../../tooling/modeling/glb-resources.cjs');
const {inspectPacket}=require('../../tooling/modeling/validate-packet.cjs');
const profile={maxTriangles:1,maxDraws:1,maxBytes:10000};
function asset(change=()=>{},corrupt=()=>{}){
 const binary=Buffer.alloc(36);[0,0,0,1,0,0,0,1,0].forEach((n,i)=>binary.writeFloatLE(n,i*4));corrupt(binary);
 const json={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{name:'Actual native link',mesh:0,extras:{equipmentComponentId:'robot.upper-arm'}}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],accessors:[{bufferView:0,componentType:5126,type:'VEC3',count:3,min:[0,0,0],max:[1,1,0]}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36}],buffers:[{byteLength:36}]};change(json);
 let text=Buffer.from(JSON.stringify(json));text=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,0x20)]);const result=Buffer.alloc(12+8+text.length+8+binary.length);result.writeUInt32LE(0x46546c67);result.writeUInt32LE(2,4);result.writeUInt32LE(result.length,8);result.writeUInt32LE(text.length,12);result.writeUInt32LE(0x4e4f534a,16);text.copy(result,20);const at=20+text.length;result.writeUInt32LE(binary.length,at);result.writeUInt32LE(0x004e4942,at+4);binary.copy(result,at+8);return result;
}
test('native modeling validation reads actual vertex payload, component identity and transformed envelope',()=>{
 const r=inspect(asset(j=>{j.nodes[0].translation=[2,3,4];}),profile);assert.equal(r.triangles,1);assert.equal(r.draws,1);assert.deepEqual(r.bounds,{min:[2,3,4],max:[3,4,4]});assert.equal(r.components[0].id,'robot.upper-arm');assert(r.staticValidationOnly);
});
test('finite accessor metadata cannot hide corrupt or truncated real geometry',()=>{
 assert.throws(()=>inspect(asset(()=>{},b=>b.writeFloatLE(NaN,0))),/Nonfinite vertex/);
 assert.throws(()=>inspect(asset(j=>{j.accessors[0].count=6;})),/buffer out of bounds/);
 assert.throws(()=>inspect(asset(j=>{j.accessors.push({...j.accessors[0],count:2});j.meshes[0].primitives[0].attributes.NORMAL=1;})),/Mismatched vertex attribute count/);
 assert.throws(()=>inspect(asset(j=>{j.accessors.push({bufferView:0,componentType:5123,type:'SCALAR',count:3});j.meshes[0].primitives[0].indices=1;},b=>b.writeUInt16LE(99,0))),/Triangle index exceeds/);
 const bytes=asset();assert.throws(()=>inspect(bytes.subarray(0,bytes.length-4)),/Truncated/);
});
test('unsupported dependencies, cyclic hierarchy and silently overloaded machine assets fail validation',()=>{
 assert.throws(()=>inspect(asset(j=>{j.images=[{uri:'https://example.com/hidden-texture.jpg'}];})),/embedded textures/);
 assert.throws(()=>inspect(asset(j=>{j.extensionsRequired=['KHR_draco_mesh_compression'];})),/unsupported/);
 assert.throws(()=>inspect(asset(j=>{j.nodes[0].children=[0];})),/Cyclic/);
 assert.throws(()=>inspect(asset(j=>{j.nodes.push({mesh:0});}),profile),/Triangle budget/);
});

test('accessors cannot escape a bufferView into adjacent buffers or texture bytes',()=>{
 assert.throws(()=>inspect(asset(j=>{j.bufferViews[0].byteLength=1;})),/out of bounds of its bufferView/);
 assert.throws(()=>inspect(asset(j=>{j.bufferViews[0].buffer=99;})),/buffer reference/);
 assert.throws(()=>inspect(asset(j=>{j.bufferViews[0].byteOffset=32;})),/BufferView exceeds/);
 assert.throws(()=>inspect(asset(j=>{j.accessors[0].byteOffset=-4;})),/Invalid accessor count or offset/);
 assert.throws(()=>inspect(asset(j=>{j.accessors[0].count=1.5;})),/Invalid accessor count/);
 assert.throws(()=>inspect(asset(j=>{j.accessors.push({...j.accessors[0],bufferView:99});})),/missing accessor/);
 assert.throws(()=>inspect(asset(j=>{j.accessors=Array.from({length:6},()=>({...j.accessors[0],count:2000000}));})),/decoding work/);
});

function withImage(width,height,mime='image/png'){
 const old=asset(),jsonLength=old.readUInt32LE(12),doc=JSON.parse(old.subarray(20,20+jsonLength).toString().trim()),oldBinary=old.subarray(28+jsonLength);
 // Real tiny PNG payload; changing IHDR dimensions exercises the pre-decode
 // size gate without allocating a large decoded image in the test process.
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');png.writeUInt32BE(width,16);png.writeUInt32BE(height,20);
 const binary=Buffer.concat([oldBinary,png,Buffer.alloc((4-png.length%4)%4)]);doc.buffers[0].byteLength=oldBinary.length+png.length;doc.bufferViews.push({buffer:0,byteOffset:oldBinary.length,byteLength:png.length});doc.images=[{bufferView:1,mimeType:mime}];doc.textures=[{source:0}];
 let text=Buffer.from(JSON.stringify(doc));text=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,32)]);const result=Buffer.alloc(28+text.length+binary.length);result.writeUInt32LE(0x46546c67);result.writeUInt32LE(2,4);result.writeUInt32LE(result.length,8);result.writeUInt32LE(text.length,12);result.writeUInt32LE(0x4e4f534a,16);text.copy(result,20);result.writeUInt32LE(binary.length,20+text.length);result.writeUInt32LE(0x004e4942,24+text.length);binary.copy(result,28+text.length);return result;
}
test('embedded image dimensions are checked before Blender decoding and against the output profile',()=>{
 const bytes=withImage(1024,1024),r=inspect(bytes);assert.deepEqual(r.textureDimensions,[{width:1024,height:1024}]);assert.equal(r.texturePixels,1048576);
 assert.throws(()=>inspect(bytes,{...profile,textureEdge:512}),/Texture edge budget exceeded/);
 assert.doesNotThrow(()=>inspect(bytes,{...profile,textureEdge:1024}));
 assert.throws(()=>inspect(withImage(4097,1)),/Texture edge budget exceeded/);
 assert.throws(()=>inspect(withImage(0,1)),/PNG dimensions/);
 assert.throws(()=>inspect(withImage(1,1,'image/jpeg')),/JPEG signature/);
 assert.throws(()=>inspect(asset(j=>{j.images=[{bufferView:0,mimeType:'image/png'}];})),/PNG signature/);
 const jpeg=Buffer.from([255,216,255,192,0,8,8,0,16,0,32,1,255,217]);assert.deepEqual(imageSize(jpeg,'image/jpeg'),{width:32,height:16});assert.throws(()=>imageSize(jpeg.subarray(0,7),'image/jpeg'),/JPEG segment/);
});

test('malformed transforms and invalid scenes cannot yield a successful NaN bounds audit',()=>{
 assert.throws(()=>inspect(asset(j=>{j.nodes[0].matrix=[1];})),/part transform/);
 assert.throws(()=>inspect(asset(j=>{j.nodes[0].translation=[0,0];})),/part transform/);
 assert.throws(()=>inspect(asset(j=>{j.nodes[0].rotation=[0,0,0,0];})),/normalized/);
 assert.throws(()=>inspect(asset(j=>{j.nodes[0].scale=[1e308,1e308,1e308];j.nodes[0].translation=[1e308,1e308,1e308];})),/Nonfinite transformed bounds/);
 assert.throws(()=>inspect(asset(j=>{j.scenes[0].nodes=[9999];})),/scene root/);
 assert.throws(()=>inspect(asset(j=>{j.scene=99;})),/active scene/);
 const invalidProfile=spawnSync(process.execPath,['tooling/modeling/validate-glb.cjs','unused.glb','quset'],{cwd:new URL('../..',import.meta.url),encoding:'utf8'});assert.equal(invalidProfile.status,1);assert.match(invalidProfile.stderr,/Unknown modeling profile/);
});

function nativePacket(){return {format:'smarttwin.native-equipment',version:1,units:'m',upAxis:'Y',counts:{triangles:999,meshes:999},nodes:[{id:'actual-link',parent:null,name:'Actual link',matrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],componentId:'robot.arm',robotJointId:'J1',geometry:'shape',materials:['paint']}],geometries:[{id:'shape',attributes:{position:{itemSize:3,array:[0,0,0,1,0,0,0,1,0]}},index:null,groups:[],drawRange:{start:0,count:null}}],materials:[{id:'paint',name:'Paint',color:[1,.3,0],metalness:0,roughness:.4,opacity:1}]};}
test('native JSON preflight calculates cost from actual geometry instances, never the supplied counts',()=>{
 const packet=nativePacket(),before=JSON.stringify(packet),r=inspectPacket(packet);assert.equal(r.triangles,1);assert.equal(r.draws,1);assert.equal(r.meshNodes,1);assert.equal(r.components[0].joint,'J1');assert.equal(JSON.stringify(packet),before);
 const forged=nativePacket();forged.counts={triangles:1,meshes:1};forged.geometries[0].index=Array.from({length:12000},(_,i)=>i%3);forged.nodes=Array.from({length:251},(_,i)=>({...forged.nodes[0],id:'link-'+i}));assert.throws(()=>inspectPacket(forged),/instantiation work/);
 // Tiny triangle counts can also hide large allocations of unused vertices.
 const vertices=nativePacket();vertices.geometries[0].attributes.position.array=Array(150000).fill(0);vertices.geometries[0].index=[0,1,2];vertices.nodes=Array.from({length:224},(_,i)=>({...vertices.nodes[0],id:'link-'+i}));assert.throws(()=>inspectPacket(vertices),/instantiation work/);
 const changed=nativePacket();changed.geometries[0].index=[0,1,2,0,1,2];changed.geometries[0].drawRange={start:3,count:3};assert.equal(inspectPacket(changed).triangles,1);
});
test('native JSON preflight rejects duplicate IDs, invalid references and parent cycles before starting Blender',()=>{
 for(const [mutate,error]of [
  [p=>p.nodes.push({...p.nodes[0]}),/duplicate native node/],
  [p=>p.geometries.push({...p.geometries[0]}),/duplicate native geometry/],
  [p=>p.materials.push({...p.materials[0]}),/duplicate native material/],
  [p=>p.nodes[0].parent='missing',/parent reference/],
  [p=>p.nodes[0].parent=p.nodes[0].id,/Cyclic native/],
  [p=>p.nodes[0].geometry='missing',/geometry reference/],
  [p=>p.nodes[0].materials=['missing'],/material reference/],
  [p=>p.geometries[0].index=[0,1,999],/triangle indices/],
  [p=>p.nodes[0].matrix=[1],/local matrix/]
 ]){const packet=nativePacket();mutate(packet);assert.throws(()=>inspectPacket(packet),error);}
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{build}=require('../../tooling/modeling/build.cjs'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'smarttwin-packet-preflight-')),input=path.join(directory,'invalid.json');
 try{const packet=nativePacket();packet.nodes[0].parent='missing';fs.writeFileSync(input,JSON.stringify(packet));assert.throws(()=>build({input,output:path.join(directory,'never-created.glb'),blender:path.join(directory,'not-a-blender.exe')}),/parent reference/);assert.deepEqual(fs.readdirSync(directory),['invalid.json']);}finally{fs.unlinkSync(input);fs.rmdirSync(directory);}
});
