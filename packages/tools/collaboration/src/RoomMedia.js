import {validPose} from './PresenceAvatar.js';

let sdkPromise;
export function loadRoomSDK(dom=document){
 if(!sdkPromise)sdkPromise=new Promise((resolve,reject)=>{
  const script=dom.createElement('script');script.src=new URL('packages/tools/collaboration/assets/livekit/dist/livekit-client.umd.js',dom.baseURI).href;script.async=true;
  const timer=setTimeout(()=>{script.remove();sdkPromise=null;reject(Error('No se pudo cargar el módulo local de salas.'));},15000);
  script.onload=()=>{clearTimeout(timer);if(window.LivekitClient)resolve(window.LivekitClient);else{sdkPromise=null;reject(Error('El módulo de salas no está disponible.'));}};script.onerror=()=>{clearTimeout(timer);sdkPromise=null;script.remove();reject(Error('No se pudo cargar el módulo local de salas.'));};dom.head.appendChild(script);
 });return sdkPromise;
}

/** The university's own SFU carries media and bounded ephemeral presence.
 * Existing authenticated Studio events retain machine/cargo authority. */
export default class RoomMedia {
 constructor(studio,options={}){this.studio=studio;this.options=options;this.status='disconnected';this.generation=0;this.muted=true;this.deafened=false;this.proximity=false;this.audio=new Map();this.speakers=new Set();this.received=new Map();this.chat=[];this.sequence=0;this.lastPose=0;this.lastChat=-Infinity;}
 changed(){if(this.options.onChange)this.options.onChange(this);if(this.studio.immersiveMenu)this.studio.immersiveMenu.dirty=true;}
 voiceState(){return this.studio.room&&this.studio.room.voice||{mode:'moderated',speakerId:null,requests:[],revision:0};}
 syncVoice(value){
  if(!value||!this.studio.room)return;const old=this.voiceState();if(value.revision<old.revision)return;this.studio.room.voice=value;
  if(value.speakerId!==(this.studio.client.user&&this.studio.client.user.id)&&!this.muted){this.muted=true;if(this.connection)this.connection.localParticipant.setMicrophoneEnabled(false).catch(()=>{});}this.changed();
 }
 async voiceAction(action,participantId){
  const room=this.studio.room;if(!room)throw Error('Entra a una sala primero.');const generation=this.generation;
  const result=await this.studio.client.request('POST','/rooms/'+encodeURIComponent(room.id)+'/voice',{action,participantId});
  if(generation===this.generation&&this.studio.room&&this.studio.room.id===room.id)this.syncVoice(result.voice);return result.voice;
 }
 microphoneLabel(){const room=this.studio.room;return !this.muted?'Silenciar micrófono':room&&room.role!=='host'&&this.voiceState().speakerId!==this.studio.client.user.id?'Pedir la palabra':'Activar micrófono';}
 async hand(){const voice=this.voiceState(),id=this.studio.client.user.id;return this.voiceAction(voice.speakerId===id?'release':voice.requests.includes(id)?'cancel':'request');}
 async connect(room){
  this.disconnect();const capabilities=this.studio.client.capabilities;if(!capabilities||!capabilities.roomRealtime||!capabilities.roomRealtime.enabled){this.status='unconfigured';this.changed();return false;}
  const generation=this.generation,current=()=>generation===this.generation;this.status='connecting';this.changed();
  try{
   const [sdk,access]=await Promise.all([(this.options.loadSDK||loadRoomSDK)(),this.studio.client.request('POST','/rooms/'+encodeURIComponent(room.id)+'/media',{})]);if(!current())return false;
   const connection=new sdk.Room({adaptiveStream:false,dynacast:false,audioCaptureDefaults:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1},publishDefaults:{audioPreset:sdk.AudioPresets&&sdk.AudioPresets.speech,dtx:true}});this.connection=connection;this.roomId=room.id;this.sdk=sdk;
   const on=(event,fn)=>connection.on(event,(...args)=>{if(current())fn(...args);});
   on(sdk.RoomEvent.DataReceived,(data,participant,kind,topic)=>this.receive(data,participant,topic));
   on(sdk.RoomEvent.TrackSubscribed,(track,publication,participant)=>{if(track.kind!=='audio')return;const element=track.attach();element.hidden=true;element.autoplay=true;(this.options.document||document).body.appendChild(element);this.audio.set(participant.identity,{track,element});this.changed();});
   on(sdk.RoomEvent.TrackUnsubscribed,(track,publication,participant)=>this.removeAudio(participant.identity));
   on(sdk.RoomEvent.ParticipantDisconnected,participant=>{this.removeAudio(participant.identity);this.received.delete(participant.identity);this.speakers.delete(participant.identity);this.changed();});
   on(sdk.RoomEvent.ActiveSpeakersChanged,participants=>{this.speakers=new Set(participants.map(p=>p.identity));this.changed();});
   on(sdk.RoomEvent.Reconnecting,()=>{this.status='reconnecting';this.changed();});on(sdk.RoomEvent.Reconnected,()=>{this.status='connected';this.changed();});
   on(sdk.RoomEvent.Disconnected,()=>{this.status='disconnected';this.muted=true;this.audio.forEach((v,id)=>this.removeAudio(id));this.received.clear();this.changed();});
   await connection.connect(access.url,access.token);if(!current()){connection.disconnect();return false;}this.status='connected';this.changed();return true;
  }catch(error){if(current()){if(this.connection)this.connection.disconnect();this.error=error.message;this.status='error';this.muted=true;this.changed();}return false;}
 }
 async microphone(){
  if(this.status!=='connected')throw Error('Conecta la sala de tiempo real antes de activar el micrófono.');
  if(this.microphonePending)return this.microphonePending;const generation=this.generation,enabled=this.muted,connection=this.connection;
  this.microphonePending=(async()=>{
   const id=this.studio.client.user.id;
   if(enabled&&this.voiceState().speakerId!==id){if(this.studio.room.role==='host')await this.voiceAction('grant',id);else{await this.voiceAction('request');if(this.studio.message)this.studio.message('Solicitud enviada. El anfitrión te dará la palabra.');return false;}}
   await connection.startAudio();if(generation!==this.generation)return;
   const start=performance.now();while(enabled&&connection.localParticipant.permissions&&connection.localParticipant.permissions.canPublish===false){if(generation!==this.generation||this.voiceState().speakerId!==id)return;if(performance.now()-start>3500)throw Error('El permiso de voz aún no está disponible. Intenta de nuevo.');await new Promise(resolve=>setTimeout(resolve,50));}
   if(enabled&&this.voiceState().speakerId!==id)return;await connection.localParticipant.setMicrophoneEnabled(enabled);
   if(generation!==this.generation||enabled&&this.voiceState().speakerId!==id){await connection.localParticipant.setMicrophoneEnabled(false);return;}this.muted=!enabled;
   if(!enabled&&this.voiceState().speakerId===id)await this.voiceAction('release');this.changed();return true;
  })().finally(()=>{this.microphonePending=null;});return this.microphonePending;
 }
 async listen(){this.deafened=!this.deafened;if(!this.deafened&&this.connection)await this.connection.startAudio();this.changed();}
 removeAudio(id){const entry=this.audio.get(id);if(entry){entry.track.detach().forEach(node=>node.remove());entry.element.remove();this.audio.delete(id);}}
 member(id){const room=this.studio.room;return room&&room.participants&&room.participants.find(person=>person.id===id&&person.online);}
 receive(bytes,participant,topic){
  if(!participant||participant.identity===(this.studio.client.user&&this.studio.client.user.id)||!this.member(participant.identity)||bytes.byteLength>14000)return;
  let value;try{value=JSON.parse(new TextDecoder().decode(bytes));}catch(_){return;}if(!value||typeof value!=='object'||Array.isArray(value))return;const id=participant.identity,now=performance.now();
  if(topic==='st.pose.v1'){
   if(!Number.isSafeInteger(value.sequence)||value.sequence<0||!validPose(value.pose))return;const prior=this.received.get(id);if(prior&&value.sequence<=prior.sequence)return;
   for(const side of ['left','right'])if(value.pose[side]&&!validPose(value.pose[side]))return;this.received.set(id,{pose:value.pose,sequence:value.sequence,at:now,muted:value.muted!==false});
   const avatar=this.studio.avatars.get(id);if(avatar&&avatar.userData.presence)avatar.userData.presence.receive(value.pose,now);
  }else if(topic==='st.chat.v1'&&typeof value.text==='string'&&value.text.trim()&&value.text.length<=400){
   if(this.chat.some(row=>row.id===id&&now-row.at<500))return;this.chat.push({id,name:this.member(id).displayName,text:value.text.trim(),at:now});this.chat=this.chat.slice(-40);this.changed();
  }else if(topic==='st.visual.v1'&&id===this.studio.room.hostId&&this.options.onVisual)this.options.onVisual(value);
 }
 publish(value,topic,reliable=false){if(this.status!=='connected'||!this.connection)return;const bytes=new TextEncoder().encode(JSON.stringify(value));if(bytes.byteLength>14000)return;return this.connection.localParticipant.publishData(bytes,{reliable,topic});}
 async send(text){const now=performance.now(),value=String(text).trim();if(this.status!=='connected')throw Error('Conecta la sala para enviar mensajes.');if(!value||value.length>400||now-this.lastChat<750)return;this.lastChat=now;await this.publish({text:value},'st.chat.v1',true);this.chat.push({id:this.studio.client.user.id,name:this.studio.client.user.displayName,text:value,at:now});this.chat=this.chat.slice(-40);this.changed();}
 tick(){
  if(this.status!=='connected')return;const now=performance.now();if(now-this.lastPose>=66){this.lastPose=now;const pose=this.studio.pose();if(validPose(pose))this.publish({sequence:++this.sequence,pose,muted:this.muted},'st.pose.v1').catch(()=>{});}
  const local=this.studio.pose();for(const [id,entry]of this.audio){const received=this.received.get(id),member=this.member(id),remote=received&&received.pose||member&&member.pose;let volume=this.deafened?0:1;if(volume&&this.proximity&&local&&remote){const d=Math.hypot(...local.position.map((n,i)=>n-remote.position[i]));volume=d<=2?1:d>=15?0:Math.pow((15-d)/13,2);}entry.track.setVolume(volume);}
 }
 disconnect(){this.generation++;this.status='disconnected';this.muted=true;this.error='';if(this.connection){this.connection.disconnect();this.connection=null;}this.audio.forEach((v,id)=>this.removeAudio(id));this.received.clear();this.speakers.clear();this.chat=[];this.roomId=null;this.changed();}
 dispose(){this.disconnect();}
}
