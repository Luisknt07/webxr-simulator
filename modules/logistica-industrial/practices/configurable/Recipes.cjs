'use strict';
const source=require('./data/source.json');
const cediOperatingData=require('./CediOperatingData.cjs');
const MODES=['manual','semiautomatic','automatic'];
const GUARDS=['identify','prepare','operate','inspect','deliver','close'];
const MODULE_ID='sector.logistics-industrial';
// Only a bounded native end-to-end regression can add a prepared baseline.
// Alternative machines, positions, cases and automation need their own proof.
const VERIFIED_MATERIAL=Object.freeze({
 'CEDI-01':'tests/native/configurable-practice-receiving-native.test.mjs','CEDI-02':'tests/native/practice-putaway-native.test.mjs','CEDI-03':'tests/framework/configurable-practice-material-fixtures.test.mjs','CEDI-04':'tests/framework/practice-packing-native.test.mjs','CEDI-05':'tests/framework/practice-dispatch-native.test.mjs',
 'SF-01':'tests/native/configurable-practice-raw-receiving-native.test.mjs','SF-02':'tests/framework/practice-kit-native.test.mjs','SF-03':'tests/native/practice-machining-native.test.mjs',
 'SF-04':'tests/framework/practice-assembly-native.test.mjs','SF-05':'tests/framework/practice-packing-native.test.mjs'
});
const clone=value=>JSON.parse(JSON.stringify(value));
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const MODE_ALIAS={M:'manual',S:'semiautomatic',A:'automatic'};
const FIXTURES={
 'CEDI-01':{pallets:6,boxesPerPallet:8,boxes:48,unitMassKg:5,palletTareKg:20,palletMassKg:60,outputPositions:2},
 'CEDI-02':{pallets:6,boxesPerPallet:8,boxes:48,replenishmentBoxes:8,outputPositions:2},
 'CEDI-03':{orders:3,boxesPerOrder:4,boxes:24,pickedBoxes:12,totes:3},
 'CEDI-04':{orders:3,boxes:12,emptyPallets:2,boxesPerPallet:6,boxLabels:12,palletLabels:2},
 'CEDI-05':{pallets:2,boxesPerPallet:6,boxes:12,outputPositions:2},
 'SF-01':{rawBodies:12,lids:12,screws:48,inboundLoads:2,sets:12},
 'SF-02':{rawBodies:12,lids:12,screws:48,kits:3,bodiesPerKit:4,lidsPerKit:4,screwsPerKit:16,containers:3},
 'SF-03':{rawBodies:12,processedBodies:12,fixture:1,tool:1},
 'SF-04':{machinedBodies:12,lids:12,screws:48,sets:12},
 'SF-05':{finishedSets:12,cartons:12,boxLabels:12,emptyPallets:1,palletLabels:1,boxesPerPallet:12}
};
function entry(id){const row=source.records.find(row=>row.id===id);if(!row)throw Error('Práctica configurable no disponible: '+id);return row;}
function availability(id,mode='manual',options={}){
 const row=entry(id);mode=MODE_ALIAS[mode]||mode;if(!MODES.includes(mode))throw Error('Modalidad de práctica inválida.');
 const caseId=options.caseId||'A';
 const selections=options.equipmentSelections||{},layout=options.layout||{preset:'prepared',overrides:[]};
 const ready=!!VERIFIED_MATERIAL[id]&&mode==='manual'&&caseId==='A'&&Object.keys(selections).length===0&&layout.preset==='prepared'&&!(layout.overrides||[]).length;
 const reasons=ready?[]:[VERIFIED_MATERIAL[id]?'El caso A manual preparado tiene una operación material comprobada. Esta selección de caso, automatización, equipos o posiciones requiere su propia validación fin a fin antes de evaluarse.':'Esta práctica conserva el montaje y los materiales de referencia; su operación completa requiere validación nativa antes de evaluarse.'];
 return {practiceId:id,mode,sourceMode:row.modes[mode].name,canConfigure:true,ready,reasons,scope:ready?(id==='CEDI-01'?'native-six-pallet-receiving':'native-material-workflow'):'source-faithful-native-configuration',evidence:ready?VERIFIED_MATERIAL[id]:null,humanResponsibilities:row.modes[mode].actorsText};
}
function normalizedOptions(options){
 if(!plain(options))throw Error('La configuración debe ser un objeto de selectores.');
 const mode=MODE_ALIAS[options.mode]||options.mode||'manual',caseId=options.caseId||'A',difficulty=options.difficulty===undefined?1:Number(options.difficulty);
 if(!MODES.includes(mode)||!['A','B','C'].includes(caseId)||!Number.isInteger(difficulty)||difficulty<1||difficulty>3)throw Error('Caso, dificultad o automatización inválidos.');
 const executionMode=options.executionMode||'isolated',evaluation=options.evaluation||'practice',device=options.device||'desktop';
 if(!['isolated','campaign'].includes(executionMode)||!['practice','assessed'].includes(evaluation)||!['desktop','mobile','vr'].includes(device))throw Error('Configuración de ejecución inválida.');
 const equipmentSelections=options.equipmentSelections===undefined?{}:options.equipmentSelections;if(!plain(equipmentSelections)||Object.keys(equipmentSelections).length>24||Object.values(equipmentSelections).some(value=>typeof value!=='string'||!/^equipment\.[a-z0-9.-]{1,110}$/.test(value)))throw Error('Selección de equipos inválida.');
 const layout=options.layout===undefined?{preset:'prepared',overrides:[]}:options.layout;if(!plain(layout)||Object.keys(layout).some(key=>!['preset','overrides'].includes(key))||layout.preset!=='prepared'||!Array.isArray(layout.overrides)||layout.overrides.length>24)throw Error('Layout de práctica inválido.');
 if(layout.overrides.some(row=>!plain(row)||Object.keys(row).some(key=>!['alias','x','z','yaw'].includes(key))||typeof row.alias!=='string'||!/^E\d{2}$/.test(row.alias)||!Number.isFinite(row.x)||!Number.isFinite(row.z)||Math.abs(row.x)>250||Math.abs(row.z)>250||row.yaw!==undefined&&(!Number.isFinite(row.yaw)||Math.abs(row.yaw)>360))||new Set(layout.overrides.map(row=>row.alias)).size!==layout.overrides.length)throw Error('Posiciones de layout inválidas.');
 if(options.helps!==undefined&&(!plain(options.helps)||Object.keys(options.helps).some(key=>!['text','voice','hints'].includes(key))))throw Error('Ayudas de práctica inválidas.');
 const helps=Object.assign({text:true,voice:false,hints:'guided'},options.helps||{});if(typeof helps.text!=='boolean'||typeof helps.voice!=='boolean'||!['guided','on-request','none'].includes(helps.hints))throw Error('Ayudas de práctica inválidas.');
 const result={mode,caseId,difficulty,executionMode,evaluation,device,equipmentSelections:clone(equipmentSelections),layout:clone(layout),helps};
 if(options.cediData!==undefined)result.cediData=cediOperatingData.normalize(options.cediData);
 return result;
}
function plan(id,options={}){
 const row=entry(id),settings=normalizedOptions(options),fixture=clone(FIXTURES[id]),availabilityValue=availability(id,settings.mode,settings);
 if(id.startsWith('CEDI-'))settings.cediData=cediOperatingData.normalize(settings.cediData);
 else if(settings.cediData!==undefined)throw Error('Los datos operativos del CEDI no se aplican a Smart Factory.');
 if(options.requireReady&&!availabilityValue.ready)throw Error(availabilityValue.reasons.join(' '));
 const units=id==='CEDI-03'?fixture.pickedBoxes:id==='SF-02'?fixture.kits:fixture.boxes||fixture.rawBodies||fixture.finishedSets||fixture.sets;
 // A material fixture belongs to the source practice; a generic old batch UI
 // must not silently replace six physical pallets by four anonymous boxes.
 if(options.units!==undefined&&Number(options.units)!==units)throw Error('La práctica utiliza su lote de fuente: '+units+' unidades.');
 const result=Object.assign({version:2,id,key:row.key,title:row.title,domain:row.domain,moduleId:MODULE_ID,kind:'configurable',units,expectedUnits:units,fixture,objective:row.objective,initialConditions:row.fixtureText,fixtureText:row.fixtureText,sourceRow:clone(row),interiorArea:clone(row.interiorArea),referenceLayout:{area:clone(row.interiorArea),coordinateMapping:'table-centres; X=x-width/2, Z=y-depth/2',equipment:clone(row.modes[settings.mode].equipment)},diagrams:clone(row.diagrams),sourceSha256:source.sources[1].sha256,sourceHashes:source.sources.map(s=>({filename:s.filename,sha256:s.sha256})),steps:row.steps.map((step,index)=>Object.assign({},step,{guard:GUARDS[index]})),modeDescription:clone(row.modes[settings.mode]),difficultyDescription:{id:'D'+settings.difficulty,name:['Guiada','Configurable','Diagnóstico y mejora'][settings.difficulty-1],text:'La dificultad es independiente de la automatización y del caso elegido.'},casesText:row.casesText,caseDescription:settings.caseId==='A'?'Caso base sin daños ni fallos aleatorios.':settings.caseId==='B'?'Alternativa compatible: comparar sin crear otra práctica.':row.casesText,result:row.result,indicators:clone(row.indicators),allowedChanges:row.allowedChanges,continuity:row.continuity,availability:availabilityValue,limits:'Escenario didáctico con activos y custodia nativos. Las cotas de fuente son hipótesis; no certifica equipos OEM, seguridad industrial ni rendimiento físico del visor.'},settings);
 if(id.startsWith('CEDI-')){result.operatingData=cediOperatingData.manifest(settings.cediData,id);result.operatingGuide=cediOperatingData.operationalGuide(settings);}
 const bindings=require('./LayoutBindings.cjs');result.layoutBindings=bindings.bindings(result);
 const aliases=new Set(result.layoutBindings.map(r=>r.alias));for(const key of Object.keys(settings.equipmentSelections))if(!aliases.has(key))throw Error('El alias elegido no pertenece al montaje: '+key);
 for(const row of settings.layout.overrides)if(!aliases.has(row.alias))throw Error('El alias de posición no pertenece al montaje: '+row.alias);
 return result;
}
function workflowRequirements(value){const p=typeof value==='string'?plan(value):value,aliases=p.layoutBindings.map(row=>row.alias);return p.steps.map((step,index)=>({id:step.id,guard:step.guard,title:step.title,action:step.action,eventId:p.id.toLowerCase()+'-stage-'+(index+1),requiredEvent:p.id.toLowerCase()+'-stage-'+(index+1),actorAliases:(p.id==='CEDI-01'?[['E01','E02','E08'],['E01','E02','E03'],['E03','E04'],['E04','E05','E07'],['E04','E08'],['E07','E08']]:Array(6).fill(aliases))[index]}));}
function list(){return source.records.map(row=>({id:row.id,key:row.key,title:row.title,domain:row.domain,objective:row.objective,moduleId:MODULE_ID,cases:['A','B','C'],modes:MODES.slice(),availability:MODES.map(mode=>availability(row.id,mode)),steps:row.steps.map((step,index)=>Object.assign({},step,{guard:GUARDS[index]})),fixtureText:row.fixtureText,diagrams:clone(row.diagrams)}));}
module.exports={version:2,MODES,GUARDS,MODULE_ID,FIXTURES,VERIFIED_MATERIAL,entry,list,plan,availability,workflowRequirements,matrix:()=>list().map(row=>({id:row.id,modes:row.availability})),normalizedOptions};
