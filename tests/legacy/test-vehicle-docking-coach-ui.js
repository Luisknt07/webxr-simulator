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
 getContext(){if(!this.context){this.calls=[];this.context={measureText:value=>({width:String(value).length*10})};for(const name of ['fillRect','fillText','beginPath','moveTo','lineTo','stroke','fill','closePath'])this.context[name]=(...args)=>{assert(args.every(value=>typeof value!=='number'||Number.isFinite(value)));this.calls.push([name,...args]);};}return this.context;}
}
class ForkCamera{
 constructor(){this.enabled=true;this.mode='isometric';this.side=-1;this.selectedFeed='front';}
 mount(options){this.options=options;}
 unmount(){this.options=null;}
 dispose(){this.unmount();}
 setEnabled(value){this.enabled=!!value;return this.enabled;}
 setAvailable(value){this.available=value;}
 toggleMode(){const modes=['isometric','entry','tips'];this.mode=modes[(modes.indexOf(this.mode)+1)%modes.length];}
 switchSide(){this.side*=-1;}
 toggleRearView(){this.selectedFeed=this.selectedFeed==='front'?'mirror':'front';return this.selectedFeed==='mirror';}
}
const filename=path.resolve(__dirname,'../../modules/logistica-industrial/functions/montacargas/runtime/VehicleDockingMonitor.js');
const source=fs.readFileSync(filename,'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default class VehicleDockingMonitor','class VehicleDockingMonitor');
const Monitor=new Function('THREE','VehicleForkCamera',source+'\nreturn VehicleDockingMonitor;')(THREE,ForkCamera);
const document={createElement:tag=>new Element(tag),body:new Element('body')},seat=new THREE.Group(),forks=new THREE.Group();
const targets=[{id:'pallet-1',name:'Pallet de entrada',kind:'pickup',allowed:true,distanceM:3},{id:'stock-1',name:'Bahía de descarga',kind:'drop',allowed:true,distanceM:5}];
const state={phase:'pickup',title:'Alinear las horquillas',instruction:'Centra ambas uñas antes de entrar.',targetId:'pallet-1',targetName:targets[0].name,distanceM:3,routeNote:'Orientación local; comprueba el pasillo.'};
const guide={enabled:true,getState:()=>state,getTargets:()=>targets,setEnabled(value){this.enabled=value;},setTarget(value){state.targetId=value;state.targetName=(targets.find(target=>target.id===value)||{}).name||'';},nextTarget(){this.setTarget(state.targetId==='pallet-1'?'stock-1':'pallet-1');}};
const snapshot={phase:'pickup',targetId:'pallet-1',ready:false,severity:'near',reason:'Completa la inserción.',errors:{lateralM:.02,verticalM:.04,yawRad:.03},insertion:{actualM:.24,requiredM:.6},geometry:{},stability:{loadKg:33,capacityKg:499}};
let blocked=false,resets=0,hudUpdates=0;const commands=[];
const vehicle={powered:true,running:true,parkingBrake:false};
const driving={ctx:{vrMode:false},id:'forklift',document,seat,holographicGuide:guide,visualRoot:{userData:{vehicleRig:{forks,config:{family:'forklift'}}}},simulation:{statePrefix:'qa-',vehicleRuntime:{getDockingState:()=>snapshot}},record:()=>({components:{vehicle}}),blocked:()=>blocked,
 cabPanelLayout:()=>({alignment:[-.8,-.34,1.1],front:{position:[.8,.08,1.1],width:.68,height:.3825},mirror:{position:[.8,.4,1.1],width:.36,height:.2}}),placeCabPanel:(plane,position)=>plane.position.fromArray(position),panelSelectable:()=>true,
 command(action){commands.push(action);if(action==='holographicGuide')guide.setEnabled(!guide.enabled);if(action==='guidanceNext')guide.nextTarget();},resetInput(){resets++;},updateHUD(){hudUpdates++;}};
