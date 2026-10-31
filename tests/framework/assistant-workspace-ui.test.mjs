import test from 'node:test';
import assert from 'node:assert/strict';
import AssistantWorkspacePanel,{safeResearchURL,videoEmbedURL,normaliseVisual} from '../../packages/assistant-ui/AssistantWorkspacePanel.js';

const walk=node=>[node,...node.children.flatMap(walk)];
class Node{
 constructor(tag,document){this.tagName=tag.toLowerCase();this.ownerDocument=document;this.children=[];this.parentNode=null;this.handlers=new Map();this.attributes=new Map();this.dataset={};this.style={};this.className='';this.hidden=false;this.disabled=false;this.value='';this._text='';this.scrollHeight=100;this.scrollTop=0;this.classList={toggle:(name,value)=>{const classes=new Set(this.className.split(/\s+/).filter(Boolean));value?classes.add(name):classes.delete(name);this.className=[...classes].join(' ');}};}
 set innerHTML(value){throw Error('Unsafe innerHTML must not be used.');}
 set textContent(value){this._text=String(value);for(const node of this.children)node.parentNode=null;this.children=[];}
 get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
 appendChild(node){if(node.parentNode)node.parentNode.removeChild(node);node.parentNode=this;this.children.push(node);return node;}
 removeChild(node){this.children=this.children.filter(value=>value!==node);node.parentNode=null;return node;}
 setAttribute(key,value){this.attributes.set(key,String(value));}
 getAttribute(key){return this.attributes.get(key);}
 removeAttribute(key){this.attributes.delete(key);}
 addEventListener(type,handler){let list=this.handlers.get(type);if(!list)this.handlers.set(type,list=[]);list.push(handler);}
 removeEventListener(type,handler){this.handlers.set(type,(this.handlers.get(type)||[]).filter(value=>value!==handler));}
 fire(type,properties={}){const event={target:this,stopped:false,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...properties};let node=this;while(node){for(const handler of [...node.handlers.get(type)||[]])handler(event);if(event.stopped)break;node=node.parentNode;}return event;}
 click(){if(!this.disabled)this.fire('click');}
 focus(){this.ownerDocument.activeElement=this;}
}
function fixture(){
 const dom=new Node('document');dom.baseURI='https://smarttwin.example.com/editor';dom.createElement=tag=>new Node(tag,dom);dom.createElementNS=(ns,tag)=>new Node(tag,dom);dom.body=dom.createElement('body');dom.body.parentNode=dom;dom.querySelector=selector=>selector==='.studio-header-actions'?header:null;const header=dom.createElement('nav');dom.body.appendChild(header);const subscribers=new Set(),calls=[],ctx={document:dom,desktopLook:{unlock(){calls.push('unlock');},reset(){calls.push('reset');},lock(){throw Error('Closing help must not capture the mouse.');}},input:{reset(){calls.push('inputReset');}},editor:{hooks:{clearKeyboard(){calls.push('clearKeyboard');}}},voicePanel:{opened:true,close(){this.opened=false;calls.push('closeVoice');}}};let model={busy:false,phase:'idle',messages:[],results:[],tools:[]};
 const agent={ask:query=>calls.push(['ask',query]),stop:()=>calls.push('stop'),subscribe(callback){subscribers.add(callback);callback(model);return ()=>subscribers.delete(callback);}},emit=patch=>{model={...model,...patch};for(const callback of subscribers)callback(model);};const ui=new AssistantWorkspacePanel({document:dom,context:ctx,agent});ui.mount();return {ui,dom,ctx,agent,calls,emit,subscribers,header};
}
const button=(node,label)=>walk(node).find(value=>value.tagName==='button'&&value.textContent===label);

