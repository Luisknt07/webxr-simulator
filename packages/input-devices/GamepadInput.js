const CHANNELS=Object.freeze(['throttle','steer','brake','lift','tilt','reach','sideShift','turret']);
const COMMAND_ROWS=[['emergency','Emergencia','R3','R3'],['exit','Bajar del vehículo'],['stop','Detener'],['powerOff','Apagar'],['pause','Pausa'],['parkingBrake','Freno de estacionamiento','L1','LB'],['powerOn','Encender','Options','Menu'],['start','Marcha','R1','RB'],['pickup','Tomar carga','✕','A'],['release','Depositar carga','○','B'],['forkCamera','Cámara de horquillas','□','X'],['holographicGuide','Holograma','△','Y'],['horn','Bocina','Share','View'],['mode','Modo hidráulico'],['rearView','Retrovisor'],['forkCameraMode','Encuadre'],['forkCameraSide','Lado de cámara'],['resetEmergency','Rearmar'],['view','Vista'],['dockingHelp','Plano'],['guidanceNext','Siguiente objetivo'],['depositIntent','Preparar depósito'],['lights','Luces'],['cursor','Cursor']];
export const GAMEPAD_ACTIONS=Object.freeze(COMMAND_ROWS.map(([action,label,ps,xbox])=>Object.freeze({action,label,...(ps?{ps,xbox}:{})})));
const COMMANDS=new Set(GAMEPAD_ACTIONS.map(row=>row.action));
export const STANDARD_BINDINGS=Object.freeze({
 axes:Object.freeze({steer:Object.freeze({index:0,mode:'bipolar',min:-1,rest:0,max:1,deadzone:.16}),throttle:Object.freeze({index:1,mode:'bipolar',min:-1,rest:0,max:1,invert:true,deadzone:.2}),lift:Object.freeze({index:3,mode:'bipolar',min:-1,rest:0,max:1,invert:true,deadzone:.2}),tilt:Object.freeze({index:2,mode:'bipolar',min:-1,rest:0,max:1,deadzone:.2})}),
 buttons:Object.freeze({pickup:0,release:1,forkCamera:2,holographicGuide:3,parkingBrake:4,start:5,horn:8,powerOn:9,emergency:11}),brakeButton:6,
 labels:Object.freeze({driveForward:'L ↑',driveReverse:'L ↓',steerLeft:'L ←',steerRight:'L →',liftUp:'R ↑',liftDown:'R ↓',tiltBack:'R ←',tiltForward:'R →',brake:'L2'})
});
const STORAGE_KEY='smarttwin.input-devices.v1',MAX_DEVICES=16,MAX_PROFILES=16;
const finite=n=>typeof n==='number'&&Number.isFinite(n),plain=o=>!!o&&typeof o==='object'&&!Array.isArray(o)&&[Object.prototype,null].includes(Object.getPrototypeOf(o));
const clone=o=>JSON.parse(JSON.stringify(o)),clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
const zero=(brake=1)=>({throttle:0,steer:0,brake,lift:0,tilt:0,reach:0,sideShift:0,turret:0});
const clean=(s,max=180)=>typeof s==='string'?s.slice(0,max).replace(/[\u0000-\u001f\u007f<>]/g,'').trim():'';
const fail=message=>{throw new Error(message);};
const keys=(value,allowed)=>{if(!plain(value)||Object.keys(value).some(key=>!allowed.includes(key)))fail('Configuración de dispositivo no válida.');};
const index=n=>{if(!Number.isInteger(n)||n<0||n>=32)fail('Índice de control fuera del intervalo permitido.');return n;};
const deviceKey=value=>typeof value==='string'&&/^pad-[a-f0-9]{8}@\d{1,2}$/.test(value);
const hash=s=>{let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16).padStart(8,'0');};
const wheelLike=label=>/wheel|steering|pedal|racing|thrustmaster|fanatec|moza|simagic|hotas|joystick|driving\s*force|logitech.*(?:g29|g920|g923|g27)/i.test(label);
function axis(mapping){
 keys(mapping,['index','mode','min','max','rest','full','invert','deadzone']);index(mapping.index);if(mapping.index>=16)fail('El dispositivo admite índices de eje de 0 a 15.');
 const mode=mapping.mode||'bipolar',deadzone=mapping.deadzone===undefined?.1:mapping.deadzone;
 if(!['bipolar','pedal'].includes(mode)||!finite(deadzone)||deadzone<0||deadzone>.45||mapping.invert!==undefined&&typeof mapping.invert!=='boolean')fail('Calibración de eje no válida.');
 let {min,max,rest,full}=mapping;
 if(mode==='pedal'&&full!==undefined){if(!finite(rest)||!finite(full)||Math.abs(full-rest)<.05)fail('Captura posiciones distintas de reposo y fondo.');min=Math.min(rest,full);max=Math.max(rest,full);}
 else if(!finite(min)||!finite(max)||min>=max||max-min<.05)fail('Captura los extremos completos del eje.');
 if(!finite(rest)||rest<min||rest>max||min< -1||max>1)fail('El reposo debe estar dentro del intervalo calibrado.');
 if(mode==='bipolar'&&(rest-min<.025||max-rest<.025))fail('El centro debe quedar entre ambos extremos.');
 if(mode==='pedal'&&full===undefined){full=mapping.invert?min:max;if(Math.abs(full-rest)<.05)full=Math.abs(max-rest)>Math.abs(min-rest)?max:min;if(Math.abs(full-rest)<.05)fail('El pedal necesita recorrido desde su reposo.');}
 return {index:mapping.index,mode,min,max,rest,...(mode==='pedal'?{full}:{}),invert:!!mapping.invert,deadzone};
}
function profile(value){
 keys(value,['kind','axes','buttons','combinedPedals','reverseButton','brakeButton']);
 const kind=value.kind||'wheel';if(!['wheel','pedals','gamepad'].includes(kind))fail('Tipo de dispositivo no válido.');
 const axes={},buttons={};if(value.axes!==undefined){keys(value.axes,CHANNELS);for(const [channel,mapping]of Object.entries(value.axes))axes[channel]=axis(mapping);}
 if(value.buttons!==undefined){keys(value.buttons,[...COMMANDS]);for(const [action,number]of Object.entries(value.buttons))buttons[action]=index(number);}
 let combinedPedals=null;if(value.combinedPedals){combinedPedals=axis({...value.combinedPedals,mode:'bipolar'});if(axes.throttle||axes.brake)fail('Un pedal combinado no puede duplicar acelerador o freno.');}
 return {kind,axes,buttons,...(combinedPedals?{combinedPedals}:{}),...(value.reverseButton!==undefined&&value.reverseButton!==null?{reverseButton:index(value.reverseButton)}:{}),...(value.brakeButton!==undefined&&value.brakeButton!==null?{brakeButton:index(value.brakeButton)}:{})};
}

