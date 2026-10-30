'use strict';

const racks = require('../schema/warehouseRacks.js');
const node = (doc, tag, text, parent, className) => {
  const element = doc.createElement(tag); if (text !== undefined) element.textContent = text;
  if (className) element.className = className; if (parent) parent.appendChild(element); return element;
};
const attribute = (element, name, value = '') => {element.setAttribute(name, value); return element;};
const assignments = config => JSON.parse(config.rackAssignments || '[]');

function remapPlan(previous, next) {
  const plan = assignments(previous); if (!plan.length) return next;
  const oldCells = racks.layout(previous).cells, newCells = racks.layout(Object.assign({}, next, {rackAssignments:'[]'})).cells;
  const rows = plan.map(row => {
    const old = oldCells.find(cell => cell.code === row.locationCode);
    const target = old && newCells.find(cell => ['bank','bay','level','column','depthIndex'].every(key => cell[key] === old[key]));
    if (!target) throw new Error('Libera primero la reserva de ' + row.locationCode + ' antes de eliminar esa posición.');
    return {locationCode: target.code, palletId: row.palletId};
  });
  return Object.assign({}, next, {rackAssignments:JSON.stringify(rows)});
}

function shell(doc, parent, runtime) {
  const root = attribute(node(doc, 'section', undefined, parent, 'rack-location-panel'), runtime ? 'data-rack-inventory' : 'data-rack-plan');
  node(doc, 'strong', runtime ? 'Ubicaciones e inventario' : 'Ubicaciones y reservas', root);
  node(doc, 'p', 'Pasillo · fila · banco · módulo · nivel · posición · fondo. El ID del pallet identifica la carga; el código de ubicación identifica su destino.', root, 'ed-hint');
  return root;
}

function renderPlan({document:doc, parent, config, update, products = [], notify = () => {}}) {
  const layout = racks.layout(config), root = shell(doc, parent, false), controls = node(doc,'div',undefined,root,'rack-location-form');
  const select = attribute(node(doc,'select',undefined,controls),'data-rack-location-select'); select.setAttribute('aria-label','Ubicación que se va a reservar');
  layout.cells.forEach(cell => {const option = node(doc,'option',cell.code,select); option.value = cell.code;});
  select.value=layout.cells[config.rackSelectedSlot||0].code;
  const input = attribute(node(doc,'input',undefined,controls),'data-rack-pallet-id'); input.type='text'; input.maxLength=200; input.placeholder='ID único del pallet'; input.setAttribute('aria-label','ID único del pallet asignado');
  const list=node(doc,'datalist',undefined,root); list.id='rack-pallet-plan-'+racks.addressPrefix(config); input.setAttribute('list',list.id);
  products.forEach(product=>{const option=node(doc,'option',product.name,list);option.value=product.id;});
  const run = action => async () => {try {await action();} catch(error) {notify(error.message || String(error));}};
  const actions = node(doc,'div',undefined,root,'ed-actions');
  const assign = attribute(node(doc,'button','Reservar ubicación',actions),'data-rack-action','assign'); assign.type='button';
  assign.addEventListener('click',run(() => {
    const palletId=input.value.trim(); if(!palletId)throw Error('Escribe el ID único del pallet que ocupará la ubicación.');
    const current=assignments(config), next=current.filter(row=>row.locationCode!==select.value);
    next.push({locationCode:select.value,palletId});
    const checked=racks.normalize(Object.assign({},config,{rackAssignments:JSON.stringify(next)}));
    return update('rackAssignments',checked.rackAssignments);
  }));
  const all=attribute(node(doc,'button','Liberar todas las reservas',actions),'data-rack-action','clear-all'); all.type='button'; all.disabled=!assignments(config).length;
  all.addEventListener('click',run(()=>update('rackAssignments','[]')));
  const table=node(doc,'div',undefined,root,'rack-location-list');
  const rows=assignments(config), reserved=new Map(rows.map(row=>[row.locationCode,row]));
  layout.cells.forEach(cell=>{
    const row=attribute(node(doc,'div',undefined,table,'rack-location-row'),'data-rack-location-code',cell.code);
    attribute(row,'data-rack-slot',cell.index); node(doc,'code',cell.code,row);
    const allocation=reserved.get(cell.code); node(doc,'span',allocation?allocation.palletId:'Disponible',row);
    if(allocation){
      const clear=attribute(node(doc,'button','Liberar',row),'data-rack-action','clear'); clear.type='button'; clear.setAttribute('aria-label','Liberar reserva de '+cell.code);
      clear.addEventListener('click',run(()=>update('rackAssignments',JSON.stringify(rows.filter(item=>item.locationCode!==cell.code)))));
    }
  });
  node(doc,'p','El plan se guarda con el proyecto y admite los IDs estables de los pallets del diseño. Los pallets que genera una nueva ejecución reciben IDs nuevos: asígnalos en Probar, desde el inventario. Una reserva no mueve la carga.',root,'ed-hint');
  return root;
}

