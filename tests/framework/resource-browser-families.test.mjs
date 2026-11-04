import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),THREE=require('three'),catalog=require('../../modules/logistica-industrial/contracts/resourceCatalog.js');
const SOURCE=fs.readFileSync(new URL('../../packages/tools/editor/src/ResourceBrowser.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default class ResourceBrowser','class ResourceBrowser');
class Element{
 constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.style={};this.attributes={};this.listeners=new Map();this.className='';this.value='';this.scrollTop=0;this.scrollLeft=0;this.classList={add:(...names)=>{this.className=[...new Set(this.className.split(/\s+/).concat(names))].join(' ');},toggle:(name,force)=>{const names=new Set(this.className.split(/\s+/));if(force===undefined?!names.has(name):force)names.add(name);else names.delete(name);this.className=[...names].join(' ');},contains:name=>this.className.split(/\s+/).includes(name)};}
 set textContent(text){this.text=String(text);this.children.forEach(c=>c.parentNode=null);this.children=[];}get textContent(){return(this.text||'')+this.children.map(c=>c.textContent).join('');}
 appendChild(child){if(child.parentNode)child.parentNode.children=child.parentNode.children.filter(c=>c!==child);child.parentNode=this;this.children.push(child);return child;}
 setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return this.attributes[key];}
 addEventListener(key,fn){if(!this.listeners.has(key))this.listeners.set(key,[]);this.listeners.get(key).push(fn);}async fire(key,event={}){for(const fn of this.listeners.get(key)||[])await fn({preventDefault(){},stopPropagation(){},...event});}
 querySelectorAll(selector){const list=this.children.flatMap(c=>(selector.split(',').includes(c.tagName)?[c]:[]).concat(Array.from(c.querySelectorAll(selector))));return Object.assign({length:list.length,forEach:fn=>list.forEach(fn),[Symbol.iterator]:()=>list[Symbol.iterator]()},Object.fromEntries(list.map((value,index)=>[index,value])));}querySelector(selector){return this.querySelectorAll(selector)[0]||null;}focus(){}
}
const descendants=(root,attribute,value)=>Array.from(root.querySelectorAll('button,select,input,div,span,p,label,fieldset')).filter(n=>n.getAttribute(attribute)===(value===undefined?n.getAttribute(attribute):value)&&n.getAttribute(attribute)!==undefined);
const tick=()=>new Promise(resolve=>setImmediate(resolve)),waitPreview=()=>new Promise(resolve=>setTimeout(resolve,150));
function fixture(options={},stored=new Map()){
 const calls={placed:[],selected:[],docs:[],previews:[],cleaned:0,thumbs:[],constructed:0},library={instantiate(){calls.constructed++;return Promise.resolve(new THREE.Group());},preview(){return Promise.resolve(()=>calls.cleaned++);},previewModel(object,host,disposers){calls.previews.push(object);disposers.push(()=>calls.cleaned++);},cancelPreview(){}},thumbnails={library,reset(){},attach(entry){calls.thumbs.push(entry);}};
 const Browser=new Function('THREE','catalog','createIndustrialPrefab','document','window',SOURCE+'\nreturn ResourceBrowser;')(THREE,catalog,(kind,variant)=>{calls.constructed++;const object=new THREE.Group();object.userData={kind,variant};return object;},{createElement:tag=>new Element(tag)},{localStorage:{getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value)}});
 const browser=new Browser({host:new Element('section'),library,thumbnails,onPlace:(resource,settings)=>calls.placed.push({resource,settings}),onSelect:r=>calls.selected.push(r),onDocumentation:link=>calls.docs.push(link),...options});browser.setProject({id:'family-test'});browser.setActive(true);browser.render();return{browser,calls,stored};
}
const vehicle='library:vehicle.forklift',variant='library:vehicle.forklift-ic';

