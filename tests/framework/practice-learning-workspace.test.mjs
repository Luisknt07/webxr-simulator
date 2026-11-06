import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

class Element {
 constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.listeners={};this.dataset={};this.className='';this.value='';this.hidden=false;this.style={setProperty(){},removeProperty(){}};this.classList={toggle:(key,on)=>{const tokens=new Set(this.className.split(' ').filter(Boolean));if(on)tokens.add(key);else tokens.delete(key);this.className=[...tokens].join(' ');},add:key=>this.classList.toggle(key,true),remove:key=>this.classList.toggle(key,false),contains:key=>this.className.split(' ').includes(key)};}
 get textContent(){return(this.text||'')+this.children.map(child=>child.textContent).join('');}
 set textContent(value){this.text=String(value);for(const child of this.children)child.parentNode=null;this.children=[];}
 appendChild(child){if(child.parentNode)child.parentNode.children=child.parentNode.children.filter(row=>row!==child);child.parentNode=this;this.children.push(child);return child;}
 insertBefore(child,next){if(child.parentNode)child.parentNode.children=child.parentNode.children.filter(row=>row!==child);const index=this.children.indexOf(next);child.parentNode=this;if(index<0)this.children.push(child);else this.children.splice(index,0,child);return child;}
 get nextSibling(){const siblings=this.parentNode&&this.parentNode.children;return siblings?siblings[siblings.indexOf(this)+1]||null:null;}
 showModal(){this.open=true;}
 close(){this.open=false;}
 setAttribute(key,value){this.attributes[key]=String(value);}
 removeAttribute(key){delete this.attributes[key];}
 getAttribute(key){return this.attributes[key];}
 addEventListener(type,listener){(this.listeners[type]||(this.listeners[type]=[])).push(listener);}
 removeEventListener(type,listener){this.listeners[type]=(this.listeners[type]||[]).filter(row=>row!==listener);}
 async fire(type,values={}){const event={target:this,currentTarget:this,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...values};for(const callback of this.listeners[type]||[])await callback(event);return event;}
 remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(row=>row!==this);this.parentNode=null;}
 contains(node){return all(this).includes(node);}
 closest(selector){for(let current=this;current;current=current.parentNode)if(matches(current,selector))return current;return null;}
 querySelectorAll(selector){return all(this).slice(1).filter(row=>selector.split(',').some(value=>matches(row,value.trim())));}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 focus(){if(this.ownerDocument)this.ownerDocument.activeElement=this;}
 blur(){if(this.ownerDocument&&this.ownerDocument.activeElement===this)this.ownerDocument.activeElement=null;}
 get isConnected(){let node=this;while(node.parentNode)node=node.parentNode;return node.tagName==='BODY';}
}
const matches=(node,selector)=>selector.startsWith('.')?node.className.split(' ').includes(selector.slice(1)):selector.startsWith('[')?(()=>{const match=/^\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/.exec(selector);return !!match&&node.getAttribute(match[1])!==undefined&&(match[2]===undefined||node.getAttribute(match[1])===match[2]);})():selector.toUpperCase()===node.tagName;
const all=root=>[root,...root.children.flatMap(all)];
function fixture(){
 let driving=false;const events=[];
 const documentListeners={};const document={body:new Element('body'),activeElement:null,createElement:tag=>{const node=new Element(tag);node.ownerDocument=document;return node;},createElementNS:(_namespace,tag)=>document.createElement(tag),querySelector:selector=>selector==='.vehicle-driving-hud:not([hidden])'&&driving?{}:null,addEventListener:(type,listener)=>{(documentListeners[type]||(documentListeners[type]=[])).push(listener);},removeEventListener:(type,listener)=>{documentListeners[type]=(documentListeners[type]||[]).filter(row=>row!==listener);},fire:async(type,values={})=>{const event={preventDefault(){},stopPropagation(){this.stopped=true;},...values};for(const callback of documentListeners[type]||[])await callback(event);return event;}};
 const listeners={},timers=new Map();let timerSequence=0;const window={innerWidth:1440,innerHeight:900,addEventListener:(type,callback)=>{listeners[type]=callback;},removeEventListener:(type,callback)=>{if(listeners[type]===callback)delete listeners[type];},dispatchEvent:event=>events.push(event.type),setInterval:callback=>{const id=++timerSequence;timers.set(id,callback);return id;},clearInterval:id=>timers.delete(id)};
 const source=fs.readFileSync('modules/logistica-industrial/practices/ui/PracticePanel.js','utf8').replace(/^import[^\n]+\n/gm,'').replace('export default class PracticePanel','class PracticePanel');
 const Panel=new Function('document','window','practiceIcon',source+'\nreturn PracticePanel;')(document,window,name=>{const icon=new Element('svg');icon.setAttribute('data-icon',name);return icon;});
 const state={plan:{id:'CEDI-01',title:'Recepción, descarga y control de ingreso',objective:'Recibir la mercancía',steps:Array.from({length:6},(_,index)=>({title:'Misión fuente '+(index+1)})),expectedUnits:48},session:{score:20,completedSteps:['identify'],stepIndex:1,mode:'manual',caseId:'A',difficulty:1},world:{sourceUnits:48,processedUnits:0,receiverUnits:0},step:{guard:'prepare',title:'Asegurar el muelle',action:'Comprueba los enclavamientos.'},canConfigureAll:true};
 let configured=0;const controller={state:()=>state,perform(){},configure:()=>{configured++;}};
 const panel=new Panel({controller,host:document.body});
 return{panel,state,events,window,document,listeners,documentListeners,timers,setDriving:value=>{driving=value;},configured:()=>configured};
}
test('learning workspace reuses native controls in two sidebars and a measurable, transparent centre',async()=>{
 const f=fixture(),p=f.panel;
 assert.equal(p.root.getAttribute('data-presentation'),'workspace');
 assert.equal(p.sceneFrame.getAttribute('data-practice-scene-viewport'),'');
 assert.equal(p.sceneFrame.parentNode,p.root);
 assert.equal(p.stepOverview.parentNode.parentNode,p.learningLeft);
 assert.equal(p.stepOverview.children.length,6);
 assert.equal(p.stepOverview.children[0].getAttribute('data-state'),'done');
 assert.equal(p.stepOverview.children[1].getAttribute('data-state'),'active');
 assert.equal(p.body.parentNode,p.operationCard);
 assert.equal(p.operationCard.parentNode,p.learningRight);
 assert.equal(p.countValues.sourceUnits.textContent,'48');
 assert.equal(p.countValues.receiverUnits.textContent,'0');
 assert.equal(p.progress.value,1);
 assert.equal(p.evaluationStatus.textContent,'En curso');
 assert.match(p.progressText.textContent,/1 de 6/);
 assert.equal(f.configured(),0);await p.configureWorkspace.fire('click');assert.equal(f.configured(),1);
 assert(f.events.includes('smarttwin-practice-layout'));p.dispose();
});
test('game HUD starts closed, reuses forms and keeps only one information drawer open at any size',async()=>{
 const f=fixture(),p=f.panel;p.sku.value='SKU observado';p.count.value='48';
 assert.equal(p.root.getAttribute('data-interface'),'game');assert.deepEqual(p.sidebarOpen,{missions:false,instructions:false,help:false});assert(Object.values(p.drawerPanels).every(panel=>panel.hidden));assert.equal(p.root.getAttribute('data-scene-focus'),'true');
 assert.equal(p.gameDock.children.length,6);assert(p.gameDock.children.every(button=>button.getAttribute('aria-label')));
 await p.sidebarButtons.missions.fire('click');assert.deepEqual(p.sidebarOpen,{missions:true,instructions:false,help:false});
 await p.sidebarButtons.instructions.fire('click');assert.deepEqual(p.sidebarOpen,{missions:false,instructions:true,help:false});assert.equal(p.learningLeft.hidden,true);assert.equal(p.learningRight.hidden,false);
 await p.sceneFocusButton.fire('click');assert.equal(p.root.getAttribute('data-scene-focus'),'true');
 f.setDriving(true);p.update();assert.equal(p.root.getAttribute('data-scene-focus'),'true');
 await p.sidebarButtons.instructions.fire('click');assert.equal(p.sidebarOpen.instructions,true);
 f.setDriving(false);f.window.innerWidth=390;p.update();assert(Object.values(p.sidebarOpen).every(value=>!value),'A previous browser reader must not reopen when leaving the cab.');
 await p.sidebarButtons.missions.fire('click');f.window.innerWidth=1720;f.listeners.resize();assert.deepEqual(p.sidebarOpen,{missions:true,instructions:false,help:false});
 assert.equal(p.sku.value,'SKU observado');assert.equal(p.count.value,'48');const before=f.events.length;p.dispose();assert(f.events.length>before);assert.equal(f.document.body.children.length,0);assert.equal(f.timers.size,0);
});
test('assessment state comes only from the observed session and preview styles do not claim a score',()=>{
 const f=fixture(),p=f.panel;f.state.session={score:100,passed:true,stepIndex:6,completedSteps:['1','2','3','4','5','6']};f.state.step={};p.update();assert.equal(p.evaluationStatus.textContent,'Superada');assert.equal(p.progress.value,6);assert.equal(p.verify.disabled,true);assert.equal(p.score.textContent,'100 / 100 pts');
 const host=fs.readFileSync('modules/logistica-industrial/practices/runtime/PracticeCampaignHost.js','utf8');assert.match(host,/Montaje de consulta · evaluación pendiente/);assert.match(host,/No inicia un intento, no concede puntuación/);assert.match(host,/data-practice-scene-viewport/);p.dispose();
});
test('reading drawers release held vehicle, touch and keyboard movement on desktop and mobile',async()=>{
 for(const width of [1440,390]){
  const f=fixture(),p=f.panel,resets=[],touch={forward:1,right:.4};let vehicleResets=0,keyboardClears=0,unlocks=0;const ctx={mobileNavigation:{reset:reason=>{resets.push(reason);touch.forward=touch.right=0;}},vehicleDriving:{resetInput:()=>{vehicleResets++;}}};p.controller.editor={ctx,hooks:{clearKeyboard:()=>{keyboardClears++;},unlock:()=>{unlocks++;}}};f.window.innerWidth=width;
  await p.sidebarButtons.instructions.fire('click');assert.deepEqual(resets,['practice-reading']);assert.deepEqual(touch,{forward:0,right:0});assert.equal(ctx.practiceReadingPanelOpen,true);assert.equal(vehicleResets,1);assert.equal(keyboardClears,1);assert.equal(unlocks,1);
  p.notifyLayout();assert.equal(resets.length,1,'Repeated measurement must not keep resetting held input.');
  await p.sceneFocusButton.fire('click');assert.equal(ctx.practiceReadingPanelOpen,false);assert.equal(vehicleResets,2,'Returning to the world also discards stale key holds.');
  await p.sidebarButtons.missions.fire('click');assert.equal(resets.length,2);assert.equal(ctx.practiceReadingPanelOpen,true);assert.equal(p.sidebarOpen.instructions,false);
  await p.sidebarButtons.missions.fire('click');assert.equal(ctx.practiceReadingPanelOpen,false);p.dispose();assert.equal(resets.length,2,'Disposal must not reset another scene touch owner.');
 }
});

