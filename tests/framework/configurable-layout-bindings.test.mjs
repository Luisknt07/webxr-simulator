import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),source=require('../../modules/logistica-industrial/practices/configurable/data/source.json'),catalogue=require('../../modules/logistica-industrial/functions/equipamiento/schema/equipmentCatalog.cjs'),layout=require('../../modules/logistica-industrial/practices/configurable/LayoutBindings.cjs');
const clone=value=>JSON.parse(JSON.stringify(value));
const plan=(id,mode='manual')=>({id,mode,sourceRow:source.records.find(row=>row.id===id)});
const deepFreeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(deepFreeze);Object.freeze(value);}return value;};

test('all thirty selected source inventories resolve exactly 255 semantic native actors without adding catalogue definitions',()=>{
 const before=JSON.stringify(catalogue.DEFINITIONS),sourceBefore=JSON.stringify(source);let total=0;
 for(const row of source.records)for(const mode of ['manual','semiautomatic','automatic']){
  const rows=layout.bindings(deepFreeze({id:row.id,mode,sourceRow:clone(row)}));assert.equal(rows.length,row.modes[mode].equipment.length);assert.equal(new Set(rows.map(item=>item.alias)).size,rows.length);
  for(const binding of rows){const authored=row.modes[mode].equipment.find(item=>item.alias===binding.alias),definition=catalogue.definition(binding.catalogueEquipmentId);assert(definition&&definition.nativeKind);assert.equal(binding.nativeKind,definition.nativeKind);assert.equal(binding.count,authored.count);assert.equal(binding.sourceName,authored.name);assert.equal(binding.componentsText,authored.componentsText);assert.deepEqual(binding.documentCenter,authored.center);assert.deepEqual(binding.sourceCenterDocument,authored.center);assert.deepEqual(binding.sourceCenter,[authored.center[0]-row.interiorArea.width/2,0,authored.center[1]-row.interiorArea.depth/2]);assert.deepEqual(binding.sourceDimensions,authored.footprint);assert(binding.bindingStatus.includes('not geometry'));for(const id of binding.componentEquipmentIds)assert(catalogue.definition(id));total++;}
 }
 assert.equal(total,255);assert.equal(JSON.stringify(catalogue.DEFINITIONS),before);assert.equal(JSON.stringify(source),sourceBefore);
});

test('manual packing and wrapping do not instantiate robot/AGV/automatic wrappers or sealers, and mode replacements change real actor kinds',()=>{
 for(const id of ['CEDI-04','SF-05']){const manual=layout.bindings(plan(id)),automatic=layout.bindings(plan(id,'automatic'));assert(!manual.some(row=>['robot','mobile'].includes(row.role)));assert(!manual.some(row=>row.catalogueEquipmentId==='equipment.packaging.stretch-wrapper'));assert(automatic.some(row=>row.catalogueEquipmentId==='equipment.packaging.stretch-wrapper'));assert(automatic.some(row=>row.role==='robot'));assert(automatic.some(row=>row.role==='mobile'));}
 const m=layout.bindings(plan('CEDI-03')),s=layout.bindings(plan('CEDI-03','semiautomatic')),a=layout.bindings(plan('CEDI-03','automatic'));
 assert.equal(m.find(row=>row.alias==='E05').role,'manualStation');assert.equal(s.find(row=>row.alias==='E05').catalogueEquipmentId,'equipment.picking.put-wall');assert.equal(a.find(row=>row.alias==='E05').catalogueEquipmentId,'equipment.picking.goods-to-robot');assert.equal(m.find(row=>row.alias==='E04').nativeKind,'vehicle');assert.equal(a.find(row=>row.alias==='E04').nativeKind,'robot');assert.equal(a.find(row=>row.alias==='E08').config.tool,'vacuum');
 assert(!layout.bindings(plan('CEDI-02','automatic')).some(row=>row.alias==='E08'));
});

