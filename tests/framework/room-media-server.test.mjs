import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createHmac,createHash} from 'node:crypto';
import apiModule from '../../apps/api/server/api.js';
import mediaModule from '../../apps/api/server/room-media.cjs';
const secret='Disposable-local-room-secret-for-native-tests-only',key='localTestKey';
async function fixture(run,enabled=true){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'smarttwin-room-media-')),calls=[],api=apiModule.createApiHandler({dataDir:directory,requireSecureCookies:false,maintenanceIntervalMs:0,roomMedia:enabled?{url:'ws://127.0.0.1:7880',apiKey:key,apiSecret:secret,fetch:async(url,options)=>{calls.push({url,options});return Response.json({});}}:{}}),server=http.createServer(api);
 try{
  await api.studio.bootstrapOwner({username:'room_owner',password:'Disposable-room-owner-2026',invitationOnly:false});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  const request=async(route,body,cookie,headers={})=>{const response=await fetch(origin+route,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};};
  const owner=await request('/api/studio/login',{username:'room_owner',password:'Disposable-room-owner-2026'}),scene=api.studio.access.publicCatalog().scenes[0],source=api.studio.access.publicProject(scene.id),saved=await request('/api/projects',{name:'Sala de prueba',document:source.document},owner.cookie);assert.equal(saved.status,201,JSON.stringify(saved.data));
  const created=await request('/api/studio/rooms',{projectId:saved.data.project.id,projectRevision:saved.data.project.revision,roomId:scene.roomId,state:{},name:'Práctica compartida'},owner.cookie);assert.equal(created.status,201,JSON.stringify(created.data));await run({api,request,owner,room:created.data.room,calls});
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));api.close();assert.equal(path.dirname(fs.realpathSync(directory)),fs.realpathSync(os.tmpdir()));fs.rmSync(directory,{recursive:true,force:true});}
}
test('only authenticated room members receive short-lived microphone/data grants and no server secret',()=>fixture(async({request,owner,room})=>{
 const route='/api/studio/rooms/'+room.id+'/media';assert.equal((await request(route,{})).status,401);assert.equal((await request(route,{},owner.cookie,{Origin:'https://other.invalid'})).status,403);
 const other=await request('/api/studio/register',{username:'other_user',password:'Disposable-other-user-2026',displayName:'Otro'});assert.equal(other.status,201);assert.equal((await request(route,{},other.cookie)).status,403);
 const response=await request(route,{},owner.cookie);assert.equal(response.status,200);assert(!JSON.stringify(response.data).includes(secret));const [header,body,signature]=response.data.token.split('.'),claims=JSON.parse(Buffer.from(body,'base64url'));assert.equal(signature,createHmac('sha256',secret).update(header+'.'+body).digest('base64url'));assert.equal(claims.sub,owner.data.user.id);assert.equal(claims.video.room,'smarttwin-'+room.id);assert.deepEqual(claims.video.canPublishSources,['microphone']);assert.equal(claims.video.canPublishData,true);assert.equal(claims.video.roomAdmin,undefined);assert(claims.exp-claims.nbf<=125);
 const me=await request('/api/studio/me',undefined,owner.cookie);assert.equal(me.data.capabilities.roomRealtime.enabled,true);assert.equal(me.data.capabilities.maxRoomParticipants,10);
}));
test('leaving and logging out revoke the media participant through the local server API',()=>fixture(async({api,request,owner,room,calls})=>{
 const route='/api/studio/rooms/'+room.id;await request(route+'/media',{},owner.cookie);await request(route+'/leave',{},owner.cookie);await Promise.all([...api.studio.media.pending]);assert.equal(calls.length,1);assert.equal(calls[0].url,'http://127.0.0.1:7880/twirp/livekit.RoomService/RemoveParticipant');assert.equal(JSON.parse(calls[0].options.body).identity,owner.data.user.id);assert.equal((await request(route+'/media',{},owner.cookie)).status,403);
 await request('/api/studio/rooms/join',{code:room.code},owner.cookie);await request(route+'/media',{},owner.cookie);await request('/api/studio/logout',{},owner.cookie);await Promise.all([...api.studio.media.pending]);assert.equal(calls.length,2);assert.equal(api.studio.media.sessions.size,0);
}));
test('the eleventh participant is refused while ten members can connect',()=>fixture(async({request,room})=>{
 for(let i=0;i<10;i++){const user=await request('/api/studio/register',{username:'participant_'+i,password:'Disposable-participant-2026',displayName:'Participante '+i});assert.equal(user.status,201);const joined=await request('/api/studio/rooms/join',{code:room.code},user.cookie);assert.equal(joined.status,i<9?200:409);if(i===9)assert.equal(joined.data.code,'room_full');}
}));
test('an installation without its own media service reports unavailable without contacting a vendor',()=>fixture(async({request,owner,room})=>{const result=await request('/api/studio/rooms/'+room.id+'/media',{},owner.cookie);assert.equal(result.status,503);assert.equal(result.data.code,'room_media_unconfigured');},false));
test('public unencrypted service URLs and missing secrets fail configuration',()=>{assert.throws(()=>new mediaModule.RoomMedia({}, {url:'ws://public.example',apiKey:key,apiSecret:secret}));assert.throws(()=>new mediaModule.RoomMedia({}, {url:'wss://voice.example',apiKey:key,apiSecret:'short'}));});
test('signed local webhooks reject tampering and remove a participant reusing an old join token after leaving',()=>fixture(async({api,request,owner,room,calls})=>{
 const body={event:'participant_joined',room:{name:'smarttwin-'+room.id},participant:{identity:owner.data.user.id}},now=Math.floor(Date.now()/1000),token=mediaModule.sign(secret,key,{exp:now+60,nbf:now-5,sha256:createHash('sha256').update(JSON.stringify(body)).digest('base64')}),route='/api/studio/room-media/webhook';
 assert.equal((await request(route,body)).status,401);assert.equal((await request(route,{...body,id:'tampered'},undefined,{Authorization:token})).status,401);
 assert.equal((await request(route,body,undefined,{Authorization:Buffer.from('null').toString('base64url')+'.'+Buffer.from('null').toString('base64url')+'.invalid'})).status,401);
 await request('/api/studio/rooms/'+room.id+'/media',{},owner.cookie);assert.equal((await request(route,body,undefined,{Authorization:token})).status,200);assert.equal(calls.length,1);assert.equal(JSON.parse(calls[0].options.body).permission.canPublish,false);
 await request('/api/studio/rooms/'+room.id+'/leave',{},owner.cookie);await Promise.all([...api.studio.media.pending]);assert.equal(calls.length,2);assert.equal((await request(route,body,undefined,{Authorization:token})).status,200);assert.equal(calls.length,3);
}));