test('outside click, Escape and automatic dismissal preserve form values and leave no stale listeners',async()=>{
 const f=fixture(),p=f.panel;p.sku.value='SKU-REAL';p.count.value='48';
 assert.equal(p.learningLeft.getAttribute('data-practice-drawer'),'missions');assert.equal(p.learningRight.getAttribute('data-practice-drawer'),'instructions');
 assert.equal(p.sidebarButtons.missions.getAttribute('aria-controls'),p.learningLeft.id);
 await p.sidebarButtons.instructions.fire('click');await f.document.fire('pointerdown',{target:p.sku});assert.equal(p.sidebarOpen.instructions,true,'Reading a native form is inside the HUD.');
 await f.document.fire('pointerdown',{target:p.sceneFrame});assert.equal(p.sidebarOpen.instructions,false);assert.equal(p.root.getAttribute('data-practice-pane'),'scene');
 await p.sidebarButtons.instructions.fire('click');p.sku.focus();const escape=await f.document.fire('keydown',{key:'Escape'});assert.equal(escape.stopped,true);assert.equal(p.sidebarOpen.instructions,false);assert.equal(f.document.activeElement,null);
 await p.sidebarButtons.instructions.fire('click');assert.equal(p.dismissIdlePanels(p.lastHudActivity+p.hudIdleMs-1),false);assert.equal(p.sidebarOpen.instructions,true);assert.equal(p.dismissIdlePanels(p.lastHudActivity+p.hudIdleMs+1),true);assert.equal(p.sidebarOpen.instructions,false);
 assert.equal(p.sku.value,'SKU-REAL');assert.equal(p.count.value,'48');assert.equal(p.operationCard.parentNode,p.learningRight);p.dispose();assert.equal(f.listeners.resize,undefined);assert.equal(f.listeners.scroll,undefined);assert.equal(f.timers.size,0);assert(Object.values(f.documentListeners).every(rows=>!rows.length));
});

