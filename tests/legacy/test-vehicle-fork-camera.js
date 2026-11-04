const __layout = require("../../tooling/layout.cjs");
'use strict';
// Actual mechanisms, pallet, monitor and camera. Renderer calls are recorded;
// final browser QA separately verifies the real GPU output.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const h = require('./test-vehicle-runtime.js'), {THREE} = h;
const source = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-vehicle-fork-camera.js"), 'test-vehicle-driving.js')), 'utf8');
const {setup, Element} = new Function('require', '__dirname', source.slice(0, source.indexOf('const desktop = setup();')) + '\nreturn {setup,Element};')(require, __dirname);
Element.prototype.getBoundingClientRect = function () { return this.rect || {left: 0, top: 0, width: 768, height: 432}; };
const near = (a, b, eps = 1e-6) => assert(Math.abs(a - b) < eps, `${a} != ${b}`);
function renderer(f, pixelRatio = 1.25) {
  const canvas = new Element('canvas'); canvas.width = 1600; canvas.height = 900; canvas.rect = {left: 0, top: 60, width: 1280, height: 720};
  const state = {target: null, cube: 2, mip: 3, viewport: new THREE.Vector4(4, 5, 800, 450), scissor: new THREE.Vector4(7, 8, 444, 333), scissorTest: true, framebuffer: f.ctx.vrMode ? {} : null};
  state.glViewport = state.viewport.clone().multiplyScalar(pixelRatio).floor();
  f.session.renderState = {baseLayer: {framebuffer: state.framebuffer}};
  const calls = [], api = f.ctx.renderer;
  Object.assign(api, {domElement: canvas, autoClear: false, toneMapping: THREE.ReinhardToneMapping, toneMappingExposure: 1.7,
    shadowMap: {enabled: true, autoUpdate: true, needsUpdate: true}, info: {autoReset: true, render: {calls: 17, triangles: 256, frame: 5, lines: 2, points: 0}},
    getRenderTarget: () => state.target, getActiveCubeFace: () => state.cube, getActiveMipmapLevel: () => state.mip,
    getViewport: out => out.copy(state.viewport), getScissor: out => out.copy(state.scissor), getScissorTest: () => state.scissorTest,
    setRenderTarget(target, cube, mip) { state.target = target; state.cube = cube; state.mip = mip; state.glViewport.copy(target ? target.viewport : state.viewport.clone().multiplyScalar(pixelRatio).floor()); }, setFramebuffer(value) { state.framebuffer = value; },
    setViewport(x, y, w, z) { state.viewport.copy(x && x.isVector4 ? x : new THREE.Vector4(x, y, w, z)); state.glViewport.copy(state.viewport).multiplyScalar(pixelRatio).floor(); },
    setScissor(x, y, w, z) { state.scissor.copy(x && x.isVector4 ? x : new THREE.Vector4(x, y, w, z)); }, setScissorTest: value => { state.scissorTest = value; },
    getPixelRatio: () => pixelRatio, getContext: () => ({isContextLost: () => false}),
    render(scene, camera) {
      calls.push({scene, camera, target: state.target, viewport: state.glViewport.clone(), scissor: state.scissor.clone()});
      if (state.target) {
        assert.equal(api.xr.enabled, false); assert.equal(api.shadowMap.autoUpdate, false); assert.equal(api.shadowMap.needsUpdate, false);
        for (const helper of [f.cameraRig, f.driving.docking.plane, f.driving.worldPanel.plane, f.driving.docking.forkCamera.plane]) assert.equal(helper.visible, false);
        if (api.failNext) { api.failNext = false; throw new Error('GPU fixture failure'); }
        scene.updateMatrixWorld(true); f.camera.matrixWorld.makeTranslation(998, 2, 9);
      }
      api.info.render.calls += 200; api.info.render.triangles += 999;
    }});
  api.xr.enabled = true; api.xr.isPresenting = !!f.ctx.vrMode; return {api, calls, state, canvas};
}
function baseline(f, r) { return {target:r.state.target,cube:r.state.cube,mip:r.state.mip,viewport:r.state.viewport.toArray(),scissor:r.state.scissor.toArray(),test:r.state.scissorTest,
  xr:r.api.xr.enabled,autoClear:r.api.autoClear,tone:r.api.toneMapping,exposure:r.api.toneMappingExposure,shadow:Object.assign({},r.api.shadowMap),info:JSON.stringify(r.api.info),
  camera:f.camera.matrixWorld.toArray(),projection:f.camera.projectionMatrix.toArray(),position:f.camera.position.toArray(),quaternion:f.camera.quaternion.toArray(),rig:f.cameraRig.matrixWorld.toArray()}; }

