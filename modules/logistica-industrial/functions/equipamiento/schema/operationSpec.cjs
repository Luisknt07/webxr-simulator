'use strict';

const catalog=require('./equipmentCatalog.cjs');
const LIMIT=8000,MAX_HISTORY=24;
const NUMBER_FIELDS={targetWidth:[.05,4],targetHeight:[.03,4],targetDepth:[.05,4],removedMassKg:[0,3000],minMassKg:[0,3000],maxMassKg:[0,3000],targetTemperatureC:[-80,1500],fillFraction:[0,1],torqueNm:[0,1000],toleranceM:[0,.5],doseKg:[0,1000],requiredUnits:[1,64]};
const STRING_FIELDS={label:80,batchCode:48,expectedProductId:80,expectedCode:80,outputCatalogueEquipmentId:120,outputMaterialClass:32,outputColor:7};
const BOOLEAN_FIELDS=['operatorConfirmed','guardClosed','utilityAvailable','testPass'];
const SUPPORTED=new Set(['erect','seal','pack','strap','wrap','label','depalletize','cut','machine','drill','bend','form','mold','extrude','additive','weld','position','paint','heat','cool','assemble','feed','clamp','finish','mix','transfer-fluid','fill','wash','test','measure','insert','dose','inspect','weigh','checkweigh','identify','decant','verify','sort','pick','leveler','restraint','tail-lift','lift-table','atls','forklift-station','pallet-truck-station','loading-dock','charging-station','extraction','energy','fluid-actuator','motor-drive','servo']);
const completedPlans=new WeakSet(),preparedPlans=new WeakMap();
function parameters(id,value={}){
 const d=catalog.definition(id);if(!d)throw new Error('Unknown operation equipment.');
 if(typeof value==='string'){if(value.length>LIMIT)throw new Error('Operation parameters exceed the document limit.');try{value=JSON.parse(value||'{}');}catch(_){throw new Error('Invalid operation parameter JSON.');}}
 if(!catalog.plain(value)||Object.keys(value).some(k=>!Object.hasOwn(NUMBER_FIELDS,k)&&!Object.hasOwn(STRING_FIELDS,k)&&!BOOLEAN_FIELDS.includes(k)))throw new Error('Unsupported operation parameter.');
 const out={};
 Object.entries(value).forEach(([key,v])=>{
  if(NUMBER_FIELDS[key]){const [lo,hi]=NUMBER_FIELDS[key];if(typeof v!=='number'||!Number.isFinite(v)||v<lo||v>hi||(key==='requiredUnits'&&!Number.isInteger(v)))throw new Error('Invalid operation parameter '+key);}
  else if(STRING_FIELDS[key]){if(typeof v!=='string'||v.length>STRING_FIELDS[key]||/[\u0000-\u001f]/.test(v))throw new Error('Invalid operation text '+key);}
  else if(typeof v!=='boolean')throw new Error('Invalid operation boolean '+key);
  out[key]=v;
 });
 if(out.minMassKg!==undefined&&out.maxMassKg!==undefined&&out.minMassKg>out.maxMassKg)throw new Error('Minimum mass exceeds maximum.');
 if(out.outputCatalogueEquipmentId){const product=catalog.definition(out.outputCatalogueEquipmentId);if(!product||product.role!=='product')throw new Error('Output model must be a registered product.');}
 if(out.outputMaterialClass&&!['solid','bulk','fluid','steel','ferromagnetic','non-ferrous','textile','porous-textile','fragile','conditioned','hazardous'].includes(out.outputMaterialClass))throw new Error('Unsupported output material class.');
 if(out.outputColor&&!/^#[a-f0-9]{6}$/i.test(out.outputColor))throw new Error('Invalid output color.');
 return out;
}
function normalizeParameters(id,value){return JSON.stringify(parameters(id,value));}
function operationSpec(id,value={}){
 const d=catalog.definition(id),c=catalog.normalize(id,value),p=parameters(id,c.operationParametersJson||{});
 return {id:d.id,recipe:d.recipe,level:d.operationLevel,discreteEvent:true,supported:SUPPORTED.has(d.recipe),parameters:p,cycleSeconds:c.processTime,ports:catalog.layout(id,c).ports,limits:'La operación registra estados y transformaciones discretas configuradas. No calcula calor, fuerzas, acabado, vacío ni tolerancias OEM.'};
}
function signature(entry){return JSON.stringify({id:entry.id,ownerId:entry.ownerId,units:entry.units,spec:entry.spec,load:entry.load});}
function copy(value){return value===undefined?undefined:JSON.parse(JSON.stringify(value));}
function freezeJSON(value){if(value&&typeof value==='object'){Object.values(value).forEach(freezeJSON);Object.freeze(value);}return value;}
function prepareOperation(config,entries,context={}){
 if(!catalog.plain(config)||!Array.isArray(entries)||!entries.length||entries.length>128)throw new Error('Invalid operation inputs.');
 const id=config.catalogueEquipmentId,d=catalog.definition(id),op=operationSpec(id,config);
 if(!op.supported)throw new Error('Equipment requires its dedicated operational adapter: '+op.recipe);
 const p=op.parameters;
 if(p.guardClosed===false||p.utilityAvailable===false||p.operatorConfirmed===false)throw new Error('The configured operation interlock is not satisfied.');
 const seen=new Set(),updates=[],ledger={inputUnits:0,outputUnits:0,inputMassKg:0,outputMassKg:0,wasteMassKg:0,massKnown:true};
 entries.forEach(entry=>{
  if(!entry||typeof entry.id!=='string'||!entry.id||seen.has(entry.id)||!catalog.plain(entry.spec)||!Number.isInteger(entry.units)||entry.units<1||entry.units>100000)throw new Error('Invalid, duplicate or non-conserved input load.');
  seen.add(entry.id);const spec=copy(entry.spec),load=copy(entry.load||{}),units=entry.units;
  const history=Array.isArray(spec.operationHistory)?spec.operationHistory.slice(-MAX_HISTORY+1):[];
  const state=catalog.plain(spec.operationState)?Object.assign({},spec.operationState):{};
  const measurement={source:'declared-simulation',units,productId:String(spec.id||''),widthM:spec.width,heightM:spec.height,depthM:spec.depth,massKg:Number.isFinite(spec.mass)?spec.mass:null};
  const result={recipe:op.recipe,equipmentId:id,recordId:String(context.recordId||'').slice(0,160),cycleSeconds:op.cycleSeconds,sequence:Number.isSafeInteger(context.runSequence)?context.runSequence:0,mode:'discrete-event'};
  const set=(key,value)=>{state[key]=value;};
  switch(op.recipe){
   case'erect':set('cartonErected',true);set('packagingStage','open');break;
   case'seal':set('sealed',true);set('packagingStage','sealed');break;
   case'pack':set('packed',true);set('packagingStage','packed');break;
   case'strap':set('strapped',true);break;
   case'wrap':set('wrapped',true);break;
   case'label':set('label',p.label||String(spec.id||entry.id));set('batchCode',p.batchCode||'');break;
   case'cut':case'machine':case'extrude':case'mold':case'additive':
    ['width','height','depth'].forEach(key=>{const target=p['target'+key[0].toUpperCase()+key.slice(1)];if(target!==undefined)spec[key]=target;});
    set('manufacturingStage',op.recipe);break;
   case'drill':set('drilled',true);break;case'bend':set('formed','bent');break;case'form':set('formed','stamped');break;
   case'weld':set('joined',true);set('joiningProcess','weld');break;case'paint':set('coated',true);break;
   case'heat':case'cool':set('thermalCycle',op.recipe);if(p.targetTemperatureC!==undefined)set('commandedTemperatureC',p.targetTemperatureC);break;
   case'assemble':set('assembled',true);break;case'clamp':set('fixtureVerified',true);break;case'finish':set('surfaceStage','finished');break;
   case'mix':set('mixed',true);break;case'fill':case'dose':set('dosed',true);if(p.fillFraction!==undefined)set('fillFraction',p.fillFraction);if(p.doseKg!==undefined)set('requestedDoseKg',p.doseKg);break;
   case'wash':set('cleaned',true);break;
   case'insert':set('inserted',true);break;
   case'test':set('testResult',p.testPass===undefined?'not-measured':p.testPass?'pass':'fail');if(p.testPass===false){spec.quality='defective';spec.defect='damage';}break;
   case'weigh':case'measure':case'inspect':case'checkweigh':case'identify':case'verify':
    result.measurement=measurement;
    if(op.recipe==='checkweigh'){
     const mass=measurement.massKg,known=mass!==null;
     const pass=known&&(p.minMassKg===undefined||mass>=p.minMassKg)&&(p.maxMassKg===undefined||mass<=p.maxMassKg);
     set('inspectionResult',known?(pass?'pass':'reject'):'unknown');if(known&&!pass){spec.quality='defective';spec.defect='weight';}
    }
    if(['identify','verify'].includes(op.recipe))set('identityVerified',p.expectedProductId===undefined||p.expectedProductId===String(spec.id||''));
    break;
   case'pick':case'sort':case'decant':case'depalletize':set('handlingStep',op.recipe);break;
   default:set('operationCycle',op.recipe);break;
  }
  if(['extrude','mold','additive'].includes(op.recipe)&&['bulk','fluid'].includes(spec.materialClass)){
   spec.catalogueEquipmentId='equipment.product.discrete-part';spec.materialClass='solid';spec.type='cylinder';delete spec.variant;
  }
  if(p.outputCatalogueEquipmentId){const output=catalog.definition(p.outputCatalogueEquipmentId),native=require('../../flujo-materiales/schema/product-equipment.js').getDefinition(output.nativeVariant);spec.catalogueEquipmentId=output.id;if(native)spec.type=native.preset.productType;delete spec.variant;}
  if(p.outputMaterialClass)spec.materialClass=p.outputMaterialClass;
  if(p.outputColor)spec.color=p.outputColor;
  const removed=p.removedMassKg||0,mass=Number.isFinite(spec.mass)?spec.mass:null;
  if(removed&&mass===null)throw new Error('Material removal requires a known declared input mass.');
  if(removed&&(!['cut','machine','drill','finish'].includes(op.recipe)||removed>mass))throw new Error('Invalid material-removal balance.');
  if(removed)spec.mass=mass-removed;
  if(spec.mass===0)throw new Error('The operation cannot erase the entire load.');
  if(p.torqueNm!==undefined)set('commandedTorqueNm',p.torqueNm);
  history.push(result);spec.operationHistory=history;spec.operationState=state;
  ledger.inputUnits+=units;ledger.outputUnits+=units;
  if(mass===null)ledger.massKnown=false;else{ledger.inputMassKg+=mass*units;ledger.outputMassKg+=spec.mass*units;ledger.wasteMassKg+=removed*units;}
  updates.push(Object.freeze({entry,signature:signature(entry),spec:freezeJSON(spec),load:freezeJSON(load),units}));
 });
 if(ledger.inputUnits!==ledger.outputUnits||ledger.massKnown&&Math.abs(ledger.inputMassKg-ledger.outputMassKg-ledger.wasteMassKg)>1e-7)throw new Error('Non-conserved operation result.');
 const plan=Object.freeze({id,recipe:op.recipe,updates:Object.freeze(updates),ledger:Object.freeze(ledger),event:Object.freeze({type:'catalogue-operation',message:d.title+' · ciclo educativo completado'}),limits:op.limits});preparedPlans.set(plan,updates);return plan;
}
function commitOperation(plan){
 if(!plan||!preparedPlans.has(plan)||completedPlans.has(plan))throw new Error('Operation plan is invalid or already committed.');
 plan.updates.forEach(row=>{if(signature(row.entry)!==row.signature)throw new Error('Operation inputs changed before commit.');});
 // All validation precedes this bounded mutation. Custody, identity, parent,
 // runtime product references and scene transforms are deliberately untouched.
 plan.updates.forEach(row=>{row.entry.spec=copy(row.spec);row.entry.load=copy(row.load);});completedPlans.add(plan);
 return {entries:plan.updates.map(row=>row.entry),ledger:plan.ledger,event:plan.event,recipe:plan.recipe};
}
function applyOperation(config,entries,context){return commitOperation(prepareOperation(config,entries,context));}
module.exports={LIMIT,MAX_HISTORY,SUPPORTED,parameters,normalizeParameters,operationSpec,prepareOperation,commitOperation,applyOperation};
