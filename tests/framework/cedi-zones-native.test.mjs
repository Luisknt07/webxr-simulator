import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),native=require('../support/load-practice-scenes.cjs')(),T=native.THREE,cedi=require('../../modules/logistica-industrial/practices/configurable/CediLayout.cjs'),operating=require('../../modules/logistica-industrial/practices/configurable/CediOperatingData.cjs'),cad=require('../../packages/tools/cad/schema/cad.js');
const source=fs.readFileSync(new URL('../../modules/logistica-industrial/practices/configurable/runtime/CediSceneComposition.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const {CONTEXT,PACKING_TRANSFER_GAPS}=new Function('THREE','schema','createIndustrialPrefab','cediLayout','operatingData','cad',source+'\nreturn {CONTEXT,PACKING_TRANSFER_GAPS};')(T,native.schema,native.createIndustrialPrefab,cedi,operating,cad);
const geometries=new Set(),materials=new Set(),bodies=new Map();let scene;
function body(key){if(bodies.has(key))return bodies.get(key);const row=CONTEXT.find(row=>row[0]===key);assert(row,'Missing native context definition '+key);const[,zone,kind,equipment,pose,,values]=row,object=native.createIndustrialPrefab(kind,'catalogue:'+equipment,{detail:'low',withPanel:false,wear:.15,autoRelease:false,running:false,...values});object.position.fromArray(pose.slice(0,3));object.rotation.y=pose[3]||0;object.updateWorldMatrix(true,true);object.traverse(node=>{if(node.geometry)geometries.add(node.geometry);for(const m of Array.isArray(node.material)?node.material:node.material?[node.material]:[])materials.add(m);});const result={object,row,zone,meshes:meshes(object)};bodies.set(key,result);return result;}
function meshes(root){const rows=[];root.traverse(node=>{if(!node.isMesh||!node.geometry)return;for(let p=node;p;p=p.parent)if(!p.visible||p.userData.editorGeometryReplaced||p.userData.warehouseRackLocationLabels)return;rows.push(node);});return rows;}
function setup(){if(!scene){const fixture=native.fixture(),built=native.buildConfigurablePracticeScene(fixture.document,'hall','CEDI-01',{scene:fixture.scene});fixture.root.updateWorldMatrix(true,true);scene={fixture,built,context:built.manifest.cediContext};}return scene;}
function contains(area,x,z,margin=.01){return x>=area.rect[0]-margin&&x<=area.rect[2]+margin&&z>=area.rect[1]-margin&&z<=area.rect[3]+margin;}
function supportHits(meshes,x,z,bottom){return new T.Raycaster(new T.Vector3(x,bottom+.002,z),new T.Vector3(0,-1,0),0,.045).intersectObjects(meshes,false).filter(hit=>hit.point.y<=bottom+.001&&bottom-hit.point.y<.018);}
after(()=>{if(scene){if(scene.fixture.runtime.active)scene.fixture.runtime.stop();native.releaseGeometry(scene.fixture);}geometries.forEach(value=>value.dispose());materials.forEach(value=>value.dispose());});

test('every static process island and displayed load belongs to a named real zone/subarea without changing established active coordinates',()=>{
 const layout=cedi.layout(),{context}=setup(),failures=[];
 for(const entry of context.entries){const zone=layout.zones[entry.zone];if(!zone){failures.push('Undefined zone '+entry.zone+' / '+entry.key);continue;}if(!entry.key.startsWith('guards-and-fixtures-')&&!zone.areas.some(area=>contains(area,entry.position[0],entry.position[2])))failures.push(entry.key+' at '+entry.position+' outside '+zone.label);}
 for(const stock of context.displayStock){const zone=layout.zones[stock.zone];if(!zone||!zone.areas.some(area=>contains(area,stock.position[0],stock.position[2])))failures.push('Unzoned display stock '+stock.key);assert.equal(stock.operational,false);}
 assert.deepEqual(failures,[]);assert.deepEqual(layout.zones.packing.rect,[10,7,23,12]);assert.deepEqual(layout.zones.inspection.rect,[-29,0,-18,8]);assert.deepEqual(layout.aisles.safePolyline,[[-22,0,18],[-12,0,18],[-12,0,-7],[27,0,-7],[27,0,18],[22,0,18]]);
 for(const zone of Object.values(layout.zones)){assert(zone.areas.some(area=>area.id==='main'&&JSON.stringify(area.rect)===JSON.stringify(zone.rect)));assert.equal(new Set(zone.areas.map(area=>area.id)).size,zone.areas.length);}
});

test('all displayed pallets and totes have real two-sided source support, and long cantilever sections bear on both actual arms',()=>{
 const {fixture,built,context}=setup(),failures=[],floorMeshes=built.manifest.facility.objects.filter(row=>['ground','annex-ground'].includes(row.role)).flatMap(row=>meshes(fixture.document.getObject(row.objectId))),seen=new Map();
 for(const stock of context.displayStock){
  const entry=context.entries.find(row=>row.key===stock.contextKey);assert(entry);const bottom=entry.bounds.min[1],rack=stock.supportFixtureKey&&body(stock.supportFixtureKey),sourceMeshes=rack?rack.meshes:stock.key.startsWith('crossdock-fast-')?body('crossdock-buffer-'+stock.key.slice(-1)).meshes:floorMeshes;
  let checks;
  if(stock.loadType==='long-steel-profiles'){
   let config;rack.object.traverse(node=>{const row=(node.userData.editorDefaultBehaviors||[]).find(row=>row.type==='palletQueue');if(row&&!config)config=row;});const cells=native.schema.warehouseRacks.layout(config).cells,cell=cells.find(cell=>cell.code===stock.locationCode);assert(cell);checks=[];
   const base=new T.Vector3(...stock.position),q=new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),stock.yaw||0);for(const x of [-cell.width*.3,cell.width*.3])for(const z of [-.22,0,.22])checks.push(new T.Vector3(x,0,z).applyQuaternion(q).add(base));
  }else{
   // A roller crown bears the runner at x±.2; x±.42 lies on the curved
   // shoulders between successive crowns, not on its real support plane.
   const sx=stock.key.startsWith('crossdock-fast-')||stock.loadType&&stock.loadType.includes('tote')?.2:.42,sz=stock.loadType&&stock.loadType.includes('tote')?.15:.32;checks=[new T.Vector3(stock.position[0]-sx,0,stock.position[2]-sz),new T.Vector3(stock.position[0]+sx,0,stock.position[2]+sz)];
  }
  for(const point of checks){assert(point.x>=entry.bounds.min[0]-.001&&point.x<=entry.bounds.max[0]+.001&&point.z>=entry.bounds.min[2]-.001&&point.z<=entry.bounds.max[2]+.001,'A support probe must actually lie underneath the displayed load.');if(!supportHits(sourceMeshes,point.x,point.z,bottom).length)failures.push({key:stock.key,type:stock.loadType||'pallet',fixture:stock.supportFixtureKey||'floor',position:stock.position,probe:[point.x,bottom,point.z]});}
  seen.set(stock.loadType||'pallet',(seen.get(stock.loadType||'pallet')||0)+1);
 }
 assert.deepEqual(failures,[]);assert(seen.get('long-steel-profiles')>0);assert(seen.get('empty-tote')>0);assert(seen.get('picking-tote')>0);assert(seen.get('pallet')>80);
 const referenceIds=new Set(context.entries.flatMap(row=>row.objectIds));assert(built.productIds.every(id=>!referenceIds.has(id)),'Reference presentation cannot enter operational custody.');
});

