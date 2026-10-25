'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module'),THREE=require('three'),schema=require('../shared/behaviors');
const {validateDocument}=require('../server/validation'),{guardContinuousCandidate,verifyContinuousManifest,verifyResumeTrial,ROOMS,NAMES}=require('./upgrade-continuous-examples');
const {hash}=require('./upgrade-cedi-examples');
const amendment=require('./continuous-amendment-qa');
const file=path.join(__dirname,'test-industrial-lab-lines.js'),text=fs.readFileSync(file,'utf8');
const {harness,releaseGeometry}=new Function('require','__dirname',text.slice(0,text.indexOf('\nasync function run()'))+'\nreturn {harness,releaseGeometry};')(createRequire(file),__dirname);
const clone=value=>JSON.parse(JSON.stringify(value));
async function run(){
  const f=harness.setup();
  schema.studio.ROOM_IDS.filter(id=>id!=='hall').forEach(id=>{const root=new THREE.Group();f.scene.add(root);f.document.registerRoom(id,root);});
  schema.studio.ROOM_IDS.forEach(id=>{const object=f.document.addPrimitive(id,'box');f.document.setProperty(object,'name','Original '+id);});
  f.document.setStudio({scenes:schema.studio.ROOM_IDS.map(id=>({id,name:ROOMS.includes(id)?NAMES[ROOMS.indexOf(id)]:'Original '+id})),startRoomId:'sound',environments:schema.studio.ROOM_IDS.map(schema.studio.defaultEnvironment)});
  const before=validateDocument(await f.document.serialize(),value=>value),candidate=clone(before);
  ROOMS.forEach((id,index)=>{candidate.rooms[id].additions[0].position[0]=index+1;candidate.studio.environments.find(row=>row.roomId===id).skyColor='#345678';});
  const safe=guardContinuousCandidate(before,candidate);assert.equal(safe.protectedRooms.length,7);assert.notDeepEqual(safe.document.rooms.sound,before.rooms.sound);
  const trial={format:'hello-webxr-continuous-qa-trial',expectedRevision:13,baseHash:hash(before),bundleHash:'compiled-one',documentHash:hash(safe.document),manifestHash:hash({scenarios:[]}),flows:{sound:{hash:'a'.repeat(64),seconds:900}}};
  assert.equal(verifyResumeTrial(trial,before,safe.document,{scenarios:[]},'compiled-one'),trial);
  for(const key of ['baseHash','bundleHash','documentHash','manifestHash']){const broken=clone(trial);broken[key]='changed';assert.throws(()=>verifyResumeTrial(broken,before,safe.document,{scenarios:[]},'compiled-one'));}
  const short=clone(trial);short.flows.sound.seconds=899;assert.throws(()=>verifyResumeTrial(short,before,safe.document,{scenarios:[]},'compiled-one'));
  const oldWork="      useful = belt.packages.length > 0 && (Math.abs(belt.actualSpeed || 0) > 1e-7 || belt.mechanismPhase !== 'ready');",newWork="      const waitingForOperator = ['waitingOperator', 'waitingManualAction'].includes(belt.mechanismPhase);\n      useful = belt.packages.length > 0 && (Math.abs(belt.actualSpeed || 0) > 1e-7 || !waitingForOperator && belt.mechanismPhase !== 'ready');";
  const runtimeFile='src/editor/SimulationRuntime.js',labFile='src/editor/IndustrialLabLines.js',otherFile='src/index.js',oldRuntime='class Runtime {\n  productionRow(record) {\n'+oldWork+'\n  }\n\n  observeProduction(delta) { return delta; }\n}',oldRecipe="const options={routing: 'branch'};const supply=source('Source · entrada al circuito rectangular');";
  const beforeSources={[runtimeFile]:oldRuntime,[labFile]:oldRecipe,[otherFile]:'unmodified input controller'},currentSources={...beforeSources,[runtimeFile]:oldRuntime.replace(oldWork,newWork),[labFile]:oldRecipe.replace("routing: 'branch'","routing: continuous ? 'percentage' : 'branch', branchPercentage: continuous ? 90 : 50").replace("source('Source · entrada al circuito rectangular')","source('Source · entrada al circuito rectangular', continuous ? {outputInterval: 6} : {})")};
  const sourceBefore={sourceHash:amendment.sha(oldRuntime),method:amendment.productionMethod(oldRuntime).method,files:Object.fromEntries(Object.entries(beforeSources).map(([file,text])=>[file,amendment.sha(text)])),bundleHash:'old-compiled'};
  const sourceProof=amendment.verifySourceProof(sourceBefore,oldRuntime,file=>currentSources[file]);assert.deepEqual(sourceProof.changedFiles.sort(),[labFile,runtimeFile].sort());
  for(const [file,replace]of[[runtimeFile,text=>text.replace('return delta','return delta*2')],[runtimeFile,text=>text.replace('!waitingForOperator','false')],[labFile,text=>text+'extra recipe edit'],[otherFile,text=>text+'extra control edit']]){const changed={...currentSources,[file]:replace(currentSources[file])};assert.throws(()=>amendment.verifySourceProof(sourceBefore,oldRuntime,key=>changed[key]));}
  const oldRouting={rooms:{sound:{additions:[{id:'exit',name:'07 · Desvío · descarga del circuito',behaviors:[{type:'conveyor',routing:'branch',branchPercentage:50,outputId:'return',branchId:'stock'}]},{id:'source',behaviors:[{type:'source',interval:2,outputInterval:1.2}]}]},photogrammetry:{unchanged:true},vertigo:{unchanged:true}}},oldCopy=clone(oldRouting),patched=amendment.patchReturn(oldRouting,{scenarios:[{roomId:'sound',lines:[{id:'rectangle',memberIds:['exit','source'],sourceIds:['source']}]}]});
  assert.deepEqual(oldRouting,oldCopy);const expected=clone(oldRouting);expected.rooms.sound.additions[0].behaviors[0].routing='percentage';expected.rooms.sound.additions[0].behaviors[0].branchPercentage=90;expected.rooms.sound.additions[1].behaviors[0].outputInterval=6;assert.deepEqual(patched.document,expected);
  const reject=mutate=>{const changed=clone(candidate);mutate(changed);assert.throws(()=>guardContinuousCandidate(before,changed));};
  reject(value=>{value.rooms.hall.additions[0].name='Lost';});reject(value=>{value.rooms.panorama1.additions[0].position[0]+=1e-16;});
  reject(value=>{value.imports.push({id:'extra',path:'extra.png'});});reject(value=>{value.studio.startRoomId='photogrammetry';});reject(value=>{value.studio.scenes[0].name='Renamed';});
  reject(value=>{value.studio.environments.find(row=>row.roomId==='hall').skyColor='#ff0000';});reject(value=>{delete value.rooms.panorama2;});
  const rounded=clone(candidate);rounded.rooms.hall.additions[0].quaternion[2]+=Number.EPSILON;const repaired=guardContinuousCandidate(before,rounded);assert.deepEqual(repaired.document.rooms.hall,before.rooms.hall);assert.equal(repaired.restoredPrecision.length,1);
  const ordered=clone(candidate);ordered.rooms.hall.additions[0]=Object.fromEntries(Object.entries(ordered.rooms.hall.additions[0]).reverse());assert.deepEqual(guardContinuousCandidate(before,ordered).document.rooms.hall,before.rooms.hall);
  const builders=require('./load-industrial-cedi')(THREE,schema),scenarios=[];
  for(const [index,roomId]of ROOMS.entries()){
    f.document.resetRoom(roomId);const kind=['sorting','packing','lab'][index],built=kind==='lab'?builders.buildIndustrialLab(f.document,roomId,{scene:f.scene,continuous:true}):builders.buildIndustrialCediLevel(f.document,roomId,{kind,scene:f.scene,continuous:true}),lines=built.lines||built.cells;
    scenarios.push({roomId,kind,continuous:true,lines:lines.map(line=>({id:line.id,mode:line.mode,controllerId:line.controller.userData.editorId,monitorId:line.monitor.userData.editorId,memberIds:line.memberIds,sourceIds:line.sources.map(object=>object.userData.editorId),receiverIds:line.receivers.map(object=>object.userData.editorId)}))});
  }
  const full=guardContinuousCandidate(before,await f.document.serialize()),manifest={scenarios},coverage=verifyContinuousManifest(manifest,full.document);assert(coverage.preassembledUnits.includes(20)&&coverage.preassembledUnits.includes(30));
  const finite=clone(full.document),sourceId=scenarios[0].lines[0].sourceIds[0];finite.rooms.photogrammetry.additions.find(row=>row.id===sourceId).behaviors.find(value=>value.type==='source').totalLimit=16;assert.throws(()=>verifyContinuousManifest(manifest,finite),/unlimited/);
  const noDispatch=clone(full.document),stockId=scenarios[0].lines[0].receiverIds[0];noDispatch.rooms.photogrammetry.additions.find(row=>row.id===stockId).behaviors.find(value=>value.type==='palletQueue').autoRelease=false;assert.throws(()=>verifyContinuousManifest(manifest,noDispatch));
  const commandFile=path.join(__dirname,'test-cedi-levels.js'),commandText=fs.readFileSync(commandFile,'utf8'),{fixture:authoringFixture}=new Function('require','__dirname',commandText.slice(0,commandText.indexOf('\nasync function authoringTransactions()'))+'\nreturn {fixture};')(createRequire(commandFile),__dirname);
  const command=authoringFixture();command.document.setStudio({scenes:schema.studio.ROOM_IDS.map(id=>({id,name:ROOMS.includes(id)?NAMES[ROOMS.indexOf(id)]:'Keep '+id})),startRoomId:'hall'});
  const original=validateDocument(await command.document.serialize(),value=>value),history=command.document.undoStack.length,refreshed=await command.tools.refreshCediExamples({continuous:true,includeLab:true});
  assert.equal(command.document.studio.startRoomId,'hall','The real refresh command preserves the selected project start room even when the Lab builder selects sound internally.');
  const refreshedSafe=guardContinuousCandidate(original,await command.document.serialize());verifyContinuousManifest(refreshed,refreshedSafe.document);assert.equal(command.document.undoStack.length,history+1);
  command.document.undo();assert.deepEqual(await command.document.serialize(),original,'One undo restores all three old levels and their global settings.');releaseGeometry(command);
  releaseGeometry(f);console.log('Continuous upgrade guards: exactly three named rooms, seven literal protected rooms, scoped metadata, fixed labels/start/imports and bounded quaternion-only repair passed without database writes.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
