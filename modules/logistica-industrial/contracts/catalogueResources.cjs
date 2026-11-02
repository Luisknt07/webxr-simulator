'use strict';
const catalog=require('../functions/equipamiento/schema/equipmentCatalog.cjs');
const operations=require('../functions/equipamiento/schema/operationSpec.cjs');
const GROUPS={transport:'TR',vehicle:'VE',mobile:'VE',storage:'AL',product:'UC',dock:'MU',picking:'PI',packaging:'EM',robot:'RO',tool:'EO',machine:'MA',sensor:'SE',safety:'SE',utility:'SE',control:'SI',monitor:'SI'};
const SUB={TR:'specialized',VE:'other',AL:'automated',UC:'special',MU:'receiving',PI:'assisted',EM:'packing',RO:'applications',EO:'process',MA:'services',SE:'sensing',SI:'control'};
function implemented(d){return d.operationLevel!=='pending'&&(d.operationLevel!=='discrete-event'||operations.SUPPORTED.has(d.recipe));}
module.exports=catalog.resources({nativeReady:implemented}).map(resource=>{
 const d=catalog.definition(resource.catalogueEquipmentId),group=GROUPS[d.role]||'MA';
 return Object.assign({},resource,{origin:'library',kind:d.role==='tool'?'tool':d.operationLevel==='workspace'?'interface':'equipment',category:'industrial',subcategory:'catalogue',catalogueGroup:group,catalogueSubgroup:SUB[group],
  thumbnail:d.nativeKind?{type:'procedural',key:d.id}:null,model:d.nativeKind?resource.action:null,dependencies:[],license:'Código y geometría originales del framework; fuentes documentales identificadas',version:catalog.VERSION,
  ports:d.nativeKind&&['source','processor','conveyor','palletQueue'].includes(d.nativeKind)?['Entrada','Salida']:[],simulation:d.operationLevel,interaction:['Ratón y teclado','Interfaz táctil','Mandos WebXR'],tags:[d.role,d.mechanism,'nexus'],
  dimensions:{units:'m',configurable:true},components:d.parts||[],parameters:(d.fields||[]).map(field=>field.label||field.key),
  documentationLinks:d.sourceRefs.map(ref=>({articleId:ref.namespace==='nexus-conceptual-198'?(ref.id||ref.sourceId):ref.key,relation:'exact'})),
  reason:d.operationLevel==='pending'?'Este mecanismo requiere completar su validación operativa.':undefined});
});