test('research URLs reject credential, local, IP, invalid-port and executable targets',()=>{
 for(const input of ['javascript:alert(1)','http://example.com','https://user:pass@example.com/','https://localhost/path','https://localhost./','https://router.local/','https://intranet/','https://127.0.0.1/','https://0x7f000001/','https://[::1]/','https://10.0.0.1/','https://public.example.com:8443/','https://example.com/with space'])assert.equal(safeResearchURL(input),null,input);
 assert.equal(safeResearchURL('https://docs.example.com/page?a=1'),'https://docs.example.com/page?a=1');
});
test('video embeds use fixed privacy domains and never forward arbitrary player parameters',()=>{
 assert.equal(videoEmbedURL('https://youtu.be/dQw4w9WgXcQ?autoplay=1'),'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=0&rel=0');assert.equal(videoEmbedURL('https://vimeo.com/12345678'),'https://player.vimeo.com/video/12345678?autoplay=0&dnt=1');
 for(const value of ['https://youtube.com.attacker.com/watch?v=dQw4w9WgXcQ','https://youtube.com/watch?v=bad','https://player.vimeo.com/video/not-numeric','https://example.com/video'])assert.equal(videoEmbedURL(value),null);
});
test('mount is closed, allocates no media and a drawer open releases world inputs without recapture',()=>{
 const f=fixture(),{ui,dom,ctx,calls}=f;assert.equal(ui.opened,false);assert.equal(ui.element.hidden,true);assert.equal(walk(dom.body).filter(node=>node.tagName==='iframe').length,0);assert.equal(calls.length,0);assert.equal(ui.launcher.parentNode,f.header);assert.equal(ui.open(),true);assert.equal(ctx.assistantPanelOpen,true);assert.equal(ctx.voicePanel.opened,false);assert(calls.includes('unlock')&&calls.includes('reset')&&calls.includes('clearKeyboard')&&calls.includes('inputReset'));assert.equal(dom.activeElement,ui.input);assert.equal(ui.launcher.getAttribute('aria-expanded'),'true');ui.close();assert.equal(ctx.assistantPanelOpen,false);assert.equal(dom.activeElement,ui.launcher);assert.equal(ui.element.hidden,true);ui.dispose();
});
test('typed requests and cancellation are explicit, bounded and contained from movement keys',()=>{
 const f=fixture(),{ui,calls}=f;ui.open();ui.input.value='Abre el nivel Almacén';const event=ui.form.fire('submit');assert(event.defaultPrevented&&event.stopped);assert.deepEqual(calls.at(-1),['ask','Abre el nivel Almacén']);assert.equal(ui.input.value,'');assert.equal(ui.input.fire('keydown',{key:'w'}).stopped,true);
 f.emit({busy:true,phase:'searching'});assert.equal(ui.sendButton.disabled,true);assert.equal(ui.stopButton.disabled,false);assert(ui.status.textContent.includes('Consultando'));ui.input.value='No debe salir';ui.form.fire('submit');assert.equal(calls.filter(row=>Array.isArray(row)&&row[0]==='ask').length,1);ui.stopButton.click();assert.equal(calls.at(-1),'stop');ui.dispose();
});
test('messages, tool progress and summaries remain inert text and only bounded recent history is rendered',()=>{
 const f=fixture(),attack='<img src=x onerror="alert(1)">';f.emit({messages:Array.from({length:60},(_,index)=>({role:index%2?'user':'assistant',text:index+':'+attack})),tools:[{name:'open_scene',status:'complete',message:attack}],results:[{type:'summary',title:attack,text:attack}]});assert.equal(f.ui.messages.children.length,48);assert(f.ui.messages.children[0].textContent.startsWith('Asistente12:'));assert.equal(walk(f.ui.element).some(node=>node.tagName==='img'||node.tagName==='script'),false);assert(f.ui.visuals.textContent.includes(attack));assert.equal(f.ui.toolList.hidden,false);f.ui.dispose();
});
test('sources start as inert cards; only a verified source can create an explicit isolated web frame',()=>{
 const f=fixture(),source={type:'source',title:'Documentación',url:'https://docs.example.com/guide',snippet:'Texto de la fuente',content:'Contenido relacionado',verified:true};f.emit({results:[source,{...source,title:'Sin verificar',url:'https://other.example.com/page',verified:false},{...source,url:'http://127.0.0.1/private'}]});assert.equal(f.ui.sources.children.length,2);assert.equal(f.ui.frames.size,0);button(f.ui.sources,'Leer aquí').click();assert(f.ui.reader.textContent.includes('Contenido relacionado'));assert.equal(f.ui.frames.size,0);
 button(f.ui.sources,'Vista web aislada').click();const frame=[...f.ui.frames][0];assert(frame);assert.equal(frame.src,source.url);assert.equal(frame.getAttribute('sandbox'),'allow-scripts');assert(!frame.getAttribute('sandbox').includes('same-origin'));assert.equal(frame.getAttribute('referrerpolicy'),'no-referrer');assert(frame.getAttribute('allow').includes("microphone 'none'"));assert.equal(f.ui.tab,'sources');assert.equal(walk(f.ui.sources).filter(node=>node.tagName==='button'&&node.textContent==='Vista web aislada').length,1);
 const link=walk(f.ui.reader).find(node=>node.tagName==='a');assert.equal(link.rel,'noopener noreferrer');frame.fire('error');assert(f.ui.status.textContent.includes('enlace original'));f.ui.close();assert.equal(f.ui.frames.size,0);assert.equal(frame.parentNode,null);f.ui.dispose();
});
test('the source reader refuses nesting SmartTwin itself and invisible pages unload external media',()=>{
 const f=fixture();assert.equal(f.ui.showSource({title:'Editor',url:'https://smarttwin.example.com/editor',verified:true},true),false);assert.equal(f.ui.frames.size,0);f.ui.showSource({title:'Fuente',url:'https://docs.example.com/page',verified:true},true);assert.equal(f.ui.frames.size,1);f.dom.hidden=true;f.dom.fire('visibilitychange');assert.equal(f.ui.frames.size,0);f.ui.dispose();
});
test('video frames load only on a deliberate action, use a fixed origin and are removed on close',()=>{
 const f=fixture();f.emit({results:[{type:'video',title:'Aprendizaje',url:'https://www.youtube.com/watch?v=dQw4w9WgXcQ'},{type:'video',title:'Otro proveedor',url:'https://media.example.com/lesson'}]});assert.equal(f.ui.frames.size,0);button(f.ui.visuals,'Ver vídeo aquí').click();const frame=[...f.ui.frames][0];assert(frame.src.startsWith('https://www.youtube-nocookie.com/embed/'));assert.equal(frame.getAttribute('sandbox'),'allow-scripts allow-presentation');assert(!frame.getAttribute('allow').includes('autoplay'));assert.equal(walk(f.ui.visuals).filter(node=>node.tagName==='button'&&node.textContent==='Ver vídeo aquí').length,1);f.ui.close();assert.equal(frame.parentNode,null);f.ui.dispose();
});
test('charts are finite data-only SVG plus a semantic table, preserving measured versus modelled origin',()=>{
 const f=fixture(),points=[{label:'A <script>run()</script>',value:-4},{label:'B',value:8},{label:'Bad',value:NaN}];f.emit({results:[{type:'chart',chartType:'bar',title:'Inventario',points,sourceKind:'measured',unit:'pallets'},{type:'chart',chartType:'line',title:'Proyección',points,sourceKind:'modelled'},{type:'chart',chartType:'table',title:'Tabla',points}]});assert.equal(walk(f.ui.visuals).filter(node=>node.tagName==='svg').length,2);assert.equal(walk(f.ui.visuals).filter(node=>node.tagName==='table').length,3);assert(f.ui.visuals.textContent.includes('Datos observados del simulador'));assert(f.ui.visuals.textContent.includes('no es una medición'));assert.equal(walk(f.ui.visuals).some(node=>node.tagName==='script'),false);for(const node of walk(f.ui.visuals))for(const [key,value]of node.attributes)assert(!/NaN|Infinity/.test(value),key+': '+value);f.ui.dispose();
});
test('malformed and oversized visual payloads cannot introduce code or unbounded drawings',()=>{
 assert.equal(normaliseVisual({type:'html',html:'<script>run()</script>'}),null);assert.equal(normaliseVisual({type:'chart',points:[{value:'2'},{value:Infinity}]}),null);const chart=normaliseVisual({type:'chart',points:Array.from({length:10000},(_,index)=>({label:'L'+index,value:index}))});assert.equal(chart.points.length,64);assert.doesNotThrow(()=>normaliseVisual({type:'chart',points:[{x:{toString:'bad'},value:1}]}));
});
test('tabs support keyboard navigation, expansion is explicit, and XR keeps the companion drawer closed',()=>{
 const f=fixture();f.ui.open();f.ui.tabs.conversation.fire('keydown',{key:'ArrowRight'});assert.equal(f.ui.tab,'sources');assert.equal(f.dom.activeElement,f.ui.tabs.sources);assert.equal(f.ui.panes.conversation.hidden,true);f.ui.expandButton.click();assert.equal(f.ui.expanded,true);assert.equal(f.ui.expandButton.getAttribute('aria-expanded'),'true');f.ctx.vrMode=true;f.ui.step();assert.equal(f.ui.opened,false);assert.equal(f.ui.launcher.hidden,true);assert.equal(f.ui.open(),false);f.ctx.vrMode=false;f.ui.step();assert.equal(f.ui.launcher.hidden,false);f.ui.dispose();
});
test('dispose releases subscriptions, media and listeners and stale controls cannot submit commands',()=>{
 const f=fixture(),button=f.ui.sendButton,input=f.ui.input,form=f.ui.form;f.ui.open();f.emit({results:[{type:'source',title:'Fuente',url:'https://docs.example.com/',verified:true}]});f.ui.showSource({title:'Fuente',url:'https://docs.example.com/',verified:true},true);const frame=[...f.ui.frames][0];f.ui.dispose();assert.equal(f.subscribers.size,0);assert.equal(frame.parentNode,null);assert.equal(f.ui.element,null);assert.equal(f.ctx.assistantPanelOpen,false);input.value='Do not execute';form.fire('submit');button.click();assert.equal(f.calls.some(row=>Array.isArray(row)&&row[0]==='ask'),false);const listeners=walk(f.dom).reduce((sum,node)=>sum+[...node.handlers.values()].reduce((n,list)=>n+list.length,0),0);assert.equal(listeners,0);
});