function mounted(vr = false, pixelRatio = 1.25) {
  const f = setup(vr, true); f.screen = renderer(f, pixelRatio); f.ctx.graphics = {getLimits: () => ({tier: 'balanced'})};
  assert(f.driving.mount(f.record.id)); f.feed = f.driving.docking.forkCamera;
  f.driving.docking.feedViewport.rect = {left: 850, top: 480, width: 360, height: 202.5};
  return f;
}
function updateBoth(f) { for (let i = 0; i < 3; i++) assert(f.driving.docking.renderBefore(f.scene, .2)); }
function meshes(f) { const values = []; [f.object, f.pallet].forEach(root => root.traverse(node => { if (node.isMesh && !node.userData.editorRuntimeHelper) values.push(node); })); return values; }
function firstAt(f, local, camera) {
  const forks = f.api.rig(f.record).forks, screen = local.clone().applyMatrix4(forks.matrixWorld).project(camera), ray = new THREE.Raycaster();
  assert(Math.abs(screen.x) < .99 && Math.abs(screen.y) < .99, 'Both physical tines remain in the working crop.');
  ray.setFromCamera(new THREE.Vector2(screen.x, screen.y), camera); ray.near = camera.near; ray.far = camera.far; return ray.intersectObjects(meshes(f), false)[0];
}
function isFork(f, hit) { let object = hit && hit.object; const forks = f.api.rig(f.record).forks; while (object && object !== forks) object = object.parent; return object === forks; }