test('moderated voice is serialized, revokes the previous publisher first and never lets a participant grant a turn',()=>fixture(async({api,request,owner,room})=>{
 const peers=new Map(),route='/api/studio/rooms/'+room.id,guest=await request('/api/studio/register',{username:'voice_guest',password:'Disposable-voice-guest-2026',displayName:'Estudiante'});await request('/api/studio/rooms/join',{code:room.code},guest.cookie);
 const a=owner.data.user.id,b=guest.data.user.id;peers.set(a,false);peers.set(b,false);let maximum=0;
 api.studio.media.fetch=async(url,options)=>{const body=JSON.parse(options.body);if(url.endsWith('/ListParticipants'))return Response.json({participants:Array.from(peers,([identity,canPublish])=>({identity,permission:{canPublish}}))});if(url.endsWith('/UpdateParticipant'))peers.set(body.identity,body.permission.canPublish);if(url.endsWith('/RemoveParticipant'))peers.delete(body.identity);maximum=Math.max(maximum,[...peers.values()].filter(Boolean).length);return Response.json({});};
 assert.equal((await request(route+'/voice',{action:'grant',participantId:b},guest.cookie)).status,403);
 assert.equal((await request(route+'/voice',{action:'request'},guest.cookie)).status,200);assert.deepEqual((await request(route,undefined,owner.cookie)).data.room.voice.requests,[b]);
 assert.equal((await request(route+'/voice',{action:'grant',participantId:b},owner.cookie)).status,200);assert.equal(peers.get(b),true);assert.equal(peers.get(a),false);
 const joins=await request(route+'/media',{},guest.cookie),claims=JSON.parse(Buffer.from(joins.data.token.split('.')[1],'base64url'));assert.equal(claims.video.canPublish,false,'Even a granted speaker rejoins muted until the signed join webhook applies current permissions.');
 const changes=await Promise.all([a,b,a,b].map(participantId=>request(route+'/voice',{action:'grant',participantId},owner.cookie)));assert(changes.every(row=>row.status===200));assert.equal(maximum,1);assert.equal([...peers.values()].filter(Boolean).length,1);
 assert.equal((await request(route+'/voice',{action:'release'},owner.cookie)).status,403);await request(route+'/voice',{action:'mute-all'},owner.cookie);assert.equal([...peers.values()].filter(Boolean).length,0);
}));

test('a media-server failure never grants the next microphone when the previous one cannot be revoked',()=>fixture(async({api,request,owner,room})=>{
 const route='/api/studio/rooms/'+room.id,guest=await request('/api/studio/register',{username:'voice_failure',password:'Disposable-voice-failure-2026',displayName:'Estudiante'});await request('/api/studio/rooms/join',{code:room.code},guest.cookie);let allowed=0;
 api.studio.media.fetch=async(url,options)=>{if(url.endsWith('/ListParticipants'))return Response.json({participants:[{identity:owner.data.user.id}]});if(JSON.parse(options.body).permission?.canPublish)allowed++;return new Response('{}',{status:503});};
 const result=await request(route+'/voice',{action:'grant',participantId:guest.data.user.id},owner.cookie);assert.equal(result.status,503);assert.equal(allowed,0);assert.equal((await request(route,undefined,owner.cookie)).data.room.voice.speakerId,null);
}));
