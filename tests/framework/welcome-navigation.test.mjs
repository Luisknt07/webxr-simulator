import test from 'node:test';
import assert from 'node:assert/strict';
import {createWelcomeNavigation, screenFromHash} from '../../apps/public-viewer/WelcomeNavigation.mjs';

function setup({start} = {}) {
  const events=[],state={active:false,starts:0,stops:0},history=[];
  const navigation=createWelcomeNavigation({
    showScreen(screen,options){events.push({screen,...options});},
    async startDemo(){state.starts++;state.active=true;return start ? start() : {dispose:async()=>{state.active=false;}};},
    async stopDemo(){if(state.active){state.stops++;state.active=false;}},
    writeHistory(hash,mode){history.push({hash,mode});},
    focusScreen(screen){events.push({focus:screen});},
    onFailure(error){events.push({failure:error.message});}
  });
  return {navigation,events,state,history};
}

test('the welcome and catalogue never start GPU work; only an explicit scene choice does',async()=>{
  const {navigation,state,history}=setup();
  await navigation.restore('');assert.equal(navigation.getStats().screen,'welcome');assert.equal(state.starts,0);
  await navigation.gallery();assert.equal(navigation.getStats().screen,'gallery');assert.equal(state.starts,0);
  await navigation.openDemo();assert.equal(navigation.getStats().screen,'demo');assert.equal(state.starts,1);assert.equal(state.active,true);
  await navigation.gallery();assert.equal(state.stops,1);assert.equal(state.active,false);assert.equal(navigation.getStats().screen,'gallery');
  await navigation.home();assert.equal(navigation.getStats().screen,'welcome');assert.equal(state.starts,1);
  assert.deepEqual(history.map(row=>row.hash),['#inicio','#escenarios','#demostracion','#escenarios','#inicio']);
});

test('history back and forward restore screens without automatically reopening 3D',async()=>{
  const {navigation,state,history}=setup();await navigation.gallery();await navigation.openDemo();
  await navigation.restore('#escenarios');assert.equal(state.stops,1);assert.equal(state.active,false);
  await navigation.restore('#demostracion');assert.equal(navigation.getStats().screen,'gallery');assert.equal(state.starts,1);
  assert.deepEqual(history[history.length-1],{hash:'#escenarios',mode:'replace'});
  for(const hash of ['#inicio','#wrong','#demostracion?scene=private','#workspace-access',''])assert.equal(screenFromHash(hash),'welcome');
  assert.equal(screenFromHash('#demostracion'),'gallery');assert.equal(screenFromHash('#escenarios'),'gallery');
});

test('leaving while a renderer starts cancels the presentation and disposes a late result',async()=>{
  let resolve,entered,disposed=0;const pending=new Promise(done=>{resolve=done;}),started=new Promise(done=>{entered=done;}),{navigation,state,events}=setup({start:()=>{entered();return pending;}});
  await navigation.gallery();const launch=navigation.openDemo();await started;assert.equal(state.starts,1);
  await navigation.home();assert.equal(state.active,false);assert.equal(navigation.getStats().screen,'welcome');
  resolve({dispose:async()=>{disposed++;}});assert.equal(await launch,false);assert.equal(disposed,1);
  assert.equal(navigation.getStats().screen,'welcome');assert(!events.some(event=>event.focus==='demo'));
});

test('duplicate history events share teardown and reentry waits until XR/GPU cleanup finishes',async()=>{
  let active=false,starts=0,stops=0,release,entered;
  const cleanup=new Promise(done=>{release=done;}),stopping=new Promise(done=>{entered=done;});
  const navigation=createWelcomeNavigation({showScreen(){},writeHistory(){},async startDemo(){starts++;active=true;return {dispose:async()=>{}};},async stopDemo(){if(active){stops++;entered();await cleanup;active=false;}}});
  await navigation.gallery();await navigation.openDemo();
  const back=navigation.restore('#escenarios'),duplicate=navigation.restore('#escenarios');await stopping;
  const reenter=navigation.openDemo();assert.equal(stops,1);assert.equal(starts,1,'A new renderer waits for the previous cleanup.');
  release();await Promise.all([back,duplicate,reenter]);assert.equal(starts,2);assert.equal(stops,1);await navigation.dispose();
});

test('failed loading returns to the catalogue; reentry and terminal cleanup remain safe',async()=>{
  let attempts=0;const {navigation,state,events}=setup({start:()=>{if(!attempts++)throw Error('Retry this scene');return {dispose:async()=>{}};}});
  await navigation.gallery();assert.equal(await navigation.openDemo(),false);assert.equal(navigation.getStats().screen,'gallery');assert.equal(navigation.getStats().loading,false);
  assert(events.some(event=>event.failure==='Retry this scene'));assert.equal(state.active,false);
  assert.equal(await navigation.openDemo(),true);await navigation.dispose();assert.equal(state.active,false);assert.equal(await navigation.openDemo(),false);
});
