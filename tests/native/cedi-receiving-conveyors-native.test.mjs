import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),h=require('../support/load-practice-scenes.cjs')();
const receiving=require('../../modules/logistica-industrial/practices/configurable/CediReceivingLayout.cjs');
const filename=new URL('../../modules/logistica-industrial/practices/configurable/runtime/CediReceivingConveyors.js',import.meta.url);
const source=fs.readFileSync(filename,'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const helper=new Function('ConveyorAssembly','receivingLayout',source+'\nreturn {buildReceivingConveyors,poolMicrofinishes};')(h.study.ConveyorAssembly,receiving),build=helper.buildReceivingConveyors;
const config=(f,object)=>f.document.getBehaviors(object).find(row=>row.type==='conveyor');
const belt=(f,id)=>f.runtime.records.get(id).components.conveyor;

test('receiving line uses real pallet rollers and exact native side-input connections, without generating stock',()=>{
 const f=h.fixture(),objects=[];
 try{
  const native=h.schema.conveyorEquipment.getDefinition('pallet-rollers'),legacy=h.schema.conveyorEquipment.getDefinition('pallet-chain');
  assert.equal(native.preset.surface,'rollers');assert.deepEqual(native.productProfiles.map(p=>p.id),['pallet']);
  assert.equal(legacy.preset.surface,'chains','Existing chain conveyor keeps its original identity and support mechanism.');
  const manifest=build(f.document,'hall',{id:'CEDI-01'},objects);
  assert.equal(objects.length,9);assert.equal(manifest.links.length,8);
  assert.equal(new Set(manifest.conveyorIds).size,9);
  for(const cell of receiving.workcells()){
   const bench=receiving.fixtures().find(row=>row[0]===cell.benchKey),entrance=bench[4][0]-bench[6].length/2-(cell.branchX+receiving.RECEIVING.width/2);
   assert(entrance>=.9,'The inspection bay needs a clear nominal operator entrance alongside its intake.');
   assert.deepEqual(cell.benchCenter,bench[4].slice(0,3));
  }
  const assembly=new h.study.ConveyorAssembly({document:f.document,roomId:'hall'});
  for(const connection of manifest.links){
   const from=objects.find(o=>o.userData.editorId===connection.sourceId),to=objects.find(o=>o.userData.editorId===connection.targetId);
   const actual=assembly.assessConnection(from,connection.sourcePort,to,connection.targetPort);
   assert(actual.ready,JSON.stringify(actual));assert(actual.gap<1e-6);assert(actual.heading>.999999);
   assert.equal(config(f,from).outputId,connection.targetId);assert.equal(config(f,from).outputPort,connection.targetPort);
  }
  for(const row of receiving.fixtures().filter(row=>row[2]==='conveyor')){
   const object=objects.find(o=>o.userData.cediReceiving.key===row[0]);
   assert.deepEqual(object.position.toArray(),row[4].slice(0,3),'Connecting ports must not silently realign the authored layout.');
   assert.equal(config(f,object).autoSpawn,false);assert.equal(config(f,object).withPallet,false);
   assert.equal(config(f,object).surface,/transfer/.test(row[0])?'chains':'rollers');
   if(config(f,object).surface==='rollers'){
    // Check the actual visible manufacturing surfaces, not just the recipe's
    // pitch value: every expected roller crown must support a downward ray.
    // This catches the catalogue decorator replacing native dense rollers
    // with a sparse, non-animated illustrative deck.
    const c=config(f,object),rollers=[];object.traverse(mesh=>{if(mesh.isMesh&&mesh.userData.industrialRoller)rollers.push(mesh);});
    assert(rollers.length>0,'Native animated roller geometry must remain on the catalogue actor.');
    assert(rollers.length<=2,'Full-density rollers share native route draws; density cannot multiply draw calls.');
    object.updateMatrixWorld(true);const count=Math.ceil(c.length/c.rollerPitch),margin=Math.min(.1,c.length*.15);
    for(let i=0;i<count;i++){
     const x=-c.length/2+margin+(c.length-2*margin)*i/(count-1);
     for(const lateral of [-.4,0,.4]){
      const origin=new h.THREE.Vector3(x,.3,lateral).applyMatrix4(object.matrixWorld),ray=new h.THREE.Raycaster(origin,new h.THREE.Vector3(0,-1,0),0,.31),hits=ray.intersectObjects(rollers,false);
      assert(hits.length>0,'Missing support at roller '+i+' in '+row[0]);
      assert(Math.abs(hits[0].point.y-object.position.y)<.003,'Roller crown must coincide with the actual pallet handling plane.');
     }
    }
   }
  }
  f.runtime.start('hall');h.advance(f,12);
  assert.equal(f.runtime.products.size,0);assert.equal(f.runtime.packageCount,0,'An empty powered line cannot manufacture inventory.');
  assert(manifest.conveyorIds.every(id=>belt(f,id).entryCount===0));
 }finally{h.releaseGeometry(f);}
 for(const id of ['CEDI-02','CEDI-03','CEDI-04','CEDI-05']){
  const inactive=h.fixture(),objects=[];
  try{assert.equal(build(inactive.document,'hall',{id},objects),null);assert.equal(objects.length,0);}finally{h.releaseGeometry(inactive);}
 }
});

test('receiving microfinish pooling preserves every pixel, sampler, private material and independent actor disposal',()=>{
 const f=h.fixture(),actors=[];
 const slots=actor=>{const out=[],seen=new Set();actor.traverse(node=>{for(const m of Array.isArray(node.material)?node.material:node.material?[node.material]:[]){if(seen.has(m))continue;seen.add(m);for(const key of Object.keys(m)){const texture=m[key];if(texture&&texture.isDataTexture&&/^Microacabado fabricado \/ /.test(texture.name))out.push({material:m,key,texture,pixels:Array.from(texture.image.data),repeat:texture.repeat.toArray(),wrap:[texture.wrapS,texture.wrapT],filter:[texture.magFilter,texture.minFilter],color:m.color&&m.color.getHex()});}}});return out;};
 try{
  for(let i=0;i<2;i++){
   const actor=f.document.addPrefab('hall','conveyor','catalogue:equipment.transport.roller-pallet');actors.push(actor);
   const before=slots(actor),original=new Set(before.map(slot=>slot.texture)),disposed=new Set();
   original.forEach(texture=>texture.addEventListener('dispose',()=>disposed.add(texture)));
   const stats=helper.poolMicrofinishes(actor),after=slots(actor),retained=new Set(after.map(slot=>slot.texture));
   assert(stats.disposedDuplicates>0);assert.equal(disposed.size,stats.disposedDuplicates);
   assert.equal(after.length,before.length);assert(retained.size<original.size);
   for(let j=0;j<after.length;j++){
    assert.equal(after[j].material,before[j].material,'An editable surface retains its own material object.');
    assert.deepEqual(after[j].pixels,before[j].pixels);assert.deepEqual(after[j].repeat,before[j].repeat);assert.deepEqual(after[j].wrap,before[j].wrap);assert.deepEqual(after[j].filter,before[j].filter);assert.equal(after[j].color,before[j].color);
    assert(!disposed.has(after[j].texture),'No retained live map may have been disposed.');
   }
  }
  const first=slots(actors[0]),second=slots(actors[1]),firstMaps=new Set(first.map(slot=>slot.texture));
  assert(second.every(slot=>!firstMaps.has(slot.texture)),'Two separately editable actors never share pooled texture ownership.');
  const otherColor=second[0].material.color.getHex();first[0].material.color.set('#123456');assert.equal(second[0].material.color.getHex(),otherColor);
  let otherDisposals=0;new Set(second.map(slot=>slot.texture)).forEach(texture=>texture.addEventListener('dispose',()=>otherDisposals++));firstMaps.forEach(texture=>texture.dispose());assert.equal(otherDisposals,0);
 }finally{h.releaseGeometry(f);}
});

test('opted-in receiving banks preserve every indexed triangle attribute and reflected drive while other textured actors stay independent',()=>{
 const f=h.fixture(),Banks=f.runtime.nativeRenderBanks.constructor,banks=new Banks(),root=new h.THREE.Group(),mirror=new h.THREE.Group(),meshes=[],maps=[];
 root.userData={editorPrefabKey:'conveyor',editorId:'receiving-presentation-fixture'};mirror.scale.z=-1;root.add(mirror);
 try{
  for(let i=0;i<2;i++){
   const geometry=new h.THREE.BoxBufferGeometry(.3,.2,.4).toNonIndexed();
   // Deliberate UV seam on an otherwise identical corner must stay split.
   geometry.attributes.uv.setX(geometry.attributes.uv.count-1,.731);
   const map=new h.THREE.DataTexture(new Uint8Array([191,191,191,255]),1,1,h.THREE.RGBAFormat);map.name='Microacabado fabricado / paint';map.needsUpdate=true;maps.push(map);
   const material=new h.THREE.MeshStandardMaterial({color:i?'#226699':'#cc7722',roughness:.47,metalness:.06,map,bumpMap:map,bumpScale:.01});
   const mesh=new h.THREE.Mesh(geometry,material);mesh.position.set(i*.5,.25,.3);mesh.rotation.y=i*.12;mirror.add(mesh);meshes.push(mesh);
  }
  root.updateMatrixWorld(true);banks.sync([root]);assert.equal(banks.banks.length,0,'Opting in a CEDI actor cannot change unrelated textured conveyor defaults.');
  banks.sync([root],{texturedTintObjects:[root.userData.editorId]});assert.equal(banks.banks.length,1);
  const bank=banks.banks[0],geometry=bank.geometry;assert.equal(bank.parent,mirror,'The native mirrored parent retains handedness.');assert(geometry.attributes.position.count<72,'Exact duplicate tuples are indexed without losing seams.');assert.equal(geometry.index.count,72);
  let corner=0;
  for(const mesh of meshes){const expected=mesh.geometry.clone().applyMatrix(mesh.matrix);try{for(let n=0;n<expected.attributes.position.count;n++,corner++){
   const actual=geometry.index.getX(corner);
   for(const name of ['position','normal','uv'])for(let k=0;k<expected.attributes[name].itemSize;k++)assert.equal(geometry.attributes[name].array[actual*expected.attributes[name].itemSize+k],expected.attributes[name].array[n*expected.attributes[name].itemSize+k]);
   const color=new Float32Array(mesh.material.color.toArray());for(let k=0;k<3;k++)assert.equal(geometry.attributes.color.array[actual*3+k],color[k]);
  }}finally{expected.dispose();}}
  assert.equal(bank.material.roughness,.47);assert.equal(bank.material.metalness,.06);assert.equal(bank.material.bumpScale,.01);assert.equal(bank.material.map,meshes[0].material.map);assert.equal(bank.material.bumpMap,meshes[0].material.bumpMap);
  let disposedOriginal=0;meshes.forEach(mesh=>mesh.material.addEventListener('dispose',()=>disposedOriginal++));banks.dispose();assert.equal(disposedOriginal,0);assert(meshes.every(mesh=>mesh.layers.mask!==0));
 }finally{banks.dispose();for(const mesh of meshes){mesh.geometry.dispose();mesh.material.dispose();}maps.forEach(map=>map.dispose());h.releaseGeometry(f);}
});

test('persisted receiving IDs restore the same native presentation opt-in and custody after document reload',async()=>{
 const f=h.fixture(),objects=[];
 try{
  const manifest=build(f.document,'hall',{id:'CEDI-01'},objects),serialized=await f.document.serialize();
  await f.document.load(serialized);const reopened=manifest.conveyorIds.map(id=>f.document.getObject(id));
  assert(reopened.every(Boolean));assert(reopened.every(object=>!object.userData.cediReceiving),'The test exercises reconstruction without transient creation markers.');
  f.runtime.start('hall');f.runtime.nativeRenderBanks.sync(reopened,{texturedTintObjects:manifest.conveyorIds});
  assert(f.runtime.nativeRenderBanks.sources.some(row=>row.tint&&row.compact));
  assert.equal(f.runtime.products.size,0);assert.equal(f.runtime.packageCount,0);
  assert(manifest.conveyorIds.every(id=>belt(f,id).entryCount===0));
  for(const link of manifest.links){const assessment=new h.study.ConveyorAssembly({document:f.document,roomId:'hall'}).assessConnection(f.document.getObject(link.sourceId),link.sourcePort,f.document.getObject(link.targetId),link.targetPort);assert(assessment.ready);assert(assessment.gap<1e-6);}
 }finally{if(f.runtime.active)f.runtime.stop();h.releaseGeometry(f);}
});

test('existing continuous CEDI examples include pallet rollers without replacing legacy chain equipment or invalidating physical links',()=>{
 const text=fs.readFileSync(new URL('../../modules/logistica-industrial/scenarios/IndustrialCediScenarios.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''),buildExample=new Function('THREE','ConveyorAssembly',require('../support/load-industrial-continuous')()+text+'\nreturn buildIndustrialCediScenario;')(h.THREE,h.study.ConveyorAssembly),used=new Set();
 for(const kind of ['sorting','packing']){
  const f=h.fixture();try{
   const graph=buildExample(f.document,'hall',{kind,continuous:true,scene:f.scene}),assembly=new h.study.ConveyorAssembly({document:f.document,roomId:'hall'}),palletLine=graph.lines.find(line=>line.id==='pallet-logistics'),equipment=palletLine.objects.map(object=>f.document.getBehaviors(object).find(row=>row.type==='conveyor')).filter(Boolean);
   assert(equipment.some(row=>row.equipmentId==='conveyor.pallet-rollers'&&row.surface==='rollers'));assert(equipment.some(row=>row.equipmentId==='conveyor.pallet-chain'&&row.surface==='chains'));
   graph.objects.forEach(object=>f.document.getBehaviors(object).filter(row=>row.type==='conveyor').forEach(row=>used.add(row.equipmentId)));
   for(const link of graph.links){const result=assembly.assessConnection(f.document.getObject(link.source),link.sourcePort,f.document.getObject(link.target),link.targetPort);assert(result.ready);assert(result.gap<1e-6);assert(result.heading>.999999);}
  }finally{h.releaseGeometry(f);}
 }
 assert.deepEqual(Array.from(used).sort(),h.schema.conveyorEquipment.listEquipment({readyOnly:true}).map(row=>row.id).sort());
});

test('one physical pallet traverses each L intake and is conserved through the receiving collector',{timeout:120000},()=>{
 for(let branch=0;branch<3;branch++){
  const f=h.fixture(),objects=[];
  try{
   const manifest=build(f.document,'hall',{id:'CEDI-01'},objects),intake=objects.find(o=>o.userData.editorId===manifest.inlets[branch].objectId);
   // An explicitly declared source supplies exactly one real pallet to the
   // same native capture contract used after a manual forklift deposit.
   const stock=f.document.addPrefab('hall','source'),initial=f.document.getBehaviors(stock).find(row=>row.type==='source');
   f.document.setBehaviors(stock,[Object.assign({},initial,{loadMode:'pallet',mass:12,initialCount:1,totalLimit:1,autoGenerate:false})]);
   f.document.setTransform(stock,{position:[-34,1,0]});
   f.runtime.start('hall');
   const queue=f.runtime.records.get(stock.userData.editorId).components.source.queue;
   assert.equal(queue.length,1);const product=queue[0].product,identity=product.object,mass=f.runtime.productMetadata(product).mass;
   f.runtime.sourceRuntime.picked(product);
   const record=f.runtime.records.get(intake.userData.editorId),infeed=belt(f,intake.userData.editorId);
   assert(f.runtime.captureProduct(product,{record,belt:infeed,route:'main',offset:-h.schema.conveyorLayout.pathLength(infeed.config)/2+.65,lateral:0}));
   h.advance(f,78);
   const destination=belt(f,manifest.outlet.objectId);
   assert.equal(destination.entryCount,1,JSON.stringify({branch,notices:f.notices,states:manifest.conveyorIds.map(id=>({key:objects.find(o=>o.userData.editorId===id).userData.cediReceiving.key,entries:belt(f,id).entryCount,phase:belt(f,id).mechanismPhase,packages:belt(f,id).packages.map(p=>({offset:p.offset,stage:p.mechanismStage,route:p.route,blocked:p.blocked}))}))}));
   assert(destination.packages.some(item=>item.mesh===identity),'The receiver gets the original pallet object, not a replacement illustration.');
   assert.equal(f.runtime.products.size,1);assert.equal(f.runtime.packageCount,1);assert.equal(f.runtime.productMetadata(product).mass,mass);
   assert.equal(queue.length,0);assert(f.runtime.events.some(event=>event.type==='mechanism-transfer'));
   const final=identity.getWorldPosition(new h.THREE.Vector3());assert(Math.abs(final.z-receiving.RECEIVING.spineZ)<.01);
  }finally{h.releaseGeometry(f);}
 }
});
