import test from 'node:test';
import assert from 'node:assert/strict';
import {createHost} from '../../packages/core/index.js';
import {workspaceModule} from '../../modules/logistica-industrial/application/workspace.js';
const create = world => createHost({catalog:[workspaceModule],worldId:'world.workspace-lifecycle',grants:['domain.industrial-world'],ports:{'domain.industrial-world':world}});
const activate = host => host.activate('sector.logistics-industrial',{functions:['logistics.workspace']});
function fixture() {
  const context={frameworkHost:null}, state={running:false,dispose:0,uiListeners:3};
  const world={start(){state.running=true;},context:()=>context,capture:()=>({running:state.running}),dispose(){state.running=false;state.dispose++;}};
  return {context,state,world};
}
test('page-lifetime Workspace rejects hot removal and framework pause while preserving its live world',async()=>{
  const {world,state,context}=fixture(),host=create(world); await activate(host);context.frameworkHost=host;
  await assert.rejects(host.remove('sector.logistics-industrial'),{code:'removal_blocked'});await assert.rejects(host.pause('sector.logistics-industrial'),{code:'workspace_page_lifetime'});
  assert.equal(state.running,true);assert.equal(state.dispose,0);assert.equal(state.uiListeners,3);assert.equal(host.status().functions[0].status,'active');assert.deepEqual(await host.dispatch('logistics.workspace:capture'),{running:true});
  await assert.rejects(host.dispose(),{code:'removal_blocked'});assert.equal(context.frameworkHost,host);await host.dispose({force:true});
});
test('terminal shutdown stops the world and clears only its framework reference and stale command closures',async()=>{
  const {world,state,context}=fixture(),host=create(world);await activate(host);context.frameworkHost=host;
  const retained=host.registry('commands').find(entry=>entry.key==='logistics.workspace:context').value;assert.equal(retained(),context);
  await host.dispose({force:true});assert.equal(state.running,false);assert.equal(state.dispose,1);assert.equal(context.frameworkHost,null);assert.deepEqual(host.registry('commands'),[]);assert.throws(()=>retained(),{code:'workspace_unavailable'});assert.equal(host.status().disposed,true);
  // It deliberately does not claim that three legacy UI listeners were freed.
  assert.equal(state.uiListeners,3);
});
test('failed startup cleans the partial world without clearing an unrelated context host',async()=>{
  const {world,state,context}=fixture();const unrelated={worldId:'world.other',status:()=>({disposed:false,functions:[]})};context.frameworkHost=unrelated;world.start=()=>{throw new Error('injected startup failure');};const host=create(world);
  await assert.rejects(activate(host),/injected startup failure/);assert.equal(state.dispose,1);assert.equal(context.frameworkHost,unrelated);assert.deepEqual(host.status().functions,[]);await host.dispose();
});
test('late asynchronous world startup is stopped again after its cancelled activation',async()=>{
  let resolve,entered;const started=new Promise(done=>{entered=done;}),pending=new Promise(done=>{resolve=done;}),{world,state}=fixture();world.start=async()=>{entered();await pending;state.running=true;};const host=create(world),activation=activate(host);await started;const rejection=assert.rejects(activation,{code:'activation_cancelled'});await host.dispose({force:true});await rejection;resolve();await new Promise(done=>setImmediate(done));assert.equal(state.running,false);assert.equal(state.dispose,2);
});