// A native elevated pickup is already in the horizontal inspection zone while
// the stricter three-dimensional raw docking probe has no candidate yet.
// The selected, physically eligible guide target must still be the real load.
{
 const f=mounted(),camera=f.feed,guide=f.driving.holographicGuide,product=f.runtime.products.get(f.pallet),originalPosition=f.pallet.position.clone();
 const support=new THREE.Mesh(new THREE.BoxBufferGeometry(1.8,2,1.5),new THREE.MeshBasicMaterial());support.position.set(0,1,3.15);f.root.add(support);
 f.pallet.position.set(0,2,3.15);f.scene.updateMatrixWorld(true);guide.update(true);assert(guide.setTarget('pickup:'+product.record.id));
 const raw=f.api.getDockingState(f.record);assert(!raw.geometry.target,'The actual raw docking probe has not identified the elevated pallet.');assert(guide.currentTarget.allowed);
 const forks=f.api.rig(f.record).forks,from=forks.getWorldPosition(new THREE.Vector3()),to=product.bounds.getCenter(new THREE.Vector3()).applyMatrix4(product.object.matrixWorld);
 assert(Math.hypot(from.x-to.x,from.z-to.z)<2,'The genuine pallet is already inside the automatic camera entry radius.');
 const custody=()=>({pose:JSON.stringify(f.v.pose),vehicle:f.object.matrixWorld.toArray(),product:product.object.matrixWorld.toArray(),parent:product.object.parent,entry:f.v.entry,owner:product.vehicleOwnerId,reserved:product.vehicleReservedBy,population:f.runtime.products.size});
 const initial=custody();
 for(const mode of ['isometric','entry','tips']){
  camera.setMode(mode);const frame=camera.frame(raw);assert.equal(frame.product,product);assert.equal(frame.approach,1,'Approach framing includes the elevated receiver before insertion.');assert(camera.camera.isOrthographicCamera);
  for(const x of [product.bounds.min.x,product.bounds.max.x])for(const y of [product.bounds.min.y,product.bounds.max.y])for(const z of [product.bounds.min.z,product.bounds.max.z]){
   const projected=new THREE.Vector3(x,y,z).applyMatrix4(product.object.matrixWorld).project(camera.camera);assert(Math.abs(projected.x)<1&&Math.abs(projected.y)<1&&Math.abs(projected.z)<1,'Every real load corner is inside the approach camera frustum.');
  }
  for(const side of [-1,1])for(const fraction of [.12,.94]){
   const point=new THREE.Vector3(side*f.config.forkSpread/2,0,f.config.forkLength*fraction).applyMatrix4(forks.matrixWorld).project(camera.camera);assert(Math.abs(point.x)<1&&Math.abs(point.y)<1&&Math.abs(point.z)<1,'Both physical insertion tines stay visible beside the approached load.');
  }
  assert.deepEqual(custody(),initial,'Framing cannot reposition cargo, change mechanism pose or acquire custody.');
 }
 camera.setMode('isometric');camera.setAvailable(true);assert(camera.renderBefore(f.scene,.2));assert(camera.hasCurrentFrame());
 const firstKey=camera.frameKey(),secondObject=f.pallet.clone(true);secondObject.position.x=1.8;secondObject.userData.editorId='camera-second-pallet';f.root.add(secondObject);
 const secondRecord=Object.assign({},product.record,{id:secondObject.userData.editorId,object:secondObject});f.runtime.records.set(secondRecord.id,secondRecord);
 const second=f.runtime.registerProduct(secondObject,secondRecord,null);f.scene.updateMatrixWorld(true);guide.update(true);assert(guide.setTarget('pickup:'+secondRecord.id));
 assert.notEqual(camera.frameKey(),firstKey);assert(!camera.hasCurrentFrame(),'Changing the actual selected pickup invalidates the previous camera frame immediately.');assert.equal(camera.product(f.record,raw),second);
 assert(camera.renderBefore(f.scene,.001),'A new target renders immediately rather than waiting for the auxiliary FPS timer.');assert.equal(camera.framing.product,second);assert(camera.hasCurrentFrame());
 // Reusing a snapshot cannot keep displaying a load that another agent took,
 // reserved, hid, removed or placed under an incompatible mission selection.
 for(const flag of ['heldBy','robotOwnerId','robotReservedBy','vehicleReservedBy','vehicleOwnerId']){second[flag]='other-owner';assert.equal(camera.product(f.record,raw),null,flag+' is checked against live custody.');delete second[flag];}
 secondObject.visible=false;assert.equal(camera.product(f.record,raw),null);secondObject.visible=true;
 f.runtime.products.delete(secondObject);assert.equal(camera.product(f.record,raw),null);f.runtime.products.set(secondObject,second);
 const Training=require('../../modules/logistica-industrial/functions/montacargas/runtime/VehicleTrainingRuntime.js').default;
 f.v.config.trainingTasksJson=JSON.stringify([{id:'camera-assigned-load',name:'Inspect assigned load',productId:product.record.id,sourceId:product.record.id,destinationId:'camera-destination',destinationSlot:0}]);
 f.v.training={index:0,completed:[]};const training=f.runtime.vehicleTraining=new Training(f.runtime);training.beginRoute(f.record,'pickup');
 const lesson=JSON.stringify(f.v.training);assert.equal(camera.product(f.record,raw),null,'A stale selected target cannot override the actual mission product.');guide.update(true);assert.equal(camera.product(f.record,raw),product);assert.equal(JSON.stringify(f.v.training),lesson,'The camera grants no route, mission or score credit.');
 delete f.runtime.vehicleTraining;delete f.v.training;f.pallet.position.copy(originalPosition);f.scene.updateMatrixWorld(true);assert(f.api.pickup(f.record),f.v.warning);
 assert.equal(camera.product(f.record,raw),product,'Actual held cargo remains authoritative after the physical pickup.');assert.equal(f.v.entry.product,product);
 f.driving.dispose();f.runtime.stop();support.geometry.dispose();support.material.dispose();
}

