import {createExperienceIcon} from '../../../navigation-ui/ExperienceHeader.js';

/** Persistent in-session controls. Capture devices still require a click. */
export default class SessionDock {
 constructor(studio,dom=document){
  this.studio=studio;this.dom=dom;this.root=dom.createElement('nav');this.root.className='studio-session-dock';this.root.setAttribute('aria-label','Controles de la sesión grupal');this.root.hidden=true;this.buttons={};
  const actions=[['microphone','Micrófono','microphone',()=>studio.roomMedia.microphone()],['hand','Pedir la palabra','hand',()=>studio.roomMedia.hand()],['listen','Escuchar sala','sound',()=>studio.roomMedia.listen()],['participants','Participantes','rooms',()=>studio.open('participants')],['chat','Chat','chat',()=>studio.open('chat')],['avatar','Mi avatar','account',()=>studio.open('avatar')],['leave','Salir de la sala','leave',()=>studio.leaveRoom()]];
  for(const [id,label,icon,action]of actions){const button=dom.createElement('button');button.type='button';button.dataset.sessionAction=id;button.appendChild(createExperienceIcon(dom,icon));const copy=dom.createElement('span');copy.className='studio-session-tooltip';copy.textContent=label;button.appendChild(copy);button.addEventListener('click',()=>studio.guard(action));this.root.appendChild(button);this.buttons[id]=button;}
  for(const type of ['pointerdown','pointerup','click','keydown','keyup'])this.root.addEventListener(type,event=>{event.stopPropagation();if(type==='pointerdown'||type==='keydown'){studio.editor.hooks.unlock();studio.editor.hooks.clearKeyboard();}});
  this.status=dom.createElement('span');this.status.className='studio-session-status';this.status.setAttribute('role','status');this.root.prepend(this.status);dom.body.appendChild(this.root);
 }
 update(){
  const s=this.studio,room=s.room,m=s.roomMedia,visible=!!room&&!s.editor.active&&!s.ctx.vrMode;if(this.root.hidden===visible)this.root.hidden=!visible;if(this.active!==!!room){this.active=!!room;this.dom.body.classList.toggle('studio-in-room',!!room);}if(!visible)return;
  const voice=m.voiceState(),id=s.client.user.id,online=room.participants.filter(p=>p.online).length,raised=voice.requests.includes(id),speaker=room.participants.find(p=>p.id===voice.speakerId);
  const signature=[voice.revision,m.status,m.muted,m.deafened,online,s.page,s.drawer.hidden,speaker&&speaker.displayName].join('|');if(signature===this.signature)return;this.signature=signature;
  this.status.textContent=m.status==='connected'?(speaker?'Turno: '+speaker.displayName:'Sala conectada · pide la palabra'):m.status==='unconfigured'?'Voz no disponible en este servidor':'Conectando voz…';
  const set=(key,label,pressed,disabled=false)=>{const b=this.buttons[key];b.setAttribute('aria-label',label);b.title=label;b.setAttribute('aria-pressed',String(!!pressed));b.disabled=disabled;b.querySelector('span').textContent=label;};
  set('microphone',m.microphoneLabel(),!m.muted,m.status!=='connected');this.buttons.microphone.dataset.muted=String(m.muted);
  set('hand',voice.speakerId===id?'Devolver la palabra':raised?'Cancelar solicitud':'Pedir la palabra',raised||voice.speakerId===id,m.status!=='connected');
  set('listen',m.deafened?'Activar escucha':'Silenciar escucha',!m.deafened,m.status!=='connected');set('participants','Participantes · '+online,s.page==='participants'&&!s.drawer.hidden);this.buttons.participants.dataset.count=String(online);
  set('chat','Chat de la sala',s.page==='chat'&&!s.drawer.hidden,m.status!=='connected');set('avatar','Personalizar mi avatar',s.page==='avatar'&&!s.drawer.hidden);set('leave','Salir de la sala',false);
 }
 dispose(){this.root.remove();this.dom.body.classList.remove('studio-in-room');}
}