test('packing belt segments end outside the real native machine beds and fixed bridges retain millimetric clear joints at one transfer height',()=>{
 const {fixture,context}=setup(),belts=['packing-belt-spine-in','packing-belt-spine-mid','packing-belt-spine-out'].map(key=>body(key)),machines=['packing-carton-sealer','packing-print-apply'].map(key=>body(key)),surfaces=[];
 for(const item of belts){const belt=item.meshes.find(mesh=>mesh.name==='Cinta continua');assert(belt);const bounds=new T.Box3().setFromObject(belt);assert(Math.abs(bounds.min.y-1)<.0001&&Math.abs(bounds.max.y-1)<.0001);surfaces.push(bounds);}
 const machineBeds=[];for(const machine of machines){const bed=machine.meshes.filter(mesh=>mesh.name==='surface / steel').map(mesh=>new T.Box3().setFromObject(mesh));assert(bed.length);machineBeds.push(bed.reduce((result,b)=>result.union(b),new T.Box3()));for(const b of bed){assert(Math.abs(b.max.y-1)<.0001);for(const belt of surfaces)assert(Math.min(b.max.x,belt.max.x)-Math.max(b.min.x,belt.min.x)<.001,'A belt must not continue through a real sealing/label machine bed.');}}
 const inBelt=new T.Box3().setFromObject(body('packing-belt-in').meshes.find(mesh=>mesh.name==='Cinta continua')),outBelt=new T.Box3().setFromObject(body('packing-belt-out').meshes.find(mesh=>mesh.name==='Cinta continua'));
 const actualGaps=[[inBelt.max.x,surfaces[0].min.x],[surfaces[0].max.x,machineBeds[0].min.x],[machineBeds[0].max.x,surfaces[1].min.x],[surfaces[1].max.x,machineBeds[1].min.x],[machineBeds[1].max.x,surfaces[2].min.x],[surfaces[2].max.x,outBelt.min.x]];
 actualGaps.forEach((gap,index)=>gap.forEach((edge,side)=>assert(Math.abs(edge-PACKING_TRANSFER_GAPS[index][side])<.0001,'Every real gap endpoint must meet its transfer plate, not only a drawn reference.')));
 const bankIds=context.entries.find(row=>row.key==='guards-and-fixtures-packing').objectIds,bridges=bankIds.flatMap(id=>meshes(fixture.document.getObject(id)));
 for(const[from,to]of PACKING_TRANSFER_GAPS)for(const fraction of [.1,.5,.9]){const x=from+(to-from)*fraction,hits=supportHits(bridges,x,-2.4,1.005);assert(hits.some(hit=>Math.abs(hit.point.y-1)<.0001),'Missing real transfer bridge between native beds at '+x);}
 assert.equal(context.entries.some(row=>row.key==='packing-belt-spine'),false,'The former overlapping full-length belt is gone.');
});

