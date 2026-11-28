'use strict';
const {ApiError}=require('./validation');

// One server-authorized microphone at a time. UI state never grants publishing.
class RoomVoice {
 constructor(media){
  this.media=media;this.studio=media.studio;this.changes=new Map();
  if(this.studio.db)this.studio.db.exec(`CREATE TABLE IF NOT EXISTS studio_room_voice (
   room_id TEXT PRIMARY KEY REFERENCES studio_rooms(id) ON DELETE CASCADE,
   speaker_id TEXT, requests TEXT NOT NULL DEFAULT '[]', revision INTEGER NOT NULL DEFAULT 0)`);
 }
 row(roomId){this.studio.db.prepare('INSERT OR IGNORE INTO studio_room_voice(room_id) VALUES(?)').run(roomId);return this.studio.db.prepare('SELECT * FROM studio_room_voice WHERE room_id=?').get(roomId);}
 members(roomId){return this.studio.db.prepare('SELECT user_id FROM studio_members WHERE room_id=? AND active=1 AND seen_at>?').all(roomId,this.media.now()-45000).map(row=>row.user_id);}
 state(roomId){
  const row=this.row(roomId),live=new Set(this.members(roomId));
  return{mode:'moderated',speakerId:live.has(row.speaker_id)?row.speaker_id:null,requests:JSON.parse(row.requests).filter(id=>live.has(id)),revision:row.revision};
 }
 clear(roomId,userId){
  const row=this.studio.db.prepare('SELECT * FROM studio_room_voice WHERE room_id=?').get(roomId);if(!row)return;const requests=JSON.parse(row.requests).filter(id=>id!==userId);
  if(row.speaker_id===userId||requests.length!==JSON.parse(row.requests).length)this.studio.db.prepare('UPDATE studio_room_voice SET speaker_id=?,requests=?,revision=revision+1 WHERE room_id=?').run(row.speaker_id===userId?null:row.speaker_id,JSON.stringify(requests),roomId);
 }
 permission(allowed){return{canSubscribe:true,canPublish:allowed,canPublishData:true,canPublishSources:['MICROPHONE'],canUpdateMetadata:false};}
 async enforce(roomId,userId){await(this.changes.get(roomId)||Promise.resolve()).catch(()=>{});const allowed=this.state(roomId).speakerId===userId;await this.media.rpc(roomId,'UpdateParticipant',{identity:userId,permission:this.permission(allowed)},true);return allowed;}
 command(req,user,room,data){
  if(!this.media.enabled)throw new ApiError(503,'El servicio de voz no está configurado.');
  const prior=this.changes.get(room.id)||Promise.resolve();
  const task=prior.catch(()=>{}).then(()=>this.apply(req,user,room,data));this.changes.set(room.id,task);
  task.finally(()=>{if(this.changes.get(room.id)===task)this.changes.delete(room.id);}).catch(()=>{});return task;
 }
 async apply(req,user,room,data){
  const current=this.studio.user(req);if(current.id!==user.id)throw new ApiError(409,'La cuenta cambió durante la solicitud.');
  const {member}=this.studio._room(room.id,current),state=this.state(room.id),action=data&&data.action;
  if(!['request','cancel','release','grant','mute-all'].includes(action))throw new ApiError(400,'Acción de voz inválida.');
  let requests=state.requests.slice();
  if(action==='request'||action==='cancel'){
   requests=requests.filter(id=>id!==user.id);if(action==='request'&&state.speakerId!==user.id)requests.push(user.id);
   this.studio.db.prepare('UPDATE studio_room_voice SET requests=?,revision=revision+1 WHERE room_id=?').run(JSON.stringify(requests),room.id);return this.state(room.id);
  }
  if(action==='release'&&state.speakerId!==user.id)throw new ApiError(403,'Solo puedes devolver tu propio turno.');
  if(action!=='release'&&member.role!=='host')throw new ApiError(403,'Solo el anfitrión administra los turnos.');
  const next=action==='grant'?data.participantId:null;
  if(next!==null&&(typeof next!=='string'||!this.members(room.id).includes(next)))throw new ApiError(400,'El participante debe estar conectado a esta sala.');
  // Revoke everyone BEFORE enabling the next microphone, including after an
  // API restart or an old-token reconnect. A failed revocation grants nobody.
  this.studio.db.prepare('UPDATE studio_room_voice SET speaker_id=NULL,revision=revision+1 WHERE room_id=?').run(room.id);
  const peers=await this.media.rpc(room.id,'ListParticipants',{},true);
  for(const peer of peers&&peers.participants||[])if(peer.identity!==next)try{
   await this.media.rpc(room.id,'UpdateParticipant',{identity:peer.identity,permission:this.permission(false)},true);
  }catch(error){await this.media.rpc(room.id,'RemoveParticipant',{identity:peer.identity},true);}
  if(next)await this.media.rpc(room.id,'UpdateParticipant',{identity:next,permission:this.permission(true)},true);
  requests=requests.filter(id=>id!==next);
  this.studio.db.prepare('UPDATE studio_room_voice SET speaker_id=?,requests=?,revision=revision+1 WHERE room_id=?').run(next,JSON.stringify(requests),room.id);
  return this.state(room.id);
 }
}
module.exports=RoomVoice;
