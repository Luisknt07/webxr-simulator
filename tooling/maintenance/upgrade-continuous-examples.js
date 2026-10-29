const __layout = require("../layout.cjs");
'use strict';
// Default: prepare a candidate and run physical QA without any project write.
// A separately reviewed artifact is required by the one-PUT apply phase.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const schema = require('../../modules/logistica-industrial/contracts/behaviors'), {validateDocument} = require('../../apps/api/server/validation');
const {hash, bytesHash, request, requestRaw, withBrowser, editorInterior, editorWideInterior} = require('./upgrade-cedi-examples');
const {installContinuousQA, verifyContinuousInventory} = require('./continuous-inventory-qa');
const ROOT = __layout.map(path.resolve(__layout.oldDir("scripts/upgrade-continuous-examples.js"), '..')), OUTPUT = __layout.map(path.join(ROOT, 'data/qa-studio'));
const PROJECT = '194c1284-1c6e-4f2a-b089-9c540ed6e32b', ORIGINAL = 'ce14b39b-5d77-45ea-a85e-1d7e0d76e872';
const BASE_HASH = 'b445473c0d64ca8b8401b5fe200773791ec1e370aa40a4e572a88506381371c5', ORIGINAL_HASH = '9a990ce7925ca3ca84a98fa02d363c9cef4da0f2a8bba961491e23dab54b3cac';
const ROOMS = ['photogrammetry', 'vertigo', 'sound'], NAMES = ['CEDI · Clasificación y consolidación', 'CEDI · Packing y transferencias', 'Laboratorio industrial · Ejemplos'];
const SCOPED = ['environments', 'entities', 'spawns', 'groups', 'widgets', 'missions'];
const option = key => { const index = process.argv.indexOf(key); return index < 0 ? null : process.argv[index + 1]; }, clone = value => JSON.parse(JSON.stringify(value));
function differences(before, after, prefix = '', result = []) {
  if (before === after) return result;
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') result.push({path: prefix, before, after});
  else [...new Set(Object.keys(before).concat(Object.keys(after)))].forEach(key => differences(before[key], after[key], prefix + '/' + key, result)); return result;
}
function targetRooms(document) { ROOMS.forEach((id, index) => { const matches = document.studio.scenes.filter(scene => scene.name === NAMES[index]); assert.equal(matches.length, 1); assert.equal(matches[0].id, id); assert(document.rooms[id]); }); }
function guardContinuousCandidate(before, candidate) {
  targetRooms(before); targetRooms(candidate); assert.deepEqual(Object.keys(candidate.rooms).sort(), Object.keys(before.rooms).sort());
  const document = clone(before), restoredPrecision = [];
  Object.keys(before.rooms).filter(id => !ROOMS.includes(id)).forEach(id => {
    if (hash(candidate.rooms[id]) === hash(before.rooms[id])) return;
    const delta = differences(before.rooms[id], candidate.rooms[id]);
    assert(delta.every(row => /\/quaternion\/[0-3]$/.test(row.path) && typeof row.before === 'number' && typeof row.after === 'number' && Math.abs(row.before - row.after) <= 1e-12), 'A protected room changed beyond quaternion roundoff: ' + id);
    restoredPrecision.push({roomId: id, components: delta.length, propertyOrderOnly: delta.length === 0});
  });
  ROOMS.forEach(id => { document.rooms[id] = clone(candidate.rooms[id]); });
  [...new Set(Object.keys(before).concat(Object.keys(candidate)))].filter(key => !['rooms','studio'].includes(key)).forEach(key => assert.deepEqual(differences(before[key], candidate[key]), [], 'Unrelated project field changed: ' + key));
  const previous = before.studio || {}, next = candidate.studio || {};
  [...new Set(Object.keys(previous).concat(Object.keys(next)))].forEach(key => {
    if (!SCOPED.includes(key)) return assert.deepEqual(differences(previous[key], next[key]), [], 'Unrelated Studio field changed: ' + key);
    const outside = (previous[key] || []).filter(value => !ROOMS.includes(value.roomId)), current = (next[key] || []).filter(value => !ROOMS.includes(value.roomId));
    assert.deepEqual(differences(outside, current), [], 'Unrelated Studio record changed: ' + key);
    if (previous[key] === undefined && next[key] === undefined) return;
    let index = 0; document.studio[key] = (next[key] || []).map(value => clone(ROOMS.includes(value.roomId) ? value : outside[index++]));
  });
  const canonical = validateDocument(document, value => value); assert.deepEqual(differences(document, canonical), [], 'Validation changed a candidate value.');
  const protectedRooms = Object.keys(before.rooms).filter(id => !ROOMS.includes(id)).map(id => ({roomId: id, hash: hash(before.rooms[id])}));
  protectedRooms.forEach(row => { assert.equal(hash(document.rooms[row.roomId]), row.hash); assert.equal(hash(canonical.rooms[row.roomId]), row.hash, 'Validation may not reorder a protected room.'); });
  assert.equal(hash(canonical.studio), hash(document.studio), 'Validation may not reorder Studio.');
  return {document, canonical, protectedRooms, restoredPrecision, reviewedPayloadHash: hash(document), storedPayloadHash: hash(canonical)};
}
function verifyContinuousManifest(manifest, document) {
  assert.equal(manifest.scenarios.length, 3); const allVariants = new Set(), allFields = new Set(), allModes = new Set(), allTypes = new Set(), palletUnits = new Set();
  const baseLines = [
    ['attribute-sorting','pallet-logistics','manual-loading-table','manual-manual-station'],
    ['packing-units','multilevel-mixed','pallet-logistics','manual-loading-table','manual-manual-station'],
    ['transfer-l','sorting','merge','elevator','pallets','assembly','rectangle','gravity','manual-l']
  ];
  const machineTypes = ['source','conveyor','processor','palletQueue','robot','vehicle'];
  manifest.scenarios.forEach((scene, index) => {
    assert.equal(scene.roomId, ROOMS[index]); assert.equal(scene.kind, ['sorting','packing','lab'][index]); assert.equal(scene.continuous, true);
    // Accept the reviewed legacy recipe or that exact recipe plus its one
    // supported manual-forklift expedition. Extra/duplicate/replaced lines fail.
    const expedition = scene.lines.some(line => line.id === 'robotics-expedition');
    assert.deepEqual(scene.lines.map(line => line.id), baseLines[index].concat(expedition ? ['robotics-expedition'] : []), 'Unexpected continuous recipe lines.');
    const rows = new Map(document.rooms[scene.roomId].additions.map(row => [row.id, row]));
    const row = id => { const value = rows.get(id); assert(value, 'Manifest object is missing: ' + id); return value; };
    const config = id => row(id).behaviors.find(value => machineTypes.includes(value.type));
    scene.lines.forEach(line => {
      const forkliftLine = line.id === 'robotics-expedition', manualAnnex = line.id.startsWith('manual-') && index !== 2;
      assert.equal(line.mode, forkliftLine || manualAnnex ? 'manual' : 'automatic');
      assert(Array.isArray(line.memberIds) && line.memberIds.length, 'Every manifest line needs explicit memberIds.');
      assert.equal(new Set(line.memberIds).size, line.memberIds.length, 'Line members may not repeat.');
      assert(line.sourceIds.length && line.receiverIds.length && line.memberIds.includes(line.controllerId));
      line.sourceIds.concat(line.receiverIds).forEach(id => assert(line.memberIds.includes(id), 'Sources and receivers must belong to their line.'));
      const members = line.memberIds.map(id => {
        const value = config(id);
        assert(value || forkliftLine && row(id).behaviors.some(value => value.type === 'info'), 'Unsupported manifest member: ' + id);
        return value;
      }).filter(Boolean);
      assert.equal(members.filter(value => value.withPanel).length, 1); assert(config(line.controllerId).withPanel);
      const monitor = rows.get(line.monitorId)?.behaviors.find(value => value.type === 'lineMonitor'); assert(monitor && monitor.targetId === line.controllerId && monitor.scope === 'line');
      line.sourceIds.forEach(id => { const value = config(id); assert.equal(value.type, 'source'); if (manualAnnex) { assert(!value.autoGenerate); assert.equal(value.initialCount, 0); } else { assert(value.autoGenerate); assert.equal(value.totalLimit, 0, 'Every automatic Source is truly unlimited.'); } (JSON.parse(value.catalog || '[]')).forEach(spec => { allTypes.add(spec.type); if (value.loadMode === 'pallet') palletUnits.add(schema.productSources.unitsFor(value, spec)); }); });
      line.receiverIds.forEach(id => { const value = config(id); assert.equal(value.type, 'palletQueue'); if (manualAnnex || forkliftLine) return; assert.equal(value.layoutMode, 'fit'); assert.equal(value.layers, 5); assert.equal(value.palletCapacity, 4); assert(value.autoRelease && value.autoReleasePressure); assert.equal(value.releasePolicy, 'stockFull'); });
      line.memberIds.filter(id => config(id)?.type === 'robot').forEach(id => {
        const value = config(id);
        assert(!value.withPanel); assert(line.memberIds.includes(value.sourceId) && line.memberIds.includes(value.outputId), 'Robot transfers stay inside their line.');
        assert.equal(config(value.sourceId).outputId, id, 'The robot must replace a real upstream connection.');
      });
      if (forkliftLine) {
        assert.equal(line.memberIds.length, 5, 'Expedition requires its four machines and guide.');
        assert.deepEqual(members.map(value => value.type).sort(), ['conveyor','palletQueue','source','vehicle']);
        assert.equal(line.sourceIds.length, 1); assert.equal(line.receiverIds.length, 1);
        const source = config(line.sourceIds[0]), pickup = config(line.controllerId), stock = config(line.receiverIds[0]), vehicle = members.find(value => value.type === 'vehicle');
        assert.equal(source.loadMode, 'pallet'); assert.equal(source.outputId, line.controllerId); assert.equal(source.delivery, 'automatic');
        const catalogue = JSON.parse(source.catalog); assert(catalogue.length); catalogue.forEach(spec => { assert.equal(spec.type, 'box'); assert.equal(schema.productSources.unitsFor(source, spec), 12, 'Expedition preserves twelve real units per pallet.'); });
        assert.equal(pickup.type, 'conveyor'); assert.equal(pickup.equipmentId, 'conveyor.pallet-chain'); assert.equal(pickup.outputId, ''); assert.equal(pickup.maxPackages, 1); assert(pickup.withSensors);
        const automation = row(line.controllerId).behaviors.find(value => value.type === 'automation');
        assert(automation && JSON.parse(automation.rules).some(rule => rule.sourceId === line.controllerId && rule.variable === 'transferBlocked' && rule.operator === 'eq' && rule.value === true && rule.targetId === line.controllerId && rule.targetVariable === 'running' && rule.set === false && rule.edge === 'rising'), 'Expedition pickup requires its actual blocked-output stop interlock.');
        assert.equal(vehicle.mode, 'manual'); assert(schema.vehicles.supports(vehicle).forks); assert.equal(vehicle.sourceId, line.controllerId); assert.equal(vehicle.outputId, line.receiverIds[0]);
        assert(stock.acceptsPallets); assert.equal(stock.delivery, 'manual'); assert.equal(stock.autoRelease, false); assert.equal(stock.palletCapacity, 2); assert.equal(stock.columns * stock.rows * stock.layers, 1);
      } else assert(!members.some(value => value.type === 'vehicle'), 'Forklifts belong only to the explicit expedition line.');
      members.filter(value => value.type === 'conveyor').forEach(value => { allVariants.add(value.equipmentId); if (['rules','percentage','alternate'].includes(value.routing)) allModes.add(value.routing); if (value.routing === 'rules') JSON.parse(value.routingRules).forEach(rule => allFields.add(rule.field)); });
    });
  });
  assert.deepEqual([...allVariants].filter(Boolean).sort(), schema.conveyorEquipment.listEquipment({readyOnly: true}).map(value => value.id).sort());
  assert.deepEqual([...allFields].sort(), schema.conveyorRouting.fields.map(value => value.value).sort()); assert.deepEqual([...allModes].sort(), ['alternate','percentage','rules']); assert.deepEqual([...allTypes].sort(), ['bottle','box','crate','drum']);
  assert(palletUnits.has(20) && palletUnits.has(30), 'The catalogue includes actual fitted 20- and 30-unit pallets.');
  return {variants: [...allVariants].sort(), fields: [...allFields].sort(), modes: [...allModes].sort(), productTypes: [...allTypes].sort(), preassembledUnits: [...palletUnits].sort((a,b)=>a-b)};
}

