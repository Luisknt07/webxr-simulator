'use strict';
// Self-hosted WebRTC only. No cloud account, external token broker, or secret
// is included in the browser bundle or a persisted scene.
const {createHmac,createHash,timingSafeEqual}=require('node:crypto');
const {ApiError}=require('./validation');
const encoded=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
function sign(secret,key,claims){const body=encoded({alg:'HS256',typ:'JWT'})+'.'+encoded({...claims,iss:key});return body+'.'+createHmac('sha256',secret).update(body).digest('base64url');}
class RoomMedia {
 constructor(studio,options={}){
  this.studio=studio;this.now=options.now||Date.now;this.fetch=options.fetch||global.fetch;this.sessions=new Map();this.closed=false;this.pending=new Set();
  this.enabled=!!options.url;
  if(this.enabled){
   const url=new URL(options.url),local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
   if(!(['wss:','ws:'].includes(url.protocol))||url.username||url.password||url.search||url.hash||url.pathname!=='/'||url.protocol==='ws:'&&!local)throw Error('El servidor de salas requiere WSS, o WS de desarrollo local.');
   if(typeof options.apiKey!=='string'||!/^[A-Za-z0-9_-]{8,120}$/.test(options.apiKey)||typeof options.apiSecret!=='string'||options.apiSecret.length<32)throw Error('Configura una clave y secreto privados de salas de al menos 32 caracteres.');
   this.url=url.origin;this.key=options.apiKey;this.secret=options.apiSecret;this.serverURL=(options.serverURL||this.url.replace(/^ws/,'http')).replace(/\/$/,'');
   const backend=new URL(this.serverURL);if(!['https:','http:'].includes(backend.protocol)||backend.username||backend.password||backend.pathname!=='/'||backend.search||backend.hash)throw Error('Dirección interna de salas inválida.');
   this.timer=setInterval(()=>this.audit(),options.auditIntervalMs||5000);this.timer.unref?.();
  }
 }
 capabilities(){return{enabled:this.enabled,provider:'self-hosted-webrtc',externalAccount:false,maxParticipants:this.studio.roomLimit||10};}
 issue(req,user,room){
  if(!this.enabled)throw new ApiError(503,'El servidor de tiempo real aún no está configurado en esta instalación.','room_media_unconfigured');
  const now=Math.floor(this.now()/1000),roomName='smarttwin-'+room.id,exp=now+120;
  const token=sign(this.secret,this.key,{sub:user.id,name:user.display_name,nbf:now-5,exp,video:{room:roomName,roomJoin:true,canSubscribe:true,canPublish:true,canPublishSources:['microphone'],canPublishData:true,canUpdateOwnMetadata:false}});
  this.sessions.set(room.id+':'+user.id,{req:{headers:{cookie:req.headers.cookie}},userId:user.id,roomId:room.id,roomName});
  return{url:this.url,token,expiresAt:exp*1000,participantId:user.id,roomName,maxParticipants:this.studio.roomLimit||10};
 }
 revoke(roomId,userId){
  if(!this.enabled)return Promise.resolve();const key=roomId+':'+userId;let entry=this.sessions.get(key);if(!entry){entry={roomId,userId,roomName:'smarttwin-'+roomId};this.sessions.set(key,entry);}
  if(entry.pending)return entry.pending;
  const task=(async()=>{
   const now=Math.floor(this.now()/1000),token=sign(this.secret,this.key,{nbf:now-5,exp:now+30,video:{room:entry.roomName,roomAdmin:true}});
   try{
    const response=await this.fetch(this.serverURL+'/twirp/livekit.RoomService/RemoveParticipant',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({room:entry.roomName,identity:userId}),signal:AbortSignal.timeout(5000)});
    if(response.ok||response.status===404)this.sessions.delete(key);
   }catch(_){/* Retry during the next audit; never keep a released lease. */}
   finally{entry.pending=null;}
  })();entry.pending=task;this.pending.add(task);task.finally(()=>this.pending.delete(task));return task;
 }
 revokeUser(userId){if(!this.enabled)return;for(const row of this.studio.db.prepare('SELECT room_id FROM studio_members WHERE user_id=? AND active=1').all(userId))this.revoke(row.room_id,userId);}
 async webhook(req){
  if(!this.enabled)throw new ApiError(503,'Salas no configuradas.','room_media_unconfigured');
  const auth=req.headers.authorization;if(typeof auth!=='string'||auth.length>8192)throw new ApiError(401,'Firma de sala inválida.');
  const token=auth.replace(/^Bearer /,''),parts=token.split('.');let header,claims;try{header=JSON.parse(Buffer.from(parts[0],'base64url'));claims=JSON.parse(Buffer.from(parts[1],'base64url'));}catch(_){throw new ApiError(401,'Firma de sala inválida.');}
  if(!header||typeof header!=='object'||Array.isArray(header)||!claims||typeof claims!=='object'||Array.isArray(claims))throw new ApiError(401,'Firma de sala inválida.');
  const expected=createHmac('sha256',this.secret).update(parts.slice(0,2).join('.')).digest(),received=Buffer.from(parts[2]||'','base64url'),now=Math.floor(this.now()/1000);
  if(parts.length!==3||header.alg!=='HS256'||claims.iss!==this.key||!Number.isFinite(claims.exp)||claims.exp<=now||claims.nbf>now+5||received.length!==expected.length||!timingSafeEqual(received,expected))throw new ApiError(401,'Firma de sala inválida.');
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>16384)throw new ApiError(413,'Evento de sala demasiado grande.');chunks.push(chunk);}const body=Buffer.concat(chunks);
  if(claims.sha256!==createHash('sha256').update(body).digest('base64'))throw new ApiError(401,'El evento de sala no coincide con su firma.');
  let event;try{event=JSON.parse(body);}catch(_){throw new ApiError(400,'Evento inválido.');}if(!event||typeof event!=='object'||Array.isArray(event))throw new ApiError(400,'Evento inválido.');
  if(event.event==='participant_joined'){
   const name=event.room&&event.room.name,userId=event.participant&&event.participant.identity;if(typeof name!=='string'||!/^smarttwin-[a-f0-9-]{36}$/.test(name)||typeof userId!=='string'||!/^[a-f0-9-]{36}$/.test(userId))throw new ApiError(400,'Participante de sala inválido.');
   const roomId=name.slice(10),entry=this.sessions.get(roomId+':'+userId);let allowed=false;
   try{if(entry&&entry.req){const user=this.studio.user(entry.req,false);if(user&&user.id===userId){this.studio._room(roomId,user,false);allowed=true;}}}catch(_){}
   if(!allowed)await this.revoke(roomId,userId);
  }
 }
 audit(){
  if(this.closed)return;
  for(const entry of this.sessions.values())try{if(!entry.req)throw Error('revoked');const user=this.studio.user(entry.req,false);if(!user||user.id!==entry.userId)throw Error('revoked');const {member}=this.studio._room(entry.roomId,user,false);if(member.seen_at<=this.now()-45000)throw Error('offline');}catch(_){this.revoke(entry.roomId,entry.userId);}
 }
 close(){this.closed=true;clearInterval(this.timer);this.sessions.clear();}
}
module.exports={RoomMedia,sign};
