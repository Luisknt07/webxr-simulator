'use strict';
// Reviewed bundle only, real WebGL and CollisionWorld, disposable loopback API.
// Baseline records known intersections; the corrected build must pass them.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),THREE=require('three');
const schema=require('../shared/behaviors'),{startTemporaryServer}=require('./qa-project-workspace-browser'),{withBrowser}=require('./qa-public-publication-browser');
const ROOT=path.resolve(__dirname,'..'),OUTPUT=path.join(ROOT,'data/qa-studio'),PASSWORD='Disposable-grasp-fixture-2026!';
const arg=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
const inset=.005,geometryCache=new Map();
function shapeKey({spec,load={}}){return JSON.stringify([spec.width,spec.height,spec.depth,load.loadMode||'individual',load.palletColumns||2,load.palletRows||2,load.palletLayers||1,load.palletType||'euro-1200x800',load.palletMaterial||'wood',load.palletPacking||'grid',load.palletWidth||0,load.palletDepth||0]);}
function cartonVolumes(product){
  const {spec,load}=product;if(!spec||spec.type!=='box')return [];
  if(load&&load.loadMode==='pallet'){
    const plan=schema.productSources.palletPlan(spec,load),base=schema.productSources.pallets.dimensions(load,true);
    const placements=plan.placements||Array.from({length:plan.units},(_,i)=>({x:(i%load.palletColumns)*(spec.width+.02)+(plan.width-load.palletColumns*(spec.width+.02)+.02)/2,z:(Math.floor(i/load.palletColumns)%load.palletRows)*(spec.depth+.02)+(plan.depth-load.palletRows*(spec.depth+.02)+.02)/2,y:Math.floor(i/(load.palletColumns*load.palletRows))*spec.height,width:spec.width,depth:spec.depth}));
    return placements.map(p=>new THREE.Box3(new THREE.Vector3(p.x-plan.width/2,base.height+p.y,p.z-plan.depth/2),new THREE.Vector3(p.x-plan.width/2+p.width,base.height+p.y+spec.height,p.z-plan.depth/2+p.depth)).expandByScalar(-inset));
  }
  return [new THREE.Box3(new THREE.Vector3(-spec.width/2,0,-spec.depth/2),new THREE.Vector3(spec.width/2,spec.height,spec.depth/2)).expandByScalar(-inset)];
}
function analyze(snapshot){
  Object.entries(snapshot.geometries).forEach(([id,value])=>geometryCache.set(id,value));
  const intersections=[],a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),triangle=new THREE.Triangle(a,b,c);
  for(const product of snapshot.products){
    const volumes=cartonVolumes(product),inverse=new THREE.Matrix4().getInverse(new THREE.Matrix4().fromArray(product.matrix));
    for(const mesh of snapshot.meshes){
      const geometry=geometryCache.get(mesh.geometry),positions=geometry.positions,indices=geometry.indices,matrix=new THREE.Matrix4().multiplyMatrices(inverse,new THREE.Matrix4().fromArray(mesh.matrix));
      let hits=0;
      for(let i=0;i<(indices?indices.length:positions.length/3);i+=3){
        const at=n=>(indices?indices[n]:n)*3;
        a.fromArray(positions,at(i)).applyMatrix4(matrix);b.fromArray(positions,at(i+1)).applyMatrix4(matrix);c.fromArray(positions,at(i+2)).applyMatrix4(matrix);
        if(volumes.some(box=>box.intersectsTriangle(triangle)))hits++;
      }
      if(hits)intersections.push({product:product.id,loadMode:product.load&&product.load.loadMode,mesh:mesh.name,role:mesh.role,trianglesInside: hits});
    }
  }
  return {insetMeters:inset,testedProducts:snapshot.products.length,testedMeshes:snapshot.meshes.length,intersections};
}
async function run(){
  fs.mkdirSync(OUTPUT,{recursive:true});
  const bundleSha256=crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,'bundle.js'))).digest('hex'),expected=arg('--expected-bundle-sha256');
  assert(expected&&/^[a-f0-9]{64}$/.test(expected),'Pass --expected-bundle-sha256 for the exact reviewed build.');assert.equal(bundleSha256,expected);
  const baseline=process.argv.includes('--baseline'),label=arg('--label')||(baseline?'baseline':'corrected');
  const sceneIds=(arg('--scenes')||(process.argv.includes('--all')?'vr-robot-dispatch,vr-robot-transfer,vr-robot-turn,robot-handling-line,robot-scara-sorting':'vr-robot-dispatch')).split(',');
  const cycles=Number(arg('--cycles')||1);assert(Number.isInteger(cycles)&&cycles>=1&&cycles<=6,'--cycles must be an integer from 1 to 6 for these finite fixtures.');
  assert(/^[a-z0-9-]+$/.test(label));
  const fixture=await startTemporaryServer(),report={label,baseline,bundleSha256,requestedCycles:cycles,geometryCoverage:{types:['box'],insetMeters:inset,description:'Visible robot triangles against separate carton interiors; every requested handling cycle and format must complete.'},scenes:[]};
  try{
    const registered=await fixture.request('/api/studio/register','POST',{username:'qa_grasp_operator',displayName:'QA de agarre temporal',password:PASSWORD});assert.equal(registered.status,201);
    await withBrowser(fixture.origin,async browser=>{
      await browser.navigate('/');await browser.call(async password=>{await context.studio.client.login('qa_grasp_operator',password);await context.studio.client.me();await context.studio.authenticated();},PASSWORD);
      await browser.navigate('/editor');await browser.call(async ids=>context.editor.studioTools.createStudyProject(ids,{name:'QA de agarre y holgura',continuous:false}),sceneIds);
      for(let room=0;room<sceneIds.length;room++){
        await browser.call(async index=>{const e=context.editor;if(!e.active)e.enter();await e.hooks.gotoRoom(index);e.home();},room);
        const initial=await browser.call(()=>{
          const e=context.editor,object=e.document.getObjects(e.roomId).find(o=>o.parent===e.root&&e.document.getBehaviors(o).some(c=>c.type==='robot'));
          if(!object)throw Error('Robot fixture missing.');window.__qaGraspId=object.userData.editorId;window.__qaGraspGeometrySent=new Set();
          e.leave();e.simulationPaused=true;const record=e.simulation.records.get(__qaGraspId),robot=record.components.robot;
          return {room:e.roomId,id:record.id,family:robot.config.family,tool:robot.config.tool,position:record.object.position.toArray(),sourceConfigs:[...e.simulation.records.values()].filter(r=>r.components.source).map(r=>r.components.source.config)};
        });
        const recipes=new Map();
        for(const config of initial.sourceConfigs){const catalog=schema.productSources.normalizeCatalog(config.catalog);for(const spec of catalog.length?catalog:[schema.productSources.singleSpec(config)]){if(spec.type!=='box')continue;const recipe={spec,load:config};recipes.set(shapeKey(recipe),cartonVolumes(recipe).map(box=>({min:box.min.toArray(),max:box.max.toArray()})));}}
        delete initial.sourceConfigs;
        await browser.call(async rows=>{
          const T=await import('/node_modules/three/build/three.module.js'),e=context.editor,s=e.simulation,record=s.records.get(__qaGraspId),r=record.components.robot,rig=r.visualRoot.userData.robotRig,nodes=[],shapes=new Map(rows.map(([key,boxes])=>[key,boxes.map(box=>new T.Box3(new T.Vector3().fromArray(box.min),new T.Vector3().fromArray(box.max)))]));
          const keyOf=({spec,load={}})=>JSON.stringify([spec.width,spec.height,spec.depth,load.loadMode||'individual',load.palletColumns||2,load.palletRows||2,load.palletLayers||1,load.palletType||'euro-1200x800',load.palletMaterial||'wood',load.palletPacking||'grid',load.palletWidth||0,load.palletDepth||0]);
          const visible=o=>{for(let p=o;p;p=p.parent)if(!p.visible)return false;return true;};
          rig.visual.traverse(node=>{if(node.geometry&&node.geometry.attributes.position){if(!node.geometry.boundingBox)node.geometry.computeBoundingBox();nodes.push(node);}});
          const a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),triangle=new T.Triangle(a,b,c),inverse=new T.Matrix4(),matrix=new T.Matrix4(),instance=new T.Matrix4(),worldMatrix=new T.Matrix4(),broad=new T.Box3(),robotPosition=new T.Vector3(),position=new T.Vector3();
          const state=window.__qaGraspPath={stepSeconds:1/60,testedFrames:0,framesWithClipping:0,maxClippingCount:0,firstEvent:null,missingRecipes:[],events:[],completedCycles:0,carriedFormats:[]};
          window.__qaGraspCheckPath=()=>{
            e.root.updateMatrixWorld(true);record.object.getWorldPosition(robotPosition);let clippingCount=0;
            state.completedCycles=r.completed;
            if(r.entry&&!state.carriedFormats.some(spec=>spec.id===r.entry.spec.id)){const spec=r.entry.spec;state.carriedFormats.push({id:spec.id,type:spec.type,width:spec.width,height:spec.height,depth:spec.depth});}
            for(const product of s.products.values()){
              const entry=product.sourceEntry;if(!entry||entry.spec.type!=='box'||!visible(product.object))continue;
              product.object.getWorldPosition(position);if(position.distanceTo(robotPosition)>r.config.reach+2)continue;
              const key=keyOf(entry),boxes=shapes.get(key);if(!boxes){if(!state.missingRecipes.includes(key))state.missingRecipes.push(key);continue;}
              inverse.getInverse(product.object.matrixWorld);const productBroad=product.bounds.clone().applyMatrix4(product.object.matrixWorld);
              for(const node of nodes){
                if(!visible(node))continue;const g=node.geometry,p=g.attributes.position,index=g.index,count=index?index.count:p.count;
                for(let item=0;item<(node.isInstancedMesh?node.count:1);item++){
                  if(node.isInstancedMesh){node.getMatrixAt(item,instance);worldMatrix.multiplyMatrices(node.matrixWorld,instance);}else worldMatrix.copy(node.matrixWorld);
                  broad.copy(g.boundingBox).applyMatrix4(worldMatrix);if(!broad.intersectsBox(productBroad))continue;
                  matrix.multiplyMatrices(inverse,worldMatrix);let hits=0;
                  for(let i=0;i<count;i+=3){a.fromBufferAttribute(p,index?index.getX(i):i).applyMatrix4(matrix);b.fromBufferAttribute(p,index?index.getX(i+1):i+1).applyMatrix4(matrix);c.fromBufferAttribute(p,index?index.getX(i+2):i+2).applyMatrix4(matrix);if(boxes.some(box=>box.intersectsTriangle(triangle)))hits++;}
                  if(hits){clippingCount++;const event={time:s.time,phase:r.phase,phaseElapsed:r.phaseElapsed,product:entry.id,held:product.robotOwnerId===record.id,mesh:node.name,role:node.userData.industrialMaterialRole,trianglesInside:hits};if(!state.firstEvent)state.firstEvent=event;if(state.events.length<12&&!state.events.some(old=>old.phase===event.phase&&old.mesh===event.mesh&&old.product===event.product))state.events.push(event);}
                }
              }
            }
            state.testedFrames++;if(clippingCount)state.framesWithClipping++;state.maxClippingCount=Math.max(state.maxClippingCount,clippingCount);
          };
          __qaGraspCheckPath();
        },[...recipes]);
        const compact=/^vr-robot-(?:dispatch|transfer|turn)$/.test(sceneIds[room]),effectiveCycles=compact?1:cycles;
        const result={sceneId:sceneIds[room],initial,requestedCycles:cycles,effectiveCycles,cycleCondition:compact?'One complete robot cycle; the one-pallet output waits for the manual forklift.':'Complete every requested cycle, including return to idle; first-cycle screenshots remain unchanged.',stages:[]};report.scenes.push(result);
        const stages=[['approach','approach',.65],['pick','pick',.9],['lift','lift',.55],['carry','carry',.5],['place','place',.85],['home','idle',0]];
        for(const [name,phase,fraction] of stages){
          const reached=await browser.call(async (wanted,fraction)=>{
            const e=context.editor,s=e.simulation,r=s.records.get(__qaGraspId),robot=r.components.robot;
            for(let step=0;step<60*80;step++){
              if(robot.fault)throw Error(robot.fault);
              if(robot.phase===wanted&&(wanted==='idle'?robot.completed>=1:robot.phaseElapsed/Math.max(.001,robot.duration)>=fraction))return {phase:robot.phase,phaseElapsed:robot.phaseElapsed,completed:robot.completed,blocked:robot.blocked,time:s.time};
              e.root.updateMatrixWorld(true);const world=e.ctx.collisionWorld;if(world)world.beginFrame();try{s.execute(1/60);}finally{if(world)world.endFrame();}__qaGraspCheckPath();
              if(step%120===119)await new Promise(resolve=>setTimeout(resolve,0));
            }
            throw Error('Phase timeout '+wanted+': '+JSON.stringify(r.variables));
          },phase,fraction).catch(async error=>{result.path=await browser.call(()=>__qaGraspPath).catch(()=>null);throw error;});
          const snapshot=await browser.call(()=>{
            const e=context.editor,s=e.simulation,record=s.records.get(__qaGraspId),r=record.components.robot,rig=r.visualRoot.userData.robotRig,geometries={},meshes=[],products=[];
            e.root.updateMatrixWorld(true);
            const robotPosition=record.object.getWorldPosition(record.object.position.clone());
            const visible=o=>{for(let p=o;p;p=p.parent)if(!p.visible)return false;return true;};
            for(const product of s.products.values()){
              if(!visible(product.object))continue;const position=product.object.getWorldPosition(product.object.position.clone());if(position.distanceTo(robotPosition)>r.config.reach+2)continue;
              const entry=product.sourceEntry;if(!entry)continue;
              products.push({id:entry.id,held:product.robotOwnerId===record.id,spec:entry.spec,load:entry.load,matrix:product.object.matrixWorld.toArray(),metadata:s.productMetadata(product)});
            }
            rig.visual.traverse(node=>{
              if(!node.geometry||!visible(node))return;
              for(let p=node;p&&p!==rig.visual;p=p.parent)if(s.products.has(p))return;
              const geometry=node.geometry;if(!geometry.attributes.position)return;
              if(!__qaGraspGeometrySent.has(geometry.uuid)){geometries[geometry.uuid]={positions:Array.from(geometry.attributes.position.array),indices:geometry.index?Array.from(geometry.index.array):null};__qaGraspGeometrySent.add(geometry.uuid);}
              const add=matrix=>meshes.push({name:node.name,role:node.userData.industrialMaterialRole,geometry:geometry.uuid,matrix:matrix.toArray()});
              if(node.isInstancedMesh){for(let i=0;i<node.count;i++){const matrix=node.matrixWorld.clone();node.getMatrixAt(i,matrix);add(node.matrixWorld.clone().multiply(matrix));}}else add(node.matrixWorld);
            });
            const held=r.entry&&r.entry.product||r.candidate&&r.candidate.product;
            if(held)window.__qaGraspLastProduct=held;
            const aim=window.__qaGraspLastProduct?window.__qaGraspLastProduct.object.getWorldPosition(robotPosition.clone()):robotPosition.clone();aim.y+=.2;
            context.cameraRig.position.set(0,0,0);context.cameraRig.quaternion.set(0,0,0,1);context.camera.position.copy(aim).add(aim.clone().set(3.1,2.0,3.5));context.camera.lookAt(aim);
            e.industrialVisuals.sync(e.roomId,0,false);e.lineMonitors.sync(e.roomId,0,false);
            return {phase:r.phase,completed:r.completed,entryId:r.entry&&r.entry.id,geometries,meshes,products,tcp:rig.tool.getWorldPosition(robotPosition.clone()).toArray(),gripSpan:r.pose.gripSpan};
          });
          const geometry=analyze(snapshot);result.stages.push({name,...reached,entryId:snapshot.entryId,tcp:snapshot.tcp,gripSpan:snapshot.gripSpan,geometry});
          await browser.screenshot('robot-grasp-'+label+'-'+sceneIds[room]+'-'+name);
          if(name==='lift'||name==='home'){
            await browser.call(()=>{const e=context.editor,r=e.simulation.records.get(__qaGraspId),p=__qaGraspLastProduct.object.getWorldPosition(r.object.position.clone());p.y+=.18;context.camera.position.copy(p).add(p.clone().set(-1.4,.9,1.7));context.camera.lookAt(p);});
            await browser.screenshot('robot-grasp-'+label+'-'+sceneIds[room]+'-'+name+'-close');
          }
          console.log(sceneIds[room],name,'completed='+reached.completed,'penetrating meshes='+geometry.intersections.length);
        }
        if(effectiveCycles>1)await browser.call(async target=>{
          const e=context.editor,s=e.simulation,record=s.records.get(__qaGraspId),r=record.components.robot;
          for(let step=0;step<60*240;step++){
            if(r.fault)throw Error(r.fault);
            if(r.completed>=target&&r.phase==='idle')return;
            e.root.updateMatrixWorld(true);const world=e.ctx.collisionWorld;if(world)world.beginFrame();try{s.execute(1/60);}finally{if(world)world.endFrame();}__qaGraspCheckPath();
            if(step%120===119)await new Promise(resolve=>setTimeout(resolve,0));
          }
          throw Error('Cycle timeout '+target+': '+JSON.stringify(record.variables));
        },effectiveCycles).catch(async error=>{result.path=await browser.call(()=>__qaGraspPath).catch(()=>null);throw error;});
        result.path=await browser.call(()=>__qaGraspPath);assert.equal(result.path.missingRecipes.length,0,'Every nearby carton must have its actual source recipe.');
        assert.equal(result.path.completedCycles,effectiveCycles,'Every requested complete cycle must actually finish.');
        console.log(sceneIds[room],'full path:',result.path.testedFrames,'frames, cycles='+result.path.completedCycles+', maximum penetrating meshes='+result.path.maxClippingCount);
      }
      report.browser={exceptions:browser.report.exceptions,consoleErrors:browser.report.consoleErrors,apiFailures:browser.report.apiFailures,shots:browser.report.shots};
      assert.deepEqual(report.browser.exceptions,[]);assert.deepEqual(report.browser.consoleErrors,[]);assert.deepEqual(report.browser.apiFailures,[]);
    });
    assert.deepEqual(fixture.errors,[]);
    if(!baseline){assert.deepEqual(report.scenes.flatMap(scene=>scene.stages.flatMap(stage=>stage.geometry.intersections)),[],'Robot triangles enter carton interiors by more than the 5 mm contact allowance.');assert(report.scenes.every(scene=>scene.path.maxClippingCount===0),'Robot triangles clip carton interiors between screenshot phases.');}
    console.log('PASS phase-specific robot grasp '+label+'; reviewed bundle '+bundleSha256+'.');
  }catch(error){report.failure=error.stack;throw error;}
  finally{fs.writeFileSync(path.join(OUTPUT,'robot-grasp-clearance-'+label+'.json'),JSON.stringify(report,null,2));await fixture.close();}
}
module.exports={run,analyze,cartonVolumes};if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