const monitor=new Monitor(driving);monitor.mount();
assert.equal(monitor.cameraEnabled,true);assert.equal(monitor.plan.hidden,false);assert.equal(monitor.feed.hidden,false);assert.equal(monitor.rear.hidden,true);assert.equal(monitor.rear.parentNode,undefined);
assert.equal(monitor.guidancePanel.parentNode,document.body);assert.equal(monitor.guidanceBar.parentNode,monitor.guidancePanel);assert.notEqual(monitor.coach.parentNode,monitor.element);assert.equal(monitor.metrics.hidden,false);
monitor.rearButton.fire('click');assert.equal(monitor.forkCamera.selectedFeed,'mirror');assert.equal(monitor.element.dataset.feed,'mirror');assert.equal(monitor.plan.hidden,false);assert.match(monitor.rearButton.textContent,/Horquillas/);monitor.rearButton.fire('click');assert.equal(monitor.forkCamera.selectedFeed,'front');
assert.match(monitor.cameraModeButton.textContent,/Isométrica/);assert.equal(monitor.sideButton.hidden,false);assert(monitor.sideButton.parentNode);
monitor.sideButton.fire('click');assert.equal(monitor.forkCamera.side,1);assert.match(monitor.sideButton.textContent,/Der/);
monitor.cameraModeButton.fire('click');assert.equal(monitor.sideButton.hidden,true);monitor.cameraModeButton.fire('click');monitor.cameraModeButton.fire('click');assert.equal(monitor.sideButton.hidden,false);
assert.equal(monitor.hologramButton.getAttribute('aria-pressed'),'true');assert.equal(monitor.targetSelect.children.length,3);assert(monitor.coach.textContent.includes('Centra ambas uñas'));
assert(monitor.metrics.textContent.includes('24.0 cm / 60.0 cm'),'Insertion is readable DOM text, not only tiny pixels in the plan.');
const originalOption=monitor.targetSelect.children[1];state.distanceM=2.8;monitor.update(true);assert.equal(monitor.targetSelect.children[1],originalOption,'Distance updates must not rebuild an open target selector.');
monitor.planButton.fire('click');assert.equal(monitor.plan.hidden,false);assert.equal(monitor.feed.hidden,false);assert.equal(monitor.forkCamera.enabled,true,'The plan remains visible and cannot switch off the selected camera.');
monitor.targetSelect.value='stock-1';monitor.targetSelect.fire('change');assert.equal(state.targetId,'stock-1');assert.equal(resets,1);assert.equal(hudUpdates,1);assert.deepEqual(commands,[]);
monitor.hologramButton.fire('click');assert.equal(guide.enabled,false);assert.deepEqual(commands,['holographicGuide']);
monitor.page='guide';monitor.select(40,400);assert.equal(guide.enabled,true);monitor.select(250,400);assert.equal(state.targetId,'pallet-1');
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
blocked=true;monitor.update(true);const count=commands.length;monitor.hologramButton.fire('click');monitor.targetSelect.fire('change');assert.equal(commands.length,count);assert.equal(monitor.targetSelect.disabled,true);assert.equal(monitor.severity,'blocked');
monitor.unmount();assert.equal(document.body.children.length,0);assert.equal(seat.children.length,0);assert.equal(monitor.targetSelect,null);assert.equal(monitor.forkCamera.options,null);
for(const cssPath of ['packages/tools/editor/src/editor.css','apps/public-viewer/viewer.css']){
 const css=fs.readFileSync(path.resolve(__dirname,'../..',cssPath),'utf8');assert(!/\.vehicle-docking-monitor(?:\[data-camera=["']?on["']?\])?\[data-plan=["']?open["']?\]\s+\.vehicle-camera-views\s*\{\s*display:\s*none;?\s*\}/.test(css),'The open plan cannot hide the live camera on mobile.');
}
console.log('Docking coach UI: front/mirror retained, readable measurements, stable target options, blocked controls, authoritative readiness, XR guide controls and complete cleanup passed.');
