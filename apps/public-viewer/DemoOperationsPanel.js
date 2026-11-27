export default class DemoOperationsPanel {
 constructor({document,window,operations,onOpen,onClose,onRestart,onStart,notify}){
  Object.assign(this,{document,window,operations,onOpen,onClose,onRestart,notify});this.opened=false;this.elapsed=0;
  const el=(tag,parent,text,cls)=>{const node=document.createElement(tag);if(text)node.textContent=text;if(cls)node.className=cls;if(parent)parent.appendChild(node);return node;};
  this.dialog=el('dialog',document.body,null,'demo-operations');this.dialog.setAttribute('aria-label','Dashboard de operación de la instalación');
  const header=el('header',this.dialog,null,'demo-operations-header');el('h2',header,'Dashboard de operación');this.closeButton=el('button',header,'Cerrar');this.closeButton.type='button';this.closeButton.addEventListener('click',()=>this.close());
  el('p',this.dialog,'Llegada de cajas → Recepción → Paletizado → Recogida → Almacén o despacho','demo-operations-route');this.status=el('p',this.dialog,null,'demo-operations-status');
  const grid=el('div',this.dialog,null,'demo-operations-kpis');this.values=new Map();
  for(const [key,label]of [['generated','Cajas emitidas'],['arrived','Cajas recibidas'],['waiting','Cajas en espera'],['palletized','Cajas paletizadas'],['pallets','Pallets terminados'],['ready','Pallets en recogida'],['stock','Ocupación del almacén'],['dispatched','Pallets en despacho']]){const card=el('div',grid);this.values.set(key,el('strong',card));el('span',card,label);}
  const row=el('div',this.dialog,null,'demo-operations-target');const label=el('label',row,'Controlar ');this.target=el('select',label);this.target.setAttribute('aria-label','Equipo o línea completa');this.target.addEventListener('change',()=>this.refresh());
  const controls=el('div',this.dialog,null,'demo-operations-controls');this.buttons=new Map();
  for(const [action,label]of [['powerOn','Encender'],['start','Iniciar'],['stop','Detener'],['pause','Pausar'],['emergency','Emergencia'],['resetEmergency','Rearmar']]){const button=el('button',controls,label);button.type='button';button.dataset.operation=action;button.addEventListener('click',()=>{try{const result=operations.command(action,this.target.value);if(result===false)notify('Comprueba el estado del equipo antes de continuar.');else if(action==='start'&&onStart)onStart();this.refresh();}catch(error){notify(error.message);}});this.buttons.set(action,button);}
  el('p',this.dialog,'Rearmar no inicia la marcha. Las paradas conservan los productos y el avance del lote.','demo-operations-help');
  el('h3',this.dialog,'Estados y últimos eventos');this.states=el('p',this.dialog,null,'demo-operations-states');this.events=el('ol',this.dialog,null,'demo-operations-events');
  const footer=el('footer',this.dialog);const restart=el('button',footer,'Reiniciar escenario');restart.type='button';restart.addEventListener('click',()=>{onRestart();this.refresh();});
  this.dialog.addEventListener('cancel',event=>{event.preventDefault();this.close();});this.dialog.addEventListener('close',()=>this.closed());
 }
 open(){if(this.opened)return;this.onOpen();this.opened=true;this.dialog.showModal();this.refresh();this.closeButton.focus();}
 closed(){if(!this.opened)return;this.opened=false;this.onClose();}
 close(){if(!this.opened)return;this.dialog.close();this.closed();}
 step(delta){if(!this.opened)return;this.elapsed+=delta;if(this.elapsed>=.5){this.elapsed=0;this.refresh();}}
 refresh(){
  const s=this.operations.snapshot();this.status.textContent=s.instruction;this.status.dataset.tone=s.tone;
  for(const [key,node]of this.values)node.textContent=key==='generated'?s.generated+' / '+s.total:key==='stock'?s.stock+' / '+s.slots:String(s[key]);
  const signature=s.machines.map(m=>m.id+':'+m.name).join('|');if(signature!==this.signature){const selected=this.target.value;this.signature=signature;this.target.replaceChildren();for(const row of [{id:'',name:'Línea completa'},...s.machines]){const option=this.document.createElement('option');option.value=row.id;option.textContent=row.name;this.target.appendChild(option);}if(s.machines.some(m=>m.id===selected))this.target.value=selected;}
  const selected=s.machines.find(m=>m.id===this.target.value);this.buttons.get('pause').textContent=(selected?selected.paused:s.paused)?'Continuar':'Pausar';this.states.textContent=s.machines.map(m=>m.name+': '+m.state).join(' · ');
  this.events.replaceChildren();for(const event of s.events){const item=this.document.createElement('li');item.textContent=Number(event.time).toFixed(1)+' s · '+event.message;this.events.appendChild(item);}
 }
 dispose(){this.close();this.dialog.remove();}
}