test('all library folders and searches present one card per real family, while project files and favorite IDs remain independent',async()=>{
 const {browser:b,calls}=fixture();const original=catalog.RESOURCES.map(r=>r.id),families=catalog.resourceFamilies.listFamilies(b.resources.filter(r=>r.origin==='library'));
 assert.equal(calls.constructed,0,'Listing never constructs a machine.');assert(b.cards.size<b.resources.length);
 const familyCards=descendants(b.grid,'data-resource-family');assert.equal(new Set(familyCards.map(n=>n.getAttribute('data-resource-family'))).size,families.length);
 for(const category of catalog.libraryTaxonomy.GROUPS.filter(group=>group.id!=='FILES')){b.state.folder='group:'+category.id;b.refresh();const ids=descendants(b.grid,'data-resource-family').map(n=>n.getAttribute('data-resource-family'));assert.equal(new Set(ids).size,ids.length,category.id);}
 b.state.folder='group:VE/forklifts';b.state.query='térmico';b.refresh();const expected=b.resources.find(r=>r.id===variant);assert(catalog.matches(expected,'térmico'));assert(b.cards.has(variant),'A matching technical variant is the actual selected family representative.');b.select(variant);await tick();assert.equal(descendants(b.preview,'data-resource-family-selector')[0].value,variant);assert.equal(b.previewSelection.id,variant);
 b.setEntries([{path:'a.glb',name:'Part.glb',importId:'a',kind:'model',extension:'glb'},{path:'b.glb',name:'Part.glb',importId:'b',kind:'model',extension:'glb'}]);b.refresh();b.openTab('project');assert.equal(b.cards.size,2,'Similar imported names never collapse into mechanical families.');
 await b.toggleFavorite(vehicle);await b.toggleFavorite(variant);b.openTab('favorites');assert(b.cards.has(vehicle)&&b.cards.has(variant));assert.equal(b.cards.size,2);assert.deepEqual(catalog.RESOURCES.map(r=>r.id),original);b.dispose();
});

test('changing a family variant refreshes its own preview, card thumbnail, add, drag and documentation without replacing an existing resource',async()=>{
 const {browser:b,calls}=fixture();b.select(vehicle);await tick();const previous=calls.previews.at(-1),selector=descendants(b.preview,'data-resource-family-selector')[0];assert(selector);selector.value=variant;await selector.fire('change');await tick();assert.equal(calls.selected.at(-1).id,variant);assert.equal(calls.previews.at(-1).userData.variant,'forklift-ic');assert.notEqual(calls.previews.at(-1),previous);assert.equal(calls.cleaned,1);assert(b.cards.has(variant));assert(calls.thumbs.some(t=>t.path==='studio-resource/'+variant));
 const add=descendants(b.preview,'data-resource-insert',variant)[0];await add.fire('click');assert.equal(calls.placed.at(-1).resource.id,variant);assert.equal(calls.placed.at(-1).resource.action.variant,'forklift-ic');
 const data=new Map();await b.cards.get(variant).fire('dragstart',{dataTransfer:{setData:(key,value)=>data.set(key,value)}});assert.equal(data.get('application/x-hello-studio-resource'),variant);b.dropEvent({dataTransfer:{getData:key=>data.get(key)||''},preventDefault(){}});assert.equal(calls.placed.at(-1).resource.id,variant);
 b._documentation(b.previewSelection);assert.equal(calls.docs.at(-1).resourceId,variant);assert(!b.organization.resources.length,'Choosing a family never edits placed instances or project organization.');b.dispose();
});

test('an explicit sibling choice clears an incompatible keyword and keeps its card, preview and insertion open',async()=>{
 const {browser:b,calls}=fixture();b.state.folder='group:VE/forklifts';b.state.query='termico';b.refresh();b.select(variant);await tick();
 assert.equal(b.previewSelection.id,variant);const selector=descendants(b.preview,'data-resource-family-selector')[0];selector.value=vehicle;await selector.fire('change');await tick();
 assert.equal(b.state.query,'');assert.equal(b.search.value,'');assert.equal(b.state.folder,'group:VE/forklifts');assert.equal(b.previewSelection.id,vehicle);assert.equal(b.previewResource,vehicle);assert(b.cards.has(vehicle));
 const add=descendants(b.preview,'data-resource-insert',vehicle)[0];assert(add&&!add.disabled);await add.fire('click');assert.equal(calls.placed.at(-1).resource.id,vehicle);assert.equal(calls.placed.at(-1).resource.action.variant,'forklift-electric-4w');b.dispose();
});

