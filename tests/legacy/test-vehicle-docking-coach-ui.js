'use strict';
// Exercise the real monitor with a DOM surface and a read-only guide model.
// Camera pixels and vehicle physics have separate production regressions.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),THREE=require('three');
class Element{
 constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attributes={};this.listeners=new Map();this.hidden=false;this.value='';this.textContent='';}
 get firstChild(){return this.children[0]||null;}
 appendChild(child){child.parentNode=this;this.children.push(child);return child;}
 removeChild(child){const index=this.children.indexOf(child);if(index>=0)this.children.splice(index,1);child.parentNode=null;return child;}
 remove(){if(this.parentNode)this.parentNode.removeChild(this);}
 setAttribute(name,value){this.attributes[name]=String(value);}
 getAttribute(name){return this.attributes[name];}
 addEventListener(name,callback){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(callback);}
 removeEventListener(name,callback){if(this.listeners.has(name))this.listeners.get(name).delete(callback);}
 fire(name){for(const callback of this.listeners.get(name)||[])callback({stopPropagation(){}});}
 getContext(){if(!this.context){this.calls=[];this.context={measureText:value=>({width:String(value).length*10})};for(const name of ['save','restore','clearRect','fillRect','fillText','beginPath','moveTo','lineTo','stroke','fill','closePath','arc','setLineDash'])this.context[name]=(...args)=>{assert(args.every(value=>typeof value!=='number'||Number.isFinite(value)));this.calls.push([name,...args]);};}return this.context;}
}
class ForkCamera{
 constructor(driving){this.driving=driving;this.enabled=true;this.mode='isometric';this.side=-1;this.selectedFeed='front';}
 mount(options){this.options=options;}
 unmount(){this.options=null;}
 dispose(){this.unmount();}
 setEnabled(value){this.enabled=!!value;return this.enabled;}
 setAvailable(value){this.available=value;}
 product(){return this.driving.simulation.products.get('pallet-1');}
 toggleMode(){const modes=['isometric','entry','tips'];this.mode=modes[(modes.indexOf(this.mode)+1)%modes.length];}
 switchSide(){this.side*=-1;}
 toggleRearView(){this.selectedFeed=this.selectedFeed==='front'?'mirror':'front';return this.selectedFeed==='mirror';}
}
const filename=path.resolve(__dirname,'../../modules/logistica-industrial/functions/montacargas/runtime/VehicleDockingMonitor.js');
const source=fs.readFileSync(filename,'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default class VehicleDockingMonitor','class VehicleDockingMonitor');
const MissionPanel=require('../../modules/logistica-industrial/functions/montacargas/runtime/VehicleMissionPanel.js').default;
const FacilityLayout=require('../../modules/logistica-industrial/functions/montacargas/runtime/VehicleFacilityLayout.js').default;
const InspectionMode=require('../../modules/logistica-industrial/functions/montacargas/runtime/VehicleInspectionMode.js').default;
const Monitor=new Function('THREE','VehicleForkCamera','VehicleMissionPanel','VehicleFacilityLayout','VehicleInspectionMode',source+'\nreturn VehicleDockingMonitor;')(THREE,ForkCamera,MissionPanel,FacilityLayout,InspectionMode);
const document={createElement:tag=>new Element(tag),body:new Element('body')},seat=new THREE.Group(),forks=new THREE.Group();
const installation=new THREE.Scene(),truck=new THREE.Group(),visualRoot=new THREE.Group(),pallet=new THREE.Mesh(new THREE.BoxBufferGeometry(1.2,.3,1),new THREE.MeshBasicMaterial());
const floor=new THREE.Mesh(new THREE.BoxBufferGeometry(20,.15,20),new THREE.MeshBasicMaterial());floor.position.y=-.1;installation.add(floor,truck,pallet);truck.add(visualRoot);visualRoot.add(forks);pallet.position.z=6;
const product={record:{id:'pallet-1'},object:pallet,bounds:new THREE.Box3(new THREE.Vector3(-.6,-.15,-.5),new THREE.Vector3(.6,.15,.5))};
const approach=z=>{forks.position.z=z;installation.updateMatrixWorld(true);};
const targets=[{id:'pallet-1',name:'Pallet de entrada',kind:'pickup',allowed:true,distanceM:3},{id:'stock-1',name:'Bahía de descarga',kind:'drop',allowed:true,distanceM:5}];
const state={phase:'pickup',title:'Alinear las horquillas',instruction:'Centra ambas uñas antes de entrar.',targetId:'pallet-1',targetName:targets[0].name,distanceM:3,routeNote:'Orientación local; comprueba el pasillo.'};
const guide={enabled:true,getState:()=>state,getTargets:()=>targets,setEnabled(value){this.enabled=value;},setTarget(value){state.targetId=value;state.targetName=(targets.find(target=>target.id===value)||{}).name||'';},nextTarget(){this.setTarget(state.targetId==='pallet-1'?'stock-1':'pallet-1');}};
const snapshot={phase:'pickup',targetId:'pallet-1',ready:false,severity:'near',reason:'Completa la inserción.',errors:{lateralM:.02,verticalM:.04,yawRad:.03},insertion:{actualM:.24,requiredM:.6},geometry:{},stability:{loadKg:33,capacityKg:499}};
let blocked=false,resets=0,hudUpdates=0;const commands=[];
const vehicle={powered:true,running:true,parkingBrake:false};
visualRoot.userData.vehicleRig={forks,config:{family:'forklift'}};
const record={id:'forklift',object:truck,components:{vehicle}},records=new Map([['forklift',record]]);
const driving={ctx:{vrMode:false},id:'forklift',document,seat,holographicGuide:guide,visualRoot,simulation:{statePrefix:'qa-',roomId:'sound',document:{getRoot:()=>installation},records,products:new Map([['pallet-1',product]]),vehicleRuntime:{getDockingState:()=>snapshot}},record:()=>record,blocked:()=>blocked,
 cabPanelLayout:()=>({alignment:[-.8,-.34,1.1],front:{position:[.8,.08,1.1],width:.68,height:.3825},mirror:{position:[.8,.4,1.1],width:.36,height:.2}}),placeCabPanel:(plane,position)=>plane.position.fromArray(position),panelSelectable:()=>true,
 command(action){commands.push(action);if(action==='holographicGuide')guide.setEnabled(!guide.enabled);if(action==='guidanceNext')guide.nextTarget();},resetInput(){resets++;},updateHUD(){hudUpdates++;}};
