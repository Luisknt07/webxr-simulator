import * as THREE from 'three';
import behaviorSchema from '../../../contracts/behaviors.js';

function visible(object) { for (let node = object; node; node = node.parent) if (!node.visible) return false; return true; }

/** A physical, independent pallet store. It receives existing loads only. */
export default class PalletQueueRuntime {
  constructor(runtime) { this.runtime = runtime; this.sequence = 0; this.identificationLabels = new Map(); this.nextIdentificationAt = 0; }

  attach(record, component) {
    const config = behaviorSchema.palletQueues.settings(component.config), helper = new THREE.Group(); component.config = config;
    helper.name = 'Cargas de la estiba'; helper.userData.editorRuntimeHelper = true; record.object.add(helper);
    const layout = behaviorSchema.conveyorLayout.palletQueueLayout(config);
    Object.assign(component, {ownerId: record.id, enabled: true, running: config.running, paused: config.paused, outputInterval: config.outputInterval,
      outputElapsed: config.outputInterval, releaseElapsed: 0, dispatchedPallets: 0, queue: [], items: [], received: 0, receivedUnits: 0, blocked: false, retryAt: 0, helper});
    component.pallets = (layout.pallets || [{index: 0, position: [0, -1, 0]}]).map(bay => {
      const marker = new THREE.Group(); marker.name = 'Posición de pallet ' + (bay.index + 1);
      marker.userData.editorRuntimeHelper = true; marker.position.fromArray(bay.position); helper.add(marker);
      return {object: marker, config: Object.assign({}, config, {top: config.palletHeight, fitMargin: 0}), items: [], full: false};
    });
    component.pallet = component.pallets[0];
    component.inventory = {queue: component.queue, helper, config, enabled: true, running: config.running, paused: config.paused,
      delivered: 0, deliveredUnits: 0, blocked: false, transferBlocked: false};
    record.writable.push({key: 'enabled', type: 'boolean', label: 'Habilitado'}, {key: 'running', type: 'boolean', label: 'En marcha'},
      {key: 'paused', type: 'boolean', label: 'En pausa'}, {key: 'outputInterval', type: 'number', label: 'Intervalo de salida (s)', min: .1, max: 120});
    if (layout.rack) this.attachRack(record, component, layout);
  }

  attachRack(record, component, layout) {
    const config = component.config, banks = [], carts=[]; let carriage = null;
    record.object.traverse(node => {if (Number.isInteger(node.userData.warehouseRackBank)) banks[node.userData.warehouseRackBank] = node; if (['vertical-lift','miniload'].includes(config.rackSystem)&&node.userData.warehouseRackMovingGeometry === config.rackSystem) carriage = node;if(node.userData.warehouseRackMovingGeometry==='push-back'&&Number.isInteger(node.userData.warehouseRackCell))carts[node.userData.warehouseRackCell]=node;});
    component.rackSelectedSlot = config.rackSelectedSlot || 0; component.rackOpenAisle = config.rackOpenAisle || 0; component.rackMechanismSpeed = config.rackMechanismSpeed || .25;
    component.rack = {system: config.rackSystem, layout, definition: layout.definition, banks, carriage,
      homes: banks.map(node => node.position.clone()), carriageHome: carriage && carriage.position.clone(), openAisle: component.rackOpenAisle,
      jobs: [], mobile: null, presentedSlot: null, preparedLane:null, carts, cartHomes:carts.map(cart=>cart.position.clone()), cartMotion:null,
      assignments: behaviorSchema.warehouseRacks.assignments(config).map(row=>Object.assign({},row)), status: 'Disponible', blocked: false};
    record.writable.push({key:'rackSelectedSlot',type:'number',label:'Posición solicitada',min:0,max:layout.cells.length-1},
      {key:'rackOpenAisle',type:'number',label:'Pasillo solicitado',min:0,max:Math.max(0, config.rackBanks-1)},
      {key:'rackMechanismSpeed',type:'number',label:'Velocidad de estantería',min:.05,max:1});
  }

  rackCell(component, index) { return component.rack.layout.cells[index]; }
  rackBusy(component) { return !!(component.rack && (component.rack.jobs.length || component.rack.mobile || component.rack.cartMotion)); }
  rackLocked(component) { return component.items.some(item => {const p=item.product;return p.heldBy||p.robotOwnerId||p.robotReservedBy||p.vehicleOwnerId||p.vehicleReservedBy;}); }
  rackAutomatic(component) { return component.rack && ['lift','miniload'].includes(component.rack.definition.mechanism); }
  rackMass(item) { return Math.max(0, Number(this.runtime.productMetadata(item.product).mass) || 0); }

  /** A load ID is independent of its SKU and of every storage address. */
  palletIdentity(product) {
    if (!product || !product.object) return '';
    const data=product.object.userData;
    // Once assigned, a generated load keeps that unit ID even when a later
    // belt/manual handoff creates its first inventory-custody entry.
    const id=product.record&&product.record.id || data.sourcePalletId || product.sourceEntry&&product.sourceEntry.id || data.sourceProductId || 'load:'+product.object.uuid;
    if (!behaviorSchema.warehouseRacks.palletIdentifier(id)) throw new Error('El identificador de pallet no es válido.');
    return id;
  }

  plannedLocation(palletId) {
    let found=null;
    this.runtime.records.forEach(record=>{
      const c=record.components.palletQueue;
      if(!c||!c.rack)return;
      for(const row of c.rack.assignments||[])if(row.palletId===palletId) {
        if(found)throw new Error('Un pallet tiene más de una ubicación reservada. Libera la asignación duplicada.');
        found={record,locationCode:row.locationCode,palletId};
      }
    });
    return found;
  }

  locations(record) {
    const c=record&&record.components.palletQueue;if(!c||!c.rack)return [];
    const assigned=new Map((c.rack.assignments||[]).map(row=>[row.locationCode,row.palletId]));
    return c.rack.layout.cells.map(cell=>{
      const item=c.items.find(item=>item.palletIndex===cell.index),palletId=item?this.palletIdentity(item.product):'';
      return {index:cell.index,code:cell.code,aisleCode:cell.aisleCode,rowCode:cell.rowCode,bank:cell.bank,bay:cell.bay,level:cell.level,column:cell.column,depthIndex:cell.depthIndex,
        status:palletId?'occupied':assigned.has(cell.code)?'reserved':'free',palletId,assignedPalletId:assigned.get(cell.code)||palletId,
        capacityKg:cell.capacityKg,width:cell.width,depth:cell.depth,clearHeight:cell.clearHeight};
    });
  }

  assignLocation(record, value) {
    const c=record&&record.components.palletQueue;if(!c||!c.rack)throw new Error('Selecciona una estantería.');
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Selecciona una ubicación y un pallet.');
    const row=behaviorSchema.warehouseRacks.assignmentRows(JSON.stringify([{locationCode:value.locationCode,palletId:value.palletId}]))[0],cell=c.rack.layout.cells.find(cell=>cell.code===row.locationCode);
    if(!cell)throw new Error('La ubicación no existe en esta estantería.');
    const occupant=c.items.find(item=>item.palletIndex===cell.index);
    if(occupant&&this.palletIdentity(occupant.product)!==row.palletId)throw new Error('La ubicación está ocupada por otro pallet.');
    const product=Array.from(this.runtime.products.values()).find(product=>this.palletIdentity(product)===row.palletId);
    if(product){
      const metadata=this.runtime.productMetadata(product),pallet=metadata.loadMode==='pallet'||metadata.productType==='pallet',size=product.bounds.getSize(new THREE.Vector3()).multiply(product.scale);
      if(c.rack.definition.acceptedLoad==='pallet'&&!pallet||c.rack.definition.acceptedLoad==='individual'&&pallet)throw new Error('Este tipo de carga no es compatible con la estantería.');
      if(Math.abs(size.x)>cell.width+.001||Math.abs(size.z)>cell.depth+.001||Math.abs(size.y)>cell.clearHeight+.001||Number(metadata.mass)>cell.capacityKg+.001)throw new Error('La carga no cabe o supera la capacidad de esta ubicación.');
    }
    this.runtime.records.forEach(other=>{
      const store=other.components.palletQueue;if(other===record||!store||!store.rack)return;
      if(store.rack.layout.cells.some(candidate=>candidate.code===cell.code))throw new Error('El código de ubicación se repite en otra estantería. Cambia su pasillo o fila.');
      if((store.rack.assignments||[]).some(candidate=>candidate.palletId===row.palletId))throw new Error('Este pallet ya tiene una ubicación reservada en otra estantería. Libérala primero.');
    });
    const current=(c.rack.assignments||[]).find(candidate=>candidate.locationCode===cell.code);
    if(current&&current.palletId!==row.palletId)throw new Error('La ubicación está reservada para otro pallet.');
    c.rack.assignments=(c.rack.assignments||[]).filter(candidate=>candidate.palletId!==row.palletId&&candidate.locationCode!==cell.code);
    if(!occupant)c.rack.assignments.push(row);
    c.rack.status=occupant?'Pallet confirmado en '+cell.code:'Ubicación reservada: '+cell.code;
    this.syncIdentification(true);return true;
  }

