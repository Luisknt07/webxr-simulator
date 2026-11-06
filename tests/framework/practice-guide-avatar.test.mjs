import test from 'node:test';
import assert from 'node:assert/strict';
import PracticeGuideAvatar from '../../packages/assistant-ui/PracticeGuideAvatar.js';

class Node {
 constructor(tag, ownerDocument) {this.tagName=tag;this.ownerDocument=ownerDocument;this.children=[];this.parentNode=null;this.attributes=new Map();this.handlers=new Map();this._text='';this.hidden=false;}
 set innerHTML(_) {throw Error('The guide must render inert DOM.');}
 set textContent(value) {this._text=String(value);this.children.forEach(node=>node.parentNode=null);this.children=[];}
 get textContent() {return this._text+this.children.map(node=>node.textContent).join('');}
 appendChild(node) {if(node.parentNode)node.parentNode.removeChild(node);this.children.push(node);node.parentNode=this;return node;}
 removeChild(node) {this.children=this.children.filter(value=>value!==node);node.parentNode=null;return node;}
 setAttribute(key,value) {this.attributes.set(key,String(value));}
 getAttribute(key) {return this.attributes.get(key);}
 addEventListener(type,handler) {const list=this.handlers.get(type)||[];list.push(handler);this.handlers.set(type,list);}
 removeEventListener(type,handler) {this.handlers.set(type,(this.handlers.get(type)||[]).filter(value=>value!==handler));}
 fire(type,properties={}) {const event={target:this,stopPropagation(){},preventDefault(){},...properties};for(const handler of [...this.handlers.get(type)||[]])handler(event);return event;}
 click() {this.fire('click');}
 focus() {this.ownerDocument.activeElement=this;}
}
const all = node => [node,...node.children.flatMap(all)];
const flush = async () => {for(let i=0;i<5;i++)await Promise.resolve();};
function fixture({permission='prompt',recognition=true}={}) {
 const document=new Node('document');document.body=new Node('body',document);document.body.parentNode=document;
 document.createElement=tag=>new Node(tag,document);document.createElementNS=(_,tag)=>new Node(tag,document);
 const permissions=new Node('permission');permissions.state=permission;
 const calls=[],subscribers=new Set();let model={enabled:false,recognitionSupported:recognition,status:'Voz desactivada.',capabilities:{recognition}};
 const emit=patch=>{model={...model,...patch};for(const callback of subscribers)callback({...model});};
 const voice={state:()=>({...model}),subscribe(callback){subscribers.add(callback);callback({...model});return()=>subscribers.delete(callback);},setEnabled(value){calls.push(['enabled',value]);emit({enabled:value});return value;},listen(){calls.push(['listen']);emit({listening:!model.listening});return true;},speak(){throw Error('The avatar must never narrate automatically.');},ask(){throw Error('The avatar must not create or send a question automatically.');}};
 let practice={step:{id:'prepare',title:'Preparar el ingreso',action:'Contrasta la orden en el puesto de recepción.'},session:{stepIndex:0,completedSteps:[]}};
 const controller={attemptId:'attempt-1',current:()=>true,state:()=>{calls.push(['snapshot']);return practice;}};
 const ctx={voiceAssistant:voice,editor:{active:false,practiceController:controller},assistantWorkspace:{open(){calls.push(['chat']);ctx.assistantPanelOpen=true;return true;}}};
 const window={navigator:{permissions:{query(options){calls.push(['permissionQuery',options.name]);return Promise.resolve(permissions);},request(){throw Error('No permission request at mount.');}},mediaDevices:{getUserMedia(){throw Error('No microphone capture at mount.');}}}};
 document.defaultView=window;
 const ui=new PracticeGuideAvatar({document,window,context:ctx});ui.mount();
 return {ui,document,ctx,voice,calls,emit,permissions,subscribers,setPractice(value){practice=value;ui.update(value);}};
}

test('the original visible guide starts collapsed with three accessible actions and no media or narration',async()=>{
 const f=fixture();await flush();assert.equal(f.ui.element.hidden,false);assert.equal(f.ui.bubble.hidden,true);assert.equal(f.ui.launcher.getAttribute('aria-expanded'),'false');
 assert.equal(f.ui.voiceButton.getAttribute('aria-label'),'Activar voz');assert.equal(f.ui.microphoneButton.getAttribute('aria-label'),'Preguntar por voz');assert.equal(f.ui.chatButton.getAttribute('aria-label'),'Chat');
 assert.equal(all(f.ui.element).filter(node=>node.tagName==='svg'&&node.getAttribute('role')==='img').length,1);
 assert.equal(all(f.ui.element).some(node=>['img','iframe','audio','video','script'].includes(node.tagName)),false);
 assert.equal(f.calls.filter(row=>row[0]==='permissionQuery').length,1);assert.equal(f.calls.some(row=>['listen','enabled','chat'].includes(row[0])),false);f.ui.dispose();
});

