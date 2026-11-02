'use strict';

const data = require('./catalogue-data.json');
const crosswalk = require('./source-crosswalk.cjs');
const MODULE_ID = 'sector.logistics-industrial';
const VERSION = 1;
const CONVEYORS = {
 'roller-gravity':'roller-gravity','roller-box':'roller-motor','roller-pallet':'pallet-chain','flat-belt':'belt','modular-belt':'modular-incline',
 'pallet-chain':'pallet-chain','zero-pressure':'roller-zones',curve:'roller-curve','popup-transfer':'popup-chain',turntable:'roller-turntable',pusher:'pusher',merge:'merge-angle',junction:'distributor','vertical-lift':'pallet-elevator','stops-guides':'loading-table'
};
const VEHICLES = {'manual-cart':'transport-cart','picking-cart':'transport-cart','pallet-truck-manual':'pallet-truck-manual','pallet-truck-electric':'pallet-truck-electric',stacker:'stacker',counterbalance:'forklift-electric-4w','reach-truck':'reach-truck',vna:'vna-turret','order-picker':'order-picker','tow-tractor':'tow-tractor'};
const ROBOTS = {articulated:'articulated-general','four-axis-palletizer':'palletizer',scara:'scara',delta:'delta',cartesian:'cartesian',gantry:'cartesian',collaborative:'collaborative',heavy:'articulated-general',painting:'articulated-process',inspection:'articulated-process',welding:'articulated-process',finishing:'articulated-process','mobile-manipulator':'mobile-manipulator','external-positioner':'cartesian'};
const MOBILE = {'agv-platform':'agv','agv-forks':'agv','agv-tug':'agv','amr-platform':'amr','amr-pallet-lift':'amr','amr-underride':'amr','amr-top-conveyor':'amr',rgv:'shuttle','autonomous-forklift':'agv'};
const STORAGE = {selective:'selective','double-deep':'double-deep','drive-in':'drive-in','drive-through':'drive-through','push-back':'push-back','pallet-flow':'pallet-flow','carton-flow':'carton-flow',cantilever:'cantilever',mobile:'mobile','light-medium':'medium-duty',mezzanine:'mezzanine','vertical-lift':'vertical-lift',miniload:'miniload','pallet-shuttle':'catalogue-pallet-shuttle','automatic-pallet-shuttle':'catalogue-automatic-pallet-shuttle','pallet-asrs':'catalogue-pallet-asrs','multilevel-shuttle':'catalogue-multilevel-shuttle',cube:'catalogue-cube',carousel:'catalogue-carousel'};
const PRODUCTS = {'wood-pallet':'pallet-industrial','plastic-pallet':'pallet-plastic','metal-pallet':'pallet-industrial','standard-pallet':'pallet-euro','loaded-pallet':'pallet-loaded','slip-sheet':'carton-bundle',carton:'box-medium',tote:'tote','roll-container':'cage',sack:'sack',drum:'drum',ibc:'jerrycan','bottle-can-tray':'bottle','discrete-part':'cylinder','metal-part':'cylinder','fragile-electronic':'box-small',textile:'carton-bundle','long-stock':'cylinder','bulk-fluid':'sack',conditioned:'crate',oversize:'crate',hazardous:'drum'};
const TOOL_TYPES = {'vacuum-single':'vacuum','vacuum-area':'vacuum','layer-gripper':'vacuum','parallel-gripper':'gripper','three-finger':'gripper','angular-gripper':'gripper','adaptive-soft':'gripper','adaptive-gripper':'gripper','soft-gripper':'gripper',magnet:'gripper',needle:'gripper','sack-gripper':'gripper','side-clamp':'gripper',forks:'fork','drum-gripper':'gripper','double-gripper':'gripper','forklift-attachment':'fork'};
const RECIPE = {
 'carton-erector':'erect','carton-sealer':'seal','case-packer':'pack','seal-strap':'strap',strapper:'strap','stretch-wrapper':'wrap','print-apply':'label',depalletizer:'depalletize',
 saw:'cut','energy-cutting':'cut','cnc-lathe':'machine','machining-center':'machine','drill-tap':'drill','press-brake':'bend','stamping-press':'form','injection-molder':'mold',extruder:'extrude','additive-printer':'additive','welding-cell':'weld','welding-source':'weld',positioner:'position','paint-curing':'paint','paint-booth':'paint',oven:'heat',cooling:'cool','assembly-bench':'assemble','vibratory-feeder':'feed','stock-feeder':'feed',fixture:'clamp',finishing:'finish','tank-mixer':'mix','pump-valve':'transfer-fluid',filler:'fill',washer:'wash','test-bench':'test',cmm:'measure','insertion-press':'insert','hopper-doser':'dose',
 'weigh-dimension':'inspect','platform-scale':'weigh',dimensioner:'measure',checkweigher:'checkweigh','barcode-rf':'identify','barcode-rfid':'identify','rfid-portal':'identify','receiving-inspection':'inspect','packing-bench':'pack',decanting:'decant',consolidation:'verify','put-wall':'sort','pick-to-light':'pick',voice:'pick','goods-to-person':'pick','goods-to-robot':'pick'
};
const DISPLAY = {erp:'analytics',wms:'inventory',warehouse:'inventory',wes:'missions',mes:'analytics',business:'analytics',scada:'monitor',fleet:'missions','digital-twin':'monitor',assistant:'assistant'};
const FRAME = {transport:[4,1,1],vehicle:[2.4,1.25,2.15],mobile:[1.4,.9,1.3],storage:[3,1.25,3.6],product:[.6,.4,.4],dock:[3,2.4,1.2],picking:[2,1.25,1.5],packaging:[3,1.5,2],robot:[.8,.8,1.6],tool:[.3,.25,.25],machine:[3,1.6,2.2],sensor:[.25,.16,.25],control:[.65,.3,1.4],monitor:[1,.15,.65],safety:[2,.16,2],utility:[1.5,.8,1.2]};
function plain(value) {return !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value)) && !Object.keys(value).some(k=>['__proto__','prototype','constructor'].includes(k));}
function finite(value, fallback, low, high) {if(value===undefined)return fallback;if(typeof value!=='number'||!Number.isFinite(value)||value<low||value>high)throw new Error('Equipment parameter is outside its bounded range.');return value;}
function descriptor(row) {
 const [role, mechanism] = row.id.slice('equipment.'.length).split('.'), size=FRAME[role]||FRAME.machine;
 let nativeKind=null,nativeVariant,operationLevel='pending',requiresRuntimeHook='';
 if(role==='transport'){nativeKind='conveyor';nativeVariant=CONVEYORS[mechanism]||'belt';operationLevel=CONVEYORS[mechanism]?'native':'discrete-transport';if(!CONVEYORS[mechanism])requiresRuntimeHook='catalogue-transport-path';}
 else if(role==='vehicle'){nativeKind=VEHICLES[mechanism]?'vehicle':'robot';nativeVariant=VEHICLES[mechanism]||'cartesian';operationLevel=VEHICLES[mechanism]?'native':'discrete-motion';if(!VEHICLES[mechanism])requiresRuntimeHook='catalogue-carrier-motion';}
 else if(role==='mobile'){nativeKind='robot';nativeVariant=MOBILE[mechanism]||'amr';operationLevel=MOBILE[mechanism]?'native':'discrete-motion';if(!MOBILE[mechanism])requiresRuntimeHook='catalogue-carrier-motion';}
 else if(role==='storage'){nativeKind='palletQueue';nativeVariant=STORAGE[mechanism];operationLevel=STORAGE[mechanism]||mechanism==='block'||mechanism==='reject-bin'?'native':'addressed-storage';if(!STORAGE[mechanism]&&!['block','reject-bin'].includes(mechanism))requiresRuntimeHook='catalogue-addressed-storage';}
 else if(role==='product'){nativeKind='product';nativeVariant=PRODUCTS[mechanism]||'box-medium';operationLevel='native';}
 else if(role==='robot'){nativeKind='robot';nativeVariant=ROBOTS[mechanism]||'articulated-general';operationLevel='native';}
 else if(role==='tool'){operationLevel='attachment';requiresRuntimeHook='catalogue-tool-contact';}
 else if(role==='monitor'){operationLevel='workspace';}
 else if(role==='sensor'&&['photoelectric','inductive-capacitive','encoder-limit','vision-distance','process','load-pressure','condition','barcode-rf','barcode-rfid'].includes(mechanism)){nativeKind='sensor';operationLevel='telemetry';requiresRuntimeHook='catalogue-sensor';}
 else if(role==='control'){nativeKind=mechanism==='charging-station'?'processor':'plc';operationLevel=mechanism==='charging-station'?'discrete-event':'native';if(mechanism==='charging-station')requiresRuntimeHook='catalogue-operation';}
 else if(role==='safety'){nativeKind='sensor';operationLevel='interlock';requiresRuntimeHook='catalogue-safety-interlock';}
 else if(role==='utility'){nativeKind=['motor-drive','servo','fluid-actuator'].includes(mechanism)?'plc':'sensor';operationLevel=nativeKind==='plc'?'service-control':'service-telemetry';requiresRuntimeHook=nativeKind==='plc'?'catalogue-service-command':'catalogue-sensor';}
 else if(role==='packaging'&&['layer-palletizer','robot-palletizer'].includes(mechanism)){nativeKind='palletQueue';operationLevel='native';}
 else if(role==='packaging'&&mechanism==='pallet-dispenser'){nativeKind='source';operationLevel='native';}
 else {nativeKind='processor';operationLevel='discrete-event';requiresRuntimeHook='catalogue-operation';}
 if(role==='tool'&&mechanism==='stand'){nativeKind='product';nativeVariant='crate';operationLevel='physical-support';requiresRuntimeHook='';}
 const defaults={catalogueEquipmentId:row.id,length:size[0],width:size[1],height:size[2],supportHeight:1,frameColor:'#466574',accentColor:'#e9b849',detail:'balanced',wear:.12,processTime:5,setupTime:0,capacity:8,parallelism:1,outputCapacity:8,powered:true,running:false,withPanel:!['storage','product','sensor','safety','tool'].includes(role),speed:.4};
 if(nativeKind==='processor')Object.assign(defaults,{mode:'process',length:Math.max(1.5,defaults.length),width:Math.max(.6,defaults.width)});
 if(role==='transport'){
  const native=require('../../bandas/schema/conveyor-equipment.js').getDefinition(nativeVariant);
  if(native)Object.assign(defaults,native.preset,{catalogueEquipmentId:row.id,autoSpawn:false,withPanel:false});
  if(!CONVEYORS[mechanism])Object.assign(defaults,{equipmentId:'',layout:'straight',axis:'x',rise:0,mechanism:'transport'});
  if(['crossbelt-sorter','shoe-sorter','tilt-tray-sorter'].includes(mechanism))Object.assign(defaults,{equipmentId:'',layout:'tee',mechanism:'distributor'});
  if(mechanism==='overhead')defaults.height=2.8;
  if(mechanism==='spiral')Object.assign(defaults,{height:2.4,rise:2.4,radius:1.5});
  if(mechanism==='bucket-elevator')Object.assign(defaults,{height:3,rise:3,width:.6});
  if(mechanism==='telescopic')defaults.length=6;
 }
 if(role==='product'){
  const formats={'wood-pallet':[.8,.144,1.2],'plastic-pallet':[1,.15,1.2],'metal-pallet':[1,.15,1.2],'standard-pallet':[.8,.144,1.2],'loaded-pallet':[1.2,.72,.8],'slip-sheet':[1,.015,1.2],carton:[.4,.3,.5],tote:[.4,.3,.6],'roll-container':[.8,1.5,1.2],sack:[.4,.65,.35],drum:[.6,.9,.6],ibc:[1,1.16,1.2],'bottle-can-tray':[.3,.35,.4],'long-stock':[2.4,.2,.2],'bulk-fluid':[.35,.25,.35],oversize:[2.2,1.4,2.4]};
  const dims=formats[mechanism]||[.4,.3,.5];Object.assign(defaults,{width:dims[0],height:dims[1],depth:dims[2]});
 }
 if(mechanism==='freight-truck')Object.assign(defaults,{length:7.2,width:2.45,height:3.1});
 if(role==='tool'&&mechanism==='stand')Object.assign(defaults,{length:.8,width:.8,depth:.6,height:1,mass:80,productType:'crate',loadMode:'individual',base:'rigid',withPanel:false});
 if(mechanism==='overhead-crane')Object.assign(defaults,{length:4,width:3,height:3.2});
 if(role==='robot')Object.assign(defaults,{tool:['painting','inspection','welding','finishing'].includes(mechanism)?'process':'gripper',operation:['painting','inspection','welding','finishing'].includes(mechanism)?'process':'pick-place',assemblyProfile:mechanism==='heavy'?'heavy-handling':'auto'});
 if(role==='mobile')Object.assign(defaults,{tool:['agv-forks','autonomous-forklift','amr-pallet-lift','amr-underride'].includes(mechanism)?'fork':'platform',operation:'transport'});
 if(role==='storage')Object.assign(defaults,{withPanel:false,acceptsPallets:!['carton-flow','light-medium','miniload','multilevel-shuttle','cube','vertical-lift','carousel'].includes(mechanism),rows:2,columns:2,layers:2,palletCapacity:1,rackSystem:STORAGE[mechanism]||'floor'});
 if(role==='storage'&&STORAGE[mechanism])Object.assign(defaults,require('../../almacenamiento/schema/warehouseRacks.js').defaults(STORAGE[mechanism]),{catalogueEquipmentId:row.id});
 if(role==='storage'&&!STORAGE[mechanism])Object.assign(defaults,{palletCapacity:4,capacity:4});
 if(mechanism==='reject-bin')Object.assign(defaults,{height:.9,acceptsPallets:false});
 if(role==='packaging'&&['layer-palletizer','robot-palletizer'].includes(mechanism))Object.assign(defaults,{palletize:true,palletizeLimit:2,layoutMode:'grid',columns:2,rows:2,layers:1,capacity:4,palletCapacity:1,acceptsPallets:false,autoRelease:false});
 if(role==='packaging'&&mechanism==='pallet-dispenser')Object.assign(defaults,{productType:'pallet',productVariant:'pallet-industrial',width:1,height:.15,depth:1.2,mass:25,initialCount:4,capacity:8,autoGenerate:false,totalLimit:4});
 return Object.freeze(Object.assign({},row,{role,mechanism,nativeKind,nativeVariant,behaviorType:nativeKind==='plc'?'automation':nativeKind,geometryFamily:role,geometryVariant:mechanism,geometryPolicy:role==='storage'&&STORAGE[mechanism]?'native-rig':'auto',defaults:Object.freeze(defaults),recipe:RECIPE[mechanism]||mechanism,operationLevel,visualizationLevel:'native-educational',requiresRuntimeHook,workspace:DISPLAY[mechanism]||'monitor',moduleId:MODULE_ID,toolType:TOOL_TYPES[mechanism]||'process',limits:'Modelo educativo: parámetros configurados, sin certificación OEM ni cálculo físico continuo.'}));
}
const DEFINITIONS=Object.freeze(data.definitions.map(descriptor));
const byId=new Map(DEFINITIONS.map(x=>[x.id,x]));
function definition(id){return byId.get(id)||null;}
function normalize(id,value={}){
 const d=definition(id);if(!d||!plain(value))throw new Error('Unknown catalogue equipment or invalid configuration.');
 const out=Object.assign({},d.defaults,value,{catalogueEquipmentId:id});
 out.length=finite(value.length,d.defaults.length,.1,30);out.width=finite(value.width,d.defaults.width,.05,20);out.height=finite(value.height,d.defaults.height,.001,20);
 out.supportHeight=finite(value.supportHeight,1,.1,8);out.processTime=finite(value.processTime,5,.1,3600);out.capacity=finite(value.capacity,d.defaults.capacity,1,500);
 if(!Number.isInteger(out.capacity))throw new Error('Equipment capacity must be an integer.');
 out.speed=finite(value.speed,.4,.01,5);out.wear=finite(value.wear,.12,0,1);
 ['frameColor','accentColor'].forEach(k=>{if(!/^#[a-f0-9]{6}$/i.test(out[k]))throw new Error('Invalid equipment color.');});
 if(value.operationParametersJson!==undefined&&typeof value.operationParametersJson!=='string')throw new Error('Invalid operation parameter document.');
 return out;
}
function layout(id,value={}){
 const d=definition(id),c=normalize(id,value),supported=['conveyor','processor','source','palletQueue'].includes(d.nativeKind),floor=supported?-1:0;
 if(d.role==='storage'){const storage=require('../../almacenamiento/schema/palletQueues.js').layout(c);return Object.assign({height:c.height},storage);}
 if(d.nativeKind==='processor')return Object.assign({height:c.height},require('../../procesamiento/schema/processors.js').layout(c));
 const input={x:-c.length/2,y:0,z:0,tx:1,tz:0},output={x:c.length/2,y:0,z:0,tx:1,tz:0};
 const result={length:c.length,width:c.width,height:c.height,floor,deckHeight:0,input,inlet:input,output,outlet:output,inputPosition:[-c.length/2+.35,0,0],outputPosition:[c.length/2-.35,0,0],queuePosition:[-c.length/2+.35,0,0],ports:supported?[{id:'input',direction:'in',position:[input.x,0,0],tangent:[1,0,0],loadTypes:['discrete']},{id:'output',direction:'out',position:[output.x,0,0],tangent:[1,0,0],loadTypes:['discrete']}]:[]};
 if(d.role==='product'){result.length=c.width;result.width=Number.isFinite(c.depth)?c.depth:.5;result.input=result.inlet=result.output=result.outlet=null;result.ports=[];}
 if(d.role==='transport'){
  const cp=require('./cataloguePath.cjs');
  if(cp.handles(c)){result.path=cp.path(c);const ports=cp.ports(c);result.input=result.inlet=ports.input;result.output=result.outlet=ports.output;result.inputPosition=[ports.input.x,ports.input.y,ports.input.z];result.outputPosition=[ports.output.x,ports.output.y,ports.output.z];result.ports=Object.entries(ports).map(([key,p])=>({id:key,direction:p.incoming?'in':'out',position:[p.x,p.y,p.z],tangent:[p.tx,p.ty,p.tz],loadTypes:[p.loadClass]}));}
 }
 return result;
}
function source(key){const id=crosswalk.canonicalId(key);return id&&definition(id)||null;}
function resources(options={}){
 const ready=options.nativeReady||(()=>false);
 return DEFINITIONS.map(d=>{const verified=ready(d)===true;const action=d.operationLevel==='workspace'?{type:'workspace',workspace:d.workspace,catalogueEquipmentId:d.id}:d.operationLevel==='attachment'?{type:'applyEquipmentTool',catalogueEquipmentId:d.id,tool:d.toolType}:d.nativeKind?{type:'prefab',kind:d.nativeKind,variant:'catalogue:'+d.id,config:Object.assign({},d.defaults)}:null;
  return {id:'catalogue:'+d.id,name:d.title,technicalName:d.id,moduleId:MODULE_ID,category:d.role,subcategory:d.mechanism,status:verified?'functional':'development',action:verified?action:null,catalogueEquipmentId:d.id,sourceRefs:d.sourceRefs.map(x=>Object.assign({},x)),description:d.operationLevel==='workspace'?'Abre la capacidad real del espacio de trabajo para consultar la simulación. No conecta por sí mismo un ERP, WMS, MES o servicio externo.':d.limits,operationLevel:d.operationLevel,implementationStatus:verified?(d.operationLevel==='workspace'?'verified-workspace':'verified-native'):'awaiting-runtime-verification',documentationLinks:d.sourceRefs.map(x=>({articleId:x.key,relation:'exact'}))};});
}
module.exports={VERSION,MODULE_ID,DEFINITIONS,definition,normalize,layout,source,resources,sourceRefs:data.sources,crosswalk,plain};
