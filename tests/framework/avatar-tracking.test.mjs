import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),T=require('three');
const {capturePresence,captureXRBody,validPresence,HAND_JOINTS,BODY_JOINTS,XRHandMesh,PresenceAvatar}=require('../support/load-room-presence.cjs');

test('real hand skin, without gripSpace, preserves all fingers through a translated/rotated vehicle rig',async()=>{
 const scene=new T.Scene(),rig=new T.Group(),camera=new T.PerspectiveCamera();scene.add(rig);rig.add(camera);rig.position.set(4,.2,-8);rig.rotation.y=.7;camera.position.set(0,1.65,0);
 const skin=new XRHandMesh('left');rig.add(skin.root);const native=new Map();HAND_JOINTS.forEach((name,i)=>native.set(name,new T.Matrix4().compose(new T.Vector3(-.3+i*.002,1.2,-.4),new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),i*.01),new T.Vector3(1,1,1))));skin.tracked(native);
 const grip=new T.Group();grip.visible=false;grip.xrInputVisual={skin};
 const ctx={vrMode:true,camera,cameraRig:rig,raycontrol:{controllers:[{inputSource:{handedness:'left'},grip}]}};
 const packet=capturePresence(ctx);assert(validPresence(packet));assert.equal(packet.left.source,'tracked');assert.equal(packet.left.joints.length,25);
 for(let i=0;i<25;i++){const expected=skin.bones.get(HAND_JOINTS[i]).getWorldPosition(new T.Vector3());assert(expected.distanceTo(new T.Vector3().fromArray(packet.left.joints[i]))<.0001);}
 const remote=new PresenceAvatar({displayName:'Manos reales',avatar:{base:'human-f07',bodyMode:'tracked'}});await remote.rig.ready;remote.receive(packet);remote.tick(null);scene.add(remote.object);scene.updateMatrixWorld(true);
 const received=remote.rig.remoteHands.left;assert(received&&received.root.visible);for(let i=0;i<25;i++){const target=new T.Vector3().fromArray(packet.left.joints[i]),actual=received.bones.get(HAND_JOINTS[i]).getWorldPosition(new T.Vector3());assert(actual.distanceTo(target)<.0001,HAND_JOINTS[i]);}
 skin.root.visible=false;const lost=capturePresence(ctx);assert(!lost.left);remote.receive(lost);remote.tick(null);assert(!received.root.visible,'Lost tracking must hide the stale hand.');
 skin.root.visible=true;skin.mode='controller';assert.equal(capturePresence(ctx).left.source,'controller');remote.dispose();skin.dispose();
});

test('optional body snapshots retain measured/emulated/unknown flags, transform with the rig, and clear on loss',()=>{
 const rig=new T.Group();rig.position.set(2,0,-3);const ctx={vrMode:true,cameraRig:rig,renderer:{xr:{getReferenceSpace:()=>({})}}},matrix=new T.Matrix4().makeTranslation(0,1,0).toArray();
 const body=new Map(BODY_JOINTS.map((name,i)=>[name,{name,index:i}]));
 captureXRBody(ctx,{body,getPose:space=>space.index===2?null:{transform:{matrix},emulatedPosition:space.index===0?false:space.index===1?true:undefined}});
 assert.equal(ctx.xrBodyPacket.joints[0][7],0);assert.equal(ctx.xrBodyPacket.joints[1][7],1);assert.equal(ctx.xrBodyPacket.joints[2],null);assert.equal(ctx.xrBodyPacket.joints[3][7],2);assert.deepEqual(ctx.xrBodyPacket.joints[0].slice(0,3),[2,1,-3]);
 const packet={position:[2,1.65,-3],quaternion:[0,0,0,1],mode:'vr',body:ctx.xrBodyPacket};assert(validPresence(packet));assert(Buffer.byteLength(JSON.stringify(packet))<14000);
 const malicious=structuredClone(packet);malicious.body.joints[0][7]=9;assert(!validPresence(malicious));malicious.body.joints[0][7]=0;malicious.body.joints[0][0]+=100;assert(!validPresence(malicious),'A peer cannot stretch a body across the facility.');captureXRBody(ctx,{body:null});assert.equal(ctx.xrBodyPacket,null);captureXRBody(ctx,{get body(){throw Error('Not available');}});assert.equal(ctx.xrBodyPacket,null);
});

