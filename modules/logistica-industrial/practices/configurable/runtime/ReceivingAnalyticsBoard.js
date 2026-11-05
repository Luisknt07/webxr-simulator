import * as THREE from 'three';

const WIDTH=1024,HEIGHT=576,REFRESH_MS=500,MAX_BOARDS=2;
const COLORS={background:'#102b34',card:'#193c46',line:'#31545d',text:'#eff9f7',dim:'#b2cccf',green:'#6ce4b4',cyan:'#7bddee',amber:'#ffd06e',red:'#ff9b9e'};
const finite=value=>typeof value==='number'&&Number.isFinite(value)?value:0;
const total=(rows,predicate)=>rows.filter(predicate).reduce((sum,row)=>sum+Math.max(0,finite(row.units)),0);
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object||{},key);
const visible=object=>{for(let node=object;node;node=node.parent)if(!node.visible)return false;return true;};
const text=value=>String(value===undefined?'':value);
function shorten(value,length){const result=text(value);return result.length>length?result.slice(0,length-1)+'…':result;}

/** An editable physical display, with no independent stock or machine timer.
 * Runtime screen resources are attached only while viewing an active attempt.
 * Persist the returned ids in manifest.receivingAnalytics; transient textures
 * and canvas planes never become document content.
 */
export function createReceivingAnalyticsBoard(document,roomId,options={}){
 const objects=[],standby=[],position=options.position||[-26,3.15,-4.5],rotation=options.rotation||[0,0,0],width=options.width||3.1,height=options.height||1.75;
 function part(name,color,location,scale){const object=document.addPrimitive(roomId,'box',color);document.setProperty(object,'name',name);document.setTransform(object,{position:location,rotation,scale});objects.push(object);return object;}
 const display=part('REC · Tablero de analítica · recepción e inspección','#142e36',position,[width,height,.14]);
 display.userData.cediReceivingAnalytics={version:1,source:'native-receiving-ledger'};
 const yaw=rotation[1]||0,local=(x,y,z)=>[position[0]+Math.cos(yaw)*x+Math.sin(yaw)*z,y,position[2]-Math.sin(yaw)*x+Math.cos(yaw)*z];
 for(const side of [-1,1]){part('REC · Columna del tablero','#294957',local(side*width*.32,(position[1]-height/2)/2,0),[.075,position[1]-height/2,.075]);part('REC · Apoyo del tablero','#294957',local(side*width*.32,.035,0),[.48,.07,.5]);}
 // Persist the editor standby legend through the existing native text atlas.
 // The native atlas adds .023 m above its authored floor. Account for that
 // in the root pose rather than relying on a negative floorY surviving import.
 // Runtime also hides this exact authored legend while its live plane exists.
 if(document.addIndustrialFloorPresentation){
  const captions=['RECEPCIÓN / CONTROL DE CALIDAD','Pedido · inspección · trazabilidad','Datos disponibles durante CEDI-01','Recibe, inspecciona y registra cada pallet'];
  const legend=document.addIndustrialFloorPresentation(roomId,{type:'industrialFloor',version:1,bounds:[.01,.01,width-.01,height-.01],floorY:0,texts:captions,labels:captions.map((caption,index)=>[width/2,.42+index*.26,0,width-.38,.18,8+index])});
  document.setProperty(legend,'name','REC · Rótulo del tablero · vista de edición');
  const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2));
  document.setTransform(legend,{position:local(-width/2,position[1]+height/2,.0714-.023),quaternion:q.toArray(),scale:[1,1,1]});
  document.setBehaviors(legend,[{type:'collision',enabled:false}]);objects.push(legend);standby.push({boardId:display.userData.editorId,objectId:legend.userData.editorId});
 }
 return{version:1,boardIds:[display.userData.editorId],standby,objectIds:objects.map(object=>object.userData.editorId),objects,source:'native-receiving-ledger',refreshHz:2};
}

/** Pure read-only projection. Documentary acceptance and physical custody are
 * deliberately separate: a registered pallet is not counted as delivered until
 * the native owner really is the released/quarantine destination.
 */