test('automatic dismissal never interrupts active reading, typing, a pending command or a workflow dialog',async()=>{
 const f=fixture(),p=f.panel;await p.sidebarButtons.instructions.fire('click');const elapsed=()=>p.lastHudActivity+p.hudIdleMs+1;
 await p.learningRight.fire('pointerenter');assert.equal(p.dismissIdlePanels(elapsed()),false);await p.learningRight.fire('pointerleave');
 p.sku.focus();p.sku.value='Escribiendo';await p.learningRight.fire('input',{target:p.sku});assert.equal(p.dismissIdlePanels(elapsed()),false);p.sku.blur();
 p.pending=true;assert.equal(p.dismissIdlePanels(elapsed()),false);p.pending=false;p.workflowDialog=new Element('dialog');assert.equal(p.dismissIdlePanels(elapsed()),false);p.workflowDialog=null;
 assert.equal(p.dismissIdlePanels(elapsed()),true);assert.equal(p.sku.value,'Escribiendo');p.dispose();
});

test('cab instruments are mutually exclusive and remain usable while driving without blocking controls',async()=>{
 const f=fixture(),p=f.panel,ctx={drivingVehicle:'forklift',vehicleDriving:{resetInput(){}}};p.controller.editor={ctx};
 await p.sidebarButtons.instructions.fire('click');assert.equal(ctx.practiceReadingPanelOpen,true);await p.dockButtons.controls.fire('click');assert.equal(ctx.practiceInstrument,'controls');assert.equal(ctx.practiceReadingPanelOpen,false);assert.equal(p.sidebarOpen.instructions,false);assert.equal(p.dockButtons.controls.getAttribute('aria-pressed'),'true');
 await p.dockButtons.layout.fire('click');assert.equal(ctx.practiceInstrument,'layout');assert.equal(p.dockButtons.controls.getAttribute('aria-pressed'),'false');assert.equal(ctx.practiceReadingPanelOpen,false);
 await p.dockButtons.layout.fire('click');assert.equal(ctx.practiceInstrument,null);assert.equal(f.document.body.getAttribute('data-practice-instrument'),undefined);p.dispose();
});