test('a sibling outside the active category remains unavailable instead of closing the selected sheet',async()=>{
 const {browser:b}=fixture();b.state.folder='group:RO/mobile';b.refresh();const current='catalogue:equipment.mobile.amr-platform';b.select(current);await tick();
 const selector=descendants(b.preview,'data-resource-family-selector')[0],outside='library:vehicle.mobile',option=Array.from(selector.querySelectorAll('option')).find(row=>row.value===outside);assert(option&&option.disabled,'The legacy AMR has no exact robot-category membership.');
 selector.value=outside;await selector.fire('change');await tick();assert.equal(b.state.folder,'group:RO/mobile');assert.equal(b.previewSelection.id,current);assert.equal(selector.value,current);b.dispose();
});

test('supported native parameter drafts rebuild one configured preview and pass exact validated values to add and same-scene drop',async()=>{
 const created=[],{browser:b,calls}=fixture({getResourceConfiguration:r=>r.id===vehicle?{fields:[{key:'width',label:'Ancho',type:'number',min:.5,max:3,step:.1},{key:'withPanel',label:'Panel',type:'checkbox'},{key:'finish',label:'Acabado',type:'select',options:[{value:'steel',label:'Acero'},{value:'paint',label:'Pintura'}]}],values:{width:1,withPanel:true,finish:'paint'}}:{fields:[],values:{}},createConfiguredPrefab:(resource,parameters)=>{const group=new THREE.Group();group.userData={resourceId:resource.id,parameters};created.push(group);return group;}});b.select(vehicle);await tick();assert.equal(created.length,1);
 const width=descendants(b.preview,'data-resource-parameter','width')[0];width.value='1.8';await width.fire('change');await waitPreview();assert.equal(created.length,2);assert.equal(created.at(-1).userData.parameters.width,1.8);assert.equal(calls.cleaned,1,'The previous preview is retired before replacing it.');
 await descendants(b.preview,'data-resource-insert',vehicle)[0].fire('click');assert.deepEqual(calls.placed.at(-1).settings.parameters,{width:1.8,withPanel:true,finish:'paint'});
 const data=new Map();await b.cards.get(vehicle).fire('dragstart',{dataTransfer:{setData:(key,value)=>data.set(key,value)}});const preset=JSON.parse(data.get('application/x-smarttwin-resource-preset'));assert.equal(preset.resourceId,vehicle);assert.equal(preset.projectId,'family-test');b.dropEvent({dataTransfer:{getData:key=>data.get(key)||''},preventDefault(){}});assert.equal(calls.placed.at(-1).settings.parameters.width,1.8);
 b.select(variant);await tick();assert.equal(descendants(b.preview,'data-resource-parameter').length,0,'Unavailable fields are never manufactured for another variant.');b.setProject({id:'different-project'});b.render();assert.equal(b.configurationDrafts.size,0);b.dispose();
});

test('invalid fields, forged drag parameters, other scenes and revoked permissions cannot insert a configured resource',async()=>{
 let allowed=true;const messages=[],{browser:b,calls}=fixture({canInsert:()=>allowed,onMessage:text=>messages.push(text),getResourceConfiguration:r=>r.id===vehicle?{fields:[{key:'width',label:'Ancho',type:'number',min:.5,max:3}],values:{width:1}}:{fields:[],values:{}}});b.select(vehicle);await tick();const width=descendants(b.preview,'data-resource-parameter','width')[0];width.value='999';await width.fire('change');assert(descendants(b.preview,'data-resource-insert',vehicle)[0].disabled);assert.equal(b.place(b.previewSelection),false);assert.equal(calls.placed.length,0);let prevented=false;await b.cards.get(vehicle).fire('dragstart',{preventDefault(){prevented=true;},dataTransfer:{setData(){assert.fail('Invalid drafts cannot start a drag.');}}});assert(prevented);
 width.value='1.2';await width.fire('change');await waitPreview();assert(!descendants(b.preview,'data-resource-insert',vehicle)[0].disabled);
 const drop=preset=>b.dropEvent({preventDefault(){},dataTransfer:{getData:type=>type==='application/x-hello-studio-resource'?vehicle:type==='application/x-smarttwin-resource-preset'?JSON.stringify(preset):''}}),valid={version:1,resourceId:vehicle,projectId:b.projectId,roomId:b.sceneRoomId,parameters:{width:1.2}};
 for(const preset of [{...valid,projectId:'other'},{...valid,roomId:'other'},{...valid,resourceId:variant},{...valid,parameters:{width:4}},{...valid,parameters:{width:true}},{...valid,parameters:{width:1,action:'arbitrary'}},{...valid,parameters:JSON.parse('{"width":1,"__proto__":{}}')}])drop(preset);
 assert.equal(calls.placed.length,0);drop(valid);assert.equal(calls.placed.length,1);allowed=false;drop(valid);assert.equal(calls.placed.length,1);assert(messages.length>=8);b.dispose();
});

