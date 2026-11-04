import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),catalog=require('../../modules/logistica-industrial/contracts/resourceCatalog.js');
const source=fs.readFileSync(new URL('../../packages/tools/editor/src/ResourceBrowser.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default class ResourceBrowser','class ResourceBrowser');
class Element{
 constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.style={};this.attributes={};this.listeners=new Map();this.className='';this.value='';this.scrollTop=0;this.scrollLeft=0;this.classList={add:(...names)=>{this.className=[...new Set(this.className.split(/\s+/).concat(names))].join(' ');},toggle:(name,force)=>{const names=new Set(this.className.split(/\s+/));if(force===undefined?!names.has(name):force)names.add(name);else names.delete(name);this.className=[...names].join(' ');},contains:name=>this.className.split(/\s+/).includes(name)};}
 set textContent(text){this.text=String(text);this.children.forEach(c=>c.parentNode=null);this.children=[];}get textContent(){return(this.text||'')+this.children.map(c=>c.textContent).join('');}
 appendChild(child){if(child.parentNode)child.parentNode.children=child.parentNode.children.filter(c=>c!==child);child.parentNode=this;this.children.push(child);return child;}
 setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return this.attributes[key];}
 addEventListener(key,fn){if(!this.listeners.has(key))this.listeners.set(key,[]);this.listeners.get(key).push(fn);}async fire(key,event={}){for(const fn of this.listeners.get(key)||[])await fn({target:this,preventDefault(){},stopPropagation(){},...event});}
 querySelectorAll(selector){const matches=node=>selector.startsWith('.')?selector.slice(1).split('.').every(name=>node.classList.contains(name)):selector.split(',').includes(node.tagName);return this.children.flatMap(c=>(matches(c)?[c]:[]).concat(c.querySelectorAll(selector)));}querySelector(selector){return this.querySelectorAll(selector)[0]||null;}focus(){this.focused=true;}scrollIntoView(){this.revealed=(this.revealed||0)+1;}
}
function fixture(width=640,stored=new Map()){
 const listeners=new Map(),doc={createElement:tag=>new Element(tag),addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:(key,fn)=>{if(listeners.get(key)===fn)listeners.delete(key);}},window={localStorage:{getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value)}};
 const Browser=new Function('catalog','document','window',source+'\nreturn ResourceBrowser;')(catalog,doc,window),host=new Element('section');host.clientWidth=width;
 const browser=new Browser({host,library:{cancelPreview(){}}});browser.setProject({id:'navigation-tree-test'});browser.setActive(true);browser.render();return{browser,listeners,stored};
}
const find=(root,attribute,value)=>root.querySelectorAll('details,summary,button').find(row=>row.getAttribute(attribute)===value);

test('the full library uses one vertical semantic tree with real paths and native branch summaries',()=>{
 const {browser:b}=fixture();assert.equal(b.categoryPicker.tagName,'details');assert.equal(b.categoryPickerSummary.tagName,'summary');assert.equal(b.categoryPicker.open,true);assert.equal(b.host.getAttribute('data-navigation-mode'),'tree');assert.equal(b.folderList.parentNode,b.categoryPicker);assert.equal(b.subfamilyList.hidden,true);assert.equal(b.subfamilyList.children.length,0);
 const nodes=b.folderList.querySelectorAll('details'),branch=find(b.folderList,'data-library-node','branch:TR/continuous');assert(branch);assert.equal(branch.children[0].tagName,'summary');assert(branch.children[1].classList.contains('studio-library-tree-children'));
 for(const row of nodes)assert.equal(row.children[0].tagName,'summary');for(const group of catalog.libraryTaxonomy.GROUPS){const records=b.resources.filter(resource=>resource.origin==='library'&&catalog.libraryTaxonomy.matchesPath(resource,'group:'+group.id));if(records.length)assert(find(b.folderList,'data-library-category',group.id));}
 assert(find(b.folderList,'data-library-path','group:TR/straight'));assert(find(b.folderList,'data-library-path','group:AL/palletized'));assert.equal(b.resources.length,catalog.RESOURCES.length);b.dispose();
});