test('XR head capture reads the measured matrix, never stale local ArrayCamera values; hidden sessions are inactive',()=>{
 const camera=new T.PerspectiveCamera(),head=new T.ArrayCamera();head.position.set(999,999,999);head.matrixWorld.compose(new T.Vector3(3,1.7,-4),new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),.6),new T.Vector3(1,1,1));const session={visibilityState:'visible'},ctx={camera,vrMode:true,renderer:{xr:{isPresenting:true,getCamera:()=>head,getSession:()=>session}}};
 const pose=capturePresence(ctx);assert.deepEqual(pose.position,[3,1.7,-4]);assert(pose.active);assert(Math.abs(pose.quaternion[1]-Math.sin(.3))<.0001);session.visibilityState='hidden';assert.equal(capturePresence(ctx).active,false);
});

test('all four local humans retain skin weights, licences, hashes and bounded embedded textures',()=>{
 const dir=new URL('../../packages/tools/collaboration/assets/humans/',import.meta.url),provenance=JSON.parse(fs.readFileSync(new URL('provenance.json',dir)));assert.equal(provenance.license,'MIT');assert(fs.readFileSync(new URL('LICENSE.md',dir),'utf8').includes('Copyright (c) 2020 Microsoft'));assert.equal(provenance.avatars.length,4);
 for(const avatar of provenance.avatars){const bytes=fs.readFileSync(new URL(avatar.file,dir));assert.equal(createHash('sha256').update(bytes).digest('hex'),avatar.sha256);assert(bytes.length<4*1024*1024);const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));assert(json.skins.length>=1);assert(json.skins.every(s=>s.joints.length>=70));assert(json.images.every(i=>i.bufferView!==undefined&&!i.uri));assert(json.meshes.every(m=>m.primitives.every(p=>p.attributes.JOINTS_0!==undefined&&p.attributes.WEIGHTS_0!==undefined)));assert(avatar.triangles<=12000);}
});

test('VR has no invented walking legs; complete mode only shows legs with valid device data',async()=>{
 const a=new PresenceAvatar({displayName:'Sin piernas inventadas',avatar:{base:'human-m04',bodyMode:'complete'}});await a.rig.ready;const pose={position:[0,1.65,0],quaternion:[0,0,0,1],mode:'vr'};a.receive(pose);a.tick(null);assert(a.rig.parts.get('legs').every(mesh=>!mesh.visible));a.receive({...pose,position:[2,1.2,0]});a.tick(null);assert(a.rig.parts.get('legs').every(mesh=>!mesh.visible));a.dispose();
});

test('repeated retargeting never mutates network hand targets or stretches wrist targets across the scene',async()=>{
 const avatar=new PresenceAvatar({displayName:'Objetivos inmutables',avatar:{base:'human-f07',bodyMode:'upper'}});await avatar.rig.ready;
 const pose={position:[-5,1.65,1],quaternion:[0,0,0,1],mode:'vr',left:{position:[-5.3,1.3,.6],quaternion:[0,0,0,1]},right:{position:[-4.7,1.3,.6],quaternion:[0,0,0,1]}};avatar.receive(pose);
 for(let i=0;i<120;i++)avatar.tick(null,1/60);
 for(const side of ['left','right']){assert.deepEqual(avatar.target.hands[side].position.toArray(),pose[side].position);assert(avatar.hands[side].getWorldPosition(new T.Vector3()).distanceTo(new T.Vector3().fromArray(pose[side].position))<1e-5);}
 avatar.dispose();
});