export function receivingAnalyticsModel(manifest,snapshot){
 const receiving=manifest.receiving||{},active=manifest.practiceId==='CEDI-01',balance=snapshot&&snapshot.materialBalance;
 if(!active||!snapshot||!balance||!Array.isArray(snapshot.pallets))return{version:1,active,available:false,title:'Recepción e inspección',orderId:receiving.orderId||'',message:active?'Esperando la observación del intento activo.':'Área de referencia · la recepción no está activa en esta práctica.',metrics:[],positions:[],rows:[],alerts:[]};
 const pallets=snapshot.pallets,ids=new Set(pallets.map(row=>row.id)),ledger=snapshot.ledger||{},count=map=>Object.keys(map||{}).filter(id=>ids.has(id)).length;
 const expectedUnits=Math.max(0,finite(balance.expectedUnits)||finite(manifest.expectedUnits)),expectedPallets=Math.max(0,finite(balance.expectedPallets)||(manifest.palletIds||[]).length),inspected=count(ledger.inspections),registered=count(ledger.registrations);
 const place=row=>row.inQuarantine?'Cuarentena':row.inReleased?'Entregado':row.inInspection?'Inspección':row.held?'En traslado':row.inSource?'En camión':'Otro apoyo';
 const positions=[['En camión',COLORS.dim],['En traslado',COLORS.cyan],['Inspección',COLORS.amber],['Entregado',COLORS.green],['Cuarentena',COLORS.red],['Otro apoyo','#aeb7ee']].map(([label,color])=>({label,color,pallets:pallets.filter(row=>place(row)===label).length,units:total(pallets,row=>place(row)===label)}));
 const completed=pallets.filter(row=>row.inReleased||row.inQuarantine).length,alerts=(snapshot.criticalReasons||[]).map(value=>shorten(value,110));
 return{version:1,active:true,available:true,title:'Recepción e inspección',orderId:receiving.orderId||'',dock:receiving.dockAlias||'E02',expectedUnits,expectedPallets,physicalUnits:Math.max(0,finite(balance.actualUnits)),prepared:snapshot.prepared===true,closed:ledger.closed===true,alerts,
  metrics:[{label:'Fuera del camión',value:pallets.filter(row=>!row.inSource).length,max:expectedPallets,color:COLORS.cyan},{label:'Inspeccionados',value:inspected,max:expectedPallets,color:COLORS.amber},{label:'Registrados',value:registered,max:expectedPallets,color:COLORS.green},{label:'En destino físico',value:completed,max:expectedPallets,color:COLORS.green}],positions,
  rows:pallets.slice(0,8).map((row,index)=>({id:row.id,label:'P'+String(index+1).padStart(2,'0')+' · '+shorten(row.productSku||row.sku,22),units:Math.max(0,finite(row.units)),massKg:Math.max(0,finite(row.massKg)),place:place(row),inspected:own(ledger.inspections,row.id),registered:own(ledger.registrations,row.id)}))};
}

export function drawReceivingAnalytics(context,model){
 const box=(x,y,w,h,color)=>{context.fillStyle=color;context.fillRect(x,y,w,h);};
 const label=(value,x,y,size=18,color=COLORS.text,max=960)=>{context.font='600 '+size+'px Arial, sans-serif';context.fillStyle=color;context.fillText(text(value),x,y,max);};
 box(0,0,WIDTH,HEIGHT,COLORS.background);box(0,0,WIDTH,6,COLORS.green);
 label('RECEPCIÓN / CONTROL DE CALIDAD',26,43,27);label('Custodia física + registros del intento',26,71,16,COLORS.dim);
 if(!model.available){box(26,111,972,351,COLORS.card);label(model.active?'ESPERANDO DATOS':'RECEPCIÓN · ÁREA DE REFERENCIA',48,167,24,COLORS.cyan);label(model.message,48,211,20,COLORS.text,923);label('Datos disponibles durante CEDI-01.',48,254,18,COLORS.dim,923);label('Recibe, inspecciona y registra cada pallet antes de liberarlo.',48,290,18,COLORS.dim,923);label('Selecciona CEDI-01 para observar la recepción del lote físico.',26,539,18,COLORS.dim);return;}
 label(shorten(model.orderId,42)+' · Muelle '+model.dock,26,101,17,COLORS.cyan);
 const status=model.alerts.length?'REVISAR BALANCE':model.closed?'RECEPCIÓN CERRADA':model.prepared?'MUELLE VERIFICADO':'PREPARACIÓN PENDIENTE';
 label(status,675,76,16,model.alerts.length?COLORS.red:model.prepared?COLORS.green:COLORS.amber,322);
 label(model.physicalUnits+' / '+model.expectedUnits+' cajas · '+model.expectedPallets+' pallets previstos',675,101,16,COLORS.text,322);
 model.metrics.forEach((metric,index)=>{const x=26+index*247;box(x,120,231,91,COLORS.card);label(metric.label,x+12,145,16,COLORS.dim,209);label(metric.value+' / '+metric.max,x+12,178,27,metric.color);box(x+12,193,207,5,COLORS.line);box(x+12,193,207*Math.min(1,metric.max?metric.value/metric.max:0),5,metric.color);});
 label('UBICACIÓN ACTUAL · cajas',26,243,17,COLORS.dim);let start=26;const overall=model.positions.reduce((sum,row)=>sum+row.units,0);
 model.positions.filter(row=>row.units>0).forEach(row=>{const size=overall?972*row.units/overall:0;box(start,256,size,16,row.color);start+=size;});
 model.positions.filter(row=>row.units>0).forEach((row,index)=>{const x=26+(index%3)*324,y=298+Math.floor(index/3)*24;box(x,y-11,9,9,row.color);label(row.label+' '+row.units,x+17,y,15,COLORS.text,299);});
 const tableY=342;box(26,tableY,972,27,COLORS.card);label('IDENTIDAD / SKU',38,tableY+19,14,COLORS.dim);label('CAJAS',468,tableY+19,14,COLORS.dim);label('UBICACIÓN',562,tableY+19,14,COLORS.dim);label('CONTROL',823,tableY+19,14,COLORS.dim);
 model.rows.slice(0,6).forEach((row,index)=>{const y=tableY+27+index*23;box(26,y,972,23,index%2?COLORS.card:COLORS.background);label(row.label,38,y+17,14,COLORS.text,412);label(row.units,481,y+17,14);label(row.place,562,y+17,14);label(row.registered?'Registrado':row.inspected?'Inspeccionado':'Pendiente',823,y+17,14,row.registered?COLORS.green:row.inspected?COLORS.amber:COLORS.dim,164);});
 label(model.alerts.length?model.alerts[0]:'Recibe, inspecciona y registra cada pallet antes de liberarlo.',26,545,16,model.alerts.length?COLORS.red:COLORS.dim,972);
 label('Actualización 2 Hz · valores del simulador',26,568,13,COLORS.dim);
}

