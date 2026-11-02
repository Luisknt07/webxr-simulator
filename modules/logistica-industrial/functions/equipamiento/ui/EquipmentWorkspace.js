const element=(tag,text,parent)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(parent)parent.appendChild(node);return node;};
const TITLES={inventory:'Inventario y ubicaciones',analytics:'Operaciones y resultados',monitor:'Supervisión de la instalación',fleet:'Flota y misiones'};
const format=value=>typeof value==='number'?String(Math.round(value*1000)/1000):String(value===undefined?'—':value);

/** Module-local views of real project/runtime data. No invented stock or
 * unconfigured external ERP, WMS or sensor connection. */
export default class EquipmentWorkspace{
 constructor(editor,host,id){
  this.editor=editor;this.host=host;this.id=id;this.generation=editor.projectGeneration;this.roomId=editor.roomId;this.disposed=false;
  element('h2',TITLES[id]||TITLES.monitor,host);element('p','Datos del nivel activo. Las cantidades ejecutadas y los eventos proceden de esta simulación; las conexiones con sistemas externos se configuran por separado.',host);
  const actions=element('div',undefined,host);actions.className='ed-actions';
  this.action(actions,'Actualizar',()=>this.render());this.action(actions,'Variables y eventos',()=>editor.simulationPanel.toggle(true));this.action(actions,'Misiones',()=>editor.shell.openWorkspace('logic'));
  this.state=element('p','',host);this.table=element('div',undefined,host);this.table.style.cssText='max-height:55vh;overflow:auto';this.render();
  this.timer=setInterval(()=>{if(!this.current())return this.dispose();this.render();},500);
 }
 current(){return!this.disposed&&this.editor.projectGeneration===this.generation&&this.editor.roomId===this.roomId&&(!this.editor.projectModules||this.editor.projectModules.canShowLevel('sector.logistics-industrial'));}
 action(parent,label,fn){const b=element('button',label,parent);b.type='button';b.addEventListener('click',()=>{if(this.current())fn();});}
 rows(){
  const e=this.editor,r=e.simulation,rows=[];
  if(r&&r.active){
   if(this.id==='inventory'){
    const seen=new Set();r.sourceRuntime.entries.forEach(entry=>{if(!entry.ownerId||seen.has(entry.id))return;seen.add(entry.id);const owner=r.records.get(entry.ownerId);rows.push([entry.spec.id,entry.id,entry.units,owner?owner.object.name:entry.ownerId,entry.spec.quality||'good']);});
    r.products.forEach(product=>{if(product.sourceEntry&&seen.has(product.sourceEntry.id))return;const m=r.productMetadata(product);rows.push([m.sku||m.id||product.object.name,product.sourceEntry&&product.sourceEntry.id||product.record&&product.record.id||product.object.uuid,m.units,product.vehicleOwnerId||product.robotOwnerId||product.sourceEntry&&product.sourceEntry.ownerId||'Nivel',m.quality]);});
   }else r.records.forEach(record=>{const v=record.variables||{},c=record.components;if(this.id==='fleet'&&!c.vehicle&&!c.robot)return;rows.push([record.object.name,record.id,v.state||v.missionStatus||v.phase||'Disponible',v.completedUnits||v.receivedUnits||v.deliveredUnits||0,v.blocked?'Bloqueado':v.emergency?'Emergencia':'—']);});
  }else e.document.getObjects(e.roomId).forEach(object=>{const configs=e.document.getBehaviors(object);for(const c of configs){if(this.id==='inventory'&&c.type!=='product')continue;if(this.id==='fleet'&&!['vehicle','robot'].includes(c.type))continue;if(!['product','source','processor','conveyor','palletQueue','robot','vehicle','sensor','automation'].includes(c.type))continue;rows.push([object.name,object.userData.editorId,c.sku||c.type,c.units||c.initialCount||0,'Configuración']);}});
  return rows;
 }
 render(){if(!this.current())return;const active=this.editor.simulation&&this.editor.simulation.active;this.state.textContent=active?'En vivo · tiempo simulado '+format(this.editor.simulation.time)+' s':'Configuración guardada · pulsa Probar para observar la ejecución';const rows=this.rows(),signature=JSON.stringify(rows);if(signature===this.signature)return;this.signature=signature;this.table.textContent='';
  const table=element('table',undefined,this.table);table.style.cssText='width:100%;border-collapse:collapse;text-align:left';const head=element('tr',undefined,element('thead',undefined,table));const columns=this.id==='inventory'?['SKU / producto','ID de carga','Unidades','Ubicación / custodio','Calidad']:['Equipo','ID','Estado / función','Unidades','Condición'];for(const name of columns){const th=element('th',name,head);th.style.cssText='padding:10px;border-bottom:1px solid #527080'}
  const body=element('tbody',undefined,table);for(const row of rows.slice(0,500)){const tr=element('tr',undefined,body);for(const value of row){const td=element('td',format(value),tr);td.style.cssText='padding:8px;border-bottom:1px solid #314856;overflow-wrap:anywhere';}}
  if(!rows.length)element('p','Este nivel no contiene registros para esta vista.',this.table);
 }
 dispose(){if(this.disposed)return;this.disposed=true;clearInterval(this.timer);}
}