function verifyContinuousArtifact(artifact,before){
  assert.equal(artifact.format,'hello-webxr-verified-continuous-upgrade');assert.equal(artifact.version,1);assert.equal(artifact.projectId,PROJECT);assert.equal(artifact.expectedRevision,13);
  assert.equal(hash(before),artifact.baseHash);assert.equal(hash(artifact.document),artifact.reviewedPayloadHash);assert.equal(hash(artifact.manifest),artifact.manifestHash);assert.equal(artifact.original.hash,ORIGINAL_HASH);assert.equal(artifact.original.revision,9);
  const safe=guardContinuousCandidate(before,artifact.document);assert.equal(safe.storedPayloadHash,artifact.storedPayloadHash);verifyContinuousManifest(artifact.manifest,artifact.document);
  if(artifact.qa.amendment){require('./continuous-amendment-qa').verifyAmendment(artifact.qa.amendment,artifact.document,artifact.manifest,artifact.bundleHash);const stations=artifact.qa.manual.filter(value=>value.lineId==='manual-manual-station');assert.deepEqual(stations.map(value=>value.roomId),['photogrammetry','vertigo']);stations.forEach(value=>{assert.deepEqual(value.analytics.map(row=>row.phase),['waitingOperator','waitingManualAction']);value.analytics.forEach(row=>{assert.equal(row.state,'idle');assert(Math.abs(row.idleDelta-1)<1e-5);assert(Math.abs(row.busyDelta)<1e-6);});});}
  assert.deepEqual(artifact.qa.physicalEvidence.map(value=>value.roomId),ROOMS);
  artifact.qa.physicalEvidence.forEach(value=>{assert.equal(value.roomDocumentHash,hash(artifact.document.rooms[value.roomId]));if(value.bundleHash!==artifact.bundleHash){assert(artifact.qa.amendment&&['photogrammetry','vertigo'].includes(value.roomId));assert.equal(value.bundleHash,artifact.qa.amendment.evidenceOldBundleHash);assert.equal(value.roomDocumentHash,artifact.qa.amendment.preservedRoomHashes[value.roomId]);}});
  assert.equal(artifact.qa.passed,true);assert.equal(artifact.qa.flows.length,3);artifact.qa.flows.forEach((flow,index)=>{assert.equal(flow.roomId,ROOMS[index]);verifyContinuousInventory(flow,artifact.manifest.scenarios[index],artifact.document);});return safe;
}
function assertStored(before,artifact,current){
  assert.deepEqual(differences(artifact.document,current),[],'The saved server values differ from the reviewed candidate.');assert.equal(hash(current),artifact.storedPayloadHash);
  Object.keys(before.rooms).filter(id=>!ROOMS.includes(id)).forEach(id=>assert.equal(hash(current.rooms[id]),hash(before.rooms[id]),'Protected room changed after save: '+id));assert.equal(hash(current.studio),hash(artifact.document.studio));
}
function verifyResumeTrial(trial,before,candidate,manifest,bundleHash){
  assert.equal(trial.format,'hello-webxr-continuous-qa-trial');assert.equal(trial.expectedRevision,13);assert.equal(trial.baseHash,hash(before));assert.equal(trial.bundleHash,bundleHash);assert.equal(trial.documentHash,hash(candidate));assert.equal(trial.manifestHash,hash(manifest));
  if(trial.amendment)require('./continuous-amendment-qa').verifyAmendment(trial.amendment,candidate,manifest,bundleHash);
  Object.keys(trial.flows).forEach(id=>{assert(ROOMS.includes(id));assert(/^[a-f0-9]{64}$/.test(trial.flows[id].hash));assert.equal(trial.flows[id].seconds,900);if(trial.flows[id].evidenceBundleHash&&trial.flows[id].evidenceBundleHash!==bundleHash){assert(trial.amendment&&['photogrammetry','vertigo'].includes(id));assert.equal(trial.flows[id].evidenceBundleHash,trial.amendment.evidenceOldBundleHash);assert.equal(trial.flows[id].roomDocumentHash,trial.amendment.preservedRoomHashes[id]);}});return trial;
}
async function dryRun(before,original,bundleHash){
  return withBrowser(PROJECT,async b=>{
    assert.equal(await b.evaluate('context.editor.currentProject.revision'),13);
    const resume=process.argv.includes('--resume'),trialFile=__layout.map(path.join(OUTPUT,'continuous-qa-trial.json'));
    let manifest,candidate,trial;
    if(resume){
      manifest=JSON.parse(fs.readFileSync(__layout.map(path.join(OUTPUT,'continuous-manifest.json')),'utf8'));candidate=guardContinuousCandidate(before.document,JSON.parse(fs.readFileSync(__layout.map(path.join(OUTPUT,'continuous-unverified-payload.json')),'utf8')));trial=verifyResumeTrial(JSON.parse(fs.readFileSync(trialFile,'utf8')),before.document,candidate.document,manifest,bundleHash);
      await b.evaluate('(async()=>{await context.editor.applyServerProject('+JSON.stringify({...before,document:candidate.document})+');return true})()');
    }else{
      manifest=await b.evaluate('context.editor.studioTools.refreshCediExamples({continuous:true,includeLab:true})');candidate=guardContinuousCandidate(before.document,await b.evaluate('(async()=>context.editor.document.serialize())()'));
      trial={format:'hello-webxr-continuous-qa-trial',createdAt:new Date().toISOString(),expectedRevision:13,baseHash:hash(before.document),bundleHash,documentHash:candidate.reviewedPayloadHash,manifestHash:hash(manifest),flows:{}};fs.writeFileSync(trialFile,JSON.stringify(trial,null,2));
    }
    const coverage=verifyContinuousManifest(manifest,candidate.document),flows=[],views=[],manual=[],resumed=[];
    const verifyManualWait=async(id,phase)=>{
      const expression='(()=>{const r=context.editor.simulation,a=r.getAnalyticsSnapshot('+JSON.stringify(id)+',"module");return{phase:r.records.get('+JSON.stringify(id)+').variables.mechanismPhase,state:a.machines[0].state,summary:a.summary}})()';
      const first=await b.evaluate(expression);assert.equal(first.phase,phase);await b.evaluate('__continuousQA.advance(1)');const last=await b.evaluate(expression);
      assert.equal(last.phase,phase);assert.equal(last.state,'idle');assert(Math.abs(last.summary.busySeconds-first.summary.busySeconds)<1e-6);assert(Math.abs(last.summary.idleSeconds-first.summary.idleSeconds-1)<1e-5);
      return{phase,state:last.state,idleDelta:last.summary.idleSeconds-first.summary.idleSeconds,busyDelta:last.summary.busySeconds-first.summary.busySeconds};
    };
    fs.writeFileSync(__layout.map(path.join(OUTPUT,'continuous-before-rev13.json')),JSON.stringify(before));fs.writeFileSync(__layout.map(path.join(OUTPUT,'continuous-unverified-payload.json')),JSON.stringify(candidate.document));fs.writeFileSync(__layout.map(path.join(OUTPUT,'continuous-manifest.json')),JSON.stringify(manifest,null,2));
    for(const scene of manifest.scenarios){
      if(option('--diagnose-room')&&scene.roomId!==option('--diagnose-room'))continue;
      await b.evaluate('(async()=>{const e=context.editor;if(!e.active)e.enter();await e.hooks.gotoRoom('+schema.studio.ROOM_IDS.indexOf(scene.roomId)+');e.entities.sync();e.home();return true})()');
      const view=await b.evaluate('('+editorInterior.toString()+')('+JSON.stringify(scene.roomId)+')');assert(view.inside&&view.belowCeiling&&view.gl===0);views.push({...view,roomId:scene.roomId});await b.screenshot('continuous-'+scene.roomId+'-interior');
      const wide=await b.evaluate('('+editorWideInterior.toString()+')('+JSON.stringify(scene.roomId)+')');assert(wide.inside&&wide.belowCeiling&&wide.gl===0);views.push({...wide,roomId:scene.roomId,kind:'layout'});await b.screenshot('continuous-'+scene.roomId+'-layout');await b.evaluate('context.editor.home()');
      const authored=await b.evaluate('(async()=>context.editor.document.serialize())()');await b.evaluate('context.editor.leave();context.editor.simulationPaused=true');await b.evaluate('('+installContinuousQA.toString()+')('+JSON.stringify(scene)+')');
      const palletSource=await b.evaluate('__continuousQA.lines.flatMap(line=>line.sourceIds).find(id=>context.editor.simulation.records.get(id).components.source.config.loadMode==="pallet")');
      if(palletSource){const frame=await b.evaluate('__continuousQA.frameObject('+JSON.stringify(palletSource)+')');views.push({...frame,roomId:scene.roomId,kind:'pallet-source'});await b.screenshot('continuous-'+scene.roomId+'-pallet-source');}
      const diagnostic=Boolean(option('--diagnose-seconds')),duration=diagnostic?Number(option('--diagnose-seconds')):900,receipt=resume&&!diagnostic&&trial.flows[scene.roomId],flowFile=__layout.map(path.join(OUTPUT,'continuous-'+scene.roomId+'-flow.json'));
      let actual;
      if(receipt){
        const bytes=fs.readFileSync(flowFile);assert.equal(bytesHash(bytes),receipt.hash);actual=JSON.parse(bytes);verifyContinuousInventory(actual,scene,candidate.document);resumed.push({roomId:scene.roomId,flowHash:receipt.hash,seconds:actual.seconds,controls:'fresh runtime after verified physical run'});console.log(scene.kind,'reused verified '+actual.seconds+'s physical evidence; testing controls in a fresh runtime');
      }else{
      try{
        for(let seconds=0;seconds<duration;seconds+=10){
          const value=await b.evaluate('__continuousQA.advance('+Math.min(10,duration-seconds)+')');
          if((seconds+10)%300===0)await b.evaluate('__continuousQA.wave()');
          if(seconds%60===0||seconds+10>=duration)console.log(scene.kind,value.seconds+'s','generated '+value.generatedUnits,'dispatched '+value.dispatchedUnits,'live '+value.liveLoads);
        }
      }catch(error){fs.writeFileSync(__layout.map(path.join(OUTPUT,'continuous-'+scene.roomId+'-failure.json')),JSON.stringify(await b.evaluate('__continuousQA.snapshot()'),null,2));throw error;}
      actual=await b.evaluate('__continuousQA.snapshot()');fs.writeFileSync(flowFile,JSON.stringify(actual,null,2));
      }
      if(diagnostic){await b.evaluate('__continuousQA.restore();context.editor.enter()');assert.deepEqual(b.writes,[]);return{verified:false,diagnostic:true,roomId:scene.roomId};}
      const result=verifyContinuousInventory(actual,scene,candidate.document);flows.push(result);
      if(!receipt){trial.flows[scene.roomId]={hash:bytesHash(fs.readFileSync(flowFile)),seconds:actual.seconds};fs.writeFileSync(trialFile,JSON.stringify(trial,null,2));}
      const suffix=receipt?'-reopen':'',stock=scene.lines.find(line=>line.id==='pallet-logistics'||line.id==='pallets')||scene.lines[0];views.push({...await b.evaluate('__continuousQA.frameObject('+JSON.stringify(stock.receiverIds[0])+')'),roomId:scene.roomId,kind:'stock'+suffix});await b.screenshot('continuous-'+scene.roomId+'-stock'+suffix);
      for(let index=0;index<scene.lines.length;index++){
        await b.evaluate('__continuousQA.frameMonitor('+index+',"diagram")');await b.screenshot('continuous-'+scene.roomId+'-monitor-'+(index+1)+suffix);
        await b.evaluate('__continuousQA.press('+index+',"pause")');await b.evaluate('__continuousQA.press('+index+',"start")');
      }
      for(const page of ['analytics','control','equipment']){await b.evaluate('__continuousQA.frameMonitor(0,'+JSON.stringify(page)+')');await b.screenshot('continuous-'+scene.roomId+'-'+page+suffix);}
      for(let index=0;index<scene.lines.length;index++)if(scene.lines[index].mode==='manual'){
        const line=scene.lines[index];await b.evaluate('__continuousQA.frameMonitor('+index+',"control",'+JSON.stringify(line.sourceIds[0])+')');const ray=await b.evaluate('__continuousQA.press('+index+',"equipment-action-generate")');await b.evaluate('__continuousQA.advance(5)');
        const stationId=await b.evaluate('__continuousQA.lines['+index+'].memberIds.find(id=>context.editor.simulation.records.get(id).components.conveyor)');
        const analytics=[];
        if(line.id==='manual-manual-station'){
          assert.equal(await b.evaluate('context.editor.simulation.records.get('+JSON.stringify(stationId)+').variables.mechanismPhase'),'waitingOperator');analytics.push(await verifyManualWait(stationId,'waitingOperator'));await b.evaluate('__continuousQA.frameMonitor('+index+',"control",'+JSON.stringify(stationId)+')');await b.evaluate('__continuousQA.press('+index+',"equipment-action-operator")');await b.evaluate('__continuousQA.advance(1)');assert.equal(await b.evaluate('context.editor.simulation.records.get('+JSON.stringify(stationId)+').variables.mechanismPhase'),'waitingManualAction');analytics.push(await verifyManualWait(stationId,'waitingManualAction'));await b.screenshot('continuous-'+scene.roomId+'-manual-operator');await b.evaluate('__continuousQA.press('+index+',"equipment-action-dispatch")');await b.evaluate('__continuousQA.advance(15)');assert.equal(await b.evaluate('context.editor.simulation.records.get('+JSON.stringify(line.receiverIds[0])+').variables.receivedUnits'),1);
        }else{assert.equal(await b.evaluate('context.editor.simulation.records.get('+JSON.stringify(line.sourceIds[0])+').components.source.queue.length'),1);await b.screenshot('continuous-'+scene.roomId+'-manual-grab-ready');}
        manual.push({roomId:scene.roomId,lineId:line.id,expectedAutomaticUnits:0,demonstrated:true,ray,analytics});
      }
      await b.evaluate('__continuousQA.restore();context.editor.enter()');assert.deepEqual(differences(authored,await b.evaluate('(async()=>context.editor.document.serialize())()')),[],'QA changed an authored recipe or pose.');
    }
    assert.equal(flows.length,3);const final=guardContinuousCandidate(before.document,await b.evaluate('(async()=>context.editor.document.serialize())()'));assert.equal(final.reviewedPayloadHash,candidate.reviewedPayloadHash);
    assert.deepEqual(b.writes,[]);assert.deepEqual(b.exceptions,[]);assert.deepEqual(b.consoleErrors,[]);assert.equal(bytesHash(await requestRaw('/bundle.js')),bundleHash,'Frontend changed during QA.');
    const saved=(await request('/api/projects/'+PROJECT)).project,protectedNow=(await request('/api/projects/'+ORIGINAL)).project;assert.equal(saved.revision,13);assert.equal(hash(saved.document),BASE_HASH);assert.equal(protectedNow.revision,9);assert.equal(hash(protectedNow.document),ORIGINAL_HASH);
    const physicalEvidence=ROOMS.map(roomId=>({roomId,bundleHash:trial.flows[roomId].evidenceBundleHash||bundleHash,roomDocumentHash:hash(final.document.rooms[roomId])}));
    const artifact={format:'hello-webxr-verified-continuous-upgrade',version:1,createdAt:new Date().toISOString(),projectId:PROJECT,expectedRevision:13,baseHash:BASE_HASH,reviewedPayloadHash:final.reviewedPayloadHash,storedPayloadHash:final.storedPayloadHash,bundleHash,beforeFile:__layout.map(path.join(OUTPUT,'continuous-before-rev13.json')),manifest,manifestHash:hash(manifest),original:{revision:original.revision,hash:hash(original.document)},document:final.document,preservation:{protectedRooms:final.protectedRooms,restoredPrecision:final.restoredPrecision},qa:{passed:true,flows,coverage,manual,views,shots:b.shots,resumed,physicalEvidence,amendment:trial.amendment,writes:b.writes,exceptions:b.exceptions,consoleErrors:b.consoleErrors,intentionalTransport:b.transport}};
    verifyContinuousArtifact(artifact,before.document);const file=__layout.map(path.join(OUTPUT,'continuous-candidate.json')),bytes=JSON.stringify(artifact);fs.writeFileSync(file,bytes);fs.writeFileSync(__layout.map(path.join(OUTPUT,'continuous-report.json')),JSON.stringify({candidateFile:file,candidateHash:bytesHash(bytes),expectedRevision:13,baseHash:BASE_HASH,reviewedPayloadHash:artifact.reviewedPayloadHash,storedPayloadHash:artifact.storedPayloadHash,flows:flows.map(flow=>({roomId:flow.roomId,seconds:flow.seconds,generatedUnits:flow.generatedUnits,dispatchedUnits:flow.dispatchedUnits,peakLoads:flow.peakLoads})),coverage,preservation:artifact.preservation,shots:b.shots,writes:[],errors:[]},null,2));console.log(JSON.stringify({saved:false,verified:true,candidateFile:file,candidateHash:bytesHash(bytes),rooms:flows.length}));return artifact;
  });
}
async function applyCandidate(before,original,bundleHash){
  const file=__layout.map(path.resolve(option('--apply-candidate')));assert(file.startsWith(__layout.map(path.resolve(OUTPUT))+path.sep));const bytes=fs.readFileSync(file),reviewedHash=option('--candidate-hash');assert(/^[a-f0-9]{64}$/.test(reviewedHash||''));assert.equal(bytesHash(bytes),reviewedHash);const artifact=JSON.parse(bytes);verifyContinuousArtifact(artifact,before.document);assert.equal(artifact.bundleHash,bundleHash);
  const history=(await request('/api/projects/'+PROJECT+'/revisions')).revisions;
  return withBrowser(PROJECT,async b=>{
    assert.equal(await b.evaluate('context.editor.currentProject.revision'),13);assert.deepEqual(b.writes,[]);
    const saved=await b.evaluate('context.editor.projectClient.updateProject('+JSON.stringify(PROJECT)+','+JSON.stringify(before.name)+','+JSON.stringify(artifact.document)+',13).then(project=>({id:project.id,revision:project.revision}))');assert.equal(saved.revision,14);assert.deepEqual(b.writes,[{method:'PUT',url:'https://localhost:8080/api/projects/'+PROJECT}]);
    const current=(await request('/api/projects/'+PROJECT)).project,protectedNow=(await request('/api/projects/'+ORIGINAL)).project,revisions=(await request('/api/projects/'+PROJECT+'/revisions')).revisions;assert.equal(current.revision,14);assertStored(before.document,artifact,current.document);assert.deepEqual(revisions.filter(value=>value.revision!==14),history);assert.equal(protectedNow.revision,original.revision);assert.equal(hash(protectedNow.document),ORIGINAL_HASH);assert.deepEqual(b.exceptions,[]);assert.deepEqual(b.consoleErrors,[]);
    fs.mkdirSync(__layout.map(path.join(ROOT,'data/exports')),{recursive:true});fs.writeFileSync(__layout.map(path.join(ROOT,'data/exports/industrial-cedi-complete.json')),JSON.stringify(current.document));fs.writeFileSync(__layout.map(path.join(OUTPUT,'continuous-after-rev14.json')),JSON.stringify(current));fs.writeFileSync(__layout.map(path.join(OUTPUT,'continuous-saved.json')),JSON.stringify({projectId:PROJECT,beforeRevision:13,revision:14,candidateHash:reviewedHash,baseHash:BASE_HASH,reviewedPayloadHash:artifact.reviewedPayloadHash,storedPayloadHash:hash(current.document),originalUnchanged:true,preservation:artifact.preservation,revisions,writes:b.writes,errors:[]},null,2));console.log(JSON.stringify({saved:true,revision:14,storedPayloadHash:hash(current.document),writes:b.writes.length}));return current;
  });
}
async function run(){
  assert.equal(option('--project')||PROJECT,PROJECT);assert.equal(Number(option('--expected-revision')),13,'Pass explicit --expected-revision 13.');fs.mkdirSync(OUTPUT,{recursive:true});
  const before=(await request('/api/projects/'+PROJECT)).project,original=(await request('/api/projects/'+ORIGINAL)).project;assert.equal(before.revision,13);assert.equal(hash(before.document),BASE_HASH);assert.equal(original.revision,9);assert.equal(hash(original.document),ORIGINAL_HASH);targetRooms(before.document);const bundleHash=bytesHash(await requestRaw('/bundle.js'));
  return option('--apply-candidate')?applyCandidate(before,original,bundleHash):dryRun(before,original,bundleHash);
}
module.exports = {guardContinuousCandidate, verifyContinuousManifest, verifyContinuousArtifact, verifyResumeTrial, assertStored, differences, targetRooms, ROOMS, NAMES, PROJECT, ORIGINAL, BASE_HASH, ORIGINAL_HASH};
if (require.main === module) run().catch(error=>{console.error(error);process.exitCode=1;});
