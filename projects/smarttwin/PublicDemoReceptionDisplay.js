/** Digital extension of the existing native monitor; no extra world panels. */
export default class PublicDemoReceptionDisplay {
 constructor(operations){this.operations=operations;this.pageId='receiving';this.label='RECEPCIÓN';}
 signature(){return this.operations.version;}
 press(hmi,entry,key){
  const o=this.operations,s=o.snapshot();entry.receptionSku=entry.receptionSku||0;entry.receptionQty=entry.receptionQty||4;entry.receptionLoad=entry.receptionLoad||0;
  const selected=s.loads.find(p=>p.id===entry.receptionLoadId)||s.loads[0];
  if(key==='sku-prev'||key==='sku-next')entry.receptionSku=(entry.receptionSku+(key==='sku-next'?1:-1)+s.catalog.length)%s.catalog.length;
  else if(key.startsWith('qty:'))entry.receptionQty=Math.max(1,Math.min(16,entry.receptionQty+Number(key.split(':')[1])));
  else if(key==='prepare')o.createOrder(s.catalog[entry.receptionSku%s.catalog.length].id,entry.receptionQty);
  else if(key==='authorize')o.authorize();
  else if(key==='pause')o.pauseReceiving();
  else if(key==='hold')o.holdReceiving();
  else if(key==='cancel'){const order=s.orders.find(row=>!row.cancelled&&row.admitted<row.quantity);if(order)o.cancelOrder(order.id);}
  else if(key==='new-sku'){const p=s.catalog[entry.receptionSku%s.catalog.length];o.addProduct({name:p.name+' · nuevo SKU',type:p.type,color:p.color,mass:p.mass,quality:p.quality});entry.receptionSku=o.catalog.length-1;}
  else if(key==='load-prev'||key==='load-next'){const i=s.loads.findIndex(p=>selected&&p.id===selected.id),index=(i+(key==='load-next'?1:-1)+Math.max(1,s.loads.length))%Math.max(1,s.loads.length);entry.receptionLoadId=s.loads[index]&&s.loads[index].id;}
  else if(key==='inspect'&&selected)o.inspect(selected.id);
  else if(key==='withdraw'&&selected)o.withdraw(selected.id);
  else if(key==='ship'&&selected)o.ship(selected.id);
  else if(key==='seal')o.finishPallet();
  entry.notice='';entry.dirty=true;
 }
 draw(hmi,entry){
  const s=this.operations.snapshot(),sku=s.catalog[(entry.receptionSku||0)%s.catalog.length],qty=entry.receptionQty||4,load=s.loads.find(p=>p.id===entry.receptionLoadId)||s.loads[0];entry.receptionLoadId=load&&load.id;
  const text=(value,x,y,size=17,color='#ecf5fb',width=470)=>hmi.text(entry,value,x,y,size,color,width);
  const button=(key,label,x,y,w=146,disabled=false)=>hmi.button(entry,'receiving:'+key,label,x,y,w,42,{operation:key,disabled,fontSize:14});
  text('1 · RECEPCIÓN Y LOTES',20,140,20,'#55d7f2');text(sku.name,20,174,20);text(sku.id+' · '+(sku.type==='crate'?'Plástico':'Cartón')+' · '+sku.mass+' kg',20,199,15);
  button('sku-prev','◀ TIPO',20,214);button('sku-next','TIPO ▶',174,214);button('new-sku','NUEVO SKU',328,214,172,s.catalog.length>=8);
  text('Cantidad: '+qty+' unidades',20,282);for(const [i,n]of [-4,-1,1,4].entries())button('qty:'+n,(n>0?'+':'')+n,20+i*62,298,56);
  button('prepare','PREPARAR LOTE',276,298,224);
  const pending=s.orders.filter(o=>!o.cancelled&&o.admitted<o.quantity);text(pending.length+' lotes pendientes · '+s.generated+' entradas / '+s.total+' previstas',20,367,16);
  button('authorize','AUTORIZAR ENTRADAS',20,380,234,!pending.length);button('pause',s.receivingPaused?'CONTINUAR LLEGADAS':'PAUSAR LLEGADAS',266,380,234);
  button('cancel','CANCELAR PENDIENTES',20,432,234,!pending.length);button('seal','CERRAR PALLET PARCIAL',266,432,234,!s.partial);
  text('Pallet parcial: '+s.partial+'/4 · Retiradas: '+s.withdrawn,20,504,16);text('Expedidos: '+s.shipped+' pallets / '+s.shippedUnits+' unidades',20,532,16,'#43d69b');
  text('2 · INSPECCIÓN DE CARGAS',524,140,20,'#55d7f2');text(load?load.name:'Sin mercancía admitida',524,174,19);
  button('load-prev','◀ CARGA',524,196,230,!s.loads.length);button('load-next','CARGA ▶',766,196,230,!s.loads.length);
  if(load){text(load.sku+' · '+load.type,524,266,16);text(load.units+' ud. · '+load.mass+' kg · '+load.width+' × '+load.depth+' × '+load.height+' m',524,294,16);text(load.quality==='defective'?'DAÑADO · '+load.defect:'CONFORME · '+(load.inspected?'Inspeccionado':'Sin inspeccionar'),524,322,16,load.quality==='defective'?'#f2be55':'#43d69b');text(load.location,524,350,15);text(load.contents.length?'Contenido: '+load.contents.map(p=>p.sku).join(', '):'Carga registrada en la instalación',524,378,14);}
  button('inspect','INSPECCIONAR',524,398,230,!load);button('withdraw','RETIRAR RECEPCIÓN',766,398,230,!(load&&load.withdrawable));
  button('ship','EXPEDIR DESDE DESPACHO',524,452,472,!(load&&load.shippable));
  button('hold',s.receptionHeld?'LIBERAR A LÍNEA':'RETENER EN RECEPCIÓN',524,506,472);
 }
}
