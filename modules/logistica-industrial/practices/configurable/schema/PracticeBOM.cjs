'use strict';
const conversion=require('../../../functions/procesamiento/schema/materialConversion.cjs');
const DEFINITIONS={
 'SF-02':{inputs:{body:4,lid:4,screw:16},batch:1,type:'crate',name:'Kit de cuatro conjuntos',dimensions:[.56,.25,.42],state:{kitted:true},material:'kit'},
 'SF-04':{inputs:{body:1,lid:1,screw:4},batch:12,type:'cylinder',name:'Conjunto ensamblado',dimensions:[.28,.18,.28],state:{assembled:true},material:'assembly'},
 'CEDI-04':{inputs:{finished:1,carton:1,label:1},batch:4,type:'box',name:'Caja cerrada e identificada',dimensions:[.38,.27,.32],state:{packed:true,sealed:true,identified:true},material:'packed'},
 'SF-05':{inputs:{finished:1,carton:1,label:1},batch:4,type:'box',name:'Producto terminado embalado',dimensions:[.38,.27,.32],state:{packed:true,sealed:true,identified:true},material:'packed'}
};
function definition(id){const value=DEFINITIONS[id];if(!value)throw Error('Esta práctica no utiliza conversión BOM.');return value;}
function rows(id,entries,stock){
 definition(id);const lookup=new Map(stock.map(row=>[row.sku,row]));
 return conversion.leaves(entries).map(leaf=>{const source=lookup.get(leaf.spec.id);if(!source)throw Error('La BOM contiene una referencia ajena a esta orden.');return{leaf,material:source.material,source};});
}
function vector(id,entries,stock){const result={};for(const row of rows(id,entries,stock))result[row.material]=(result[row.material]||0)+row.leaf.units;return result;}
function accepts(id,entries,stock){
 try{if(entries.some(entry=>entry.spec&&entry.spec.operationState&&entry.spec.operationState.sourcePractice))return false;const d=definition(id),counts=vector(id,entries,stock);return Object.entries(counts).every(([key,quantity])=>d.inputs[key]&&quantity<=d.inputs[key]*d.batch);}catch(_){return false;}
}
function prepare(id,entries,stock){
 if(!accepts(id,entries,stock))throw Error('La entrada contiene referencias ajenas, repetidas o ya fabricadas.');
 const d=definition(id),counts=vector(id,entries,stock),keys=Object.keys(d.inputs),outputCount=counts[keys[0]]/d.inputs[keys[0]];
 if(!Number.isInteger(outputCount)||outputCount!==d.batch||Object.keys(counts).some(key=>!d.inputs[key])||keys.some(key=>counts[key]!==d.inputs[key]*outputCount))throw Error('BOM incompleta: '+keys.map(key=>d.inputs[key]*d.batch+' '+key).join(' / ')+'. Carga las referencias originales en la entrada.');
 const available=rows(id,entries,stock).map(row=>({...row,remaining:row.leaf.units,used:0})),outputs=[];
 for(let n=0;n<outputCount;n++){
  const members=[];
  for(const material of keys){let needed=d.inputs[material];for(const row of available){
   if(row.material!==material||!row.remaining||!needed)continue;
   const quantity=Math.min(needed,row.remaining),member=Object.assign({},row.leaf,{units:quantity,product:null});
   delete member.archivedProduct;
   member.materialUnitIds=row.source.unitIds.slice(row.used,row.used+quantity);
   if(member.materialUnitIds.length!==quantity)throw Error('Las identidades de componentes no corresponden a su cantidad.');
   members.push(member);row.used+=quantity;row.remaining-=quantity;needed-=quantity;
  }if(needed)throw Error('Faltan componentes originales de la BOM.');}
  const mass=members.reduce((sum,leaf)=>sum+leaf.spec.mass*leaf.units,0),lineage=entries[0].id.replace(/[^a-zA-Z0-9_-]/g,'-').slice(-42),[width,height,depth]=d.dimensions;
  outputs.push({units:1,members,spec:{id:id+'-'+d.material+'-'+lineage+'-'+(n+1),name:d.name+' '+(n+1),type:d.type,width,height,depth,mass,color:d.material==='packed'?'#b99363':'#4a8b91',materialClass:'solid',operationState:Object.assign({},d.state,{sourcePractice:id,outputUnits:1}),operationHistory:[{recipe:d.material==='assembly'?'assemble':d.material==='kit'?'kit':'pack',recordId:'',source:'native-processor-BOM',mode:'discrete-event',componentUnits:members.reduce((sum,leaf)=>sum+leaf.units,0)}]},load:{loadMode:'individual',palletColumns:1,palletRows:1,palletLayers:1}});
 }
 conversion.validate(entries,outputs);return outputs;
}
module.exports={DEFINITIONS,definition,vector,accepts,prepare};
