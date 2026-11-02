import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const source=require('../../modules/logistica-industrial/practices/configurable/data/source.json');
const proof=require('../fixtures/configurable-practice-source-proof.json');
const costs=require('../support/practice-render-costs.cjs');
const MODES=['manual','semiautomatic','automatic'],CODES=['M','S','A'];
const OUTPUT=path.join(ROOT,'data/qa-studio/configurable-practices/native-matrix.json');
const files=['modules/logistica-industrial/practices/configurable/Recipes.cjs','modules/logistica-industrial/practices/configurable/LayoutBindings.cjs','modules/logistica-industrial/practices/configurable/runtime/ConfigurablePracticeScene.js','modules/logistica-industrial/practices/configurable/data/source.json'];
const hashes=()=>Object.fromEntries(files.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex')]));
const same=(a,b,message)=>assert(Math.abs(a-b)<1e-6,message+': '+a+' != '+b);

test('renderer cost convention excludes replaced bodies, single materials do not multiply box groups, and material arrays use draw ranges',()=>{
 const THREE=require('three'),root=new THREE.Group(),box=new THREE.BoxBufferGeometry(1,1,1),material=new THREE.MeshBasicMaterial();
 root.add(new THREE.Mesh(box,material));const hidden=new THREE.Group();hidden.visible=false;hidden.add(new THREE.Mesh(box,material));root.add(hidden);
 const replaced=new THREE.Group();replaced.userData.editorGeometryReplaced=true;replaced.add(new THREE.Mesh(box,material));root.add(replaced);
 let result=costs([root,root]);assert.equal(result.drawCalls,1);assert.equal(result.triangles,12);assert.equal(result.resident.meshes,3);assert.equal(result.resident.hiddenOrUndrawnMeshes,2);
 root.children[0].material=Array(6).fill(material);result=costs([root]);assert.equal(result.drawCalls,6);assert.equal(result.triangles,12);
 box.setDrawRange(0,6);result=costs([root]);assert.equal(result.drawCalls,1);assert.equal(result.triangles,2);box.dispose();material.dispose();
});

test('ten source practices produce thirty separately selected native configurations with honest readiness, source identity and measured rendering budgets',()=>{
 const native=require('../support/load-practice-scenes.cjs')(),startedAt=new Date().toISOString(),loadedSourceHashes=hashes(),rows=[],failures=[];
 const budgets={triangleLimit:200000,drawCallReviewTarget:250,drawCallRegressionLimit:400};
 let mappings=0,readyCount=0;
 try{
  assert.deepEqual(source.records.map(row=>row.id),proof.ids);
  for(const record of source.records)for(let modeIndex=0;modeIndex<MODES.length;modeIndex++){
   const mode=MODES[modeIndex],fixture=native.fixture(),row={id:record.id,mode,caseId:'A'},table=proof.modeTables.find(t=>t.practiceId===record.id&&t.mode===CODES[modeIndex]);
   try{
    const options={mode,caseId:'A',difficulty:1,scene:fixture.scene},availability=native.configurableRecipes.availability(record.id,mode,options);row.ready=availability.ready;
    if(!availability.ready){const before=fixture.document.getObjects('hall').map(o=>o.userData.editorId);assert.throws(()=>native.buildConfigurablePracticeScene(fixture.document,'hall',record.id,{...options,requireReady:true}));assert.deepEqual(fixture.document.getObjects('hall').map(o=>o.userData.editorId),before,'An unavailable evaluated run cannot author actors or cargo.');row.rejectsExecutionBeforeAuthoring=true;}
    else readyCount++;
    const built=native.buildConfigurablePracticeScene(fixture.document,'hall',record.id,options),aliases=built.manifest.aliases;
    assert.equal(aliases.length,table.rows.length);assert.equal(new Set(aliases.map(a=>a.alias)).size,aliases.length);assert.equal(new Set(aliases.map(a=>a.objectId)).size,aliases.length);
    for(const authored of record.modes[mode].equipment){
     const binding=aliases.find(a=>a.alias===authored.alias),object=fixture.document.getObject(binding.objectId);assert(object&&object.parent);
     assert.equal(binding.sourceName,authored.name);assert.deepEqual(binding.sourceCenterDocument,authored.center);assert.deepEqual(binding.sourceDimensions,authored.footprint);
     assert.deepEqual(binding.sourceCenter,[authored.center[0]-record.interiorArea.width/2,0,authored.center[1]-record.interiorArea.depth/2]);
     assert.equal(object.userData.configurablePracticeAlias,authored.alias);assert.equal(object.userData.configurablePracticeId,record.id);assert.equal(binding.actualCatalogueEquipmentId,binding.catalogueEquipmentId);
     assert.deepEqual(object.scale.toArray(),[1,1,1],'Factory dimensions may configure a mechanism; arbitrary root deformation is not used.');
     object.position.toArray().forEach((v,i)=>same(v,binding.actualPose.position[i],'Actual editable pose'));
     if(Math.abs(object.position.x-binding.sourceCenter[0])>1e-6||Math.abs(object.position.z-binding.sourceCenter[2])>1e-6)assert(built.manifest.layoutAdjustments.some(a=>a.alias===authored.alias&&a.reason),'Relocation requires an explicit technical adaptation.');
     assert(binding.actualFootprint.length===3&&binding.actualFootprint.every(v=>Number.isFinite(v)&&v>0));mappings++;
    }
    const unique=[...new Set(built.objects)],physicalMesh=n=>fixture.ctx.collisionWorld.physicalMesh(n),measured=costs(unique,{validate:(ok,message)=>assert(ok,message),physicalMesh});
    Object.assign(row,measured,{actorCount:unique.length,sourceAliases:aliases.length,adjustments:built.manifest.layoutAdjustments});
    row.byActor=unique.map(object=>({id:object.userData.editorId,alias:object.userData.configurablePracticeAlias||'',name:object.name,...costs([object])})).sort((a,b)=>b.drawCalls-a.drawCalls);
    row.drawCallReview=measured.drawCalls>budgets.drawCallReviewTarget;
    assert(measured.triangles<=budgets.triangleLimit,'Configuration exceeds 200k drawn triangles.');assert(measured.drawCalls<=budgets.drawCallRegressionLimit,'Configuration exceeds the measured 400-draw regression envelope; see the explicit 250-draw review.');
    assert.equal(measured.lights,0,'Native actors do not allocate extra dynamic scene lights.');assert(measured.physicalMeshes>0,'Real native collision meshes remain.');
    assert(built.manifest.executionRoute.referenceOnly,'Source numerical polylines are references, not a false clearance certification.');
    const floor=built.objects.find(o=>o.name.startsWith('Interior'));assert(floor);same(floor.scale.x,record.interiorArea.width,'Source interior width');same(floor.scale.z,record.interiorArea.depth,'Source interior depth');
    // Root points for native ground vehicles must lie on an actual collidable
    // floor, including trucks deliberately outside the interior source area.
    const floorBoxes=unique.filter(o=>o.scale.x>=3&&o.scale.z>=3&&o.position.y<0&&o.position.y>-.3).map(o=>new native.THREE.Box3().setFromObject(o));
    for(const binding of aliases.filter(a=>a.nativeKind==='vehicle')){const object=fixture.document.getObject(binding.objectId);assert(floorBoxes.some(box=>object.position.x>=box.min.x&&object.position.x<=box.max.x&&object.position.z>=box.min.z&&object.position.z<=box.max.z),'Ground vehicle '+binding.alias+' needs a real floor at its root.');}
   }catch(error){row.error=error.stack||error.message;failures.push({id:record.id,mode,error:error.message});}
   finally{rows.push(row);native.releaseGeometry(fixture);}
  }
 }finally{
  const report={format:'smarttwin.configurable-native-configuration-audit',version:1,startedAt,completedAt:new Date().toISOString(),loadedSourceHashes,finishedSourceHashes:hashes(),sourcePractices:10,configurations:rows.length,mappedAliases:mappings,executionReady:readyCount,configurationOnly:rows.length-readyCount,budgets,worst:{triangles:rows.filter(r=>r.triangles!==undefined).sort((a,b)=>b.triangles-a.triangles).slice(0,3).map(({byActor,...r})=>r),drawCalls:rows.filter(r=>r.drawCalls!==undefined).sort((a,b)=>b.drawCalls-a.drawCalls).slice(0,3).map(({byActor,...r})=>r)},review:rows.filter(r=>r.drawCallReview).map(r=>({id:r.id,mode:r.mode,drawCalls:r.drawCalls,top:r.byActor.slice(0,4)})),failures,rows,limits:'Configuration and visible native geometry audit only. Counts supplied authored roots, not unrelated fixture content; material groups only count for material arrays, two-pass transparent double-sided materials counted. Resident hidden allocations are separate. No frustum culling, shadows, physical headset FPS, full runtime or actor-contact certification.'};
  fs.mkdirSync(path.dirname(OUTPUT),{recursive:true});fs.writeFileSync(OUTPUT,JSON.stringify(report,null,2));
 }
 assert.equal(rows.length,30);assert.equal(mappings,255);assert.equal(readyCount,1,'Only the verified receiving/manual/A run is advertised ready.');assert.equal(failures.length,0,JSON.stringify(failures));
 console.log('30 native configurations / 255 mapped aliases; '+rows.filter(r=>r.drawCallReview).length+' configurations require draw-call review. Receipt '+path.relative(ROOT,OUTPUT));
});
