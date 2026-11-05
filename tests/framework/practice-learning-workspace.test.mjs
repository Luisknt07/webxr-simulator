import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

class Element {
 constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.listeners={};this.dataset={};this.className='';this.value='';this.hidden=false;this.classList={toggle:(key,on)=>{const tokens=new Set(this.className.split(' ').filter(Boolean));if(on)tokens.add(key);else tokens.delete(key);this.className=[...tokens].join(' ');}};}
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
 async fire(type){for(const callback of this.listeners[type]||[])await callback({preventDefault(){},stopPropagation(){}});}
 remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(row=>row!==this);this.parentNode=null;}
 querySelectorAll(selector){return all(this).filter(row=>selector==='button'&&row.tagName==='BUTTON');}
}
const all=root=>[root,...root.children.flatMap(all)];
function fixture(){
 let driving=false;const events=[];
 const document={body:new Element('body'),createElement:tag=>new Element(tag),querySelector:selector=>selector==='.vehicle-driving-hud:not([hidden])'&&driving?{}:null};
 const listeners={};const window={innerWidth:1440,innerHeight:900,addEventListener:(type,callback)=>{listeners[type]=callback;},removeEventListener:(type,callback)=>{if(listeners[type]===callback)delete listeners[type];},dispatchEvent:event=>events.push(event.type)};
 const source=fs.readFileSync('modules/logistica-industrial/practices/ui/PracticePanel.js','utf8').replace('export default class PracticePanel','class PracticePanel');
 const Panel=new Function('document','window',source+'\nreturn PracticePanel;')(document,window);
 const state={plan:{id:'CEDI-01',title:'Recepción, descarga y control de ingreso',objective:'Recibir la mercancía',steps:Array.from({length:6},(_,index)=>({title:'Misión fuente '+(index+1)})),expectedUnits:48},session:{score:20,completedSteps:['identify'],stepIndex:1,mode:'manual',caseId:'A',difficulty:1},world:{sourceUnits:48,processedUnits:0,receiverUnits:0},step:{guard:'prepare',title:'Asegurar el muelle',action:'Comprueba los enclavamientos.'},canConfigureAll:true};
 let configured=0;const controller={state:()=>state,perform(){},configure:()=>{configured++;}};
 const panel=new Panel({controller,host:document.body});
 return{panel,state,events,window,document,listeners,setDriving:value=>{driving=value;},configured:()=>configured};
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
test('driving uses the full scene automatically and explicit focus or mobile navigation preserves typed values',async()=>{
 const f=fixture(),p=f.panel;p.sku.value='SKU observado';
 await p.sceneFocusButton.fire('click');assert.equal(p.root.getAttribute('data-scene-focus'),'true');
 await p.sceneFocusButton.fire('click');assert.equal(p.root.getAttribute('data-scene-focus'),'false');
 f.setDriving(true);p.update();assert.equal(p.root.getAttribute('data-scene-focus'),'true');assert.equal(p.body.hidden,true);
 await p.sceneFocusButton.fire('click');assert.equal(p.root.getAttribute('data-scene-focus'),'false');
 f.setDriving(false);f.window.innerWidth=390;p.update();const scene=p.mobileNavigation.children.find(row=>row.getAttribute('data-practice-pane')==='scene');await scene.fire('click');assert.equal(p.root.getAttribute('data-practice-pane'),'scene');assert.equal(p.sku.value,'SKU observado');
 const before=f.events.length;p.dispose();assert.equal(f.events.length,before+1);assert.equal(f.document.body.children.length,0);
});
test('assessment state comes only from the observed session and preview styles do not claim a score',()=>{
 const f=fixture(),p=f.panel;f.state.session={score:100,passed:true,stepIndex:6,completedSteps:['1','2','3','4','5','6']};f.state.step={};p.update();assert.equal(p.evaluationStatus.textContent,'Superada');assert.equal(p.progress.value,6);assert.equal(p.verify.disabled,true);assert.equal(p.score.textContent,'100 / 100 pts');
 const host=fs.readFileSync('modules/logistica-industrial/practices/runtime/PracticeCampaignHost.js','utf8');assert.match(host,/Montaje de consulta · evaluación pendiente/);assert.match(host,/No inicia un intento, no concede puntuación/);assert.match(host,/data-practice-scene-viewport/);p.dispose();
});
test('mobile drawers release held input once when opened and return to neutral controls when closed',async()=>{
 const f=fixture(),p=f.panel,resets=[],touch={forward:1,right:.4};let vehicleResets=0;const ctx={mobileNavigation:{reset:reason=>{resets.push(reason);touch.forward=touch.right=0;}},vehicleDriving:{resetInput:()=>{vehicleResets++;}}};p.controller.editor={ctx};f.window.innerWidth=390;
 const pane=id=>p.mobileNavigation.children.find(row=>row.getAttribute('data-practice-pane')===id);
 await pane('scene').fire('click');assert.equal(resets.length,0);assert.equal(touch.forward,1);
 await pane('instructions').fire('click');assert.deepEqual(resets,['practice-reading']);assert.deepEqual(touch,{forward:0,right:0});
 assert.equal(ctx.practiceReadingPanelOpen,true);assert.equal(vehicleResets,1);p.notifyLayout();assert.equal(resets.length,1,'Repeated measurement must not reset input repeatedly.');
 await p.sceneFocusButton.fire('click');assert.equal(ctx.practiceReadingPanelOpen,false);await pane('missions').fire('click');assert.equal(resets.length,2,'A newly opened drawer releases any prior movement.');assert.equal(p.sidebarOpen.instructions,false);
 f.setDriving(true);p.update();assert.equal(ctx.practiceReadingPanelOpen,false);await pane('instructions').fire('click');assert.equal(resets.length,3,'A mobile cab reader cannot keep moving under an open drawer.');assert.equal(ctx.practiceReadingPanelOpen,true);
 await p.sidebarButtons.instructions.fire('click');assert.equal(ctx.practiceReadingPanelOpen,false);assert.equal(vehicleResets,3);
 p.dispose();assert.equal(resets.length,3,'Disposal must not reset another scene input owner.');
});

test('independent sidebars preserve form values, separate cab preferences and adapt to a single mobile drawer',async()=>{
 const f=fixture(),p=f.panel;p.sku.value='SKU-REAL';p.count.value='48';
 assert.equal(p.learningLeft.getAttribute('data-practice-drawer'),'missions');assert.equal(p.learningRight.getAttribute('data-practice-drawer'),'instructions');
 assert.equal(p.sidebarButtons.missions.getAttribute('aria-controls'),p.learningLeft.id);assert.deepEqual(p.sidebarOpen,{missions:true,instructions:true});
 await p.sidebarButtons.missions.fire('click');assert.deepEqual(p.sidebarOpen,{missions:false,instructions:true});assert.equal(p.sidebarButtons.missions.getAttribute('aria-expanded'),'false');
 f.setDriving(true);p.update();assert.deepEqual(p.sidebarOpen,{missions:false,instructions:false});await p.sidebarButtons.instructions.fire('click');assert.deepEqual(p.sidebarOpen,{missions:false,instructions:true});
 f.setDriving(false);p.update();assert.deepEqual(p.sidebarOpen,{missions:false,instructions:true});
 await p.sidebarButtons.missions.fire('click');assert.deepEqual(p.sidebarOpen,{missions:true,instructions:true});
 f.window.innerWidth=390;f.listeners.resize();assert.deepEqual(p.sidebarOpen,{missions:true,instructions:false},'Only the most recently requested sidebar covers a mobile scene.');
 f.window.innerWidth=1720;f.listeners.resize();assert.deepEqual(p.sidebarOpen,{missions:true,instructions:true},'Resizing restores the desktop preference.');
 assert.equal(p.sku.value,'SKU-REAL');assert.equal(p.count.value,'48');assert.equal(p.operationCard.parentNode,p.learningRight);p.dispose();assert.equal(f.listeners.resize,undefined);assert.equal(f.listeners.scroll,undefined);
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
 f.setDriving(true);p.update();const parent=p.workflow.parentNode,next=p.workflow.nextSibling,order=p.order,forms=p.workflow;
 assert(p.openWorkflowAction('arrival-check'));assert.equal(commands.length,0,'Opening never accepts preconditions.');
 assert.equal(ctx.vehiclePreparationOpen,true);assert.equal(p.workflow,forms);assert.equal(p.order,order);
 assert.equal(forms.parentNode.parentNode,p.workflowDialog,'Reuse native forms instead of a duplicate UI with independent values.');
 assert.equal(p.workflowWidgets.get('arrival-check').inputs.boxes.value,'','The observed count is not prefilled.');
 p.workflowWidgets.get('arrival-check').inputs.boxes.value='47';await p.workflowWidgets.get('arrival-check').form.fire('submit');await new Promise(resolve=>setImmediate(resolve));
 assert.match(p.workflowDialogStatus.textContent,/no coinciden/);assert.equal(vehicle.enabled,false);assert.equal(p.workflowChosen,'arrival-check');
 p.workflowWidgets.get('arrival-check').inputs.boxes.value='48';await p.workflowWidgets.get('arrival-check').form.fire('submit');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(p.workflowChosen,'secure-dock');assert.equal(vehicle.enabled,false);assert.equal(p.workflowWidgets.get('arrival-check').inputs.boxes.value,'48');
 p.workflowWidgets.get('secure-dock').inputs.secured.value='checked';await p.workflowWidgets.get('secure-dock').form.fire('submit');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(vehicle.enabled,true);assert.equal(p.workflowDialog,null);assert.equal(ctx.vehiclePreparationOpen,false);assert.equal(ctx.vehicleDriving.resets,1);
 assert.equal(forms.parentNode,parent);assert.equal(forms.nextSibling,next);assert.equal(p.workflowWidgets.get('arrival-check').inputs.boxes.value,'48');
 assert.deepEqual(commands.map(row=>row.payload.command),['arrival-check','arrival-check','secure-dock']);p.dispose();
});
