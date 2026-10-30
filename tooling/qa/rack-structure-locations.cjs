'use strict';
// Real production Workspace, disposable HTTPS/SQLite account and Chrome profile.
// Stored projects and credentials in the developer's normal data/ are not used.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {randomBytes, createHash} = require('node:crypto');
const {startFixture, withBrowser, request} = require('./workspace-production.cjs');
const {SYSTEMS} = require('../../modules/logistica-industrial/functions/almacenamiento/schema/warehouseRacks');
const ROOT = path.resolve(__dirname, '../..'), OUT = path.join(ROOT, 'data/qa-studio/workspace-production');
const hash = file => createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex');

async function run() {
  fs.mkdirSync(OUT, {recursive:true});
  const report = {startedAt:new Date().toISOString(), workspaceSha256:hash('artifacts/workspace/bundle.js'), publicSha256:hash('artifacts/public-viewer/viewer.js'), temporaryDatabaseOnly:true,
    exceptions:[], consoleErrors:[], failedRequests:[], responses:[], screenshots:[], models:[]};
  for(const app of ['workspace','public-viewer']) assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT,'artifacts',app,'publication.json'))).bundleSha256, app==='workspace'?report.workspaceSha256:report.publicSha256, 'Package the final artifact before QA.');
  const password='Disposable-Rack-QA-'+randomBytes(16).toString('hex'), fixture=await startFixture(password);
  try {
    assert.equal((await request(fixture.origin,'/workspace/bundle.js')).status,401);
    assert.equal((await request(fixture.origin,'/api/library/scenes')).status,401);
    assert.equal((await request(fixture.origin,'/data/studio.sqlite')).status,404);
    await withBrowser(fixture,report,async b=>{
      const until=(callback,message)=>b.until(callback,message,45000);
      const ready=async()=>{
        await until(()=>b.evaluate('!!window.context && !!context.editor && !context.editor.initializing && !context.editor.loadingProject && !!context.studio'), 'Production Workspace did not initialize.');
        await b.evaluate('context.studio.ready');
        await until(()=>b.evaluate('!context.editor.busy && !context.editor.pendingEdits && !context.editor.creatingProject && !context.editor.creatingScene'), 'The editor did not settle.');
      };
      const editing=async()=>{await b.call(()=>{const e=context.editor;if(!e.active)e.enter();});await ready();};
      const snapshot=()=>b.call(()=>{
        const e=context.editor,o=e.document.getObject(__rackQA.id), config=e.document.getBehaviors(o).find(c=>c.type==='palletQueue');
        let rig=null,detail=null;const controls=[],meshes=[];
        o.traverse(n=>{if(n.userData.warehouseRackRig)rig=n.userData.warehouseRackRig;if(n.userData.warehouseRackVisualStats)detail=n.userData.warehouseRackVisualStats;
          if(n.isMesh)meshes.push(n);e.document.getBehaviors(n).filter(c=>c.type==='control').forEach(c=>controls.push({command:c.command,targetId:c.targetId}));});
        const cells=(rig&&rig.pallets||[]).map(p=>p.cell).filter(Boolean), box=e.collisionWorld.objectBounds(o);
        return {id:o.userData.editorId,config,controls,detail,codes:cells.map(c=>c.code),cellWidths:cells.map(c=>c.width),size:box.getSize(e.camera.position.clone()).toArray(),
          meshes:meshes.length,triangles:meshes.reduce((s,n)=>s+(n.geometry.index?n.geometry.index.count:n.geometry.attributes.position.count)/3,0),gl:context.renderer.getContext().getError()};
      });
      const remove=async()=>{await editing();await b.call(async()=>{const e=context.editor;await e.perform(()=>{
        e.document.begin();e.document.getObjects(e.roomId).filter(o=>e.document.getBehaviors(o).some(c=>c.type==='palletQueue'&&c.rackSystem&&c.rackSystem!=='floor')||o.userData.rackQASource).forEach(o=>e.document.remove(o));e.document.commit();e.select(null);
      });});await ready();};
      const add=async system=>{
        await editing();
        await b.call(async system=>{const e=context.editor;const o=await e.perform(()=>{const o=e.document.addPrefab(e.roomId,'palletQueue',system);e.document.setTransform(o,{position:[0,1,0]});return o;});
          window.__rackQA={id:o.userData.editorId,system};e.select(o);e.showInspectorTab('object');e.shell.setPanel('inspector',true);
        },system);await ready();return snapshot();
      };
      const field=async(key,value)=>{
        await b.call((key,value)=>{const e=context.editor,o=e.document.getObject(__rackQA.id);e.select(o);e.showInspectorTab('object');e.shell.setPanel('inspector',true);
          const f=e.inspector.querySelector('[data-behavior-field="'+key+'"]');if(!f)throw Error('Missing configurable rack field: '+key);f.value=String(value);f.dispatchEvent(new Event('change',{bubbles:true}));
        },key,value);await ready();
        await until(()=>b.call((key,value)=>{const e=context.editor,c=e.document.getBehaviors(e.document.getObject(__rackQA.id)).find(c=>c.type==='palletQueue');return key==='rackBayWidths'?String(c[key]).replace(/\s/g,'')===String(value).replace(/\s/g,''):String(c[key])===String(value);},key,value),'Rack field did not apply: '+key);
      };
      const frame=async(close=false)=>b.call(close=>{
        const e=context.editor,o=e.document.getObject(__rackQA.id);e.select(null);e.clearAssetPreview();e.shell.setPanel('resources',false);e.shell.setPanel('hierarchy',false);e.shell.setPanel('inspector',false);e.resize();
        const box=e.collisionWorld.objectBounds(o),center=box.getCenter(e.camera.position.clone()),size=box.getSize(e.camera.position.clone());e.stopOrbitMotion();e.camera.fov=42;e.camera.updateProjectionMatrix();
        if(close){center.set(box.min.x+.10,box.min.y+.28,box.max.z-.02);e.camera.position.copy(center).add(e.camera.position.clone().set(.75,.50,1.25));}
        else {const radius=size.length()/2,distance=Math.max(4,radius*1.18/Math.sin(42*Math.PI/360));e.camera.position.copy(center).addScaledVector(e.camera.position.clone().set(1,.65,1.25).normalize(),distance);}
        e.orbit.target.copy(center);e.safeCameraPosition=null;e.safeOrbitTarget=null;e.orbit.update();e.constrainEditorCamera(false);e.camera.updateWorldMatrix(true,false);
      },close);
      await b.send('Emulation.setDeviceMetricsOverride',{width:1600,height:1050,deviceScaleFactor:1,mobile:false});
      await b.send('Emulation.setFocusEmulationEnabled',{enabled:true});
      await b.send('Page.navigate',{url:fixture.origin+'/editor'});
      await until(()=>b.evaluate('!!document.getElementById("login")'),'Login unavailable.');
      await b.call(password=>{const f=document.getElementById('login');f.elements.username.value='qa_production_owner';f.elements.password.value=password;f.requestSubmit();},password);
      await ready();await editing();
      await b.call(()=>{window.__rackProjectOperation=context.editor.studioTools.newProject();return true;});
      await until(()=>b.evaluate('!!document.querySelector(".ed-scene-create[open]")'),'New-project wizard unavailable.');
      await b.call(()=>{const d=document.querySelector('.ed-scene-create');d.querySelector('.ed-scene-create-choice').click();d.querySelector('input').value='QA · Estanterías estructurales';d.querySelector('form').requestSubmit();});
      await b.evaluate('__rackProjectOperation');await ready();
      await b.call(()=>{context.editor.projectSync.stop();context.graphics.setMode('balanced');});
      console.log('Rack production QA: configurable structure and addressing.');
      const initial=await add('selective');assert.equal(initial.controls.length,0,'A storage rack must not contain a machine-control panel.');
      await field('rackBayWidth',3.4);await field('rackAisleCode','A_12');await field('rackRowCode','R_07');await field('rackBayWidths','3.4,2.8');
      const resized=await snapshot();assert(resized.size[0]>initial.size[0]);assert.equal(resized.config.rackBayWidths.replace(/\s/g,''),'3.4,2.8');assert(resized.codes.every(code=>/^A_12-R_07-/.test(code)));assert.equal(new Set(resized.codes).size,resized.codes.length);assert(new Set(resized.cellWidths.map(v=>v.toFixed(3))).size>1,'Different bay widths must change actual slot widths.');
      report.resize={before:initial.size,after:resized.size,codes:resized.codes,cellWidths:resized.cellWidths};
      await b.call(code=>{
        const plan=document.querySelector('[data-rack-plan]');if(!plan)throw Error('Location configuration panel missing.');
        const select=plan.querySelector('[data-rack-location-select]'),pallet=plan.querySelector('[data-rack-pallet-id]');select.value=code;pallet.value='PALLET-QA-001';
        plan.querySelector('[data-rack-action="assign"]').click();
      },resized.codes[0]);await ready();
      await until(()=>b.call(code=>{const e=context.editor,c=e.document.getBehaviors(e.document.getObject(__rackQA.id)).find(c=>c.type==='palletQueue');return JSON.parse(c.rackAssignments).some(row=>row.locationCode===code&&row.palletId==='PALLET-QA-001');},resized.codes[0]),'The location panel did not save the chosen pallet assignment.');
      report.planUI={locationCode:resized.codes[0],palletId:'PALLET-QA-001',savedThroughPanel:true};
      report.planUI.beforeDimensions=await b.call(()=>{
        const plan=document.querySelector('[data-rack-plan]'),width=document.querySelector('[data-behavior-field="rackBayWidth"]');
        return !!(plan&&width&&(plan.compareDocumentPosition(width)&Node.DOCUMENT_POSITION_FOLLOWING));
      });assert(report.planUI.beforeDimensions,'Location planning must be visible before the detailed structural dimensions.');
      await b.call(()=>{const e=context.editor;e.select(e.document.getObject(__rackQA.id));e.showInspectorTab('object');e.shell.setPanel('inspector',true);});await b.screenshot('rack-location-inspector');
      await b.call(()=>{const e=context.editor,duplicate=[...e.inspector.querySelectorAll('button')].find(b=>b.textContent==='Duplicar con funciones');if(!duplicate)throw Error('Rack duplicate action unavailable.');duplicate.click();});await ready();
      report.duplicate=await b.call(()=>{
        const e=context.editor,original=e.document.getObject(__rackQA.id),copy=e.selected;if(!copy||copy===original)throw Error('Duplicate did not create its own rack.');
        const config=o=>e.document.getBehaviors(o).find(c=>c.type==='palletQueue'),a=config(original),b=config(copy);__rackQA.duplicateId=copy.userData.editorId;
        return {originalId:__rackQA.id,duplicateId:copy.userData.editorId,originalRow:a.rackRowCode,duplicateRow:b.rackRowCode,aisle:b.rackAisleCode,bayWidths:b.rackBayWidths,assignments:JSON.parse(b.rackAssignments)};
      });
      assert.notEqual(report.duplicate.originalRow,report.duplicate.duplicateRow,'Copied rows must have unique physical location addresses.');assert.equal(report.duplicate.bayWidths,resized.config.rackBayWidths);assert.deepEqual(report.duplicate.assignments,[],'Duplicating a rack must not reserve the same physical pallet twice.');
      await b.call(async()=>{const e=context.editor;await e.perform(()=>e.document.remove(e.document.getObject(__rackQA.duplicateId)));e.select(e.document.getObject(__rackQA.id));});await ready();
      const saved=await b.call(async()=>{const e=context.editor;await e.saveProject();return {projectId:e.currentProject.id,rackId:__rackQA.id,config:e.document.getBehaviors(e.document.getObject(__rackQA.id)).find(c=>c.type==='palletQueue')};});
      await b.send('Page.navigate',{url:fixture.origin+'/editor?project='+encodeURIComponent(saved.projectId)});await ready();await editing();
      await b.call(id=>{window.__rackQA={id,system:'selective'};context.editor.projectSync.stop();},saved.rackId);
      report.reopened=await snapshot();for(const key of ['rackBayWidth','rackAisleCode','rackRowCode','rackBayWidths','rackAssignments'])assert.equal(report.reopened.config[key],saved.config[key]);assert.deepEqual(report.reopened.codes,resized.codes);
      await frame();await b.screenshot('rack-structure-selective');await frame(true);await b.screenshot('rack-structure-fasteners');
      await b.call(async()=>{
        const e=context.editor;await e.perform(()=>{
          const rack=e.document.getObject(__rackQA.id),old=e.document.getBehaviors(rack);e.document.setBehaviors(rack,old.map(c=>c.type==='palletQueue'?{...c,rackAssignments:'[]'}:c));
          const source=e.document.addPrefab(e.roomId,'source'),configs=e.document.getBehaviors(source);e.document.setBehaviors(source,configs.map(c=>c.type==='source'?{...c,initialCount:2,autoGenerate:false,delivery:'manual',withPanel:false,
            generationMode:'sequence',loadMode:'pallet',palletType:'euro-1200x800',palletColumns:2,palletRows:2,palletLayers:1,
            catalog:JSON.stringify([{id:'qa-rack-box',name:'Carga de prueba',type:'box',variant:'box-small',width:.3,depth:.3,height:.2,mass:2,base:'flat',quality:'good',defect:'none',color:'#b98d53'}])}:c));
          e.document.setTransform(source,{position:[-10,1,0]});source.userData.rackQASource=true;__rackQA.sourceId=source.userData.editorId;
        });e.select(null);e.leave();e.simulationPaused=true;
      });
      await until(()=>b.evaluate('context.editor.simulation.running && !!context.editor.simulation.records.get(__rackQA.sourceId)'), 'Rack assignment simulation did not start.');
      const runtimePlan=await b.call(()=>{
        const e=context.editor,s=e.simulation,source=s.records.get(__rackQA.sourceId),rack=s.records.get(__rackQA.id),product=s.sourceRuntime.materialize(source);
        e.simulationPanel.toggle(true);e.simulationPanel.objectSelect.value=rack.id;e.simulationPanel.render(true);
        return {palletId:s.palletQueueRuntime.palletIdentity(product),locationCode:s.palletQueueRuntime.locations(rack)[0].code};
      });
      await b.call(plan=>{
        const panel=document.querySelector('[data-rack-inventory]');if(!panel)throw Error('The running rack inventory panel is missing.');
        const location=panel.querySelector('[data-rack-location-select]'),pallet=panel.querySelector('[data-rack-pallet-id]');location.value=plan.locationCode;location.dispatchEvent(new Event('change',{bubbles:true}));
        pallet.value=plan.palletId;pallet.dispatchEvent(new Event('change',{bubbles:true}));const assign=panel.querySelector('[data-rack-action="assign"]');if(assign.disabled)throw Error('The actual pallet cannot be assigned from the running inventory panel.');assign.click();
      },runtimePlan);
      await until(()=>b.call(plan=>{const s=context.editor.simulation,row=s.palletQueueRuntime.locations(s.records.get(__rackQA.id)).find(row=>row.code===plan.locationCode);return row.assignedPalletId===plan.palletId;},runtimePlan),'The runtime inventory action did not reserve its real pallet.');
      report.assignment=await b.call(()=>{
        const e=context.editor,s=e.simulation,api=s.palletQueueRuntime,rack=s.records.get(__rackQA.id),source=s.records.get(__rackQA.sourceId),component=rack.components.palletQueue;
        const entry=source.components.source.queue[0],product=s.sourceRuntime.materialize(source),mesh=product.object,palletId=api.palletIdentity(product),locations=api.locations(rack),slot=locations[0];
        const planned=api.locations(rack).find(row=>row.code===slot.code);if(planned.assignedPalletId!==palletId)throw Error('The chosen pallet assignment was not visible in inventory.');
        const placement=api.rackPlacement(rack,product);if(!placement||placement.palletIndex!==slot.index)throw Error('Placement did not honor its assigned location.');
        const wrong={...placement,palletIndex:locations[1].index,globalSlot:locations[1].index,rackStorageCell:locations[1].index};
        const mismatchRejected=!api.receive(rack,entry,true,wrong),sourceStillOwns=source.components.source.queue.includes(entry)&&entry.ownerId===source.id;
        if(!mismatchRejected||!sourceStillOwns)throw Error('A mismatched location changed custody.');
        if(!s.sourceRuntime.remove(source,entry,'ubicación verificada')||!api.receive(rack,entry,true,placement))throw Error('Physical pallet placement failed.');
        const occupied=api.locations(rack).find(row=>row.code===slot.code),labels=[];product.object.traverse(n=>{if(n.userData.warehouseLocationLabel)labels.push({text:n.userData.warehouseLocationLabel,renderedText:n.userData.warehouseLocationRenderedText});});
        const cell=component.rack.layout.cells[slot.index],worldSupport=rack.object.localToWorld(rack.object.position.clone().fromArray(cell.position));
        e.simulation.refreshVariables();e.simulationPanel.toggle(true);e.simulationPanel.objectSelect.value=rack.id;e.simulationPanel.render(true);
        __rackQA.palletId=palletId;__rackQA.locationCode=slot.code;
        const center=placement.bounds.getCenter(context.camera.position.clone()),eye=center.clone().add(context.camera.position.clone().set(2,1.4,3));context.camera.parent.updateWorldMatrix(true,true);context.camera.position.copy(context.camera.parent.worldToLocal(eye));context.camera.lookAt(center);context.camera.updateWorldMatrix(true,true);
        return {palletId,locationCode:slot.code,assignedThroughRuntimePanel:true,mismatchRejected,sourceStillOwns,occupied,sameEntry:component.queue[0]===entry,sameMesh:entry.product.object===mesh,units:entry.units,
          mass:s.productMetadata(product).mass,metadata:{palletId:mesh.userData.sourcePalletId,locationCode:mesh.userData.sourceRackLocationCode,owner:mesh.userData.sourceRackLocationOwner},labels,
          supportGap:product.item.box.min.y-worldSupport.y};
      });
      assert(report.assignment.mismatchRejected&&report.assignment.sourceStillOwns&&report.assignment.sameEntry&&report.assignment.sameMesh);assert.equal(report.assignment.occupied.palletId,report.assignment.palletId);
      assert.equal(report.assignment.units,4);assert.equal(report.assignment.mass,33);
      assert.equal(report.assignment.metadata.palletId,report.assignment.palletId);assert.equal(report.assignment.metadata.locationCode,report.assignment.locationCode);assert(Math.abs(report.assignment.supportGap)<.02,'The stored pallet must physically rest on its assigned support.');
      assert(JSON.stringify(report.assignment.labels).includes(report.assignment.palletId)&&JSON.stringify(report.assignment.labels).includes(report.assignment.locationCode),'The pallet needs physical identity/location labels matching the rack.');
      assert(report.assignment.labels.every(label=>label.text===label.renderedText),'Printed physical labels must preserve identifier case and underscores exactly.');
      await until(()=>b.call((code,palletId)=>{const panel=document.querySelector('[data-rack-inventory]');return !!panel&&panel.textContent.includes(code)&&panel.textContent.includes(palletId);},report.assignment.locationCode,report.assignment.palletId),'The live inventory panel must show the same pallet/location pair.');
      report.inventoryUI=await b.call(()=>{
        const sim=context.editor.simulationPanel,inventory=sim.variables.querySelector('[data-rack-inventory]'),advanced=sim.variables.querySelector('.sim-rack-advanced'),select=inventory.querySelector('[data-rack-location-select]'),assign=inventory.querySelector('[data-rack-action="assign"]'),clear=inventory.querySelector('[data-rack-action="clear"]');select.dispatchEvent(new Event('change',{bubbles:true}));
        const panelRect=sim.panel.getBoundingClientRect(),selectRect=select.getBoundingClientRect(),assignRect=assign.getBoundingClientRect();
        return {inventoryFirst:sim.variables.firstElementChild===inventory,advancedPresent:!!advanced,advancedClosed:!!advanced&&!advanced.open,
          selectorVisible:selectRect.top>=panelRect.top&&selectRect.bottom<=panelRect.bottom,assignmentVisible:assignRect.top>=panelRect.top&&assignRect.bottom<=panelRect.bottom,
          noHorizontalOverflow:sim.panel.scrollWidth<=sim.panel.clientWidth+1,clearDisabledAfterFulfilled:clear.disabled,prefilledPalletId:inventory.querySelector('[data-rack-pallet-id]').value};
      });assert(report.inventoryUI.inventoryFirst&&report.inventoryUI.advancedPresent&&report.inventoryUI.advancedClosed,'The requested inventory workflow must precede collapsed technical variables.');
      assert(report.inventoryUI.selectorVisible&&report.inventoryUI.assignmentVisible&&report.inventoryUI.noHorizontalOverflow,'Assignment controls must be visible immediately without horizontal scrolling.');
      assert(report.inventoryUI.clearDisabledAfterFulfilled,'The fulfilled physical pallet is occupied; it has no pending reservation to clear.');
      assert.equal(report.inventoryUI.prefilledPalletId,report.assignment.palletId,'Selecting the occupied location must identify the exact pallet currently there.');
      await b.screenshot('rack-pallet-location-matching');
      await b.call(()=>{context.editor.simulationPanel.toggle(false);context.editor.enter();});await ready();
      for(const system of SYSTEMS){
        await remove();await add(system.id);await frame();const model=await snapshot();
        assert.equal(model.controls.length,0,system.id+': no physical HMI');assert.equal(model.gl,0,system.id+': WebGL error');assert(model.detail&&model.detail.profiles>0&&model.detail.bolts>0,system.id+': structural profiles and fixings missing');
        assert(model.detail.slotsLabeled===model.codes.length&&model.codes.every(Boolean),system.id+': every real seat needs its physical location code');assert.equal(new Set(model.codes).size,model.codes.length);assert(model.meshes<80&&model.triangles<150000,system.id+': bounded rack geometry');
        model.system=system.id;report.models.push(model);await b.screenshot('rack-structure-'+system.id);console.log('Rack production QA: '+system.id+' profiles='+model.detail.profiles+' bolts='+model.detail.bolts+' seats='+model.codes.length);
      }
      assert.equal(report.models.length,14);assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.failedRequests,[]);assert.deepEqual(fixture.errors,[]);
    });
    report.passed=true;console.log(JSON.stringify({passed:true,workspaceSha256:report.workspaceSha256,models:report.models.length,reopened:true}));
  }catch(error){report.passed=false;report.failure=error.stack||String(error);throw error;}
  finally{report.completedAt=new Date().toISOString();fs.writeFileSync(path.join(OUT,'rack-structure-locations-report.json'),JSON.stringify(report,null,2));await fixture.close();}
  return report;
}
module.exports={run};if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