  clearLocationAssignment(record, locationCode) {
    const c=record&&record.components.palletQueue;if(!c||!c.rack)return false;
    if(typeof locationCode!=='string'||!c.rack.layout.cells.some(cell=>cell.code===locationCode))throw new Error('La ubicación no existe en esta estantería.');
    const previous=(c.rack.assignments||[]).length;
    c.rack.assignments=(c.rack.assignments||[]).filter(row=>row.locationCode!==locationCode);
    if(previous===c.rack.assignments.length)return false;
    c.rack.status='Reserva liberada: '+locationCode;this.syncIdentification(true);return true;
  }

  assignmentAllows(record, product, cell) {
    const c=record.components.palletQueue,palletId=this.palletIdentity(product),plan=this.plannedLocation(palletId);
    if(plan&&(plan.record!==record||plan.locationCode!==cell.code))return false;
    return !(c.rack.assignments||[]).some(row=>row.locationCode===cell.code&&row.palletId!==palletId);
  }

  identifyStored(record,item) {
    const cell=this.rackCell(record.components.palletQueue,item.palletIndex);if(!cell)return;
    Object.assign(item.product.object.userData,{sourcePalletId:this.palletIdentity(item.product),sourceRackLocationCode:cell.code,sourceRackLocationOwner:record.id});
  }