test('late configured preview work is disposed after a project changes, and vertical category context survives refresh and tab switching',async()=>{
 let resolve;const {browser:b,calls,stored}=fixture({createConfiguredPrefab:()=>new Promise(done=>resolve=done)});b.select(vehicle);assert(resolve);b.folderList.scrollLeft=173;b.folderList.scrollTop=29;await b.folderList.fire('scroll');b.refresh();assert.equal(b.folderList.scrollLeft,0,'The obsolete horizontal rail offset is cleared.');assert.equal(b.folderList.scrollTop,29);b.openTab('project');b.openTab('library');assert.equal(b.folderList.scrollLeft,0);assert.equal(b.folderList.scrollTop,29);
 b.setProject({id:'second-project'});b.render();let disposed=0;const object=new THREE.Group(),geometry=new THREE.BoxBufferGeometry(1,1,1);geometry.addEventListener('dispose',()=>disposed++);object.add(new THREE.Mesh(geometry,new THREE.MeshStandardMaterial()));resolve(object);await tick();assert.equal(disposed,1);assert.equal(b.previewResource,null);assert.equal(calls.cleaned,1);b.dispose();const restored=fixture({},stored);assert.equal(restored.browser.state.navScrollX,0);assert.equal(restored.browser.state.navScroll,29);restored.browser.dispose();
});

test('resource preview cleanup releases private geometry and textures while retaining the shared industrial atlas',async()=>{
 const shared=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1),owned=new THREE.DataTexture(new Uint8Array([128,128,128,255]),1,1);shared.userData={sharedIndustrialTexture:true};let sharedDisposals=0,ownedDisposals=0,geometryDisposals=0;shared.addEventListener('dispose',()=>sharedDisposals++);owned.addEventListener('dispose',()=>ownedDisposals++);
 const {browser:b}=fixture({createConfiguredPrefab:()=>{const group=new THREE.Group(),geometry=new THREE.BoxBufferGeometry(1,1,1);geometry.addEventListener('dispose',()=>geometryDisposals++);group.add(new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({map:shared,roughnessMap:owned})));return group;}});b.select(vehicle);await tick();b.clearPreview();assert.equal(sharedDisposals,0);assert.equal(ownedDisposals,1);assert.equal(geometryDisposals,1);b.dispose();shared.dispose();
});

test('native dependent validation blocks add and canceled refreshes never conceal an invalid field',async()=>{
 const {browser:b,calls}=fixture({getResourceConfiguration:r=>r.id===vehicle?{fields:[{key:'width',label:'Ancho',type:'number',min:.5,max:3},{key:'length',label:'Largo',type:'number',min:1,max:5}],values:{width:1,length:2}}:{fields:[],values:{}},normalizeResourceConfiguration:(resource,values)=>{if(resource.id===vehicle&&values.width>values.length)throw Error('El ancho supera el largo admitido.');}});b.select(vehicle);await tick();const width=descendants(b.preview,'data-resource-parameter','width')[0],length=descendants(b.preview,'data-resource-parameter','length')[0];width.value='1.1';await width.fire('change');width.value='999';await width.fire('change');length.value='3';await length.fire('change');await waitPreview();assert.equal(width.value,'999');assert(descendants(b.preview,'data-resource-insert',vehicle)[0].disabled);assert.equal(calls.previews.length,1,'A previously scheduled valid rebuild cannot erase the invalid form.');width.value='2.5';length.value='2';await length.fire('change');await width.fire('change');assert.equal(b.place(b.previewSelection),false);assert.equal(calls.placed.length,0);width.value='1.5';await width.fire('change');assert.equal(b.place(b.previewSelection),true);b.dispose();
});

test('native configuration factories are not used for primitive and studio presentation resources',async()=>{
 const {browser:b,calls}=fixture({getResourceConfiguration:()=>({fields:[],values:{}}),createConfiguredPrefab:()=>{throw Error('Only native equipment accepts this factory.');}});b.select('library:environment.floor');await tick();assert.equal(calls.previews.length,1);assert(calls.previews[0].isMesh);assert(!b.preview.textContent.includes('Only native equipment'));b.dispose();
});