const monitor=new Monitor(driving);monitor.mount();
assert.equal(monitor.element.dataset.expanded,'false','Driving starts with the compact navigation panel.');assert.equal(monitor.expandButton.getAttribute('aria-expanded'),'false');
const beforeExpand=resets;monitor.expandButton.fire('click');assert.equal(monitor.expanded,true);assert.equal(monitor.element.dataset.expanded,'true');assert.equal(monitor.expandButton.getAttribute('aria-expanded'),'true');assert(resets>beforeExpand,'Changing panel size clears held driving inputs.');
monitor.navigationKey({key:'Escape',stopPropagation(){}});assert.equal(monitor.expanded,false);assert.equal(monitor.expandButton.getAttribute('aria-expanded'),'false');
assert.equal(monitor.cameraEnabled,true);assert.equal(monitor.mode,'layout');assert.equal(monitor.plan.hidden,false);assert.equal(monitor.feed.hidden,true);assert.equal(monitor.forkCamera.available,false);assert.equal(monitor.rear.hidden,true);assert.equal(monitor.rear.parentNode,undefined);
assert.equal(monitor.panels.parentNode,document.body);assert.equal(monitor.guidancePanel.parentNode,monitor.operatorColumn);assert.equal(monitor.guidanceBar.parentNode,monitor.guidancePanel);assert.notEqual(monitor.coach.parentNode,monitor.element);assert.equal(monitor.metrics.hidden,true);assert(monitor.facilityLayout.model,'The far display uses the actual installation model.');
assert(monitor.canvas.calls.some(call=>call[0]==='fillText'&&call[1].includes('EN VIVO')),'The map is painted while the camera is inactive.');
monitor.rearButton.fire('click');assert.equal(monitor.mode,'rear');assert.equal(monitor.forkCamera.selectedFeed,'mirror');assert.equal(monitor.element.dataset.feed,'mirror');assert.equal(monitor.plan.hidden,true);assert.equal(monitor.feed.hidden,false);assert.equal(monitor.forkCamera.available,true);assert.match(monitor.rearButton.textContent,/Horquillas/);monitor.rearButton.fire('click');assert.equal(monitor.forkCamera.selectedFeed,'front');assert.equal(monitor.mode,'layout');
// Headset frames between 10 Hz telemetry ticks must retain rear-mode
// visibility. Re-enabling the diagram before the throttle briefly overlays
// the mirror with stale map/inspection content on most rendered frames.
driving.ctx.vrMode=true;monitor.rearButton.fire('click');assert.equal(monitor.mode,'rear');assert.equal(monitor.plane.visible,false);assert.equal(monitor.forkCamera.available,true);
const rearPaints=monitor.canvas.calls.length;monitor.lastUpdate=performance.now();
for(let frame=0;frame<3;frame++){monitor.update();assert.equal(monitor.plane.visible,false,'A throttled headset frame cannot reveal the stale alignment plane over the retrovisor.');assert.equal(monitor.mode,'rear');}
assert.equal(monitor.canvas.calls.length,rearPaints,'The intervening headset checks exercise the throttled update path, not fresh telemetry paints.');
monitor.rearButton.fire('click');assert.equal(monitor.mode,'layout');assert.equal(monitor.plane.visible,true);assert.deepEqual(monitor.plane.position.toArray(),driving.cabPanelLayout().front.position,'Returning from the mirror restores the global map at the shared front-display position.');
driving.ctx.vrMode=false;monitor.update(true);assert.equal(monitor.plane.visible,false,'Desktop presentation hides the cab canvas plane.');
approach(4.1);monitor.update(true);assert.equal(monitor.mode,'inspection');assert.equal(monitor.plan.hidden,false);assert.equal(monitor.feed.hidden,false);assert.equal(monitor.metrics.hidden,false);assert.equal(monitor.forkCamera.available,true);
approach(3.4);monitor.update(true);assert.equal(monitor.mode,'inspection','A small reverse correction remains in inspection.');approach(3.1);monitor.update(true);assert.equal(monitor.mode,'layout');approach(4.1);monitor.update(true);assert.equal(monitor.mode,'inspection');
assert.equal(monitor.plan.parentNode,monitor.body);assert.equal(monitor.feed.parentNode,monitor.body);assert.notEqual(monitor.plan.parentNode,monitor.feedViewport,'The insertion diagram never overlays the rendered camera viewport.');
assert.match(monitor.cameraModeButton.textContent,/Isométrica/);assert.equal(monitor.sideButton.hidden,false);assert(monitor.sideButton.parentNode);
monitor.sideButton.fire('click');assert.equal(monitor.forkCamera.side,1);assert.match(monitor.sideButton.textContent,/Der/);
monitor.cameraModeButton.fire('click');assert.equal(monitor.sideButton.hidden,true);monitor.cameraModeButton.fire('click');monitor.cameraModeButton.fire('click');assert.equal(monitor.sideButton.hidden,false);
assert.equal(monitor.hologramButton.getAttribute('aria-pressed'),'true');assert.equal(monitor.targetSelect.children.length,3);assert(monitor.coach.textContent.includes('Centra ambas uñas'));
assert(monitor.metrics.textContent.includes('24.0 cm / 60.0 cm'),'Insertion is readable DOM text, not only tiny pixels in the plan.');
const originalOption=monitor.targetSelect.children[1];state.distanceM=2.8;monitor.update(true);assert.equal(monitor.targetSelect.children[1],originalOption,'Distance updates must not rebuild an open target selector.');
monitor.planButton.fire('click');assert.equal(monitor.mode,'layout');assert.equal(monitor.forceLayout,true);assert.equal(monitor.plan.hidden,false);assert.equal(monitor.feed.hidden,true);assert.equal(monitor.forkCamera.enabled,true,'Forcing the plan suspends camera rendering without disabling automatic inspection.');assert.equal(monitor.forkCamera.available,false);
monitor.planButton.fire('click');assert.equal(monitor.mode,'inspection');assert.equal(monitor.feed.hidden,false);
monitor.cameraButton.fire('click');assert.equal(monitor.cameraEnabled,false);assert.equal(monitor.mode,'layout');assert.equal(monitor.forkCamera.available,false);monitor.cameraButton.fire('click');assert.equal(monitor.mode,'inspection');
const resetsBeforeTarget=resets;monitor.targetSelect.value='stock-1';monitor.targetSelect.fire('change');assert.equal(state.targetId,'stock-1');assert.equal(resets,resetsBeforeTarget+1);assert.equal(hudUpdates,1);assert.deepEqual(commands,[]);
monitor.hologramButton.fire('click');assert.equal(guide.enabled,false);assert.deepEqual(commands,['holographicGuide']);
monitor.page='guide';monitor.select(40,400);assert.equal(guide.enabled,true);monitor.page='guide';monitor.select(250,400);assert.equal(state.targetId,'pallet-1');
state.ready=true;monitor.update(true);assert.equal(monitor.severity,'near','A guide model must never make unvalidated physical docking green.');
snapshot.ready=true;state.ready=false;state.explicitTarget=true;state.targetMatchesSnapshot=false;state.targetName='Otro pallet seleccionado';snapshot.targetName='Pallet detectado';monitor.update(true);assert.equal(monitor.severity,'near');assert(monitor.summary.textContent.includes('Pallet detectado')&&monitor.summary.textContent.includes('Otro pallet seleccionado'),'Readiness for another pallet cannot be presented as readiness for the selected target.');
// A deposited pallet can be immediately eligible for pickup in the physical
// runtime. The monitor must still coach withdrawal until the forks are clear.
const savedTargets=targets.splice(0),savedInstruction=state.instruction;
Object.assign(state,{phase:'withdraw',title:'Retirar las horquillas',instruction:'Retrocede lentamente hasta retirar por completo ambas horquillas.',targetId:'',targetName:'Bahía de descarga',explicitTarget:false});
Object.assign(snapshot,{phase:'pickup',ready:true,severity:'ready',reason:'Listo para tomar el pallet depositado.'});
const depositedSnapshot=JSON.parse(JSON.stringify(snapshot));monitor.page='alignment';monitor.canvas.calls.length=0;monitor.update(true);
assert.equal(monitor.severity,'near');assert.equal(monitor.element.dataset.state,'near');assert.match(monitor.summary.textContent,/^RETIRADA · Retrocede/);assert.match(monitor.canvas.getAttribute('aria-label'),/^RETIRADA\./);
const withdrawalHeader=monitor.canvas.calls.find(call=>call[0]==='fillText'&&call[2]===20&&call[3]===40);assert.equal(withdrawalHeader[1],'RETIRADA','The plan cannot advertise TOMA · LISTO during a deposit withdrawal.');
assert.equal(monitor.targetSelect.firstChild.textContent,'Retira las horquillas');assert.equal(monitor.targetSelect.disabled,true);
assert.equal(monitor.snapshot,snapshot);assert.deepEqual(snapshot,depositedSnapshot,'Withdrawal presentation must preserve physical readiness and all raw docking measurements.');assert(monitor.metrics.textContent.includes('24.0 cm / 60.0 cm'));assert.equal(monitor.cameraButton.disabled,false);
state.phase='withdraw-source';monitor.update(true);assert.equal(monitor.severity,'near');assert.match(monitor.summary.textContent,/^RETIRADA/,'Source withdrawal also takes precedence over a ready docking snapshot.');
guide.enabled=false;monitor.update(true);assert.equal(monitor.severity,'ready','Turning off advisory guidance preserves the original physical monitor behavior.');
guide.enabled=true;state.phase='pickup';state.instruction=savedInstruction;targets.push(...savedTargets);
vehicle.parkingBrake=true;driving.nextStep={stage:'parking',title:'Freno de estacionamiento activo',instruction:'Libera el freno después de revisar el pasillo.',control:'P'};monitor.update(true);assert(monitor.coach.textContent.includes('Libera el freno'));assert(!monitor.coach.textContent.includes('Centra ambas uñas'),'Operational readiness overrides a spatial instruction.');vehicle.parkingBrake=false;
// Follow real Object3D reparenting at the UI boundary. The loaded pallet stays
// next to the forks, but only the fixed source/destination controls proximity.
const initialPalletPosition=pallet.position.clone();
guide.currentTarget={id:'drop:stock-1',targetId:'stock-1',allowed:true,kind:'drop',matrix:new THREE.Matrix4().makeTranslation(0,0,16),bounds:product.bounds};
forks.attach(pallet);vehicle.entry={id:'custody-1',product};monitor.update(true);assert.equal(monitor.mode,'inspection');
approach(9.2);monitor.update(true);assert.equal(monitor.mode,'layout','Carried cargo cannot keep the camera active throughout transport.');assert.equal(monitor.forkCamera.available,false);
approach(14.2);monitor.update(true);assert.equal(monitor.mode,'inspection','The receiving position activates unloading inspection.');
installation.attach(pallet);vehicle.entry=null;guide.currentTarget=null;monitor.update(true);assert.equal(monitor.mode,'inspection','Release keeps the fixed destination visible until the forks are withdrawn.');
approach(13.5);monitor.update(true);assert.equal(monitor.mode,'inspection');approach(13.1);monitor.update(true);assert.equal(monitor.mode,'layout');
pallet.position.copy(initialPalletPosition);approach(4.1);monitor.update(true);assert.equal(monitor.mode,'inspection');
// The compact mission surface consumes verified engine state while retaining
// the plan, real feed and all inspection controls beside it.
const trainingTasks=[{id:'mission-1',name:'1 · Recepción a R1'},{id:'mission-2',name:'2 · Reposición'}];
let lesson={taskId:'mission-1',title:trainingTasks[0].name,total:2,completed:0,phase:'withdraw',stage:'withdraw',stageTitle:'Retira las horquillas',instruction:'Retrocede hasta que ambas horquillas estén fuera.',score:40,scoreMax:330,badges:[],routeComplete:true};
lesson.productId='pallet-1';
driving.simulation.vehicleTraining={guidance:()=>lesson,tasks:()=>trainingTasks,product:id=>id==='pallet-1'?product:null,destination:()=>null};monitor.update(true);
assert.equal(monitor.guidancePanel.dataset.training,'active');assert.equal(monitor.trainingPanel.hidden,false);assert.equal(monitor.missionPanel.title.textContent,'Recepción a R1');
assert.equal(monitor.missionPanel.missionList.children[1].dataset.status,'locked','The monitor cannot unlock the following mission before engine confirmation.');
assert.equal(monitor.targetSelect.disabled,true);assert.equal(monitor.plan.hidden,false);assert.equal(monitor.feed.hidden,true);assert.equal(monitor.mode,'layout','Without a recent physical custody transition, a completed withdrawal resumes the installation map.');assert.equal(monitor.forkCamera.selectedFeed,'front');
lesson={...lesson,taskId:'mission-2',title:trainingTasks[1].name,completed:1,phase:'pickup',stage:'approach',stageTitle:'Acércate al pallet',instruction:'Sigue las flechas.',score:140};monitor.update(true);
assert.equal(monitor.missionPanel.missionList.children[1].dataset.status,'active');assert.equal(monitor.missionPanel.score.textContent,'140 / 330 pts');
assert.equal(monitor.mode,'inspection');assert.equal(monitor.feed.hidden,false);assert.equal(monitor.plan.hidden,false);assert.equal(monitor.forkCamera.available,true);
assert.equal(monitor.cameraButton.disabled,false);assert.equal(monitor.rearButton.disabled,false);assert.deepEqual(snapshot,depositedSnapshot,'Mission presentation cannot mutate physical docking data.');
// A short landscape display paints to the available slot, keeping readable map
// labels instead of scaling down the old tall bitmap. XR retains its cab ratio.
monitor.canvas.ownerDocument={defaultView:{innerWidth:780,innerHeight:390}};
monitor.canvas.getBoundingClientRect=()=>({width:500,height:154});
monitor.forceLayout=true;const mapTexture=monitor.texture;monitor.update(true);
assert.equal(monitor.canvas.width,500);assert.equal(monitor.canvas.height,154);assert.equal(monitor.canvas.width/monitor.canvas.height,500/154,'The canvas bitmap follows its actual slot rather than distorting the floor plan.');assert.equal(monitor.texture,mapTexture,'A layout resize reuses its canvas texture.');
driving.ctx.vrMode=true;monitor.update(true);assert.equal(monitor.canvas.width,768);assert.equal(monitor.canvas.height,432,'A headset map always keeps the original 16:9 cab surface.');assert.equal(monitor.setExpanded(true),false,'Desktop enlargement cannot alter the headset cab layout.');
driving.ctx.vrMode=false;monitor.canvas.ownerDocument.defaultView={innerWidth:1440,innerHeight:900,devicePixelRatio:2};monitor.update(true);assert.equal(monitor.canvas.width,1000);assert.equal(monitor.canvas.height,308,'An expanded/compact map retains slot proportions on high density screens.');
monitor.forceLayout=false;monitor.update(true);
blocked=true;monitor.update(true);const count=commands.length;monitor.hologramButton.fire('click');monitor.targetSelect.fire('change');assert.equal(commands.length,count);assert.equal(monitor.targetSelect.disabled,true);assert.equal(monitor.severity,'blocked');
monitor.unmount();assert.equal(document.body.children.length,0);assert.equal(seat.children.length,0);assert.equal(monitor.targetSelect,null);assert.equal(monitor.forkCamera.options,null);assert.equal(monitor.missionPanel,null);
for(const cssPath of ['packages/tools/editor/src/editor.css','apps/public-viewer/viewer.css']){
 const css=fs.readFileSync(path.resolve(__dirname,'../..',cssPath),'utf8');assert(!/\.vehicle-docking-monitor(?:\[data-camera=["']?on["']?\])?\[data-plan=["']?open["']?\]\s+\.vehicle-camera-views\s*\{\s*display:\s*none;?\s*\}/.test(css),'The open plan cannot hide the live camera on mobile.');
}
console.log('Docking coach UI: front/mirror retained, readable measurements, stable target options, blocked controls, authoritative readiness, XR guide controls and complete cleanup passed.');