export default class ReceivingAnalyticsBoard{
 constructor(editor,manifest,options={}){
  this.editor=editor;this.manifest=manifest;this.now=options.now||Date.now;this.entries=[];this.disposed=false;this.nextAt=0;this.draws=0;
  const dom=editor.ctx&&editor.ctx.document||(typeof document!=='undefined'?document:null),configuration=manifest.receivingAnalytics||{};
  if(!dom||!dom.createElement)return;
  for(const id of (configuration.boardIds||[]).slice(0,MAX_BOARDS)){
   const owner=editor.document&&editor.document.getObject(id);if(!owner||!owner.parent)continue;
   const canvas=dom.createElement('canvas');canvas.width=WIDTH;canvas.height=HEIGHT;const drawing=canvas.getContext&&canvas.getContext('2d');if(!drawing)continue;
   const texture=new THREE.CanvasTexture(canvas);texture.encoding=THREE.sRGBEncoding;texture.generateMipmaps=false;texture.minFilter=texture.magFilter=THREE.LinearFilter;
   const geometry=new THREE.PlaneBufferGeometry(.967,.955),material=new THREE.MeshBasicMaterial({map:texture,toneMapped:false}),plane=new THREE.Mesh(geometry,material);
   plane.name='REC · Analítica del intento activo';plane.position.z=.52;Object.assign(plane.userData,{editorRuntimeHelper:true,editorHelper:true,editorNonCollidable:true});owner.add(plane);
   const legends=[];
   for(const reference of configuration.standby||[]){
    if(reference.boardId!==id)continue;const legend=editor.document.getObject(reference.objectId);
    if(!legend||!legend.parent||!legend.userData.editorDescriptor||legend.userData.editorDescriptor.type!=='industrialFloor')continue;
    // Native floor content is regenerated from its descriptor and has no
    // editable descendant records. Leave wrapper visibility untouched so a
    // save while viewing still serializes the exact authored scene.
    for(const object of legend.children.filter(child=>!child.userData.editorRuntimeHelper))legends.push({object,authoredVisible:object.visible});
   }
   // Display-only state: do not call a document command, replace descriptors,
   // or add a history entry. Preserve a deliberately hidden authored legend.
   for(const legend of legends)legend.object.visible=false;
   this.entries.push({owner,plane,canvas,drawing,texture,legends,signature:''});
  }
 }
 update(snapshotOrRead){
  if(this.disposed||!this.entries.length)return false;const now=this.now();if(now<this.nextAt)return false;this.nextAt=now+REFRESH_MS;
  const performance=this.editor.ctx&&this.editor.ctx.performanceVisibility,shown=this.entries.filter(entry=>entry.owner.parent&&visible(entry.owner)&&(!performance||!performance.isVisible||performance.isVisible(entry.owner)));
  if(!shown.length)return false;
  const snapshot=typeof snapshotOrRead==='function'?snapshotOrRead():snapshotOrRead,model=receivingAnalyticsModel(this.manifest,snapshot),signature=JSON.stringify(model);let changed=false;
  for(const entry of shown){if(entry.signature===signature)continue;drawReceivingAnalytics(entry.drawing,model);entry.signature=signature;entry.texture.needsUpdate=true;this.draws++;changed=true;}
  return changed;
 }
 dispose(){
  if(this.disposed)return;this.disposed=true;for(const entry of this.entries){if(entry.plane.parent)entry.plane.parent.remove(entry.plane);for(const legend of entry.legends)legend.object.visible=legend.authoredVisible;entry.plane.geometry.dispose();entry.plane.material.dispose();entry.texture.dispose();entry.canvas.width=entry.canvas.height=0;}this.entries=[];this.editor=null;
 }
}