test('the bubble follows the native step and verified completion without commands or unsafe HTML',()=>{
 const f=fixture();f.ui.launcher.click();assert.equal(f.ui.bubble.hidden,false);assert.equal(f.ui.stepLabel.textContent,'PASO 1 DE 6');assert(f.ui.instruction.textContent.includes('puesto de recepción'));
 f.setPractice({step:{id:'inspect',title:'<img src=x> Verificar la carga',action:'Comprueba cantidades y referencias.'},session:{stepIndex:2}});assert.equal(f.ui.stepLabel.textContent,'PASO 3 DE 6');assert(f.ui.heading.textContent.includes('<img src=x>'));assert.equal(all(f.ui.element).some(node=>node.tagName==='img'),false);
 f.setPractice({session:{passed:true,stepIndex:6}});assert.equal(f.ui.heading.textContent,'Trabajo verificado');f.ui.closeButton.click();assert.equal(f.ui.expanded,false);f.ui.launcher.click();f.document.fire('keydown',{key:'Escape'});assert.equal(f.ui.expanded,false);f.ui.dispose();
});

test('voice toggles the existing service and microphone starts only after a deliberate gesture',async()=>{
 const f=fixture();await flush();f.ui.voiceButton.click();assert.equal(f.ui.voiceButton.getAttribute('aria-pressed'),'true');f.ui.voiceButton.click();assert.equal(f.ui.voiceButton.getAttribute('aria-pressed'),'false');
 assert.equal(f.calls.some(row=>row[0]==='listen'),false);f.ui.microphoneButton.click();assert.equal(f.calls.filter(row=>row[0]==='listen').length,1);assert.equal(f.ui.microphoneButton.getAttribute('aria-pressed'),'true');assert.equal(f.ui.element.getAttribute('data-voice-state'),'listening');f.ui.microphoneButton.click();assert.equal(f.calls.filter(row=>row[0]==='listen').length,2);assert.equal(f.ui.microphoneButton.getAttribute('aria-pressed'),'false');f.ui.dispose();
});

test('native denied and unsupported microphone states give actionable help without capture',async()=>{
 const f=fixture({permission:'denied'});await flush();f.ui.microphoneButton.click();assert.equal(f.calls.some(row=>row[0]==='listen'),false);assert(f.ui.status.textContent.includes('ajustes de este sitio'));assert.equal(f.ui.element.getAttribute('data-microphone-permission'),'denied');
 f.permissions.state='granted';f.permissions.fire('change');f.ui.microphoneButton.click();assert.equal(f.calls.filter(row=>row[0]==='listen').length,1);f.ui.dispose();
 const unsupported=fixture({recognition:false});await flush();unsupported.ui.microphoneButton.click();assert(unsupported.ui.status.textContent.includes('Chat'));assert.equal(unsupported.calls.some(row=>row[0]==='listen'),false);unsupported.ui.dispose();
});

test('chat uses the real assistant panel or native voice question input, never a placeholder agent',()=>{
 const f=fixture();f.ui.setExpanded(true);f.ui.chatButton.click();assert.equal(f.calls.filter(row=>row[0]==='chat').length,1);assert.equal(f.ctx.assistantPanelOpen,true);assert.equal(f.ui.expanded,false);
 delete f.ctx.assistantWorkspace;const input=new Node('input',f.document);f.ctx.voicePanel={questionInput:input,open(){f.calls.push(['voicePanel']);return true;}};f.ui.chatButton.click();assert.equal(f.document.activeElement,input);assert.equal(f.calls.filter(row=>row[0]==='voicePanel').length,1);
 delete f.ctx.voicePanel;f.ui.chatButton.click();assert(f.ui.status.textContent.includes('no está disponible'));f.ui.dispose();
});

test('practice, edit and XR lifecycle keep the desktop guide scoped and remove every listener',async()=>{
 const f=fixture();await flush();const oldButton=f.ui.microphoneButton;assert.equal(f.subscribers.size,1);f.ctx.vrMode=true;f.ui.update({session:{}});assert.equal(f.ui.element.hidden,true);f.ctx.vrMode=false;f.ctx.editor.active=true;f.ui.update({session:{}});assert.equal(f.ui.element.hidden,true);f.ctx.editor.active=false;f.ui.update(null);assert.equal(f.ui.element.hidden,true);
 f.ui.dispose();oldButton.click();assert.equal(f.subscribers.size,0);assert.equal(f.ui.element,null);assert.equal(f.calls.some(row=>row[0]==='listen'),false);assert.equal([...f.permissions.handlers.values()].reduce((sum,rows)=>sum+rows.length,0),0);assert.equal([...f.document.handlers.values()].reduce((sum,rows)=>sum+rows.length,0),0);
 const late=fixture();late.ui.dispose();await flush();assert.equal([...late.permissions.handlers.values()].reduce((sum,rows)=>sum+rows.length,0),0);
});

test('per-frame host updates do not resnapshot the complete practice inventory every frame',()=>{
 const f=fixture();const before=f.calls.filter(row=>row[0]==='snapshot').length;for(let i=0;i<100;i++)f.ui.update();assert.equal(f.calls.filter(row=>row[0]==='snapshot').length,before);f.ui.lastStateAt=Date.now()-300;f.ui.update();assert.equal(f.calls.filter(row=>row[0]==='snapshot').length,before+1);f.ui.dispose();
});