function renderRuntime({document:doc, parent, editor, objectId, notify = () => {}}) {
  let simulation=editor.simulation, runtime=simulation.palletQueueRuntime, record=simulation.records.get(objectId);
  if(!record || !record.components.palletQueue || !record.components.palletQueue.rack || !runtime.locations)return null;
  const root=shell(doc,parent,true), controls=node(doc,'div',undefined,root,'rack-location-form');
  const select=attribute(node(doc,'select',undefined,controls),'data-rack-location-select'); select.setAttribute('aria-label','Ubicación de almacenamiento');
  const pallet=attribute(node(doc,'select',undefined,controls),'data-rack-pallet-id'); pallet.setAttribute('aria-label','Pallet de la operación');
  const actions=node(doc,'div',undefined,root,'sim-actions'), table=node(doc,'div',undefined,root,'rack-location-list');
  let locationSignature='', productSignature=''; const rows=new Map();
  const authority=()=>!editor.active&&(!editor.ctx.studio||!editor.ctx.studio.room||editor.ctx.studio.room.role==='host');
  const command=(action,value)=>{try{if(!authority())throw Error('Las asignaciones de la sesión se modifican desde el equipo anfitrión en modo Probar.');if(editor.simulation.command(objectId,action,value)===false)throw Error('La ubicación o el pallet no están disponibles para esta asignación.');paint();}catch(error){notify(error.message||String(error));}};
  const assign=attribute(node(doc,'button','Asignar carga al destino',actions),'data-rack-action','assign');assign.type='button';assign.addEventListener('click',()=>command('assignLocation',{locationCode:select.value,palletId:pallet.value}));
  const clear=attribute(node(doc,'button','Liberar reserva',actions),'data-rack-action','clear');clear.type='button';clear.addEventListener('click',()=>command('clearLocationAssignment',select.value));
  function paint(){
    simulation=editor.simulation;runtime=simulation.palletQueueRuntime;record=simulation.records.get(objectId);
    if(!record||!record.components.palletQueue||!record.components.palletQueue.rack){root.hidden=true;assign.disabled=true;clear.disabled=true;return;}root.hidden=false;
    const locations=runtime.locations(record), signature=locations.map(cell=>cell.code).join('|');
    if(signature!==locationSignature){
      const previous=select.value;select.textContent='';table.textContent='';rows.clear();
      locations.forEach(cell=>{
        const option=node(doc,'option',cell.code,select);option.value=cell.code;
        const row=attribute(node(doc,'div',undefined,table,'rack-location-row'),'data-rack-location-code',cell.code);attribute(row,'data-rack-slot',cell.index);
        node(doc,'code',cell.code,row);const text=node(doc,'output','',row);rows.set(cell.code,{row,text});
      });select.value=locations.some(cell=>cell.code===previous)?previous:locations[record.components.palletQueue.rackSelectedSlot||0].code;locationSignature=signature;
    }
    const products=new Map();
    simulation.products.forEach(product=>{const id=runtime.palletIdentity(product);if(id)products.set(id,product.object&&product.object.name||'Pallet');});
    const ids=[...products.keys()].sort(), productKey=ids.join('|');
    if(productKey!==productSignature||!pallet.children.length){const previous=pallet.value;pallet.textContent='';const first=node(doc,'option','Selecciona un pallet de la operación',pallet);first.value='';ids.forEach(id=>{const option=node(doc,'option',id+' · '+products.get(id),pallet);option.value=id;});if(ids.includes(previous))pallet.value=previous;productSignature=productKey;}
    locations.forEach(cell=>{const view=rows.get(cell.code);view.text.textContent=cell.palletId?'Ocupada · '+cell.palletId:cell.assignedPalletId?'Reservada · '+cell.assignedPalletId:'Disponible';attribute(view.row,'data-rack-status',cell.status);});
    assign.disabled=!authority()||!pallet.value;clear.disabled=!authority()||!(record.components.palletQueue.rack.assignments||[]).some(row=>row.locationCode===select.value);
  }
  pallet.addEventListener('change',paint); select.addEventListener('change',()=>{const sim=editor.simulation,live=sim.records.get(objectId);if(!live||!live.components.palletQueue||!live.components.palletQueue.rack)return paint();const cell=sim.palletQueueRuntime.locations(live).find(cell=>cell.code===select.value);if(cell){sim.setVariable(objectId,'rackSelectedSlot',cell.index);const id=cell.assignedPalletId||cell.palletId;if(id&&Array.from(pallet.children).some(option=>option.value===id))pallet.value=id;}paint();});
  node(doc,'p','El pallet conserva su ID al cargar o descargar. El inventario y la etiqueta distinguen ubicación actual y destino reservado. Menú → Sesiones → Guardar ejecución actual conserva esta operación; guardar analítica no sustituye ese estado.',root,'ed-hint');paint();
  return {root,update:paint};
}

module.exports={renderPlan,renderRuntime,remapPlan};
