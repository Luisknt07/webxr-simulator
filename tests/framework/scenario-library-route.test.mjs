import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'../..'),routes=require('../../apps/workspace/PlayRoute.cjs'),progressSchema=require('../../modules/logistica-industrial/practices/schema/PracticeProgress.cjs'),sessionSchema=require('../../modules/logistica-industrial/practices/schema/PracticeSession.cjs'),recipes=require('../../modules/logistica-industrial/practices/configurable/Recipes.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class Element{
 constructor(){this.children=[];this.attributes={};this.listeners=new Map();this.hidden=false;}
 set textContent(value){this.text=String(value);this.children=[];}get textContent(){return(this.text||'')+this.children.map(child=>child.textContent).join('');}
 appendChild(child){child.parentNode=this;this.children.push(child);return child;}setAttribute(k,v){this.attributes[k]=String(v);}getAttribute(k){return this.attributes[k];}addEventListener(k,fn){this.listeners.set(k,fn);}removeEventListener(k){this.listeners.delete(k);}remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(child=>child!==this);}
}
const source=fs.readFileSync(path.join(root,'apps/workspace/src/ScenarioLibraryPage.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default class ScenarioLibraryPage','class ScenarioLibraryPage');
const Page=new Function('StudioClient','progressSchema','sessionSchema','recipes','routes',source+'\nreturn ScenarioLibraryPage;')(class{},progressSchema,sessionSchema,recipes,routes);
function fixture(options={}){
 const elements=new Map(['scenario-library-content','scenario-library-status','scenario-library-account','scenario-library-logout','editor'].map(id=>[id,new Element()])),listeners=new Map(),navigations=[],requests=[],instances=[];let user={id:'alice',displayName:'Alicia',permissions:{editor:true}},meHook=options.meHook,progressHook=options.progressHook;
 const document={documentElement:new Element(),body:new Element(),getElementById:id=>elements.get(id),querySelector:()=>elements.get('editor'),createElement:()=>new Element()},window={location:{origin:'https://private.invalid',assign:url=>navigations.push(url)},addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:key=>listeners.delete(key)};
 const client={user:null,async me(){if(meHook)await meHook();this.user=user;requests.push({method:'GET',path:'/me'});return{user};},async request(method,url){requests.push({method,path:url});if(progressHook)await progressHook();return{progress:user?progressSchema.empty(user.id):null};},async logout(){requests.push({method:'POST',path:'/logout'});this.user=null;user=null;}};
 class Browser{constructor(host,config){this.config=config;this.records=Array(10).fill({});this.root=new Element();host.appendChild(this.root);this.ready=Promise.resolve(true);this.disposed=false;instances.push(this);}dispose(){this.disposed=true;this.root.remove();}}
 const page=new Page({document,window,client,loadBrowser:options.loadBrowser||(()=>Promise.resolve({default:Browser}))});
 return{page,client,requests,navigations,instances,listeners,elements,document,setUser:value=>{user=value;},setMeHook:value=>{meHook=value;}};
}
test('the HTTP route requires a concrete selection, not a filter or empty/unsafe identifier',()=>{
 for(const query of ['', '?domain=logistics','?mode=manual&settings=%7B%7D','?scene=','?practice=%3Cscript%3E','?scene=../../secret'])assert.equal(routes.playEntry(new URLSearchParams(query)),'catalogue.html',query);
 for(const query of ['?practice=CEDI-01','?scene=vr-robot-dispatch','?libraryScene=vr-robot-transfer','?project=f513b592-420b-494d-8215-fceab98052ce'])assert.equal(routes.playEntry(new URLSearchParams(query)),'index.html',query);
 const url=new URL(routes.practiceURL('https://private.invalid','CEDI-01',{mode:'manual',caseId:'A',difficulty:1}));assert.equal(url.pathname,'/play');assert.equal(url.searchParams.get('practice'),'CEDI-01');assert.equal(JSON.parse(url.searchParams.get('settings')).caseId,'A');assert.throws(()=>routes.practiceURL('https://private.invalid','../private',{}));
});
test('loading the full page consults identity/progress and creates only the catalogue, never an attempt',async()=>{
 const f=fixture();assert.equal(await f.page.ready,true);assert.deepEqual(f.requests.map(row=>row.path),['/me','/practices/progress']);assert.equal(f.instances.length,1);const browser=f.instances[0];assert.equal(browser.config.presentation,'page');assert.equal(browser.config.navigation,'external');assert.equal(browser.config.isAvailable(),true);assert.equal(f.elements.get('scenario-library-account').textContent,'Alicia');assert.equal(f.elements.get('editor').hidden,false);assert.equal(f.navigations.length,0);f.page.dispose();assert(browser.disposed);
});
test('explicit start preserves the full normalized configuration and leaves attempt creation to the execution host',async()=>{
 const f=fixture();await f.page.ready;const callback=f.instances[0].config.onStart;
 await assert.rejects(()=>callback('CEDI-02',{mode:'manual',caseId:'A',difficulty:1}),/CEDI-01/);assert.equal(f.navigations.length,0);
 await callback('CEDI-01',{mode:'manual',caseId:'A',difficulty:1});const url=new URL(f.navigations[0]);assert.equal(url.origin,'https://private.invalid');assert.equal(url.pathname,'/play');assert.equal(url.searchParams.get('practice'),'CEDI-01');assert.equal(JSON.parse(url.searchParams.get('settings')).executionMode,'campaign');assert.equal(f.requests.some(row=>row.method==='POST'),false);f.page.dispose();
});
test('a captured start cannot execute after account replacement or expired authentication',async()=>{
 const f=fixture();await f.page.ready;const stale=f.instances[0].config.onStart;f.setUser({id:'bob',permissions:{editor:false}});await assert.rejects(()=>stale('CEDI-01',{}),/sesión|cuenta/i);assert.equal(f.page.disposed,true);assert.equal(f.instances[0].disposed,true);assert.equal(f.navigations.length,0);assert.equal(f.elements.get('scenario-library-account').textContent,'');f.page.dispose();
 const missing=fixture();await missing.page.ready;missing.setUser(null);await missing.page.verifySession();assert.equal(missing.page.disposed,true);missing.page.dispose();
});
test('a late catalogue/progress load cannot resurrect a document retired during navigation',async()=>{
 let release;const pending=new Promise(resolve=>{release=resolve;}),f=fixture({progressHook:()=>pending});await tick();f.listeners.get('pagehide')({persisted:true});release();assert.equal(await f.page.ready,false);assert.equal(f.instances.length,0);assert.equal(f.elements.get('scenario-library-content').children.length,0);f.page.dispose();
});
test('browser Back restores one freshly authenticated catalogue and old callbacks stay revoked',async()=>{
 const f=fixture();await f.page.ready;const old=f.instances[0],callback=old.config.onStart;f.listeners.get('pagehide')({persisted:true});assert(old.disposed);f.listeners.get('pageshow')({persisted:true});await f.page.ready;assert.equal(f.instances.length,2);assert.equal(f.instances[1].config.isAvailable(),true);assert.equal(old.config.isAvailable(),false);await assert.rejects(()=>callback('CEDI-01',{}),/cuenta/);assert.equal(f.navigations.length,0);assert.equal(f.requests.filter(row=>row.path==='/me').length,2);f.page.dispose();
});
test('the real campaign navigation leaves the renderer document; editor drafts and immersive menus retain their native boundary',()=>{
 const assignments=[],opened=[],menus=[],window={location:{origin:'https://private.invalid',assign:url=>assignments.push(url)},open:(...args)=>opened.push(args)};
 const source=fs.readFileSync(path.join(root,'modules/logistica-industrial/practices/runtime/PracticeCampaignHost.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default class PracticeCampaignHost','class PracticeCampaignHost'),Host=new Function('window',source+'\nreturn PracticeCampaignHost;')(window);
 const fixture={editor:{editorEnabled:false,ctx:{vrMode:false}},studio:{open:page=>menus.push(page)}};Host.prototype.openCatalogue.call(fixture);assert.deepEqual(assignments,['https://private.invalid/play']);assert.equal(menus.length,0);
 fixture.editor.editorEnabled=true;Host.prototype.openCatalogue.call(fixture);assert.deepEqual(opened,[['https://private.invalid/play','_blank','noopener']]);assert.equal(assignments.length,1,'An author keeps the existing project document.');
 fixture.editor.editorEnabled=false;fixture.editor.ctx.vrMode=true;Host.prototype.openCatalogue.call(fixture);assert.deepEqual(menus,['scenes']);
});
test('an explicit scene opens directly, and the real desktop menu opens the independent catalogue instead of a modal over 3D',async()=>{
 const location=new URL('https://private.invalid/play?scene=vr-robot-dispatch'),source=fs.readFileSync(path.join(root,'apps/workspace/studio/StudioExperience.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default class StudioExperience','class StudioExperience'),Experience=new Function('window',source+'\nreturn StudioExperience;')({location});
 const opened=[],f={client:{},editor:{initialIdentity:Promise.resolve({user:{id:'alice'}}),document:{studio:{}},ready:Promise.resolve(),editorEnabled:false},ctx:{room:0},identity(){},tools:{refreshLabels(){}},education:{async restoreProgress(){}},applySpawn(){},open:page=>opened.push(page)};
 await Experience.prototype.initialize.call(f);assert.deepEqual(opened,[],'Scene selection must not immediately cover itself with a second catalogue.');
 let navigated=0;f.practiceCampaign={openCatalogue:()=>++navigated};Experience.prototype.open.call(f,'scenes');assert.equal(navigated,1);assert.deepEqual(opened,[]);
});
test('the catalogue entry dependency closure contains no renderer, world, scene compiler or 3D assets',()=>{
 const visited=new Set(),walk=file=>{if(visited.has(file))return;visited.add(file);const source=fs.readFileSync(file,'utf8');const expression=/(?:\bfrom\s*|\bimport\s*\(\s*(?:\/\*[^]*?\*\/\s*)?|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;let match;while((match=expression.exec(source))){const name=match[1];assert.notEqual(name,'three',file);if(!name.startsWith('.'))continue;const target=path.resolve(path.dirname(file),name);assert(!/\.(glb|gltf|obj|fbx|wasm)$/i.test(target));if(/\.(js|mjs|cjs)$/.test(target))walk(target);}};walk(path.join(root,'apps/workspace/src/scenario-library.js'));const paths=[...visited].map(file=>path.relative(root,file).replaceAll('\\','/'));assert(paths.some(name=>name.endsWith('PracticeBrowser.js')));assert(paths.some(name=>name.endsWith('DocumentationBrowser.js')));assert(paths.every(name=>!/src\/index.js|BrowserHost|PracticeSceneBuilder|SceneEditor|SimulationRuntime|IndustrialPrefabs|render-three/.test(name)),paths.join('\n'));
 const html=fs.readFileSync(path.join(root,'apps/workspace/catalogue.html'),'utf8');assert.match(html,/scenario-library.js/);assert.doesNotMatch(html,/bundle.js|StartupStatus|<canvas|\.glb|rel="(?:module)?preload"/i);
});
