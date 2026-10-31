import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectSession} from '../../packages/core/project-session.js';
import {renderModuleManager, parseSessionDocument, mountProjectTransfer} from '../../apps/project-viewer/modules.mjs';

class Element {
  constructor(tag) {this.tagName=tag;this.children=[];this.handlers=new Map();this.dataset={};this._text='';}
  set textContent(value){this._text=value;this.children=[];}get textContent(){return this._text;}
  get firstChild(){return this.children[0]||null;}
  appendChild(child){child.parentNode=this;this.children.push(child);return child;}
  append(...children){children.forEach(child=>this.appendChild(child));}
  removeChild(child){this.children=this.children.filter(row=>row!==child);child.parentNode=null;}
  remove(){if(this.parentNode)this.parentNode.removeChild(this);}
  addEventListener(name,handler){this.handlers.set(name,handler);}removeEventListener(name,handler){if(this.handlers.get(name)===handler)this.handlers.delete(name);}
  click(){if(!this.disabled)return this.handlers.get('click')?.();}
}
const document={createElement:tag=>new Element(tag)};
const walk=node=>[node,...node.children.flatMap(walk)];
const project={format:'smarttwin.project',version:1,id:'project.ui',worldId:'world.ui',modules:[{id:'sector.demo',version:'1.0.0',functions:['demo.feature']}],entities:[]};
const manifest={id:'demo.feature',version:'1.0.0',metadata:{title:'Función de prueba'}};
const catalog=[{id:'sector.demo',version:'1.0.0',metadata:{title:'Sector de prueba'},functions:[{...manifest,load:async()=>({...manifest,register(scope){scope.register('commands','set',input=>scope.state.set(input));scope.register('commands','read',()=>scope.state.get());}})}]}];

test('module management buttons control a real session and cleanup prevents stale UI actions',async()=>{
  const session=createProjectSession({catalog});await session.open(project);await session.dispatch('demo.feature:set',{value:7});
  const parent=new Element('div'),errors=[],dispose=renderModuleManager({document,parent,session,onError:error=>errors.push(error)});
  const button=label=>walk(parent).find(node=>node.tagName==='button'&&node.textContent===label);
  await button('Pausar').click();assert.equal(session.status().core.functions[0].status,'paused');
  await assert.rejects(session.dispatch('demo.feature:read'),{code:'inactive_command'});
  await button('Continuar').click();assert.deepEqual(await session.dispatch('demo.feature:read'),{value:7});
  await button('Desactivar').click();assert.equal(session.status().core.functions.length,0);assert.equal(session.project.modules[0].enabled,false);
  await button('Activar').click();assert.deepEqual(await session.dispatch('demo.feature:read'),{value:7});
  await button('Quitar del proyecto').click();assert.equal(session.project.modules.length,0);
  const stale=button('Añadir');dispose();assert.equal(parent.children.length,0);assert.equal(stale.handlers.size,0);await stale.click();assert.equal(session.project.modules.length,0);
  assert.equal(errors.length,0);await session.dispose();
});
test('function controls update actual root selection while preserving its state for reactivation',async()=>{
  const session=createProjectSession({catalog});await session.open(project);await session.dispatch('demo.feature:set',{value:3});
  const parent=new Element('div'),dispose=renderModuleManager({document,parent,session});
  let check=walk(parent).find(node=>node.tagName==='input');assert.equal(check.checked,true);check.checked=false;await check.handlers.get('change')();
  assert.equal(session.host.status().functions.length,0);check=walk(parent).find(node=>node.tagName==='input');check.checked=true;await check.handlers.get('change')();
  assert.deepEqual(await session.dispatch('demo.feature:read'),{value:3});dispose();await session.dispose();
});
test('session transfer preserves opaque JSON and rejects unsafe data/world mismatches without evaluating code',()=>{
  const state={format:'smarttwin.module-state',version:1,worldId:'world.ui',functions:[{id:'future.feature',version:'8.0.0',schemaVersion:9,data:{code:'globalThis.injection=true'}}]};
  const parsed=parseSessionDocument(JSON.stringify({format:'smarttwin.project-session',version:1,project,state,pausedModules:['sector.demo']}));
  assert.deepEqual(parsed.settings.state,state);assert.deepEqual(parsed.settings.pausedModules,['sector.demo']);assert.equal(globalThis.injection,undefined);
  assert.throws(()=>parseSessionDocument(JSON.stringify({format:'smarttwin.project-session',version:1,project,state:{...state,worldId:'world.other'}})),{code:'world_mismatch'});
  assert.throws(()=>parseSessionDocument('{"format":"smarttwin.project","__proto__":{}}'),{code:'unsafe_key'});
  assert.throws(()=>parseSessionDocument('null'),{code:'invalid_project'});
});
test('project transfer blocks editing while busy and cleans pending download URLs/listeners',async()=>{
  const session=createProjectSession({catalog});await session.open(project);const parent=new Element('div'),urls=[],revoked=[];
  const window={Blob:class{},URL:{createObjectURL(){const url='blob:'+urls.length;urls.push(url);return url;},revokeObjectURL:url=>revoked.push(url)},setTimeout(){}};
  const dispose=mountProjectTransfer({document,window,parent,session});const save=walk(parent).find(node=>node.textContent==='Descargar proyecto y estado');save.click();assert.equal(urls.length,1);
  dispose();assert.deepEqual(revoked,urls);assert.equal(save.handlers.size,0);assert.equal(parent.children.length,0);await session.dispose();
});