test('native instruments receive the measured scene bounds after layout and remove them on exit',()=>{
 const f=fixture(),p=f.panel,properties={};f.document.body.style={setProperty:(key,value)=>{properties[key]=value;},removeProperty:key=>{delete properties[key];}};
 p.sceneFrame.getBoundingClientRect=()=>({left:320,top:150,width:700,height:600,right:1020,bottom:750});p.notifyLayout();
 assert.equal(properties['--practice-scene-left'],'320px');assert.equal(properties['--practice-scene-right'],'420px');assert.equal(properties['--practice-scene-height'],'600px');assert.equal(f.document.body.getAttribute('data-practice-layout'),'active');
 f.window.innerWidth=1720;f.listeners.resize();assert.equal(properties['--practice-scene-right'],'700px');p.dispose();assert.deepEqual(properties,{});assert.equal(f.document.body.getAttribute('data-practice-layout'),undefined);
});

test('a narrow browser reading drawer never keeps immersive vehicle controls blocked',async()=>{
 const f=fixture(),p=f.panel,ctx={vrMode:false,renderer:{xr:{isPresenting:false}},vehicleDriving:{resetInput(){}}};p.controller.editor={ctx};f.window.innerWidth=390;f.listeners.resize();
 await p.sidebarButtons.instructions.fire('click');assert.equal(ctx.practiceReadingPanelOpen,true);
 ctx.vrMode=true;p.notifyLayout();assert.equal(ctx.practiceReadingPanelOpen,false);
 ctx.vrMode=false;ctx.renderer.xr.isPresenting=true;p.notifyLayout();assert.equal(ctx.practiceReadingPanelOpen,false,'XR presentation is authoritative even before the app VR flag arrives.');
 ctx.renderer.xr.isPresenting=false;p.notifyLayout();assert.equal(ctx.practiceReadingPanelOpen,true,'Returning to a browser restores the open mobile reader.');p.dispose();assert.equal(ctx.practiceReadingPanelOpen,false);
});

