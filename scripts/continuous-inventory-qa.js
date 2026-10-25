'use strict';
const assert = require('node:assert/strict');
const schema = require('../shared/behaviors');

/** Observers call the real runtime synchronously and never change its result. */
function installContinuousQA(scene) {
  const e=context.editor,r=e.simulation,world=e.collisionWorld;
  if(!r.running||context.collisionWorld!==world)throw new Error('A real running CollisionWorld is required.');
  e.simulationPaused=true;const previousLocomotion=context.studioLocomotion;context.studioLocomotion='teleport';
  const clone=value=>JSON.parse(JSON.stringify(value)),feedIds=new Set(scene.sourceIds),generated=new Map(),dispatched=[],snapshots=[],warnings=new Map();
  r.events.filter(event=>event.type==='configuration-warning').forEach(event=>warnings.set(event.objectId+'|'+event.message,clone(event)));
  const runtimeEvent=r.event;r.event=function(objectId,type,message){if(type==='configuration-warning')warnings.set(objectId+'|'+message,{objectId,type,message,time:r.time});return runtimeEvent.call(this,objectId,type,message);};
  const leaves=entry=>{const rows=[];const visit=value=>{if(value.members?.length)value.members.forEach(visit);else rows.push({id:value.id,originId:value.originId,units:value.units,spec:clone(value.spec)});};visit(entry);return rows;};
  const describe=entry=>({id:entry.id,originId:entry.originId,ownerId:entry.ownerId,units:entry.units,spec:clone(entry.spec),load:clone(entry.load||{}),lineage:(entry.lineage||[]).slice(),leaves:leaves(entry),metadata:entry.product&&r.productMetadata(entry.product)});
  const rememberEntry=entry=>{if(!entry||!feedIds.has(entry.originId)||!entry.id.startsWith(entry.originId+':')||entry.members?.length)return;let value=generated.get(entry.id);if(!value){value=describe(entry);generated.set(entry.id,value);}if(entry.product&&!value.metadata)value.metadata=r.productMetadata(entry.product);};
  const remember=()=>r.sourceRuntime.entries.forEach(rememberEntry);
  const generate=r.sourceRuntime.generate,materialize=r.sourceRuntime.materialize,release=r.palletQueueRuntime.releasePallet;
  r.sourceRuntime.generate=function(...args){const result=generate.apply(this,args);if(result)rememberEntry(args[0].components.source.queue.at(-1));return result;};
  r.sourceRuntime.materialize=function(...args){const result=materialize.apply(this,args);rememberEntry(result&&result.sourceEntry||args[0].components.source?.queue[0]);return result;};
  r.palletQueueRuntime.releasePallet=function(record,index){const entries=record.components.palletQueue.queue.filter(entry=>entry.product?.item.palletIndex===index).map(describe),result=release.call(this,record,index);if(result)entries.forEach(entry=>dispatched.push({receiverId:record.id,...entry}));return result;};
  const lines=scene.lines.map(line=>{
    const actual=r.getPanelSnapshot(line.controllerId,'line').memberIds.slice().sort();if(JSON.stringify(actual)!==JSON.stringify(line.memberIds.slice().sort()))throw new Error('PLC scope differs from network '+line.id);
    const panels=line.memberIds.map(id=>r.records.get(id)).filter(record=>r.machineComponent(record).config.withPanel);if(panels.length!==1||panels[0].id!==line.controllerId)throw new Error('Exactly one PLC is required per network.');
    line.sourceIds.forEach(id=>{const config=r.records.get(id).components.source.config;if(line.mode==='manual'){if(config.autoGenerate||config.initialCount)throw new Error('Manual annex generates products automatically.');}else if(!config.autoGenerate||config.totalLimit!==0)throw new Error('Automatic Source must be unlimited.');});
    return Object.assign({},line,{monitor:e.document.getObject(line.monitorId)});
  });
  const ports=e.assembly.edges().map(edge=>{const value=e.assembly.assessConnection(edge.source,edge.sourcePort,edge.target,edge.targetPort);if(!value.ready||value.gap>1e-6)throw new Error('Disconnected physical interface: '+edge.source.name);return{sourceId:edge.source.userData.editorId,targetId:edge.targetId,gap:value.gap};});
  const qa={scene,lines,elapsed:0,peakLoads:r.sourceRuntime.liveLoads(),ports};
  qa.summary=()=>({roomId:e.roomId,seconds:qa.elapsed,liveLoads:r.sourceRuntime.liveLoads(),peakLoads:qa.peakLoads,trackedEntries:r.sourceRuntime.entries.size,productCount:r.products.size,archivedProducts:r.processorRuntime.archive.size,renderer:{memory:{...context.renderer.info.memory},render:{...context.renderer.info.render}},generatedUnits:[...generated.values()].reduce((sum,entry)=>sum+entry.units,0),dispatchedUnits:dispatched.reduce((sum,entry)=>sum+entry.units,0),lines:lines.map(line=>({id:line.id,mode:line.mode,
    sources:line.sourceIds.map(id=>{const value=r.records.get(id).variables;return{id,generated:value.generated,generatedUnits:value.generatedUnits,queuedUnits:value.queuedUnits,generationBlocked:value.generationBlocked};}),
    receivers:line.receiverIds.map(id=>{const value=r.records.get(id).variables;return{id,receivedUnits:value.receivedUnits,storedUnits:value.queuedUnits,deliveredUnits:value.deliveredUnits,dispatchedPallets:value.dispatchedPallets,pallets:JSON.parse(value.palletOccupancies)};})}))});
  qa.advance=seconds=>{for(let time=0;time<seconds-1e-8;time+=.1){world.beginFrame();try{e.root.updateMatrixWorld(true);r.execute(Math.min(.1,seconds-time));e.industrialVisuals.sync(e.roomId,.1,false);e.root.updateMatrixWorld(true);qa.peakLoads=Math.max(qa.peakLoads,r.sourceRuntime.liveLoads());if(qa.peakLoads>500)throw new Error('Global logical load bound exceeded.');}finally{world.endFrame();}}qa.elapsed+=seconds;return qa.summary();};
  qa.wave=()=>{const value=qa.summary();snapshots.push(value);return value;};
  qa.snapshot=()=>{remember();const summary=qa.summary(),active=[...r.sourceRuntime.entries].filter(entry=>leaves(entry).some(leaf=>feedIds.has(leaf.originId))).map(describe);
    const analytics=lines.map(line=>{const snapshot=r.getAnalyticsSnapshot(line.controllerId,'line');return{id:line.id,time:snapshot.time,observedSeconds:snapshot.observedSeconds,summary:snapshot.summary,historyLength:snapshot.history.length,control:snapshot.control};});
    return{...summary,waves:snapshots,generated:[...generated.values()],active,dispatched:dispatched.slice(),analytics,warnings:[...warnings.values()],ports,gl:context.renderer.getContext().getError(),machines:[...r.records.values()].filter(record=>r.machineComponent(record)).map(record=>({id:record.id,name:record.object.name,variables:{...record.variables}}))};};
  qa.frameMonitor=(index,page='diagram',selectedId)=>{const line=lines[index];e.lineMonitors.sync(e.roomId,.3,false);const entry=e.lineMonitors.entries.get(line.monitor);if(!entry)throw new Error('Missing monitor');const center=entry.plane.getWorldPosition(context.camera.position.clone()),normal=center.clone().set(0,0,1).applyQuaternion(entry.plane.getWorldQuaternion(context.camera.quaternion.clone())),eye=center.clone().addScaledVector(normal,3.5);context.cameraRig.position.add(eye.clone().sub(context.camera.getWorldPosition(center.clone())));context.cameraRig.updateMatrixWorld(true);context.camera.lookAt(center);context.camera.updateMatrixWorld(true);e.performance.update(context.camera,0);entry.page=page;if(selectedId)entry.selectedId=selectedId;entry.dirty=true;e.lineMonitors.sync(e.roomId,.3,false);return{page,selectedId:entry.selectedId};};
  qa.frameObject=id=>{const record=r.records.get(id),bounds=world.objectBounds(record.object),center=bounds.getCenter(context.camera.position.clone()),distance=Math.max(3,bounds.getSize(center.clone()).length()),direction=center.clone().set(1,.7,1).normalize().applyQuaternion(record.object.getWorldQuaternion(context.camera.quaternion.clone())),eye=center.clone().addScaledVector(direction,distance);eye.y=Math.min(6.8,eye.y);context.cameraRig.position.add(eye.clone().sub(context.camera.getWorldPosition(center.clone())));context.cameraRig.updateMatrixWorld(true);context.camera.lookAt(center);context.camera.updateMatrixWorld(true);e.performance.update(context.camera,0);e.industrialVisuals.sync(e.roomId,.3,false);return{id,name:record.object.name,eye:eye.toArray(),center:center.toArray()};};
  qa.press=(index,key)=>{const entry=e.lineMonitors.entries.get(lines[index].monitor),hand=context.desktopController;if(!['diagram','analytics','equipment','variables','events','control'].includes(key)&&entry.page!=='control')qa.press(index,'control');entry.dirty=true;e.lineMonitors.sync(e.roomId,.3,false);const region=entry.regions.find(value=>value.key===key&&!value.disabled);if(!region)throw new Error('Missing live monitor control '+key);const u=(region.x+region.width/2)/entry.canvas.width,v=1-(region.y+region.height/2)/entry.canvas.height,point=entry.plane.localToWorld(context.camera.position.clone().set((u-.5)*.98,(v-.5)*.98,0)),origin=r.interactionOrigin(hand),ray=new context.raycontrol.raycaster.constructor(origin,point.clone().sub(origin).normalize(),0,6),hit=ray.intersectObject(entry.plane)[0];if(!hit||!entry.state.isSelectable(hit,hand))throw new Error('Real interaction ray is blocked for '+key);entry.state.onSelectStart(hit,hand);entry.state.onSelectEnd(hit,hand);if(entry.notice)throw new Error(entry.notice);return{key,distance:hit.distance,uv:hit.uv.toArray()};};
  qa.restore=()=>{r.event=runtimeEvent;r.sourceRuntime.generate=generate;r.sourceRuntime.materialize=materialize;r.palletQueueRuntime.releasePallet=release;context.studioLocomotion=previousLocomotion;};
  remember();window.__continuousQA=qa;return qa.summary();
}
const histogram=rows=>{const counts=new Map();rows.forEach(row=>{const s=row.spec,key=JSON.stringify([row.id,row.originId,s.id,s.type,s.width,s.height,s.depth,s.color,s.quality,s.defect,s.mass,s.base]);counts.set(key,(counts.get(key)||0)+row.units);});return [...counts].sort((a,b)=>a[0].localeCompare(b[0]));};
function verifyMachinePassages(result,scene,document){
  assert(Array.isArray(result.machines),'Real physical passage counters are required.');
  const machines=new Map(result.machines.map(value=>[value.id,value]));
  scene.lines.filter(line=>line.mode!=='manual').forEach(line=>line.memberIds.forEach(id=>{
    const machine=machines.get(id);assert(machine,'Missing physical passage counters for '+id);
    const record=document.rooms[scene.roomId].additions.find(value=>value.id===id);assert(record,'Missing authored automatic machine '+id);
    const config=record.behaviors.find(value=>['source','processor','palletQueue','conveyor'].includes(value.type));assert(config,'Missing machine configuration '+id);
    const v=machine.variables,terminalIndex=line.receiverIds.indexOf(id),reserve=terminalIndex>=0&&line.expectedReceiverUnits?.[terminalIndex]===0;
    if(reserve){assert.equal(v.receivedUnits,0,'The unmatched-products reserve must stay empty.');return;}
    if(config.type==='source'){if(line.sourceIds.includes(id))assert(v.generatedUnits>0&&v.deliveredUnits>0,'An automatic Source never fed its next process: '+machine.name);else assert(v.receivedUnits>0&&v.deliveredUnits>0,'An intermediate FIFO never completed its real handoff: '+machine.name);}
    else if(config.type==='conveyor'){assert(v.entryCount>0&&v.exitCount>0,'An automatic conveyor never completed a passage: '+machine.name);}
    else if(config.type==='processor'){assert(v.receivedUnits>0&&v.deliveredUnits>0,'An automatic processor never completed its real handoff: '+machine.name);}
    else {assert(v.receivedUnits>0,'An automatic stock never received a product: '+machine.name);if(terminalIndex<0)assert(v.deliveredUnits>0,'An intermediate queue never fed its downstream machine: '+machine.name);}
  }));
}
function verifyContinuousInventory(result,scene,document){
  assert.equal(result.roomId,scene.roomId);assert.equal(result.seconds,900);assert.deepEqual(result.waves.map(value=>value.seconds),[300,600,900]);assert(result.peakLoads<=500);assert.equal(result.gl,0);assert.deepEqual(result.warnings,[]);
  const expectedLines=scene.lines.map(line=>line.id);assert.deepEqual(result.lines.map(line=>line.id),expectedLines);assert.deepEqual(result.analytics.map(line=>line.id),expectedLines);
  result.waves.forEach(wave=>assert.deepEqual(wave.lines.map(line=>line.id),expectedLines,'Every wave includes every authored network.'));
  [result,...result.waves].forEach(wave=>{for(const key of ['trackedEntries','productCount'])assert(Number.isInteger(wave[key])&&wave[key]>=0&&wave[key]<=500,'Missing or unbounded logical/visual inventory: '+key);assert.equal(wave.archivedProducts,0,'Generated stock retirement must not retain authored-product archives.');});
  assert.deepEqual(histogram(result.generated.flatMap(entry=>entry.leaves)),histogram(result.active.concat(result.dispatched).flatMap(entry=>entry.leaves)),'Every generated unit remains active or was dispatched exactly once, including nested/fractional provenance.');
  const ids=result.active.map(entry=>entry.id).concat(result.dispatched.map(entry=>entry.id));assert.equal(new Set(ids).size,ids.length,'An active/dispatched load must not be counted twice.');
  result.lines.forEach(line=>{
    const authored=scene.lines.find(value=>value.id===line.id);assert.equal(line.mode,authored.mode);assert.deepEqual(line.sources.map(value=>value.id),authored.sourceIds);assert.deepEqual(line.receivers.map(value=>value.id),authored.receiverIds);
    line.sources.forEach(source=>{const entries=result.generated.filter(entry=>entry.originId===source.id);assert.equal(entries.length,source.generated,'Source generation counter agrees with observed entries.');assert.equal(entries.reduce((sum,entry)=>sum+entry.units,0),source.generatedUnits,'Source unit counter agrees with observed provenance.');if(document){const config=document.rooms[scene.roomId].additions.find(row=>row.id===source.id).behaviors.find(value=>value.type==='source');entries.forEach((entry,index)=>{const expected=schema.productSources.specAt(config,index);assert.deepEqual(entry.spec,expected,'Generation follows the actual persisted catalogue and sequence.');assert.equal(entry.units,schema.productSources.unitsFor(config,expected),'Fitted Source units match shared packing geometry.');});}});
    const previous=result.waves.slice(0,-1).map(wave=>wave.lines.find(value=>value.id===line.id)),current=result.waves.at(-1).lines.find(value=>value.id===line.id);
    if(line.mode==='manual'){line.sources.forEach(source=>assert.equal(source.generatedUnits,0));return;}
    const produced=value=>value.sources.reduce((sum,source)=>sum+source.generatedUnits,0);assert(produced(current)>produced(previous.at(-1))&&produced(previous.at(-1))>produced(previous[0]),'Continuous production must increase over all three waves: '+line.id);
    line.receivers.forEach(receiver=>{assert.equal(receiver.receivedUnits,receiver.storedUnits+receiver.deliveredUnits,'Terminal accounting: received = stored + dispatched.');const entries=result.dispatched.filter(entry=>entry.receiverId===receiver.id);assert.equal(entries.reduce((sum,entry)=>sum+entry.units,0),receiver.deliveredUnits);receiver.pallets.forEach(pallet=>assert(pallet.layers<=5));});
    assert(line.receivers.reduce((sum,receiver)=>sum+receiver.deliveredUnits,0)>0,'Every automatic network must release capacity during the run: '+line.id);
  });
  if(document)verifyMachinePassages(result,scene,document);
  result.dispatched.filter(entry=>entry.load.loadMode==='pallet').forEach(entry=>{const source=result.generated.find(value=>value.id===entry.id);assert(source&&source.metadata&&entry.metadata);for(const key of ['width','height','depth'])assert(Math.abs(source.metadata[key]-entry.metadata[key])<.005);for(const key of ['units','mass','base','loadMode','productType'])assert.equal(entry.metadata[key],source.metadata[key]);});
  if(scene.kind==='sorting'){
    const groups=[['surface-case'],['damaged-case'],['priority-sku'],['blue-case'],['crate-case'],['wide-case','tall-case','long-case'],[]];
    scene.lines[0].receiverIds.forEach((id,index)=>{const delivered=result.dispatched.filter(entry=>entry.receiverId===id),stored=result.active.filter(entry=>entry.ownerId===id);stored.concat(delivered).flatMap(entry=>entry.leaves).forEach(leaf=>assert(groups[index].includes(leaf.spec.id),'A classifier sent the wrong SKU to '+id));});
  }
  result.analytics.forEach(value=>{assert(value.historyLength<=600);assert(value.control.ready);const seconds=['busySeconds','idleSeconds','setupSeconds','blockedSeconds','downSeconds','pausedSeconds'].reduce((sum,key)=>sum+value.summary[key],0);assert(Math.abs(seconds-value.observedSeconds)<1e-5);});
  result.verified=true;return result;
}
module.exports={installContinuousQA,verifyContinuousInventory,verifyMachinePassages,histogram};
