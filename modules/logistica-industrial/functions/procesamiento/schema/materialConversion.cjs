'use strict';

// A kit, carton or assembly changes the handling unit. Conservation is checked
// in original component units and mass, rather than adding incomparable SKUs.
const MAX_OUTPUTS=128,MAX_LEAVES=128;
function leaves(entries,out=[]){
 const path=new Set();let nodes=0;
 const visit=(rows,depth)=>{
  if(!Array.isArray(rows)||rows.length>MAX_LEAVES||depth>16)throw Error('Jerarquía material fuera de límite.');
  for(const entry of rows){
   if(!entry||typeof entry!=='object'||path.has(entry)||++nodes>4096)throw Error('Jerarquía material cíclica o inválida.');
   if(entry.members&&entry.members.length){path.add(entry);visit(entry.members,depth+1);path.delete(entry);}
   else{out.push(entry);if(out.length>4096)throw Error('Demasiados componentes originales.');}
  }
 };
 visit(entries,0);return out;
}
const key=entry=>[entry.originId||'',entry.id,entry.spec&&entry.spec.id||''].join('\u0000');
function vector(entries){
 const result=new Map();for(const entry of leaves(entries)){
  if(!entry||typeof entry.id!=='string'||!entry.spec||!Number.isSafeInteger(entry.units)||entry.units<1)throw Error('Componente original inválido.');
  const id=key(entry);result.set(id,(result.get(id)||0)+entry.units);
 }return result;
}
function signature(entries){return JSON.stringify(entries.map(entry=>({id:entry.id,ownerId:entry.ownerId,units:entry.units,spec:entry.spec,load:entry.load,members:leaves([entry]).map(leaf=>({id:key(leaf),units:leaf.units}))})));}
function validate(inputs,outputs){
 if(!Array.isArray(inputs)||!inputs.length||inputs.length>MAX_LEAVES||new Set(inputs.map(entry=>entry.id)).size!==inputs.length)throw Error('Entradas materiales duplicadas o fuera de límite.');
 if(!Array.isArray(outputs)||!outputs.length||outputs.length>MAX_OUTPUTS)throw Error('Salidas materiales fuera de límite.');
 const original=vector(inputs),result=vector(outputs);
 if(original.size!==result.size||[...original].some(([id,units])=>result.get(id)!==units))throw Error('La conversión no conserva los componentes y sus identidades.');
 let outputMass=0;
 for(const output of outputs){
  const spec=output.spec;
  if(!Number.isSafeInteger(output.units)||output.units<1||output.units>100000||!spec||typeof spec.id!=='string'||!spec.id||!Number.isFinite(spec.mass)||spec.mass<=0||!['width','height','depth'].every(field=>Number.isFinite(spec[field])&&spec[field]>.001&&spec[field]<=4)||!Array.isArray(output.members)||!output.members.length||leaves([output]).length>MAX_LEAVES)throw Error('Unidad fabricada inválida.');
  outputMass+=spec.mass*output.units;
 }
 const raw=leaves(inputs);if(raw.some(entry=>!Number.isFinite(entry.spec.mass)||entry.spec.mass<=0))throw Error('La BOM necesita masas de componentes conocidas.');
 const inputMass=raw.reduce((sum,entry)=>sum+entry.units*entry.spec.mass,0);
 if(Math.abs(inputMass-outputMass)>1e-6*Math.max(1,inputMass))throw Error('La conversión no conserva la masa declarada.');
 return{inputHandlingUnits:inputs.reduce((sum,entry)=>sum+entry.units,0),outputHandlingUnits:outputs.reduce((sum,entry)=>sum+entry.units,0),componentUnits:raw.reduce((sum,entry)=>sum+entry.units,0),inputMassKg:inputMass,outputMassKg:outputMass,sourceComponents:original.size};
}
module.exports={MAX_OUTPUTS,MAX_LEAVES,leaves,key,vector,signature,validate};
