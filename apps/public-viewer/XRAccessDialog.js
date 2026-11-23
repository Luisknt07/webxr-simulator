/** The public VR action remains visible when a desktop has no immersive
 * device. Only a supported browser can request an actual immersive session. */
export default class XRAccessDialog {
 constructor(ctx,{document=globalThis.document}={}){this.ctx=ctx;this.document=document;this.dialog=null;this.disposed=false;this.opened=false;}
 open({reason}={},entry){
  if(this.disposed||this.opened)return;
  const d=this.document,ctx=this.ctx,dialog=d.createElement('dialog');this.dialog=dialog;this.opened=true;this.previousGate=!!ctx.publicDialogOpen;this.previousFocus=d.activeElement;
  dialog.className='viewer-access-dialog viewer-xr-help';dialog.setAttribute('aria-labelledby','viewer-xr-help-title');
  const title=d.createElement('h2');title.id='viewer-xr-help-title';title.textContent='Realidad virtual';
  const description=d.createElement('p');description.textContent=reason==='insecure'?'La realidad virtual necesita una dirección HTTPS. Abre la dirección segura desde el navegador del visor.':'Este navegador todavía no detecta un visor de realidad virtual compatible.';
  const instructions=d.createElement('p');instructions.textContent='Abre esta misma página en el navegador de tu visor. En un PC, conecta y activa primero el visor compatible. Después pulsa «Realidad virtual» y acepta el permiso para entrar.';
  const status=d.createElement('p');status.className='viewer-xr-status';status.setAttribute('role','status');
  const actions=d.createElement('div');actions.className='viewer-xr-actions';
  if(reason==='insecure'){
   const secure=d.createElement('a');secure.textContent='Abrir dirección HTTPS';secure.href=d.location.href.replace(/^http:/,'https:');actions.appendChild(secure);
  }
  const retry=d.createElement('button');retry.type='button';retry.textContent='Volver a detectar';
  retry.onclick=async()=>{retry.disabled=true;try{const supported=entry&&entry.refreshSupport&&await entry.refreshSupport();if(this.disposed||this.dialog!==dialog)return;if(supported){this.close();if(ctx.notify)ctx.notify('Visor detectado. Pulsa Realidad virtual para entrar.');}else status.textContent='Todavía no se detecta un visor. Puedes continuar explorando y volver a comprobarlo cuando esté conectado.';}catch(_){if(!this.disposed&&this.dialog===dialog)status.textContent='No se pudo comprobar el visor. Revisa los permisos de realidad virtual del navegador.';}finally{if(!this.disposed&&this.dialog===dialog)retry.disabled=false;}};
  const close=d.createElement('button');close.type='button';close.textContent='Volver al escenario';close.onclick=()=>this.close();actions.append(retry,close);dialog.append(title,description,instructions,status,actions);d.body.appendChild(dialog);
  dialog.addEventListener('close',()=>{if(this.dialog===dialog)this.release();});dialog.addEventListener('cancel',()=>{if(this.dialog===dialog)this.release();});
  ctx.publicDialogOpen=true;if(ctx.input)ctx.input.reset();if(ctx.demo)ctx.demo.driving.resetInput();if(ctx.desktopLook)ctx.desktopLook.unlock();
  if(dialog.showModal)dialog.showModal();else dialog.setAttribute('open','');close.focus();
 }
 release(){if(!this.opened)return;this.opened=false;this.ctx.publicDialogOpen=this.previousGate;if(this.ctx.input)this.ctx.input.reset();if(this.dialog){this.dialog.remove();this.dialog=null;}if(this.previousFocus&&this.previousFocus.isConnected)this.previousFocus.focus();}
 close(){if(this.dialog&&this.dialog.open&&this.dialog.close)this.dialog.close();this.release();}
 dispose(){this.disposed=true;this.close();}
}