/** Portable browser Gamepad API adapter. No renderer, editor, RAF, timer, HID
 * permission, vehicle command implementation or network connection is owned. */
export default class GamepadInput{
 constructor(options={}){
  this.navigator=options.navigator||(typeof navigator==='undefined'?null:navigator);this.storage=options.storage||null;this.now=options.now||(()=>Date.now());this.onCommand=typeof options.onCommand==='function'?options.onCommand:()=>{};
  this.enabled=true;this.deviceKeys=null;this.profiles={};this.devices=[];this.records=new Map();this.listeners=new Set();this.output=zero();this.status='unavailable';this.armed=false;this.active=false;this.selectedKeys=[];this.bindings={};this.reason='';this.contextKey='';this.connectionKey='';this.lastPoll=null;this.lastEmit=-Infinity;this.lastSignature='';this.disposed=false;this.load();
 }
 load(){try{const raw=this.storage&&this.storage.getItem(STORAGE_KEY);if(!raw||raw.length>50000)return;const data=JSON.parse(raw);keys(data,['version','enabled','deviceKeys','profiles']);if(data.version!==1||typeof data.enabled!=='boolean'||!plain(data.profiles)||Object.keys(data.profiles).length>MAX_PROFILES)return;const next={};for(const [key,value]of Object.entries(data.profiles)){if(!deviceKey(key))return;next[key]=profile(value);}this.validateSelection(data.deviceKeys);this.enabled=data.enabled;this.deviceKeys=data.deviceKeys;this.profiles=next;}catch(_){/* Optional local preferences never disable the host. */}}
 save(){try{if(this.storage)this.storage.setItem(STORAGE_KEY,JSON.stringify({version:1,enabled:this.enabled,deviceKeys:this.deviceKeys,profiles:this.profiles}));}catch(_){/* Storage may be unavailable or full. */}}
 validateSelection(value){if(value!==null&&(!Array.isArray(value)||value.length>8||value.some(key=>!deviceKey(key))||new Set(value).size!==value.length))fail('Selección de dispositivos no válida.');}
 configure(options={}){if(this.disposed)return this.getState();keys(options,['enabled','deviceKeys']);if(options.enabled!==undefined&&typeof options.enabled!=='boolean')fail('Estado de dispositivo no válido.');if(options.deviceKeys!==undefined)this.validateSelection(options.deviceKeys);if(options.enabled!==undefined)this.enabled=options.enabled;if(options.deviceKeys!==undefined)this.deviceKeys=options.deviceKeys===null?null:options.deviceKeys.slice();this.save();this.reset('configuration');return this.getState();}
 updateProfile(key,patch){
  if(this.disposed)fail('El adaptador está cerrado.');if(!deviceKey(key))fail('Dispositivo no válido.');keys(patch,['kind','axes','buttons','combinedPedals','reverseButton','brakeButton']);
  const device=this.devices.find(row=>row.key===key),automatic=device&&device.standard?this.effective({...device,key:''}):null;
  const previous=this.profiles[key]||(automatic?{kind:'gamepad',axes:clone(automatic.axes),buttons:{...automatic.buttons},...(automatic.brakeButton!==undefined?{brakeButton:automatic.brakeButton}:{})}:{kind:'wheel',axes:{},buttons:{}}),next={...previous,...patch,axes:{...previous.axes},buttons:{...previous.buttons}};
  for(const field of ['axes','buttons'])if(patch[field]!==undefined){keys(patch[field],field==='axes'?CHANNELS:[...COMMANDS]);for(const [name,value]of Object.entries(patch[field])){if(value===null)delete next[field][name];else next[field][name]=value;}}
  if(patch.combinedPedals===null)delete next.combinedPedals;if(patch.reverseButton===null)delete next.reverseButton;if(patch.brakeButton===null)delete next.brakeButton;
  const normalized=profile(next);if(!this.profiles[key]&&Object.keys(this.profiles).length>=MAX_PROFILES)fail('Se alcanzó el límite de perfiles locales.');this.profiles[key]=normalized;this.save();this.reset('profile');return clone(normalized);
 }
 removeProfile(key){if(!deviceKey(key))fail('Dispositivo no válido.');delete this.profiles[key];this.save();this.reset('profile');return this.getState();}
 calibrate(key,channel,mapping){if(!CHANNELS.includes(channel))fail('Canal no válido.');return this.updateProfile(key,{axes:{[channel]:axis(mapping)}});}
 captureCalibration(key,number){index(number);if(number>=16)fail('El dispositivo admite índices de eje de 0 a 15.');const device=this.readDevices([]).find(row=>row.key===key);if(!device||!finite(device.axes[number])||device.invalid)fail('No hay una lectura de ese eje conectado.');return device.axes[number];}
 readDevices(excludedIds){
  const excluded=new Set((Array.isArray(excludedIds)?excludedIds:[]).slice(0,64).map(id=>clean(id,256))),devices=[];let pads;
  try{pads=this.navigator&&typeof this.navigator.getGamepads==='function'?this.navigator.getGamepads():[];}catch(_){return [];}
  for(let slot=0;slot<Math.min(MAX_DEVICES,pads&&pads.length||0);slot++)try{
   const pad=pads[slot];if(!pad||pad.connected===false)continue;const label=clean(pad.id)||'Mando '+(slot+1),mapping=clean(pad.mapping,24);if(mapping==='xr-standard'||excluded.has(clean(pad.id,256)))continue;
   const axes=[],buttons=[];let invalid=false;for(const raw of Array.from(pad.axes||[]).slice(0,16)){if(!finite(raw))invalid=true;axes.push(finite(raw)?clamp(raw,-1,1):0);}
   for(const raw of Array.from(pad.buttons||[]).slice(0,32)){const value=typeof raw==='number'?raw:raw&&raw.value!==undefined?raw.value:raw&&raw.pressed?1:0;if(!finite(value))invalid=true;buttons.push(finite(value)?clamp(raw&&raw.pressed===true?Math.max(.7,value):value,0,1):0);}
   const key='pad-'+hash(label+'|'+mapping+'|'+axes.length+'|'+buttons.length)+'@'+slot,standard=mapping==='standard'&&!wheelLike(label)&&axes.length>=2;
   devices.push({key,index:slot,label,mapping,standard,axes,buttons,invalid,brand:/054c|sony|playstation|dualshock|dualsense/i.test(label)?'ps':/045e|xbox|microsoft/i.test(label)?'xbox':'generic'});
  }catch(_){/* A revoked or malformed hardware sample is ignored. */}
  return devices;
 }
 effective(device){if(this.profiles[device.key]){const value=this.profiles[device.key];return Object.keys(value.axes).length||Object.keys(value.buttons).length||value.combinedPedals||value.reverseButton!==undefined||value.brakeButton!==undefined?value:null;}if(!device.standard)return null;const axes={};for(const [channel,value]of Object.entries(STANDARD_BINDINGS.axes))if(device.axes.length>value.index)axes[channel]=value;return {kind:'gamepad',axes,buttons:Object.fromEntries(Object.entries(STANDARD_BINDINGS.buttons).filter(([,number])=>number<device.buttons.length)),...(device.buttons.length>STANDARD_BINDINGS.brakeButton?{brakeButton:STANDARD_BINDINGS.brakeButton}:{}),standard:true};}
 axisValue(mapping,device,record,key){
  const raw=device.axes[mapping.index];if(!finite(raw))return null;let value=mapping.mode==='pedal'?(raw-mapping.rest)/(mapping.full-mapping.rest):raw>=mapping.rest?(raw-mapping.rest)/(mapping.max-mapping.rest):(raw-mapping.rest)/(mapping.rest-mapping.min);
  if(mapping.mode==='bipolar'&&mapping.invert)value=-value;value=clamp(value,mapping.mode==='pedal'?0:-1,1);
  const magnitude=Math.abs(value),dead=mapping.deadzone,was=record.axisActive.has(key),active=magnitude>(was?dead*.7:dead);if(active)record.axisActive.add(key);else record.axisActive.delete(key);
  return active?Math.sign(value)*Math.max(0,(magnitude-dead)/(1-dead)):0;
 }
 sample(device,configuration,record){
  const output=zero(0),edges=[];let invalid=device.invalid;
  const pressed=device.buttons.map((value,number)=>value>=(record.pressed[number]?.4:.65));
  for(const [channel,mapping]of Object.entries(configuration.axes)){const value=this.axisValue(mapping,device,record,channel);if(value===null)invalid=true;else output[channel]=channel==='brake'?Math.max(0,value):value;}
  if(configuration.combinedPedals){const value=this.axisValue(configuration.combinedPedals,device,record,'combined');if(value===null)invalid=true;else{output.throttle=Math.max(0,value);output.brake=Math.max(0,-value);}}
  if(configuration.brakeButton!==undefined){if(configuration.brakeButton>=device.buttons.length)invalid=true;else{const value=device.buttons[configuration.brakeButton];output.brake=Math.max(output.brake,value>.05?(value-.05)/.95:0);}}
  const reverse=configuration.reverseButton!==undefined&&!!pressed[configuration.reverseButton];if(configuration.reverseButton!==undefined&&configuration.reverseButton>=device.buttons.length)invalid=true;
  for(const [action,number]of Object.entries(configuration.buttons)){if(number>=device.buttons.length)invalid=true;else if(pressed[number]&&!record.pressed[number])edges.push(action);}
  record.pressed=pressed;const neutral=!invalid&&CHANNELS.every(channel=>Math.abs(output[channel])<=.001)&&!pressed.some(Boolean);return {output,edges,neutral,invalid,reverse};
 }
 resetRuntime(reason){this.records.clear();this.armed=false;this.output=zero();this.reason=clean(reason,80);}
 reset(reason='blur'){this.resetRuntime(reason);this.status=this.disposed?'disposed':'rearm';this.emit(true);}
 poll({active=false,blocked=false,xr=false,selectedVehicleId='',excludedIds=[]}={}){
  if(this.disposed)return zero();const time=this.now(),context=String(selectedVehicleId||'').slice(0,200)+'|'+!!active+'|'+!!blocked+'|'+!!xr;
  if(context!==this.contextKey||this.lastPoll!==null&&finite(time)&&time-this.lastPoll>1000){this.resetRuntime('context');this.contextKey=context;}this.lastPoll=finite(time)?time:null;
  this.devices=this.readDevices(excludedIds);let selected=this.deviceKeys===null?this.devices.filter(device=>device.standard).slice(0,1):this.devices.filter(device=>this.deviceKeys.includes(device.key));
  this.selectedKeys=selected.map(device=>device.key);const connection=selected.map(d=>d.key+':'+JSON.stringify(this.profiles[d.key]||null)).join('|');if(connection!==this.connectionKey){this.resetRuntime('connection');this.connectionKey=connection;}
  this.active=!!(active&&selectedVehicleId&&!blocked&&!xr&&this.enabled);this.bindings=this.makeBindings(selected);
  const missing=this.deviceKeys!==null&&this.deviceKeys.some(key=>!this.selectedKeys.includes(key));
  if(!this.active||!selected.length||missing){this.resetRuntime(missing?'disconnected':!selected.length?'no-device':blocked?'blocked':xr?'xr':'inactive');this.status=!this.enabled?'disabled':xr?'xr':blocked?'blocked':!active||!selectedVehicleId?'inactive':missing?'disconnected':'unavailable';this.emit();return {...this.output};}
  const samples=[];for(const device of selected){const configuration=this.effective(device);if(!configuration){this.resetRuntime('unmapped');this.status='unmapped';this.emit();return {...this.output};}let record=this.records.get(device.key);if(!record){record={armed:false,pressed:[],axisActive:new Set()};this.records.set(device.key,record);}const value=this.sample(device,configuration,record);samples.push({device,record,...value});if(value.invalid)record.armed=false;else if(!record.armed&&value.neutral)record.armed=true;}
  this.armed=samples.every(sample=>sample.record.armed&&!sample.invalid);this.status=this.armed?'ready':'rearm';this.output=zero(this.armed?0:1);
  if(this.armed){
   for(const sample of samples)for(const channel of CHANNELS)if(channel==='brake')this.output.brake=Math.max(this.output.brake,sample.output.brake);else if(Math.abs(sample.output[channel])>Math.abs(this.output[channel]))this.output[channel]=sample.output[channel];
   if(samples.some(sample=>sample.reverse))this.output.throttle=-Math.abs(this.output.throttle);
   const commands=samples.flatMap(sample=>sample.edges.map(action=>({action,device:sample.device}))).sort((a,b)=>COMMAND_ROWS.findIndex(row=>row[0]===a.action)-COMMAND_ROWS.findIndex(row=>row[0]===b.action));
   if(commands.length){const {action,device}=commands[0];try{this.onCommand(action,{deviceKey:device.key,index:device.index,label:device.label});}catch(_){this.resetRuntime('command-error');this.status='rearm';}}
  }
  this.emit();return {...this.output};
 }
 makeBindings(devices){
  const result={};let reverseLabel='';for(const device of devices){const p=this.effective(device);if(!p)continue;const standard=device.standard&&p.kind==='gamepad',brand=device.brand==='ps'?'ps':'xbox';for(const [action,number]of Object.entries(p.buttons)){const item=GAMEPAD_ACTIONS.find(row=>row.action===action);result[action]=standard&&number===STANDARD_BINDINGS.buttons[action]&&item&&item[brand]?item[brand]:'B'+(number+1);}
   const labels={steer:['steerLeft','steerRight'],throttle:['driveForward','driveReverse'],brake:['brake'],lift:['liftUp','liftDown'],tilt:['tiltBack','tiltForward'],reach:['retract','extend'],sideShift:['sideLeft','sideRight'],turret:['turretLeft','turretRight']};for(const [channel,mapping]of Object.entries(p.axes))for(const action of labels[channel])result[action]=standard&&STANDARD_BINDINGS.axes[channel]&&STANDARD_BINDINGS.axes[channel].index===mapping.index?STANDARD_BINDINGS.labels[action]:channel==='steer'?'Volante':channel==='brake'?'Freno':mapping.mode==='pedal'?'Pedal':'Eje '+(mapping.index+1);if(p.brakeButton!==undefined)result.brake=standard&&p.brakeButton===6?(device.brand==='xbox'?'LT':'L2'):'B'+(p.brakeButton+1);if(p.combinedPedals){result.driveForward='Pedal +';result.brake='Pedal −';}if(p.reverseButton!==undefined)reverseLabel='B'+(p.reverseButton+1)+' + pedal';
  }if(reverseLabel)result.driveReverse=reverseLabel;return result;
 }
 getState(){return {enabled:this.enabled,automatic:this.deviceKeys===null,deviceKeys:this.deviceKeys===null?null:this.deviceKeys.slice(),selectedKeys:this.selectedKeys.slice(),active:this.active,armed:this.armed,status:this.status,reason:this.reason,output:{...this.output},bindings:{...this.bindings},standardBindings:clone(STANDARD_BINDINGS),profiles:clone(this.profiles),devices:this.devices.map(device=>({...device,axes:device.axes.slice(),buttons:device.buttons.slice(),mapped:!!this.effective(device),profile:this.profiles[device.key]?clone(this.profiles[device.key]):null}))};}
 subscribe(listener){if(typeof listener!=='function'||this.disposed)return()=>{};this.listeners.add(listener);listener(this.getState());return()=>this.listeners.delete(listener);}
 emit(force=false){const time=this.now(),state=this.getState(),signature=JSON.stringify(state);if(!force&&(signature===this.lastSignature||finite(time)&&time>=this.lastEmit&&time-this.lastEmit<50))return;this.lastSignature=signature;this.lastEmit=finite(time)?time:0;for(const listener of this.listeners)try{listener(state);}catch(_){/* UI observers never acquire control authority. */}}
 dispose(){if(this.disposed)return;this.disposed=true;this.enabled=false;this.active=false;this.resetRuntime('disposed');this.status='disposed';this.devices=[];this.selectedKeys=[];this.deviceKeys=null;this.profiles={};this.bindings={};this.emit(true);this.listeners.clear();}
}