// Use the actual receiving installation and native shipment pallet, not just
// a synthetic elevated load. Place this fixture at the camera's entry boundary;
// framing itself must leave the real mechanism, material and mission untouched.
{
 const native=require('../support/load-practice-scenes.cjs')(),f=native.fixture();let guide,camera;
 try{
  const built=native.buildConfigurablePracticeScene(f.document,'hall','CEDI-01',{scene:f.scene,mode:'manual'});f.runtime.start('hall');native.advance(f,.1);
  const record=f.runtime.records.get(built.vehicleIds[0]),v=record.components.vehicle,rig=f.runtime.vehicleRuntime.rig(record);
  const driving={ctx:f.ctx,simulation:f.runtime,record:()=>record,visualRoot:v.visualRoot,blocked:()=>false,document:null};
  const Guide=require('../../modules/logistica-industrial/functions/montacargas/runtime/VehicleHolographicGuide.js').default;
  const {ForkCamera}=require('../support/load-vehicle-driving')(THREE);
  guide=driving.holographicGuide=new Guide(driving);guide.mount(record);assert(guide.currentTarget&&guide.currentTarget.allowed);
  const product=guide.currentTarget.product,from=rig.forks.getWorldPosition(new THREE.Vector3()),to=product.bounds.getCenter(new THREE.Vector3()).applyMatrix4(product.object.matrixWorld),offset=to.clone().sub(from);offset.y=0;
  const distance=offset.length(),world=record.object.getWorldPosition(new THREE.Vector3()).addScaledVector(offset.normalize(),Math.max(0,distance-1.99));
  record.object.position.copy(record.object.parent.worldToLocal(world));record.object.updateMatrix();f.scene.updateMatrixWorld(true);guide.update(true);
  const actualFrom=rig.forks.getWorldPosition(new THREE.Vector3());near(Math.hypot(actualFrom.x-to.x,actualFrom.z-to.z),1.99,1e-5);
  camera=new ForkCamera(driving);const raw=f.runtime.vehicleRuntime.getDockingState(record),before={vehicle:record.object.matrixWorld.toArray(),product:product.object.matrixWorld.toArray(),pose:JSON.stringify(v.pose),entry:v.entry,training:JSON.stringify(v.training)};
  for(const mode of ['isometric','entry','tips']){
   camera.setMode(mode);const frame=camera.frame(raw);assert.equal(frame.product,product,'The actual CEDI receiving load is selected before insertion.');
   assert.equal(frame.approach,1,'At automatic activation the pallet must be fully framed, rather than left beyond the fixed insertion crop.');
   for(const x of [product.bounds.min.x,product.bounds.max.x])for(const y of [product.bounds.min.y,product.bounds.max.y])for(const z of [product.bounds.min.z,product.bounds.max.z]){
    const point=new THREE.Vector3(x,y,z).applyMatrix4(product.object.matrixWorld).project(camera.camera);assert(Math.abs(point.x)<1&&Math.abs(point.y)<1&&Math.abs(point.z)<1,'All actual CEDI pallet corners are in the camera frustum.');
   }
   for(const side of [-1,1])for(const fraction of [.12,.94]){
    const point=new THREE.Vector3(side*v.config.forkSpread/2,0,v.config.forkLength*fraction).applyMatrix4(rig.forks.matrixWorld).project(camera.camera);assert(Math.abs(point.x)<1&&Math.abs(point.y)<1&&Math.abs(point.z)<1,'Actual CEDI fork tips and heels remain in view.');
   }
   assert.deepEqual({vehicle:record.object.matrixWorld.toArray(),product:product.object.matrixWorld.toArray(),pose:JSON.stringify(v.pose),entry:v.entry,training:JSON.stringify(v.training)},before);
  }
 }finally{if(camera)camera.dispose();if(guide)guide.dispose();if(f.runtime.active)f.runtime.stop();native.releaseGeometry(f);}
}

