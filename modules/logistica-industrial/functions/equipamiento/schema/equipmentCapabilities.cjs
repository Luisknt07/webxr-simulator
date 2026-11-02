'use strict';

const catalog=require('./equipmentCatalog.cjs');
const loadPolicy=require('../../robots/schema/robot-load-policy.js');
function known(value){return typeof value==='number'&&Number.isFinite(value);}
function sampleSensor(id,context={}){
 const d=catalog.definition(id);if(!d||!['sensor','safety','utility'].includes(d.role))throw new Error('Unknown sensing capability.');
 const target=context.target, spec=target&&(target.spec||target.metadata||target), read=(v,unit)=>({known:known(v),value:known(v)?v:null,unit,source:'simulation-telemetry'});
 let result;
 switch(d.mechanism){
  case'photoelectric':case'inductive-capacitive':result={known:typeof context.presence==='boolean',value:typeof context.presence==='boolean'?context.presence:null,unit:'boolean',source:'simulation-telemetry'};break;
  case'encoder-limit':result=read(context.positionM,'m');if(known(context.angleRad))result=read(context.angleRad,'rad');break;
  case'load-pressure':result=read(context.pressureKPa,'kPa');if(!result.known)result=read(spec&&spec.mass,'kg');break;
  case'condition':case'process':result=read(context.temperatureC,'°C');if(!result.known)result=read(context.vibrationMMS,'mm/s');break;
  case'energy':case'extraction':result={known:typeof context.powered==='boolean',value:typeof context.powered==='boolean'?context.powered:null,unit:'enabled',source:'simulation-telemetry'};break;
  case'vision-distance':case'dimensioner':result=read(context.distanceM,'m');if(spec)result.dimensions={widthM:read(spec.width,'m'),heightM:read(spec.height,'m'),depthM:read(spec.depth,'m')};break;
  case'barcode-rf':case'barcode-rfid':case'rfid-portal':{const code=spec&&(spec.id||spec.sku);result={known:typeof code==='string'&&!!code,value:typeof code==='string'&&code?code:null,unit:'code',source:'declared-simulation'};break;}
  case'guard':result={known:typeof context.guardClosed==='boolean',value:typeof context.guardClosed==='boolean'?context.guardClosed:null,unit:'closed',source:'declared-simulation'};break;
  case'presence-stop':case'emergency-rearm':result={known:typeof context.emergency==='boolean',value:typeof context.emergency==='boolean'?!context.emergency:null,unit:'permit',source:'simulation-telemetry'};break;
  default:result=read(spec&&spec.mass,'kg');break;
 }
 return Object.assign({equipmentId:id,kind:d.mechanism,limits:'Lectura de variables del simulador. No es una medición de hardware ni un cálculo de integridad de seguridad.'},result);
}
function assessTool(id,robotConfig={},metadata={},state={}){
 const d=catalog.definition(id);if(!d||d.role!=='tool')throw new Error('Unknown end-effector.');
 const base=loadPolicy.assess(Object.assign({},robotConfig,{tool:d.toolType}),metadata);
 if(!base.accepted)return base;
 if(d.toolType==='process')return Object.assign(base,{accepted:false,reason:'Esta herramienta ejecuta un proceso o medición y no custodia una carga.'});
 if(state.enabled===false||state.closed===false||state.utilityAvailable===false)return Object.assign(base,{accepted:false,reason:'La herramienta no está habilitada/cerrada o no dispone del servicio simulado requerido.'});
 if(d.mechanism==='magnet'&&!['steel','ferromagnetic'].includes(metadata.material||metadata.materialClass))return Object.assign(base,{accepted:false,reason:'La pinza magnética requiere material ferromagnético declarado; no se infiere a partir del color.'});
 if(d.mechanism==='needle'&&!['textile','porous-textile'].includes(metadata.material||metadata.materialClass))return Object.assign(base,{accepted:false,reason:'La pinza de agujas requiere material textil/poroso compatible declarado.'});
 if(d.mechanism==='three-finger'&&!['cylinder','drum','bottle'].includes(metadata.type||metadata.productType))return Object.assign(base,{accepted:false,reason:'El ejercicio de pinza céntrica admite piezas cilíndricas declaradas.'});
 return Object.assign(base,{catalogueToolId:id,contactMode:d.toolType,limits:'Admisión cinemática y propiedades declaradas; no calcula fuerzas, adherencia, porosidad ni estabilidad.'});
}
function route(id,value={}){
 const d=catalog.definition(id),c=catalog.normalize(id,value);if(!d||d.role!=='transport')throw new Error('Equipment is not a fixed transport.');
 const points=[],L=c.length,R=Math.min(c.width/2,L/4),rise=known(value.rise)?value.rise:0;
 if(Math.abs(rise)>10)throw new Error('Transport rise exceeds its supported envelope.');
 if(d.mechanism==='spiral'){
  const r=known(value.radius)?Math.max(.5,Math.min(8,value.radius)):Math.max(1.25,c.width*1.5),n=64,h=rise||Math.min(3,c.height);
  for(let i=0;i<=n;i++){const t=i/n,a=t*Math.PI*2;points.push([Math.cos(a)*r,t*h,Math.sin(a)*r]);}
 }else if(d.mechanism==='overhead'){
  const y=Math.max(1,c.height);points.push([-L/2,y,0],[L/2,y,0]);
 }else if(d.mechanism==='bucket-elevator'){
  points.push([-L/2,0,0],[-L/2+R,0,0],[L/2-R,rise||Math.max(1,c.height),0],[L/2,rise||Math.max(1,c.height),0]);
 }else if(d.mechanism==='curve'){
  for(let i=0;i<=32;i++){const a=i/32*Math.PI/2;points.push([Math.sin(a)*L/2,0,(1-Math.cos(a))*L/2]);}
 }else points.push([-L/2,0,0],[L/2,rise,0]);
 const lengths=[0];for(let i=1;i<points.length;i++)lengths.push(lengths[i-1]+Math.hypot(...points[i].map((x,k)=>x-points[i-1][k])));
 return {equipmentId:id,points,lengths,length:lengths[lengths.length-1],speed:c.speed,mode:'discrete-load-kinematics',limits:['screw','pneumatic','vibratory','bucket-elevator'].includes(d.mechanism)?'Flujo educativo de lotes discretos. No resuelve dinámica granular, presión ni caudal de fluido.':''};
}
function pointAt(path,distance){
 if(!path||!Array.isArray(path.points)||path.points.length<2||!known(distance))throw new Error('Invalid transport path.');
 const at=Math.max(0,Math.min(path.length,distance));let i=1;while(i<path.lengths.length-1&&path.lengths[i]<at)i++;
 const span=path.lengths[i]-path.lengths[i-1],t=span?(at-path.lengths[i-1])/span:0,a=path.points[i-1],b=path.points[i],position=a.map((v,k)=>v+(b[k]-v)*t),length=Math.hypot(...b.map((v,k)=>v-a[k]));
 return {position,tangent:b.map((v,k)=>length?(v-a[k])/length:0),distance:at,complete:at>=path.length};
}
function interlock(state={}){
 if(state.emergency)return {permit:false,reason:'emergency-latched'};
 if(state.powered===false)return {permit:false,reason:'power-off'};
 if(state.guardClosed===false)return {permit:false,reason:'guard-open'};
 if(state.utilityAvailable===false)return {permit:false,reason:'utility-unavailable'};
 if(state.running===false||state.paused)return {permit:false,reason:state.paused?'paused':'stopped'};
 return {permit:true,reason:''};
}
function serviceCommand(id,request={},context={}){
 const d=catalog.definition(id);if(!d||d.operationLevel!=='service-control')throw new Error('This equipment is not a service controller.');
 if(typeof context.canControl!=='function'||context.canControl()!==true||!context.runtime||typeof context.runtime.command!=='function')throw new Error('Service control is unavailable in this context.');
 if(typeof request.targetId!=='string'||!context.runtime.records.has(request.targetId))throw new Error('Select a live target machine.');
 if(!['start','stop','powerOn','powerOff','emergency','resetEmergency'].includes(request.action))throw new Error('Unsupported service command.');
 return context.runtime.command(request.targetId,request.action);
}
module.exports={sampleSensor,assessTool,route,pointAt,interlock,serviceCommand};