test('quarantine, released buffers and pallet-building seats remain floor queues; software workspaces use an honest physical HMI terminal',()=>{
 const c1=layout.bindings(plan('CEDI-01'));
 for(const alias of ['E05','E07']){const row=c1.find(row=>row.alias===alias);assert.equal(row.catalogueEquipmentId,'equipment.storage.block');assert.equal(row.role,'floorQueue');assert.equal(row.config.rackSystem,'floor');assert.equal(row.config.layers,1);}
 assert.equal(c1.find(row=>row.alias==='E05').quality,'held');assert.equal(c1.find(row=>row.alias==='E07').quality,'released');assert.equal(c1.find(row=>row.alias==='E04').placementPolicy,'table-aside-floor-load; a whole pallet is not placed on the inspection table');
 const terminal=c1.find(row=>row.alias==='E08');assert.equal(terminal.catalogueEquipmentId,'equipment.control.hmi');assert.equal(terminal.nativeKind,'plc');assert.equal(terminal.workspaceId,'inventory');assert.equal(layout.bindings(plan('SF-02')).find(row=>row.alias==='E01').workspaceId,'analytics');
 assert.equal(c1.find(row=>row.alias==='E02').catalogueEquipmentId,'equipment.dock.leveler');
});

test('curated choices accept only the source alias family and return fresh arrays and configuration across callers',()=>{
 const initial=plan('CEDI-01'),rows=layout.bindings(initial),truck=rows.find(row=>row.alias==='E03'),choices=layout.equipmentChoices(initial,'E03');assert.deepEqual(choices.map(row=>row.id),layout.equipmentChoices(truck).map(row=>row.id));assert(choices.some(row=>row.id==='equipment.vehicle.reach-truck'));
 const configured=layout.bindings({...initial,equipmentSelections:{E03:'equipment.vehicle.reach-truck'}}).find(row=>row.alias==='E03');assert.equal(configured.catalogueEquipmentId,'equipment.vehicle.reach-truck');assert.equal(configured.nativeVariant,'reach-truck');
 assert.throws(()=>layout.bindings({...initial,equipmentSelections:{E03:'equipment.robot.articulated'}}));assert.throws(()=>layout.bindings({...initial,equipmentSelections:{E09:'equipment.mobile.agv-forks'}}));assert.throws(()=>layout.bindings({...initial,equipmentSelections:{E03:{}}}));
 const arm=layout.bindings(plan('SF-03','automatic')).find(row=>row.alias==='E09');arm.requiredInterfaces.push('invalid-mutated');arm.config.tool='process';arm.allowedEquipmentIds.push('invalid-mutated');const armAgain=layout.bindings(plan('SF-03','automatic')).find(row=>row.alias==='E09');assert(!armAgain.requiredInterfaces.includes('invalid-mutated'));assert.equal(armAgain.config.tool,'gripper');assert(!armAgain.allowedEquipmentIds.includes('invalid-mutated'));
 assert.throws(()=>layout.equipmentChoices(initial,'E99'));assert.throws(()=>layout.equipmentChoices({allowedEquipmentIds:['not-a-native-equipment']}));
});

test('invalid source identity, modes, counts or nonfinite footprints are rejected rather than mapped to a generic machine',()=>{
 assert.throws(()=>layout.bindings({id:'CEDI-01',mode:'manual'}));assert.throws(()=>layout.bindings({...plan('CEDI-01'),mode:'unknown'}));assert.throws(()=>layout.bindings({...plan('CEDI-01'),id:'SF-05'}));
 const p=clone(plan('CEDI-01'));p.sourceRow.modes.manual.equipment[0].center[0]=Infinity;assert.throws(()=>layout.bindings(p));p.sourceRow.modes.manual.equipment[0].center[0]=-5;p.sourceRow.modes.manual.equipment[0].count=0;assert.throws(()=>layout.bindings(p));
 const d=clone(plan('CEDI-01'));d.sourceRow.modes.manual.equipment.push(clone(d.sourceRow.modes.manual.equipment[0]));assert.throws(()=>layout.bindings(d));
});