const desktop = setup(false, true);
const r = desktop.screen = renderer(desktop); desktop.ctx.graphics = {getLimits: () => ({tier: 'balanced'})}; assert(desktop.driving.mount(desktop.record.id));
const feed = desktop.feed = desktop.driving.docking.forkCamera, monitor = desktop.driving.docking;
monitor.feedViewport.rect = {left:850,top:480,width:360,height:202.5};
assert.equal(feed.mode,'isometric'); assert.equal(feed.selectedFeed,'front'); assert.equal(feed.toggleMode(),'entry'); assert.equal(feed.toggleMode(),'tips'); assert.equal(feed.toggleMode(),'isometric');
assert.equal(monitor.plan.hidden,false); assert.equal(monitor.metrics.hidden,false); assert(!monitor.guidancePanel.hidden); assert.notEqual(monitor.guidancePanel.parentNode,monitor.element);
assert.equal(monitor.rear.parentNode,undefined,'No picture-in-picture camera obscures the working image.');
const original=baseline(desktop,r),population=desktop.runtime.products.size;
assert(monitor.renderBefore(desktop.scene,.02)); assert.deepEqual(baseline(desktop,r),original);
assert.equal(feed.target.width,768); assert(!feed.mirrorTarget); assert.equal(desktop.ctx.performanceRenderTargets.size,1);
for(let i=0;i<120;i++)monitor.renderBefore(desktop.scene,1/120);
assert(feed.stats.frames<=13); assert.equal(feed.stats.mirrorFrames,0,'A hidden rear feed never renders in the background.');
assert(monitor.postRender()); assert.deepEqual(baseline(desktop,r),original); const frontComposite=r.calls[r.calls.length-1];
assert.equal(frontComposite.scene,feed.overlayScene); assert(frontComposite.scissor.equals(new THREE.Vector4(850,97.5,360,202.5)));
// The WebGL composition obeys CSS clipping, independently on each axis.
// A panel scroll clips pixels without stretching the full 16:9 source crop.
const viewport=monitor.feedViewport,oldParent=viewport.parentNode,oldOwner=viewport.ownerDocument,xClip=new Element('section'),yClip=new Element('section'),visibleAncestor=new Element('section');
xClip.rect={left:900,top:0,width:270,height:1};yClip.rect={left:0,top:500,width:1,height:100};visibleAncestor.rect={left:0,top:0,width:1,height:1};
viewport.parentNode=xClip;xClip.parentNode=yClip;yClip.parentNode=visibleAncestor;
viewport.ownerDocument={defaultView:{getComputedStyle:node=>node===xClip?{overflowX:'hidden',overflowY:'visible'}:node===yClip?{overflowX:'visible',overflowY:'auto'}:{overflow:'visible'}}};
let clipped=feed.desktopRect(viewport);assert.equal(clipped.rect,viewport.rect);assert.deepEqual([clipped.left,clipped.right,clipped.top,clipped.bottom],[900,1170,500,600]);
assert(monitor.postRender());const clippedComposite=r.calls[r.calls.length-1];assert(clippedComposite.viewport.equals(frontComposite.viewport),'Ancestor clipping cannot resize or shift the complete camera projection.');assert(clippedComposite.scissor.equals(new THREE.Vector4(900,180,270,100)));
const clippedFrames=feed.stats.frames;xClip.rect.left=1220;assert.equal(feed.desktopRect(viewport),null);assert.deepEqual(feed.visibleFeeds(),[]);assert.equal(feed.renderBefore(desktop.scene,.2),false);assert.equal(feed.stats.frames,clippedFrames,'An entirely clipped feed does not perform another world render.');
let reads=0,node=viewport;for(let i=0;i<40;i++){const parent=new Element('section');parent.rect={left:0,top:0,width:1280,height:780};node.parentNode=parent;node=parent;}
viewport.ownerDocument.defaultView.getComputedStyle=()=>{reads++;return{overflow:'clip'};};assert(feed.desktopRect(viewport));assert.equal(reads,32,'Style/layout probes are bounded even in a deeply nested host application.');
viewport.parentNode=oldParent;if(oldOwner===undefined)delete viewport.ownerDocument;else viewport.ownerDocument=oldOwner;assert.deepEqual(baseline(desktop,r),original);
// Fixed panels do not contribute to BODY's layout height. Browsers propagate
// its overflow to the viewport, rather than clipping that panel to height zero.
const rootBody=new Element('body'),rootHtml=new Element('html'),rootClip=new Element('section');
rootBody.rect={left:0,top:0,width:1280,height:0};rootHtml.rect={left:0,top:0,width:1280,height:0};rootHtml.clientWidth=1280;rootHtml.clientHeight=780;
rootClip.rect={left:880,top:490,width:300,height:170};viewport.parentNode=rootClip;rootClip.parentNode=rootBody;rootBody.parentNode=rootHtml;
viewport.ownerDocument={body:rootBody,documentElement:rootHtml,defaultView:{innerWidth:1280,innerHeight:780,getComputedStyle:node=>node===rootHtml?{overflow:'visible'}:{overflow:'hidden'}}};
const fixedAllocations=feed.stats.allocations;feed.release();assert(!feed.target&&!feed.mirrorTarget);
const fixedClip=feed.desktopRect(viewport);assert(fixedClip,'A fixed camera remains visible under a zero-height BODY.');assert.deepEqual([fixedClip.left,fixedClip.right,fixedClip.top,fixedClip.bottom],[880,1180,490,660]);
assert(monitor.renderBefore(desktop.scene,.2),'The first real camera frame must render before the fallback can hide.');assert.equal(feed.stats.allocations,fixedAllocations+1);assert(feed.hasCurrentFrame());assert(monitor.postRender());assert(r.calls[r.calls.length-1].scissor.equals(new THREE.Vector4(880,120,300,170)));
viewport.ownerDocument.defaultView.innerHeight=620;assert.equal(feed.desktopRect(viewport).bottom,620,'Root overflow still clips at the real viewport edge.');viewport.ownerDocument.defaultView.innerHeight=780;
rootClip.rect.top=700;assert.equal(feed.desktopRect(viewport),null,'Genuine overflowing panel ancestors still clip the image.');
viewport.parentNode=oldParent;if(oldOwner===undefined)delete viewport.ownerDocument;else viewport.ownerDocument=oldOwner;
let disposed=0;const frontTarget=feed.target;frontTarget.addEventListener('dispose',()=>disposed++);
assert.equal(monitor.toggleRearView(),true); assert.equal(disposed,1); assert(!feed.target&&!feed.mirrorTarget); assert(monitor.renderBefore(desktop.scene,.2));
assert.equal(feed.selectedFeed,'mirror');assert(!feed.target&&feed.mirrorTarget);assert.equal(feed.mirrorTarget.width,768,'Alternating rear view uses the full working-display resolution.');
assert.equal(feed.mirrorTarget.texture.repeat.x,-1); assert.equal(feed.mirrorTarget.texture.offset.x,1);assert.equal(desktop.ctx.performanceRenderTargets.size,1);
assert(monitor.postRender());assert.equal(r.calls[r.calls.length-1].scene,feed.mirrorOverlayScene);assert.deepEqual(baseline(desktop,r),original);
const rearFrames=feed.stats.mirrorFrames;monitor.toggleRearView();assert(monitor.renderBefore(desktop.scene,.2));assert.equal(feed.stats.mirrorFrames,rearFrames);assert(feed.target&&!feed.mirrorTarget);
assert.equal(desktop.runtime.products.size,population);assert.equal(desktop.v.entry,null);
// The external inspection camera crops away its own truck, including ghost
// wires, while preserving the actual insertion blades and carried cargo.
// Guide arrows/target contours have no place in either camera image.
assert(desktop.api.pickup(desktop.record),desktop.v.warning);const heldCargo=desktop.v.entry,guide=desktop.driving.holographicGuide,savedGuide={root:guide.root,label:guide.label};
const label=new THREE.Object3D(),contour=new THREE.Group(),guideMesh=new THREE.Mesh(new THREE.BoxBufferGeometry(.1,.1,.1),new THREE.MeshBasicMaterial());contour.add(guideMesh);desktop.scene.add(contour,label);guide.label=label;guide.root=contour;
const cargo=heldCargo.product.object,insideCargo=node=>{for(let parent=node;parent;parent=parent.parent)if(parent===cargo)return true;return false;};
const body=[],blades=[],cargoNodes=[];desktop.driving.visualRoot.traverse(node=>{if(node.isMesh||node.isLineSegments)(insideCargo(node)?cargoNodes:node.userData.vehicleForkBlade?blades:body).push(node);});
assert(body.length>20&&blades.length>=2&&cargoNodes.length>2,'Use the actual truck, entering blades and reparented load.');
body[0].visible=false;const visibility=new Map([...body,...blades,...cargoNodes,label,contour,guideMesh].map(node=>[node,node.visible]));
const cargoPose=cargo.matrixWorld.toArray(),mechanismPose=JSON.stringify(desktop.v.pose),savedRender=r.api.render;let frontChecks=0,rearChecks=0;
r.api.render=(scene,camera)=>{if(r.state.target){
 assert.equal(label.visible,false);assert.equal(contour.visible,false,'The whole guide root must be excluded, not just its text banner.');
 if(camera===feed.camera){body.forEach(node=>assert.equal(node.visible,false));frontChecks++;}else{body.forEach(node=>assert.equal(node.visible,visibility.get(node)));rearChecks++;}
 [...blades,...cargoNodes].forEach(node=>assert.equal(node.visible,visibility.get(node),'Camera exclusion cannot hide an entering tine or a real carried pallet.'));
 }return savedRender(scene,camera);};
