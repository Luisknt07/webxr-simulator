import {GAMEPAD_ACTIONS,STANDARD_BINDINGS} from './GamepadInput.js';

const clean=(value,max=240)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max):'';
const CHANNELS=[['steer','Dirección'],['throttle','Avance / retroceso'],['brake','Freno'],['lift','Elevación'],['tilt','Inclinación'],['sideShift','Desplazamiento lateral'],['reach','Alcance'],['turret','Torreta']];
let serial=0;

/** Explicit, local Gamepad API configuration. This view never requests device
 * permissions, uses WebHID, drives a vehicle, or owns the input adapter. */
export default class InputDevicePanel {
 constructor({document:dom,window:win,input,onOpen,onClose}={}){
  if(!input||typeof input.getState!=='function'||typeof input.configure!=='function')throw Error('El panel necesita un adaptador de controles.');
  this.document=dom||(typeof document==='undefined'?null:document);this.window=win||this.document&&this.document.defaultView;this.input=input;this.onOpen=onOpen;this.onClose=onClose;this.opened=false;this.disposed=false;this.listeners=[];this.dynamic=[];this.id='input-devices-'+(++serial);this.activeKey='';this.model={};this.lastPaint=-Infinity;this.deviceSignature='';this.profileSignature='';
 }
 get isOpen(){return this.opened;}
 create(tag,name,text,parent){const node=this.document.createElement(tag);if(name)node.className=name;if(text)node.textContent=text;if(parent)parent.appendChild(node);return node;}
 listen(node,type,callback,list=this.listeners){node.addEventListener(type,callback);list.push(()=>node.removeEventListener(type,callback));}
 action(text,parent,callback,list=this.listeners){const button=this.create('button','input-device-action',text,parent);button.type='button';this.listen(button,'click',()=>this.invoke(callback),list);return button;}
 invoke(callback){if(this.disposed)return false;try{const result=callback();this.error.textContent='';this.update(this.input.getState(),true);return result;}catch(error){this.error.textContent=clean(error&&error.message,500)||'No se pudo guardar el control. Revisa sus valores.';return false;}}
 mount(parent){
  if(this.disposed||this.element||!this.document||!this.document.body)return this;
  const dom=this.document;
  this.button=this.create('button','input-device-launcher','',parent||dom.body);this.button.type='button';this.button.dataset.inputDevices='';this.button.setAttribute('aria-haspopup','dialog');this.button.setAttribute('aria-expanded','false');
  this.create('span','input-device-launcher-label','◉ Controles',this.button);this.indicator=this.create('small','input-device-launcher-status','Sin mando',this.button);this.listen(this.button,'click',()=>this.open());
  this.element=this.create('div','input-device-overlay','',dom.body);this.element.hidden=true;
  this.panel=this.create('section','input-device-panel','',this.element);this.panel.setAttribute('role','dialog');this.panel.setAttribute('aria-modal','true');this.panel.setAttribute('aria-labelledby',this.id+'-title');this.panel.tabIndex=-1;
  const header=this.create('div','input-device-header','',this.panel),title=this.create('div','','',header);this.create('small','input-device-eyebrow','MANDOS Y VOLANTES',title);this.create('h2','','Configura tus controles',title).id=this.id+'-title';this.closeButton=this.action('×',header,()=>this.close());this.closeButton.setAttribute('aria-label','Cerrar controles');
  this.tabs=this.create('nav','input-device-tabs','',this.panel);this.tabs.setAttribute('role','tablist');this.tabs.setAttribute('aria-label','Ajustes de controles');this.tabButtons={};this.panes={};
  const body=this.create('div','input-device-body','',this.panel);this.body=body;
  for(const [key,text]of [['devices','Dispositivos'],['axes','Ejes y pedales'],['buttons','Botones']]){
   const button=this.action(text,this.tabs,()=>this.setTab(key));button.id=this.id+'-tab-'+key;button.setAttribute('role','tab');button.setAttribute('aria-controls',this.id+'-'+key);this.tabButtons[key]=button;
   const pane=this.create('section','input-device-pane','',body);pane.id=this.id+'-'+key;pane.setAttribute('role','tabpanel');pane.setAttribute('aria-labelledby',button.id);this.panes[key]=pane;
   this.listen(button,'keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const keys=Object.keys(this.tabsByKey||this.tabButtons),index=keys.indexOf(key),at=event.key==='Home'?0:event.key==='End'?keys.length-1:(index+(event.key==='ArrowRight'?1:-1)+keys.length)%keys.length;this.setTab(keys[at]);this.tabButtons[keys[at]].focus();});
  }
  this.buildDevices();this.buildAxes();this.buildButtons();
  const footer=this.create('div','input-device-footer','',this.panel);this.status=this.create('p','input-device-status','',footer);this.status.setAttribute('role','status');this.status.setAttribute('aria-live','polite');this.error=this.create('p','input-device-error','',footer);this.error.setAttribute('role','alert');
  for(const type of ['pointerdown','pointerup','mousedown','mouseup','click','dblclick','touchstart','touchend','wheel','keyup'])this.listen(this.element,type,event=>event.stopPropagation());
  this.listen(this.element,'keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();this.close();}else if(event.key==='Tab')this.trapFocus(event);});
  this.listen(this.element,'click',event=>{if(event.target===this.element)this.close();});
  this.listen(dom,'visibilitychange',()=>{if(dom.hidden&&this.opened)this.close();});
  if(typeof this.input.subscribe==='function')this.unsubscribe=this.input.subscribe(state=>this.update(state));
  this.setTab('devices');this.update(this.input.getState(),true);return this;
 }
 setting(label,type,parent){const row=this.create('label','input-device-field','',parent);this.create('span','',label,row);const input=this.create(type==='select'?'select':'input','','',row);if(type!=='select')input.type=type;return input;}
 option(select,value,label){const item=this.create('option','',label,select);item.value=String(value);return item;}
 buildDevices(){
  const pane=this.panes.devices;this.create('p','input-device-help','Conecta el mando, volante o pedales por USB o Bluetooth y pulsa un botón. Los dispositivos disponibles aparecen aquí; no se solicita acceso especial al hardware.',pane);
  this.enabled=this.setting('Usar controles externos','checkbox',pane);this.listen(this.enabled,'change',()=>this.invoke(()=>this.input.configure({enabled:this.enabled.checked})));
  this.automatic=this.setting('Elegir automáticamente un mando estándar','checkbox',pane);this.listen(this.automatic,'change',()=>this.invoke(()=>this.input.configure({deviceKeys:this.automatic.checked?null:(this.model.selectedKeys||[]).slice()})));
  this.deviceList=this.create('div','input-device-list','',pane);this.devicesEmpty=this.create('p','input-device-help','',pane);
  this.action('Actualizar dispositivos',pane,()=>{this.input.reset('settings-refresh');this.step(true);});
  const legend=this.create('details','input-device-legend','',pane);this.create('summary','','Controles de PlayStation / mando estándar',legend);
  const table=this.create('table','','',legend),body=this.create('tbody','','',table);
  for(const [control,functionality]of [['Palanca izquierda','Dirección y avance / retroceso'],['Palanca derecha','Elevación e inclinación'],['L2 / LT','Freno']]){const row=this.create('tr','','',body);this.create('th','',control,row);this.create('td','',functionality,row);}
  for(const definition of GAMEPAD_ACTIONS.filter(row=>row.ps||row.xbox)){const row=this.create('tr','','',body);this.create('th','',[definition.ps,definition.xbox].filter(Boolean).join(' / '),row);this.create('td','',definition.label,row);}
  this.create('p','input-device-help','El modo estándar funciona automáticamente. Los volantes y pedales con otra distribución necesitan una asignación explícita. Puedes combinar un volante y unos pedales seleccionando ambos.',pane);
 }
 deviceSelector(parent){const select=this.setting('Dispositivo para configurar','select',parent);this.listen(select,'change',()=>{this.activeKey=select.value;this.profileSignature='';this.update(this.input.getState(),true);});return select;}
 buildAxes(){
  const pane=this.panes.axes;this.axisDevice=this.deviceSelector(pane);
  this.kind=this.setting('Tipo de dispositivo','select',pane);for(const [value,label]of [['wheel','Volante'],['pedals','Pedales'],['gamepad','Mando personalizado']])this.option(this.kind,value,label);
  this.listen(this.kind,'change',()=>this.invoke(()=>this.input.updateProfile(this.activeKey,{kind:this.kind.value})));
  const grid=this.create('div','input-device-grid','',pane);this.channel=this.setting('Función del vehículo','select',grid);for(const [value,label]of CHANNELS)this.option(this.channel,value,label);this.option(this.channel,'combinedPedals','Pedales combinados · acelerador y freno');
  this.axis=this.setting('Número de eje','number',grid);this.axis.min='0';this.axis.max='15';this.axis.step='1';this.axis.value='0';
  this.mode=this.setting('Tipo de movimiento','select',grid);this.option(this.mode,'bipolar','Bidireccional · volante / palanca');this.option(this.mode,'pedal','Pedal · reposo y fondo');
  this.deadzone=this.setting('Zona muerta · 0 a 0,45','number',grid);this.deadzone.min='0';this.deadzone.max='.45';this.deadzone.step='.01';this.deadzone.value='.08';
  this.invert=this.setting('Invertir sentido','checkbox',grid);
  this.live=this.create('output','input-device-live','Eje actual: —',pane);this.live.setAttribute('aria-live','off');
  this.endpoints={};this.captureButtons={};
  const calibration=this.create('fieldset','input-device-calibration','',pane);this.create('legend','','Calibración',calibration);
  for(const [key,label]of [['min','Extremo menor / mínimo'],['rest','Centro / reposo'],['max','Extremo mayor / máximo'],['full','Pedal a fondo']]){
   const row=this.create('div','input-device-capture','',calibration),field=this.setting(label,'number',row);field.min='-1';field.max='1';field.step='.001';this.endpoints[key]=field;field.calibrationRow=row;
   this.captureButtons[key]=this.action('Capturar',row,()=>{const index=this.axisIndex(),value=this.input.captureCalibration(this.activeKey,index);if(!Number.isFinite(value))throw Error('No se pudo leer este eje.');field.value=String(Math.round(value*10000)/10000);});this.captureButtons[key].setAttribute('aria-label','Capturar '+label.toLowerCase());
  }
  this.directionHelp=this.create('p','input-device-help','',pane);
  this.listen(this.channel,'change',()=>this.loadCalibration());this.listen(this.mode,'change',()=>this.calibrationMode());
  this.applyAxis=this.action('Guardar calibración',pane,()=>{
   const mode=this.mode.value,mapping={index:this.axisIndex(),mode,deadzone:this.number(this.deadzone,'zona muerta'),invert:mode==='bipolar'&&this.invert.checked};
   mapping.rest=this.number(this.endpoints.rest,'reposo');if(mode==='pedal')mapping.full=this.number(this.endpoints.full,'pedal a fondo');else{mapping.min=this.number(this.endpoints.min,'mínimo');mapping.max=this.number(this.endpoints.max,'máximo');}
   if(this.channel.value==='combinedPedals')this.input.updateProfile(this.activeKey,{combinedPedals:mapping,axes:{throttle:null,brake:null}});
   else if(['throttle','brake'].includes(this.channel.value)&&this.profile().combinedPedals)this.input.updateProfile(this.activeKey,{combinedPedals:null,axes:{[this.channel.value]:mapping}});
   else this.input.calibrate(this.activeKey,this.channel.value,mapping);this.input.reset('calibration-updated');
  });
  this.action('Quitar esta función',pane,()=>{if(!this.activeKey)throw Error('Selecciona un dispositivo.');this.input.updateProfile(this.activeKey,this.channel.value==='combinedPedals'?{combinedPedals:null}:{axes:{[this.channel.value]:null}});this.input.reset('axis-removed');});
  this.axisMappings=this.create('div','input-device-mappings','',pane);
  this.action('Restablecer este dispositivo',pane,()=>{if(!this.activeKey)throw Error('Selecciona un dispositivo.');this.input.removeProfile(this.activeKey);this.input.reset('profile-reset');});
 }
 buildButtons(){
  const pane=this.panes.buttons;this.buttonDevice=this.deviceSelector(pane);const grid=this.create('div','input-device-grid','',pane);
  this.command=this.setting('Función','select',grid);for(const row of GAMEPAD_ACTIONS)this.option(this.command,row.action,row.label);
  this.buttonIndex=this.setting('Número de botón','number',grid);this.buttonIndex.min='0';this.buttonIndex.max='31';this.buttonIndex.step='1';this.buttonIndex.value='0';
  this.liveButtons=this.create('output','input-device-live','Botones pulsados: ninguno',pane);this.liveButtons.setAttribute('aria-live','off');
  this.applyButton=this.action('Asignar botón',pane,()=>{const index=this.number(this.buttonIndex,'botón');if(!Number.isInteger(index)||index<0||index>31)throw Error('Indica un botón entre 0 y 31.');if(!this.activeKey)throw Error('Selecciona un dispositivo.');this.input.updateProfile(this.activeKey,{buttons:{[this.command.value]:index}});this.input.reset('buttons-updated');});
  this.action('Quitar botón de esta función',pane,()=>{if(!this.activeKey)throw Error('Selecciona un dispositivo.');this.input.updateProfile(this.activeKey,{buttons:{[this.command.value]:null}});this.input.reset('button-removed');});
  this.buttonMappings=this.create('div','input-device-mappings','',pane);
  const reverse=this.create('fieldset','input-device-calibration','',pane);this.create('legend','','Marcha atrás para volante y pedales',reverse);
  const row=this.create('div','input-device-capture','',reverse);this.reverseIndex=this.setting('Botón mantenido · opcional','number',row);this.reverseIndex.min='0';this.reverseIndex.max='31';this.reverseIndex.step='1';
  this.reverseCapture=this.action('Capturar',row,()=>{const current=this.input.getState(),device=(current.devices||[]).find(value=>value.key===this.activeKey),pressed=device&&Array.isArray(device.buttons)?device.buttons.map((value,index)=>value>.5?index:null).filter(value=>value!==null):[];if(pressed.length!==1)throw Error('Mantén pulsado un único botón para asignar la marcha atrás.');this.reverseIndex.value=String(pressed[0]);});
  this.reverseApply=this.action('Guardar marcha atrás',reverse,()=>{if(!this.activeKey)throw Error('Selecciona un dispositivo.');const index=this.reverseIndex.value===''?null:this.number(this.reverseIndex,'marcha atrás');if(index!==null&&(!Number.isInteger(index)||index<0||index>31))throw Error('Indica un botón entre 0 y 31, o deja el campo vacío.');this.input.updateProfile(this.activeKey,{reverseButton:index});this.input.reset('reverse-updated');});
  this.create('p','input-device-help','Con un acelerador de pedal, mantén este botón para retroceder. Déjalo vacío para quitar la asignación. El mando estándar ya usa el sentido de su palanca izquierda.',reverse);
  this.create('p','input-device-help','Pulsa un botón para ver su número. Las acciones se ejecutan una vez por pulsación; al cerrar este panel debes soltar los controles antes de conducir.',pane);
 }
 number(field,name){if(field.value===''||!Number.isFinite(Number(field.value)))throw Error('Captura o escribe un valor válido para '+name+'.');return Number(field.value);}
 axisIndex(){const value=this.number(this.axis,'eje');if(!Number.isInteger(value)||value<0||value>15)throw Error('Indica un eje entre 0 y 15.');if(!this.activeKey)throw Error('Selecciona un dispositivo.');return value;}
 selectedDevice(){return (this.model.devices||[]).find(device=>device.key===this.activeKey)||null;}
 focusables(){const list=[],visit=(node,closed=false)=>{if(node.hidden||closed)return;const tag=String(node.tagName||'').toLowerCase(),style=this.window&&this.window.getComputedStyle&&this.window.getComputedStyle(node),tabindex=node.getAttribute&&node.getAttribute('tabindex');if(style&&style.display==='none')return;if(!node.disabled&&node.tabIndex!==-1&&(['button','input','select','textarea','summary'].includes(tag)||tabindex!==null&&tabindex!==undefined))list.push(node);for(const child of Array.from(node.children||[]))visit(child,tag==='details'&&!node.open&&String(child.tagName||'').toLowerCase()!=='summary');};visit(this.panel);return list;}
 trapFocus(event){const nodes=this.focusables(),first=nodes[0],last=nodes[nodes.length-1],active=this.document.activeElement;if(!first){event.preventDefault();this.panel.focus();}else if(!nodes.includes(active)||event.shiftKey&&active===first||!event.shiftKey&&active===last){event.preventDefault();(event.shiftKey?last:first).focus();}}
 profile(){const device=this.selectedDevice();if(!device)return {};const explicit=device.profile||this.model.profiles&&this.model.profiles[device.key];if(explicit)return explicit;if(!device.standard)return {};const standard=this.model.standardBindings||STANDARD_BINDINGS;return {kind:'gamepad',axes:Object.fromEntries(Object.entries(standard.axes||{}).filter(([,map])=>map.index<(device.axes||[]).length)),buttons:Object.fromEntries(Object.entries(standard.buttons||{}).filter(([,index])=>index<(device.buttons||[]).length)),...((device.buttons||[]).length>standard.brakeButton?{brakeButton:standard.brakeButton}:{})};}
 calibrationMode(){const pedal=this.mode.value==='pedal';this.endpoints.min.calibrationRow.hidden=pedal;this.endpoints.max.calibrationRow.hidden=pedal;this.endpoints.full.calibrationRow.hidden=!pedal;this.invert.disabled=pedal;this.directionHelp.textContent=pedal?'Suelta el pedal y captura Reposo; presiónalo a fondo y captura Pedal a fondo. El sentido se obtiene de esas dos lecturas.':'Centra el volante o la palanca, captura el reposo y los extremos de menor y mayor valor. Invierte el sentido si la dirección queda al revés. La zona muerta evita movimientos involuntarios.';}
 loadCalibration(){const profile=this.profile(),combined=this.channel.value==='combinedPedals',mapping=(combined?profile.combinedPedals:profile.axes&&profile.axes[this.channel.value])||{};this.axis.value=String(Number.isInteger(mapping.index)?mapping.index:0);this.mode.disabled=combined;this.mode.value=combined?'bipolar':mapping.mode||(['brake'].includes(this.channel.value)?'pedal':'bipolar');this.deadzone.value=String(Number.isFinite(mapping.deadzone)?mapping.deadzone:.08);this.invert.checked=!!mapping.invert;for(const key of ['min','rest','max','full'])this.endpoints[key].value=Number.isFinite(mapping[key])?String(mapping[key]):key==='min'?'-1':key==='max'?'1':key==='rest'&&this.mode.value==='bipolar'?'0':'';this.calibrationMode();if(combined)this.directionHelp.textContent='Un eje compartido usa un extremo para acelerar y el otro para frenar. Captura los dos extremos y el reposo; invierte el sentido si hace falta. Guardar reemplaza las asignaciones independientes de acelerador y freno.';}
 setTab(key){if(!this.panes||!this.panes[key])return;if(this.tab!==key&&this.body)this.body.scrollTop=0;this.tab=key;for(const name of Object.keys(this.panes)){this.panes[name].hidden=name!==key;this.tabButtons[name].setAttribute('aria-selected',String(name===key));this.tabButtons[name].tabIndex=name===key?0:-1;}}
 open(){if(this.disposed||!this.element)return false;if(this.opened)return true;this.opened=true;this.element.hidden=false;this.button.setAttribute('aria-expanded','true');this.input.reset('settings-opened');if(this.onOpen)this.onOpen();this.update(this.input.getState(),true);if(this.body)this.body.scrollTop=0;(this.tab==='devices'?this.enabled:this.tabButtons[this.tab]).focus();return true;}
 close(){if(!this.opened)return false;this.opened=false;if(this.element)this.element.hidden=true;if(this.button)this.button.setAttribute('aria-expanded','false');this.input.reset('settings-closed');if(this.onClose)this.onClose();if(this.button&&this.button.focus)this.button.focus();return true;}
 step(force=false){if(this.disposed||!this.element)return;this.update(this.input.getState(),force);}
 update(state={},force=false){
  if(this.disposed)return;this.model=state||{};if(!this.element)return;
  const devices=(Array.isArray(state.devices)?state.devices:[]).slice(0,8),selected=Array.isArray(state.selectedKeys)?state.selectedKeys:[],mapped=devices.filter(device=>selected.includes(device.key));
  const short=!state.enabled?'Desactivado':!devices.length?'Sin mando':!mapped.length?'Sin asignar':mapped.length>1?mapped.length+' conectados':mapped[0].standard?'Mando listo':'Dispositivo';
  this.indicator.textContent=short;this.button.title='Controles · '+short;this.button.setAttribute('aria-label','Configurar controles. '+short);
  if(!this.opened&&!force)return;
  const now=Date.now();if(!force&&now-this.lastPaint<120)return;this.lastPaint=now;
  this.enabled.checked=!!state.enabled;this.automatic.checked=state.automatic===true||state.deviceKeys===null;
  this.status.textContent=!state.enabled?'Los controles externos están desactivados.':!devices.length?'Pulsa un botón del mando para que el navegador lo detecte.':'La conducción está bloqueada durante la configuración. Al cerrar, suelta palancas, pedales y botones para volver a conducir.';
  this.devicesEmpty.textContent=devices.length?'Puedes seleccionar varios dispositivos, por ejemplo un volante y pedales independientes.':'No se ha detectado ningún dispositivo. Teclado y controles táctiles siguen disponibles.';
  if(!devices.some(device=>device.key===this.activeKey)){this.activeKey=mapped[0]&&mapped[0].key||devices[0]&&devices[0].key||'';this.profileSignature='';}
  const signature=JSON.stringify(devices.map(device=>[device.key,device.label,device.standard,device.axes&&device.axes.length,device.buttons&&device.buttons.length,selected.includes(device.key)]));
  if(signature!==this.deviceSignature){this.deviceSignature=signature;for(const remove of this.dynamic.splice(0))remove();this.deviceList.textContent='';this.axisDevice.textContent='';this.buttonDevice.textContent='';
   for(const device of devices){const card=this.create('article','input-device-card','',this.deviceList),pick=this.create('label','input-device-choice','',card),checkbox=this.create('input','','',pick);checkbox.type='checkbox';checkbox.checked=selected.includes(device.key);this.create('span','',clean(device.label)||'Dispositivo '+device.index,pick);this.create('small','',device.standard?'Mando estándar · distribución automática':'Distribución específica · requiere asignación',card);this.create('small','',(device.axes||[]).length+' ejes · '+(device.buttons||[]).length+' botones',card);
    this.listen(checkbox,'change',()=>this.invoke(()=>{const keys=new Set(this.model.selectedKeys||[]);checkbox.checked?keys.add(device.key):keys.delete(device.key);this.input.configure({deviceKeys:[...keys]});}),this.dynamic);
    this.action('Configurar',card,()=>{this.activeKey=device.key;this.profileSignature='';this.setTab('axes');},this.dynamic);this.option(this.axisDevice,device.key,clean(device.label)||'Dispositivo '+device.index);this.option(this.buttonDevice,device.key,clean(device.label)||'Dispositivo '+device.index);
   }
  }
  this.axisDevice.value=this.activeKey;this.buttonDevice.value=this.activeKey;const device=this.selectedDevice(),profile=this.profile(),profileSignature=JSON.stringify([this.activeKey,profile]);
  if(profileSignature!==this.profileSignature){this.profileSignature=profileSignature;this.kind.value=profile.kind||(device&&device.standard?'gamepad':'wheel');this.loadCalibration();this.axisMappings.textContent='';for(const [channel,map]of Object.entries(profile.axes||{}).slice(0,8))this.create('p','',((CHANNELS.find(row=>row[0]===channel)||[])[1]||channel)+' · eje '+map.index+' · '+(map.mode==='pedal'?'pedal calibrado':'bidireccional'),this.axisMappings);if(profile.combinedPedals)this.create('p','','Pedales combinados · eje '+profile.combinedPedals.index,this.axisMappings);this.buttonMappings.textContent='';for(const [action,index]of Object.entries(profile.buttons||{}).slice(0,32))this.create('p','',((GAMEPAD_ACTIONS.find(row=>row.action===action)||{}).label||action)+' · botón '+index,this.buttonMappings);this.reverseIndex.value=Number.isInteger(profile.reverseButton)?String(profile.reverseButton):'';}
  this.axisDevice.disabled=this.buttonDevice.disabled=this.kind.disabled=this.applyAxis.disabled=this.applyButton.disabled=this.reverseCapture.disabled=this.reverseApply.disabled=!device;
  for(const button of Object.values(this.captureButtons))button.disabled=!device;
  const axisIndex=Number(this.axis.value),raw=device&&Array.isArray(device.axes)&&device.axes[axisIndex];this.live.textContent='Eje '+(Number.isInteger(axisIndex)?axisIndex:'—')+' actual: '+(Number.isFinite(raw)?raw.toFixed(3):'—');
  const pressed=device&&Array.isArray(device.buttons)?device.buttons.slice(0,64).map((value,index)=>value>.5?index:null).filter(value=>value!==null):[];this.liveButtons.textContent='Botones pulsados: '+(pressed.length?pressed.join(', '):'ninguno');
 }
 dispose(){if(this.disposed)return;this.close();this.disposed=true;if(this.unsubscribe)this.unsubscribe();for(const remove of [...this.dynamic.splice(0),...this.listeners.splice(0)])remove();for(const node of [this.element,this.button])if(node&&node.parentNode)node.parentNode.removeChild(node);this.element=this.panel=this.button=null;}
}
