import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

class Element {
 constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.listeners={};this.dataset={};this.className='';this.value='';this.hidden=false;this.classList={toggle:(key,on)=>{const tokens=new Set(this.className.split(' ').filter(Boolean));if(on)tokens.add(key);else tokens.delete(key);this.className=[...tokens].join(' ');}};}
 get textContent(){return(this.text||'')+this.children.map(child=>child.textContent).join('');}
 set textContent(value){this.text=String(value);for(const child of this.children)child.parentNode=null;this.children=[];}
 appendChild(child){if(child.parentNode)child.parentNode.children=child.parentNode.children.filter(row=>row!==child);child.parentNode=this;this.children.push(child);return child;}
 setAttribute(key,value){this.attributes[key]=String(value);}
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
 const window={innerWidth:1440,dispatchEvent:event=>events.push(event.type)};
 const source=fs.readFileSync('modules/logistica-industrial/practices/ui/PracticePanel.js','utf8').replace('export default class PracticePanel','class PracticePanel');
 const Panel=new Function('document','window',source+'\nreturn PracticePanel;')(document,window);
 const state={plan:{id:'CEDI-01',title:'Recepción, descarga y control de ingreso',objective:'Recibir la mercancía',steps:Array.from({length:6},(_,index)=>({title:'Misión fuente '+(index+1)})),expectedUnits:48},session:{score:20,completedSteps:['identify'],stepIndex:1,mode:'manual',caseId:'A',difficulty:1},world:{sourceUnits:48,processedUnits:0,receiverUnits:0},step:{guard:'prepare',title:'Asegurar el muelle',action:'Comprueba los enclavamientos.'},canConfigureAll:true};
 let configured=0;const controller={state:()=>state,perform(){},configure:()=>{configured++;}};
 const panel=new Panel({controller,host:document.body});
 return{panel,state,events,window,document,setDriving:value=>{driving=value;},configured:()=>configured};
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
test('mobile reading releases held native touch input while scene focus and occupied vehicles preserve their controls',async()=>{
 const f=fixture(),p=f.panel,resets=[],touch={forward:1,right:.4};p.controller.editor={ctx:{mobileNavigation:{reset:reason=>{resets.push(reason);touch.forward=touch.right=0;}}}};f.window.innerWidth=390;
 const pane=id=>p.mobileNavigation.children.find(row=>row.getAttribute('data-practice-pane')===id);
 await pane('scene').fire('click');assert.equal(resets.length,0);assert.equal(touch.forward,1);
 await pane('instructions').fire('click');assert.deepEqual(resets,['practice-reading']);assert.deepEqual(touch,{forward:0,right:0});
 await p.sceneFocusButton.fire('click');await pane('missions').fire('click');assert.equal(resets.length,1,'Full-scene view does not revoke scene controls.');
 f.setDriving(true);p.update();await pane('instructions').fire('click');assert.equal(resets.length,1,'Occupied vehicle controls are not globally hidden or reset by reading-tab state.');
 p.dispose();assert.equal(resets.length,1,'Disposal must not reset another scene input owner.');
});