const restored=()=>{visibility.forEach((visible,node)=>assert.equal(node.visible,visible,'Every authored visibility flag is restored after the camera pass.'));assert.equal(desktop.v.entry,heldCargo);assert.equal(JSON.stringify(desktop.v.pose),mechanismPose);assert.deepEqual(cargo.matrixWorld.toArray(),cargoPose);};
assert(monitor.renderBefore(desktop.scene,.2));restored();assert(frontChecks);
monitor.toggleRearView();assert(monitor.renderBefore(desktop.scene,.2));restored();assert(rearChecks,'Rear inspection retains the truck body instead of applying the front cutaway.');
monitor.toggleRearView();const preserved=baseline(desktop,r);r.api.failNext=true;assert.equal(monitor.renderBefore(desktop.scene,.2),false);restored();assert.deepEqual(baseline(desktop,r),preserved,'A GPU exception restores visibility and all primary/XR render state.');
feed.setEnabled(true);assert(monitor.renderBefore(desktop.scene,.2));restored();r.api.render=savedRender;
guide.root=savedGuide.root;guide.label=savedGuide.label;desktop.scene.remove(contour,label);guideMesh.geometry.dispose();guideMesh.material.dispose();

// The same real forks retain metric projection down to 0/10/50/100 mm gaps.
const {ForkCamera}=require('../support/load-vehicle-driving')(THREE);
let variants=0;
for(const definition of h.vehicles.VARIANTS.filter(value=>h.vehicles.supports(value.preset).forks)){
 const f=h.fixture(definition.id,false,true),product=f.runtime.products.get(f.pallet),camera=new ForkCamera({ctx:f.ctx,simulation:f.runtime,record:()=>f.record,visualRoot:f.v.visualRoot}),rig=f.api.rig(f.record),saved={pose:JSON.stringify(f.v.pose),parent:product.object.parent,population:f.runtime.products.size};
 const originalPosition=f.pallet.position.clone();
 for(const mode of ['isometric','entry','tips']){
  camera.setMode(mode);let crop=null;
  for(const gap of [.1,.05,.01,0,-.12]){
   f.scene.updateMatrixWorld(true);const local=product.bounds.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(new THREE.Matrix4().getInverse(rig.forks.matrixWorld),product.object.matrixWorld));
   f.pallet.position.z+=f.config.forkLength+gap-local.min.z;f.scene.updateMatrixWorld(true);
   const before=product.object.matrixWorld.toArray(),frame=camera.frame(f.api.getDockingState(f.record)),view=camera.camera;
   assert(view.isOrthographicCamera,mode+' has no fisheye FOV at a near-zero pallet gap.'); assert(view.projectionMatrix.elements.every(Number.isFinite));assert(view.near>=.02&&view.far>view.near);
   const next=[view.left,view.right,view.top,view.bottom];if(crop)next.forEach((value,index)=>near(value,crop[index],1e-7));else crop=next;
   for(const side of [-1,1])for(const fraction of [.12,.55,.94]){const point=new THREE.Vector3(side*f.config.forkSpread/2,0,f.config.forkLength*fraction).applyMatrix4(rig.forks.matrixWorld).project(view);assert(Math.abs(point.x)<1&&Math.abs(point.y)<1,'Both insertion blades remain in the fixed crop.');}
   if(gap===.1&&mode==='entry')for(const side of [-1,1])assert(isFork(f,firstAt(f,new THREE.Vector3(side*f.config.forkSpread/2,0,f.config.forkLength*.7),view)),definition.id+': the actual visible surface of both insertion blades is inside the precise frontal section.');
   assert.deepEqual(product.object.matrixWorld.toArray(),before);assert.equal(JSON.stringify(f.v.pose),saved.pose);assert.equal(product.object.parent,saved.parent);assert.equal(f.runtime.products.size,saved.population);
   if(mode==='isometric'){const inverse=new THREE.Matrix4().getInverse(rig.forks.matrixWorld),direction=view.getWorldDirection(new THREE.Vector3()).transformDirection(inverse),elevation=Math.atan2(-direction.y,Math.hypot(direction.x,direction.z)),oblique=Math.atan2(Math.abs(direction.x),Math.abs(direction.z));assert(elevation>4*Math.PI/180&&elevation<15*Math.PI/180,'Low inspection angle exposes pocket mouths instead of looking down at the deck.');assert(oblique>20*Math.PI/180&&oblique<40*Math.PI/180,'Three-quarter inspection retains a clear front and depth view.');}
  }
 }
 f.pallet.position.copy(originalPosition);f.scene.updateMatrixWorld(true);assert(f.api.pickup(f.record),definition.id+': '+f.v.warning);const held=f.v.entry;
 for(const mode of ['isometric','entry','tips']){camera.setMode(mode);camera.frame(f.api.getDockingState(f.record));assert.equal(f.v.entry,held);}
 camera.dispose();f.runtime.stop();variants++;
}
assert(variants>=9);