test('compact category selection closes its picker, focuses its summary and preserves the exact filter and families',async()=>{
 const {browser:b}=fixture(340);assert.equal(b.categoryPicker.open,false);assert.equal(b.host.getAttribute('data-navigation-mode'),'compact');b.categoryPicker.open=true;
 await find(b.folderList,'data-library-path','group:AL/palletized').fire('click');assert.equal(b.state.folder,'group:AL/palletized');assert(b.cards.has('library:storage.rack'));assert.equal(b.categoryPicker.open,false);assert(b.categoryPickerSummary.focused);assert.equal(b.categoryPickerCurrent.textContent,catalog.libraryTaxonomy.title('group:AL/palletized'));assert(b.grid.querySelectorAll('h3').length);assert.equal(b.folderList.scrollLeft,0);b.dispose();
});

test('Escape and outside pointer close only the compact picker; choosing category keeps the tree open for a subcategory',async()=>{
 const {browser:b,listeners}=fixture(480);b.categoryPicker.open=true;await find(b.folderList,'data-library-category','VE').fire('click');assert.equal(b.state.folder,'group:VE');assert.equal(b.categoryPicker.open,true);
 listeners.get('pointerdown')({target:b.categoryPickerCurrent});assert.equal(b.categoryPicker.open,true);listeners.get('pointerdown')({target:new Element('input')});assert.equal(b.categoryPicker.open,false);
 b.categoryPicker.open=true;let prevented=0;await b.categoryPicker.fire('keydown',{key:'Escape',preventDefault(){prevented++;}});assert.equal(prevented,1);assert.equal(b.categoryPicker.open,false);assert(b.categoryPickerSummary.focused);
 b.host.clientWidth=640;b._syncNavigationLayout();listeners.get('pointerdown')({target:new Element('input')});assert.equal(b.categoryPicker.open,true,'The desktop tree remains part of the layout.');b.dispose();
});

test('resizing never creates a horizontal rail or loses a filter and preserves deliberate compact expansion',()=>{
 const {browser:b}=fixture();b.state.folder='group:VE/forklifts';b.refresh();b.host.clientWidth=560;b._syncNavigationLayout();assert.equal(b.categoryPicker.open,false);b.categoryPicker.open=true;b._syncNavigationLayout(true);assert.equal(b.categoryPicker.open,true);b.host.clientWidth=340;b._syncNavigationLayout();assert.equal(b.categoryPicker.open,true,'Resizing within compact mode retains its explicit open state.');b.host.clientWidth=800;b._syncNavigationLayout();assert.equal(b.categoryPicker.open,true);assert.equal(b.state.folder,'group:VE/forklifts');assert.equal(b.folderList.scrollLeft,0);b.dispose();
});

test('branch expansion is persisted, expand/collapse covers descendants, and disposed observers and listeners stay inert',async()=>{
 const first=fixture(),b=first.browser,branch=find(b.folderList,'data-library-node','branch:TR/continuous');branch.open=true;await branch.fire('toggle');assert.equal(b.state.expanded['branch:TR/continuous'],true);b._expandLibrary(false);assert.equal(b.state.expanded['branch:TR/continuous'],false);b._expandLibrary(true);assert.equal(b.state.expanded['branch:TR/continuous'],true);b.dispose();assert.equal(first.listeners.size,0);
 const restored=fixture(640,first.stored);assert.equal(find(restored.browser.folderList,'data-library-node','branch:TR/continuous').open,true);restored.browser.openTab('project');assert.equal(restored.browser.categoryPickerLabel.textContent,'Carpetas del proyecto');restored.browser.openTab('favorites');assert.equal(restored.browser.categoryPickerLabel.textContent,'Origen de favoritos');let disconnected=0;restored.browser.navigationObserver={disconnect(){disconnected++;}};restored.browser.dispose();restored.browser._syncNavigationLayout(true);restored.browser.dispose();assert.equal(disconnected,1);assert.equal(restored.listeners.size,0);
});
