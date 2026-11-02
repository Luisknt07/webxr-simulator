'use strict';
const entries=require('../data/practice-index.cjs').entries;
const layouts=require('./PracticeLayoutBindings.cjs');
const automaticUnavailable=new Set(['L04','L12','L15','L19','L28','L32','I01','I04','I23','I31','I32']);
const automaticReason={L04:'La descarga automática necesita una misión ATLS/AGV con acoplamiento de muelle; no se sustituye por conducir un montacargas.',L12:'Falta la misión específica de almacenamiento AS/RS/AGV y su estación de alimentación.',L15:'La reposición automática por umbral y AS/RS/AMR todavía no está enlazada al saldo de consumo.',L19:'Falta la orden de recuperación automática y la estación de salida AS/RS/AGV.',L28:'La carga ATLS/AGV del camión requiere una interfaz de muelle automática validada.',L32:'El gestor de flota, los cruces y la política híbrida AMR/AGV aún no tienen una misión especializada.',I01:'La recepción automática ATLS/AGV no se sustituye por un montacargas en ruta.',I04:'Falta la misión específica AS/RS/miniload y su interfaz de alimentación.',I23:'El cambio automático requiere movimiento al soporte, desacople, servicios y enclavamiento del cambiador; el cambio asistido es otra modalidad.',I31:'Falta la transferencia automática de titularidad entre planta, CEDI y buffer AS/RS.',I32:'El despacho automático AGV/ATLS requiere interfaces de muelle e interlocks de carga propios.'};
function availability(id,mode='manual'){
 const source=entries.find(row=>row.id===id);if(!source)throw Error('Práctica no disponible: '+id);
 if(!['manual','semiautomatic','automatic'].includes(mode))throw Error('Modalidad de práctica inválida.');
 let reason='';
 if(mode==='automatic'&&automaticUnavailable.has(id))reason=automaticReason[id];
 else if(mode==='automatic'&&layouts.DOCUMENTARY.has(id))reason='La ficha automatizada exige reglas o integración del sistema de información; esta instalación implementa el flujo documental local supervisado, sin fingir ERP/WMS/OCR externos.';
 else if(mode==='semiautomatic'&&id==='L32')reason='La modalidad semiautomática necesita AGV con despacho central y sensores de cruce; está disponible el recorrido mecanizado de la modalidad manual.';
 return{practiceId:id,mode,ready:!reason,reasons:reason?[reason]:[],sourceMode:source.modes[['manual','semiautomatic','automatic'].indexOf(mode)].name,scope:layouts.DOCUMENTARY.has(id)?'local-supervised-documentary-workflow':'native-physical-operation'};
}
function matrix(){return entries.map(row=>({id:row.id,modes:['manual','semiautomatic','automatic'].map(mode=>availability(row.id,mode))}));}
module.exports={availability,matrix};