test('the denser static world stays finite and its reference stock does not create active runtime products',()=>{
 const {fixture,built,context}=setup();fixture.runtime.start('hall');native.advance(fixture,.1);const costs=require('../support/practice-render-costs.cjs'),scope=[...new Set(built.objects)],contextIds=[...new Set(context.entries.flatMap(row=>row.objectIds))],contextObjects=contextIds.map(id=>fixture.document.getObject(id)),facilityObjects=built.manifest.facility.objects.map(row=>fixture.document.getObject(row.objectId)),authored=costs(scope),facility=costs(facilityObjects),reference=costs(contextObjects);
 assert(facility.drawCalls<90&&facility.triangles<35000,'The existing facility envelope remains unchanged.');assert.equal(reference.drawCalls,contextIds.length,'Each stored context bank must be a single real native draw.');assert.equal(context.staticDraws,reference.drawCalls+1);assert(reference.drawCalls<context.entries.length,'A mesh per context actor would defeat area/material batching.');
 for(const object of contextObjects){assert(fixture.document.getBehaviors(object).every(row=>['collision','surfaceMaterial'].includes(row.type)));assert(!fixture.runtime.records.has(object.userData.editorId),'Static reference geometry cannot register an additional simulated actor.');}
 fixture.runtime.nativeRenderBanks.sync(scope,{staticObjects:built.manifest.facility.objects.filter(row=>['envelope','detail'].includes(row.role)).map(row=>fixture.document.getObject(row.objectId))});
 const submitted=scope.concat(fixture.runtime.nativeRenderBanks.banks),banked=costs(submitted);assert.equal(banked.triangles,authored.triangles,'Rigid banking retains all native surfaces.');assert(banked.drawCalls<authored.drawCalls,'The actual production presentation must reduce draw submissions.');
 const camera=new T.PerspectiveCamera(70,16/9,.1,150);camera.position.fromArray(built.manifest.facility.initialView.eye);camera.lookAt(new T.Vector3(...built.manifest.facility.initialView.target));camera.updateMatrixWorld(true);camera.matrixWorldInverse.getInverse(camera.matrixWorld);const frustum=new T.Frustum().setFromMatrix(new T.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse)),visible=new Set();for(const root of submitted)root.traverse(node=>{if(!node.isMesh||!node.geometry||node.layers.mask===0)return;for(let parent=node;parent;parent=parent.parent)if(!parent.visible||parent.userData.editorGeometryReplaced)return;if(node.frustumCulled===false||frustum.intersectsObject(node))visible.add(node);});
 const report={practiceId:'CEDI-01',layoutId:cedi.ID,displayLoads:context.displayStock.length,loadTypes:Object.fromEntries([...new Set(context.displayStock.map(row=>row.loadType||'pallet'))].map(type=>[type,context.displayStock.filter(row=>(row.loadType||'pallet')===type).length])),facility,context:reference,authored,banked,initialCamera:costs([...visible]),presentation:fixture.runtime.nativeRenderBanks.getStats(),policy:'Facility retains its established <90 draw / <35k triangle envelope; context is area/material-banked with zero actors/lights. Whole enlarged CEDI costs are explicitly reported for review; existing campaign 400-draw/200k guards are not raised. No physical headset FPS claim.'};
 const output=new URL('../../data/qa-studio/cedi-zones-native.json',import.meta.url);fs.mkdirSync(new URL('./',output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({cediCosts:{authored:{drawCalls:authored.drawCalls,triangles:authored.triangles},banked:{drawCalls:banked.drawCalls,triangles:banked.triangles},initialCamera:report.initialCamera,facility,context:reference}}));
 assert.equal(authored.lights,0);assert.equal(context.simulationActors,0);assert(context.displayStock.length>100);assert.equal(new Set(context.displayStock.map(row=>row.key)).size,context.displayStock.length);
});