  syncIdentification(force=false) {
    const now=this.runtime.time||0;if(!force&&now<this.nextIdentificationAt)return;this.nextIdentificationAt=now+.25;
    const products=Array.from(this.runtime.products.values()),active=new Set(products.map(product=>product.object));
    const visual=behaviorSchema.warehouseRackVisual;
    const release=state=>{if(state.root.parent)state.root.parent.remove(state.root);if(visual&&visual.disposeVisual)visual.disposeVisual(state.root);};
    this.identificationLabels.forEach((state,object)=>{if(!active.has(object)){release(state);this.identificationLabels.delete(object);}});
    const plans=new Map();this.runtime.records.forEach(record=>{const c=record.components.palletQueue;if(c&&c.rack)(c.rack.assignments||[]).forEach(row=>plans.set(row.palletId,row.locationCode));});
    products.forEach(product=>{
      const data=product.object.userData,id=this.palletIdentity(product),destination=plans.get(id)||'';
      if(!data.sourcePalletId&&!data.sourceRackLocationCode&&!destination&&!data.sourceRackLastLocationCode)return;
      data.sourcePalletId=id;data.sourceRackDestinationCode=destination;
      const location=destination||data.sourceRackLocationCode||data.sourceRackLastLocationCode,
        caption=location?(destination?'A ':data.sourceRackLocationCode?'EN ':'DE ')+location:'SIN UBICACION',key=id+'|'+caption,old=this.identificationLabels.get(product.object);
      if(old&&old.key===key)return;if(old){release(old);this.identificationLabels.delete(product.object);}
      if(!visual||!visual.createLocationLabel)return;
      const size=product.bounds.getSize(new THREE.Vector3());
      let pockets=data.forkPockets||data.sourceProduct&&data.sourceProduct.forkPockets,anchors=data.palletIdentificationAnchors;
      // Authored actors wrap their prefab in an editor-owned group. Source
      // cargo stores these presentation metrics on its root; both paths must
      // place the plate above the same physical pallet entries.
      if(!pockets||!anchors)product.object.traverse(node=>{if(!pockets&&node.userData.forkPockets)pockets=node.userData.forkPockets;if(!anchors&&node.userData.palletIdentificationAnchors)anchors=node.userData.palletIdentificationAnchors;});
      const top=pockets&&Number.isFinite(pockets.maxY)?pockets.maxY:pockets&&Number.isFinite(pockets.top)?pockets.top:0;
      const baseHeight=top>0?top/.74:0,loaded=size.y>baseHeight+.08;
      const face=loaded&&(anchors||[]).filter(anchor=>['centerX','frontZ','minY','maxY','width'].every(key=>Number.isFinite(anchor[key]))&&anchor.width>.05&&anchor.maxY-anchor.minY>.05)
        .sort((a,b)=>b.frontZ-a.frontZ||b.width-a.width||a.minY-b.minY)[0];
      const width=Math.min(1.08,Math.max(.12,(face?face.width:size.x)*.88));
      // The old two-row plate crossed the fork pockets at y=.12. Loaded cargo
      // carries its tag above the complete pallet deck; an empty pallet uses
      // the narrow solid deck edge, never a placard across an entry opening.
      const safeBottom=face?face.minY+.018:product.bounds.min.y+(loaded?baseHeight+.018:top+.002);
      const safeTop=face?face.maxY-.012:loaded?product.bounds.max.y-.012:product.bounds.min.y+baseHeight-.002;
      const height=Math.min(.07,Math.max(.006,(safeTop-safeBottom)/2.2));
      const centerY=safeBottom+height*1.05;
      let faceZ=face?face.frontZ:product.bounds.max.z;
      if(loaded&&!face){
        product.object.updateWorldMatrix(true,true);
        const inverse=new THREE.Matrix4().getInverse(product.object.matrixWorld);let front=-Infinity;
        product.object.traverse(mesh=>{
          if(!mesh.isMesh||!mesh.geometry||mesh.userData.editorRuntimeHelper)return;
          if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();if(!mesh.geometry.boundingBox)return;
          const box=mesh.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,mesh.matrixWorld));
          if(box.max.y>product.bounds.min.y+baseHeight+.04&&box.min.y<safeTop)front=Math.max(front,box.max.z);
        });
        if(Number.isFinite(front))faceZ=front;
      }
      const root=new THREE.Group();root.name='Identificación física del pallet';root.userData.editorRuntimeHelper=true;root.userData.editorCollisionDisabled=true;
      root.userData.palletIdentificationAboveEntries=true;
      const first=visual.createLocationLabel(THREE,id,{width,height}),second=visual.createLocationLabel(THREE,caption,{width,height});
      first.position.y=height*.55;second.position.y=-height*.55;root.add(first,second);
      root.position.set(face?face.centerX:(product.bounds.min.x+product.bounds.max.x)/2,centerY,faceZ+.005);product.object.add(root);
      this.identificationLabels.set(product.object,{key,root});
    });
  }

  removeIdentification(object) {
    const state=this.identificationLabels.get(object);if(!state)return;
    if(state.root.parent)state.root.parent.remove(state.root);
    if(behaviorSchema.warehouseRackVisual&&behaviorSchema.warehouseRackVisual.disposeVisual)behaviorSchema.warehouseRackVisual.disposeVisual(state.root);
    this.identificationLabels.delete(object);
  }

  rackMatrix(record, product, point) {
    record.object.updateWorldMatrix(true, false);
    const rotation=record.object.getWorldQuaternion(new THREE.Quaternion()), center=product.bounds.getCenter(new THREE.Vector3()).multiply(product.scale);
    const offset=new THREE.Vector3(-center.x,.005-Math.min(product.bounds.min.y*product.scale.y,product.bounds.max.y*product.scale.y),-center.z);
    const position=record.object.localToWorld(new THREE.Vector3().fromArray(point)).add(offset.applyQuaternion(rotation));
    return new THREE.Matrix4().compose(position,rotation,product.scale);
  }

  rackPoint(component, cell) {
    const point=cell.position.slice();
    if(component.rack.definition.mechanism==='mobile') {
      const base=cell.closedPosition, bank=component.rack.banks[cell.bank];
      if(bank)return [base[0]+bank.position.x,base[1]+bank.position.y,base[2]+bank.position.z];
    }
    return point;
  }

  rackCanPickup(component,item) {
    if(!item||this.rackBusy(component)||component.paused||component.emergency||component.powered===false)return false;
    const state=component.rack,cell=this.rackCell(component,item.palletIndex);if(!cell)return false;
    if(this.rackAutomatic(component))return state.presentedSlot===cell.index;
    if(['gravity','push-back'].includes(state.definition.mechanism)&&cell.depthIndex!==0)return false;
    if(state.definition.mechanism==='mobile'&&cell.bank!==state.openAisle)return false;
    const lane=component.items.filter(other=>other!==item&&this.rackCell(component,other.palletIndex).lane===cell.lane);
    if(state.system==='drive-through')return !lane.some(other=>this.rackCell(component,other.palletIndex).depthIndex>cell.depthIndex);
    if(['lifo','fifo'].includes(state.definition.policy))return !lane.some(other=>this.rackCell(component,other.palletIndex).depthIndex<cell.depthIndex);
    return true;
  }

  rackAccess(record,product,actor,outgoing=true,targetIndex) {
    const component=record && record.components.palletQueue;if(!component||!component.rack)return true;
    const item=product.item,cell=this.rackCell(component,Number.isInteger(targetIndex)?targetIndex:item&&item.palletIndex);
    if(outgoing&&!this.rackCanPickup(component,item))return false;
    if(!actor||!cell)return true;
    record.object.updateWorldMatrix(true,false);actor.object.updateWorldMatrix(true,false);
    const local=record.object.worldToLocal(actor.object.getWorldPosition(new THREE.Vector3())),face=outgoing?cell.pickFace:cell.loadFace;
    if(face==='front'&&local.z<cell.position[2]-.05||face==='rear'&&local.z>cell.position[2]+.05)return false;
    if(component.rack.system==='double-deep'&&cell.depthIndex>0) {
      const v=actor.components.vehicle,c=v&&v.config;if(!v||c.forkLength+(Number(v.pose.reach)||0)+.05<cell.requiredReachM)return false;
    }
    return true;
  }

  rackPlacement(record,product,reservations=[],preferredCenter,receivingIgnore,connectionOnly=false) {
    const component=record.components.palletQueue,state=component.rack,definition=state.definition;
    if(this.rackBusy(component)||component.paused||component.emergency||component.powered===false||state.presentedSlot!==null)return null;
    const metadata=this.runtime.productMetadata(product),pallet=metadata.loadMode==='pallet'||metadata.productType==='pallet';
    if(definition.acceptedLoad==='pallet'&&!pallet||definition.acceptedLoad==='individual'&&pallet)return null;
    const item=this.itemFor(product),physical=item.bounds.getSize(new THREE.Vector3()).multiply(item.scale),mass=Math.max(0,Number(metadata.mass)||0);
    const occupied=new Set(component.items.map(value=>value.palletIndex));reservations.forEach(value=>occupied.add(value.palletIndex));
    const palletId=this.palletIdentity(product),plan=this.plannedLocation(palletId),assigned=new Map((state.assignments||[]).map(row=>[row.locationCode,row.palletId]));
    let cells=state.layout.cells.filter(cell=>!occupied.has(cell.index)&&(!plan||plan.record===record&&plan.locationCode===cell.code)&&(!assigned.has(cell.code)||assigned.get(cell.code)===palletId));
    if(connectionOnly&&!this.rackAutomatic(component))cells=cells.filter(cell=>this.rackAtPort(component,cell,false));
    if(definition.mechanism==='mobile')cells=cells.filter(cell=>cell.bank===state.openAisle);
    if(['lifo','fifo'].includes(definition.policy))cells=cells.filter(cell=>{
      if(definition.mechanism==='gravity')return cell.depthIndex===component.config.rackDepthSlots-1;
      if(definition.mechanism==='push-back')return cell.depthIndex===0;
      return !component.items.some(value=>{const other=this.rackCell(component,value.palletIndex);return other.lane===cell.lane&&other.depthIndex<cell.depthIndex;})&&!reservations.some(value=>{const other=this.rackCell(component,value.palletIndex);return other&&other.lane===cell.lane&&other.depthIndex<cell.depthIndex;});
    });
    cells.sort((a,b)=>a.bank-b.bank||a.bay-b.bay||a.level-b.level||a.column-b.column||b.depthIndex-a.depthIndex);
    let best=null;
    for(const cell of cells) {
      if(definition.mechanism==='push-back'&&state.carts.length&&this.rackAvailableCart(component,cell)<0)continue;
      if(Math.abs(physical.x)>cell.width+.001||Math.abs(physical.z)>cell.depth+.001||Math.abs(physical.y)>cell.clearHeight+.001||mass>cell.capacityKg+.001)continue;
      const levelMass=component.items.filter(value=>{const other=this.rackCell(component,value.palletIndex);return other.bank===cell.bank&&other.bay===cell.bay&&other.level===cell.level;}).reduce((sum,value)=>sum+this.rackMass(value),0);
      const reservedMass=reservations.filter(value=>{const other=this.rackCell(component,value.palletIndex);return other&&other.bank===cell.bank&&other.bay===cell.bay&&other.level===cell.level;}).reduce((sum,value)=>sum+(value.mass||0),0);
      if(levelMass+reservedMass+mass>cell.levelCapacityKg+.001)continue;
      if(component.config.rackSkuPolicy==='lane'&&component.items.some(value=>this.rackCell(component,value.palletIndex).lane===cell.lane&&this.runtime.productMetadata(value.product).sku!==metadata.sku))continue;
      const point=this.rackAutomatic(component)?state.layout.accessPosition:this.rackPoint(component,cell),matrix=this.rackMatrix(record,product,point),box=product.bounds.clone().applyMatrix4(matrix),world=this.runtime.ctx.collisionWorld;
      const options=this.collisionOptions(record,item,reservations);if(typeof receivingIgnore==='function')options.ignore.push(...receivingIgnore(matrix));
      if(world&&world.testBox(box,options))continue;
      const candidate={slot:0,globalSlot:cell.index,palletIndex:cell.index,locationCode:cell.code,palletId,matrix,bounds:box,box,height:Math.abs(physical.y),mass,rackStorageCell:cell.index};
      if(!preferredCenter)return candidate;
      const distance=preferredCenter.distanceTo(box.getCenter(new THREE.Vector3()));if(!best||distance<best.distance)best=Object.assign(candidate,{distance});
    }
    return best;
  }

  rackPath(record,item,cell,retrieve) {
    const state=record.components.palletQueue.rack,access=state.layout.accessPosition,shaft=state.layout.shaftPosition,storage=this.rackPoint(record.components.palletQueue,cell);
    const route=retrieve?[storage,[storage[0],storage[1],shaft[1]],[0,storage[1],shaft[1]],[0,access[1],shaft[1]],access]:
      [access,[0,access[1],shaft[1]],[0,storage[1],shaft[1]],[storage[0],storage[1],shaft[1]],storage];
    return route.map(point=>this.rackMatrix(record,item.product,point));
  }

  rackQueueMove(record,item,cell,kind,path) {
    const state=record.components.palletQueue.rack;
    if(state.jobs.some(job=>job.item===item))return false;
    state.jobs.push({item,targetIndex:cell.index,kind,path:path||[this.rackMatrix(record,item.product,this.rackPoint(record.components.palletQueue,cell))]});
    state.blocked=false;state.status=kind==='retrieve'?'Presentando carga en ventanilla':kind==='store'?'Guardando carga en su posición':'Desplazando cargas';return true;
  }

  rackAfterReceive(record,item) {
    const component=record.components.palletQueue;if(!component.rack)return;
    const state=component.rack,cell=this.rackCell(component,item.palletIndex);if(state.preparedLane===cell.lane)state.preparedLane=null;
    const palletId=this.palletIdentity(item.product);
    state.assignments=(state.assignments||[]).filter(row=>row.palletId!==palletId);
    this.identifyStored(record,item);this.syncIdentification(true);
    if(state.definition.mechanism==='push-back'&&state.carts.length){item.rackCartIndex=this.rackAvailableCart(component,cell,item);this.rackSyncVisual(record);}
    if(this.rackAutomatic(component))this.rackQueueMove(record,item,this.rackCell(component,item.palletIndex),'store',this.rackPath(record,item,this.rackCell(component,item.palletIndex),false));
  }

  rackRetarget(component,item,index) {
    component.pallets[item.palletIndex].items=component.pallets[item.palletIndex].items.filter(value=>value!==item);
    item.palletIndex=index;item.palletSlot=0;component.pallets[index].items.push(item);
    component.pallets.forEach(pallet=>{pallet.full=!!pallet.items.length;});
    const record=this.runtime.records.get(component.ownerId);if(record)this.identifyStored(record,item);
  }

  rackRequestRetrieval(record,index) {
    const component=record.components.palletQueue,state=component.rack;
    if(!state||!this.rackAutomatic(component)||this.rackBusy(component)||this.rackLocked(component)||!this.operational(component))return false;
    const selected=Number.isInteger(index)&&index>=0?index:component.rackSelectedSlot,item=component.items.find(value=>value.palletIndex===selected);
    if(!item||state.presentedSlot!==null)return state.presentedSlot===selected;
    return this.rackQueueMove(record,item,this.rackCell(component,selected),'retrieve',this.rackPath(record,item,this.rackCell(component,selected),true));
  }

  rackPrepareInput(record) {
    const component=record.components.palletQueue,state=component.rack;
    if(!state||state.definition.mechanism!=='push-back'||this.rackBusy(component)||this.rackLocked(component)||!this.operational(component))return false;
    const byLane=new Map();state.layout.cells.forEach(cell=>{if(!byLane.has(cell.lane))byLane.set(cell.lane,[]);byLane.get(cell.lane).push(cell);});
    for(const cells of byLane.values()) {
      const items=component.items.filter(item=>cells.some(cell=>cell.index===item.palletIndex));if(!items.length||!items.some(item=>this.rackCell(component,item.palletIndex).depthIndex===0))continue;
      if(items.some(item=>this.rackCell(component,item.palletIndex).depthIndex>=component.config.rackDepthSlots-1))continue;
      state.preparedLane=cells[0].lane;items.sort((a,b)=>this.rackCell(component,b.palletIndex).depthIndex-this.rackCell(component,a.palletIndex).depthIndex).forEach(item=>{
        const depth=this.rackCell(component,item.palletIndex).depthIndex+1,target=cells.find(cell=>cell.depthIndex===depth);this.rackQueueMove(record,item,target,'move');
      });return !!state.jobs.length;
    }
    return false;
  }

  rackUserBox() {
    const ctx=this.runtime.ctx;if(!ctx.vrMode&&!(ctx.desktopLook&&ctx.desktopLook.isLocked))return null;
    let camera=ctx.camera;if(ctx.vrMode&&ctx.renderer&&ctx.renderer.xr&&ctx.renderer.xr.getCamera)camera=ctx.renderer.xr.getCamera(camera);
    if(!camera||!camera.getWorldPosition)return null;camera.updateWorldMatrix(true,false);const p=camera.getWorldPosition(new THREE.Vector3());
    return new THREE.Box3(new THREE.Vector3(p.x-.3,p.y-1.65,p.z-.3),new THREE.Vector3(p.x+.3,p.y+.15,p.z+.3));
  }

  rackAtPort(component,cell,outgoing) {
    const state=component.rack,port=outgoing?state.layout.output:state.layout.input,face=outgoing?cell.pickFace:cell.loadFace;
    if(state.definition.mechanism==='mobile'&&state.openAisle!==component.config.rackOpenAisle)return false;
    if(Number.isInteger(port.seatIndex))return cell.index===port.seatIndex;
    const depth=face==='rear'?component.config.rackDepthSlots-1:0;
    return cell.depthIndex===depth&&Math.abs(cell.position[0]-port.x)<.05&&Math.abs(cell.position[1]-port.y)<.05;
  }

  rackSyncVisual(record) {let rig=record.object.userData.warehouseRackRig;if(!rig)record.object.traverse(node=>{if(!rig&&node.userData.warehouseRackRig)rig=node.userData.warehouseRackRig;});if(rig&&rig.syncMotion)rig.syncMotion();this.runtime.invalidateCollision(record.object);}

  rackAvailableCart(component,cell,excluded) {
    const used=new Set(component.items.filter(item=>item!==excluded).map(item=>item.rackCartIndex)),point=new THREE.Vector3().fromArray(this.rackPoint(component,cell));
    return component.rack.carts.findIndex((cart,index)=>cart&&this.rackCell(component,index).lane===cell.lane&&!used.has(index)&&cart.position.distanceTo(point)<.012);
  }

  rackAdvanceCart(record,delta) {
    const component=record.components.palletQueue,state=component.rack,motion=state.cartMotion;if(!motion)return false;
    if(this.rackLocked(component)){state.blocked=true;state.status='Carro retenido por carga agarrada o reservada';return true;}
    const cart=state.carts[motion.index],cell=this.rackCell(component,motion.index),offset=motion.path[0].clone().sub(cart.position),amount=component.rackMechanismSpeed*delta;
    if(offset.length()>amount)offset.setLength(amount);cart.updateWorldMatrix(true,false);
    const box=new THREE.Box3(new THREE.Vector3(-cell.width*.45,-.09,-cell.depth*.46),new THREE.Vector3(cell.width*.45,0,cell.depth*.46)).applyMatrix4(cart.matrixWorld),worldOffset=offset.clone().transformDirection(record.object.matrixWorld).multiplyScalar(offset.length()),next=box.clone().translate(worldOffset),world=this.runtime.ctx.collisionWorld,user=this.rackUserBox(),options=this.runtime.packageCollisionOptions(record,null);
    if(user&&box.clone().union(next).intersectsBox(user)||world&&(world.sweepBox(box,worldOffset,options).blocked||world.testBox(next,options))){state.blocked=true;state.status='Carro detenido por obstáculo';return true;}
    cart.position.add(offset);cart.updateWorldMatrix(true,true);this.rackSyncVisual(record);state.blocked=false;
    if(cart.position.distanceTo(motion.path[0])<1e-6){motion.path.shift();if(!motion.path.length){state.cartMotion=null;state.status='Entrada preparada';}}return true;
  }

  captureRackPose(record) {
    const component=record.components.palletQueue,state=component&&component.rack;if(!state)return;
    state.visualPose={banks:state.banks.map(node=>node.position.toArray()),carriage:state.carriage?state.carriage.position.toArray():null,carts:state.carts.map(node=>node.position.toArray())};
  }

  restoreRackPose(record) {
    const component=record.components.palletQueue,state=component&&component.rack,pose=state&&state.visualPose;if(!pose)return;
    const valid=value=>Array.isArray(value)&&value.length===3&&value.every(n=>Number.isFinite(n)&&Math.abs(n)<=10000);
    if(!Array.isArray(pose.banks)||pose.banks.length!==state.banks.length||!Array.isArray(pose.carts)||pose.carts.length!==state.carts.length||pose.banks.some(p=>!valid(p))||pose.carts.some(p=>!valid(p))||pose.carriage!==null&&!valid(pose.carriage))throw new Error('La posición del mecanismo de estantería no es válida.');
    state.banks.forEach((node,index)=>node.position.fromArray(pose.banks[index]));state.carts.forEach((node,index)=>node.position.fromArray(pose.carts[index]));if(state.carriage&&pose.carriage)state.carriage.position.fromArray(pose.carriage);
    const assignments=behaviorSchema.warehouseRacks.assignmentRows(JSON.stringify(state.assignments||behaviorSchema.warehouseRacks.assignments(component.config)));
    if(assignments.some(row=>!state.layout.cells.some(cell=>cell.code===row.locationCode)))throw new Error('Una reserva de estantería apunta a una ubicación inexistente.');
    state.assignments=assignments;assignments.forEach(row=>this.plannedLocation(row.palletId));
    component.items.forEach(item=>this.identifyStored(record,item));
    component.pallets.forEach((pallet,index)=>pallet.object.position.fromArray(this.rackPoint(component,this.rackCell(component,index))));record.object.updateWorldMatrix(true,true);this.rackSyncVisual(record);this.syncIdentification(true);
  }

  rackSupportProposal(record,item,matrix,limit) {
    const component=record.components.palletQueue,state=component.rack;if(!['gravity','push-back'].includes(state.definition.mechanism))return matrix;
    const inverse=new THREE.Matrix4().getInverse(record.object.matrixWorld),local=item.bounds.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,matrix)),cell=this.rackCell(component,item.palletIndex);
    let height=-Infinity;
    state.layout.cells.filter(other=>other.lane===cell.lane).forEach(other=>{
      if(local.max.x<other.position[0]-other.width/2||local.min.x>other.position[0]+other.width/2)return;
      const supports=state.definition.mechanism==='gravity'?[-.36,0,.36].map(f=>({z:other.position[2]+other.depth*f,r:.035})): [{z:other.position[2],r:other.depth/2}];
      if(supports.some(p=>local.max.z>p.z-p.r&&local.min.z<p.z+p.r))height=Math.max(height,other.position[1]+.005);
    });
    if(height<=local.min.y+1e-8)return matrix;
    const zero=record.object.getWorldPosition(new THREE.Vector3()),lift=record.object.localToWorld(new THREE.Vector3(0,height-local.min.y,0)).sub(zero),current=new THREE.Vector3().setFromMatrixPosition(item.product.object.matrixWorld),target=new THREE.Vector3().setFromMatrixPosition(matrix).add(lift);
    if(target.distanceTo(current)>limit+1e-8){const vertical=lift.clone().normalize().multiplyScalar(Math.min(limit,lift.length()));matrix=item.product.object.matrixWorld.clone();matrix.setPosition(current.add(vertical));}
    else matrix.setPosition(target);
    return matrix;
  }

  rackAdvanceJobs(record,delta) {
    const component=record.components.palletQueue,state=component.rack;if(!state.jobs.length)return false;
    if(this.rackLocked(component)){state.blocked=true;state.status='Mecanismo retenido por carga agarrada o reservada';return true;}
    const distance=Math.max(.05,Math.min(1,component.rackMechanismSpeed))*delta,proposals=[];
    state.jobs.forEach(job=>{
      const p=job.item.product;p.object.updateWorldMatrix(true,true);const current=p.object.matrixWorld.clone(),position=new THREE.Vector3().setFromMatrixPosition(current),target=new THREE.Vector3().setFromMatrixPosition(job.path[0]),offset=target.clone().sub(position),remaining=offset.length();
      if(remaining>distance)offset.multiplyScalar(distance/remaining);let next=current.clone();next.setPosition(position.add(offset));next=this.rackSupportProposal(record,job.item,next,distance);const actual=new THREE.Vector3().setFromMatrixPosition(next).sub(new THREE.Vector3().setFromMatrixPosition(current));
      proposals.push({job,product:p,matrix:next,box:p.bounds.clone().applyMatrix4(next),movement:actual,arrived:new THREE.Vector3().setFromMatrixPosition(next).distanceTo(target)<=1e-7});
    });
    const moving=new Set(state.jobs.map(job=>job.item)),world=this.runtime.ctx.collisionWorld,user=this.rackUserBox();
    for(const proposal of proposals) {
      const options=this.collisionOptions(record,proposal.job.item);options.extraBoxes=options.extraBoxes.filter(box=>!Array.from(moving).some(item=>item.box===box));
      if(state.carriage)options.ignore.push(state.carriage);
      if(user&&proposal.box.intersectsBox(user)||world&&(world.sweepBox(proposal.job.item.box,proposal.movement,options).blocked||world.testBox(proposal.box,options))) {state.blocked=true;state.status='Mecanismo detenido por obstáculo';return true;}
    }
    for(let a=0;a<proposals.length;a++)for(let b=a+1;b<proposals.length;b++)if(proposals[a].box.clone().expandByScalar(-.001).intersectsBox(proposals[b].box.clone().expandByScalar(-.001))){state.blocked=true;state.status='Esperando separación entre cargas';return true;}
    proposals.forEach(proposal=>{
      const {job,product,matrix,box}=proposal,item=job.item;item.previous.copy(item.box);this.runtime.setProductMatrix(product,matrix);item.box.copy(box);item.swept.copy(item.previous).union(box);this.runtime.invalidateCollision(product.object);
      if(state.carriage&&this.rackAutomatic(component)) {
        const point=box.getCenter(new THREE.Vector3());point.y=box.min.y-.005;state.carriage.parent.updateWorldMatrix(true,false);state.carriage.position.copy(state.carriage.parent.worldToLocal(point));state.carriage.updateWorldMatrix(true,true);this.runtime.invalidateCollision(state.carriage);
      }
      if(state.carts[item.rackCartIndex]){const point=box.getCenter(new THREE.Vector3());point.y=box.min.y-.005;state.carts[item.rackCartIndex].parent.updateWorldMatrix(true,false);state.carts[item.rackCartIndex].position.copy(state.carts[item.rackCartIndex].parent.worldToLocal(point));}
      if(proposal.arrived){job.path.shift();if(!job.path.length){this.rackRetarget(component,item,job.targetIndex);if(job.kind==='retrieve')state.presentedSlot=job.targetIndex;job.done=true;}}
    });
    this.rackSyncVisual(record);state.jobs=state.jobs.filter(job=>!job.done);state.blocked=false;if(!state.jobs.length){state.status=state.presentedSlot===null?'Disponible':'Carga disponible en ventanilla';this.order(component);}
    return true;
  }

  rackRequestAisle(record,index) {
    const component=record.components.palletQueue,state=component.rack,requested=Number.isInteger(index)&&index>=0?index:component.rackOpenAisle;
    if(!state||state.definition.mechanism!=='mobile'||requested<0||requested>=component.config.rackBanks||!Number.isInteger(requested))return false;
    component.rackOpenAisle=requested;
    if(requested===state.openAisle&&!state.mobile)return true;
    if(this.rackBusy(component)||this.rackLocked(component)||!this.operational(component))return false;
    const api=behaviorSchema.warehouseRacks||behaviorSchema.palletQueues.racks;
    state.mobile={aisle:requested,from:state.banks.map(bank=>bank.position.clone()),targets:state.banks.map((bank,i)=>new THREE.Vector3().fromArray(api.mobileOffset(component.config,i,requested))),elapsed:0};
    state.status='Abriendo pasillo';state.blocked=false;return true;
  }

  rackAdvanceAisle(record,delta) {
    const component=record.components.palletQueue,state=component.rack,motion=state.mobile;if(!motion)return false;
    if(this.rackLocked(component)){state.blocked=true;state.status='Pasillo retenido por carga agarrada o reservada';return true;}
    const amount=Math.max(.05,Math.min(1,component.rackMechanismSpeed))*delta,world=this.runtime.ctx.collisionWorld,user=this.rackUserBox(),proposals=[];
    state.banks.forEach((bank,index)=>{const target=motion.targets[index],offset=target.clone().sub(bank.position);if(offset.length()>amount)offset.setLength(amount);const box=new THREE.Box3().setFromObject(bank);box.min.y+=.025;
      const worldOffset=offset.clone().transformDirection(record.object.matrixWorld).multiplyScalar(offset.length());const next=box.clone().translate(worldOffset);
      proposals.push({bank,index,offset,box,next,worldOffset});});
    for(const proposal of proposals){const options=this.runtime.packageCollisionOptions(record,null);options.extraBoxes=options.extraBoxes.filter(box=>!component.items.some(item=>box===item.box));
      const full=motion.targets[proposal.index].clone().sub(proposal.bank.position),fullWorld=full.clone().transformDirection(record.object.matrixWorld).multiplyScalar(full.length()),end=proposal.box.clone().translate(fullWorld);
      if(user&&proposal.box.clone().union(end).intersectsBox(user)||world&&(world.sweepBox(proposal.box,fullWorld,options).blocked||world.testBox(end,options))){state.blocked=true;state.status='Pasillo ocupado: rearma la emergencia y pulsa Marcha cuando esté libre';this.runtime.setVariable(record.id,'emergency',true);return true;}}
    proposals.forEach(p=>{p.bank.position.add(p.offset);p.bank.updateWorldMatrix(true,true);this.runtime.invalidateCollision(p.bank);});
    component.pallets.forEach((pallet,index)=>pallet.object.position.fromArray(this.rackPoint(component,this.rackCell(component,index))));
    component.items.forEach(item=>{const matrix=this.rackMatrix(record,item.product,this.rackPoint(component,this.rackCell(component,item.palletIndex)));item.previous.copy(item.box);this.runtime.setProductMatrix(item.product,matrix);item.box.copy(item.bounds).applyMatrix4(matrix);item.swept.copy(item.previous).union(item.box);this.runtime.invalidateCollision(item.product.object);});
    state.blocked=false;if(proposals.every(p=>p.bank.position.distanceTo(motion.targets[p.index])<1e-6)){state.openAisle=motion.aisle;state.mobile=null;state.status='Pasillo '+(state.openAisle+1)+' disponible';this.order(component);}return true;
  }

  rackStep(record,delta) {
    const component=record.components.palletQueue,state=component.rack;if(!state)return;
    if(this.rackAdvanceAisle(record,delta)||this.rackAdvanceJobs(record,delta)||this.rackAdvanceCart(record,delta))return;
    if(state.definition.mechanism==='mobile'&&component.rackOpenAisle!==state.openAisle){this.rackRequestAisle(record,component.rackOpenAisle);return;}
    if(!['gravity','push-back'].includes(state.definition.mechanism))return;
    if(state.definition.mechanism==='push-back'&&state.preparedLane!==null&&state.carts.length){const front=state.layout.cells.find(cell=>cell.lane===state.preparedLane&&cell.depthIndex===0);if(front&&this.rackAvailableCart(component,front)<0){const used=new Set(component.items.map(item=>item.rackCartIndex)),index=state.carts.findIndex((cart,i)=>cart&&this.rackCell(component,i).lane===front.lane&&!used.has(i));if(index>=0){const from=state.carts[index].position,target=new THREE.Vector3().fromArray(this.rackPoint(component,front)),lower=Math.max(-.9,Math.min(from.y,target.y)-.12);state.cartMotion={index,path:[new THREE.Vector3(from.x,lower,from.z),new THREE.Vector3(target.x,lower,target.z),target]};state.status='Preparando carro de entrada';return;}}}
    const occupied=new Set(component.items.map(item=>item.palletIndex));
    const ordered=component.items.slice().sort((a,b)=>this.rackCell(component,a.palletIndex).depthIndex-this.rackCell(component,b.palletIndex).depthIndex),lanes=new Set();
    ordered.forEach(item=>{const cell=this.rackCell(component,item.palletIndex);if(cell.depthIndex===0||lanes.has(cell.lane)||state.preparedLane===cell.lane)return;const target=state.layout.cells.find(other=>other.lane===cell.lane&&other.depthIndex===cell.depthIndex-1);if(target&&!occupied.has(target.index)){this.rackQueueMove(record,item,target,'move');lanes.add(cell.lane);}});
  }

  operational(component) { return component.enabled && component.running && !component.paused; }

  itemFor(product) {
    if (product.item) return product.item;
    product.object.updateWorldMatrix(true, true);
    const box = product.bounds.clone().applyMatrix4(product.object.matrixWorld);
    return product.item = {mesh: product.object, product, authored: !!product.record, bounds: product.bounds, scale: product.scale,
      beltId: null, box, previous: box.clone(), swept: box.clone()};
  }

  top(component, item) {
    if(component.rack)return this.rackCanPickup(component,item);
    if (component.config.layoutMode === 'fit') {
      const a = item.fitPlacement;
      return !a || !component.items.some(other => {
        const b = other.fitPlacement;
        return other !== item && b && other.palletIndex === item.palletIndex && b.y > a.y &&
          a.x < b.x + b.width - 1e-7 && a.x + a.width > b.x + 1e-7 && a.z < b.z + b.depth - 1e-7 && a.z + a.depth > b.z + 1e-7;
      });
    }
    const cells = component.config.columns * component.config.rows, cell = item.palletSlot % cells;
    return !component.items.some(other => other !== item && (other.palletIndex || 0) === (item.palletIndex || 0) && other.palletSlot % cells === cell && other.palletSlot > item.palletSlot);
  }

  canPickup(product) {
    const item = product && product.item, record = item && this.runtime.records.get(item.palletOwnerId), component = record && record.components.palletQueue;
    return !component || this.top(component, item);
  }

  collisionOptions(record, item, reservations = []) {
    const options = this.runtime.packageCollisionOptions(record, item);
    // The wood, guard rail and control post remain real collision geometry.
    options.ignore = options.ignore.filter(object => object !== record.object);
    if (item.mesh) options.ignore.push(item.mesh);
    reservations.forEach(reservation => { if (reservation.box) options.extraBoxes.push(reservation.box); });
    return options;
  }

  fitPlacement(record, product, reservations, markFull) {
    const component = record.components.palletQueue, config = component.config, item = this.itemFor(product), packing = behaviorSchema.palletQueues.pallets;
    for (let palletIndex = 0; palletIndex < component.pallets.length; palletIndex++) {
      const pallet = component.pallets[palletIndex], reserved = reservations.filter(value => value.palletIndex === palletIndex);
      const quota = behaviorSchema.palletQueues.bayCapacity(config, palletIndex);
      if (!quota || pallet.full || pallet.items.length + reserved.length >= quota) continue;
      const existing = pallet.items.map(value => value.fitPlacement).concat(reserved.map(value => value.fitPlacement)).filter(Boolean);
      pallet.object.updateWorldMatrix(true, false);
      const inverse = new THREE.Matrix4().getInverse(pallet.object.matrixWorld), origin = pallet.object.getWorldPosition(new THREE.Vector3());
      const quaternion = pallet.object.getWorldQuaternion(new THREE.Quaternion());
      let geometricallyFits = false;
      for (const turned of [false, true]) {
        const rotation = quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), turned ? Math.PI / 2 : 0));
        const unit = new THREE.Matrix4().compose(origin, rotation, item.scale);
        const local = product.bounds.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, unit)), size = local.getSize(new THREE.Vector3());
        const placement = packing.place(config.width, config.depth, {width: size.x, depth: size.z, height: size.y}, existing, config.layers, false, config.maxStackHeight);
        if (!placement) continue;
        geometricallyFits = true; placement.rotated = turned;
        const center = new THREE.Vector3(placement.x + placement.width / 2 - config.width / 2, config.palletHeight + .005 + placement.y + placement.height / 2, placement.z + placement.depth / 2 - config.depth / 2).applyMatrix4(pallet.object.matrixWorld);
        center.sub(product.bounds.getCenter(new THREE.Vector3()).multiply(item.scale).applyQuaternion(rotation));
        const matrix = new THREE.Matrix4().compose(center, rotation, item.scale), box = product.bounds.clone().applyMatrix4(matrix), world = this.runtime.ctx.collisionWorld;
        if (world && world.testBox(box, this.collisionOptions(record, item, reservations))) continue;
        const used = new Set(pallet.items.map(value => value.palletSlot).concat(reserved.map(value => value.slot)));
        let slot = 0; while (used.has(slot)) slot++;
        return {slot, globalSlot: palletIndex * 500 + slot, palletIndex, matrix, bounds: box, box, height: size.y, fitPlacement: placement};
      }
      // A full footprint/5-layer stack is complete even when its nominal load
      // quota is larger. Oversize loads never seal an otherwise empty bay.
      const physical = product.bounds.getSize(new THREE.Vector3()).multiply(item.scale), bayScale = pallet.object.getWorldScale(new THREE.Vector3());
      const fitsEmpty = packing.place(config.width, config.depth, {width: Math.abs(physical.x / bayScale.x), depth: Math.abs(physical.z / bayScale.z), height: Math.abs(physical.y / bayScale.y)}, [], config.layers, true, config.maxStackHeight);
      if (markFull && !geometricallyFits && pallet.items.length && fitsEmpty) pallet.full = true;
    }
    return null;
  }

  placement(record, product, reservations = [], preferredCenter, markFull = false, receivingIgnore) {
    const component = record.components.palletQueue;
    if (!component || component.queue.length + reservations.length >= component.config.capacity) return null;
    if(component.rack)return this.rackPlacement(record,product,reservations,preferredCenter,receivingIgnore);
    const item = this.itemFor(product), perPallet = component.config.acceptsPallets ? 1 : component.config.columns * component.config.rows * component.config.layers;
    // Authored pallets keep their metadata in the visual child; generated
    // loads keep it on the root. Resolve both through the custody runtime.
    if (component.config.acceptsPallets && this.runtime.productMetadata(product).loadMode !== 'pallet') return null;
    if (component.config.layoutMode === 'fit' && !component.config.acceptsPallets) return this.fitPlacement(record, product, reservations, markFull);
    const occupied = new Set(component.items.map(value => (value.palletIndex || 0) * perPallet + value.palletSlot));
    reservations.forEach(value => occupied.add(value.globalSlot === undefined ? value.slot : value.globalSlot));
    let best = null;
    for (let globalSlot = 0; globalSlot < component.config.capacity; globalSlot++) {
      if (occupied.has(globalSlot)) continue;
      const palletIndex = Math.floor(globalSlot / perPallet), slot = globalSlot % perPallet, pallet = component.pallets[palletIndex];
      if (!pallet) continue;
      let target;
      if (component.config.acceptsPallets) {
        pallet.object.updateWorldMatrix(true, false);
        const rotation = pallet.object.getWorldQuaternion(new THREE.Quaternion()), scale = pallet.object.getWorldScale(new THREE.Vector3());
        const physical = item.bounds.getSize(new THREE.Vector3()).multiply(item.scale);
        if (Math.abs(physical.x) > component.config.width * Math.abs(scale.x) + .02 || Math.abs(physical.z) > component.config.depth * Math.abs(scale.z) + .02) continue;
        const center = item.bounds.getCenter(new THREE.Vector3()).multiply(item.scale);
        const offset = new THREE.Vector3(-center.x, .005 - Math.min(item.bounds.min.y * item.scale.y, item.bounds.max.y * item.scale.y), -center.z).applyQuaternion(rotation);
        target = {matrix: new THREE.Matrix4().compose(pallet.object.getWorldPosition(new THREE.Vector3()).add(offset), rotation, item.scale), height: Math.abs(physical.y)};
      } else target = this.runtime.palletMatrix(pallet, item, slot);
      if (!target) continue;
      const box = product.bounds.clone().applyMatrix4(target.matrix), world = this.runtime.ctx.collisionWorld;
      const options = this.collisionOptions(record, item, reservations);
      // Only the carrier runtime supplies this callback, after proving both
      // tines fit the pallet pockets at this exact final placement. Normal
      // stock queries keep every vehicle/chassis/mast collision unchanged.
      if (typeof receivingIgnore === 'function') options.ignore.push(...receivingIgnore(target.matrix));
      if (world && world.testBox(box, options)) continue;
      const candidate = {slot, globalSlot, palletIndex, matrix: target.matrix, bounds: box, box, height: target.height};
      if (!preferredCenter) return candidate;
      const distance = preferredCenter.distanceTo(box.getCenter(new THREE.Vector3()));
      if (!best || distance < best.distance) best = Object.assign(candidate, {distance});
    }
    return best;
  }

  canReceive(record, entry, manual = false, reservations = []) {
    const component = record && record.components.palletQueue;
    if (!component || !component.enabled || !manual && !this.operational(component) || !visible(record.object) || !entry.product || component.queue.includes(entry)) return false;
    const accepted = !!(component.rack?this.rackPlacement(record,entry.product,reservations,undefined,undefined,!manual):this.placement(record, entry.product, reservations, undefined, !manual));
    if(!accepted&&!manual&&component.rack&&component.rack.definition.mechanism==='push-back')this.rackPrepareInput(record);
    component.blocked = !accepted;
    return accepted;
  }

  receive(record, entry, manual = false, placement) {
    const component = record && record.components.palletQueue;
    if (!component || !component.enabled || !manual && !this.operational(component) || !visible(record.object) || !entry.product || component.queue.includes(entry)) return false;
    const target = placement || (component.rack?this.rackPlacement(record,entry.product,[],undefined,undefined,!manual):this.placement(record, entry.product, [], undefined, true));
    if (!target) { component.blocked = true; return false; }
    if(component.rack&&(this.rackBusy(component)||!this.rackCell(component,target.palletIndex)||component.items.some(item=>item.palletIndex===target.palletIndex)||!this.assignmentAllows(record,entry.product,this.rackCell(component,target.palletIndex))))return false;
    const product = entry.product, item = this.itemFor(product);
    entry.ownerId = record.id; entry.lineage.push(record.id); if (entry.lineage.length > 64) entry.lineage.shift();
    entry.palletSequence = ++this.sequence;
    component.helper.add(product.object); product.object.visible = true;
    this.runtime.setProductMatrix(product, target.matrix);
    Object.assign(item, {sourceEntry: entry, palletOwnerId: record.id, palletSide: 'queue', palletSlot: target.slot,
      palletIndex: target.palletIndex || 0, stackHeight: target.height, beltId: null, exited: false, blocked: false});
    item.fitPlacement = target.fitPlacement || null;
    item.box.copy(target.bounds); item.previous.copy(item.box); item.swept.copy(item.box);
    product.sourceEntry = entry; product.sourceId = ''; product.processorLocked = false; product.processorOwnerId = '';
    product.enteredBelts.clear();
    Object.assign(product.object.userData, {sourceProductId: entry.id, sourceOriginId: entry.originId, sourceSku: entry.spec.id,
      sourceUnits: entry.units, sourceLineage: entry.lineage.slice()});
    component.items.push(item); component.pallets[item.palletIndex].items.push(item); component.queue.push(entry); component.received++; component.receivedUnits += entry.units; component.blocked = false;
    if (component.pallets[item.palletIndex].items.length >= behaviorSchema.palletQueues.bayCapacity(component.config, item.palletIndex)) component.pallets[item.palletIndex].full = true;
    if (target.fitPlacement) {
      const pallet = component.pallets[item.palletIndex], pack = behaviorSchema.palletQueues.pallets;
      if (!pack.place(component.config.width, component.config.depth, target.fitPlacement, pallet.items.map(value => value.fitPlacement), component.config.layers, true, component.config.maxStackHeight)) pallet.full = true;
    }
    this.runtime.sourceRuntime.entries.add(entry); this.order(component);
    this.rackAfterReceive(record,item);
    this.runtime.event(record.id, 'pallet-queue-entry', 'Carga apilada en la estiba: ' + component.queue.length + '/' + component.config.capacity + '.');
    return true;
  }

  order(component) {
    if(component.rack){component.queue.sort((a,b)=>Number(this.rackCanPickup(component,b.product.item))-Number(this.rackCanPickup(component,a.product.item))||(component.rack.definition.policy==='lifo'?b.palletSequence-a.palletSequence:a.palletSequence-b.palletSequence));return;}
    component.queue.sort((a, b) => {
      const aTop = this.top(component, a.product.item), bTop = this.top(component, b.product.item);
      return Number(bTop) - Number(aTop) || b.palletSequence - a.palletSequence;
    });
  }

  removeItem(component, product) {
    const item = product.item;
    if(component.rack&&item.palletOwnerId===component.ownerId&&product.object.userData.sourceRackLocationOwner===component.ownerId){const data=product.object.userData;data.sourceRackLastLocationCode=data.sourceRackLocationCode;delete data.sourceRackLocationCode;delete data.sourceRackLocationOwner;}
    if(component.rack){const oldIndex=component.pallets.findIndex(pallet=>pallet.items.includes(item));if(component.rack.presentedSlot===oldIndex)component.rack.presentedSlot=null;component.rack.jobs=component.rack.jobs.filter(job=>job.item!==item);}
    const index = component.items.indexOf(item); if (index !== -1) component.items.splice(index, 1);
    component.pallets.forEach(pallet => { const index = pallet.items.indexOf(item); if (index !== -1) { pallet.items.splice(index, 1); pallet.full = false; } });
    // Receiving storage has already assigned its own slot during a handoff.
    // Removing the source membership must preserve that new ownership.
    if (item.palletOwnerId === component.ownerId) { item.palletOwnerId = null; item.palletSide = null; item.palletSlot = null; item.palletIndex = null; }
    component.blocked = false;
    this.order(component);
    if(component.rack)this.syncIdentification(true);
  }

  picked(product) {
    const item = product && product.item, record = item && this.runtime.records.get(item.palletOwnerId), component = record && record.components.palletQueue;
    if (!component || !this.top(component, item)) return;
    const entry = product.sourceEntry;
    if (!entry || !this.runtime.sourceRuntime.remove(record, entry, 'manual', component.inventory)) return;
    this.removeItem(component, product);
  }

  dispatch(record) {
    const component = record.components.palletQueue;
    if(component.rack&&component.rack.preparedLane!==null){component.rack.preparedLane=null;return false;}
    if(component.rack){if(this.rackBusy(component))return false;if(this.rackAutomatic(component)&&component.rack.presentedSlot===null)return this.rackRequestRetrieval(record,component.rackSelectedSlot);}
    this.order(component);
    if(component.rack&&!this.rackAutomatic(component)) {const index=component.queue.findIndex(entry=>this.rackCanPickup(component,entry.product.item)&&this.rackAtPort(component,this.rackCell(component,entry.product.item.palletIndex),true));if(index<0){component.blocked=!!component.queue.length;component.rack.status='Traslada la carga al apoyo de salida con un operador';return false;}if(index>0)component.queue.unshift(component.queue.splice(index,1)[0]);}
    const entry = component.queue[0];
    if (!entry || !this.operational(component)) return false;
    if(component.rack&&!this.rackCanPickup(component,entry.product.item))return false;
    Object.assign(component.inventory, {enabled: component.enabled, running: component.running, paused: component.paused});
    const product = entry.product;
    const result = this.runtime.sourceRuntime.dispatch(record, component.inventory);
    if (result) this.removeItem(component, product);
    else component.blocked = true;
    return result;
  }

  beltTransferDetails(record, belt, item, target, portName, reservations = []) {
    const runtime = this.runtime, blocked = {blocked: true};
    if (portName !== 'input' || !item.product) return blocked;
    const entry = item.product.sourceEntry || {product: item.product};
    const sameTarget = reservations.filter(value => value.palletQueue && value.target === target).map(value => value.placement);
    const receiver = target.components.palletQueue;
    if (!receiver || !this.operational(receiver) || !visible(target.object)) return blocked;
    const point = runtime.pathPoint(belt.config, runtime.pathLength(belt.config, item.route), item.route), to = runtime.sourceRuntime.port(target, false);
    if (!to || runtime.pathSurface(record, belt, point).distanceTo(to.position) > .18 || runtime.pathVector(record, point.tx, point.tz).normalize().dot(to.direction) < .85 || runtime.pathUp(record).dot(to.up) < .95) return blocked;
    if (!this.canReceive(target, entry, false, sameTarget)) return blocked;
    const placement = receiver.rack?this.rackPlacement(target,item.product,sameTarget,undefined,undefined,true):this.placement(target, item.product, sameTarget);
    return {record, belt, item, target, receiver, sourceBuffer: true, palletQueue: true, placement, box: placement.bounds, blocked: false};
  }

  findPlacement(product, tolerance = .6, receivingIgnore) {
    product.object.updateWorldMatrix(true, true);
    const current = product.bounds.clone().applyMatrix4(product.object.matrixWorld), center = current.getCenter(new THREE.Vector3());
    let best = null;
    this.runtime.records.forEach(record => {
      const component = record.components.palletQueue;
      if (!component || !component.enabled || !visible(record.object)) return;
      const candidate = this.placement(record, product, [], center, false, receivingIgnore);
      if (!candidate) {
        const config = component.config, layout = behaviorSchema.conveyorLayout.palletQueueLayout(config);
        record.object.updateWorldMatrix(true, false);
        const up = new THREE.Vector3(0, 1, 0).transformDirection(record.object.matrixWorld), inverse = new THREE.Matrix4().getInverse(record.object.matrixWorld);
        layout.pallets.forEach(bay => {
          const height = component.items.filter(item => (item.palletIndex || 0) === bay.index).reduce((max, item) => Math.max(max, item.box.clone().applyMatrix4(inverse).max.y), layout.palletTop);
          const region = new THREE.Box3(new THREE.Vector3(bay.position[0] - config.width / 2, layout.palletTop, bay.position[2] - config.depth / 2),
            new THREE.Vector3(bay.position[0] + config.width / 2, Math.max(layout.palletTop + .2, height + .5), bay.position[2] + config.depth / 2)).applyMatrix4(record.object.matrixWorld);
          const distance = center.distanceTo(region.clampPoint(center, new THREE.Vector3()));
          if (distance <= tolerance && (!best || distance < best.distance)) best = {record, target: record.object, distance, palletIndex: bay.index, accepted: false, kind: 'top', normal: up};
        });
        return;
      }
      const distance = center.distanceTo(candidate.bounds.getCenter(new THREE.Vector3()));
      if (distance > tolerance || best && best.distance <= distance) return;
      best = Object.assign({}, candidate, {record, target: record.object, kind: 'top', distance, snapped: distance <= .22, accepted: true,
        normal: new THREE.Vector3(0, 1, 0).transformDirection(record.object.matrixWorld), point: candidate.bounds.getCenter(new THREE.Vector3()).setY(candidate.bounds.min.y)});
    });
    return best;
  }

  receiveManual(product, placement) {
    if (!placement || !placement.accepted) return false;
    const entry = this.runtime.sourceRuntime.entryForProduct(placement.record, product);
    return this.receive(placement.record, entry, true, placement);
  }

  step(delta) {
    this.syncIdentification();
    this.runtime.records.forEach(record => {
      const component = record.components.palletQueue;
      if (!component || !visible(record.object) || !this.operational(component)) return;
      if(component.rack){this.rackStep(record,delta);if(this.rackBusy(component))return;}
      if (component.config.autoRelease && !component.rack) {
        const complete = component.pallets.map((pallet, index) => this.bayFull(component, index));
        const pressure = component.config.autoReleasePressure && this.runtime.sourceRuntime.liveLoads() >= 425;
        const ready = complete.some(Boolean) && (component.config.releasePolicy === 'palletFull' || complete.every(Boolean) || pressure);
        component.releaseElapsed = ready ? component.releaseElapsed + delta : 0;
        if (ready && component.releaseElapsed + 1e-8 >= component.config.releaseInterval) { this.releasePallet(record, complete.indexOf(true)); component.releaseElapsed = 0; }
      }
      if (component.config.delivery !== 'automatic') return;
      component.outputElapsed = Math.min(component.outputInterval, component.outputElapsed + delta);
      if (component.outputElapsed >= component.outputInterval && component.queue.length && this.dispatch(record)) component.outputElapsed = 0;
    });
  }

  variables(record) {
    const component = record.components.palletQueue;
    const occupancies = component.pallets.map((pallet, index) => ({loads: pallet.items.length, units: pallet.items.reduce((sum, item) => sum + (item.product.sourceEntry ? item.product.sourceEntry.units : 1), 0), full: this.bayFull(component, index), capacity: behaviorSchema.palletQueues.bayCapacity(component.config, index), layers: pallet.items.reduce((max, item) => Math.max(max, item.fitPlacement ? item.fitPlacement.layer : Math.floor(item.palletSlot / (component.config.columns * component.config.rows)) + 1), 0)}));
    const details = {}; occupancies.forEach((pallet, index) => { details['pallet' + (index + 1) + 'Units'] = pallet.units; details['pallet' + (index + 1) + 'Full'] = pallet.full; });
    return Object.assign({enabled: component.enabled, running: component.running, paused: component.paused, outputInterval: component.outputInterval,
      received: component.received, receivedUnits: component.receivedUnits, delivered: component.inventory.delivered, deliveredUnits: component.inventory.deliveredUnits,
      queued: component.queue.length, queuedUnits: component.queue.reduce((sum, entry) => sum + entry.units, 0), capacity: component.config.capacity,
      full: component.queue.length >= component.config.capacity || occupancies.every(pallet => pallet.full), empty: !component.queue.length, blocked: component.blocked,
      dispatchedPallets: component.dispatchedPallets, autoRelease: component.config.autoRelease, releasePolicy: component.config.releasePolicy,
      occupancy: component.queue.length / component.config.capacity * 100, columns: component.config.columns, rows: component.config.rows, layers: component.config.layers,
      palletCapacity: component.pallets.length, palletCount: occupancies.filter(pallet => pallet.loads).length, completePallets: occupancies.filter(pallet => pallet.full).length,
      palletOccupancies: JSON.stringify(occupancies)}, details,component.rack?{rackBusy:this.rackBusy(component),rackStatus:component.rack.status,rackBlocked:component.rack.blocked,rackSelectedSlot:component.rackSelectedSlot,rackOpenAisle:component.rackOpenAisle,rackMechanismSpeed:component.rackMechanismSpeed,rackPresentedSlot:component.rack.presentedSlot===null?-1:component.rack.presentedSlot,rackLoadKg:component.items.reduce((sum,item)=>sum+this.rackMass(item),0),rackSystem:component.rack.system,rackLocations:JSON.stringify(this.locations(record))}:{});
  }

  bayFull(component, index) {
    const pallet = component.pallets[index], quota = behaviorSchema.palletQueues.bayCapacity(component.config, index);
    return !!quota && (pallet.full || pallet.items.length >= quota);
  }

  releasePallet(record, index) {
    const component = record.components.palletQueue, pallet = component.pallets[index];
    if(component.rack)return this.dispatch(record);
    if (!this.operational(component) || !pallet || !this.bayFull(component, index) || pallet.items.some(item => item.product.heldBy)) return false;
    const entries = component.queue.filter(entry => entry.product && entry.product.item.palletIndex === index), units = entries.reduce((sum, entry) => sum + entry.units, 0);
    entries.forEach(entry => {
      const product = entry.product;
      this.runtime.sourceRuntime.remove(record, entry, 'despacho de estiba', component.inventory);
      this.removeItem(component, product);
      // Same bounded retirement path as process consumption: generated bodies
      // are disposed; authored assets are archived for exact stop/checkpoint.
      this.runtime.processorRuntime.consume(entry);
    });
    pallet.full = false; component.dispatchedPallets++; component.blocked = false;
    this.runtime.event(record.id, 'pallet-dispatched', 'Estiba ' + (index + 1) + ': ' + entries.length + ' cargas / ' + units + ' unidades despachadas.');
    return true;
  }

  command(record, action, value) {
    const runtime = this.runtime, component = record.components.palletQueue;
    let result;
    if(action==='assignLocation')result=this.assignLocation(record,value);
    else if(action==='clearLocationAssignment')result=this.clearLocationAssignment(record,value);
    else if(action==='requestRetrieval')result=this.rackRequestRetrieval(record,value);
    else if(action==='openAisle')result=this.rackRequestAisle(record,value);
    else if(action==='prepareRackInput')result=this.rackPrepareInput(record);
    else if (action === 'dispatch') result = this.dispatch(record);
    else if (action === 'dispatchPallet') result = this.releasePallet(record, component.pallets.findIndex((pallet, index) => this.bayFull(component, index)));
    else if (action === 'start') { runtime.setVariable(record.id, 'paused', false); result = runtime.setVariable(record.id, 'running', true); }
    else if (action === 'stop') result = runtime.setVariable(record.id, 'running', false);
    else if (action === 'pause') result = runtime.setVariable(record.id, 'paused', !component.paused);
    else throw new Error('Mando de estiba no compatible.');
    runtime.refreshVariables(); return result;
  }

  stop() {
    Array.from(this.identificationLabels.keys()).forEach(object=>this.removeIdentification(object));this.nextIdentificationAt=0;
    this.runtime.records.forEach(record=>{if(record.components.product){const data=record.object.userData;for(const key of ['sourceRackLocationCode','sourceRackLocationOwner','sourceRackDestinationCode','sourceRackLastLocationCode'])delete data[key];}});
    this.runtime.records.forEach(record => {
      const component = record.components.palletQueue;
      if (!component) return;
      if(component.rack){component.rack.banks.forEach((bank,index)=>bank.position.copy(component.rack.homes[index]));component.rack.carts.forEach((cart,index)=>cart.position.copy(component.rack.cartHomes[index]));if(component.rack.carriage&&component.rack.carriageHome)component.rack.carriage.position.copy(component.rack.carriageHome);this.rackSyncVisual(record);record.object.updateWorldMatrix(true,true);this.runtime.invalidateCollision(record.object);}
      if (component.helper.parent) component.helper.parent.remove(component.helper);
      component.pallets.forEach(pallet => { pallet.items.length = 0; });
      component.items.length = 0; component.queue.length = 0;
    });
  }
}