// Main/tracked camera and render state survive AA, rear switching, failures,
// context recovery, DPR differences and high-frequency headset frames.
for(const dpr of [1,1.5,2,2.5]){const f=mounted(false,dpr),state=baseline(f,f.screen);updateBoth(f);assert.deepEqual(baseline(f,f.screen),state);f.driving.docking.toggleRearView();updateBoth(f);assert.deepEqual(baseline(f,f.screen),state);assert.equal(f.ctx.performanceRenderTargets.size,1);f.driving.dispose();assert.equal(f.ctx.performanceRenderTargets.size,0);f.runtime.stop();}
const xr=mounted(true),xrFeed=xr.feed;xr.camera.lookAt(xrFeed.plane.getWorldPosition(new THREE.Vector3()));xr.scene.updateMatrixWorld(true);
xr.ctx.renderer.xr.getCamera=probe=>{assert.notEqual(probe,xr.camera);probe.matrixWorld.makeTranslation(999,888,777);return xr.camera;};
const tracked=baseline(xr,xr.screen);updateBoth(xr);assert.deepEqual(baseline(xr,xr.screen),tracked);assert(xrFeed.plane.visible);assert.equal(xrFeed.mirrorPlane,null);assert.equal(xrFeed.plane.material.map,xrFeed.target.texture);
xr.driving.docking.toggleRearView();assert.equal(xrFeed.plane.visible,false,'Switching does not expose an uninitialized white texture.');updateBoth(xr);assert.equal(xrFeed.plane.material.map,xrFeed.mirrorTarget.texture);assert(xrFeed.plane.visible);assert.equal(xr.ctx.performanceRenderTargets.size,1);assert(xrFeed.stats.estimatedGpuBytes<=12*1024*1024);
assert.deepEqual(baseline(xr,xr.screen),tracked);assert.equal(xrFeed.state,null);assert.equal(xr.driving.docking.postRender(),false);
const frames=xrFeed.stats.frames;assert.equal(xrFeed.renderBefore(xr.scene,1/90),false);assert.equal(xrFeed.stats.frames,frames);assert(xrFeed.plane.visible);
const beforeFailure=baseline(xr,xr.screen);xr.screen.api.failNext=true;assert.equal(xrFeed.renderBefore(xr.scene,.2),false);assert.deepEqual(baseline(xr,xr.screen),beforeFailure);assert(!xrFeed.target&&!xrFeed.mirrorTarget);
xrFeed.setEnabled(true);updateBoth(xr);xrFeed.onLost();assert.equal(xr.ctx.performanceRenderTargets.size,0);xrFeed.onRestored();updateBoth(xr);xr.driving.dispose();xr.runtime.stop();
desktop.driving.dispose();desktop.runtime.stop();assert.equal(desktop.ctx.performanceRenderTargets.size,0);
console.log('Precise vehicle camera: stable metric crops at 0/10/50/100mm, '+variants+' fork variants, real custody, single full-size alternating rear feed, separate targets, always-visible plan, source-label exclusion, DPR/XR/render restoration and cleanup passed.');