test('a mounted learner opens the real order forms, sees validation errors and resumes after dock verification',async()=>{
 const f=fixture(),p=f.panel,commands=[],vehicle={enabled:false,operatorInterlock:{kind:'practice-dock',actionId:'arrival-check'}},ctx={vehiclePreparationOpen:false,vehicleDriving:{resetInput(){this.resets=(this.resets||0)+1;}}};
 p.controller.editor={ctx};p.controller.manifest={vehicleIds:['forklift']};p.controller.runtime={records:new Map([['forklift',{components:{vehicle}}]])};
 Object.assign(f.state,{evidenceKind:'workflow',order:{orderId:'ORD-048',lotId:'LOT-001',dockId:'E02',expectedPallets:6,expectedUnits:48,pallets:[]},workflowActions:[
  {id:'arrival-check',title:'Contrastar orden',enabled:true,fields:[{key:'boxes',label:'Cajas observadas',type:'number'}]},
  {id:'secure-dock',title:'Verificar muelle',enabled:false,reason:'Contrasta primero la orden.',fields:[{key:'secured',label:'Comprobación',type:'choice',options:[{value:'checked',label:'Calzos y borde revisados'}]}]}
 ]});
 p.controller.perform=(type,payload)=>{commands.push({type,payload});if(payload.command==='arrival-check'){
  if(payload.values.boxes!==48)throw Error('Las cajas no coinciden con la orden.');
  f.state.workflowActions[0].enabled=false;f.state.workflowActions[1].enabled=true;vehicle.operatorInterlock.actionId='secure-dock';return{message:'Orden verificada.'};
 }assert.equal(payload.values.secured,'checked');vehicle.enabled=true;delete vehicle.operatorInterlock;return{message:'Muelle verificado.'};};
 f.setDriving(true);p.update();const parent=p.workflow.parentNode,next=p.workflow.nextSibling,order=p.order,forms=p.workflow,resetsBeforeDialog=ctx.vehicleDriving.resets||0;
 assert(p.openWorkflowAction('arrival-check'));assert.equal(commands.length,0,'Opening never accepts preconditions.');
 assert.equal(ctx.vehiclePreparationOpen,true);assert.equal(p.workflow,forms);assert.equal(p.order,order);
 assert.equal(forms.parentNode.parentNode,p.workflowDialog,'Reuse native forms instead of a duplicate UI with independent values.');
 assert.equal(p.workflowWidgets.get('arrival-check').inputs.boxes.value,'','The observed count is not prefilled.');
 p.workflowWidgets.get('arrival-check').inputs.boxes.value='47';await p.workflowWidgets.get('arrival-check').form.fire('submit');await new Promise(resolve=>setImmediate(resolve));
 assert.match(p.workflowDialogStatus.textContent,/no coinciden/);assert.equal(vehicle.enabled,false);assert.equal(p.workflowChosen,'arrival-check');
 p.workflowWidgets.get('arrival-check').inputs.boxes.value='48';await p.workflowWidgets.get('arrival-check').form.fire('submit');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(p.workflowChosen,'secure-dock');assert.equal(vehicle.enabled,false);assert.equal(p.workflowWidgets.get('arrival-check').inputs.boxes.value,'48');
 p.workflowWidgets.get('secure-dock').inputs.secured.value='checked';await p.workflowWidgets.get('secure-dock').form.fire('submit');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(vehicle.enabled,true);assert.equal(p.workflowDialog,null);assert.equal(ctx.vehiclePreparationOpen,false);assert.equal(ctx.vehicleDriving.resets,resetsBeforeDialog+1,'Closing the real preparation dialog releases its held controls.');
 assert.equal(forms.parentNode,parent);assert.equal(forms.nextSibling,next);assert.equal(p.workflowWidgets.get('arrival-check').inputs.boxes.value,'48');
 assert.deepEqual(commands.map(row=>row.payload.command),['arrival-check','arrival-check','secure-dock']);p.dispose();
});
