import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../../apps/public-viewer/index.html',import.meta.url),'utf8');
const main=fs.readFileSync(new URL('../../apps/public-viewer/main.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');

function fixture(configuration={},baseURI='https://studio.example/'){
 const errors=[],navigationCalls=[],assignments=[],elements=new Map();let galleryOptions,creates=0;
 const element=tag=>({tagName:tag.toUpperCase(),children:[],listeners:new Map(),attributes:new Map(),classList:{add(){},remove(){},toggle(){}},hidden:false,open:false,textContent:'',
  append(...rows){this.children.push(...rows);},appendChild(row){this.children.push(row);return row;},setAttribute(key,value){this.attributes.set(key,String(value));},removeAttribute(key){this.attributes.delete(key);},
  addEventListener(key,callback){if(!this.listeners.has(key))this.listeners.set(key,[]);this.listeners.get(key).push(callback);},
  showModal(){this.open=true;},close(){this.open=false;for(const callback of this.listeners.get('close')||[])callback({});},remove(){this.removed=true;},focus(){},
  async click(){const event={preventDefault(){this.defaultPrevented=true;}};for(const callback of this.listeners.get('click')||[])await callback(event);return event;}});
 for(const match of html.matchAll(/<([a-z]+)\b[^>]*\bid="([^"]+)"[^>]*>/g)){const node=element(match[1]);node.id=match[2];const href=match[0].match(/\bhref="([^"]*)"/);if(href)node.href=href[1];elements.set(node.id,node);}
 const brand=element('a'),body=element('body');
 const document={baseURI,body,getElementById:id=>{assert(elements.has(id),'The actual HTML must contain '+id);return elements.get(id);},querySelector:selector=>selector==='.viewer-brand'?brand:null,createElement:tag=>element(tag)};
 const window={SMARTTWIN_PUBLIC_VIEWER_CONFIG:configuration,location:{hash:'',origin:new URL(baseURI).origin,assign:url=>assignments.push(url)},history:{pushState(){},replaceState(){}},addEventListener(){}};
 const gallery={ready:Promise.resolve(),getStats:()=>({}),hide(){},show(){},setStatus:message=>errors.push(message),dispose(){}};
 const mountGallery=options=>{galleryOptions=options;return gallery;};
 const createWelcomeNavigation=options=>{creates++;return{getStats:()=>({screen:'welcome'}),restore:async()=>{},gallery:async()=>{navigationCalls.push('gallery');},home:async()=>{navigationCalls.push('home');},openDemo:async()=>{navigationCalls.push('demo');},dispose:async()=>{}};};
 const noNetwork=()=>{throw Error('Welcome controls must not request scenes, accounts or a private editor.');};
 new Function('document','window','mountGallery','createWelcomeNavigation','console','fetch',main)(document,window,mountGallery,createWelcomeNavigation,{error:(...rows)=>errors.push(rows)},noNetwork);
 return{elements,document,window,errors,navigationCalls,assignments,get galleryOptions(){return galleryOptions;},get creates(){return creates;}};
}

test('the public welcome keeps a real editor CTA and a separately packaged welcome stylesheet',()=>{
 assert.match(html,/<link\b[^>]*href="welcome\.css"/);assert.match(html,/<a\b[^>]*id="editor-access"[^>]*>[\s\S]*?Ir al editor[\s\S]*?<\/a>/);
 assert.match(html,/<button\b[^>]*id="explore-scenes"/);assert.match(html,/Cinco procesos de CEDI y cinco de Smart Factory/);
});

test('server exploration opens the independent catalogue through login, without preselecting a 3D scene',async()=>{
 const f=fixture({backendAvailable:true,apiOrigin:'https://studio.example'});assert.deepEqual(f.errors,[]);assert.equal(f.creates,1);assert.deepEqual(f.navigationCalls,[],'Welcome setup does not open the 3D scene.');
 const editor=f.elements.get('editor-access'),login=new URL(editor.href);assert.equal(login.origin,'https://studio.example');assert.equal(login.pathname,'/login');assert.equal(login.searchParams.get('next'),'/editor');
 f.galleryOptions.onStateChange({user:null,backend:'https://studio.example'});assert.equal(new URL(editor.href).pathname,'/login');await f.elements.get('explore-scenes').click();assert.deepEqual(f.navigationCalls,[]);assert.deepEqual(f.assignments,['https://studio.example/login?next=%2Fplay']);
 f.galleryOptions.onStateChange({user:{id:'temporary-viewer'},backend:'https://studio.example'});assert.equal(editor.href,'https://studio.example/editor');assert.equal(f.elements.get('workspace-link').href,'https://studio.example/play');
 await f.elements.get('explore-scenes').click();assert.deepEqual(f.assignments,['https://studio.example/login?next=%2Fplay','https://studio.example/play']);assert.deepEqual(f.navigationCalls,[],'Opening the catalogue must not start the public demo.');
});

test('static hosting opens the actual access explanation instead of requesting a private editor or API',async()=>{
 const f=fixture({backendAvailable:false},'https://example.github.io/webxr-simulator/');assert.deepEqual(f.errors,[]);assert.equal(f.elements.get('editor-access').href,'#workspace-access');
 const event=await f.elements.get('editor-access').click();assert.equal(event.defaultPrevented,true);const dialog=f.document.body.children.find(node=>node.id==='workspace-access');assert(dialog&&dialog.open);assert(dialog.children.some(node=>node.textContent.includes('servidor privado')));
 assert.deepEqual(f.assignments,[]);assert.deepEqual(f.navigationCalls,[]);await f.elements.get('explore-scenes').click();assert.deepEqual(f.navigationCalls,['gallery']);
});
