const ROOT='modules/logistica-industrial/practices/assets/tutorials/';
export const RECEIVING_VIDEO_MANIFEST=ROOT+'cedi-01-guide.json';
const element=(tag,className,text,parent)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=String(text);if(parent)parent.appendChild(node);return node;};
const boundedText=(value,max)=>typeof value==='string'&&value.trim()&&value.length<=max;
const localFile=(value,name)=>value===ROOT+name;
/** A signed-in instructional video never changes an attempt or fabricates evidence. */
export function validateReceivingVideoManifest(value){
 if(!value||value.format!=='smarttwin.receiving-video-guide'||value.version!==1||value.practiceId!=='CEDI-01'||!boundedText(value.title,180))throw Error('La ficha de la videoguía no es válida.');
 if(!value.video||!localFile(value.video.src,'cedi-01-guide.mp4')||!Number.isFinite(value.video.duration)||value.video.duration<=0||value.video.duration>900)throw Error('El vídeo debe ser un archivo local de CEDI-01.');
 if(!value.poster||!localFile(value.poster.src,'cedi-01-guide-poster.jpg')||!boundedText(value.poster.alt,300))throw Error('Falta la portada local de la videoguía.');
 if(!value.captions||!localFile(value.captions.src,'cedi-01-guide.vtt')||value.captions.language!=='es'||!boundedText(value.captions.label,60))throw Error('Faltan los subtítulos en español.');
 const ids=['configuration','step-1','step-2','step-3','step-4','step-5','step-6'];
 if(!Array.isArray(value.chapters)||value.chapters.length!==ids.length)throw Error('La videoguía debe incluir configuración y seis misiones.');
 let end=0;for(const [index,row]of value.chapters.entries()){
  if(!row||row.id!==ids[index]||!boundedText(row.title,180)||!boundedText(row.summary,1000)||!Number.isFinite(row.start)||!Number.isFinite(row.end)||Math.abs(row.start-end)>.01||row.end<=row.start||row.end>value.video.duration+.5||!Array.isArray(row.transcript)||!row.transcript.length||row.transcript.length>30||row.transcript.some(text=>!boundedText(text,3000)))throw Error('Los capítulos de la videoguía no son válidos.');end=row.end;
 }
 if(Math.abs(end-value.video.duration)>.5)throw Error('Los capítulos deben cubrir la duración completa de la videoguía.');
 return value;
}
const clock=seconds=>Math.floor(seconds/60)+':'+String(Math.floor(seconds%60)).padStart(2,'0');
export function holdReceivingVideoInput(ctx){
 if(!ctx)return()=>{};const previous=ctx.publicDialogOpen;ctx.publicDialogOpen=true;
 if(ctx.vehicleDriving&&ctx.vehicleDriving.resetInput)ctx.vehicleDriving.resetInput();
 if(ctx.vehicleDriving&&ctx.vehicleDriving.releaseCursor)ctx.vehicleDriving.releaseCursor();
 if(ctx.editor&&ctx.editor.clearNavigation)ctx.editor.clearNavigation();
 if(ctx.editor&&ctx.editor.hooks&&ctx.editor.hooks.unlock)ctx.editor.hooks.unlock();
 let released=false;return()=>{if(released)return;released=true;ctx.publicDialogOpen=previous;if(ctx.vehicleDriving&&ctx.vehicleDriving.resetInput)ctx.vehicleDriving.resetInput();if(ctx.editor&&ctx.editor.clearNavigation)ctx.editor.clearNavigation();};
}
export default class ReceivingVideoGuide{
 constructor(host,{chapter='configuration',loadManifest,fetcher,baseURI=document.baseURI,inputContext}={}){
  this.disposed=false;this.selectedId=chapter;this.baseURI=baseURI;this.abort=typeof AbortController==='function'?new AbortController():null;
  this.releaseInput=holdReceivingVideoInput(inputContext);
  this.root=element('section','st-receiving-video',undefined,host);this.root.setAttribute('aria-label','Videoguía de recepción CEDI-01');
  this.status=element('p','st-receiving-video-status','Preparando la videoguía…',this.root);this.status.setAttribute('role','status');
  this.onVisibility=()=>{if(document.hidden&&this.video)this.video.pause();};if(document.addEventListener)document.addEventListener('visibilitychange',this.onVisibility);
  const request=fetcher||((url,options)=>fetch(url,options));this.ready=Promise.resolve().then(()=>loadManifest?loadManifest():request(new URL(RECEIVING_VIDEO_MANIFEST,this.baseURI).href,{credentials:'same-origin',signal:this.abort&&this.abort.signal}).then(async response=>{if(!response.ok)throw Error('No se pudo cargar la videoguía. Revisa tu sesión e inténtalo de nuevo.');const text=await response.text();if(text.length>100000)throw Error('La ficha de la videoguía es demasiado grande.');return JSON.parse(text);})).then(manifest=>{if(this.disposed)return;this.manifest=validateReceivingVideoManifest(manifest);this.render();}).catch(error=>{if(!this.disposed){this.status.textContent=error.message||'No se pudo abrir la videoguía.';this.root.setAttribute('data-video-state','error');}});
 }
 render(){
  const manifest=this.manifest;this.root.setAttribute('data-video-state','ready');this.status.textContent='Capturas del simulador · Caso A · Manual / mecanizada · Dificultad guiada. El vídeo se reproduce al pulsar Play; no completa misiones.';
  const heading=element('div','st-receiving-video-intro',undefined,this.root);element('h3','',manifest.title,heading);element('p','','Empieza por la configuración o elige un paso. Puedes pausar, ampliar el vídeo y consultar la transcripción.',heading);
  const grid=element('div','st-receiving-video-grid',undefined,this.root),media=element('div','st-receiving-video-media',undefined,grid);this.video=element('video','st-receiving-video-player',undefined,media);const video=this.video;video.controls=true;video.preload='none';video.playsInline=true;video.setAttribute('playsinline','');video.setAttribute('aria-label',manifest.title);video.poster=new URL(manifest.poster.src,this.baseURI).href;video.src=new URL(manifest.video.src,this.baseURI).href;
  const captions=element('track','',undefined,video);captions.kind='captions';captions.src=new URL(manifest.captions.src,this.baseURI).href;captions.srclang='es';captions.label=manifest.captions.label;captions.default=true;
  video.addEventListener('loadedmetadata',()=>{if(this.pendingSeek!==undefined){video.currentTime=this.pendingSeek;this.pendingSeek=undefined;}});
  video.addEventListener('timeupdate',()=>{if(this.disposed)return;const row=manifest.chapters.find(row=>video.currentTime>=row.start&&video.currentTime<row.end);if(row&&row.id!==this.selectedId)this.select(row.id,false);});
  video.addEventListener('error',()=>{if(!this.disposed)this.status.textContent='El vídeo no pudo reproducirse. Puedes consultar cada capítulo y su transcripción; vuelve a abrirlo para reintentar.';});
  const download=element('a','st-receiving-video-download','Abrir vídeo en otra pestaña',media);download.href=video.src;download.target='_blank';download.rel='noopener';
  const side=element('aside','st-receiving-video-chapters',undefined,grid);element('h4','','Configuración y seis misiones',side);this.buttons=new Map();
  for(const row of manifest.chapters){const button=element('button','st-receiving-video-chapter',undefined,side);button.type='button';button.setAttribute('data-video-chapter',row.id);element('span','st-receiving-video-time',clock(row.start),button);element('strong','',row.title,button);button.addEventListener('click',()=>this.select(row.id,true));this.buttons.set(row.id,button);}
  this.reading=element('section','st-receiving-video-reading',undefined,this.root);this.reading.setAttribute('aria-label','Explicación y transcripción del capítulo');this.select(this.selectedId,false);
  if(this.chapter.start>0){this.pendingSeek=this.chapter.start;video.addEventListener('play',()=>{if(this.pendingSeek!==undefined&&video.readyState>=1){video.currentTime=this.pendingSeek;this.pendingSeek=undefined;}},{once:true});}
 }
 select(id,seek){
  if(this.disposed||!this.manifest)return;const row=this.manifest.chapters.find(row=>row.id===id)||this.manifest.chapters[0];this.selectedId=row.id;this.chapter=row;
  for(const [key,button]of this.buttons){button.setAttribute('aria-pressed',String(key===row.id));if(key===row.id)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');}
  this.reading.textContent='';element('h4','',row.title,this.reading);element('p','st-receiving-video-summary',row.summary,this.reading);const details=element('details','st-receiving-video-transcript',undefined,this.reading);element('summary','','Leer explicación completa de este capítulo',details);for(const text of row.transcript)element('p','',text,details);
  if(seek){this.pendingSeek=row.start;if(this.video.readyState>=1){this.video.currentTime=row.start;this.pendingSeek=undefined;}const result=this.video.play();if(result&&result.catch)result.catch(()=>{if(!this.disposed)this.status.textContent='Capítulo seleccionado. Pulsa Play para comenzar la explicación.';});}
 }
 dispose(){if(this.disposed)return;this.disposed=true;try{if(this.abort)this.abort.abort();if(document.removeEventListener)document.removeEventListener('visibilitychange',this.onVisibility);if(this.video){this.video.pause();this.video.removeAttribute('src');for(const track of this.video.querySelectorAll('track'))track.removeAttribute('src');this.video.load();}this.root.remove();}finally{this.releaseInput();}}
}

/** A separate modal preserves all unsaved configuration fields underneath it. */
export function openReceivingVideoDialog({chapter='configuration',onClose,inputContext}={}){
 const dialog=element('dialog','st-receiving-video-dialog');dialog.setAttribute('aria-label','Videoguía · CEDI-01');const head=element('div','st-receiving-video-dialog-head',undefined,dialog);element('h2','','Videoguía · Recepción CEDI-01',head);const closer=element('button','','Volver a la configuración',head);closer.type='button';const host=element('div','st-receiving-video-dialog-content',undefined,dialog);document.body.appendChild(dialog);const viewer=new ReceivingVideoGuide(host,{chapter,inputContext});let disposed=false;
 const close=()=>{if(disposed)return;disposed=true;viewer.dispose();if(dialog.close&&dialog.open)dialog.close();dialog.remove();if(onClose)onClose();};closer.addEventListener('click',close);dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.addEventListener('close',close);if(dialog.showModal)dialog.showModal();else dialog.setAttribute('open','');if(closer.focus)closer.focus();return{dispose:close,viewer,dialog};
}
