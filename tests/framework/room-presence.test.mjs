import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),T=require('three'),{PresenceAvatar,validPose,RoomMedia,RoomVisuals}=require('../support/load-room-presence.cjs');
const pose=(x=0)=>({position:[x,1.65,0],quaternion:[0,0,0,1],left:{position:[x-.3,1.3,-.4],quaternion:[0,0,0,1]},right:{position:[x+.3,1.3,-.4],quaternion:[0,0,0,1]}});
function fixture(){
 const people=[{id:'me',displayName:'Yo',online:true},{id:'host',displayName:'Instructor',online:true},{id:'guest',displayName:'Invitada',online:true}],messages=[],visual=[],events={DataReceived:'data',TrackSubscribed:'track',TrackUnsubscribed:'untrack',ParticipantDisconnected:'left',ActiveSpeakersChanged:'speakers',Reconnecting:'reconnecting',Reconnected:'reconnected',Disconnected:'disconnected'};
 class Room{constructor(){this.events=new Map();this.localParticipant={publishData:async(bytes,options)=>messages.push({value:JSON.parse(new TextDecoder().decode(bytes)),options}),setMicrophoneEnabled:async value=>{this.microphone=value;}};}on(event,handler){this.events.set(event,handler);}async connect(){}disconnect(){this.disconnected=true;}async startAudio(){this.audioStarted=true;}emit(event,...args){this.events.get(events[event])?.(...args);}}
 const studio={client:{user:{id:'me',displayName:'Yo'},capabilities:{roomRealtime:{enabled:true}},request:async()=>({url:'ws://127.0.0.1:7880',token:'disposable'})},room:{id:'room',hostId:'host',role:'participant',participants:people},avatars:new Map(),pose:()=>pose()},media=new RoomMedia(studio,{loadSDK:async()=>({Room,RoomEvent:events}),onVisual:value=>visual.push(value)});studio.roomMedia=media;
 return{studio,media,people,messages,visual,events,async connect(){assert(await media.connect(studio.room));},receive(value,id='guest',topic='st.pose.v1'){media.receive(new TextEncoder().encode(JSON.stringify(value)),{identity:id},topic);}};
}
test('ten lightweight avatars show measured head and bilateral hands, reject invalid poses and dispose their local resources',()=>{
 const scene=new T.Scene(),camera=new T.PerspectiveCamera(),avatars=[];let meshes=0,disposed=0;
 for(let i=0;i<10;i++){const avatar=new PresenceAvatar({displayName:'Participante '+i,avatar:{bodyColor:'#33ccbb'}});avatars.push(avatar);scene.add(avatar.object);assert(avatar.receive(pose(i)));avatar.tick(camera,1/60);scene.updateMatrixWorld(true);assert(avatar.hands.left.visible&&avatar.hands.right.visible);assert(Math.abs(avatar.hands.right.getWorldPosition(new T.Vector3()).x-(i+.3))<1e-6);avatar.texture.addEventListener('dispose',()=>disposed++);avatar.object.traverse(n=>{if(n.isMesh)meshes++;});assert(!avatar.receive({...pose(i),position:[Infinity,0,0]}));avatar.voice(false,true);}
 assert(meshes<=100);avatars.forEach(a=>a.dispose());assert.equal(scene.children.length,0);assert.equal(disposed,10);assert(!validPose({...pose(),quaternion:[0,0,0,0]}));
});
test('presence accepts only members, ignores stale samples and rejects forged host visuals and malformed packets',async()=>{
 const f=fixture();await f.connect();f.receive({sequence:2,pose:pose(2),muted:false});assert.equal(f.media.received.get('guest').pose.position[0],2);f.receive({sequence:1,pose:pose(1)});assert.equal(f.media.received.get('guest').sequence,2);f.receive({sequence:3,pose:pose(3)},'stranger');assert.equal(f.media.received.size,1);f.receive(null);f.receive({sequence:3,pose:{...pose(),right:{}}});assert.equal(f.media.received.get('guest').sequence,2);f.receive({items:[]},'guest','st.visual.v1');assert.equal(f.visual.length,0);f.receive({items:[]},'host','st.visual.v1');assert.equal(f.visual.length,1);f.media.disconnect();assert.equal(f.media.received.size,0);
});
test('microphone starts muted, requires a user action, and a late capture is stopped after leaving',async()=>{
 const f=fixture();await f.connect();assert(f.media.muted);assert.equal(f.media.connection.microphone,undefined);await f.media.microphone();assert(!f.media.muted);await f.media.microphone();assert(f.media.muted);
 const connection=f.media.connection;let release;connection.localParticipant.setMicrophoneEnabled=value=>value?new Promise(resolve=>release=resolve):Promise.resolve(connection.stopped=true);const pending=f.media.microphone();await Promise.resolve();await Promise.resolve();assert(release);f.media.disconnect();release();await pending;assert(connection.stopped);assert(f.media.muted);
});
test('room changes cannot let a late token response attach to a different room',async()=>{
 const f=fixture();let release;f.studio.client.request=()=>new Promise(resolve=>release=resolve);const old=f.media.connect(f.studio.room);await Promise.resolve();f.media.disconnect();release({url:'ws://127.0.0.1:7880',token:'disposable'});assert.equal(await old,false);assert(!f.media.connection);
});
test('proximity and deafening control only local playback, and outgoing presence stays bounded',async()=>{
 const f=fixture();await f.connect();let volume;f.media.audio.set('guest',{track:{setVolume:value=>volume=value,detach:()=>[]},element:{remove(){}}});f.receive({sequence:1,pose:pose(8),muted:false});f.media.proximity=true;f.media.tick();assert(volume>0&&volume<1);f.media.deafened=true;f.media.tick();assert.equal(volume,0);assert.equal(f.messages[0].options.topic,'st.pose.v1');assert(JSON.stringify(f.messages[0].value).length<1200);f.media.disconnect();
});
test('visual packets never overwrite a locally held product or change custody',()=>{
 const object=new T.Object3D(),product={object,heldBy:{},vehicleOwnerId:'fork'},runtime={products:new Map([[object,product]]),records:new Map(),setProductMatrix(){throw Error('A local hold must remain authoritative.');}},studio={room:{role:'participant'},roomMedia:{status:'connected'},editor:{simulation:runtime}},visual=new RoomVisuals(studio);visual.receive({sequence:1,items:[{kind:'p',id:object.uuid,...pose(3)}]});visual.tick();assert.equal(object.position.x,0);assert.equal(product.vehicleOwnerId,'fork');visual.clear();assert.equal(visual.targets.size,0);
});
